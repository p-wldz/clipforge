import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const platform = process.platform;
const arch = process.arch;
const name = `clipforge-${pkg.version}-${platform}-${arch}`;
const output = join(root, 'release', name);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'dist'), join(output, 'dist'), { recursive: true });
await cp(process.execPath, join(output, platform === 'win32' ? 'node.exe' : 'node'));
await cp(join(root, 'README.md'), join(output, 'README.md'));

if (platform === 'win32') {
  await writeFile(
    join(output, 'clipforge.cmd'),
    '@echo off\r\n"%~dp0node.exe" "%~dp0dist\\cli.js" %*\r\n',
  );
} else {
  await writeFile(join(output, 'clipforge'), '#!/bin/sh\nexec "$(dirname "$0")/node" "$(dirname "$0")/dist/cli.js" "$@"\n', { mode: 0o755 });
}
console.log(output);
