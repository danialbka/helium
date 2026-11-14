import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';

export function connectionSession(args,env=process.env){
  for(let i=0;i<args.length;i++){
    if(args[i]==='-s'||args[i]==='--session')return args[i+1];
    if(args[i].startsWith('-s=')||args[i].startsWith('--session='))return args[i].slice(args[i].indexOf('=')+1);
  }
  if(env.HELIUM_PLAYWRIGHT_SESSION||env.PLAYWRIGHT_CLI_SESSION)return env.HELIUM_PLAYWRIGHT_SESSION||env.PLAYWRIGHT_CLI_SESSION;
  const identity=env.CODEX_THREAD_ID||env.TERM_SESSION_ID||env.ITERM_SESSION_ID||(env.TMUX_PANE&&`${env.TMUX}:${env.TMUX_PANE}`)||env.TTY;
  return identity?`helium-${createHash('sha256').update(identity).digest('hex').slice(0,12)}`:'helium';
}

// Serialize startup, including the first headless host. A killed terminal must
// not leave a permanent lock; a busy connection must never be replaced.
export async function connectLock(local){
  const directory=path.join(local,'connect.lock'),deadline=Date.now()+45000;
  for(;;){
    try{mkdirSync(directory,{mode:0o700});writeFileSync(path.join(directory,'pid'),String(process.pid),{mode:0o600});break;}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      try{
        const pid=Number(readFileSync(path.join(directory,'pid'),'utf8'));
        if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid lock owner');
        try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){rmSync(directory,{recursive:true,force:true});continue;}throw e;}
      }catch{try{if(Date.now()-statSync(directory).mtimeMs>45000){rmSync(directory,{recursive:true,force:true});continue;}}catch{continue;}}
      if(Date.now()>deadline)throw Error('Helium is connecting in another terminal. Retry after that connection finishes.');
      await delay(100);
    }
  }
  const release=()=>{try{if(readFileSync(path.join(directory,'pid'),'utf8')===String(process.pid))rmSync(directory,{recursive:true,force:true});}catch{}};
  process.once('exit',release);
  return ()=>{process.removeListener('exit',release);release();};
}
