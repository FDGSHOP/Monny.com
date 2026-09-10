-- 5A-2: persist expired state instead of rolling it back with an exception.
-- No payment allocation or historical data changes.
CREATE OR REPLACE FUNCTION public.fdg_rider_attach_scan_batch_evidence(p_batch_id uuid, p_evidence_path text, p_gps_lat numeric, p_gps_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor uuid:=public.fdg_current_staff_public_id();v_user public.users%rowtype;v_batch public.rider_collection_batches%rowtype;
begin select * into v_user from public.users where id=v_actor;if not found or v_user.role::text<>'rider' or v_user.status::text<>'active' then raise exception 'Unauthorized';end if;if nullif(btrim(p_evidence_path),'') is null then raise exception 'EVIDENCE_REQUIRED';end if;
  select * into v_batch from public.rider_collection_batches where id=p_batch_id for update;if not found then raise exception 'BATCH_NOT_FOUND';end if;if v_batch.rider_id<>v_actor then raise exception 'BATCH_NOT_OWNED_BY_RIDER';end if;if v_batch.payment_method<>'SCAN' then raise exception 'BATCH_NOT_SCAN';end if;if v_batch.status not in ('pending','failed') then raise exception 'BATCH_NOT_ATTACHABLE';end if;if v_batch.created_at<now()-interval '10 minutes' then update public.rider_collection_batches set status='expired',updated_at=now() where id=p_batch_id;return jsonb_build_object('status','expired','batch_id',p_batch_id,'message','SCAN_BATCH_EXPIRED_REVIEW_TRANSFER_BEFORE_RETRY');end if;
  update public.rider_collection_batches set evidence_path=btrim(p_evidence_path),gps_lat=coalesce(p_gps_lat,gps_lat),gps_lng=coalesce(p_gps_lng,gps_lng),evidence_captured_at=now(),status='pending',failure_reason=null,updated_at=now() where id=p_batch_id;
  return jsonb_build_object('status','attached','batch_id',p_batch_id,'total_amount',v_batch.total_amount);end $function$;
