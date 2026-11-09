import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Load an explicitly selected dotenv-style file without adding a runtime dependency.
 * Existing process variables always win, so shell/CI secrets cannot be replaced by a file.
 */
export async function loadEnvironmentFile(file: string) {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    const message =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `Environment file not found: ${file}`
        : `Could not read environment file ${file}: ${(error as Error).message}`;
    throw new Error(message);
  }

  let loaded = 0;
  for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid environment entry at ${path.basename(file)}:${index + 1}`);
    const key = match[1]!;
    const rawValue = match[2] ?? '';
    const value = unquote(rawValue ?? '');
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded++;
    }
  }
  return { file: path.resolve(file), loaded };
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/, '');
}
