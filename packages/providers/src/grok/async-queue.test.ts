import { describe, expect, test } from 'bun:test';

import { AsyncQueue } from './async-queue';

describe('AsyncQueue', () => {
  test('push preserves FIFO order for a for-await consumer', async () => {
    const queue = new AsyncQueue<string>();
    queue.push('a');
    queue.push('b');
    queue.push('c');
    queue.close();

    const values: string[] = [];
    for await (const value of queue) {
      values.push(value);
    }
    expect(values).toEqual(['a', 'b', 'c']);
  });

  test('push immediately resolves a waiting reader', async () => {
    const queue = new AsyncQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();

    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    queue.push(7);
    expect(await pending).toEqual({ value: 7, done: false });
    expect(settled).toBe(true);
  });

  test('close drains buffered values before done: true', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.close();

    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  test('fail drains buffered values before rejecting with the stored error', async () => {
    const queue = new AsyncQueue<number>();
    const error = new Error('after drain');
    queue.push(1);
    queue.push(2);
    queue.fail(error);

    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
    await expect(iterator.next()).rejects.toBe(error);
    await expect(iterator.next()).rejects.toBe(error);
  });

  test('close is idempotent and push after close throws', () => {
    const queue = new AsyncQueue<number>();
    queue.close();
    queue.close();
    expect(() => queue.push(1)).toThrow();
  });

  test('fail is idempotent, preserves the first error, and push after fail throws', async () => {
    const queue = new AsyncQueue<number>();
    const first = new Error('first');
    queue.fail(first);
    queue.fail(new Error('second'));
    expect(() => queue.push(1)).toThrow();

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(first);
  });

  test('fail after close is a no-op', async () => {
    const queue = new AsyncQueue<number>();
    queue.close();
    queue.fail(new Error('ignored'));

    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  test('close after fail is a no-op', async () => {
    const queue = new AsyncQueue<number>();
    const error = new Error('boom');
    queue.fail(error);
    queue.close();

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(error);
  });

  test('close while a reader is waiting settles once with done: true', async () => {
    const queue = new AsyncQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    queue.close();
    queue.close();
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  test('fail while a reader is waiting rejects once with the first error', async () => {
    const queue = new AsyncQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    const first = new Error('first');
    queue.fail(first);
    queue.fail(new Error('second'));
    await expect(pending).rejects.toBe(first);
  });

  test('push after resolving a waiter does not settle that waiter twice', async () => {
    const queue = new AsyncQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    queue.push(1);
    expect(await pending).toEqual({ value: 1, done: false });
    queue.close();
    queue.fail(new Error('ignored'));
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
