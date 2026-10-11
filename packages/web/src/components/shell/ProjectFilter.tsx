import type { CodebaseResponse } from '@/lib/api';
import { projectDisplayName } from '@/lib/projects/display-name';

/** Select value for "All projects". Codebase IDs never equal this value. */
const ALL_PROJECTS = '';

interface ProjectFilterProps {
  codebases: readonly Pick<CodebaseResponse, 'id' | 'name' | 'repository_url'>[];
  /** Selected codebase ID, or null for all projects. */
  value: string | null;
  onChange: (codebaseId: string | null) => void;
}

/** Top bar project filter. Its value scopes every screen. */
export function ProjectFilter({
  codebases,
  value,
  onChange,
}: ProjectFilterProps): React.ReactElement {
  return (
    <label className="flex h-12 flex-none items-center gap-2 border-l border-header-line px-4 text-xs whitespace-nowrap text-header-muted max-md:ml-auto">
      <span className="max-md:sr-only">Project</span>
      <select
        value={value ?? ALL_PROJECTS}
        onChange={(event): void => {
          onChange(event.target.value === ALL_PROJECTS ? null : event.target.value);
        }}
        className="h-[30px] max-w-[240px] cursor-pointer max-md:max-w-[120px] border border-header-line bg-header-bg px-2 text-[13px] font-semibold text-header-fg"
      >
        <option value={ALL_PROJECTS}>All projects</option>
        {codebases.map(codebase => (
          <option key={codebase.id} value={codebase.id}>
            {projectDisplayName(codebase)}
          </option>
        ))}
      </select>
    </label>
  );
}
