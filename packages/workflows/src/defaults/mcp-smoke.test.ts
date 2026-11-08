/**
 * The mcp-smoke bundled workflow: a no-AI run that exercises the MCP server's
 * task, approval, cancel, failure and event paths on a real server.
 */
import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorkflow } from '../loader';
import { buildTopologicalLayers } from '../dag-executor';
import type { DagNode, WorkflowDefinition } from '../schemas';
import { BUNDLED_WORKFLOWS } from './bundled-defaults';

const NAME = 'mcp-smoke';
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const YAML_TEXT = readFileSync(
  join(REPO_ROOT, '.archon/workflows/defaults', `${NAME}.yaml`),
  'utf-8'
);

function loadWorkflow(): WorkflowDefinition {
  const result = parseWorkflow(YAML_TEXT, `${NAME}.yaml`);
  if (result.workflow === null) throw new Error(result.error.error);
  return result.workflow;
}

const WORKFLOW = loadWorkflow();

function nodeById(id: string): DagNode {
  const node = WORKFLOW.nodes.find(n => n.id === id);
  if (!node) throw new Error(`node ${id} missing`);
  return node;
}

function bashOf(id: string): string {
  const node = nodeById(id) as { bash?: string };
  if (typeof node.bash !== 'string') throw new Error(`node ${id} has no bash`);
  return node.bash;
}

/** Runs the wait node without its 15-second sleep. */
function runWait(mode: string): { status: number | null; stdout: string; stderr: string } {
  const script = bashOf('wait').replace(/^\s*sleep 15$/m, 'sleep 0');
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ARGUMENTS: mode },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('mcp-smoke structure', () => {
  it('is bundled byte for byte', () => {
    expect(BUNDLED_WORKFLOWS[NAME]).toBe(YAML_TEXT.replace(/\r\n/g, '\n'));
  });

  it('runs wait, then the approval gate, then finish', () => {
    expect(WORKFLOW.name).toBe(NAME);
    expect(buildTopologicalLayers(WORKFLOW.nodes).map(layer => layer.map(n => n.id))).toEqual([
      ['wait'],
      ['gate'],
      ['finish'],
    ]);
    expect('approval' in nodeById('gate')).toBe(true);
  });

  it('has no AI nodes: every node is bash or an approval gate', () => {
    const others = WORKFLOW.nodes.filter(n => !('bash' in n) && !('approval' in n));
    expect(others.map(n => n.id)).toEqual([]);
  });

  it('calls no git, GitHub or network tool', () => {
    for (const id of ['wait', 'finish']) {
      expect(bashOf(id)).not.toMatch(/\b(git|gh|curl|wget|ssh|npm|npx|bun)\b/);
    }
  });

  it('declares that runs on one folder can overlap', () => {
    expect(WORKFLOW.mutates_checkout).toBe(false);
  });
});

describe('mcp-smoke wait node', () => {
  it('passes for the mode "pass"', () => {
    const r = runWait('pass');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('waited');
  });

  it('fails on purpose for the mode "fail"', () => {
    const r = runWait('fail');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('failing on purpose');
  });

  it('refuses any other run message instead of guessing a mode', () => {
    for (const mode of ['', 'Pass', 'please fail', 'pass ']) {
      const r = runWait(mode);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("must be exactly 'pass' or 'fail'");
    }
  });

  it('keeps the wait long enough to see and cancel the working state', () => {
    expect(bashOf('wait')).toMatch(/^\s*sleep 15$/m);
  });
});
