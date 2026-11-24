import { classifierPython, detectPython, venvPython } from './setup.js';
import { checkTool } from './process.js';
import { detectAgents } from './providers.js';
import { loadConfig } from './paths.js';
export async function doctor(root: string) {
  const config = await loadConfig(root);
  const python = await detectPython();
  const [ffmpeg, ffprobe, transcription, soundClassifier] = await Promise.all([
    checkTool('ffmpeg'),
    checkTool('ffprobe'),
    checkTool(venvPython(root), ['-c', 'import faster_whisper; print("faster-whisper available")']),
    checkTool(classifierPython(root), [
      '-c',
      'import torch, torchaudio, transformers;print("classifier ready")',
    ]),
  ]);
  const pythonTool = python
    ? await checkTool(python.command, [...python.prefix, '--version'])
    : { installed: false, error: 'Python 3 not found' };
  return {
    node: process.version,
    provider: config.agent.provider,
    tools: {
      ffmpeg,
      ffprobe,
      python: pythonTool,
      transcription,
      soundClassifier,
      ...(await detectAgents()),
    },
    optional: {
      transcription: {
        enabled: config.transcription.enabled,
        installed: transcription.installed,
        setup: 'clipforge setup --transcription',
      },
      soundClassifier: {
        enabled: config.soundClassifier.enabled,
        installed: soundClassifier.installed,
        setup: 'clipforge setup --sound-classifier',
      },
      all: 'clipforge setup all',
    },
    ready:
      ffmpeg.installed &&
      ffprobe.installed &&
      (!config.soundClassifier.enabled || soundClassifier.installed) &&
      (!config.transcription.enabled || transcription.installed),
  };
}
