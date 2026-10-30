/* ============================================================
   app-fiche-scolarite.js — Fiche de scolarité de l'élève (NOUVEAU MODULE)
   ------------------------------------------------------------
   Reprend le modèle papier officiel (Burkina Faso) :
   - recto : FICHE DE SCOLARITÉ (identité, parents, entrée/sortie,
     cours suivis CP1→CM2 avec date, moyenne générale, classement,
     diplômes, observations et signature du directeur) ;
   - verso : FICHE MÉDICO-SCOLAIRE (antécédents, vaccinations,
     constantes, examen physique, observations).

   Données : stockées dans le dossier de l'élève (eleve.fiche), donc
   synchronisées et hors ligne comme le reste. Aucune nouvelle table.
   Les champs déjà connus (nom, parents, matricule, parcours scolaire,
   moyennes annuelles…) sont repris automatiquement du dossier ; une
   valeur saisie dans la fiche prend le dessus.
   ============================================================ */

const FS_NIVEAUX = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const FS_NIVEAU_LABEL = { CP1: 'C.P.1', CP2: 'C.P.2', CE1: 'C.E.1', CE2: 'C.E.2', CM1: 'C.M.1', CM2: 'C.M.2' };
const FS_NB_ANNEES_MED = 8;
const FS_CONSTANTES = [
  ['alb', 'Urines — Alb.'], ['sucre', 'Urines — Sucre'],
  ['avOD', 'AV — OD'], ['avOG', 'AV — OG'], ['aaOD', 'AA — OD'], ['aaOG', 'AA — OG'],
  ['poids', 'Poids'], ['taille', 'Taille']
];

/* ---------------- Utilitaires ---------------- */
function fsGet(obj, path) {
  return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);
}
function fsSet(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) { o[k] = val; return; }
    if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
}
function fsMerge(base, over) {
  Object.keys(over || {}).forEach((k) => {
    const v = over[k];
    if (v && typeof v === 'object') base[k] = fsMerge(base[k] && typeof base[k] === 'object' ? base[k] : (Array.isArray(v) ? [] : {}), v);
    else if (v !== undefined) base[k] = v;
  });
  return base;
}
function fsDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? formatDate(v) : (v || ''); }

/* ---------------- Données ---------------- */
async function fsContexte(id) {
  const eleve = await DB.get('eleves', id);
  if (!eleve) return null;
  const [classe, metas] = await Promise.all([classeById(eleve.classeId), DB.getAll('meta')]);
  return { eleve, classe, meta: (metas || [])[0] || {} };
}

/* Cours suivis déduits du parcours (passages de classe) : année scolaire + moyenne annuelle */
function fsCoursAuto(eleve) {
  const out = {};
  FS_NIVEAUX.forEach((n) => {
    const h = (eleve.historiqueClasses || []).filter((x) => x.niveau === n);
    if (!h.length) return;
    out[n] = {
      date: h.map((x) => x.anneeScolaire).filter(Boolean).join(' / '),
      moyenne: h.map((x) => (x.moyenneAnnuelle !== null && x.moyenneAnnuelle !== undefined && x.moyenneAnnuelle !== '' && Number.isFinite(Number(x.moyenneAnnuelle))) ? Number(x.moyenneAnnuelle).toFixed(2) : '').filter(Boolean).join(' / ')
    };
  });
  return out;
}

/* Valeurs reprises automatiquement du dossier (avant toute saisie dans la fiche) */
function fsDefauts(ctx) {
  const e = ctx.eleve, meta = ctx.meta;
  const auto = fsCoursAuto(e);
  const cours = {};
  FS_NIVEAUX.forEach((n) => { cours[n] = { date: (auto[n] && auto[n].date) || '', moyenne: (auto[n] && auto[n].moyenne) || '', classement: '' }; });
  const courant = e.niveau || (ctx.classe && ctx.classe.niveau);
  if (courant && cours[courant] && !cours[courant].date) cours[courant].date = meta.anneeScolaire || '';
  return {
    lieuNaissance: '',
    professionPere: e.professionParents || '', professionMere: '',
    domicile: [e.village, e.secteur].filter(Boolean).join(', '),
    ethnie: '', religion: '',
    logeur: e.tuteur || '',
    entreLe: e.dateEntreeEcole || e.dateInscription || '',
    venantDe: '',
    sortieLe: e.dateSortie || '',
    allantA: '',
    motifDepart: e.statutMotif || '',
    cours, diplomes: '', observationsDirecteur: '',
    med: {}
  };
}
function fsEff(ctx) {
  return fsMerge(fsDefauts(ctx), JSON.parse(JSON.stringify(ctx.eleve.fiche || {})));
}

/* ---------------- Rendu « papier » (aperçu = impression) ---------------- */
const FS_ENCRE = '#16307a';
function fsChamp(label, val, basis) {
  return `<div style="flex:1 1 ${basis || 200}px; display:flex; gap:5px; align-items:flex-end; min-width:0;">
    <span style="white-space:nowrap;">${esc(label)}</span>
    <span style="flex:1; min-width:30px; border-bottom:1px dotted #333; min-height:19px; padding:0 4px; color:${FS_ENCRE}; font-weight:600; overflow-wrap:anywhere;">${esc(val)}</span></div>`;
}
function fsLigne(...cols) { return `<div style="display:flex; flex-wrap:wrap; gap:6px 16px; align-items:flex-end; margin:6px 0;">${cols.join('')}</div>`; }
function fsBloc(label, val, lignes) {
  return `<div style="margin:8px 0;"><div>${esc(label)}</div>
    <div style="border-bottom:1px dotted #333; min-height:${(lignes || 2) * 22}px; padding:0 4px; color:${FS_ENCRE}; font-weight:600; white-space:pre-wrap; background:repeating-linear-gradient(transparent 0, transparent 21px, #999 21px, #999 22px);">${esc(val)}</div></div>`;
}
const FS_TH = 'border:1px solid #222; padding:4px; text-align:center; font-weight:700;';
const FS_TD = 'border:1px solid #222; padding:4px; text-align:center; color:' + FS_ENCRE + '; font-weight:600; overflow-wrap:anywhere; height:26px;';

function fsHtmlRecto(ctx) {
  const e = ctx.eleve, meta = ctx.meta, f = fsEff(ctx);
  const cours = FS_NIVEAUX.map((n) => f.cours[n] || {});
  return `<div class="fs-page" style="font-family:Georgia,serif; font-size:13.5px; line-height:1.5; color:#111;">
    <div style="text-align:center; margin-bottom:8px;">
      <div style="font-weight:700; letter-spacing:.08em;">BURKINA FASO</div>
      <div style="font-size:22px; font-weight:800; letter-spacing:.1em; margin-top:2px;">FICHE DE SCOLARITÉ</div>
    </div>
    ${fsLigne(fsChamp('Nom :', e.nom, 260))}
    ${fsLigne(fsChamp('Prénom(s) :', e.prenom, 260), `<div style="flex:0 0 auto;">Sexe <span style="display:inline-block; min-width:30px; text-align:center; border:1px solid #222; padding:1px 8px; color:${FS_ENCRE}; font-weight:700;">${e.sexe === 'F' ? 'F' : 'M'}</span></div>`)}
    ${fsLigne(fsChamp('Né(e) le :', fsDate(e.dateNaissance), 200), fsChamp('à :', f.lieuNaissance, 200))}
    ${fsLigne(fsChamp('fils de :', e.pere, 260), fsChamp('Profession :', f.professionPere, 200))}
    ${fsLigne(fsChamp('et de :', e.mere, 260), fsChamp('Profession :', f.professionMere, 200))}
    ${fsLigne(fsChamp('Domicilié à :', f.domicile, 300))}
    ${fsLigne(fsChamp('Ethnie :', f.ethnie, 200), fsChamp('Religion :', f.religion, 200))}
    ${fsLigne(fsChamp('N° Mle :', e.matricule, 180), fsChamp('ÉCOLE :', meta.nomEcole, 260))}
    ${fsLigne(fsChamp('Nom et adresse du logeur (père ou tuteur) :', f.logeur, 300))}
    ${fsLigne(fsChamp('Entré(e) le :', fsDate(f.entreLe), 200), fsChamp('Venant de :', f.venantDe, 200))}
    ${fsLigne(fsChamp('Sortie le :', fsDate(f.sortieLe), 200), fsChamp('Allant à :', f.allantA, 200))}
    ${fsLigne(fsChamp('Motif du départ :', f.motifDepart, 300))}
    <div style="overflow-x:auto; margin-top:10px;">
    <table style="width:100%; border-collapse:collapse; table-layout:fixed; border:2px solid #222; min-width:520px;">
      <colgroup><col style="width:19%">${FS_NIVEAUX.map(() => '<col style="width:13.5%">').join('')}</colgroup>
      <tr><th style="${FS_TH} text-align:left;">Cours suivi</th>${FS_NIVEAUX.map((n) => `<th style="${FS_TH}">${FS_NIVEAU_LABEL[n]}</th>`).join('')}</tr>
      <tr><td style="${FS_TH} text-align:left; font-weight:400;">Date</td>${cours.map((c) => `<td style="${FS_TD}">${esc(c.date)}</td>`).join('')}</tr>
      <tr><td style="${FS_TH} text-align:left; font-weight:400;">Moyenne générale</td>${cours.map((c) => `<td style="${FS_TD}">${esc(c.moyenne)}</td>`).join('')}</tr>
      <tr><td style="${FS_TH} text-align:left; font-weight:400;">Classement</td>${cours.map((c) => `<td style="${FS_TD}">${esc(c.classement)}</td>`).join('')}</tr>
    </table></div>
    <div style="font-size:11px; margin:4px 0 8px;">(1) Indiquer le classement sous forme de fraction : 7e / 39</div>
    ${fsBloc('Diplômes obtenus et date d\'obtention :', f.diplomes, 2)}
    ${fsBloc('Observations du Directeur :', f.observationsDirecteur, 3)}
    <div class="pd-signature" style="margin-top:14px; display:flex; justify-content:flex-end;">
      <div style="text-align:center; min-width:230px;">
        <div style="font-style:italic;">Signature du Directeur</div>
        <div style="height:74px; margin:4px 0; display:flex; align-items:center; justify-content:center; gap:8px;">
          ${meta.cachetDataUrl ? `<img src="${meta.cachetDataUrl}" alt="" style="max-height:74px; max-width:100px; object-fit:contain; opacity:.92;">` : ''}
          ${meta.signatureDataUrl ? `<img src="${meta.signatureDataUrl}" alt="" style="max-height:54px; max-width:130px; object-fit:contain;">` : ''}
        </div>
        <div style="border-top:1px solid #333; padding-top:3px; min-height:16px;">${esc(meta.nomDirecteur || '')}</div>
      </div>
    </div>
    <div style="margin-top:14px; font-size:10.5px; border-top:1px solid #999; padding-top:5px;"><strong>Observation générale :</strong> la présente fiche de scolarité n'est en aucun cas remise à l'enfant à sa sortie définitive de l'école. Il ne peut en être délivré qu'une copie conforme. En cas de mutation, la fiche est transmise directement et sur sa demande au nouveau Directeur.</div>
  </div>`;
}

function fsHtmlVerso(ctx) {
  const f = fsEff(ctx), m = f.med || {};
  const g = (p) => fsGet(m, p) || '';
  const titre = (t) => `<div style="font-weight:800; font-size:15px; margin:14px 0 4px;">${esc(t)}</div>`;
  const cols = Array.from({ length: FS_NB_ANNEES_MED }, (_, i) => i);
  const cellule = (i, k) => `<td style="${FS_TD} height:22px;">${esc(g(`constantes.${i}.${k}`))}</td>`;
  return `<div class="fs-page" style="font-family:Georgia,serif; font-size:13.5px; line-height:1.5; color:#111;">
    <div style="text-align:center; font-size:21px; font-weight:800; letter-spacing:.06em; margin-bottom:6px;">FICHE MÉDICO-SCOLAIRE</div>
    ${titre('A) ANTÉCÉDENTS')}
    <div style="font-weight:700;">1 - Familiaux</div>
    ${fsLigne(fsChamp('Diabète', g('antFam.diabete'), 150), fsChamp('Asthme', g('antFam.asthme'), 150), fsChamp('HTA', g('antFam.hta'), 150))}
    ${fsLigne(fsChamp('Autres', g('antFam.autres'), 300))}
    <div style="font-weight:700; margin-top:8px;">II - Personnels : a) médicaux</div>
    ${fsLigne(fsChamp('Hémoglobine', g('pers.hemoglobine'), 200), fsChamp('Groupe sanguin Rhésus', g('pers.groupe'), 200))}
    ${fsLigne(fsChamp('Diabète', g('pers.diabete'), 150), fsChamp('Asthme', g('pers.asthme'), 150), fsChamp('Rhinites à répétitions', g('pers.rhinites'), 200))}
    ${fsLigne(fsChamp('Angines à répétitions', g('pers.angines'), 200), fsChamp('Trachome', g('pers.trachome'), 150), fsChamp('Poliomyélite', g('pers.polio'), 150))}
    ${fsLigne(fsChamp('Rougeole', g('pers.rougeole'), 200), fsChamp('Autres', g('pers.autres'), 250))}
    ${titre('VACCINATIONS')}
    ${fsLigne(fsChamp('B.C.G.', g('vacc.bcg'), 260), fsChamp('D.T.C.P.', g('vacc.dtcp'), 260))}
    ${fsLigne(fsChamp('ANTI Rougeoleux', g('vacc.rougeoleux'), 260), fsChamp('ANTI Amaril', g('vacc.amaril'), 260))}
    ${fsLigne(fsChamp('ANTI Méningococcique', g('vacc.meningo'), 260), fsChamp('b) Chirurgicaux', g('chir'), 260))}
    ${titre('B) EXAMEN CLINIQUE')}
    <div style="font-weight:700; margin-bottom:4px;">I. CONSTANTES</div>
    <div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; table-layout:fixed; border:2px solid #222; min-width:560px;">
      <colgroup><col style="width:16%">${cols.map(() => '<col style="width:10.5%">').join('')}</colgroup>
      <tr><th style="${FS_TH} text-align:left;">Année</th>${cols.map((i) => `<td style="${FS_TD} height:22px;">${esc(g(`constantes.${i}.annee`))}</td>`).join('')}</tr>
      ${FS_CONSTANTES.map(([k, l]) => `<tr><td style="${FS_TH} text-align:left; font-weight:400; font-size:12px;">${esc(l)}</td>${cols.map((i) => cellule(i, k)).join('')}</tr>`).join('')}
    </table></div>
    <div style="font-weight:700; margin:12px 0 2px;">II - EXAMEN PHYSIQUE</div>
    ${cols.map((i) => `<div style="display:flex; gap:6px; align-items:flex-end; margin:3px 0;"><span style="white-space:nowrap;">20</span><span style="flex:0 0 80px; border-bottom:1px dotted #333; min-height:18px; color:${FS_ENCRE}; font-weight:600;">${esc(g(`physique.${i}.annee`))}</span><span style="flex:1; border-bottom:1px dotted #333; min-height:18px; padding:0 4px; color:${FS_ENCRE}; font-weight:600; overflow-wrap:anywhere;">${esc(g(`physique.${i}.texte`))}</span></div>`).join('')}
    ${titre('OBSERVATIONS')}
    ${fsLigne(fsChamp('- Apte', g('obs.apte'), 300))}
    ${fsLigne(fsChamp('- À surveiller', g('obs.surveiller'), 300))}
    ${fsLigne(fsChamp('- Inapte temporaire', g('obs.inapteTemp'), 300))}
    ${fsLigne(fsChamp('- Inapte définitif', g('obs.inapteDef'), 300))}
  </div>`;
}

/* ---------------- Onglet « Fiche de scolarité » ---------------- */
async function renderFicheScolarite(c, id) {
  const ctx = await fsContexte(id);
  if (!ctx) { c.innerHTML = '<div class="alert alert-terre">Élève introuvable.</div>'; return; }
  const paper = 'background:#fff; color:#111; border:1px solid var(--border); border-radius:8px; padding:16px; margin-top:10px;';
  c.innerHTML = `
    <div class="card">
      <div class="flex justify-between items-center" style="flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">Fiche de scolarité</h3>
        <div class="flex gap-8 no-print" style="flex-wrap:wrap;">
          <button class="btn btn-sm" id="fs-edit">Modifier la fiche</button>
          <button class="btn btn-sm" id="fs-edit-med">Fiche médico-scolaire</button>
          <button class="btn btn-sm" id="fs-print">Imprimer (recto)</button>
          <button class="btn btn-sm btn-primary" id="fs-print-all">Imprimer recto + verso</button>
        </div>
      </div>
      <p class="text-soft" style="font-size:12.5px; margin:6px 0 0;">Nom, parents, matricule, parcours et moyennes annuelles sont repris du dossier de l'élève. Ce que vous saisissez ici (en bleu) prend le dessus.</p>
      <div style="${paper}">${fsHtmlRecto(ctx)}</div>
      <div style="${paper}">${fsHtmlVerso(ctx)}</div>
    </div>`;
  $('#fs-edit', c).onclick = () => fsOuvrirEditeur(c, id, false);
  $('#fs-edit-med', c).onclick = () => fsOuvrirEditeur(c, id, true);
  $('#fs-print', c).onclick = () => fsImprimer(id, false);
  $('#fs-print-all', c).onclick = () => fsImprimer(id, true);
}

async function fsImprimer(id, avecVerso) {
  const ctx = await fsContexte(id);
  if (!ctx) return;
  const html = fsHtmlRecto(ctx) + (avecVerso ? `<div style="break-before:page; page-break-before:always; margin-top:24px;">${fsHtmlVerso(ctx)}</div>` : '');
  printDocument(`Fiche de scolarité — ${ctx.eleve.nom} ${ctx.eleve.prenom}`, html, { sansCadre: true });
}

/* ---------------- Formulaires de saisie ---------------- */
function fsChampForm(label, path, valeur, opts = {}) {
  const full = opts.full ? ' full' : '';
  if (opts.textarea) return `<div class="field${full}"><label>${esc(label)}</label><textarea data-path="${path}" rows="3">${esc(valeur)}</textarea></div>`;
  return `<div class="field${full}"><label>${esc(label)}</label><input data-path="${path}" type="${opts.type || 'text'}" value="${esc(valeur)}"${opts.ph ? ` placeholder="${esc(opts.ph)}"` : ''}>${opts.hint ? `<small>${esc(opts.hint)}</small>` : ''}</div>`;
}
const fsPetit = 'width:100%; min-width:0; padding:4px; font-size:13px;';

function fsCorpsScolarite(f) {
  const champs = [
    ['Lieu de naissance', 'lieuNaissance'], ['Profession du père', 'professionPere'], ['Profession de la mère', 'professionMere'],
    ['Domicilié à', 'domicile'], ['Ethnie', 'ethnie'], ['Religion', 'religion'],
    ['Nom et adresse du logeur (père ou tuteur)', 'logeur']
  ].map(([l, p]) => fsChampForm(l, p, f[p] || '')).join('');
  const dates = fsChampForm('Entré(e) le', 'entreLe', /^\d{4}-\d{2}-\d{2}$/.test(f.entreLe || '') ? f.entreLe : '', { type: 'date', hint: 'Par défaut : date d\'inscription.' })
    + fsChampForm('Venant de', 'venantDe', f.venantDe || '', { ph: 'Recrutement, autre école…' })
    + fsChampForm('Sortie le', 'sortieLe', /^\d{4}-\d{2}-\d{2}$/.test(f.sortieLe || '') ? f.sortieLe : '', { type: 'date' })
    + fsChampForm('Allant à', 'allantA', f.allantA || '')
    + fsChampForm('Motif du départ', 'motifDepart', f.motifDepart || '', { full: true });
  const tableau = `<div class="field full"><label>Cours suivis</label>
    <div class="table-wrap" style="overflow-x:auto;"><table style="min-width:480px; width:100%;"><thead><tr><th>Cours</th><th>Date (année)</th><th>Moyenne générale</th><th>Classement (ex. 7e / 39)</th></tr></thead><tbody>
    ${FS_NIVEAUX.map((n) => {
      const c = f.cours[n] || {};
      return `<tr><td><strong>${FS_NIVEAU_LABEL[n]}</strong></td>
        <td><input style="${fsPetit}" data-path="cours.${n}.date" value="${esc(c.date || '')}" placeholder="2023-2024"></td>
        <td><input style="${fsPetit}" data-path="cours.${n}.moyenne" value="${esc(c.moyenne || '')}"></td>
        <td><input style="${fsPetit}" data-path="cours.${n}.classement" value="${esc(c.classement || '')}"></td></tr>`;
    }).join('')}</tbody></table></div>
    <small>Les années et moyennes se remplissent toutes seules à chaque passage de classe ; vous pouvez les corriger ici.</small></div>`;
  return `<div class="form-grid">${champs}${dates}${tableau}
    ${fsChampForm('Diplômes obtenus et date d\'obtention', 'diplomes', f.diplomes || '', { full: true, textarea: true })}
    ${fsChampForm('Observations du Directeur', 'observationsDirecteur', f.observationsDirecteur || '', { full: true, textarea: true })}
  </div>`;
}

function fsCorpsMedical(f) {
  const m = f.med || {};
  const g = (p) => fsGet(m, p) || '';
  const grp = (titre, items) => `<h4 style="margin:14px 0 6px;">${esc(titre)}</h4><div class="form-grid">${items.map(([l, p]) => fsChampForm(l, 'med.' + p, g(p))).join('')}</div>`;
  const cols = Array.from({ length: FS_NB_ANNEES_MED }, (_, i) => i);
  return `<p class="text-soft" style="font-size:12.5px;">Renseignements médicaux : à remplir uniquement par la personne habilitée (directeur, agent de santé). Tous les champs sont facultatifs.</p>
    ${grp('Antécédents familiaux', [['Diabète', 'antFam.diabete'], ['Asthme', 'antFam.asthme'], ['HTA', 'antFam.hta'], ['Autres', 'antFam.autres']])}
    ${grp('Antécédents personnels (médicaux)', [['Hémoglobine', 'pers.hemoglobine'], ['Groupe sanguin Rhésus', 'pers.groupe'], ['Diabète', 'pers.diabete'], ['Asthme', 'pers.asthme'], ['Rhinites à répétitions', 'pers.rhinites'], ['Angines à répétitions', 'pers.angines'], ['Trachome', 'pers.trachome'], ['Poliomyélite', 'pers.polio'], ['Rougeole', 'pers.rougeole'], ['Autres', 'pers.autres']])}
    ${grp('Vaccinations et antécédents chirurgicaux', [['B.C.G.', 'vacc.bcg'], ['D.T.C.P.', 'vacc.dtcp'], ['ANTI Rougeoleux', 'vacc.rougeoleux'], ['ANTI Amaril', 'vacc.amaril'], ['ANTI Méningococcique', 'vacc.meningo'], ['Chirurgicaux', 'chir']])}
    <h4 style="margin:14px 0 6px;">Constantes (une colonne par année)</h4>
    <div class="table-wrap" style="overflow-x:auto;"><table style="min-width:700px; width:100%;"><thead><tr><th></th>${cols.map((i) => `<th>${i + 1}</th>`).join('')}</tr></thead><tbody>
      <tr><td><strong>Année</strong></td>${cols.map((i) => `<td><input style="${fsPetit}" data-path="med.constantes.${i}.annee" value="${esc(g(`constantes.${i}.annee`))}" placeholder="2024"></td>`).join('')}</tr>
      ${FS_CONSTANTES.map(([k, l]) => `<tr><td style="white-space:nowrap;">${esc(l)}</td>${cols.map((i) => `<td><input style="${fsPetit}" data-path="med.constantes.${i}.${k}" value="${esc(g(`constantes.${i}.${k}`))}"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <h4 style="margin:14px 0 6px;">Examen physique</h4>
    <div class="table-wrap" style="overflow-x:auto;"><table style="min-width:420px; width:100%;"><tbody>
      ${cols.map((i) => `<tr><td style="width:90px;"><input style="${fsPetit}" data-path="med.physique.${i}.annee" value="${esc(g(`physique.${i}.annee`))}" placeholder="Année"></td><td><input style="${fsPetit}" data-path="med.physique.${i}.texte" value="${esc(g(`physique.${i}.texte`))}"></td></tr>`).join('')}
    </tbody></table></div>
    ${grp('Observations', [['Apte', 'obs.apte'], ['À surveiller', 'obs.surveiller'], ['Inapte temporaire', 'obs.inapteTemp'], ['Inapte définitif', 'obs.inapteDef']])}`;
}

async function fsOuvrirEditeur(c, id, medical) {
  const ctx = await fsContexte(id);
  if (!ctx) return;
  const f = fsEff(ctx);
  const defauts = fsDefauts(ctx);
  const overlay = openModal(medical ? 'Fiche médico-scolaire' : 'Modifier la fiche de scolarité', medical ? fsCorpsMedical(f) : fsCorpsScolarite(f), {
    wide: true,
    onSave: async (ov) => {
      const frais = await DB.get('eleves', id); // dossier à jour (une synchro a pu arriver entre-temps)
      const fiche = frais.fiche ? JSON.parse(JSON.stringify(frais.fiche)) : {};
      $all('[data-path]', ov).forEach((inp) => {
        const path = inp.dataset.path;
        const val = inp.value.trim();
        const deja = fsGet(fiche, path);
        const parDefaut = fsGet(defauts, path);
        // On ne fige pas une valeur reprise automatiquement du dossier tant que l'utilisateur ne l'a pas changée
        if (deja === undefined && val === (parDefaut === undefined ? '' : parDefaut)) return;
        fsSet(fiche, path, val);
      });
      frais.fiche = fiche;
      await DB.put('eleves', frais);
      toast(medical ? 'Fiche médico-scolaire enregistrée.' : 'Fiche de scolarité enregistrée.');
      renderFicheScolarite(c, id);
      return true;
    }
  });
  return overlay;
}
