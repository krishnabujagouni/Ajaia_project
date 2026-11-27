import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const SEED_USERS = [
  { email: 'krishna@example.com', name: 'Krishna' },
  { email: 'charitha@example.com', name: 'Charitha' },
  { email: 'kritha@example.com', name: 'Kritha' },
];

// Demo accounts used by earlier versions -> their replacements.
const LEGACY_USERS = [
  ['alice@example.com', SEED_USERS[0]],
  ['bob@example.com', SEED_USERS[1]],
  ['carol@example.com', SEED_USERS[2]],
];

/**
 * Opens (or creates) the SQLite database, applies the schema and seeds demo users.
 * Pass ':memory:' for an isolated in-memory database (used by tests).
 */
export function openDb(file = process.env.DB_FILE || path.resolve('data', 'app.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS shares (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (document_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_id);
    CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);
  `);

  // Rename the original demo accounts in place so existing documents and shares carry over.
  const rename = db.prepare(`UPDATE users SET email = ?, name = ? WHERE email = ?
    AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`);
  for (const [oldEmail, u] of LEGACY_USERS) rename.run(u.email, u.name, oldEmail, u.email);
  db.prepare(`UPDATE documents SET content = REPLACE(REPLACE(REPLACE(REPLACE(content,
      'CollabDocs', 'Ajaia_project'), 'Alice', 'Krishna'), 'Bob', 'Charitha'), 'Carol', 'Kritha')
    WHERE title = 'Welcome — start here'`).run();

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (email, name) VALUES (?, ?)');
  for (const u of SEED_USERS) insertUser.run(u.email, u.name);

  // Give reviewers something to look at on a fresh database (skipped for in-memory test DBs).
  if (file !== ':memory:' && db.prepare('SELECT COUNT(*) AS n FROM documents').get().n === 0) {
    seedDemoDocument(db);
  }

  return db;
}

const DEMO_HTML = `<h1>Welcome to Ajaia_project</h1>
<p>This document is owned by <strong>Krishna</strong>, shared with <strong>Charitha</strong> (<em>can edit</em>) and <strong>Kritha</strong> (<u>view only</u>).</p>
<h2>Try this</h2>
<ol><li><p>Sign in as Charitha in a private window and edit this text.</p></li>
<li><p>Sign in as Kritha: the editor is read-only.</p></li>
<li><p>As Krishna, click <strong>Share</strong> to change or revoke access.</p></li></ol>
<ul><li><p>Import a .txt, .md or .docx file from the documents page.</p></li></ul>`.replace(/\n/g, '');

function seedDemoDocument(db) {
  const id = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  const { lastInsertRowid: docId } = db
    .prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)')
    .run(id('krishna@example.com'), 'Welcome — start here', DEMO_HTML);
  const share = db.prepare('INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)');
  share.run(docId, id('charitha@example.com'), 'editor');
  share.run(docId, id('kritha@example.com'), 'viewer');
}
