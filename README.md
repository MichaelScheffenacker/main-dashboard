# main-dashboard

A private dashboard with a TypeScript backend using Node.js and SQLite.

## Run with Podman

Install [Podman](https://podman.io/docs/installation) first. On macOS or
Windows, initialize and start a Podman machine before running these commands.
On Debian 13, install Podman and its rootless dependencies with:

```sh
sudo apt-get update
sudo apt-get install podman uidmap slirp4netns fuse-overlayfs
```

Run from the repository root:

```sh
podman build --format docker -t localhost/main-dashboard -f Containerfile .
podman volume create main-dashboard-data
podman run -d --name main-dashboard -p 127.0.0.1:3000:3000 -v main-dashboard-data:/app/data localhost/main-dashboard
```

Open `http://127.0.0.1:3000/`. Check health and view logs with:

```sh
curl http://127.0.0.1:3000/health
podman logs main-dashboard
podman healthcheck run main-dashboard
```

The image includes the frontend and backend and uses the official Node.js
26.12.0 image. No host Node.js installation or npm install is needed.
The app runs as the unprivileged `node` user. It listens on `0.0.0.0:3000`
inside the container; the published port restricts host access to localhost.
For LAN access, replace `-p 127.0.0.1:3000:3000` with `-p 3000:3000`.
To use another host port, use e.g. `-p 127.0.0.1:8080:3000`.

SQLite lives at `/app/data/dashboard.sqlite`. The named volume holds the
entire database directory, including SQLite journal files, outside the
container and survives container replacement. It starts empty; existing
host data is not copied automatically. Do not remove `main-dashboard-data`
unless you intend to delete the saved boards and tasks.

For a database imported into a named volume, ensure the application user
owns the directory and files before starting the dashboard:

```sh
podman run --rm --user 0 -v main-dashboard-data:/app/data localhost/main-dashboard chown -R node:node /app/data
```

The running installation on this development machine uses
`main-dashboard-data`, initialized from a consistent snapshot of the
existing host database. Future container writes go to that volume; the
original `data/dashboard.sqlite` remains a separate copy.

Stop and start the existing container:

```sh
podman stop main-dashboard
podman start main-dashboard
```

After code changes, rebuild and replace the container, reusing its volume:

```sh
podman build --format docker -t localhost/main-dashboard -f Containerfile .
podman stop main-dashboard
podman rm main-dashboard
podman run -d --name main-dashboard -p 127.0.0.1:3000:3000 -v main-dashboard-data:/app/data localhost/main-dashboard
```

To use the existing host `data/` directory instead of a named volume on
Linux, first stop any host instance of the app. Then use this alternative
run command with rootless Podman (remove any previous container with the
same name first):

```sh
mkdir -p data
podman run -d --name main-dashboard --userns=keep-id --user "$(id -u):$(id -g)" -p 127.0.0.1:3000:3000 -v "$(pwd)/data:/app/data:Z" localhost/main-dashboard
```

This mount keeps the existing database and its journal files together.
The `:Z` option labels the directory for private container access on SELinux
hosts. See the [Podman volume and user namespace documentation](https://docs.podman.io/en/latest/markdown/podman-run.1.html).

## Local development without a container

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
Run `npm run test:api` for HTTP integration tests covering board creation,
updates, ordering, persistence across restarts, stale writes, and request
validation. Tests use isolated databases and temporary local ports, and
connect directly without using environment proxies.
Frontend integration tests use jsdom and the real HTTP API with isolated
databases. They cover board/task controls, ordering, summary selection, drafts,
and error recovery; they do not test browser layout or native drag gestures.

Manual board tests live in `test/manual/boards.ts` and are excluded from
`npm test` and `npm run test:api`. Run both explicitly:

```sh
node --test test/manual/boards.ts
```

Or run just one:

```sh
node --test --test-name-pattern='^add a board named test$' test/manual/boards.ts
node --test --test-name-pattern='^remove a board named test$' test/manual/boards.ts
```

These tests use separate in-memory databases, leaving the dashboard database
unchanged. The removal test creates its own board named `test` first.

## Todo dashboard

Open `http://127.0.0.1:3000/` for the dark-themed dashboard. Use the Todo
navigation link to create named Kanban boards and single-line tasks in
Todo, Doing, and Done columns. Rename, edit, or delete boards and tasks
using their controls. Board deletion asks for confirmation.

Drag a board by its handle to reorder it. Drag tasks onto another task to
insert before it, or onto a column to append them (including across boards).
Board up/down buttons provide keyboard alternatives for reordering boards. Move tasks
between columns by dragging.
Changes save automatically to SQLite. On the overview, each board shows
its first Doing task, falling back to its first Todo task.

The frontend is buildless vanilla HTML, CSS, and JavaScript in `public/`.
Board and task IDs work over both localhost and HTTP LAN connections.
Editing is disabled until boards load and while a save is in progress.
Errors appear above the dashboard with a Reload boards button; failed saves
preserve input drafts. Click a board title or task to edit it inline, then press Enter to save
or Escape to cancel. Inputs use the API's length limits. To serve the dashboard on your LAN, run `HOST=0.0.0.0 npm start`
and visit `http://<server-ip>:3000/`.

The server creates the Todo tables on first startup. `GET /api/todo` reads
the state; `PUT /api/todo` saves `{ revision, boards }`, where each board has
`{ id, title, tasks }` and each task has `{ id, text, status }`. Writes require
JSON, the current revision, unique IDs, and the exact documented fields.
Limits are 50 boards, 1,000 tasks total, 100 characters per board title,
300 per task, and a 1 MiB request body. Stale writes return 409; reload
the page before editing again. The server continues to bind to localhost
by default.

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
