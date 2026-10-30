/* Tests du scanner (v54) : nettoyage d'image, PDF valide, découpage en parties, brouillons. */
const vm = require('vm');
const fs = require('fs');
const { creer } = require('./harness');
const ctx = creer(['tests/stub-routes.js', 'tests/stub-scanner.js', 'app-scanner.js']);
let ok_ = 0, ko = 0;
const ok = (c, m) => { if (c) { ok_++; console.log('ok : ' + m); } else { ko++; console.log('ÉCHEC : ' + m); } };
const g = (nom) => vm.runInContext(nom, ctx);
ctx.btoa = (s) => Buffer.from(s, 'latin1').toString('base64');

/* ---- Nettoyage d'image : feuille éclairée de façon inégale (ombre à gauche) avec des lignes de texte ---- */
const W = 400, H = 300, rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const ombre = 150 + (x / W) * 100;                       // éclairage de 150 (gauche) à 250 (droite)
  const texte = (y % 30 >= 12 && y % 30 < 16 && x > 40 && x < 360 && (x % 9) < 6) ? 0.25 : 1;   // « lignes de texte » sombres
  const v = ombre * texte, i = (y * W + x) * 4;
  rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
}
const copie = (a) => new Uint8ClampedArray(a);
const fond = (a, x, y) => a[(y * W + x) * 4];
let bw = copie(rgba); ctx.scTraiter(bw, W, H, 'bw');
ok(fond(bw, 10, 5) > 235 && fond(bw, 390, 5) > 235, 'noir et blanc : papier blanc partout, même dans la zone ombrée');
ok(fond(bw, 100, 14) < 90, 'noir et blanc : le texte reste sombre');
let gr = copie(rgba); ctx.scTraiter(gr, W, H, 'gris');
ok(gr[0] === gr[1] && gr[1] === gr[2] && gr[3] === 255, 'niveaux de gris : canaux égaux, opaque');
let co = copie(rgba); ctx.scTraiter(co, W, H, 'couleur');
ok(fond(co, 10, 5) > 225, 'couleur : l\'ombre est corrigée');
const blanc = new Uint8ClampedArray(64 * 64 * 4).fill(255); ctx.scTraiter(blanc, 64, 64, 'bw');
ok(blanc[0] === 255 && blanc[100] === 255, 'page blanche : reste blanche (pas de bruit)');

/* ---- PDF : structure valide, table xref exacte ---- */
const jpegPng = fs.existsSync('/tmp/test.jpg') ? new Uint8Array(fs.readFileSync('/tmp/test.jpg')) : new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
const pdf = ctx.scPdf([{ jpeg: jpegPng, w: 100, h: 140 }, { jpeg: jpegPng, w: 200, h: 120 }], { titre: 'Dossier Ouédraogo' });
const txt = Buffer.from(pdf).toString('latin1');
ok(txt.startsWith('%PDF-1.4') && txt.trimEnd().endsWith('%%EOF'), 'PDF : en-tête et fin de fichier');
const sx = Number(/startxref\n(\d+)\n/.exec(txt)[1]);
ok(txt.slice(sx, sx + 4) === 'xref', 'PDF : startxref pointe sur la table xref');
const lignes = txt.slice(sx).split('\n'), nb = Number(lignes[1].split(' ')[1]);
let xrefOk = true;
for (let id = 1; id < nb; id++) { const off = Number(lignes[2 + id].slice(0, 10)); if (txt.slice(off, off + String(id).length + 6) !== `${id} 0 obj`) xrefOk = false; }
ok(nb === 3 + 1 + 3 * 2 && xrefOk, 'PDF : 2 pages, chaque entrée xref pointe exactement sur son objet');
ok(/\/Count 2 /.test(txt) && /\/Width 100 \/Height 140/.test(txt), 'PDF : 2 pages avec leurs images');
ok(/MediaBox \[0 0 841\.890 595\.276\]/.test(txt) && /MediaBox \[0 0 595\.276 841\.890\]/.test(txt), 'PDF : portrait pour une page haute, paysage pour une page large');
ok(/\/Title <FEFF/.test(txt), 'PDF : titre encodé (accents conservés)');
if (process.env.PDF_SORTIE) fs.writeFileSync(process.env.PDF_SORTIE, pdf);

/* ---- Utilitaires ---- */
const b64 = ctx.scBase64(new Uint8Array([72, 101, 108, 108, 111, 255, 0, 1]));
ok(Buffer.from(b64, 'base64').equals(Buffer.from([72, 101, 108, 108, 111, 255, 0, 1])), 'base64 : aller-retour exact');
const gros = new Uint8Array(200000).map((_, i) => i % 251);
ok(Buffer.from(ctx.scBase64(gros), 'base64').equals(Buffer.from(gros)), 'base64 : gros fichier (par blocs)');
const parts = ctx.scDecouper([400, 400, 400, 400, 400], 1500, 100);
ok(JSON.stringify(parts) === '[[0,1,2],[3,4]]', 'découpage en parties qui tiennent dans la limite (ordre conservé)');
ok(JSON.stringify(ctx.scDecouper([5000], 1000, 100)) === '[[0]]', 'une page plus grosse que la limite forme sa propre partie');
ok(JSON.stringify(ctx.scDecouper([], 1000)) === '[]', 'aucune page : aucune partie');
ok(JSON.stringify(ctx.scDeplacer([1, 2, 3], 0, 1)) === '[2,1,3]' && JSON.stringify(ctx.scDeplacer([1, 2, 3], 0, -1)) === '[1,2,3]' && JSON.stringify(ctx.scDeplacer([1, 2, 3], 2, -1)) === '[1,3,2]', 'réorganiser les pages (les bords ne bougent pas)');
ok(g('scSlug')('Dossier de M. Ouédraogo — 2026') === 'dossier-de-m-ouedraogo-2026' && g('scSlug')('') === 'scan', 'nom de fichier propre');

/* ---- Brouillons, plan du sommaire ---- */
const b = ctx.scNouveauBrouillon('dossier');
ok(b.mode === 'dossier' && b.sommaire === true && b.documents.length === 1 && b.aspect === 'bw', 'nouveau dossier : sommaire activé, aspect noir et blanc');
ok(ctx.scNouveauBrouillon('simple').sommaire === false, 'document simple : pas de sommaire');
b.documents = [{ id: 'a', titre: 'Acte de naissance', pages: [{}, {}] }, { id: 'b', titre: '', pages: [] }, { id: 'c', titre: 'Certificat', pages: [{}] }];
ok(g('scNbPages')(b) === 3, 'nombre de pages du dossier');
const plan = ctx.scPlan(b);
ok(plan.length === 2 && plan[0].de === 2 && plan[0].a === 3 && plan[1].de === 4 && plan[1].titre === 'Certificat', 'sommaire : la page 1 est la garde, documents vides ignorés');
b.sommaire = false; ok(ctx.scPlan(b)[0].de === 1, 'sans sommaire : les documents commencent à la page 1');
ok(ctx.ROUTE_ROLES['#/scanner'].includes('ministere') && ctx.ROUTE_ROLES['#/scanner'].includes('directeur') && ctx.ROUTE_ROLES['#/scanner'].includes('ceb') && ctx.ROUTE_ROLES['#/scanner'].includes('service_min'), 'accès : du ministère jusqu\'aux écoles (et services/bureaux)');

console.log(`\n${ok_} réussi(s), ${ko} échec(s)`);
if (ko) { console.log('Des tests échouent.'); process.exit(1); }
console.log('Tous les tests passent.');
