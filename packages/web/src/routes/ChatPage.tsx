import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { AllConversationsView } from '@/components/sidebar/AllConversationsView';
import { SearchBar } from '@/components/sidebar/SearchBar';

/** Conversation list on the left, the selected conversation on the right. */
export function ChatPage(): React.ReactElement {
  const { '*': rawConversationId } = useParams();
  const conversationId = rawConversationId ? decodeURIComponent(rawConversationId) : undefined;
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col gap-2 overflow-auto border-line-strong px-3 py-3 max-md:max-h-[35vh] max-md:border-b-2 md:border-r-2">
        <button
          type="button"
          onClick={(): void => {
            void navigate('/chat');
          }}
          className="flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 border border-line-strong bg-background px-4 text-sm font-semibold text-text-primary hover:bg-selection"
        >
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          New chat
        </button>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search..."
          listFilter
        />
        <AllConversationsView searchQuery={searchQuery} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <ChatInterface key={conversationId ?? 'new'} conversationId={conversationId ?? 'new'} />
      </div>
    </div>
  );
}
