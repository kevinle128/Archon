/**
 * DOM-free scroll-follow reducer for run rooms.
 *
 * Completed and failed executions start at the top. Running and awaiting
 * executions pin to the bottom until the reader scrolls more than 24px away.
 * A saved scrollTop from the current visit wins on reopen.
 */

const FOLLOW_THRESHOLD_PX = 24;

export interface ScrollFollowMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ScrollFollowState {
  follow: boolean;
  scrollTop: number | null;
  pinToBottom: boolean;
}

function isLiveStatus(status: string): boolean {
  return status === 'running' || status === 'awaiting';
}

export function createScrollFollow(status: string, savedScrollTop?: number): ScrollFollowState {
  if (savedScrollTop !== undefined) {
    return { follow: false, scrollTop: savedScrollTop, pinToBottom: false };
  }
  if (isLiveStatus(status)) {
    return { follow: true, scrollTop: null, pinToBottom: true };
  }
  return { follow: false, scrollTop: 0, pinToBottom: false };
}

export function onRoomScroll(
  state: ScrollFollowState,
  metrics: ScrollFollowMetrics
): ScrollFollowState {
  const distance = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  const follow = distance <= FOLLOW_THRESHOLD_PX;
  return {
    ...state,
    follow,
    scrollTop: metrics.scrollTop,
    pinToBottom: follow,
  };
}

export function jumpToLatest(state: ScrollFollowState): ScrollFollowState {
  return { ...state, follow: true, pinToBottom: true };
}

export function jumpToOccurrence(state: ScrollFollowState, scrollTop: number): ScrollFollowState {
  return { ...state, follow: false, scrollTop, pinToBottom: false };
}
