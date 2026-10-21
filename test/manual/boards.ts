import assert from 'node:assert/strict';
import test from 'node:test';
import { startApi } from '../helpers/api.ts';

test('add a board named test', async t => {
  const api = await startApi();
  t.after(() => api.close());
  const board = { id: 'test-board', title: 'test', tasks: [] };
  const response = await api.call('/api/todo', {
    method: 'PUT', payload: { revision: 0, boards: [board] },
  });
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(JSON.parse(response.body), { revision: 1, boards: [board] });
  const saved = await api.call('/api/todo');
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.body), { revision: 1, boards: [board] });
});

test('remove a board named test', async t => {
  const api = await startApi();
  t.after(() => api.close());
  const board = { id: 'test-board', title: 'test', tasks: [] };
  const created = await api.call('/api/todo', {
    method: 'PUT', payload: { revision: 0, boards: [board] },
  });
  assert.equal(created.status, 200, created.body);
  assert.deepEqual(JSON.parse((await api.call('/api/todo')).body), { revision: 1, boards: [board] });
  const response = await api.call('/api/todo', {
    method: 'PUT', payload: { revision: 1, boards: [] },
  });
  assert.equal(response.status, 200, response.body);
  assert.deepEqual(JSON.parse(response.body), { revision: 2, boards: [] });
  const saved = await api.call('/api/todo');
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(saved.body), { revision: 2, boards: [] });
});

