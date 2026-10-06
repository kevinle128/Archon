import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArtifactContent } from '@/components/run-artifacts/ArtifactContent';
import { fetchRunArtifact } from '@/lib/run-artifacts/api';

interface ArtifactViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  filename: string;
}

export function ArtifactViewerModal({
  open,
  onOpenChange,
  runId,
  filename,
}: ArtifactViewerModalProps): React.ReactElement {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !filename) return;

    setLoading(true);
    setContent(null);
    setError(null);

    async function loadArtifact(): Promise<void> {
      try {
        setContent(await fetchRunArtifact(runId, filename));
      } catch (err: unknown) {
        console.error('[ArtifactViewerModal] fetch failed', { runId, filename, err });
        setError(err instanceof Error ? err.message : 'Failed to load artifact');
      } finally {
        setLoading(false);
      }
    }

    void loadArtifact();
  }, [open, runId, filename]);

  const basename = filename.split('/').pop() ?? filename;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col max-w-3xl">
        <DialogHeader>
          <DialogTitle>{basename}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto min-h-0">
          {loading && <p className="text-sm text-text-secondary animate-pulse">Loading…</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          {content !== null && <ArtifactContent path={filename} content={content} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
