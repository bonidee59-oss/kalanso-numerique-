/* ============================================================
   app-print-a4.js — Impression / export PDF en format A4 (NOUVEAU MODULE)
   ------------------------------------------------------------
   Utilisé par printDocument() (toutes les rubriques : listes, bulletins,
   rapports, registres, cahiers de bord…) et par l'impression du reçu.
   Garanties :
   - page A4 (portrait, ou paysage automatique si un tableau est trop large) ;
   - aucune ligne de tableau, image, signature coupée entre deux pages ;
   - en-têtes de colonnes répétés sur chaque page ;
   - titres jamais isolés en bas de page ;
   - cellules qui passent à la ligne au lieu d'être tronquées ;
   - tableau trop large : réduit pour tenir dans la largeur de la page.
   ============================================================ */

(function () {
  /* Zone imprimable A4 à 96 dpi avec marges de 10 mm : 190 mm ≈ 718 px (portrait), 277 mm ≈ 1047 px (paysage) */
  const LARGEUR = { portrait: 718, paysage: 1047 };
  const ZOOM_MIN = 0.4;

  /* Mesure (écran) : largeur minimale que peut prendre un tableau en laissant ses cellules passer à la ligne */
  const css = document.createElement('style');
  css.textContent = '.a4-mesure table{width:min-content !important;} .a4-mesure th,.a4-mesure td{white-space:normal !important;}';
  document.head.appendChild(css);

  function regles(sel, orientation, extra) {
    return `
@page{size:A4 ${orientation}; margin:10mm;}
@media print{
  html,body{background:#fff !important; height:auto !important; overflow:visible !important;}
  body>*:not(.modal-overlay){display:none !important;}
  .modal-overlay{position:static !important; display:block !important; background:none !important; padding:0 !important; overflow:visible !important; height:auto !important;}
  .modal{box-shadow:none !important; border:0 !important; width:100% !important; max-width:100% !important; max-height:none !important; height:auto !important; overflow:visible !important; margin:0 !important;}
  .modal-head,.modal-foot{display:none !important;}
  .modal-body{padding:0 !important; max-height:none !important; overflow:visible !important;}
  ${sel}{-webkit-print-color-adjust:exact; print-color-adjust:exact;}
  ${sel} table{border-collapse:collapse; max-width:100%;}
  ${sel} th,${sel} td{white-space:normal !important; overflow-wrap:anywhere; word-break:normal; position:static !important;}
  ${sel} thead{display:table-header-group;}
  ${sel} tfoot{display:table-footer-group;}
  ${sel} tr,${sel} img,${sel} .pd-signature,${sel} .pd-entete,${sel} .recu-moderne{break-inside:avoid; page-break-inside:avoid;}
  ${sel} h1,${sel} h2,${sel} h3,${sel} h4,${sel} h5{break-after:avoid; page-break-after:avoid;}
  ${sel} p{orphans:3; widows:3;}
  ${extra || ''}
}`;
  }

  /* zone : élément contenant le document à imprimer (déjà affiché dans la fenêtre d'aperçu) */
  window.imprimerA4 = function (zone, opts = {}) {
    zone.classList.add('a4-zone');
    const tables = [...zone.querySelectorAll('table')];

    /* 1. Largeur minimale de chaque tableau → orientation + facteur de réduction */
    zone.classList.add('a4-mesure');
    const larg = tables.map((t) => t.getBoundingClientRect().width);
    zone.classList.remove('a4-mesure');
    const orientation = opts.orientation || (larg.some((w) => w > LARGEUR.portrait) ? 'landscape' : 'portrait');
    const dispo = orientation === 'landscape' ? LARGEUR.paysage : LARGEUR.portrait;
    tables.forEach((t, i) => {
      t.dataset.zoomA4 = t.style.zoom || '';
      if (larg[i] > dispo) t.style.zoom = String(Math.max(ZOOM_MIN, dispo / larg[i]));
    });

    /* 2. Feuille de style d'impression temporaire */
    const style = document.createElement('style');
    style.id = 'temp-print-css';
    style.textContent = regles('.a4-zone', orientation, opts.extraCss);
    document.head.appendChild(style);

    let nettoye = false;
    const nettoyer = () => {
      if (nettoye) return; nettoye = true;
      style.remove();
      tables.forEach((t) => { t.style.zoom = t.dataset.zoomA4; delete t.dataset.zoomA4; });
      zone.classList.remove('a4-zone');
      window.removeEventListener('afterprint', nettoyer);
    };
    window.addEventListener('afterprint', nettoyer);
    setTimeout(nettoyer, 60000); // sécurité si « afterprint » n'est jamais émis
    window.print();
  };
})();
