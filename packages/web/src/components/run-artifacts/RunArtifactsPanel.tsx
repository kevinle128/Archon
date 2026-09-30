import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ArtifactSummary } from '@/components/workflows/ArtifactSummary';
import { ArtifactContent } from '@/components/run-artifacts/ArtifactContent';
import {
  RunArtifactsUnavailableError,
  fetchRunArtifact,
  formatFileSize,
  listRunArtifacts,
  runArtifactUrl,
  type RunArtifactFile,
} from '@/lib/run-artifacts/api';
import type { WorkflowArtifact } from '@/lib/types';

export interface RunArtifactsPanelProps {
  runId: string;
  /** Artifacts reported by workflow events (PR links, commits); shown above the file list. */
  reportedArtifacts: WorkflowArtifact[];
  onClose: () => void;
  /** Loaders are injectable so tests do not need to mock the network module. */
  loadFiles?: (runId: string) => Promise<RunArtifactFile[]>;
  loadFile?: (runId: string, path: string) => Promise<string>;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; files: RunArtifactFile[] }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

type FileState =
  | { kind: 'loading' }
  | { kind: 'ready'; content: string }
  | { kind: 'error'; message: string };

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Browser for every file on disk under a run's artifact directory. It lists
 * disk contents rather than event-reported artifacts because bash and script
 * nodes usually write straight to $ARTIFACTS_DIR without emitting an event.
 */
export function RunArtifactsPanel({
  runId,
  reportedArtifacts,
  onClose,
  loadFiles = listRunArtifacts,
  loadFile = fetchRunArtifact,
}: RunArtifactsPanelProps): React.ReactElement {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<FileState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setList({ kind: 'loading' });
    setSelected(null);
    loadFiles(runId).then(
      files => {
        if (cancelled) return;
        setList({ kind: 'ready', files });
        // Auto-select the first file so the viewer is never blank when files exist.
        setSelected(files[0]?.path ?? null);
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof RunArtifactsUnavailableError) {
          setList({ kind: 'unavailable' });
          return;
        }
        console.error('[RunArtifactsPanel] list failed', { runId, err });
        setList({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to list artifacts',
        });
      }
    );
    return (): void => {
      cancelled = true;
    };
  }, [runId, loadFiles]);

  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    setFile({ kind: 'loading' });
    loadFile(runId, selected).then(
      content => {
        if (!cancelled) setFile({ kind: 'ready', content });
      },
      (err: unknown) => {
        if (cancelled) return;
        console.error('[RunArtifactsPanel] load failed', { runId, path: selected, err });
        setFile({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to load artifact',
        });
      }
    );
    return (): void => {
      cancelled = true;
    };
  }, [runId, selected, loadFile]);

  // Escape closes the panel, but not while the user types in the node room
  // composer or while a dialog (the reported-artifact viewer) owns the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <aside
      aria-label="Run artifacts"
      data-testid="run-artifacts-panel"
      className="flex h-[45%] min-h-0 w-full shrink-0 flex-col border-t border-border bg-background lg:h-auto lg:w-[420px] lg:border-l lg:border-t-0"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-text-primary">Artifacts</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close artifacts"
          title="Close (Esc)"
          className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] text-text-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <X aria-hidden="true" strokeWidth={2} className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {reportedArtifacts.length > 0 ? (
          <div className="border-b border-border p-3">
            <ArtifactSummary artifacts={reportedArtifacts} runId={runId} />
          </div>
        ) : null}
        <FileBrowser
          runId={runId}
          list={list}
          selected={selected}
          onSelect={setSelected}
          file={file}
        />
      </div>
    </aside>
  );
}

interface FileBrowserProps {
  runId: string;
  list: ListState;
  selected: string | null;
  onSelect: (path: string) => void;
  file: FileState;
}

function FileBrowser({
  runId,
  list,
  selected,
  onSelect,
  file,
}: FileBrowserProps): React.ReactElement {
  if (list.kind === 'loading') {
    return <p className="p-4 text-sm text-text-tertiary">Loading artifacts…</p>;
  }
  if (list.kind === 'unavailable') {
    // A 404 means the output location could not be resolved, which is not the
    // same as a resolved location that holds no files.
    return (
      <div role="alert" className="p-4 text-sm text-text-secondary">
        <p className="text-error">Artifacts unavailable for this run.</p>
        <p className="mt-2 text-text-tertiary">
          Archon could not resolve where this run&apos;s output was written. The run record may have
          been deleted, or its project may no longer be registered.
        </p>
      </div>
    );
  }
  if (list.kind === 'error') {
    return (
      <p role="alert" className="p-4 font-mono text-xs text-error">
        Could not list artifacts: {list.message}
      </p>
    );
  }
  if (list.files.length === 0) {
    return (
      <div className="p-4 text-sm text-text-tertiary">
        <p>No artifacts written to disk for this run.</p>
        <p className="mt-2 text-xs">
          Workflows that emit reports or plans write them to{' '}
          <code className="rounded bg-surface-inset px-1 font-mono">$ARTIFACTS_DIR</code>.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <nav aria-label="Artifact files" className="border-b border-border p-2">
        <ul className="flex flex-col gap-px">
          {list.files.map(f => {
            const isSelected = f.path === selected;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={(): void => {
                    onSelect(f.path);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${
                    isSelected ? 'bg-accent-muted' : 'hover:bg-surface-hover'
                  }`}
                >
                  <span
                    className={`min-w-0 truncate font-mono text-xs ${
                      isSelected ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {f.path}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-text-tertiary">
                    {formatFileSize(f.size)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {selected !== null ? (
        <section aria-label="Artifact preview" className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-xs text-text-primary">{selected}</span>
            <a
              href={runArtifactUrl(runId, selected)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs text-text-tertiary transition-colors hover:text-text-primary"
            >
              Open raw
            </a>
          </div>
          {file.kind === 'loading' ? (
            <p className="text-sm text-text-tertiary">Loading…</p>
          ) : file.kind === 'error' ? (
            <p role="alert" className="font-mono text-xs text-error">
              {file.message}
            </p>
          ) : (
            <ArtifactContent path={selected} content={file.content} />
          )}
        </section>
      ) : null}
    </div>
  );
}
