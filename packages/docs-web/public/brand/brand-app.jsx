// Archon brand sheet. Static content: logo, palette, type, shape, motion.

const TOKENS = [
  ["--bg", "Page", "#F5F7FA", "#0F1218"],
  ["--surface", "Surface", "#EAEEF3", "#161A22"],
  ["--surface-2", "Cards and inputs", "#FFFFFF", "#1C2230"],
  ["--border", "Line", "#E2E6ED", "#232A36"],
  ["--border-strong", "Strong line", "#C9D0DB", "#2E3746"],
  ["--selection", "Selection", "#E4ECFB", "#1C2230"],
  ["--text", "Text", "#1A2130", "#E6E8EE"],
  ["--text-2", "Secondary text", "#5A6478", "#9AA3B2"],
  ["--text-3", "Tertiary text", "#98A1B2", "#667085"],
  ["--accent", "Accent and running", "#2563EB", "#8B9BFF"],
  ["--header-bg", "Top bar", "#1A2130", "#0F1218"],
  ["--header-fg", "Top bar text", "#F1F4F9", "#E6E8EE"],
  ["--code-bg", "Code block", "#1A2130", "#0A0C11"],
  ["--code-fg", "Code text", "#E6E9F0", "#CDD3DE"],
  ["--ok", "Done", "#16A34A", "#5FBF8F"],
  ["--warn", "Awaiting you", "#D97706", "#F0A54A"],
  ["--err", "Failed", "#DC2626", "#F07167"],
  ["--pending", "Pending text", "#98A1B2", "#667085"],
  ["--segment-pending", "Pending segment", "#D3D9E3", "#2E3746"],
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
          Archon is a minimal, AI-native interface built on columns. A navy top
          bar sits over a light page with one blue accent. Rules of 1px and
          2px separate surfaces. Corners are square and nothing casts a shadow.
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
            The wordmark is set in Archivo, weight 800. In the top bar the mark uses the top bar text color and the runner uses the top bar accent.
          </p>
        </div>
      </section>

      <section>
        <h2>Color</h2>
        <p>
          Light is the default. Dark uses the midnight palette, follows the
          system setting, and can be set by hand. All values are the exact
          handoff palette; some small status text on light surfaces is below
          WCAG AA by product decision.
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
          Archivo (400, 600, 700, 800) for all interface text, with 800 for
          headings. The mono stack is ui-monospace, Menlo, monospace, used for
          code, ids, and logs. Numerals are tabular on every screen.
        </p>
        <div className="card type-sample">
          <div><span className="label mono">28</span><span style={{ fontSize: 28, fontWeight: 800 }}>Governed automation</span></div>
          <div><span className="label mono">20</span><span style={{ fontSize: 20, fontWeight: 800 }}>Run detail</span></div>
          <div><span className="label mono">16</span><span style={{ fontSize: 16 }}>Agent message text</span></div>
          <div><span className="label mono">14</span><span style={{ fontSize: 14 }}>Interface text and controls</span></div>
          <div><span className="label mono">12</span><code>archon workflow run fix-issue</code></div>
        </div>
      </section>

      <section>
        <h2>Surfaces and shape</h2>
        <p>
          Radius is 0 everywhere and nothing casts a shadow. Major column and
          section dividers are 2px; rows are separated by 1px. A selected row
          has a 3px accent bar on the left and the selection background. The
          focus ring is a 2px accent outline with a 2px offset. Icons are
          glyph characters or Lucide-style SVG. Do not use emoji.
        </p>
        <div className="card" style={{ display: "grid", gap: 16 }}>
          <div className="header-sample">Archon</div>
          <div className="card attention">
            Context card: surface background, 1px line, and a 3px accent left
            bar when it is selected or needs attention.
          </div>
          <div className="code-sample mono">archon workflow run fix-issue</div>
        </div>
      </section>

      <section>
        <h2>Status language</h2>
        <p>
          One glyph, label, and color per state. The waiting state is a filled
          chip. A progress strip has one 4px segment per node with 2px gaps.
        </p>
        <div className="card" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="chip" style={{ color: "var(--accent-text)" }}>▶ Running</span>
            <span className="chip fill-warn">! Awaiting you</span>
            <span className="chip ok">✓ Done</span>
            <span className="chip err">✕ Failed</span>
            <span className="chip pending">○ Pending</span>
            <span className="chip pending">– Skipped</span>
          </div>
          <div className="strip">
            <span style={{ background: "var(--ok)" }} />
            <span style={{ background: "var(--ok)" }} />
            <span style={{ background: "var(--accent)" }} />
            <span style={{ background: "var(--warn)" }} />
            <span style={{ background: "var(--segment-pending)" }} />
          </div>
        </div>
      </section>

      <section>
        <h2>Motion</h2>
        <p>Use motion only when it carries meaning:</p>
        <ul className="rules">
          <li>The streaming caret: an 8px block that blinks in 1s steps while an agent writes.</li>
          <li>Live timers that count up while a node runs.</li>
          <li>The logo runner, only while a run is active.</li>
          <li>The caret and the runner are static under prefers-reduced-motion: reduce.</li>
        </ul>
      </section>

      <section>
        <h2>Rules</h2>
        <ul className="rules">
          <li>One accent color. No gradients, no shadows, no rounded corners.</li>
          <li>Build hierarchy with size and weight (800 for titles), not color.</li>
          <li>Use an 8px spacing scale. One primary action per screen.</li>
          <li>Take colors from the product tokens in packages/web/src/index.css.</li>
        </ul>
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
