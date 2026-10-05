import { useParams } from 'react-router';
import { ChatInterface } from '@/components/chat/ChatInterface';

/**
 * The conversation list, project picker, search and "New chat" live in the app
 * sidebar, so this route renders only the conversation itself.
 */
export function ChatPage(): React.ReactElement {
  const { '*': rawConversationId } = useParams();
  const conversationId = rawConversationId ? decodeURIComponent(rawConversationId) : undefined;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatInterface key={conversationId ?? 'new'} conversationId={conversationId ?? 'new'} />
    </div>
  );
}
