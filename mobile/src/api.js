import { API_URL } from './config';

let token = null;
let onUnauthorized = () => {};

export const setToken = (t) => {
  token = t;
};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(API_URL + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new Error(`Cannot reach the server at ${API_URL}. Is the backend running and on the same Wi-Fi?`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b || {}),
  patch: (p, b) => request('PATCH', p, b || {}),
  del: (p) => request('DELETE', p),
};
