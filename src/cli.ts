#!/usr/bin/env node
import path from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { initWizard } from './core/wizard.js';
import { detectAgents } from './core/providers.js';
import { scanAiModels } from './core/ai-models.js';
import { initWorkspace,loadConfig,saveConfig,workspaceDir,newId } from './core/paths.js';
import { doctor } from './core/doctor.js';
import { setupPlan, applySetup } from './core/setup.js';
import { createInterface } from 'node:readline/promises';
import { Store } from './core/db.js';
import { analyze } from './pipeline/analyze.js';
import { startServer } from './server.js';
import { render } from './pipeline/render.js';
import { ensurePrompts, getPrompt, promptPath, type PromptName } from './agents/prompts.js';
import { smokeTestAgent } from './agents/smoke.js';
import { suggestFilm,latestFilmProposal } from './agents/montage.js';
import { contexts } from './pipeline/staged-ai.js';
const usage=`clipforge-local - local-first gameplay highlights\n\nCommands:\n  init [folder] [--interactive]         Initialize workspace (project questions)\n  doctor [--json]                      Check installed tools (no LLM)\n  setup [--interactive] [--transcription] [--sound-classifier] [--device cpu|cuda|auto] [--scope project|user] [--dry-run] [--yes]  Install missing dependencies with consent\n  usage [run-id]                       Reported token usage, billing observations and optional pricing estimates\n  ai models                            Discover provider model catalogs (access test still required)
  ai set <understanding|contextual|editing|direction|clip|montage> <codex|claude|deepseek|none> [model-id]  Choose agent and model for a stage
  ai test <understanding|contextual|editing|direction|clip|montage>  Make a real model call for a configured stage
  agents                               Detect installed agent CLIs
  agent test [codex|claude|deepseek]             Real AI connection test (uses tokens)
  prompts [list|show <name>]            Inspect editable prompts
  suggest [codex|claude|deepseek]                Generate final film proposal from saved analyses
  agent [none|codex|claude|cursor|deepseek]     Show or change selected agent\n  analyze <file|folder> [--agent [codex|claude|cursor|deepseek]] [--force]  Analyze videos\n  search <phrase> [--json]             Search timestamped transcripts
  skipped [--json]                     List skipped files and reasons
  runs [--json]                        Show recent analysis jobs and errors\n  logs <run-id>                        Show timestamped pipeline/LLM activity\n  highlights [--json]                  List highlight candidates\n  approve <highlight-id>               Mark candidate approved\n  reject <highlight-id>                Mark candidate rejected\n  project <name>                       Create project from approved highlights\n  projects                             List projects\n  render <project-id>                  Render approved project\n  dashboard [--port 4173]              Start local review UI\n\nGlobal option: --root <workspace path>\nConfig: .clipforge/config.json\n`;
const raw=process.argv.slice(2);
function takeOption(name:string){let idx=raw.indexOf(name);if(idx<0)return undefined;let value=raw[idx+1];if(!value||value.startsWith('--'))throw new Error(`${name} requires a value`);raw.splice(idx,2);return value;}
const root=path.resolve(takeOption('--root')??process.cwd());
const initName=takeOption('--name');
const initDescription=takeOption('--description');
const initFocus=takeOption('--focus');
const initClipsDir=takeOption('--clips-dir');
const initFrameInterval=takeOption('--frame-interval');
const initAudio=takeOption('--audio');
const initTranscription=raw.includes('setup')?undefined:takeOption('--transcription');
const initMaxDuration=takeOption('--max-duration');
const initMinDuration=takeOption('--min-duration');
const initRequireAudio=takeOption('--require-audio');
const port=Number(takeOption('--port')??'4173');
const setupDevice=takeOption('--device');
const setupScope=takeOption('--scope');
const cmd=raw.shift();
const agentIndex=raw.indexOf('--agent');
const agentChoice=agentIndex>=0 && ['codex','claude','cursor','deepseek'].includes(raw[agentIndex+1]??'')?raw[agentIndex+1] as 'codex'|'claude'|'cursor'|'deepseek':undefined;
if(agentChoice)raw.splice(agentIndex+1,1);
const flags=new Set(raw.filter(s=>s.startsWith('--')));
const args=raw.filter(x=>!x.startsWith('--'));
async function main(){
  if(cmd==='init'){const destination=path.resolve(args[0]??root);const wizard=flags.has('--interactive')?await initWizard(path.basename(destination)):{};const options={...wizard,...(initName?{name:initName}:{}),...(initDescription?{description:initDescription}:{}),...(initFocus?{focus:initFocus}:{}),...(initClipsDir?{mediaDir:initClipsDir}:{}),...(initFrameInterval?{frameIntervalSeconds:Number(initFrameInterval)}:{}),...(initAudio?{hasAudio:initAudio==='yes'||initAudio==='true'}:{}),...(initTranscription?{transcriptionEnabled:initTranscription==='yes'||initTranscription==='true'}:{}),...(initMaxDuration?{maxDurationSeconds:Number(initMaxDuration)===0?null:Number(initMaxDuration)}:{}),...(initMinDuration?{minDurationSeconds:Number(initMinDuration)}:{}),...(initRequireAudio?{requireAudio:initRequireAudio==='true'||initRequireAudio==='yes'}:{})};console.log('Initialized:',await initWorkspace(destination,options));return;}
  if(!cmd||cmd==='help'||cmd==='--help'){console.log(usage);return;}
  if(!existsSync(workspaceDir(root)))throw new Error(`No workspace in ${root}. Run: clipforge init`);
  switch(cmd){
    case 'ai': {
      if(args[0]==='models') {console.log(JSON.stringify(await scanAiModels(root),null,2));return;}
      const config=await loadConfig(root);
      const stage=({clip:'clipAnalysis',montage:'montage',understanding:'understanding',contextual:'contextualUnderstanding',editing:'editing',direction:'filmDirection'} as Record<string,string>)[args[1]??''];
      if(!stage)throw new Error('Use: clipforge ai models | ai set <understanding|contextual|editing|direction> <provider> [model]');
      if(args[0]==='set'){
        const provider=args[2];
        if(!provider||!['none','codex','claude','deepseek'].includes(provider))throw new Error('Agent must be none, codex, claude or deepseek');
        const current:NonNullable<typeof config.aiStages>=config.aiStages??{};
        current[stage as keyof typeof current]={provider:provider as 'none'|'codex'|'claude'|'deepseek',...(args[3]?{model:args[3]}:{})};
        config.aiStages=current;
        await saveConfig(root,config);
        console.log(JSON.stringify(config.aiStages,null,2));return;
      }
      if(args[0]==='test'){
        const profile=config.aiStages?.[stage as keyof NonNullable<typeof config.aiStages>]??config.agent;
        if(profile.provider!=='codex'&&profile.provider!=='claude'&&profile.provider!=='deepseek')throw new Error('Stage requires Codex, Claude or DeepSeek');
        const result=await smokeTestAgent(root,profile.provider,profile.model);
        console.log(JSON.stringify(result,null,2));if(result.status!=='success')process.exitCode=1;return;
      }
      throw new Error('Unknown ai command');
    }
    case 'prompts': {
      await ensurePrompts(root);
      if(args[0]==='show'){
        const name=args[1] as PromptName;if(!['understanding-base','understanding-contextual','editing-boundary-refinement','clip-analysis','highlight-selection','montage','film-direction','film-regeneration','agent-test'].includes(name))throw new Error('Unknown prompt name');
        console.log(await getPrompt(root,name));
      }else for(const name of ['understanding-base','understanding-contextual','editing-boundary-refinement','clip-analysis','highlight-selection','montage','film-direction','film-regeneration','agent-test'] as PromptName[])console.log(`${name}: ${promptPath(root,name)}`);
      return;
    }
    case 'suggest': {
      const config=await loadConfig(root);
      const provider=(args[0]??config.aiStages?.montage?.provider??config.aiStages?.filmDirection?.provider??config.agent.provider);
      if(provider!=='codex'&&provider!=='claude'&&provider!=='deepseek')throw new Error('Choose Codex, Claude or DeepSeek');
      const db=new Store(root);
      try {
        const items=db.highlights().filter(h=>h.status!=='rejected');
        const summaries=db.clipAnalyses().filter((r:any)=>r.status==='success');
        const context=(await contexts(root,config)).filmDirection;
        console.log(JSON.stringify(await suggestFilm(root,provider,config.aiStages?.montage?.model??config.aiStages?.filmDirection?.model??config.agent.model,context,items,summaries,console.log),null,2));
      }finally{db.close();}
      return;
    }
    case 'agents': {console.log(JSON.stringify(await detectAgents(),null,2));return;}
    case 'agent': {
      if(args[0]==='test'){
        const config=await loadConfig(root);const provider=args[1]??config.agent.provider;
        if(provider!=='codex'&&provider!=='claude'&&provider!=='deepseek')throw new Error('Select Codex, Claude or DeepSeek for a real connection test');
        console.log(`Calling ${provider} (this consumes agent quota)...`);
        const result=await smokeTestAgent(root,provider,config.agent.model);
        console.log(JSON.stringify(result,null,2));if(result.status!=='success')process.exitCode=1;
        return;
      }
      const config=await loadConfig(root);if(args[0]){if(!['none','codex','claude','cursor','deepseek'].includes(args[0]))throw new Error('Agent must be none|codex|claude|cursor|deepseek');config.agent.provider=args[0] as typeof config.agent.provider;await writeFile(path.join(workspaceDir(root),'config.json'),JSON.stringify(config,null,2)+'\n');}console.log(JSON.stringify(config.agent,null,2));return;}
    case 'setup': {
      if(setupScope && !['project','user'].includes(setupScope))throw new Error('--scope must be project or user');
      if(setupDevice && !['cpu','cuda','auto'].includes(setupDevice))throw new Error('--device must be cpu, cuda, or auto');
      const interactive=(flags.has('--interactive') || (!flags.has('--transcription') && !flags.has('--sound-classifier') && !flags.has('--yes') && !flags.has('--dry-run'))) && process.stdin.isTTY;
      let transcription=flags.has('--transcription');
      let soundClassifier=flags.has('--sound-classifier');
      if(interactive){
        const rl=createInterface({input:process.stdin,output:process.stdout});
        try {transcription=(await rl.question('Enable local speech transcription (faster-whisper)? [Y/n] ')).trim().toLowerCase()!=='n';
          soundClassifier=(await rl.question('Enable local sound effects classification (explosions, gunshots, etc.)? [y/N] ')).trim().toLowerCase()==='y';}
        finally{rl.close();}
      }
      const scope=(setupScope??(await loadConfig(root)).toolsScope??'project') as 'project'|'user';
      const report=await setupPlan(root,{transcription,soundClassifier,scope});
      console.log(JSON.stringify(report,null,2));
      if(report.warnings.length)console.warn(report.warnings.join('\n'));
      if(flags.has('--dry-run')||!report.plans.length)return;
      let approved=flags.has('--yes');
      if(!approved){
        if(!process.stdin.isTTY){console.error('Noninteractive setup: use --yes to authorize installation.');process.exitCode=2;return;}
        const rl=createInterface({input:process.stdin,output:process.stdout});
        try {approved=(await rl.question('Install/verify listed dependencies (including model download)? [y/N] ')).trim().toLowerCase()==='y';}
        finally{rl.close();}
      }
      if(!approved){console.log('Installation cancelled');return;}
      await applySetup(root,report,console.log,{device:(setupDevice??'auto') as 'cpu'|'cuda'|'auto',scope});
      console.log('Setup completed. Check: clipforge doctor');
      return;
    }
    case 'doctor': {const result=await doctor(root);console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=1;return;}
    case 'analyze': {const input=path.resolve(args[0]&&!['codex','claude','cursor','deepseek'].includes(args[0])?args[0]:path.join(root,(await loadConfig(root)).mediaDir));const override=agentChoice;const result=await analyze(root,input,{withAgent:flags.has('--agent'),force:flags.has('--force'),provider:override});console.log(JSON.stringify(result));return;}
    case 'search': {if(!args.length)throw new Error('Missing search phrase');const db=new Store(root);try{const hits=db.searchTranscripts(args.join(' '));if(flags.has('--json'))console.log(JSON.stringify(hits,null,2));else hits.forEach(h=>console.log(`${path.basename(h.source_path)} ${h.start.toFixed(1)}-${h.end.toFixed(1)}s: ${h.text}`));}finally{db.close();}return;}
    case 'skipped': {const db=new Store(root);try{console.log(JSON.stringify(db.skipped(),null,2));}finally{db.close();}return;}
    case 'usage': {const db=new Store(root);try{const id=args[0]??(db.runs() as Array<{id:string}>)[0]?.id;const summary=db.aiUsageSummary(id);console.log(JSON.stringify({runId:id??null,summary,calls:db.aiUsage(id),balanceChanges:id?db.balanceChanges(id):[],note:'Pricing-based values are estimates, not bills. DeepSeek balance changes are account-wide, not proof of run cost.'},null,2));}finally{db.close();}return;}
    case 'runs': {const db=new Store(root);try{console.log(JSON.stringify(db.runs(),null,2));}finally{db.close();}return;}
    case 'logs': {const db=new Store(root);try{const runs=db.runs() as Array<{id:string}>;const id=args[0]??runs[0]?.id;if(!id)throw new Error('No analysis runs found');const logs=db.events(id) as Array<{at:string;level:string;stage:string;message:string}>;for(const e of logs)console.log(`${e.at} [${e.level}] [${e.stage}] ${e.message}`);}finally{db.close();}return;}
    case 'highlights': {const db=new Store(root);try{const items=db.highlights();if(flags.has('--json'))console.log(JSON.stringify(items,null,2));else items.forEach(h=>console.log(`${h.id} [${h.status}] ${h.start}-${h.end}s score=${h.score} ${h.title}`));}finally{db.close();}return;}
    case 'approve':case 'reject': {if(!args[0])throw new Error('Missing highlight ID');const db=new Store(root);try{console.log(JSON.stringify(db.updateHighlight(args[0],{status:cmd==='approve'?'approved':'rejected'}),null,2));}finally{db.close();}return;}
    case 'project': {if(!args[0])throw new Error('Missing project name');const db=new Store(root);try{const ids=db.highlights('approved').map(h=>h.id);if(!ids.length)throw new Error('No approved highlights');const id=newId();db.createProject(id,args.join(' '),ids);console.log(`Created ${id} with ${ids.length} highlights`);}finally{db.close();}return;}
    case 'projects': {const db=new Store(root);try{console.log(JSON.stringify(db.projects(),null,2));}finally{db.close();}return;}
    case 'render': {if(!args[0])throw new Error('Missing project ID');console.log('Rendered:',await render(root,args[0]));return;}
    case 'dashboard': {if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Invalid port');startServer(root,port);return;}
    default: throw new Error(`Unknown command: ${cmd}\n${usage}`);
  }
}
main().catch(e=>{console.error('Error:',(e as Error).message);process.exitCode=1});
