import { readFile } from 'node:fs/promises';

const tag = process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG;
if (!tag) throw new Error('Set RELEASE_TAG locally or run this from a tag workflow.');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (tag !== `v${version}`)
  throw new Error(`Release tag ${tag} does not match package.json version v${version}.`);
console.log(`Release tag matches package version: ${tag}`);
