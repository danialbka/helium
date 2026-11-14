import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const frontScript='ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js';
async function foreground(){return (await exec('/usr/bin/osascript',['-l','JavaScript','-e',frontScript],{timeout:3000})).stdout.trim();}
export async function captureDesktopFocus(){
  if(process.platform!=='darwin')return null;
  try{
    const application=await foreground();
    const result=await exec('/usr/bin/osascript',['-e','tell application "Helium" to get {id of window 1, id of active tab of window 1}'],{timeout:3000});
    const [windowId,tabId]=result.stdout.trim().split(/,\s*/).map(Number);
    return {application,windowId,tabId};
  }catch{return null;}
}
export async function restoreDesktopFocus(previous){
  if(!previous?.application)return;
  try{
    const front=await foreground();
    // Restore only if this connection brought Helium forward. Never override a
    // switch the user made to another application while the connection opened.
    if(front==='net.imput.helium' && previous.application!==front)
      await exec('/usr/bin/open',['-b',previous.application],{timeout:3000});
  }catch{ /* A closed application does not prevent a usable browser connection. */ }
}
export function workspaceCode(previous,session='helium'){
  return `async page => {
    const helper=page.context().pages().find(p=>p.url().startsWith('chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html'));
    if(!helper)throw Error('The official extension helper is missing.');
    return helper.evaluate(async session=>{
      const current=await chrome.tabs.getCurrent();
      if(current.groupId<0)throw Error('The helper has no automation group.');
      const params=new URL(location.href).searchParams;
      if(params.get('heliumSession')!==session)throw Error('The helper belongs to another Helium session.');
      // A graceful detach remembers only this group's tab IDs. Never take a tab
      // from another live connection, even if the user moved it meanwhile.
      const saved=JSON.parse(params.get('heliumTabs')||'[]');
      const tabs=await chrome.tabs.query({windowId:current.windowId});
      const owned=tabs.filter(t=>saved.includes(t.id)&&t.groupId===-1).map(t=>t.id);
      if(owned.length)await chrome.tabs.group({tabIds:owned,groupId:current.groupId});
      await chrome.tabGroups.update(current.groupId,{title:'Codex · '+session,color:'blue'});
      return {isolatedGroup:true,headless:true};
    },${JSON.stringify(session)});
  }`;
}
