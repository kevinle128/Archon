// The Archon mark: a 7x7 pixel "A". A "#" is a filled pixel. One runner pixel
// in the accent color steps across crossbar columns 2 to 4 while a run is
// active.
const ARCHON_ROWS = [
  "..###..",
  ".##.##.",
  "##...##",
  "#######",
  "##...##",
  "##...##",
  "##...##",
];
const CELL = 8;
const PAD = 4;
const CROSSBAR_ROW = 3;
const RUNNER_FIRST_COLUMN = 2;

function ArchonMark({ className, active = false }) {
  const pixels = [];
  ARCHON_ROWS.forEach((row, y) => {
    row.split("").forEach((cell, x) => {
      if (cell === "#") pixels.push({ x: PAD + x * CELL, y: PAD + y * CELL });
    });
  });
  return (
    <svg
      viewBox="0 0 64 64"
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label="Archon"
      fill="currentColor"
    >
      {pixels.map(({ x, y }) => (
        <rect key={x + "-" + y} x={x} y={y} width={CELL} height={CELL} />
      ))}
      {active && (
        <rect
          className="runner"
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

function ArchonLockup() {
  return (
    <div className="lockup">
      <ArchonMark className="lockup-mark" />
      <span>Archon</span>
    </div>
  );
}

Object.assign(window, { ArchonMark, ArchonLockup });
