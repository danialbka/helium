#!/usr/bin/env node
import {readFileSync, readlinkSync, realpathSync, existsSync, openSync, closeSync, statSync} from 'node:fs';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {connectionSession, connectLock} from '../lib/connection.mjs';
import {protectOutput} from '../lib/output.mjs';
import {connectCode,reuseCode,recordCode} from '../lib/tabs.mjs';

process.umask(0o077);
const root=fileURLToPath(new URL('../',import.meta.url));
const local=path.join(root,'.local');
const settings=JSON.parse(readFileSync(path.join(local,'settings.json'),'utf8'));
const token=existsSync(path.join(local,'auth-token'))?readFileSync(path.join(local,'auth-token'),'utf8').trim():'';
protectOutput(token);
const args=process.argv.slice(2);
const explicit=args.some(a=>/^(-s|--session)(=|$)/.test(a));
const session=explicit||process.env.HELIUM_PLAYWRIGHT_SESSION?connectionSession(args):`visible-${connectionSession(args)}`;
for(let i=0;i<args.length;i++){
  if(args[i]==='-s'||args[i]==='--session'){args.splice(i,2);i--;}
  else if(/^(-s|--session)=/.test(args[i])){args.splice(i,1);i--;}
}
const env={...process.env,PLAYWRIGHT_MCP_EXECUTABLE_PATH:settings.executablePath,PLAYWRIGHT_MCP_PROFILE_DIR_NAME:settings.profile};
for(const key of ['HELIUM_PLAYWRIGHT_HEADLESS','HELIUM_PLAYWRIGHT_BACKGROUND','HELIUM_PLAYWRIGHT_HEADLESS_MODULE','PLAYWRIGHT_MCP_EXTENSION_TOKEN','PWTEST_EXTENSION_USER_DATA_DIR'])delete env[key];
if(token)env.PLAYWRIGHT_MCP_EXTENSION_TOKEN=token;
// Work in unselected tabs so the owner's current tab and application keep
// focus. HELIUM_PLAYWRIGHT_FOREGROUND=1 restores upstream's bring-to-front.
if(process.env.HELIUM_PLAYWRIGHT_FOREGROUND!=='1')env.HELIUM_PLAYWRIGHT_BACKGROUND='1';
const cli=path.join(root,'node_modules/@playwright/cli/playwright-cli.js');
function run(command,{quiet=false,allowFailure=false,timeout=45000}={}){
  const result=spawnSync(process.execPath,[cli,`-s=${session}`,'--raw',...command],{cwd:root,env,encoding:'utf8',timeout,maxBuffer:4*1024*1024});
  if(!quiet){process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');}
  if(!allowFailure&&(result.error||result.status!==0))throw Error(result.error?.message||`Playwright command failed (${result.status}).`);
  return result;
}
function frontApp(){
  const result=spawnSync('/usr/bin/osascript',['-l','JavaScript','-e','ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js'],{encoding:'utf8',timeout:5000});
  return result.status===0?result.stdout.trim():'';
}
// The tab selected in each Helium window before a helper tab is opened.
function selectedTabs(){
  if(process.platform!=='darwin'||env.HELIUM_PLAYWRIGHT_BACKGROUND!=='1'||!defaultBrowserPid())return [];
  const result=spawnSync('/usr/bin/osascript',['-e','tell application "Helium" to get id of active tab of every window'],{encoding:'utf8',timeout:5000});
  if(result.status!==0)return [];
  return result.stdout.split(',').map(Number).filter(Number.isSafeInteger);
}
function connect(){
  const ready=run(['tab-list'],{quiet:true,allowFailure:true,timeout:10000});
  if(ready.error)throw Error('Visible Helium connection check did not finish; no replacement connection attempted.');
  let restore=[];
  if(ready.status!==0){
    restore=selectedTabs();
    const front=restore.length?frontApp():'';
    run(['attach','--extension=chrome',`--config=${path.join(local,'cli.config.json')}`],{quiet:true});
    // Opening the helper tab can bring Helium forward. Hand the screen back,
    // unless the owner was already in Helium or has since switched elsewhere.
    if(front&&front!=='net.imput.helium'&&frontApp()==='net.imput.helium')spawnSync('/usr/bin/open',['-b',front],{timeout:5000});
  }
  // Reports the tabs this session already has, returns its earlier tabs to the
  // group, and closes helper tabs left behind by finished connections.
  const grouped=run(['run-code',connectCode(session,restore)]);
  return JSON.parse(grouped.stdout.trim());
}
// tab-new <url>: select the tab that already shows this page instead of
// opening it again. --new opens another copy on purpose.
function tabNew(rest){
  const force=rest.includes('--new');
  const passed=rest.filter(a=>a!=='--new');
  const url=passed.find(a=>!a.startsWith('-'));
  if(!url||force)return run(['tab-new',...passed]);
  const check=run(['run-code',reuseCode(session,url)],{quiet:true,allowFailure:true});
  let found;try{found=JSON.parse(check.stdout.trim());}catch{}
  if(found?.reuse){
    run(['tab-select',String(found.index)],{quiet:true});
    console.log(JSON.stringify({reused:true,index:found.index,url:found.url,note:'Already open in this session; selected it. Pass --new to open another copy.'}));
    return;
  }
  run(['tab-new',...passed]);
  run(['run-code',recordCode(session,url)],{quiet:true,allowFailure:true});
}
function defaultBrowserPid(){
  const lock=path.join(os.homedir(),'Library/Application Support/net.imput.helium/SingletonLock');
  let target;try{target=readlinkSync(lock);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const pid=Number(target.match(/-(\d+)$/)?.[1]);
  if(!Number.isSafeInteger(pid)||pid<2)throw Error('Cannot identify normal Helium process.');
  const result=spawnSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
  if(result.status!==0)return null;
  const command=result.stdout.trim();
  if(!command.startsWith(settings.executablePath+' ')&&command!==settings.executablePath)throw Error('Profile lock does not belong to the configured Helium executable.');
  if(/--headless(?:[=\s]|$)|--user-data-dir(?:[=\s]|$)/.test(command))throw Error('Refusing to restart a headless or custom-profile browser.');
  return pid;
}
async function loadExtension(input,restart){
  if(process.platform!=='darwin')throw Error('Visible extension startup currently supports macOS Helium only.');
  if(!input)throw Error('Usage: load-extension /absolute/extension/folder --restart');
  const directory=realpathSync(input);
  if(directory.includes(','))throw Error('Extension paths cannot contain commas.');
  const manifest=JSON.parse(readFileSync(path.join(directory,'manifest.json'),'utf8'));
  if(!manifest.name||!manifest.version||!manifest.key)throw Error('A named, versioned extension with a stable manifest key is required.');
  const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
  const pid=defaultBrowserPid();
  if(pid&&!restart)throw Error('Normal Helium is running; --restart is required to load an extension at startup.');
  if(pid){
    run(['detach'],{quiet:true,allowFailure:true});
    process.kill(pid,'SIGTERM');
    const deadline=Date.now()+20000;
    for(;;){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')break;throw e;}if(Date.now()>deadline)throw Error('Normal Helium did not exit; no force-kill or second launch attempted.');await delay(200);}
  }
  const log=openSync(path.join(local,'visible-host.err'),'a',0o600);
  const started=Date.now();
  const child=spawn(settings.executablePath,[`--profile-directory=${settings.profile}`,`--load-extension=${directory}`,'--restore-last-session','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{detached:true,stdio:['ignore',log,log],env});
  child.unref();closeSync(log);
  const deadline=Date.now()+20000;
  while(defaultBrowserPid()!==child.pid){if(Date.now()>deadline)throw Error('Visible Helium startup did not establish its profile lock.');await delay(200);}
  const portFile=path.join(os.homedir(),'Library/Application Support/net.imput.helium/DevToolsActivePort');
  let port;
  const portDeadline=Date.now()+10000;
  while(!port){
    try{if(statSync(portFile).mtimeMs>=started-1000)port=Number(readFileSync(portFile,'utf8').split('\n')[0]);}catch{}
    if(!port){if(Date.now()>portDeadline)throw Error('Visible browser did not expose its local Playwright endpoint; build load is not runtime-verified.');await delay(200);}
  }
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local browser endpoint.');
  const require=createRequire(import.meta.url);
  const {chromium}=require('playwright-core');
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:10000,noDefaults:true});
  let actual;
  try{
    const target=await browser.contexts()[0].newPage();
    const targetUrl=`chrome-extension://${id}/${manifest.action?.default_popup||'manifest.json'}?qaSession=${encodeURIComponent(session)}`;
    await target.goto(targetUrl);
    actual=await target.evaluate(()=>({id:chrome.runtime.id,name:chrome.runtime.getManifest().name,version:chrome.runtime.getManifest().version}));
    if(actual.id!==id||actual.version!==manifest.version)throw Error('Loaded extension identity/version mismatch');
    await target.close();
  }finally{await browser.close();}
  // Chrome's extension bridge can be detached by a concurrent direct CDP client.
  // Finish verification first, then establish the isolated CLI group last.
  const group=connect();
  console.log(JSON.stringify({...actual,source:directory,visible:true,groupId:group.groupId}));
}
try{
  if(!args.length||args[0]==='connect'||args[0]==='load-extension'){
    const release=await connectLock(local);
    try{if(args[0]==='load-extension')await loadExtension(args[1],args.includes('--restart'));else connect();}finally{release();}
  }else if(args[0]==='--help')console.log('Visible Helium: connect | load-extension /absolute/folder --restart | tab-new <url> [--new] | <playwright-cli command>. connect lists the tabs this session already has; tab-new reuses an open tab for the same page. Use -s=<session> for an isolated group. Loading restarts only normal default-profile Helium; never the shared headless host.');
  else if(args[0]==='tab-new')tabNew(args.slice(1));
  else run(args);
}catch(error){console.error(error.message);process.exitCode=1;}
