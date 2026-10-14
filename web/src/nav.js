export function navigate(to, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new Event('pofov:navigate'));
}
