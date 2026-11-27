import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3001;

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.warn('WARNING: SESSION_SECRET is not set; using an insecure default.');
}

const db = openDb(process.env.DB_FILE || path.join(root, 'data', 'app.db'));
const app = createApp(db, {
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  clientDir: path.join(root, 'dist'),
});

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
