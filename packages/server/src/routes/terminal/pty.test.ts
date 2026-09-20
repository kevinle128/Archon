import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildDockerExecArgs } from './docker';
import { buildDockerClientEnv, buildHostTerminalEnv } from './env';
import { buildTerminalSpawnSpec, spawnTerminalPty } from './pty';

const sourceEnv: NodeJS.ProcessEnv = {
  HOME: '/Users/operator',
  USER: 'operator',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'en_US.UTF-8',
  DOCKER_HOST: 'unix:///tmp/docker.sock',
  DATABASE_URL: 'postgres://secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
};

const hostTarget = { kind: 'host' as const, cwd: '/canonical/checkout', shell: '/bin/bash' };
const containerTarget = {
  kind: 'container' as const,
  cwd: '/workspace/app',
  handle: 'archon-run-1',
  shell: '/bin/bash' as const,
};

describe('buildTerminalSpawnSpec', () => {
  test('builds the host command, canonical cwd, and host allowlist', () => {
    expect(buildTerminalSpawnSpec(hostTarget, sourceEnv)).toEqual({
      command: ['/bin/bash', '-l'],
      cwd: '/canonical/checkout',
      env: buildHostTerminalEnv(sourceEnv),
    });
  });

  test('builds the Docker command without a Docker cwd and uses the Docker-client allowlist', () => {
    const spec = buildTerminalSpawnSpec(containerTarget, sourceEnv);
    expect(spec).toEqual({
      command: ['docker', ...buildDockerExecArgs('/workspace/app', 'archon-run-1', '/bin/bash')],
      env: buildDockerClientEnv(sourceEnv),
    });
    expect(spec.cwd).toBeUndefined();
  });
});

describe('spawnTerminalPty', () => {
  test('writes, resizes, and kills the inline terminal at most once', async () => {
    const events: string[] = [];
    const writes: string[] = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    const chunks: Uint8Array[] = [];
    let resolveExited!: (code: number) => void;
    const exited = new Promise<number>(resolve => {
      resolveExited = resolve;
    });
    const fakeTerminal = {
      write(data: string) {
        writes.push(data);
      },
      resize(cols: number, rows: number) {
        resizes.push({ cols, rows });
      },
      close() {
        events.push('close');
      },
    };
    const fakeProcess = {
      terminal: fakeTerminal,
      signalCode: 'SIGTERM' as NodeJS.Signals | null,
      exited,
      kill(signal?: number | NodeJS.Signals) {
        events.push(`kill:${String(signal ?? '')}`);
      },
    };
    let spawnArgs: { command: string[]; options: Record<string, unknown> } | undefined;
    const spawn = ((command: string[], options: Record<string, unknown>) => {
      spawnArgs = { command, options };
      const terminal = options.terminal as {
        data: (terminal: unknown, chunk: Uint8Array) => void;
      };
      terminal.data(fakeTerminal, new Uint8Array([1, 2, 3]));
      return fakeProcess;
    }) as typeof Bun.spawn;

    const pty = spawnTerminalPty({
      target: hostTarget,
      cols: 80,
      rows: 24,
      onData(chunk) {
        chunks.push(chunk);
      },
      sourceEnv,
      spawn,
    });

    expect(spawnArgs?.command).toEqual(['/bin/bash', '-l']);
    expect(spawnArgs?.options.cwd).toBe('/canonical/checkout');
    expect(spawnArgs?.options.env).toEqual(buildHostTerminalEnv(sourceEnv));
    expect(spawnArgs?.options.terminal).toEqual(
      expect.objectContaining({
        cols: 80,
        rows: 24,
        name: 'xterm-256color',
      })
    );
    expect(spawnArgs?.options.terminal instanceof Bun.Terminal).toBe(false);
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);

    pty.write('ls\n');
    pty.resize(120, 40);
    pty.kill();
    pty.kill();
    expect(writes).toEqual(['ls\n']);
    expect(resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(events).toEqual(['kill:SIGTERM', 'close']);

    resolveExited(1);
    await expect(pty.exited).resolves.toEqual({ code: 1, signal: 'SIGTERM' });
  });

  test('omits cwd when spawning the Docker client', () => {
    const fakeTerminal = {
      write() {},
      resize() {},
      close() {},
    };
    let spawnArgs: { command: string[]; options: Record<string, unknown> } | undefined;
    const spawn = ((command: string[], options: Record<string, unknown>) => {
      spawnArgs = { command, options };
      return {
        terminal: fakeTerminal,
        signalCode: null,
        exited: Promise.resolve(0),
        kill() {},
      };
    }) as typeof Bun.spawn;

    spawnTerminalPty({
      target: containerTarget,
      cols: 80,
      rows: 24,
      onData() {},
      sourceEnv,
      spawn,
    });

    expect(spawnArgs?.command).toEqual([
      'docker',
      ...buildDockerExecArgs('/workspace/app', 'archon-run-1', '/bin/bash'),
    ]);
    expect(spawnArgs?.options).not.toHaveProperty('cwd');
    expect(spawnArgs?.options.env).toEqual(buildDockerClientEnv(sourceEnv));
  });

  test('fails fast when Bun does not attach a terminal', () => {
    const kills: Array<number | NodeJS.Signals | undefined> = [];
    const spawn = (() => ({
      terminal: undefined,
      signalCode: null,
      exited: Promise.resolve(0),
      kill(signal?: number | NodeJS.Signals) {
        kills.push(signal);
      },
    })) as typeof Bun.spawn;

    expect(() =>
      spawnTerminalPty({
        target: hostTarget,
        cols: 80,
        rows: 24,
        onData() {},
        sourceEnv,
        spawn,
      })
    ).toThrow('Bun did not create the requested terminal');
    expect(kills).toEqual(['SIGTERM']);
  });

  test.skipIf(process.platform === 'win32')(
    'SIGINT from Ctrl-C interrupts a sleeping child on a real controlling terminal',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'archon-pty-'));
      const decoder = new TextDecoder();
      let output = '';
      let pty: ReturnType<typeof spawnTerminalPty> | undefined;
      try {
        pty = spawnTerminalPty({
          target: { kind: 'host', cwd: dir, shell: '/bin/bash' },
          cols: 80,
          rows: 24,
          onData(chunk) {
            output += decoder.decode(chunk);
          },
        });
        // Use a command marker, not the shell prompt. A login profile can
        // legally replace Bash with the user's configured shell and change
        // PS1, while Ctrl-C must still let the queued command run.
        pty.write('echo READY; sleep 30\n');
        await waitFor(
          () => output.includes('READY'),
          10_000,
          'READY',
          () => output
        );
        // READY is printed in the same command list as `sleep`. On loaded
        // Ubuntu runners the kernel may not have made `sleep` the foreground
        // process group yet; \x03 written then is a literal byte, not SIGINT.
        await Bun.sleep(250);
        const outputBeforeInterrupt = output.length;
        const sawInterruptConfirmation = (): boolean =>
          output.slice(outputBeforeInterrupt).includes('INTERRUPTED');
        pty.write('\x03');
        pty.write('echo INTERRUPTED; exit\n');
        try {
          await waitFor(sawInterruptConfirmation, 1_500, 'command after SIGINT', () => output);
        } catch {
          // Retry once — the first Ctrl-C can still lose the process-group race.
          pty.write('\x03');
          pty.write('echo INTERRUPTED; exit\n');
          await waitFor(sawInterruptConfirmation, 8_000, 'command after SIGINT', () => output);
        }
        await pty.exited;
      } finally {
        pty?.kill();
        await rm(dir, { recursive: true, force: true });
      }
    },
    45_000
  );
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
  dump?: () => string
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(20);
  }
  const detail = dump ? ` output=${JSON.stringify(dump())}` : '';
  throw new Error(`Timed out waiting for ${label}${detail}`);
}
