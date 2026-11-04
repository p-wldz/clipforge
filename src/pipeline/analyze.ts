import path from 'node:path';
import { readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Store, type Highlight } from '../core/db.js';
import { stableId,artifactDir,loadConfig,newId } from '../core/paths.js';
import { probe,frames,audioEvents,saveJson } from './media.js';
import { candidates } from './highlights.js';
import { classifySound } from './sound-classifier.js';
import { inspectAudio } from './audio-signals.js';
import { transcribe } from './transcribe.js';
import { understandClip } from '../agents/agent.js';
import { selectFrames } from './frame-selection.js';
import { suggestFilm } from '../agents/montage.js';
import type { AgentTrace } from '../agents/agent.js';
const extensions=new Set(['.mp4','.mkv','.mov','.webm']);
export async function analyze(root:string,input:string,options:{withAgent:boolean;force:boolean;provider?:'codex'|'claude'|'cursor'|'deepseek'},onProgress:(line:string)=>void=console.log) {
  const config=await loadConfig(root),provider=options.withAgent?(options.provider??config.aiStages?.clipAnalysis.provider??config.agent.provider):'none';
  if(options.withAgent&&provider==='none')throw new Error('No agent selected. Run clipforge agent codex or use --agent codex');
  if(provider==='cursor')throw new Error('Cursor analysis adapter is not implemented. Choose codex, claude or deepseek.');
  const db=new Store(root),runId=newId();let processed=0,analyzed=0,failedFiles=0;
  try {
    const stat=await import('node:fs/promises').then(fs=>fs.stat(input));
    const files=stat.isDirectory()?(await readdir(input)).filter(x=>extensions.has(path.extname(x).toLowerCase())).map(x=>path.join(input,x)):[input];
    db.startRun(runId,provider,files.length);
    const context=await readFile(path.join(root,'.clipforge','context.md'),'utf8').catch(()=>config.project.focus);
    function event(stage:string,message:string,clipId:string|null=null,level='info',file:string|null=null){db.progressRun(runId,stage,file);db.addEvent(runId,stage,message,clipId,level);onProgress(`[${stage}] ${message}`);}

    for(const file of files){
      const full=path.resolve(file),id=stableId(full),folder=artifactDir(root,id),name=path.basename(file);
      if(db.clip(id)&&!options.force){event('skip',`${name}: already indexed; --force to reanalyze`,id,'info',name);processed++;db.progressRun(runId,'skip',name,processed);continue;}
      try {
      const stageErrors:Array<{stage:string;message:string;at:string}>=[];
      async function optionalStage<T>(stage:string,task:()=>Promise<T>,fallback:T):Promise<T>{
        try{return await task();}catch(e){const message=(e as Error).message;stageErrors.push({stage,message,at:new Date().toISOString()});event(stage,`${name}: unavailable (${message}); continuing without this signal`,id,'warn',name);return fallback;}
      }
      event('probe',`${name}: inspecting media`,id,'info',name);
      const meta=await probe(full);
      const reasons:string[]=[];
      if(meta.duration<config.analysis.minDurationSeconds)reasons.push(`duration ${meta.duration.toFixed(2)}s below minimum`);
      if(config.analysis.maxDurationSeconds!==null&&meta.duration>config.analysis.maxDurationSeconds)reasons.push(`duration ${meta.duration.toFixed(2)}s exceeds maximum`);
      if(config.analysis.requireAudio&&!meta.hasAudio)reasons.push('audio track required');
      if(reasons.length){const reason=reasons.join('; ');db.saveScan(id,full,meta.duration,meta.hasAudio,'skip',reason);event('filtered',`${name}: ${reason}`,id,'warn',name);onProgress(`FILTERED ${name} (${reason})`);processed++;db.progressRun(runId,'filtered',name,processed);continue;}
      db.saveScan(id,full,meta.duration,meta.hasAudio,'analyze',null);
      event('audio',`${name}: extracting audio activity and peaks`,id,'info',name);
      const activity=await audioEvents(full,meta.duration,meta.hasAudio,config.analysis.minAudioSilenceSeconds);
      const audioSignals=await optionalStage('audio-signals',()=>inspectAudio(full,meta.hasAudio),{windowSeconds:0.1,levels:[],events:[]});
      await saveJson(path.join(folder,'audio-signals.json'),audioSignals);
      event('sound-classifier',`${name}: ${config.soundClassifier.enabled?'running sound classifier':'classifier disabled'}`,id,'info',name);
      const classified=meta.hasAudio?await optionalStage('sound-classifier',()=>classifySound(root,config,full,meta.duration,folder),[]):[];
      if(stageErrors.some(x=>x.stage==='sound-classifier'))await saveJson(path.join(folder,'sound-events.json'),[]);
      event('transcription',`${name}: ${config.transcription.enabled?'transcribing speech':'transcription disabled'}`,id,'info',name);
      const transcript=meta.hasAudio?await optionalStage('transcription',()=>transcribe(config,full,folder),null):null;
      if(stageErrors.some(x=>x.stage==='transcription'))await rm(path.join(folder,'transcript.json'),{force:true}).catch(()=>{});
      const segments=normalizeTranscript(transcript);
      event('frames',`${name}: extracting screenshots every ${config.analysis.frameIntervalSeconds}s`,id,'info',name);
      const pics=await frames(full,path.join(folder,'frames'),config.analysis.frameIntervalSeconds,meta.duration,config.analysis.imageMaxWidth??640);
      db.upsertClip({id,source_path:full,duration:meta.duration,width:meta.width,height:meta.height,analyzed_at:new Date().toISOString(),transcript:transcript?JSON.stringify(transcript):null});
      db.saveTranscriptSegments(id,segments);
      await saveJson(path.join(folder,'metadata.json'),{source:full,...meta});
      await saveJson(path.join(folder,'audio-activity.json'),activity);
      if(transcript)await saveJson(path.join(folder,'transcript.json'),transcript);
      const classifiedWindows=classified.map(e=>({start:Math.max(0,e.start-3),end:Math.min(meta.duration,e.end+4)}));
      const signalWindows=audioSignals.events.map(e=>({start:Math.max(0,e.start-3),end:Math.min(meta.duration,e.end+4)}));
      const transcriptWindows=segments.map(s=>({start:Math.max(0,s.start-2),end:Math.min(meta.duration,s.end+2)}));
      let highlights=candidates(id,meta.duration,[...classifiedWindows,...signalWindows,...transcriptWindows,...activity],config.analysis.maxHighlightsPerClip,config.analysis.highlightDurationSeconds);
      if(provider!=='none'){
        event('llm',`${name}: CALL ${provider}, full clip (${pics.length} extracted frames, ${segments.length} speech segments, ${classified.length} sound events)`,id,'info',name);
        try{
          // Sample frames across the FULL clip so setup and reactions can be understood.
          const max=config.analysis.maxImagesPerClip??8;
          const selection=selectFrames(pics,meta.duration,config.analysis.frameIntervalSeconds,max,[...classified,...audioSignals.events,...segments]);
          event('frames',`${name}: ${selection.length}/${pics.length} JPEG frames selected for AI (max width ${config.analysis.imageMaxWidth??640}px)`,id,'info',name);
          const {analysis,trace}=await understandClip({provider,model:config.aiStages?.clipAnalysis.model??config.agent.model,pricing:config.pricing,workspace:root,folder,images:selection,payload:{project:config.project,context,duration:meta.duration,framesEverySeconds:config.analysis.frameIntervalSeconds,transcript:segments,soundEvents:classified,audioSignals:audioSignals.events},onEvent:msg=>event('llm',`${name}: ${msg}`,id,'info',name)});
          await saveJson(path.join(folder,'clip-analysis.json'),analysis);
          db.saveClipAnalysis(id,runId,provider,'success',analysis,path.join(folder,'ai','trace.json'),null);
          db.saveAiUsage({runId,clipId:id,stage:'clip-analysis',provider,model:trace.model,usage:trace.usage,imageCount:selection.length,apiEquivalentUsd:trace.apiEquivalentUsd,providerReportedUsd:trace.providerReportedUsd,costStatus:trace.costStatus??'unpriced'});
          highlights=analysis.highlights.slice(0,config.analysis.maxHighlightsPerClip).map((h,i):Highlight=>({id:createHash('sha256').update(`${id}:ai:${h.start}:${h.end}:${i}`).digest('hex').slice(0,20),clip_id:id,start:h.start,end:h.end,title:h.title,description:h.reason?`${h.description}\nReason: ${h.reason}`:h.description,score:h.score,status:'pending_review',origin:provider,created_at:new Date().toISOString()}));
          event('llm',`${name}: SUCCESS: ${analysis.title}; ${highlights.length} AI highlights`,id,'info',name);
        }catch(e){const message=(e as Error).message;
          try{const trace=JSON.parse(await readFile(path.join(folder,'ai','trace.json'),'utf8')) as AgentTrace; if(trace.usage)db.saveAiUsage({runId,clipId:id,stage:'clip-analysis',provider,model:trace.model,usage:trace.usage,imageCount:Math.min(pics.length,config.analysis.maxImagesPerClip??8),apiEquivalentUsd:trace.apiEquivalentUsd,providerReportedUsd:trace.providerReportedUsd,costStatus:trace.costStatus??'unpriced'});}catch{/* trace might be missing if agent never started */}
          db.saveClipAnalysis(id,runId,provider,'failed',null,path.join(folder,'ai','trace.json'),message);
          event('llm',`${name}: FAILED: ${message}. Heuristic candidates retained, clearly marked.`,id,'error',name);
        }
      } else{db.saveClipAnalysis(id,runId,'none','skipped',null,null,'Agent analysis not requested. Use --agent codex, claude or deepseek');event('llm',`${name}: SKIPPED (no --agent flag)`,id,'warn',name);}
      if(stageErrors.length)await saveJson(path.join(folder,'stage-errors.json'),stageErrors);
      else await rm(path.join(folder,'stage-errors.json'),{force:true}).catch(()=>{});
      if(options.force)db.clearPendingHighlights(id);
      for(const h of highlights)db.upsertHighlight(h);
      await saveJson(path.join(folder,'highlights.json'),highlights);
      analyzed++;processed++;db.progressRun(runId,'done',name,processed);event('done',`${name}: ${highlights.length} candidates (${highlights[0]?.origin??'none'})${stageErrors.length?`; ${stageErrors.length} nonfatal stage warning(s)`:''}`,id);
      } catch(e) {
        failedFiles++;const message=(e as Error).message;
        db.recordFileFailure(runId,id,full,message);processed++;db.progressRun(runId,'file-error',name,processed);
        event('file-error',`${name}: FAILED (${message}); skipping this file and continuing with the others`,id,'error',name);
      }
    }
    const montageProvider=config.aiStages?.montage.provider??provider;
    if(montageProvider==='codex'||montageProvider==='claude'||montageProvider==='deepseek') {
      event('montage',`Preparing AI proposal for the final movie`);
      try {
        const candidates=db.highlights().filter(h=>h.status!=='rejected');
        const summaries=db.clipAnalyses().filter((a:any)=>a.status==='success');
        if(candidates.length)await suggestFilm(root,montageProvider,config.aiStages?.montage.model??config.agent.model,context,candidates,summaries,msg=>event('montage',msg),runId);
        else event('montage','No AI highlights available; film proposal skipped',null,'warn');
      }catch(e){event('montage',`Film proposal FAILED: ${(e as Error).message}`,null,'error');}
    }
    const warnings=db.runSummary(runId)?.warning_count??0;
    db.finishRun(runId,warnings>0?'completed_with_warnings':'completed');const usage=db.aiUsageSummary(runId);event('usage',`RUN FINISHED · ${usage.calls} AI calls · ${usage.inputTokens} input + ${usage.outputTokens} output tokens · ${usage.imagesSent} images · OPTIONAL pricing estimate ${usage.pricedCalls?('$'+usage.apiEquivalentUsd.toFixed(5)):'unavailable'}${!usage.complete?' (partial; unknown rates or usage)':''}`);return {runId,analyzed,failedFiles,total:files.length,warnings,usage};
  }catch(error){db.finishRun(runId,'failed',(error as Error).message);throw error;}
  finally{db.close();}
}
export function normalizeTranscript(data:unknown):Array<{start:number;end:number;text:string}> {
  const raw=(data && typeof data==='object' && 'segments' in data) ? (data as {segments:unknown}).segments : data;
  if(!Array.isArray(raw))return [];
  return raw.flatMap(x=>{
    if(!x||typeof x!=='object')return [];
    const row=x as Record<string,unknown>;
    if(typeof row.start!=='number'||typeof row.end!=='number'||typeof row.text!=='string'||!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end<=row.start||!row.text.trim())return [];
    return [{start:row.start,end:row.end,text:row.text.trim()}];
  });
}
