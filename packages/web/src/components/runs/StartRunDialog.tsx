import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { WorkflowInvoker } from './WorkflowInvoker';

/** "Start run" button of the runs list. Opens the workflow launcher for the selected project. */
export function StartRunDialog({ codebaseId }: { codebaseId: string | null }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Start run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a run</DialogTitle>
          <DialogDescription>
            {codebaseId === null
              ? 'The run starts without a project. Pick a project in the top bar to run in it.'
              : 'The run starts in the project picked in the top bar.'}
          </DialogDescription>
        </DialogHeader>
        <WorkflowInvoker codebaseId={codebaseId ?? undefined} />
      </DialogContent>
    </Dialog>
  );
}
