import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, Loader2, ChevronDown, FolderGit2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ProjectSelector } from '@/components/sidebar/ProjectSelector';
import { useProject } from '@/contexts/ProjectContext';
import { addCodebase, getCodebaseInput } from '@/lib/api';

interface SidebarProjectsProps {
  searchQuery: string;
}

/** Project picker: shows the active project, expands to the full list, and adds projects. */
export function SidebarProjects({ searchQuery }: SidebarProjectsProps): React.ReactElement {
  const {
    selectedProjectId,
    setSelectedProjectId,
    codebases,
    isLoadingCodebases,
    isErrorCodebases,
  } = useProject();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showAddInput, setShowAddInput] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const selectedProject = codebases?.find(cb => cb.id === selectedProjectId) ?? null;

  useEffect(() => {
    if (showAddInput) addInputRef.current?.focus();
  }, [showAddInput]);

  const handleSelectProject = useCallback(
    (id: string | null): void => {
      setSelectedProjectId(id);
      setExpanded(false);
    },
    [setSelectedProjectId]
  );

  const handleAddSubmit = useCallback((): void => {
    const trimmed = addValue.trim();
    if (!trimmed || addLoading) return;

    setAddLoading(true);
    setAddError(null);

    void addCodebase(getCodebaseInput(trimmed))
      .then(codebase => {
        void queryClient.invalidateQueries({ queryKey: ['codebases'] });
        handleSelectProject(codebase.id);
        setShowAddInput(false);
        setAddValue('');
        setAddError(null);
      })
      .catch((err: Error) => {
        setAddError(err.message);
      })
      .finally(() => {
        setAddLoading(false);
      });
  }, [addValue, addLoading, queryClient, handleSelectProject]);

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter') {
        handleAddSubmit();
      } else if (e.key === 'Escape') {
        setShowAddInput(false);
        setAddValue('');
        setAddError(null);
      }
    },
    [handleAddSubmit]
  );

  return (
    <section aria-label="Projects">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-center gap-1 pr-1">
          <CollapsibleTrigger className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left text-sm text-text-secondary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary">
            <FolderGit2 className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {selectedProject?.name ?? 'All projects'}
            </span>
            <ChevronDown
              className="h-4 w-4 shrink-0 text-text-tertiary"
              strokeWidth={1.5}
              aria-hidden
            />
          </CollapsibleTrigger>
          <button
            type="button"
            onClick={(): void => {
              setShowAddInput(prev => !prev);
              setAddError(null);
              setAddValue('');
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-surface-elevated hover:text-text-primary"
            title="Add project"
            aria-label="Add project"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {showAddInput && (
          <div className="px-3 pb-1">
            <div className="flex items-center gap-1">
              <input
                ref={addInputRef}
                value={addValue}
                onChange={(e): void => {
                  setAddValue(e.target.value);
                }}
                onKeyDown={handleAddKeyDown}
                onBlur={(): void => {
                  // Close on blur only if empty and no error
                  if (!addValue.trim() && !addError) {
                    setShowAddInput(false);
                  }
                }}
                placeholder="GitHub URL or local path"
                aria-label="GitHub URL or local path"
                disabled={addLoading}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none disabled:opacity-50"
              />
              {addLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
            </div>
            {addError && <p className="mt-1 line-clamp-2 text-xs text-error">{addError}</p>}
          </div>
        )}

        <CollapsibleContent>
          <div className="max-h-[35vh] overflow-y-auto">
            <ProjectSelector
              projects={codebases ?? []}
              selectedProjectId={selectedProjectId}
              onSelectProject={handleSelectProject}
              isLoading={isLoadingCodebases}
              searchQuery={searchQuery}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {isErrorCodebases && (
        <p className="px-3 text-xs text-error">Failed to load projects, retrying</p>
      )}
    </section>
  );
}
