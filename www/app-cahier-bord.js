/* ============================================================
   app-cahier-bord.js — Cahier de bord du directeur (NOUVEAU MODULE)
   ------------------------------------------------------------
   Reprend les rubriques du document officiel « Cahier de bord du
   directeur » (MEBAPLN). Un enregistrement par onglet et par année
   scolaire dans le magasin 'cahierBord' (synchronisé). Additif :
   aucun module existant n'est modifié en profondeur.
   ============================================================ */

const CB_CLS = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const CB_GFT = ['G', 'F', 'T'];
const CB_BMT = ['B', 'M', 'T'];
const CB_AGES = Array.from({ length: 11 }, (_, i) => (i === 10 ? '15 ans et +' : `${i + 5} ans`));
const CB_PROF = ['Cultivateurs', 'Fonctionnaires', 'Ouvriers', 'Commerçants', 'Artisans', 'Militaires', 'Retraités', 'Autres'];
const CB_EXA = ['CEP seul', 'CEP + EG', 'CEP + ET', 'EG seul', 'ET seul'];
const cbNum = (v) => Number(v) || 0;
const cbG = (k, titre, lignes, groupes, sous, o = {}) => ({ t: 'grille', k, titre, lignes, groupes, sous, ...o });
const cbT = (k, titre, cols, o = {}) => ({ t: 'tab', k, titre, cols, ...o });
const cbC = (k, l, o = {}) => ({ k, l, ...o });
const cbTxt = (k, l) => ({ t: 'texte', k, l });

const CB_CEP_P = cbG('cepP', 'Bilan du CEP et du concours d\'entrée en sixième — candidats présents', ['Candidats'], CB_EXA, CB_GFT, { auto: 1, totalCol: 1, lab: '' });
const CB_CEP_A = cbG('cepA', 'Candidats admis', ['Candidats'], CB_EXA, CB_GFT, { auto: 1, totalCol: 1, lab: '' });
const CB_SUIVI = ['premier', 'deuxième', 'troisième'];

const CB_TABS = [
  { id: 'ident', titre: 'Identification', act: 'Remplir depuis l\'application', blocs: [
    { t: 'champs', champs: [
      ['dr', 'Direction régionale'], ['dp', 'Direction provinciale'], ['ceb', 'Circonscription d\'éducation de base'], ['ecole', 'École primaire de'],
      ['matricule', 'N° matricule du responsable'], ['nom', 'Nom et prénom(s)'], ['sexe', 'Sexe', ['M', 'F']], ['grade', 'Grade'],
      ['fonction', 'Fonction'], ['classe', 'Classe tenue'], ['tache', 'Tâche'], ['ancP', 'Ancienneté dans le poste'], ['ancG', 'Ancienneté générale'],
      ['statut', 'Statut de l\'école', ['Publique', 'Privée']], ['nbClasses', 'Nombre de classes', 'number'],
      ['effG', 'Effectif — garçons', 'number'], ['effF', 'Effectif — filles', 'number'] ] },
    { t: 'calc', f: (d) => `<p><b>Effectif total de l'école :</b> ${cbNum(d.effG) + cbNum(d.effF)}</p>` } ] },
  { id: 'personnel', titre: 'Personnel', act: 'Importer les enseignants', blocs: [
    cbT('pers', 'État nominatif du personnel', [cbC('matricule', 'Matricule'), cbC('nom', 'Nom et prénom'), cbC('grade', 'Grade'), cbC('fonction', 'Fonction'), cbC('classe', 'Classe tenue'), cbC('tache', 'Tâche*'), cbC('obs', 'Observations')], { n: 15 }),
    { t: 'note', x: '* Tâche = responsabilisation par rapport aux activités péri et post-scolaires programmées à l\'école.' },
    cbT('sub', 'État nominatif du personnel subalterne', [cbC('nom', 'Nom et prénom(s)'), cbC('fonction', 'Fonction'), cbC('anc', 'Ancienneté'), cbC('res', 'Résidence'), cbC('obs', 'Observation')], { init: [{ fonction: 'Gardien' }, { fonction: 'Cuisinière' }, { fonction: 'Cuisinière' }, {}] }) ] },
  { id: 'eleves', titre: 'Répartition des élèves', act: 'Calculer les âges depuis les élèves', blocs: [
    cbG('prof', 'Répartition des élèves selon la profession du père', CB_PROF, CB_CLS, CB_GFT, { auto: 1, totalCol: 1, lab: 'Profession' }),
    cbG('ages', 'Répartition des élèves par âges et par sexes', CB_AGES, CB_CLS, CB_GFT, { auto: 1, totalCol: 1, lab: 'Âge révolu' }) ] },
  { id: 'materiel', titre: 'Matériel didactique', blocs: [
    cbG('didac', 'Situation du matériel didactique de l\'école', null, CB_CLS, [''], { libre: 1, n: 12, totalCol: 1, lab: 'Genre — matière (livres guides, livres d\'élèves, matériel de calcul, autres)' }) ] },
  { id: 'patrimoine', titre: 'Mobilier & immobilier', blocs: [
    cbG('mob', 'Mobilier scolaire', ['Tables-bancs', 'Bureaux', 'Chaises', 'Armoires', 'Tableaux à chevalet', 'Tableaux d\'affichage'], ['Nombre et état'], CB_BMT, { auto: 1, lab: 'Article' }),
    cbTxt('comMob', 'Commentaires'),
    cbG('imm', 'Immobilier scolaire', ['Salles de classe', 'Logements', 'Cuisines', 'Latrines', 'Puits', 'Forages', 'Jardin', 'Champ scolaire'], ['Nombre et état'], CB_BMT, { auto: 1, lab: 'Local' }),
    cbTxt('comImm', 'Commentaires'),
    cbG('autres', 'Autres mobiliers scolaires', ['Marmites', 'Cuvettes', 'Seaux', 'Arrosoirs', 'Brouettes', 'Charrues', 'Charrettes'], ['Nombre et état'], CB_BMT, { auto: 1, lab: 'Article' }),
    cbTxt('comAutres', 'Commentaires'),
    { t: 'note', x: 'B = bon état · M = mauvais état · T = total (calculé).' } ] },
  { id: 'plans', titre: 'Plans d\'amélioration', blocs: [
    cbT('pai', 'Plans d\'amélioration individuels', [cbC('classe', 'Classe', { fixe: 1 }), cbC('eff', 'Effectif'), cbC('probleme', 'Situation problème'), cbC('causes', 'Principales causes'), cbC('act', 'Activités'), cbC('ech', 'Échéances'), cbC('pd', '% début d\'année'), cbC('pf', '% fin d\'année')], { init: CB_CLS.map((c) => ({ classe: c })), fixe: 1 }),
    cbT('pac1', 'Plan d\'amélioration collectif — analyse du problème', [cbC('pb', 'Problème'), cbC('man', 'Manifestations'), cbC('cau', 'Causes'), cbC('con', 'Conséquences')], { n: 1 }),
    cbT('pac2', 'Plan d\'amélioration', [cbC('obj', 'Objectifs'), cbC('act', 'Activités'), cbC('cal', 'Calendrier d\'exécution'), cbC('ind', 'Indicateur de progrès'), cbC('met', 'Méthode de collecte')], { n: 3 }),
    cbT('sout', 'Mécanisme de soutien', [cbC('bes', 'Besoins en formation'), cbC('moy', 'Moyens'), cbC('dir', 'Soutien attendu du directeur'), cbC('enc', 'Soutien attendu des encadreurs'), cbC('par', 'Soutien des partenaires')], { n: 1 }),
    cbT('eval', 'Mécanisme d\'évaluation', [cbC('x', '', { fixe: 1 }), cbC('el', 'Des élèves'), cbC('en', 'Des enseignants'), cbC('pa', 'Des partenaires')], { init: [{ x: 'Résultats attendus' }, { x: 'Indicateurs de progrès' }], fixe: 1 }) ] },
  { id: 'suivi', titre: 'Suivi du PAC', blocs: [0, 1, 2].flatMap((i) => [
    cbT('suivi' + i, `Tableau de suivi du PAC : ${CB_SUIVI[i]} trimestre`, [cbC('disc', 'Discipline'), cbC('pd', '% début'), cbC('pv', '% visé'), cbC('ech', 'Échéance'), cbC('pa', '% atteint'),
      cbC('ecart', 'Écart observé', { auto: (r) => ((r.pa === undefined || r.pa === '' || r.pv === undefined || r.pv === '') ? '' : cbNum(r.pa) - cbNum(r.pv)) }), cbC('obs', 'Observations : raisons ou causes')], { n: 4 }),
    cbTxt('sol' + i, 'Solutions préconisées'), cbTxt('exp' + i, 'Expériences à partager') ]) },
  { id: 'notes', titre: 'Feuilles de notes', blocs: [
    cbT('notes', 'Feuilles de notes', [cbC('date', 'Date', { type: 'date' }), cbC('evt', 'Événements', { type: 'area' }), cbC('obs', 'Observations', { type: 'area' })], { n: 12 }) ] },
  { id: 'bilan', titre: 'Bilan de fin d\'année', act: 'Pré-remplir depuis les élèves', blocs: [
    cbG('bil', 'Bilan général de fin d\'année', CB_CLS, ['Effectif début', 'Effectif fin', 'Promus', 'Abandons', 'Exclus', 'Arrivées', 'Départs', 'Redoublants'], CB_GFT, { auto: 1, totalRow: 1, lab: 'Classe' }),
    cbTxt('comBil', 'Commentaires'),
    CB_CEP_P, CB_CEP_A,
    { t: 'calc', f: (d) => {
      const s = (b, gs) => gs.reduce((t, g) => t + cbCell(b, d, 0, g, 2), 0);
      const p = (a, b) => (b ? Math.round((a / b) * 100) + ' %' : '—');
      return `<p><b>% de succès — examen (CEP) :</b> ${p(s(CB_CEP_A, [0, 1, 2]), s(CB_CEP_P, [0, 1, 2]))} &nbsp;·&nbsp; <b>concours (EG / ET) :</b> ${p(s(CB_CEP_A, [3, 4]), s(CB_CEP_P, [3, 4]))}</p>`;
    } } ] },
  { id: 'programme', titre: 'Programme d\'activités', blocs: [
    cbT('prog', 'Programme d\'activités annuelles', [cbC('n', 'N°'), cbC('obj', 'Objectifs'), cbC('act', 'Activités'), cbC('ech', 'Échéances'), cbC('con', 'Contraintes de réalisation'), cbC('res', 'Résultats attendus')], { n: 9 }),
    cbTxt('comProg', 'Commentaires') ] }
];

const CB_BLOCS = {};
CB_TABS.forEach((t) => t.blocs.forEach((b) => { if (b.k) CB_BLOCS[b.k] = b; }));

/* ---------------- Calculs ---------------- */
function cbNbl(b, d) { return b.lignes ? b.lignes.length : ((d[b.k] || {}).n || b.n || 1); }

/* Valeur d'une cellule de grille. i / g = 'T' → total de la ligne / de la colonne. */
function cbCell(b, d, i, g, s) {
  const c = (d[b.k] || {}).c || {};
  if (i === 'T') { let t = 0; for (let r = 0; r < cbNbl(b, d); r++) t += cbCell(b, d, r, g, s); return t; }
  if (g === 'T') { let t = 0; for (let h = 0; h < b.groupes.length; h++) t += cbCell(b, d, i, h, s); return t; }
  if (b.auto && b.sous[s] === 'T') { let t = 0; b.sous.forEach((x, u) => { if (x !== 'T') t += cbNum(c[`${i}|${g}|${u}`]); }); return t; }
  return cbNum(c[`${i}|${g}|${s}`]);
}

function cbRows(b, d) {
  if (!Array.isArray(d[b.k])) d[b.k] = (b.init || Array.from({ length: b.n || 1 }, () => ({}))).map((r) => ({ ...r }));
  return d[b.k];
}

/* ---------------- Rendu ---------------- */
function cbBloc(b, d, ro) {
  const TS = ro ? 'style="width:100%;border-collapse:collapse;font-size:11px;" border="1" cellpadding="3"' : '';
  const H = b.titre ? `<h4 style="margin:18px 0 8px;">${esc(b.titre)}</h4>` : '';
  const wrap = (x) => (ro ? x : `<div class="table-wrap cb-sticky">${x}</div>`);
  if (b.t === 'note') return `<p class="text-soft" style="font-size:12px;">${esc(b.x)}</p>`;
  if (b.t === 'calc') return `<div data-calc="${CB_TABS.findIndex((t) => t.blocs.includes(b))}|${CB_TABS.flatMap((t) => t.blocs).indexOf(b)}">${b.f(d)}</div>`;
  if (b.t === 'texte') {
    return `<div class="field full" style="margin:12px 0;"><label>${esc(b.l)}</label>${ro ? `<div>${esc(d[b.k] || '—')}</div>` : `<textarea class="cb-in" data-w="x" data-k="${b.k}">${esc(d[b.k] || '')}</textarea>`}</div>`;
  }
  if (b.t === 'champs') {
    if (ro) return `<table ${TS}>${b.champs.map(([k, l]) => `<tr><td><b>${esc(l)}</b></td><td>${esc(d[k] ?? '')}</td></tr>`).join('')}</table>`;
    return `<div class="form-grid">${b.champs.map(([k, l, o]) => `<div class="field"><label>${esc(l)}</label>${Array.isArray(o)
      ? `<select class="cb-in" data-w="f" data-k="${k}"><option value="">—</option>${o.map((v) => `<option ${d[k] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
      : `<input class="cb-in" data-w="f" data-k="${k}" type="${o || 'text'}" value="${esc(d[k] ?? '')}">`}</div>`).join('')}</div>`;
  }
  if (b.t === 'tab') {
    const rows = cbRows(b, d);
    const head = b.cols.map((c) => `<th>${esc(c.l)}</th>`).join('') + (ro || b.fixe ? '' : '<th></th>');
    const body = rows.map((r, i) => `<tr>${b.cols.map((c) => {
      if (c.fixe) return `<td><b>${esc(r[c.k] || '')}</b></td>`;
      if (c.auto) return `<td data-ea="${b.k}|${i}|${c.k}">${esc(c.auto(r))}</td>`;
      if (ro) return `<td>${esc(r[c.k] ?? '')}</td>`;
      const at = `class="cb-in" data-w="t" data-k="${b.k}" data-r="${i}" data-c="${c.k}"`;
      return `<td>${c.type === 'area' ? `<textarea ${at} rows="2">${esc(r[c.k] ?? '')}</textarea>` : `<input ${at} type="${c.type || 'text'}" value="${esc(r[c.k] ?? '')}">`}</td>`;
    }).join('')}${ro || b.fixe ? '' : `<td><button class="btn btn-sm btn-danger" data-del="${b.k}|${i}">×</button></td>`}</tr>`).join('');
    return `${H}${wrap(`<table ${TS}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)}${ro || b.fixe ? '' : `<button class="btn btn-sm" style="margin-top:8px;" data-add="${b.k}">+ Ligne</button>`}`;
  }
  /* grille */
  const D = d[b.k] || {}, c = D.c || {}, lab = D.lab || {};
  const n = cbNbl(b, d), multi = b.sous.length > 1;
  const gr = [...b.groupes, ...(b.totalCol ? ['TOTAL'] : [])];
  const h1 = `<tr><th ${multi ? 'rowspan="2"' : ''}>${esc(b.lab || '')}</th>${gr.map((g) => `<th colspan="${b.sous.length}" style="text-align:center;">${esc(g)}</th>`).join('')}</tr>`;
  const h2 = multi ? `<tr>${gr.map(() => b.sous.map((s) => `<th style="text-align:center;">${esc(s)}</th>`).join('')).join('')}</tr>` : '';
  const cell = (i, g, s) => {
    if (i === 'T' || g === 'T' || (b.auto && b.sous[s] === 'T')) return `<td style="text-align:center;font-weight:600;" data-a="${b.k}|${i}|${g}|${s}">${cbCell(b, d, i, g, s)}</td>`;
    const v = c[`${i}|${g}|${s}`] ?? '';
    return ro ? `<td style="text-align:center;">${esc(v)}</td>` : `<td><input class="cb-in cb-g" inputmode="numeric" data-w="g" data-k="${b.k}" data-g="${i}|${g}|${s}" value="${esc(v)}"></td>`;
  };
  const ligne = (i) => `<tr><td>${b.lignes ? esc(b.lignes[i]) : (ro ? esc(lab[i] || '') : `<input class="cb-in" style="min-width:120px;" data-w="l" data-k="${b.k}" data-i="${i}" value="${esc(lab[i] || '')}">`)}</td>${gr.map((_, g) => b.sous.map((_s, s) => cell(b.totalCol && g === b.groupes.length ? i : i, b.totalCol && g === b.groupes.length ? 'T' : g, s)).join('')).join('')}</tr>`;
  let rows = ''; for (let i = 0; i < n; i++) rows += ligne(i);
  if (b.totalRow) rows += `<tr><td><b>TOTAL</b></td>${gr.map((_, g) => b.sous.map((_s, s) => cell('T', g === b.groupes.length ? 'T' : g, s)).join('')).join('')}</tr>`;
  return `${H}${wrap(`<table ${TS}><thead>${h1}${h2}</thead><tbody>${rows}</tbody></table>`)}${!ro && b.libre ? `<button class="btn btn-sm" style="margin-top:8px;" data-add="${b.k}">+ Ligne</button>` : ''}`;
}

/* Mise à jour des totaux / écarts / blocs calculés sans re-rendre les champs de saisie. */
function cbMaj(root, d) {
  $all('[data-a]', root).forEach((td) => {
    const [k, i, g, s] = td.dataset.a.split('|');
    td.textContent = cbCell(CB_BLOCS[k], d, i === 'T' ? 'T' : Number(i), g === 'T' ? 'T' : Number(g), Number(s));
  });
  $all('[data-ea]', root).forEach((td) => {
    const [k, i, ck] = td.dataset.ea.split('|');
    const col = CB_BLOCS[k].cols.find((x) => x.k === ck);
    td.textContent = col.auto((d[k] || [])[Number(i)] || {});
  });
  const flat = CB_TABS.flatMap((t) => t.blocs);
  $all('[data-calc]', root).forEach((el) => { el.innerHTML = flat[Number(el.dataset.calc.split('|')[1])].f(d); });
}

/* ---------------- Remplissages automatiques depuis les autres rubriques ---------------- */
const CB_ACT = {
  async ident(d) {
    const [metaAll, classes, eleves] = await Promise.all([DB.getAll('meta'), DB.getAll('classes'), DB.getAll('eleves')]);
    const meta = metaAll[0] || {};
    const actifs = eleves.filter((e) => (e.statut || 'actif') === 'actif');
    if (!d.nom && meta.nomDirecteur) d.nom = meta.nomDirecteur;
    if (!d.ecole && meta.nomEcole) d.ecole = meta.nomEcole;
    if (!d.fonction) d.fonction = 'Directeur';
    d.nbClasses = classes.length;
    d.effG = actifs.filter((e) => e.sexe !== 'F').length;
    d.effF = actifs.filter((e) => e.sexe === 'F').length;
  },
  async personnel(d) {
    const [ens, classes] = await Promise.all([DB.getAll('enseignants'), DB.getAll('classes')]);
    const cn = Object.fromEntries(classes.map((c) => [c.id, c.nom]));
    const b = CB_BLOCS.pers;
    const rows = cbRows(b, d).filter((r) => r.nom || r.matricule);
    ens.forEach((e) => {
      const nom = `${e.nom || ''} ${e.prenom || ''}`.trim();
      if (rows.some((r) => (e.matricule && r.matricule === e.matricule) || r.nom === nom)) return;
      rows.push({ matricule: e.matricule || '', nom, fonction: e.fonction || '', classe: cn[e.classeId] || '' });
    });
    while (rows.length < 15) rows.push({});
    d.pers = rows;
  },
  async eleves(d) {
    if (Object.keys((d.ages || {}).c || {}).length && !(await confirmDialog('Remplacer le tableau « âges et sexes » par le calcul à partir des élèves ?'))) return false;
    const [classes, eleves] = await Promise.all([DB.getAll('classes'), DB.getAll('eleves')]);
    const cn = Object.fromEntries(classes.map((c) => [c.id, (c.nom || '').toUpperCase().replace(/\s/g, '')]));
    const c = {}; let ignores = 0;
    eleves.filter((e) => (e.statut || 'actif') === 'actif').forEach((e) => {
      const g = CB_CLS.indexOf(cn[e.classeId]), age = calcAge(e.dateNaissance);
      if (g < 0 || age === '—') { ignores++; return; }
      const key = `${Math.min(Math.max(age, 5), 15) - 5}|${g}|${e.sexe === 'F' ? 1 : 0}`;
      c[key] = (c[key] || 0) + 1;
    });
    d.ages = { c };
    if (ignores) toast(`${ignores} élève(s) ignoré(s) (date de naissance ou classe non reconnue).`);
  },
  async bilan(d) {
    if (!(await confirmDialog('Remplir « Effectif fin », « Abandons » et « Départs » à partir du statut des élèves ? Les valeurs saisies dans ces colonnes seront remplacées.'))) return false;
    const [classes, eleves] = await Promise.all([DB.getAll('classes'), DB.getAll('eleves')]);
    const cn = Object.fromEntries(classes.map((c) => [c.id, (c.nom || '').toUpperCase().replace(/\s/g, '')]));
    const c = { ...((d.bil || {}).c || {}) };
    for (let i = 0; i < 6; i++) [1, 3, 6].forEach((g) => { c[`${i}|${g}|0`] = 0; c[`${i}|${g}|1`] = 0; });
    const col = { actif: 1, abandon: 3, transfere: 6 };
    eleves.forEach((e) => {
      const i = CB_CLS.indexOf(cn[e.classeId]), g = col[e.statut || 'actif'];
      if (i < 0 || g === undefined) return;
      c[`${i}|${g}|${e.sexe === 'F' ? 1 : 0}`]++;
    });
    d.bil = { ...(d.bil || {}), c };
  }
};

/* ---------------- Page ---------------- */
/* Moteur de page commun au cahier du directeur et au cahier de l'enseignant.
   cfg = { tabs, store, titre, ens (identifiant de synchro de l'enseignant ou null), ensRec } */
async function cbPage(root, cfg) {
  const meta = (await DB.getAll('meta'))[0] || {};
  const annee = meta.anneeScolaire || anneeScolaireCourante();
  const all = (await DB.getAll(cfg.store)).filter((r) => r.annee === annee && (r.ens || null) === (cfg.ens || null));
  cfg.annee = annee;
  const st = { tab: cfg.tabs[0], rec: null, d: {}, dirty: false };
  const charger = (tab) => {
    st.tab = tab; st.dirty = false;
    st.rec = all.find((r) => r.cle === tab.id) || { cle: tab.id, annee, ens: cfg.ens || null, data: {} };
    st.d = JSON.parse(JSON.stringify(st.rec.data || {}));
  };
  const chargerSync = async (tab) => {
    charger(tab);
    if (!st.rec.id && CB_ACT[tab.id]) { try { await CB_ACT[tab.id](st.d, cfg, true); st.dirty = true; } catch (e) { console.warn('Synchro cahier', e); } }
  };
  const sauver = async (silencieux) => {
    st.rec.data = st.d; st.rec.maj = new Date().toISOString();
    if (st.rec.id) await DB.put(cfg.store, st.rec);
    else { st.rec.id = await DB.add(cfg.store, st.rec); all.push(st.rec); }
    st.dirty = false;
    if (!silencieux) toast('Cahier de bord enregistré.');
  };
  const htmlTab = (tab, d) => tab.blocs.map((b) => cbBloc(b, d, true)).join('');
  const imprimer = (tabs) => printDocument(cfg.titre + ' — ' + (tabs.length === 1 ? tabs[0].titre : 'année ' + annee),
    tabs.map((t, i) => {
      const r = all.find((x) => x.cle === t.id), d = t === st.tab ? st.d : JSON.parse(JSON.stringify(r ? r.data : {}));
      return `<div style="${i ? 'page-break-before:always;' : ''}"><h3 style="text-align:center;">${esc(t.titre.toUpperCase())}</h3>${htmlTab(t, d)}</div>`;
    }).join(''));

  root.innerHTML = `<p class="text-soft" style="margin-top:0;">Année scolaire ${esc(annee)} — un cahier par année (changez l'année dans Paramètres pour en ouvrir un nouveau ; les anciens sont conservés).</p>
    <div class="tabs" id="cb-tabs"></div><div id="cb-body"></div>`;

  const aff = () => {
    $('#cb-tabs').innerHTML = cfg.tabs.map((t) => `<button class="tab ${t === st.tab ? 'active' : ''}" data-tab="${t.id}">${esc(t.titre)}</button>`).join('');
    $('#cb-body').innerHTML = `<div class="card">
      <div class="table-toolbar" style="flex-wrap:wrap;">
        <h3 style="flex:1;margin:0;min-width:160px;">${esc(st.tab.titre)}</h3>
        ${st.tab.act ? `<button class="btn btn-sm" id="cb-act">${esc(st.tab.act)}</button>` : ''}
        <button class="btn btn-primary btn-sm" id="cb-save">Enregistrer</button>
        <button class="btn btn-sm" id="cb-print">Imprimer / PDF</button>
        <button class="btn btn-sm" id="cb-all">Tout le cahier</button>
      </div>${st.tab.blocs.map((b) => cbBloc(b, st.d, false)).join('')}</div>`;
  };

  root.onclick = async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tab) {
      if (st.dirty) await sauver(true);
      await chargerSync(cfg.tabs.find((x) => x.id === t.dataset.tab)); return aff();
    }
    if (t.dataset.add) {
      const b = CB_BLOCS[t.dataset.add];
      if (b.t === 'tab') cbRows(b, st.d).push({}); else { st.d[b.k] = st.d[b.k] || {}; st.d[b.k].n = cbNbl(b, st.d) + 1; }
      st.dirty = true; return aff();
    }
    if (t.dataset.del) {
      const [k, i] = t.dataset.del.split('|'); cbRows(CB_BLOCS[k], st.d).splice(Number(i), 1);
      st.dirty = true; return aff();
    }
    if (t.id === 'cb-save') return sauver();
    if (t.id === 'cb-print') return imprimer([st.tab]);
    if (t.id === 'cb-all') { if (st.dirty) await sauver(true); return imprimer(cfg.tabs); }
    if (t.id === 'cb-act') {
      if ((await CB_ACT[st.tab.id](st.d, cfg, false)) === false) return;
      st.dirty = true; aff(); toast('Données synchronisées avec l\'application — pensez à enregistrer.');
    }
  };
  root.oninput = (e) => {
    const el = e.target, w = el.dataset.w; if (!w) return;
    const d = st.d, k = el.dataset.k;
    if (w === 'f') d[k] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    else if (w === 'x') d[k] = el.value;
    else if (w === 't') cbRows(CB_BLOCS[k], d)[Number(el.dataset.r)][el.dataset.c] = el.value;
    else { d[k] = d[k] || {}; if (w === 'g') (d[k].c = d[k].c || {})[el.dataset.g] = el.value; else (d[k].lab = d[k].lab || {})[el.dataset.i] = el.value; }
    st.dirty = true; cbMaj(root, d);
  };

  await chargerSync(cfg.tabs[0]); aff();
}

ROUTES['#/cahier-bord'] = (root) => cbPage(root, { tabs: CB_TABS, store: 'cahierBord', titre: 'Cahier de bord du directeur', ens: null });

