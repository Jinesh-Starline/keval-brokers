/* Pure business logic. Works in the browser (window.Logic) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COMMODITIES = [
    { id: 'groundnut', en: 'Groundnut', gu: 'મગફળી' },
    { id: 'soyabean', en: 'Soyabean', gu: 'સોયાબીન' },
    { id: 'cotton', en: 'Cotton', gu: 'કપાસ' },
    { id: 'castor', en: 'Castor', gu: 'એરંડા' },
  ];

  /* How a deal's quantity is counted. "bags" is fixed; the rest can be edited in Settings. */
  const BAGS_UNIT = { id: 'bags', en: 'Bags', gu: 'બેગ' };
  const DEFAULT_QTY_UNITS = [
    BAGS_UNIT,
    { id: 'truck', en: 'Truck', gu: 'ટ્રક' },
    { id: 'small-cargo-van', en: 'Small cargo van', gu: 'છોટા હાથી' },
    { id: 'tempo', en: 'Tempo', gu: 'ટેમ્પો' },
    { id: 'tractor', en: 'Tractor', gu: 'ટ્રેક્ટર' },
  ];

  const DEFAULT_VARIETIES = { groundnut: ['G20', 'Jini'], soyabean: [], cotton: [], castor: [] };
  const DEFAULT_RULE = { perBag: 1.5, roundStep: 5 };

  const KEVAL_BASE = {
    id: 'keval',
    share: 60,
    firm: 'KEVAL BROKERS',
    name: 'KEVAL CHETANKUMAR BAKHAI',
    mobile: '97269 15827',
    address: 'SHOP NO.: 4, BHAGVATI APARTMENT, KOLKI ROAD, UPLETA',
    bank: 'STATE BANK OF INDIA',
    account: '42434360480',
    ifsc: 'SBIN0005949',
    pan: 'HOEPB5980R',
  };

  const CHETAN_BASE = Object.assign({}, KEVAL_BASE, {
    id: 'chetan',
    share: 40,
    firm: 'CHETAN BROKERS',
    name: 'CHETANKUMAR BAKHAI',
  });

  const DEFAULT_BROKERS = [KEVAL_BASE, CHETAN_BASE];

  const DEFAULT_SETTINGS = {
    lang: 'gu',
    qtyUnits: DEFAULT_QTY_UNITS,
    broker: Object.assign({}, KEVAL_BASE),
    brokers: DEFAULT_BROKERS.map((b) => Object.assign({}, b)),
  };

  function brokersOf(settings) {
    if (settings && Array.isArray(settings.brokers) && settings.brokers.length) return settings.brokers;
    const k = Object.assign({}, KEVAL_BASE, (settings && settings.broker) || {}, { id: 'keval' });
    const c = Object.assign({}, CHETAN_BASE);
    return [k, c];
  }
  function brokerById(settings, id) {
    const list = brokersOf(settings);
    return list.find((b) => b.id === id) || list[0];
  }

  /* ---------- brokerage ---------- */
  /* bags x rate-per-bag, rounded DOWN to the nearest step.
     Matches the existing bill: 325 bags -> 487.5 -> 485, 425 -> 637.5 -> 635. */
  function calcBrokerage(bags, rule) {
    const r = Object.assign({}, DEFAULT_RULE, rule || {});
    const raw = Number(bags) * Number(r.perBag);
    if (!isFinite(raw) || raw <= 0) return 0;
    if (r.roundStep > 0) return Math.floor(raw / r.roundStep + 1e-9) * r.roundStep;
    return Math.round(raw);
  }

  /* ---------- dates / numbers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function shiftDay(iso, delta) {
    const [y, m, d] = iso.split('-').map(Number);
    return todayISO(new Date(y, m - 1, d + delta));
  }
  function fmtDate(iso) {
    const [y, m, d] = iso.split('-');
    return d + '/' + m + '/' + y.slice(2);
  }
  function fmtDateLong(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtNum(n) {
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  /* Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, or DD/MM/YY (when opened & saved in Excel). */
  function parseDateISO(raw) {
    const s = String(raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return '';
    const dd = pad(Number(m[1]));
    const mm = pad(Number(m[2]));
    const yy = m[3].length === 2 ? (Number(m[3]) >= 70 ? '19' + m[3] : '20' + m[3]) : m[3];
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
    return yy + '-' + mm + '-' + dd;
  }
  /* Indian financial year (1 Apr - 31 Mar) containing the given ISO date */
  function fyRange(iso) {
    const [y, m] = iso.split('-').map(Number);
    const start = m >= 4 ? y : y - 1;
    return { from: start + '-04-01', to: start + 1 + '-03-31', label: start + '-' + String(start + 1).slice(2) };
  }

  /* 10 digit Indian mobile -> 91XXXXXXXXXX. Returns '' if it cannot be a valid number. */
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '0') d = d.slice(1);
    if (d.length === 10) d = '91' + d;
    return d.length >= 11 && d.length <= 15 ? d : '';
  }
  /* Display-friendly 10-digit Indian number if 91XXXXXXXXXX, else original digits. */
  function shortPhone(raw) {
    const d = normalizePhone(raw);
    if (d && d.length === 12 && d.startsWith('91')) return d.slice(2);
    return String(raw || '').trim();
  }
  function waLink(phone, text) {
    return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
  }

  /* ---------- quantity units ---------- */
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const unitsOf = (settings) => (settings && settings.qtyUnits && settings.qtyUnits.length ? settings.qtyUnits : DEFAULT_QTY_UNITS);
  function unitInfo(units, id) {
    return (units || DEFAULT_QTY_UNITS).find((u) => u.id === id) || { id, en: id, gu: id };
  }
  /* One line per unit: "English | ગુજરાતી". Bags is always first and cannot be removed. */
  function unitsToText(units) {
    return units.filter((u) => u.id !== 'bags').map((u) => u.en + (u.gu && u.gu !== u.en ? ' | ' + u.gu : '')).join('\n');
  }
  function parseUnits(text, current) {
    const out = [BAGS_UNIT];
    String(text || '').split('\n').forEach((line) => {
      const [en, gu] = line.split('|').map((s) => s.trim());
      if (!en || slug(en) === 'bags' || slug(en) === 'bag') return;
      const old = (current || []).find((u) => u.en.toLowerCase() === en.toLowerCase());
      let id = old ? old.id : slug(en) || 'unit' + out.length;
      while (out.some((u) => u.id === id)) id += '-2';
      out.push({ id, en, gu: gu || en });
    });
    return out;
  }

  /* ---------- deals ---------- */
  function lineBagsSum(d) {
    const ls = d.lines || [];
    const ok = ls.length && ls.every((l) => l.bags != null && l.bags !== '' && isFinite(l.bags));
    return ok ? ls.reduce((s, l) => s + Number(l.bags), 0) : null;
  }
  function dealBags(d) {
    const s = lineBagsSum(d);
    if (s != null) return s;
    if (d.actualBags != null && d.actualBags !== '' && isFinite(d.actualBags)) return Number(d.actualBags);
    if (d.qtyUnit === 'bags' && Number(d.qty) > 0) return Number(d.qty);
    return null;
  }
  const isPending = (d) => dealBags(d) === null;
  const hasSplit = (d) => (d.lines || []).length > 1 && lineBagsSum(d) != null;

  /* Old deals had bags/rate directly on the deal. */
  function migrateDeal(d) {
    if (!d.lines) {
      d.lines = [{ variety: '', rate: Number(d.rate) || 0 }];
      d.qty = d.bags;
      d.qtyUnit = 'bags';
      d.actualBags = null;
      delete d.rate; delete d.bags; delete d.unit;
    }
    return d;
  }

  function ratesText(d, rupee) {
    const ls = d.lines || [];
    const parts = ls.map((l) => (l.variety ? l.variety + ' ' : '') + (rupee ? '₹' : '') + fmtNum(l.rate));
    return parts.join(' | ') + (d.extra ? '/' + d.extra : '');
  }
  const qtyText = (d, units, lang) => d.qty + ' ' + (unitInfo(units, d.qtyUnit)[lang] || unitInfo(units, d.qtyUnit).en);

  const commodityName = (id, lang) => {
    const c = COMMODITIES.find((x) => x.id === id);
    return c ? c[lang] || c.en : id;
  };
  function varietiesFor(commodity, deals) {
    const seen = (DEFAULT_VARIETIES[commodity] || []).slice();
    (deals || []).forEach((d) => {
      if (d.commodity !== commodity) return;
      (d.lines || []).forEach((l) => { if (l.variety && !seen.some((v) => v.toLowerCase() === l.variety.toLowerCase())) seen.push(l.variety); });
    });
    return seen;
  }

  const dealsForParty = (deals, partyId) => deals.filter((d) => d.seller === partyId || d.buyer === partyId);

  /* ---------- WhatsApp messages ---------- */
  const T = {
    gu: {
      hello: (n) => 'નમસ્તે ' + n + ',',
      head: (d) => d + ' ના કન્ફર્મ સોદા:',
      bags: 'બેગ', rate: 'ભાવ', buyer: 'ખરીદાર', seller: 'વેચાણકાર', note: 'નોંધ', total: 'કુલ',
      after: 'ઉતાર્યા પછી', pending: 'બેગ ઉતાર્યા પછી જણાવીશું', thanks: 'આભાર,',
    },
    en: {
      hello: (n) => 'Hello ' + n + ',',
      head: (d) => 'Confirmed deals for ' + d + ':',
      bags: 'bags', rate: 'Rate', buyer: 'Buyer', seller: 'Seller', note: 'Note', total: 'Total',
      after: 'After unloading', pending: 'Bag count will be shared after unloading', thanks: 'Thanks,',
    },
  };

  function buildMessage({ party, date, deals, parties, broker, lang, units }) {
    const t = T[lang] || T.gu;
    const byId = (id) => parties.find((p) => p.id === id);
    const lines = [t.hello(party.name), t.head(fmtDate(date)), ''];
    let totalBags = 0;
    let allKnown = deals.length > 0;
    deals.forEach((d, i) => {
      const isSeller = d.seller === party.id;
      const other = byId(isSeller ? d.buyer : d.seller);
      const bags = dealBags(d);
      lines.push(i + 1 + ') ' + commodityName(d.commodity, lang) + ' - ' + qtyText(d, units, lang));
      lines.push('   ' + t.rate + ': ' + ratesText(d, true));
      lines.push('   ' + (isSeller ? t.buyer : t.seller) + ': ' + (other ? other.name + (other.city ? ' (' + other.city + ')' : '') : '-'));
      if (bags != null) {
        totalBags += bags;
        if (d.qtyUnit !== 'bags' || hasSplit(d)) {
          const split = hasSplit(d) ? ' (' + d.lines.map((l) => (l.variety || '') + ' ' + l.bags).join(', ').replace(/\s+/g, ' ') + ')' : '';
          lines.push('   ' + t.after + ': ' + bags + ' ' + t.bags + split);
        }
      } else allKnown = false;
      if (d.note) lines.push('   ' + t.note + ': ' + d.note);
    });
    lines.push('');
    lines.push(allKnown ? t.total + ': ' + totalBags + ' ' + t.bags : t.pending);
    lines.push('', t.thanks, broker.firm || broker.name);
    return lines.join('\n');
  }

  /* ---------- billing & 60/40 distribution ---------- */
  function billRows(db, partyId, from, to) {
    const party = db.parties.find((p) => p.id === partyId);
    if (!party) return { rows: [], total: 0, bags: 0, pending: 0 };
    const mine = dealsForParty(db.deals, partyId).filter((d) => d.date >= from && d.date <= to);
    const rows = mine
      .filter((d) => !isPending(d))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
      .map((d) => {
        const other = db.parties.find((p) => p.id === (d.seller === partyId ? d.buyer : d.seller));
        const bags = dealBags(d);
        return { date: d.date, party: other ? other.name : '-', city: other ? other.city : '', bags, rate: ratesText(d), amount: calcBrokerage(bags, party.rule) };
      });
    return {
      rows,
      total: rows.reduce((s, r) => s + r.amount, 0),
      bags: rows.reduce((s, r) => s + r.bags, 0),
      pending: mine.filter(isPending).length,
    };
  }

  function dealBrokerage(d, parties) {
    const bags = dealBags(d);
    if (bags == null) return 0;
    return [d.seller, d.buyer].reduce((s, id) => {
      const p = parties.find((x) => x.id === id);
      return s + (p && p.charge ? calcBrokerage(bags, p.rule) : 0);
    }, 0);
  }

  /* Total brokerage across all charged parties in [from, to], plus billed-per-account and 60/40 split. */
  function periodSummary(db, from, to) {
    const brokers = brokersOf(db.settings);
    const billedMap = {};
    brokers.forEach((b) => { billedMap[b.id] = 0; });
    const inPeriod = (db.deals || []).filter((d) => d.date >= from && d.date <= to);
    let total = 0;
    let bags = 0;
    let pending = 0;

    inPeriod.forEach((d) => {
      const b = dealBags(d);
      if (b == null) { pending++; return; }
      bags += b;
      [d.seller, d.buyer].forEach((id) => {
        const p = (db.parties || []).find((x) => x.id === id);
        if (!p || !p.charge) return;
        const amt = calcBrokerage(b, p.rule);
        total += amt;
        const bid = billedMap[p.brokerId] != null ? p.brokerId : brokers[0].id;
        billedMap[bid] += amt;
      });
    });

    const pctSum = brokers.reduce((s, b) => s + (Number(b.share) || 0), 0) || 100;
    let allocated = 0;
    const byBroker = brokers.map((b, idx) => {
      const sharePct = Number(b.share) || 0;
      const isLast = idx === brokers.length - 1;
      const shareAmount = isLast ? Math.max(0, total - allocated) : Math.round((total * sharePct) / pctSum);
      allocated += shareAmount;
      const billed = billedMap[b.id] || 0;
      return { broker: b, billed, sharePct, shareAmount, diff: shareAmount - billed };
    });

    return { total, bags, pending, byBroker };
  }

  let seq = 0;
  const newId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

  /* ---------- VCF (vCard) parsing ---------- */
  function decodeQuotedPrintable(str) {
    try {
      const clean = str.replace(/=\r?\n/g, '');
      const hexed = clean.replace(/=([0-9A-Fa-f]{2})/g, '%$1');
      return decodeURIComponent(hexed);
    } catch (_) {
      return str;
    }
  }
  function unescapeVcf(str) {
    return String(str || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
  }
  function parseVcf(text) {
    const unfolded = String(text || '')
      .replace(/=\r?\n[ \t]?/g, '=')
      .replace(/\r\n[ \t]/g, '')
      .replace(/\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    const contacts = [];
    let cur = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^BEGIN:VCARD/i.test(line)) {
        cur = { name: '', nParts: [], phones: [], city: '' };
        continue;
      }
      if (/^END:VCARD/i.test(line)) {
        if (cur) {
          let name = cur.name;
          if (!name && cur.nParts.length) {
            const [last, first, mid] = cur.nParts;
            name = [first, mid, last].filter(Boolean).join(' ').trim();
          }
          const valid = cur.phones.find((ph) => normalizePhone(ph));
          const phone = valid ? shortPhone(valid) : (cur.phones[0] || '').trim();
          if (name || phone) {
            contacts.push({
              selected: true,
              name: name || phone,
              phone,
              city: cur.city,
              role: 'buyer',
              brokerId: 'keval',
              charge: false,
              perBag: DEFAULT_RULE.perBag,
              roundStep: DEFAULT_RULE.roundStep,
            });
          }
        }
        cur = null;
        continue;
      }
      if (!cur) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const keyPart = line.slice(0, colonIdx);
      let valPart = line.slice(colonIdx + 1);
      const prop = keyPart.split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      if (/ENCODING=QUOTED-PRINTABLE/i.test(keyPart)) valPart = decodeQuotedPrintable(valPart);

      if (prop === 'FN') {
        const v = unescapeVcf(valPart);
        if (v) cur.name = v;
      } else if (prop === 'N') {
        cur.nParts = valPart.split(';').map(unescapeVcf);
      } else if (prop === 'TEL') {
        const p = unescapeVcf(valPart);
        if (p) {
          if (/CELL|PREF/i.test(keyPart)) cur.phones.unshift(p);
          else cur.phones.push(p);
        }
      } else if (prop === 'ADR' && !cur.city) {
        const parts = valPart.split(';').map(unescapeVcf);
        if (parts[3]) cur.city = parts[3];
      }
    }
    return contacts;
  }

  /* ---------- CSV serialization & parsing ---------- */
  function toCsv(rows) {
    const escCell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '\uFEFF' + rows.map((r) => r.map(escCell).join(',')).join('\r\n') + '\r\n';
  }
  function parseCsv(text) {
    const s = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
        else if (ch === '\n' || ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  /* ---------- Parties CSV ---------- */
  function partiesToCsv(parties, settings) {
    const header = ['Name', 'City', 'WhatsApp', 'Role', 'Broker Account', 'Pays Brokerage', 'Rs Per Bag', 'Round Step'];
    const rows = (parties || []).map((p) => [
      p.name,
      p.city || '',
      p.phone || '',
      p.role === 'both' ? 'Both' : p.role === 'seller' ? 'Seller' : 'Buyer',
      brokerById(settings, p.brokerId).firm,
      p.charge ? 'Yes' : 'No',
      p.rule ? p.rule.perBag : DEFAULT_RULE.perBag,
      p.rule ? p.rule.roundStep : DEFAULT_RULE.roundStep,
    ]);
    return toCsv([header].concat(rows));
  }

  function parsePartiesCsv(text, existingParties, settings) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { added: 0, updated: 0, skipped: 0, parties: existingParties.slice() };
    const hdr = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => hdr.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const iName = col('name', 'party');
    const iCity = col('city', 'town', 'village');
    const iPhone = col('whatsapp', 'phone', 'mobile', 'contact', 'number');
    const iRole = col('role', 'type');
    const iBroker = col('broker account', 'account', 'broker');
    const iCharge = col('pays', 'charge');
    const iPerBag = col('per bag', 'perbag', 'rate');
    const iRound = col('round', 'step');

    if (iName < 0) return { added: 0, updated: 0, skipped: rows.length - 1, parties: existingParties.slice() };

    const brokers = brokersOf(settings);
    const list = existingParties.map((p) => Object.assign({}, p, { rule: Object.assign({}, p.rule) }));
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const name = (cells[iName] || '').trim();
      if (!name) { skipped++; continue; }
      const city = iCity >= 0 ? (cells[iCity] || '').trim() : '';
      const rawPhone = iPhone >= 0 ? (cells[iPhone] || '').trim() : '';
      const phone = rawPhone ? (shortPhone(rawPhone) || rawPhone) : '';
      const roleRaw = iRole >= 0 ? (cells[iRole] || '').trim().toLowerCase() : '';
      const role = roleRaw.includes('both') || (roleRaw.includes('sell') && roleRaw.includes('buy')) ? 'both'
        : roleRaw.includes('sell') ? 'seller' : 'buyer';
      const brokerRaw = iBroker >= 0 ? (cells[iBroker] || '').trim().toLowerCase() : '';
      const matchedBroker = brokerRaw ? brokers.find((b) => b.id === brokerRaw || b.firm.toLowerCase().includes(brokerRaw) || brokerRaw.includes(b.id)) : null;
      const brokerId = matchedBroker ? matchedBroker.id : 'keval';
      const chargeRaw = iCharge >= 0 ? (cells[iCharge] || '').trim().toLowerCase() : '';
      const charge = ['yes', 'y', '1', 'true'].includes(chargeRaw);
      const perBagVal = iPerBag >= 0 && cells[iPerBag] !== '' && isFinite(Number(cells[iPerBag])) ? Number(cells[iPerBag]) : DEFAULT_RULE.perBag;
      const roundVal = iRound >= 0 && cells[iRound] !== '' && isFinite(Number(cells[iRound])) ? Number(cells[iRound]) : DEFAULT_RULE.roundStep;

      const existing = list.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
      if (existing) {
        if (city) existing.city = city;
        if (phone) existing.phone = phone;
        if (iRole >= 0 && roleRaw) existing.role = role;
        if (iBroker >= 0 && matchedBroker) existing.brokerId = brokerId;
        if (iCharge >= 0 && chargeRaw) existing.charge = charge;
        if (iPerBag >= 0 && cells[iPerBag] !== '') existing.rule.perBag = perBagVal;
        if (iRound >= 0 && cells[iRound] !== '') existing.rule.roundStep = roundVal;
        updated++;
      } else {
        list.push({
          id: newId(),
          name,
          city,
          phone,
          role,
          brokerId,
          charge,
          rule: { perBag: perBagVal, roundStep: roundVal },
        });
        added++;
      }
    }
    return { added, updated, skipped, parties: list };
  }

  /* ---------- Deals CSV ---------- */
  function dealsToCsv(db) {
    const units = unitsOf(db.settings);
    const byId = (id) => (db.parties || []).find((p) => p.id === id);
    const header = [
      'Date', 'Seller', 'Seller City', 'Buyer', 'Buyer City', 'Commodity',
      'Quantity', 'Unit', 'Rates', 'Variety Bags', 'Total Bags', 'Extra', 'Note', 'Brokerage',
    ];
    const sorted = (db.deals || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    const rows = sorted.map((d) => {
      const s = byId(d.seller) || {};
      const b = byId(d.buyer) || {};
      const rateStr = (d.lines || []).map((l) => (l.variety ? l.variety + ' ' : '') + l.rate).join(' | ');
      const splitStr = hasSplit(d) ? d.lines.map((l) => (l.variety ? l.variety + ' ' : '') + l.bags).join(' | ') : '';
      const bags = dealBags(d);
      return [
        d.date,
        s.name || '',
        s.city || '',
        b.name || '',
        b.city || '',
        commodityName(d.commodity, 'en'),
        d.qty,
        unitInfo(units, d.qtyUnit).en,
        rateStr,
        splitStr,
        bags != null ? bags : '',
        d.extra || '',
        d.note || '',
        dealBrokerage(d, db.parties || []),
      ];
    });
    return toCsv([header].concat(rows));
  }

  function parseRateSegment(seg) {
    const s = String(seg || '').replace(/₹/g, '').trim();
    if (!s) return null;
    const m = s.match(/^(?:(.+?)\s+)?([0-9][0-9,]*(?:\.[0-9]+)?)$/);
    if (!m) return null;
    const rate = Number(m[2].replace(/,/g, ''));
    if (!isFinite(rate)) return null;
    return { variety: (m[1] || '').trim(), rate };
  }

  function parseDealsCsv(text, db) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { added: 0, skipped: 0, createdParties: 0, parties: (db.parties || []).slice(), deals: (db.deals || []).slice() };
    const hdr = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => hdr.findIndex((h) => names.some((n) => h === n || h.includes(n)));

    const iDate = col('date');
    const iSeller = col('seller');
    const iSellerCity = col('seller city');
    const iBuyer = col('buyer');
    const iBuyerCity = col('buyer city');
    const iComm = col('commodity', 'item', 'crop');
    const iQty = col('quantity', 'qty');
    const iUnit = col('unit');
    const iRates = col('rate');
    const iSplit = col('variety bags', 'split');
    const iTotalBags = col('total bags', 'bags');
    const iExtra = col('extra');
    const iNote = col('note', 'remark');

    if (iDate < 0 || iSeller < 0 || iBuyer < 0 || iRates < 0) {
      return { added: 0, skipped: rows.length - 1, createdParties: 0, parties: (db.parties || []).slice(), deals: (db.deals || []).slice() };
    }

    const parties = (db.parties || []).map((p) => Object.assign({}, p, { rule: Object.assign({}, p.rule) }));
    const deals = (db.deals || []).slice();
    const units = unitsOf(db.settings);
    let added = 0;
    let skipped = 0;
    let createdParties = 0;

    function ensureParty(name, city, defaultRole) {
      const clean = name.trim();
      let p = parties.find((x) => x.name.trim().toLowerCase() === clean.toLowerCase());
      if (!p) {
        p = {
          id: newId(),
          name: clean,
          city: (city || '').trim(),
          phone: '',
          role: defaultRole,
          brokerId: 'keval',
          charge: false,
          rule: { perBag: DEFAULT_RULE.perBag, roundStep: DEFAULT_RULE.roundStep },
        };
        parties.push(p);
        createdParties++;
      } else if (city && !p.city) {
        p.city = city.trim();
      }
      return p;
    }

    for (let r = 1; r < rows.length; r++) {
      const c = rows[r];
      const date = parseDateISO(c[iDate]);
      const sellerName = (c[iSeller] || '').trim();
      const buyerName = (c[iBuyer] || '').trim();
      if (!date || !sellerName || !buyerName || sellerName.toLowerCase() === buyerName.toLowerCase()) {
        skipped++;
        continue;
      }

      const commRaw = iComm >= 0 ? (c[iComm] || '').trim().toLowerCase() : '';
      const commObj = COMMODITIES.find((x) => x.id === commRaw || x.en.toLowerCase() === commRaw || x.gu === commRaw);
      const commodity = commObj ? commObj.id : 'groundnut';

      const unitRaw = iUnit >= 0 ? (c[iUnit] || '').trim().toLowerCase() : '';
      const unitObj = units.find((u) => u.id === unitRaw || u.en.toLowerCase() === unitRaw || u.gu === unitRaw);
      const qtyUnit = unitObj ? unitObj.id : 'bags';

      const rateRaw = (c[iRates] || '').trim();
      const lines = rateRaw.split('|').map(parseRateSegment).filter(Boolean);
      if (!lines.length) { skipped++; continue; }

      const splitRaw = iSplit >= 0 ? (c[iSplit] || '').trim() : '';
      if (splitRaw) {
        splitRaw.split('|').forEach((seg, idx) => {
          const parsed = parseRateSegment(seg);
          if (!parsed) return;
          const target = parsed.variety
            ? lines.find((l) => l.variety.toLowerCase() === parsed.variety.toLowerCase()) || lines[idx]
            : lines[idx];
          if (target && parsed.rate >= 0) target.bags = parsed.rate;
        });
      }

      const totalBagsRaw = iTotalBags >= 0 ? (c[iTotalBags] || '').replace(/,/g, '').trim() : '';
      const totalBagsNum = totalBagsRaw !== '' && isFinite(Number(totalBagsRaw)) && Number(totalBagsRaw) > 0 ? Number(totalBagsRaw) : null;

      let qty = iQty >= 0 && (c[iQty] || '').trim() !== '' ? Number(String(c[iQty]).replace(/,/g, '')) : 0;
      if (!(qty > 0)) qty = qtyUnit === 'bags' && totalBagsNum ? totalBagsNum : 1;

      const splitSum = lineBagsSum({ lines });
      const actualBags = splitSum != null ? splitSum : (qtyUnit !== 'bags' ? totalBagsNum : null);
      const extra = iExtra >= 0 ? (c[iExtra] || '').trim() : '';
      const note = iNote >= 0 ? (c[iNote] || '').trim() : '';

      const seller = ensureParty(sellerName, iSellerCity >= 0 ? c[iSellerCity] : '', 'seller');
      const buyer = ensureParty(buyerName, iBuyerCity >= 0 ? c[iBuyerCity] : '', 'buyer');

      const sig = (d) => [d.date, d.seller, d.buyer, d.commodity, d.qty, d.qtyUnit, JSON.stringify(d.lines), d.actualBags ?? '', d.extra || ''].join('|');
      const candidate = {
        id: newId(),
        date,
        seller: seller.id,
        buyer: buyer.id,
        commodity,
        qty,
        qtyUnit,
        lines,
        extra,
        note,
        actualBags,
        createdAt: Date.now() + r,
      };
      if (deals.some((ex) => sig(ex) === sig(candidate))) {
        skipped++;
        continue;
      }
      deals.push(candidate);
      added++;
    }

    return { added, skipped, createdParties, parties, deals };
  }

  /* The 2024-25 bill of Vrundavan Trading, used for demo data and tests. */
  function sampleData() {
    const mk = (name, city, role, charge, brokerId) => ({ id: newId(), name, city, phone: '', role, brokerId: brokerId || 'keval', charge, rule: { perBag: 1.5, roundStep: 5 } });
    const v = mk('Vrundavan Trading', 'Kalavad', 'seller', true, 'keval');
    const g = mk('Ganesh Oil Industries', 'Upleta', 'buyer', false, 'keval');
    const b = mk('Balaji Proteins', 'Upleta', 'buyer', false, 'chetan');
    const rows = [
      ['2024-04-02', g, 350, 24000, '500'], ['2024-04-02', g, 350, 24000, ''], ['2024-04-03', b, 700, 24075, '100'],
      ['2024-04-06', b, 350, 24300, ''], ['2024-04-16', g, 350, 24400, ''], ['2024-07-21', b, 325, 24551, ''],
      ['2024-07-25', b, 350, 24700, ''], ['2024-07-26', b, 350, 24500, ''], ['2024-08-16', b, 350, 22575, ''],
      ['2024-08-20', b, 425, 22410, ''], ['2024-09-03', b, 350, 23000, ''], ['2024-11-15', g, 400, 21300, '800'],
      ['2024-11-18', g, 350, 20800, ''],
    ];
    const deals = rows.map(([date, buyer, bags, rate, extra], i) => ({
      id: newId(), date, seller: v.id, buyer: buyer.id, commodity: 'groundnut', qty: bags, qtyUnit: 'bags',
      lines: [{ variety: '', rate }], extra, note: '', actualBags: null, createdAt: i,
    }));
    return { parties: [v, g, b], deals };
  }

  return {
    COMMODITIES, DEFAULT_RULE, DEFAULT_BROKERS, DEFAULT_SETTINGS, DEFAULT_QTY_UNITS,
    brokersOf, brokerById,
    calcBrokerage, todayISO, shiftDay, fmtDate, fmtDateLong, fmtNum, parseDateISO, fyRange,
    normalizePhone, shortPhone, waLink,
    unitsOf, unitInfo, unitsToText, parseUnits, dealBags, isPending, hasSplit, migrateDeal,
    ratesText, qtyText, commodityName, varietiesFor, dealsForParty, buildMessage, billRows, dealBrokerage, periodSummary,
    parseVcf, toCsv, parseCsv, partiesToCsv, parsePartiesCsv, dealsToCsv, parseDealsCsv,
    newId, sampleData,
  };
});