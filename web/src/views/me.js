import { api, getMe } from '../api.js';
import { navigate } from '../nav.js';
import { esc, toast } from '../ui.js';

const LEVELS = ['New reader', 'Trusted reader', 'Reviewer', 'Admin'];

export default async function meView(root, _, query) {
  const me = await getMe(true);
  if (!me) return navigate('/login', { replace: true });
  const next = sessionStorage.getItem('pofov:next');
  if (query.get('welcome') && next) {
    sessionStorage.removeItem('pofov:next');
    return navigate(next, { replace: true });
  }
  root.innerHTML = `
  <section class="page">
    <h1>${esc(me.display_name || 'Your profile')}</h1>
    <div class="stats">
      <div><strong>${me.karma}</strong><span>points</span></div>
      <div><strong>${me.locations}</strong><span>libraries</span></div>
      <div><strong>${me.sightings}</strong><span>book reports</span></div>
    </div>
    <p class="muted">${LEVELS[me.trust_level]}${me.trust_level === 0 ? ' — your first few reports are checked by a reviewer. After that they go live right away.' : ''}</p>
    <form class="form" id="name">
      <label>Name shown on the leaderboard
        <input name="display_name" maxlength="40" value="${esc(me.display_name ?? '')}" placeholder="e.g. Dana from Florentin"></label>
      <button class="btn">Save</button>
    </form>
    <p class="row">
      ${me.trust_level >= 2 ? '<a class="btn" href="/review">Review queue</a>' : ''}
      <a class="btn" href="/about">About &amp; settings</a>
      <button class="btn" id="logout">Sign out</button>
    </p>
    <p class="muted small">${esc(me.email)}</p>
  </section>`;
  root.querySelector('#name').onsubmit = async (e) => {
    e.preventDefault();
    await api('/api/me', { method: 'POST', json: { display_name: e.target.display_name.value } });
    toast('Saved');
    meView(root, _, new URLSearchParams());
  };
  root.querySelector('#logout').onclick = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    await getMe(true);
    navigate('/');
  };
}
