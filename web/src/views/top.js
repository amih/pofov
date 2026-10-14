import { api } from '../api.js';
import { esc } from '../ui.js';

export default async function topView(root) {
  root.innerHTML = '<section class="page"><h1>Top contributors</h1><div class="seg"><button data-d="7">Week</button><button data-d="30" class="on">Month</button><button data-d="3650">All time</button></div><div id="stats" class="stats"></div><ol class="leaders" id="list"></ol><p class="muted small">Points: new library 10 · book on a shelf 2 · book taken or missing 1 · checking a library 1 · reviewing 1.</p></section>';
  const list = root.querySelector('#list');
  async function load(days) {
    try {
      const { leaders } = await api(`/api/leaderboard?days=${days}`);
      list.innerHTML = leaders.length ? leaders.map((l) => `<li><span>${esc(l.name)}</span><strong>${l.points}</strong></li>`).join('') : '<p class="muted">No points yet in this period.</p>';
    } catch { list.innerHTML = '<p class="muted">Offline.</p>'; }
  }
  root.querySelector('.seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    root.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    load(b.dataset.d);
  };
  load(30);
  api('/api/stats').then((s) => {
    root.querySelector('#stats').innerHTML = `<div><strong>${s.locations}</strong><span>libraries</span></div><div><strong>${s.books}</strong><span>books</span></div><div><strong>${s.sightings}</strong><span>reports</span></div>`;
  }).catch(() => {});
}
