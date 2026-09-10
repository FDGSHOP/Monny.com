const {harness}=require('./frontend-harness.cjs');
const assert=require('node:assert/strict');
const path=require('node:path');
const results=[];
async function test(name,fn){try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}}
function setup(){
 const h=harness(path.join(__dirname,'../admin.html'));assert.deepEqual(h.errors,[]);
 h.run(`currentUser={id:'rider-a',role:'rider'};currentRiderTab='pending';
 globalThis.messages=[];showToast=(message,ok)=>messages.push({message,ok});
 globalThis.calls=[];globalThis.groups=[];globalThis.failure=null;globalThis.fromFailure=null;globalThis.waiter=null;
 renderRider=()=>renderLiveRiderTaskList();
 adminSb.rpc=async(name)=>{calls.push(name);if(waiter)await waiter;return name==='fdg_rider_task_groups_snapshot'?{data:{groups,scan_batches:[]},error:failure}:{data:{state:'WORKING'},error:null};};
 adminSb.from=()=>{const q={select(){return q},eq(){return q},order(){return q},gte(){return q},in(){return q},then(resolve,reject){return Promise.resolve({data:[],error:fromFailure}).then(resolve,reject)}};return q;};`);
 return h;
}
(async()=>{
 await test('4G and Rider scripts initialize in document order',()=>{const h=setup();for(const fn of ['checkpoint4gLoadFinance','checkpoint4RefreshManagement','rider5ProceedPayment','rider5LoadAdminIssues'])assert.equal(h.run('typeof '+fn),'function');});
 await test('failed first snapshot never claims zero pending work',async()=>{const h=setup();h.run("failure={message:'offline'}");assert.equal(await h.run('rider5RefreshNow()'),false);assert.match(h.node('rider-task-list').innerHTML,/โหลดรายการงานไม่สำเร็จ/);assert.equal(h.run('messages.at(-1).ok'),false);});
 await test('successful empty snapshot clears completed tasks immediately',async()=>{const h=setup();h.run("groups=[{customer_id:'c1',customer_name:'TEST CUSTOMER',total_due:150}]");await h.run('loadLiveRiderData()');assert.match(h.node('rider-task-list').innerHTML,/TEST CUSTOMER/);h.run('groups=[]');assert.equal(await h.run('loadLiveRiderData()'),true);assert.doesNotMatch(h.node('rider-task-list').innerHTML,/TEST CUSTOMER/);});
 await test('overlapping refreshes share one request',async()=>{const h=setup();h.run('waiter=new Promise(r=>globalThis.release=r)');const a=h.run('loadLiveRiderData()'),b=h.run('loadLiveRiderData()');h.run('release();waiter=null');assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(h.run("calls.filter(x=>x==='fdg_rider_task_groups_snapshot').length"),1);});
 await test('financial fetch failure keeps prior remittance values',async()=>{const h=setup();h.run("liveRiderRemittances=[{amount:171.44}];fromFailure={message:'offline'}");assert.equal(await h.run('loadLiveRiderData()'),false);assert.equal(h.run('liveRiderRemittances[0].amount'),171.44);});
 await test('logout clears Rider timer and rejects late response',async()=>{const h=setup();h.run('phase2d2StartRiderRefresh();waiter=new Promise(r=>globalThis.release=r)');const p=h.run('loadLiveRiderData()');await h.run('logout()');h.run('release();waiter=null');assert.equal(await p,false);assert.equal(h.run('rider5TaskGroups.length'),0);assert.equal(h.run('rider5RefreshTimer'),null);assert.equal(h.run('liveRiderDashboard'),null);});
 await test('oldest-first selection fills preceding installments',()=>{const h=setup();h.run(`globalThis.checks=[0,1,2].map((n)=>({checked:n===2,dataset:{collectionId:String(n)}}));document.querySelectorAll=()=>checks;rider5NormalizeSelection(2)`);assert.equal(h.run('checks.every(x=>x.checked)'),true);h.run('checks[1].checked=false;rider5NormalizeSelection(1)');assert.equal(h.run('JSON.stringify(checks.map(x=>x.checked))'),'[true,false,false]');});
 await test('waiting SCAN can reopen the same batch without creating a payment',()=>{const h=setup();h.run("rider5ScanBatches=[{id:'b1',total_amount:300}];rider5ResumeScan('b1')");assert.equal(h.run('rider5ScanBatch.batch_id'),'b1');assert.match(h.node('rider5-scan-qr').src,/300.00/);assert.equal(h.run('calls.length'),0);});
 await test('expired attachment stops verification and refreshes tasks',async()=>{const h=setup();h.run(`rider5CameraContext={batchId:'expired'};rider5UploadEvidence=async()=> 'proof.jpg';adminSb.rpc=async name=>name==='fdg_rider_attach_scan_batch_evidence'?{data:{status:'expired'}}:{data:{groups:[]}};adminSb.auth.getSession=()=>{throw Error('MUST_NOT_VERIFY_EXPIRED')};`);await h.run('rider5VerifyDestinationScan(new Blob(["photo"]),{lat:19.1,lng:99.9})');assert.equal(h.run('rider5ScanBatch'),null);assert.match(h.run('messages[0].message'),/SCAN หมดอายุ/);});
 console.log(JSON.stringify(results,null,2));process.exitCode=results.some(x=>!x.pass)?1:0;
})();
