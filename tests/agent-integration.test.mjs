import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initWorkspace } from '../dist/core/paths.js';
import { codexTextArgs } from '../dist/agents/agent.js';
import { smokeTestAgent } from '../dist/agents/smoke.js';
import { suggestFilm, latestFilmProposal } from '../dist/agents/montage.js';

test('Codex text calls rely on prompt JSON plus the stage parser, not a generic output schema', () => {
  assert.deepEqual(codexTextArgs('gpt-5.3-codex', 'response.json'), [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    'gpt-5.3-codex',
    '-o',
    'response.json',
    '-',
  ]);
});

test(
  'mock Codex subprocess smoke test and montage proposal end-to-end',
  { skip: process.platform === 'win32' },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-agent-'));
    const originalPath = process.env.PATH;
    try {
      await initWorkspace(root);
      const bin = path.join(root, 'fake-bin');
      await mkdir(bin);
      const command = path.join(bin, 'codex');
      const source = `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);if(args.includes('--output-schema'))process.exit(42);const output=args[args.indexOf('-o')+1];let s='';process.stdin.on('data',b=>s+=b.toString());process.stdin.on('end',()=>{const answer=s.includes('connectivity test')?{ok:true,message:'Clipforge agent connection works'}:{title:'HLL epic finale',description:'Three surprising plays',concept:'Comedy to action',openingHook:'Voice chat',ending:'Explosion',estimatedDurationSeconds:20,sequence:[{highlightId:'highlight-1',reason:'Great reaction'}]};fs.writeFileSync(output,JSON.stringify(answer));});`;
      await writeFile(command, source, { mode: 0o755 });
      process.env.PATH = bin + path.delimiter + originalPath;
      const tested = await smokeTestAgent(root, 'codex');
      assert.equal(tested.status, 'success', tested.error);
      const proposed = await suggestFilm(
        root,
        'codex',
        undefined,
        'Find funny moments',
        [
          {
            id: 'highlight-1',
            clip_id: 'clip-1',
            title: 'Funny explosion',
            description: 'Boom',
            start: 1,
            end: 4,
            score: 90,
            origin: 'codex',
          },
        ],
        [],
        () => {},
      );
      assert.equal(proposed.sequence[0].highlightId, 'highlight-1');
      assert.equal((await latestFilmProposal(root)).proposal.title, 'HLL epic finale');
      assert.match(
        await readFile(path.join(root, '.clipforge', 'agent-tests', 'latest.json'), 'utf8'),
        /success/,
      );
    } finally {
      process.env.PATH = originalPath;
      await rm(root, { recursive: true, force: true });
    }
  },
);
