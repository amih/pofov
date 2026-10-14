import { checkForUpdate, hardReset, isUpdateWaiting, maybeApply } from '../update.js';
import { toast } from '../ui.js';

export default function aboutView(root) {
  root.innerHTML = `
  <section class="page">
    <h1>About POFOV</h1>
    <p><strong>Pass On, Find Other Volumes.</strong> A shared map of free street libraries — book boxes, little free libraries,
      shelves in lobbies and parks — and the books on their shelves right now.</p>
    <ul>
      <li>Found a library? Add it with a photo and a hint.</li>
      <li>At a library? Scan the barcodes of the books you see, take or leave.</li>
      <li>Every report earns points. After a few checked reports, yours go live right away.</li>
    </ul>
    <h2>Install it</h2>
    <p>On Android: browser menu → <em>Install app</em>. On iPhone: Share → <em>Add to Home Screen</em>.</p>
    <h2>Version</h2>
    <p>You are running <strong>${__APP_VERSION__}</strong>. The app updates itself.</p>
    <p class="row"><button class="btn" id="upd">Check for update now</button><button class="btn" id="reset">Repair app</button></p>
    <h2>Data</h2>
    <p class="small">Library locations include data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> (ODbL).
      Book details from <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a> and Google Books.</p>
  </section>`;
  root.querySelector('#upd').onclick = async () => {
    checkForUpdate();
    toast('Checking…');
    setTimeout(() => {
      if (isUpdateWaiting()) { toast('Installing the new version…'); maybeApply(); }
      else toast('You have the latest version.');
    }, 3000);
  };
  root.querySelector('#reset').onclick = () => {
    if (confirm('This clears the app’s saved files and reloads it. Uploads waiting offline are kept. Continue?')) hardReset();
  };
}
