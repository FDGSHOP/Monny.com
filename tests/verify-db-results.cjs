const assert=require('node:assert/strict');
const data=require('./db-results-20260910.json');
for(const t of data)assert.equal(t.executed,true,t.scenario+': '+t.error);
const get=n=>data.find(x=>x.scenario===n).observed;
for(const [name,n,fee,company,commission] of [['cash_single_fee',1,50,150,7],['cash_multi_fee',2,50,300,14],['cash_no_fee',1,0,100,7],['scan_multi_fee',2,50,0,0]]){
 const x=get(name);assert.equal(x.payments.length,n);assert.equal(x.balance,0);assert.equal(x.company_money,company);assert.equal(x.commission,commission);
 x.payments.forEach(p=>{assert.equal(p.received,100+fee);assert.equal(p.late_fee,fee);assert.equal(p.principal,80);assert.equal(p.interest,20);assert.equal(p.before-p.after,100)});
 x.installments.forEach(i=>{assert.equal(i.paid,100);assert.equal(i.status,'paid')});
}
assert.equal(get('scan_multi_fee').bank_refs,1);assert.equal(get('scan_multi_fee').payment_refs,1);
for(const n of ['oldest_first','cash_atomic','scan_atomic','scan_duplicate','scan_stale_quote','end_work_pending','end_work_scan','scan_without_work','photo_required','gps_required','no_answer_spacing']){
 const x=get(n);assert.equal(x.payments.length,0,n);assert.equal(x.commission,0,n);assert.equal(x.company_money,0,n);assert.ok(x.rejection,n);
}
assert.equal(get('cash_atomic').balance,200);assert.equal(get('scan_atomic').balance,200);assert.equal(get('scan_atomic').bank_refs,0);
assert.equal(get('issue_review').issue_status,'rejected');assert.equal(get('issue_review').balance,100);
assert.equal(get('end_work_money').company_money,150);assert.match(get('end_work_money').rejection,/CASH_REMITTANCE_REQUIRED/);
assert.equal(get('interest_only').payments[0].principal,0);assert.equal(get('interest_only').payments[0].interest,20);assert.equal(get('interest_only').balance,100);
assert.equal(get('customer_regression').payments[0].principal+get('customer_regression').payments[0].interest,75);
assert.equal(get('end_work_closed').work_status,'completed');assert.equal(get('end_work_closed').daily_state,'CLOSED');assert.equal(get('end_work_closed').repeat,'true');
console.log('PASS: observed results from all 20 live rollback scenarios');
