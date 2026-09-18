---
phase: 1
title: 'Shared Raw contract'
status: pending
priority: P1
dependencies: []
---

# Phase 01 — Shared Raw contract

## Objective

Add a small, total, React-free Raw payload contract to the existing tool-row presentation core. Finish this phase with focused unit tests green and no renderer behavior changed yet.

## Production change

Edit `packages/web/src/lib/tool-presentation.ts` only.

1. Define `ToolRawPayload` with `name`, `input`, and `output` in that declaration order.
2. Add `rawPayload: ToolRawPayload` to `ToolRowPresentation`.
3. Have `toolRowPresentation(input)` capture the original provider-facing `input.name`, `input.input`, and `input.output` after resolving the visible presentation. Do not use the normalized label or fact text to reconstruct them.
4. Preserve the core's total-function guarantee. Defensive capture must not let an adversarial getter throw through the public helper; use `{ name: 'generic', input: undefined, output: undefined }` only for malformed in-memory input that cannot arise from validated API data.
5. Export `toolRawPayloadJson(payload)`:
   - build exactly `{ name, input, output }` in that order;
   - use `JSON.stringify(value, null, 2)`;
   - accept normal JSON omission of `undefined` and preservation of `null`;
   - on cycles, `bigint`, or another serialization exception, return pretty valid `{ name, error: 'payload is not serializable' }` JSON without leaking exception stacks or object inspection output; preserve a safely readable string name and otherwise use `generic`, so fallback construction cannot throw a second time.

Do not add React, a JSON-viewer dependency, redaction policy, ids, labels, icons, facts, or renderer state to this module.

## Tests

Extend `packages/web/src/lib/tool-presentation.test.ts` to prove:

- generic, known, and Codex-native tool names retain their exact original `name` in `rawPayload` even when their visible label differs;
- object/array/primitive/null values are preserved structurally;
- absent `input`/`output` properties are omitted by JSON serialization, while explicit `null` remains;
- top-level keys and pretty indentation are deterministic;
- quotes, backslashes, newlines, and `<script>`-like strings are JSON-escaped and remain text data;
- cyclic input, `bigint` output, and a serializer argument with a throwing `name` getter return the documented valid JSON fallback instead of throwing;
- existing adversarial-getter totality tests still pass, and `toolRowPresentation` exposes the deterministic generic `rawPayload` fallback when capture fails.

Extend `packages/web/src/lib/agent-history.test.ts` with the end-to-end projection boundary:

- a paired tool call/result produces `item.presentation.rawPayload` containing the call name/input and result output;
- a pending call has no output key after serialization;
- arrival of the result keeps the card id but changes the presentation's Raw output.

These assertions verify the real two-row pairing semantics and prevent the implementation from claiming or emulating a byte-for-byte persisted row.

## Validation

```bash
bun test packages/web/src/lib/tool-presentation.test.ts packages/web/src/lib/agent-history.test.ts
bun run type-check
```

## Exit criteria

- The shared contract is total, typed, deterministic, and renderer-agnostic.
- Tests prove original-name preservation, pairing semantics, JSON behavior, and malformed-value fallback.
- No API, persistence, schema, provider, or component file has changed.
