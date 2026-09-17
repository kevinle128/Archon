import { useEffect, useRef } from 'react';

import { askCardId } from '@/lib/execution-room-model';

import type { AskAnswerBody, PendingInteraction } from '../../skills/runs';
import { ensureUtc, formatDurationMs } from '../../lib/format';
import type { AskCardPresentation } from './ask-card-presentation';
import {
  draftToAnswerBody,
  isAskDraftValid,
  type AskDraft,
  type AskQuestion,
} from './parse-ask-envelope';

export interface ConsoleAskCardProps {
  interaction: PendingInteraction;
  questions: readonly AskQuestion[];
  presentation: AskCardPresentation;
  viewerIsStarter: boolean;
  starterDisplayName: string | null;
  agentDisplayName: string;
  nodeId: string;
  autoFocus: boolean;
  nowMs: number;
  /** Unique per mount context so stream and room copies never share a DOM id. */
  mountContext?: string;
  draft: AskDraft;
  onDraftChange: (next: AskDraft) => void;
  onSubmit: (body: Extract<AskAnswerBody, { answers: unknown }>) => void;
  onDecline: () => void;
}

export function replaceDraftValue(
  draft: AskDraft,
  questionId: string,
  value: string | string[]
): AskDraft {
  return { ...draft, [questionId]: value };
}

function listedOptions(question: AskQuestion, value: string | string[] | undefined): string[] {
  const items = Array.isArray(value) ? value : [];
  return items.filter(item => question.options.includes(item));
}

function otherTextFromDraft(question: AskQuestion, value: string | string[] | undefined): string {
  if (question.selection === 'single') {
    return typeof value === 'string' && !question.options.includes(value) ? value : '';
  }
  if (!Array.isArray(value)) return '';
  return value.find(item => !question.options.includes(item)) ?? '';
}

function isOtherOn(question: AskQuestion, value: string | string[] | undefined): boolean {
  if (!question.allowOther) return false;
  if (question.options.length === 0) return true;
  if (question.selection === 'single') {
    return typeof value === 'string' && !question.options.includes(value);
  }
  return (
    otherTextFromDraft(question, value).length > 0 || (Array.isArray(value) && value.includes(''))
  );
}

function elapsedWaitingMs(createdAt: string, nowMs: number): number {
  const startedAt = new Date(ensureUtc(createdAt)).getTime();
  if (!Number.isFinite(startedAt)) {
    return 0;
  }
  return Math.max(0, nowMs - startedAt);
}

function formatAnswerValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function answerSummaries(
  questions: readonly AskQuestion[],
  answer: AskAnswerBody | null
): { key: string; label: string; value: string }[] {
  if (answer === null || 'decline' in answer) {
    return [];
  }
  const prompts = new Map(
    questions.map((question): [string, string] => [question.id, question.prompt])
  );
  return answer.answers.map((item, index) => ({
    key: `${item.questionId}:${String(index)}`,
    label: prompts.get(item.questionId) ?? item.questionId,
    value: formatAnswerValue(item.value),
  }));
}

function PayloadDisclosure(props: {
  envelope: PendingInteraction['envelope'];
}): React.ReactElement {
  return (
    <details>
      <summary>View payload</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-text-secondary">
        {JSON.stringify(props.envelope, null, 2)}
      </pre>
    </details>
  );
}

function ResolvedStamp(props: { presentation: AskCardPresentation }): React.ReactElement | null {
  const { presentation } = props;
  let text: string | null = null;
  if (presentation.viewState === 'answered') {
    text = 'Answered';
  } else if (presentation.viewState === 'declined') {
    text = 'Declined';
  } else if (presentation.viewState === 'rejected-late') {
    text = 'Already answered';
  } else if (presentation.viewState === 'failed-resume') {
    text = 'Resume failed — node failed; your answer is preserved below';
  }
  if (text === null) {
    return null;
  }
  return (
    <p className="text-sm text-text-primary">
      <span>{text}</span>
      {presentation.viewState === 'failed-resume' && presentation.error !== null ? (
        <span className="mt-1 block text-error">{presentation.error}</span>
      ) : null}
      {presentation.resolvedAt !== null ? (
        <time className="mt-1 block text-xs text-text-tertiary" dateTime={presentation.resolvedAt}>
          {presentation.resolvedAt}
        </time>
      ) : null}
    </p>
  );
}

export function ConsoleAskCard(props: ConsoleAskCardProps): React.ReactElement {
  const {
    interaction,
    questions,
    presentation,
    agentDisplayName,
    nodeId,
    autoFocus,
    nowMs,
    mountContext = 'default',
    draft,
    onDraftChange,
    onSubmit,
    onDecline,
  } = props;

  const formRef = useRef<HTMLFormElement | null>(null);
  const declineDialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    formRef.current?.focus();
  }, [autoFocus]);

  function openDeclineDialog(): void {
    declineDialogRef.current?.showModal();
  }

  function closeDeclineDialog(): void {
    declineDialogRef.current?.close();
  }

  const draftValid = isAskDraftValid(questions, draft);
  const isPending = presentation.viewState === 'pending';
  const lockAnswers = !isPending;
  const showActions = isPending;

  function selectSingle(question: AskQuestion, option: string): void {
    onDraftChange(replaceDraftValue(draft, question.id, option));
  }

  function selectSingleOther(question: AskQuestion): void {
    onDraftChange(
      replaceDraftValue(draft, question.id, otherTextFromDraft(question, draft[question.id]))
    );
  }

  function toggleMulti(question: AskQuestion, option: string, checked: boolean): void {
    const extra = otherTextFromDraft(question, draft[question.id]);
    const listed = listedOptions(question, draft[question.id]);
    const nextListed = checked
      ? listed.includes(option)
        ? listed
        : [...listed, option]
      : listed.filter(item => item !== option);
    const keepOther = isOtherOn(question, draft[question.id]);
    const next = keepOther ? [...nextListed, extra] : nextListed;
    onDraftChange(replaceDraftValue(draft, question.id, next));
  }

  function setQuestionOtherSelected(question: AskQuestion, selected: boolean): void {
    const listed = listedOptions(question, draft[question.id]);
    if (selected) {
      onDraftChange(
        replaceDraftValue(draft, question.id, [
          ...listed,
          otherTextFromDraft(question, draft[question.id]),
        ])
      );
      return;
    }
    onDraftChange(replaceDraftValue(draft, question.id, listed));
  }

  function setQuestionOtherText(question: AskQuestion, value: string): void {
    if (question.selection === 'single') {
      onDraftChange(replaceDraftValue(draft, question.id, value));
      return;
    }
    const listed = listedOptions(question, draft[question.id]);
    onDraftChange(replaceDraftValue(draft, question.id, [...listed, value]));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!showActions || !draftValid) {
      return;
    }
    onSubmit(draftToAnswerBody(questions, draft));
  }

  return (
    <form
      ref={formRef}
      id={askCardId(interaction.tool_use_id, mountContext)}
      tabIndex={-1}
      aria-label={`question from agent, ${String(questions.length)} questions`}
      onSubmit={handleSubmit}
    >
      <div className="rounded-lg border border-warning bg-surface-elevated shadow-sm">
        <div className="p-4">
          <p className="text-sm font-medium text-text-primary">{`${agentDisplayName} is asking`}</p>
          <p className="flex flex-wrap items-center gap-2 text-xs">
            <span>{nodeId}</span>
            <span>{formatDurationMs(elapsedWaitingMs(interaction.created_at, nowMs))}</span>
          </p>
        </div>
        <div className="space-y-4 px-4 pb-4">
          {presentation.viewState === 'sending' ? (
            <p className="text-sm text-text-secondary">Sending…</p>
          ) : null}
          <ResolvedStamp presentation={presentation} />
          {presentation.error !== null && presentation.viewState !== 'failed-resume' ? (
            <p role="alert" className="text-sm text-error">
              {presentation.error}
            </p>
          ) : null}
          {answerSummaries(questions, presentation.answer).map(item => (
            <p key={item.key} className="text-sm text-text-primary">
              {item.label}: {item.value}
            </p>
          ))}
          <fieldset disabled={lockAnswers} className="min-w-0 space-y-4 border-0 p-0">
            {questions.map(question => {
              const value = draft[question.id];
              const otherOn = isOtherOn(question, value);
              const listed = listedOptions(question, value);
              return (
                <fieldset key={question.id} className="min-w-0 space-y-2 border-0 p-0">
                  <legend className="text-sm font-medium text-text-primary">
                    {question.prompt}
                  </legend>
                  {question.options.map(option => {
                    const controlId = `${mountContext}:${interaction.id}:${question.id}:${option}`;
                    if (question.selection === 'single') {
                      return (
                        <label
                          key={option}
                          className="flex items-center gap-2 text-sm text-text-primary"
                        >
                          <input
                            id={controlId}
                            type="radio"
                            name={`${mountContext}:${interaction.id}:${question.id}`}
                            value={option}
                            checked={!otherOn && value === option}
                            onChange={(): void => {
                              selectSingle(question, option);
                            }}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    }
                    return (
                      <label
                        key={option}
                        className="flex items-center gap-2 text-sm text-text-primary"
                      >
                        <input
                          id={controlId}
                          type="checkbox"
                          name={`${mountContext}:${interaction.id}:${question.id}`}
                          value={option}
                          checked={listed.includes(option)}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                            toggleMulti(question, option, event.target.checked);
                          }}
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                  {question.allowOther ? (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm text-text-primary">
                        <input
                          type={question.selection === 'single' ? 'radio' : 'checkbox'}
                          name={`${mountContext}:${interaction.id}:${question.id}`}
                          value="__other__"
                          checked={otherOn}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                            if (question.selection === 'single') {
                              selectSingleOther(question);
                              return;
                            }
                            setQuestionOtherSelected(question, event.target.checked);
                          }}
                        />
                        <span>Other</span>
                      </label>
                      {otherOn ? (
                        <textarea
                          aria-label={`Other answer for ${question.prompt}`}
                          aria-required="true"
                          value={otherTextFromDraft(question, value)}
                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
                            setQuestionOtherText(question, event.target.value);
                          }}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </fieldset>
              );
            })}
          </fieldset>
        </div>
        <div className="flex flex-col items-stretch gap-3 px-4 pb-4">
          {showActions ? (
            <div className="flex flex-col items-stretch gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!draftValid}
                  className="rounded-md border border-border px-3 py-2 text-sm text-text-primary"
                >
                  Submit
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-2 text-sm text-text-primary"
                  onClick={openDeclineDialog}
                >
                  Decline
                </button>
                <dialog
                  ref={declineDialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`${interaction.id}:decline-title`}
                  aria-describedby={`${interaction.id}:decline-description`}
                  className="rounded-lg border border-border bg-surface-elevated p-4 text-text-primary"
                >
                  <h2 id={`${interaction.id}:decline-title`} className="text-sm font-medium">
                    Decline this ask?
                  </h2>
                  <p
                    id={`${interaction.id}:decline-description`}
                    className="mt-2 text-sm text-text-secondary"
                  >
                    The agent will be told you declined
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={closeDeclineDialog}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={(): void => {
                        closeDeclineDialog();
                        onDecline();
                      }}
                    >
                      Decline
                    </button>
                  </div>
                </dialog>
              </div>
            </div>
          ) : null}
          <PayloadDisclosure envelope={interaction.envelope} />
        </div>
      </div>
    </form>
  );
}

export function ConsoleInvalidAskCard(props: {
  interaction: PendingInteraction;
  agentDisplayName: string;
  nodeId: string;
}): React.ReactElement {
  return (
    <section
      role="alert"
      className="rounded-lg border border-error bg-error/5 p-4 text-text-primary shadow-sm"
    >
      <p className="text-sm font-medium">Invalid Ask payload</p>
      <p className="mt-1 text-xs text-text-secondary">{`${props.agentDisplayName} · ${props.nodeId}`}</p>
      <div className="mt-3">
        <PayloadDisclosure envelope={props.interaction.envelope} />
      </div>
    </section>
  );
}
