import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspaceDir } from '../core/paths.js';
import { runAgentText } from './agent.js';
import { getPrompt } from './prompts.js';
export async function smokeTestAgent(root:string,provider:'codex'|'claude'|'deepseek',model?:string){
  const dir=path.join(workspaceDir(root),'agent-tests');await mkdir(dir,{recursive:true});
  const prompt=await getPrompt(root,'agent-test');const now=new Date().toISOString().replace(/[:.]/g,'-');
  const responseFile=path.join(dir,`${now}-${provider}-response.txt`),start=Date.now();
  const result:{provider:string;status:'success'|'failed';durationMs:number;responseFile:string;response?:string;error?:string}={provider,status:'failed',durationMs:0,responseFile};
  try{
    const answer=await runAgentText(provider,model,root,prompt,responseFile,90000);
    result.response=answer.slice(0,4000);
    const parsed=JSON.parse(answer.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) as {ok?:unknown};
    if(parsed.ok!==true)throw new Error('Agent did not return expected {ok:true} JSON');
    result.status='success';
  }catch(e){result.error=(e as Error).message;}
  finally{result.durationMs=Date.now()-start;await writeFile(path.join(dir,'latest.json'),JSON.stringify(result,null,2)+'\n');}
  return result;
}
