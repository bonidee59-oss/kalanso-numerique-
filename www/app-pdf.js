/* ============================================================
   app-pdf.js — Téléchargement PDF A4, portrait ou paysage (NOUVEAU MODULE)
   ------------------------------------------------------------
   Produit un VRAI fichier .pdf directement dans le navigateur (téléphone
   compris, hors ligne, sans bibliothèque externe) à partir du document
   affiché : texte vectoriel sélectionnable, tableaux, bordures, fonds,
   logo/cachet/signature.
   Principe : le document est mis en page par le navigateur à la largeur
   exacte de la page A4 choisie, puis chaque ligne de texte, chaque fond et
   chaque bordure est reportée dans le PDF à la position mesurée.
   Garanties : marges de 10 mm, aucune ligne de tableau / signature / bloc
   « ne pas couper » coupé entre deux pages, titres jamais isolés en bas de
   page, en-têtes de tableau répétés sur chaque page, tableau trop large
   réduit pour tenir dans la largeur, numéro de page en pied.
   Limites : polices PDF standard (Helvetica, Times, Courier) ; les symboles
   hors alphabet latin (♿, ▲…) sont remplacés par un équivalent simple.
   ============================================================ */

const PDF_LARGEURS={H:[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],HB:[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556],T:[250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541,761,500,0,333,500,444,1000,500,500,333,1000,556,333,889,0,611,0,0,333,333,444,444,350,500,1000,333,980,389,333,722,0,444,722,250,333,500,500,500,500,200,500,333,760,276,500,564,333,760,333,400,564,300,300,333,500,453,250,333,300,310,500,750,750,750,444,722,722,722,722,722,722,889,667,611,611,611,611,333,333,333,333,722,722,722,722,722,722,722,564,722,722,722,722,722,722,556,500,444,444,444,444,444,444,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,564,500,500,500,500,500,500,500,500],TB:[250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520,761,500,0,333,500,500,1000,500,500,333,1000,556,333,1000,0,667,0,0,333,333,500,500,350,500,1000,333,1000,389,333,722,0,444,722,250,333,500,500,500,500,220,500,333,747,300,500,570,333,747,333,400,570,300,300,333,556,540,250,333,300,330,500,750,750,750,500,722,722,722,722,722,722,1000,722,667,667,667,667,389,389,389,389,722,722,778,778,778,778,778,570,778,722,722,722,722,722,611,556,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,500,556,500],TI:[250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541,761,500,0,333,500,556,889,500,500,333,1000,500,333,944,0,556,0,0,333,333,556,556,350,500,889,333,980,389,333,667,0,389,556,250,389,500,500,500,500,275,500,333,760,276,500,675,333,760,333,400,675,300,300,333,500,523,250,333,300,310,500,750,750,750,500,611,611,611,611,611,611,889,667,611,611,611,611,333,333,333,333,722,667,722,722,722,722,722,675,722,722,722,722,722,556,611,500,500,500,500,500,500,500,667,444,444,444,444,444,278,278,278,278,500,500,500,500,500,500,500,675,500,500,500,500,500,444,500,444],TBI:[250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,500,500,389,389,278,556,444,667,500,444,389,348,220,348,570,761,500,0,333,500,500,1000,500,500,333,1000,556,333,944,0,611,0,0,333,333,500,500,350,500,1000,333,1000,389,333,722,0,389,611,250,389,500,500,500,500,220,500,333,747,266,500,606,333,747,333,400,570,300,300,333,576,500,250,333,300,300,500,750,750,750,500,667,667,667,667,667,667,944,667,667,667,667,667,389,389,389,389,722,722,722,722,722,722,722,570,722,722,722,722,722,611,611,500,500,500,500,500,500,500,722,444,444,444,444,444,278,278,278,278,500,556,500,500,500,500,500,570,500,556,556,556,556,444,500,444]};

(function () {
  const PT = 0.75;                                  // 1 px = 0,75 pt
  const MARGE = 10 / 25.4 * 72;                     // 10 mm en points
  const A4 = { w: 595.276, h: 841.89 };
  /* zone utile à 96 dpi : 190 × 277 mm */
  const ZONE = { portrait: { w: 718, h: 1047 }, landscape: { w: 1047, h: 718 } };

  /* ---------- Encodage WinAnsi ---------- */
  const CP = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
  const SUB = { '→': '->', '←': '<-', '▲': '^', '▼': 'v', '♿': '(H)', '✔': 'ok', '✓': 'ok', '★': '*', '●': '•', '○': 'o', '⇅': '<>', '▦': '#', '📎': '', '−': '-', '\u00a0': ' ', '\u202f': ' ', '\u2009': ' ', '\u2002': ' ', '\u2003': ' ', '≠': '!=', '≥': '>=', '≤': '<=', '\t': ' ', '\n': ' ', '\r': ' ' };
  function enc(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = SUB[ch] !== undefined ? SUB[ch] : ch;
      for (const d of c) {
        const n = d.codePointAt(0);
        if (CP[d]) out += String.fromCharCode(CP[d]);
        else if ((n >= 32 && n <= 126) || (n >= 160 && n <= 255)) out += d;
        else out += '?';
      }
    }
    return out;
  }
  const echap = (s) => s.replace(/[\\()]/g, (m) => '\\' + m);

  /* ---------- Polices ---------- */
  function police(cs) {
    const fam = String(cs.fontFamily).toLowerCase();
    const gras = (parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400)) >= 600;
    const ital = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
    const mono = /mono|courier|consolas/.test(fam);
    const serif = !mono && (/georgia|times|garamond|palatino|cambria/.test(fam) || (/serif/.test(fam) && !/sans/.test(fam)));
    if (mono) return { cle: 'C', nom: gras ? (ital ? 'Courier-BoldOblique' : 'Courier-Bold') : (ital ? 'Courier-Oblique' : 'Courier') };
    if (serif) return gras ? (ital ? { cle: 'TBI', nom: 'Times-BoldItalic' } : { cle: 'TB', nom: 'Times-Bold' }) : (ital ? { cle: 'TI', nom: 'Times-Italic' } : { cle: 'T', nom: 'Times-Roman' });
    return gras ? { cle: 'HB', nom: ital ? 'Helvetica-BoldOblique' : 'Helvetica-Bold' } : { cle: 'H', nom: ital ? 'Helvetica-Oblique' : 'Helvetica' };
  }
  function largeurPdf(txt, cle) {   // en millièmes d'em
    if (cle === 'C') return txt.length * 600;
    const t = PDF_LARGEURS[cle === 'HB' || cle === 'H' || cle === 'T' || cle === 'TB' || cle === 'TI' || cle === 'TBI' ? cle : 'H'];
    let w = 0;
    for (let i = 0; i < txt.length; i++) { const c = txt.charCodeAt(i); w += c >= 32 && c <= 255 ? t[c - 32] : 556; }
    return w;
  }

  /* ---------- Couleurs ---------- */
  function couleur(s) {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const cPdf = (c) => `${(c.r / 255).toFixed(3)} ${(c.g / 255).toFixed(3)} ${(c.b / 255).toFixed(3)}`;
  const n2 = (x) => (Math.round(x * 100) / 100).toString();

  /* ---------- Mise en page à la largeur de la page ---------- */
  const CSS_HOTE = `
    #pdf-hote, #pdf-hote *{ box-sizing:border-box; }
    #pdf-hote{ position:fixed; left:-30000px; top:0; background:#fff; color:#000; overflow:visible; }
    #pdf-hote th, #pdf-hote td{ position:static !important; white-space:normal !important; overflow-wrap:break-word; }
    #pdf-hote .no-print{ display:none !important; }
    #pdf-hote.pdf-mesure table{ width:min-content !important; }`;

  function preparerHote(zone, largeur, largeurDoc) {
    if (!document.getElementById('pdf-css')) { const st = document.createElement('style'); st.id = 'pdf-css'; st.textContent = CSS_HOTE; document.head.appendChild(st); }
    const hote = document.createElement('div');
    hote.id = 'pdf-hote';
    hote.style.width = largeur + 'px';
    const clone = zone.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.padding = '0';
    clone.style.margin = '0';
    clone.style.maxWidth = 'none';
    clone.style.width = largeurDoc ? largeurDoc + 'px' : '100%';
    hote.appendChild(clone);
    document.body.appendChild(hote);
    return { hote, clone };
  }

  /* Tableaux plus larges que la page : réduits (transform) pour tenir dans la largeur */
  function ajusterTableaux(hote, clone, largeur) {
    hote.classList.add('pdf-mesure');
    const tabs = [...clone.querySelectorAll('table')];
    const mini = tabs.map((t) => t.getBoundingClientRect().width);
    hote.classList.remove('pdf-mesure');
    tabs.forEach((t, i) => {
      if (mini[i] <= largeur + 0.5) return;
      const k = Math.max(0.35, largeur / mini[i]);
      t.style.width = 'min-content';
      const h = t.getBoundingClientRect().height;
      const enveloppe = document.createElement('div');
      enveloppe.style.cssText = `width:${largeur}px; height:${h * k}px; overflow:visible;`;
      t.parentNode.insertBefore(enveloppe, t);
      enveloppe.appendChild(t);
      t.style.transformOrigin = 'top left';
      t.style.transform = `scale(${k})`;
      t.dataset.pdfk = String(k);
    });
    return Math.max(0, ...mini);
  }
  const echelle = (el) => { const a = el.closest('[data-pdfk]'); return a ? parseFloat(a.dataset.pdfk) || 1 : 1; };

  /* ---------- Extraction : fonds, bordures, texte, images ---------- */
  function extraire(clone, imagesOut) {
    const base = clone.getBoundingClientRect();
    const ops = [], evite = [], titres = [], forces = [], tableaux = new Map();
    const R = (r) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });

    function texte(noeud, parent, cs, s) {
      let src = noeud.nodeValue;
      const tt = cs.textTransform;
      if (tt === 'uppercase') src = src.toUpperCase(); else if (tt === 'lowercase') src = src.toLowerCase();
      else if (tt === 'capitalize') src = src.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
      const orig = noeud.nodeValue;
      const f = police(cs);
      const taille = parseFloat(cs.fontSize) * s;           // px
      const col = couleur(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      const sousligne = /underline/.test(cs.textDecorationLine || cs.textDecoration || '');
      const pieces = [];
      const re = /\S+/g; let m, wi = 0;
      const rg = document.createRange();
      while ((m = re.exec(orig))) {
        rg.setStart(noeud, m.index); rg.setEnd(noeud, m.index + m[0].length);
        const rects = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        const mot = src.substr(m.index, m[0].length); wi++;
        if (rects.length === 1 || rects.every((r) => Math.abs(r.top - rects[0].top) < 2)) {
          const x0 = Math.min(...rects.map((r) => r.left)), x1 = Math.max(...rects.map((r) => r.right));
          pieces.push({ t: mot, l: x0, r: x1, top: rects[0].top, h: rects[0].height, m: wi });
        } else {                                              // mot coupé sur plusieurs lignes : caractère par caractère
          for (let i = 0; i < m[0].length; i++) {
            rg.setStart(noeud, m.index + i); rg.setEnd(noeud, m.index + i + 1);
            const r = rg.getBoundingClientRect();
            if (r.width > 0) pieces.push({ t: src.charAt(m.index + i), l: r.left, r: r.right, top: r.top, h: r.height, car: true, m: wi });
          }
        }
      }
      let ligne = null; const lignes = [];
      pieces.forEach((p) => {
        if (!ligne || Math.abs(p.top - ligne.top) > p.h * 0.5) { ligne = { top: p.top, h: p.h, l: p.l, r: p.r, parts: [p] }; lignes.push(ligne); }
        else { ligne.r = Math.max(ligne.r, p.r); ligne.l = Math.min(ligne.l, p.l); ligne.parts.push(p); }
      });
      lignes.forEach((ln) => {
        let t = '';
        ln.parts.forEach((p, i) => { t += (i && p.m !== ln.parts[i - 1].m ? ' ' : '') + p.t; });
        const e = enc(t);
        if (!e.trim()) return;
        const largeurNav = ln.r - ln.l;
        const largeurP = largeurPdf(e, f.cle) * taille / 1000;
        const tz = largeurP > 0 ? Math.min(140, Math.max(60, largeurNav / largeurP * 100)) : 100;
        const y = ln.top - base.top, x = ln.l - base.left;
        ops.push({ k: 't', x, y, h: ln.h, txt: e, font: f, taille, tz, col, base: y + ln.h * 0.79, sous: sousligne, w: largeurNav });
        evite.push({ top: y, bottom: y + ln.h });
      });
    }

    function visiter(el) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) return;
      const s = echelle(el);
      const bloc = cs.display !== 'inline';
      const rects = bloc ? [el.getBoundingClientRect()] : [...el.getClientRects()];
      const bg = couleur(cs.backgroundColor);
      rects.forEach((rr) => {
        if (rr.width <= 0 || rr.height <= 0) return;
        const r = R(rr);
        if (bg && bg.a > 0.05) ops.push({ k: 'r', x: r.x, y: r.y, w: r.w, h: r.h, col: bg });
        if (bloc) {
          [['Top', 0], ['Bottom', 1], ['Left', 2], ['Right', 3]].forEach(([c, i]) => {
            const w = parseFloat(cs['border' + c + 'Width']) * s;
            const st = cs['border' + c + 'Style'], bc = couleur(cs['border' + c + 'Color']);
            if (!(w > 0) || st === 'none' || st === 'hidden' || !bc || bc.a < 0.05) return;
            const ww = Math.max(w, 0.5);
            if (i === 0) ops.push({ k: 'r', x: r.x, y: r.y, w: r.w, h: ww, col: bc });
            else if (i === 1) ops.push({ k: 'r', x: r.x, y: r.y + r.h - ww, w: r.w, h: ww, col: bc });
            else if (i === 2) ops.push({ k: 'r', x: r.x, y: r.y, w: ww, h: r.h, col: bc });
            else ops.push({ k: 'r', x: r.x + r.w - ww, y: r.y, w: ww, h: r.h, col: bc });
          });
        }
      });
      const r0 = rects[0] ? R(rects[0]) : null;
      if (r0 && r0.h > 0) {
        const tag = el.tagName;
        if (tag === 'TR' || tag === 'IMG' || el.classList.contains('pd-signature') || el.classList.contains('pd-entete') || el.classList.contains('recu-moderne')
          || cs.breakInside === 'avoid' || cs.pageBreakInside === 'avoid') evite.push({ top: r0.y, bottom: r0.y + r0.h });
        if (/^H[1-5]$/.test(tag)) titres.push({ top: r0.y, bottom: r0.y + r0.h });
        if (['page', 'always'].includes(cs.breakAfter) || cs.pageBreakAfter === 'always') forces.push(r0.y + r0.h);
        if (tag === 'TABLE') tableaux.set(el, { top: r0.y, bottom: r0.y + r0.h, th: null });
      } else if (el.tagName !== 'IMG' && (['page', 'always'].includes(cs.breakAfter) || cs.pageBreakAfter === 'always')) {
        const rr = el.getBoundingClientRect(); forces.push(R(rr).y);
      }
      if (el.tagName === 'IMG' && r0 && r0.w > 0) {
        try {
          const c = document.createElement('canvas');
          const nw = Math.min(el.naturalWidth || 200, 900), nh = Math.round(nw * (el.naturalHeight || 1) / (el.naturalWidth || 1));
          c.width = nw; c.height = nh;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, nw, nh); g.drawImage(el, 0, 0, nw, nh);
          const d = c.toDataURL('image/jpeg', 0.9).split(',')[1];
          imagesOut.push({ data: atob(d), w: nw, h: nh });
          ops.push({ k: 'i', x: r0.x, y: r0.y, w: r0.w, h: r0.h, idx: imagesOut.length - 1 });
        } catch (e) { /* image illisible : ignorée */ }
        return;
      }
      let debutTh = null;
      if (el.tagName === 'THEAD') { const tb = tableaux.get(el.closest('table')); if (tb) debutTh = ops.length; }
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) { if (/\S/.test(n.nodeValue)) texte(n, el, cs, s); }
        else if (n.nodeType === 1) visiter(n);
      });
      if (debutTh !== null) {
        const tb = tableaux.get(el.closest('table')), rt = R(el.getBoundingClientRect());
        tb.th = { top: rt.y, bottom: rt.y + rt.h, h: rt.h, d: debutTh, f: ops.length };
      }
    }
    visiter(clone);
    return { ops, evite, titres, forces, tableaux: [...tableaux.values()].filter((t) => t.th), hauteur: base.height };
  }

  /* ---------- Pagination ---------- */
  function paginer(ex, hPage) {
    const pages = [];
    let y0 = 0, offset = 0, entete = null, garde = 0;
    while (y0 < ex.hauteur - 0.5 && garde++ < 2000) {
      const dispo = hPage - offset;
      let cut = y0 + dispo;
      if (cut >= ex.hauteur - 0.5) { pages.push({ y0, y1: ex.hauteur, offset, entete }); break; }
      const f = ex.forces.filter((y) => y > y0 + 1 && y <= cut).sort((a, b) => a - b)[0];
      if (f !== undefined) cut = f;
      else {
        let change = true, n = 0;
        while (change && n++ < 300) {
          change = false;
          for (const a of ex.evite) if (a.top > y0 + 2 && a.top < cut - 0.5 && a.bottom > cut + 0.5 && (a.bottom - a.top) <= dispo) { cut = a.top; change = true; }
          for (const h of ex.titres) if (h.top > y0 + 2 && h.top < cut && h.bottom > cut - 28) { cut = h.top; change = true; }
        }
        if (cut <= y0 + 2) cut = y0 + dispo;
      }
      pages.push({ y0, y1: cut, offset, entete });
      y0 = cut; offset = 0; entete = null;
      const t = ex.tableaux.find((t) => t.top < y0 - 1 && t.bottom > y0 + 1 && t.th.bottom <= y0 + 0.5);
      if (t && !ex.forces.some((y) => Math.abs(y - y0) < 1)) { offset = t.th.h; entete = t.th; }
    }
    return pages;
  }

  /* ---------- Écriture du PDF ---------- */
  const octets = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  async function compresser(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()); } catch (e) { return null; }
  }

  async function assembler(ex, pages, orient, titre, images) {
    const W = orient === 'landscape' ? A4.h : A4.w, H = orient === 'landscape' ? A4.w : A4.h;
    const polices = new Map();
    ex.ops.forEach((o) => { if (o.k === 't' && !polices.has(o.font.nom)) polices.set(o.font.nom, 'F' + (polices.size + 1)); });
    const objets = []; // chaque entrée : Uint8Array du corps (sans « n 0 obj »)
    const reserve = () => { objets.push(null); return objets.length; };
    const poser = (id, corps) => { objets[id - 1] = typeof corps === 'string' ? octets(corps) : corps; };
    const flux = async (dict, u8) => {
      const z = await compresser(u8);
      const d = z ? `<< ${dict} /Filter /FlateDecode /Length ${z.length} >>` : `<< ${dict} /Length ${u8.length} >>`;
      const entete = octets(d + '\nstream\n'), pied = octets('\nendstream');
      const out = new Uint8Array(entete.length + (z || u8).length + pied.length);
      out.set(entete, 0); out.set(z || u8, entete.length); out.set(pied, entete.length + (z || u8).length);
      return out;
    };
    const idCat = reserve(), idPages = reserve(), idRes = reserve(), idInfo = reserve();
    const idPolices = {}; polices.forEach((res, nom) => { const id = reserve(); idPolices[res] = id; poser(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${nom} /Encoding /WinAnsiEncoding >>`); });
    const idImgs = [];
    for (let i = 0; i < images.length; i++) {
      const id = reserve(); idImgs.push(id);
      const im = images[i], u8 = octets(im.data);
      const ent = octets(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${u8.length} >>\nstream\n`), pied = octets('\nendstream');
      const out = new Uint8Array(ent.length + u8.length + pied.length); out.set(ent, 0); out.set(u8, ent.length); out.set(pied, ent.length + u8.length);
      poser(id, out);
    }
    poser(idRes, `<< /Font << ${[...polices.values()].map((r) => `/${r} ${idPolices[r]} 0 R`).join(' ')} >> /XObject << ${idImgs.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >> >>`);
    poser(idInfo, `<< /Title (${echap(enc(titre))}) /Creator (Ecole numerique) /Producer (Ecole numerique) >>`);

    const nbPages = pages.length, kids = [];
    const px = (v) => v * PT;
    for (let p = 0; p < nbPages; p++) {
      const pg = pages[p];
      const dessiner = (o, dy) => {   // dy : décalage vertical (px) à appliquer à la position document
        const haut = H - MARGE;
        if (o.k === 'r') {
          return `${cPdf(o.col)} rg ${n2(MARGE + px(o.x))} ${n2(haut - px(o.y + o.h + dy))} ${n2(px(o.w))} ${n2(px(o.h))} re f\n`;
        }
        if (o.k === 'i') {
          return `q ${n2(px(o.w))} 0 0 ${n2(px(o.h))} ${n2(MARGE + px(o.x))} ${n2(haut - px(o.y + o.h + dy))} cm /Im${o.idx + 1} Do Q\n`;
        }
        const nomRes = polices.get(o.font.nom);
        let s = `BT /${nomRes} ${n2(px(o.taille))} Tf ${n2(o.tz)} Tz ${cPdf(o.col)} rg 1 0 0 1 ${n2(MARGE + px(o.x))} ${n2(haut - px(o.base + dy))} Tm (${echap(o.txt)}) Tj ET\n`;
        if (o.sous) s += `${cPdf(o.col)} rg ${n2(MARGE + px(o.x))} ${n2(haut - px(o.base + dy + o.taille * 0.12))} ${n2(px(o.w))} ${n2(Math.max(0.4, px(o.taille) * 0.06))} re f\n`;
        return s;
      };
      let c = '';
      const hautPage = pg.y1 - pg.y0 + pg.offset;
      const clip = (hPx) => `q ${n2(MARGE)} ${n2(H - MARGE - px(hPx))} ${n2(W - 2 * MARGE)} ${n2(px(hPx))} re W n\n`;
      if (pg.entete) {   // en-tête de tableau répété
        c += clip(pg.entete.h);
        for (let i = pg.entete.d; i < pg.entete.f; i++) c += dessiner(ex.ops[i], -pg.entete.top);
        c += 'Q\n';
      }
      c += clip(hautPage);
      for (const o of ex.ops) {
        const haut = o.y, bas = o.y + (o.h || 0);
        if (bas < pg.y0 - 0.5 || haut > pg.y1 + 0.5) continue;
        if (o.k === 't' && (haut < pg.y0 - 1 || bas > pg.y1 + 1)) continue;   // ligne de texte jamais coupée
        c += dessiner(o, -pg.y0 + pg.offset);
      }
      c += 'Q\n';
      // pied de page
      const pied = enc(`Page ${p + 1} / ${nbPages}`);
      c += `BT /${polices.size ? [...polices.values()][0] : 'F0'} 7.5 Tf 100 Tz 0.4 0.4 0.4 rg 1 0 0 1 ${n2(W / 2 - largeurPdf(pied, 'H') * 7.5 / 2000)} ${n2(MARGE * 0.45)} Tm (${echap(pied)}) Tj ET\n`;
      const idC = reserve(), idP = reserve();
      poser(idC, await flux('', octets(c)));
      poser(idP, `<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources ${idRes} 0 R /Contents ${idC} 0 R >>`);
      kids.push(idP);
    }
    poser(idPages, `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    poser(idCat, `<< /Type /Catalog /Pages ${idPages} 0 R >>`);

    const morceaux = [octets('%PDF-1.4\n%âãÏÓ\n')]; let pos = morceaux[0].length; const offs = [];
    objets.forEach((corps, i) => {
      const ent = octets(`${i + 1} 0 obj\n`), fin = octets('\nendobj\n');
      offs.push(pos); morceaux.push(ent, corps, fin); pos += ent.length + corps.length + fin.length;
    });
    const xref = `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objets.length + 1} /Root ${idCat} 0 R /Info ${idInfo} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    morceaux.push(octets(xref));
    return new Blob(morceaux, { type: 'application/pdf' });
  }

  /* ---------- API ---------- */
  /* Orientation recommandée : paysage si un tableau ne tient pas en portrait */
  window.pdfOrientationConseillee = function (zone) {
    const { hote, clone } = preparerHote(zone, ZONE.portrait.w);
    const theme = document.documentElement.getAttribute('data-theme');
    try { document.documentElement.setAttribute('data-theme', 'light'); hote.classList.add('pdf-mesure'); const larg = Math.max(0, ...[...clone.querySelectorAll('table')].map((t) => t.getBoundingClientRect().width)); return larg > ZONE.portrait.w + 0.5 ? 'landscape' : 'portrait'; }
    finally { if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme'); hote.remove(); }
  };

  window.genererPDF = async function (zone, opts = {}) {
    const orient = opts.orientation === 'landscape' ? 'landscape' : 'portrait';
    const z = ZONE[orient];
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignoré */ } }
    const theme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');   // un PDF est toujours en clair, même si l'application est en mode sombre
    const { hote, clone } = preparerHote(zone, z.w, opts.largeur);
    const images = [];
    let ex, pages;
    try {
      ajusterTableaux(hote, clone, z.w);
      ex = extraire(clone, images);
      if (opts.largeur) { const dx = Math.max(0, (z.w - opts.largeur) / 2); ex.ops.forEach((o) => { o.x += dx; }); }
      pages = paginer(ex, z.h);
    } finally {
      hote.remove();
      if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
    }
    return assembler(ex, pages, orient, opts.titre || 'Document', images);
  };

  window.telechargerPDF = async function (zone, titre, orientation, largeur) {
    if (typeof toast === 'function') toast('Création du PDF…');
    try {
      const blob = await window.genererPDF(zone, { orientation, titre, largeur });
      const nom = (String(titre || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document')
        + '-' + (orientation === 'landscape' ? 'paysage' : 'portrait') + '-' + new Date().toISOString().slice(0, 10) + '.pdf';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nom;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      if (typeof toast === 'function') toast('PDF téléchargé : ' + nom);
      return blob;
    } catch (e) {
      console.error(e);
      if (typeof toast === 'function') toast("Impossible de créer le PDF sur cet appareil : utilisez « Imprimer ».");
      return null;
    }
  };
})();
