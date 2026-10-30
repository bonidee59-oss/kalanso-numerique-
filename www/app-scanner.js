/* ============================================================
   app-scanner.js — Scanner de documents (version 54)

   Photographier (ou importer) des documents papier, les redresser et les nettoyer comme avec un scanner,
   puis les assembler en PDF :
     • « Document simple » : un seul document (une ou plusieurs pages) ;
     • « Dossier complet » : plusieurs documents (acte de naissance, certificat…) regroupés dans un seul PDF,
       avec une page de sommaire.
   Le PDF peut être envoyé par le circuit des documents (du ministère jusqu'aux écoles), partagé (WhatsApp, e-mail…)
   ou enregistré. Un dossier trop gros pour un envoi est découpé automatiquement en parties.
   Tout se passe sur l'appareil, sans bibliothèque externe, hors ligne. Les brouillons restent sur l'appareil
   jusqu'à l'envoi (base locale « ecole-scans »).
   ============================================================ */

const SC_QUALITES = {
  leger: { label: 'Léger (messagerie)', essais: [[1240, 0.5], [1100, 0.45], [1000, 0.4], [900, 0.36]] },
  standard: { label: 'Standard', essais: [[1500, 0.62], [1300, 0.55], [1150, 0.48], [1000, 0.42], [900, 0.36]] },
  haute: { label: 'Haute (impression)', essais: [[1754, 0.78], [1600, 0.7], [1400, 0.6], [1240, 0.5], [1000, 0.42]] }
};
const SC_ASPECTS = { bw: 'Document (noir et blanc)', gris: 'Niveaux de gris', couleur: 'Couleur' };
const SC_MAX_ORIG = 2000;     // côté maximal de la photo conservée dans le brouillon
const SC_ROLES = ['directeur', 'directeur_adjoint', 'secretaire', 'ceb', 'dpeppnf', 'dreppnf', 'ministere', 'bureau', 'service', 'service_reg', 'service_min'];

/* ============ Traitement d'image (fonctions pures, testables) ============ */
function scPercentile(hist, total, p) {
  let acc = 0; const cible = total * p;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cible) return i; }
  return 255;
}
/* Luminosité du papier, bloc par bloc (80e centile), lissée : sert à supprimer ombres et éclairage inégal. */
function scGrille(gray, w, h, bloc) {
  const gw = Math.max(1, Math.ceil(w / bloc)), gh = Math.max(1, Math.ceil(h / bloc)), val = new Float32Array(gw * gh), hist = new Uint32Array(256);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    hist.fill(0); let n = 0;
    const x1 = Math.min(w, (bx + 1) * bloc), y1 = Math.min(h, (by + 1) * bloc);
    for (let y = by * bloc; y < y1; y++) { let i = y * w + bx * bloc; for (let x = bx * bloc; x < x1; x++, i++) { hist[gray[i]]++; n++; } }
    val[by * gw + bx] = scPercentile(hist, n, 0.8);
  }
  const lisse = new Float32Array(gw * gh);   // maximum 3×3 : un bloc entièrement couvert d'encre ne fait pas « noircir » la zone
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) m = Math.max(m, val[yy * gw + xx]); }
    lisse[y * gw + x] = m;
  }
  return { gw, gh, val: lisse, bloc };
}
function scFondEn(g, x, y) {
  let gx = (x + 0.5) / g.bloc - 0.5, gy = (y + 0.5) / g.bloc - 0.5;
  gx = Math.max(0, Math.min(g.gw - 1, gx)); gy = Math.max(0, Math.min(g.gh - 1, gy));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(g.gw - 1, x0 + 1), y1 = Math.min(g.gh - 1, y0 + 1), fx = gx - x0, fy = gy - y0;
  const a = g.val[y0 * g.gw + x0], b = g.val[y0 * g.gw + x1], c = g.val[y1 * g.gw + x0], d = g.val[y1 * g.gw + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
/* Nettoie une image RGBA en place. aspect : 'bw' (papier blanc, encre noire), 'gris', 'couleur'. */
function scTraiter(rgba, w, h, aspect) {
  const n = w * h, gray = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  const hist = new Uint32Array(256);
  if (aspect === 'gris') {
    for (let i = 0; i < n; i++) hist[gray[i]]++;
    const lo = Math.min(scPercentile(hist, n, 0.01), 120), hi = Math.max(scPercentile(hist, n, 0.99), lo + 40), k = 255 / (hi - lo);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = Math.max(0, Math.min(255, (gray[i] - lo) * k)); rgba[j] = rgba[j + 1] = rgba[j + 2] = v; rgba[j + 3] = 255; }
    return;
  }
  const g = scGrille(gray, w, h, Math.max(24, Math.round(Math.max(w, h) / 40)));
  const plat = new Uint8Array(n);                         // luminosité après suppression de l'éclairage inégal
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const f = 255 / Math.max(scFondEn(g, x, y), 70);
    plat[i] = Math.min(255, gray[i] * f);
  }
  if (aspect === 'bw') {
    for (let i = 0; i < n; i++) hist[plat[i]]++;
    const lo = Math.min(scPercentile(hist, n, 0.015), 120), hi = 235, k = 255 / (hi - lo);
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = Math.max(0, Math.min(255, (plat[i] - lo) * k)); rgba[j] = rgba[j + 1] = rgba[j + 2] = v; rgba[j + 3] = 255; }
    return;
  }
  // couleur : même correction d'éclairage appliquée aux trois canaux, puis léger contraste
  for (let y = 0, i = 0, j = 0; y < h; y++) for (let x = 0; x < w; x++, i++, j += 4) {
    const f = 255 / Math.max(scFondEn(g, x, y), 70);
    for (let c = 0; c < 3; c++) rgba[j + c] = Math.max(0, Math.min(255, (rgba[j + c] * f - 10) * (255 / 230)));
    rgba[j + 3] = 255;
  }
}

/* ============ PDF : pages = images JPEG ============ */
const scHex16 = (s) => { let h = 'FEFF'; for (const ch of String(s || '')) { const c = ch.codePointAt(0); if (c > 0xFFFF) { const d = c - 0x10000; h += (0xD800 + (d >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (d & 0x3FF)).toString(16).padStart(4, '0'); } else h += c.toString(16).padStart(4, '0'); } return '<' + h.toUpperCase() + '>'; };
/* pages : [{ jpeg: Uint8Array, w, h }] → Uint8Array du fichier PDF. Chaque page est un A4 (portrait ou paysage selon l'image). */
function scPdf(pages, meta) {
  const enc = new TextEncoder(), parts = [], off = [], A4 = [595.276, 841.89];
  let pos = 0;
  const put = (u8) => { parts.push(u8); pos += u8.length; };
  const txt = (s) => put(enc.encode(s));
  const debut = (id) => { off[id] = pos; txt(`${id} 0 obj\n`); };
  const n = pages.length, tot = 3 + 3 * n;
  put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // %PDF-1.4 + octets binaires
  debut(1); txt('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  debut(2); txt(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${4 + 3 * i} 0 R`).join(' ')}] >>\nendobj\n`);
  const d = new Date(), z = (v) => String(v).padStart(2, '0');
  debut(3); txt(`<< /Title ${scHex16((meta && meta.titre) || 'Document scanné')} /Producer ${scHex16('École Numérique')} /CreationDate (D:${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}) >>\nendobj\n`);
  pages.forEach((p, i) => {
    const page = 4 + 3 * i, cont = page + 1, img = page + 2;
    const paysage = p.w > p.h, W = paysage ? A4[1] : A4[0], H = paysage ? A4[0] : A4[1];
    const k = Math.min(W / p.w, H / p.h), iw = p.w * k, ih = p.h * k, x = (W - iw) / 2, y = (H - ih) / 2;
    const flux = `q ${iw.toFixed(3)} 0 0 ${ih.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im0 Do Q`;
    debut(page); txt(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(3)} ${H.toFixed(3)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${cont} 0 R >>\nendobj\n`);
    debut(cont); txt(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream\nendobj\n`);
    debut(img); txt(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    put(p.jpeg); txt('\nendstream\nendobj\n');
  });
  const xref = pos;
  let t = `xref\n0 ${tot + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= tot; id++) t += String(off[id]).padStart(10, '0') + ' 00000 n \n';
  txt(t + `trailer\n<< /Size ${tot + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let o = 0;
  parts.forEach((u) => { out.set(u, o); o += u.length; });
  return out;
}
function scBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
/* Découpe les pages en parties dont chacune tient dans `budget` octets (surcoût du PDF compris). */
function scDecouper(tailles, budget, surcout) {
  const sur = surcout || 1500, parties = [];
  let cur = [], somme = 0;
  tailles.forEach((t, i) => {
    if (cur.length && somme + t + sur > budget) { parties.push(cur); cur = []; somme = 0; }
    cur.push(i); somme += t + sur;
  });
  if (cur.length) parties.push(cur);
  return parties;
}
function scDeplacer(liste, i, delta) {
  const j = i + delta;
  if (i < 0 || i >= liste.length || j < 0 || j >= liste.length) return liste;
  const r = liste.slice(); const [x] = r.splice(i, 1); r.splice(j, 0, x); return r;
}
const scSlug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'scan';
const scId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function scNouveauBrouillon(mode) {
  return { id: 'sc-' + scId(), mode, titre: '', categorie: '', reference: '', aspect: 'bw', qualite: 'standard', sommaire: mode === 'dossier', documents: [{ id: scId(), titre: '', pages: [] }], maj: Date.now() };
}
const scNbPages = (b) => b.documents.reduce((s, d) => s + d.pages.length, 0);
/* Plan du sommaire : page de garde = page 1, les documents suivent. */
function scPlan(b) {
  let page = b.sommaire ? 2 : 1; const plan = [];
  b.documents.forEach((d, i) => { if (!d.pages.length) return; plan.push({ titre: d.titre || `Document ${i + 1}`, de: page, a: page + d.pages.length - 1 }); page += d.pages.length; });
  return plan;
}

/* ============ Brouillons (base locale séparée) ============ */
const scDB = {
  _p: null,
  ouvrir() {
    if (!this._p) this._p = new Promise((res, rej) => {
      const r = indexedDB.open('ecole-scans', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('brouillons', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this._p;
  },
  async op(mode, f) { const db = await this.ouvrir(); return new Promise((res, rej) => { const t = db.transaction('brouillons', mode), s = t.objectStore('brouillons'), r = f(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
  lister() { return this.op('readonly', (s) => s.getAll()).then((l) => (l || []).sort((a, b) => b.maj - a.maj)); },
  lire(id) { return this.op('readonly', (s) => s.get(id)); },
  ecrire(b) { return this.op('readwrite', (s) => s.put(b)); },
  supprimer(id) { return this.op('readwrite', (s) => s.delete(id)); }
};
let _scTimer = null;
function scSauver() { clearTimeout(_scTimer); _scTimer = setTimeout(() => { if (SC.b) { SC.b.maj = Date.now(); scDB.ecrire(SC.b).catch((e) => console.warn('Brouillon non enregistré', e)); } }, 600); }

/* ============ Image : chargement, rotation, rognage, nettoyage ============ */
const SC = { b: null, imgs: new Map(), vign: new Map() };
const scCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
function scChargerSrc(src) { return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = src; }); }
async function scImage(page) {
  if (!SC.imgs.has(page.id)) SC.imgs.set(page.id, await scChargerSrc(page.orig));
  return SC.imgs.get(page.id);
}
/* Fichier image (photo, galerie) → page du brouillon (JPEG réduit à SC_MAX_ORIG). */
async function scPageDepuisFichier(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await scChargerSrc(url);
    const k = Math.min(1, SC_MAX_ORIG / Math.max(img.naturalWidth, img.naturalHeight));
    const c = scCanvas(img.naturalWidth * k, img.naturalHeight * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return { id: scId(), orig: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height, rot: 0, crop: { l: 0, t: 0, r: 0, b: 0 } };
  } finally { URL.revokeObjectURL(url); }
}
async function scRendrePage(page, aspect, maxCote, traiter = true) {
  const img = await scImage(page);
  const rot = (((page.rot || 0) % 360) + 360) % 360, iw = img.naturalWidth, ih = img.naturalHeight, tourne = rot % 180 !== 0;
  const rw = tourne ? ih : iw, rh = tourne ? iw : ih;
  const tmp = scCanvas(rw, rh), tx = tmp.getContext('2d');
  tx.translate(rw / 2, rh / 2); tx.rotate(rot * Math.PI / 180); tx.drawImage(img, -iw / 2, -ih / 2);
  const c = page.crop || {}, l = c.l || 0, t = c.t || 0, r = c.r || 0, b = c.b || 0;
  const sx = Math.round(rw * l), sy = Math.round(rh * t), sw = Math.max(8, Math.round(rw * (1 - l - r))), sh = Math.max(8, Math.round(rh * (1 - t - b)));
  const k = Math.min(1, maxCote / Math.max(sw, sh)), out = scCanvas(sw * k, sh * k), ox = out.getContext('2d');
  ox.drawImage(tmp, sx, sy, sw, sh, 0, 0, out.width, out.height);
  if (traiter) { const d = ox.getImageData(0, 0, out.width, out.height); scTraiter(d.data, out.width, out.height, aspect); ox.putImageData(d, 0, 0); }
  return out;
}
const scJpeg = (canvas, q) => new Promise((ok) => canvas.toBlob(async (b) => ok(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', q));
async function scVignette(page, aspect) {
  const cle = [page.id, page.rot || 0, JSON.stringify(page.crop || {}), aspect].join('|');
  if (!SC.vign.has(cle)) SC.vign.set(cle, (await scRendrePage(page, aspect, 360)).toDataURL('image/jpeg', 0.6));
  return SC.vign.get(cle);
}

/* Page de garde / sommaire du dossier (dessinée sur un canvas A4 à 150 dpi). */
function scPageSommaire(b, plan, partie) {
  const c = scCanvas(1240, 1754), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#111';
  const u = (typeof currentUser !== 'undefined' && currentUser) || {};
  const coupe = (t, max) => { const m = []; let l = ''; String(t).split(/\s+/).forEach((mot) => { const essai = l ? l + ' ' + mot : mot; if (x.measureText(essai).width > max && l) { m.push(l); l = mot; } else l = essai; }); if (l) m.push(l); return m; };
  let y = 150;
  x.font = 'bold 34px sans-serif'; x.fillStyle = '#555'; x.fillText(String(u.structure || u.nom || '').toUpperCase().slice(0, 60), 90, y); y += 70;
  x.fillStyle = '#111'; x.font = 'bold 60px sans-serif';
  coupe(b.titre || 'Dossier', 1060).slice(0, 4).forEach((l) => { x.fillText(l, 90, y); y += 76; });
  y += 20; x.font = '30px sans-serif'; x.fillStyle = '#444';
  x.fillText(`${plan.length} document(s) · ${plan.length ? plan[plan.length - 1].a : 0} page(s)${partie ? ' · ' + partie : ''}`, 90, y); y += 44;
  if (b.reference) { x.fillText('Référence : ' + b.reference, 90, y); y += 44; }
  x.fillText('Établi le ' + new Date().toLocaleDateString('fr-FR'), 90, y); y += 90;
  x.fillStyle = '#111'; x.font = 'bold 36px sans-serif'; x.fillText('Sommaire', 90, y); y += 30;
  x.strokeStyle = '#999'; x.lineWidth = 2; x.beginPath(); x.moveTo(90, y); x.lineTo(1150, y); x.stroke(); y += 56;
  x.font = '32px sans-serif';
  plan.slice(0, 22).forEach((p, i) => {
    x.fillStyle = '#111'; const t = coupe(`${i + 1}. ${p.titre}`, 800)[0] || '';
    x.fillText(t, 90, y); x.textAlign = 'right'; x.fillStyle = '#555'; x.fillText(p.de === p.a ? `p. ${p.de}` : `p. ${p.de}–${p.a}`, 1150, y); x.textAlign = 'left'; y += 56;
  });
  return c;
}

/* Construit les pages JPEG du brouillon. Si `budget` est donné, la qualité baisse par paliers jusqu'à ce que tout tienne. */
async function scEncoderPages(b, budget, progres) {
  const pages = [];
  b.documents.forEach((d) => d.pages.forEach((p) => pages.push(p)));
  const essais = SC_QUALITES[b.qualite || 'standard'].essais;
  let res = null;
  for (let e = 0; e < essais.length; e++) {
    const [maxCote, q] = essais[e], jpegs = [];
    for (let i = 0; i < pages.length; i++) {
      if (progres) progres(i + 1, pages.length, e);
      const c = await scRendrePage(pages[i], b.aspect, maxCote);
      jpegs.push({ jpeg: await scJpeg(c, q), w: c.width, h: c.height });
    }
    res = jpegs;
    const total = jpegs.reduce((s, j) => s + j.jpeg.length, 0);
    if (!budget || total + 1500 * jpegs.length <= budget) break;
  }
  return res;
}
async function scPdfParties(b, budget, progres) {
  const jpegs = await scEncoderPages(b, budget, progres);
  const plan = scPlan(b);
  let couverte = null;
  const parties = scDecouper(jpegs.map((j) => j.jpeg.length), budget ? Math.max(1, budget - (b.sommaire ? 120000 : 0)) : Infinity);
  const nom = scSlug(b.titre);
  const out = [];
  for (let k = 0; k < parties.length; k++) {
    const lot = parties[k].map((i) => jpegs[i]);
    const etiquette = parties.length > 1 ? `partie ${k + 1}/${parties.length}` : '';
    if (b.sommaire && k === 0) {
      const sc = scPageSommaire(b, plan, etiquette); couverte = { jpeg: await scJpeg(sc, 0.8), w: sc.width, h: sc.height };
      lot.unshift(couverte);
    }
    out.push({ nom: `${nom}${parties.length > 1 ? `-partie-${k + 1}-sur-${parties.length}` : ''}.pdf`, bytes: scPdf(lot, { titre: b.titre || 'Document scanné' }), pages: lot.length, etiquette });
  }
  return out;
}

/* ============ Interface ============ */
function scCss() {
  if (document.getElementById('sc-css')) return;
  const s = document.createElement('style'); s.id = 'sc-css';
  s.textContent = `.sc-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.sc-page{border:1px solid var(--border);border-radius:10px;padding:6px;text-align:center;background:var(--surface,transparent)}
.sc-page img{width:100%;aspect-ratio:3/4;object-fit:contain;background:#eee;border-radius:6px}
.sc-page .sc-bt{display:flex;justify-content:space-between;gap:2px;margin-top:4px}
.sc-page .sc-bt button{flex:1;padding:6px 0;font-size:15px}
.sc-barre{position:sticky;bottom:0;background:var(--surface,#fff);border-top:1px solid var(--border);padding:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;z-index:5}
.sc-doc{border:1px solid var(--border);border-radius:12px;padding:10px;margin-bottom:12px}
.sc-rogn{position:relative;display:inline-block;max-width:100%}.sc-rogn img{max-width:100%;max-height:50vh;display:block}
.sc-rogn i{position:absolute;background:rgba(0,0,0,.45);pointer-events:none}`;
  document.head.appendChild(s);
}
const scTaille = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.round(n / 1024) + ' Ko');

async function scAccueil(root) {
  const liste = await scDB.lister().catch(() => []);
  root.innerHTML = `
    <h2 style="margin:0 0 6px;">Scanner un document</h2>
    <p class="text-soft" style="margin:0 0 12px;">Photographiez vos documents papier : ils sont redressés, nettoyés et assemblés en PDF, puis envoyés à votre hiérarchie ou à vos écoles.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <button class="btn btn-primary" id="sc-simple" style="padding:18px 8px;">📄 Document simple<br><small>1 document, 1 ou plusieurs pages</small></button>
      <button class="btn btn-primary" id="sc-dossier" style="padding:18px 8px;">🗂 Dossier complet<br><small>plusieurs documents + sommaire</small></button>
    </div>
    ${liste.length ? `<h3 style="margin:0 0 6px;">Brouillons sur cet appareil</h3>${liste.map((b) => `<div class="card" style="padding:10px;margin-bottom:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;"><div style="flex:1;min-width:160px;"><b>${esc(b.titre || (b.mode === 'dossier' ? 'Dossier sans titre' : 'Document sans titre'))}</b><div class="text-soft" style="font-size:12px;">${b.mode === 'dossier' ? 'Dossier' : 'Document'} · ${scNbPages(b)} page(s) · ${new Date(b.maj).toLocaleString('fr-FR')}</div></div><button class="btn btn-sm" data-reprendre="${esc(b.id)}">Reprendre</button><button class="btn btn-sm btn-danger" data-suppr="${esc(b.id)}">Supprimer</button></div>`).join('')}` : ''}
    <p class="text-soft" style="font-size:12px;">Les scans restent sur cet appareil (même sans internet) jusqu'à ce que vous les supprimiez.</p>`;
  const ouvrir = (b) => { SC.b = b; SC.imgs.clear(); SC.vign.clear(); scEditeur(root); };
  $('#sc-simple', root).onclick = () => ouvrir(scNouveauBrouillon('simple'));
  $('#sc-dossier', root).onclick = () => ouvrir(scNouveauBrouillon('dossier'));
  $all('[data-reprendre]', root).forEach((bt) => { bt.onclick = async () => { const b = await scDB.lire(bt.dataset.reprendre); if (b) ouvrir(b); }; });
  $all('[data-suppr]', root).forEach((bt) => { bt.onclick = async () => { if (await confirmDialog('Supprimer ce brouillon et toutes ses pages ?')) { await scDB.supprimer(bt.dataset.suppr); scAccueil(root); } }; });
}

function scEditeur(root) {
  scCss();
  const b = SC.b, dossier = b.mode === 'dossier', cats = (typeof RES_CATEGORIES !== 'undefined') ? RES_CATEGORIES : [];
  const nbp = scNbPages(b);
  root.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
      <button class="btn btn-sm" id="sc-retour">← Brouillons</button>
      <h2 style="margin:0;flex:1;font-size:18px;">${dossier ? 'Dossier complet' : 'Document simple'}</h2>
    </div>
    <div class="card" style="padding:10px;margin-bottom:12px;">
      <div class="form-grid">
        <div class="field full"><label>${dossier ? 'Titre du dossier' : 'Titre du document'} *</label><input id="sc-titre" value="${esc(b.titre)}" placeholder="${dossier ? 'Ex : Dossier de mutation de M. Ouédraogo' : 'Ex : Rapport de rentrée 2026'}"></div>
        <div class="field"><label>Type de document</label><select id="sc-cat">${cats.map((c) => `<option ${c === b.categorie ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>En réponse à / référence</label><input id="sc-ref" value="${esc(b.reference)}" placeholder="N° de la demande"></div>
        <div class="field"><label>Aspect</label><select id="sc-aspect">${Object.entries(SC_ASPECTS).map(([k, v]) => `<option value="${k}" ${k === b.aspect ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field"><label>Qualité / taille</label><select id="sc-qual">${Object.entries(SC_QUALITES).map(([k, v]) => `<option value="${k}" ${k === b.qualite ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
        ${dossier ? `<div class="field full"><label style="display:flex;gap:8px;align-items:center;font-weight:400;"><input type="checkbox" id="sc-somm" ${b.sommaire ? 'checked' : ''}> Ajouter une page de sommaire en tête du PDF</label></div>` : ''}
      </div>
    </div>
    <div id="sc-docs"></div>
    ${dossier ? '<button class="btn" id="sc-add-doc" style="margin-bottom:12px;">+ Ajouter un document au dossier</button>' : ''}
    <div class="sc-barre">
      <b id="sc-compte">${nbp} page(s)</b>
      <span style="flex:1;"></span>
      <button class="btn" id="sc-apercu" ${nbp ? '' : 'disabled'}>Aperçu PDF</button>
      <button class="btn" id="sc-partager" ${nbp ? '' : 'disabled'}>Partager / Enregistrer</button>
      <button class="btn btn-primary" id="sc-envoyer" ${nbp ? '' : 'disabled'}>Envoyer</button>
    </div>`;
  const maj = (k, v) => { b[k] = v; scSauver(); };
  $('#sc-retour', root).onclick = () => { clearTimeout(_scTimer); if (SC.b) scDB.ecrire({ ...SC.b, maj: Date.now() }).catch(() => {}); SC.b = null; scAccueil(root); };
  $('#sc-titre', root).oninput = (e) => maj('titre', e.target.value);
  $('#sc-cat', root).onchange = (e) => maj('categorie', e.target.value);
  $('#sc-ref', root).oninput = (e) => maj('reference', e.target.value);
  $('#sc-aspect', root).onchange = (e) => { maj('aspect', e.target.value); scDessinerDocs(root); };
  $('#sc-qual', root).onchange = (e) => maj('qualite', e.target.value);
  if ($('#sc-somm', root)) $('#sc-somm', root).onchange = (e) => maj('sommaire', e.target.checked);
  if ($('#sc-add-doc', root)) $('#sc-add-doc', root).onclick = () => { b.documents.push({ id: scId(), titre: '', pages: [] }); scSauver(); scDessinerDocs(root); };
  $('#sc-apercu', root).onclick = () => scExporter(root, 'apercu');
  $('#sc-partager', root).onclick = () => scExporter(root, 'partager');
  $('#sc-envoyer', root).onclick = () => scEnvoyer(root);
  scDessinerDocs(root);
}

async function scDessinerDocs(root) {
  const b = SC.b, dossier = b.mode === 'dossier', zone = $('#sc-docs', root);
  if (!zone) return;
  zone.innerHTML = b.documents.map((d, di) => `
    <div class="sc-doc" data-doc="${d.id}">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        ${dossier ? `<input class="sc-dtitre" data-di="${di}" value="${esc(d.titre)}" placeholder="Nom du document ${di + 1} (ex : Acte de naissance)" style="flex:1;font-weight:700;">${b.documents.length > 1 ? `<button class="btn btn-sm btn-danger" data-suppr-doc="${di}">Retirer</button>` : ''}` : `<b style="flex:1;">${d.pages.length} page(s)</b>`}
      </div>
      <div class="sc-grille">${d.pages.map((p, pi) => `<div class="sc-page" data-p="${p.id}"><img alt="Page ${pi + 1}" data-vign="${p.id}"><div class="text-soft" style="font-size:12px;">Page ${pi + 1}</div>
        <div class="sc-bt"><button class="btn btn-sm" data-act="rot" data-di="${di}" data-pi="${pi}" title="Pivoter">↻</button><button class="btn btn-sm" data-act="crop" data-di="${di}" data-pi="${pi}" title="Rogner">✂</button><button class="btn btn-sm" data-act="left" data-di="${di}" data-pi="${pi}" title="Avancer">◀</button><button class="btn btn-sm" data-act="right" data-di="${di}" data-pi="${pi}" title="Reculer">▶</button><button class="btn btn-sm btn-danger" data-act="del" data-di="${di}" data-pi="${pi}" title="Supprimer">✕</button></div></div>`).join('')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button class="btn btn-primary" data-photo="${di}">📷 Photographier</button>
        <button class="btn" data-import="${di}">🖼 Importer des images</button>
      </div>
    </div>`).join('');
  $all('.sc-dtitre', zone).forEach((i) => { i.oninput = () => { b.documents[Number(i.dataset.di)].titre = i.value; scSauver(); }; });
  $all('[data-suppr-doc]', zone).forEach((bt) => { bt.onclick = async () => { const d = b.documents[Number(bt.dataset.supprDoc)]; if (d.pages.length && !(await confirmDialog('Retirer ce document et ses pages ?'))) return; b.documents.splice(Number(bt.dataset.supprDoc), 1); scSauver(); scDessinerDocs(root); }; });
  $all('[data-photo]', zone).forEach((bt) => { bt.onclick = () => scChoisir(root, Number(bt.dataset.photo), true); });
  $all('[data-import]', zone).forEach((bt) => { bt.onclick = () => scChoisir(root, Number(bt.dataset.import), false); });
  $all('[data-act]', zone).forEach((bt) => { bt.onclick = () => scAction(root, bt.dataset.act, Number(bt.dataset.di), Number(bt.dataset.pi)); });
  const c = $('#sc-compte', root); if (c) c.textContent = `${scNbPages(b)} page(s)`;
  ['#sc-apercu', '#sc-partager', '#sc-envoyer'].forEach((s) => { const el = $(s, root); if (el) el.disabled = !scNbPages(b); });
  for (const im of $all('[data-vign]', zone)) {   // vignettes : calculées l'une après l'autre pour ne pas figer le téléphone
    const p = b.documents.flatMap((d) => d.pages).find((x) => x.id === im.dataset.vign);
    if (p) { try { im.src = await scVignette(p, b.aspect); } catch (e) { im.alt = 'Image illisible'; } }
  }
}
function scChoisir(root, di, camera) {
  $all('.sc-input-cache').forEach((x) => x.remove());
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = !camera; inp.className = 'sc-input-cache'; inp.style.display = 'none';
  if (camera) inp.setAttribute('capture', 'environment');
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const files = [...inp.files]; inp.remove(); if (!files.length) return;
    toast(`Traitement de ${files.length} image(s)…`);
    for (const f of files) {
      try { SC.b.documents[di].pages.push(await scPageDepuisFichier(f)); scSauver(); }
      catch (e) { toast('Image illisible : ' + (f.name || '')); }
    }
    await scDessinerDocs(root);
    if (camera) toast('Page ajoutée. Appuyez encore sur « Photographier » pour la page suivante.');
  };
  inp.click();
}
async function scAction(root, act, di, pi) {
  const d = SC.b.documents[di], p = d.pages[pi];
  if (act === 'rot') p.rot = ((p.rot || 0) + 90) % 360;
  else if (act === 'left') d.pages = scDeplacer(d.pages, pi, -1);
  else if (act === 'right') d.pages = scDeplacer(d.pages, pi, 1);
  else if (act === 'del') { if (!(await confirmDialog('Supprimer cette page ?'))) return; d.pages.splice(pi, 1); }
  else if (act === 'crop') { scRogner(root, p); return; }
  scSauver(); scDessinerDocs(root);
}
async function scRogner(root, p) {
  const prev = (await scRendrePage({ ...p, crop: { l: 0, t: 0, r: 0, b: 0 } }, 'couleur', 700, false)).toDataURL('image/jpeg', 0.7);
  const c = { l: 0, t: 0, r: 0, b: 0, ...(p.crop || {}) };
  const champ = (k, lib) => `<div class="field"><label>${lib} : <span id="sr-${k}-v">${Math.round(c[k] * 100)}</span> %</label><input type="range" id="sr-${k}" min="0" max="40" value="${Math.round(c[k] * 100)}"></div>`;
  openModal('Rogner la page', `<div style="text-align:center;"><div class="sc-rogn"><img id="sr-img" src="${prev}"><i id="sr-t"></i><i id="sr-b"></i><i id="sr-l"></i><i id="sr-r"></i></div></div>
    <div class="form-grid" style="margin-top:8px;">${champ('t', 'Haut')}${champ('b', 'Bas')}${champ('l', 'Gauche')}${champ('r', 'Droite')}</div>`, {
    saveLabel: 'Appliquer',
    onSave: async () => { p.crop = { ...c }; scSauver(); scDessinerDocs(root); return true; }
  });
  const trait = () => {
    const st = { t: `top:0;left:0;right:0;height:${c.t * 100}%`, b: `bottom:0;left:0;right:0;height:${c.b * 100}%`, l: `top:0;bottom:0;left:0;width:${c.l * 100}%`, r: `top:0;bottom:0;right:0;width:${c.r * 100}%` };
    ['t', 'b', 'l', 'r'].forEach((k) => { document.getElementById('sr-' + k + '-v').textContent = Math.round(c[k] * 100); });
    const el = { t: document.querySelectorAll('.sc-rogn i')[0], b: document.querySelectorAll('.sc-rogn i')[1], l: document.querySelectorAll('.sc-rogn i')[2], r: document.querySelectorAll('.sc-rogn i')[3] };
    Object.keys(el).forEach((k) => { el[k].setAttribute('style', st[k]); });
  };
  ['t', 'b', 'l', 'r'].forEach((k) => { const r = document.getElementById('sr-' + k); r.oninput = () => { c[k] = Number(r.value) / 100; trait(); }; });
  trait();
}

/* ---- Aperçu / partage / enregistrement ---- */
function scBloc(bytes, nom) { return new File([bytes], nom, { type: 'application/pdf' }); }
async function scExporter(root, mode) {
  const b = SC.b;
  if (!b.titre.trim()) { toast('Donnez un titre au ' + (b.mode === 'dossier' ? 'dossier' : 'document') + '.'); return; }
  toast('Création du PDF…');
  try {
    const parties = await scPdfParties(b, null, (i, n) => { if (n > 6 && i % 5 === 0) toast(`Page ${i}/${n}…`); });
    const f = scBloc(parties[0].bytes, parties[0].nom);
    if (mode === 'partager' && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: b.titre }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(f);
    if (mode === 'apercu') { const w = window.open(url, '_blank'); if (w) { toast(`PDF de ${parties[0].pages} page(s), ${scTaille(f.size)}.`); return; } }
    const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`PDF enregistré : ${f.name} (${scTaille(f.size)}).`);
  } catch (e) { toast('Impossible de créer le PDF : ' + (e.message || e)); }
}

/* ---- Envoi par le circuit des documents ---- */
async function scEnvoyer(root) {
  const b = SC.b;
  if (!b.titre.trim()) { toast('Donnez un titre au ' + (b.mode === 'dossier' ? 'dossier' : 'document') + '.'); return; }
  if (typeof resFormPublier !== 'function') { toast('Envoi indisponible sur cet écran.'); return; }
  const limite = typeof RES_PJ_MAX !== 'undefined' ? RES_PJ_MAX : 1.5 * 1024 * 1024;
  const budget = Math.floor(limite * 0.74);    // le fichier est transmis en base64 (+33 %)
  toast('Préparation de l’envoi…');
  let parties;
  try { parties = await scPdfParties(b, budget, (i, n) => { if (n > 6 && i % 5 === 0) toast(`Page ${i}/${n}…`); }); }
  catch (e) { toast('Impossible de créer le PDF : ' + (e.message || e)); return; }
  const niveau = typeof resNiveau === 'function' ? resNiveau() : 'ecole';
  const total = parties.length;
  const suite = async (i, cibles) => {
    if (i >= total) {
      toast(total > 1 ? `${total} parties envoyées.` : 'Document envoyé.');
      if (await confirmDialog('Supprimer ce brouillon de l’appareil ?')) { await scDB.supprimer(b.id).catch(() => {}); SC.b = null; scAccueil(root); }
      return;
    }
    const p = parties[i];
    if (total > 1 && i === 0) toast(`Ce dossier est volumineux : il sera envoyé en ${total} parties.`);
    resFormPublier(niveau, {
      objet: b.titre.trim() + (total > 1 ? ` (partie ${i + 1}/${total})` : ''), categorie: b.categorie, reference: b.reference || '',
      contenu: `${b.mode === 'dossier' ? 'Dossier numérisé' : 'Document numérisé'} : ${p.pages} page(s)${p.etiquette ? ', ' + p.etiquette : ''}.`,
      pj: { nom: p.nom, type: 'application/pdf', data: scBase64(p.bytes) }, cibles, garderPage: true,
      onSent: (r) => { setTimeout(() => suite(i + 1, r.cibles), 400); }
    });
  };
  suite(0, null);
}

/* ============ Route ============ */
ROUTE_ROLES['#/scanner'] = SC_ROLES.slice();
ROUTES['#/scanner'] = async (root) => {
  if (!currentUser || !SC_ROLES.includes(currentUser.role)) { root.innerHTML = '<div class="alert alert-terre">Le scanner est réservé aux comptes de l’école, de la CEB, de la DPEPPNF, de la DREPPNF et du ministère.</div>'; return; }
  scCss();
  if (SC.b) scEditeur(root); else await scAccueil(root);
};
