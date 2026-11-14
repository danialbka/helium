#!/usr/bin/env node
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,readdir,unlink,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {hostSocket} from '../lib/headless.mjs';
process.umask(0o077);
const root=fileURLToPath(new URL('../',import.meta.url)),local=path.join(root,'.local');
const require=createRequire(import.meta.url),{chromium}=require('playwright-core');
const settings=JSON.parse(await readFile(path.join(local,'settings.json'),'utf8'));
const extensionId='mmlmfjhmonkocbjadbfplnigmagldckm';
const base=`chrome-extension://${extensionId}/connect.html`;
const extensionRoot=path.join(os.homedir(),'Library/Application Support/net.imput.helium',settings.profile,'Extensions',extensionId);
const versions=(await readdir(extensionRoot)).filter(v=>/^\d/.test(v)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
if(!versions.length)throw Error('Install the official Playwright extension in Helium first.');
const extension=path.join(extensionRoot,versions[0]);
const profile=path.join(local,'headless-profile');
await mkdir(profile,{recursive:true,mode:0o700});
const context=await chromium.launchPersistentContext(profile,{
  executablePath:settings.executablePath,channel:'chromium',headless:true,viewport:null,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],timeout:20000,
});
// This connection owns browser lifetime, while the official extension handles
// dialogs. Suppress Playwright's default auto-dismiss in the lifetime connection.
const leaveDialogsToExtension=page=>page.on('dialog',()=>{});
context.on('page',leaveDialogsToExtension);
for(const page of context.pages())leaveDialogsToExtension(page);
const status=await context.newPage();await status.goto(`chrome-extension://${extensionId}/status.html`);
const token=await status.evaluate(()=>localStorage.getItem('auth-token'));
if(!token)throw Error('Headless Playwright extension did not initialize.');
await writeFile(path.join(local,'headless-token'),token+'\n',{mode:0o600});
await status.close();
for(const p of context.pages())if(p.url()==='about:blank')await p.close();
let lastRequest=Date.now(),closing=false;
const info={pid:process.pid,headless:true,extensionId};
const saved=new Map();
async function liveRelay(page){
  let url;try{url=new URL(new URL(page.url()).searchParams.get('mcpRelayUrl'));}catch{return false;}
  if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.protocol!=='ws:')return true;
  return new Promise(resolve=>{const s=net.connect({host:url.hostname==='[::1]'?'::1':url.hostname,port:Number(url.port)});s.setTimeout(500);s.once('connect',()=>{s.destroy();resolve(true)});s.once('error',()=>resolve(false));s.once('timeout',()=>{s.destroy();resolve(false)});});
}
async function handle(request){
  lastRequest=Date.now();
  if(request.action==='info')return info;
  if(request.action==='connect'){
    if(typeof request.session!=='string'||!request.session)throw Error('A Helium session identity is required.');
    const url=new URL(request.url);
    if(url.protocol!=='chrome-extension:'||url.hostname!==extensionId||url.pathname!=='/connect.html')throw Error('Invalid Playwright helper URL.');
    url.searchParams.set('heliumSession',request.session);
    const existing=context.pages().find(p=>p.url().startsWith(base)&&new URL(p.url()).searchParams.get('heliumSession')===request.session);
    if(existing&&await liveRelay(existing))throw Error('This Helium session is already connected. Reuse it instead of attaching again.');
    const page=existing||await context.newPage();
    // Keep only this session's known task tabs across a graceful detach.
    if(saved.has(request.session))url.searchParams.set('heliumTabs',JSON.stringify(saved.get(request.session)));
    await page.goto(url.toString(),{waitUntil:'domcontentloaded'});
    return {reused:Boolean(existing)};
  }
  if(request.action==='remember'){
    const page=context.pages().find(p=>p.url().startsWith(base)&&new URL(p.url()).searchParams.get('heliumSession')===request.session);
    if(page)saved.set(request.session,await page.evaluate(async()=>{const t=await chrome.tabs.getCurrent();if(t.groupId<0)return [];return (await chrome.tabs.query({groupId:t.groupId})).map(t=>t.id);}));
    return {remembered:Boolean(page)};
  }
  throw Error('Unknown headless host request.');
}
// Requests can create helpers concurrently for different CLI daemons. Serialize
// them so both see the same browser and one helper per session.
let queue=Promise.resolve();
const server=net.createServer(socket=>{
  let input='';socket.setTimeout(30000,()=>socket.destroy());
  socket.on('data',chunk=>{
    input+=chunk;if(input.length>65536){socket.destroy();return;}
    const end=input.indexOf('\n');if(end<0)return;
    const line=input.slice(0,end);input='';
    queue=queue.then(async()=>{
      try{socket.end(JSON.stringify(await handle(JSON.parse(line)))+'\n');}
      catch{socket.end(JSON.stringify({error:'Headless Helium could not complete the request. Reuse the existing connection or reconnect after the current task finishes.'})+'\n');}
    }).catch(()=>{});
  });
  socket.on('error',()=>{});
});
await unlink(hostSocket).catch(e=>{if(e.code!=='ENOENT')throw e;});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(hostSocket,resolve);});
await chmod(hostSocket,0o600);
async function close(){if(closing)return;closing=true;clearInterval(idle);server.close();await context.close();await unlink(hostSocket).catch(()=>{});process.exit(0);}
const idle=setInterval(async()=>{
  if(Date.now()-lastRequest<10*60*1000)return;
  const helpers=context.pages().filter(p=>p.url().startsWith(base));
  if((await Promise.all(helpers.map(liveRelay))).some(Boolean))return;
  await close();
},30000);
process.once('SIGTERM',close);process.once('SIGINT',close);context.once('close',()=>{if(!closing)void close();});
