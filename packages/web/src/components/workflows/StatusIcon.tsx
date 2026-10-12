import { getStatusPresentation, STATUS_TONE_TEXT_CLASS } from '@/lib/status-presentation';
import { cn } from '@/lib/utils';

/** Node/run status glyph. The glyph and color come from the shared status map. */
export function StatusIcon({ status }: { status: string }): React.ReactElement {
  const { glyph, label, tone } = getStatusPresentation(status);
  const awaiting = tone === 'waiting';
  return (
    <span
      data-slot="status-icon"
      data-tone={tone}
      // A waiting node needs an accessible name; the other glyphs sit beside a text label.
      role={awaiting ? 'img' : undefined}
      aria-label={awaiting ? 'waiting on you' : undefined}
      aria-hidden={awaiting ? undefined : true}
      title={awaiting ? undefined : label}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center text-[13px] leading-none font-bold',
        STATUS_TONE_TEXT_CLASS[tone]
      )}
    >
      {glyph}
    </span>
  );
}
