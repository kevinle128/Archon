import type { ChangeEvent, FormEvent } from 'react';

export interface RunChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  sending: boolean;
  disabledReason: string | null;
  error: string | null;
}

export function RunChatComposer(props: RunChatComposerProps): React.ReactElement {
  const disabled = props.sending || props.disabledReason !== null;
  const placeholder = props.disabledReason ?? "Message the run's conversation…";

  return (
    <form
      aria-label="Run conversation composer"
      className="sticky bottom-0 border-t border-border bg-background p-3"
      title={props.disabledReason ?? undefined}
      onSubmit={(event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!disabled) props.onSubmit();
      }}
    >
      {props.error !== null ? (
        <p role="alert" className="mb-2 text-xs text-error">
          {props.error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message the run conversation"
          value={props.value}
          disabled={disabled}
          rows={1}
          placeholder={placeholder}
          className="min-h-11 flex-1 resize-none rounded-[10px] border border-border bg-background px-3 py-2.5 text-sm text-text-primary transition-colors duration-150 placeholder:text-text-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
            props.onValueChange(event.target.value);
          }}
        />
        <button
          type="submit"
          disabled={disabled || props.value.trim().length === 0}
          className="h-11 cursor-pointer rounded-[10px] bg-accent px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          {props.sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
