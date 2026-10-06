import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  getWorkflowRunFilesChanged,
  type AttributedNodeExecution,
  type FilesChangedPath,
} from '@/lib/api';
import {
  FILES_CHANGED_EMPTY_COPY,
  describeFilesChangedExecutions,
  elidePathMiddle,
  isFilesChangedEmpty,
  orderedFilesChangedPaths,
} from '@/lib/files-changed';

import { FileGlyph } from './file-glyph';
import { StatusBadge } from './status-badge';

const PATH_MAX_LENGTH = 60;

function executionsSummary(executions: readonly AttributedNodeExecution[]): string {
  if (executions.length === 0) return 'unknown';
  return executions.map(execution => execution.nodeId).join(', ');
}

function FilesChangedRow(props: { file: FilesChangedPath }): ReactElement {
  const displayPath = elidePathMiddle(props.file.path, PATH_MAX_LENGTH);
  return (
    <li
      title={props.file.path}
      className="flex items-center gap-2 border-b border-border px-3 py-2 text-[0.8125rem] last:border-b-0"
    >
      <FileGlyph path={props.file.path} />
      <span className="min-w-0 flex-1 truncate font-mono text-text-primary">{displayPath}</span>
      <span
        className="shrink-0 font-mono text-[0.75rem] text-text-tertiary"
        title={
          props.file.executions.length === 0
            ? 'No node execution proved this change'
            : executionsSummary(props.file.executions)
        }
      >
        {describeFilesChangedExecutions(props.file.executions)}
      </span>
      <StatusBadge status={props.file.status} />
    </li>
  );
}

export function FilesChangedTab({ runId }: { runId: string }): ReactElement {
  const { data, isError, isFetching, error } = useQuery({
    queryKey: ['workflowRunFilesChanged', runId],
    queryFn: ({ signal }) => getWorkflowRunFilesChanged(runId, { signal }),
    retry: false,
    refetchInterval: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  if (isFetching && data === undefined) {
    return (
      <div role="status" aria-live="polite" className="p-4 text-[0.8125rem] text-text-tertiary">
        Loading files changed…
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="p-4 text-[0.8125rem] text-text-secondary">
        Could not load files changed{error instanceof Error ? `: ${error.message}` : ''}.
      </div>
    );
  }

  if (data === undefined || isFilesChangedEmpty(data)) {
    return (
      <div className="p-4 text-[0.8125rem] text-text-tertiary">{FILES_CHANGED_EMPTY_COPY}</div>
    );
  }

  const files = orderedFilesChangedPaths(data);

  return (
    <div className="h-full min-h-0 overflow-auto">
      <h2 className="px-3 pt-2.5 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.07em] text-text-tertiary">
        Files changed · {files.length.toString()}
      </h2>
      <ul aria-label="Files changed" className="flex flex-col">
        {files.map(file => (
          <FilesChangedRow key={`${file.status}:${file.path}`} file={file} />
        ))}
      </ul>
    </div>
  );
}
