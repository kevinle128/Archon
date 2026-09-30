// Archon brand sheet. Static content: logo, palette, type, shape, motion.

const TOKENS = [
  ["--bg", "Page", "#FFFFFF", "#0B0B0F"],
  ["--surface", "Surface", "#F7F7F8", "#141418"],
  ["--surface-2", "Raised surface", "#EFEFF1", "#1C1C22"],
  ["--border", "Border", "#E4E4E7", "#2A2A31"],
  ["--text", "Text", "#18181B", "#F4F4F5"],
  ["--text-2", "Secondary text", "#52525B", "#A1A1AA"],
  ["--text-3", "Tertiary text", "#71717A", "#8B8B94"],
  ["--accent", "Accent (indigo)", "#4F46E5", "#818CF8"],
  ["--on-accent", "Text on accent", "#FFFFFF", "#0B0B0F"],
  ["--accent-soft", "Accent tint", "#EEF0FF", "#1E1B3A"],
  ["--ok", "Success", "#15803D", "#4ADE80"],
  ["--warn", "Warning", "#B45309", "#FBBF24"],
  ["--err", "Error", "#DC2626", "#F87171"],
];

function Swatch({ token, name, light, dark, theme }) {
  return (
    <div className="swatch">
      <div className="swatch-chip" style={{ background: "var(" + token + ")" }} />
      <div className="swatch-meta">
        <span className="swatch-name">{name}</span>
        <code className="swatch-value">{token}</code>
        <code className="swatch-value">
          {theme === "dark" ? dark : light}
        </code>
      </div>
    </div>
  );
}

function currentTheme(setting) {
  if (setting !== "system") return setting;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [setting, setSetting] = React.useState("system");
  const theme = currentTheme(setting);

  React.useEffect(() => {
    if (setting === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", setting);
  }, [setting]);

  const next = { system: "light", light: "dark", dark: "system" }[setting];

  return (
    <div className="page">
      <div className="head">
        <ArchonLockup />
        <button
          type="button"
          className="theme-toggle"
          onClick={() => setSetting(next)}
        >
          Theme: {setting}
        </button>
      </div>

      <section>
        <h1>Brand foundation</h1>
        <p>
          Archon is a minimal, AI-native interface. The conversation and the
          agent are the center. The palette is neutral with one indigo accent,
          and a 1px border separates surfaces.
        </p>
      </section>

      <section>
        <h2>Logo</h2>
        <div className="card logo-row">
          <ArchonMark className="logo-big" />
          <ArchonMark className="logo-big" active />
          <p style={{ margin: 0 }}>
            A 7x7 pixel grid draws the letter A. Pixels use the text color. The
            second mark shows the runner: one pixel in the accent color that
            steps across crossbar columns 2 to 4 only while a run is active.
            The wordmark is set in Fira Sans, weight 600.
          </p>
        </div>
      </section>

      <section>
        <h2>Color</h2>
        <p>
          Light is the default. Dark follows the system setting and can be set
          by hand. The accent is indigo, darkened in light mode so small text
          on white passes WCAG AA.
        </p>
        <div className="swatches">
          {TOKENS.map(([token, name, light, dark]) => (
            <Swatch
              key={token}
              token={token}
              name={name}
              light={light}
              dark={dark}
              theme={theme}
            />
          ))}
        </div>
      </section>

      <section>
        <h2>Type</h2>
        <p>
          Fira Sans (400, 500, 600) for the interface. Fira Code (400, 500) for
          code, ids, node kinds, durations, and logs. Body text is 14 to 16px
          with a line height of 1.5 or more.
        </p>
        <div className="card type-sample">
          <div><span className="label mono">28</span><span style={{ fontSize: 28, fontWeight: 600 }}>Governed automation</span></div>
          <div><span className="label mono">20</span><span style={{ fontSize: 20, fontWeight: 600 }}>Run detail</span></div>
          <div><span className="label mono">16</span><span style={{ fontSize: 16 }}>Agent message text</span></div>
          <div><span className="label mono">14</span><span style={{ fontSize: 14 }}>Interface text and controls</span></div>
          <div><span className="label mono">12</span><code>archon workflow run fix-issue</code></div>
        </div>
      </section>

      <section>
        <h2>Surfaces and shape</h2>
        <p>
          Cards and panels use a 12px radius. Inputs and buttons use 10px.
          Status chips are full pills. The user message is a tinted bubble with
          a 16px radius, aligned right. Agent messages are plain text aligned
          left. Icons are Lucide-style SVG with a 1.5px stroke, one family, no
          emoji.
        </p>
        <div className="card" style={{ display: "grid", gap: 16 }}>
          <div><span className="bubble">Run the release check on this branch.</span></div>
          <div className="card attention">
            Context card: surface background, 1px border, and a 3px accent left
            border when it needs attention.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="chip ok">completed</span>
            <span className="chip warn">needs you</span>
            <span className="chip err">failed</span>
          </div>
        </div>
      </section>

      <section>
        <h2>Motion</h2>
        <p>Use motion only when it carries meaning:</p>
        <ul className="rules">
          <li>Streaming agent text and the 3-dot typing indicator, only while an agent works.</li>
          <li>The logo runner, only while a run is active.</li>
          <li>Progress fill, and hover and expand transitions of 150 to 250ms.</li>
          <li>Everything is static under prefers-reduced-motion: reduce.</li>
        </ul>
      </section>

      <section>
        <h2>Rules</h2>
        <ul className="rules">
          <li>One accent color. No gradients, no shadows, no background texture.</li>
          <li>Build hierarchy with size and weight, not color.</li>
          <li>Use an 8px spacing scale. One primary action per screen.</li>
          <li>Take colors from the product tokens in packages/web/src/index.css.</li>
        </ul>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
