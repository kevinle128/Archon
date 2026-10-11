import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage } from '@/lib/types';
import { MessageBubble } from './MessageBubble';

const TIMESTAMP = Date.parse('2026-09-30T11:48:00.000Z');

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', role: 'assistant', content: 'Done.', timestamp: TIMESTAMP, ...overrides };
}

describe('MessageBubble', () => {
  test('renders a user message in bold under a "You" byline', () => {
    const markup = renderToStaticMarkup(
      <MessageBubble message={message({ role: 'user', content: 'Run a review' })} />
    );
    expect(markup).toContain('data-role="user"');
    expect(markup).toContain('font-semibold');
    expect(markup).toContain('Run a review');
    expect(markup).toContain('You');
  });

  test('renders an agent message as plain text under an Archon byline', () => {
    const markup = renderToStaticMarkup(
      <MessageBubble message={message({})} assistantLabel="codex" />
    );
    expect(markup).toContain('data-role="assistant"');
    expect(markup).toContain('Archon');
    expect(markup).toContain('codex');
    expect(markup).not.toContain('Archon is typing');
  });

  test('shows the typing indicator only while the agent is streaming', () => {
    const streaming = renderToStaticMarkup(
      <MessageBubble message={message({ content: '', isStreaming: true })} />
    );
    expect(streaming).toContain('Archon is typing');
    const finished = renderToStaticMarkup(<MessageBubble message={message({})} />);
    expect(finished).not.toContain('Archon is typing');
  });
});
