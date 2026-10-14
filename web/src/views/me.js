import { api, getMe } from '../api.js';
import { navigate } from '../nav.js';
import { esc, toast, avatarHtml } from '../ui.js';

const LEVELS = ['New reader', 'Trusted reader', 'Reviewer', 'Admin'];
const NAME_ERRORS = {
  invalid_screen_name: '3–30 letters or numbers (spaces, _ . - allowed inside). No email addresses.',
  screen_name_taken: 'Someone already uses that name. Try another.',
};

export default async function meView(root, _, query) {
  const me = await getMe(true);
  if (!me) return navigate('/login', { replace: true });
  const welcome = query.get('welcome');
  const goNext = () => {
    const next = sessionStorage.getItem('pofov:next');
    sessionStorage.removeItem('pofov:next');
    if (next) { navigate(next, { replace: true }); return true; }
    return false;
  };
  if (welcome && me.screen_name && goNext()) return;

  const needsName = !me.screen_name;
  root.innerHTML = `
  <section class="page">
    ${needsName ? `<h1>Welcome to POFOV!</h1><p>Choose a screen name. It is what others see next to your books and on the leaderboard — your email stays private.</p>`
      : `<div class="profile-head">${avatarHtml(me, 72)}<div><h1>${esc(me.screen_name)}</h1><p class="muted">${LEVELS[me.trust_level]}</p></div></div>`}
    <form class="form" id="name">
      <label>Screen name
        <input name="screen_name" maxlength="30" minlength="3" required value="${esc(me.screen_name ?? '')}" placeholder="e.g. DanaReads" autocomplete="nickname"></label>
      <p class="field-error" id="name-err" hidden></p>
      <button class="btn${needsName ? ' primary big' : ''}">${needsName ? 'Continue' : 'Save name'}</button>
    </form>
    ${needsName ? '' : `
    <h2>Picture</h2>
    <div class="row avatar-row">
      ${avatarHtml(me, 56)}
      <label class="btn">📷 ${me.avatar ? 'Replace picture' : 'Add a picture'}<input type="file" accept="image/*" id="avatar" hidden></label>
      ${me.avatar_source === 'upload' ? `<button class="btn" id="avatar-reset">${me.can_use_google_picture ? 'Use my Google picture' : 'Remove picture'}</button>` : ''}
    </div>
    ${me.avatar_source === 'google' ? '<p class="muted small">This is your Google profile picture. It updates when you sign in with Google, until you replace it.</p>' : ''}
    <div class="stats">
      <div><strong>${me.karma}</strong><span>points</span></div>
      <div><strong>${me.locations}</strong><span>libraries</span></div>
      <div><strong>${me.sightings}</strong><span>book reports</span></div>
    </div>
    ${me.trust_level === 0 ? '<p class="muted small">Your first few reports are checked by a reviewer. After that they go live right away.</p>' : ''}
    <p class="row">
      ${me.trust_level >= 2 ? '<a class="btn" href="/review">Review queue</a>' : ''}
      <a class="btn" href="/about">About &amp; settings</a>
      <button class="btn" id="logout">Sign out</button>
    </p>
    <p class="muted small">Signed in as ${esc(me.email)}${me.has_google ? ' (Google)' : ''} — only you can see this.</p>`}
  </section>`;

  const rerender = () => meView(root, _, new URLSearchParams());
  root.querySelector('#name').onsubmit = async (e) => {
    e.preventDefault();
    const err = root.querySelector('#name-err');
    try {
      await api('/api/me', { method: 'POST', json: { screen_name: e.target.screen_name.value } });
      await getMe(true);
      document.dispatchEvent(new Event('pofov:me'));
      if (needsName && goNext()) return;
      toast('Saved');
      rerender();
    } catch (ex) {
      err.textContent = NAME_ERRORS[ex.body?.error] ?? 'Could not save. Please try again.';
      err.hidden = false;
    }
  };
  root.querySelector('#avatar')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      await api('/api/me/avatar', { method: 'POST', form: fd });
      document.dispatchEvent(new Event('pofov:me'));
      toast('Picture updated');
      rerender();
    } catch { toast('That image could not be used. Try another.'); }
  });
  root.querySelector('#avatar-reset')?.addEventListener('click', async () => {
    await api('/api/me/avatar', { method: 'DELETE' });
    document.dispatchEvent(new Event('pofov:me'));
    rerender();
  });
  root.querySelector('#logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    await getMe(true);
    document.dispatchEvent(new Event('pofov:me'));
    navigate('/');
  });
}
