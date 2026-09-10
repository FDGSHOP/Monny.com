/* CHECKPOINT 5A — Rider Field Collection */
let rider5TaskGroups=[];
let rider5Issues=[];
let rider5ScanBatches=[];
let rider5CurrentGroup=null;
let rider5Detail=null;
let rider5Method='CASH';
let rider5RefreshTimer=null;
let rider5CameraStream=null;
let rider5CameraMode=null;
let rider5CameraContext=null;
let rider5CapturedBlob=null;
let rider5CapturedUrl=null;
let rider5CapturedGps=null;
let rider5IssueProof=null;
let rider5ScanBatch=null;
let rider5AdminIssues=[];

function rider5EnsureUi(){
  if(!document.getElementById('fdg-confirm-modal'))document.body.insertAdjacentHTML('beforeend',`
    <div id="fdg-confirm-modal" class="hidden fixed inset-0 z-[5700] bg-black/60 items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
        <div><div id="fdg-confirm-kicker" class="text-[10px] font-extrabold text-indigo-600"></div><h3 id="fdg-confirm-title" class="text-lg font-extrabold text-slate-900"></h3></div>
        <div id="fdg-confirm-body" class="text-sm text-slate-600"></div>
        <div class="grid grid-cols-2 gap-2"><button id="fdg-confirm-cancel" class="border rounded-xl py-2.5 font-bold">ยกเลิก</button><button id="fdg-confirm-ok" class="bg-indigo-600 text-white rounded-xl py-2.5 font-bold">ยืนยัน</button></div>
      </div>
    </div>`);

  if(!document.getElementById('rider5-task-modal'))document.body.insertAdjacentHTML('beforeend',`
    <div id="rider5-task-modal" class="hidden fixed inset-0 z-[5200] bg-black/55 items-center justify-center p-3">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-hidden flex flex-col">
        <div class="p-4 border-b flex justify-between gap-3"><div><div class="text-[10px] font-extrabold text-emerald-600">GROUPED COLLECTION • OLDEST FIRST</div><h3 id="rider5-task-name" class="font-extrabold text-lg"></h3><div id="rider5-task-address" class="text-xs text-gray-500"></div></div><button onclick="rider5CloseTaskModal()" class="text-2xl text-gray-400">×</button></div>
        <div class="p-4 overflow-y-auto space-y-3">
          <div class="grid grid-cols-3 gap-2"><button id="rider5-profile-btn" class="border rounded-xl p-2 text-xs font-bold">ข้อมูลลูกค้า</button><button id="rider5-map-btn" class="border border-blue-200 bg-blue-50 text-blue-700 rounded-xl p-2 text-xs font-bold">📍 แผนที่</button><button id="rider5-call-btn" class="bg-emerald-600 text-white rounded-xl p-2 text-xs font-bold">📞 โทรหา</button></div>
          <div class="flex justify-between bg-slate-50 border rounded-xl p-3"><span class="text-xs text-gray-500">งวดที่ชำระได้</span><b id="rider5-task-count"></b></div>
          <div id="rider5-installment-list" class="space-y-2"></div>
          <div class="grid grid-cols-2 gap-2"><button id="rider5-method-cash" onclick="rider5SetMethod('CASH')" class="border rounded-xl p-3 font-bold text-sm text-emerald-700">เงินสด CASH</button><button id="rider5-method-scan" onclick="rider5SetMethod('SCAN')" class="border rounded-xl p-3 font-bold text-sm text-blue-700">SCAN เข้าบริษัท</button></div>
          <div class="flex justify-between items-center bg-rose-50 border border-rose-100 rounded-xl p-3"><b>ยอดรับจริงรวม</b><b id="rider5-selected-total" class="text-xl text-rose-600"></b></div>
          <button onclick="rider5ProceedPayment()" class="w-full bg-slate-900 text-white rounded-xl p-3 font-extrabold">ดำเนินการรับชำระ</button>
        </div>
      </div>
    </div>
    <div id="rider5-profile-modal" class="hidden fixed inset-0 z-[5300] bg-black/55 items-center justify-center p-3"><div class="bg-white rounded-2xl w-full max-w-lg max-h-[94vh] overflow-hidden flex flex-col"><div class="p-4 border-b flex justify-between"><h3 id="rider5-profile-name" class="font-extrabold"></h3><button onclick="rider5CloseProfile()" class="text-2xl text-gray-400">×</button></div><div id="rider5-profile-content" class="p-4 overflow-y-auto space-y-3 text-sm"></div></div></div>
    <div id="rider5-camera-modal" class="hidden fixed inset-0 z-[5600] bg-black/80 items-center justify-center p-3"><div class="bg-white rounded-2xl w-full max-w-lg overflow-hidden"><div class="p-4 border-b flex justify-between"><h3 id="rider5-camera-title" class="font-extrabold"></h3><button onclick="rider5CloseCamera()" class="text-2xl text-gray-400">×</button></div><div class="p-4 space-y-3"><video id="rider5-camera-video" playsinline class="w-full max-h-[55vh] bg-black rounded-xl object-contain"></video><img id="rider5-camera-preview" class="hidden w-full max-h-[55vh] bg-black rounded-xl object-contain" alt="หลักฐาน"><div id="rider5-camera-quality" class="text-xs text-gray-500"></div><div id="rider5-camera-gps" class="text-xs text-blue-700"></div><div class="grid grid-cols-2 gap-2"><button id="rider5-camera-shot" onclick="rider5TakePhoto()" class="col-span-2 bg-slate-900 text-white rounded-xl p-3 font-bold">ถ่ายภาพ</button><button id="rider5-camera-retake" onclick="rider5RetakeCamera()" class="hidden border rounded-xl p-3 font-bold">ถ่ายใหม่</button><button id="rider5-camera-use" onclick="rider5UsePhoto()" class="hidden bg-emerald-600 text-white rounded-xl p-3 font-bold">ใช้ภาพนี้</button></div></div></div></div>
    <div id="rider5-scan-modal" class="hidden fixed inset-0 z-[5400] bg-black/55 items-center justify-center p-3"><div class="bg-white rounded-2xl w-full max-w-sm p-5 space-y-4 text-center"><div class="flex justify-between"><h3 class="font-extrabold text-blue-800">SCAN เข้าบัญชีบริษัท</h3><button onclick="rider5CloseScanModal()" class="text-2xl text-gray-400">×</button></div><div id="rider5-scan-amount" class="text-3xl font-extrabold text-blue-700"></div><img id="rider5-scan-qr" class="w-64 max-w-full mx-auto border rounded-xl" alt="PromptPay QR"><div class="text-xs text-gray-500">เมื่อลูกค้าชำระแล้ว ให้ถ่ายสลิปจากหน้าจอลูกค้าเพื่อตรวจ EasySlip</div><button onclick="rider5CaptureScanSlip()" class="w-full bg-blue-600 text-white rounded-xl p-3 font-extrabold">ถ่ายสลิปและตรวจ EasySlip</button></div></div>
    <div id="rider5-issue-modal" class="hidden fixed inset-0 z-[5450] bg-black/55 items-center justify-center p-3"><div class="bg-white rounded-2xl w-full max-w-md p-5 space-y-4"><div class="flex justify-between"><h3 class="font-extrabold text-amber-800">ส่งงานติดปัญหา</h3><button onclick="rider5CloseIssueModal()" class="text-2xl text-gray-400">×</button></div><div id="rider5-call-rule" class="text-xs bg-amber-50 border border-amber-200 rounded-xl p-3"></div><select id="rider5-issue-reason" class="w-full border rounded-xl p-3 text-sm"><option value="NO_ANSWER">โทรไม่รับสาย</option><option value="NOT_HOME">ลูกค้าไม่อยู่บ้าน</option><option value="REQUEST_DELAY">ลูกค้าขอเลื่อนชำระ</option><option value="WRONG_ADDRESS">ที่อยู่/พิกัดไม่ถูกต้อง</option><option value="OTHER">อื่น ๆ</option></select><textarea id="rider5-issue-note" class="w-full border rounded-xl p-3 text-sm" rows="3" placeholder="รายละเอียดเพิ่มเติม"></textarea><div id="rider5-issue-proof-state" class="text-xs text-gray-500"></div><button onclick="rider5CaptureIssueProof()" class="w-full border border-amber-300 text-amber-800 rounded-xl p-3 font-bold">ถ่ายรูปหน้าบ้าน + GPS</button><button onclick="rider5SubmitIssue()" class="w-full bg-amber-600 text-white rounded-xl p-3 font-extrabold">ส่งให้ Admin ตรวจ</button></div></div>`);

  if(!document.getElementById('rider5-admin-issue-card')){
    const monitor=document.getElementById('admin-rider-monitor');
    const card=monitor?.closest('.bg-white');
    if(card)card.insertAdjacentHTML('afterend',`<div id="rider5-admin-issue-card" class="bg-white rounded-xl shadow border border-amber-100 overflow-hidden"><div class="p-4 border-b flex justify-between items-center"><div><div class="font-bold text-amber-800">งานติดปัญหารอ Admin Review</div><div class="text-xs text-gray-500">ตรวจรูป GPS และประวัติกดโทรก่อนยืนยัน</div></div><button onclick="rider5LoadAdminIssues(true)" class="text-xs font-bold text-amber-700">↻ รีเฟรช</button></div><div id="rider5-admin-issue-list" class="p-4 space-y-2"><div class="text-sm text-gray-400">กำลังโหลด...</div></div></div>`);
  }
}

rider5EnsureUi();

window.fdgConfirm=function({title='ยืนยันรายการ',body='',confirmText='ยืนยัน',kicker='ยืนยันรายการ',danger=false}={}){
  return new Promise(resolve=>{
    const modal=document.getElementById('fdg-confirm-modal');
    document.getElementById('fdg-confirm-title').textContent=title;
    document.getElementById('fdg-confirm-kicker').textContent=kicker;
    document.getElementById('fdg-confirm-body').innerHTML=body;
    const ok=document.getElementById('fdg-confirm-ok');
    const cancel=document.getElementById('fdg-confirm-cancel');
    ok.textContent=confirmText;
    ok.className=`${danger?'bg-red-600':'bg-indigo-600'} text-white rounded-xl py-2.5 font-bold`;
    modal.classList.remove('hidden');modal.classList.add('flex');
    const finish=v=>{modal.classList.add('hidden');modal.classList.remove('flex');ok.onclick=null;cancel.onclick=null;resolve(v);};
    ok.onclick=()=>finish(true);cancel.onclick=()=>finish(false);
  });
};

function rider5FmtDue(d){if(!d)return '-';return new Date(`${d}T00:00:00`).toLocaleDateString('th-TH',{day:'numeric',month:'short'});}
function rider5Address(g){return [g?.home_address,g?.home_subdistrict?`ต.${g.home_subdistrict}`:'',g?.home_district?`อ.${g.home_district}`:''].filter(Boolean).join(' ');}

let rider5Loaded=false;
let rider5LoadError='';
let rider5LoadPromise=null;
let rider5Generation=0;
const rider5BaseLoadLiveRiderData=loadLiveRiderData;
loadLiveRiderData=function(opts={}){
  if(!currentUser||currentUser.role!=='rider')return Promise.resolve(false);
  if(rider5LoadPromise)return rider5LoadPromise;
  const actor=currentUser.id,generation=rider5Generation;
  const pending=(async()=>{
    try{
      const baseOk=await rider5BaseLoadLiveRiderData(opts);
      if(baseOk===false)throw new Error('โหลดข้อมูลยอดเงินไม่สำเร็จ');
      if(currentUser?.id!==actor||generation!==rider5Generation)return false;
      const {data,error}=await adminSb.rpc('fdg_rider_task_groups_snapshot');
      if(error)throw error;
      if(currentUser?.id!==actor||generation!==rider5Generation)return false;
      if(!data||!Array.isArray(data.groups))throw new Error('ข้อมูลรายการงานไม่ครบ');
      rider5TaskGroups=data.groups;rider5Issues=data.issues_today||[];rider5ScanBatches=data.scan_batches||[];
      rider5Loaded=true;rider5LoadError='';
      const target=rider5TaskGroups.filter(g=>!g.issue_today).reduce((sum,g)=>sum+Number(g.total_due||0),0);
      const t=document.getElementById('rider-target-today');if(t)t.textContent=liveMoney(target);
      const r=document.getElementById('rider-live-refresh-state');if(r)r.textContent=`อัปเดตล่าสุด ${new Date().toLocaleTimeString('th-TH')} • อัตโนมัติทุก 10 วินาที`;
      renderLiveRiderTaskList();return true;
    }catch(err){
      if(currentUser?.id!==actor||generation!==rider5Generation)return false;
      rider5LoadError=err?.message||'โหลดงาน Rider ไม่สำเร็จ';
      renderLiveRiderTaskList();
      if(!opts.silent)showToast(rider5LoadError,false);
      return false;
    }
  })();
  rider5LoadPromise=pending;
  pending.finally(()=>{if(rider5LoadPromise===pending)rider5LoadPromise=null;});
  return pending;
};
phase2d2StartRiderRefresh=function(){
  if(liveRiderRefreshTimer)clearInterval(liveRiderRefreshTimer);
  if(rider5RefreshTimer)clearInterval(rider5RefreshTimer);
  rider5RefreshTimer=setInterval(()=>{if(currentUser?.role==='rider')loadLiveRiderData({silent:true});},10000);
};
window.rider5RefreshNow=async function(){const ok=await loadLiveRiderData({silent:true});showToast(ok?'อัปเดตงานล่าสุดแล้ว':'โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชอีกครั้ง',ok);return ok;};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentUser?.role==='rider')loadLiveRiderData({silent:true});});
const rider5BaseLogout=logout;
logout=async function(){
  rider5Generation++;
  if(rider5RefreshTimer)clearInterval(rider5RefreshTimer);
  rider5RefreshTimer=null;rider5LoadPromise=null;rider5Loaded=false;rider5LoadError='';
  rider5TaskGroups=[];rider5Issues=[];rider5ScanBatches=[];rider5CurrentGroup=null;rider5Detail=null;rider5ScanBatch=null;
  rider5CloseCamera();
  await rider5BaseLogout();
};

function rider5GroupCompleted(rows){const m=new Map();for(const c of rows){const k=String(c.customer_id||'');if(!m.has(k))m.set(k,[]);m.get(k).push(c);}return [...m.entries()].map(([customer_id,items])=>({customer_id,items}));}

renderLiveRiderTaskList=function(){
  const box=document.getElementById('rider-task-list');if(!box)return;
  if(rider5LoadError||!rider5Loaded){box.innerHTML='<div class="text-center text-sm bg-white border rounded-xl p-6">'+(rider5LoadError?'โหลดรายการงานไม่สำเร็จ กรุณารีเฟรชก่อนรับชำระ':'กำลังโหลดรายการงาน...')+'</div>';return;}
  if(currentRiderTab==='pending'){
    const rows=rider5TaskGroups.filter(g=>!g.issue_today);
    if(!rows.length){box.innerHTML='<div class="text-center text-sm text-emerald-600 bg-white border rounded-xl p-6 font-bold">✓ ไม่มีงานที่ต้องเก็บค้างในวันนี้</div>';return;}
    box.innerHTML=rows.map((g,idx)=>`<div class="bg-white rounded-2xl shadow border overflow-hidden"><div class="p-4 space-y-3">
      <div class="flex justify-between gap-3"><div class="flex items-center gap-2 min-w-0"><span class="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-xs">${idx+1}</span><div><div class="font-extrabold text-slate-800">${liveEsc(g.customer_name||'ลูกค้า')}</div><div class="text-[10px] text-gray-400">${liveEsc(g.customer_code||'')}</div></div></div><div class="text-right shrink-0"><div class="text-[10px] text-gray-500">ยอดเก็บรวม</div><div class="text-xl font-extrabold text-rose-600">${liveMoney(g.total_due||0)}</div></div></div>
      <div class="text-xs text-gray-600 bg-slate-50 rounded-xl p-3 space-y-1"><div><b>ที่อยู่:</b> ${liveEsc(rider5Address(g)||'-')}</div><div><b>ค้าง:</b> ${Number(g.installment_count||0)} งวด • <b>เก่าสุด:</b> ${liveEsc(rider5FmtDue(g.oldest_due_date))}${Number(g.max_late_days||0)>0?` • <span class="text-red-600 font-bold">ค่าปรับสูงสุด ${g.max_late_days} วัน</span>`:''}</div><div><b>ยอดตามสัญญา:</b> ${liveMoney(g.contract_due||0)} • <b class="text-red-600">ค่าปรับ:</b> ${liveMoney(g.late_fee_total||0)}</div></div>
      <div class="flex gap-2"><button onclick="rider5OpenMap('${g.customer_id}')" class="flex-1 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl p-2.5 text-xs font-bold">📍 แผนที่</button><button onclick="rider5OpenIssueForCustomer('${g.customer_id}')" class="flex-1 border border-amber-200 bg-amber-50 text-amber-800 rounded-xl p-2.5 text-xs font-bold">⚠ ติดปัญหา</button><button onclick="rider5CallCustomer('${g.customer_id}')" class="flex-[1.35] bg-emerald-600 text-white rounded-xl p-2.5 text-sm font-extrabold">📞 โทรหา</button></div>
      <button onclick="rider5OpenTask('${g.customer_id}')" class="w-full bg-slate-900 text-white rounded-xl p-3 font-extrabold text-sm">ดูรายละเอียด / เลือกงวดชำระ (${Number(g.installment_count||0)})</button>
    </div></div>`).join('');return;
  }
  if(currentRiderTab==='issue'){
    if(!rider5Issues.length){box.innerHTML='<div class="text-center text-sm text-gray-400 bg-white border rounded-xl p-6">ยังไม่มีงานติดปัญหาของวันนี้</div>';return;}
    box.innerHTML=rider5Issues.map(i=>`<div class="bg-white border border-amber-200 rounded-xl p-4"><div class="flex justify-between gap-2"><div><div class="font-bold">${liveEsc(i.customer_name||'-')}</div><div class="text-xs text-gray-500">${liveEsc(i.reason_label||i.reason_code||'-')}</div><div class="text-[11px] text-gray-400 mt-1">${liveEsc(i.note||'')}</div></div><span class="text-[10px] bg-amber-100 text-amber-800 rounded-full px-2 py-1 h-fit font-bold">${liveEsc(i.status||'PENDING_ADMIN')}</span></div></div>`).join('');return;
  }
  if(currentRiderTab==='waiting'){
    const rows=rider5ScanBatches.filter(b=>['pending','verifying','failed'].includes(String(b.status)));
    if(!rows.length){box.innerHTML='<div class="text-center text-sm text-gray-400 bg-white border rounded-xl p-6">ไม่มีรายการ SCAN ที่กำลังตรวจ</div>';return;}
    box.innerHTML=rows.map(b=>`<div class="bg-white border border-blue-200 rounded-xl p-4"><div class="flex justify-between"><div><div class="font-bold">${liveEsc(b.customer_name||'-')}</div><div class="text-xs text-blue-600">${liveEsc(b.batch_code||'')}</div></div><div class="font-extrabold text-blue-700">${liveMoney(b.total_amount||0)}</div></div><div class="text-xs text-gray-500 mt-2">สถานะ: ${liveEsc(String(b.status||'').toUpperCase())}</div><button onclick="rider5ResumeScan('${b.id}')" class="mt-3 w-full border rounded-xl p-2 font-bold">เปิดรายการ / ตรวจสลิปอีกครั้ง</button></div>`).join('');return;
  }
  const groups=rider5GroupCompleted(liveRiderCollections.filter(x=>['collected','verified','returned'].includes(String(x.status))));
  if(!groups.length){box.innerHTML='<div class="text-center text-sm text-gray-400 bg-white border rounded-xl p-6">ยังไม่มีรายการที่เก็บสำเร็จ</div>';return;}
  box.innerHTML=groups.map(g=>{const c=phase2d2CurrentCustomer(g.customer_id);return `<div class="bg-white border rounded-xl p-4"><div class="flex justify-between"><div><div class="font-bold">${liveEsc(c?.full_name||'-')}</div><div class="text-xs text-gray-400">${g.items.length} รายการ</div></div><div class="font-extrabold text-emerald-700">${liveMoney(g.items.reduce((s,x)=>s+Number(x.amount||0),0))}</div></div><button onclick="rider5OpenProfile('${g.customer_id}')" class="mt-2 w-full border rounded-lg p-2 text-xs font-bold">ดูประวัติลูกค้า</button></div>`;}).join('');
};

window.rider5OpenTask=async function(customerId){
  if(!rider5Loaded||rider5LoadError){showToast('กรุณารีเฟรชรายการงานก่อน',false);return;}
  const group=rider5TaskGroups.find(g=>String(g.customer_id)===String(customerId));if(!group)return;rider5CurrentGroup=group;rider5Method='CASH';
  try{
    const {data,error}=await adminSb.rpc('fdg_rider_customer_detail',{p_customer_id:customerId});if(error)throw error;rider5Detail=data;
    document.getElementById('rider5-task-name').textContent=`${data.customer?.full_name||'-'} • ${data.customer?.customer_code||''}`;
    document.getElementById('rider5-task-address').textContent=rider5Address(data.customer||{});
    document.getElementById('rider5-task-count').textContent=`${(data.payable_installments||[]).length} งวด`;
    document.getElementById('rider5-profile-btn').onclick=()=>rider5OpenProfile(customerId);
    document.getElementById('rider5-map-btn').onclick=()=>rider5OpenMap(customerId);
    document.getElementById('rider5-call-btn').onclick=()=>rider5CallCustomer(customerId);
    document.getElementById('rider5-installment-list').innerHTML=(data.payable_installments||[]).map((it,idx)=>`<label class="block border rounded-xl p-3 ${idx===0?'border-emerald-300 bg-emerald-50/40':''}"><div class="flex gap-3 items-start"><input type="checkbox" class="rider5-inst-check mt-1 w-5 h-5" data-index="${idx}" data-collection-id="${it.collection_id}" ${idx===0?'checked':''} onchange="rider5NormalizeSelection(${idx})"><div class="flex-1"><div class="flex justify-between gap-2"><div class="font-bold">งวด ${it.installment_no} • ${rider5FmtDue(it.due_date)}</div><div class="font-extrabold text-rose-600">${liveMoney(it.total_due)}</div></div><div class="text-[11px] text-gray-500 mt-1">ตามสัญญา ${liveMoney(it.contract_due)}${Number(it.late_fee_amount)>0?` • <span class="text-red-600 font-bold">ค่าปรับ ${liveMoney(it.late_fee_amount)} (${it.late_days} วัน)</span>`:' • ยังไม่มีค่าปรับ'}</div></div></div></label>`).join('');
    rider5SetMethod('CASH');rider5UpdateSelectedTotal();
    const m=document.getElementById('rider5-task-modal');m.classList.remove('hidden');m.classList.add('flex');
  }catch(err){showToast(err?.message||'โหลดรายละเอียดลูกค้าไม่สำเร็จ',false);}
};
window.rider5CloseTaskModal=function(){const m=document.getElementById('rider5-task-modal');m?.classList.add('hidden');m?.classList.remove('flex');};
window.rider5NormalizeSelection=function(idx){const c=[...document.querySelectorAll('.rider5-inst-check')],x=c[idx];if(!x)return;if(x.checked){for(let i=0;i<=idx;i++)c[i].checked=true;}else{for(let i=idx;i<c.length;i++)c[i].checked=false;}if(!c.some(v=>v.checked)&&c[0])c[0].checked=true;rider5UpdateSelectedTotal();};
function rider5SelectedCollections(){return [...document.querySelectorAll('.rider5-inst-check')].filter(x=>x.checked).map(x=>x.dataset.collectionId).filter(Boolean);}
function rider5UpdateSelectedTotal(){const ids=new Set(rider5SelectedCollections());const total=(rider5Detail?.payable_installments||[]).filter(x=>ids.has(String(x.collection_id))).reduce((s,x)=>s+Number(x.total_due||0),0);const e=document.getElementById('rider5-selected-total');if(e)e.textContent=liveMoney(total);}
window.rider5SetMethod=function(m){rider5Method=m;const c=document.getElementById('rider5-method-cash'),s=document.getElementById('rider5-method-scan');if(m==='CASH'){c.className='border-2 border-emerald-500 bg-emerald-50 text-emerald-800 rounded-xl p-3 font-bold text-sm';s.className='border rounded-xl p-3 font-bold text-sm text-blue-700';}else{s.className='border-2 border-blue-500 bg-blue-50 text-blue-800 rounded-xl p-3 font-bold text-sm';c.className='border rounded-xl p-3 font-bold text-sm text-emerald-700';}};

window.rider5OpenProfile=async function(customerId){
  try{const {data,error}=await adminSb.rpc('fdg_rider_customer_detail',{p_customer_id:customerId});if(error)throw error;const c=data.customer||{};document.getElementById('rider5-profile-name').textContent=`${c.full_name||'-'} • ${c.customer_code||''}`;document.getElementById('rider5-profile-content').innerHTML=`<div class="border rounded-xl p-3 space-y-1"><div><span class="text-gray-500">โทร:</span> <b>${liveEsc(c.phone||'-')}</b></div><div><span class="text-gray-500">ที่อยู่:</span> <b>${liveEsc(rider5Address(c)||'-')}</b></div><div><span class="text-gray-500">GPS:</span> <b>${c.gps_lat&&c.gps_lng?`${Number(c.gps_lat).toFixed(6)}, ${Number(c.gps_lng).toFixed(6)}`:'ยังไม่ได้ปักพิกัด'}</b></div><div class="grid grid-cols-2 gap-2 mt-3"><button onclick="rider5OpenMap('${customerId}')" class="bg-blue-600 text-white rounded-lg p-2.5 font-bold">📍 นำทาง</button><button onclick="rider5CallCustomer('${customerId}')" class="bg-emerald-600 text-white rounded-lg p-2.5 font-bold">📞 โทรหา</button></div></div><div class="border rounded-xl overflow-hidden"><div class="p-3 bg-slate-50 font-bold">ประวัติงวดทั้งหมด</div><div class="divide-y">${(data.all_installments||[]).map(i=>`<div class="p-3 flex justify-between gap-2"><div><b>งวด ${i.installment_no} • ${rider5FmtDue(i.due_date)}</b><div class="text-[11px] text-gray-500">${liveEsc(String(i.status||'').toUpperCase())} • จ่ายแล้ว ${liveMoney(i.amount_paid||0)}</div></div><div class="text-right"><div class="font-bold">${liveMoney(i.amount_due||0)}</div>${Number(i.current_late_fee||0)>0?`<div class="text-[11px] text-red-600">ค่าปรับ ${liveMoney(i.current_late_fee)}</div>`:''}</div></div>`).join('')}</div></div><div class="border rounded-xl overflow-hidden"><div class="p-3 bg-slate-50 font-bold">ประวัติรับชำระ</div><div class="divide-y">${(data.payment_history||[]).map(p=>`<div class="p-3 flex justify-between"><div><b>${liveEsc(p.payment_code||'-')}</b><div class="text-[11px] text-gray-500">${p.verified_at?new Date(p.verified_at).toLocaleString('th-TH'):'-'} • ${liveEsc(p.payment_channel||'-')}</div></div><div class="font-bold text-emerald-700">${liveMoney(p.amount_received||0)}</div></div>`).join('')||'<div class="p-3 text-gray-400">ยังไม่มีประวัติชำระ</div>'}</div></div>`;const m=document.getElementById('rider5-profile-modal');m.classList.remove('hidden');m.classList.add('flex');}catch(err){showToast(err?.message||'โหลดโปรไฟล์ไม่สำเร็จ',false);}
};
window.rider5CloseProfile=function(){const m=document.getElementById('rider5-profile-modal');m?.classList.add('hidden');m?.classList.remove('flex');};
window.rider5OpenMap=function(customerId){const g=rider5TaskGroups.find(x=>String(x.customer_id)===String(customerId));const d=(rider5Detail?.customer&&String(rider5Detail.customer.id)===String(customerId))?rider5Detail.customer:null;const lat=Number(d?.gps_lat??g?.gps_lat),lng=Number(d?.gps_lng??g?.gps_lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||!lat||!lng){showToast('ลูกค้ารายนี้ยังไม่มีพิกัด GPS',false);return;}window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat+','+lng)}`,'_blank','noopener');};

async function rider5GetLocation({quiet=false}={}){if(!navigator.geolocation){if(!quiet)showToast('อุปกรณ์ไม่รองรับ GPS',false);return null;}return await new Promise(resolve=>navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),()=>{if(!quiet)showToast('ต้องอนุญาต GPS ก่อน',false);resolve(null);},{enableHighAccuracy:true,timeout:12000,maximumAge:0}));}
window.rider5CallCustomer=async function(customerId){const g=rider5TaskGroups.find(x=>String(x.customer_id)===String(customerId));const phone=g?.phone||rider5Detail?.customer?.phone;if(!phone){showToast('ไม่มีเบอร์โทรลูกค้า',false);return;}try{const gps=await rider5GetLocation({quiet:true});const {data,error}=await adminSb.rpc('fdg_rider_log_call_attempt',{p_customer_id:customerId,p_gps_lat:gps?.lat??null,p_gps_lng:gps?.lng??null});if(error)throw error;showToast(`บันทึกการกดโทรครั้งที่ ${data?.attempt_no||'-'} แล้ว`,true);setTimeout(()=>{window.location.href=`tel:${phone}`;},150);}catch(err){showToast(err?.message||'บันทึกการโทรไม่สำเร็จ',false);}};

async function rider5OpenCamera(mode,context={}){rider5CameraMode=mode;rider5CameraContext=context;rider5CapturedBlob=null;rider5CapturedGps=null;if(rider5CapturedUrl){URL.revokeObjectURL(rider5CapturedUrl);rider5CapturedUrl=null;}const title={CASH:'ถ่ายหลักฐานรับเงินสด',ISSUE:'ถ่ายรูปหน้าบ้านลูกค้า',SCAN_SLIP:'ถ่ายสลิปบนมือถือของลูกค้า'}[mode]||'ถ่ายหลักฐาน';document.getElementById('rider5-camera-title').textContent=title;document.getElementById('rider5-camera-preview').classList.add('hidden');document.getElementById('rider5-camera-video').classList.remove('hidden');document.getElementById('rider5-camera-shot').classList.remove('hidden');document.getElementById('rider5-camera-retake').classList.add('hidden');document.getElementById('rider5-camera-use').classList.add('hidden');const m=document.getElementById('rider5-camera-modal');m.classList.remove('hidden');m.classList.add('flex');rider5CapturedGps=await rider5GetLocation();const ge=document.getElementById('rider5-camera-gps');ge.textContent=rider5CapturedGps?`GPS ±${Math.round(rider5CapturedGps.accuracy||0)} ม. • ${rider5CapturedGps.lat.toFixed(6)}, ${rider5CapturedGps.lng.toFixed(6)}`:'ยังไม่ได้ GPS';try{rider5CameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:3840,min:1280},height:{ideal:2160,min:720}}});const v=document.getElementById('rider5-camera-video');v.srcObject=rider5CameraStream;await v.play();const st=rider5CameraStream.getVideoTracks()[0].getSettings?.()||{};document.getElementById('rider5-camera-quality').textContent=`กล้อง ${st.width||v.videoWidth||'-'}×${st.height||v.videoHeight||'-'} • กล้องหลัง`;}catch(err){showToast('เปิดกล้องไม่ได้ กรุณาอนุญาต Camera และใช้ HTTPS',false);rider5CloseCamera();}}
window.rider5CloseCamera=function(){if(rider5CameraStream){rider5CameraStream.getTracks().forEach(t=>t.stop());rider5CameraStream=null;}const m=document.getElementById('rider5-camera-modal');m?.classList.add('hidden');m?.classList.remove('flex');};
async function rider5BlobDimensions(blob){try{const b=await createImageBitmap(blob);const x={width:b.width,height:b.height};b.close();return x;}catch(_){return {width:0,height:0};}}
window.rider5TakePhoto=async function(){if(!rider5CameraStream)return;const v=document.getElementById('rider5-camera-video'),track=rider5CameraStream.getVideoTracks()[0];try{if('ImageCapture' in window){rider5CapturedBlob=await new ImageCapture(track).takePhoto();}else{const c=document.createElement('canvas');c.width=v.videoWidth||1920;c.height=v.videoHeight||1080;c.getContext('2d').drawImage(v,0,0,c.width,c.height);rider5CapturedBlob=await new Promise(r=>c.toBlob(r,'image/jpeg',0.96));}const d=await rider5BlobDimensions(rider5CapturedBlob);if(Math.max(d.width,d.height)<1280||Math.min(d.width,d.height)<720){rider5CapturedBlob=null;showToast(`ภาพต่ำเกินไป ${d.width}×${d.height} กรุณาถ่ายใหม่`,false);return;}rider5CapturedUrl=URL.createObjectURL(rider5CapturedBlob);const p=document.getElementById('rider5-camera-preview');p.src=rider5CapturedUrl;p.classList.remove('hidden');v.classList.add('hidden');document.getElementById('rider5-camera-shot').classList.add('hidden');document.getElementById('rider5-camera-retake').classList.remove('hidden');document.getElementById('rider5-camera-use').classList.remove('hidden');document.getElementById('rider5-camera-quality').textContent=`✓ ${d.width}×${d.height} • ${(rider5CapturedBlob.size/1024/1024).toFixed(2)} MB`;}catch(err){showToast(err?.message||'ถ่ายรูปไม่สำเร็จ',false);}};
window.rider5RetakeCamera=function(){rider5CapturedBlob=null;document.getElementById('rider5-camera-video').classList.remove('hidden');document.getElementById('rider5-camera-preview').classList.add('hidden');document.getElementById('rider5-camera-shot').classList.remove('hidden');document.getElementById('rider5-camera-retake').classList.add('hidden');document.getElementById('rider5-camera-use').classList.add('hidden');};
async function rider5UploadEvidence(blob,kind){const ext=(blob.type||'image/jpeg').includes('png')?'png':'jpg';const path=`${currentUser.id}/${phase2d2BangkokDate()}/field-${kind}-${Date.now()}.${ext}`;const {error}=await adminSb.storage.from('payment-evidence').upload(path,blob,{cacheControl:'3600',upsert:false,contentType:blob.type||'image/jpeg'});if(error)throw error;return path;}
window.rider5UsePhoto=async function(){if(!rider5CapturedBlob){showToast('กรุณาถ่ายรูปก่อน',false);return;}if(!rider5CapturedGps){showToast('ต้องได้ GPS ก่อน',false);return;}const b=rider5CapturedBlob,g=rider5CapturedGps,m=rider5CameraMode;rider5CloseCamera();if(m==='CASH')await rider5FinalizeCashWithProof(b,g);else if(m==='ISSUE'){rider5IssueProof={blob:b,gps:g};document.getElementById('rider5-issue-proof-state').innerHTML=`<b class="text-emerald-700">✓ มีรูปหน้าบ้าน + GPS แล้ว</b><br>GPS ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} • ±${Math.round(g.accuracy||0)} ม.`;}else if(m==='SCAN_SLIP')await rider5VerifyDestinationScan(b,g);};

window.rider5ProceedPayment=async function(){if(!rider5Loaded||rider5LoadError){showToast('กรุณารีเฟรชรายการงานก่อน',false);return;}const ids=rider5SelectedCollections();if(!ids.length){showToast('เลือกอย่างน้อย 1 งวด',false);return;}if(String(liveRiderDashboard?.state)!=='WORKING'){showToast('ต้องกดเริ่มงานก่อนรับชำระ',false);return;}const total=(rider5Detail?.payable_installments||[]).filter(x=>ids.includes(String(x.collection_id))).reduce((s,x)=>s+Number(x.total_due||0),0);if(rider5Method==='CASH'){const ok=await fdgConfirm({title:'ยืนยันเตรียมรับเงินสด',kicker:'CASH COLLECTION',confirmText:'เปิดกล้องถ่ายหลักฐาน',body:`ลูกค้า <b>${liveEsc(rider5Detail?.customer?.full_name||'-')}</b><br>เลือก <b>${ids.length} งวด</b><br>ยอดรับ <b class="text-rose-600">${liveMoney(total)}</b><div class="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2">ต้องถ่ายรูปตอนรับเงิน + GPS ก่อนตัดยอด</div>`});if(ok)rider5OpenCamera('CASH',{collectionIds:ids});}else{const gps=await rider5GetLocation();if(!gps)return;try{const {data,error}=await adminSb.rpc('fdg_rider_create_scan_batch',{p_collection_ids:ids,p_gps_lat:gps.lat,p_gps_lng:gps.lng});if(error)throw error;rider5ScanBatch=data;document.getElementById('rider5-scan-amount').textContent=liveMoney(data.total_amount||0);document.getElementById('rider5-scan-qr').src=`https://promptpay.io/0658351446/${Number(data.total_amount||0).toFixed(2)}.png`;const m=document.getElementById('rider5-scan-modal');m.classList.remove('hidden');m.classList.add('flex');}catch(err){showToast(err?.message||'สร้าง SCAN ปลายทางไม่สำเร็จ',false);}}};
async function rider5FinalizeCashWithProof(blob,gps){const ids=rider5CameraContext?.collectionIds||rider5SelectedCollections();try{const path=await rider5UploadEvidence(blob,'cash');const ok=await fdgConfirm({title:'ยืนยันรับเงินสดและตัดยอด',kicker:'FINAL CASH',confirmText:'ยืนยันรับเงินจริง',danger:true,body:`รูปหลักฐานและ GPS อัปโหลดแล้ว<br><span class="text-xs text-gray-500">GPS ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}</span><div class="mt-2 text-xs bg-red-50 border border-red-200 rounded-lg p-2">หลังยืนยัน ยอดลูกค้าจะถูกตัดทันที และเงินจะเป็นเงินบริษัทที่ Rider ต้องนำส่ง</div>`});if(!ok)return;const {data,error}=await adminSb.rpc('fdg_rider_collect_cash_bundle',{p_collection_ids:ids,p_evidence_path:path,p_gps_lat:gps.lat,p_gps_lng:gps.lng});if(error)throw error;rider5CloseTaskModal();showToast(`รับเงินสดสำเร็จ ${liveMoney(data?.total_amount||0)} • คอมฯ ${liveMoney(data?.commission_amount||0)}`,true);await loadLiveRiderData({silent:true});}catch(err){showToast(err?.message||'รับเงินสดไม่สำเร็จ',false);}}
window.rider5CloseScanModal=function(){const m=document.getElementById('rider5-scan-modal');m?.classList.add('hidden');m?.classList.remove('flex');};
window.rider5CaptureScanSlip=function(){if(!rider5ScanBatch?.batch_id){showToast('ไม่พบรายการ SCAN',false);return;}rider5OpenCamera('SCAN_SLIP',{batchId:rider5ScanBatch.batch_id});};
async function rider5VerifyDestinationScan(blob,gps){const batchId=rider5CameraContext?.batchId||rider5ScanBatch?.batch_id;try{const path=await rider5UploadEvidence(blob,'scan-slip');const {data:attachment,error:aerr}=await adminSb.rpc('fdg_rider_attach_scan_batch_evidence',{p_batch_id:batchId,p_evidence_path:path,p_gps_lat:gps.lat,p_gps_lng:gps.lng});if(aerr)throw aerr;if(attachment?.status==='expired'){rider5CloseScanModal();rider5ScanBatch=null;throw new Error('รายการ SCAN หมดอายุ กรุณาตรวจยอดโอนกับ Admin ก่อนรับเงินหรือสร้างรายการใหม่');}const {data:s}=await adminSb.auth.getSession();const token=s?.session?.access_token;if(!token)throw new Error('Session หมดอายุ');showToast('กำลังตรวจ EasySlip...',true);const res=await fetch(`${ADMIN_SUPABASE_URL}/functions/v1/dynamic-api`,{method:'POST',headers:{'Content-Type':'application/json','apikey':ADMIN_SUPABASE_KEY,'Authorization':`Bearer ${token}`},body:JSON.stringify({type:'RIDER_CUSTOMER_SCAN',id:batchId})});let data={};try{data=await res.json();}catch(_){}if(!res.ok||data?.status!=='verified'){const e=new Error(data?.message||`EasySlip ไม่ผ่าน HTTP ${res.status}`);e.data=data;throw e;}rider5CloseScanModal();rider5CloseTaskModal();rider5ScanBatch=null;showToast(`✓ EasySlip VERIFIED ${liveMoney(data?.amount||0)} • เงินเข้าบริษัทโดยตรง`,true);await loadLiveRiderData({silent:true});}catch(err){showToast(err?.data?.message||err?.message||'ตรวจสลิปไม่สำเร็จ',false);await loadLiveRiderData({silent:true});}}

window.rider5OpenIssueForCustomer=function(id){rider5OpenTask(id).then(()=>setTimeout(rider5OpenIssueModal,120));};
window.rider5OpenIssueModal=function(){if(!rider5CurrentGroup)return;rider5IssueProof=null;document.getElementById('rider5-issue-note').value='';document.getElementById('rider5-issue-proof-state').textContent='ยังไม่มีรูปหน้าบ้านและ GPS';const a=Number(rider5CurrentGroup.call_attempts_today||0),f=rider5CurrentGroup.first_call_at?new Date(rider5CurrentGroup.first_call_at):null,l=rider5CurrentGroup.last_call_at?new Date(rider5CurrentGroup.last_call_at):null,g=(f&&l)?Math.floor((l-f)/60000):0;document.getElementById('rider5-call-rule').innerHTML=`<b>กดโทรวันนี้:</b> ${a} ครั้ง${a>=2?` • ห่างกัน ${g} นาที`:''}<br>“ไม่รับสาย” ต้อง 2 ครั้ง ห่าง ≥10 นาที • เหตุผลอื่นอย่างน้อย 1 ครั้ง`;const m=document.getElementById('rider5-issue-modal');m.classList.remove('hidden');m.classList.add('flex');};
window.rider5CloseIssueModal=function(){const m=document.getElementById('rider5-issue-modal');m?.classList.add('hidden');m?.classList.remove('flex');};
window.rider5CaptureIssueProof=function(){rider5OpenCamera('ISSUE',{customerId:rider5CurrentGroup?.customer_id});};
window.rider5SubmitIssue=async function(){if(!rider5CurrentGroup)return;if(!rider5IssueProof){showToast('ต้องถ่ายรูปหน้าบ้าน + GPS ก่อน',false);return;}const reason=document.getElementById('rider5-issue-reason').value,note=document.getElementById('rider5-issue-note').value.trim();try{const path=await rider5UploadEvidence(rider5IssueProof.blob,'issue');const ok=await fdgConfirm({title:'ยืนยันส่งงานติดปัญหา',kicker:'ISSUE PROOF',confirmText:'ส่งให้ Admin ตรวจ',body:`ลูกค้า <b>${liveEsc(rider5CurrentGroup.customer_name||'-')}</b><br><div class="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-lg p-2">ระบบเก็บรูปหน้าบ้าน + GPS + เวลา Server + ประวัติกดโทร งานวันนี้ถือว่าเคลียร์ แต่หนี้ยังค้าง</div>`});if(!ok)return;const {error}=await adminSb.rpc('fdg_rider_submit_issue',{p_customer_id:rider5CurrentGroup.customer_id,p_reason_code:reason,p_note:note||null,p_evidence_path:path,p_gps_lat:rider5IssueProof.gps.lat,p_gps_lng:rider5IssueProof.gps.lng});if(error)throw error;rider5CloseIssueModal();rider5CloseTaskModal();showToast('ส่งงานติดปัญหาให้ Admin ตรวจแล้ว',true);await loadLiveRiderData({silent:true});}catch(err){const m=String(err?.message||'');if(m.includes('NO_ANSWER_REQUIRES_TWO_CALLS'))showToast('ไม่รับสายต้องกดโทร 2 ครั้ง ห่างกันอย่างน้อย 10 นาที',false);else if(m.includes('CALL_ATTEMPT_REQUIRED'))showToast('ต้องกดโทรลูกค้าอย่างน้อย 1 ครั้งก่อน',false);else showToast(m||'ส่งงานติดปัญหาไม่สำเร็จ',false);}};

// Pretty Start / End Work
toggleShift=async function(){if(!currentUser||currentUser.role!=='rider')return;const state=String(liveRiderDashboard?.state||'OFFLINE');try{if(state==='WORKING'){const ok=await fdgConfirm({title:'ยืนยันเลิกงานวันนี้',kicker:'END WORK',confirmText:'ตรวจและเลิกงาน',danger:true,body:'ระบบจะตรวจว่าไม่มีลูกค้าที่ต้องเก็บค้าง หรือทุกงานที่เก็บไม่ได้ถูกส่ง “ติดปัญหา” พร้อมหลักฐานแล้ว และเงินบริษัทต้องเป็น 0'});if(!ok)return;const {error}=await adminSb.rpc('fdg_rider_end_work');if(error)throw error;showToast('ปิดงานวันนี้เรียบร้อย',true);}else{const ok=await fdgConfirm({title:'เริ่มปฏิบัติงาน',kicker:'START WORK',confirmText:'เริ่มงาน',body:'ระบบจะเปิดงานลูกค้าที่ถึงกำหนด/ค้างชำระในพื้นที่รับผิดชอบ'});if(!ok)return;const {data,error}=await adminSb.rpc('fdg_rider_start_work');if(error)throw error;if(data?.status==='cash_locked')showToast('มียอดเงินบริษัทค้าง ต้องนำส่งก่อนเริ่มงาน',false);else showToast('เริ่มปฏิบัติงานแล้ว',true);}await loadLiveRiderData({silent:true});}catch(err){const m=String(err?.message||'');if(m.includes('CASH_REMITTANCE_REQUIRED'))showToast('ยังมียอดเงินบริษัทค้างส่ง',false);else if(m.includes('PENDING_COLLECTIONS_REMAIN'))showToast('ยังมีลูกค้าที่ต้องเก็บหรือยังไม่ได้ส่งติดปัญหา',false);else showToast(m||'เปลี่ยนสถานะงานไม่สำเร็จ',false);}};

async function rider5LoadAdminIssues(showMessage=false){if(!currentUser||!['admin','master'].includes(String(currentUser.role)))return;try{const {data,error}=await adminSb.rpc('fdg_admin_rider_issue_snapshot');if(error)throw error;rider5AdminIssues=data?.issues||[];const box=document.getElementById('rider5-admin-issue-list');if(box){box.innerHTML=rider5AdminIssues.length?rider5AdminIssues.map(i=>`<div class="border rounded-xl p-3"><div class="flex flex-col md:flex-row md:items-start justify-between gap-3"><div><div class="font-bold">${liveEsc(i.customer_name||'-')} <span class="text-indigo-600">${liveEsc(i.customer_code||'')}</span></div><div class="text-xs text-gray-500">Rider: ${liveEsc(i.rider_name||'-')} • ${liveEsc(i.reason_label||i.reason_code||'-')}</div><div class="text-[11px] text-gray-500 mt-1">โทร ${i.call_attempts||0} ครั้ง • GPS ${i.gps_lat?Number(i.gps_lat).toFixed(6):'-'}, ${i.gps_lng?Number(i.gps_lng).toFixed(6):'-'}</div><div class="text-[11px] text-gray-400">${liveEsc(i.note||'')}</div></div><div class="flex flex-wrap gap-2"><button onclick="rider5ViewIssuePhoto('${i.id}')" class="border rounded-lg px-3 py-2 text-xs font-bold">ดูรูป</button><button onclick="rider5AdminReviewIssue('${i.id}',true)" class="bg-emerald-600 text-white rounded-lg px-3 py-2 text-xs font-bold">ยืนยันเคส</button><button onclick="rider5AdminReviewIssue('${i.id}',false)" class="bg-red-600 text-white rounded-lg px-3 py-2 text-xs font-bold">ปฏิเสธ</button></div></div></div>`).join(''):'<div class="text-sm text-emerald-600 font-bold">ไม่มีงานติดปัญหารอการตรวจสอบ</div>';}if(showMessage)showToast('รีเฟรชงานติดปัญหาแล้ว',true);}catch(err){if(showMessage)showToast(err?.message||'โหลดงานติดปัญหาไม่สำเร็จ',false);}}
window.rider5LoadAdminIssues=rider5LoadAdminIssues;
window.rider5ViewIssuePhoto=async function(id){const i=rider5AdminIssues.find(x=>String(x.id)===String(id));if(!i?.evidence_path)return;try{const {data,error}=await adminSb.storage.from('payment-evidence').createSignedUrl(i.evidence_path,300);if(error)throw error;window.open(data.signedUrl,'_blank','noopener');}catch(_){showToast('เปิดรูปไม่ได้',false);}};
window.rider5AdminReviewIssue=async function(id,approve){const i=rider5AdminIssues.find(x=>String(x.id)===String(id));if(!i)return;const ok=await fdgConfirm({title:approve?'ยืนยันงานติดปัญหา':'ปฏิเสธงานติดปัญหา',kicker:'ADMIN DOUBLE CHECK',confirmText:approve?'ยืนยัน':'ปฏิเสธ',danger:!approve,body:`ลูกค้า <b>${liveEsc(i.customer_name||'-')}</b><br>Rider <b>${liveEsc(i.rider_name||'-')}</b><br><span class="text-xs text-gray-500">ควรโทรตรวจลูกค้าอีกครั้งก่อนตัดสิน</span>`});if(!ok)return;try{const {error}=await adminSb.rpc('fdg_admin_review_rider_issue',{p_issue_id:id,p_approve:approve,p_note:approve?'Admin ตรวจสอบแล้ว':'Admin ปฏิเสธหลักฐาน/เหตุผล'});if(error)throw error;showToast(approve?'ยืนยันเคสแล้ว':'ปฏิเสธเคสแล้ว',true);await rider5LoadAdminIssues(false);}catch(err){showToast(err?.message||'บันทึกผลไม่สำเร็จ',false);}};

// Fix capital setter: server authorizes Master directly, no stale client isMaster check.
updateMasterInvestmentLimit=async function(){const input=document.getElementById('input-master-investment'),amount=Number(input?.value||0);if(!Number.isFinite(amount)||amount<=0){showToast('กรอกจำนวนเงินทุนให้ถูกต้อง',false);return;}const ok=await fdgConfirm({title:'ตั้งเงินทุนบริษัท',kicker:'MASTER CAPITAL',confirmText:'บันทึกเงินทุน',body:`ตั้งเงินทุนเป็น <b class="text-indigo-700">${liveMoney(amount)}</b><br><span class="text-xs text-gray-500">สิทธิ์ตรวจที่ Server โดยตรง</span>`});if(!ok)return;try{const {data,error}=await adminSb.rpc('fdg_master_set_investment_capital',{p_amount:amount});if(error)throw error;if(input)input.value='';showToast(`ตั้งเงินทุนเป็น ${liveMoney(data?.investment_capital_total||amount)} สำเร็จ`,true);await checkpoint4gLoadFinance(false);}catch(err){showToast(err?.message||'ตั้งเงินทุนไม่สำเร็จ',false);}};

const rider5BaseAdminLoad=loadLiveAdminData;
loadLiveAdminData=async function(){await rider5BaseAdminLoad();await rider5LoadAdminIssues(false);};

window.rider5ResumeScan=function(id){
  const b=rider5ScanBatches.find(x=>String(x.id)===String(id));if(!b)return;
  rider5ScanBatch={...b,batch_id:b.id};
  document.getElementById('rider5-scan-amount').textContent=liveMoney(b.total_amount);
  const promptpay='0658351446'; // Same company receiver as the existing SCAN flow.
  document.getElementById('rider5-scan-qr').src=`https://promptpay.io/${promptpay}/${Number(b.total_amount).toFixed(2)}.png`;
  const m=document.getElementById('rider5-scan-modal');m.classList.remove('hidden');m.classList.add('flex');
};
