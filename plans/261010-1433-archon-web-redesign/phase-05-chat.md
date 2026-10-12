# Phase 05: Chat

Status: done. Depends on: 02. Effort: 1.5d. Can run in parallel with 03, 04, 06, 07.

Delivery notes: the bubble renders its own tool, error and run cards so its memo comparator stays correct. The context panel reads runs of this chat from the shared recent-runs query (`parent_conversation_id` or `conversation_id`), and is hidden below 1024px.

## Context

- Spec: README "Screens > 3. Chat". Behavior: `Archon Chat.dc.html` `renderVals()` (`convs`, `runCard`, `newChat`, `suggestions`, `commands`, `inputKey`). The prototype `reply()` function fakes server replies; it is not a client parser and must not be copied.
- Today: `routes/ChatPage.tsx` -> `components/chat/ChatInterface.tsx` with `ChatHeader.tsx` (menu "Conversation actions": copy path, open in IDE via `ide-uri`, hidden in Docker), `MessageList.tsx`, `MessageBubble.tsx` (+ test), `MessageInput.tsx` (`aria-label="Message Archon"`, file attachments, "Attach a file", "Send message"), `ToolCallCard.tsx` (+ test), `WorkflowProgressCard.tsx` (inline run card, uses run actions), `ErrorCard.tsx`, `LockIndicator.tsx`. Conversation list after phase 02: `components/sidebar/AllConversationsView.tsx` + `SearchBar.tsx` hosted in the Chat left column; rows `components/conversations/ConversationItem.tsx` ("Rename conversation", "Delete conversation"). `AllConversationsView` uses `SidebarSectionHeader`.
- Streaming: `hooks/useSSE.ts` on `/api/stream/<conversationId>`.
- Commands: the orchestrator handles `/status`, `/workflow list`, `/workflow run <name> <input>`, `/workflow cancel <id>`, and more (`packages/core/src/handlers/command-handler.ts`). The client sends text unchanged (`POST /api/conversations/:id/message`).
- Runs per conversation: `listWorkflowRuns({ conversationId })`.

## Requirements

1. Columns `minmax(240px,300px) | 1fr | minmax(280px,340px)`.
2. Conversations column: "Chat" + secondary "New chat" (creates a conversation in the filter project via `createConversation(selectedProjectId)`; with "All projects" it creates one with no project, as today). Filter input (`data-list-filter`) by title. List filtered by the project filter. Row (`ListRow`): project line, title 14px/700 + time, "▶ N run(s) active" (accent, 11px/700) when the conversation has running runs. Keep rename and delete on row hover/focus (kept feature). Changing the project selects the first conversation of that project if the current one is outside it.
3. Thread: header project + title Archivo 800 22px; keep the "Conversation actions" menu (copy path, open in IDE) and `LockIndicator` in the header. Messages grid `64px 1fr`: who ("You" text / "Archon" accent, 12px/800) + time; text 14.5px/1.6, user text 600, `pre-wrap`. Keep markdown rendering, `ToolCallCard`, `ErrorCard`, and artifact links in `MessageBubble`, restyled. Empty state "Ask about <repo>, or start a workflow." + one explanation line. Run card = `WorkflowProgressCard` restyled (white, 1px strong border, max 520px, id, workflow, status chip, `ProgressStrip`, "N of M nodes", "Open in Runs →" to `/runs/<id>`). "Archon is replying…" italic while the SSE stream has no text yet.
4. Composer (2px strong top border): suggestion chips (mono 12px, 1px strong border) that prefill the input: `/workflow run <first recommended workflow> `, `/status`, `/workflow list`. 2-row textarea + primary "Send ↵"; Enter sends, Shift+Enter new line. Keep attachments ("Attach a file", file chips with "Remove <name>").
5. Context panel: Project / Branch / Path (from the conversation's codebase and cwd); "Runs from this chat" (runs of this conversation with live `ProgressStrip`, each links to `/runs/<id>`); "Commands" list: `/workflow run <name> <input>` "Start a workflow", `/status` "Runs in this project", `/workflow list` "List available workflows", `/workflow cancel <run id>` "Cancel a run". Click prefills the command text before the first `<`.
6. The client never parses message text. Chips and commands only set the textarea value.

## Kept features (new home)

| Feature                    | New home                                  |
| -------------------------- | ----------------------------------------- |
| Conversation rename/delete | Row actions in the Conversations column   |
| Copy path, open in IDE     | Thread header "Conversation actions" menu |
| Attachments                | Composer                                  |
| Lock indicator             | Thread header                             |
| Tool call and error cards  | Thread messages                           |

## Files

Create: `src/components/chat/ConversationsColumn.tsx`, `ChatContextPanel.tsx`, `ComposerSuggestions.tsx`; `src/lib/chat/queries.ts` (`useConversationRuns`); `src/lib/chat/chat-commands.ts` (static list of command templates and descriptions, no parsing); tests beside each.

Modify: `src/routes/ChatPage.tsx`, `ChatInterface.tsx`, `ChatHeader.tsx`, `MessageList.tsx` (run links via `buildRunPath`), `MessageBubble.tsx`, `MessageInput.tsx`, `ToolCallCard.tsx`, `WorkflowProgressCard.tsx` (run link via `buildRunPath`), `ErrorCard.tsx`, `LockIndicator.tsx`, `src/components/conversations/ConversationItem.tsx`.

Move then delete: `src/components/sidebar/AllConversationsView.tsx`, `SearchBar.tsx`, `SidebarSectionHeader.tsx` (logic moves into `ConversationsColumn.tsx`). After this phase `src/components/sidebar/` holds no file used by Chat.

## Steps

1. Build `ConversationsColumn` from `AllConversationsView` + `SearchBar` logic.
2. Restyle thread components; keep their props.
3. Add the context panel and suggestions.
4. Check streaming, attachments, rename, delete, IDE menu, light/dark, 1440/1024.

## Tests

- Add: `ConversationsColumn.test.tsx` (project filter, search, select-first on project change, active-run marker), `ChatContextPanel.test.tsx` (runs list, command prefill), `chat-commands.test.ts` (prefill text), `ComposerSuggestions.test.tsx`.
- Update: `MessageBubble.test.tsx`, `ToolCallCard.test.tsx` (class or markup assertions only).
- Keep: `lib/chat-message-reducer.test.ts`, `chat-header.test.ts`, `message-cache.test.ts`, `api.conversations.test.ts`.
- e2e: `shell.spec.ts` clicks the Chat nav link only; no Chat-specific spec exists. No e2e change expected; add none in this phase (phase 08 adds a smoke step).

## Validation

`bun run --cwd packages/web test`, `bun run type-check`, `bun run lint`, manual send of `/status` and `/workflow list` on a dev server: the orchestrator replies; the client sends the raw text.

## Risks

| Risk                                                             | L x I      | Mitigation                                                                 |
| ---------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| Someone adds client-side command handling to match the prototype | Med x High | Requirement 6; reviewer checks `sendMessage` gets the raw textarea value.  |
| Runs-per-conversation polling cost                               | Low x Low  | Query only the open conversation; refetch on `workflow_status` SSE events. |

## Rollback

Revert the PR; the phase 02 relocation layout returns.
