import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let app;

beforeEach(() => {
  app = createApp(openDb(':memory:'), { sessionSecret: 'test' });
});

async function loginAs(email) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email }).expect(200);
  return agent;
}

describe('auth', () => {
  it('rejects unauthenticated access and unknown accounts', async () => {
    await request(app).get('/api/documents').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'nobody@example.com' }).expect(401);
  });

  it('rejects a forged (unsigned) session cookie', async () => {
    await request(app).get('/api/documents').set('Cookie', 'uid=1').expect(401);
  });
});

describe('documents', () => {
  it('creates, renames, edits and reopens a document with formatting preserved', async () => {
    const alice = await loginAs('alice@example.com');
    const { body: created } = await alice.post('/api/documents').send({}).expect(201);
    expect(created.title).toBe('Untitled document');
    expect(created.role).toBe('owner');

    const html = '<h1>Plan</h1><p><strong>bold</strong> <em>it</em> <u>under</u></p><ul><li>one</li></ul><ol><li>two</li></ol>';
    await alice.patch(`/api/documents/${created.id}`)
      .send({ title: 'Q3 Plan', content: html, version: created.version }).expect(200);

    const { body: reopened } = await alice.get(`/api/documents/${created.id}`).expect(200);
    expect(reopened.title).toBe('Q3 Plan');
    expect(reopened.content).toBe(html);
    expect(reopened.version).toBe(created.version + 1);
  });

  it('validates input', async () => {
    const alice = await loginAs('alice@example.com');
    await alice.post('/api/documents').send({ title: '   ' }).expect(400);
    await alice.post('/api/documents').send({ title: 'x'.repeat(201) }).expect(400);
    const { body: doc } = await alice.post('/api/documents').send({ title: 'ok' }).expect(201);
    await alice.patch(`/api/documents/${doc.id}`).send({ title: 'no version' }).expect(400);
    await alice.patch(`/api/documents/${doc.id}`).send({ version: doc.version }).expect(400);
    await alice.get('/api/documents/abc').expect(400);
    await alice.post('/api/documents').set('Content-Type', 'application/json').send('{bad').expect(400);
  });

  it('strips dangerous HTML before storing it', async () => {
    const alice = await loginAs('alice@example.com');
    const { body: doc } = await alice.post('/api/documents')
      .send({ content: '<p onclick="x()">hi<script>alert(1)</script><a href="javascript:evil()">l</a></p>' })
      .expect(201);
    expect(doc.content).toBe('<p>hi<a>l</a></p>');
  });

  it('rejects a stale save with 409 instead of silently overwriting', async () => {
    const alice = await loginAs('alice@example.com');
    const { body: doc } = await alice.post('/api/documents').send({}).expect(201);
    await alice.patch(`/api/documents/${doc.id}`).send({ content: '<p>first</p>', version: doc.version }).expect(200);
    const res = await alice.patch(`/api/documents/${doc.id}`)
      .send({ content: '<p>stale</p>', version: doc.version }).expect(409);
    expect(res.body.latest.content).toBe('<p>first</p>');
  });
});

describe('sharing', () => {
  it('enforces owner / editor / viewer / no-access permissions', async () => {
    const alice = await loginAs('alice@example.com');
    const bob = await loginAs('bob@example.com');
    const carol = await loginAs('carol@example.com');

    const { body: doc } = await alice.post('/api/documents').send({ title: 'Secret' }).expect(201);

    // Before sharing, Bob can't see it, and it doesn't leak via 403.
    await bob.get(`/api/documents/${doc.id}`).expect(404);

    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: 'bob@example.com', role: 'editor' }).expect(201);
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: 'carol@example.com', role: 'viewer' }).expect(201);

    // Lists distinguish owned vs shared.
    const { body: aliceList } = await alice.get('/api/documents').expect(200);
    expect(aliceList.owned.map((d) => d.id)).toContain(doc.id);
    expect(aliceList.owned[0].share_count).toBe(2);
    const { body: bobList } = await bob.get('/api/documents').expect(200);
    expect(bobList.owned).toHaveLength(0);
    expect(bobList.shared[0]).toMatchObject({ id: doc.id, role: 'editor', owner_email: 'alice@example.com' });

    // Editor can edit but not share or delete.
    const { body: bobView } = await bob.get(`/api/documents/${doc.id}`).expect(200);
    expect(bobView.role).toBe('editor');
    expect(bobView.shares).toBeUndefined();
    await bob.patch(`/api/documents/${doc.id}`).send({ content: '<p>bob was here</p>', version: bobView.version }).expect(200);
    await bob.post(`/api/documents/${doc.id}/shares`).send({ email: 'carol@example.com' }).expect(403);
    await bob.delete(`/api/documents/${doc.id}`).expect(403);

    // Viewer can read the latest content but not edit.
    const { body: carolView } = await carol.get(`/api/documents/${doc.id}`).expect(200);
    expect(carolView.content).toBe('<p>bob was here</p>');
    await carol.patch(`/api/documents/${doc.id}`).send({ title: 'mine', version: carolView.version }).expect(403);

    // Revoking access works.
    const { body: ownerView } = await alice.get(`/api/documents/${doc.id}`).expect(200);
    const carolShare = ownerView.shares.find((s) => s.email === 'carol@example.com');
    expect(carolShare.role).toBe('viewer');
    await alice.delete(`/api/documents/${doc.id}/shares/${carolShare.user_id}`).expect(200);
    await carol.get(`/api/documents/${doc.id}`).expect(404);
  });

  it('validates share requests', async () => {
    const alice = await loginAs('alice@example.com');
    const { body: doc } = await alice.post('/api/documents').send({}).expect(201);
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: 'ghost@example.com' }).expect(404);
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: 'alice@example.com' }).expect(400);
    await alice.post(`/api/documents/${doc.id}/shares`).send({ email: 'bob@example.com', role: 'admin' }).expect(400);
  });
});

describe('file upload', () => {
  it('imports a markdown file as a new formatted document', async () => {
    const alice = await loginAs('alice@example.com');
    const md = '# Meeting notes\n\nSome **bold** and _italic_.\n\n- a\n- b\n';
    const { body: doc } = await alice.post('/api/documents/import')
      .attach('file', Buffer.from(md), 'notes.md').expect(201);
    expect(doc.title).toBe('notes');
    expect(doc.content).toContain('<h1>Meeting notes</h1>');
    expect(doc.content).toContain('<strong>bold</strong>');
    expect(doc.content).toContain('<ul>');
  });

  it('converts plain text into paragraphs, escaping HTML', async () => {
    const alice = await loginAs('alice@example.com');
    const { body } = await alice.post('/api/convert')
      .attach('file', Buffer.from('line <b>one</b>\n\nsecond para'), 'a.txt').expect(200);
    expect(body.html).toBe('<p>line &lt;b&gt;one&lt;/b&gt;</p><p>second para</p>');
  });

  it('rejects unsupported and missing files', async () => {
    const alice = await loginAs('alice@example.com');
    await alice.post('/api/documents/import').attach('file', Buffer.from('x'), 'evil.exe').expect(415);
    await alice.post('/api/documents/import').expect(400);
    await alice.post('/api/documents/import').attach('file', Buffer.from('not a zip'), 'broken.docx').expect(415);
  });
});

describe('demo seed', () => {
  it('seeds one shared welcome document on a fresh file database, only once', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-docs-'));
    const file = path.join(dir, 'app.db');
    openDb(file).close();
    const db = openDb(file); // reopening must not seed a second copy
    const seeded = createApp(db, { sessionSecret: 'test' });

    const bob = request.agent(seeded);
    await bob.post('/api/auth/login').send({ email: 'bob@example.com' }).expect(200);
    const { body } = await bob.get('/api/documents').expect(200);
    expect(body.shared).toHaveLength(1);
    expect(body.shared[0]).toMatchObject({ role: 'editor', owner_email: 'alice@example.com' });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
