import { Search, X } from 'lucide-react';
import type { RefObject } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Marks the input as the screen's list filter: `/` focuses it and Escape clears it. */
  listFilter?: boolean;
}

export function SearchBar({
  value,
  onChange,
  placeholder,
  inputRef,
  listFilter = false,
}: SearchBarProps): React.ReactElement {
  return (
    <div className="relative flex items-center">
      <Search className="absolute left-2 h-3.5 w-3.5 text-text-tertiary" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        data-list-filter={listFilter ? '' : undefined}
        onKeyDown={(e): void => {
          if (listFilter && e.key === 'Escape') onChange('');
        }}
        onChange={(e): void => {
          onChange(e.target.value);
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-md border border-border bg-surface pl-7 pr-7 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-primary transition-colors"
      />
      {value && (
        <button
          onClick={(): void => {
            onChange('');
          }}
          className="absolute right-2 p-0.5 rounded hover:bg-surface-elevated"
        >
          <X className="h-3 w-3 text-text-tertiary" />
        </button>
      )}
    </div>
  );
}
