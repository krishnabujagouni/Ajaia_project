import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, SUPPORTED_UPLOADS, SUPPORTED_UPLOADS_LABEL } from '../api.js';

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function DocList() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);
  const navigate = useNavigate();

  const load = () => api.listDocs().then(setDocs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    try {
      const doc = await api.createDoc();
      navigate(`/d/${doc.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const doc = await api.importFile(file);
      navigate(`/d/${doc.id}`);
    } catch (err) {
      setError(`Import failed: ${err.message}`);
      setBusy(false);
    }
  }

  async function remove(doc) {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteDoc(doc.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <h2>Documents</h2>
        <div className="actions">
          <button className="btn primary" onClick={create} disabled={busy}>+ New document</button>
          <button className="btn" onClick={() => fileInput.current.click()} disabled={busy}>
            ⬆ Import file
          </button>
          <input ref={fileInput} type="file" accept={SUPPORTED_UPLOADS} hidden onChange={importFile} />
        </div>
      </div>
      <p className="muted small">Import turns a {SUPPORTED_UPLOADS_LABEL} file into a new editable document.</p>
      {error && <div className="alert error">{error}</div>}

      {!docs ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section>
            <h3>Owned by me <span className="count">{docs.owned.length}</span></h3>
            {docs.owned.length === 0 ? (
              <p className="empty">No documents yet. Create one or import a file.</p>
            ) : (
              <ul className="doc-list">
                {docs.owned.map((d) => (
                  <li key={d.id}>
                    <Link to={`/d/${d.id}`} className="doc-link">
                      <span className="doc-title">{d.title}</span>
                      <span className="muted small">Edited {formatDate(d.updated_at)}</span>
                    </Link>
                    {d.share_count > 0 && (
                      <span className="badge">Shared with {d.share_count}</span>
                    )}
                    <span className="badge owner">Owner</span>
                    <button className="btn ghost small" onClick={() => remove(d)} title="Delete">🗑</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Shared with me <span className="count">{docs.shared.length}</span></h3>
            {docs.shared.length === 0 ? (
              <p className="empty">Nothing has been shared with you yet.</p>
            ) : (
              <ul className="doc-list">
                {docs.shared.map((d) => (
                  <li key={d.id}>
                    <Link to={`/d/${d.id}`} className="doc-link">
                      <span className="doc-title">{d.title}</span>
                      <span className="muted small">
                        From {d.owner_name} · Edited {formatDate(d.updated_at)}
                      </span>
                    </Link>
                    <span className={`badge ${d.role}`}>{d.role === 'editor' ? 'Can edit' : 'View only'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
