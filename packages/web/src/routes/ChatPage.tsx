import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';

import { ChatInterface } from '@/components/chat/ChatInterface';
import { ConversationsColumn } from '@/components/chat/ConversationsColumn';
import { useProject } from '@/contexts/ProjectContext';
import { listConversations } from '@/lib/api';

/** Chat: conversations, the selected thread, and its context panel. */
export function ChatPage(): React.ReactElement {
  const { '*': rawConversationId } = useParams();
  const conversationId = rawConversationId ? decodeURIComponent(rawConversationId) : undefined;
  const navigate = useNavigate();
  const { selectedProjectId } = useProject();
  const [query, setQuery] = useState('');

  const { data: conversations, isError } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => listConversations(),
    refetchInterval: 10_000,
  });

  const inProject = useMemo(
    () =>
      (conversations ?? []).filter(
        conversation => selectedProjectId === null || conversation.codebase_id === selectedProjectId
      ),
    [conversations, selectedProjectId]
  );
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text === '') return inProject;
    return inProject.filter(conversation =>
      (conversation.title ?? conversation.platform_conversation_id).toLowerCase().includes(text)
    );
  }, [inProject, query]);

  // Project change: when the open conversation is not in the new project, open that
  // project's first conversation, or a new chat when it has none.
  const previousProject = useRef(selectedProjectId);
  useEffect(() => {
    if (previousProject.current === selectedProjectId || conversations === undefined) return;
    previousProject.current = selectedProjectId;
    if (selectedProjectId === null || conversationId === undefined) return;
    const open = conversations.find(c => c.platform_conversation_id === conversationId);
    if (open?.codebase_id === selectedProjectId) return;
    const first = inProject[0];
    void navigate(
      first !== undefined ? `/chat/${encodeURIComponent(first.platform_conversation_id)}` : '/chat',
      { replace: true }
    );
  }, [selectedProjectId, conversations, conversationId, inProject, navigate]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] max-lg:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(280px,340px)]">
      <div className="flex min-h-0 flex-col max-lg:max-h-[35vh] [&>aside]:flex-1">
        <ConversationsColumn
          conversations={visible}
          isError={isError}
          totalCount={conversations?.length ?? 0}
          query={query}
          onQueryChange={setQuery}
        />
      </div>
      <ChatInterface key={conversationId ?? 'new'} conversationId={conversationId ?? 'new'} />
    </div>
  );
}
