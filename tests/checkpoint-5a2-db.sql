-- Run through an administrative SQL connection. The final deliberate exception
-- rolls back ALL fixtures, logs, rewards and ledger writes. Never remove it.
DO $test$
DECLARE
  rider uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  customer uuid; loan uuid; inst uuid; ws uuid; ids uuid[];
  today date := (now() at time zone 'Asia/Bangkok')::date;
  due date; fee numeric; scenario text; n integer; i integer;
  result jsonb := '[]'; observed jsonb; response jsonb; snap jsonb;
  batch uuid; issue uuid; err text; stage text; principal numeric;
BEGIN
  FOREACH scenario IN ARRAY ARRAY['cash_single_fee','cash_multi_fee','cash_no_fee','scan_multi_fee','oldest_first','cash_atomic','scan_atomic','issue_review','end_work_money','end_work_pending','interest_only','customer_regression','scan_duplicate','scan_stale_quote','end_work_scan','scan_without_work','photo_required','gps_required','no_answer_spacing','end_work_closed'] LOOP
    stage := 'fixture'; observed := '{}';
    BEGIN
      rider := gen_random_uuid(); admin_id := gen_random_uuid();
      INSERT INTO auth.users(id,email) VALUES(rider,rider||'@5a2.invalid'),(admin_id,admin_id||'@5a2.invalid');
      INSERT INTO public.users(id,username,display_name,role,status,commission_rate) VALUES(rider,rider||'@5a2.invalid','ROLLBACK 5A2 Rider','rider','active',0.07),(admin_id,admin_id||'@5a2.invalid','ROLLBACK 5A2 Admin','admin','active',0);
      PERFORM set_config('request.jwt.claim.sub',rider::text,true);
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',rider,'role','authenticated')::text,true);
      INSERT INTO public.work_sessions(rider_id,work_date,status,start_time) VALUES(rider,today,'working',now()) RETURNING id INTO ws;
      INSERT INTO public.customers(customer_code,full_name) VALUES('TEST-5A2-'||gen_random_uuid(),'ROLLBACK 5A2 Customer') RETURNING id INTO customer;
      n := CASE WHEN scenario IN ('cash_multi_fee','scan_multi_fee','oldest_first','cash_atomic','scan_atomic') THEN 2 ELSE 1 END;
      INSERT INTO public.loans(loan_code,customer_id,amount,remaining_balance,payment_channel,disbursement_status) VALUES('TEST-5A2-'||gen_random_uuid(),customer,80*n,100*n,'CASH','paid') RETURNING id INTO loan;
      SELECT d INTO due FROM generate_series(today-2,today,interval '1 day') x(d) WHERE public.fdg_installment_late_fee(d::date,now())=50 LIMIT 1;
      IF scenario='cash_no_fee' THEN due:=today; END IF;
      IF due IS NULL THEN RAISE EXCEPTION 'Cannot produce fee 50 from current settings'; END IF;
      fee:=public.fdg_installment_late_fee(due,now());
      FOR i IN 1..n LOOP
        INSERT INTO public.loan_installments(loan_id,installment_no,due_date,principal_due,interest_due,amount_due) VALUES(loan,i,due,80,20,100) RETURNING id INTO inst;
      END LOOP;
      UPDATE public.collections SET rider_id=rider WHERE loan_id=loan;
      SELECT array_agg(c.id ORDER BY li.due_date,li.installment_no) INTO ids FROM public.collections c JOIN public.loan_installments li ON li.id=c.installment_id WHERE c.loan_id=loan;
      stage:=scenario;
      IF scenario IN ('cash_single_fee','cash_multi_fee','cash_no_fee','end_work_money') THEN
        response:=public.fdg_rider_collect_cash_bundle(ids,'rollback-only/evidence.jpg',19.1,99.9);
      ELSIF scenario='scan_multi_fee' THEN
        response:=public.fdg_rider_create_scan_batch(ids,19.1,99.9); batch:=(response->>'batch_id')::uuid;
        response:=public.fdg_finalize_rider_scan_batch(batch,'TEST-5A2-'||gen_random_uuid(),(response->>'total_amount')::numeric,NULL);
        observed:=jsonb_build_object('bank_refs',(SELECT count(*) FROM public.bank_transaction_refs WHERE owner_id=batch),'payment_refs',(SELECT count(*) FROM public.loan_payments WHERE rider_collection_batch_id=batch AND transaction_reference IS NOT NULL));
      ELSIF scenario IN ('scan_duplicate','scan_stale_quote','end_work_scan') THEN
        response:=public.fdg_rider_create_scan_batch(ids,19.1,99.9); batch:=(response->>'batch_id')::uuid;
        IF scenario='scan_duplicate' THEN
          INSERT INTO public.bank_transaction_refs(transaction_reference,owner_type,owner_id,amount) VALUES('TEST-5A2-DUPLICATE','RIDER_CUSTOMER_SCAN',batch,150);
          BEGIN PERFORM public.fdg_finalize_rider_scan_batch(batch,'TEST-5A2-DUPLICATE',150,NULL); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
          EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%DUPLICATE_BANK_TRANSACTION%' THEN RAISE; END IF;observed:=jsonb_build_object('rejection',SQLERRM);END;
        ELSIF scenario='scan_stale_quote' THEN
          UPDATE public.loan_installments SET amount_paid=10 WHERE id=inst;
          BEGIN PERFORM public.fdg_finalize_rider_scan_batch(batch,'TEST-5A2-STALE',150,NULL); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
          EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%BATCH_INSTALLMENT_CHANGED_REQUIRES_REVIEW%' THEN RAISE; END IF;observed:=jsonb_build_object('rejection',SQLERRM);END;
        ELSE
          PERFORM public.fdg_rider_log_call_attempt(customer,19.1,99.9);
          PERFORM public.fdg_rider_submit_issue(customer,'NOT_HOME','ROLLBACK TEST','rollback-only/evidence.jpg',19.1,99.9);
          BEGIN PERFORM public.fdg_rider_end_work(); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
          EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%PENDING_SCAN_BATCH_REMAINS%' THEN RAISE; END IF;observed:=jsonb_build_object('rejection',SQLERRM);END;
        END IF;
      ELSIF scenario='scan_without_work' THEN
        UPDATE public.work_sessions SET status='completed' WHERE id=ws;
        BEGIN PERFORM public.fdg_rider_create_scan_batch(ids,19.1,99.9); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%ACTIVE_RIDER_WORK_SESSION_NOT_FOUND%' THEN RAISE; END IF;observed:=jsonb_build_object('rejection',SQLERRM);END;
      ELSIF scenario IN ('photo_required','gps_required') THEN
        BEGIN PERFORM public.fdg_rider_collect_cash_bundle(ids,CASE WHEN scenario='photo_required' THEN NULL ELSE 'rollback-only/evidence.jpg' END,CASE WHEN scenario='gps_required' THEN NULL ELSE 19.1 END,99.9); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE (CASE WHEN scenario='photo_required' THEN '%EVIDENCE_REQUIRED%' ELSE '%GPS_REQUIRED%' END) THEN RAISE; END IF;observed:=jsonb_build_object('rejection',SQLERRM);END;
      ELSIF scenario='no_answer_spacing' THEN
        PERFORM public.fdg_rider_log_call_attempt(customer,19.1,99.9);
        PERFORM public.fdg_rider_log_call_attempt(customer,19.1,99.9);
        BEGIN PERFORM public.fdg_rider_submit_issue(customer,'NO_ANSWER',NULL,'rollback-only/evidence.jpg',19.1,99.9); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%NO_ANSWER_REQUIRES_TWO_CALLS%' THEN RAISE; END IF;observed:=jsonb_build_object('rejection',SQLERRM);END;
      ELSIF scenario='end_work_closed' THEN
        UPDATE public.collections SET status='cancelled' WHERE loan_id=loan;
        response:=public.fdg_rider_end_work();
        observed:=jsonb_build_object('work_status',(SELECT status FROM public.work_sessions WHERE id=ws),'daily_state',(SELECT state FROM public.rider_daily_states WHERE rider_id=rider AND work_date=today),'repeat',public.fdg_rider_end_work()->>'already_closed');
      ELSIF scenario='oldest_first' THEN
        BEGIN PERFORM public.fdg_rider_collect_cash_bundle(ARRAY[ids[2]],'rollback-only/evidence.jpg',19.1,99.9); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%OLDEST_INSTALLMENT_REQUIRED%' THEN RAISE; END IF; observed:=jsonb_build_object('rejection',SQLERRM); END;
      ELSIF scenario='cash_atomic' THEN
        -- A paid second installment forces failure after the first payment insert.
        UPDATE public.loan_installments SET amount_paid=amount_due,status='paid' WHERE loan_id=loan AND installment_no=2;
        BEGIN PERFORM public.fdg_rider_collect_cash_bundle(ids,'rollback-only/evidence.jpg',19.1,99.9); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%INSTALLMENT_ALREADY_PAID%' THEN RAISE; END IF; observed:=jsonb_build_object('rejection',SQLERRM); END;
      ELSIF scenario='scan_atomic' THEN
        response:=public.fdg_rider_create_scan_batch(ids,19.1,99.9); batch:=(response->>'batch_id')::uuid;
        UPDATE public.collections SET status='cancelled' WHERE id=ids[2];
        BEGIN PERFORM public.fdg_finalize_rider_scan_batch(batch,'TEST-5A2-'||gen_random_uuid(),(response->>'total_amount')::numeric,NULL); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%COLLECTION_ALREADY_PROCESSED%' THEN RAISE; END IF; observed:=jsonb_build_object('rejection',SQLERRM,'bank_refs',(SELECT count(*) FROM public.bank_transaction_refs WHERE owner_id=batch)); END;
      ELSIF scenario='issue_review' THEN
        BEGIN PERFORM public.fdg_rider_submit_issue(customer,'NO_ANSWER',NULL,'rollback-only/evidence.jpg',19.1,99.9); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%NO_ANSWER_REQUIRES_TWO_CALLS%' THEN RAISE; END IF; END;
        PERFORM public.fdg_rider_log_call_attempt(customer,19.1,99.9);
        response:=public.fdg_rider_submit_issue(customer,'NOT_HOME','ROLLBACK TEST','rollback-only/evidence.jpg',19.1,99.9); issue:=(response->>'issue_id')::uuid;
        PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
        PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
        response:=public.fdg_admin_review_rider_issue(issue,false,'ROLLBACK TEST');
        observed:=jsonb_build_object('issue_status',response->>'status');
      ELSIF scenario='end_work_pending' THEN
        BEGIN PERFORM public.fdg_rider_end_work(); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%PENDING_COLLECTIONS_REMAIN%' THEN RAISE; END IF; observed:=jsonb_build_object('rejection',SQLERRM); END;
      ELSIF scenario IN ('interest_only','customer_regression') THEN
        IF scenario='interest_only' THEN
          INSERT INTO public.rider_collection_batches(rider_id,customer_id,loan_id,payment_method,status) VALUES(rider,customer,loan,'CASH','verified') RETURNING id INTO batch;
        ELSE batch:=NULL; END IF;
        INSERT INTO public.loan_payments(customer_id,loan_id,installment_id,payment_channel,payment_type,payment_source,gross_due,cash_amount,amount_received,late_fee_amount,discount_amount,status,rider_collection_batch_id)
        VALUES(customer,loan,inst,'SCAN',CASE WHEN scenario='interest_only' THEN 'INTEREST_ONLY' ELSE 'FULL' END,'CUSTOMER_SCAN',20,70,70,50,5,'verified',batch);
      END IF;
      IF scenario='end_work_money' THEN
        BEGIN PERFORM public.fdg_rider_end_work(); RAISE EXCEPTION 'UNEXPECTED_ACCEPTED';
        EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%CASH_REMITTANCE_REQUIRED%' THEN RAISE; END IF; observed:=jsonb_build_object('rejection',SQLERRM); END;
      END IF;
      observed:=observed||jsonb_build_object('fee_per_installment',fee,'payments',(SELECT coalesce(jsonb_agg(jsonb_build_object('received',amount_received,'late_fee',late_fee_amount,'principal',principal_applied,'interest',interest_applied,'before',balance_before,'after',balance_after)),'[]') FROM public.loan_payments WHERE loan_id=loan),'balance',(SELECT remaining_balance FROM public.loans WHERE id=loan),'installments',(SELECT jsonb_agg(jsonb_build_object('n',installment_no,'paid',amount_paid,'status',status) ORDER BY installment_no) FROM public.loan_installments WHERE loan_id=loan),'commission',(SELECT coalesce(sum(commission_amount),0) FROM public.commissions WHERE rider_id=rider),'company_money',(SELECT remaining_company_money FROM public.work_sessions WHERE id=ws));
      result:=result||jsonb_build_array(jsonb_build_object('scenario',scenario,'executed',true,'observed',observed));
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='ROLLBACK_FIXTURE';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
      WHEN OTHERS THEN result:=result||jsonb_build_array(jsonb_build_object('scenario',scenario,'executed',false,'stage',stage,'error',SQLERRM));
    END;
  END LOOP;
  RAISE EXCEPTION 'ROLLBACK_TEST_RESULTS %',result;
END;
$test$;
