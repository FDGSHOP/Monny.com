-- Checkpoint 5A-2: make work_sessions agree with rider_daily_states and
-- reconcile only provably settled historical sessions. No monetary column is
-- changed by this migration.

create or replace function public.fdg_rider_end_work()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := public.fdg_current_staff_public_id();
  v_user public.users%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_ws public.work_sessions%rowtype;
  v_pending integer := 0;
begin
  select * into v_user from public.users where id = v_actor;
  if not found or v_user.role::text <> 'rider' or v_user.status::text <> 'active'
     or v_user.deleted_at is not null then
    raise exception 'Unauthorized';
  end if;

  select * into v_ws
  from public.work_sessions
  where rider_id = v_actor and work_date = v_today
  for update
  limit 1;

  if not found then
    raise exception 'ยังไม่ได้เริ่มงานวันนี้';
  end if;

  if v_ws.status::text = 'completed' then
    insert into public.rider_daily_states(
      rider_id, work_date, state, started_at, ended_at,
      locked_reason, locked_work_session_id
    )
    values(
      v_actor, v_today, 'CLOSED', coalesce(v_ws.start_time, now()),
      coalesce(v_ws.end_time, now()), null, null
    )
    on conflict(rider_id, work_date) do update
      set state = 'CLOSED',
          ended_at = coalesce(public.rider_daily_states.ended_at, excluded.ended_at),
          locked_reason = null,
          locked_work_session_id = null,
          updated_at = now();

    return jsonb_build_object(
      'status', 'closed',
      'work_date', v_today,
      'work_session_id', v_ws.id,
      'already_closed', true
    );
  end if;

  if v_ws.status::text <> 'working' then
    raise exception 'WORK_SESSION_NOT_ACTIVE';
  end if;

  if round(coalesce(v_ws.remaining_company_money, 0), 2) <> 0 then
    raise exception 'CASH_REMITTANCE_REQUIRED: %', v_ws.remaining_company_money;
  end if;

  select count(distinct c.customer_id) into v_pending
  from public.collections c
  join public.loan_installments li on li.id = c.installment_id
  where c.rider_id = v_actor
    and c.status::text = 'pending'
    and coalesce(c.due_date, li.due_date) <= v_today
    and greatest(li.amount_due - coalesce(li.amount_paid, 0), 0) > 0
    and not exists(
      select 1
      from public.rider_task_issues i
      where i.rider_id = v_actor
        and i.customer_id = c.customer_id
        and i.issue_date = v_today
        and i.status in ('pending_admin', 'confirmed')
    );

  if v_pending > 0 then
    raise exception 'PENDING_COLLECTIONS_REMAIN: %', v_pending;
  end if;

  update public.work_sessions
  set status = 'completed',
      end_time = now(),
      can_checkout = true,
      updated_at = now()
  where id = v_ws.id;

  insert into public.rider_daily_states(
    rider_id, work_date, state, started_at, ended_at,
    locked_reason, locked_work_session_id
  )
  values(v_actor, v_today, 'CLOSED', coalesce(v_ws.start_time, now()), now(), null, null)
  on conflict(rider_id, work_date) do update
    set state = 'CLOSED',
        ended_at = now(),
        locked_reason = null,
        locked_work_session_id = null,
        updated_at = now();

  perform public.fdg_write_log(
    'RIDER_END_WORK', v_actor, 'rider', 'Rider ปิดรอบงาน',
    jsonb_build_object('work_date', v_today, 'work_session_id', v_ws.id),
    true
  );

  return jsonb_build_object(
    'status', 'closed',
    'work_date', v_today,
    'work_session_id', v_ws.id
  );
end;
$function$;

-- A completed same-day session may be reopened because the existing UI offers
-- “start again”. Reopening is allowed only with zero company-money liability.
create or replace function public.fdg_rider_start_work()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid := public.fdg_current_staff_public_id();
  v_user public.users%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_lock jsonb;
  v_ws public.work_sessions%rowtype;
begin
  select * into v_user from public.users where id = v_actor;
  if not found or v_user.role::text <> 'rider' or v_user.status::text <> 'active'
     or v_user.deleted_at is not null then
    raise exception 'Unauthorized';
  end if;

  v_lock := public.fdg_rider_cash_lock_info(v_actor);
  if coalesce((v_lock->>'cash_locked')::boolean, false) then
    insert into public.rider_daily_states(
      rider_id, work_date, state, locked_reason, locked_work_session_id
    )
    values(
      v_actor, v_today, 'CASH_LOCKED',
      'มียอดเงินสดของบริษัทจากวันก่อนยังไม่ได้นำส่ง',
      (v_lock->>'work_session_id')::uuid
    )
    on conflict(rider_id, work_date) do update
      set state = 'CASH_LOCKED',
          locked_reason = excluded.locked_reason,
          locked_work_session_id = excluded.locked_work_session_id,
          updated_at = now();

    return jsonb_build_object(
      'status', 'cash_locked',
      'message', 'ต้องชำระเงินสดคงค้างของบริษัทให้ครบก่อนเริ่มงานวันใหม่',
      'lock', v_lock
    );
  end if;

  insert into public.work_sessions(
    rider_id, work_date, status, total_collected, total_returned,
    remaining_company_money, can_checkout
  )
  values(v_actor, v_today, 'working', 0, 0, 0, true)
  on conflict(rider_id, work_date) do update
    set status = 'working',
        end_time = null,
        can_checkout = true,
        updated_at = now()
    where public.work_sessions.status::text = 'completed'
      and round(coalesce(public.work_sessions.remaining_company_money, 0), 2) = 0
  returning * into v_ws;

  if not found then
    select * into v_ws
    from public.work_sessions
    where rider_id = v_actor and work_date = v_today
    limit 1;
  end if;

  if not found or v_ws.status::text <> 'working' then
    raise exception 'WORK_SESSION_NOT_REOPENABLE';
  end if;

  insert into public.rider_daily_states(
    rider_id, work_date, state, started_at, ended_at,
    locked_reason, locked_work_session_id
  )
  values(v_actor, v_today, 'WORKING', now(), null, null, null)
  on conflict(rider_id, work_date) do update
    set state = 'WORKING',
        started_at = coalesce(public.rider_daily_states.started_at, now()),
        ended_at = null,
        locked_reason = null,
        locked_work_session_id = null,
        updated_at = now();

  perform public.fdg_write_log(
    'RIDER_START_WORK', v_actor, 'rider', 'Rider เริ่มงาน',
    jsonb_build_object('work_date', v_today, 'work_session_id', v_ws.id),
    true
  );

  return jsonb_build_object(
    'status', 'working',
    'work_date', v_today,
    'work_session_id', v_ws.id
  );
end;
$function$;

-- Reconcile historical rows only when all accounting and operational guards
-- positively prove that the session is already settled. Sessions with any
-- company money (including 171.44), pending remittance, open scan, pending
-- admin review, or unresolved due task cannot match this predicate.
do $reconcile$
declare
  v_session record;
begin
  for v_session in
    select ws.*
    from public.work_sessions ws
    where ws.status::text = 'working'
      and ws.work_date < (now() at time zone 'Asia/Bangkok')::date
      and round(coalesce(ws.remaining_company_money, 0), 2) = 0
      and round(coalesce(ws.total_collected, 0), 2)
          = round(coalesce(ws.total_returned, 0), 2)
      and ws.can_checkout is true
      and not exists(
        select 1 from public.rider_remittances rr
        where rr.work_session_id = ws.id
          and rr.status in ('pending', 'verifying')
      )
      and not exists(
        select 1 from public.rider_collection_batches b
        where b.rider_id = ws.rider_id
          and (b.created_at at time zone 'Asia/Bangkok')::date = ws.work_date
          and b.status in ('pending', 'verifying')
      )
      and not exists(
        select 1 from public.rider_task_issues i
        where i.rider_id = ws.rider_id
          and i.issue_date = ws.work_date
          and i.status = 'pending_admin'
      )
      and not exists(
        select 1
        from public.collections c
        join public.loan_installments li on li.id = c.installment_id
        where c.rider_id = ws.rider_id
          and c.status::text = 'pending'
          and coalesce(c.due_date, li.due_date) <= ws.work_date
          and greatest(li.amount_due - coalesce(li.amount_paid, 0), 0) > 0
      )
    for update
  loop
    update public.work_sessions
    set status = 'completed',
        end_time = coalesce(end_time, updated_at, created_at),
        can_checkout = true,
        updated_at = now()
    where id = v_session.id;

    insert into public.rider_daily_states(
      rider_id, work_date, state, started_at, ended_at,
      locked_reason, locked_work_session_id
    )
    values(
      v_session.rider_id,
      v_session.work_date,
      'CLOSED',
      coalesce(v_session.start_time, v_session.created_at),
      coalesce(v_session.end_time, v_session.updated_at, v_session.created_at),
      null,
      null
    )
    on conflict(rider_id, work_date) do update
      set state = 'CLOSED',
          ended_at = coalesce(public.rider_daily_states.ended_at, excluded.ended_at),
          locked_reason = null,
          locked_work_session_id = null,
          updated_at = now();
  end loop;
end;
$reconcile$;
