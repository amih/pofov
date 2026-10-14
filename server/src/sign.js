import QRCode from 'qrcode';
import { config } from './config.js';
import { escapeHtml } from './util.js';
import { locationByCode } from './locations.js';

// Printable A5 sign for a library: what POFOV is + a QR code to this location.
export default async function signRoutes(app) {
  app.get('/api/locations/:code/sign', async (req, reply) => {
    const loc = await locationByCode(req.params.code);
    if (!loc || loc.status !== 'approved') return reply.code(404).send('Not found');
    const url = `${config.baseUrl}/l/${loc.code}`;
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>POFOV sign ${loc.code}</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #2b2118; }
  .sheet { width: 124mm; min-height: 180mm; margin: 0 auto; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4mm; }
  .logo { width: 30mm; }
  h1 { font-size: 22pt; margin: 0; letter-spacing: .04em; }
  .tag { font-size: 11pt; margin: 0; color: #7a5232; }
  .qr { width: 62mm; height: 62mm; }
  .qr svg { width: 100%; height: 100%; }
  p { font-size: 11pt; line-height: 1.4; margin: 0; }
  .code { font: 600 14pt ui-monospace, monospace; letter-spacing: .15em; }
  ol { text-align: left; font-size: 11pt; line-height: 1.5; margin: 0; padding-left: 6mm; }
  .print { margin: 8mm auto; display: block; font-size: 14pt; padding: 3mm 8mm; }
  @media print { .print { display: none; } }
</style></head><body>
<div class="sheet">
  <img class="logo" src="/icons/icon-192.png" alt="">
  <h1>POFOV</h1>
  <p class="tag">Pass On, Find Other Volumes</p>
  <p><strong>This is a free book exchange.</strong> Take a book, leave a book.</p>
  <div class="qr">${qr}</div>
  <p class="code">pofov.com/l/${escapeHtml(loc.code)}</p>
  <ol>
    <li>Scan the code to see which books are here now.</li>
    <li>Took a book or left one? Scan its barcode so others know.</li>
    <li>Know another free library? Add it to the map.</li>
  </ol>
  ${loc.name ? `<p><em>${escapeHtml(loc.name)}</em></p>` : ''}
</div>
<button class="print" onclick="print()">Print</button>
</body></html>`);
  });
}
