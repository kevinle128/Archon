# Accessibility review — readable agent transcript

Reviewer lens: accessibility. Date: 2026-09-10.
Scope: `DESIGN.md`, `EXPERIENCE.md`, and the three mockups in `mockups/`.
Token sources read: `packages/web/src/index.css` (Legacy) and `packages/web/src/experiments/console/theme.css` (Console).

This review changes no token and no source file.

---

## 1. Method

Every ratio in this report comes from the OKLCH token values in the two CSS files. No ratio is copied from `DESIGN.md`.

The steps are:

1. Convert OKLCH to OKLab.
2. Convert OKLab to linear sRGB.
3. Apply the CSS Color 4 gamut-mapping algorithm when the colour is outside sRGB.
4. Encode to 8-bit sRGB.
5. Compute the WCAG relative luminance `Y`.
6. Compute the ratio `(Y_light + 0.05) / (Y_dark + 0.05)`.

### Worked example — Legacy `--text-tertiary`

Token: `--text-tertiary: oklch(0.45 0.01 260)` (`index.css:17`).

```
a = 0.01 × cos(260°) = -0.0017365
b = 0.01 × sin(260°) = -0.0098481

l' = 0.45 + 0.3963377774(-0.0017365) + 0.2158037573(-0.0098481) = 0.4471777
m' = 0.45 - 0.1055613458(-0.0017365) - 0.0638541728(-0.0098481) = 0.4508119
s' = 0.45 - 0.0894841775(-0.0017365) - 1.2914855480(-0.0098481) = 0.4628735

l = l'³ = 0.0894259     m = m'³ = 0.0916227     s = s'³ = 0.0991718

R = 4.0767416621(0.0894259) - 3.3077115913(0.0916227) + 0.2309699292(0.0991718) = 0.08286
G = -1.2684380046(0.0894259) + 2.6097574011(0.0916227) - 0.3413193965(0.0991718) = 0.08916
B = -0.0041960863(0.0894259) - 0.7034186147(0.0916227) + 1.7076147010(0.0991718) = 0.10877
```

All three channels are inside 0–1. Gamut mapping is not needed.

```
Encode:  R8 = 82   G8 = 85   B8 = 91        →  #52555B
Decode:  0.08289, 0.08920, 0.10702
Y = 0.2126(0.08289) + 0.7152(0.08920) + 0.0722(0.10702) = 0.090462
```

Legacy `--surface: oklch(0.18 0.008 260)` gives `#101215`, `Y = 0.005969`.

```
Ratio = (0.090462 + 0.05) / (0.005969 + 0.05) = 0.140462 / 0.055969 = 2.51 : 1
```

### Two notes on accuracy

**Gamut mapping.** Six tokens fall outside sRGB: Legacy `--success`, `--node-command`, `--accent-bright`; Console `--success`, `--error`, `--brand-magenta`. For these, a naive clip and the CSS gamut-map give different results. The difference is small (0.15 or less in the ratio) and no pass/fail verdict changes. **All three tokens named in the claims are inside sRGB.** Gamut mapping cannot move them. Their ratios are exact.

**Alpha compositing.** Browsers blend alpha in gamma-encoded sRGB, not in linear light. All composited values below use gamma-encoded blending. A linear-light blend makes dark-over-dark results too bright, and it changes verdicts — see finding B-3.

---

## 2. Verification of the three claims

| #   | Claim                                           | Computed                          | Verdict                          |
| --- | ----------------------------------------------- | --------------------------------- | -------------------------------- |
| 1   | Legacy `--text-tertiary` on `--surface` = 2.5:1 | **2.51:1**                        | **Correct**                      |
| 2   | `--node-prompt` chips = 3.8:1                   | **3.74:1 Legacy, 3.89:1 Console** | **Correct in effect, imprecise** |
| 3   | Legacy `--error` badge = 4.3:1                  | **4.29:1**                        | **Correct**                      |

**Claim 2 detail.** `DESIGN.md:324` states "3.8:1 on both surfaces". This is one rounded number for two different values. The two surfaces have different `--surface-elevated` values (Legacy `oklch(0.22 0.01 260)`, Console `oklch(0.205 0.009 265)`), so the ratios must differ. Neither value is 3.8. The conclusion does not change: both fail 4.5:1.

**Token existence.** Every token named in the three claims exists on the surface named. `--node-prompt` needs one note: `console/theme.css` does not declare it. The Console gets it by cascade from `index.css :root`, because `.console-root` is a descendant of `:root`. The `DESIGN.md` comment "Console inherits" is correct.

---

## 3. All measured pairs

Sizes and weights are read from the mockup CSS. The transcript container `.tx` sets `font-size: 12px`. Weight is 400 unless stated.

Threshold rule used: **4.5:1** for text (WCAG 1.4.3), **3:1** for large-scale text and for non-text UI components and graphical objects (WCAG 1.4.11).

> **Threshold correction.** The review brief gives large-scale text as "≥18.66px regular or ≥14px bold". This conflates points and pixels. WCAG defines large scale as **18pt (≈24px) regular, or 14pt bold (≈18.66px)**. The correction changes no verdict here: the largest text in the transcript is the assistant prose at 12.5px, and the largest bold text is the 12px status glyph. **Nothing in the transcript is large-scale text under either reading.** Every text row below is judged at 4.5:1.

### 3.1 Legacy surface (`index.css`)

| Token              | Resolved  | On                   | Ratio      | Size / weight                        | Threshold       | Result              |
| ------------------ | --------- | -------------------- | ---------- | ------------------------------------ | --------------- | ------------------- |
| `--text-primary`   | `#E6E8EB` | `--surface`          | 15.28:1    | 12px / 400 headline                  | 4.5             | Pass                |
| `--text-secondary` | `#8C8F95` | `--surface`          | 5.79:1     | 12px / 400 path head                 | 4.5             | Pass                |
| `--text-secondary` | `#8C8F95` | `--surface-inset`    | 6.26:1     | 11.5px / 400 body box                | 4.5             | Pass                |
| `--text-tertiary`  | `#52555B` | `--surface`          | **2.51:1** | 11px / 400 badge                     | 4.5             | **Fail**            |
| `--text-tertiary`  | `#52555B` | `--surface`          | **2.51:1** | 12px / 700 `–` glyph                 | 4.5             | **Fail**            |
| `--text-tertiary`  | `#52555B` | `--surface-hover`    | **2.21:1** | 11px / 400 badge, row hovered        | 4.5             | **Fail**            |
| `--text-tertiary`  | `#52555B` | `--surface-inset`    | **2.71:1** | 11.5px / 400 diff line no., raw JSON | 4.5             | **Fail**            |
| `--text-tertiary`  | `#52555B` | `--surface`          | **2.51:1** | 10px / 400 chevron `▶`               | 3.0 (graphical) | **Fail**            |
| `--success`        | `#00AB60` | `--surface`          | 6.25:1     | 12px / 700 `✓` glyph                 | 4.5             | Pass                |
| `--error`          | `#DE3B3D` | `--surface`          | **4.29:1** | 11px / 400 `exit 101` badge          | 4.5             | **Fail**            |
| `--error`          | `#DE3B3D` | `--surface`          | **4.29:1** | 12px / 700 `✕` glyph                 | 4.5             | **Fail** (see B-2)  |
| `--error`          | `#DE3B3D` | `--surface-hover`    | **3.78:1** | 11px / 400 badge, row hovered        | 4.5             | **Fail**            |
| `--error`          | `#DE3B3D` | `--surface-inset`    | 4.63:1     | 11.5px / 400 `−` diff line           | 4.5             | Pass                |
| `--accent-bright`  | `#4CA9FF` | `--surface`          | 7.53:1     | 12px / 700 `◐` glyph                 | 4.5             | Pass                |
| `--warning`        | `#E49E22` | `--surface`          | 8.23:1     | 11.5px / 400 `⊘` blocked item        | 4.5             | Pass                |
| `--node-bash`      | `#E49E22` | `--surface-elevated` | 7.58:1     | 11px / 400 chip text                 | 4.5             | Pass                |
| `--node-command`   | `#0089EB` | `--surface-elevated` | 4.75:1     | 11px / 400 chip text                 | 4.5             | Pass                |
| `--node-prompt`    | `#7D5EE0` | `--surface-elevated` | **3.74:1** | 11px / 400 chip text                 | 4.5             | **Fail**            |
| `--node-approval`  | `#FB794A` | `--surface-elevated` | 6.53:1     | 11px / 400 chip text                 | 4.5             | Pass                |
| `--node-prompt`    | `#7D5EE0` | `--surface-inset`    | 4.39:1     | 11.5px / 400 code keyword            | 4.5             | **Fail** (marginal) |

### 3.2 Console surface (`console/theme.css`)

| Token              | Resolved  | On                   | Ratio      | Size / weight                 | Threshold       | Result   |
| ------------------ | --------- | -------------------- | ---------- | ----------------------------- | --------------- | -------- |
| `--text-primary`   | `#F5F7FA` | `--surface`          | 17.72:1    | 12px / 400 headline           | 4.5             | Pass     |
| `--text-secondary` | `#A8ACB6` | `--surface`          | 8.37:1     | 12px / 400 path head          | 4.5             | Pass     |
| `--text-tertiary`  | `#70757F` | `--surface`          | **4.11:1** | 11px / 400 badge              | 4.5             | **Fail** |
| `--text-tertiary`  | `#70757F` | `--surface`          | **4.11:1** | 12px / 700 `–` glyph          | 4.5             | **Fail** |
| `--text-tertiary`  | `#70757F` | `--surface-hover`    | **3.69:1** | 11px / 400 badge, row hovered | 4.5             | **Fail** |
| `--text-tertiary`  | `#70757F` | `--surface-inset`    | **4.35:1** | 11.5px / 400 raw JSON         | 4.5             | **Fail** |
| `--text-tertiary`  | `#70757F` | `--surface`          | 4.11:1     | 10px / 400 chevron `▶`        | 3.0 (graphical) | Pass     |
| `--success`        | `#00CE9D` | `--surface`          | 9.34:1     | 12px / 700 `✓` glyph          | 4.5             | Pass     |
| `--error`          | `#FF4F65` | `--surface`          | 5.94:1     | 11px / 400 `exit 101` badge   | 4.5             | Pass     |
| `--error`          | `#FF4F65` | `--surface-hover`    | 5.29:1     | 11px / 400 badge, row hovered | 4.5             | Pass     |
| `--running`        | `#3DACFE` | `--surface`          | 7.72:1     | 12px / 700 `◐` glyph          | 4.5             | Pass     |
| `--warning`        | `#E7B643` | `--surface`          | 10.11:1    | 11.5px / 400 `⊘` blocked item | 4.5             | Pass     |
| `--node-bash`      | `#E49E22` | `--surface-elevated` | 7.87:1     | 11px / 400 chip text          | 4.5             | Pass     |
| `--node-command`   | `#0089EB` | `--surface-elevated` | 4.96:1     | 11px / 400 chip text          | 4.5             | Pass     |
| `--node-prompt`    | `#7D5EE0` | `--surface-elevated` | **3.89:1** | 11px / 400 chip text          | 4.5             | **Fail** |
| `--node-approval`  | `#FB794A` | `--surface-elevated` | 6.78:1     | 11px / 400 chip text          | 4.5             | Pass     |

### 3.3 Composited values (gamma-encoded blend)

| Item                                      | Surface                     | Resolved  | Ratio      | Size / weight           | Threshold | Result       |
| ----------------------------------------- | --------------------------- | --------- | ---------- | ----------------------- | --------- | ------------ |
| `--accent-ring` focus ring (magenta @30%) | Console `--surface`         | `#4F0B51` | **1.36:1** | 2px outline             | 3.0       | **Fail**     |
| `--accent-ring` focus ring (magenta @30%) | Console `--surface-hover`   | `#56145A` | **1.34:1** | 2px outline             | 3.0       | **Fail**     |
| `outline-ring/50` (`--ring` @50%)         | Legacy `--surface`          | `#105286` | **2.30:1** | browser default outline | 3.0       | **Fail**     |
| Folded todo `✓` at opacity 0.55           | Legacy `--surface`          | `#07673E` | **2.70:1** | 12px / 700              | 4.5       | **Fail**     |
| Folded todo `✓` at opacity 0.55           | Console `--surface`         | `#077A5E` | **3.58:1** | 12px / 700              | 4.5       | **Fail**     |
| Chip border `--node-prompt` @45%          | Legacy `--surface-elevated` | `#453976` | 1.73:1     | 1px border              | see N-4   | Not a target |
| Chip border `--node-command` @40%         | Legacy `--surface-elevated` | `#0E4771` | 1.78:1     | 1px border              | see N-4   | Not a target |
| Chip border `--node-bash` @40%            | Legacy `--surface-elevated` | `#6A4F20` | 2.26:1     | 1px border              | see N-4   | Not a target |
| Chip border `--node-approval` @40%        | Legacy `--surface-elevated` | `#734130` | 2.08:1     | 1px border              | see N-4   | Not a target |

Console chip borders differ by 0.02 or less from Legacy. They are not listed again.

---

## 4. What the failing tokens carry

This section answers "what information is lost", not "how bad is the number".

**`--text-tertiary` carries two different classes of information. They must not be judged together.**

_Class 1 — secondary information._ Duration badges, count badges, `+n −m`, the body bar facts, the occurrence header, key-value keys, the chevron, the todo phase label, pending todo items, diff line numbers, and the folded `todo updated` headline. A reader who cannot read these still knows which tool ran, on what, and whether it succeeded. The row headline is `--text-primary` at 15.28:1, and the `✓` glyph is `--success` at 6.25:1.

_Class 2 — primary outcome information._ The `–` glyph and the `output missing` / `output unknown` badge. `EXPERIENCE.md:120-121` puts both in `--text-tertiary`. **On Legacy this whole outcome state sits at 2.51:1.** A reader who cannot read tertiary text cannot tell "this tool call has no known result" from "this tool call is fine". This is not secondary information. It is one of the five outcomes the feature exists to report.

**`--error` carries the failure signal.** The `✕` glyph and the `exit n` badge. On Legacy both sit at 4.29:1, and at 3.78:1 while the reader hovers the row. On Console both pass.

**`--node-prompt` carries the chip text for the `search` and `glob` families.** The chip text is the tool name, for example `Grep`. The reader still gets the tool name from the headline context and the body. The chip colour is the only carrier of the resolved family — see N-3.

**Correct summary:** on Legacy, the transcript's failure signal is marginal (4.29:1) and its unknown signal is not readable (2.51:1). Most other tertiary text is secondary. The transcript is not "unreadable". Its headlines, paths, assistant prose, body text, and three of four status glyphs all pass comfortably.

---

## 5. `DESIGN.md` accuracy

`DESIGN.md:312-325` records ten ratios. Nine are correct within rounding. The table is a good-faith measurement, not a guess.

Two problems:

1. **Row "node-prompt chip" gives one number for two surfaces.** See claim 2 above.
2. **Open Question 1 offers the remedy for Legacy only.** It says: "use `--text-secondary` for 11px transcript text on **Legacy only**?" But Console `--text-tertiary` is 4.11:1 on `--surface` and 3.69:1 on `--surface-hover`. Console fails too. The table bolds the Console value, so the spine knows. The question does not offer Console a fix.

A third problem is in the frontmatter, not the table. See B-1.

---

## 6. BLOCKING findings

A finding blocks when (a) an interactive affordance falls below 3:1, or an outcome state falls below 4.5:1, or (b) the spine records a false fact that will pass into the build.

### B-1 — The Console focus ring fails, and `DESIGN.md` records the wrong value for it

`console/theme.css:153-157` sets the focus ring:

```css
.console-root :focus-visible {
  outline: 2px solid var(--accent-ring);
  outline-offset: 2px;
}
```

`--accent-ring` is `oklch(0.64 0.295 330 / 0.3)` — brand magenta at **30% alpha** (`theme.css:68`).

Composited over `--surface`, this gives `#4F0B51`, `Y = 0.00994`, ratio **1.36:1**. WCAG 1.4.11 requires 3:1 for a focus indicator. The ring fails by a wide margin. A keyboard reader cannot see which row has focus.

`DESIGN.md:54` records this as:

```yaml
focus-console: '#E400DE' # --accent-ring = brand magenta at 30% alpha, 2px outline, offset 2px
```

`#E400DE` is **full-opacity** magenta. That colour gives 4.85:1 and would pass. The comment names the 30% alpha token, but the hex ignores the alpha. `EXPERIENCE.md:162` then repeats `{colors.focus-console}` as the confirmed focus treatment.

The spine therefore records a passing value for a ring that renders at 1.36:1. A builder who trusts the frontmatter will ship an invisible focus ring and believe it was specified.

_Note:_ Legacy is no better, but for a different reason. `index.css:179` applies `outline-ring/50` to every element. That sets an outline **colour** only, at `--ring` 50% alpha, which composites to 2.30:1. It sets no width and no style. Only `mockups/key-transcript-states.html:45` defines a real 2px `--accent-bright` outline (7.53:1, passes). Neither room mockup defines a focus rule at all. The passing treatment exists only in the states sheet.

**Decision needed. Options:**

| Option                                               | Effect                                          | Cost                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Raise `--accent-ring` alpha in `theme.css`        | Fixes every focused control in the Console      | Changes a shared brand token; the magenta at full opacity is 4.85:1                                                                                       |
| B. Override the focus colour for the transcript only | Fixes the transcript; rest of Console unchanged | The spine's rule "the transcript never declares a colour that is not already a variable" still holds if `--running` (7.72:1) or `--brand-magenta` is used |
| C. Correct `DESIGN.md:54` only, and accept 1.36:1    | Removes the false fact; keeps the failure       | Focus stays invisible on Console                                                                                                                          |
| D. Accept, and record the failure in Open Questions  | Honest; no code change                          | Focus stays invisible on both surfaces                                                                                                                    |

I do not choose. Options A and B touch a token, which is outside my remit.

### B-2 — Legacy `--error` is below 4.5:1 for the `exit n` badge, and `DESIGN.md` Open Question 3 uses the wrong threshold

Measured: 4.29:1 on `--surface`, and **3.78:1 on `--surface-hover`**. The hover value matters, because a mouse reader hovers the row they are reading.

`DESIGN.md:461-462` says: "the `✕` glyph is bold and passes the 3:1 graphical-object floor". Two problems:

1. **The glyph is arguably text, not a graphical object.** A `✕` character is set with `font-weight`, scales with `font-size`, and is selectable. WCAG's definition of _text_ requires human language, so a bare mark is contestable. Both readings are defensible: as text it needs 4.5:1 and fails at 4.29:1; as a graphical object it needs 3:1 and passes.
2. **"Bold" does not raise the threshold here.** Large-scale bold text starts at 14pt (≈18.66px). The glyph is 12px. Bold weight alone changes nothing.

The argument does not need to be settled, because the `exit 101` badge next to the glyph is unambiguously text at 11px / 400. It needs 4.5:1. It gets 4.29:1, and 3.78:1 on hover. The failure stands whichever way the glyph is classified.

`DESIGN.md:462` also asks the reader to accept the shortfall because Legacy "is scheduled for deletion". That is a product judgement, not an accessibility one. It is the user's to make. I record only that the shortfall is real and that the hover state makes it worse than the spine states.

**Decision needed. Options:** accept as scheduled-for-deletion; lift Legacy `--error` lightness; use Console's `--error` value on both surfaces; or exclude the hover fill from rows that carry an error badge.

### B-3 — The folded todo `✓` at 55% opacity fails on both surfaces

`DESIGN.md:136` sets `folded-todo-opacity: '0.55'`. `DESIGN.md:296` explains the intent: the call succeeded, it is merely collapsed.

Composited in gamma-encoded sRGB:

- Legacy: `--success` at 55% over `--surface` → `#07673E`, **2.70:1**.
- Console: `--success` at 55% over `--surface` → `#077A5E`, **3.58:1**.

Both fail 4.5:1 for a 12px / 700 glyph. Console fails even against a 3:1 floor by a small margin only if the glyph is read as a graphical object — 3.58:1 passes that reading.

This pair appears in no table in `DESIGN.md` and in no Open Question.

**Why this is blocking:** the glyph is the outcome carrier for the row, and `EXPERIENCE.md:98` states the folded row shows nothing new when expanded. The glyph is the only status the reader gets.

**Decision needed. Options:** raise the opacity until the ratio passes (about 0.75 on Legacy); drop the opacity treatment and fade the headline only, which is already tertiary; or accept, because the row is deliberately de-emphasised.

### B-4 — The Raw button has no perceivable boundary and no readable label on Legacy

`mockups/key-transcript-states.html:67`:

```css
.raw {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: 10.5px;
}
```

The Raw button is an interactive control. Two WCAG rules apply.

- **1.4.11, boundary.** `--border` on `--surface` is **1.29:1**. Required: 3:1.
- **1.4.3, label.** `--text-tertiary` on `--surface` is **2.51:1** on Legacy and **4.11:1** on Console. Required: 4.5:1.

The fill is transparent, so the border is the only shape. On Legacy the control has neither a visible boundary nor a readable label. A low-vision reader cannot find the one control that reveals the provider JSON.

1.4.11 permits a weak boundary when the label alone identifies the control. That exception does not apply here, because the label also fails.

**Decision needed. Options:** use `--border-bright` for the border (1.66:1 — still short, so this alone is not enough); use `--text-secondary` for the label (5.79:1 Legacy, 8.37:1 Console); give the button a `--surface-elevated` fill; or accept.

### B-5 — Legacy `--text-tertiary` carries the unknown outcome at 2.51:1

Covered in section 4. `EXPERIENCE.md:120-121` assigns the `–` glyph and the `output unknown` / `output missing` badge to `--text-tertiary`.

`DESIGN.md` Open Question 1 lists the tertiary failure, but frames it as badges, body bar, occurrence header, and chevron — all secondary. It does not say that the unknown outcome state is in the same token. The Open Question therefore understates what a reader loses.

**Decision needed. Options:** promote the unknown glyph and its badge to `--text-secondary` on both surfaces; promote all 11px transcript text to `--text-secondary` on Legacy, as Open Question 1 proposes, and extend the same fix to Console; or accept.

---

## 7. NON-BLOCKING findings

### N-1 — Native `<details>` keyboard behaviour, stated as fact

`EXPERIENCE.md:146` records: "[ASSUMPTION] `↑` / `↓` move focus between rows, matching the existing details/summary behaviour today."

**There is no such native behaviour.** The real behaviour of `<details>` / `<summary>` is:

- `<summary>` is focusable by default. It needs no `tabindex`.
- `Enter` toggles the parent `<details>`.
- `Space` toggles the parent `<details>`.
- `Tab` moves to the next focusable element in DOM order. When a row is open, its Raw button is the next stop, because `.tbody` follows `</summary>` inside the same `<details>`.
- `Shift+Tab` moves backwards.
- **Arrow keys do nothing to focus.** They scroll the panel. `<details>` is not a composite widget and has no roving `tabindex`.

`EXPERIENCE.md:139-145` describes click, `Enter`, `Space`, and `Tab` correctly. Only the arrow-key line is wrong. `EXPERIENCE.md` Open Question 3 already asks whether to add `↑` / `↓`. Answer for the record: adding them needs custom JavaScript, a roving `tabindex`, and care not to trap the Raw button. It is a real feature, not a confirmation.

**Recommendation:** delete the "matching the existing behaviour" clause. It is false and it will mislead a builder into shipping nothing.

### N-2 — Screen-reader semantics are unspecified, and two defaults read badly

`EXPERIENCE.md:160` is broadly correct: a `<summary>` maps to a button role with an expanded state in current browsers, with no custom ARIA.

Three gaps remain. The mockups contain **zero** `aria-*`, `role`, or visually-hidden markup. Mockups are visual, so this is "unspecified", not "wrong". But the spine must specify it.

1. **The accessible name of the row is its full text content.** That includes the `▶` chevron and the status glyph. A screen reader announces the literal characters — for example "black right-pointing triangle" and "multiplication x" — before the tool name. The `▶` is fully redundant with the announced expanded state. **Recommendation:** put `aria-hidden="true"` on the chevron, and give the glyph a visually-hidden name. `EXPERIENCE.md:161` already assumes the second half. Confirm it and add the first.
2. **Middle elision of a path needs JavaScript, so the DOM holds the shortened string.** `EXPERIENCE.md:217` specifies `packages/web/…/ConsoleAgentHistoryList.tsx`. A screen reader then reads the ellipsis and loses the real path. CSS `text-overflow: ellipsis` does not have this problem, because the DOM keeps the full string — but CSS cannot elide in the middle. **Recommendation:** keep the full path in a `title` or an `aria-label`, or render the elided text with `aria-hidden` beside a visually-hidden full path. This is not in either spine.
3. **The Raw toggle needs `aria-expanded`.** `EXPERIENCE.md:90` states the button swaps the body. It is a disclosure control, so it must report its state. The mockup markup is `<button class="raw" type="button">Raw</button>` with no state attribute.

### N-3 — Family is conveyed by colour alone (WCAG 1.4.1)

`DESIGN.md:343`: "only the colour says which family it resolved to." `EXPERIENCE.md:85` repeats it.

Nine families map to five hues. Siblings share a hue: `shell` with `code`, `file` with `web`, `search` with `glob`, `todo` with `task`. A reader who cannot separate the hues loses the family grouping.

**Impact is limited, and the design earned that.** The chip text is the tool name the provider sent. The headline, badges, and body all carry the substance. The reader loses a scanning aid, not a fact. The status glyph — the thing that matters most — uses four different characters and passes 1.4.1 cleanly. `DESIGN.md:229-230` shows the team rejected a coloured dot and a left bar for exactly this reason.

**Recommendation:** no change required for AA. Record the limitation in the spine, so it is a decision and not an oversight.

### N-4 — Chip borders are low contrast, but they are not a 1.4.11 target

Chip borders run 1.73:1 to 2.28:1 against `--surface-elevated`. This is below 3:1.

1.4.11 does not apply. The chip is not interactive — `EXPERIENCE.md:85` states "Carries no click behaviour". And the border is not the only means of identifying it: the chip has a `--surface-elevated` fill, which is a 1.09:1 step off `--surface`. That step is also weak, but the chip's own text is the shape a reader perceives.

**Recommendation:** no change. Recorded so the numbers are on file and this is not re-raised as a failure.

### N-5 — Streaming: the spine decides announcement, but says nothing about scroll or focus

The brief asks whether the design is silent on live regions. **It is not silent.** `EXPERIENCE.md:165` states rows appended while a node runs are not announced, and that the panel's status badge carries the running state. `EXPERIENCE.md` Open Question 7 raises it for confirmation. That is a recorded decision. The decision is also defensible: a transcript that announces every appended tool row would flood a screen reader.

Two real gaps remain. Neither spine mentions either.

1. **Scroll anchoring.** `EXPERIENCE.md:110` says rows append in `seq` order while the node runs. `EXPERIENCE.md:112` and `:118` say a failed row opens on first render. A row that appends or auto-opens above the reading position pushes the content down. The reader loses their place. CSS `overflow-anchor` handles the common case, but auto-opening a row is a height change the browser cannot anchor for.
2. **Focus stability.** If a focused row's DOM node is replaced during a re-render — for example when a `◐` row flips to `✓` in place, per `EXPERIENCE.md:110` — focus returns to `<body>`. A keyboard reader is thrown to the top of the page. React keeps the node when the key is stable, so this is a build constraint: **key rows by a stable id, never by index.**

**Recommendation:** add both to the spine. They are cheap to specify and expensive to retrofit.

### N-6 — Reduced motion is assumed, not specified, and no mockup implements it

`EXPERIENCE.md:164` records "[ASSUMPTION] The 120ms chevron rotation is disabled under `prefers-reduced-motion`."

No mockup contains a `prefers-reduced-motion` block. All three set `transition: transform .12s` on `.chev` unconditionally.

**Impact is low.** A 120ms rotation of a 9px glyph is small, short, and not a vestibular trigger. The assumption is correct practice and costs three lines.

**Recommendation:** confirm the assumption and add the media query at build time.

### N-7 — Target size is borderline and must be measured in a browser

WCAG 2.2 SC 2.5.8 (AA) requires a 24×24 CSS px target, with a spacing exception.

- **Row summary.** `padding: 4px 6px` on 12px monospace text. With a `normal` line-height of 1.15–1.35, the row is about **21.8px to 24.2px** tall. Rows stack with no gap, so the spacing exception does not rescue a short row.
- **Raw button.** `padding: 1px 7px` on 10.5px text, plus 1px borders — about **17px** tall. It sits alone at the right end of the body bar, so the spacing exception probably applies.

I cannot run a browser, so these are arithmetic bounds, not measurements. The row is close enough to 24px that the real font metrics decide it.

**Recommendation:** measure both in Chrome and Safari at build time. If the row falls short, one extra pixel of vertical padding clears it without changing the one-line rule.

### N-8 — The Console mockup's `--error` does not match `theme.css`

`mockups/key-console-node-room.html:25` declares `--error: oklch(0.65 0.22 25)`.
`console/theme.css:81` declares `--error: oklch(0.68 0.215 18)`.

The mockup value gives 5.31:1 on `--surface`. The real value gives 5.94:1. Both pass, so no verdict changes.

**Recommendation:** correct the mockup so a later reviewer measures the shipped token. `DESIGN.md:51` already records the correct `#FF4D64`, which resolves from the `theme.css` value.

### N-9 — Occurrence headers are not headings

`mockups/key-legacy-node-room.html:142` renders `<div class="occ">Run 1 · failed</div>`. `EXPERIENCE.md:101` states the header is "Not interactive".

Correct — it should not be a control. But a screen-reader reader navigates a long document by heading. A transcript with several occurrence groups has no structural landmark. The reader must arrow through every row to reach Run 2.

**Recommendation:** render the occurrence header as a heading element at the right level for the panel, or give the group a labelled region. It stays non-interactive either way. Low cost, real benefit on long transcripts.

---

## 8. What passes, and passes well

This is not a failing design. Recording the strengths keeps the findings in proportion.

- **Outcome never depends on colour.** `✓ ✕ ◐ –` are four different characters (`DESIGN.md:293`, `EXPERIENCE.md:84`). `+n` and `−m` carry their signs. `DESIGN.md:229-230` shows a coloured dot and a colour-only left bar were both considered and rejected for exactly this reason. This is the single most important accessibility decision in the design, and it was made correctly and deliberately.
- **Native `<details>` instead of custom ARIA.** Keyboard operation, the button role, and the expanded state all come free and stay correct.
- **The primary reading path is high contrast everywhere.** Headlines 15.28:1 and 17.72:1. Body text 6.26:1 and 8.86:1. Assistant prose 5.79:1 and 8.37:1.
- **Three of four status glyphs pass on both surfaces.** Only the Legacy `✕` is marginal.
- **The design refuses hover-only information.** `EXPERIENCE.md:124`: "nothing new is revealed — every fact is already on the row." `EXPERIENCE.md:152` bans hover-only information outright.
- **The Console surface passes almost everything.** Its only text failures are `--text-tertiary` and the `--node-prompt` chip.
- **The spine measured its own contrast and published the failures.** `DESIGN.md:312-328` bolds the failing cells and refuses to hide them. Nine of ten published ratios are correct.

---

## 9. Summary

| ID  | Finding                                                                                     | Surface | Class        |
| --- | ------------------------------------------------------------------------------------------- | ------- | ------------ |
| B-1 | Console focus ring 1.36:1; `DESIGN.md:54` records a passing hex for a 30%-alpha token       | Console | BLOCKING     |
| B-2 | Legacy `--error` 4.29:1, and 3.78:1 on hover; Open Question 3 applies the wrong threshold   | Legacy  | BLOCKING     |
| B-3 | Folded todo `✓` at 55% opacity: 2.70:1 Legacy, 3.58:1 Console; in no table                  | Both    | BLOCKING     |
| B-4 | Raw button: border 1.29:1, label 2.51:1, transparent fill                                   | Legacy  | BLOCKING     |
| B-5 | Unknown outcome (`–` glyph, `output missing`) at 2.51:1                                     | Legacy  | BLOCKING     |
| N-1 | `↑` / `↓` recorded as existing native behaviour; it does not exist                          | Both    | non-blocking |
| N-2 | Chevron and glyph in the accessible name; elided path lost to AT; Raw needs `aria-expanded` | Both    | non-blocking |
| N-3 | Tool family conveyed by colour alone (1.4.1); impact limited to a scanning aid              | Both    | non-blocking |
| N-4 | Chip borders 1.73–2.28:1; not a 1.4.11 target                                               | Both    | non-blocking |
| N-5 | No scroll anchoring and no focus-stability rule for streaming rows                          | Both    | non-blocking |
| N-6 | Reduced motion assumed; no mockup implements it                                             | Both    | non-blocking |
| N-7 | Row height about 21.8–24.2px against the 24px floor; measure at build                       | Both    | non-blocking |
| N-8 | Console mockup `--error` drifts from `theme.css`; both values pass                          | Console | non-blocking |
| N-9 | Occurrence headers are `<div>`, so there is no heading navigation                           | Both    | non-blocking |

**Decisions the user must make:** B-1 through B-5 each end with options. Every option that fixes a contrast failure either changes a shared token, adds a transcript-scoped override, or accepts the failure. `DESIGN.md:328` records that the user has ruled out changing a token. That rules out one column of every option table, and it makes the override-or-accept choice the live one. I do not choose for them.

---

## 10. Unresolved questions

1. **B-1:** is the Console focus ring's 30% alpha deliberate, or did `--accent-ring` get reused from a selection-highlight role? `theme.css:148-151` uses the same token for `::selection`, where 30% is correct. A focus outline and a selection wash may need different tokens.
2. **B-2:** does "Legacy is scheduled for deletion" have a date? If Legacy outlives the fix window, the accept option costs more than it looks.
3. **B-3:** was the 55% opacity chosen for a measured appearance, or picked by eye? If by eye, raising it to about 0.75 may cost nothing visually.
4. **N-7:** what is the computed row height in Chrome and Safari with JetBrains Mono and Geist Mono loaded, and with the system fallback?
5. `DESIGN.md` Open Question 4 asks which glyph `interrupted` takes. If it takes `–` in tertiary, it joins B-5 and inherits the 2.51:1 failure on Legacy. If it takes `✕` in error, it inherits B-2. Neither is free. The accessibility answer does not settle it, but the choice should be made knowing both costs.
