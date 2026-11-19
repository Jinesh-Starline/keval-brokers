(() => {
  const L = window.Logic;
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let db;
  let tab = 'today';
  let day = L.todayISO();
  let draft = newDraft();
  let billSel = { partyId: '', brokerId: '', from: '', to: '' };
  let editingParty = null; // party id, 'new' or null
  let vcfRows = null; // array of parsed contacts waiting in the VCF review grid, or null
  let bagsEdit = null; // id of a counted deal whose bags are being corrected
  let editingId = null; // deal being edited in the form
  let savedDraft = null; // the half-typed new deal, put back when editing ends
  const edits = {}; // hand-edited message text, key = day|partyId

  function newDraft() {
    return { seller: '', buyer: '', commodity: 'groundnut', qty: '', qtyUnit: 'bags', extra: '', note: '', lines: [{ variety: '', rate: '' }] };
  }

  // ---------- data ----------
  function emptyDb() {
    return { version: 2, settings: JSON.parse(JSON.stringify(L.DEFAULT_SETTINGS)), parties: [], deals: [], sent: {} };
  }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api.save(db), 150);
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 3500);
  }
  /* In-app confirm. The built-in confirm() popup can leave text boxes unresponsive in Electron on Windows. */
  function askConfirm(message, okLabel) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true"><p></p><div class="modal-actions"><button class="btn" data-m="no">Cancel</button><button class="btn primary" data-m="yes"></button></div></div>';
      wrap.querySelector('p').textContent = message;
      wrap.querySelector('[data-m=yes]').textContent = okLabel || 'OK';
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
        if (prev && prev.focus && document.contains(prev)) prev.focus();
        resolve(v);
      }
      wrap.addEventListener('click', (e) => {
        const m = e.target.dataset && e.target.dataset.m;
        if (m) done(m === 'yes');
        else if (e.target === wrap) done(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      wrap.querySelector('[data-m=yes]').focus();
    });
  }
  function stopEditing() {
    editingId = null;
    if (savedDraft) { draft = savedDraft; savedDraft = null; }
  }
  const draftFromDeal = (d) => ({
    date: d.date, seller: d.seller, buyer: d.buyer, commodity: d.commodity, qty: String(d.qty), qtyUnit: d.qtyUnit,
    extra: d.extra || '', note: d.note || '', lines: d.lines.map((l) => ({ variety: l.variety, rate: String(l.rate) })),
  });
  const party = (id) => db.parties.find((p) => p.id === id);
  const units = () => L.unitsOf(db.settings);
  const brokers = () => L.brokersOf(db.settings);
  const brokerOptions = (selected) =>
    brokers().map((b) => `<option value="${b.id}"${b.id === selected ? ' selected' : ''}>${esc(b.firm)}</option>`).join('');
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  const avatar = (name) => `<span class="avatar av${Math.abs(hash(name || '')) % 6}">${esc((name || '?').trim().charAt(0).toUpperCase())}</span>`;
  const partyOptions = (selected) =>
    '<option value="">Select party</option>' +
    db.parties.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(p.name)}${p.city ? ' (' + esc(p.city) + ')' : ''}</option>`).join('');
  const unitOptions = (sel) => units().map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.en)}</option>`).join('');

  // ---------- today ----------
  const dayDeals = () => db.deals.filter((d) => d.date === day).sort((a, b) => a.createdAt - b.createdAt);
  const pendingDeals = () => db.deals.filter(L.isPending).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  const messageKey = (pid) => day + '|' + pid;
  function messageFor(pid) {
    const edited = edits[messageKey(pid)];
    if (edited != null) return edited;
    const p = party(pid);
    const b = L.brokerById(db.settings, p && p.brokerId);
    return L.buildMessage({
      party: p, date: day, parties: db.parties, broker: b, lang: db.settings.lang,
      units: units(), deals: L.dealsForParty(dayDeals(), pid),
    });
  }
  function involvedParties() {
    const ids = [];
    dayDeals().forEach((d) => [d.seller, d.buyer].forEach((id) => { if (id && !ids.includes(id)) ids.push(id); }));
    return ids.map(party).filter(Boolean);
  }
  const isSent = (pid) => { const s = db.sent[messageKey(pid)]; return !!s && s.hash === hash(messageFor(pid)); };

  function ratesHtml(d) {
    return `<div class="rates">${d.lines.map((l) => `<span class="rate">${l.variety ? '<i>' + esc(l.variety) + '</i>' : ''}₹${L.fmtNum(l.rate)}</span>`).join('')}${d.extra ? `<span class="rate"><small>extra ${esc(d.extra)}</small></span>` : ''}</div>`;
  }
  function bagsHtml(d) {
    const b = L.dealBags(d);
    if (b == null) return '<span class="tag wait">Awaiting unload</span>';
    const split = L.hasSplit(d) ? `<div class="split">${d.lines.map((l) => esc(l.variety) + ' ' + l.bags).join(', ')}</div>` : '';
    return `${b}${split}`;
  }

  function dealFormHtml() {
    const vs = L.varietiesFor(draft.commodity, db.deals);
    const bagsUnit = draft.qtyUnit === 'bags';
    return `<form id="deal-form" autocomplete="off">
      ${editingId ? `<div class="grid3 field-group-top"><label>Date<input type="date" name="date" value="${esc(draft.date)}" /></label></div>` : ''}
      <div class="grid3">
        <label>Seller<select name="seller">${partyOptions(draft.seller)}</select></label>
        <label>Buyer<select name="buyer">${partyOptions(draft.buyer)}</select></label>
        <label>Commodity<select name="commodity">${L.COMMODITIES.map((c) => `<option value="${c.id}"${c.id === draft.commodity ? ' selected' : ''}>${c.en}</option>`).join('')}</select></label>
      </div>
      <div class="field-group">
        <span class="lbl">Quantity</span>
        <div class="qty-row">
          <input name="qty" type="number" min="1" step="1" placeholder="1" value="${esc(draft.qty)}" />
          <select name="qtyUnit">${unitOptions(draft.qtyUnit)}</select>
        </div>
        ${bagsUnit ? '' : '<div class="hint">Bags are added after unloading. The deal waits in the list on the right.</div>'}
      </div>
      <div class="field-group">
        <span class="lbl">Rate${draft.lines.length > 1 ? 's, one per variety' : ''}</span>
        ${draft.lines.map((l, i) => `<div class="line">
          <input name="variety" list="varieties" placeholder="Variety (optional)" value="${esc(l.variety)}" />
          <input name="rate" type="number" min="0" step="any" placeholder="Rate" value="${esc(l.rate)}" />
          ${draft.lines.length > 1 ? `<button type="button" class="icon-btn" data-act="rm-line" data-i="${i}" title="Remove this rate" aria-label="Remove this rate">&times;</button>` : '<span></span>'}
        </div>`).join('')}
        <datalist id="varieties">${vs.map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>
        <div class="chips">
          ${vs.map((v) => `<button type="button" class="chip-btn" data-act="add-variety" data-v="${esc(v)}">${esc(v)}</button>`).join('')}
          <button type="button" class="link-btn" data-act="add-line">Add another rate</button>
        </div>
      </div>
      <div class="grid2 field-group">
        <label>Extra on rate<input name="extra" placeholder="e.g. 500" value="${esc(draft.extra)}" /></label>
        <label>Note for the message<input name="note" placeholder="Payment, delivery" value="${esc(draft.note)}" /></label>
      </div>
      <div class="form-foot">
        <span class="muted">${editingId ? 'Changing the quantity or its type clears the bags counted after unloading.' : db.parties.length < 2 ? 'Add two parties first in Parties, or load the sample data in Settings.' : 'Seller, buyer and commodity stay selected for the next deal.'}</span>
        <span class="btns">${editingId ? '<button class="btn" type="button" data-act="cancel-edit">Cancel</button> ' : ''}<button class="btn primary" type="submit">${editingId ? 'Save changes' : 'Add deal'}</button></span>
      </div>
    </form>`;
  }
  const formPanelHtml = () => `<h2>${editingId ? 'Edit deal' : 'New deal'}</h2>${dealFormHtml()}`;

  function waitingHtml() {
    const list = pendingDeals();
    const editing = bagsEdit && !list.some((d) => d.id === bagsEdit) ? db.deals.find((d) => d.id === bagsEdit) : null;
    const items = (editing ? [editing] : []).concat(list);
    if (!items.length) return '<div class="empty">Nothing waiting. Deals counted in trucks or vans show up here until you enter the bags.</div>';
    return items.map((d) => {
      const multi = d.lines.length > 1;
      const cur = L.dealBags(d);
      return `<form class="wait-item unload" data-id="${d.id}">
        <div class="who">${esc((party(d.seller) || {}).name)} to ${esc((party(d.buyer) || {}).name)}</div>
        <div class="meta">${L.fmtDate(d.date)}, ${L.commodityName(d.commodity, 'en')}, ${esc(L.qtyText(d, units(), 'en'))}</div>
        <div class="inputs">
          ${multi ? d.lines.map((l, i) => `<label>${esc(l.variety || 'Variety ' + (i + 1))} bags<input name="b${i}" data-split type="number" min="0" step="1" value="${l.bags != null ? l.bags : ''}" /></label>`).join('') : ''}
          <label class="total">Total bags<input name="total" type="number" min="1" step="1" value="${cur != null ? cur : ''}" /></label>
          <button class="btn primary sm" type="submit">Save bags</button>
        </div>
      </form>`;
    }).join('');
  }

  function dealsTableHtml(deals) {
    if (!deals.length) return '<div class="none">No deals on this day yet. Add the first one above.</div>';
    return `<table><thead><tr><th>#</th><th>Seller and buyer</th><th>Commodity</th><th>Quantity</th><th>Rate</th><th class="num">Bags</th><th></th></tr></thead><tbody>
      ${deals.map((d, i) => `<tr class="${d.id === editingId ? 'editing' : ''}">
        <td>${i + 1}</td>
        <td><div class="pair"><strong>${esc((party(d.seller) || {}).name)}</strong><div class="to">to ${esc((party(d.buyer) || {}).name)}</div></div></td>
        <td><span class="tag ${d.commodity}">${L.commodityName(d.commodity, 'en')}</span></td>
        <td>${esc(L.qtyText(d, units(), 'en'))}</td>
        <td>${ratesHtml(d)}</td>
        <td class="num">${bagsHtml(d)}</td>
        <td><div class="row-actions"><button class="btn sm" data-act="edit-deal" data-id="${d.id}">Edit</button>${d.qtyUnit !== 'bags' || d.lines.length > 1 ? `<button class="btn sm" data-act="edit-bags" data-id="${d.id}">Bags</button>` : ''}<button class="btn sm danger" data-act="del-deal" data-id="${d.id}">Delete</button></div></td>
      </tr>`).join('')}
    </tbody></table>`;
  }

  function renderToday() {
    const deals = dayDeals();
    const counted = deals.filter((d) => !L.isPending(d));
    const bags = counted.reduce((s, d) => s + L.dealBags(d), 0);
    const earned = deals.reduce((s, d) => s + L.dealBrokerage(d, db.parties), 0);
    const waiting = pendingDeals().length;
    const ps = involvedParties();
    $('#view').innerHTML = `<div class="page">
      <div class="page-head">
        <div><h1>${L.fmtDateLong(day)}</h1><p class="sub">Enter the day's deals, then send each party its message.</p></div>
        <div class="date-ctl">
          <button class="btn" data-act="prev-day" aria-label="Previous day">&larr;</button>
          <input type="date" id="day" value="${day}" aria-label="Date" />
          <button class="btn" data-act="next-day" aria-label="Next day">&rarr;</button>
          <button class="btn" data-act="today">Today</button>
        </div>
      </div>
      <div class="strip">
        <div><b>${deals.length}</b><span>Deals</span></div>
        <div><b>${L.fmtNum(bags)}</b><span>Bags counted</span></div>
        <div class="${waiting ? 'alert' : ''}"><b>${waiting}</b><span>Awaiting unload, all days</span></div>
        <div><b>${ps.filter((p) => isSent(p.id)).length}/${ps.length}</b><span>Messages sent</span></div>
        <div><b>₹${L.fmtNum(earned)}</b><span>Brokerage</span></div>
      </div>
      <div class="cols">
        <section class="panel${editingId ? ' editing' : ''}" id="deal-panel">${formPanelHtml()}</section>
        <section class="panel wait"><h2>Awaiting unload</h2><p class="help">When the truck is unloaded, enter the bags here. For two varieties, enter each one and the total fills in.</p>${waitingHtml()}</section>
      </div>
      <section class="ledger">
        <div class="ledger-head">
          <h2>Deals</h2>
          <div class="btns">
            <span class="muted">${deals.length ? deals.length + (deals.length === 1 ? ' deal' : ' deals') : ''}</span>
            <button class="btn sm" data-act="import-deals-csv">Import CSV</button>
            <button class="btn sm" data-act="export-deals-csv" ${db.deals.length ? '' : 'disabled'}>Export All CSV</button>
          </div>
        </div>
        ${dealsTableHtml(deals)}
      </section>
      <div id="queue"></div>
    </div>`;
    renderQueue();
  }

  function autosize(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; }
  function renderQueue() {
    renderQueueHtml();
    $$('.bubble textarea').forEach(autosize);
  }
  function renderQueueHtml() {
    const q = $('#queue');
    if (!q) return;
    const ps = involvedParties();
    if (!ps.length) { q.innerHTML = ''; return; }
    q.innerHTML = `
      <div class="wa-head">
        <div><h2>WhatsApp messages</h2><p class="help">One message for each party. Check it, press Send, and WhatsApp opens with the text ready. Send it there. After unloading, a changed message can be sent again as an update.</p></div>
        <button class="btn primary" data-act="send-next">Send next unsent</button>
      </div>
      <div class="msg-grid">${ps.map((p) => {
        const text = messageFor(p.id);
        const s = db.sent[messageKey(p.id)];
        const state = !s ? '<span class="state-pill">Not sent</span>' : s.hash === hash(text) ? '<span class="state-pill sent">Sent</span>' : '<span class="state-pill changed">Changed since sent</span>';
        const phone = L.normalizePhone(p.phone);
        return `<div class="msg">
          <div class="msg-top">${avatar(p.name)}<div><div class="name">${esc(p.name)}</div>${phone ? `<div class="ph">+${phone}</div>` : '<div class="ph miss">No WhatsApp number. Add it in Parties.</div>'}</div><div class="state">${state}</div></div>
          <div class="chat"><div class="bubble"><textarea data-pid="${p.id}" aria-label="Message to ${esc(p.name)}">${esc(text)}</textarea></div></div>
          <div class="msg-actions">
            <button class="btn primary" data-act="send" data-pid="${p.id}" ${phone ? '' : 'disabled'}>${s && s.hash !== hash(text) ? 'Send update' : 'Send on WhatsApp'}</button>
            <button class="btn" data-act="copy" data-pid="${p.id}">Copy</button>
            <button class="btn" data-act="reset-msg" data-pid="${p.id}">Reset text</button>
          </div></div>`;
      }).join('')}</div>`;
  }

  function syncDraft() {
    const f = $('#deal-form');
    if (!f) return;
    const e = f.elements;
    if (e.date) draft.date = e.date.value;
    Object.assign(draft, { seller: e.seller.value, buyer: e.buyer.value, commodity: e.commodity.value, qty: e.qty.value, qtyUnit: e.qtyUnit.value, extra: e.extra.value, note: e.note.value });
    draft.lines = $$('.line', f).map((r) => ({ variety: $('[name=variety]', r).value, rate: $('[name=rate]', r).value }));
  }
  function redrawForm() {
    const p = $('#deal-panel');
    if (p) p.innerHTML = formPanelHtml();
  }

  function onAddDeal() {
    syncDraft();
    const d = draft;
    const lines = d.lines.filter((l) => String(l.rate).trim() !== '');
    if (!d.seller || !d.buyer) return toast('Choose a seller and a buyer.');
    if (d.seller === d.buyer) return toast('Seller and buyer must be different parties.');
    if (!(Number(d.qty) > 0)) return toast('Enter the quantity, for example 1 truck or 350 bags.');
    if (!lines.length) return toast('Enter a rate.');
    if (lines.length > 1 && lines.some((l) => !l.variety.trim())) return toast('Name the variety for each rate, for example G20 and Jini.');
    if (editingId) {
      const deal = db.deals.find((x) => x.id === editingId);
      if (!deal) { stopEditing(); return renderToday(); }
      if (!d.date) return toast('Choose the date of the deal.');
      const sameQty = Number(deal.qty) === Number(d.qty) && deal.qtyUnit === d.qtyUnit;
      const old = deal.lines;
      const newLines = lines.map((l) => {
        const nl = { variety: l.variety.trim(), rate: Number(l.rate) };
        const o = sameQty && old.find((x) => x.variety.trim().toLowerCase() === nl.variety.toLowerCase());
        if (o && o.bags != null) nl.bags = o.bags;
        return nl;
      });
      Object.assign(deal, {
        date: d.date, seller: d.seller, buyer: d.buyer, commodity: d.commodity, qty: Number(d.qty), qtyUnit: d.qtyUnit,
        lines: newLines, extra: d.extra.trim(), note: d.note.trim(), actualBags: sameQty ? deal.actualBags : null,
      });
      day = deal.date;
      stopEditing();
      save();
      renderToday();
      return toast('Deal updated. Messages with this deal show the change, so they can be sent again.');
    }
    db.deals.push({
      id: L.newId(), date: day, seller: d.seller, buyer: d.buyer, commodity: d.commodity,
      qty: Number(d.qty), qtyUnit: d.qtyUnit, lines: lines.map((l) => ({ variety: l.variety.trim(), rate: Number(l.rate) })),
      extra: d.extra.trim(), note: d.note.trim(), actualBags: null, createdAt: Date.now(),
    });
    draft = Object.assign(newDraft(), { seller: d.seller, buyer: d.buyer, commodity: d.commodity, qtyUnit: d.qtyUnit, lines: d.lines.map((l) => ({ variety: l.variety, rate: '' })) });
    save();
    renderToday();
    const q = $('#deal-form [name=qty]');
    if (q) q.focus();
  }

  function onSaveBags(form) {
    const deal = db.deals.find((x) => x.id === form.dataset.id);
    const val = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    const splits = deal.lines.map((_, i) => val('b' + i));
    const filled = splits.filter((v) => v !== '').length;
    if (filled && filled < splits.length) return toast('Enter the bags for every variety, or leave them all empty and enter only the total.');
    if (filled) {
      deal.lines.forEach((l, i) => (l.bags = Number(splits[i])));
      deal.actualBags = deal.lines.reduce((s, l) => s + l.bags, 0);
    } else {
      if (!(Number(val('total')) > 0)) return toast('Enter the total bags.');
      deal.lines.forEach((l) => delete l.bags);
      deal.actualBags = Number(val('total'));
    }
    bagsEdit = null;
    save();
    renderToday();
    toast('Bags saved. Messages with this deal now show the final count.');
  }

  async function sendTo(pid) {
    const p = party(pid);
    const phone = L.normalizePhone(p.phone);
    if (!phone) return toast('Add a WhatsApp number for ' + p.name + ' in Parties.');
    const text = messageFor(pid);
    const ok = await api.openWhatsApp(L.waLink(phone, text));
    if (!ok) return toast('WhatsApp could not be opened.');
    db.sent[messageKey(pid)] = { at: Date.now(), hash: hash(text) };
    save();
    renderQueue();
    $('.strip > div:nth-child(4) b').textContent = involvedParties().filter((x) => isSent(x.id)).length + '/' + involvedParties().length;
  }

  // ---------- parties & VCF review grid ----------
  function syncVcfGrid() {
    if (!vcfRows) return;
    $$('#vcf-grid tbody tr').forEach((tr, i) => {
      if (!vcfRows[i]) return;
      vcfRows[i].selected = $('[name=sel]', tr).checked;
      vcfRows[i].name = $('[name=name]', tr).value;
      vcfRows[i].phone = $('[name=phone]', tr).value;
      vcfRows[i].city = $('[name=city]', tr).value;
      vcfRows[i].role = $('[name=role]', tr).value;
      vcfRows[i].brokerId = $('[name=brokerId]', tr).value;
      vcfRows[i].charge = $('[name=charge]', tr).value === '1';
      vcfRows[i].perBag = Number($('[name=perBag]', tr).value);
      vcfRows[i].roundStep = Number($('[name=roundStep]', tr).value);
    });
  }

  function vcfGridHtml() {
    if (!vcfRows) return '';
    const existingPhones = new Set(db.parties.map((x) => L.normalizePhone(x.phone)).filter(Boolean));
    const existingNames = new Set(db.parties.map((x) => x.name.trim().toLowerCase()));
    const selCount = vcfRows.filter((r) => r.selected).length;
    return `<section class="panel vcf-panel">
      <div class="vcf-head">
        <div>
          <h2>Review contacts from VCF (${selCount} of ${vcfRows.length} selected)</h2>
          <p class="help">Edit Name, City, Role, Broker Account, and Brokerage details in the grid below before importing.</p>
        </div>
        <div class="btns">
          <button class="btn sm" type="button" data-act="vcf-all">Select all</button>
          <button class="btn sm" type="button" data-act="vcf-none">Deselect all</button>
          <button class="btn" type="button" data-act="vcf-cancel">Cancel</button>
          <button class="btn primary" type="button" data-act="vcf-import" ${selCount ? '' : 'disabled'}>Import selected (${selCount})</button>
        </div>
      </div>
      <div class="grid-scroll">
        <table id="vcf-grid" class="vcf-table">
          <thead><tr>
            <th><input type="checkbox" data-act="vcf-toggle-all" ${selCount === vcfRows.length ? 'checked' : ''} aria-label="Toggle all" /></th>
            <th>Party Name</th>
            <th>WhatsApp Number</th>
            <th>City</th>
            <th>Role</th>
            <th>Broker Account</th>
            <th>Pays Brokerage</th>
            <th>₹ / Bag</th>
            <th>Round Step</th>
          </tr></thead>
          <tbody>
            ${vcfRows.map((r, i) => {
              const dup = (r.phone && existingPhones.has(L.normalizePhone(r.phone))) || (r.name && existingNames.has(r.name.trim().toLowerCase()));
              return `<tr class="${r.selected ? '' : 'row-dim'}" data-idx="${i}">
                <td><input type="checkbox" name="sel" ${r.selected ? 'checked' : ''} /></td>
                <td><input name="name" value="${esc(r.name)}" placeholder="Party name" />${dup ? '<div class="hint">Already in Parties</div>' : ''}</td>
                <td><input name="phone" value="${esc(r.phone)}" placeholder="10 digit mobile" /></td>
                <td><input name="city" value="${esc(r.city)}" placeholder="City" /></td>
                <td><select name="role">
                  <option value="seller"${r.role === 'seller' ? ' selected' : ''}>Seller</option>
                  <option value="buyer"${r.role === 'buyer' ? ' selected' : ''}>Buyer</option>
                  <option value="both"${r.role === 'both' ? ' selected' : ''}>Both</option>
                </select></td>
                <td><select name="brokerId">${brokerOptions(r.brokerId || 'keval')}</select></td>
                <td><select name="charge">
                  <option value="1"${r.charge ? ' selected' : ''}>Yes</option>
                  <option value="0"${r.charge ? '' : ' selected'}>No</option>
                </select></td>
                <td><input name="perBag" type="number" step="any" min="0" value="${r.perBag}" /></td>
                <td><input name="roundStep" type="number" step="any" min="0" value="${r.roundStep}" /></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  function onImportVcfRows() {
    syncVcfGrid();
    const chosen = (vcfRows || []).filter((r) => r.selected);
    if (!chosen.length) return toast('Select at least one contact to import.');
    let added = 0;
    for (const r of chosen) {
      const name = r.name.trim();
      if (!name) return toast('Every selected row needs a party name.');
      if (r.phone.trim() && !L.normalizePhone(r.phone)) {
        return toast('Invalid WhatsApp number for "' + name + '". Use a 10 digit mobile number or clear it.');
      }
      db.parties.push({
        id: L.newId(),
        name,
        city: r.city.trim(),
        phone: r.phone.trim() ? L.shortPhone(r.phone) : '',
        role: r.role,
        brokerId: r.brokerId || 'keval',
        charge: !!r.charge,
        rule: {
          perBag: isFinite(r.perBag) && r.perBag >= 0 ? r.perBag : L.DEFAULT_RULE.perBag,
          roundStep: isFinite(r.roundStep) && r.roundStep >= 0 ? r.roundStep : L.DEFAULT_RULE.roundStep,
        },
      });
      added++;
    }
    vcfRows = null;
    save();
    renderParties();
    toast(added + (added === 1 ? ' party' : ' parties') + ' imported from VCF.');
  }

  function renderParties() {
    const p = editingParty === 'new' ? { id: '', name: '', city: '', phone: '', role: 'buyer', brokerId: 'keval', charge: false, rule: { perBag: 1.5, roundStep: 5 } } : party(editingParty);
    $('#view').innerHTML = `<div class="page stack">
      <div class="page-head">
        <div><h1>Parties</h1><p class="sub">Sellers and buyers, with their WhatsApp number, broker account, and brokerage rate.</p></div>
        <div class="btns">
          <button class="btn" data-act="import-vcf">Import Contacts (.vcf)</button>
          <button class="btn" data-act="import-parties-csv">Import CSV</button>
          <button class="btn" data-act="export-parties-csv" ${db.parties.length ? '' : 'disabled'}>Export CSV</button>
          ${p ? '' : '<button class="btn primary" data-act="new-party">Add party</button>'}
        </div>
      </div>
      ${vcfGridHtml()}
      ${p ? `<section class="panel"><h2>${p.id ? 'Edit party' : 'New party'}</h2>
        <form id="party-form" autocomplete="off">
          <div class="grid3">
            <label>Name<input name="name" required value="${esc(p.name)}" /></label>
            <label>City<input name="city" value="${esc(p.city)}" /></label>
            <label>WhatsApp number<input name="phone" value="${esc(p.phone)}" placeholder="10 digit mobile" /></label>
            <label>Usually a<select name="role"><option value="seller"${p.role === 'seller' ? ' selected' : ''}>Seller</option><option value="buyer"${p.role === 'buyer' ? ' selected' : ''}>Buyer</option><option value="both"${p.role === 'both' ? ' selected' : ''}>Seller and buyer</option></select></label>
            <label>Broker account<select name="brokerId">${brokerOptions(p.brokerId || 'keval')}</select></label>
            <label>Pays brokerage<select name="charge"><option value="1"${p.charge ? ' selected' : ''}>Yes</option><option value="0"${p.charge ? '' : ' selected'}>No</option></select></label>
            <label>Rupees per bag<input name="perBag" type="number" step="any" min="0" value="${p.rule.perBag}" /></label>
            <label>Round down to nearest rupees<input name="roundStep" type="number" step="any" min="0" value="${p.rule.roundStep}" /></label>
          </div>
          <div class="form-foot"><span class="muted">325 bags at 1.5, rounded down to 5, is billed as 485.</span>
            <span><button class="btn" type="button" data-act="cancel-party">Cancel</button> <button class="btn primary" type="submit">Save party</button></span></div>
        </form></section>` : ''}
      <section class="list">${db.parties.length ? `<table><thead><tr><th>Party</th><th>WhatsApp</th><th>Role</th><th>Account</th><th>Brokerage</th><th></th></tr></thead><tbody>
        ${db.parties.slice().sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<tr>
          <td><div class="cell-name">${avatar(x.name)}<div><strong>${esc(x.name)}</strong><div class="muted">${esc(x.city)}</div></div></div></td>
          <td>${x.phone ? esc(x.phone) : '<span class="muted">Not added</span>'}</td>
          <td>${x.role === 'both' ? 'Seller and buyer' : x.role === 'seller' ? 'Seller' : 'Buyer'}</td>
          <td><span class="tag">${esc(L.brokerById(db.settings, x.brokerId).firm)}</span></td>
          <td>${x.charge ? '₹' + x.rule.perBag + ' per bag, rounded down to ' + x.rule.roundStep : '<span class="muted">Not charged</span>'}</td>
          <td><div class="row-actions"><button class="btn sm" data-act="edit-party" data-id="${x.id}">Edit</button><button class="btn sm danger" data-act="del-party" data-id="${x.id}">Delete</button></div></td></tr>`).join('')}
      </tbody></table>` : '<div class="none">No parties yet. Add one, import from a phone VCF file, or load sample data in Settings.</div>'}</section>
    </div>`;
  }
  function onSaveParty(form) {
    const f = form.elements;
    if (f.phone.value.trim() && !L.normalizePhone(f.phone.value)) return toast('That WhatsApp number is not valid. Use the 10 digit mobile number.');
    const data = {
      name: f.name.value.trim(), city: f.city.value.trim(), phone: f.phone.value.trim(), role: f.role.value,
      brokerId: f.brokerId.value || 'keval',
      charge: f.charge.value === '1', rule: { perBag: Number(f.perBag.value), roundStep: Number(f.roundStep.value) },
    };
    if (editingParty === 'new') db.parties.push(Object.assign({ id: L.newId() }, data));
    else Object.assign(party(editingParty), data);
    editingParty = null;
    save();
    renderParties();
  }

  // ---------- bills ----------
  function billBody(p, b, calc, from) {
    return `<div class="hdr"><div>${esc(b.name)}<br>MOB.: ${esc(b.mobile)}<br>${esc(b.address)}</div>
      <div>BANK : ${esc(b.bank)}<br>SB A/C: ${esc(b.account)}<br>IFSC CODE: ${esc(b.ifsc)}<br>PAN NO.: ${esc(b.pan)}</div></div>
      <div class="firm">${esc(b.firm)}</div>
      <div class="party">${esc(p.name.toUpperCase())}${p.city ? '. ' + esc(p.city.toUpperCase()) : ''}.</div>
      <div class="title">BROKERAGE BILL ${L.fyRange(from).label}</div>
      <table><thead><tr><th>DATE</th><th>PARTY NAME</th><th>CITY</th><th>BAG</th><th>RATE</th><th>RS.</th></tr></thead>
      <tbody>${calc.rows.map((r) => `<tr><td>${L.fmtDate(r.date)}</td><td>${esc(r.party)}</td><td>${esc(r.city)}</td><td class="c">${r.bags}</td><td class="c">${esc(r.rate)}/-</td><td class="r">${L.fmtNum(r.amount)}/-</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3" class="c">TOTAL</td><td class="c">${calc.bags}</td><td></td><td class="r">${L.fmtNum(calc.total)}/-</td></tr></tfoot></table>`;
  }
  const PAPER_CSS = `body{margin:28px;font-family:Arial,"Nirmala UI",sans-serif;font-size:12px;color:#000}
    .hdr{display:flex;justify-content:space-between;font-weight:700;line-height:1.7}.hdr div:last-child{text-align:right}
    .firm{text-align:center;font:800 42px/1.1 Arial,sans-serif;margin:14px 0 6px;padding-bottom:8px;border-bottom:3px solid #000}
    .party{text-align:center;font-weight:800;font-size:22px;text-decoration:underline;margin:8px 0 2px}
    .title{text-align:center;font-weight:800;font-size:16px;text-decoration:underline;margin-bottom:8px}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:5px 8px;font-weight:700}
    th,.c{text-align:center}.r{text-align:right}tfoot td{font-size:14px}`;

  function renderBills() {
    if (!billSel.partyId && db.parties.length) {
      const defParty = db.parties.find((p) => p.charge) || db.parties[0];
      billSel.partyId = defParty.id;
      billSel.brokerId = defParty.brokerId || 'keval';
    }
    if (!billSel.from) { const fy = L.fyRange(day); billSel.from = fy.from; billSel.to = fy.to; }
    const p = party(billSel.partyId);
    const activeBroker = L.brokerById(db.settings, billSel.brokerId || (p && p.brokerId));
    const calc = L.billRows(db, billSel.partyId, billSel.from, billSel.to);
    const dist = L.periodSummary(db, billSel.from, billSel.to);

    $('#view').innerHTML = `<div class="page stack">
      <div class="page-head"><div><h1>Brokerage bill</h1><p class="sub">Pick a party, broker account, and period. Yearly brokerage is split between partners below.</p></div>
        <button class="btn primary" data-act="bill-pdf" ${calc.rows.length ? '' : 'disabled'}>Save as PDF</button></div>
      <section class="panel"><div class="grid4">
        <label>Party<select id="bill-party">${partyOptions(billSel.partyId)}</select></label>
        <label>Bill account<select id="bill-broker">${brokerOptions(activeBroker.id)}</select></label>
        <label>From<input type="date" id="bill-from" value="${billSel.from}" /></label>
        <label>To<input type="date" id="bill-to" value="${billSel.to}" /></label>
      </div></section>
      <section class="panel dist-panel">
        <h2>Period brokerage distribution (${L.fyRange(billSel.from).label})</h2>
        <div class="dist-grid">
          <div class="dist-card dist-total">
            <span>Total brokerage (all parties)</span>
            <b>₹${L.fmtNum(dist.total)}</b>
            <small>${L.fmtNum(dist.bags)} bags counted${dist.pending ? ' · ' + dist.pending + ' pending' : ''}</small>
          </div>
          ${dist.byBroker.map((x) => `<div class="dist-card">
            <span>${esc(x.broker.firm)} (${x.sharePct}% share)</span>
            <b>₹${L.fmtNum(x.shareAmount)}</b>
            <small>Billed under account: ₹${L.fmtNum(x.billed)}</small>
          </div>`).join('')}
        </div>
      </section>
      ${calc.pending ? `<div class="notice">${calc.pending} ${calc.pending === 1 ? 'deal is' : 'deals are'} still awaiting unload and ${calc.pending === 1 ? 'is' : 'are'} not in this bill. Enter the bags on the Today screen.</div>` : ''}
      ${p && calc.rows.length ? `<div class="paper">${billBody(p, activeBroker, calc, billSel.from)}</div>` : '<section class="panel"><div class="empty">No counted deals for this party in this period.</div></section>'}
    </div>`;
  }

  // ---------- settings ----------
  function renderSettings() {
    const s = db.settings;
    const list = brokers();
    const bField = (bid, k, label, type) => {
      const b = L.brokerById(s, bid);
      return `<label>${label}<input name="b_${bid}_${k}" type="${type || 'text'}"${type === 'number' ? ' step="any" min="0" max="100"' : ''} value="${esc(b[k])}" /></label>`;
    };
    $('#view').innerHTML = `<div class="page stack">
      <div class="page-head"><div><h1>Settings</h1></div></div>
      <form id="settings-form" class="stack" autocomplete="off">
        <section class="panel"><h2>Messages</h2>
          <div class="grid3"><label>Language<select name="lang"><option value="gu"${s.lang === 'gu' ? ' selected' : ''}>Gujarati</option><option value="en"${s.lang === 'en' ? ' selected' : ''}>English</option></select></label></div>
          <div class="field-group"><label>Quantity types, one per line as English | ગુજરાતી
            <textarea class="plain" name="units">${esc(L.unitsToText(units()))}</textarea></label>
            <p class="help">Bags is always there. Add the vehicles you count deals in. Changing a name does not change deals already entered.</p></div>
        </section>
        ${list.map((b) => `<section class="panel">
          <h2>Bill details — ${esc(b.firm)}</h2>
          <div class="grid3">
            ${bField(b.id, 'firm', 'Firm name')}
            ${bField(b.id, 'name', 'Broker name')}
            ${bField(b.id, 'share', 'Yearly share (%)', 'number')}
            ${bField(b.id, 'mobile', 'Mobile')}
            ${bField(b.id, 'address', 'Address')}
            ${bField(b.id, 'bank', 'Bank')}
            ${bField(b.id, 'account', 'Account number')}
            ${bField(b.id, 'ifsc', 'IFSC')}
            ${bField(b.id, 'pan', 'PAN')}
          </div>
        </section>`).join('')}
        <div><button class="btn primary" type="submit">Save settings</button></div>
      </form>
      <section class="panel"><h2>Excel / CSV Backup &amp; Restore (All Years)</h2>
        <p class="help">All your deals and parties are stored permanently on this computer with daily backups (never deleted). You can also export or import Excel CSV files anytime.</p>
        <div class="chips">
          <button class="btn primary" data-act="export-deals-csv" ${db.deals.length ? '' : 'disabled'}>Export Deals CSV (${db.deals.length})</button>
          <button class="btn" data-act="import-deals-csv">Import Deals CSV</button>
          <button class="btn" data-act="export-parties-csv" ${db.parties.length ? '' : 'disabled'}>Export Parties CSV (${db.parties.length})</button>
          <button class="btn" data-act="import-parties-csv">Import Parties CSV</button>
          <button class="btn" data-act="import-vcf">Import Contacts (.vcf)</button>
        </div>
        <div class="chips field-group">
          <button class="btn" data-act="open-backups">Open backup folder</button>
          <button class="btn" data-act="load-sample">Load sample data (2024-25 bill)</button>
        </div>
      </section></div>`;
  }
  function onSaveSettings(form) {
    const f = form.elements, s = db.settings;
    s.lang = f.lang.value;
    s.qtyUnits = L.parseUnits(f.units.value, units());
    const keys = ['firm', 'name', 'mobile', 'address', 'bank', 'account', 'ifsc', 'pan'];
    s.brokers = brokers().map((b) => {
      const next = Object.assign({}, b);
      keys.forEach((k) => {
        const el = f['b_' + b.id + '_' + k];
        if (el) next[k] = el.value.trim();
      });
      const sh = f['b_' + b.id + '_share'];
      if (sh && sh.value !== '' && isFinite(Number(sh.value))) next.share = Number(sh.value);
      return next;
    });
    s.broker = Object.assign({}, s.brokers[0]);
    Object.keys(edits).forEach((k) => delete edits[k]);
    save();
    renderSettings();
    toast('Settings saved.');
  }

  // ---------- CSV & VCF file handlers ----------
  async function handleExportDealsCsv() {
    const csv = L.dealsToCsv(db);
    const saved = await api.saveFile(csv, 'Keval-Brokers-Deals-' + L.todayISO() + '.csv', [{ name: 'CSV', extensions: ['csv'] }]);
    if (saved) toast('Deals exported to CSV.');
  }
  async function handleImportDealsCsv() {
    const file = await api.openFile([{ name: 'CSV Files', extensions: ['csv'] }]);
    if (!file) return;
    const res = L.parseDealsCsv(file.content, db);
    if (!res.added && !res.createdParties) {
      return toast('No new deals imported (' + res.skipped + ' skipped or already present).');
    }
    db.parties = res.parties;
    db.deals = res.deals;
    save();
    render();
    toast('Imported ' + res.added + ' deals' + (res.createdParties ? ', added ' + res.createdParties + ' new parties' : '') + (res.skipped ? ' (' + res.skipped + ' skipped).' : '.'));
  }
  async function handleExportPartiesCsv() {
    const csv = L.partiesToCsv(db.parties, db.settings);
    const saved = await api.saveFile(csv, 'Keval-Brokers-Parties-' + L.todayISO() + '.csv', [{ name: 'CSV', extensions: ['csv'] }]);
    if (saved) toast('Parties exported to CSV.');
  }
  async function handleImportPartiesCsv() {
    const file = await api.openFile([{ name: 'CSV Files', extensions: ['csv'] }]);
    if (!file) return;
    const res = L.parsePartiesCsv(file.content, db.parties, db.settings);
    if (!res.added && !res.updated) return toast('No valid party rows found in CSV.');
    db.parties = res.parties;
    save();
    render();
    toast('Parties imported: ' + res.added + ' added, ' + res.updated + ' updated.');
  }
  async function handleImportVcf() {
    const file = await api.openFile([{ name: 'vCard Contacts', extensions: ['vcf'] }]);
    if (!file) return;
    const parsed = L.parseVcf(file.content);
    if (!parsed.length) return toast('No contacts found in that VCF file.');
    vcfRows = parsed;
    editingParty = null;
    tab = 'parties';
    render();
    toast('Loaded ' + parsed.length + ' contacts. Review and edit details in the grid, then click Import selected.');
  }

  // ---------- events ----------
  document.addEventListener('click', async (e) => {
    const nav = e.target.closest('#nav button');
    if (nav) { tab = nav.dataset.tab; editingParty = null; return render(); }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, id, pid } = el.dataset;
    switch (act) {
      case 'prev-day': day = L.shiftDay(day, -1); return render();
      case 'next-day': day = L.shiftDay(day, 1); return render();
      case 'today': day = L.todayISO(); return render();
      case 'add-line': syncDraft(); draft.lines.push({ variety: '', rate: '' }); return redrawForm();
      case 'rm-line': syncDraft(); draft.lines.splice(Number(el.dataset.i), 1); return redrawForm();
      case 'add-variety': {
        syncDraft();
        const v = el.dataset.v;
        if (draft.lines.some((l) => l.variety.trim().toLowerCase() === v.toLowerCase())) return;
        const empty = draft.lines.find((l) => !l.variety.trim());
        if (empty) empty.variety = v; else draft.lines.push({ variety: v, rate: '' });
        redrawForm();
        const rows = $$('#deal-form .line');
        const row = rows.find((r) => $('[name=variety]', r).value === v);
        if (row) $('[name=rate]', row).focus();
        return;
      }
      case 'edit-bags': bagsEdit = id; return renderToday();
      case 'edit-deal': {
        const d = db.deals.find((x) => x.id === id);
        if (!d) return;
        if (!editingId) { syncDraft(); savedDraft = draft; }
        editingId = id;
        draft = draftFromDeal(d);
        renderToday();
        $('#view').scrollTop = 0;
        const q = $('#deal-form [name=qty]');
        if (q) q.focus();
        return;
      }
      case 'cancel-edit': stopEditing(); return renderToday();
      case 'del-deal':
        if (!(await askConfirm('Delete this deal? This cannot be undone.', 'Delete'))) return;
        if (editingId === id) stopEditing();
        db.deals = db.deals.filter((d) => d.id !== id); save(); return renderToday();
      case 'send': return sendTo(pid);
      case 'send-next': {
        const next = involvedParties().find((p) => L.normalizePhone(p.phone) && !isSent(p.id));
        return next ? sendTo(next.id) : toast('Every party with a WhatsApp number has been sent its message.');
      }
      case 'copy':
        try { await navigator.clipboard.writeText(messageFor(pid)); toast('Message copied.'); } catch (_) { toast('Could not copy the message.'); }
        return;
      case 'reset-msg': delete edits[messageKey(pid)]; return renderQueue();
      case 'new-party': editingParty = 'new'; return renderParties();
      case 'edit-party': editingParty = id; return renderParties();
      case 'cancel-party': editingParty = null; return renderParties();
      case 'del-party':
        if (L.dealsForParty(db.deals, id).length) return toast('This party has deals, so it cannot be deleted.');
        if (!(await askConfirm('Delete this party?', 'Delete'))) return;
        db.parties = db.parties.filter((p) => p.id !== id); save(); return renderParties();
      case 'import-vcf': return handleImportVcf();
      case 'vcf-all': syncVcfGrid(); vcfRows.forEach((r) => (r.selected = true)); return renderParties();
      case 'vcf-none': syncVcfGrid(); vcfRows.forEach((r) => (r.selected = false)); return renderParties();
      case 'vcf-cancel': vcfRows = null; return renderParties();
      case 'vcf-import': return onImportVcfRows();
      case 'export-parties-csv': return handleExportPartiesCsv();
      case 'import-parties-csv': return handleImportPartiesCsv();
      case 'export-deals-csv': return handleExportDealsCsv();
      case 'import-deals-csv': return handleImportDealsCsv();
      case 'bill-pdf': {
        const p = party(billSel.partyId);
        const b = L.brokerById(db.settings, billSel.brokerId || (p && p.brokerId));
        const calc = L.billRows(db, p.id, billSel.from, billSel.to);
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAPER_CSS}</style></head><body>${billBody(p, b, calc, billSel.from)}</body></html>`;
        const saved = await api.savePdf(html, b.firm + ' - ' + p.name + ' ' + L.fyRange(billSel.from).label + '.pdf');
        if (saved) toast('PDF saved.');
        return;
      }
      case 'open-backups': return api.openBackups();
      case 'load-sample': {
        if (db.parties.length && !(await askConfirm('Add the sample parties and deals to your existing data?', 'Add sample data'))) return;
        const sd = L.sampleData();
        db.parties.push(...sd.parties); db.deals.push(...sd.deals); save();
        day = '2024-11-18'; billSel = { partyId: sd.parties[0].id, brokerId: sd.parties[0].brokerId || 'keval', from: '', to: '' };
        tab = 'bills'; return render();
      }
    }
  });

  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'deal-form') onAddDeal();
    else if (f.classList.contains('unload')) onSaveBags(f);
    else if (f.id === 'party-form') onSaveParty(f);
    else if (f.id === 'settings-form') onSaveSettings(f);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.matches('textarea[data-pid]')) { edits[messageKey(t.dataset.pid)] = t.value; autosize(t); }
    if (t.matches('[data-split]')) {
      const form = t.closest('form');
      const vals = $$('[data-split]', form).map((x) => x.value).filter((v) => v !== '');
      if (vals.length) form.elements.total.value = vals.reduce((s, v) => s + Number(v), 0);
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'day' && t.value) { day = t.value; render(); }
    else if (t.closest('#deal-form') && (t.name === 'commodity' || t.name === 'qtyUnit')) { syncDraft(); redrawForm(); }
    else if (t.dataset && t.dataset.act === 'vcf-toggle-all') {
      syncVcfGrid();
      const checked = t.checked;
      vcfRows.forEach((r) => (r.selected = checked));
      renderParties();
    } else if (t.closest('#vcf-grid') && t.name === 'sel') {
      syncVcfGrid();
      renderParties();
    } else if (t.id === 'bill-party') {
      billSel.partyId = t.value;
      const p = party(t.value);
      if (p) billSel.brokerId = p.brokerId || 'keval';
      renderBills();
    } else if (t.id === 'bill-broker') { billSel.brokerId = t.value; renderBills(); }
    else if (t.id === 'bill-from') { billSel.from = t.value; renderBills(); }
    else if (t.id === 'bill-to') { billSel.to = t.value; renderBills(); }
  });

  function render() {
    if (editingId) stopEditing();
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ({ today: renderToday, parties: renderParties, bills: renderBills, settings: renderSettings }[tab])();
    $('#view').scrollTop = 0;
  }

  (async function init() {
    db = (await api.load()) || emptyDb();
    const base = JSON.parse(JSON.stringify(L.DEFAULT_SETTINGS));
    db.settings = Object.assign(base, db.settings, { broker: Object.assign(base.broker, (db.settings || {}).broker) });
    db.settings.brokers = L.brokersOf(db.settings).map((b) => Object.assign({}, b));
    db.parties = (db.parties || []).map((p) => Object.assign({ brokerId: 'keval' }, p));
    db.deals = (db.deals || []).map(L.migrateDeal);
    db.sent = db.sent || {};
    render();
  })();

  window.__app = { render, get db() { return db; } }; // used by the smoke test
})();