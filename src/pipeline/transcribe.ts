import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { run } from '../core/process.js';
import { fileURLToPath } from 'node:url';
import type { Config } from '../core/paths.js';
export async function transcribe(config:Config,file:string,artifact:string) {
  if(!config.transcription.enabled)return null;
  // An external executable is explicitly configured; never evaluate a shell string.
  if(config.transcription.provider==='faster-whisper'){
    const script=fileURLToPath(new URL('../../tools/transcribe_faster_whisper.py',import.meta.url));
    const output=path.join(artifact,'transcript.json');
    await run(config.transcription.command,[script,'--input',file,'--output',output,'--model',config.transcription.model??'small','--device',config.transcription.device??'cpu'],{timeoutMs:30*60*1000});
    return JSON.parse(await readFile(output,'utf8')) as unknown;
  }
  const args=config.transcription.args.map(s=>s.replaceAll('{input}',file).replaceAll('{outputDir}',artifact));
  await run(config.transcription.command,args,{timeoutMs:30*60*1000});
  const json=path.join(artifact,path.parse(file).name+'.json');
  try {return JSON.parse(await readFile(json,'utf8')) as unknown;}catch{throw new Error(`Transcription finished but expected JSON missing: ${json}. Check your provider's output layout.`)}
}
