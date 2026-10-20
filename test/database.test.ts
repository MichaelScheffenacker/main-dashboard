import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/database.ts';

test('SQLite persists writes after reopening and enforces foreign keys', () => {
  const directory = mkdtempSync(join(tmpdir(), 'main-dashboard-'));
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    const path = join(directory, 'nested', 'test.sqlite');
    database = openDatabase(path);
    database.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)');
    database.prepare('INSERT INTO entries (value) VALUES (?)').run('saved');
    database.close();
    database = openDatabase(path);
    assert.equal(database.prepare('SELECT value FROM entries').get()?.value, 'saved');
    assert.equal(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
