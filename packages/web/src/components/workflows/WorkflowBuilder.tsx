import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider, useNodesState, useEdgesState } from '@xyflow/react';
import { Redo2, Undo2 } from 'lucide-react';
import type { Edge } from '@xyflow/react';
import type {
  RouteLoopConfig,
  RouteLoopOutcome,
  WorkflowDefinition,
  WorkflowSource,
} from '@/lib/api';

import { useProject } from '@/contexts/ProjectContext';
import {
  getWorkflow,
  listCommands,
  validateWorkflow,
  saveWorkflow,
  createConversation,
  listWorkflows,
  runWorkflow,
} from '@/lib/api';
import type { CommandEntry } from '@/lib/api';
import { dagNodesToReactFlow } from '@/lib/dag-layout';
import { useBuilderKeyboard } from '@/hooks/useBuilderKeyboard';
import { useBuilderUndo } from '@/hooks/useBuilderUndo';
import { useBuilderValidation } from '@/hooks/useBuilderValidation';
import type { ValidationIssue } from '@/hooks/useBuilderValidation';
import { WorkflowCanvas, reactFlowToDagNodes } from './WorkflowCanvas';
import { ValidationPanel } from './ValidationPanel';
import { YamlCodeView } from './YamlCodeView';
import { BuilderInspector } from '@/components/builder/BuilderInspector';
import { BuilderPalette, type BuilderNodeKind } from '@/components/builder/BuilderPalette';
import { StepsCanvas } from '@/components/builder/StepsCanvas';
import { WorkflowSettings } from '@/components/builder/WorkflowSettings';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { Segmented } from '@/components/ui/segmented';
import { groupNodesIntoSteps } from '@/lib/node-steps';
import { cn } from '@/lib/utils';
import type { DagNodeData, DagFlowNode } from './DagNodeComponent';
import {
  dependenciesForStep,
  ROUTE_OUTCOMES,
  stepIndexOf,
  withNodeDependencies,
} from '@/lib/builder/builder-steps';

type CanvasView = 'steps' | 'graph';

interface BuilderNotice {
  kind: 'info' | 'error' | 'saved';
  text: string;
}

const NOTICE_CLASS: Readonly<Record<BuilderNotice['kind'], string>> = {
  info: 'bg-selection text-accent',
  error: 'bg-tint-error text-status-failed',
  saved: 'bg-tint-success text-status-done',
};

function routeLoopEdgeLabel(
  outcome: RouteLoopOutcome
): Pick<Edge, 'label' | 'labelStyle' | 'labelBgStyle' | 'labelBgPadding' | 'labelBgBorderRadius'> {
  return {
    label: outcome,
    labelStyle: { fill: 'var(--text-secondary)', fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.9 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  };
}

function routeLoopConfigToEdges(
  nodeId: string,
  routeLoop: RouteLoopConfig,
  sourceNodeIds: readonly string[]
): Edge[] {
  const routeEdges = ROUTE_OUTCOMES.flatMap(outcome => {
    const target = routeLoop.routes[outcome].trim();
    if (!target) return [];
    return [
      {
        id: `${nodeId}->${target}:${outcome}`,
        source: nodeId,
        sourceHandle: outcome,
        target,
        type: 'smoothstep',
        ...routeLoopEdgeLabel(outcome),
      },
    ] satisfies Edge[];
  });
  const sourceEdges = sourceNodeIds.flatMap(source => {
    const sourceId = source.trim();
    if (!sourceId) return [];
    return [
      {
        id: `${sourceId}->${nodeId}`,
        source: sourceId,
        target: nodeId,
        type: 'smoothstep',
      },
    ] satisfies Edge[];
  });
  return [...sourceEdges, ...routeEdges];
}

function WorkflowBuilderInner(): React.ReactElement {
  const [searchParams] = useSearchParams();
  const editName = searchParams.get('edit');
  const navigate = useNavigate();

  const { codebases, selectedProjectId } = useProject();
  const cwd = selectedProjectId
    ? codebases?.find(cb => cb.id === selectedProjectId)?.default_cwd
    : undefined;

  // Core state
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [provider, setProvider] = useState<string | undefined>(undefined);
  const [model, setModel] = useState<string | undefined>(undefined);
  const [workflowMetadata, setWorkflowMetadata] = useState<
    Omit<WorkflowDefinition, 'name' | 'description' | 'provider' | 'model' | 'nodes'>
  >({});
  const [workflowSource, setWorkflowSource] = useState<WorkflowSource | undefined>(undefined);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [validationPanelOpen, setValidationPanelOpen] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const [canvasView, setCanvasView] = useState<CanvasView>('steps');
  const [inspectorTab, setInspectorTab] = useState<'inspector' | 'yaml'>('inspector');
  const [startFrom, setStartFrom] = useState('');
  const [notice, setNotice] = useState<BuilderNotice | null>(null);

  // DAG state
  const [nodes, setNodes, onNodesChange] = useNodesState<DagFlowNode>([]);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments -- TSC infers never[] without explicit Edge
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Loop state

  // Commands for palette/inspector
  const {
    data: commands,
    isError: commandsError,
    isLoading: commandsLoading,
  } = useQuery({
    queryKey: ['commands', cwd],
    queryFn: () => listCommands(cwd),
  });
  const commandList: CommandEntry[] = commands ?? [];

  const { data: workflowList } = useQuery({
    queryKey: ['workflows', cwd ?? null],
    queryFn: () => listWorkflows(cwd),
  });

  const { pushSnapshot, undo, redo, canUndo, canRedo } = useBuilderUndo();

  const validationIssues = useBuilderValidation(workflowName, workflowDescription, nodes, edges);
  const errorCount = useMemo(
    () => validationIssues.filter(i => i.severity === 'error').length,
    [validationIssues]
  );

  const markDirty = useCallback((): void => {
    setHasUnsavedChanges(true);
  }, []);

  // Refs mirror the latest nodes/edges so snapshot-taking callbacks don't
  // close over stale values when events fire in the same tick as a render.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  const pushSnapshotLatest = useCallback((): void => {
    pushSnapshot({ nodes: nodesRef.current, edges: edgesRef.current });
  }, [pushSnapshot]);

  const buildDefinition = useCallback((): WorkflowDefinition => {
    const name = workflowName.trim() || 'untitled';
    const description = workflowDescription;
    const dagNodes = reactFlowToDagNodes(nodes, edges);
    return {
      name,
      description,
      ...workflowMetadata,
      provider,
      model,
      nodes: dagNodes,
    };
  }, [workflowName, workflowDescription, workflowMetadata, provider, model, nodes, edges]);

  const loadWorkflow = useCallback(
    async (name: string): Promise<void> => {
      try {
        const { workflow, source } = await getWorkflow(name, cwd);
        const {
          name: loadedName,
          description: loadedDescription,
          provider: loadedProvider,
          model: loadedModel,
          nodes: loadedNodes,
          ...metadata
        } = workflow;
        setWorkflowName(loadedName);
        setWorkflowDescription(loadedDescription);
        setProvider(loadedProvider);
        setModel(loadedModel);
        setWorkflowMetadata(metadata);
        setWorkflowSource(source);
        setValidationErrors([]);

        const { nodes: rfNodes, edges: rfEdges } = dagNodesToReactFlow(loadedNodes);
        setNodes(rfNodes);
        setEdges(rfEdges);

        setHasUnsavedChanges(false);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[workflow-builder] workflow.load_failed', {
          workflowName: name,
          cwd,
          error,
        });
        setValidationErrors([`Failed to load workflow: ${error.message}`]);
      }
    },
    [cwd, setNodes, setEdges]
  );

  // Auto-load if ?edit= is present
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (editName && !autoLoaded.current) {
      autoLoaded.current = true;
      void loadWorkflow(editName);
    }
  }, [editName, loadWorkflow]);

  const handleToggleValidationPanel = useCallback((): void => {
    setValidationPanelOpen(v => !v);
  }, []);

  const handleNodeUpdate = useCallback(
    (updates: Partial<DagNodeData>): void => {
      setNodes(nds =>
        nds.map(n => (n.id === selectedNodeId ? { ...n, data: { ...n.data, ...updates } } : n))
      );
      const selectedNode = nodes.find(node => node.id === selectedNodeId);
      const routeLoopUpdate = updates.route_loop ?? selectedNode?.data.route_loop;
      const updatesDependsOn = Object.prototype.hasOwnProperty.call(updates, 'depends_on');
      const shouldRebuildRouteLoopEdges =
        selectedNodeId !== null &&
        selectedNode?.data.nodeType === 'route_loop' &&
        routeLoopUpdate !== undefined &&
        (updates.route_loop !== undefined || updatesDependsOn);
      // Dependencies are edges: the saved YAML derives `depends_on` from them, so an
      // inspector edit must rewrite the node's incoming edges, not only its data.
      if (selectedNodeId && updatesDependsOn && selectedNode?.data.nodeType !== 'route_loop') {
        setEdges(eds => withNodeDependencies(eds, selectedNodeId, updates.depends_on ?? []));
      }
      if (selectedNodeId && shouldRebuildRouteLoopEdges) {
        const sourceNodeIds = updatesDependsOn
          ? (updates.depends_on ?? [])
          : (selectedNode?.data.depends_on ?? []);
        setEdges(eds => [
          ...eds.filter(
            edge =>
              !(
                (edge.source === selectedNodeId &&
                  ROUTE_OUTCOMES.some(outcome => outcome === edge.sourceHandle)) ||
                (edge.target === selectedNodeId &&
                  !ROUTE_OUTCOMES.some(outcome => outcome === edge.sourceHandle))
              )
          ),
          ...routeLoopConfigToEdges(selectedNodeId, routeLoopUpdate, sourceNodeIds),
        ]);
      }
      markDirty();
    },
    [nodes, selectedNodeId, setNodes, setEdges, markDirty]
  );

  const handleNodeDeleteById = useCallback(
    (nodeId: string): void => {
      pushSnapshotLatest();
      setNodes(nds => nds.filter(n => n.id !== nodeId));
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(prev => (prev === nodeId ? null : prev));
      markDirty();
    },
    [setNodes, setEdges, markDirty, pushSnapshotLatest]
  );

  const handleNodeDelete = useCallback((): void => {
    if (!selectedNodeId) return;
    handleNodeDeleteById(selectedNodeId);
  }, [selectedNodeId, handleNodeDeleteById]);

  // Toolbar action handlers
  const handleValidate = useCallback(async (): Promise<void> => {
    try {
      const def = buildDefinition();
      const result = await validateWorkflow(def);
      if (result.valid) {
        setValidationErrors([]);
        setNotice({ kind: 'info', text: 'The server accepts this workflow.' });
      } else {
        setValidationErrors(result.errors ?? ['Unknown validation error']);
      }
      setValidationPanelOpen(true);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      console.error('[workflow-builder] workflow.validate_failed', { workflowName, error });
      setValidationErrors([`Validation request failed: ${error.message}`]);
    }
  }, [buildDefinition]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!workflowName.trim()) {
      setValidationErrors(['Workflow name is required']);
      return;
    }
    try {
      const def = buildDefinition();
      const validation = await validateWorkflow(def);
      if (!validation.valid) {
        setValidationErrors(validation.errors ?? ['Workflow is invalid']);
        return;
      }
      setValidationErrors([]);
      await saveWorkflow(workflowName.trim(), def, cwd, workflowSource);
      setHasUnsavedChanges(false);
      setNotice({
        kind: 'saved',
        text: `Saved to .archon/workflows/${workflowName.trim()}.yaml`,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      console.error('[workflow-builder] workflow.save_failed', { workflowName, cwd, error });
      setValidationErrors([`Save failed: ${error.message}`]);
      setValidationPanelOpen(true);
    }
  }, [buildDefinition, workflowName, cwd, workflowSource]);

  const handleRun = useCallback(async (): Promise<void> => {
    if (!workflowName.trim() || hasUnsavedChanges) return;
    try {
      const result = await createConversation(selectedProjectId ?? undefined);
      const conversationId = result.conversationId;
      await runWorkflow(workflowName.trim(), conversationId, '');
      navigate(`/chat/${conversationId}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      console.error('[workflow-builder] workflow.run_failed', { workflowName, error });
      setValidationErrors([`Run failed: ${error.message}`]);
      setValidationPanelOpen(true);
    }
  }, [workflowName, hasUnsavedChanges, selectedProjectId, navigate]);

  // Undo/redo handlers
  const handleUndo = useCallback((): void => {
    const state = undo();
    if (state) {
      setNodes(state.nodes);
      setEdges(state.edges);
    }
  }, [undo, setNodes, setEdges]);

  const handleRedo = useCallback((): void => {
    const state = redo();
    if (state) {
      setNodes(state.nodes);
      setEdges(state.edges);
    }
  }, [redo, setNodes, setEdges]);

  // Convert validation issues for the panel (merge server-side errors with client-side)
  const allValidationIssues = useMemo((): ValidationIssue[] => {
    const serverIssues: ValidationIssue[] = validationErrors.map(msg => ({
      severity: 'error' as const,
      message: msg,
    }));
    return [...serverIssues, ...validationIssues];
  }, [validationErrors, validationIssues]);

  // Keyboard shortcuts — stabilize actions object to avoid re-registering handler on every render
  const keyboardActions = useMemo(
    () => ({
      onSave: (): void => void handleSave(),
      onUndo: handleUndo,
      onRedo: handleRedo,
      onToggleLibrary: (): void => {
        setShowLibrary(v => !v);
      },
      onToggleYaml: (): void => {
        setInspectorTab(tab => (tab === 'yaml' ? 'inspector' : 'yaml'));
      },
      onToggleValidation: handleToggleValidationPanel,
      onAddPrompt: (): void => {
        const id = `node-${crypto.randomUUID()}`;
        const newNode: DagFlowNode = {
          id,
          type: 'dagNode',
          position: { x: 200, y: 200 },
          data: { id, label: 'Prompt', nodeType: 'prompt' },
        };
        pushSnapshotLatest();
        setNodes(nds => [...nds, newNode]);
        markDirty();
      },
      onAddBash: (): void => {
        const id = `node-${crypto.randomUUID()}`;
        const newNode: DagFlowNode = {
          id,
          type: 'dagNode',
          position: { x: 200, y: 200 },
          data: { id, label: 'Shell', nodeType: 'bash' },
        };
        pushSnapshotLatest();
        setNodes(nds => [...nds, newNode]);
        markDirty();
      },
      onDeleteSelected: (): void => {
        if (selectedNodeId) {
          handleNodeDelete();
        }
      },
      onDuplicateSelected: (): void => {
        if (!selectedNodeId) return;
        const sourceNode = nodes.find(n => n.id === selectedNodeId);
        if (!sourceNode) return;
        const id = `node-${crypto.randomUUID()}`;
        const newNode: DagFlowNode = {
          id,
          type: 'dagNode',
          position: { x: sourceNode.position.x + 30, y: sourceNode.position.y + 30 },
          data: { ...sourceNode.data, id },
        };
        pushSnapshotLatest();
        setNodes(nds => [...nds, newNode]);
        markDirty();
      },
    }),
    [
      handleSave,
      handleUndo,
      handleRedo,
      handleToggleValidationPanel,
      handleNodeDelete,
      nodes,
      selectedNodeId,
      pushSnapshotLatest,
      setNodes,
      markDirty,
    ]
  );
  useBuilderKeyboard(keyboardActions, true);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;

  const steps = useMemo(
    () => groupNodesIntoSteps(reactFlowToDagNodes(nodes, edges)),
    [nodes, edges]
  );
  const selectedStepIndex = selectedNodeId === null ? -1 : stepIndexOf(steps, selectedNodeId);

  const handleStartFrom = useCallback(
    async (name: string | null): Promise<void> => {
      pushSnapshotLatest();
      setStartFrom(name ?? '');
      setSelectedNodeId(null);
      if (name === null) {
        setWorkflowName('');
        setWorkflowDescription('');
        setProvider(undefined);
        setModel(undefined);
        setWorkflowMetadata({});
        setWorkflowSource(undefined);
        setNodes([]);
        setEdges([]);
        setValidationErrors([]);
        setNotice(null);
        setHasUnsavedChanges(false);
        return;
      }
      await loadWorkflow(name);
      // A start point is a copy: it saves as a new project workflow.
      setWorkflowName(`${name}-copy`);
      setWorkflowSource(undefined);
      setHasUnsavedChanges(true);
      setNotice({ kind: 'info', text: `Started from ${name}. Saving creates ${name}-copy.` });
    },
    [loadWorkflow, pushSnapshotLatest, setNodes, setEdges]
  );

  const handleAddNode = useCallback(
    (kind: BuilderNodeKind): void => {
      const base = kind === 'route_loop' ? 'route' : kind;
      const taken = new Set(nodes.map(n => n.id));
      let counter = nodes.length + 1;
      while (taken.has(`${base}-${String(counter)}`)) counter += 1;
      const id = `${base}-${String(counter)}`;
      // A new node goes into the step after the selected one, or into a new last step.
      const targetStep = selectedStepIndex >= 0 ? selectedStepIndex + 1 : steps.length;
      const dependsOn = dependenciesForStep(steps, targetStep);
      const label =
        kind === 'command'
          ? (commandList[0]?.name ?? '')
          : kind === 'prompt'
            ? 'Prompt'
            : kind === 'bash'
              ? 'Shell'
              : 'Route';
      const newNode: DagFlowNode = {
        id,
        type: 'dagNode',
        position: { x: targetStep * 260, y: (steps[targetStep]?.nodes.length ?? 0) * 110 },
        data: {
          id,
          label,
          nodeType: kind,
          depends_on: dependsOn.length > 0 ? dependsOn : undefined,
          ...(kind === 'prompt' ? { promptText: '' } : {}),
          ...(kind === 'bash' ? { bashScript: '' } : {}),
        },
      };
      pushSnapshotLatest();
      setNodes(nds => [...nds, newNode]);
      setEdges(eds => withNodeDependencies(eds, id, dependsOn));
      setSelectedNodeId(id);
      markDirty();
    },
    [
      nodes,
      selectedStepIndex,
      steps,
      commandList,
      pushSnapshotLatest,
      setNodes,
      setEdges,
      markDirty,
    ]
  );

  const handleMoveStep = useCallback(
    (direction: -1 | 1): void => {
      if (selectedNodeId === null || selectedStepIndex < 0) return;
      const target = selectedStepIndex + direction;
      if (target < 0) return;
      const dependsOn = dependenciesForStep(steps, target, selectedNodeId);
      // Moving right needs a node to follow; without one the node stays where it is.
      if (direction === 1 && dependsOn.length === 0) return;
      pushSnapshotLatest();
      handleNodeUpdate({ depends_on: dependsOn.length > 0 ? dependsOn : undefined });
    },
    [selectedNodeId, selectedStepIndex, steps, pushSnapshotLatest, handleNodeUpdate]
  );

  const saveBlocked = errorCount > 0;
  const statsText = `${String(nodes.length)} ${nodes.length === 1 ? 'node' : 'nodes'} · ${String(steps.length)} ${steps.length === 1 ? 'step' : 'steps'} · ${String(errorCount)} ${errorCount === 1 ? 'error' : 'errors'}`;
  const activeNotice: BuilderNotice | null =
    validationErrors.length > 0 ? { kind: 'error', text: validationErrors.join(' ') } : notice;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(300px,380px)]">
      <BuilderPalette
        workflows={workflowList?.workflows ?? []}
        startFrom={startFrom}
        onStartFrom={(name): void => {
          void handleStartFrom(name);
        }}
        addHint={
          selectedNodeId !== null
            ? `Adds to the step after ${selectedNodeId}.`
            : 'Adds a new step at the end.'
        }
        onAdd={handleAddNode}
        commands={commandList}
        commandsLoading={commandsLoading}
        showLibrary={canvasView === 'graph' && showLibrary}
      />

      <section
        aria-label="Workflow canvas"
        className="flex min-h-0 min-w-0 flex-col border-r border-border"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-3">
          <input
            aria-label="Workflow name"
            value={workflowName}
            placeholder="workflow-name"
            onChange={(event): void => {
              setWorkflowName(event.target.value.replace(/\s+/g, '-'));
              markDirty();
            }}
            className="min-h-10 min-w-[200px] flex-1 border border-line-strong bg-card px-3 text-xl font-extrabold text-text-primary placeholder:text-text-tertiary"
          />
          <span
            className={cn(
              'text-xs font-semibold',
              saveBlocked ? 'text-status-failed' : 'text-text-secondary'
            )}
          >
            {statsText}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              disabled={!canUndo}
              onClick={handleUndo}
            >
              <Undo2 className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={handleRedo}
            >
              <Redo2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={(): void => {
              void handleValidate();
            }}
          >
            Validate
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={workflowName.trim() === '' || hasUnsavedChanges}
            title={hasUnsavedChanges ? 'Save before running' : undefined}
            onClick={(): void => {
              void handleRun();
            }}
          >
            Run
          </Button>
          <Button
            size="sm"
            onClick={(): void => {
              if (saveBlocked) {
                setNotice({
                  kind: 'error',
                  text: `Fix ${String(errorCount)} ${errorCount === 1 ? 'error' : 'errors'} before saving.`,
                });
                setValidationPanelOpen(true);
                return;
              }
              void handleSave();
            }}
          >
            {hasUnsavedChanges || workflowName.trim() === '' ? 'Save' : 'Saved'}
          </Button>
        </div>
        {activeNotice !== null ? (
          <div
            role={activeNotice.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'border-b border-border px-6 py-2 text-[13px] font-semibold',
              NOTICE_CLASS[activeNotice.kind]
            )}
          >
            {activeNotice.text}
          </div>
        ) : null}
        {commandsError ? (
          <div className="border-b border-border bg-tint-error px-6 py-2 text-xs text-error">
            Failed to load commands. Command palette and dropdowns may be empty.
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 px-6 pt-3">
          <SectionLabel>Canvas</SectionLabel>
          <Segmented<CanvasView>
            aria-label="Canvas view"
            value={canvasView}
            onValueChange={setCanvasView}
            options={[
              { value: 'steps', label: 'Steps' },
              { value: 'graph', label: 'Graph' },
            ]}
          />
        </div>
        {canvasView === 'steps' ? (
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
            <StepsCanvas
              steps={steps}
              selectedNodeId={selectedNodeId}
              onSelect={(id): void => {
                setSelectedNodeId(id);
                setInspectorTab('inspector');
              }}
            />
          </div>
        ) : (
          <div className="relative mt-3 min-h-0 flex-1 overflow-hidden border-t border-border">
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              setNodes={setNodes}
              setEdges={setEdges}
              onNodeSelect={setSelectedNodeId}
              onNodeDelete={handleNodeDeleteById}
              onDirty={markDirty}
              onPushSnapshot={pushSnapshotLatest}
              commands={commandList}
            />
          </div>
        )}
        <ValidationPanel
          issues={allValidationIssues}
          isOpen={validationPanelOpen}
          onToggle={handleToggleValidationPanel}
          onFocusNode={setSelectedNodeId}
        />
      </section>

      <section aria-label="Inspector" className="flex min-h-0 flex-col bg-background">
        <div
          role="tablist"
          aria-label="Inspector views"
          className="flex flex-none border-b border-border px-6"
        >
          {(['inspector', 'yaml'] as const).map(value => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={inspectorTab === value}
              onClick={(): void => {
                setInspectorTab(value);
              }}
              className={cn(
                '-mb-px mr-4 border-b-[3px] pt-3 pb-2 text-[13px] font-semibold',
                inspectorTab === value
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {value === 'inspector' ? 'Inspector' : 'YAML'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {inspectorTab === 'yaml' ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-secondary">
                .archon/workflows/{workflowName.trim() || 'untitled'}.yaml
              </span>
              <YamlCodeView definition={buildDefinition()} mode="full" />
            </div>
          ) : selectedNode ? (
            <BuilderInspector
              node={selectedNode.data}
              commands={commandList}
              stepNumber={selectedStepIndex + 1}
              canMoveLeft={selectedStepIndex > 0}
              canMoveRight={
                dependenciesForStep(steps, selectedStepIndex + 1, selectedNode.id).length > 0
              }
              onMove={handleMoveStep}
              onUpdate={handleNodeUpdate}
              onDelete={handleNodeDelete}
            />
          ) : (
            <WorkflowSettings
              description={workflowDescription}
              provider={provider}
              model={model}
              onDescriptionChange={(next): void => {
                setWorkflowDescription(next);
                markDirty();
              }}
              onProviderChange={(next): void => {
                setProvider(next);
                markDirty();
              }}
              onModelChange={(next): void => {
                setModel(next);
                markDirty();
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function WorkflowBuilder(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner />
    </ReactFlowProvider>
  );
}
