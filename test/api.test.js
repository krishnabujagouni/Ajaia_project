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
    const krishna = await loginAs('krishna@example.com');
    const { body: created } = await krishna.post('/api/documents').send({}).expect(201);
    expect(created.title).toBe('Untitled document');
    expect(created.role).toBe('owner');

    const html = '<h1>Plan</h1><p><strong>bold</strong> <em>it</em> <u>under</u></p><ul><li>one</li></ul><ol><li>two</li></ol>';
    await krishna.patch(`/api/documents/${created.id}`)
      .send({ title: 'Q3 Plan', content: html, version: created.version }).expect(200);

    const { body: reopened } = await krishna.get(`/api/documents/${created.id}`).expect(200);
    expect(reopened.title).toBe('Q3 Plan');
    expect(reopened.content).toBe(html);
    expect(reopened.version).toBe(created.version + 1);
  });

  it('validates input', async () => {
    const krishna = await loginAs('krishna@example.com');
    await krishna.post('/api/documents').send({ title: '   ' }).expect(400);
    await krishna.post('/api/documents').send({ title: 'x'.repeat(201) }).expect(400);
    const { body: doc } = await krishna.post('/api/documents').send({ title: 'ok' }).expect(201);
    await krishna.patch(`/api/documents/${doc.id}`).send({ title: 'no version' }).expect(400);
    await krishna.patch(`/api/documents/${doc.id}`).send({ version: doc.version }).expect(400);
    await krishna.get('/api/documents/abc').expect(400);
    await krishna.post('/api/documents').set('Content-Type', 'application/json').send('{bad').expect(400);
  });

  it('strips dangerous HTML before storing it', async () => {
    const krishna = await loginAs('krishna@example.com');
    const { body: doc } = await krishna.post('/api/documents')
      .send({ content: '<p onclick="x()">hi<script>alert(1)</script><a href="javascript:evil()">l</a></p>' })
      .expect(201);
    expect(doc.content).toBe('<p>hi<a>l</a></p>');
  });

  it('rejects a stale save with 409 instead of silently overwriting', async () => {
    const krishna = await loginAs('krishna@example.com');
    const { body: doc } = await krishna.post('/api/documents').send({}).expect(201);
    await krishna.patch(`/api/documents/${doc.id}`).send({ content: '<p>first</p>', version: doc.version }).expect(200);
    const res = await krishna.patch(`/api/documents/${doc.id}`)
      .send({ content: '<p>stale</p>', version: doc.version }).expect(409);
    expect(res.body.latest.content).toBe('<p>first</p>');
  });
});

describe('sharing', () => {
  it('enforces owner / editor / viewer / no-access permissions', async () => {
    const krishna = await loginAs('krishna@example.com');
    const charitha = await loginAs('charitha@example.com');
    const kritha = await loginAs('kritha@example.com');

    const { body: doc } = await krishna.post('/api/documents').send({ title: 'Secret' }).expect(201);

    // Before sharing, Charitha can't see it, and it doesn't leak via 403.
    await charitha.get(`/api/documents/${doc.id}`).expect(404);

    await krishna.post(`/api/documents/${doc.id}/shares`).send({ email: 'charitha@example.com', role: 'editor' }).expect(201);
    await krishna.post(`/api/documents/${doc.id}/shares`).send({ email: 'kritha@example.com', role: 'viewer' }).expect(201);

    // Lists distinguish owned vs shared.
    const { body: krishnaList } = await krishna.get('/api/documents').expect(200);
    expect(krishnaList.owned.map((d) => d.id)).toContain(doc.id);
    expect(krishnaList.owned[0].share_count).toBe(2);
    const { body: charithaList } = await charitha.get('/api/documents').expect(200);
    expect(charithaList.owned).toHaveLength(0);
    expect(charithaList.shared[0]).toMatchObject({ id: doc.id, role: 'editor', owner_email: 'krishna@example.com' });

    // Editor can edit but not share or delete.
    const { body: charithaView } = await charitha.get(`/api/documents/${doc.id}`).expect(200);
    expect(charithaView.role).toBe('editor');
    expect(charithaView.shares).toBeUndefined();
    await charitha.patch(`/api/documents/${doc.id}`).send({ content: '<p>charitha was here</p>', version: charithaView.version }).expect(200);
    await charitha.post(`/api/documents/${doc.id}/shares`).send({ email: 'kritha@example.com' }).expect(403);
    await charitha.delete(`/api/documents/${doc.id}`).expect(403);

    // Viewer can read the latest content but not edit.
    const { body: krithaView } = await kritha.get(`/api/documents/${doc.id}`).expect(200);
    expect(krithaView.content).toBe('<p>charitha was here</p>');
    await kritha.patch(`/api/documents/${doc.id}`).send({ title: 'mine', version: krithaView.version }).expect(403);

    // Revoking access works.
    const { body: ownerView } = await krishna.get(`/api/documents/${doc.id}`).expect(200);
    const krithaShare = ownerView.shares.find((s) => s.email === 'kritha@example.com');
    expect(krithaShare.role).toBe('viewer');
    await krishna.delete(`/api/documents/${doc.id}/shares/${krithaShare.user_id}`).expect(200);
    await kritha.get(`/api/documents/${doc.id}`).expect(404);
  });

  it('validates share requests', async () => {
    const krishna = await loginAs('krishna@example.com');
    const { body: doc } = await krishna.post('/api/documents').send({}).expect(201);
    await krishna.post(`/api/documents/${doc.id}/shares`).send({ email: 'ghost@example.com' }).expect(404);
    await krishna.post(`/api/documents/${doc.id}/shares`).send({ email: 'krishna@example.com' }).expect(400);
    await krishna.post(`/api/documents/${doc.id}/shares`).send({ email: 'charitha@example.com', role: 'admin' }).expect(400);
  });
});

describe('file upload', () => {
  it('imports a markdown file as a new formatted document', async () => {
    const krishna = await loginAs('krishna@example.com');
    const md = '# Meeting notes\n\nSome **bold** and _italic_.\n\n- a\n- b\n';
    const { body: doc } = await krishna.post('/api/documents/import')
      .attach('file', Buffer.from(md), 'notes.md').expect(201);
    expect(doc.title).toBe('notes');
    expect(doc.content).toContain('<h1>Meeting notes</h1>');
    expect(doc.content).toContain('<strong>bold</strong>');
    expect(doc.content).toContain('<ul>');
  });

  it('converts plain text into paragraphs, escaping HTML', async () => {
    const krishna = await loginAs('krishna@example.com');
    const { body } = await krishna.post('/api/convert')
      .attach('file', Buffer.from('line <b>one</b>\n\nsecond para'), 'a.txt').expect(200);
    expect(body.html).toBe('<p>line &lt;b&gt;one&lt;/b&gt;</p><p>second para</p>');
  });

  it('rejects unsupported and missing files', async () => {
    const krishna = await loginAs('krishna@example.com');
    await krishna.post('/api/documents/import').attach('file', Buffer.from('x'), 'evil.exe').expect(415);
    await krishna.post('/api/documents/import').expect(400);
    await krishna.post('/api/documents/import').attach('file', Buffer.from('not a zip'), 'broken.docx').expect(415);
  });
});

describe('demo seed', () => {
  it('seeds one shared welcome document on a fresh file database, only once', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajaia-project-'));
    const file = path.join(dir, 'app.db');
    openDb(file).close();
    const db = openDb(file); // reopening must not seed a second copy
    const seeded = createApp(db, { sessionSecret: 'test' });

    const charitha = request.agent(seeded);
    await charitha.post('/api/auth/login').send({ email: 'charitha@example.com' }).expect(200);
    const { body } = await charitha.get('/api/documents').expect(200);
    expect(body.shared).toHaveLength(1);
    expect(body.shared[0]).toMatchObject({ role: 'editor', owner_email: 'krishna@example.com' });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('legacy demo accounts', () => {
  it('renames old alice/bob/carol accounts in place, keeping their documents and shares', async () => {
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajaia-project-'));
    const file = path.join(dir, 'app.db');
    // Simulate a database created by the earlier version.
    const old = openDb(file);
    old.exec(`UPDATE users SET email = 'alice@example.com', name = 'Alice Owner' WHERE email = 'krishna@example.com';
              UPDATE users SET email = 'bob@example.com', name = 'Bob Collaborator' WHERE email = 'charitha@example.com';
              UPDATE users SET email = 'carol@example.com', name = 'Carol Reviewer' WHERE email = 'kritha@example.com';
              UPDATE documents SET content = '<p>Owned by Alice, shared with Bob and Carol</p>';`);
    old.close();

    const db = openDb(file);
    expect(db.prepare('SELECT email FROM users ORDER BY id').all().map((u) => u.email))
      .toEqual(['krishna@example.com', 'charitha@example.com', 'kritha@example.com']);
    const app2 = createApp(db, { sessionSecret: 'test' });
    const charitha = request.agent(app2);
    await charitha.post('/api/auth/login').send({ email: 'charitha@example.com' }).expect(200);
    const { body } = await charitha.get('/api/documents').expect(200);
    expect(body.shared).toHaveLength(1);
    expect(body.shared[0]).toMatchObject({ role: 'editor', owner_name: 'Krishna' });
    const { body: doc } = await charitha.get(`/api/documents/${body.shared[0].id}`).expect(200);
    expect(doc.content).toBe('<p>Owned by Krishna, shared with Charitha and Kritha</p>');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
