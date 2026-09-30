import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  RunArtifactsUnavailableError,
  fetchRunArtifact,
  formatFileSize,
  isMarkdownPath,
  listRunArtifacts,
  runArtifactUrl,
} from './api';

const realFetch = globalThis.fetch;

function stubFetch(response: Response): ReturnType<typeof mock> {
  const stub = mock(async () => response);
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('run artifacts api', () => {
  test('listRunArtifacts returns files', async () => {
    const files = [{ path: 'a.md', size: 1, modifiedAt: 'x' }];
    const stub = stubFetch(Response.json({ files }));
    expect(await listRunArtifacts('r 1')).toEqual(files);
    expect(stub.mock.calls[0]).toEqual(['/api/runs/r%201/artifacts']);
  });

  test('listRunArtifacts maps 404 to the unavailable error', async () => {
    stubFetch(Response.json({ error: 'no' }, { status: 404 }));
    await expect(listRunArtifacts('r')).rejects.toBeInstanceOf(RunArtifactsUnavailableError);
  });

  test('listRunArtifacts surfaces the server error message', async () => {
    stubFetch(Response.json({ error: 'bad' }, { status: 500 }));
    await expect(listRunArtifacts('r')).rejects.toThrow('bad');
  });

  test('fetchRunArtifact encodes each path segment', async () => {
    const stub = stubFetch(new Response('hello'));
    expect(await fetchRunArtifact('r', 'dir/a b.md')).toBe('hello');
    expect(stub.mock.calls[0]).toEqual(['/api/artifacts/r/dir/a%20b.md']);
    expect(runArtifactUrl('r', 'x/y')).toBe('/api/artifacts/r/x/y');
  });

  test('fetchRunArtifact rejects with a status fallback when the body is not JSON', async () => {
    stubFetch(new Response('nope', { status: 502 }));
    await expect(fetchRunArtifact('r', 'a')).rejects.toThrow('Failed to load artifact (502)');
  });

  test('formatFileSize and isMarkdownPath', () => {
    expect(formatFileSize(10)).toBe('10 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(isMarkdownPath('A.MD')).toBe(true);
    expect(isMarkdownPath('a.txt')).toBe(false);
  });
});
