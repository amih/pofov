import { api } from '../api.js';
import { esc } from '../ui.js';

const ERRORS = {
  expired: 'That sign-in link has expired or was already used. Please try again.',
  google: 'Google sign-in did not work. Please try again, or use the email link.',
  google_off: 'Google sign-in is not available right now. Use the email link.',
};

const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

export default async function loginView(root, _, query) {
  const error = ERRORS[query.get('error')];
  if (query.get('next')) sessionStorage.setItem('pofov:next', query.get('next'));
  const { google } = await api('/api/auth/config').catch(() => ({ google: false }));
  root.innerHTML = `
  <section class="page narrow">
    <h1>Sign in or sign up</h1>
    ${error ? `<p class="note">${error}</p>` : ''}
    ${google ? `
      <a class="btn big google" href="/api/auth/google">${GOOGLE_G} Continue with Google</a>
      <p class="or"><span>or</span></p>` : ''}
    <form class="form" id="f">
      <label>Email <input type="email" name="email" required autocomplete="email" inputmode="email"></label>
      <button class="btn primary big">Email me a one-time sign-in link</button>
    </form>
    <p class="muted small">Your email is never shown to anyone. Others see only the screen name and picture you choose.</p>
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
