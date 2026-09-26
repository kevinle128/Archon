import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath, stat, rename, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  catalogSchema, featureSchema, gapsSchema, digest, sorted,
  validateCatalog, relativePathSchema, type Catalog,
} from './contract';

const exec = promisify(execFile);
export const SKILL_ROOT = resolve(import.meta.dir, '..');
export const TOOLING_REPO = resolve(SKILL_ROOT, '../../..');
export const ARTIFACT_SUBTREE = '.plans/verifications';

export async function git(repo: string, args: string[]): Promise<string> {
  const result = await exec('git', ['-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
  return result.stdout.trimEnd();
}
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}
export async function loadCatalog(): Promise<Catalog & { sha256: string }> {
  const files = sorted((await readdir(join(SKILL_ROOT, 'features'))).filter(file => file.endsWith('.json')));
  const features = await Promise.all(files.map(async file => featureSchema.parse(await readJson(join(SKILL_ROOT, 'features', file)))));
  const { gaps } = gapsSchema.parse(await readJson(join(SKILL_ROOT, 'coverage-gaps.json')));
  const content = { version: 1 as const, features, gaps };
  const catalog = catalogSchema.parse({ ...content, catalog_sha256: digest(content) });
  validateCatalog(catalog);
  // Existing workflow consumers use this alias; it is not a protocol field.
  return Object.defineProperty(catalog, 'sha256', { value: catalog.catalog_sha256 }) as Catalog & { sha256: string };
}
export function contains(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}
/** Resolve existing ancestors too, so a not-yet-created path cannot hide a symlink escape. */
export async function resolvedPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await resolvedPath(parent), relative(parent, path));
  }
}
export async function sourceFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'reports', 'test-results', 'playwright-report', '.tmp', '.git'].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Tooling source must not be a symlink: ${path}`);
    if (entry.isDirectory()) paths.push(...await sourceFiles(path));
    else if (entry.isFile()) paths.push(path);
  }
  return sorted(paths);
}
export async function toolingDigest(): Promise<string> {
  const files = [...await sourceFiles(SKILL_ROOT), ...await sourceFiles(join(TOOLING_REPO, 'e2e')),
    join(TOOLING_REPO, 'package.json'), join(TOOLING_REPO, 'bun.lock')];
  const hash = createHash('sha256');
  for (const file of sorted(files)) {
    const bytes = await readFile(file);
    hash.update(relative(TOOLING_REPO, file)).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  return hash.digest('hex');
}
export async function evidenceDirectory(repo: string, root: string): Promise<string> {
  repo = await realpath(repo);
  const lexical = resolve(root);
  const resolved = await resolvedPath(lexical);
  const retained = join(repo, ARTIFACT_SUBTREE);
  const toolingArtifacts = join(TOOLING_REPO, ARTIFACT_SUBTREE);
  if ((contains(TOOLING_REPO, resolved) && !contains(toolingArtifacts, resolved)) || contains(SKILL_ROOT, resolved) ||
      (contains(repo, resolved) && (!contains(retained, resolved) || await resolvedPath(retained) !== retained))) {
    throw new Error('Evidence must be external or below TARGET/.plans/verifications, with no source symlink');
  }
  if (contains(repo, lexical) && !contains(retained, lexical)) throw new Error('In-repository evidence outside the retained subtree');
  await mkdir(resolved, { recursive: true });
  const child = join(resolved, randomUUID());
  await mkdir(child);
  return child;
}
export async function attachmentInventory(directory: string, paths: string[]): Promise<string[]> {
  const inventory: string[] = [];
  const root = await realpath(directory);
  for (const path of new Set(paths)) {
    relativePathSchema.parse(path);
    const full = join(root, path);
    try {
      const resolved = await realpath(full);
      if (!contains(root, resolved) || (await lstat(full)).isSymbolicLink()) throw new Error(`Attachment escapes evidence: ${path}`);
      if (!(await stat(resolved)).isFile()) throw new Error(`Attachment is not a file: ${path}`);
      inventory.push(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return inventory;
}
