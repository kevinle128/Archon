interface QueueWaiter<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

type QueueTerminal = { kind: 'closed' } | { kind: 'failed'; error: unknown };

/**
 * FIFO async iterable that bridges push callbacks to a single consumer.
 * Buffered values drain before close completes or fail rejects.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiter: QueueWaiter<T> | undefined;
  private terminal: QueueTerminal | undefined;

  push(value: T): void {
    if (this.terminal !== undefined) {
      throw new Error('AsyncQueue.push() after terminal state');
    }
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter.resolve({ value, done: false });
      return;
    }
    this.buffer.push(value);
  }

  close(): void {
    if (this.terminal !== undefined) {
      return;
    }
    this.terminal = { kind: 'closed' };
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.terminal !== undefined) {
      return;
    }
    this.terminal = { kind: 'failed', error };
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => this.next(),
    };
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      return Promise.resolve({ value: this.buffer.shift() as T, done: false });
    }
    if (this.terminal !== undefined) {
      if (this.terminal.kind === 'failed') {
        const error = this.terminal.error;
        return new Promise(
          (resolve: (result: IteratorResult<T>) => void, reject: (reason: unknown) => void) => {
            const waiter: QueueWaiter<T> = { resolve, reject };
            waiter.reject(error);
          }
        );
      }
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise(
      (resolve: (result: IteratorResult<T>) => void, reject: (error: unknown) => void) => {
        this.waiter = { resolve, reject };
      }
    );
  }
}
