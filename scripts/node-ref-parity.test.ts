/**
 * Repository-level parity check: the web UI's copy of the engine's
 * `$<nodeId>.output` reference grammar must stay identical to the engine's
 * original.
 *
 * `@archon/web` must never import `@archon/workflows` (a server package), and
 * `api.generated.d.ts` is type-only so it cannot carry a runtime value — the
 * same constraint AGENTS.md records for `TRIGGER_RULES`. The web package
 * therefore keeps a deliberate copy of the grammar, and this check keeps that
 * copy honest.
 *
 * It lives in `scripts/` rather than beside the web module because this is a
 * cross-package repository invariant, not a unit of `@archon/web` behavior — the
 * same reason the bundled-defaults and capability-matrix checks live here. This
 * file importing both packages does not breach the rule above: the rule is about
 * what ships in the web bundle, and nothing here is bundled. `bun run test` ends
 * with `bun test ./scripts/`, so CI enforces it.
 *
 * The drift this catches actually happened (#2567): a copy used `\w`, which
 * excludes the hyphen, so it silently validated none of the hyphenated node ids
 * the bundled workflows use.
 *
 * The reference is a plain `String.raw` literal on both sides, so it is compared
 * as TEXT (see the decoy analysis on `DECL` below).
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..');
const ENGINE_LOADER = join(REPO_ROOT, 'packages', 'workflows', 'src', 'loader.ts');
const WEB_NODE_REF = join(REPO_ROOT, 'packages', 'web', 'src', 'lib', 'node-ref.ts');

function missing(name: string, file: string): Error {
  return new Error(
    `Could not find \`${name}\` in ${file}. If it was renamed or moved, re-point this ` +
      'parity check and its counterpart together — they are meant to change as a pair.'
  );
}

/**
 * A regex over raw source cannot tell a DECLARATION from a MENTION of one. That
 * is the whole difficulty here, and every layer below is about narrowing the gap
 * — none of them closes it, so treat this as "cheap steps toward reading code",
 * not as a solved problem.
 *
 * The failure mode is concrete: a commented-out copy holding the CURRENT value,
 * sitting above a live constant that has genuinely drifted. That is an ordinary
 * thing to find in a file someone is mid-refactor on, and it makes the whole
 * suite pass while the invariant is broken. Measured against the real test file,
 * each row with the #2567 regression (a dropped hyphen in `NODE_ID_SOURCE`) live:
 *
 *   extractor                  `// …`      `/*` indented   `/*` at column 0
 *   no anchor                  DEFEATED    DEFEATED        DEFEATED
 *   `^\s*(?:export )?const`    caught      DEFEATED        DEFEATED
 *   `^(?:export )?const`       caught      caught          DEFEATED
 *   + strip comments first     caught      caught          caught
 *
 * Hence both layers, which are complementary rather than redundant: stripping
 * removes commented-out copies whatever their indentation, and the column-0
 * anchor still rejects a mention embedded mid-line in live code, which stripping
 * leaves untouched.
 *
 * Column 0 is safe rather than brittle: all three constants this file extracts are
 * top-level, and an indented one would not be. If a future constant is nested,
 * widen deliberately and re-run the decoy matrix — do not reach for `\s*`.
 *
 * A guard that can be silently defeated is worse than no guard: it buys
 * confidence in exactly the invariant it is failing to check.
 */
const DECL = String.raw`^(?:export )?const`;

/** Drop block comments and whole-line `//` comments before matching. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Extract a `const <name> = String.raw`…`` literal, failing loudly if it moved. */
function rawConstant(file: string, name: string): string {
  const source = stripComments(readFileSync(file, 'utf8'));
  const match = new RegExp(String.raw`${DECL} ${name} =\s*String\.raw\x60([^\x60]*)\x60`, 'm').exec(
    source
  );
  if (match?.[1] === undefined) throw missing(name, file);
  return match[1];
}

/** Resolve the `${NAME}` interpolations a composed web pattern is built from. */
function resolveInterpolations(pattern: string, parts: Record<string, string>): string {
  let resolved = pattern;
  for (const [name, value] of Object.entries(parts)) {
    resolved = resolved.replaceAll(`\${${name}}`, value);
  }
  return resolved;
}

describe('node-ref parity: @archon/web mirrors the engine', () => {
  test('the web OUTPUT_REF_SOURCE is byte-identical to the engine definition', () => {
    // The web copy interpolates NODE_ID_SOURCE, so compare the resolved value.
    const engine = rawConstant(ENGINE_LOADER, 'OUTPUT_REF_SOURCE');
    const nodeId = rawConstant(WEB_NODE_REF, 'NODE_ID_SOURCE');
    const web = resolveInterpolations(rawConstant(WEB_NODE_REF, 'OUTPUT_REF_SOURCE'), {
      NODE_ID_SOURCE: nodeId,
    });

    expect(web).toBe(engine);
  });

  test('the shared grammar admits a hyphenated id (the #2567 regression)', () => {
    // Asserted by MATCHING, not by string equality: a lockstep widening of the
    // grammar on both sides is legitimate and should pass here, while the
    // regression this pins — dropping the hyphen — still fails. Byte-identity
    // with the engine is the previous test's job, not this one's.
    const nodeId = new RegExp(`^${rawConstant(WEB_NODE_REF, 'NODE_ID_SOURCE')}$`);

    expect(nodeId.test('check-reproduction')).toBe(true);
    expect(nodeId.test('classify-testability')).toBe(true);
  });
});
