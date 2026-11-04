import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getPrompt } from './prompts.js';
import { runAgentText } from './agent.js';
import type { AgentProvider } from '../core/paths.js';
import { workspaceDir } from '../core/paths.js';
import { Store } from '../core/db.js';
import { estimateApiEquivalent, type TokenUsage } from '../core/usage.js';
import {validTransition,type Transition} from '../pipeline/edit-plan.js';

export interface FilmProposal {
  title:string; description:string; concept:string; openingHook:string;
  estimatedDurationSeconds:number; sequence:Array<{highlightId:string;reason:string;transition?:Transition;transitionDuration?:number}>;
  ending:string;
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseFilmProposal(raw:string,ids:Set<string>):FilmProposal {
  let parsed:unknown;
  try{parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
  catch{const first=raw.indexOf('{'),last=raw.lastIndexOf('}');if(first<0||last<first)throw new Error('Montage proposal is not JSON');parsed=JSON.parse(raw.slice(first,last+1));}
  if(!obj(parsed)||!['title','description','concept','openingHook','ending'].every(k=>typeof parsed[k]==='string')||!Array.isArray(parsed.sequence))throw new Error('Malformed montage proposal');
  const sequence=parsed.sequence.filter(obj).filter(s=>typeof s.highlightId==='string'&&ids.has(s.highlightId)&&typeof s.reason==='string').map(s=>({highlightId:s.highlightId as string,reason:(s.reason as string).slice(0,1000),...(validTransition(s.transition)?{transition:s.transition}:{}),...(typeof s.transitionDuration==='number'&&Number.isFinite(s.transitionDuration)?{transitionDuration:Math.min(1.5,Math.max(0.1,s.transitionDuration))}:{})}));
  if(!sequence.length)throw new Error('Montage proposal does not reference valid highlight IDs');
  const unique=[...new Map(sequence.map(s=>[s.highlightId,s])).values()];
  return {title:(parsed.title as string).slice(0,180),description:(parsed.description as string).slice(0,3000),concept:(parsed.concept as string).slice(0,3000),openingHook:(parsed.openingHook as string).slice(0,1000),ending:(parsed.ending as string).slice(0,1000),estimatedDurationSeconds:typeof parsed.estimatedDurationSeconds==='number'&&Number.isFinite(parsed.estimatedDurationSeconds)?Math.max(0,parsed.estimatedDurationSeconds):0,sequence:unique};
}
export async function suggestFilm(root:string,provider:Exclude<AgentProvider,'none'|'cursor'>,model:string|undefined,context:string,items:Array<{id:string;clip_id:string;title:string;description:string;start:number;end:number;score:number;origin:string}>,summaries:unknown,onEvent?:(msg:string)=>void,runId?:string,regenerationGuidance=''){
  if(!items.length)throw new Error('No highlight candidates available for a film proposal');
  const folder=path.join(workspaceDir(root),'projects','suggestions');await mkdir(folder,{recursive:true});
  const instructions=await getPrompt(root,'montage');
  const direction=await getPrompt(root,'film-direction');
  const previous=await latestFilmProposal(root);
  const regenerate=previous?.proposal?await getPrompt(root,'film-regeneration'):'';
  if(regenerationGuidance.length>3000)throw new Error('Regeneration guidance is too long');
  const required=`Return only JSON with: title, description, concept, openingHook, estimatedDurationSeconds (number), sequence (array of {highlightId,reason,transition,transitionDuration}), ending. Every transition must be an incoming transition and one of cut, fade, fadeblack, wipeleft, wiperight, slideleft, slideright, circleopen, with duration 0.1-1.5 seconds. Prefer clean cuts; never suggest a transition between overlapping or adjacent selections from the same source. Avoid selecting multiple overlapping highlights from one original clip; prefer the complete narrative. Use rich clip editorial profiles to balance humor, tension, speech and action. Every highlightId MUST be one of the provided IDs. Prefer between 2 and 12 items. Do not approve highlights or render.`;
  const prompt=`${instructions}\n\n${previous?.proposal?`REGENERATION INSTRUCTIONS:\n${regenerate}\n\nPREVIOUS PROPOSAL:\n${JSON.stringify(previous.proposal).slice(0,12000)}\n\nUSER REQUEST FOR THIS REGENERATION:\n${regenerationGuidance||'Improve pacing, narrative and variety.'}\n\n`:''}FILM DIRECTION GUIDELINES:\n${direction}\n\n${required}\n\nPROJECT CONTEXT:\n${context.slice(0,15000)}\n\nCLIP SUMMARIES:\n${JSON.stringify(summaries).slice(0,25000)}\n\nHIGHLIGHTS:\n${JSON.stringify(items).slice(0,50000)}`;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const promptFile=path.join(folder,`${stamp}-prompt.txt`),responseFile=path.join(folder,`${stamp}-response.txt`);
  await writeFile(promptFile,prompt);
  onEvent?.(`CALL ${provider}: planning final video from ${items.length} highlights`);
  let usage:TokenUsage|null=null,providerReportedUsd:number|null=null;
  const response=await runAgentText(provider,model,root,prompt,responseFile,3*60*1000,(value,reported)=>{usage=value;providerReportedUsd=reported??null;});
  const config=await import('../core/paths.js').then(m=>m.loadConfig(root));
  const billedModel=provider==='deepseek'?(model||'deepseek-flash'):model;
  const estimate=estimateApiEquivalent(provider,billedModel,usage,config.pricing);
  const store=new Store(root);try{store.saveAiUsage({runId,stage:'montage',provider,model:billedModel,usage,apiEquivalentUsd:estimate.usd,providerReportedUsd,costStatus:estimate.status});}finally{store.close();}
  onEvent?.(`Usage: ${usage?JSON.stringify(usage):'not reported'}, API equivalent ${estimate.usd===null?'unavailable':'$'+estimate.usd.toFixed(5)}`);
  await writeFile(responseFile,response);
  const proposal=parseFilmProposal(response,new Set(items.map(x=>x.id)));
  await writeFile(path.join(folder,'latest.json'),JSON.stringify({provider,createdAt:new Date().toISOString(),proposal,promptFile,responseFile,regenerationGuidance,editedAt:null},null,2));
  onEvent?.(`SUCCESS: film proposal '${proposal.title}' with ${proposal.sequence.length} highlights`);
  return proposal;
}
export async function latestFilmProposal(root:string){return JSON.parse(await readFile(path.join(workspaceDir(root),'projects','suggestions','latest.json'),'utf8').catch(()=>'null')) as {proposal:FilmProposal;provider:string;createdAt:string}|null;}

/** Persist a human-edited transition plan without editing the model's raw response. */
export async function updateFilmProposal(root:string,createdAt:string,edits:Array<{highlightId:string;transition:string;transitionDuration:number}>){
  const file=path.join(workspaceDir(root),'projects','suggestions','latest.json');
  const current=await latestFilmProposal(root);
  if(!current||current.createdAt!==createdAt)throw new Error('Suggestion changed; reload before editing transitions');
  if(!Array.isArray(edits)||edits.length!==current.proposal.sequence.length)throw new Error('Expected one transition for each suggested highlight');
  for(let i=0;i<edits.length;i++){
    const edit=edits[i]!,original=current.proposal.sequence[i]!;
    if(edit.highlightId!==original.highlightId||!validTransition(edit.transition)||!Number.isFinite(edit.transitionDuration)||edit.transitionDuration<0.1||edit.transitionDuration>1.5)throw new Error('Invalid transition edit');
  }
  const proposal={...current.proposal,sequence:current.proposal.sequence.map((item,i)=>({...item,transition:i===0?'cut':edits[i]!.transition as Transition,transitionDuration:edits[i]!.transitionDuration}))};
  const updated={...current,proposal,editedAt:new Date().toISOString()};
  await writeFile(file,JSON.stringify(updated,null,2));
  return updated;
}
