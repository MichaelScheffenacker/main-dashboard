import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startApi } from './helpers/api.ts';
import type { TodoState } from '../src/todo.ts';

const empty = (): TodoState => ({ revision: 0, boards: [] });
const boardState = (): TodoState => ({ revision: 0, boards: [
  { id: '1ef029e1-c4b3-441a-832d-c70ca83ec4dd', title: 'Work', tasks: [] },
] });

test('GET /api/todo starts empty and returns uncached JSON', async t => {
  const api = await startApi(); t.after(() => api.close());
  const response = await api.call('/api/todo');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type']!, /application\/json/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), empty());
});

test('browser workflow: create an empty board, read it, add a second board, rename and delete', async t => {
  const api = await startApi(); t.after(() => api.close());
  let state: TodoState = JSON.parse((await api.call('/api/todo')).body);
  state.boards.push(boardState().boards[0]);
  // Simulate the browser's Origin and Host when accessing the app over the LAN.
  const headers = { Host: '192.168.0.3:3000', Origin: 'http://192.168.0.3:3000' };
  const save = await api.call('/api/todo', { method: 'PUT', payload: state, headers });
  assert.equal(save.status, 200, save.body);
  assert.deepEqual(JSON.parse(save.body), { ...state, revision: 1 });
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), { ...state, revision: 1 });

  state = JSON.parse(save.body);
  state.boards.push({ id: 'board-2', title: 'Personal', tasks: [] });
  state.boards[0].title = 'Work priorities';
  const update = await api.call('/api/todo', { method: 'PUT', payload: state, headers });
  assert.equal(update.status, 200, update.body);
  assert.deepEqual(JSON.parse(update.body), { ...state, revision: 2 });
  state = JSON.parse(update.body);
  state.boards.splice(0, 1);
  const remove = await api.call('/api/todo', { method: 'PUT', payload: state, headers });
  assert.equal(remove.status, 200, remove.body);
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), { ...state, revision: 3 });
});

test('API preserves board/task order, task edits, status changes and moves between boards', async t => {
  const api = await startApi(); t.after(() => api.close());
  const state = boardState();
  state.boards[0].tasks = [
    { id: 'task-1', text: 'First task', status: 'todo' },
    { id: 'task-2', text: 'Second task', status: 'todo' },
    { id: 'task-3', text: 'Finished task', status: 'done' },
  ];
  state.boards.push({ id: 'board-2', title: 'Personal', tasks: [] });
  assert.equal((await api.call('/api/todo', { method: 'PUT', payload: state })).status, 200);
  state.revision = 1;
  state.boards.reverse();
  const task = state.boards[1].tasks.shift()!;
  task.status = 'doing'; task.text = 'Moved task';
  state.boards[0].tasks.push(task);
  state.boards[1].tasks.reverse();
  const response = await api.call('/api/todo', { method: 'PUT', payload: state });
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(JSON.parse(response.body), { ...state, revision: 2 });
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), { ...state, revision: 2 });
});

test('saved boards survive closing and reopening the server/database', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-api-'));
  let reopened: Awaited<ReturnType<typeof startApi>> | undefined;
  t.after(async () => {
    if (reopened) await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'dashboard.sqlite');
  const first = await startApi(path);
  const state = boardState();
  try {
    assert.equal((await first.call('/api/todo', { method: 'PUT', payload: state })).status, 200);
  } finally { await first.close(); }
  const second = await startApi(path); reopened = second;
  assert.deepEqual(JSON.parse((await second.call('/api/todo')).body), { ...state, revision: 1 });
});

test('simultaneous writes accept one revision and reject the stale edit without overwriting data', async t => {
  const api = await startApi(); t.after(() => api.close());
  const first = boardState();
  const second = boardState(); second.boards[0].title = 'Other tab';
  const responses = await Promise.all([first, second].map(payload => api.call('/api/todo', { method: 'PUT', payload })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.match(JSON.parse(responses.find(r => r.status === 409)!.body).error, /another tab/i);
  const winner = JSON.parse(responses.find(r => r.status === 200)!.body);
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), winner);
  const retry = await api.call('/api/todo', { method: 'PUT', payload: { ...winner, boards: [] } });
  assert.equal(retry.status, 200);
  assert.deepEqual(JSON.parse(retry.body), { revision: 2, boards: [] });
});

const invalidPayloads: [string, unknown][] = [
  ['null', null], ['an array', []], ['missing revision', { boards: [] }],
  ['negative revision', { ...empty(), revision: -1 }],
  ['fractional revision', { ...empty(), revision: 0.5 }],
  ['extra root field', { ...empty(), extra: true }],
  ['empty title', { revision: 0, boards: [{ id: 'b', title: '', tasks: [] }] }],
  ['blank title', { revision: 0, boards: [{ id: 'b', title: '   ', tasks: [] }] }],
  ['multiline title', { revision: 0, boards: [{ id: 'b', title: 'One\nTwo', tasks: [] }] }],
  ['long title', { revision: 0, boards: [{ id: 'b', title: 'x'.repeat(101), tasks: [] }] }],
  ['extra board field', { revision: 0, boards: [{ id: 'b', title: 'Work', tasks: [], extra: true }] }],
  ['missing tasks', { revision: 0, boards: [{ id: 'b', title: 'Work' }] }],
  ['invalid ID', { revision: 0, boards: [{ id: '../b', title: 'Work', tasks: [] }] }],
  ['duplicate boards', { revision: 0, boards: [boardState().boards[0], boardState().boards[0]] }],
  ['too many boards', { revision: 0, boards: Array.from({ length: 51 }, (_, i) => ({ id: `b${i}`, title: 'Work', tasks: [] })) }],
];
for (const [name, task] of [
  ['invalid status', { id: 't', text: 'Task', status: 'waiting' }],
  ['multiline task', { id: 't', text: 'One\nTwo', status: 'todo' }],
  ['empty task', { id: 't', text: '', status: 'todo' }],
  ['long task', { id: 't', text: 'x'.repeat(301), status: 'todo' }],
  ['duplicate board/task ID', { id: 'b', text: 'Task', status: 'todo' }],
  ['extra task field', { id: 't', text: 'Task', status: 'todo', extra: true }],
] as const) invalidPayloads.push([name, { revision: 0, boards: [{ id: 'b', title: 'Work', tasks: [task] }] }]);
invalidPayloads.push(['too many tasks', { revision: 0, boards: [{ id: 'b', title: 'Work', tasks: Array.from({ length: 1001 }, (_, i) => ({ id: `t${i}`, text: 'Task', status: 'todo' })) }] }]);

test('invalid state returns 400 and leaves existing boards and revision unchanged', async t => {
  const api = await startApi(); t.after(() => api.close());
  const saved = await api.call('/api/todo', { method: 'PUT', payload: boardState() });
  assert.equal(saved.status, 200);
  for (const [name, payload] of invalidPayloads) {
    await t.test(name, async () => {
      const response = await api.call('/api/todo', { method: 'PUT', payload });
      assert.equal(response.status, 400, response.body);
      assert.equal(typeof JSON.parse(response.body).error, 'string');
      assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), JSON.parse(saved.body));
    });
  }
});

test('valid text boundaries, Unicode and SQL/HTML-like text round-trip unchanged', async t => {
  const api = await startApi(); t.after(() => api.close());
  const state = boardState();
  state.boards[0].title = 'x'.repeat(100);
  state.boards[0].tasks = [
    { id: 't1', text: 'x'.repeat(300), status: 'todo' },
    { id: 't2', text: 'Ångström — 日本語 ✓', status: 'doing' },
    { id: 't3', text: "'); DROP TABLE todo_boards; -- <script>alert(1)</script>", status: 'done' },
  ];
  const response = await api.call('/api/todo', { method: 'PUT', payload: state });
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), { ...state, revision: 1 });
});

test('API rejects unsupported methods, bodies on GET, foreign origins and malformed JSON', async t => {
  const api = await startApi(); t.after(() => api.close());
  const cases: [string, Parameters<typeof api.call>[1], number][] = [
    ['/api/todo', { method: 'POST' }, 405],
    ['/api/todo', { method: 'DELETE' }, 405],
    ['/api/todo', { payload: {} }, 400],
    ['/health', { payload: {} }, 400],
    ['/api/todo', { method: 'PUT', rawBody: '' }, 400],
    ['/api/todo', { method: 'PUT', rawBody: '{' }, 400],
    ['/api/todo', { method: 'PUT', payload: empty(), headers: { 'Content-Type': 'text/plain' } }, 415],
    ['/api/todo', { method: 'PUT', payload: empty(), headers: { Origin: 'https://foreign.example' } }, 403],
    ['/unknown', {}, 404],
    ['/' + 'a'.repeat(256), {}, 414],
  ];
  for (const [path, options, status] of cases) {
    const response = await api.call(path, options);
    assert.equal(response.status, status, `${options?.method || 'GET'} ${path}: ${response.body}`);
    assert.equal(typeof JSON.parse(response.body).error, 'string');
    assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), empty());
  }
});

test('API accepts valid chunked JSON and rejects oversized Content-Length payloads', async t => {
  const api = await startApi(); t.after(() => api.close());
  assert.equal((await api.call('/api/todo', { method: 'PUT', payload: boardState(), chunked: true })).status, 200);
  const before = JSON.parse((await api.call('/api/todo')).body);
  const response = await api.call('/api/todo', { method: 'PUT', rawBody: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), before);
});

test('dashboard assets and health endpoint are available; arbitrary files are inaccessible', async t => {
  const api = await startApi(); t.after(() => api.close());
  assert.deepEqual(JSON.parse((await api.call('/health')).body), { status: 'ok', database: 'sqlite' });
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css']]) {
    const response = await api.call(path);
    assert.equal(response.status, 200);
    assert.ok(response.headers['content-type']?.startsWith(type));
    assert.ok(response.body.length > 0);
  }
  for (const path of ['/../package.json', '/src/server.ts', '/data/dashboard.sqlite']) {
    assert.equal((await api.call(path)).status, 404);
  }
});
