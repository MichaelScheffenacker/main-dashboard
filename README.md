# main-dashboard

A private dashboard with a TypeScript backend using Node.js and SQLite.

## Setup

Use Node.js 26 (see `.nvmrc`). With nvm installed:

```sh
nvm install
nvm use
npm ci
npm run typecheck
npm run db:init
npm test
npm start
```

The backend serves `GET /health` at `http://127.0.0.1:3000/health`.
SQLite is bundled with Node.js; no separate database server is required.
Data is stored in `data/dashboard.sqlite` and excluded from Git.
Configure `DATABASE_PATH`, `HOST`, or `PORT` through environment variables.
Use `npm run dev` for automatic restarts during development.
Node.js 26 runs the TypeScript files directly using built-in type stripping;
no build step is required. Run `npm run typecheck` for strict type checking
of the backend and tests, and `npm test` for the TypeScript test suite.

## Local access and the Codex sandbox

From your development machine's terminal, run `npm start` (or `npm run dev`),
then check the server from another terminal:

```sh
curl http://127.0.0.1:3000/health
```

Commands run by Codex inside its sandbox have isolated network access. A server
started there may respond within the same command environment while being
unreachable from your terminal. Ask Codex to run `npm start` outside the sandbox
to make the server accessible on the development machine; this may require
approval.

Codex's command environment also has proxy settings that can affect localhost
requests. Within that environment, check direct access with
`curl --noproxy '*' http://127.0.0.1:3000/health`. The option bypasses the proxy
for that request; it does not bypass sandbox isolation. Your separate terminal
has its own environment and does not need this option when ordinary `curl` works.

The development machine uses Node.js 26.12.0 with bundled SQLite 3.54.0.
Node.js is installed under `~/.local/lib/node-v26.12.0-linux-x64`, with
`node`, `npm`, and `npx` linked into `~/.local/bin`. Ensure that directory
precedes `/usr/bin` on `PATH`; run `hash -r` in an existing Bash terminal
if it still selects the older system Node.js. Database initialization and
tests pass on Node.js 26.12.0.
