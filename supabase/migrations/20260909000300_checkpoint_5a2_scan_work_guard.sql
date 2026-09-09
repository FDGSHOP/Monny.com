-- Checkpoint 5A-2: Rider destination SCAN must be created only during an
-- active work session, matching the existing CASH server-side guard.

create or replace function public.fdg_rider_create_scan_batch(
  p_collection_ids uuid[],
  p_gps_lat numeric,
  p_gps_lng numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := public.fdg_current_staff_public_id();
  v_user public.users%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_valid record;
  v_col public.collections%rowtype;
  v_inst public.loan_installments%rowtype;
  v_batch_id uuid;
  v_code text;
  v_contract numeric;
  v_fee numeric;
  v_contract_total numeric := 0;
  v_fee_total numeric := 0;
  v_total numeric := 0;
begin
  select * into v_user from public.users where id = v_actor;
  if not found or v_user.role::text <> 'rider' or v_user.status::text <> 'active'
     or v_user.deleted_at is not null then
    raise exception 'Unauthorized';
  end if;
  if p_gps_lat is null or p_gps_lng is null then
    raise exception 'GPS_REQUIRED';
  end if;

  if not exists(
    select 1
    from public.work_sessions ws
    where ws.rider_id = v_actor
      and ws.work_date = v_today
      and ws.status::text = 'working'
  ) then
    raise exception 'ACTIVE_RIDER_WORK_SESSION_NOT_FOUND';
  end if;

  update public.rider_collection_batches
  set status = 'expired', updated_at = now()
  where rider_id = v_actor
    and payment_method = 'SCAN'
    and status in ('pending', 'failed')
    and created_at < now() - interval '10 minutes';

  select * into v_valid
  from public.fdg_validate_rider_collection_selection(v_actor, p_collection_ids);

  if exists(
    select 1
    from public.rider_collection_batch_items bi
    join public.rider_collection_batches b on b.id = bi.batch_id
    where bi.collection_id = any(p_collection_ids)
      and b.status in ('pending', 'verifying')
  ) then
    raise exception 'SCAN_BATCH_ALREADY_OPEN';
  end if;

  insert into public.rider_collection_batches(
    rider_id, customer_id, loan_id, payment_method, status,
    gps_lat, gps_lng, created_at, updated_at
  )
  values(
    v_actor, v_valid.customer_id, v_valid.loan_id, 'SCAN', 'pending',
    p_gps_lat, p_gps_lng, now(), now()
  )
  returning id, batch_code into v_batch_id, v_code;

  for v_col in
    select c.*
    from public.collections c
    join public.loan_installments li on li.id = c.installment_id
    where c.id = any(p_collection_ids)
    order by li.due_date, li.installment_no
  loop
    select * into v_inst
    from public.loan_installments
    where id = v_col.installment_id;

    v_contract := round(greatest(v_inst.amount_due - coalesce(v_inst.amount_paid, 0), 0), 2);
    v_fee := public.fdg_installment_late_fee(v_inst.due_date, now());

    insert into public.rider_collection_batch_items(
      batch_id, collection_id, installment_id, due_date, installment_no,
      contract_amount, late_days, late_fee_amount, total_amount
    )
    values(
      v_batch_id, v_col.id, v_inst.id, v_inst.due_date, v_inst.installment_no,
      v_contract, public.fdg_installment_late_days(v_inst.due_date, now()),
      v_fee, v_contract + v_fee
    );

    v_contract_total := v_contract_total + v_contract;
    v_fee_total := v_fee_total + v_fee;
    v_total := v_total + v_contract + v_fee;
  end loop;

  update public.rider_collection_batches
  set contractual_amount = round(v_contract_total, 2),
      late_fee_amount = round(v_fee_total, 2),
      total_amount = round(v_total, 2),
      updated_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'status', 'pending',
    'batch_id', v_batch_id,
    'batch_code', v_code,
    'contractual_amount', round(v_contract_total, 2),
    'late_fee_amount', round(v_fee_total, 2),
    'total_amount', round(v_total, 2),
    'expires_in_minutes', 10
  );
end;
$function$;

