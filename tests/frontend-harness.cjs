const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function harness(file) {
  const html = fs.readFileSync(file, 'utf8')+'<script>'+fs.readFileSync(require('node:path').join(require('node:path').dirname(file),'rider5a.js'),'utf8')+'</script>';
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(m => !/\bsrc\s*=/.test(m[1]));
  const nodes = new Map(), events = new Map(), timers = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      id, innerHTML: '', textContent: '', innerText: '', value: '', disabled: false,
      style: {}, dataset: {}, children: [],
      classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} },
      addEventListener(){}, removeEventListener(){}, setAttribute(){}, removeAttribute(){},
      appendChild(){}, remove(){}, focus(){}, blur(){}, querySelectorAll(){return [];},
      querySelector(){return null;}, getContext(){return {};},
    });
    return nodes.get(id);
  };
  const on = (event, cb) => { if(!events.has(event)) events.set(event, []); events.get(event).push(cb); };
  const storage = new Map();
  const sandbox = {
    console: { log(){}, warn(){}, error(){} },
    document: {
      getElementById:node, querySelector(){return null;}, querySelectorAll(){return [];},
      createElement: tag=>node('created-'+tag), addEventListener:on, removeEventListener(){},
      body:node('body'), documentElement:node('html'), visibilityState:'visible', activeElement:node('active'),
    },
    navigator:{ userAgent:'Node test harness', standalone:false },
    location:{protocol:'https:',pathname:'/admin.html',href:'https://example.invalid/admin.html',search:'',hash:''},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    sessionStorage:{getItem(){return null;},setItem(){},removeItem(){}},
    setTimeout:(cb,ms)=>{const id=Symbol();timers.set(id,{cb,ms,type:'timeout'});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:(cb,ms)=>{const id=Symbol();timers.set(id,{cb,ms,type:'interval'});return id;},
    clearInterval:id=>timers.delete(id),
    addEventListener:on,removeEventListener(){}, matchMedia:()=>({matches:false,addEventListener(){}}),
    innerWidth:390, lucide:{createIcons(){}}, confirm:()=>{throw Error('Unexpected browser confirm');},
    supabase:{createClient:()=>({auth:{signOut:async()=>({error:null})}})},
    URL, URLSearchParams, Intl, Blob, AbortController, structuredClone,
  };
  sandbox.window=sandbox; sandbox.self=sandbox;
  const ctx=vm.createContext(sandbox), errors=[];
  scripts.forEach((m,i)=>{
    try { new vm.Script(m[2], {filename:`${file}:script-${i+1}`}).runInContext(ctx); }
    catch(e){errors.push({script:i+1,message:e.message});}
  });
  return {ctx,nodes,node,timers,events,errors,scripts,run:code=>vm.runInContext(code,ctx)};
}

module.exports={harness};
if(require.main===module){
  const h=harness(process.argv[2]);
  console.log(JSON.stringify({scripts:h.scripts.length,startupErrors:h.errors},null,2));
  process.exitCode=h.errors.length?1:0;
}
