import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { codexModelCatalog } from '../dist/core/codex-models.js';
test('Codex models are fetched via app-server RPC with default and modalities', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-model-list-'));
  const file = path.join(dir, 'mock.mjs');
  try {
    await writeFile(
      file,
      `import readline from 'node:readline';for await(const line of readline.createInterface({input:process.stdin})){const x=JSON.parse(line);if(x.method==='initialize')process.stdout.write(JSON.stringify({id:1,result:{}})+'\\n');if(x.method==='model/list')process.stdout.write(JSON.stringify({id:2,result:{data:[{model:'codex-test',displayName:'Codex Test',inputModalities:['text','image'],isDefault:true}],nextCursor:null}})+'\\n');}`,
    );
    const models = await codexModelCatalog({
      command: process.execPath,
      args: [file],
      timeoutMs: 3000,
    });
    assert.deepEqual(models, [
      {
        id: 'codex-test',
        label: 'Codex Test',
        inputModalities: ['text', 'image'],
        isDefault: true,
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
