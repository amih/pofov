import { api } from '../api.js';
import { esc } from '../ui.js';

export default function loginView(root, _, query) {
  const expired = query.get('error') === 'expired';
  if (query.get('next')) sessionStorage.setItem('pofov:next', query.get('next'));
  root.innerHTML = `
  <section class="page narrow">
    <h1>Sign in</h1>
    ${expired ? '<p class="note">That link has expired or was already used. Ask for a new one.</p>' : ''}
    <p>No password. We email you a link — tap it on this phone and you are in.</p>
    <form class="form" id="f">
      <label>Email <input type="email" name="email" required autocomplete="email" inputmode="email"></label>
      <button class="btn primary big">Email me a sign-in link</button>
    </form>
    <p class="muted small">We use your email only to sign you in. Your name on the leaderboard is whatever you choose.</p>
  </section>`;
  root.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    e.target.querySelector('button').disabled = true;
    try {
      await api('/api/auth/request', { method: 'POST', json: { email } });
      root.querySelector('.page').innerHTML = `<h1>Check your email</h1><p>We sent a link to <strong>${esc(email)}</strong>. Open it on this device.</p><p class="muted small">Nothing arrived? Look in the spam folder, or <a href="/login">try again</a>.</p>`;
    } catch (err) {
      e.target.querySelector('button').disabled = false;
      alert(err.status === 429 ? 'Too many attempts. Please wait a few minutes.' : 'Could not send the email. Please try again.');
    }
  };
}
