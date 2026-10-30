const { creer } = require('./harness');
const ctx = creer(['app-word.js']);
const ok = (c, m) => { if (!c) { console.error('ECHEC :', m); process.exit(1); } console.log('ok :', m); };
ok(ctx.wordCrc32(new TextEncoder().encode('123456789')) === 0xCBF43926, 'CRC32 conforme à la valeur de référence');
ctx.Blob = Blob;
const b = ctx.wordAssembler('<w:p/>', [], 'landscape');
ok(b.size > 500, 'archive .docx produite');
