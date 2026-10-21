import { Agent, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { createApp } from '../../src/app.ts';
import { openDatabase } from '../../src/database.ts';

interface RequestOptions {
  method?: string;
  payload?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  chunked?: boolean;
}
export async function startApi(path = ':memory:') {
  const database = openDatabase(path);
  const server = createApp(database);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  // API tests always connect directly, regardless of the terminal's proxy settings.
  const agent = new Agent({ proxyEnv: {} });
  return {
    async call(path: string, options: RequestOptions = {}) {
      const body = options.rawBody ?? (options.payload === undefined ? undefined : JSON.stringify(options.payload));
      return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
        const req = request({
          hostname: '127.0.0.1', port, path, method: options.method || 'GET', agent,
          headers: {
            ...(body === undefined ? {} : {
              'Content-Type': 'application/json',
              ...(options.chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': String(Buffer.byteLength(body)) }),
            }),
            ...options.headers,
          },
        }, response => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('error', reject);
          response.on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }));
        });
        req.setTimeout(5000, () => req.destroy(new Error('API request timed out')));
        req.on('error', reject);
        req.end(body);
      });
    },
    async close() {
      agent.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      database.close();
    },
  };
}
