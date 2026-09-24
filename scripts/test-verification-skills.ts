import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
for (const skill of ['select-verify-archon-targets', 'verify-archon']) {
  const directory = resolve(root, '.agents/skills', skill);
  const instructions = await readFile(resolve(directory, 'SKILL.md'), 'utf8');
  const metadata = await readFile(resolve(directory, 'agents/openai.yaml'), 'utf8');
  if (!instructions.includes('disable-model-invocation: true')) {
    throw new Error(`${skill} must disable implicit Claude invocation`);
  }
  if (!metadata.includes('allow_implicit_invocation: false')) {
    throw new Error(`${skill} must disable implicit OpenAI invocation`);
  }
}

const files = ['./.agents/skills/verify-archon/lib/contract.test.ts'];
if (process.platform === 'win32') {
  console.log('Skipping POSIX process-isolation verification tests on Windows.');
} else {
  files.push('./.agents/skills/verify-archon/lib/isolation.test.ts');
}

const child = Bun.spawn(['bun', 'test', ...files], {
  cwd: resolve(import.meta.dir, '..'),
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
process.exitCode = await child.exited;
