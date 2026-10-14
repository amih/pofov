import { get, set, del, keys, createStore } from 'idb-keyval';

// Uploads made with no signal are kept here and sent when the phone is back online.
const store = createStore('pofov-queue', 'requests');
const listeners = new Set();

export const onQueueChange = (fn) => listeners.add(fn);
const notify = async () => { const n = await pendingCount(); listeners.forEach((fn) => fn(n)); };

export async function pendingCount() {
  try { return (await keys(store)).length; } catch { return 0; }
}

// fields: plain values; files: { name: Blob }
export async function enqueue(url, fields, files = {}, label = 'upload') {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await set(id, { id, url, fields, files, label, createdAt: Date.now() }, store);
  notify();
  return id;
}

let flushing = false;
// Returns the results of requests sent in this pass.
export async function flush() {
  if (flushing || !navigator.onLine) return [];
  flushing = true;
  const results = [];
  try {
    for (const id of (await keys(store)).sort()) {
      const item = await get(id, store);
      if (!item) continue;
      const form = new FormData();
      for (const [k, v] of Object.entries(item.fields)) if (v != null) form.append(k, v);
      for (const [k, blob] of Object.entries(item.files)) if (blob) form.append(k, blob, `${k}.jpg`);
      let res;
      try {
        res = await fetch(item.url, { method: 'POST', body: form, headers: { 'X-App-Build': String(__APP_BUILD__) } });
      } catch {
        break; // still offline — try again later
      }
      if (res.status === 401 || res.status === 426 || res.status >= 500) break;
      const data = await res.json().catch(() => null);
      results.push({ item, status: res.status, data });
      await del(id, store);
    }
  } finally {
    flushing = false;
    notify();
  }
  return results;
}

export function startQueue() {
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && flush());
  flush();
}
