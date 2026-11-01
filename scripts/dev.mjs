#!/usr/bin/env node
/**
 * Isolated dev harness.
 *
 *   pnpm dev          create/reuse `.dsh-dev/`, link this package into its `dev`
 *                     profile, and boot that profile
 *   pnpm dev:reset    delete `.dsh-dev/` first
 *   node scripts/dev.mjs --no-start     stop after linking (for CI/checks)
 *
 * The whole Harness home lives inside the repo (`<repo>/.dsh-dev`), so nothing
 * here reads or writes the real profile under `~/.dsh`. That is also what makes
 * the setup sandbox-friendly: every path it touches is inside the workspace.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = join(ROOT, '.dsh-dev');
const PROFILE = 'dev';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/dev.mjs [--reset] [--no-start]

  --reset     delete ${HOME} and rebuild the isolated profile
  --no-start  stop after linking the package into the dev profile

Environment:
  DSH_CLI     path to the dsh launcher (default: "dsh" from PATH)
  DSH_HOME    overridden to ${HOME} for every child process`);
  process.exit(0);
}

const DSH = process.env.DSH_CLI ?? 'dsh';
const isWindows = process.platform === 'win32';
// Piped child stdio is blocked in some sandboxes, so capture is opt-in: the
// default inherits the terminal, which always works.
const CAPTURE = process.env.DSH_DEV_CAPTURE === '1';

if (!existsSync(join(ROOT, 'package.json'))) {
  console.error(`dev: ${ROOT} does not look like the plugin package root`);
  process.exit(1);
}

if (args.has('--reset') && existsSync(HOME)) {
  console.log(`dev: removing ${HOME}`);
  rmSync(HOME, { recursive: true, force: true });
}

const env = { ...process.env, DSH_HOME: HOME };

/**
 * @param {string[]} argv
 * @param {{capture?: boolean, allowFailure?: boolean}} [options]
 * @returns {{ok:boolean, stdout:string, stderr:string, status:number|null}}
 */
function run(argv, options = {}) {
  const result = spawnSync(DSH, argv, {
    cwd: ROOT,
    env,
    shell: isWindows,
    stdio: options.quiet === true ? 'ignore' : options.capture === true && CAPTURE ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  const ok = result.status === 0;
  if (!ok && options.allowFailure !== true) {
    if (options.capture === true && CAPTURE) {
      console.error(String(result.stdout ?? ''));
      console.error(String(result.stderr ?? ''));
    }
    console.error(`dev: "${DSH} ${argv.join(' ')}" failed with status ${String(result.status)}${result.error ? ` (${String(result.error.message)})` : ''}`);
    console.error(`dev: is the Harness launcher on PATH? Set DSH_CLI=<path to dsh> and retry.`);
    process.exit(result.status ?? 1);
  }
  return { ok, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), status: result.status };
}

const profileDir = join(HOME, 'profiles', PROFILE);
console.log(`dev: DSH_HOME=${HOME}`);
console.log(`dev: profile=${PROFILE}`);

// 1. Create the profile from the shipped web template the first time. A dump
//    resolves and prints the composed tree without listening on a port.
if (!existsSync(join(profileDir, 'package.json'))) {
  console.log('dev: creating the isolated profile from the shipped "web" template');
  run(['--profile', PROFILE, '--from-default-profile', 'web', '--dump-config'], { quiet: true });
}

// 2. Link this package into that profile. A local directory spec installs a
//    symlink, so edits are visible without republishing.
console.log('dev: linking the package into the dev profile');
run(['plugin', '--profile', PROFILE, 'add', ROOT], { capture: false });

if (args.has('--no-start')) {
  console.log('dev: linked; not starting (--no-start)');
  process.exit(0);
}

// 3. Boot. This is a separate server on its own port; the running Desktop GUI is
//    untouched.
console.log('dev: booting the dev profile');
run(['--profile', PROFILE]);
