import path from 'node:path';
import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import mammoth from 'mammoth';

export const MAX_CONTENT_BYTES = 1_000_000; // 1 MB of HTML per document
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB per uploaded file
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];

/**
 * Document content is stored as HTML. Because documents are shared between users,
 * everything is sanitized server-side to the subset of tags the editor can produce,
 * so one user can never inject script into another user's browser.
 */
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr', 'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], ol: ['start'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    b: 'strong',
    i: 'em',
    // Collapse heading levels the editor doesn't offer down to h3.
    h4: 'h3', h5: 'h3', h6: 'h3',
  },
};

export function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function textToHtml(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export class UnsupportedFileError extends Error {}

/** Converts an uploaded file buffer into sanitized editor HTML. */
export async function fileToHtml(originalName, buffer) {
  const ext = path.extname(originalName || '').toLowerCase();
  let html;
  switch (ext) {
    case '.txt':
      html = textToHtml(buffer.toString('utf8'));
      break;
    case '.md':
      html = await marked.parse(buffer.toString('utf8'));
      break;
    case '.docx': {
      try {
        const result = await mammoth.convertToHtml({ buffer });
        html = result.value;
      } catch {
        throw new UnsupportedFileError('Could not read this .docx file. Is it a valid Word document?');
      }
      break;
    }
    default:
      throw new UnsupportedFileError(
        `Unsupported file type "${ext || 'none'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      );
  }
  return sanitizeContent(html);
}

export function titleFromFilename(name) {
  const base = path.basename(name || 'Untitled', path.extname(name || '')).trim();
  return (base || 'Untitled').slice(0, 200);
}
