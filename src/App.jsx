import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import DocList from './pages/DocList.jsx';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const navigate = useNavigate();

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    navigate('/');
  }

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">📝 CollabDocs</Link>
        <div className="topbar-right">
          <span className="muted">Signed in as <strong>{user.name}</strong> ({user.email})</span>
          <button className="btn ghost" onClick={logout}>Switch user</button>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<DocList user={user} />} />
        <Route path="/d/:id" element={<EditorPage user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
