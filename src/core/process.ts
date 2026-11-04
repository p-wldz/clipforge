import { spawn } from 'node:child_process';
export async function run(command:string,args:string[],opts:{cwd?:string;timeoutMs?:number;input?:string;encoding?:'buffer';maxBuffer?:number;onStdout?:(text:string)=>void;onStderr?:(text:string)=>void}={}) {
  return new Promise<{stdout:string|Buffer;stderr:string}>((resolve,reject)=>{
    const child=spawn(command,args,{cwd:opts.cwd,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const chunks:Buffer[]=[];let bytes=0;let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),opts.timeoutMs??120000);
    child.stdout.on('data',(b:Buffer)=>{opts.onStdout?.(b.toString());bytes+=b.length;if(opts.encoding==='buffer')chunks.push(b);else stdout+=b.toString(); if(bytes>(opts.maxBuffer??8_000_000))child.kill();});
    child.stderr.on('data',(b:Buffer)=>{opts.onStderr?.(b.toString());stderr+=b.toString(); if(stderr.length>8_000_000)child.kill();});
    child.on('error',e=>{clearTimeout(timer);reject(e)});
    child.on('close',(code,signal)=>{clearTimeout(timer); if(code===0)resolve({stdout:opts.encoding==='buffer'?Buffer.concat(chunks):stdout,stderr});else reject(new Error(`${command} failed (${code??signal}): ${stderr.slice(-2500)}`));});
    if(opts.input!==undefined)child.stdin.end(opts.input);else child.stdin.end();
  });
}
export async function checkTool(cmd:string,args=['-version']) {
  try {let result=await run(cmd,args,{timeoutMs:5000});return {installed:true,version:String(result.stdout||result.stderr).split('\n')[0]?.slice(0,150)||'available'};}
  catch(e){return {installed:false,error:(e as Error).message.slice(0,180)};}
}
