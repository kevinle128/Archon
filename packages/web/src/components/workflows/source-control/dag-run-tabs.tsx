import { MessageSquare } from 'lucide-react';
import type { ReactElement } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type WorkflowRunView =
  | 'graph'
  | 'logs'
  | 'chat'
  | 'source-control'
  | 'terminal'
  | 'files-changed';

// Underline tab: the active tab carries a 2px accent bottom border, no fill or shadow.
const TAB_CLASS =
  'h-full flex-none cursor-pointer rounded-none px-3 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text-primary data-[state=active]:text-text-primary after:hidden border-0 border-b-2 border-b-transparent data-[state=active]:border-b-accent dark:data-[state=active]:border-b-accent motion-reduce:transition-none';

export interface DagRunTabsProps {
  activeView: WorkflowRunView;
  parentPlatformId: string | null;
  onValueChange: (view: WorkflowRunView) => void;
}

export function DagRunTabs(props: DagRunTabsProps): ReactElement {
  return (
    <Tabs
      value={props.activeView}
      onValueChange={(value): void => {
        props.onValueChange(value as WorkflowRunView);
      }}
    >
      <TabsList variant="line" className="h-11 items-stretch gap-1 p-0">
        <TabsTrigger className={TAB_CLASS} value="graph">
          Graph
        </TabsTrigger>
        <TabsTrigger className={TAB_CLASS} value="logs">
          Logs
        </TabsTrigger>
        <TabsTrigger className={TAB_CLASS} value="chat">
          <MessageSquare className="mr-1 h-3 w-3" />
          Chat
        </TabsTrigger>
        <TabsTrigger className={TAB_CLASS} value="source-control">
          Source Control
        </TabsTrigger>
        <TabsTrigger className={TAB_CLASS} value="files-changed">
          Files changed
        </TabsTrigger>
        <TabsTrigger className={TAB_CLASS} value="terminal">
          Terminal
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
