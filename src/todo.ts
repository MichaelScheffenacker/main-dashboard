import type { DatabaseSync } from 'node:sqlite';

export const statuses = ['todo', 'doing', 'done'] as const;
export type Status = typeof statuses[number];
export interface Task { id: string; text: string; status: Status }
export interface Board { id: string; title: string; tasks: Task[] }
export interface TodoState { revision: number; boards: Board[] }

export function initializeTodo(database: DatabaseSync): void {
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS todo_meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL)',
    'INSERT OR IGNORE INTO todo_meta VALUES (1, 0)',
    'CREATE TABLE IF NOT EXISTS todo_boards (id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100), position INTEGER NOT NULL)',
    "CREATE TABLE IF NOT EXISTS todo_tasks (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES todo_boards(id) ON DELETE CASCADE, text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 300), status TEXT NOT NULL CHECK(status IN ('todo', 'doing', 'done')), position INTEGER NOT NULL)",
  ]) database.prepare(sql).run();
}

export function validState(value: unknown): value is TodoState {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && allowed.every(k => Object.hasOwn(v, k));
  const line = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\r\n\u0000-\u001f\u007f]/u.test(v);
  const ids = new Set<string>();
  const id = (v: unknown): v is string => {
    if (typeof v !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(v) || ids.has(v)) return false;
    ids.add(v); return true;
  };
  let count = 0;
  return object(value) && keys(value, ['revision', 'boards']) && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && Array.isArray(value.boards) && value.boards.length <= 50 && value.boards.every(board =>
    object(board) && keys(board, ['id', 'title', 'tasks']) && id(board.id) && line(board.title, 100) && Array.isArray(board.tasks) && board.tasks.every(task =>
      ++count <= 1000 && object(task) && keys(task, ['id', 'text', 'status']) && id(task.id) && line(task.text, 300) && statuses.includes(task.status as Status)));
}

export function readTodo(database: DatabaseSync): TodoState {
  // A single read transaction keeps the revision and rows consistent.
  database.prepare('BEGIN').run();
  try {
    const revision = Number(database.prepare('SELECT revision FROM todo_meta WHERE id = 1').get()!.revision);
    const tasks = database.prepare('SELECT id, board_id, text, status FROM todo_tasks ORDER BY position').all();
    const boards = database.prepare('SELECT id, title FROM todo_boards ORDER BY position').all().map(board => ({
      id: String(board.id), title: String(board.title),
      tasks: tasks.filter(task => task.board_id === board.id).map(task => ({ id: String(task.id), text: String(task.text), status: task.status as Status })),
    }));
    database.prepare('COMMIT').run();
    return { revision, boards };
  } catch (error) { database.prepare('ROLLBACK').run(); throw error; }
}

export function saveTodo(database: DatabaseSync, state: TodoState): boolean {
  database.prepare('BEGIN IMMEDIATE').run();
  try {
    const result = database.prepare('UPDATE todo_meta SET revision = revision + 1 WHERE id = 1 AND revision = ?').run(state.revision);
    if (!result.changes) { database.prepare('ROLLBACK').run(); return false; }
    database.prepare('DELETE FROM todo_tasks').run();
    database.prepare('DELETE FROM todo_boards').run();
    const boardInsert = database.prepare('INSERT INTO todo_boards (id, title, position) VALUES (?, ?, ?)');
    const taskInsert = database.prepare('INSERT INTO todo_tasks (id, board_id, text, status, position) VALUES (?, ?, ?, ?, ?)');
    state.boards.forEach((board, index) => {
      boardInsert.run(board.id, board.title, index);
      board.tasks.forEach((task, position) => taskInsert.run(task.id, board.id, task.text, task.status, position));
    });
    database.prepare('COMMIT').run(); return true;
  } catch (error) { database.prepare('ROLLBACK').run(); throw error; }
}
