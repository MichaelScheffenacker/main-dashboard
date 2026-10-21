const statuses = ['todo', 'doing', 'done'];
let state = { revision: 0, boards: [] };
let loaded = false;
let busy = false;
let drag = null;
const inlineEditors = new WeakMap();
const $ = selector => document.querySelector(selector);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

// getRandomValues also works on HTTP LAN origins, where randomUUID is unavailable.
function createId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function button(text, label, action, focusKey) {
  const node = element('button', `[${text}]`, 'secondary');
  node.type = 'button';
  node.setAttribute('aria-label', label);
  node.title = label;
  if (focusKey) node.dataset.focusKey = focusKey;
  node.addEventListener('click', action);
  return node;
}

function fail(message) {
  $('#error-message').textContent = message;
  $('#error').hidden = false;
}

function availability() {
  $('#todo-controls').disabled = busy || !loaded;
  $('#todo-controls').setAttribute('aria-busy', String(busy));
  $('#reload').disabled = busy;
  document.body.classList.toggle('busy', busy);
}

async function load() {
  if (busy) return;
  busy = true;
  availability();
  $('#save-status').textContent = 'Loading boards…';
  $('#error').hidden = true;
  try {
    const response = await fetch('/api/todo');
    if (!response.ok) throw new Error('Could not load boards.');
    state = await response.json();
    loaded = true;
    render();
    route();
    $('#save-status').textContent = 'All changes saved';
  } catch (error) {
    loaded = false;
    fail(`${error.message} Check the connection and reload boards.`);
    $('#save-status').textContent = 'Unable to load';
  } finally {
    busy = false;
    availability();
  }
}

async function change(update) {
  if (busy || !loaded) return false;
  const focusKey = document.activeElement?.dataset.focusKey;
  busy = true;
  availability();
  $('#save-status').textContent = 'Saving…';
  $('#error').hidden = true;
  try {
    const next = structuredClone(state);
    // Catch local failures as well as network errors so edits never fail silently.
    update(next);
    const response = await fetch('/api/todo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) loaded = false;
      throw new Error(result.error || 'Unable to save.');
    }
    state = result;
    document.querySelectorAll('.inline-editor input[data-submitted]').forEach(input => { delete input.dataset.draftKey; });
    render();
    $('#save-status').textContent = 'All changes saved';
    return true;
  } catch (error) {
    render();
    fail(`${error.message} Your last edit was not saved. Reload boards before retrying.`);
    $('#save-status').textContent = 'Not saved';
    return false;
  } finally {
    busy = false;
    availability();
    if (focusKey) document.querySelectorAll('[data-focus-key]').forEach(node => {
      if (node.dataset.focusKey === focusKey) node.focus();
    });
  }
}

function route() {
  const todo = location.hash === '#todo' || location.hash.startsWith('#todo-');
  $('#home').hidden = todo;
  $('#todo').hidden = !todo;
  document.querySelectorAll('nav a').forEach(link => {
    if (link.hash === (todo ? '#todo' : '#home')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (location.hash.startsWith('#todo-')) {
    document.getElementById(`board-${location.hash.slice(6)}`)?.scrollIntoView?.({ behavior: 'smooth' });
  }
}

function editInline(node, value, maxLength, label, update, key) {
  if (!loaded || node.querySelector('input')) return;
  const form = element('form', undefined, 'inline-editor');
  const input = element('input');
  input.value = value;
  input.maxLength = maxLength;
  input.required = true;
  input.dataset.draftKey = key;
  input.setAttribute('aria-label', label);
  form.append(input);
  node.replaceChildren(form);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) { input.setCustomValidity('Enter a name or task.'); input.reportValidity(); return; }
    if (text === value) { node.textContent = value; return; }
    input.dataset.submitted = '';
    await change(next => update(next, text));
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); node.textContent = value; node.focus(); }
  });
  input.focus();
  input.select();
}

function editable(node, value, maxLength, label, update, key) {
  node.tabIndex = 0;
  node.title = `${label} (Enter to edit)`;
  const edit = () => editInline(node, value, maxLength, label, update, key);
  node.dataset.editorKey = key;
  inlineEditors.set(node, edit);
  node.addEventListener('click', event => { if (!event.target.closest('input')) edit(); });
  node.addEventListener('keydown', event => {
    if (event.target === node && event.key === 'Enter') { event.preventDefault(); edit(); }
  });
  return edit;
}

function reorderBoard(id, targetId) {
  if (id === targetId) return;
  return change(next => {
    const from = next.boards.findIndex(board => board.id === id);
    const to = next.boards.findIndex(board => board.id === targetId);
    const [board] = next.boards.splice(from, 1);
    next.boards.splice(to, 0, board);
  });
}

function moveTask(id, boardId, status, beforeId) {
  if (id === beforeId) return;
  return change(next => {
    let moving;
    for (const board of next.boards) {
      const index = board.tasks.findIndex(task => task.id === id);
      if (index !== -1) [moving] = board.tasks.splice(index, 1);
    }
    if (!moving) return;
    moving.status = status;
    const target = next.boards.find(board => board.id === boardId);
    const index = target.tasks.findIndex(task => task.id === beforeId);
    target.tasks.splice(index === -1 ? target.tasks.length : index, 0, moving);
  });
}

function dragSource(node, data) {
  node.draggable = true;
  node.addEventListener('dragstart', event => {
    if (busy || !loaded || event.target.closest('button, input, select')) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    drag = data;
    event.dataTransfer.setData('text/plain', data.id);
    event.dataTransfer.effectAllowed = 'move';
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    drag = null;
    node.classList.remove('dragging');
    document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
  });
}

function dropTarget(node, kind, action) {
  node.addEventListener('dragover', event => {
    if (drag?.kind !== kind || busy) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
  node.addEventListener('drop', event => {
    node.classList.remove('drop-target');
    if (drag?.kind !== kind || busy) return;
    event.preventDefault();
    event.stopPropagation();
    action(drag.id);
    drag = null;
  });
}

function renderTask(task, board, status) {
  const row = element('article', undefined, 'task');
  row.dataset.taskId = task.id;
  dragSource(row, { kind: 'task', id: task.id });
  const text = element('span', task.text, 'task-text');
  text.title = task.text;
  const handle = element('span', '⠿', 'handle');
  handle.title = 'Drag to reorder or move task';
  handle.setAttribute('aria-hidden', 'true');
  dragSource(handle, { kind: 'task', id: task.id });
  row.append(handle, text);
  dropTarget(row, 'task', id => moveTask(id, board.id, status, task.id));
  editable(text, task.text, 300, `Edit ${task.text}`, (next, value) => {
    next.boards.find(item => item.id === board.id).tasks.find(item => item.id === task.id).text = value;
  }, `edit-task-${task.id}`);
  const controls = element('span', undefined, 'task-controls');
  controls.append(button('x', `Delete ${task.text}`, () => change(next => {
    const target = next.boards.find(item => item.id === board.id);
    target.tasks = target.tasks.filter(item => item.id !== task.id);
  })));
  row.append(controls);
  return row;
}

function renderColumn(board, status, drafts) {
  const column = element('section', undefined, 'column');
  column.dataset.status = status;
  const tasks = board.tasks.filter(task => task.status === status);
  column.append(element('h3', `${status} · ${tasks.length}`));
  const list = element('div', undefined, 'tasks');
  tasks.forEach(task => list.append(renderTask(task, board, status)));
  if (!tasks.length) list.append(element('p', 'No tasks', 'column-empty'));
  column.append(list);
  if (status === 'todo') {
    const form = element('form', undefined, 'task-form');
    const input = element('input');
    const key = `${board.id}-${status}`;
    input.dataset.draftKey = key;
    input.dataset.focusKey = key;
    input.value = drafts.get(key) || '';
    input.required = true;
    input.maxLength = 300;
    input.placeholder = '+ Add a task';
    input.setAttribute('aria-label', `New ${status} task in ${board.title}`);
    const add = element('button', '[+]');
    add.setAttribute('aria-label', `Add ${status} task`);
    form.append(input, add);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const saved = await change(next => {
        next.boards.find(item => item.id === board.id).tasks.push({ id: createId(), text, status });
      });
      if (saved) document.querySelectorAll('[data-draft-key]').forEach(node => {
        if (node.dataset.draftKey === key) { node.value = ''; node.focus(); }
      });
    });
    column.append(form);
  }
  dropTarget(column, 'task', id => moveTask(id, board.id, status));
  return column;
}

function render() {
  const drafts = new Map(Array.from(document.querySelectorAll('[data-draft-key]'), node => [node.dataset.draftKey, node.value]));
  const summaries = $('#summaries');
  const boards = $('#boards');
  summaries.replaceChildren();
  boards.replaceChildren();
  $('#board-count').textContent = String(state.boards.length);
  if (!state.boards.length) {
    const empty = element('div', undefined, 'empty-state');
    empty.append(element('p', 'Your next task starts here.'), element('p', 'Create a board to organize Todo, Doing, and Done.', 'empty'));
    const link = element('a', 'Create your first board →');
    link.href = '#todo';
    empty.append(link);
    summaries.append(empty);
    boards.append(element('p', 'No boards yet. Add your first board above.', 'empty'));
  }
  for (const [boardIndex, board] of state.boards.entries()) {
    const summary = element('a', undefined, 'summary');
    summary.href = `#todo-${board.id}`;
    summary.append(element('h3', board.title));
    const next = board.tasks.find(task => task.status === 'doing') || board.tasks.find(task => task.status === 'todo');
    const description = element('p');
    if (next) description.append(element('span', next.status, 'tag'), document.createTextNode(next.text));
    else {
      description.textContent = board.tasks.length ? 'All done. Room for what’s next.' : 'No tasks yet.';
      description.className = 'empty';
    }
    summary.append(description);
    summaries.append(summary);
    const card = element('article', undefined, 'board');
    card.id = `board-${board.id}`;
    const heading = element('header', undefined, 'board-heading');
    const handle = element('span', '⠿', 'handle');
    handle.title = 'Drag to reorder board';
    handle.setAttribute('aria-hidden', 'true');
    dragSource(handle, { kind: 'board', id: board.id });
    const title = element('h2', board.title);
    const edit = editable(title, board.title, 100, `Rename ${board.title}`, (next, value) => {
      next.boards.find(item => item.id === board.id).title = value;
    }, `edit-board-${board.id}`);
    heading.append(handle, title);
    const actions = element('span', undefined, 'board-actions');
    for (const [symbol, offset] of [['↑', -1], ['↓', 1]]) {
      const move = button(symbol, `Move ${board.title} ${offset < 0 ? 'up' : 'down'}`, () => reorderBoard(board.id, state.boards[boardIndex + offset].id), `move-${board.id}-${offset}`);
      move.disabled = !state.boards[boardIndex + offset];
      actions.append(move);
    }
    actions.append(button('e', `Rename ${board.title}`, edit, `rename-${board.id}`), button('x', `Delete ${board.title}`, () => {
      if (confirm(`Delete “${board.title}” and all its tasks?`)) change(next => {
        next.boards = next.boards.filter(item => item.id !== board.id);
      });
    }));
    heading.append(actions);
    card.append(heading);
    dropTarget(card, 'board', id => reorderBoard(id, board.id));
    const columns = element('div', undefined, 'columns');
    for (const status of statuses) columns.append(renderColumn(board, status, drafts));
    card.append(columns);
    boards.append(card);
  }
  document.querySelectorAll('.task-text, .board-heading h2').forEach(node => {
    const draft = drafts.get(node.dataset.editorKey);
    if (draft !== undefined) {
      inlineEditors.get(node)();
      const input = node.querySelector('input');
      if (input) input.value = draft;
    }
  });
}

$('#new-board').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#board-title').value.trim();
  if (!title) return;
  const saved = await change(next => {
    next.boards.push({ id: createId(), title, tasks: [] });
  });
  if (saved) {
    $('#board-title').value = '';
    $('#board-title').focus();
  }
});
$('#reload').addEventListener('click', load);
$('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  $('#main').focus();
});
window.addEventListener('hashchange', route);
route();
availability();
await load();
