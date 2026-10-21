import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { initializeTodo, readTodo, saveTodo, validState } from './todo.ts';

// Every endpoint declares its method and permitted payload. Undefined means no payload.
export const endpoints = [
  { path: '/health', method: 'GET', payload: undefined },
  { path: '/api/todo', method: 'GET', payload: undefined },
  { path: '/api/todo', method: 'PUT', payload: validState },
] as const;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const maxBody = 1024 * 1024;
async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBody) throw new Error('too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createApp(database: DatabaseSync) {
  initializeTodo(database);
  return createServer({ maxHeaderSize: 8192, requestTimeout: 15000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data));
    };
    const path = request.url || '/';
    if (path.length > 256) { send(414, { error: 'Request path too long' }); return; }
    const endpoint = endpoints.find(e => e.path === path && e.method === request.method);
    const asset = assets.get(path);
    if (!endpoint && !(asset && request.method === 'GET')) {
      send(endpoints.some(e => e.path === path) || asset ? 405 : 404, { error: 'Unknown endpoint or method' }); return;
    }
    if (!endpoint?.payload && (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) > 0)) {
      send(400, { error: 'This endpoint accepts no payload' }); return;
    }
    try {
      if (endpoint?.payload) {
        // Accept browser writes only from this origin. No CORS access is enabled.
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { send(403, { error: 'Foreign origin' }); return; }
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { send(415, { error: 'Use application/json' }); return; }
        if (Number(request.headers['content-length']) > maxBody) { send(413, { error: 'Payload too large' }); return; }
        let value;
        try { value = await body(request); } catch (error) { send(error instanceof Error && error.message === 'too large' ? 413 : 400, { error: 'Invalid JSON or oversized payload' }); return; }
        if (!endpoint.payload(value)) { send(400, { error: 'Invalid Todo data (50 boards, 1000 tasks maximum)' }); return; }
        if (!saveTodo(database, value)) { send(409, { error: 'Changed in another tab. Reload before editing.' }); return; }
        send(200, readTodo(database));
      } else if (path === '/health') {
        database.prepare('SELECT 1').get(); send(200, { status: 'ok', database: 'sqlite' });
      } else if (path === '/api/todo') send(200, readTodo(database));
      else if (asset) {
        const content = await readFile(new URL(`../public/${asset[0]}`, import.meta.url));
        response.writeHead(200, { 'Content-Type': asset[1]! }); response.end(content);
      }
    } catch (error) {
      console.error(error);
      send(path === '/health' ? 503 : 500, { error: 'Service unavailable' });
    }
  });
}
