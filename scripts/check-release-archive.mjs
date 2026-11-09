import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const entries = await readdir('release', { withFileTypes: true });
const folder = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('clipforge-'))?.name;
if (!folder) throw new Error('No portable archive directory found. Run npm run release:archive first.');
const command = process.platform === 'win32' ? join('release', folder, 'clipforge.cmd') : join('release', folder, 'clipforge');
const result = spawnSync(command, ['--help'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status !== 0 || !result.stdout.includes('clipforge-local'))
  throw new Error(`Portable launcher smoke test failed: ${result.stderr || result.stdout}`);
console.log(`Portable launcher works: ${command}`);
