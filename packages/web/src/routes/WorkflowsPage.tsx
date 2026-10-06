import { WorkflowList } from '@/components/workflows/WorkflowList';

export function WorkflowsPage(): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkflowList />
    </div>
  );
}
