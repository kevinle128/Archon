import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { ConversationItem } from '@/components/conversations/ConversationItem';
import { useProject } from '@/contexts/ProjectContext';
import { listWorkflowRuns, type ConversationResponse } from '@/lib/api';
import { projectDisplayName } from '@/lib/projects/display-name';

interface ConversationsColumnProps {
  /** Conversations in the project filter, already searched. */
  conversations: readonly ConversationResponse[] | undefined;
  isError: boolean;
  /** Every conversation, before filters, to tell "none yet" from "none match". */
  totalCount: number;
  query: string;
  onQueryChange: (query: string) => void;
}

/** Left column of Chat: conversations of the selected project. */
export function ConversationsColumn({
  conversations,
  isError,
  totalCount,
  query,
  onQueryChange,
}: ConversationsColumnProps): React.ReactElement {
  const navigate = useNavigate();
  const { codebases } = useProject();

  const { data: runs, isError: isErrorRuns } = useQuery({
    queryKey: ['workflow-runs-status'],
    queryFn: () => listWorkflowRuns({ limit: 50 }),
    refetchInterval: 10_000,
  });

  const statusByConversation = useMemo((): Map<string, 'running' | 'failed'> => {
    const map = new Map<string, 'running' | 'failed'>();
    // Status badges are secondary; a failed read leaves them off.
    if (!runs || isErrorRuns) return map;
    for (const run of runs) {
      // Web runs carry the visible chat as their parent; CLI runs have only one conversation.
      const key = run.parent_conversation_id ?? run.conversation_id;
      if (run.status === 'running') map.set(key, 'running');
      else if (run.status === 'failed' && !map.has(key)) map.set(key, 'failed');
    }
    return map;
  }, [runs, isErrorRuns]);

  const codebaseById = new Map((codebases ?? []).map(codebase => [codebase.id, codebase]));

  return (
    <aside
      aria-label="Conversations"
      className="flex min-h-0 flex-col border-r-2 border-line-strong"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold">Chat</h1>
          <Button
            variant="secondary"
            size="sm"
            onClick={(): void => {
              void navigate('/chat');
            }}
          >
            New chat
          </Button>
        </div>
        <input
          type="search"
          value={query}
          data-list-filter=""
          aria-label="Search conversations"
          placeholder="Search conversations"
          onChange={(event): void => {
            onQueryChange(event.target.value);
          }}
          onKeyDown={(event): void => {
            if (event.key === 'Escape') onQueryChange('');
          }}
          className="mt-2 h-8 w-full border border-line-strong bg-background px-2 text-[13px] text-text-primary placeholder:text-text-tertiary"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {isError ? (
          <p className="p-4 text-[13px] text-error">Failed to load conversations. Retrying.</p>
        ) : conversations !== undefined && conversations.length > 0 ? (
          conversations.map(conversation => {
            const codebase =
              conversation.codebase_id !== null
                ? codebaseById.get(conversation.codebase_id)
                : undefined;
            return (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                projectName={codebase !== undefined ? projectDisplayName(codebase) : undefined}
                status={statusByConversation.get(conversation.id) ?? 'idle'}
              />
            );
          })
        ) : (
          <p className="p-4 text-[13px] text-text-secondary">
            {totalCount > 0 ? 'No conversations match.' : 'No conversations yet. Start a new chat.'}
          </p>
        )}
      </div>
    </aside>
  );
}
