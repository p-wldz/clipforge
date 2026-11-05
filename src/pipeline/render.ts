import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { run } from '../core/process.js';
import { Store } from '../core/db.js';
import { rendersDir } from '../core/paths.js';
import { normalizeEditPlan, transitionGraph } from './edit-plan.js';
import { probe } from './media.js';
export { audioTempoFilter } from './tempo.js';
import { audioTempoFilter } from './tempo.js';

export async function render(root: string, projectId: string) {
  const db = new Store(root);
  try {
    const original = db.projectItems(projectId);
    if (!original.length) throw new Error('Project is empty');
    if (
      original.some((h) => h.status !== 'approved') &&
      !db.projectProposal(projectId) &&
      db.editorProject(projectId)?.origin === 'legacy'
    )
      throw new Error('All project highlights must be approved before render');
    const plan = normalizeEditPlan(original);
    const outputDir = path.join(rendersDir(root), projectId);
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, 'edit-plan.json'),
      JSON.stringify(
        {
          originalItems: original.length,
          renderedSegments: plan.length,
          segments: plan,
        },
        null,
        2,
      ),
    );
    const segments: string[] = [],
      durations: number[] = [];
    for (let i = 0; i < plan.length; i++) {
      const h = plan[i]!;
      const speed = h.speed;
      const out = path.join(outputDir, `segment-${String(i).padStart(3, '0')}.mp4`);
      await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          String(h.start),
          '-i',
          h.source_path,
          '-t',
          String(h.end - h.start),
          '-vf',
          `setpts=(PTS-STARTPTS)/${speed},scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuv420p',
          '-af',
          audioTempoFilter(speed),
          '-c:a',
          'aac',
          '-ar',
          '48000',
          '-ac',
          '2',
          out,
        ],
        { timeoutMs: 20 * 60 * 1000 },
      );
      segments.push(out);
      durations.push((await probe(out)).duration);
    }
    const final = path.join(outputDir, 'final.mp4');
    const hasEffects = plan.some((h, i) => i > 0 && h.transition && h.transition !== 'cut');
    if (hasEffects) {
      const graph = transitionGraph(durations, plan);
      // Check filters rather than assuming all custom FFmpeg builds include them.
      const filters = await run('ffmpeg', ['-hide_banner', '-filters']);
      if (
        !/\bxfade\b/.test(String(filters.stdout)) ||
        !/\bacrossfade\b/.test(String(filters.stdout))
      )
        throw new Error(
          'FFmpeg was built without xfade/acrossfade. Choose hard cuts or install a full FFmpeg build.',
        );
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...segments.flatMap((s) => ['-i', s]),
        '-filter_complex',
        graph.filters,
        '-map',
        `[${graph.video}]`,
        '-map',
        `[${graph.audio}]`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        final,
      ];
      await run('ffmpeg', args, { timeoutMs: 40 * 60 * 1000 });
    } else {
      const concat = path.join(outputDir, 'concat.txt');
      await writeFile(
        concat,
        segments.map((s) => `file '${path.basename(s).replaceAll("'", "'\\''")}'`).join('\n') +
          '\n',
      );
      await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concat,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          final,
        ],
        { timeoutMs: 20 * 60 * 1000 },
      );
    }
    return final;
  } finally {
    db.close();
  }
}
