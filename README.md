# Ajaia_project

A small full-stack document editor: rich-text editing, file import, and owner → user sharing, persisted in SQLite.

**Stack:** React 19 + TipTap 3 (Vite) · Node 24 + Express 5 · SQLite via built-in `node:sqlite` · Vitest + Supertest.

## Features

| Area | What you can do |
|---|---|
| Documents | Create, rename (click the title), edit, delete (owner only). Autosaves ~0.8 s after you stop typing, with a "Saving… / All changes saved" indicator. |
| Formatting | Bold, italic, underline, strikethrough, Heading 1–3, bulleted and numbered lists, quotes, undo/redo. Keyboard shortcuts work (Ctrl+B/I/U). |
| File upload | **Supported types: `.txt`, `.md`, `.docx`, max 5 MB.** <br>• **Import file** on the documents page creates a new document from the file. <br>• **Insert file** in the editor toolbar inserts the file's content at the cursor. <br>Other types are rejected with a clear message. |
| Sharing | The owner clicks **Share** and grants a user *Can edit* or *Can view*. They can change the access level or remove access later. The documents page separates **Owned by me** from **Shared with me**, with access badges. Viewers get a read-only editor. |
| Persistence | Documents, titles, formatting (stored as sanitized HTML) and shares live in SQLite, so they survive refreshes and restarts. |
| Concurrency | Saves carry a version number. If someone else saved first, you get a conflict banner (*Load their version* / *Overwrite with mine*) instead of a silent overwrite. |

### Demo accounts (mocked auth)

There are no passwords. Pick a seeded account on the sign-in screen:

- `krishna@example.com`: Krishna
- `charitha@example.com`: Charitha
- `kritha@example.com`: Kritha

A fresh database also contains **"Welcome — start here"**, owned by Krishna and shared with Charitha (edit) and Kritha (view), so sharing can be reviewed immediately.

**To try sharing:** sign in as Krishna in one browser and Charitha in a private window (or a different browser), then share Krishna's doc with Charitha.

## Running locally

Requires **Node ≥ 22.13** (Node 24 recommended; it uses the built-in `node:sqlite`, so there are no native modules to compile).

```bash
npm install
npm run dev        # API on :3001 + Vite on http://localhost:5173 (proxies /api)
```

Production mode (one process serves both the API and the built client):

```bash
npm run build
npm start          # http://localhost:3001
```

Data is stored in `data/app.db`. Delete that file to reset.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `DB_FILE` | `data/app.db` | SQLite file path |
| `SESSION_SECRET` | `dev-secret` | Signs the session cookie. **Set this in production.** |
| `NODE_ENV` | — | `production` marks the cookie `Secure` |

## Tests

```bash
npm test
```

There are 13 API integration tests in [test/api.test.js](test/api.test.js). They run against an in-memory database and cover:

- create / rename / edit / reopen with formatting preserved
- input validation and malformed JSON
- XSS sanitization
- stale-save 409 conflicts
- the full owner / editor / viewer / no-access permission matrix, including revoking access
- share validation
- `.md` / `.txt` import, plus rejection of unsupported, broken and missing files
- the one-time demo seed, and in-place migration of the old demo accounts

> **Windows note:** if Vitest reports *"failed to find the runner"*, your shell's working directory has a lowercase drive letter (`c:\…`). VS Code terminals sometimes open that way. Run `cd C:\path\to\collab-docs` with an uppercase `C:` and retry. This is a known Vitest/Windows path-casing issue, not a problem with the app.

## Deployment

The app is one Docker container with SQLite on a mounted volume ([Dockerfile](Dockerfile)).

**Render (free, recommended):** push this repo to GitHub, then in Render choose **New → Blueprint** and select the repo. [render.yaml](render.yaml) creates a free web service and generates `SESSION_SECRET`. Health check: `/api/health`.

Free-tier caveats: the instance sleeps after ~15 min idle, so the first request takes ~30–60 s. The disk is ephemeral: data persists across refreshes and while the instance is up, but resets on restart or redeploy. The demo users and the shared Welcome document are re-seeded on every fresh start. For durable storage, set `plan: starter` and uncomment the `disk` block (~$7/mo, paid by the deployer, never by reviewers).

**Any Docker host** (Fly.io, Railway, a VM):

```bash
docker build -t ajaia-project .
docker run -p 3001:3001 -v ajaia-data:/data -e SESSION_SECRET=change-me ajaia-project
```

Deployed URL: _add after deploying_

## Project layout

```
server/
  index.js     entry point: opens DB, serves API + built client
  app.js       Express app: routes, auth, permissions, validation, errors
  db.js        schema + seeded users
  content.js   HTML sanitization and file → HTML conversion
src/
  pages/       Login, DocList, EditorPage (autosave + conflict handling)
  components/  Toolbar, ShareDialog
  api.js       fetch wrapper
test/          API integration tests
```

## Screenshots

| | |
|---|---|
| ![Documents list](docs/screenshots/2-documents-owner.png) | ![Editor](docs/screenshots/3-editor.png) |
| ![Share dialog](docs/screenshots/4-share-dialog.png) | ![Viewer is read-only](docs/screenshots/6-viewer-read-only.png) |

More in [docs/screenshots/](docs/screenshots/).

## More docs

- [ARCHITECTURE.md](ARCHITECTURE.md): design decisions and trade-offs
- [AI_WORKFLOW.md](AI_WORKFLOW.md): how AI tools were used and checked
- [SUBMISSION.md](SUBMISSION.md): what's included, status, next steps
