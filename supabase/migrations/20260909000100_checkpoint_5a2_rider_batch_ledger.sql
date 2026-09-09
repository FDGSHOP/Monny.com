-- Checkpoint 5A-2: keep Rider batch late fees outside the contractual ledger.
-- Customer Payment rows (rider_collection_batch_id IS NULL) retain the exact
-- pre-5A-2 allocation behavior, including discount_amount.

create or replace function public.fdg_allocate_verified_payment_ledger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inst public.loan_installments%rowtype;
  v_interest_used numeric := 0;
  v_principal_used numeric := 0;
  v_credit numeric := 0;
  v_interest_left numeric := 0;
  v_principal_left numeric := 0;
begin
  if new.status <> 'verified' or new.installment_id is null then
    return new;
  end if;

  select * into v_inst
  from public.loan_installments
  where id = new.installment_id;

  if not found then
    return new;
  end if;

  if new.rider_collection_batch_id is not null then
    if round(coalesce(new.amount_received, 0), 2)
       < round(coalesce(new.late_fee_amount, 0), 2) then
      raise exception 'RIDER_BATCH_AMOUNT_BELOW_LATE_FEE';
    end if;

    -- Rider CASH/SCAN batch RPCs store the real received amount as
    -- contractual amount + late fee. Only the contractual portion belongs in
    -- principal_applied + interest_applied.
    v_credit := round(
      coalesce(new.amount_received, 0) - coalesce(new.late_fee_amount, 0),
      2
    );
  else
    -- Preserve Customer Payment behavior exactly.
    v_credit := round(
      coalesce(new.amount_received, 0) + coalesce(new.discount_amount, 0),
      2
    );
  end if;

  select
    coalesce(sum(interest_applied), 0),
    coalesce(sum(principal_applied), 0)
  into v_interest_used, v_principal_used
  from public.loan_payments
  where installment_id = new.installment_id
    and status = 'verified'
    and id <> new.id;

  v_interest_left := greatest(round(v_inst.interest_due - v_interest_used, 2), 0);
  v_principal_left := greatest(round(v_inst.principal_due - v_principal_used, 2), 0);

  if new.payment_type = 'INTEREST_ONLY' then
    new.interest_applied := v_credit;
    new.principal_applied := 0;
  else
    new.interest_applied := least(v_credit, v_interest_left);
    new.principal_applied := least(
      greatest(v_credit - new.interest_applied, 0),
      v_principal_left
    );

    -- Preserve the existing defensive behavior for legacy installment
    -- snapshots while keeping the total limited to v_credit above.
    if round(new.interest_applied + new.principal_applied, 2) < v_credit then
      new.principal_applied := round(
        new.principal_applied
        + (v_credit - new.interest_applied - new.principal_applied),
        2
      );
    end if;
  end if;

  return new;
end;
$function$;

