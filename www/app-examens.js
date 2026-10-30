/* ============================================================
   app-examens.js — Espace Examen CEP / CEB (NOUVEAU MODULE)
   ------------------------------------------------------------
   Sessions d'examen, tableau de bord, candidats, centres et salles,
   jurys. La correction anonyme et les résultats sont dans
   app-examens-correction.js ; les documents imprimables dans
   app-examens-docs.js ; les calculs dans app-examens-calcul.js.

   Magasins (synchronisés, voir db.js) :
     examSessions · examCentres · examJurys · examCandidats · examNotes
   Tous les liens entre enregistrements se font par _uuid (stable d'un
   appareil à l'autre) : sessionUuid, centreUuid, eleveUuid…
   Une note = une ligne par (session, épreuve, code d'anonymat), avec
   un _uuid déterministe : plusieurs correcteurs peuvent saisir en même
   temps sur des téléphones différents sans s'écraser.
   ============================================================ */

const EX_ETAT = { tab: 'tableau', sessionUuid: null, q: '', fCentre: '', fStatut: '', fEcole: '', fFonction: '', epreuve: '' };
const EX_TABS = [
  { id: 'tableau', label: 'Tableau de bord' },
  { id: 'candidats', label: '1. Inscription' },
  { id: 'centres', label: '2. Jurys & centres' },
  { id: 'jurys', label: '3. Acteurs' },
  { id: 'correction', label: '4. Saisie des notes' },
  { id: 'resultats', label: '5. Résultats & PV' }
];
const EX_RENDERERS = {}; // rempli ici et dans app-examens-correction.js

function exDirection() { return !!currentUser && ['directeur', 'directeur_adjoint', 'ceb', 'dpeppnf', 'dreppnf', 'ministere'].includes(currentUser.role); }
function exAutorise() { return typeof routeAutorisee === 'function' && routeAutorisee('#/examens'); }
function exVerrouille(session) {
  if (session && session.resultatsVerrouilles) { toast("La délibération est clôturée : rouvrez-la (onglet Résultats) pour modifier."); return true; }
  return false;
}
const exLib = (liste, v) => { const t = liste.find((x) => x[0] === v); return t ? t[1] : v || ''; };
const exNomComplet = (c) => `${c.nom || ''} ${c.prenom || ''}`.trim();

/* ---------------- Chargement ---------------- */
async function exChargerSessions() {
  const l = await DB.getAll('examSessions');
  return l.sort((a, b) => String(b.dateDebut || b.annee || '').localeCompare(String(a.dateDebut || a.annee || '')) || b.id - a.id);
}
async function exChargerCtx(session) {
  const [centres, jurys, candidats, notes, meta] = await Promise.all([
    DB.getAll('examCentres'), DB.getAll('examJurys'), DB.getAll('examCandidats'), DB.getAll('examNotes'), DB.getAll('meta')
  ]);
  const f = (l) => l.filter((x) => x.sessionUuid === session._uuid);
  return {
    session, meta: meta[0] || {},
    centres: f(centres).sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')),
    jurys: f(jurys), candidats: f(candidats), notes: f(notes)
  };
}
const exCentreNom = (ctx, uuid) => { const c = ctx.centres.find((x) => x._uuid === uuid); return c ? c.nom : ''; };

/* Renumérote les n° PV de toute la session (après changement de centre, de jury ou de répartition) */
async function exRecalculerPV(ctx, centres) {
  const cands = (await DB.getAll('examCandidats')).filter((x) => x.sessionUuid === ctx.session._uuid);
  const pv = exNumerosPV(cands, centres);
  for (const c of cands) {
    const n = pv.get(c._uuid) || '';
    if ((c.numeroPV || '') !== n) await DB.put('examCandidats', { ...c, numeroPV: n });
  }
}

/* ---------------- Analyse : contrôles de préparation ---------------- */
function exAnalyse(ctx) {
  const { session, centres, jurys, candidats, notes } = ctx;
  const eps = session.epreuves || [];
  const capTotale = centres.reduce((s, c) => s + exSalles(c).length * (Number(c.capaciteSalle) || 0), 0);
  const sansCentre = candidats.filter((c) => !c.centreUuid || !c.salle);
  const sansAnon = candidats.filter((c) => !c.anonymat);
  const centresSansChef = centres.filter((c) => !jurys.some((j) => j.fonction === 'chef_centre' && j.centreUuid === c._uuid));
  const sallesSansSurv = [];
  centres.forEach((c) => exSalles(c).forEach((s) => {
    const nb = candidats.filter((x) => x.centreUuid === c._uuid && x.salle === s).length;
    if (nb && !jurys.some((j) => j.fonction === 'surveillant' && j.centreUuid === c._uuid && j.salle === s)) sallesSansSurv.push({ centre: c, salle: s, nb });
  }));
  // Conflit d'intérêts : un surveillant ou un chef de centre qui surveille des candidats de sa propre école
  const conflits = [];
  jurys.forEach((j) => {
    if (!['surveillant', 'chef_centre', 'secretaire_centre'].includes(j.fonction) || !j.centreUuid || !exCleEcole(j.ecoleOrigine)) return;
    const k = exCleEcole(j.ecoleOrigine);
    const nb = candidats.filter((x) => x.centreUuid === j.centreUuid && (j.fonction !== 'surveillant' || !j.salle || x.salle === j.salle) && exCleEcole(x.ecole) === k).length;
    if (nb) conflits.push({ jure: j, nb });
  });
  const attendus = new Set(candidats.filter((c) => c.anonymat && !['absent', 'exclu'].includes(c.statut)).map((c) => c.anonymat));
  let ecarts = 0;
  const progression = eps.map((ep) => {
    let faites = 0;
    notes.forEach((n) => {
      if (n.epreuveCode !== ep.code || !attendus.has(n.anonymat)) return;
      const f = exNoteFinale(n, ep, session);
      if (['ok', 'absent', 'fraude'].includes(f.etat)) faites++;
      if (f.etat === 'ecart') ecarts++;
    });
    return { ep, faites, total: attendus.size };
  });
  return { eps, capTotale, sansCentre, sansAnon, centresSansChef, sallesSansSurv, conflits, progression, ecarts, attendus: attendus.size };
}

/* ---------------- Page ---------------- */
ROUTES['#/examens'] = async (root) => {
  const p = getHashParams().get('tab');
  if (p && EX_TABS.some((t) => t.id === p)) EX_ETAT.tab = p;
  const sessions = await exChargerSessions();
  if (!sessions.length) {
    root.innerHTML = `<div class="empty-state"><div class="big">🎓</div>
      <p>Aucune session d'examen pour l'instant.</p>
      <p class="text-soft" style="max-width:520px;margin:0 auto 14px;">Une session regroupe les candidats, les centres, les jurys, la correction et les résultats d'un examen (CEP, CEP + concours d'entrée en 6e, ou examen blanc d'entraînement).</p>
      <button class="btn btn-accent" id="ex-new">+ Créer la première session</button></div>`;
    $('#ex-new').onclick = () => exFormSession(null);
    return;
  }
  if (!sessions.some((s) => s._uuid === EX_ETAT.sessionUuid)) EX_ETAT.sessionUuid = sessions[0]._uuid;
  const session = sessions.find((s) => s._uuid === EX_ETAT.sessionUuid);
  const ctx = await exChargerCtx(session);

  root.innerHTML = `
    <div class="table-toolbar no-print">
      <select id="ex-session" class="search-input" style="min-width:220px;">${sessions.map((s) => `<option value="${esc(s._uuid)}" ${s._uuid === session._uuid ? 'selected' : ''}>${esc(s.libelle)}</option>`).join('')}</select>
      <span class="badge badge-indigo">${esc(EX_TYPES[session.type] || session.type || '')}</span>
      ${session.resultatsVerrouilles ? '<span class="badge badge-vert">Délibération clôturée</span>' : ''}
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="ex-edit">Paramètres de la session</button>
      <button class="btn btn-sm" id="ex-new">+ Nouvelle session</button>
      ${exDirection() ? '<button class="btn btn-sm btn-danger" id="ex-del">Supprimer</button>' : ''}
    </div>
    <div class="tabs no-print" id="ex-tabs">${EX_TABS.map((t) => `<button class="tab" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}</div>
    <div id="ex-contenu"></div>`;
  $('#ex-session').onchange = (e) => { EX_ETAT.sessionUuid = e.target.value; EX_ETAT.epreuve = ''; onRouteChange(); };
  $('#ex-new').onclick = () => exFormSession(null);
  $('#ex-edit').onclick = () => exFormSession(session);
  if ($('#ex-del')) $('#ex-del').onclick = () => exSupprimerSession(ctx);
  const montrer = async (t) => {
    EX_ETAT.tab = t;
    $all('.tab', $('#ex-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    const c = $('#ex-contenu');
    c.innerHTML = '<p class="text-soft">Chargement…</p>';
    // Données relues à chaque changement d'onglet : les notes saisies dans l'onglet Correction
    // ne rechargent pas la page, il ne faut pas afficher des résultats périmés.
    const frais = await exChargerCtx(ctx.session);
    Object.assign(ctx, { centres: frais.centres, jurys: frais.jurys, candidats: frais.candidats, notes: frais.notes, meta: frais.meta });
    await EX_RENDERERS[t](c, ctx);
  };
  $('#ex-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) montrer(b.dataset.tab); };
  await montrer(EX_ETAT.tab);
};

/* ---------------- Session : création / paramètres ---------------- */
async function exFormSession(ex) {
  if (!exAutorise()) return;
  if (ex && ex.resultatsVerrouilles) { toast("La délibération est clôturée : rouvrez-la d'abord (onglet Résultats) pour changer les paramètres."); return; }
  const meta = (await DB.getAll('meta'))[0] || {};
  const annee0 = ex ? ex.annee : (meta.anneeScolaire || anneeScolaireCourante());
  const eps = (ex ? ex.epreuves : EX_EPREUVES_DEFAUT).map((e) => ({ ...e }));
  const mentions = ex ? ex.mentions : EX_MENTIONS_DEFAUT;
  const codesAvecNotes = new Set();
  if (ex) (await DB.getAll('examNotes')).filter((n) => n.sessionUuid === ex._uuid).forEach((n) => codesAvecNotes.add(n.epreuveCode));
  const v = (k, d = '') => esc(ex ? (ex[k] ?? d) : d);

  const ov = openModal(ex ? 'Paramètres de la session' : 'Nouvelle session d\'examen', `
    <div class="alert alert-ocre">Épreuves, coefficients, barèmes, seuil d'admission et mentions sont des valeurs de départ : alignez-les sur la note de service de votre DREPPNF / CEB avant de saisir des notes.</div>
    <div class="form-grid">
      <div class="field full"><label>Intitulé de la session *</label><input id="ex-s-lib" value="${ex ? v('libelle') : esc('CEP ' + annee0)}" placeholder="Ex : CEP 2026-2027 — CEB de …"></div>
      <div class="field"><label>Année / session *</label><input id="ex-s-annee" value="${esc(annee0)}"></div>
      <div class="field"><label>Type d'examen</label><select id="ex-s-type">${Object.entries(EX_TYPES).map(([k, l]) => `<option value="${k}" ${(ex ? ex.type : 'cep') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>CEB (circonscription)</label><input id="ex-s-ceb" value="${ex ? v('ceb') : esc(meta.ceb || '')}"></div>
      <div class="field"><label>Province</label><input id="ex-s-prov" value="${v('province')}"></div>
      <div class="field"><label>Région</label><input id="ex-s-reg" value="${v('region')}"></div>
      <div class="field"><label>Préfixe des n° de table</label><input id="ex-s-pref" value="${v('prefixeTable')}" placeholder="Ex : T (facultatif)" maxlength="4"></div>
      <div class="field"><label>Date de début</label><input type="date" id="ex-s-debut" value="${v('dateDebut')}"></div>
      <div class="field"><label>Date de fin</label><input type="date" id="ex-s-fin" value="${v('dateFin')}"></div>
      <div class="field"><label>Date de proclamation des résultats</label><input type="date" id="ex-s-res" value="${v('dateResultats')}"></div>
      <div class="field"><label>Seuil d'admission (moyenne /20) *</label><input id="ex-s-seuil" inputmode="decimal" value="${ex ? v('seuilAdmission') : '10'}"></div>
      <div class="field"><label>Correction</label><select id="ex-s-double"><option value="1" ${!ex || ex.doubleCorrection ? 'selected' : ''}>Double correction (2 correcteurs + arbitrage)</option><option value="0" ${ex && !ex.doubleCorrection ? 'selected' : ''}>Correction simple</option></select></div>
      <div class="field"><label>Écart toléré entre correcteurs (points /20)</label><input id="ex-s-tol" inputmode="decimal" value="${ex ? v('toleranceEcart', '3') : '3'}"><small>Au-delà, une 3e correction (arbitrage) est exigée.</small></div>
      <div class="field"><label>Note éliminatoire (/20, facultatif)</label><input id="ex-s-elim" inputmode="decimal" value="${v('noteEliminatoire')}" placeholder="Vide = aucune"><small>Une épreuve en dessous de cette note ajourne le candidat.</small></div>
      <div class="field full"><label>Mentions (une par ligne : libellé ; moyenne minimale)</label><textarea id="ex-s-mentions" style="min-height:90px;">${esc(mentions.map((m) => `${m.label} ; ${m.min}`).join('\n'))}</textarea></div>
      <div class="field full"><label>Épreuves *</label><div id="ex-s-eps"></div>
        <button type="button" class="btn btn-sm" id="ex-s-addep" style="margin-top:8px;">+ Ajouter une épreuve</button></div>
    </div>`, {
    wide: true,
    onSave: async (o) => {
      const g = (s) => $(s, o).value.trim();
      const libelle = g('#ex-s-lib'), annee = g('#ex-s-annee');
      if (!libelle || !annee) { toast("Indiquez l'intitulé et l'année de la session."); return false; }
      const seuil = exNum(g('#ex-s-seuil')), tol = exNum(g('#ex-s-tol'));
      if (seuil === null || seuil < 0 || seuil > 20) { toast("Le seuil d'admission doit être un nombre entre 0 et 20."); return false; }
      if (tol === null || tol < 0) { toast("L'écart toléré doit être un nombre positif."); return false; }
      const elimTxt = g('#ex-s-elim'), elim = exNum(elimTxt);
      if (elimTxt && (elim === null || elim < 0 || elim > 20)) { toast('La note éliminatoire doit être entre 0 et 20 (ou vide).'); return false; }
      const lignes = eps.filter((e) => String(e.nom || '').trim());
      if (!lignes.length) { toast('Ajoutez au moins une épreuve.'); return false; }
      for (const e of lignes) {
        if (exNum(e.coef) === null || exNum(e.coef) < 0) { toast(`Coefficient invalide pour « ${e.nom} ».`); return false; }
        if (exNum(e.bareme) === null || exNum(e.bareme) <= 0) { toast(`Barème invalide pour « ${e.nom} ».`); return false; }
      }
      const ments = [];
      for (const ligne of g('#ex-s-mentions').split('\n').map((x) => x.trim()).filter(Boolean)) {
        const [lab, min] = ligne.split(';').map((x) => x.trim());
        if (!lab || exNum(min) === null) { toast(`Mention illisible : « ${ligne} » (format : Bien ; 14).`); return false; }
        ments.push({ label: lab, min: exNum(min) });
      }
      // Codes stables : une épreuve existante garde son code, une nouvelle reçoit le suivant
      const pris = new Set(lignes.map((e) => e.code).filter(Boolean));
      let n = 0;
      lignes.forEach((e) => { if (!e.code) { do { n++; } while (pris.has('E' + n)); e.code = 'E' + n; pris.add(e.code); } });
      const obj = ex ? { ...(await DB.get('examSessions', ex.id)) } : { _uuid: genUuid() };
      Object.assign(obj, {
        libelle, annee, type: g('#ex-s-type'), ceb: g('#ex-s-ceb'), province: g('#ex-s-prov'), region: g('#ex-s-reg'), prefixeTable: g('#ex-s-pref'),
        dateDebut: g('#ex-s-debut'), dateFin: g('#ex-s-fin'), dateResultats: g('#ex-s-res'),
        seuilAdmission: seuil, doubleCorrection: g('#ex-s-double') === '1', toleranceEcart: tol,
        noteEliminatoire: elimTxt ? elim : '', mentions: ments,
        epreuves: lignes.map((e) => ({ code: e.code, nom: String(e.nom).trim(), coef: exNum(e.coef), bareme: exNum(e.bareme), date: e.date || '', heure: e.heure || '' }))
      });
      if (ex) await DB.put('examSessions', obj); else { obj.id = await DB.add('examSessions', obj); }
      EX_ETAT.sessionUuid = obj._uuid;
      toast(ex ? 'Session mise à jour.' : 'Session créée.');
      onRouteChange();
      return true;
    }
  });

  const rendreEps = () => {
    $('#ex-s-eps', ov).innerHTML = eps.map((e, i) => `
      <div style="display:grid; grid-template-columns:minmax(120px,2fr) 60px 60px minmax(110px,1fr) 90px auto; gap:6px; margin-bottom:6px; align-items:center;">
        <input data-i="${i}" data-k="nom" value="${esc(e.nom || '')}" placeholder="Nom de l'épreuve">
        <input data-i="${i}" data-k="coef" value="${esc(e.coef ?? '')}" inputmode="decimal" title="Coefficient" placeholder="Coef.">
        <input data-i="${i}" data-k="bareme" value="${esc(e.bareme ?? '')}" inputmode="decimal" title="Barème (note maximale)" placeholder="/20">
        <input data-i="${i}" data-k="date" type="date" value="${esc(e.date || '')}" title="Date de l'épreuve">
        <input data-i="${i}" data-k="heure" value="${esc(e.heure || '')}" placeholder="07h30-09h30" title="Horaire">
        <button type="button" class="btn btn-sm btn-danger" data-rm="${i}" ${e.code && codesAvecNotes.has(e.code) ? 'disabled title="Des notes existent déjà pour cette épreuve"' : ''}>✕</button>
      </div>`).join('') + '<div class="text-soft" style="font-size:11.5px;">Colonnes : épreuve · coefficient · barème · date · horaire (repris sur les convocations).</div>';
  };
  rendreEps();
  ov.addEventListener('input', (e) => { const t = e.target; if (t.dataset && t.dataset.i !== undefined) eps[Number(t.dataset.i)][t.dataset.k] = t.value; });
  ov.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm && !rm.disabled) { eps.splice(Number(rm.dataset.rm), 1); rendreEps(); }
  });
  $('#ex-s-addep', ov).onclick = () => { eps.push({ nom: '', coef: 1, bareme: 20, date: '', heure: '' }); rendreEps(); };
}

async function exSupprimerSession(ctx) {
  if (!exDirection()) { toast('Seule la direction peut supprimer une session.'); return; }
  const { session, centres, jurys, candidats, notes } = ctx;
  if (!(await confirmDialog(`Supprimer définitivement la session « ${session.libelle} » avec ses ${candidats.length} candidat(s), ${centres.length} centre(s), ${jurys.length} membre(s) de jury et ${notes.length} note(s) ? Cette action est irréversible.`))) return;
  for (const l of [['examNotes', notes], ['examCandidats', candidats], ['examJurys', jurys], ['examCentres', centres]]) {
    for (const r of l[1]) await DB.delete(l[0], r.id);
  }
  await DB.delete('examSessions', session.id);
  EX_ETAT.sessionUuid = null;
  toast('Session supprimée.');
  onRouteChange();
}

/* ============================================================
   TABLEAU DE BORD
   ============================================================ */
EX_RENDERERS.tableau = async (c, ctx) => {
  const { session, candidats, centres, jurys } = ctx;
  const a = exAnalyse(ctx);
  const nbCand = candidats.length;
  const pct = (x, t) => (t ? Math.round(x / t * 100) : 0);
  const saisieMoy = a.progression.length ? Math.round(a.progression.reduce((s, p) => s + pct(p.faites, p.total), 0) / a.progression.length) : 0;
  const etape = (ok, titre, detail, tab, action) => ({ ok, titre, detail, tab, action });
  const etapes = [
    etape(a.eps.length > 0, 'Session paramétrée', `${a.eps.length} épreuve(s) · seuil d'admission ${exFmt(exNum(session.seuilAdmission) ?? 10)}/20 · ${session.doubleCorrection ? 'double correction' : 'correction simple'}`, null, 'Paramètres'),
    etape(nbCand > 0, 'Candidats inscrits', nbCand ? `${nbCand} candidat(s) (${candidats.filter((x) => x.sexe === 'F').length} filles)` : 'Aucun candidat : importez les élèves de CM2 ou ajoutez-en.', 'candidats', 'Candidats'),
    etape(centres.length > 0 && a.capTotale >= nbCand && nbCand > 0, 'Centres et salles', centres.length ? `${centres.length} centre(s) · ${a.capTotale} places pour ${nbCand} candidats` : 'Aucun centre créé.', 'centres', 'Centres'),
    etape(centres.length > 0 && !centres.some((x) => !String(x.jury || '').trim()), 'Centres rattachés à un jury', centres.length ? (centres.filter((x) => !String(x.jury || '').trim()).length ? `${centres.filter((x) => !String(x.jury || '').trim()).length} centre(s) sans jury.` : `${new Set(centres.map(exNomJury)).size} jury(s) constitué(s).`) : '—', 'centres', 'Jurys & centres'),
    etape(nbCand > 0 && !a.sansCentre.length, 'Candidats répartis (centre, salle, n° de table, n° PV)', a.sansCentre.length ? `${a.sansCentre.length} candidat(s) sans centre ou sans salle.` : (nbCand ? 'Tous les candidats ont un centre, une salle et un n° de table.' : '—'), 'candidats', 'Répartir'),
    etape(jurys.some((j) => j.fonction === 'president') && !a.centresSansChef.length && !a.sallesSansSurv.length && centres.length > 0, 'Jurys complets',
      [!jurys.some((j) => j.fonction === 'president') ? 'pas de président du jury' : '', a.centresSansChef.length ? `${a.centresSansChef.length} centre(s) sans chef de centre` : '', a.sallesSansSurv.length ? `${a.sallesSansSurv.length} salle(s) sans surveillant` : ''].filter(Boolean).join(' · ') || `${jurys.length} membre(s) affecté(s).`, 'jurys', 'Jurys'),
    etape(!a.conflits.length && jurys.length > 0, "Pas de conflit d'intérêts", a.conflits.length ? `${a.conflits.length} surveillant(s)/chef(s) de centre devant surveiller des candidats de leur propre école.` : 'Aucun surveillant ne garde des candidats de son école.', 'jurys', 'Jurys'),
    etape(nbCand > 0 && !a.sansAnon.length, "Codes d'anonymat générés", a.sansAnon.length ? `${a.sansAnon.length} candidat(s) sans code d'anonymat.` : (nbCand ? 'Tous les candidats ont un code.' : '—'), 'candidats', 'Candidats'),
    etape(a.progression.length > 0 && a.progression.every((p) => p.total > 0 && p.faites === p.total) && !a.ecarts, 'Correction terminée', a.progression.map((p) => `${p.ep.nom} : ${p.faites}/${p.total}`).join(' · ') + (a.ecarts ? ` · ${a.ecarts} écart(s) à arbitrer` : ''), 'correction', 'Correction'),
    etape(!!session.resultatsVerrouilles, 'Délibération clôturée', session.resultatsVerrouilles ? 'Résultats figés.' : 'À faire après la correction complète.', 'resultats', 'Résultats')
  ];
  const res = nbCand ? exCalculerResultats(session, candidats, ctx.notes) : null;
  const st = res ? res.stats.global : null;
  c.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Candidats</div><div class="value">${nbCand}</div><div class="foot">${centres.length} centre(s) · ${jurys.length} membre(s) de jury</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Correction</div><div class="value">${saisieMoy}%</div><div class="foot">moyenne des épreuves saisies</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Admis (provisoire)</div><div class="value">${st ? st.admis : '—'}</div><div class="foot">${st && st.taux !== null ? exFmt(st.taux, 1) + ' % des présents' : 'pas encore de résultats'}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">En attente</div><div class="value">${st ? st.attente : '—'}</div><div class="foot">candidats dont les notes sont incomplètes</div></div>
    </div>
    <div class="card" style="padding:6px 16px;">
      ${etapes.map((e) => `<div class="flex items-center gap-12" style="padding:11px 0; border-bottom:1px solid var(--border);">
        <div style="font-size:20px; width:26px; text-align:center; color:${e.ok ? 'var(--vert-600)' : 'var(--ocre-600)'};">${e.ok ? '✔' : '○'}</div>
        <div style="flex:1; min-width:0;"><div style="font-weight:700;">${esc(e.titre)}</div><div class="text-soft" style="font-size:12.5px;">${esc(e.detail)}</div></div>
        ${e.tab ? `<button class="btn btn-sm no-print" data-go="${e.tab}">${esc(e.action)} →</button>` : `<button class="btn btn-sm no-print" data-edit="1">${esc(e.action)} →</button>`}
      </div>`).join('')}
    </div>
    <p class="text-soft" style="font-size:12px;margin-top:10px;">Ordre conseillé : paramètres → candidats → centres → répartition → jurys → anonymats → correction → résultats.</p>`;
  $all('[data-go]', c).forEach((b) => { b.onclick = () => { EX_ETAT.tab = b.dataset.go; onRouteChange(); }; });
  $all('[data-edit]', c).forEach((b) => { b.onclick = () => exFormSession(session); });
};

/* ============================================================
   CANDIDATS
   ============================================================ */
function exBadgeStatut(s) {
  const m = { inscrit: 'indigo', present: 'vert', absent: 'ocre', exclu: 'terre' };
  return `<span class="badge badge-${m[s] || 'indigo'}">${esc(exLib(EX_STATUTS_CAND, s || 'inscrit'))}</span>`;
}

EX_RENDERERS.candidats = async (c, ctx) => {
  const { session, centres, candidats } = ctx;
  const dir = exDirection();
  const ecoles = [...new Set(candidats.map((x) => x.ecole).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  c.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px;" id="ex-c-stats"></div>
    <div class="table-toolbar">
      <input class="search-input" id="ex-c-q" placeholder="Rechercher (nom, école, n° de table…)" value="${esc(EX_ETAT.q)}">
      <select id="ex-c-centre" class="search-input"><option value="">Tous les centres</option><option value="__sans" ${EX_ETAT.fCentre === '__sans' ? 'selected' : ''}>Sans centre</option>${centres.map((x) => `<option value="${esc(x._uuid)}" ${EX_ETAT.fCentre === x._uuid ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select>
      <select id="ex-c-ecole" class="search-input"><option value="">Toutes les écoles</option>${ecoles.map((x) => `<option ${EX_ETAT.fEcole === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="ex-c-statut" class="search-input"><option value="">Tous les statuts</option>${EX_STATUTS_CAND.map(([v, l]) => `<option value="${v}" ${EX_ETAT.fStatut === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    </div>
    <div class="table-toolbar no-print">
      <button class="btn btn-accent" id="ex-c-add">+ Candidat</button>
      <button class="btn btn-sm" id="ex-c-import">Importer les élèves de CM2</button>
      <button class="btn btn-sm btn-accent" id="ex-c-ceb">⇩ Candidats publiés par les écoles</button>
      <button class="btn btn-sm" id="ex-c-insc">Inscriptions des écoles (fichiers)</button>
      ${currentUser && currentUser.role === 'ceb' && typeof cepTransmettreEffectifs === 'function' ? '<button class="btn btn-sm btn-accent" id="ex-c-eff">⇪ Transmettre les effectifs (serveur)</button>' : ''}
      <button class="btn btn-sm" id="ex-c-repartir">Répartir en centres &amp; salles</button>
      ${dir ? '<button class="btn btn-sm" id="ex-c-anon">Générer les codes d\'anonymat</button>' : ''}
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="ex-c-liste">Liste (PDF)</button>
      <button class="btn btn-sm" id="ex-c-conv">Convocations (PDF)</button>
      <button class="btn btn-sm" id="ex-c-emarg">Émargement par salle (PDF)</button>
      <button class="btn btn-sm" id="ex-c-csv">Excel (CSV)</button>
    </div>
    <div id="ex-c-liste-tab"></div>`;

  let liste = candidats;
  const rendre = () => {
    EX_ETAT.q = $('#ex-c-q').value; EX_ETAT.fCentre = $('#ex-c-centre').value; EX_ETAT.fEcole = $('#ex-c-ecole').value; EX_ETAT.fStatut = $('#ex-c-statut').value;
    const q = EX_ETAT.q.toLowerCase();
    liste = candidats.filter((x) => (!EX_ETAT.fCentre || (EX_ETAT.fCentre === '__sans' ? !x.centreUuid : x.centreUuid === EX_ETAT.fCentre))
      && (!EX_ETAT.fEcole || x.ecole === EX_ETAT.fEcole) && (!EX_ETAT.fStatut || (x.statut || 'inscrit') === EX_ETAT.fStatut)
      && (!q || [exNomComplet(x), x.ecole, x.numeroTable, x.numeroPV, x.matricule].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => String(a.numeroTable || '\uffff').localeCompare(String(b.numeroTable || '\uffff')) || exCmpNom(a, b));
    $('#ex-c-stats').innerHTML = `
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Candidats</div><div class="value">${candidats.length}</div><div class="foot">${candidats.filter((x) => x.sexe === 'F').length} filles · ${candidats.filter((x) => x.sexe !== 'F').length} garçons · ${candidats.filter((x) => x.handicap).length} en situation de handicap · ${candidats.filter((x) => x.bilingue).length} bilingues</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Répartis</div><div class="value">${candidats.filter((x) => x.centreUuid && x.salle).length}</div><div class="foot">centre + salle + n° de table</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Écoles</div><div class="value">${ecoles.length}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Absents / exclus</div><div class="value">${candidats.filter((x) => ['absent', 'exclu'].includes(x.statut)).length}</div></div>`;
    $('#ex-c-liste-tab').innerHTML = liste.length ? `<div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr>
      <th>Candidat</th><th>N° table</th><th>N° PV</th><th>Sexe</th><th>Né(e) le</th><th>École</th><th>Examen</th><th>Centre / salle</th>${dir ? '<th>Anonymat</th>' : ''}<th>Statut</th><th class="no-print"></th></tr></thead>
      <tbody>${liste.map((x) => `<tr>
        <td class="wrap" style="font-weight:600;">${esc(exNomComplet(x))}${x.eleveUuid ? ' <span class="text-soft" title="Élève de l\'école">●</span>' : ''}${x.besoinsSpecifiques ? ` <span title="Besoin spécifique : ${esc(x.besoinsSpecifiques)}">♿</span>` : (x.handicap ? ' <span title="Situation de handicap">♿</span>' : '')}${x.bilingue ? ' <span class="badge badge-indigo" title="Candidat bilingue">bilingue</span>' : ''}</td>
        <td style="font-weight:700;">${esc(x.numeroTable) || '<span class="text-soft">—</span>'}</td>
        <td>${esc(x.numeroPV) || '<span class="text-soft">—</span>'}</td>
        <td>${x.sexe === 'F' ? 'F' : 'M'}</td>
        <td>${x.dateNaissance ? formatDate(x.dateNaissance) : '—'}</td>
        <td class="wrap">${esc(x.ecole) || '—'}</td>
        <td>${esc(x.examens || 'CEP seul')}</td>
        <td class="wrap">${x.centreUuid ? `${esc(exCentreNom(ctx, x.centreUuid))} · ${esc(x.salle || '?')}<div class="text-soft" style="font-size:11px;">${esc(exNomJury(ctx.centres.find((k) => k._uuid === x.centreUuid)))}</div>` : '<span class="text-soft">—</span>'}</td>
        ${dir ? `<td style="font-family:var(--font-mono);">${esc(x.anonymat) || '<span class="text-soft">—</span>'}</td>` : ''}
        <td><select data-st="${x.id}" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--ink);">${EX_STATUTS_CAND.map(([v, l]) => `<option value="${v}" ${(x.statut || 'inscrit') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
        <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-edit="${x.id}">Modifier</button><button class="btn btn-sm btn-danger" data-del="${x.id}">Suppr.</button></div></td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty-state"><div class="big">🎓</div>${candidats.length ? 'Aucun candidat ne correspond à cette recherche.' : 'Aucun candidat. Importez les élèves de CM2 de votre école ou ajoutez des candidats d\'autres écoles.'}</div>`;
    $all('[data-edit]', $('#ex-c-liste-tab')).forEach((b) => { b.onclick = () => exFormCandidat(ctx, Number(b.dataset.edit)); });
    $all('[data-del]', $('#ex-c-liste-tab')).forEach((b) => { b.onclick = () => exSupprimerCandidat(ctx, Number(b.dataset.del)); });
    $all('[data-st]', $('#ex-c-liste-tab')).forEach((s) => {
      s.onchange = async () => {
        if (exVerrouille(session)) { onRouteChange(); return; }
        const cand = await DB.get('examCandidats', Number(s.dataset.st));
        if (!cand) return;
        cand.statut = s.value;
        await DB.put('examCandidats', cand);
        toast('Statut mis à jour.');
        onRouteChange();
      };
    });
  };
  ['#ex-c-q'].forEach((s) => { $(s).oninput = rendre; });
  ['#ex-c-centre', '#ex-c-ecole', '#ex-c-statut'].forEach((s) => { $(s).onchange = rendre; });
  rendre();
  $('#ex-c-add').onclick = () => exFormCandidat(ctx, null);
  $('#ex-c-import').onclick = () => exImporterEleves(ctx);
  $('#ex-c-ceb').onclick = () => lcRecupererCandidatsCEP(ctx);
  $('#ex-c-insc').onclick = () => exImporterInscriptions(ctx);
  if ($('#ex-c-eff')) $('#ex-c-eff').onclick = () => cepTransmettreEffectifs(ctx);
  $('#ex-c-repartir').onclick = () => exFormRepartition(ctx);
  if ($('#ex-c-anon')) $('#ex-c-anon').onclick = () => exGenererCodes(ctx);
  $('#ex-c-liste').onclick = () => exDocListeCandidats(ctx, liste);
  $('#ex-c-conv').onclick = () => exDocConvocations(ctx, liste);
  $('#ex-c-emarg').onclick = () => exDocEmargement(ctx, null);
  $('#ex-c-csv').onclick = () => download(`candidats-${session.annee}.csv`, toCSV(liste, [
    { label: 'N° table', value: 'numeroTable' }, { label: 'N° PV', value: 'numeroPV' }, { label: 'Jury', value: (x) => exNomJury(ctx.centres.find((k) => k._uuid === x.centreUuid)) },
    { label: 'Nom', value: 'nom' }, { label: 'Prénom', value: 'prenom' }, { label: 'Besoins spécifiques', value: 'besoinsSpecifiques' }, { label: 'Situation de handicap', value: (x) => (x.handicap ? 'Oui' : '') }, { label: 'Candidat bilingue', value: (x) => (x.bilingue ? 'Oui' : '') },
    { label: 'Sexe', value: (x) => (x.sexe === 'F' ? 'F' : 'M') }, { label: 'Date de naissance', value: 'dateNaissance' }, { label: 'Lieu de naissance', value: 'lieuNaissance' },
    { label: 'École', value: 'ecole' }, { label: 'Matricule', value: 'matricule' }, { label: 'Examen', value: (x) => x.examens || 'CEP seul' },
    { label: 'Centre', value: (x) => exCentreNom(ctx, x.centreUuid) }, { label: 'Salle', value: 'salle' }, { label: 'Statut', value: (x) => exLib(EX_STATUTS_CAND, x.statut || 'inscrit') }
  ]), 'text/csv;charset=utf-8');
};

async function exFormCandidat(ctx, id) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const ex = id ? ctx.candidats.find((x) => x.id === id) : null;
  const v = (k, d = '') => esc(ex ? (ex[k] ?? d) : d);
  const ecolesConnues = [...new Set([ctx.meta.nomEcole, ...ctx.candidats.map((x) => x.ecole)].filter(Boolean))];
  const salles = (uuid) => { const cc = ctx.centres.find((x) => x._uuid === uuid); return cc ? exSalles(cc) : []; };
  let salleInit = ex ? (ex.salle || '') : '';
  const ov = openModal(ex ? 'Modifier le candidat' : 'Ajouter un candidat', `
    <div class="form-grid">
      <div class="field"><label>Nom *</label><input id="ex-k-nom" value="${v('nom')}"></div>
      <div class="field"><label>Prénom(s) *</label><input id="ex-k-prenom" value="${v('prenom')}"></div>
      <div class="field"><label>Sexe</label><select id="ex-k-sexe"><option value="M" ${!ex || ex.sexe !== 'F' ? 'selected' : ''}>Garçon</option><option value="F" ${ex && ex.sexe === 'F' ? 'selected' : ''}>Fille</option></select></div>
      <div class="field"><label>Date de naissance</label><input type="date" id="ex-k-dn" value="${v('dateNaissance')}"></div>
      <div class="field"><label>Lieu de naissance</label><input id="ex-k-ln" value="${v('lieuNaissance')}"></div>
      <div class="field"><label>Matricule</label><input id="ex-k-mat" value="${v('matricule')}"></div>
      <div class="field full"><label>École d'origine *</label><input id="ex-k-ecole" list="ex-k-ecoles" value="${ex ? v('ecole') : esc(ctx.meta.nomEcole || '')}"><datalist id="ex-k-ecoles">${ecolesConnues.map((e) => `<option value="${esc(e)}">`).join('')}</datalist></div>
      <div class="field"><label>Examen présenté</label><select id="ex-k-exam">${EX_EXAMENS.map((e) => `<option ${(ex ? ex.examens : 'CEP seul') === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
      <div class="field"><label>Statut</label><select id="ex-k-statut">${EX_STATUTS_CAND.map(([k, l]) => `<option value="${k}" ${(ex ? ex.statut : 'inscrit') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Centre</label><select id="ex-k-centre"><option value="">— non affecté —</option>${ctx.centres.map((x) => `<option value="${esc(x._uuid)}" ${ex && ex.centreUuid === x._uuid ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></div>
      <div class="field"><label>Salle</label><select id="ex-k-salle"></select></div>
      <div class="field"><label>N° de table</label><input id="ex-k-table" value="${v('numeroTable')}" placeholder="Attribué par la répartition"></div>
      <div class="field"><label>Situation de handicap</label><select id="ex-k-hand"><option value="">Non</option><option value="1" ${ex && ex.handicap ? 'selected' : ''}>Oui</option></select></div>
      <div class="field"><label>Candidat bilingue</label><select id="ex-k-bil"><option value="">Non</option><option value="1" ${ex && ex.bilingue ? 'selected' : ''}>Oui</option></select></div>
      <div class="field full"><label>Besoins spécifiques (handicap, aménagement de composition)</label><input id="ex-k-bes" value="${v('besoinsSpecifiques')}" placeholder="Ex : déficience visuelle, salle de plain-pied, tiers-temps…"><small>À renseigner dès l'inscription : sert à choisir la salle et à prévenir le chef de centre.</small></div>
      <div class="field full"><label>Observations</label><textarea id="ex-k-obs">${v('observations')}</textarea></div>
    </div>`, {
    wide: true,
    onSave: async (o) => {
      const g = (s) => $(s, o).value.trim();
      if (!g('#ex-k-nom') || !g('#ex-k-prenom')) { toast('Le nom et le prénom sont obligatoires.'); return false; }
      if (!g('#ex-k-ecole')) { toast("Indiquez l'école d'origine."); return false; }
      const table = g('#ex-k-table');
      if (table && ctx.candidats.some((x) => x.id !== id && x.numeroTable === table)) { toast(`Le n° de table ${table} est déjà attribué.`); return false; }
      const obj = ex ? { ...(await DB.get('examCandidats', id)) } : { _uuid: genUuid(), sessionUuid: ctx.session._uuid, anonymat: '' };
      Object.assign(obj, {
        nom: g('#ex-k-nom'), prenom: g('#ex-k-prenom'), sexe: g('#ex-k-sexe'), dateNaissance: g('#ex-k-dn'), lieuNaissance: g('#ex-k-ln'),
        matricule: g('#ex-k-mat'), ecole: g('#ex-k-ecole'), examens: g('#ex-k-exam'), statut: g('#ex-k-statut'),
        centreUuid: g('#ex-k-centre'), salle: g('#ex-k-centre') ? g('#ex-k-salle') : '', numeroTable: table, besoinsSpecifiques: g('#ex-k-bes'), handicap: g('#ex-k-hand') === '1', bilingue: g('#ex-k-bil') === '1', observations: g('#ex-k-obs')
      });
      if (ex) await DB.put('examCandidats', obj); else await DB.add('examCandidats', obj);
      await exRecalculerPV(ctx, ctx.centres);
      toast(ex ? 'Candidat modifié.' : 'Candidat ajouté.');
      onRouteChange();
      return true;
    }
  });
  const majSalles = () => {
    const l = salles($('#ex-k-centre', ov).value);
    $('#ex-k-salle', ov).innerHTML = l.length ? l.map((s) => `<option ${s === salleInit ? 'selected' : ''}>${esc(s)}</option>`).join('') : '<option value="">—</option>';
  };
  $('#ex-k-centre', ov).onchange = () => { salleInit = ''; majSalles(); };
  majSalles();
}

async function exSupprimerCandidat(ctx, id) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const cand = ctx.candidats.find((x) => x.id === id);
  if (!cand) return;
  const aDesNotes = cand.anonymat && ctx.notes.some((n) => n.anonymat === cand.anonymat);
  if (!(await confirmDialog(`Supprimer le candidat ${exNomComplet(cand)} ?${aDesNotes ? ' Ses notes saisies (sous son code d\'anonymat) seront aussi supprimées.' : ''}`))) return;
  if (aDesNotes) for (const n of ctx.notes.filter((x) => x.anonymat === cand.anonymat)) await DB.delete('examNotes', n.id);
  await DB.delete('examCandidats', id);
  toast('Candidat supprimé.');
  onRouteChange();
}

/* Importer les élèves d'une classe (CM2 par défaut) de l'école */
async function exImporterEleves(ctx) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const [classes, eleves] = await Promise.all([DB.getAll('classes'), DB.getAll('eleves')]);
  if (!classes.length) { toast("Aucune classe n'existe dans l'application."); return; }
  const dejaImportes = new Set(ctx.candidats.map((x) => x.eleveUuid).filter(Boolean));
  const cm2 = classes.find((k) => /CM2/i.test(k.nom || k.niveau || ''));
  let classeId = (cm2 || classes[0]).id;
  const ov = openModal('Importer les élèves de la classe', `
    <div class="field"><label>Classe</label><select id="ex-i-classe">${classes.map((k) => `<option value="${k.id}" ${k.id === classeId ? 'selected' : ''}>${esc(k.nom)}</option>`).join('')}</select></div>
    <div id="ex-i-liste" style="margin-top:12px;"></div>`, {
    saveLabel: 'Importer la sélection',
    onSave: async (o) => {
      const ids = $all('[data-eid]:checked', o).map((x) => Number(x.dataset.eid));
      if (!ids.length) { toast('Aucun élève sélectionné.'); return false; }
      for (const eid of ids) {
        const e = eleves.find((x) => x.id === eid);
        if (!e) continue;
        if (!e._uuid) { e._uuid = genUuid(); await DB.put('eleves', e); }
        await DB.add('examCandidats', {
          _uuid: genUuid(), sessionUuid: ctx.session._uuid, eleveUuid: e._uuid,
          nom: e.nom || '', prenom: e.prenom || '', sexe: e.sexe === 'F' ? 'F' : 'M', dateNaissance: e.dateNaissance || '', lieuNaissance: String((e.fiche && e.fiche.lieuNaissance) || '').trim(),
          matricule: e.matricule || '', ecole: ctx.meta.nomEcole || '', examens: 'CEP seul', statut: 'inscrit',
          centreUuid: '', salle: '', numeroTable: '', anonymat: '', handicap: !!e.handicap, bilingue: !!e.bilingue
        });
      }
      toast(`${ids.length} élève(s) importé(s) comme candidats.`);
      onRouteChange();
      return true;
    }
  });
  const rendre = () => {
    classeId = Number($('#ex-i-classe', ov).value);
    const el = eleves.filter((e) => e.classeId === classeId && (e.statut || 'actif') === 'actif').sort(exCmpNom);
    $('#ex-i-liste', ov).innerHTML = el.length ? `
      <label style="display:flex;gap:8px;font-weight:700;margin-bottom:6px;"><input type="checkbox" id="ex-i-all" checked> Tout sélectionner (${el.filter((e) => !dejaImportes.has(e._uuid)).length} à importer)</label>
      <div style="max-height:320px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px;">${el.map((e) => {
        const deja = e._uuid && dejaImportes.has(e._uuid);
        return `<label style="display:flex;gap:8px;padding:4px 0;${deja ? 'opacity:.5;' : ''}"><input type="checkbox" data-eid="${e.id}" ${deja ? 'disabled' : 'checked'}> ${esc(exNomComplet(e))} <span class="text-soft">(${e.sexe === 'F' ? 'F' : 'M'}${e.matricule ? ' · ' + esc(e.matricule) : ''})</span>${deja ? ' <span class="badge badge-vert">déjà candidat</span>' : ''}</label>`;
      }).join('')}</div>`
      : '<div class="text-soft">Aucun élève actif dans cette classe.</div>';
    const all = $('#ex-i-all', ov);
    if (all) all.onchange = () => $all('[data-eid]:not(:disabled)', ov).forEach((x) => { x.checked = all.checked; });
  };
  $('#ex-i-classe', ov).onchange = rendre;
  rendre();
}

/* Répartition automatique + numéros de table */
async function exFormRepartition(ctx) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const { session, centres, candidats } = ctx;
  if (!candidats.length) { toast("Aucun candidat à répartir."); return; }
  if (!centres.length) { toast("Créez d'abord au moins un centre (onglet Centres)."); return; }
  const deja = candidats.filter((x) => x.centreUuid).length;
  openModal('Répartir les candidats', `
    <p>${candidats.length} candidat(s) seront répartis de façon équilibrée dans toutes les salles des ${centres.length} centre(s), avec attribution des n° de table.</p>
    ${deja ? `<div class="alert alert-ocre">⚠ ${deja} candidat(s) sont déjà affectés : leur centre, leur salle et leur n° de table seront remplacés.</div>` : ''}
    <div class="form-grid">
      <div class="field full"><label>Mode de répartition</label><select id="ex-r-mode">
        <option value="melange">Mélanger les écoles dans chaque salle (recommandé)</option>
        <option value="alpha">Ordre alphabétique</option></select></div>
      <div class="field"><label>Préfixe des n° de table</label><input id="ex-r-pref" value="${esc(session.prefixeTable || '')}" maxlength="4" placeholder="Facultatif"></div>
    </div>`, {
    saveLabel: 'Répartir',
    onSave: async (o) => {
      const r = exRepartir(candidats, centres, $('#ex-r-mode', o).value, $('#ex-r-pref', o).value.trim());
      if (r.erreur) { toast(r.erreur); return false; }
      const par = new Map(candidats.map((x) => [x._uuid, x]));
      for (const a of r.affectations) {
        const cand = { ...par.get(a.uuid), centreUuid: a.centreUuid, salle: a.salle, numeroTable: a.numeroTable };
        await DB.put('examCandidats', cand);
      }
      await exRecalculerPV(ctx, centres);
      toast(`${r.affectations.length} candidat(s) répartis, avec n° de table et n° PV.`);
      onRouteChange();
      return true;
    }
  });
}

/* Codes d'anonymat (direction seulement) */
async function exGenererCodes(ctx) {
  if (!exDirection()) { toast("Seule la direction peut générer les codes d'anonymat."); return; }
  if (exVerrouille(ctx.session)) return;
  const sans = ctx.candidats.filter((x) => !x.anonymat);
  const existants = new Set(ctx.candidats.map((x) => x.anonymat).filter(Boolean));
  let cibles = sans, remplacer = false;
  if (!sans.length) {
    if (ctx.notes.length) { toast("Tous les candidats ont déjà un code et des notes sont saisies : régénérer casserait le lien entre les copies et les candidats."); return; }
    if (!(await confirmDialog('Tous les candidats ont déjà un code d\'anonymat. Les régénérer tous (aucune note saisie pour l\'instant) ?'))) return;
    cibles = ctx.candidats; remplacer = true;
  }
  const codes = exGenererAnonymats(cibles, remplacer ? null : existants);
  for (const cand of cibles) await DB.put('examCandidats', { ...cand, anonymat: codes.get(cand._uuid) });
  toast(`${cibles.length} code(s) d'anonymat généré(s).`);
  onRouteChange();
}

/* ============================================================
   CENTRES
   ============================================================ */
EX_RENDERERS.centres = async (c, ctx) => {
  const { session, centres, candidats, jurys } = ctx;
  const a = exAnalyse(ctx);
  c.innerHTML = `
    ${exAlerteRepartition(a)}
    <div class="table-toolbar no-print">
      <button class="btn btn-accent" id="ex-ce-add">+ Centre d'examen</button>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="ex-ce-emarg">Émargement de tous les centres (PDF)</button>
    </div>
    ${centres.length ? `<div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr>
      <th>Centre</th><th>Jury</th><th>Localité</th><th>Chef de centre</th><th>Salles × places</th><th>Candidats</th><th>Remplissage</th><th>Jurés</th><th class="no-print"></th></tr></thead>
      <tbody>${centres.map((x) => {
        const cap = exSalles(x).length * (Number(x.capaciteSalle) || 0);
        const nb = candidats.filter((k) => k.centreUuid === x._uuid).length;
        const chef = jurys.find((j) => j.fonction === 'chef_centre' && j.centreUuid === x._uuid);
        return `<tr>
          <td class="wrap" style="font-weight:700;">${esc(x.nom)}</td>
          <td class="wrap">${String(x.jury || '').trim() ? esc(x.jury) : '<span class="badge badge-ocre">à rattacher</span>'}</td>
          <td class="wrap">${esc(x.localite) || '—'}</td>
          <td class="wrap">${chef ? esc(exNomComplet(chef)) : '<span class="badge badge-terre">à désigner</span>'}</td>
          <td>${exSalles(x).length} × ${esc(x.capaciteSalle || 0)} = <b>${cap}</b></td>
          <td>${nb}</td>
          <td style="min-width:110px;"><div class="progress"><div style="width:${cap ? Math.min(100, Math.round(nb / cap * 100)) : 0}%;"></div></div><span class="text-soft" style="font-size:11px;">${cap ? Math.round(nb / cap * 100) : 0} %</span></td>
          <td>${jurys.filter((j) => j.centreUuid === x._uuid).length}</td>
          <td class="no-print"><div class="flex gap-8">
            <button class="btn btn-sm" data-emarg="${esc(x._uuid)}">Listes (PDF)</button>
            <button class="btn btn-sm" data-edit="${x.id}">Modifier</button>
            <button class="btn btn-sm btn-danger" data-del="${x.id}">Suppr.</button></div></td></tr>`;
      }).join('')}</tbody></table></div>`
      : '<div class="empty-state"><div class="big">🏫</div>Aucun centre. Un centre est une école qui accueille les épreuves : indiquez son nombre de salles et leur capacité.</div>'}`;
  $('#ex-ce-add').onclick = () => exFormCentre(ctx, null);
  $('#ex-ce-emarg').onclick = () => exDocEmargement(ctx, null);
  $all('[data-edit]', c).forEach((b) => { b.onclick = () => exFormCentre(ctx, Number(b.dataset.edit)); });
  $all('[data-del]', c).forEach((b) => { b.onclick = () => exSupprimerCentre(ctx, Number(b.dataset.del)); });
  $all('[data-emarg]', c).forEach((b) => { b.onclick = () => exDocEmargement(ctx, b.dataset.emarg); });
};
function exAlerteRepartition(a) {
  return a.capTotale && a.sansCentre.length
    ? `<div class="alert alert-ocre">${a.sansCentre.length} candidat(s) ne sont pas encore répartis : onglet Candidats → « Répartir en centres &amp; salles ».</div>` : '';
}

async function exFormCentre(ctx, id) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const ex = id ? ctx.centres.find((x) => x.id === id) : null;
  const v = (k, d = '') => esc(ex ? (ex[k] ?? d) : d);
  openModal(ex ? 'Modifier le centre' : "Nouveau centre d'examen", `
    <div class="form-grid">
      <div class="field full"><label>Nom du centre (école hôte) *</label><input id="ex-ce-nom" value="${v('nom')}" placeholder="Ex : EPP de Zorgho A"></div>
      <div class="field full"><label>Jury de rattachement *</label><input id="ex-ce-jury" list="ex-ce-jurys" value="${v('jury')}" placeholder="Ex : Jury 12"><datalist id="ex-ce-jurys">${[...new Set(ctx.centres.map((k) => k.jury).filter(Boolean))].map((j) => `<option value="${esc(j)}">`).join('')}</datalist><small>Un jury regroupe plusieurs centres de composition : les n° PV, la saisie des notes et le procès-verbal se font par jury.</small></div>
      <div class="field full"><label>Localité / adresse</label><input id="ex-ce-loc" value="${v('localite')}"></div>
      <div class="field"><label>Nombre de salles *</label><input type="number" min="1" id="ex-ce-nb" value="${v('nbSalles')}"></div>
      <div class="field"><label>Places par salle *</label><input type="number" min="1" id="ex-ce-cap" value="${v('capaciteSalle')}"></div>
      <div class="field full"><label>Observations</label><textarea id="ex-ce-obs">${v('observations')}</textarea></div>
    </div>
    <p class="text-soft" style="font-size:12px;">Le chef de centre et les surveillants se désignent dans l'onglet Jurys.</p>`, {
    onSave: async (o) => {
      const g = (s) => $(s, o).value.trim();
      const nb = Math.floor(Number(g('#ex-ce-nb'))), cap = Math.floor(Number(g('#ex-ce-cap')));
      if (!g('#ex-ce-nom')) { toast('Indiquez le nom du centre.'); return false; }
      if (!(nb >= 1) || !(cap >= 1)) { toast('Indiquez un nombre de salles et un nombre de places supérieurs à 0.'); return false; }
      if (ex) {
        const retirees = exSalles(ex).filter((s) => !exSalles({ nbSalles: nb }).includes(s));
        const occupees = ctx.candidats.filter((k) => k.centreUuid === ex._uuid && retirees.includes(k.salle)).length;
        if (occupees) { toast(`${occupees} candidat(s) sont affectés à des salles que vous supprimez : réaffectez-les d'abord.`); return false; }
      }
      const obj = ex ? { ...(await DB.get('examCentres', id)) } : { _uuid: genUuid(), sessionUuid: ctx.session._uuid };
      if (!g('#ex-ce-jury')) { toast('Indiquez le jury auquel ce centre est rattaché.'); return false; }
      Object.assign(obj, { nom: g('#ex-ce-nom'), jury: g('#ex-ce-jury'), localite: g('#ex-ce-loc'), nbSalles: nb, capaciteSalle: cap, observations: g('#ex-ce-obs') });
      if (ex) await DB.put('examCentres', obj); else obj.id = await DB.add('examCentres', obj);
      await exRecalculerPV(ctx, ex ? ctx.centres.map((k) => (k._uuid === obj._uuid ? obj : k)) : [...ctx.centres, obj]);
      toast(ex ? 'Centre modifié.' : 'Centre créé.');
      onRouteChange();
      return true;
    }
  });
}

async function exSupprimerCentre(ctx, id) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const centre = ctx.centres.find((x) => x.id === id);
  if (!centre) return;
  const cands = ctx.candidats.filter((k) => k.centreUuid === centre._uuid), js = ctx.jurys.filter((j) => j.centreUuid === centre._uuid);
  if (!(await confirmDialog(`Supprimer le centre « ${centre.nom} » ? ${cands.length} candidat(s) et ${js.length} membre(s) de jury y sont rattachés : ils redeviendront « non affectés » (les candidats perdent aussi leur n° de table).`))) return;
  for (const k of cands) await DB.put('examCandidats', { ...k, centreUuid: '', salle: '', numeroTable: '' });
  for (const j of js) await DB.put('examJurys', { ...j, centreUuid: '', salle: '' });
  await DB.delete('examCentres', id);
  await exRecalculerPV(ctx, ctx.centres.filter((k) => k.id !== id));
  toast('Centre supprimé.');
  onRouteChange();
}

/* ============================================================
   JURYS
   ============================================================ */
EX_RENDERERS.jurys = async (c, ctx) => {
  const { session, centres, jurys } = ctx;
  const a = exAnalyse(ctx);
  const alertes = [];
  if (!jurys.some((j) => j.fonction === 'president')) alertes.push(['ocre', 'Aucun président du jury désigné.']);
  if (a.centresSansChef.length) alertes.push(['ocre', `Centre(s) sans chef de centre : ${a.centresSansChef.map((x) => esc(x.nom)).join(', ')}.`]);
  if (a.sallesSansSurv.length) alertes.push(['ocre', `${a.sallesSansSurv.length} salle(s) occupée(s) sans surveillant : ${a.sallesSansSurv.slice(0, 6).map((s) => `${esc(s.centre.nom)} / ${esc(s.salle)}`).join(', ')}${a.sallesSansSurv.length > 6 ? '…' : ''}.`]);
  exDoublesRequisitions(jurys).forEach((l) => alertes.push(['terre', `⚠ Double réquisition : ${esc(exNomComplet(l[0]))} est enregistré(e) ${l.length} fois (${l.map((j) => esc(exLib(EX_FONCTIONS, j.fonction))).join(', ')}).`]));
  a.conflits.forEach((k) => alertes.push(['terre', `⚠ Conflit d'intérêts : ${esc(exNomComplet(k.jure))} (${esc(exLib(EX_FONCTIONS, k.jure.fonction))}, école « ${esc(k.jure.ecoleOrigine)} ») doit encadrer ${k.nb} candidat(s) de sa propre école.`]));
  c.innerHTML = `
    ${alertes.map(([niv, m]) => `<div class="alert alert-${niv}">${m}</div>`).join('')}
    <div class="table-toolbar">
      <input class="search-input" id="ex-j-q" placeholder="Rechercher (nom, école, téléphone…)" value="${esc(EX_ETAT.q)}">
      <select id="ex-j-fonc" class="search-input"><option value="">Toutes les fonctions</option>${EX_FONCTIONS.map(([k, l]) => `<option value="${k}" ${EX_ETAT.fFonction === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    </div>
    <div class="table-toolbar no-print">
      <button class="btn btn-accent" id="ex-j-add">+ Membre du jury</button>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="ex-j-conv">Convocations des acteurs (PDF)</button>
      <button class="btn btn-sm" id="ex-j-pdf">Liste des jurys (PDF)</button>
      <button class="btn btn-sm" id="ex-j-csv">Excel (CSV)</button>
    </div>
    <div id="ex-j-tab"></div>`;
  let liste = jurys;
  const ordreF = Object.fromEntries(EX_FONCTIONS.map(([k], i) => [k, i]));
  const rendre = () => {
    EX_ETAT.q = $('#ex-j-q').value; EX_ETAT.fFonction = $('#ex-j-fonc').value;
    const q = EX_ETAT.q.toLowerCase();
    liste = jurys.filter((j) => (!EX_ETAT.fFonction || j.fonction === EX_ETAT.fFonction) && (!q || [exNomComplet(j), j.ecoleOrigine, j.telephone, j.grade].join(' ').toLowerCase().includes(q)))
      .sort((x, y) => (ordreF[x.fonction] ?? 99) - (ordreF[y.fonction] ?? 99) || exCmpNom(x, y));
    $('#ex-j-tab').innerHTML = liste.length ? `<div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr>
      <th>Nom et prénom(s)</th><th>Fonction</th><th>Affectation</th><th>École / service</th><th>Téléphone</th><th>Présence</th><th class="no-print"></th></tr></thead>
      <tbody>${liste.map((j) => `<tr>
        <td class="wrap" style="font-weight:600;">${esc(exNomComplet(j))}${j.grade ? `<div class="text-soft" style="font-weight:400;">${esc(j.grade)}</div>` : ''}</td>
        <td class="wrap">${esc(exLib(EX_FONCTIONS, j.fonction))}</td>
        <td class="wrap">${exAffectationJure(ctx, j) || '<span class="text-soft">—</span>'}</td>
        <td class="wrap">${esc(j.ecoleOrigine) || '—'}</td>
        <td>${esc(j.telephone) || '—'}</td>
        <td>${j.presence === 'present' ? '<span class="badge badge-vert">Présent</span>' : j.presence === 'absent' ? '<span class="badge badge-terre">Absent</span>' : '<span class="badge badge-indigo">Convoqué</span>'}</td>
        <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-edit="${j.id}">Modifier</button><button class="btn btn-sm btn-danger" data-del="${j.id}">Suppr.</button></div></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty-state"><div class="big">⚖</div>Aucun membre de jury enregistré.</div>';
    $all('[data-edit]', $('#ex-j-tab')).forEach((b) => { b.onclick = () => exFormJure(ctx, Number(b.dataset.edit)); });
    $all('[data-del]', $('#ex-j-tab')).forEach((b) => { b.onclick = () => exSupprimerJure(ctx, Number(b.dataset.del)); });
  };
  $('#ex-j-q').oninput = rendre; $('#ex-j-fonc').onchange = rendre;
  rendre();
  $('#ex-j-add').onclick = () => exFormJure(ctx, null);
  $('#ex-j-pdf').onclick = () => exDocJury(ctx);
  $('#ex-j-conv').onclick = () => exDocConvocationsActeurs(ctx, liste);
  $('#ex-j-csv').onclick = () => download(`jurys-${session.annee}.csv`, toCSV(liste, [
    { label: 'Nom', value: 'nom' }, { label: 'Prénom', value: 'prenom' }, { label: 'Fonction', value: (j) => exLib(EX_FONCTIONS, j.fonction) },
    { label: 'Centre', value: (j) => exCentreNom(ctx, j.centreUuid) }, { label: 'Salle', value: 'salle' },
    { label: 'Épreuve', value: (j) => { const e = (session.epreuves || []).find((x) => x.code === j.epreuveCode); return e ? e.nom : ''; } },
    { label: 'École / service', value: 'ecoleOrigine' }, { label: 'Grade', value: 'grade' }, { label: 'Téléphone', value: 'telephone' }
  ]), 'text/csv;charset=utf-8');
};

function exAffectationJure(ctx, j) {
  const parts = [];
  if (j.centreUuid) parts.push(esc(exCentreNom(ctx, j.centreUuid)));
  if (j.salle) parts.push(esc(j.salle));
  const ep = (ctx.session.epreuves || []).find((x) => x.code === j.epreuveCode);
  if (ep) parts.push(esc(ep.nom));
  return parts.join(' · ');
}

async function exFormJure(ctx, id) {
  if (!exAutorise()) return;
  const ex = id ? ctx.jurys.find((x) => x.id === id) : null;
  const v = (k, d = '') => esc(ex ? (ex[k] ?? d) : d);
  let salleInit = ex ? (ex.salle || '') : '';
  const ov = openModal(ex ? 'Modifier le membre du jury' : 'Ajouter un membre du jury', `
    <div class="form-grid">
      <div class="field"><label>Nom *</label><input id="ex-m-nom" value="${v('nom')}"></div>
      <div class="field"><label>Prénom(s) *</label><input id="ex-m-prenom" value="${v('prenom')}"></div>
      <div class="field"><label>Fonction *</label><select id="ex-m-fonc">${EX_FONCTIONS.map(([k, l]) => `<option value="${k}" ${(ex ? ex.fonction : 'surveillant') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Grade</label><input id="ex-m-grade" value="${v('grade')}" placeholder="IP, IAC, ITEPS…"></div>
      <div class="field"><label>École / service d'origine</label><input id="ex-m-ecole" value="${v('ecoleOrigine')}"><small>Sert à détecter les conflits d'intérêts.</small></div>
      <div class="field"><label>Téléphone</label><input id="ex-m-tel" inputmode="tel" value="${v('telephone')}"></div>
      <div class="field" id="ex-m-f-centre"><label>Centre</label><select id="ex-m-centre"><option value="">—</option>${ctx.centres.map((x) => `<option value="${esc(x._uuid)}" ${ex && ex.centreUuid === x._uuid ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></div>
      <div class="field" id="ex-m-f-salle"><label>Salle (surveillants)</label><select id="ex-m-salle"></select></div>
      <div class="field" id="ex-m-f-ep"><label>Épreuve corrigée (correcteurs)</label><select id="ex-m-ep"><option value="">—</option>${(ctx.session.epreuves || []).map((e) => `<option value="${esc(e.code)}" ${ex && ex.epreuveCode === e.code ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}</select></div>
      <div class="field"><label>Présence</label><select id="ex-m-pres"><option value="convoque" ${!ex || !ex.presence || ex.presence === 'convoque' ? 'selected' : ''}>Convoqué</option><option value="present" ${ex && ex.presence === 'present' ? 'selected' : ''}>Présent</option><option value="absent" ${ex && ex.presence === 'absent' ? 'selected' : ''}>Absent</option></select></div>
    </div>`, {
    wide: true,
    onSave: async (o) => {
      const g = (s) => $(s, o).value.trim();
      if (!g('#ex-m-nom') || !g('#ex-m-prenom')) { toast('Le nom et le prénom sont obligatoires.'); return false; }
      const fonc = g('#ex-m-fonc');
      const centre = ['chef_centre', 'secretaire_centre', 'surveillant'].includes(fonc) ? g('#ex-m-centre') : '';
      if (['chef_centre', 'secretaire_centre', 'surveillant'].includes(fonc) && !centre) { toast('Choisissez le centre de ce membre.'); return false; }
      if (fonc === 'chef_centre' && ctx.jurys.some((j) => j.id !== id && j.fonction === 'chef_centre' && j.centreUuid === centre)) { toast('Ce centre a déjà un chef de centre.'); return false; }
      if (fonc === 'president' && ctx.jurys.some((j) => j.id !== id && j.fonction === 'president')) { toast('Un président du jury est déjà désigné.'); return false; }
      const obj = ex ? { ...(await DB.get('examJurys', id)) } : { _uuid: genUuid(), sessionUuid: ctx.session._uuid };
      Object.assign(obj, {
        nom: g('#ex-m-nom'), prenom: g('#ex-m-prenom'), fonction: fonc, grade: g('#ex-m-grade'), ecoleOrigine: g('#ex-m-ecole'), telephone: g('#ex-m-tel'),
        centreUuid: centre, salle: fonc === 'surveillant' ? g('#ex-m-salle') : '', epreuveCode: fonc === 'correcteur' ? g('#ex-m-ep') : '', presence: g('#ex-m-pres')
      });
      if (ex) await DB.put('examJurys', obj); else await DB.add('examJurys', obj);
      toast(ex ? 'Membre modifié.' : 'Membre ajouté.');
      onRouteChange();
      return true;
    }
  });
  const majChamps = () => {
    const f = $('#ex-m-fonc', ov).value;
    $('#ex-m-f-centre', ov).style.display = ['chef_centre', 'secretaire_centre', 'surveillant'].includes(f) ? '' : 'none';
    $('#ex-m-f-salle', ov).style.display = f === 'surveillant' ? '' : 'none';
    $('#ex-m-f-ep', ov).style.display = f === 'correcteur' ? '' : 'none';
    const cc = ctx.centres.find((x) => x._uuid === $('#ex-m-centre', ov).value);
    $('#ex-m-salle', ov).innerHTML = '<option value="">—</option>' + (cc ? exSalles(cc).map((s) => `<option ${s === salleInit ? 'selected' : ''}>${esc(s)}</option>`).join('') : '');
  };
  $('#ex-m-fonc', ov).onchange = majChamps;
  $('#ex-m-centre', ov).onchange = () => { salleInit = ''; majChamps(); };
  majChamps();
}

async function exSupprimerJure(ctx, id) {
  if (!exAutorise()) return;
  const j = ctx.jurys.find((x) => x.id === id);
  if (!j || !(await confirmDialog(`Retirer ${exNomComplet(j)} du jury ?`))) return;
  await DB.delete('examJurys', id);
  toast('Membre retiré.');
  onRouteChange();
}
