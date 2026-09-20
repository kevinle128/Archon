#!/usr/bin/env bun
/**
 * Runs the Windows CI checks in the local Parallels VM.
 *
 * Usage:
 *   bun run scripts/test-windows.ts
 *   bun run scripts/test-windows.ts -- test packages/git/src/git.test.ts
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const parallels = '/usr/local/bin/prlctl';
const vmName = process.env.ARCHON_WINDOWS_VM ?? 'Windows 11';
const guestScript = String.raw`\\Mac\archon-src\scripts\test-windows.ps1`;
const repoRoot = join(import.meta.dir, '..');
const hostShareProbe = Buffer.from(
  String.raw`if (Test-Path -LiteralPath '\\Mac\archon-src') { exit 0 } else { exit 1 }`,
  'utf16le'
).toString('base64');

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function capture(command: string[]): Promise<CommandResult> {
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function waitForGuest(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await capture([
      parallels,
      'exec',
      vmName,
      '--current-user',
      'powershell.exe',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'exit 0',
    ]);
    if (result.exitCode === 0) return;
    await Bun.sleep(2_000);
  }
  throw new Error(`Windows guest '${vmName}' did not become ready within 60 seconds.`);
}

async function waitForHostShare(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await capture([
      parallels,
      'exec',
      vmName,
      '--current-user',
      'powershell.exe',
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      hostShareProbe,
    ]);
    if (result.exitCode === 0) return;
    await Bun.sleep(1_000);
  }
  throw new Error("The Parallels host share 'archon-src' did not mount within 30 seconds.");
}

async function configureHostShare(): Promise<void> {
  const configured = await capture([
    parallels,
    'set',
    vmName,
    '--shf-host-set',
    'archon-src',
    '--path',
    repoRoot,
    '--mode',
    'ro',
    '--enable',
  ]);
  if (configured.exitCode === 0) return;

  const added = await capture([
    parallels,
    'set',
    vmName,
    '--shf-host-add',
    'archon-src',
    '--path',
    repoRoot,
    '--mode',
    'ro',
    '--enable',
  ]);
  if (added.exitCode !== 0) {
    throw new Error(
      added.stderr.trim() ||
        configured.stderr.trim() ||
        'Could not configure the Parallels host share.'
    );
  }
}

async function hostShareIsCurrent(): Promise<boolean> {
  const result = await capture([parallels, 'list', '-i', vmName]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Could not inspect Parallels VM '${vmName}'.`);
  }
  return result.stdout.includes(`  archon-src (+) path='${repoRoot}' mode='ro'`);
}

async function prepareSyncFiles(): Promise<{ directory: string; relativeDirectory: string }> {
  const relativeDirectory = `.archon/logs/windows-sync/${crypto.randomUUID()}`;
  const directory = join(repoRoot, relativeDirectory);
  await mkdir(directory, { recursive: true });
  try {
    const head = await capture(['git', '-C', repoRoot, 'rev-parse', 'HEAD']);
    if (head.exitCode !== 0) throw new Error(head.stderr.trim() || 'Could not read the host HEAD.');
    const bundlePath = join(directory, 'repository.bundle');
    const bundle = await capture(['git', '-C', repoRoot, 'bundle', 'create', bundlePath, 'HEAD']);
    if (bundle.exitCode !== 0) {
      throw new Error(bundle.stderr.trim() || 'Could not create the host Git bundle.');
    }
    const patchPath = join(directory, 'worktree.patch');
    const patch = await capture([
      'git',
      '-C',
      repoRoot,
      'diff',
      '--binary',
      'HEAD',
      `--output=${patchPath}`,
    ]);
    if (patch.exitCode !== 0) {
      throw new Error(patch.stderr.trim() || 'Could not create the host patch.');
    }
    const untracked = await capture([
      'git',
      '-C',
      repoRoot,
      '-c',
      'core.quotepath=false',
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
    if (untracked.exitCode !== 0) {
      throw new Error(untracked.stderr.trim() || 'Could not list untracked host files.');
    }
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        head: head.stdout.trim(),
        untracked: untracked.stdout.split('\0').filter(Boolean),
      })
    );
    return { directory, relativeDirectory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('This runner requires macOS and Parallels.');

  const status = await capture([parallels, 'status', vmName]);
  if (status.exitCode !== 0) {
    throw new Error(status.stderr.trim() || `Parallels VM '${vmName}' was not found.`);
  }
  const wasRunning = /\brunning\b/i.test(status.stdout);
  if (!(await hostShareIsCurrent())) {
    if (!/\bstopped\b/i.test(status.stdout)) {
      throw new Error(
        `Parallels VM '${vmName}' must be fully stopped before updating the 'archon-src' share.`
      );
    }
    await configureHostShare();
  }
  if (!wasRunning) {
    const started = await capture([parallels, 'start', vmName]);
    if (started.exitCode !== 0) throw new Error(started.stderr.trim() || started.stdout.trim());
  }

  try {
    await waitForGuest();
    await waitForHostShare();
    const sync = await prepareSyncFiles();
    try {
      const customArgs = process.argv.slice(2).filter(argument => argument !== '--');
      const child = Bun.spawn(
        [
          parallels,
          'exec',
          vmName,
          '--current-user',
          'powershell.exe',
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          guestScript,
          '-SyncDirectoryRelativePath',
          sync.relativeDirectory,
          ...customArgs,
        ],
        { stdout: 'inherit', stderr: 'inherit' }
      );
      const exitCode = await child.exited;
      if (exitCode !== 0) {
        throw new Error(`Windows checks failed with exit code ${String(exitCode)}.`);
      }
    } finally {
      await rm(sync.directory, { recursive: true, force: true });
    }
  } finally {
    if (!wasRunning) {
      const suspended = await capture([parallels, 'suspend', vmName]);
      if (suspended.exitCode !== 0) {
        console.error(`Could not restore the suspended VM state: ${suspended.stderr.trim()}`);
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
