const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const path=require('node:path');
const file=process.argv[2]||path.join(__dirname,'../supabase/functions/dynamic-api/index.ts');
const code=stripTypeScriptTypes(fs.readFileSync(file,'utf8').replace(/^import .*;\s*/,''));
async function scenario({kind='RIDER_CUSTOMER_SCAN',owner='rider',status='pending',provider={},finalError=null,token=true}={}){
 let handler;const rpcCalls=[],writes=[];
 const batch={id:'batch',batch_code:'B',rider_id:owner,customer_id:'customer',loan_id:'loan',payment_method:'SCAN',status,total_amount:300,evidence_path:'test.jpg'};
 const admin={auth:{getUser:async()=>({data:{user:{id:'rider'}}})},rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:{status:'verified'},error:name.startsWith('fdg_finalize')?finalError:null};},storage:{from:()=>({download:async()=>({data:new Blob(['image'],{type:'image/jpeg'})})})},from(table){let op='select';const q={select(){return q},eq(){return q},ilike(){return q},limit(){return q},order(){return q},in(){return q},update(x){op='update';writes.push({table,x});return q},insert(x){op='insert';writes.push({table,x});return q},maybeSingle(){return Promise.resolve(value())},single(){return Promise.resolve({data:{id:'slip'}})},then(a,b){return Promise.resolve(value()).then(a,b)}};function value(){if(op!=='select')return {data:[],error:null};return {data:table==='users'?{id:'rider',role:'rider',status:'active'}:table==='rider_collection_batches'?batch:table==='loan_payments'?{id:'payment',status:'pending',payment_source:'CUSTOMER_SCAN',cash_amount:300,evidence_path:'test.jpg',payment_code:'P',customer_id:'customer',loan_id:'loan'}:table==='customers'?{auth_user_id:'rider'}:[],error:null};}return q;}};
 const ctx=vm.createContext({console,Request,Response,Blob,File,FormData,createClient:()=>admin,Deno:{env:{get:n=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',EASYSLIP_API_KEY:'test-only'}[n])},serve:fn=>handler=fn},fetch:async()=>new Response(JSON.stringify({success:true,data:{amountInSlip:300,isDuplicate:false,isAmountMatched:true,matchedAccount:{},rawSlip:{transRef:'T-ROLLBACK'},...provider}}),{status:200})});
 new vm.Script(code).runInContext(ctx);
 const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer test-only'}:{})},body:JSON.stringify({type:kind,id:'batch'})}));
 return {status:response.status,body:await response.json(),rpcCalls,writes};
}
(async()=>{const results=[];async function test(name,fn){try{await fn();results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.message})}}
await test('Rider SCAN success allocates through batch finalizer',async()=>{const r=await scenario();assert.equal(r.body.status,'verified');assert.equal(r.rpcCalls.at(-1).name,'fdg_finalize_rider_scan_batch');assert.equal(r.rpcCalls.at(-1).args.p_actual_amount,300)});
await test('foreign already-verified batch still requires ownership',async()=>{assert.equal((await scenario({owner:'someone-else',status:'verified'})).status,403)});
await test('missing authentication is rejected',async()=>{assert.equal((await scenario({token:false})).status,401)});
for(const [name,provider,expected] of [['duplicate',{isDuplicate:true},'duplicate'],['wrong amount',{isAmountMatched:false},'amount_mismatch'],['wrong account',{matchedAccount:null},'account_mismatch'],['missing reference',{rawSlip:{}},'failed']])await test('provider '+name+' does not finalize',async()=>{const r=await scenario({provider});assert.equal(r.body.status,expected);assert.ok(r.rpcCalls.every(x=>!x.name.startsWith('fdg_finalize')))});
await test('duplicate database reference returns duplicate',async()=>{assert.equal((await scenario({finalError:{message:'DUPLICATE_BANK_TRANSACTION'}})).body.status,'duplicate')});
await test('Customer Payment retains its existing finalizer',async()=>{const r=await scenario({kind:'CUSTOMER_PAYMENT'});assert.equal(r.body.status,'verified');assert.equal(r.rpcCalls.at(-1).name,'fdg_finalize_customer_scan_payment')});
console.log(JSON.stringify(results,null,2));process.exitCode=results.some(x=>!x.pass)?1:0;})();
