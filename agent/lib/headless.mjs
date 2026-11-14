import net from 'node:net';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const local=path.join(root,'.local');
export const hostSocket=path.join(local,'headless.sock');

export function hostRequest(request){
  return new Promise((resolve,reject)=>{
    const socket=net.connect(hostSocket);let data='';
    const timer=setTimeout(()=>socket.destroy(Error('Headless Helium host timed out.')),30000);
    socket.once('connect',()=>socket.write(JSON.stringify(request)+'\n'));
    socket.on('data',chunk=>{
      data+=chunk;
      if(data.length>1024*1024){socket.destroy(Error('Invalid headless host response.'));return;}
      if(!data.includes('\n'))return;
      try{const result=JSON.parse(data.slice(0,data.indexOf('\n')));if(result.error)reject(Error(result.error));else resolve(result);}catch(error){reject(error);}
      socket.destroy();
    });
    socket.once('error',reject);
    socket.once('close',()=>{clearTimeout(timer);if(!data)reject(Error('Headless Helium host is unavailable.'));});
  });
}

export async function ensureHeadless(){
  try{return await hostRequest({action:'info'});}catch(error){if(!/unavailable|ENOENT|ECONNREFUSED/.test(error.message))throw error;}
  const log=openSync(path.join(local,'headless-host.err'),'w',0o600);
  const child=spawn(process.execPath,[path.join(root,'bin/headless-host.mjs')],{cwd:root,detached:true,stdio:['ignore','ignore',log]});
  child.unref();closeSync(log);
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){
    await delay(100);
    try{return await hostRequest({action:'info'});}catch{}
    if(child.exitCode!==null)break;
  }
  throw Error('Headless Helium did not start. Inspect the protected .local/headless-host.err diagnostic.');
}

// Called by the version-checked upstream extension-launch hook. The URL and
// authentication token travel only over a mode-600 local socket, never argv.
export async function openHeadlessConnectPage(url){
  await hostRequest({action:'connect',url,session:process.env.HELIUM_PLAYWRIGHT_CONNECTION});
}
