// Loads the real renderer in jsdom with a stubbed window.api and drives the end-of-day flow,
// multi-variety truck unloading, VCF grid, CSV import/export, and dual-broker (Keval/Chetan) 60/40 billing.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..', 'renderer');
const opened = [];
const exportedFiles = [];
let nextOpenFile = null;
let saved = null;

(async () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(!/style="/.test(html + fs.readFileSync(path.join(root, 'app.js'), 'utf8')), 'no inline style attributes (blocked by CSP)');
  const dom = new JSDOM(html.replace(/<script[^>]*><\/script>/g, ''), { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.api = {
    load: async () => null,
    save: async (db) => { saved = JSON.parse(JSON.stringify(db)); return true; },
    openWhatsApp: async (u) => { opened.push(u); return true; },
    savePdf: async () => 'x.pdf',
    saveFile: async (content, name) => { exportedFiles.push({ name, content }); return name; },
    openFile: async () => nextOpenFile,
    openBackups: async () => '',
  };
  w.confirm = () => true;
  w.eval(fs.readFileSync(path.join(root, 'logic.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
  const tick = () => new Promise((r) => setTimeout(r, 200));
  await tick();
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => Array.from(w.document.querySelectorAll(s));
  const click = (s) => $(s).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const change = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const submit = (s) => $(s).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));

  // Every screen renders.
  ['parties', 'bills', 'settings', 'today'].forEach((t) => { click('[data-tab="' + t + '"]'); assert.ok($('#view').textContent.length > 20, t); });

  // Sample data -> bill shows Rs 7,495 and 60/40 partner distribution.
  click('[data-tab="settings"]');
  click('[data-act="load-sample"]');
  await tick();
  assert.ok($('.paper tfoot').textContent.includes('7,495'), 'bill total on screen');
  assert.ok($('.dist-panel').textContent.includes('60% share') && $('.dist-panel').textContent.includes('40% share'), '60/40 distribution shown');

  // Switching Bill account to Chetan Brokers updates the bill header.
  change($('#bill-broker'), 'chetan');
  assert.ok($('.paper .firm').textContent.includes('CHETAN BROKERS'), 'bill switches to Chetan Brokers');

  const db = w.__app.db;
  assert.strictEqual(db.deals.length, 13);
  const [vr, ganesh, balaji] = db.parties;
  ganesh.phone = '98765 43210';
  balaji.phone = '91234 56789';

  // Go to the day of the last sample deal.
  click('[data-tab="today"]');
  change($('#day'), '2024-11-18');
  assert.strictEqual($$('.msg').length, 2, 'two parties in queue');

  // Add a truck: G20 and Jini at two prices, bags not known yet.
  change($('#deal-form [name=seller]'), vr.id);
  change($('#deal-form [name=buyer]'), balaji.id);
  $('#deal-form [name=qty]').value = '1';
  change($('#deal-form [name=qtyUnit]'), 'truck');
  click('[data-act="add-variety"][data-v="G20"]');
  click('[data-act="add-variety"][data-v="Jini"]');
  const rows = $$('#deal-form .line');
  rows[0].querySelector('[name=rate]').value = '24000';
  rows[1].querySelector('[name=rate]').value = '23500';
  submit('#deal-form');
  assert.strictEqual(db.deals.length, 14);
  const truck = db.deals[13];

  // After unloading: G20 200 + Jini 150.
  const unload = $('.unload');
  unload.elements.b0.value = '200';
  unload.elements.b0.dispatchEvent(new w.Event('input', { bubbles: true }));
  unload.elements.b1.value = '150';
  unload.elements.b1.dispatchEvent(new w.Event('input', { bubbles: true }));
  submit('.unload');
  assert.strictEqual(w.Logic.dealBags(truck), 350);

  // ---- VCF Contact Import -> Editable Grid (with Broker Account) -> Save ----
  click('[data-tab="parties"]');
  nextOpenFile = {
    name: 'contacts.vcf',
    content: [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Jayeshbhai Broker',
      'TEL;TYPE=CELL:+91 98251 99999',
      'END:VCARD',
    ].join('\r\n'),
  };
  click('[data-act="import-vcf"]');
  await tick();
  const gridRows = $$('#vcf-grid tbody tr');
  assert.strictEqual(gridRows.length, 1);
  gridRows[0].querySelector('[name=city]').value = 'Jetpur';
  gridRows[0].querySelector('[name=role]').value = 'seller';
  gridRows[0].querySelector('[name=brokerId]').value = 'chetan';
  gridRows[0].querySelector('[name=charge]').value = '1';
  gridRows[0].querySelector('[name=perBag]').value = '2';
  click('[data-act="vcf-import"]');
  assert.strictEqual(db.parties.length, 4);
  assert.strictEqual(db.parties[3].brokerId, 'chetan');

  // ---- Export & Import Deals CSV ----
  click('[data-act="export-deals-csv"]');
  await tick();
  assert.strictEqual(exportedFiles.length, 1);

  // Settings: both Keval Brokers and Chetan Brokers sections exist and save.
  click('[data-tab="settings"]');
  assert.ok($('#settings-form [name=b_keval_firm]') && $('#settings-form [name=b_chetan_firm]'));
  submit('#settings-form');

  await tick();
  assert.strictEqual(saved.deals.length, 14, 'persisted');
  console.log('smoke test passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });