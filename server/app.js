import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import {
  sanitizeContent, fileToHtml, titleFromFilename, UnsupportedFileError,
  MAX_CONTENT_BYTES, MAX_UPLOAD_BYTES,
} from './content.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SESSION_COOKIE = 'uid';
const ROLES = ['viewer', 'editor'];

function validateTitle(title) {
  if (typeof title !== 'string') throw new HttpError(400, 'Title must be a string');
  const trimmed = title.trim();
  if (!trimmed) throw new HttpError(400, 'Title cannot be empty');
  if (trimmed.length > 200) throw new HttpError(400, 'Title must be at most 200 characters');
  return trimmed;
}

function validateContent(content) {
  if (typeof content !== 'string') throw new HttpError(400, 'Content must be a string');
  if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) throw new HttpError(413, 'Document is too large');
  return sanitizeContent(content);
}

export function createApp(db, { sessionSecret = 'dev-secret', clientDir } = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser(sessionSecret));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  // ---- prepared statements ----
  const q = {
    userById: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT id, email, name FROM users WHERE email = ?'),
    allUsers: db.prepare('SELECT id, email, name FROM users ORDER BY name'),
    docById: db.prepare('SELECT * FROM documents WHERE id = ?'),
    shareFor: db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?'),
    owned: db.prepare(`
      SELECT d.id, d.title, d.updated_at, d.owner_id,
             (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id) AS share_count
      FROM documents d WHERE d.owner_id = ? ORDER BY d.updated_at DESC`),
    sharedWithMe: db.prepare(`
      SELECT d.id, d.title, d.updated_at, d.owner_id, s.role, u.name AS owner_name, u.email AS owner_email
      FROM shares s
      JOIN documents d ON d.id = s.document_id
      JOIN users u ON u.id = d.owner_id
      WHERE s.user_id = ? ORDER BY d.updated_at DESC`),
    insertDoc: db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)'),
    updateDoc: db.prepare(`
      UPDATE documents
      SET title = ?, content = ?, version = version + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND version = ?`),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    sharesOf: db.prepare(`
      SELECT u.id AS user_id, u.email, u.name, s.role
      FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.document_id = ? ORDER BY u.name`),
    upsertShare: db.prepare(`
      INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT (document_id, user_id) DO UPDATE SET role = excluded.role`),
    deleteShare: db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?'),
  };

  // ---- auth (mocked: pick a seeded account, identity held in a signed cookie) ----
  function currentUser(req) {
    const id = Number(req.signedCookies?.[SESSION_COOKIE]);
    return id ? q.userById.get(id) : undefined;
  }

  function requireUser(req, _res, next) {
    const user = currentUser(req);
    if (!user) return next(new HttpError(401, 'Please sign in'));
    req.user = user;
    next();
  }

  /** Loads the document and works out the caller's role: owner | editor | viewer. */
  function loadDoc(req, minRole) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid document id');
    const doc = q.docById.get(id);
    if (!doc) throw new HttpError(404, 'Document not found');

    let role;
    if (doc.owner_id === req.user.id) role = 'owner';
    else role = q.shareFor.get(id, req.user.id)?.role;
    // Respond 404 (not 403) to users with no access so document ids aren't discoverable.
    if (!role) throw new HttpError(404, 'Document not found');

    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[minRole]) {
      throw new HttpError(403, minRole === 'owner'
        ? 'Only the owner can do that'
        : 'You have view-only access to this document');
    }
    return { doc, role };
  }

  function serializeDoc(doc, role) {
    const owner = q.userById.get(doc.owner_id);
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      owner,
      role,
      shares: role === 'owner' ? q.sharesOf.all(doc.id) : undefined,
    };
  }

  const api = express.Router();

  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/users', (_req, res) => res.json(q.allUsers.all()));

  api.post('/auth/login', (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const user = q.userByEmail.get(email);
    if (!user) throw new HttpError(401, 'Unknown account. Pick one of the demo users.');
    res.cookie(SESSION_COOKIE, String(user.id), {
      signed: true, httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 3600 * 1000,
    });
    res.json(user);
  });

  api.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE);
    res.status(204).end();
  });

  api.get('/auth/me', requireUser, (req, res) => res.json(req.user));

  api.get('/documents', requireUser, (req, res) => {
    res.json({
      owned: q.owned.all(req.user.id),
      shared: q.sharedWithMe.all(req.user.id),
    });
  });

  api.post('/documents', requireUser, (req, res) => {
    const title = req.body?.title === undefined ? 'Untitled document' : validateTitle(req.body.title);
    const content = req.body?.content === undefined ? '' : validateContent(req.body.content);
    const { lastInsertRowid } = q.insertDoc.run(req.user.id, title, content);
    res.status(201).json(serializeDoc(q.docById.get(lastInsertRowid), 'owner'));
  });

  api.get('/documents/:id', requireUser, (req, res) => {
    const { doc, role } = loadDoc(req, 'viewer');
    res.json(serializeDoc(doc, role));
  });

  // Partial update with optimistic concurrency: the client sends the version it edited.
  api.patch('/documents/:id', requireUser, (req, res) => {
    const { doc, role } = loadDoc(req, 'editor');
    const body = req.body ?? {};
    if (body.title === undefined && body.content === undefined) {
      throw new HttpError(400, 'Nothing to update');
    }
    if (!Number.isInteger(body.version)) throw new HttpError(400, 'version is required');

    const title = body.title === undefined ? doc.title : validateTitle(body.title);
    const content = body.content === undefined ? doc.content : validateContent(body.content);
    const { changes } = q.updateDoc.run(title, content, doc.id, body.version);
    if (changes === 0) {
      const latest = q.docById.get(doc.id);
      return res.status(409).json({
        error: 'This document was changed elsewhere since you opened it.',
        latest: serializeDoc(latest, role),
      });
    }
    res.json(serializeDoc(q.docById.get(doc.id), role));
  });

  api.delete('/documents/:id', requireUser, (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    q.deleteDoc.run(doc.id);
    res.status(204).end();
  });

  // ---- sharing ----
  api.post('/documents/:id/shares', requireUser, (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const role = req.body?.role ?? 'editor';
    if (!email) throw new HttpError(400, 'Email is required');
    if (!ROLES.includes(role)) throw new HttpError(400, `Role must be one of: ${ROLES.join(', ')}`);
    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, `No user with email ${email}`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'The owner already has full access');
    q.upsertShare.run(doc.id, target.id, role);
    res.status(201).json(q.sharesOf.all(doc.id));
  });

  api.delete('/documents/:id/shares/:userId', requireUser, (req, res) => {
    const { doc } = loadDoc(req, 'owner');
    q.deleteShare.run(doc.id, Number(req.params.userId));
    res.json(q.sharesOf.all(doc.id));
  });

  // ---- file upload ----
  const singleFile = (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'File is larger than 5 MB'));
    if (err) return next(new HttpError(400, err.message));
    if (!req.file) return next(new HttpError(400, 'No file uploaded (expected form field "file")'));
    next();
  });

  async function convertUpload(file) {
    try {
      return await fileToHtml(file.originalname, file.buffer);
    } catch (err) {
      if (err instanceof UnsupportedFileError) throw new HttpError(415, err.message);
      throw err;
    }
  }

  // Upload a file and turn it into a brand-new document owned by the caller.
  api.post('/documents/import', requireUser, singleFile, async (req, res) => {
    const html = await convertUpload(req.file);
    const title = titleFromFilename(req.file.originalname);
    const { lastInsertRowid } = q.insertDoc.run(req.user.id, title, html);
    res.status(201).json(serializeDoc(q.docById.get(lastInsertRowid), 'owner'));
  });

  // Convert a file to HTML so the editor can insert it into an existing draft.
  api.post('/convert', requireUser, singleFile, async (req, res) => {
    res.json({ html: await convertUpload(req.file) });
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use('/api', api);

  // ---- static client (production build) ----
  if (clientDir && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }

  // ---- error handler: consistent JSON errors, no stack traces leaked ----
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    const status = err.status && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
