import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const entries = await readdir('release', { withFileTypes: true });
const folder = entries.find((entry) => entry.isDirectory() && entry.name.startsWith('clipforge-'))?.name;
if (!folder) throw new Error('No portable archive directory found. Run npm run release:archive first.');
const extraction = await mkdtemp(join(tmpdir(), 'clipforge-archive-extract-'));
const archive = join(extraction, 'clipforge.tar.gz');
const tar = (...args) => {
  const result = spawnSync('tar', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Archive command failed: ${result.stderr || result.stdout}`);
};
tar('-czf', archive, '-C', 'release', folder);
tar('-xzf', archive, '-C', extraction);
const command = process.platform === 'win32' ? join(extraction, folder, 'clipforge.cmd') : join(extraction, folder, 'clipforge');
const invoke = (args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`Portable launcher smoke test failed: ${result.stderr || result.stdout}`);
  return result.stdout;
};
if (!invoke(['--help']).includes('clipforge-local')) throw new Error('Portable launcher returned unexpected help');
const sandbox = await mkdtemp(join(tmpdir(), 'clipforge-release-'));
try {
  invoke(['init', sandbox, '--name', 'Archive smoke test']);
  const doctor = invoke(['doctor', '--root', sandbox, '--json']);
  JSON.parse(doctor);
} finally {
  await rm(sandbox, { recursive: true, force: true });
  await rm(extraction, { recursive: true, force: true });
}
console.log(`Extracted portable archive works: ${command}`);
