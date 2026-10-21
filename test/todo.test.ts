import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/database.ts';
import { initializeTodo, readTodo, saveTodo, validState, type TodoState } from '../src/todo.ts';

const fixture = (): TodoState => ({ revision: 0, boards: [
  { id: 'b2', title: 'Second', tasks: [{ id: 't2', text: 'In progress', status: 'doing' }, { id: 't1', text: 'Next', status: 'todo' }] },
  { id: 'b1', title: 'First', tasks: [] },
] });
test('Todo persists ordered boards and tasks, moves, rejects stale writes and enforces constraints', () => {
  const directory = mkdtempSync(join(tmpdir(), 'todo-'));
  const path = join(directory, 'test.sqlite');
  let db = openDatabase(path);
  try {
    initializeTodo(db);
    assert.deepEqual(readTodo(db), { revision: 0, boards: [] });
    assert.equal(saveTodo(db, fixture()), true);
    db.close(); db = openDatabase(path); initializeTodo(db);
    assert.deepEqual(readTodo(db), { ...fixture(), revision: 1 });
    assert.equal(saveTodo(db, fixture()), false);
    const next = readTodo(db);
    next.boards.reverse();
    const task = next.boards[1].tasks.shift()!;
    task.status = 'done'; next.boards[0].tasks.push(task);
    assert.equal(saveTodo(db, next), true);
    assert.deepEqual(readTodo(db), { ...next, revision: 2 });
    assert.throws(() => db.prepare('INSERT INTO todo_tasks VALUES (?, ?, ?, ?, ?)').run('bad', 'missing', 'Task', 'todo', 0));
    assert.throws(() => db.prepare('INSERT INTO todo_tasks VALUES (?, ?, ?, ?, ?)').run('bad', 'b1', 'Task', 'invalid', 0));
    db.prepare('DELETE FROM todo_boards WHERE id = ?').run('b1');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM todo_tasks WHERE board_id = ?').get('b1')?.count, 0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('Todo validates exact shapes, unique IDs, single lines and size limits', () => {
  assert.equal(validState(fixture()), true);
  for (const invalid of [null, { ...fixture(), extra: true }, { ...fixture(), revision: -1 },
    { revision: 0, boards: [{ id: 'b', title: ' ', tasks: [] }] },
    { revision: 0, boards: [{ id: 'b', title: 'Board', tasks: [{ id: 'b', text: 'Duplicate', status: 'todo' }] }] },
    { revision: 0, boards: [{ id: 'b', title: 'Board', tasks: [{ id: 't', text: 'Two\nlines', status: 'todo' }] }] },
    { revision: 0, boards: [{ id: 'b', title: 'Board', tasks: [{ id: 't', text: 'Task', status: 'other' }] }] },
    { revision: 0, boards: Array.from({ length: 51 }, (_, i) => ({ id: `b${i}`, title: 'Board', tasks: [] })) },
  ]) assert.equal(validState(invalid), false);
});
