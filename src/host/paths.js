/**
 * Filesystem locations and atomic JSON IO for this plugin's own state.
 *
 * Everything lives under `$DSH_HOME/dsh-token-control/`, so an isolated
 * `DSH_HOME` (the `.dsh-dev` workflow) keeps dev state away from the real
 * profile, and uninstalling the plugin leaves one self-contained directory.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * @returns {string} the Harness home (`$DSH_HOME`, else `~/.dsh`)
 */
export function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim();
  return join(homedir(), '.dsh');
}

/** @returns {string} */
export function dataDir() {
  return join(dshHome(), 'dsh-token-control');
}

/** @returns {string} */
export function viewConfigFile() {
  return join(dataDir(), 'views.json');
}

/**
 * @param {string} file
 * @returns {Promise<unknown>} parsed JSON, or `undefined` when absent/unreadable
 */
export async function readJsonFile(file) {
  try {
    const text = await readFile(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Write JSON atomically (temp file in the same directory, then rename) so a
 * crash mid-write cannot leave a truncated settings file.
 * @param {string} file
 * @param {unknown} value
 */
export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}
