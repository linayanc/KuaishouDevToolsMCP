import test from 'node:test';
import assert from 'node:assert/strict';
import { LogStore, normalizeEvent } from '../src/logs.js';

const event = (message: string, timestamp = 1000, type = 'log') => ({ method: 'Runtime.consoleAPICalled', params: {
  type, timestamp, args: [{ type: 'string', value: message }], executionContextId: 1,
} });

test('same event is deduplicated, but repeated messages at different timestamps survive', () => {
  const store = new LogStore(10);
  store.append(event('hello'), 'runtime');
  store.append(event('hello'), 'runtime');
  store.append(event('hello', 2000), 'runtime');
  assert.equal(store.snapshot().entries.length, 2);
});
test('replayed Error objects with new remote handles are deduplicated without merging sub-millisecond events', () => {
  const store = new LogStore(10);
  const make = (objectId: string, timestamp = 1000.123) => ({ method: 'Runtime.consoleAPICalled', params: {
    type: 'error', timestamp, args: [{ type: 'object', subtype: 'error', description: 'Error: boom', objectId }], executionContextId: 1,
  } });
  store.append(make('connection-1.1'), 'a');
  store.append(make('connection-2.2'), 'a');
  store.append(make('connection-2.3', 1000.124), 'a');
  assert.equal(store.snapshot().entries.length, 2);
});
test('incremental pagination does not skip records and filters advance past nonmatching records', () => {
  const store = new LogStore(10);
  for (let i = 1; i <= 7; i++) store.append(event(`entry-${i}`, i, i % 2 ? 'error' : 'log'), 'a');
  let page = store.since(0, { levels: ['error'], limit: 2 });
  assert.deepEqual(page.entries.map(e => e.id), [1, 3]);
  assert.equal(page.hasMore, true);
  page = store.since(store.parseCursor(page.nextCursor), { levels: ['error'], limit: 2 });
  assert.deepEqual(page.entries.map(e => e.id), [5, 7]);
  assert.equal(page.hasMore, false);
  assert.equal(store.since(0, { contains: 'missing' }).nextCursor, store.cursor(7));
});
test('retention overflow is explicit and old sessions/future cursors are rejected', () => {
  const store = new LogStore(2);
  for (let i = 1; i <= 4; i++) store.append(event(String(i), i), 'a');
  assert.equal(store.since(0).dropped, 2);
  assert.deepEqual(store.since(0).entries.map(e => e.id), [3, 4]);
  assert.throws(() => store.parseCursor(new LogStore().cursor()), /another project/);
  assert.throws(() => store.parseCursor(store.cursor(999)), /invalid/);
  assert.throws(() => store.parseCursor(`${store.session}:-1`));
});
test('console levels, exception stack locations, redaction, object previews and output limits', () => {
  assert.equal(normalizeEvent(event('warn', 1, 'warning'), 'a')?.level, 'warn');
  assert.equal(normalizeEvent(event('assert', 1, 'assert'), 'a')?.level, 'error');
  const entry = normalizeEvent({ method: 'Runtime.exceptionThrown', params: { timestamp: 2000,
    exceptionDetails: { exception: { description: 'Error: token=abc123' }, stackTrace: { callFrames: [
      { functionName: 'start', url: 'game.js?token=secret', lineNumber: 4, columnNumber: 2 },
    ] } } } }, 'a')!;
  assert.equal(entry.level, 'exception');
  assert.equal(entry.message, 'Error: token=[REDACTED]');
  assert.deepEqual(entry.stack[0], { functionName: 'start', url: 'game.js', line: 5, column: 3 });
  const large = normalizeEvent(event('x'.repeat(10000)), 'a')!;
  assert.equal(large.message.length, 8000);
  assert.equal(large.truncated, true);
  const object = normalizeEvent({ method: 'Runtime.consoleAPICalled', params: { args: [
    { type: 'object', description: 'Object', preview: { properties: [{ name: 'score', value: '42' }] } },
    { type: 'number', unserializableValue: 'NaN' },
  ] } }, 'a')!;
  assert.equal(object.message, 'Object {score: 42} NaN');
});
