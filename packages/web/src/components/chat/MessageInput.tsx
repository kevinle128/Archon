import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type KeyboardEvent,
  type DragEvent,
  type ClipboardEvent,
} from 'react';
import { cn } from '@/lib/utils';
import { Loader2, Paperclip, X } from 'lucide-react';

/** Binary (non-text) MIME types explicitly accepted */
const ACCEPTED_BINARY_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  // application/json may be reported by browsers for .json files
  'application/json',
]);

/** Extensions for the file-picker `accept` attribute. Covers images, PDFs, and text/code files. */
const ACCEPTED_EXTENSIONS_LIST = [
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  // Documents
  '.pdf',
  // Text / markup
  '.md',
  '.txt',
  '.csv',
  '.xml',
  '.html',
  '.htm',
  // Data / config
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.log',
  // Web
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  // Systems / scripting
  '.py',
  '.rb',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.rs',
  '.swift',
  '.kt',
  '.scala',
  '.r',
  '.sql',
];

/** Comma-separated string for the file input `accept` attribute */
const ACCEPTED_EXTENSIONS = ACCEPTED_EXTENSIONS_LIST.join(',');

/** Set for O(1) extension lookup in validation */
const ACCEPTED_EXTENSIONS_SET = new Set(ACCEPTED_EXTENSIONS_LIST);

/** Returns true if the file type is accepted (any text/* or an explicitly allowed binary). */
function isAcceptedFileType(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (ACCEPTED_BINARY_MIME_TYPES.has(file.type)) return true;
  // Browsers assign empty MIME types to many code/config extensions (.md, .py, .rs, etc.)
  // Fall back to checking the file extension from the accepted list
  const dotIndex = file.name.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = file.name.slice(dotIndex).toLowerCase();
    return ACCEPTED_EXTENSIONS_SET.has(ext);
  }
  return false;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

interface MessageInputProps {
  onSend: (message: string, files?: File[]) => void;
  disabled: boolean;
  disabledReason?: string;
  /** Project the message runs against, shown as the scope chip. */
  projectName?: string;
  /** Command texts offered as chips above the field. A click fills the field; it never sends. */
  suggestions?: readonly string[];
}

export interface MessageInputHandle {
  focus: () => void;
  /** Replaces the draft with `text` and focuses the field, cursor at the end. */
  prefill: (text: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}

const messageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInputInner(
  { onSend, disabled, disabledReason, projectName, suggestions = [] }: MessageInputProps,
  ref
): React.ReactElement {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<{ file: File; id: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const prefill = useCallback((text: string): void => {
    setValue(text);
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (field === null) return;
      field.focus();
      field.setSelectionRange(text.length, text.length);
    });
  }, []);

  useImperativeHandle(ref, () => ({
    focus: (): void => {
      textareaRef.current?.focus();
    },
    prefill,
  }));

  const addFiles = useCallback((incoming: File[]): void => {
    setFileError(null);
    setFiles(prev => {
      const combined = [...prev];
      const rejections: string[] = [];
      for (const file of incoming) {
        if (combined.length >= MAX_FILES) {
          rejections.push(`Maximum ${String(MAX_FILES)} files per message`);
          break;
        }
        if (file.size > MAX_FILE_BYTES) {
          rejections.push(`"${file.name}" exceeds the 10 MB size limit`);
          continue;
        }
        if (!isAcceptedFileType(file)) {
          rejections.push(`"${file.name}" is not a supported file type`);
          continue;
        }
        combined.push({ file, id: crypto.randomUUID() });
      }
      if (rejections.length > 0) {
        setFileError(rejections.join('; '));
      }
      return combined;
    });
  }, []);

  const removeFile = useCallback((id: string): void => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setFileError(null);
  }, []);

  const handleSend = useCallback((): void => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, files.length > 0 ? files.map(f => f.file) : undefined);
    setValue('');
    setFiles([]);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  }, [value, disabled, onSend, files]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    // Auto-expand textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 200);
    textarea.style.height = `${String(newHeight)}px`;
    textarea.style.overflowY = newHeight >= 200 ? 'auto' : 'hidden';
  };

  const handleFilePickerChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) addFiles(Array.from(e.target.files));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    // Only clear dragging when leaving the outer container, not a child element
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(Array.from(e.dataTransfer.files));
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const imageItems = Array.from(e.clipboardData.items).filter(item =>
      item.type.startsWith('image/')
    );
    if (imageItems.length === 0) return;
    const pastedFiles: File[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) pastedFiles.push(file);
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      addFiles(pastedFiles);
    }
  };

  return (
    <div
      className="shrink-0 border-t-2 border-line-strong bg-background px-6 py-3"
      title={disabledReason}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {suggestions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {suggestions.map(text => (
            <button
              key={text}
              type="button"
              disabled={disabled}
              onClick={(): void => {
                prefill(text);
              }}
              className="cursor-pointer border border-line-strong bg-card px-2 py-0.5 font-mono text-xs text-text-primary hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {text.trim()}
            </button>
          ))}
        </div>
      ) : null}

      {/* File preview chips */}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {files.map(({ file, id }) => (
            <div
              key={id}
              className="flex items-center gap-1 border border-line-strong bg-surface px-2 py-1 text-xs text-text-secondary"
            >
              <span className="max-w-[140px] truncate" title={file.name}>
                {file.name}
              </span>
              <span className="text-text-tertiary">({formatBytes(file.size)})</span>
              <button
                type="button"
                onClick={() => {
                  removeFile(id);
                }}
                className="ml-1 cursor-pointer text-text-tertiary hover:text-text-primary"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* File error */}
      {fileError !== null && <p className="mb-2 text-xs text-error">{fileError}</p>}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleFilePickerChange}
        disabled={disabled}
      />

      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2">
        <button
          type="button"
          disabled={disabled || files.length >= MAX_FILES}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center border border-line-strong bg-card text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          title="Attach file"
          aria-label="Attach a file"
        >
          <Paperclip className="h-4 w-4" strokeWidth={2} />
        </button>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          aria-label="Message Archon"
          placeholder={
            dragging
              ? 'Drop files here...'
              : (disabledReason ??
                (projectName ? `Ask about ${projectName}, or type a command` : 'Message Archon...'))
          }
          rows={2}
          className={cn(
            'block min-h-11 w-full resize-none overflow-hidden border bg-card px-3 py-2 text-sm leading-normal text-text-primary placeholder:text-text-tertiary disabled:cursor-not-allowed disabled:opacity-50',
            dragging ? 'border-accent bg-selection' : 'border-line-strong'
          )}
          style={{ maxHeight: '200px' }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="inline-flex min-h-11 min-w-24 cursor-pointer items-center justify-between gap-2 bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disabled && !disabledReason ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
          ) : null}
          <span>Send</span>
          <span aria-hidden="true">↵</span>
        </button>
      </div>
      <p className="mt-1 text-[11px] text-text-tertiary">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
});

export { messageInput as MessageInput };
