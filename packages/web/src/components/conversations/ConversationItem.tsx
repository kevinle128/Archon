import { useState, useRef, useCallback } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Pencil, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationResponse } from '@/lib/api';
import { deleteConversation, updateConversation } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ConversationItemProps {
  conversation: ConversationResponse;
  badge?: number;
  projectName?: string;
  status?: 'idle' | 'running' | 'failed';
}

export function ConversationItem({
  conversation,
  badge,
  projectName,
  status = 'idle',
}: ConversationItemProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams<{ conversationId: string }>();

  const displayName = conversation.title ?? 'Untitled conversation';

  const lastActivity = conversation.last_activity_at
    ? new Date(
        conversation.last_activity_at.endsWith('Z')
          ? conversation.last_activity_at
          : conversation.last_activity_at + 'Z'
      ).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'No activity';

  const handleDelete = useCallback((): void => {
    setDeleteError(null);
    void deleteConversation(conversation.platform_conversation_id)
      .then(() => {
        setDeleteDialogOpen(false);
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        if (params.conversationId === conversation.platform_conversation_id) {
          void navigate('/');
        }
      })
      .catch((err: unknown) => {
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete conversation');
        setDeleteDialogOpen(true);
      });
  }, [conversation.platform_conversation_id, queryClient, navigate, params.conversationId]);

  const handleRenameSubmit = useCallback((): void => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conversation.title) {
      setRenameError(null);
      void updateConversation(conversation.platform_conversation_id, { title: trimmed })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        })
        .catch((err: unknown) => {
          setRenameError(err instanceof Error ? err.message : 'Failed to rename conversation');
          setIsEditing(true);
        });
    } else {
      setRenameError(null);
    }
    setIsEditing(false);
  }, [editValue, conversation.id, conversation.title, queryClient]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleRenameSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setRenameError(null);
        setIsEditing(false);
      }
    },
    [handleRenameSubmit]
  );

  const projectSlash = projectName?.lastIndexOf('/') ?? -1;
  const projectOwner =
    projectName !== undefined && projectSlash > 0 ? projectName.slice(0, projectSlash + 1) : '';
  const projectRepo =
    projectName === undefined ? 'No project' : projectName.slice(projectSlash + 1);

  return (
    <NavLink
      to={`/chat/${encodeURIComponent(conversation.platform_conversation_id)}`}
      className={({ isActive }): string =>
        cn(
          'group relative flex w-full flex-col gap-1 border-b border-l-[3px] border-b-border px-4 py-3 text-text-primary no-underline hover:bg-selection',
          isActive ? 'border-l-accent bg-selection' : 'border-l-transparent'
        )
      }
    >
      <span className="truncate pr-12 text-[11px] font-bold text-text-secondary">
        <span className="font-normal">{projectOwner}</span>
        <span className="text-text-primary">{projectRepo}</span>
        {conversation.platform_type !== 'web' ? (
          <span className="ml-2 font-normal tracking-wider uppercase">
            {conversation.platform_type}
          </span>
        ) : null}
      </span>
      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e): void => {
            setEditValue(e.target.value);
          }}
          onBlur={handleRenameSubmit}
          onKeyDown={handleKeyDown}
          onClick={(e): void => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-label="Conversation title"
          className="w-full border-b border-primary bg-transparent text-sm font-bold text-text-primary outline-none"
        />
      ) : (
        <span className="flex w-full items-baseline gap-2">
          <span
            className="min-w-0 flex-1 text-sm leading-[1.35] font-bold break-words"
            title={conversation.title ?? 'Untitled conversation'}
          >
            {displayName}
          </span>
          <span className="flex-none text-xs text-text-secondary">{lastActivity}</span>
        </span>
      )}
      {renameError && <span className="text-[11px] text-error">{renameError}</span>}
      {status === 'running' ? (
        <span className="text-[11px] font-bold text-status-running">▶ Run active</span>
      ) : status === 'failed' ? (
        <span className="text-[11px] font-bold text-status-failed">✕ Last run failed</span>
      ) : null}
      {!isEditing && (
        <>
          <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
            <button
              onClick={(e): void => {
                e.preventDefault();
                e.stopPropagation();
                setEditValue(conversation.title ?? '');
                setRenameError(null);
                setIsEditing(true);
                setTimeout(() => {
                  inputRef.current?.focus();
                  inputRef.current?.select();
                }, 0);
              }}
              className="p-1 hover:bg-card"
              aria-label="Rename conversation"
              title="Rename conversation"
            >
              <Pencil className="h-3.5 w-3.5 text-text-tertiary hover:text-primary" />
            </button>
            <button
              onClick={(e): void => {
                e.preventDefault();
                e.stopPropagation();
                setDeleteError(null);
                setDeleteDialogOpen(true);
              }}
              className="p-1 hover:bg-card"
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              <Trash2 className="h-3.5 w-3.5 text-text-tertiary hover:text-error" />
            </button>
          </div>
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this conversation and its messages. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {deleteError && <p className="text-sm text-error px-1">{deleteError}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-3 bottom-3 flex h-5 min-w-5 items-center justify-center bg-error px-1 text-[10px] font-semibold text-on-solid">
          {badge > 99 ? '99+' : String(badge)}
        </span>
      )}
    </NavLink>
  );
}
