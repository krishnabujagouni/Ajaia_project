import { useEditorState } from '@tiptap/react';

/** Formatting toolbar. Active states re-render on every selection change via useEditorState. */
export default function Toolbar({ editor, children }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const block = s.h1 ? 'h1' : s.h2 ? 'h2' : s.h3 ? 'h3' : 'p';
  const run = (fn) => () => fn(editor.chain().focus()).run();

  function setBlock(value) {
    const chain = editor.chain().focus();
    if (value === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(value[1]) }).run();
  }

  const Btn = ({ active, label, title, onClick, disabled, className = '' }) => (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="↶" title="Undo (Ctrl+Z)" onClick={run((c) => c.undo())} disabled={!s.canUndo} />
      <Btn label="↷" title="Redo (Ctrl+Y)" onClick={run((c) => c.redo())} disabled={!s.canRedo} />
      <span className="tb-sep" />
      <select
        className="tb-select"
        value={block}
        onChange={(e) => setBlock(e.target.value)}
        aria-label="Text style"
      >
        <option value="p">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span className="tb-sep" />
      <Btn label="B" className="b" title="Bold (Ctrl+B)" active={s.bold} onClick={run((c) => c.toggleBold())} />
      <Btn label="I" className="i" title="Italic (Ctrl+I)" active={s.italic} onClick={run((c) => c.toggleItalic())} />
      <Btn label="U" className="u" title="Underline (Ctrl+U)" active={s.underline} onClick={run((c) => c.toggleUnderline())} />
      <Btn label="S" className="s" title="Strikethrough" active={s.strike} onClick={run((c) => c.toggleStrike())} />
      <span className="tb-sep" />
      <Btn label="• List" title="Bulleted list" active={s.bullet} onClick={run((c) => c.toggleBulletList())} />
      <Btn label="1. List" title="Numbered list" active={s.ordered} onClick={run((c) => c.toggleOrderedList())} />
      <Btn label="❝" title="Quote" active={s.quote} onClick={run((c) => c.toggleBlockquote())} />
      <span className="tb-sep" />
      {children}
    </div>
  );
}
