# Repository Guidelines


## Project Structure & Module Organization

Work in `/home/msc/workspace/main-dashboard` (`~/workspace/main-dashboard`).
This private dashboard has a TypeScript backend using Node.js and SQLite.
`src/server.ts` runs the HTTP server; `src/database.ts` opens the database.
Tests live in `test/`. Runtime data lives in the ignored `data/` directory.
The vanilla HTML/CSS/JavaScript frontend lives in `public/`. `src/app.ts`
defines the HTTP API and static asset allowlist; `src/todo.ts` manages Todo
validation, schema initialization, and transactional persistence.


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
Todo tables are created on server startup with `CREATE TABLE IF NOT EXISTS`.
There is no versioned migration system yet. Todo writes use a revision check
to reject stale state and preserve board/task ordering in SQLite.


## Build, Test, and Development Commands

- `npm ci`: restore the locked package setup using Node.js 26.
- `npm run db:init`: create/open the SQLite file and print its version.
- `npm start`: start the backend at `http://127.0.0.1:3000`.
- `npm run dev`: restart the backend when source files change.
- `npm run typecheck`: check backend and test types with TypeScript in strict mode.
- `npm test`: run tests using the built-in Node.js test runner.
- `curl http://127.0.0.1:3000/health`: check HTTP and database health.

Set `HOST` and `PORT` to change the listening address. No build step,
formatter, or linter is configured. Node.js runs TypeScript directly using
built-in type stripping; use only erasable TypeScript syntax and `.ts`
extensions for local imports.


## Coding Style & Testing Guidelines

Use ES modules, two-space indentation, semicolons, and camelCase variables.
Use bound SQL parameters for values. Name tests `test/*.test.ts`.
Verify persistence and database constraints for storage changes. Run
`npm run typecheck` and `npm test` after changes and report limitations;
no coverage target exists.


### Restrictive Interfaces

Interfaces between system components (especially accessible from third
parties) are to be designed as restrictive as possible. 

#### API Endpoints

- Overly long request paths have to be captured and rejected as soon as
the framework allows.
- The type of each request has to be clearly defined.
- The payload and its data type of each endpoint have to be defined
clearly and restrictively.
- There is a data structure (JS object) defining each endpoint,
it contains:
  - Type of the endpoint
  - Data type of the payload (undefined is no payload allowed)
  
#### Database Queries

- Each query has to use a prepared statement.
- Strings used in prepared statements must be generated without
any string operation from any input from outside the application.
Especially string concatenation and template strings with foreign
strings have to be avoided.


## Commit & Pull Request Guidelines

History currently contains `Initial commit`; no broader convention exists.
Use concise, imperative commit subjects. Describe changes, reasons, and
validation in pull requests; link issues when relevant.


## Security & Configuration

Keep credentials, `.env` files, database files, and unrelated personal
configuration out of Git. The backend binds to localhost by default.
