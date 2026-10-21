import { createApp } from './app.ts';
import { openDatabase } from './database.ts';

const database = openDatabase();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const server = createApp(database);
server.listen(port, host, () => console.log(`Backend: http://${host}:${port}`));
function shutdown(): void {
  server.close(() => { database.close(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
