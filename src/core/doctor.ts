import { classifierPython } from './setup.js';
import { checkTool } from './process.js';
import { detectAgents } from './providers.js';
import { loadConfig } from './paths.js';
export async function doctor(root:string) {
  const config=await loadConfig(root);
  const tools = await Promise.all([
    checkTool('ffmpeg'),checkTool('ffprobe'),
    ...(config.soundClassifier.enabled?[checkTool(config.soundClassifier.command||classifierPython(root),['-c','import torch, torchaudio, transformers;print("classifier ready")'])]:[]),
    ...(config.transcription.enabled?[config.transcription.provider==='faster-whisper' ? checkTool(config.transcription.command,['-c','import faster_whisper; print("faster-whisper available")']) : checkTool(config.transcription.command,['--help'])]:[])
  ]);
  const labels=['ffmpeg','ffprobe',...(config.soundClassifier.enabled?['soundClassifier']:[]),...(config.transcription.enabled?['transcription']:[])];
  return {node:process.version,provider:config.agent.provider,tools:{...Object.fromEntries(labels.map((x,i)=>[x,tools[i]])),...await detectAgents()},ready:!!tools[0]?.installed&&!!tools[1]?.installed&&(!config.soundClassifier.enabled||!!tools[2]?.installed)&&(!config.transcription.enabled||!!tools[config.soundClassifier.enabled?3:2]?.installed)};
}
