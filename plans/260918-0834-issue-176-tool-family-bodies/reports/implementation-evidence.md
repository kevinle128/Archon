# US-006 Implementation Evidence — Release gate, E2E/visual specs, validation, closeout

**Date:** 2026-09-18
**Scope:** Story 1.3 (issue #176) closeout — authoritative generic-fallback record, mandatory release check, deterministic HITL + visual E2E for family bodies and the Raw swap on both surfaces, full validation, sprint tracking.

## Audit record (identity only — no payload contents)

- **Record:** `audit/generic-fallback.json` (durable, non-evergreen, non-`docs/` location; committed).
- **Denominator:** `logical-tool-cards-v1` — one logical UI tool card per invocation via `projectToolTranscript()` (decision recorded in `reports/us-005-audit-decision.md`).
- **Corpus:** `source = mac-mini-local-install`, `dialect = sqlite`.
- **Generated:** `2026-09-18T12:28:03.664Z`, `schemaVersion = 1`.
- **Source hash:** `auditSourceSha256 = bc5bd3cd50c7513b50a6477ff909e224aae681d08c79fc2f22ac7ef590644f92` over the classification/pairing sources.
- **Result:** `89 / 5540` generic cards → `fraction = 0.01606` (**1.61% < 2%** bound).
- `genericNames` aggregate counts only (no payloads): `get_output` 71, `get_command_or_subagent_output` 4, `StructuredOutput` 3, `mcp__archon__AskHuman` 3, `ReportFindings` 2, `exec` 2, `kill_shell` 2, `SendMessage` 1, `Skill` 1.

```text
$ bun run scripts/audit-generic-fallback.ts --check audit/generic-fallback.json
audit record OK: 89/5540 generic cards (1.61% < 2%), dialect=sqlite, generated=2026-09-18T12:28:03.664Z
EXIT=0
```

## Release gate

`.claude/skills/release/SKILL.md` gained **Step 1.6: Generic-fallback audit record check**, placed after Step 1.5 (compiled-binary pre-flight) and **before** Step 2 (stack/version detection) — i.e. before any version/changelog mutation:

```bash
bun run scripts/audit-generic-fallback.ts --check audit/generic-fallback.json
```

`--check` reads only the committed record plus the classification sources — it never connects to a database. Nonzero exit aborts the release on: missing/unreadable record, staleness (>90 days), `auditSourceSha256` mismatch, empty denominator, or `fraction >= 2%`. The step documents the only authorized remedy (read-only refresh against the corpus named by the record's `source` field, committed on a feature branch) and explicitly forbids lowering the threshold, hand-editing counts, or pointing the audit at an arbitrary database when the designated corpus is unreachable. A matching "NEVER skip Step 1.6" bullet was added to the skill's rules list. `release` is not a bundled skill (`check:bundled-skill` covers `archon` + `manage-run` only), so no generated derivative needed regenerating; `check:bundled*` all pass.

## E2E — deterministic behavior (both surfaces)

`e2e/ui/workflow-run-hitl-room.spec.ts` — shared helper `expectFileFamilyBody(row)` applied to the real fake-provider `inspect-file` Read row (`HITL_TOOL_INPUT.txt` / `HITL_TOOL_OUTPUT_VISIBLE`) in the Console `agent-history` test and both Legacy room tests:

- collapsed row mounts **no** `.tool-family-body` and zero exact `Input`/`Output` diagnostic disclosures;
- opening renders the file body: path header `.text-node-command` = `HITL_TOOL_INPUT.txt`, preview contains `HITL_TOOL_OUTPUT_VISIBLE`, and the body never contains the serialized `"output"` key;
- Raw (`button` `aria-expanded` false→true) swaps the body to the exact pretty-printed `{ name: 'Read', input: { path: 'HITL_TOOL_INPUT.txt' }, output: 'HITL_TOOL_OUTPUT_VISIBLE' }` payload (`toBe` on `textContent`);
- closing Raw restores the file body;
- the retained `history-complete` block still asserts `full_output_available` → `View full output` fetch.

**#175 swap-slot anchors (identical on both surfaces):** `rawOpen` boolean state in the row component; single `button` with accessible name `Raw` carrying `aria-expanded`; the shared `.tool-family-body` box as the swap slot (`ToolBodySwitch` ⇄ `formatToolIo({name,input,input})` payload); body laziness = `open && !rawOpen` mount contract.

```text
$ bun run --cwd e2e test:ui:hitl
38 passed, 3 skipped (pre-existing auth-gated: hitl.ask-authorization,
  hitl.console-unowned-ask, hitl.legacy-unowned-ask), 0 failed
```

## Visual E2E — `e2e/ui/agent-tool-row-visual.spec.ts` (extended, not a second harness)

New `[V:hitl.tool-body-gallery-{console,legacy}]` test: `routeGalleryTranscript()` route-fulfills only the `inspect-file` node's messages page with a deterministic 8-card gallery (labeled "browser visual fixtures" in every attachment — not fake-provider claims): terminal (600-char unbroken token), file, content-mode matches, glob paths, fenced code + result, web with a markdown link, generic key/value, and a corrupt-payload unreadable arm.

Measured at the contractual 460px room width (Console 460px, Legacy 459.67px, tolerance 1.5px):

| Assertion      | Measured                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Collapsed rows | 0 `.tool-family-body` per row; 0 `Input`/`Output` texts                                                                                   |
| Body bar       | one line, height 24–30px, bar text `scrollWidth ≤ clientWidth`                                                                            |
| Raw placement  | flush right of bar (Δ ≤ 1.5px), ≥24px target                                                                                              |
| Body box       | padding 8px/10px, radius 6px, 11.5px/17.25px mono (`Geist Mono` Console / `JetBrains Mono` Legacy), `pre-wrap` + `overflow-wrap:anywhere` |
| Terminal wrap  | 395×259.5px box, `scrollWidth ≤ clientWidth` — long token wraps, no horizontal scroll                                                     |
| Web arm        | link renders as `the reference (https://example.com/ref)` text; 0 `<a>` elements                                                          |
| Degraded arm   | `output unreadable — open Raw`                                                                                                            |
| Room/page      | `expectNoRoomDrivenOverflow` passes with all 8 rows open                                                                                  |

Existing sweep retained unchanged: 1440×1000, 1024×900, 768×900, 390×844, plus 200% zoom — no new transcript breakpoint; rows stay one-line and operable at every width.

**Keyboard + screen-reader pass (terminal body row 0 `shell · Bash`, matches body row 2 `search · Grep`, both surfaces):**

- AX name carries state → family/tool → target: `"succeeded shell · Bash bun run validate"`, `"succeeded search · Grep needle in src"`; `expanded` property reads true after opening (CDP query scoped to `[role="region"][aria-label="inspect-file room"]` so the Console page's own transcript rows can't shadow the room's).
- Tab order `summary → Raw`; Raw shows `:focus-visible` 2px solid outline resolving to `--accent-bright` (Console `oklch(0.64 0.295 330)`, Legacy `oklch(0.72 0.18 250)` — the intentional per-surface offset is unchanged).
- Raw `aria-expanded` toggles false→true→false with the body swap each way.
- `prefers-reduced-motion`: chevron `transition-property` computes to `none`.

**Contrast (computed `getComputedStyle` → resolved oklch → WCAG ratio, floor 4.5:1 body / 3:1 focus):**

| Tone                                  | Console     | Legacy      |
| ------------------------------------- | ----------- | ----------- |
| terminal body text vs inset bg        | **18.77**   | **16.52**   |
| matches path text vs inset bg         | **5.56**    | **5.60**    |
| search/glob chip text vs rest / hover | 6.86 / 6.17 | 6.81 / 5.65 |
| nonzero exit digits vs rest / hover   | 8.02 / 7.21 | 6.45 / 5.35 |
| focus outline vs rest / hover         | 4.85 / 4.35 | 7.85 / 6.51 |
| succeeded glyph vs rest / hover       | 9.50 / 8.54 | 6.70 / 5.56 |
| neutral badge text vs rest / hover    | 8.37 / 7.52 | 8.37 / 7.52 |

(Full token table for all body tones remains `reports/us-003-contrast-evidence.md`.)

**Captures** (via `testInfo.attach` → Playwright report, linked from `ui/reports/results.json`): `{console,legacy}-body-gallery-460.png`, `{console,legacy}-body-gallery-measurements.json`, `{console,legacy}-tool-row-460.png`, `{console,legacy}-room-460.png`, `tool-row-contrast.json`, `mockup-*-460.png`. The tracked Story-1.1 mockup-alignment captures under `plans/260907-1454-…/reports/captures/` regenerated as a side effect of the mandatory `test:ui:hitl` run (the shipped row now carries the family chip/body) and are committed refreshed.

```text
$ bun run --cwd e2e typecheck            → clean
$ bunx playwright test ui/agent-tool-row-visual.spec.ts   → 8 passed
$ bunx playwright test ui/workflow-run-hitl-room.spec.ts  → 19 passed
```

## Full validation

```text
$ bun run validate
check:bundled OK (68 commands, 31 workflows) · check:bundled-skill OK ·
check:bundled-schema OK · check:pi-vendor-map OK · check:capability-matrix OK ·
type-check all packages OK · eslint --max-warnings 0 OK · format:check OK ·
test:install OK · all package tests OK · scripts tests 153 pass/0 fail ·
test:verification-skills 29 pass/0 fail — exit 0
```

Pre-existing environment blocker cleared under the unblock protocol (separate commit `14ccc5ad`, zero story changes): `dag-executor.test.ts` fixtures `.archon/workflows/defaults/speckit-feature.yaml` + `speckit-ralph-native-feature.yaml` were absent on this lineage (deleted in `16b01a72`), failing 7 tests with ENOENT on the clean base; restored from `915cf18c` and `bundled-defaults.generated.ts` regenerated (29→31 workflows).
