import { cn } from '@/lib/utils';

/** The 7x7 pixel "A". A `#` is a filled pixel. */
const ROWS = ['..###..', '.##.##.', '##...##', '#######', '##...##', '##...##', '##...##'] as const;

const CELL = 8;
const PAD = 4;
/** Crossbar row of the glyph, where the runner pixel travels. */
const CROSSBAR_ROW = 3;
/** The runner steps across crossbar columns 2 to 4. */
const RUNNER_FIRST_COLUMN = 2;

const PIXELS: readonly { x: number; y: number }[] = ROWS.flatMap((row, y) =>
  row
    .split('')
    .flatMap((cell, x) => (cell === '#' ? [{ x: PAD + x * CELL, y: PAD + y * CELL }] : []))
);

interface PixelLogoProps {
  className?: string;
  /** Show the accent runner pixel stepping across the crossbar. Static under reduced motion. */
  active?: boolean;
  /** Accessible name. Pass an empty string for a purely decorative logo. */
  label?: string;
}

export function PixelLogo({
  className,
  active = false,
  label = 'Archon',
}: PixelLogoProps): React.ReactElement {
  const decorative = label === '';
  return (
    <svg
      viewBox="0 0 64 64"
      shapeRendering="crispEdges"
      className={cn('block h-6 w-6 shrink-0', className)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      fill="currentColor"
    >
      {PIXELS.map(({ x, y }) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={CELL} height={CELL} />
      ))}
      {active && (
        <rect
          className="pixel-logo-runner"
          x={PAD + RUNNER_FIRST_COLUMN * CELL}
          y={PAD + CROSSBAR_ROW * CELL}
          width={CELL}
          height={CELL}
          fill="var(--accent)"
        />
      )}
    </svg>
  );
}
