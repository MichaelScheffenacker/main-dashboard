# Repository Guidelines

## Project Structure & Module Organization

Work in `/home/msc/workspace/main-dashboard` (`~/workspace/main-dashboard`).
This private dashboard has a JavaScript backend using Node.js and SQLite.
`src/server.js` runs the HTTP server; `src/database.js` opens the database.
Tests live in `test/`. Runtime data lives in the ignored `data/` directory.
No frontend or asset structure has been established yet.

## Runtime & Database Setup

Target Node.js major 26, pinned in `.nvmrc` and `package.json`. If nvm is
available, run `nvm install` and `nvm use` from the project directory.
Node.js 26.12.0 is installed under `~/.local/lib/node-v26.12.0-linux-x64`,
with commands linked into `~/.local/bin` ahead of `/usr/bin` on PATH.
Database initialization and tests have passed on this runtime.

SQLite uses Node's bundled `node:sqlite` module; no external database
service or npm driver is required. The verified bundled SQLite version
on the installed runtime is 3.54.0. The default database file is
`data/dashboard.sqlite`. Set `DATABASE_PATH` to override its location.
Foreign keys and write-ahead logging are enabled when opening databases.
There is no application schema or migration system yet.

## Build, Test, and Development Commands

- `npm ci`: restore the locked package setup using Node.js 26.
- `npm run db:init`: create/open the SQLite file and print its version.
- `npm start`: start the backend at `http://127.0.0.1:3000`.
- `npm run dev`: restart the backend when source files change.
- `npm test`: run tests using the built-in Node.js test runner.
- `curl http://127.0.0.1:3000/health`: check HTTP and database health.

Set `HOST` and `PORT` to change the listening address. No build step,
formatter, or linter is configured.

## Coding Style & Testing Guidelines

Use ES modules, two-space indentation, semicolons, and camelCase variables.
Use bound SQL parameters for values. Name tests `test/*.test.js`.
Verify persistence and database constraints for storage changes. Run
`npm test` after changes and report limitations; no coverage target exists.

## Commit & Pull Request Guidelines

History currently contains `Initial commit`; no broader convention exists.
Use concise, imperative commit subjects. Describe changes, reasons, and
validation in pull requests; link issues when relevant.

## Security & Configuration

Keep credentials, `.env` files, database files, and unrelated personal
configuration out of Git. The backend binds to localhost by default.
