import { execFile as execFileCb } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * `agent login` does not write CURSOR_API_KEY.
 * On macOS the session lives in the login keychain under account `cursor-user`:
 * service `cursor-access-token` is the bearer the CLI sends, and
 * `cursor-api-key` is present only for an API-key login.
 * `AGENT_CLI_CREDENTIAL_STORE=file`, and the default on every other OS, writes
 * those same fields to the CLI auth file. `~/.cursor/sdk/auth.json` is the
 * SDK's own store and is not this login.
 */

const execFileAsync = promisify(execFileCb);

const KEYCHAIN_ACCOUNT = 'cursor-user';
const ACCESS_TOKEN_SERVICE = 'cursor-access-token';
const API_KEY_SERVICE = 'cursor-api-key';

export interface ExecFileResult {
  stdout: string;
  stderr: string;
}

export type CursorCliLogin =
  | { status: 'present'; bearer: string; teamId?: number }
  | { status: 'absent' }
  | { status: 'locked' }
  | { status: 'expired' };

interface CliLoginDeps {
  platform: NodeJS.Platform;
  homedir: string;
  env: NodeJS.ProcessEnv;
  readText: (path: string) => Promise<string>;
  execFile: (file: string, args: string[]) => Promise<ExecFileResult>;
}

type SecretRead =
  | { status: 'present'; value: string }
  | { status: 'absent' }
  | { status: 'locked' };

function storeKind(env: NodeJS.ProcessEnv): 'file' | 'memory' | 'default' {
  if (env.AGENT_CLI_CREDENTIAL_STORE === 'file') return 'file';
  if (env.AGENT_CLI_CREDENTIAL_STORE === 'memory') return 'memory';
  return 'default';
}

function authFilePath(env: NodeJS.ProcessEnv, home: string, osPlatform: NodeJS.Platform): string {
  if (osPlatform === 'win32') {
    const appData = env.APPDATA?.trim() || join(home, 'AppData', 'Roaming');
    return join(appData, 'Cursor', 'auth.json');
  }
  if (osPlatform === 'darwin') return join(home, '.cursor', 'auth.json');
  const base = env.XDG_CONFIG_HOME?.trim() || join(home, '.config');
  return join(base, 'cursor', 'auth.json');
}

function cliConfigPath(env: NodeJS.ProcessEnv, home: string, osPlatform: NodeJS.Platform): string {
  const override = env.CURSOR_CONFIG_DIR?.trim();
  if (override) return join(override, 'cli-config.json');
  if (osPlatform !== 'darwin' && osPlatform !== 'win32') {
    const xdg = env.XDG_CONFIG_HOME?.trim();
    if (xdg) return join(xdg, 'cursor', 'cli-config.json');
  }
  return join(home, '.cursor', 'cli-config.json');
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A value that is not a JWT is not treated as expired. */
function isExpiredJwt(token: string, nowMs: number): boolean {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null || !('exp' in payload)) return false;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 <= nowMs;
  } catch {
    return false;
  }
}

function bearerFromFields(
  accessToken: string | undefined,
  apiKey: string | undefined,
  nowMs: number
): CursorCliLogin {
  if (accessToken && !isExpiredJwt(accessToken, nowMs)) {
    return { status: 'present', bearer: accessToken };
  }
  if (apiKey) return { status: 'present', bearer: apiKey };
  if (accessToken) return { status: 'expired' };
  return { status: 'absent' };
}

function execFailure(error: unknown): { status: number | undefined; stderr: string } {
  if (typeof error !== 'object' || error === null) return { status: undefined, stderr: '' };
  const record = error as { status?: unknown; stderr?: unknown };
  const status = typeof record.status === 'number' ? record.status : undefined;
  const stderr =
    typeof record.stderr === 'string'
      ? record.stderr
      : Buffer.isBuffer(record.stderr)
        ? record.stderr.toString('utf8')
        : '';
  return { status, stderr };
}

async function readKeychainSecret(
  service: string,
  execFile: CliLoginDeps['execFile']
): Promise<SecretRead> {
  try {
    const { stdout } = await execFile('/usr/bin/security', [
      'find-generic-password',
      '-a',
      KEYCHAIN_ACCOUNT,
      '-s',
      service,
      '-w',
    ]);
    const value = stdout.trim();
    return value.length > 0 ? { status: 'present', value } : { status: 'absent' };
  } catch (error) {
    const { status, stderr } = execFailure(error);
    if (status === 44 || /could not be found/i.test(stderr)) return { status: 'absent' };
    // `security` exits 36 when this process is outside the GUI login session.
    if (
      status === 36 ||
      /interaction is not allowed/i.test(stderr) ||
      /keychain is locked/i.test(stderr)
    ) {
      return { status: 'locked' };
    }
    throw new Error(
      `Could not read the Cursor CLI login from the macOS keychain (security exit ${status ?? 'unknown'}).`
    );
  }
}

async function readAuthFile(
  path: string,
  readText: CliLoginDeps['readText'],
  nowMs: number
): Promise<CursorCliLogin> {
  let raw: string;
  try {
    raw = await readText(path);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'ENOENT') return { status: 'absent' };
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'absent' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 'absent' };
  const record = parsed as { accessToken?: unknown; apiKey?: unknown };
  return bearerFromFields(trimmedString(record.accessToken), trimmedString(record.apiKey), nowMs);
}

async function readTeamId(
  path: string,
  readText: CliLoginDeps['readText']
): Promise<number | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readText(path));
    if (typeof parsed !== 'object' || parsed === null || !('authInfo' in parsed)) return undefined;
    const authInfo = (parsed as { authInfo?: unknown }).authInfo;
    if (typeof authInfo !== 'object' || authInfo === null || !('activeTeamId' in authInfo)) {
      return undefined;
    }
    const teamId = (authInfo as { activeTeamId?: unknown }).activeTeamId;
    if (typeof teamId !== 'number' || !Number.isSafeInteger(teamId) || teamId <= 0)
      return undefined;
    return teamId;
  } catch {
    return undefined;
  }
}

async function readStoredLogin(deps: CliLoginDeps, nowMs: number): Promise<CursorCliLogin> {
  const kind = storeKind(deps.env);
  if (kind === 'memory') return { status: 'absent' };
  if (kind === 'file' || deps.platform !== 'darwin') {
    return readAuthFile(authFilePath(deps.env, deps.homedir, deps.platform), deps.readText, nowMs);
  }

  const access = await readKeychainSecret(ACCESS_TOKEN_SERVICE, deps.execFile);
  if (access.status === 'locked') return { status: 'locked' };
  const accessToken = access.status === 'present' ? access.value : undefined;
  if (accessToken && !isExpiredJwt(accessToken, nowMs)) {
    return { status: 'present', bearer: accessToken };
  }
  const apiKey = await readKeychainSecret(API_KEY_SERVICE, deps.execFile);
  if (apiKey.status === 'locked') return { status: 'locked' };
  return bearerFromFields(
    accessToken,
    apiKey.status === 'present' ? apiKey.value : undefined,
    nowMs
  );
}

export async function readCursorCliLogin(
  overrides: Partial<CliLoginDeps> & { nowMs?: number } = {}
): Promise<CursorCliLogin> {
  const deps: CliLoginDeps = {
    platform: overrides.platform ?? platform(),
    homedir: overrides.homedir ?? homedir(),
    env: overrides.env ?? process.env,
    readText: overrides.readText ?? ((path: string): Promise<string> => readFile(path, 'utf8')),
    execFile:
      overrides.execFile ??
      (async (file: string, args: string[]): Promise<ExecFileResult> => {
        const { stdout, stderr } = await execFileAsync(file, args, {
          encoding: 'utf8',
          timeout: 5000,
        });
        return {
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
        };
      }),
  };
  const login = await readStoredLogin(deps, overrides.nowMs ?? Date.now());
  if (login.status !== 'present') return login;
  const teamId = await readTeamId(
    cliConfigPath(deps.env, deps.homedir, deps.platform),
    deps.readText
  );
  return teamId === undefined ? login : { ...login, teamId };
}
