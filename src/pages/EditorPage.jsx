import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { api, ApiError, SUPPORTED_UPLOADS, SUPPORTED_UPLOADS_LABEL } from '../api.js';
import Toolbar from '../components/Toolbar.jsx';
import ShareDialog from '../components/ShareDialog.jsx';

const AUTOSAVE_MS = 800;

export default function EditorPage() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setDoc(null);
    setError('');
    api.getDoc(id).then(setDoc).catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <div className="alert error">{error}</div>
        <Link to="/">← Back to documents</Link>
      </main>
    );
  }
  if (!doc) return <main className="page muted">Loading document…</main>;
  return <DocEditor key={doc.id} initialDoc={doc} />;
}

function DocEditor({ initialDoc }) {
  const [doc, setDoc] = useState(initialDoc);
  const [status, setStatus] = useState('saved'); // saved | dirty | saving | error | conflict
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState(initialDoc.title);
  const [showShare, setShowShare] = useState(false);
  const canEdit = doc.role !== 'viewer';

  // Refs so the debounced saver always sees the latest values.
  const versionRef = useRef(initialDoc.version);
  const pending = useRef({}); // fields waiting to be saved
  const timer = useRef(null);
  const inFlight = useRef(false);
  const conflictRef = useRef(false);
  const fileInput = useRef(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current || conflictRef.current) return;
    const fields = pending.current;
    if (Object.keys(fields).length === 0) return;
    pending.current = {};
    inFlight.current = true;
    setStatus('saving');
    try {
      const saved = await api.updateDoc(initialDoc.id, { ...fields, version: versionRef.current });
      versionRef.current = saved.version;
      setDoc(saved);
      setMessage('');
      setStatus(Object.keys(pending.current).length ? 'dirty' : 'saved');
    } catch (e) {
      // Put unsaved fields back so nothing is lost.
      pending.current = { ...fields, ...pending.current };
      if (e instanceof ApiError && e.status === 409) {
        conflictRef.current = true;
        setDoc((d) => ({ ...d, latest: e.body.latest }));
        setStatus('conflict');
      } else {
        setStatus('error');
        setMessage(e.message);
      }
    } finally {
      inFlight.current = false;
    }
    // Anything typed while the request was in flight gets saved next.
    if (!conflictRef.current && Object.keys(pending.current).length) schedule();
  }, [initialDoc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }, [flush]);

  const queue = useCallback((fields) => {
    Object.assign(pending.current, fields);
    if (!conflictRef.current) setStatus('dirty');
    schedule();
  }, [schedule]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: initialDoc.content,
    editable: canEdit,
    onUpdate: ({ editor: ed }) => queue({ content: ed.getHTML() }),
  });

  // Warn before leaving with unsaved changes; save when navigating away in-app.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (Object.keys(pending.current).length || inFlight.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [flush]);

  function commitTitle() {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(doc.title);
      setMessage('Title cannot be empty');
      return;
    }
    if (trimmed.length > 200) {
      setMessage('Title must be at most 200 characters');
      return;
    }
    if (trimmed !== doc.title) {
      setDoc((d) => ({ ...d, title: trimmed }));
      queue({ title: trimmed });
      flush();
    }
  }

  // Conflict resolution: either take the server copy, or force ours on top of it.
  function loadLatest() {
    const latest = doc.latest;
    pending.current = {};
    conflictRef.current = false;
    versionRef.current = latest.version;
    editor.commands.setContent(latest.content, { emitUpdate: false });
    setTitle(latest.title);
    setDoc(latest);
    setStatus('saved');
  }

  function keepMine() {
    versionRef.current = doc.latest.version;
    conflictRef.current = false;
    pending.current = { title: title.trim() || doc.title, content: editor.getHTML() };
    flush();
  }

  async function insertFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage('');
    try {
      const { html } = await api.convertFile(file);
      editor.chain().focus().insertContent(html).run();
    } catch (err) {
      setMessage(`Import failed: ${err.message}`);
    }
  }

  const statusText = {
    saved: 'All changes saved',
    dirty: 'Unsaved changes…',
    saving: 'Saving…',
    error: 'Save failed',
    conflict: 'Conflict',
  }[status];

  return (
    <main className="page editor-page">
      <div className="editor-head">
        <Link to="/" className="back" title="Back to documents">←</Link>
        <input
          className="title-input"
          value={title}
          disabled={!canEdit}
          maxLength={200}
          aria-label="Document title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <span className={`save-status ${status}`}>{canEdit ? statusText : 'View only'}</span>
        {doc.role === 'owner' ? (
          <button className="btn primary" onClick={() => setShowShare(true)}>
            Share{doc.shares?.length ? ` (${doc.shares.length})` : ''}
          </button>
        ) : (
          <span className="badge">Owned by {doc.owner.name}</span>
        )}
      </div>

      {message && <div className="alert error">{message}</div>}
      {status === 'error' && (
        <div className="alert error">
          Your changes are kept locally. <button className="btn small" onClick={flush}>Retry save</button>
        </div>
      )}
      {status === 'conflict' && (
        <div className="alert warn">
          Someone else saved this document while you were editing.
          <button className="btn small" onClick={loadLatest}>Load their version</button>
          <button className="btn small" onClick={keepMine}>Overwrite with mine</button>
        </div>
      )}
      {!canEdit && (
        <div className="alert info">You have view-only access. Ask {doc.owner.name} for edit access.</div>
      )}

      {canEdit && (
        <Toolbar editor={editor}>
          <button
            type="button"
            className="tb-btn"
            title={`Insert content from a ${SUPPORTED_UPLOADS_LABEL} file`}
            onClick={() => fileInput.current.click()}
          >
            ⬆ Insert file
          </button>
          <input ref={fileInput} type="file" accept={SUPPORTED_UPLOADS} hidden onChange={insertFile} />
        </Toolbar>
      )}

      <div className="paper">
        <EditorContent editor={editor} />
      </div>

      {showShare && (
        <ShareDialog
          doc={doc}
          onChange={(shares) => setDoc((d) => ({ ...d, shares }))}
          onClose={() => setShowShare(false)}
        />
      )}
    </main>
  );
}
