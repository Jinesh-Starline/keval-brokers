// Copies the shared renderer files into pwa/ so the phone app always uses the same code as the computer app.
// Bank identifiers baked into logic.js are blanked in the copy, because pwa/ is hosted on the internet.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'renderer');
const out = path.join(root, 'pwa');

['logic.js', 'app.js', 'styles.css'].forEach((f) => fs.copyFileSync(path.join(src, f), path.join(out, f)));

const file = path.join(out, 'logic.js');
let n = 0;
const text = fs.readFileSync(file, 'utf8').replace(/(\b(?:account|ifsc|pan):\s*)'[^']*'/g, (_, key) => {
  n++;
  return key + "''";
});
if (n !== 3) throw new Error('Expected to blank 3 bank fields in logic.js, found ' + n + '. Check scripts/build-pwa.js.');
fs.writeFileSync(file, text);
console.log('pwa/ updated. Bank account, IFSC and PAN blanked in pwa/logic.js.');
