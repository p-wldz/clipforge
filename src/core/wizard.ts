import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
export interface InitAnswers {
  name: string;
  description: string;
  focus: string;
  mediaDir: string;
  hasAudio: boolean;
  frameIntervalSeconds: number;
  transcriptionEnabled: boolean;
  maxDurationSeconds: number | null;
  minDurationSeconds: number;
  requireAudio: boolean;
}
export async function initWizard(defaultName: string): Promise<InitAnswers> {
  const rl = createInterface({ input: stdin, output: stdout });
  async function ask(question: string, fallback: string) {
    const value = (await rl.question(`${question} [${fallback}]: `)).trim();
    return value || fallback;
  }
  try {
    const name = await ask('Project name', defaultName);
    const description = await ask('Description', 'Gameplay highlights');
    const focus = await ask(
      'Highlight focus (funny moments, explosions, etc.)',
      'Exciting gameplay moments',
    );
    const mediaDir = await ask('Clips directory', 'clips');
    const hasAudio = (await ask('Clips contain audio? (y/n)', 'y')).toLowerCase().startsWith('y');
    const frameIntervalSeconds = Number(await ask('Screenshot interval in seconds', '3'));
    if (!Number.isFinite(frameIntervalSeconds) || frameIntervalSeconds <= 0)
      throw new Error('Screenshot interval must be positive');
    const maxRaw = await ask('Maximum clip length in seconds (0 = unlimited)', '60');
    const maxDurationSeconds = Number(maxRaw) === 0 ? null : Number(maxRaw);
    const minDurationSeconds = Number(await ask('Minimum clip length in seconds', '0'));
    const requireAudio = (await ask('Skip files without an audio track? (y/n)', 'n'))
      .toLowerCase()
      .startsWith('y');
    const transcriptionEnabled =
      hasAudio &&
      (await ask('Enable transcription? Requires a local Whisper CLI (y/n)', 'n'))
        .toLowerCase()
        .startsWith('y');
    return {
      name,
      description,
      focus,
      mediaDir,
      hasAudio,
      frameIntervalSeconds,
      transcriptionEnabled,
      maxDurationSeconds,
      minDurationSeconds,
      requireAudio,
    };
  } finally {
    rl.close();
  }
}
