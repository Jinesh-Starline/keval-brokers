const assert = require('assert');
const L = require('../renderer/logic.js');

// Brokerage matches every row of the real 2024-25 bill.
[[350, 525], [700, 1050], [325, 485], [425, 635], [400, 600]].forEach(([bags, want]) =>
  assert.strictEqual(L.calcBrokerage(bags), want, bags + ' bags'));

// Whole bill: 13 deals, Rs 7,495.
const sd = L.sampleData();
const db = { settings: L.DEFAULT_SETTINGS, parties: sd.parties, deals: sd.deals };
const [vr, ganesh, balaji] = sd.parties;
const bill = L.billRows(db, vr.id, '2024-04-01', '2025-03-31');
assert.strictEqual(bill.rows.length, 13);
assert.strictEqual(bill.total, 7495);
assert.strictEqual(bill.pending, 0);

// 60/40 yearly brokerage distribution between Keval Brokers and Chetan Brokers.
const bigDb = {
  settings: L.DEFAULT_SETTINGS,
  parties: [
    { id: 's1', name: 'Seller A', city: 'Upleta', role: 'seller', brokerId: 'keval', charge: true, rule: { perBag: 2, roundStep: 0 } },
    { id: 's2', name: 'Seller B', city: 'Jetpur', role: 'seller', brokerId: 'chetan', charge: true, rule: { perBag: 2, roundStep: 0 } },
    { id: 'b1', name: 'Buyer X', city: 'Rajkot', role: 'buyer', brokerId: 'keval', charge: false, rule: { perBag: 1.5, roundStep: 5 } },
  ],
  deals: [
    { id: 'd1', date: '2025-05-01', seller: 's1', buyer: 'b1', commodity: 'groundnut', qty: 75000, qtyUnit: 'bags', lines: [{ variety: '', rate: 1000 }], actualBags: null, createdAt: 1 },
    { id: 'd2', date: '2025-06-01', seller: 's2', buyer: 'b1', commodity: 'groundnut', qty: 25000, qtyUnit: 'bags', lines: [{ variety: '', rate: 1000 }], actualBags: null, createdAt: 2 },
  ],
};
const dist = L.periodSummary(bigDb, '2025-04-01', '2026-03-31');
assert.strictEqual(dist.total, 200000);
assert.strictEqual(dist.byBroker[0].broker.id, 'keval');
assert.strictEqual(dist.byBroker[0].shareAmount, 120000);
assert.strictEqual(dist.byBroker[0].billed, 150000);
assert.strictEqual(dist.byBroker[1].broker.id, 'chetan');
assert.strictEqual(dist.byBroker[1].shareAmount, 80000);
assert.strictEqual(dist.byBroker[1].billed, 50000);

// Phone handling and link.
assert.strictEqual(L.normalizePhone('97269 15827'), '919726915827');
assert.strictEqual(L.normalizePhone('+91 97269-15827'), '919726915827');
assert.strictEqual(L.normalizePhone('09726915827'), '919726915827');
assert.strictEqual(L.normalizePhone('12345'), '');
assert.ok(/^https:\/\/wa\.me\/919726915827\?text=/.test(L.waLink('919726915827', 'hi')));

// Dates (including Excel DD/MM/YY and DD/MM/YYYY formats).
assert.strictEqual(L.fyRange('2024-11-18').from, '2024-04-01');
assert.strictEqual(L.shiftDay('2024-03-01', -1), '2024-02-29');
assert.strictEqual(L.fmtDate('2024-04-02'), '02/04/24');
assert.strictEqual(L.parseDateISO('02/04/24'), '2024-04-02');
assert.strictEqual(L.parseDateISO('02/04/2024'), '2024-04-02');

// ---- A truck with two varieties and two prices; bags unknown until unloaded ----
const units = L.DEFAULT_QTY_UNITS;
const truck = {
  id: 't1', date: '2026-11-19', seller: vr.id, buyer: balaji.id, commodity: 'groundnut',
  qty: 1, qtyUnit: 'truck', lines: [{ variety: 'G20', rate: 24000 }, { variety: 'Jini', rate: 23500 }],
  extra: '', note: '', actualBags: null, createdAt: 99,
};
assert.strictEqual(L.dealBags(truck), null, 'pending until unloaded');
assert.ok(L.isPending(truck));
assert.strictEqual(L.ratesText(truck, true), 'G20 ₹24,000 | Jini ₹23,500');

const base = { parties: sd.parties, broker: L.DEFAULT_SETTINGS.broker, units, date: '2026-11-19' };
const before = L.buildMessage(Object.assign({ party: balaji, lang: 'en', deals: [truck] }, base));
assert.ok(before.includes('Groundnut - 1 Truck') && before.includes('Rate: G20 ₹24,000 | Jini ₹23,500'));
assert.ok(before.includes('Bag count will be shared after unloading') && !before.includes('Total:'));
const beforeGu = L.buildMessage(Object.assign({ party: balaji, lang: 'gu', deals: [truck] }, base));
assert.ok(beforeGu.includes('મગફળી - 1 ટ્રક') && beforeGu.includes('બેગ ઉતાર્યા પછી જણાવીશું'));

// Pending deals are kept out of the bill and counted.
const dbP = { parties: sd.parties, deals: sd.deals.concat([truck]) };
const billP = L.billRows(dbP, vr.id, '2026-04-01', '2027-03-31');
assert.strictEqual(billP.rows.length, 0);
assert.strictEqual(billP.pending, 1);
assert.strictEqual(L.dealBrokerage(truck, sd.parties), 0);

// After unloading: 200 G20 + 150 Jini = 350 bags -> same brokerage as any 350 bags.
truck.lines[0].bags = 200; truck.lines[1].bags = 150;
assert.strictEqual(L.dealBags(truck), 350);
assert.ok(L.hasSplit(truck));
const after = L.buildMessage(Object.assign({ party: balaji, lang: 'en', deals: [truck] }, base));
assert.ok(after.includes('After unloading: 350 bags (G20 200, Jini 150)') && after.includes('Total: 350 bags'));
assert.notStrictEqual(before, after, 'message changes so it can be re-sent');
const billA = L.billRows(dbP, vr.id, '2026-04-01', '2027-03-31');
assert.strictEqual(billA.total, 525);
assert.strictEqual(billA.rows[0].rate, 'G20 24,000 | Jini 23,500');
assert.strictEqual(L.dealBrokerage(truck, sd.parties), 525);

// Total known but no split: still billable.
const truck2 = Object.assign({}, truck, { id: 't2', lines: [{ variety: 'G20', rate: 1 }, { variety: 'Jini', rate: 2 }], actualBags: 325 });
assert.strictEqual(L.dealBags(truck2), 325);
assert.ok(!L.hasSplit(truck2));
assert.strictEqual(L.billRows({ parties: sd.parties, deals: [truck2] }, vr.id, '2026-01-01', '2026-12-31').total, 485);

// Counted in bags: known straight away, nothing extra said after unloading.
const bagDeal = sd.deals[0];
assert.strictEqual(L.dealBags(bagDeal), 350);
assert.ok(!L.buildMessage(Object.assign({ party: ganesh, lang: 'en', deals: [bagDeal] }, base)).includes('After unloading'));

// Old-format deals are migrated.
const old = L.migrateDeal({ id: 'o', date: '2024-04-02', seller: 'a', buyer: 'b', commodity: 'groundnut', bags: 350, rate: 24000, unit: '', extra: '', note: '' });
assert.strictEqual(L.dealBags(old), 350);
assert.deepStrictEqual(old.lines, [{ variety: '', rate: 24000 }]);

// Variety suggestions include ones already used.
assert.deepStrictEqual(L.varietiesFor('groundnut', []), ['G20', 'Jini']);
assert.ok(L.varietiesFor('groundnut', [{ commodity: 'groundnut', lines: [{ variety: 'Bold' }] }]).includes('Bold'));
assert.deepStrictEqual(L.varietiesFor('cotton', []), []);

// Editable vehicle list keeps ids of existing types.
const parsed = L.parseUnits('Truck | ટ્રક\nSmall cargo van | છોટા હાથી\nPickup | પીકઅપ', units);
assert.deepStrictEqual(parsed.map((u) => u.id), ['bags', 'truck', 'small-cargo-van', 'pickup']);
assert.ok(L.unitsToText(parsed).includes('Pickup | પીકઅપ'));

// ---- VCF contact parsing ----
const vcfSample = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:Rameshbhai Patel',
  'TEL;TYPE=CELL:+91 98250 12345',
  'ADR;TYPE=WORK:;;Market Yard;Rajkot;Gujarat;360001;India',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:2.1',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E0=AA=B6=E0=AB=8D=E0=AA=B0=E0=AB=80=20=E0=AA=95=E0=AB=83=E0=AA=B7=E0=AB=8D=E0=AA=A3=E0=AA=BE',
  'TEL;CELL:09909911223',
  'END:VCARD',
].join('\r\n');
const vcfParsed = L.parseVcf(vcfSample);
assert.strictEqual(vcfParsed.length, 2);
assert.strictEqual(vcfParsed[0].name, 'Rameshbhai Patel');
assert.strictEqual(vcfParsed[0].phone, '9825012345');
assert.strictEqual(vcfParsed[0].city, 'Rajkot');
assert.strictEqual(vcfParsed[0].brokerId, 'keval');
assert.strictEqual(vcfParsed[1].name, 'શ્રી કૃષ્ણા');
assert.strictEqual(vcfParsed[1].phone, '9909911223');

// ---- CSV export & import for Parties (with Broker Account) and Deals ----
const partiesCsv = L.partiesToCsv(sd.parties, L.DEFAULT_SETTINGS);
assert.ok(partiesCsv.includes('CHETAN BROKERS'));
const importedParties = L.parsePartiesCsv(partiesCsv + '\nKrishna Traders,Gondal,9898011111,Seller,CHETAN BROKERS,Yes,2,5\n', sd.parties, L.DEFAULT_SETTINGS);
assert.strictEqual(importedParties.updated, 3);
assert.strictEqual(importedParties.added, 1);
assert.strictEqual(importedParties.parties[3].brokerId, 'chetan');

const exportDb = { settings: L.DEFAULT_SETTINGS, parties: sd.parties, deals: sd.deals.concat([truck]) };
const dealsCsv = L.dealsToCsv(exportDb);
assert.ok(dealsCsv.includes('G20 24000 | Jini 23500'));
assert.ok(dealsCsv.includes('G20 200 | Jini 150'));

const reimport = L.parseDealsCsv(dealsCsv, exportDb);
assert.strictEqual(reimport.added, 0);
assert.strictEqual(reimport.skipped, 14);

const freshImport = L.parseDealsCsv(dealsCsv, { settings: L.DEFAULT_SETTINGS, parties: [], deals: [] });
assert.strictEqual(freshImport.added, 14);
assert.strictEqual(freshImport.createdParties, 3);
const importedTruck = freshImport.deals[13];
assert.strictEqual(L.dealBags(importedTruck), 350);
assert.ok(L.hasSplit(importedTruck));

console.log('logic tests passed');