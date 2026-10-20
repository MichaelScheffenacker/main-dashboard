import { createServer } from 'node:http';
import { openDatabase } from './database.js';

const database = openDatabase();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    try {
      database.prepare('SELECT 1').get();
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', database: 'sqlite' }));
    } catch {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'unavailable' }));
    }
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(port, host, () => console.log(`Backend: http://${host}:${port}`));
function shutdown() {
  server.close(() => {
    database.close();
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
