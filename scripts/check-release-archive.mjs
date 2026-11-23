import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const folder = `clipforge-${version}-${process.platform}-${process.arch}`;
try {
  if (!(await stat(join('release', folder))).isDirectory()) throw new Error('not a directory');
} catch {
  throw new Error(`Portable archive directory release/${folder} not found. Run npm run release:archive first.`);
}
const extraction = await mkdtemp(join(tmpdir(), 'clipforge-archive-extract-'));
const archive = join(extraction, 'clipforge.tar.gz');
const tar = (...args) => {
  const result = spawnSync('tar', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Archive command failed: ${result.stderr || result.stdout}`);
};
tar('-czf', archive, '-C', 'release', folder);
tar('-xzf', archive, '-C', extraction);
const command = process.platform === 'win32' ? join(extraction, folder, 'clipforge.cmd') : join(extraction, folder, 'clipforge');
const output = (result) => [result.stdout, result.stderr].filter(Boolean).join('\n');
const invoke = (args, { allowedStatuses = [0] } = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  if (!allowedStatuses.includes(result.status))
    throw new Error(`Portable launcher smoke test failed: ${output(result)}`);
  return result;
};
if (!invoke(['--help']).stdout.includes('clipforge-local')) throw new Error('Portable launcher returned unexpected help');
const sandbox = await mkdtemp(join(tmpdir(), 'clipforge-release-'));
try {
  invoke(['init', sandbox, '--name', 'Archive smoke test']);
  const doctor = invoke(['doctor', '--root', sandbox, '--json'], { allowedStatuses: [0, 1] });
  const diagnosis = JSON.parse(doctor.stdout);
  if (!diagnosis.node || !diagnosis.tools) throw new Error('Portable launcher returned invalid doctor output');
} finally {
  await rm(sandbox, { recursive: true, force: true });
  await rm(extraction, { recursive: true, force: true });
}
console.log(`Extracted portable archive works: ${command}`);
