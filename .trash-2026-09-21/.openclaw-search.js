const fs = require('fs');
const file = process.argv[2];
const pats = process.argv[3].split(',').map(s => new RegExp(s, 'i'));
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
lines.forEach((l, i) => { if (pats.some(p => p.test(l))) console.log((i + 1) + ': ' + l); });
