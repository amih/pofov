import { api, getMe } from '../api.js';
import { navigate } from '../nav.js';
import { esc, getPosition, shrinkImage, toast } from '../ui.js';
import { t } from '../i18n.js';

export default async function editLocationView(root, [code]) {
  const me = await getMe();
  if (!me) return navigate(`/login?next=/l/${code}/edit`, { replace: true });
  let l;
  try { l = (await api(`/api/locations/${code}`)).location; } catch {
    root.innerHTML = `<section class="page"><h1>${t('loc.notfound')}</h1></section>`;
    return;
  }

  root.innerHTML = `
  <section class="page">
    <p><a href="/l/${l.code}">${t('back.library')}</a></p>
    <h1>${t('edit.title')}</h1>
    <p class="muted">${t('edit.lead')}</p>
    <form id="f" class="form">
      <label class="photo-pick">
        <input type="file" name="photo" accept="image/*" capture="environment" hidden>
        <span id="photo-preview">${l.photo ? `<img src="${l.photo.url}" alt="">` : t('edit.photo')}</span>
      </label>
      <label>${t('addloc.name')} <input name="name" maxlength="120" value="${esc(l.name ?? '')}"></label>
      <label>${t('addloc.hint')} <textarea name="description" maxlength="1000" rows="3">${esc(l.description ?? '')}</textarea></label>
      <label class="check"><input type="checkbox" name="restricted" ${l.restricted ? 'checked' : ''}> ${t('addloc.restricted')}</label>
      <label class="check"><input type="checkbox" name="move"> ${t('edit.move')}</label>
      <p class="muted small">${t('edit.move_note')}</p>
      <label class="check"><input type="checkbox" name="removed"> ${t('edit.removed')}</label>
      <label>${t('edit.note')} <span class="muted">${t('optional')}</span><textarea name="note" maxlength="500" rows="2"></textarea></label>
      <button class="btn primary big" type="submit">${t('edit.submit')}</button>
    </form>
  </section>`;

  const form = root.querySelector('#f');
  let photo = null;
  form.photo.onchange = async () => {
    const file = form.photo.files[0];
    if (!file) return;
    photo = await shrinkImage(file);
    root.querySelector('#photo-preview').innerHTML = `<img src="${URL.createObjectURL(photo)}" alt="">`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('name', form.name.value);
    fd.append('description', form.description.value);
    fd.append('restricted', form.restricted.checked ? '1' : '0');
    if (form.removed.checked) fd.append('removed', '1');
    if (form.note.value.trim()) fd.append('note', form.note.value);
    if (photo) fd.append('photo', photo, 'photo.jpg');
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      if (form.move.checked) {
        const p = await getPosition();
        fd.append('lat', p.lat);
        fd.append('lon', p.lon);
      }
      const { edit } = await api(`/api/locations/${code}/edits`, { method: 'POST', form: fd });
      toast(t(edit.status === 'approved' ? 'edit.applied' : 'edit.sent'));
      navigate(`/l/${code}`, { replace: true });
    } catch (err) {
      const k = { no_changes: 'edit.no_changes', too_far: 'edit.too_far' }[err.body?.error];
      toast(k ? t(k) : err.message);
      btn.disabled = false;
    }
  };
}
