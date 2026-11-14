// Explicit live integration check; never run from the default unit-test command.
// Uses the existing Helium session with a loopback fixture and no account data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),launcher=fileURLToPath(new URL('../bin/helium-playwright.mjs',import.meta.url));
const dir=await mkdtemp(path.join(tmpdir(),'helium-runner-qa-')),contents='Original Helium upload fixture.\n',filename=path.join(dir,'fixture.txt');
await writeFile(filename,contents,{mode:0o600});
const server=createServer((request,response)=>{response.setHeader('Content-Type','text/html');response.end('<title>Helium runner fixture</title><label>File <input type="file"></label><output></output><button id="alert" onclick="alert(\'Fixture dialog\')">Show dialog</button><script>document.querySelector("input").onchange=async e=>document.querySelector("output").textContent=await e.target.files[0]?.text()</script>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const target='http://127.0.0.1:'+server.address().port+'/runner';
let ownTab=false;
const inspect=async code=>JSON.parse(await cli(['run-code',`async page=>{const helper=page.context().pages().find(p=>p.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'));return helper.evaluate(${code});}`]));
async function cli(args,{allowError=false}={}){
 try{return (await exec(process.execPath,[launcher,...args],{timeout:45000,maxBuffer:4*1024*1024,env:{...process.env,HELIUM_PLAYWRIGHT_SESSION:'helium-browser-qa'}})).stdout.trim();}
 catch(error){if(allowError)return error.stdout||error.stderr||'';throw Error((error.stdout||error.stderr||error.message).trim());}
}
try{
 await cli(['connect']);
 const workspace=await inspect(`async()=>{const t=await chrome.tabs.getCurrent();return {windowId:t.windowId,groupId:t.groupId,tabs:(await chrome.tabs.query({windowId:t.windowId})).map(t=>({id:t.id,group:t.groupId}))}}`);
 assert(workspace.groupId>=0,'The headless connection must own a tab group');
 await cli(['tab-new',target]);ownTab=true;
 await cli(['tab-select','0']);await cli(['tab-select','1']);
 const selection=await inspect(`async()=>{const t=(await chrome.tabs.query({url:${JSON.stringify(target)}}))[0];return {targetWindow:t.windowId,group:t.groupId}}`);
 assert.equal(selection.targetWindow,workspace.windowId,'New tabs must reuse the headless window');
 assert.equal(selection.group,workspace.groupId,'New tabs must belong to this connection');
 const uploaded=await cli(['run-code',`async page=>{await page.getByLabel('File').setInputFiles(${JSON.stringify(filename)},{timeout:5000});await page.locator('output').filter({hasText:'Original Helium upload fixture.'}).waitFor();return {text:await page.locator('output').textContent()};}`]);
 assert.deepEqual(JSON.parse(uploaded),{text:contents},'Native file-path uploads must deliver exact fixture bytes');
 const chooser=await cli(['run-code',"async page=>{await page.getByLabel('File').click();await page.waitForTimeout(100);}"]);
 assert.match(chooser,/file.*chooser/i,'Compact output must reveal the pending chooser');
 await cli(['upload']);
 assert.equal(JSON.parse(await cli(['run-code',"async page=>({readable:await page.getByLabel('File').count()===1})"])).readable,true,'Cancel must release the modal before the next action');
 await cli(['run-code',"async page=>{await page.getByLabel('File').click();await page.waitForTimeout(100);}"]);
 await cli(['upload',filename]);
 assert.deepEqual(JSON.parse(await cli(['run-code',"async page=>({text:await page.locator('output').textContent()})"])),{text:contents});
 const dialog=JSON.parse(await cli(['--json','run-code',"async page=>{await page.getByRole('button',{name:'Show dialog'}).click();}"]));
 assert.match(dialog['modal state'],/dialog/i,'JSON output must retain the modal and recovery instruction');
 await cli(['dialog-dismiss']);
 await cli(['tab-close']);ownTab=false;
 await cli(['detach']);await cli(['connect']);
 assert.match(await cli(['connect']),/reused/);
 console.log('PASS: headless window reuse and isolated tab selection; native path and chooser uploads, exact bytes, raw/JSON modal reporting, cancellation, normal reads, detach/reconnect.');
}finally{
 if(ownTab){await cli(['upload'],{allowError:true});await cli(['dialog-dismiss'],{allowError:true});await cli(['tab-close'],{allowError:true});}
 await cli(['detach'],{allowError:true});await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});
}
