-- Checkpoint 5A-2: Rider-only execution permissions and transactional guards.
-- No DML reconciliation, monetary corrections, Customer Payment or constraint changes.

CREATE OR REPLACE FUNCTION public.fdg_rider_end_work()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Historical company cash is a guard only; never reconcile or close it here.
  if exists(select 1 from public.work_sessions where rider_id=v_actor
    and round(coalesce(remaining_company_money,0),2)<>0) then
    raise exception 'CASH_REMITTANCE_REQUIRED';
  end if;
  if exists(select 1 from public.rider_collection_batches where rider_id=v_actor
    and status in ('pending','verifying')) then
    raise exception 'PENDING_SCAN_BATCH_REMAINS';
  end if;
  if exists(select 1 from public.rider_remittances where rider_id=v_actor
    and status in ('pending','verifying')) then
    raise exception 'PENDING_REMITTANCE_REMAINS';
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

CREATE OR REPLACE FUNCTION public.fdg_rider_create_scan_batch(p_collection_ids uuid[], p_gps_lat numeric, p_gps_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Match CASH lock order: work session, then loan, before validating.
  perform 1 from public.work_sessions ws
  where ws.rider_id=v_actor and ws.work_date=v_today and ws.status::text='working'
  for update;
  if not found then raise exception 'ACTIVE_RIDER_WORK_SESSION_NOT_FOUND'; end if;
  perform 1 from public.loans l where l.id in
    (select c.loan_id from public.collections c where c.id=any(p_collection_ids))
  order by l.id for update;

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

CREATE OR REPLACE FUNCTION public.fdg_rider_collect_cash_bundle(p_collection_ids uuid[], p_evidence_path text, p_gps_lat numeric, p_gps_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.fdg_current_staff_public_id();v_user public.users%rowtype;v_today date:=(now() at time zone 'Asia/Bangkok')::date;v_valid record;v_ws public.work_sessions%rowtype;v_loan public.loans%rowtype;v_col public.collections%rowtype;v_inst public.loan_installments%rowtype;v_batch_id uuid;v_payment_id uuid;v_contract numeric;v_fee numeric;v_total numeric:=0;v_contract_total numeric:=0;v_fee_total numeric:=0;v_before numeric;v_after numeric;v_interest_component numeric;v_principal_component numeric;v_rate numeric;v_commission numeric;v_commission_total numeric:=0;
begin select * into v_user from public.users where id=v_actor;if not found or v_user.role::text<>'rider' or v_user.status::text<>'active' then raise exception 'Unauthorized';end if;if nullif(btrim(p_evidence_path),'') is null then raise exception 'EVIDENCE_REQUIRED';end if;if p_gps_lat is null or p_gps_lng is null then raise exception 'GPS_REQUIRED';end if;
  select * into v_valid from public.fdg_validate_rider_collection_selection(v_actor,p_collection_ids);
  if exists(
    select 1 from public.rider_collection_batch_items bi
    join public.rider_collection_batches b on b.id=bi.batch_id
    where bi.collection_id=any(p_collection_ids) and b.status in ('pending','verifying')
  ) then raise exception 'SCAN_BATCH_ALREADY_OPEN'; end if;
  select * into v_ws from public.work_sessions where rider_id=v_actor and work_date=v_today and status::text='working' for update limit 1;if not found then raise exception 'ACTIVE_RIDER_WORK_SESSION_NOT_FOUND';end if;
  select * into v_loan from public.loans where id=v_valid.loan_id for update;if not found or v_loan.status::text<>'active' then raise exception 'LOAN_NOT_ACTIVE';end if;
  -- Revalidate after acquiring locks; another CASH/SCAN request may have won.
  select * into v_valid from public.fdg_validate_rider_collection_selection(v_actor,p_collection_ids);
  if exists(select 1 from public.rider_collection_batch_items bi
    join public.rider_collection_batches b on b.id=bi.batch_id
    where bi.collection_id=any(p_collection_ids) and b.status in ('pending','verifying')) then
    raise exception 'SCAN_BATCH_ALREADY_OPEN';
  end if;
  insert into public.rider_collection_batches(rider_id,customer_id,loan_id,payment_method,status,evidence_path,gps_lat,gps_lng,evidence_captured_at) values(v_actor,v_valid.customer_id,v_valid.loan_id,'CASH','verified',p_evidence_path,p_gps_lat,p_gps_lng,now()) returning id into v_batch_id;
  v_rate:=coalesce(nullif(v_user.commission_rate,0),public.fdg_setting_numeric('rider_commission_rate',0.07));
  for v_col in select c.* from public.collections c join public.loan_installments li on li.id=c.installment_id where c.id=any(p_collection_ids) order by li.due_date,li.installment_no for update loop
    select * into v_inst from public.loan_installments where id=v_col.installment_id for update;v_contract:=round(greatest(v_inst.amount_due-coalesce(v_inst.amount_paid,0),0),2);v_fee:=public.fdg_installment_late_fee(v_inst.due_date,now());if v_contract<=0 then raise exception 'INSTALLMENT_ALREADY_PAID';end if;
    v_before:=v_loan.remaining_balance;v_interest_component:=least(greatest(round(v_inst.interest_due,2),0),v_contract);v_principal_component:=greatest(round(v_contract-v_interest_component,2),0);v_after:=greatest(round(v_before-v_contract,2),0);
    insert into public.loan_payments(customer_id,loan_id,installment_id,payment_channel,payment_type,payment_source,gross_due,late_fee_amount,points_used,discount_amount,cash_amount,amount_received,principal_applied,interest_applied,balance_before,balance_after,collected_by,status,verified_at,evidence_path,rider_collection_batch_id)
    values(v_col.customer_id,v_col.loan_id,v_col.installment_id,'CASH','FULL','RIDER_CASH',v_contract,v_fee,0,0,v_contract+v_fee,v_contract+v_fee,v_principal_component,v_interest_component,v_before,v_after,v_actor,'verified',now(),p_evidence_path,v_batch_id) returning id into v_payment_id;
    update public.loans set remaining_balance=v_after,status=case when v_after<=0 then 'completed' else status end,updated_at=now() where id=v_loan.id;v_loan.remaining_balance:=v_after;
    update public.loan_installments set amount_paid=least(round(amount_paid+v_contract,2),amount_due),status=case when round(amount_paid+v_contract,2)>=amount_due then 'paid' else 'partial' end,paid_at=case when round(amount_paid+v_contract,2)>=amount_due then now() else paid_at end,updated_at=now() where id=v_inst.id;
    update public.collections set status='collected',collected_at=now(),work_session_id=v_ws.id,loan_payment_id=v_payment_id,updated_at=now() where id=v_col.id;
    insert into public.rider_collection_batch_items(batch_id,collection_id,installment_id,due_date,installment_no,contract_amount,late_days,late_fee_amount,total_amount,loan_payment_id) values(v_batch_id,v_col.id,v_inst.id,v_inst.due_date,v_inst.installment_no,v_contract,public.fdg_installment_late_days(v_inst.due_date,now()),v_fee,v_contract+v_fee,v_payment_id);
    v_commission:=round(v_contract*v_rate,2);v_commission_total:=v_commission_total+v_commission;insert into public.commissions(rider_id,collection_id,order_amount,rate,commission_amount,work_date) values(v_actor,v_col.id,v_contract,v_rate,v_commission,v_today) on conflict(collection_id) do nothing;
    v_contract_total:=v_contract_total+v_contract;v_fee_total:=v_fee_total+v_fee;v_total:=v_total+v_contract+v_fee;
  end loop;
  update public.work_sessions set total_collected=round(total_collected+v_total,2),remaining_company_money=round(remaining_company_money+v_total,2),can_checkout=false,updated_at=now() where id=v_ws.id;
  update public.rider_collection_batches set contractual_amount=round(v_contract_total,2),late_fee_amount=round(v_fee_total,2),total_amount=round(v_total,2),verified_at=now(),updated_at=now() where id=v_batch_id;
  perform public.fdg_process_referral_after_payment(v_valid.customer_id,v_valid.loan_id);
  perform public.fdg_write_log('RIDER_CASH_BUNDLE_COLLECTED',v_actor,'rider','Rider รับเงินสดหลายงวดพร้อมรูป/GPS',jsonb_build_object('batch_id',v_batch_id,'collection_ids',p_collection_ids,'contractual_amount',round(v_contract_total,2),'late_fee_amount',round(v_fee_total,2),'total_amount',round(v_total,2),'commission_amount',round(v_commission_total,2),'gps_lat',p_gps_lat,'gps_lng',p_gps_lng),true);
  return jsonb_build_object('status','verified','batch_id',v_batch_id,'contractual_amount',round(v_contract_total,2),'late_fee_amount',round(v_fee_total,2),'total_amount',round(v_total,2),'commission_amount',round(v_commission_total,2));end $function$;

CREATE OR REPLACE FUNCTION public.fdg_finalize_rider_scan_batch(p_batch_id uuid, p_transaction_reference text, p_actual_amount numeric, p_slip_verification_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_batch public.rider_collection_batches%rowtype;v_item public.rider_collection_batch_items%rowtype;v_col public.collections%rowtype;v_inst public.loan_installments%rowtype;v_loan public.loans%rowtype;v_payment_id uuid;v_first_payment_id uuid:=null;v_first boolean:=true;v_before numeric;v_after numeric;v_interest_component numeric;v_principal_component numeric;
begin if nullif(btrim(p_transaction_reference),'') is null then raise exception 'TRANSACTION_REFERENCE_REQUIRED';end if;
  select * into v_batch from public.rider_collection_batches where id=p_batch_id for update;if not found then raise exception 'BATCH_NOT_FOUND';end if;if v_batch.payment_method<>'SCAN' then raise exception 'BATCH_NOT_SCAN';end if;if v_batch.status='verified' then return jsonb_build_object('status','verified','batch_id',v_batch.id,'total_amount',v_batch.total_amount);end if;if v_batch.status not in ('pending','verifying','failed') then raise exception 'BATCH_NOT_FINALIZABLE';end if;if round(coalesce(p_actual_amount,0),2)<>round(v_batch.total_amount,2) then raise exception 'AMOUNT_MISMATCH';end if;
  insert into public.bank_transaction_refs(transaction_reference,owner_type,owner_id,amount) values(btrim(p_transaction_reference),'RIDER_CUSTOMER_SCAN',v_batch.id,p_actual_amount);
  select * into v_loan from public.loans where id=v_batch.loan_id for update;if not found or v_loan.status::text<>'active' then raise exception 'LOAN_NOT_ACTIVE';end if;
  for v_item in select * from public.rider_collection_batch_items where batch_id=v_batch.id order by due_date,installment_no for update loop
    select * into v_col from public.collections where id=v_item.collection_id for update;if not found or v_col.status::text<>'pending' then raise exception 'COLLECTION_ALREADY_PROCESSED';end if;select * into v_inst from public.loan_installments where id=v_item.installment_id for update;
    -- A quote cannot allocate money against an installment changed meanwhile.
    if not found or v_col.rider_id is distinct from v_batch.rider_id
      or v_col.customer_id is distinct from v_batch.customer_id
      or v_col.loan_id is distinct from v_batch.loan_id
      or v_inst.loan_id is distinct from v_batch.loan_id
      or round(greatest(v_inst.amount_due-coalesce(v_inst.amount_paid,0),0),2)
         <>round(v_item.contract_amount,2)
      or v_item.contract_amount<=0
      or round(v_item.total_amount,2)<>round(v_item.contract_amount+v_item.late_fee_amount,2)
    then raise exception 'BATCH_INSTALLMENT_CHANGED_REQUIRES_REVIEW'; end if;
    v_before:=v_loan.remaining_balance;v_interest_component:=least(greatest(round(v_inst.interest_due,2),0),v_item.contract_amount);v_principal_component:=greatest(round(v_item.contract_amount-v_interest_component,2),0);v_after:=greatest(round(v_before-v_item.contract_amount,2),0);
    insert into public.loan_payments(customer_id,loan_id,installment_id,payment_channel,payment_type,payment_source,gross_due,late_fee_amount,points_used,discount_amount,cash_amount,amount_received,principal_applied,interest_applied,balance_before,balance_after,collected_by,status,verified_at,evidence_path,transaction_reference,rider_collection_batch_id)
    values(v_batch.customer_id,v_batch.loan_id,v_item.installment_id,'SCAN','FULL','CUSTOMER_SCAN',v_item.contract_amount,v_item.late_fee_amount,0,0,v_item.total_amount,v_item.total_amount,v_principal_component,v_interest_component,v_before,v_after,v_batch.rider_id,'verified',now(),v_batch.evidence_path,case when v_first then btrim(p_transaction_reference) else null end,v_batch.id) returning id into v_payment_id;
    if v_first then v_first_payment_id:=v_payment_id;v_first:=false;end if;
    update public.loans set remaining_balance=v_after,status=case when v_after<=0 then 'completed' else status end,updated_at=now() where id=v_loan.id;v_loan.remaining_balance:=v_after;
    update public.loan_installments set amount_paid=least(round(amount_paid+v_item.contract_amount,2),amount_due),status=case when round(amount_paid+v_item.contract_amount,2)>=amount_due then 'paid' else 'partial' end,paid_at=case when round(amount_paid+v_item.contract_amount,2)>=amount_due then now() else paid_at end,updated_at=now() where id=v_inst.id;
    update public.collections set status='collected',collected_at=now(),loan_payment_id=v_payment_id,updated_at=now() where id=v_col.id;update public.rider_collection_batch_items set loan_payment_id=v_payment_id where id=v_item.id;
  end loop;
  update public.rider_collection_batches set status='verified',transaction_reference=btrim(p_transaction_reference),verified_at=now(),updated_at=now() where id=v_batch.id;
  if p_slip_verification_id is not null then update public.slip_verifications set status='verified',transaction_reference=btrim(p_transaction_reference),amount=p_actual_amount,expected_amount=v_batch.total_amount,is_duplicate=false,is_amount_matched=true,is_account_matched=true,rider_id=v_batch.rider_id,customer_id=v_batch.customer_id,loan_id=v_batch.loan_id,loan_payment_id=v_first_payment_id,rider_collection_batch_id=v_batch.id,verification_type='RIDER_CUSTOMER_SCAN',verified_at=now() where id=p_slip_verification_id;end if;
  perform public.fdg_process_referral_after_payment(v_batch.customer_id,v_batch.loan_id);perform public.fdg_write_log('RIDER_DESTINATION_SCAN_VERIFIED',v_batch.rider_id,'rider','ลูกค้าสแกนปลายทางบนมือถือ Rider และ EasySlip VERIFIED',jsonb_build_object('batch_id',v_batch.id,'transaction_reference',btrim(p_transaction_reference),'actual_amount',p_actual_amount,'late_fee_amount',v_batch.late_fee_amount),true);
  return jsonb_build_object('status','verified','batch_id',v_batch.id,'amount_received',p_actual_amount,'total_amount',v_batch.total_amount,'loan_balance_after',v_loan.remaining_balance);
exception when unique_violation then raise exception 'DUPLICATE_BANK_TRANSACTION';end $function$;

REVOKE EXECUTE ON FUNCTION public.fdg_finalize_rider_scan_batch(uuid,text,numeric,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fdg_fail_rider_scan_batch(uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fdg_finalize_rider_scan_batch(uuid,text,numeric,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fdg_fail_rider_scan_batch(uuid,uuid,text,text,jsonb) TO service_role;
