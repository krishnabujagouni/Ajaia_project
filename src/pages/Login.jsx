import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Mocked auth: pick one of the seeded demo accounts. */
export default function Login({ onLogin }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.users().then(setUsers).catch((e) => setError(e.message));
  }, []);

  async function choose(email) {
    setError('');
    try {
      onLogin(await api.login(email));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="center">
      <div className="card login">
        <h1>📝 CollabDocs</h1>
        <p className="muted">
          Demo sign-in: choose an account. Open a second browser (or a private window) as a
          different user to try sharing.
        </p>
        {error && <div className="alert error">{error}</div>}
        <div className="user-list">
          {users.map((u) => (
            <button key={u.id} className="user-btn" onClick={() => choose(u.email)}>
              <span className="avatar">{u.name[0]}</span>
              <span>
                <strong>{u.name}</strong>
                <br />
                <span className="muted">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
