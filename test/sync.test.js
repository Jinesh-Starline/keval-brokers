const assert = require('assert');
const L = require('../renderer/logic.js');

let clock = 1000;
const mkDb = (id) => ({ parties: [], deals: [], sent: {}, deleted: {}, device: { id, name: id }, settings: {} });
const touch = (db, o) => { o.updatedAt = ++clock; o.updatedFrom = db.device.id; return o; };
const apply = (db, res) => { assert.ok(!res.error, res.error); Object.assign(db, { parties: res.parties, deals: res.deals, deleted: res.deleted, sent: res.sent }); return res.stats; };
const syncTo = (from, to) => apply(to, L.mergeSync(to, L.exportSync(from)));

// PC has the sample data
const pc = mkDb('pc');
const sd = L.sampleData();
sd.parties.forEach((p) => pc.parties.push(touch(pc, p)));
sd.deals.forEach((d) => pc.deals.push(touch(pc, d)));

// 1. first import into an empty mobile
const mob = mkDb('mobile');
let st = syncTo(pc, mob);
assert.strictEqual(mob.deals.length, 13);
assert.strictEqual(mob.parties.length, 3);
assert.strictEqual(st.dealsAdded, 13);

// 2. importing the same file again changes nothing
st = syncTo(pc, mob);
assert.deepStrictEqual([st.dealsAdded, st.dealsUpdated, st.dealsRemoved, st.partiesAdded, st.partiesUpdated], [0, 0, 0, 0, 0]);

// 3. rate edited on mobile reaches the computer
const dm = mob.deals[0];
dm.lines[0].rate = 25000; touch(mob, dm);
st = syncTo(mob, pc);
assert.strictEqual(st.dealsUpdated, 1);
assert.strictEqual(pc.deals[0].lines[0].rate, 25000);
assert.strictEqual(pc.deals[0].updatedFrom, 'mobile');

// 4. older copy does not overwrite a newer one
syncTo(pc, mob); // nothing newer on pc
const dp = pc.deals[1];
dp.actualBags = 360; touch(pc, dp);
mob.deals[1].lines[0].rate = 1; // older stamp, edited "before"
st = syncTo(pc, mob);
assert.strictEqual(mob.deals[1].actualBags, 360);

// 5. deal added on mobile, deleted on computer, delete reaches mobile
const nd = touch(mob, { id: L.newId(), date: '2025-01-05', seller: mob.parties[0].id, buyer: mob.parties[1].id, commodity: 'groundnut', qty: 1, qtyUnit: 'truck', lines: [{ variety: 'G20', rate: 2000 }], extra: '', note: '', actualBags: null, createdAt: 1 });
mob.deals.push(nd);
syncTo(mob, pc);
assert.ok(pc.deals.some((d) => d.id === nd.id));
pc.deals = pc.deals.filter((d) => d.id !== nd.id);
pc.deleted[nd.id] = { updatedAt: ++clock, updatedFrom: 'pc' };
st = syncTo(pc, mob);
assert.strictEqual(st.dealsRemoved, 1);
assert.ok(!mob.deals.some((d) => d.id === nd.id));
// and the old copy coming back does not resurrect it
const before = pc.deals.length;
syncTo(mob, pc);
assert.strictEqual(pc.deals.length, before);

// 6. same party created separately on mobile (different id) is matched by name
const fresh = mkDb('mobile2');
const mp = touch(fresh, { id: 'x-ganesh', name: 'ganesh oil industries ', city: 'Upleta', phone: '', role: 'buyer', charge: false, rule: { perBag: 2, roundStep: 5 } });
fresh.parties.push(mp);
fresh.deals.push(touch(fresh, { id: 'x-deal', date: '2025-02-01', seller: 'x-ganesh', buyer: 'x-ganesh2', commodity: 'cotton', qty: 5, qtyUnit: 'bags', lines: [{ variety: '', rate: 1 }], extra: '', note: '', actualBags: null, createdAt: 1 }));
syncTo(pc, fresh);
assert.strictEqual(fresh.parties.filter((p) => p.name.trim().toLowerCase() === 'ganesh oil industries').length, 1);
const pcGanesh = pc.parties.find((p) => p.name === 'Ganesh Oil Industries');
syncTo(fresh, pc);
assert.ok(pc.deals.some((d) => d.id === 'x-deal' && d.seller === pcGanesh.id));

// 7. sent marks keep the later one
pc.sent['2025-01-05|a'] = { at: 10, hash: 1 };
const m2 = mkDb('m'); m2.sent['2025-01-05|a'] = { at: 20, hash: 2 };
syncTo(m2, pc);
assert.strictEqual(pc.sent['2025-01-05|a'].hash, 2);

// 8. bad file
assert.ok(L.mergeSync(pc, 'not json').error);
assert.ok(L.mergeSync(pc, '{"type":"other"}').error);

console.log('sync tests passed');
