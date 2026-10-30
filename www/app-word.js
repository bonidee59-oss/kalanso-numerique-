/* ============================================================
   app-word.js — Téléchargement Word A4 (.docx), portrait ou paysage
   ------------------------------------------------------------
   Même principe que app-pdf.js : on part du document affiché à l'écran
   (listes, bulletins, reçus, registres, états…) et on produit un VRAI
   fichier Word (.docx) MODIFIABLE, lisible dans Word (ordinateur et
   téléphone), LibreOffice, WPS Office et Google Docs. Fonctionne hors
   ligne, sans bibliothèque externe.
   Reprend : titres, paragraphes, gras / italique / couleurs / tailles,
   alignements, tableaux (bordures, fonds, colonnes fusionnées, en-têtes
   répétés sur chaque page, lignes non coupées), logo / cachet / signature,
   listes. Page A4, marges de 10 mm.
   Limites : les mises en page « côte à côte » (flex) sont converties en
   tableaux ; les graphiques dessinés (svg) ne sont pas repris.
   ============================================================ */

(function () {
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PAGE = { portrait: [11906, 16838], landscape: [16838, 11906] };   // twips (A4)
  const UTILE = { portrait: 10772, landscape: 15705 };                    // largeur utile avec marges de 10 mm (190 / 277 mm)
  const MARGE = 567;                                                      // 10 mm
  const BLOCS_IGNORES = ['SCRIPT', 'STYLE', 'BUTTON', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'NOSCRIPT', 'TEMPLATE'];

  const x = (t) => String(t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = (t) => String(t || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
  const tw = (px) => Math.round(px * 15);                                  // px -> twips

  /* ---------- Archive ZIP (sans compression) ---------- */
  const CRCT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(fichiers) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    fichiers.forEach((f) => {
      const nom = enc.encode(f.nom), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, nom.length, true);
      parts.push(new Uint8Array(h.buffer), nom, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, nom.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nom);
      off += 30 + nom.length + n;
    });
    const taille = central.reduce((a, p) => a + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, fichiers.length, true); e.setUint16(10, fichiers.length, true); e.setUint32(12, taille, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: MIME });
  }

  /* ---------- Couleurs, polices ---------- */
  function hex(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map((s) => parseFloat(s)), a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return p.slice(0, 3).map((n) => Math.round(n * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function police(cs) {
    const fam = String(cs.fontFamily || '').toLowerCase().split(',')[0].replace(/["']/g, '').trim();
    if (/mono|courier|consolas/.test(fam)) return 'Courier New';
    if (/georgia/.test(fam)) return 'Georgia';
    if (/times|serif|garamond|palatino|cambria/.test(fam) && !/sans/.test(fam)) return 'Times New Roman';
    if (/calibri|verdana|tahoma|trebuchet/.test(fam)) return fam.replace(/\b\w/g, (m) => m.toUpperCase());
    return 'Arial';
  }
  function rpr(cs) {
    const f = police(cs), gras = (parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400)) >= 600;
    const deco = cs.textDecorationLine || '', col = hex(cs.color);
    return `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>${gras ? '<w:b/>' : ''}${/italic|oblique/.test(cs.fontStyle) ? '<w:i/>' : ''}${cs.textTransform === 'uppercase' ? '<w:caps/>' : ''}${/line-through/.test(deco) ? '<w:strike/>' : ''}${col && col !== '000000' ? `<w:color w:val="${col}"/>` : ''}<w:sz w:val="${Math.max(2, Math.round(parseFloat(cs.fontSize) * 1.5))}"/>${/underline/.test(deco) ? '<w:u w:val="single"/>' : ''}`;
  }
  function bordure(nom, cs, cote) {
    const w = parseFloat(cs.getPropertyValue(`border-${cote}-width`)), st = cs.getPropertyValue(`border-${cote}-style`);
    if (!(w > 0) || st === 'none' || st === 'hidden') return '';
    const col = hex(cs.getPropertyValue(`border-${cote}-color`)) || '000000';
    return `<w:${nom} w:val="${st === 'dashed' ? 'dashed' : st === 'dotted' ? 'dotted' : st === 'double' ? 'double' : 'single'}" w:sz="${Math.min(96, Math.max(2, Math.round(w * 6)))}" w:space="0" w:color="${col}"/>`;
  }

  /* ---------- Paragraphes ---------- */
  function nouveauP(cs) {
    const al = cs.textAlign;
    return { jc: al === 'center' ? 'center' : al === 'right' || al === 'end' ? 'right' : al === 'justify' ? 'both' : 'left', avant: 0, apres: 0, ind: 0, bdr: '', shd: null, suivant: false, runs: [] };
  }
  const estP = (b) => b && b.runs;
  function pXml(p) {
    const r = p.runs.slice();
    while (r.length && r[0].t !== undefined && !r[0].t.trim()) r.shift();
    while (r.length && r[r.length - 1].t !== undefined && !r[r.length - 1].t.trim()) r.pop();
    if (r.length && r[0].t !== undefined) r[0] = { ...r[0], t: r[0].t.replace(/^[ \t\n]+/, '') };
    if (r.length && r[r.length - 1].t !== undefined) r[r.length - 1] = { ...r[r.length - 1], t: r[r.length - 1].t.replace(/[ \t\n]+$/, '') };
    const ppr = `${p.suivant ? '<w:keepNext/>' : ''}${p.bdr ? `<w:pBdr>${p.bdr}</w:pBdr>` : ''}${p.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${p.shd}"/>` : ''}<w:spacing w:before="${Math.min(p.avant, 900)}" w:after="${Math.min(p.apres, 900)}"/>${p.ind ? `<w:ind w:left="${p.ind}"/>` : ''}<w:jc w:val="${p.jc}"/>`;
    return `<w:p><w:pPr>${ppr}</w:pPr>${r.map((u) => u.xml ? u.xml : u.br ? '<w:r><w:br/></w:r>' : `<w:r><w:rPr>${u.rpr}</w:rPr><w:t xml:space="preserve">${x(u.t)}</w:t></w:r>`).join('')}</w:p>`;
  }
  const videP = (p) => !p.runs.some((u) => u.xml || u.br || (u.t !== undefined && u.t.trim()));

  /* ---------- Parcours du document affiché ---------- */
  function ignore(el, cs) { return BLOCS_IGNORES.includes(el.tagName) || cs.display === 'none' || cs.visibility === 'hidden' || el.classList.contains('no-print') || el.hidden; }
  const enLigne = (cs) => /^inline/.test(cs.display) && !/flex|grid|table/.test(cs.display);

  function image(img, ctx) {
    const r = img.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null;
    let src = img.currentSrc || img.src || '', m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(src);
    if (!m) {   // webp, svg, lien : on le redessine en PNG
      try { const cv = document.createElement('canvas'); cv.width = img.naturalWidth || Math.round(r.width); cv.height = img.naturalHeight || Math.round(r.height); cv.getContext('2d').drawImage(img, 0, 0); src = cv.toDataURL('image/png'); } catch (e) { return null; }
      m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(src); if (!m) return null;
    }
    const ext = m[1].toLowerCase().replace('jpeg', 'jpg'), bin = atob(m[2]), data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const n = ctx.medias.length + 1, nom = `image${n}.${ext}`;
    ctx.medias.push({ nom, data, ext });
    let cx = Math.round(r.width * 9525), cy = Math.round(r.height * 9525); const max = ctx.utile * 635;
    if (cx > max) { cy = Math.round(cy * max / cx); cx = max; }
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Image ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${nom}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  /* contenu en ligne (texte, gras, retours à la ligne, images) ajouté au paragraphe p */
  function enLigneDans(noeud, p, ctx) {
    if (noeud.nodeType === 3) {
      const cs = getComputedStyle(noeud.parentElement);
      p.runs.push({ t: noeud.nodeValue.replace(/[ \t\r\n\f]+/g, ' '), rpr: rpr(cs) });
      return;
    }
    if (noeud.nodeType !== 1) return;
    const cs = getComputedStyle(noeud);
    if (ignore(noeud, cs)) return;
    if (noeud.tagName === 'BR') { p.runs.push({ br: true }); return; }
    if (noeud.tagName === 'IMG') { const xml = image(noeud, ctx); if (xml) p.runs.push({ xml }); return; }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(noeud.tagName)) {
      const v = noeud.tagName === 'SELECT' ? ((noeud.options[noeud.selectedIndex] || {}).text || '') : (noeud.type === 'checkbox' || noeud.type === 'radio' ? (noeud.checked ? '☑' : '☐') : noeud.value);
      p.runs.push({ t: v || '', rpr: rpr(cs) }); return;
    }
    noeud.childNodes.forEach((n) => enLigneDans(n, p, ctx));
  }

  /* liste de blocs (paragraphes et tableaux) d'un élément */
  function blocs(el, ctx) {
    const out = []; let cur = null; const cse = getComputedStyle(el);
    const vider = () => { if (cur && !videP(cur)) out.push(cur); cur = null; };
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) { if (!cur && !n.nodeValue.trim()) return; if (!cur) cur = nouveauP(cse); enLigneDans(n, cur, ctx); return; }
      if (n.nodeType !== 1) return;
      const cs = getComputedStyle(n);
      if (ignore(n, cs)) return;
      if (enLigne(cs) || n.tagName === 'BR') { if (!cur) cur = nouveauP(cse); enLigneDans(n, cur, ctx); return; }
      vider(); out.push(...bloc(n, cs, ctx));
    });
    vider();
    return out;
  }

  /* un élément de type « bloc » -> liste de blocs */
  function bloc(el, cs, ctx) {
    if (el.tagName === 'IMG') { const p = nouveauP(getComputedStyle(el.parentElement || el)); const xml = image(el, ctx); if (xml) p.runs.push({ xml }); return videP(p) ? [] : [p]; }
    if (el.tagName === 'TABLE') return [tableau(el, ctx)];
    if (el.tagName === 'HR') { const p = nouveauP(cs); p.bdr = bordure('bottom', cs, 'top') ? bordure('bottom', cs, 'top') : '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/>'; p.runs.push({ t: '', rpr: '' }); p.runs[0] = { xml: '<w:r/>' }; return [p]; }
    if (/flex/.test(cs.display) && !/column/.test(cs.flexDirection) && [...el.children].some((c) => !ignore(c, getComputedStyle(c)))) return [ligneFlex(el, cs, ctx)];
    let res = blocs(el, ctx);
    if (el.tagName === 'LI') {
      const pere = el.parentElement, ol = pere && pere.tagName === 'OL', num = ol ? [...pere.children].filter((c) => c.tagName === 'LI').indexOf(el) + 1 : 0;
      if (!res.length || !estP(res[0])) res.unshift(nouveauP(cs));
      res[0].runs.unshift({ t: ol ? num + '. ' : '• ', rpr: rpr(cs) });
    }
    const mh = (c) => parseFloat(cs.getPropertyValue(c)) || 0;
    const av = mh('margin-top') + mh('padding-top'), ap = mh('margin-bottom') + mh('padding-bottom');
    const ind = mh('margin-left') + mh('padding-left') + (/^(UL|OL)$/.test(el.tagName) ? 0 : 0);
    if (!res.length) {                                   // bloc vide qui occupe de la place (zone de signature, espace)
      const h = parseFloat(cs.height) || 0;
      if (h >= 8) { const p = nouveauP(cs); p.avant = tw(Math.min(h, 120)); p.runs.push({ xml: '<w:r/>' }); res = [p]; }
      return res;
    }
    const fond = hex(cs.backgroundColor), haut = bordure('top', cs, 'top'), bas = bordure('bottom', cs, 'bottom'), gauche = bordure('left', cs, 'left'), droite = bordure('right', cs, 'right');
    const ps = res.filter(estP);
    if (estP(res[0])) { res[0].avant += tw(av); if (haut) res[0].bdr = haut + res[0].bdr; }
    if (estP(res[res.length - 1])) { res[res.length - 1].apres += tw(ap); if (bas) res[res.length - 1].bdr += bas; }
    ps.forEach((p) => { p.ind += tw(ind); if (fond && !p.shd) p.shd = fond; if (gauche) p.bdr = p.bdr.replace(/<w:left[^>]*\/>/, '') + gauche; if (droite) p.bdr += droite; });
    if (/^H[1-6]$/.test(el.tagName) && estP(res[res.length - 1])) res[res.length - 1].suivant = true;
    return res;
  }

  /* ---------- Tableaux ---------- */
  function cellule(contenu, largeur, opts = {}) {
    const mar = opts.mar || [0, 0, 0, 0];
    return `<w:tc><w:tcPr><w:tcW w:w="${largeur}" w:type="dxa"/>${opts.span > 1 ? `<w:gridSpan w:val="${opts.span}"/>` : ''}${opts.vm ? `<w:vMerge${opts.vm === 'debut' ? ' w:val="restart"' : ''}/>` : ''}${opts.bdr ? `<w:tcBorders>${opts.bdr}</w:tcBorders>` : ''}${opts.fond ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fond}"/>` : ''}<w:tcMar><w:top w:w="${mar[0]}" w:type="dxa"/><w:left w:w="${mar[3]}" w:type="dxa"/><w:bottom w:w="${mar[2]}" w:type="dxa"/><w:right w:w="${mar[1]}" w:type="dxa"/></w:tcMar>${opts.va ? `<w:vAlign w:val="${opts.va}"/>` : ''}</w:tcPr>${contenu || '<w:p/>'}</w:tc>`;
  }
  const sérialiser = (liste) => { let s = '', prec = null; liste.forEach((b) => { const t = typeof b === 'string'; if (t && prec === 'tbl') s += '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>'; s += t ? b : pXml(b); prec = t ? 'tbl' : 'p'; }); return s; };

  function tableau(t, ctx) {
    const R = t.getBoundingClientRect(), lignes = [...t.rows];
    if (!lignes.length || R.width < 1) return '<w:p/>';
    const cellules = lignes.map((tr) => [...tr.cells].filter((c) => { const s = getComputedStyle(c); return s.display !== 'none'; }));
    const arrondi = (v) => Math.round(v / 2) * 2;
    const bords = new Set([0, arrondi(R.width)]);
    cellules.forEach((cl) => cl.forEach((c) => { const r = c.getBoundingClientRect(); bords.add(Math.max(0, arrondi(r.left - R.left))); bords.add(Math.min(arrondi(R.width), arrondi(r.right - R.left))); }));
    const aretes = [...bords].sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] >= 2);
    const nCol = aretes.length - 1; if (nCol < 1) return '<w:p/>';
    const idx = (v) => { let k = 0, best = 1e9; aretes.forEach((e, i) => { if (Math.abs(e - v) < best) { best = Math.abs(e - v); k = i; } }); return k; };
    const dispo = ctx.largeur ? tw(ctx.largeur) : ctx.utile, total = tw(R.width), k = Math.min(1, dispo / Math.max(1, total));
    const cols = []; for (let i = 0; i < nCol; i++) cols.push(Math.max(60, Math.round(tw(aretes[i + 1] - aretes[i]) * k)));
    const somme = cols.reduce((a, b) => a + b, 0);
    const cst = getComputedStyle(t), centre = cst.marginLeft === cst.marginRight && parseFloat(cst.marginLeft) > 0 && R.width < (t.parentElement ? t.parentElement.getBoundingClientRect().width - 4 : 1e9);
    const carry = {};   // colonne -> { fin, reste, larg } : cellules fusionnées vers le bas
    let xml = '';
    lignes.forEach((tr, ri) => {
      const trs = getComputedStyle(tr), entete = tr.parentElement && tr.parentElement.tagName === 'THEAD';
      if (ignore(tr, trs)) return;
      let col = 0, contenu = '';
      const fondLigne = hex(trs.backgroundColor);
      const remplir = (jusqua) => { while (col < jusqua) { const c = carry[col]; if (c && c.reste > 0) { const w = cols.slice(col, c.fin).reduce((a, b) => a + b, 0); contenu += cellule('<w:p/>', w, { span: c.fin - col, vm: 'suite' }); c.reste--; col = c.fin; } else { contenu += cellule('<w:p/>', cols[col]); col++; } } };
      cellules[ri].forEach((c) => {
        const r = c.getBoundingClientRect(), a = idx(r.left - R.left), b = Math.max(a + 1, idx(r.right - R.left));
        remplir(a);
        const cs = getComputedStyle(c), w = cols.slice(a, b).reduce((s, v) => s + v, 0), mar = ['top', 'right', 'bottom', 'left'].map((s) => Math.min(400, Math.max(0, tw(parseFloat(cs.getPropertyValue(`padding-${s}`)) || 0))));
        const bdr = bordure('top', cs, 'top') + bordure('left', cs, 'left') + bordure('bottom', cs, 'bottom') + bordure('right', cs, 'right');
        let inner = sérialiser(blocs(c, ctx));
        const rs = c.rowSpan > 1 ? c.rowSpan : 1;
        if (rs > 1) carry[a] = { fin: b, reste: rs - 1 };
        contenu += cellule(inner, w, { span: b - a, vm: rs > 1 ? 'debut' : '', bdr, fond: hex(cs.backgroundColor) || fondLigne, mar, va: /middle|center/.test(cs.verticalAlign) ? 'center' : /bottom/.test(cs.verticalAlign) ? 'bottom' : '' });
        col = b;
      });
      remplir(nCol);
      xml += `<w:tr><w:trPr><w:cantSplit/>${entete ? '<w:tblHeader/>' : ''}</w:trPr>${contenu}</w:tr>`;
    });
    return `<w:tbl><w:tblPr><w:tblW w:w="${somme}" w:type="dxa"/>${centre ? '<w:jc w:val="center"/>' : ''}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols.map((c) => `<w:gridCol w:w="${c}"/>`).join('')}</w:tblGrid>${xml}</w:tbl>`;
  }

  /* bloc « côte à côte » (flex en ligne) -> tableau d'une ligne sans bordure */
  function ligneFlex(el, cs, ctx) {
    const items = [...el.children].filter((c) => !ignore(c, getComputedStyle(c)));
    const dispo = ctx.largeur ? tw(ctx.largeur) : ctx.utile, tot = items.reduce((a, c) => a + Math.max(1, c.getBoundingClientRect().width), 0);
    const bas = bordure('bottom', cs, 'bottom'), haut = bordure('top', cs, 'top');
    let cols = '', tcs = '';
    items.forEach((c, i) => {
      const ocs = getComputedStyle(c), w = Math.max(200, Math.round(dispo * Math.max(1, c.getBoundingClientRect().width) / tot));
      let inner = bloc(c, ocs, ctx);
      const al = ocs.textAlign === 'center' ? 'center' : (/space-between/.test(cs.justifyContent) && items.length > 1 ? (i === 0 ? 'left' : i === items.length - 1 ? 'right' : 'center') : (ocs.textAlign === 'right' || ocs.textAlign === 'end' ? 'right' : 'left'));
      inner.filter(estP).forEach((p) => { p.jc = al; });
      cols += `<w:gridCol w:w="${w}"/>`;
      tcs += cellule(sérialiser(inner), w, { bdr: (i === 0 || true ? bas.replace(/^/, '') : '') + haut, va: /flex-end|end/.test(cs.alignItems) ? 'bottom' : /center/.test(cs.alignItems) ? 'center' : '' });
    });
    return `<w:tbl><w:tblPr><w:tblW w:w="${dispo}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${cols}</w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs}</w:tr></w:tbl>`;
  }

  /* ---------- Assemblage du fichier ---------- */
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  /* Fonction pure (testable) : corps XML + images -> Blob .docx */
  function wordAssembler(corps, medias, orientation, largeur) {
    const o = orientation === 'landscape' ? 'landscape' : 'portrait', [pw, ph] = PAGE[o];
    const lat = largeur ? Math.max(MARGE, Math.round((pw - tw(largeur)) / 2)) : MARGE;
    const enc = new TextEncoder(), t = (s) => enc.encode(s);
    const exts = [...new Set(medias.map((m) => m.ext))];
    const types = XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${exts.map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
    const rels = XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    const docRels = XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${medias.map((m, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.nom}"/>`).join('')}</Relationships>`;
    const styles = XML + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
    const doc = XML + `<w:document ${NS}><w:body>${corps}<w:sectPr><w:pgSz w:w="${pw}" w:h="${ph}"${o === 'landscape' ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${MARGE}" w:right="${lat}" w:bottom="${MARGE}" w:left="${lat}" w:header="283" w:footer="283" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    return zip([{ nom: '[Content_Types].xml', data: t(types) }, { nom: '_rels/.rels', data: t(rels) }, { nom: 'word/document.xml', data: t(doc) }, { nom: 'word/styles.xml', data: t(styles) }, { nom: 'word/_rels/document.xml.rels', data: t(docRels) }, ...medias.map((m) => ({ nom: 'word/media/' + m.nom, data: m.data }))]);
  }

  window.wordCrc32 = crc32; window.wordZip = zip; window.wordAssembler = wordAssembler;

  window.genererWord = async function (zone, opts = {}) {
    const orient = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignoré */ } }
    const theme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');   // un document est toujours en clair
    const ctx = { medias: [], utile: UTILE[orient], largeur: opts.largeur || 0 };
    let corps;
    try { corps = sérialiser(blocs(zone, ctx)); }
    finally { if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme'); }
    return wordAssembler(corps || '<w:p/>', ctx.medias, orient, opts.largeur);
  };

  window.telechargerWord = async function (zone, titre, orientation, largeur) {
    if (typeof toast === 'function') toast('Création du fichier Word…');
    try {
      const blob = await window.genererWord(zone, { orientation, titre, largeur });
      const nom = slug(titre) + '-' + (orientation === 'landscape' ? 'paysage' : 'portrait') + '-' + new Date().toISOString().slice(0, 10) + '.docx';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      if (typeof toast === 'function') toast('Word téléchargé : ' + nom);
      return blob;
    } catch (e) {
      console.error(e);
      if (typeof toast === 'function') toast('Impossible de créer le fichier Word sur cet appareil.');
      return null;
    }
  };
})();
