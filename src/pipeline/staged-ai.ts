/** Stage boundaries for reusable AI work.  This module deliberately contains no
 * media extraction: understanding can be reused when an editor changes taste. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactDir, workspaceDir, type AgentProvider, type AiProfile, type Config } from '../core/paths.js';
import { Store, type Highlight } from '../core/db.js';
import { getPrompt } from '../agents/prompts.js';
import { runAgentText } from '../agents/agent.js';

export type Observation={start:number;end:number;type:string;description:string;confidence:number;evidence:string[];interpretation?:string};
export type Understanding={clipId:string;summary:string;observations:Observation[];themes:string[];tone:{intensity:number|null;humor:number|null;tension:number|null;voiceActivity:number|null}};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const profileFor=(config:Config,stage:'understanding'|'contextualUnderstanding'|'editing'|'filmDirection'):AiProfile=>
  config.aiStages?.[stage]??(stage==='understanding'?config.aiStages?.clipAnalysis:stage==='filmDirection'?config.aiStages?.montage:undefined)??config.agent;
export async function contexts(root:string,config:Config){
  const fallback={domain:'',editing:config.project.focus,filmDirection:config.project.focus};
  const fromFile=await readFile(path.join(workspaceDir(root),'contexts.json'),'utf8').then(JSON.parse).catch(()=>null);
  return {...fallback,...config.contexts,...(fromFile&&typeof fromFile==='object'?fromFile:{})} as typeof fallback;
}
function parse(text:string,duration:number,clipId:string):Understanding{
  const first=text.indexOf('{'),last=text.lastIndexOf('}'); if(first<0||last<=first)throw new Error('Understanding response contains no JSON object');
  const raw=JSON.parse(text.slice(first,last+1)) as Record<string,unknown>;
  if(typeof raw.summary!=='string'||!Array.isArray(raw.observations))throw new Error('Understanding requires summary and observations');
  const observations=raw.observations.flatMap((x):Observation[]=>{if(!x||typeof x!=='object')return [];const o=x as Record<string,unknown>;if(typeof o.start!=='number'||typeof o.end!=='number'||typeof o.description!=='string'||o.start<0||o.end<=o.start||o.end>duration+.1)return [];return [{start:o.start,end:Math.min(o.end,duration),type:typeof o.type==='string'?o.type.slice(0,60):'observation',description:o.description.slice(0,1200),confidence:typeof o.confidence==='number'?Math.max(0,Math.min(1,o.confidence)):0,evidence:Array.isArray(o.evidence)?o.evidence.filter((e):e is string=>typeof e==='string').slice(0,8):[],...(typeof o.interpretation==='string'?{interpretation:o.interpretation.slice(0,800)}:{})}];});
  if(!observations.length)throw new Error('Understanding contains no valid timestamped observations');
  const tone=raw.tone&&typeof raw.tone==='object'?raw.tone as Record<string,unknown>:{};
  const metric=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?Math.max(0,Math.min(1,x)):null;
  return {clipId,summary:raw.summary.slice(0,5000),observations,themes:Array.isArray(raw.themes)?raw.themes.filter((x):x is string=>typeof x==='string').slice(0,30):[],tone:{intensity:metric(tone.intensity),humor:metric(tone.humor),tension:metric(tone.tension),voiceActivity:metric(tone.voiceActivity)}};
}
export async function baseUnderstanding(root:string,db:Store,input:{clipId:string;duration:number;media:unknown;images:string[];config:Config;runId?:string},onEvent?:(message:string)=>void){
  const profile=profileFor(input.config,'understanding'); if(!['codex','claude','deepseek'].includes(profile.provider))throw new Error('Base understanding requires a configured AI provider');
  const prompt=await getPrompt(root,'understanding-base'); const key=hash({stage:'understanding',prompt,provider:profile,media:input.media});
  const cached=db.stageArtifact(input.clipId,'base',key);if(cached?.status==='success')return {understanding:JSON.parse(cached.payload_json) as Understanding,cached:true};
  const folder=path.join(artifactDir(root,input.clipId),'understanding');await mkdir(folder,{recursive:true});
  const file=path.join(folder,'base.json'),output=path.join(folder,'base-response.txt');
  const request=`${prompt}\n\nReturn ONLY JSON: {summary,observations:[{start,end,type,description,confidence 0..1,evidence:string[],interpretation?:string}],themes:string[],tone:{intensity,humor,tension,voiceActivity}}. Describe the whole clip. Evidence must be visual, transcription, sound-event, audio-signal, or uncertain. Do not select highlights or rank entertainment.\n\nINPUT:\n${JSON.stringify(input.media).slice(0,100000)}\n\nFRAME PATHS:\n${input.images.join('\n')}`;
  await writeFile(path.join(folder,'base-prompt.txt'),request);onEvent?.(`Base understanding: invoking ${profile.provider}`);
  try {const response=await runAgentText(profile.provider as Exclude<AgentProvider,'none'|'cursor'>,profile.model,root,request,output,10*60*1000);const understanding=parse(response,input.duration,input.clipId);await writeFile(file,JSON.stringify(understanding,null,2));db.saveStageArtifact(input.clipId,'base',key,profile.provider,profile.model,'success',file,understanding,null);return {understanding,cached:false};}
  catch(error){db.saveStageArtifact(input.clipId,'base',key,profile.provider,profile.model,'failed',file,null,(error as Error).message);throw error;}
}
export async function contextualUnderstanding(root:string,db:Store,input:{clipId:string;base:Understanding;domain:string;config:Config}){
  const profile=profileFor(input.config,'contextualUnderstanding');if(!['codex','claude','deepseek'].includes(profile.provider))throw new Error('Contextual understanding requires a configured AI provider');
  const prompt=await getPrompt(root,'understanding-contextual');const key=hash({stage:'contextual-understanding',prompt,domain:input.domain,base:input.base,profile});const cached=db.stageArtifact(input.clipId,'contextual',key);if(cached?.status==='success')return JSON.parse(cached.payload_json);
  const folder=path.join(artifactDir(root,input.clipId),'understanding','contexts');await mkdir(folder,{recursive:true});const output=path.join(folder,`${key}.response.txt`),file=path.join(folder,`${key}.json`);
  const request=`${prompt}\n\nDOMAIN CONTEXT:\n${input.domain}\n\nBASE UNDERSTANDING (do not overwrite it):\n${JSON.stringify(input.base)}\n\nReturn only JSON with {summary,interpretations:[{observationIndex,meaning,confidence}]}.`;
  try{const response=await runAgentText(profile.provider as Exclude<AgentProvider,'none'|'cursor'>,profile.model,root,request,output,10*60*1000);const value=JSON.parse(response.slice(response.indexOf('{'),response.lastIndexOf('}')+1));await writeFile(file,JSON.stringify(value,null,2));db.saveStageArtifact(input.clipId,'contextual',key,profile.provider,profile.model,'success',file,value,null);return value;}catch(error){db.saveStageArtifact(input.clipId,'contextual',key,profile.provider,profile.model,'failed',file,null,(error as Error).message);throw error;}
}
export function persistEditingSet(db:Store,context:string,highlights:Highlight[],key:string){db.saveHighlightSet(context,key,highlights);}
