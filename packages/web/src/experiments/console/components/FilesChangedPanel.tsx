import type { ReactElement } from 'react';

import {
  FILES_CHANGED_EMPTY_COPY,
  describeFilesChangedExecutions,
  elidePathMiddle,
  isFilesChangedEmpty,
  orderedFilesChangedPaths,
  type AttributedNodeExecution,
  type FilesChangedPath,
} from '@/lib/files-changed';

import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import * as skill from '../skills';

const PATH_MAX_LENGTH = 64;

const STATUS_LABEL: Record<FilesChangedPath['status'], string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
};

function executionsTitle(executions: readonly AttributedNodeExecution[]): string {
  if (executions.length === 0) return 'No node execution proved this change';
  return executions.map(execution => execution.nodeId).join(', ');
}

function FilesChangedRow({ file }: { file: FilesChangedPath }): ReactElement {
  return (
    <li
      title={file.path}
      className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12.5px] last:border-b-0"
    >
      <span
        aria-label={STATUS_LABEL[file.status]}
        className="min-w-5 shrink-0 rounded-sm bg-surface-inset px-[5px] py-px text-center font-mono text-[10.5px] font-semibold text-text-secondary"
      >
        {file.status}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-text-primary">
        {elidePathMiddle(file.path, PATH_MAX_LENGTH)}
      </span>
      <span
        className="shrink-0 font-mono text-[11px] text-text-tertiary"
        title={executionsTitle(file.executions)}
      >
        {describeFilesChangedExecutions(file.executions)}
      </span>
    </li>
  );
}

/**
 * Run-level Files Changed panel: every path this run's node executions
 * proved changed, in deterministic repository order, with the node
 * executions attributed to each one. Repository evidence only — never
 * inferred from tool names or agent prose.
 */
export function FilesChangedPanel({ runId }: { runId: string }): ReactElement {
  const {
    data: response,
    error,
    loading,
  } = useEntity(K.filesChanged(runId), () => skill.getFilesChanged(runId));

  // Error is checked before loading: the two can briefly co-exist (inflight
  // clears in a later tick than the error is recorded), and error is the
  // authoritative state when that happens.
  if (error !== undefined) {
    return (
      <div role="alert" className="p-6 font-mono text-[12px] text-error">
        Could not load files changed: {error.message}
      </div>
    );
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="p-6 text-[12px] text-text-tertiary">
        Loading files changed…
      </div>
    );
  }

  if (response === undefined || isFilesChangedEmpty(response)) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-[13px] text-text-tertiary">{FILES_CHANGED_EMPTY_COPY}</p>
      </div>
    );
  }

  const files = orderedFilesChangedPaths(response);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        Files changed · {files.length.toString()}
      </header>
      <ul aria-label="Files changed" className="flex flex-col">
        {files.map(file => (
          <FilesChangedRow key={`${file.status}:${file.path}`} file={file} />
        ))}
      </ul>
    </div>
  );
}
