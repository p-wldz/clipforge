import os from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkTool, run } from './process.js';
import { loadConfig, saveConfig, workspaceDir } from './paths.js';

export type Platform = 'win32'|'darwin'|'linux';
export type InstallPlan = {kind:'ffmpeg'|'transcription'|'sound-classifier'; description:string; command:string; args:string[]; requiresElevation:boolean; note?:string};
export type SetupReport = {platform:string; packageManager:string|null; plans:InstallPlan[]; warnings:string[]};

const packageManagers: Record<Platform,{name:string; command:string; args:string[]; elevated:boolean}[]> = {
  win32: [
    {name:'winget',command:'winget',args:['install','--id','Gyan.FFmpeg','--exact','--accept-package-agreements','--accept-source-agreements'],elevated:false},
    {name:'choco',command:'choco',args:['install','ffmpeg','-y'],elevated:true},
    {name:'scoop',command:'scoop',args:['install','ffmpeg'],elevated:false}
  ],
  darwin: [{name:'brew',command:'brew',args:['install','ffmpeg'],elevated:false}],
  linux: [
    {name:'apt-get',command:'sudo',args:['apt-get','install','-y','ffmpeg'],elevated:true},
    {name:'dnf',command:'sudo',args:['dnf','install','-y','ffmpeg'],elevated:true},
    {name:'pacman',command:'sudo',args:['pacman','-S','--noconfirm','ffmpeg'],elevated:true},
    {name:'zypper',command:'sudo',args:['zypper','--non-interactive','install','ffmpeg'],elevated:true},
    {name:'apk',command:'sudo',args:['apk','add','ffmpeg'],elevated:true}
  ]
};

export async function detectPython():Promise<{command:string; prefix:string[]}|null>{
  const candidates = process.platform==='win32' ? [{command:'py',prefix:['-3']},{command:'python',prefix:[]},{command:'python3',prefix:[]}] : [{command:'python3',prefix:[]},{command:'python',prefix:[]}];
  for(const candidate of candidates){
    const status=await checkTool(candidate.command,[...candidate.prefix,'-c','import sys; print(sys.version_info.major)']);
    if(status.installed && status.version?.trim()==='3')return candidate;
  }
  return null;
}

export type ToolsScope='project'|'user';
export function toolRoot(root:string,scope?:ToolsScope):string{
  let chosen=scope;
  if(!chosen){try{chosen=JSON.parse(readFileSync(path.join(workspaceDir(root),'config.json'),'utf8')).toolsScope;}catch{}}
  return chosen==='user'?path.join(os.homedir(),'.clipforge','tools'):path.join(workspaceDir(root),'tools');
}
export function venvPython(root:string,platform=process.platform,scope?:ToolsScope):string{
  return path.join(toolRoot(root,scope),'python',platform==='win32'?'Scripts':'bin',platform==='win32'?'python.exe':'python');
}

export async function setupPlan(root:string, options:{ffmpeg?:boolean;transcription?:boolean;soundClassifier?:boolean;scope?:ToolsScope}={}):Promise<SetupReport>{
  const platform=process.platform;
  const warnings:string[]=[];
  const plans:InstallPlan[]=[];
  let packageManager:string|null=null;
  if(options.ffmpeg!==false){
    const ffmpeg=await checkTool('ffmpeg');const ffprobe=await checkTool('ffprobe');
    if(!ffmpeg.installed||!ffprobe.installed){
      const candidates=packageManagers[platform as Platform]??[];
      for(const candidate of candidates){
        if((await checkTool(candidate.name,['--version'])).installed){
          packageManager=candidate.name;
          plans.push({kind:'ffmpeg',description:'Install FFmpeg and ffprobe',command:candidate.command,args:candidate.args,requiresElevation:candidate.elevated,note:'A new terminal or PATH refresh may be needed after installation.'});break;
        }
      }
      if(!packageManager)warnings.push(`No supported package manager detected on ${platform}. Install FFmpeg manually and ensure ffmpeg/ffprobe are on PATH.`);
    }
  }
  if(options.transcription){
    const existing=await checkTool(venvPython(root,process.platform,options.scope),['-c','import faster_whisper; print("ready")']);
    if(existing.installed){
      plans.push({kind:'transcription',description:'Verify existing local Whisper and configure the selected execution device',command:venvPython(root,process.platform,options.scope),args:[],requiresElevation:false,note:'Reuses the existing environment; runs a real inference smoke test.'});
    } else {
      const py=await detectPython();
      if(!py)warnings.push('Python 3 not found. Install Python 3 with venv support first, then rerun clipforge setup --transcription.');
      else plans.push({kind:'transcription',description:'Create isolated project Python environment and install faster-whisper',command:py.command,args:[...py.prefix,'-m','venv',path.join(toolRoot(root,options.scope),'python')],requiresElevation:false,note:'Models download on first transcription. Python package dependencies may need network access.'});
    }
  }
  if(options.soundClassifier){
    const existing=await checkTool(classifierPython(root,process.platform,options.scope),['-c','import torch, torchaudio, transformers, numpy; print("ready")']);
    if(existing.installed)plans.push({kind:'sound-classifier',description:'Verify AST audio classifier and download model if necessary',command:classifierPython(root,process.platform,options.scope),args:[],requiresElevation:false,note:'Runs CPU inference test; model is cached locally (approx. 350MB plus dependencies).'});
    else {
      const py=await detectPython();
      if(!py)warnings.push('Python 3 not found. Install Python 3 (3.11+ preferred) and rerun setup.');
      else plans.push({kind:'sound-classifier',description:'Install independent AST sound-event classifier environment',command:py.command,args:[...py.prefix,'-m','venv',path.join(toolRoot(root,options.scope),'sound-classifier')],requiresElevation:false,note:'CPU PyTorch dependencies are large and require internet access. Downloads and model load may take time.'});
    }
  }
  return {platform:os.platform(),packageManager,plans,warnings};
}

export function classifierPython(root:string,platform=process.platform,scope?:ToolsScope):string{
  return path.join(toolRoot(root,scope),'sound-classifier',platform==='win32'?'Scripts':'bin',platform==='win32'?'python.exe':'python');
}

export type TranscriptionDevice = 'cpu' | 'cuda' | 'auto';
export type SetupChoices = {device?:TranscriptionDevice; model?:string; scope?:ToolsScope};
export function chooseTranscriptionDevice(requested:TranscriptionDevice, cudaReady:boolean):'cpu'|'cuda'{
  return requested==='cpu' ? 'cpu' : cudaReady ? 'cuda' : 'cpu';
}
const classifierScript = fileURLToPath(new URL('../../tools/classify_sound_ast.py',import.meta.url));
const workerScript = fileURLToPath(new URL('../../tools/transcribe_faster_whisper.py',import.meta.url));
async function inferenceSmokeTest(python:string,device:'cpu'|'cuda',log:(line:string)=>void){
  log(`Testing local speech inference on ${device.toUpperCase()} (downloads the tiny model once if absent)...`);
  await run(python,[workerScript,'--self-test','--model','tiny','--device',device],{timeoutMs:15*60*1000});
}
export async function applySetup(root:string,report:SetupReport,log:(line:string)=>void=console.log,choices:SetupChoices={}){

  for(const plan of report.plans){
    log(`Installing: ${plan.description}`);
    if(plan.kind==='transcription'){
      const python=venvPython(root,process.platform,choices.scope);
      const hasEnv=(await checkTool(python,['-c','import sys;print(sys.executable)'])).installed;
      if(!hasEnv){
        await mkdir(toolRoot(root,choices.scope),{recursive:true});
        await run(plan.command,plan.args,{timeoutMs:120000});
      }
      // Fixed dependency versions avoid the PyAV metadata_errors regression.
      await run(python,['-m','pip','install','faster-whisper==1.2.1','av==18.1.0'],{timeoutMs:20*60*1000});
      const status=await checkTool(python,['-c','import faster_whisper, av; print(av.__version__)']);
      if(!status.installed)throw new Error('faster-whisper/PyAV verification failed after installation');
      const requested=choices.device??'auto';
      let cudaReady=false;
      if(requested!=='cpu'){
        const nvidia=await checkTool('nvidia-smi',['-L']);
        if(nvidia.installed){
          try {await inferenceSmokeTest(python,'cuda',log);cudaReady=true;}
          catch(e){log(`GPU transcription unavailable (${(e as Error).message.slice(-240)}). Falling back to CPU.`);}
        } else log('No NVIDIA GPU detected; using CPU.');
      }
      const device=chooseTranscriptionDevice(requested,cudaReady);
      // A real inference test catches CUDA DLL errors that simple imports do not.
      if(device==='cpu')await inferenceSmokeTest(python,'cpu',log);
      const config=await loadConfig(root);
      config.toolsScope=choices.scope??config.toolsScope;
      config.transcription={...config.transcription,enabled:true,provider:'faster-whisper',command:python,device,model:choices.model??config.transcription.model??'small'};
      await saveConfig(root,config);
      log(`Transcription ready: ${device}, ${config.transcription.model}, ${python}`);
    } else if(plan.kind==='sound-classifier'){
      const python=classifierPython(root,process.platform,choices.scope);
      if(!(await checkTool(python,['-c','import sys; print(sys.executable)'])).installed){
        await mkdir(toolRoot(root,choices.scope),{recursive:true});
        await run(plan.command,plan.args,{timeoutMs:120000});
      }
      log('Installing CPU PyTorch and torchaudio (separate from Whisper)...');
      await run(python,['-m','pip','install','torch','torchaudio','--index-url','https://download.pytorch.org/whl/cpu'],{timeoutMs:30*60*1000});
      await run(python,['-m','pip','install','transformers==4.57.1','numpy','safetensors'],{timeoutMs:20*60*1000});
      log('Downloading/verifying AST model and running a synthetic audio inference test...');
      const config=await loadConfig(root);
      const model=config.soundClassifier.model;
      await run(python,[classifierScript,'--self-test','--model',model],{timeoutMs:25*60*1000});
      config.toolsScope=choices.scope??config.toolsScope;
      config.soundClassifier={...config.soundClassifier,enabled:true,command:python};
      await saveConfig(root,config);
      log(`Sound event classifier ready: ${model} (CPU)`);
    } else {
      await run(plan.command,plan.args,{timeoutMs:20*60*1000});
      const status=await checkTool('ffmpeg');
      if(status.installed)log('FFmpeg verified on PATH');
      else log('FFmpeg installer finished. Restart the terminal if ffmpeg is not yet on PATH.');
    }
  }
}
