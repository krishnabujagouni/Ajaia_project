import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ShareDialog({ doc, onChange, onClose }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shares = doc.shares ?? [];

  useEffect(() => {
    api.users().then(setUsers).catch((e) => setError(e.message));
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const candidates = users.filter(
    (u) => u.id !== doc.owner.id && !shares.some((s) => s.user_id === u.id),
  );

  async function grant(targetEmail, targetRole) {
    setError('');
    setBusy(true);
    try {
      onChange(await api.share(doc.id, targetEmail, targetRole));
      setEmail('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId) {
    setError('');
    try {
      onChange(await api.unshare(doc.id, userId));
    } catch (e) {
      setError(e.message);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!email.trim()) return setError('Enter or pick an email address');
    grant(email.trim(), role);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h3 id="share-title">Share “{doc.title}”</h3>

        <form className="share-form" onSubmit={submit}>
          <input
            list="share-users"
            type="email"
            placeholder="Email, e.g. charitha@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <datalist id="share-users">
            {candidates.map((u) => <option key={u.id} value={u.email}>{u.name}</option>)}
          </datalist>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="btn primary" disabled={busy}>Share</button>
        </form>
        {error && <div className="alert error">{error}</div>}

        <h4>People with access</h4>
        <ul className="share-list">
          <li>
            <span><strong>{doc.owner.name}</strong> <span className="muted">{doc.owner.email}</span></span>
            <span className="badge owner">Owner</span>
          </li>
          {shares.map((s) => (
            <li key={s.user_id}>
              <span><strong>{s.name}</strong> <span className="muted">{s.email}</span></span>
              <span className="share-actions">
                <select
                  value={s.role}
                  onChange={(e) => grant(s.email, e.target.value)}
                  aria-label={`Access for ${s.name}`}
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <button className="btn ghost small" onClick={() => revoke(s.user_id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">Demo accounts: {users.map((u) => u.email).join(', ')}</p>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
