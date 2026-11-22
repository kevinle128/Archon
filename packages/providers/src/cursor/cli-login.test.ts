import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { readCursorCliLogin, type ExecFileResult } from './cli-login';

const dirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'archon-cursor-cli-'));
  mkdirSync(join(dir, '.cursor'));
  dirs.push(dir);
  return dir;
}

function jwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function fail(status: number, stderr: string): Error & { status: number; stderr: string } {
  const error = new Error('security failed') as Error & { status: number; stderr: string };
  error.status = status;
  error.stderr = stderr;
  return error;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readCursorCliLogin', () => {
  test('reads the macOS keychain access token and the CLI team id', async () => {
    const home = tempHome();
    writeFileSync(
      join(home, '.cursor', 'cli-config.json'),
      JSON.stringify({ authInfo: { activeTeamId: 42, email: 'hidden@example.com' } })
    );
    const services: string[] = [];
    const login = await readCursorCliLogin({
      platform: 'darwin',
      homedir: home,
      env: {},
      nowMs: 1_000,
      execFile: async (_file, args) => {
        const service = args[args.indexOf('-s') + 1] ?? '';
        services.push(service);
        if (service === 'cursor-access-token') {
          return { stdout: `${jwt(2)}\n`, stderr: '' };
        }
        throw fail(44, 'The specified item could not be found in the keychain.');
      },
    });

    expect(services).toEqual(['cursor-access-token']);
    expect(login).toEqual({ status: 'present', bearer: jwt(2), teamId: 42 });
  });

  test('uses the keychain API key when the access token is an expired JWT', async () => {
    const login = await readCursorCliLogin({
      platform: 'darwin',
      homedir: tempHome(),
      env: {},
      nowMs: 5_000,
      readText: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      execFile: async (_file, args) => {
        const service = args[args.indexOf('-s') + 1];
        if (service === 'cursor-access-token') return { stdout: `${jwt(1)}\n`, stderr: '' };
        if (service === 'cursor-api-key') return { stdout: 'cursor-api-key-value\n', stderr: '' };
        throw fail(44, 'The specified item could not be found in the keychain.');
      },
    });

    expect(login).toEqual({ status: 'present', bearer: 'cursor-api-key-value' });
  });

  test('reports an expired access token when no API key is stored', async () => {
    const login = await readCursorCliLogin({
      platform: 'darwin',
      homedir: tempHome(),
      env: {},
      nowMs: 5_000,
      execFile: async (_file, args) => {
        const service = args[args.indexOf('-s') + 1];
        if (service === 'cursor-access-token') return { stdout: jwt(1), stderr: '' };
        throw fail(44, 'The specified item could not be found in the keychain.');
      },
    });

    expect(login).toEqual({ status: 'expired' });
  });

  test('reports a locked keychain without a secret in the error', async () => {
    await expect(
      readCursorCliLogin({
        platform: 'darwin',
        homedir: tempHome(),
        env: {},
        execFile: async () => {
          throw fail(36, '');
        },
      })
    ).resolves.toEqual({ status: 'locked' });
  });

  test('reads the file store used outside the macOS keychain', async () => {
    const home = tempHome();
    const authPath = join(home, '.config', 'cursor', 'auth.json');
    mkdirSync(join(home, '.config', 'cursor'), { recursive: true });
    writeFileSync(
      authPath,
      JSON.stringify({ accessToken: 'file-access', refreshToken: 'file-refresh' })
    );

    const login = await readCursorCliLogin({
      platform: 'linux',
      homedir: home,
      env: {},
      execFile: async () => {
        throw new Error('security must not run off darwin');
      },
    });

    expect(login).toEqual({ status: 'present', bearer: 'file-access' });
  });

  test('honors AGENT_CLI_CREDENTIAL_STORE=file on macOS', async () => {
    const home = tempHome();
    writeFileSync(join(home, '.cursor', 'auth.json'), JSON.stringify({ apiKey: 'file-api-key' }));
    let calledSecurity = false;
    const login = await readCursorCliLogin({
      platform: 'darwin',
      homedir: home,
      env: { AGENT_CLI_CREDENTIAL_STORE: 'file' },
      execFile: async () => {
        calledSecurity = true;
        return { stdout: '', stderr: '' } satisfies ExecFileResult;
      },
    });

    expect(calledSecurity).toBe(false);
    expect(login).toEqual({ status: 'present', bearer: 'file-api-key' });
  });

  test('is absent when the memory store holds nothing this process can read', async () => {
    const login = await readCursorCliLogin({
      platform: 'darwin',
      homedir: tempHome(),
      env: { AGENT_CLI_CREDENTIAL_STORE: 'memory' },
      execFile: async () => {
        throw new Error('security must not run');
      },
    });
    expect(login).toEqual({ status: 'absent' });
  });
});
