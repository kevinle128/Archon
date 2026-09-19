import { useRef, type ReactElement } from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { Diff } from 'react-diff-view/esm/index.js';
import { type HunkData, type RenderGutter } from 'react-diff-view';
import 'react-diff-view/style/index.css';

import type { GitReadyDiffResponse } from '@/lib/api';

import { hunksForSide, toHunkData } from '@/lib/git-hunk-adapter';
import './source-control-diff.css';
import { highlightDiffTokens, renderHighlightedToken } from './syntax-highlight';

const PANE_HEIGHT = 280;

const renderGutter: RenderGutter = ({ change, side, renderDefault }) => {
  const marker =
    change.type === 'delete' && side === 'old'
      ? '-'
      : change.type === 'insert' && side === 'new'
        ? '+'
        : '';
  return (
    <>
      <span aria-hidden="true" className="sc-diff-marker">
        {marker}
      </span>
      <span>{renderDefault()}</span>
    </>
  );
};

function estimateHunkHeight(hunks: readonly HunkData[]): (index: number) => number {
  return (index: number): number => {
    const hunk = hunks[index];
    return 24 + (hunk?.changes.length ?? 1) * 20;
  };
}

function observePaneRect(
  instance: Virtualizer<HTMLDivElement, Element>,
  cb: (rect: { width: number; height: number }) => void
): (() => void) | undefined {
  const element = instance.scrollElement;
  if (!element) return undefined;
  const emit = (): void => {
    const rect = element.getBoundingClientRect();
    cb({
      width: Math.max(Math.round(rect.width), 1),
      height: Math.max(Math.round(rect.height), PANE_HEIGHT),
    });
  };
  emit();
  const RESIZE_OBSERVER = element.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
  const observer = new RESIZE_OBSERVER((): void => {
    emit();
  });
  observer.observe(element);
  return (): void => {
    observer.disconnect();
  };
}

function VirtualizedDiffSide(props: {
  label: 'Before' | 'After';
  sideClassName: string;
  paneClassName?: string;
  hunks: HunkData[];
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: props.hunks.length,
    getScrollElement: (): HTMLDivElement | null => scrollRef.current,
    estimateSize: estimateHunkHeight(props.hunks),
    initialRect: { width: 0, height: PANE_HEIGHT },
    observeElementRect: observePaneRect,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const virtualized = virtualItems.length > 0;

  const renderHunk = (hunk: HunkData, key: string, start?: number): ReactElement => (
    <div
      key={key}
      className="sc-virtual-hunk"
      style={
        start === undefined
          ? undefined
          : {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${String(start)}px)`,
            }
      }
    >
      <Diff
        diffType="modify"
        viewType="split"
        hunks={[hunk]}
        tokens={highlightDiffTokens([hunk])}
        renderToken={renderHighlightedToken}
        renderGutter={renderGutter}
        className={`sc-diff-side ${props.sideClassName}`}
      />
    </div>
  );

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${props.paneClassName ?? ''}`}>
      <div
        ref={scrollRef}
        aria-label={props.label}
        tabIndex={0}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        {virtualized ? (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: 'relative',
            }}
          >
            {virtualItems.map(item => {
              const hunk = props.hunks[item.index];
              if (!hunk) return null;
              return renderHunk(hunk, String(item.key), item.start);
            })}
          </div>
        ) : (
          props.hunks.map((hunk, index) => renderHunk(hunk, String(index)))
        )}
      </div>
    </div>
  );
}

export function DiffPanes(props: {
  response: GitReadyDiffResponse;
  stacked: boolean;
}): ReactElement {
  const hunks = props.response.hunks.map(toHunkData);
  const oldHunks = hunksForSide(hunks, 'old');
  const newHunks = hunksForSide(hunks, 'new');
  const paneClass = props.stacked ? 'flex min-h-0 flex-1 flex-col' : 'flex min-h-0 flex-1 flex-row';

  return (
    <div className={paneClass}>
      <VirtualizedDiffSide label="Before" sideClassName="sc-diff-before" hunks={oldHunks} />
      <VirtualizedDiffSide
        label="After"
        sideClassName="sc-diff-after"
        paneClassName={props.stacked ? 'border-t border-border' : 'border-l border-border'}
        hunks={newHunks}
      />
    </div>
  );
}
