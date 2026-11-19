# Keval Brokers: project context (read this first)

Desktop app (Electron, Windows) for a commodity brokerage in Upleta, Kathiyawad, Gujarat.
Built for the user's brother, Keval Chetankumar Bakhai ("Keval Brokers"). He brokers groundnut,
soyabean, cotton and castor between sellers and buyers. He used to write brokerage bills by hand in MS Word.
The app replaces that: daily deal entry, WhatsApp messages to both sides, and brokerage bills.

Current version: 0.2. Plain JavaScript, no framework, no build step. Offline only.

## What the business does

- Sellers and buyers are different parties. Example sellers: Vrundavan Trading (Kalavad). Example buyers: Ganesh Oil Industries, Balaji Proteins (both Upleta).
- The broker is paid brokerage per bag. The yearly bill goes to the party that pays (in the sample, the seller Vrundavan). The bill lists every deal: date, other party, city, bags, rate, brokerage.
- Brokerage rule seen in the real bill: bags x Rs 2, rounded DOWN to the nearest Rs 5. 350 bags = 525, 700 = 1050, 325 = 487.5 -> 485, 425 = 637.5 -> 635, 400 = 600. The 13 deals of the 2024-25 bill total Rs 7,495 (this is a test).
- Bill layout (reproduced in the app): broker name, mobile and address top left; bank, SB A/C, IFSC, PAN top right; big firm name; party name underlined; "BROKERAGE BILL 2024-25"; table DATE | PARTY NAME | CITY | BAG | RATE | RS.; TOTAL row. The rate column shows things like `24,000/500/-` where "/500" is an extra (exact meaning not yet confirmed).
- Deals are entered at the end of the day (EOD), then a WhatsApp message goes to both the seller and the buyer.
- Quantity is counted in bags, trucks, small cargo vans etc., NOT quintal or ton.
- One truck can carry two groundnut varieties, G20 and Jini, at two different prices in the same deal. The bag count of each variety is only known after unloading. Brokerage is the same for both varieties (per bag).
- Rates, quantity or other details can change later in the day, so deals must be editable.

## Decisions already made

- WhatsApp: "click-to-send" only. The app opens `https://wa.me/<91number>?text=<message>` and the user presses Send in WhatsApp. It is free, safe, no ban risk. The Official WhatsApp Cloud API (fully automatic, needs Meta verification and costs per message) is a possible later upgrade. Unofficial automation (whatsapp-web.js) was rejected because the number could be banned.
- Storage: a JSON file (not SQLite) in Electron's userData folder, atomic write, one backup per day, last 60 kept. Chosen because SQLite needs native compilation on Windows. Can migrate later.
- Messages are one per party per day, listing all that party's deals. Default language Gujarati, English selectable in Settings.
- Sample data (the real 2024-25 Vrundavan bill) can be loaded from Settings. Phone numbers in it are blank.
- Rate unit (per 20 kg, quintal, ton) was NOT confirmed, so it is not shown anywhere.

## Data model (db saved as data.json)

```
db = { version: 2, settings, parties: [], deals: [], sent: {} }
settings = { lang: 'gu'|'en', qtyUnits: [{id,en,gu}], broker: { firm, name, mobile, address, bank, account, ifsc, pan } }
party = { id, name, city, phone, role: 'seller'|'buyer'|'both', charge: bool, rule: { perBag, roundStep } }
deal  = { id, date 'YYYY-MM-DD', seller, buyer, commodity: groundnut|soyabean|cotton|castor,
          qty, qtyUnit ('bags' | truck | small-cargo-van | tempo | tractor | custom),
          lines: [{ variety, rate, bags? }],   // 1 line normally, 2+ for G20 + Jini
          extra (text), note (text), actualBags (number|null), createdAt }
sent = { 'YYYY-MM-DD|partyId': { at, hash } }  // hash of the message text when sent
```

- Bags of a deal = sum of `lines[].bags` if all lines have it, else `actualBags`, else `qty` if the unit is bags, else unknown (deal is "pending / awaiting unload").
- Pending deals are left out of bills (the Bills screen shows how many).
- `charge` on a party decides whether it pays brokerage; each party has its own rate rule.
- Old deals (v1 had `bags` and `rate` on the deal) are migrated on load by `Logic.migrateDeal`.
- A message shows "Sent", "Not sent" or "Changed since sent" by comparing the stored hash with the current text. After unloading or editing, the button becomes "Send update".

## Screens

- **Today**: date navigation; a summary strip (deals, bags counted, awaiting unload across all days, messages sent, brokerage); "New deal" form (seller, buyer, commodity, quantity + type, one rate row per variety with G20 / Jini quick buttons and "Add another rate", extra, note); "Awaiting unload" panel (enter bags per variety, total fills in, or total only); the day's deals as a ruled ledger with Edit / Bags / Delete; WhatsApp message cards (editable text in a chat bubble, Send on WhatsApp / Copy / Reset text, "Send next unsent").
- **Parties**: add, edit, delete (not allowed if the party has deals). WhatsApp number, role, brokerage rule.
- **Bills**: party + period (default financial year, 1 Apr to 31 Mar), paper-style preview, Save as PDF.
- **Settings**: message language, editable quantity types ("English | ગુજરાતી" per line, bags fixed), bill details, open backup folder, load sample data.

Editing a deal: the form switches to "Edit deal" with a date field. Changing rates, extra, note, parties keeps counted bags and the per-variety split. Changing quantity or its type clears them (back to awaiting unload). Navigating away drops an edit; a half-typed new deal is restored after editing.

## Files

```
package.json            scripts: start, test, dist (electron-builder, Windows NSIS)
main.js                 Electron main: window, JSON store with daily backups, IPC (db:load, db:save, wa:open, bill:pdf, backup:open)
preload.js              contextBridge `window.api` (load, save, openWhatsApp, savePdf, openBackups)
renderer/index.html     shell: sidebar + #view, strict CSP
renderer/styles.css     the whole design
renderer/logic.js       pure logic (UMD, works in browser and Node): brokerage, dates, phone, messages, bills, units, migration, sample data
renderer/app.js         UI and events (render functions per screen, delegated click/submit/input/change handlers)
test/logic.test.js      brokerage maths, bill total 7,495, G20 + Jini truck, messages, migration, units
test/smoke.test.js      jsdom run of the real renderer with a stubbed window.api, full EOD flow, editing, dialog
README.md               user-facing run instructions
```

Run: `npm install`, `npm start`. Tests: `npm test` (or `node test/logic.test.js`, `node test/smoke.test.js`). Windows installer: `npm run dist`.

## Rules for working on this code (learned the hard way)

- CSP is `default-src 'self'; style-src 'self'`: NO inline `style="..."` attributes and no inline `<style>`/scripts in the app. Setting `element.style.x` from JS is fine. Smoke test checks for `style="`.
- NEVER use native `confirm()`/`alert()`: in Electron on Windows they can leave text boxes unresponsive. Use `askConfirm()` (in-app dialog) and `toast()`.
- Security: contextIsolation on, sandbox on, nodeIntegration off; only `https://wa.me/<digits>?text=` links may be opened; the PDF window has JavaScript disabled.
- Escape every inserted value with `esc()`.
- `syncDraft()` must run before any redraw of the deal form so typed values are not lost.
- Fonts are Windows system fonts (Segoe UI, Nirmala UI for Gujarati, Bahnschrift for numbers). No web fonts, works offline.
- Design: "trader's ledger": navy sidebar, ruled blue lines, a red margin line on the deals ledger, jute accents, WhatsApp-green bubbles. Keep it consistent. Sentence case labels, plain wording.
- Update both `logic.test.js` and `smoke.test.js` when behaviour changes, and run them before handing work back.
- The user wants ONLY the changed files sent back (not the whole zip), with a note of which folder each goes in.
- Screens can be checked by rendering a standalone HTML copy (real renderer + stub api + sample data) with `google-chrome --headless=new --screenshot`. Note: build the HTML with function replacers in `String.replace`, because `$$` in the code is a special replacement pattern.

## Open questions (not yet answered by the user)

1. What does "/500" (extra) in the bill's rate column mean, and what is the rate unit (per 20 kg, quintal, ton)? Currently a free-text "Extra on rate" field, and no unit shown.
2. Does brokerage ever apply to the buyer too? (Supported per party via "Pays brokerage"; only Vrundavan is set to Yes in the sample.)
3. Does the brokerage rate differ by commodity (cotton by bale, castor by quintal)? A per-commodity rate is not built yet.
4. Is "છોટા હાથી" the right Gujarati for "small cargo van"? Editable in Settings.

## Ideas for next steps

Daily rate broadcast to selected parties; paid / pending ledger with payments received; party-wise and commodity-wise reports (monthly, yearly); Gujarati party names in messages; per-commodity brokerage rules; Windows installer and auto backup to Google Drive; optional upgrade to the WhatsApp Cloud API; stricter validation (duplicate deals); printing the day's register.

## Known limits

- Only tested with jsdom and headless Chrome renders; the Electron window itself and real WhatsApp sending have not been tested by the assistant.
- Windows is the only target. The data file is local to one computer; there is no sync between machines.
