// Tab bookkeeping for a visible Helium session, run through the official
// extension's own pages (they have chrome.tabs; nothing in the extension is
// modified). Goals: never leave a dead helper tab behind, give a reconnecting
// session its earlier tabs back, and reuse an open tab instead of duplicating it.
export const EXTENSION='chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/';
const HELPER_MARK='#helium-helper';

// Same page, ignoring only a trailing slash. Fragments stay significant
// because single-page sites route on them.
export function sameUrl(a,b){
  const norm=u=>{try{u=new URL(u).href;}catch{u=String(u);}return u.replace(/\/$/,'');};
  return norm(a)===norm(b);
}

// Runs inside a helper (extension) page. Self-contained: it is serialized.
async function helperWork({session,mark,restore}){
  const me=await chrome.tabs.getCurrent();
  // The browser selects a newly opened helper tab. Give the selection back to
  // the tab the owner had in front in that window.
  if(restore?.length&&(await chrome.tabs.get(me.id)).active){
    for(const id of restore){
      const before=await chrome.tabs.get(id).catch(()=>null);
      if(before&&before.windowId===me.windowId&&before.id!==me.id){await chrome.tabs.update(id,{active:true});break;}
    }
  }
  for(let i=0;i<30&&(await chrome.tabs.get(me.id)).groupId<0;i++)await new Promise(r=>setTimeout(r,100));
  const self=await chrome.tabs.get(me.id);
  if(self.groupId<0)throw Error('Missing isolated automation group');
  const title='Codex · '+session,key='helium-tabs:'+session,base=chrome.runtime.getURL('');
  const status=()=>chrome.runtime.sendMessage({type:'getConnectionStatus'});
  // Tabs a live connection is driving: listed by the extension, or debugged.
  const live=new Set((await status()).connections.flatMap(c=>c.connectedTabIds));
  for(const t of await chrome.debugger.getTargets())if(t.attached&&t.tabId!==undefined)live.add(t.tabId);
  const all=await chrome.tabs.query({});
  const url=t=>t.url||t.pendingUrl||'';
  const isHelper=t=>url(t).startsWith(base+'connect.html')||(url(t).startsWith(base)&&url(t).endsWith(mark));
  const debuggable=t=>!/^(chrome|edge|devtools):/.test(url(t));
  let saved=[];try{saved=JSON.parse(localStorage.getItem(key)||'[]');}catch{}
  // A browser restart restores this session's old group under the same title.
  const restored=new Set((await chrome.tabGroups.query({title})).filter(g=>g.id!==self.groupId).map(g=>g.id));
  const mine=t=>(t.groupId===-1&&saved.some(s=>s.id===t.id&&s.url===t.url))||restored.has(t.groupId);
  const candidates=all.filter(t=>t.id!==me.id&&!live.has(t.id));
  const adopt=candidates.filter(t=>!isHelper(t)&&debuggable(t)&&mine(t)).map(t=>t.id);
  if(adopt.length)await chrome.tabs.group({tabIds:adopt,groupId:self.groupId});
  // Helper tabs whose connection is gone are plumbing with nothing to keep.
  const stale=candidates.filter(isHelper).map(t=>t.id);
  if(stale.length)await chrome.tabs.remove(stale);
  await chrome.tabGroups.update(self.groupId,{title,color:'blue'});
  if(!window.__heliumTracker){
    window.__heliumTracker=true;
    let timer;
    const tick=async()=>{
      const now=await chrome.tabs.get(me.id).catch(()=>null);
      if(!now)return;
      // Connection over (detach, crash, dragged out): close this helper so the
      // next connection does not find a second one. The saved list is kept.
      if(!(await status()).connections.some(c=>c.connectedTabIds.includes(me.id))){await chrome.tabs.remove(me.id);return;}
      if(now.groupId<0)return;
      const tabs=await chrome.tabs.query({groupId:now.groupId});
      localStorage.setItem(key,JSON.stringify(tabs.filter(t=>t.id!==me.id).map(t=>({id:t.id,url:t.url}))));
    };
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>tick().catch(()=>{}),700);};
    chrome.tabs.onUpdated.addListener((id,info)=>{if(info.groupId!==undefined||info.url!==undefined)schedule();});
    chrome.tabs.onRemoved.addListener(schedule);
    setInterval(schedule,30000);
    window.__heliumSchedule=schedule;
  }
  window.__heliumSchedule();
  return {groupId:self.groupId,adopted:adopt.length,closedHelpers:stale.length};
}

const findHelper=`const EXT=${JSON.stringify(EXTENSION)};
  const context=page.context();
  const findHelper=()=>context.pages().find(p=>p.url().startsWith(EXT+'connect.html'))||context.pages().find(p=>p.url().startsWith(EXT));`;

// Connect-time housekeeping. Returns the session's tabs so the caller knows
// what already exists before opening anything.
export function connectCode(session,restore=[]){
  return `async page => {
  ${findHelper}
  let helper=findHelper();
  if(!helper){helper=await context.newPage();await helper.goto(EXT+'status.html${HELPER_MARK}');}
  const done=await helper.evaluate(${helperWork.toString()},${JSON.stringify({session,mark:HELPER_MARK,restore})});
  // Returned tabs attach asynchronously; wait until they are usable.
  const want=context.pages().length+done.adopted;
  for(let i=0;i<50&&context.pages().length<want;i++)await helper.waitForTimeout(100);
  const tabs=context.pages().map((p,index)=>({index,url:p.url()})).filter(t=>!t.url.startsWith(EXT));
  return {visible:true,session:${JSON.stringify(session)},...done,tabs};
}`;
}

// Is the requested page already open in this session? Also matches the address
// an earlier tab-new for the same request ended on (redirects).
export function reuseCode(session,url){
  return `async page => {
  ${findHelper}
  const sameUrl=${sameUrl.toString()};
  const wanted=${JSON.stringify(url)};
  let landed;
  const helper=findHelper();
  if(helper)landed=await helper.evaluate(([k,u])=>{try{return JSON.parse(localStorage.getItem(k)||'{}')[u];}catch{}},[${JSON.stringify('helium-opened:'+session)},wanted]).catch(()=>undefined);
  const pages=context.pages();
  const index=pages.findIndex(p=>!p.url().startsWith(EXT)&&(sameUrl(p.url(),wanted)||(landed&&sameUrl(p.url(),landed))));
  return index<0?{reuse:false}:{reuse:true,index,url:pages[index].url()};
}`;
}

// After tab-new: remember where the request ended up (the current page).
export function recordCode(session,url){
  return `async page => {
  ${findHelper}
  const helper=findHelper();
  if(!helper)return {recorded:false};
  await helper.evaluate(([k,u,final])=>{
    let map={};try{map=JSON.parse(localStorage.getItem(k)||'{}');}catch{}
    delete map[u];map[u]=final;
    const keys=Object.keys(map);for(const old of keys.slice(0,Math.max(0,keys.length-50)))delete map[old];
    localStorage.setItem(k,JSON.stringify(map));
  },[${JSON.stringify('helium-opened:'+session)},${JSON.stringify(url)},page.url()]);
  return {recorded:true};
}`;
}
