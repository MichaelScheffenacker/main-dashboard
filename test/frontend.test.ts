import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { startApi } from './helpers/api.ts';
import type { TodoState } from '../src/todo.ts';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for frontend update');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function frontend(t: TestContext, initial?: TodoState) {
  const api = await startApi();
  if (initial) assert.equal((await api.call('/api/todo', { method: 'PUT', payload: initial })).status, 200);
  const errors: Error[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, { url: 'http://192.168.0.3:3000/#todo', runScripts: 'outside-only', virtualConsole });
  t.after(async () => { dom.window.close(); await api.close(); });
  const { window } = dom;
  const document = window.document;
  // Reproduce a LAN HTTP page with no secure-context randomUUID API.
  Object.defineProperty(window.crypto, 'randomUUID', { value: undefined });
  Object.defineProperty(window, 'structuredClone', { value: structuredClone });
  let rejectNext = false;
  Object.defineProperty(window, 'fetch', { value: async (path: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    if (rejectNext) { rejectNext = false; throw new Error('Connection lost'); }
    const response = await api.call(path, {
      method: options.method,
      rawBody: options.body,
      headers: { ...options.headers, Host: window.location.host, ...(options.method === 'PUT' ? { Origin: window.location.origin } : {}) },
    });
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => JSON.parse(response.body) };
  } });
  // jsdom does not implement native dialog behavior; model open/close events.
  const dialog = document.querySelector('dialog')!;
  dialog.showModal = () => dialog.setAttribute('open', '');
  dialog.close = value => {
    dialog.returnValue = value || '';
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new window.Event('close'));
  };
  window.confirm = () => true;
  await window.eval(`(async () => {${script}\n})()`);
  const query = <T extends Element = HTMLElement>(selector: string) => {
    const node = document.querySelector<T>(selector);
    assert.ok(node, `Missing frontend element: ${selector}`);
    return node;
  };
  const submit = (selector: string) => query(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const click = (label: string) => query<HTMLButtonElement>(`button[aria-label="${label}"]`).click();
  const saved = () => waitFor(() => query('#save-status').textContent === 'All changes saved');
  const read = async (): Promise<TodoState> => JSON.parse((await api.call('/api/todo')).body);
  const addBoard = async (title: string) => {
    query<HTMLInputElement>('#board-title').value = title;
    submit('#new-board');
    await saved();
  };
  const drag = (source: Element, target: Element) => {
    const dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
    for (const [node, type] of [[source, 'dragstart'], [target, 'dragover'], [target, 'drop']] as const) {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      node.dispatchEvent(event);
    }
  };
  return { api, window, document, query, submit, click, saved, read, addBoard, drag, errors, failNext: () => { rejectNext = true; } };
}

test('frontend creates a board over LAN HTTP without randomUUID and renders saved boards after reload', async t => {
  const ui = await frontend(t);
  assert.equal(ui.window.crypto.randomUUID, undefined);
  assert.equal(ui.query<HTMLFieldSetElement>('#todo-controls').disabled, false);
  await ui.addBoard('test');
  assert.equal(ui.document.querySelectorAll('.column[data-status="todo"] .task-form').length, 1);
  assert.equal(ui.document.querySelectorAll('.column[data-status="doing"] .task-form, .column[data-status="done"] .task-form').length, 0);
  assert.equal(ui.query('.board h2').textContent, 'test');
  assert.equal(ui.query('#summaries h3').textContent, 'test');
  assert.equal(ui.query('#board-count').textContent, '1');
  assert.equal(ui.query<HTMLInputElement>('#board-title').value, '');
  const state = await ui.read();
  assert.equal(state.boards[0].title, 'test');
  assert.match(state.boards[0].id, /^[a-f0-9]{32}$/);
  ui.query<HTMLButtonElement>('#reload').click();
  await ui.saved();
  assert.equal(ui.query('.board h2').textContent, 'test');
  ui.window.location.hash = '#home';
  await waitFor(() => !ui.query<HTMLElement>('#home').hidden);
  assert.equal(ui.query('nav a[aria-current="page"]').textContent, 'Overview');
  assert.deepEqual(ui.errors, []);
});

test('frontend adds and edits tasks, changes status, chooses summary priority, and deletes a board', async t => {
  const ui = await frontend(t);
  await ui.addBoard('test');
  const taskInput = () => ui.query<HTMLInputElement>('.column[data-status="todo"] input');
  taskInput().value = 'First';
  ui.submit('.column[data-status="todo"] form');
  await ui.saved();
  assert.equal(taskInput().value, '');
  assert.match(ui.query('.summary p').textContent!, /todoFirst/);
  taskInput().value = 'Second';
  ui.submit('.column[data-status="todo"] form');
  await ui.saved();
  const select = ui.query<HTMLSelectElement>('select[aria-label="Status for Second"]');
  select.value = 'doing';
  select.dispatchEvent(new ui.window.Event('change', { bubbles: true }));
  await ui.saved();
  assert.match(ui.query('.summary p').textContent!, /doingSecond/);
  ui.click('Edit Second');
  ui.query<HTMLInputElement>('#editor-value').value = 'Edited';
  ui.submit('#editor-form');
  await waitFor(() => ui.query('.summary p').textContent!.includes('Edited'));
  assert.equal((await ui.read()).boards[0].tasks[1].text, 'Edited');
  ui.click('Delete Edited');
  await ui.saved();
  assert.match(ui.query('.summary p').textContent!, /todoFirst/);
  ui.click('Rename test');
  ui.query<HTMLInputElement>('#editor-value').value = 'Renamed';
  ui.submit('#editor-form');
  await waitFor(() => ui.query('.board h2').textContent === 'Renamed');
  ui.click('Delete Renamed');
  await ui.saved();
  assert.equal(ui.document.querySelectorAll('.board').length, 0);
  assert.deepEqual((await ui.read()).boards, []);
  assert.deepEqual(ui.errors, []);
});

const initial = (): TodoState => ({ revision: 0, boards: [
  { id: 'a', title: 'A', tasks: [{ id: 'one', text: 'One', status: 'todo' }, { id: 'two', text: 'Two', status: 'todo' }] },
  { id: 'b', title: 'B', tasks: [] },
] });

test('frontend persists keyboard and drag ordering of boards and tasks, including cross-board moves', async t => {
  const ui = await frontend(t, initial());
  ui.click('Move B up');
  await ui.saved();
  assert.deepEqual((await ui.read()).boards.map(board => board.id), ['b', 'a']);
  ui.drag(ui.query('#board-a .handle'), ui.query('#board-b'));
  await ui.saved();
  assert.deepEqual((await ui.read()).boards.map(board => board.id), ['a', 'b']);
  ui.click('Move Two up');
  await ui.saved();
  assert.deepEqual((await ui.read()).boards[0].tasks.map(task => task.id), ['two', 'one']);
  ui.drag(ui.query('[data-task-id="one"]'), ui.query('[data-task-id="two"]'));
  await ui.saved();
  assert.deepEqual((await ui.read()).boards[0].tasks.map(task => task.id), ['one', 'two']);
  ui.drag(ui.query('[data-task-id="one"]'), ui.query('#board-b [data-status="doing"]'));
  await ui.saved();
  assert.deepEqual((await ui.read()).boards[1].tasks, [{ id: 'one', text: 'One', status: 'doing' }]);
  assert.deepEqual(ui.errors, []);
});

test('frontend preserves task drafts during other edits, and preserves failed board input with a visible error', async t => {
  const ui = await frontend(t, initial());
  const draft = ui.query<HTMLInputElement>('#board-a [data-status="todo"] input');
  draft.value = 'Unsubmitted task';
  ui.click('Move B up');
  await ui.saved();
  assert.equal(ui.query<HTMLInputElement>('#board-a [data-status="todo"] input').value, 'Unsubmitted task');
  ui.failNext();
  ui.query<HTMLInputElement>('#board-title').value = 'Keep this draft';
  ui.submit('#new-board');
  await waitFor(() => ui.query('#save-status').textContent === 'Not saved');
  assert.equal(ui.query<HTMLElement>('#error').hidden, false);
  assert.match(ui.query('#error-message').textContent!, /Connection lost/);
  assert.equal(ui.query<HTMLInputElement>('#board-title').value, 'Keep this draft');
  assert.equal((await ui.read()).boards.length, 2);
  assert.deepEqual(ui.errors, []);
});

test('frontend blocks stale writes and recovers by reloading boards', async t => {
  const ui = await frontend(t);
  await ui.api.call('/api/todo', { method: 'PUT', payload: initial() });
  ui.query<HTMLInputElement>('#board-title').value = 'Stale edit';
  ui.submit('#new-board');
  await waitFor(() => ui.query('#save-status').textContent === 'Not saved');
  assert.match(ui.query('#error-message').textContent!, /another tab/);
  assert.equal(ui.query<HTMLFieldSetElement>('#todo-controls').disabled, true);
  ui.query<HTMLButtonElement>('#reload').click();
  await ui.saved();
  assert.equal(ui.query<HTMLFieldSetElement>('#todo-controls').disabled, false);
  assert.equal(ui.document.querySelectorAll('.board').length, 2);
  assert.equal(ui.query<HTMLElement>('#error').hidden, true);
  assert.deepEqual(ui.errors, []);
});
