// Explicit host-only regression: real Helium windows, official extension, two
// independent Codex identities. No account pages or persistent fixture tabs.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const launcher=fileURLToPath(new URL('../bin/helium-playwright.mjs',import.meta.url));
const identities=['a','b'].map(label=>`window-qa-${process.pid}-${label}`);
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Helium window fixture</title><label>Value<input></label>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const target=`http://127.0.0.1:${server.address().port}/`;
async function cli(identity,args){
  const env={...process.env,CODEX_THREAD_ID:identity};
  delete env.HELIUM_PLAYWRIGHT_SESSION;delete env.PLAYWRIGHT_CLI_SESSION;
  try{return (await exec(process.execPath,[launcher,...args],{env,timeout:45000,maxBuffer:1024*1024})).stdout.trim();}
  catch(error){throw Error((error.stdout||error.stderr||error.message).trim());}
}
const inspect=identity=>cli(identity,['run-code',`async page=>{const h=page.context().pages().find(p=>p.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'));return h.evaluate(async()=>{const t=await chrome.tabs.getCurrent();return {helper:t.id,window:t.windowId,group:t.groupId,windows:(await chrome.windows.getAll()).length}})}`]).then(JSON.parse);
const visibleWindows=async()=>JSON.parse((await exec('/usr/bin/osascript',['-l','JavaScript','-e','JSON.stringify(Application("Helium").windows().map(w=>w.id()).sort())'])).stdout);
const before=await visibleWindows();
const started=new Set();
try{
  const a=identities[0],b=identities[1];
  await Promise.all(identities.map(async id=>{await cli(id,['connect']);started.add(id);}));
  const initial=await inspect(a);
  await cli(a,['detach']);
  await cli(a,['connect']);
  const reconnected=await inspect(a);
  assert.equal(reconnected.window,initial.window,'Reconnect must reuse the automation window');
  assert.equal(reconnected.helper,initial.helper,'Reconnect must reuse its helper tab');
  assert.equal(reconnected.windows,initial.windows,'Reconnect must not increase the window count');
  await cli(a,['tab-new',target+'a']);
  await cli(a,['run-code',"async page=>{await page.getByLabel('Value').fill('terminal A');}"]);
  await cli(b,['connect']);started.add(b);
  const second=await inspect(b);
  assert.equal(second.window,initial.window,'Codex terminals must share the automation window');
  assert.notEqual(second.group,reconnected.group,'Each Codex terminal must own a separate group');
  assert.notEqual(second.helper,reconnected.helper,'Each Codex terminal must own its own helper');
  await cli(b,['tab-new',target+'b']);
  await cli(b,['run-code',"async page=>{await page.getByLabel('Value').fill('terminal B');}"]);
  const values=await Promise.all(identities.map(id=>cli(id,['run-code',"async page=>({value:await page.getByLabel('Value').inputValue(),pages:page.context().pages().filter(p=>p.url().startsWith('http://127.0.0.1:')).length})"]).then(JSON.parse)));
  assert.deepEqual(values,[{value:'terminal A',pages:1},{value:'terminal B',pages:1}],'Concurrent commands must remain in their own terminal tabs');
  for(let i=0;i<3;i++){
    await cli(a,['detach']);await cli(a,['connect']);
    const again=await inspect(a);
    assert.equal(again.window,initial.window);assert.equal(again.helper,initial.helper);assert.equal(again.windows,initial.windows);
    const restored=JSON.parse(await cli(a,['run-code',`async page=>{const p=page.context().pages().find(p=>p.url()===${JSON.stringify(target+'a')});return {value:p?await p.getByLabel('Value').inputValue():null}}`]));
    assert.equal(restored.value,'terminal A','Reconnect must restore only its own task tabs');
    const other=JSON.parse(await cli(b,['run-code',"async page=>({value:await page.getByLabel('Value').inputValue()})"]));
    assert.equal(other.value,'terminal B','Reconnecting A must not disconnect or retarget B');
  }
  assert.deepEqual(await visibleWindows(),before,'Headless automation must not create visible Helium windows');
  console.log('PASS: true headless Helium with the official extension; reconnect reuses helper/window; two Codex identities have isolated groups, targets and concurrent commands; visible windows unchanged.');
}finally{
  for(const id of started){
    await cli(id,['run-code',`async page=>{for(const p of page.context().pages())if(p.url().startsWith(${JSON.stringify(target)}))await p.close();const h=page.context().pages().find(p=>p.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'));if(h)await h.close();}`]).catch(()=>{});
    await cli(id,['detach']).catch(()=>{});
  }
  await new Promise(resolve=>server.close(resolve));
}
