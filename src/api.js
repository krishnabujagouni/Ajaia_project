/** Thin fetch wrapper: JSON in/out, throws ApiError with the server's message. */
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${url}`, opts);
  } catch {
    throw new ApiError(0, 'Network error: could not reach the server');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data);
  return data;
}

function fileForm(file) {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export const api = {
  users: () => request('GET', '/users'),
  me: () => request('GET', '/auth/me'),
  login: (email) => request('POST', '/auth/login', { email }),
  logout: () => request('POST', '/auth/logout'),

  listDocs: () => request('GET', '/documents'),
  createDoc: (data = {}) => request('POST', '/documents', data),
  getDoc: (id) => request('GET', `/documents/${id}`),
  updateDoc: (id, data) => request('PATCH', `/documents/${id}`, data),
  deleteDoc: (id) => request('DELETE', `/documents/${id}`),

  share: (id, email, role) => request('POST', `/documents/${id}/shares`, { email, role }),
  unshare: (id, userId) => request('DELETE', `/documents/${id}/shares/${userId}`),

  importFile: (file) => request('POST', '/documents/import', fileForm(file)),
  convertFile: (file) => request('POST', '/convert', fileForm(file)),
};

export const SUPPORTED_UPLOADS = '.txt,.md,.docx';
export const SUPPORTED_UPLOADS_LABEL = '.txt, .md or .docx, up to 5 MB';
