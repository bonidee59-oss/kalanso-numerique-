/* ============================================================
   app-examens-docs.js — Espace Examen : documents imprimables / exports
   ------------------------------------------------------------
   Tous les PDF passent par printDocument() puis imprimerA4() : page A4,
   lignes de tableau jamais coupées, en-têtes de colonnes répétés.
   Ces documents portent leur propre en-tête d'examen (sans cadre de
   l'école) et leurs propres lignes de signature.
   ============================================================ */

const EX_SAUT = '<div style="page-break-after:always;break-after:page;height:0;"></div>';
const exPrint = (titre, html) => printDocument(titre, html, { sansCadre: true });

function exTitreExamen(session) {
  return ({ cep: "CERTIFICAT D'ÉTUDES PRIMAIRES", cep_concours: "CEP ET CONCOURS D'ENTRÉE EN SIXIÈME", blanc: 'EXAMEN BLANC' })[session.type] || 'EXAMEN';
}
function exEntete(ctx, titre, sous) {
  const { session } = ctx;
  return `<div style="text-align:center;margin-bottom:12px;">
    <div style="font-size:11px;letter-spacing:.05em;">BURKINA FASO — Unité · Progrès · Justice</div>
    ${session.ceb ? `<div style="font-size:12px;margin-top:4px;">Circonscription d'éducation de base de ${esc(session.ceb)}</div>` : ''}
    <div style="font-size:12px;font-weight:700;margin-top:2px;">${esc(exTitreExamen(session))} — Session ${esc(session.annee)}</div>
    <h3 style="margin:10px 0 2px;">${esc(titre.toUpperCase())}</h3>${sous ? `<div style="font-size:12px;color:#444;">${sous}</div>` : ''}</div>`;
}
function exTab(entetes, lignes, o = {}) {
  const centre = o.centre || [];
  return `<table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:${o.fs || 11}px;">
    <thead><tr>${entetes.map((h) => `<th style="background:#eee;">${h}</th>`).join('')}</tr></thead>
    <tbody>${lignes.length ? lignes.map((r) => `<tr style="${o.hauteur ? `height:${o.hauteur}px;` : ''}">${r.map((c, i) => `<td${centre.includes(i) ? ' style="text-align:center;"' : ''}>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${entetes.length}">Aucune donnée</td></tr>`}</tbody></table>`;
}
function exSignatures(libelles) {
  return `<div class="pd-signature" style="margin-top:34px;display:flex;justify-content:space-around;gap:18px;font-size:12.5px;">${libelles.map((l) => `<div style="text-align:center;min-width:170px;"><div>${esc(l)}</div><div style="height:58px;"></div><div style="border-top:1px solid #333;padding-top:4px;">&nbsp;</div></div>`).join('')}</div>`;
}
const exSexe = (c) => (c.sexe === 'F' ? 'F' : 'M');
const exQuand = (c) => [c.dateNaissance ? formatDate(c.dateNaissance) : '', c.lieuNaissance ? 'à ' + c.lieuNaissance : ''].filter(Boolean).join(' ');
const exPrems = (ctx, fonction) => ctx.jurys.find((j) => j.fonction === fonction);
const exNomJure = (j) => (j ? exNomComplet(j) : '');

/* ---------------- Candidats ---------------- */
function exDocListeCandidats(ctx, liste) {
  const l = [...liste].sort((a, b) => exCmpNom(a, b));
  exPrint('Liste des candidats', exEntete(ctx, 'Liste des candidats', `${l.length} candidat(s)`) + exTab(
    ['N°', 'Nom et prénom(s)', 'Sexe', 'Né(e) le', 'École', 'Examen', 'N° table', 'N° PV', 'Jury', 'Centre / salle'],
    l.map((x, i) => [i + 1, esc(exNomComplet(x)) + (x.besoinsSpecifiques ? ' ♿' : ''), exSexe(x), esc(exQuand(x)), esc(x.ecole), esc(x.examens || 'CEP seul'), esc(x.numeroTable), esc(x.numeroPV), esc(x.centreUuid ? exNomJury(ctx.centres.find((k) => k._uuid === x.centreUuid)) : ''), esc(x.centreUuid ? `${exCentreNom(ctx, x.centreUuid)} · ${x.salle || ''}` : '')]),
    { centre: [0, 2, 6, 7], fs: 10 }));
}

function exDocConvocations(ctx, liste) {
  const { session } = ctx;
  if (!liste.length) { toast('Aucun candidat à convoquer.'); return; }
  const eps = (session.epreuves || []).filter((e) => e.date || e.heure);
  const blocs = [...liste].sort((a, b) => exCmpNom(a, b)).map((x) => {
    const cen = ctx.centres.find((k) => k._uuid === x.centreUuid);
    return `<div style="border:1px solid #333;padding:14px 16px;margin-bottom:16px;break-inside:avoid;page-break-inside:avoid;font-size:12.5px;">
      ${exEntete(ctx, 'Convocation')}
      <p style="margin:6px 0;">Le/la candidat(e) <b>${esc(exNomComplet(x))}</b>${exQuand(x) ? `, né(e) le ${esc(exQuand(x))}` : ''}, de l'école <b>${esc(x.ecole || '—')}</b>, est convoqué(e) à l'examen (${esc(x.examens || 'CEP seul')}) selon les indications suivantes :</p>
      ${exTab(['N° de table', 'Centre d\'examen', 'Salle'], [[`<b style="font-size:15px;">${esc(x.numeroTable || '—')}</b>`, esc(cen ? cen.nom + (cen.localite ? ' — ' + cen.localite : '') : 'à préciser'), esc(x.salle || 'à préciser')]], { centre: [0, 2], fs: 12 })}
      ${eps.length ? `<div style="margin-top:8px;">${exTab(['Épreuve', 'Date', 'Horaire'], eps.map((e) => [esc(e.nom), e.date ? esc(formatDate(e.date)) : '—', esc(e.heure || '—')]), { fs: 11.5 })}</div>` : ''}
      <p style="margin:8px 0 0;font-size:11.5px;">Le/la candidat(e) doit se présenter à l'heure, muni(e) de la présente convocation.</p>
      <div style="text-align:right;margin-top:8px;font-size:12px;">Le Directeur / Le Chef de CEB<div style="height:38px;"></div></div></div>`;
  });
  const pages = [];
  for (let i = 0; i < blocs.length; i += 2) pages.push(blocs.slice(i, i + 2).join(''));
  exPrint('Convocations', pages.join(EX_SAUT));
}

function exDocEmargement(ctx, centreUuid) {
  const { session } = ctx;
  const centres = ctx.centres.filter((c) => !centreUuid || c._uuid === centreUuid);
  const eps = session.epreuves || [];
  const pages = [];
  centres.forEach((c) => exSalles(c).forEach((s) => {
    const cands = ctx.candidats.filter((x) => x.centreUuid === c._uuid && x.salle === s).sort((a, b) => String(a.numeroTable).localeCompare(String(b.numeroTable)));
    if (!cands.length) return;
    const surv = ctx.jurys.filter((j) => j.fonction === 'surveillant' && j.centreUuid === c._uuid && j.salle === s).map(exNomJure);
    pages.push(exEntete(ctx, "Liste d'émargement", `<b>${esc(c.nom)}</b> (${esc(exNomJury(c))}) — <b>${esc(s)}</b> · ${cands.length} candidat(s)${cands.some((x) => x.besoinsSpecifiques) ? ' · ♿ besoin(s) spécifique(s) signalé(s)' : ''}<br>Surveillant(s) : ${surv.length ? esc(surv.join(', ')) : '………………………………'}`)
      + exTab(['N° table', 'N° PV', 'Nom et prénom(s)', 'École', ...eps.map((e) => esc(e.nom) + '<br>(signature)')],
        cands.map((x) => [`<b>${esc(x.numeroTable)}</b>`, esc(x.numeroPV), esc(exNomComplet(x)) + (x.besoinsSpecifiques ? ` ♿ <i>${esc(x.besoinsSpecifiques)}</i>` : ''), esc(x.ecole), ...eps.map(() => '')]), { centre: [0, 1], hauteur: 30 })
      + exSignatures(['Le Chef de centre', 'Le(s) Surveillant(s)']));
  }));
  if (!pages.length) { toast("Aucun candidat n'est encore réparti dans une salle."); return; }
  exPrint("Listes d'émargement", pages.join(EX_SAUT));
}

/* Fiches de correction : codes d'anonymat uniquement */
function exDocFichesCorrection(ctx, epCode) {
  const { session } = ctx;
  const eps = (session.epreuves || []).filter((e) => !epCode || e.code === epCode);
  const cands = ctx.candidats.filter((x) => x.anonymat && !['absent', 'exclu'].includes(x.statut)).sort((a, b) => a.anonymat.localeCompare(b.anonymat));
  if (!cands.length) { toast("Générez d'abord les codes d'anonymat (onglet Candidats)."); return; }
  const pages = eps.map((ep) => {
    const correcteurs = ctx.jurys.filter((j) => j.fonction === 'correcteur' && j.epreuveCode === ep.code).map(exNomJure);
    const cols = session.doubleCorrection ? ['Correcteur 1', 'Correcteur 2', 'Arbitrage (3e)'] : ['Note'];
    return exEntete(ctx, 'Fiche de correction anonyme', `<b>${esc(ep.nom)}</b> — barème /${esc(ep.bareme)} — coefficient ${esc(ep.coef)}<br>Correcteur(s) : ${correcteurs.length ? esc(correcteurs.join(', ')) : '………………………………'}`)
      + exTab(['N°', "Code d'anonymat", ...cols, 'Observations'], cands.map((x, i) => [i + 1, `<b style="font-family:monospace;font-size:13px;">${esc(x.anonymat)}</b>`, ...cols.map(() => ''), '']), { centre: [0, 1], hauteur: 26 })
      + exSignatures(session.doubleCorrection ? ['Correcteur 1', 'Correcteur 2'] : ['Le Correcteur']);
  });
  exPrint('Fiches de correction', pages.join(EX_SAUT));
}

/* ---------------- Jurys ---------------- */
function exDocJury(ctx) {
  const { session, jurys } = ctx;
  const ligne = (j) => [esc(exNomComplet(j)), esc(exLib(EX_FONCTIONS, j.fonction)), esc(j.grade), esc(j.ecoleOrigine), esc(j.telephone)];
  const bureau = jurys.filter((j) => ['president', 'vice_president', 'secretaire', 'membre'].includes(j.fonction));
  let html = exEntete(ctx, 'Composition des jurys') + '<h4>Bureau du jury et délibération</h4>' + exTab(['Nom et prénom(s)', 'Fonction', 'Grade', 'École / service', 'Téléphone'], bureau.map(ligne));
  ctx.centres.forEach((c) => {
    const js = jurys.filter((j) => j.centreUuid === c._uuid).sort((a, b) => (a.salle || '').localeCompare(b.salle || '') || exCmpNom(a, b));
    html += `<h4 style="margin-top:16px;">Centre : ${esc(c.nom)}${c.localite ? ' — ' + esc(c.localite) : ''}</h4>` + exTab(['Nom et prénom(s)', 'Fonction', 'Salle', 'École / service', 'Téléphone'], js.map((j) => [esc(exNomComplet(j)), esc(exLib(EX_FONCTIONS, j.fonction)), esc(j.salle), esc(j.ecoleOrigine), esc(j.telephone)]));
  });
  const corr = jurys.filter((j) => j.fonction === 'correcteur');
  html += '<h4 style="margin-top:16px;">Correcteurs</h4>' + exTab(['Nom et prénom(s)', 'Épreuve corrigée', 'Grade', 'École / service', 'Téléphone'],
    corr.sort((a, b) => String(a.epreuveCode).localeCompare(String(b.epreuveCode)) || exCmpNom(a, b)).map((j) => { const e = (session.epreuves || []).find((x) => x.code === j.epreuveCode); return [esc(exNomComplet(j)), esc(e ? e.nom : ''), esc(j.grade), esc(j.ecoleOrigine), esc(j.telephone)]; }));
  exPrint('Composition des jurys', html);
}

/* ---------------- Résultats ---------------- */
function exLigneAdmis(l, i, merite) {
  const c = l.candidat;
  return merite
    ? [l.rang ?? '', esc(c.numeroTable), esc(exNomComplet(c)), exSexe(c), esc(c.ecole), exFmt(l.moyenne), esc(l.mention || (l.repeche ? 'repêché(e)' : ''))]
    : [esc(c.numeroPV || i + 1), esc(c.numeroTable), esc(exNomComplet(c)), exSexe(c), esc(exQuand(c)), esc(c.ecole), esc(l.mention || (l.repeche ? 'repêché(e)' : ''))];
}
function exHtmlAdmis(ctx, res, ordre) {
  const merite = ordre === 'merite';
  const admis = res.lignes.filter((l) => l.decision === 'admis').sort((a, b) => merite ? (a.rang ?? 1e9) - (b.rang ?? 1e9) || exCmpNom(a.candidat, b.candidat) : exCmpNom(a.candidat, b.candidat));
  const g = res.stats.global;
  return exEntete(ctx, merite ? 'Palmarès des admis (par mérite)' : 'Liste des admis (ordre alphabétique)', `${admis.length} admis sur ${g.presents} présents${g.taux !== null ? ` — ${exFmt(g.taux, 1)} %` : ''}`)
    + exTab(merite ? ['Rang', 'N° table', 'Nom et prénom(s)', 'Sexe', 'École', 'Moyenne /20', 'Mention'] : ['N° PV', 'N° table', 'Nom et prénom(s)', 'Sexe', 'Né(e) le', 'École', 'Mention'], admis.map((l, i) => exLigneAdmis(l, i, merite)), { centre: [0, 1, 3] })
    + exSignatures(['Le Président du jury']);
}
function exDocAdmis(ctx, res, ordre) {
  if (res.stats.global.attente) toast(`Attention : ${res.stats.global.attente} candidat(s) sont encore en attente — liste provisoire.`);
  exPrint(ordre === 'merite' ? 'Palmarès des admis' : 'Liste des admis', exHtmlAdmis(ctx, res, ordre));
}
function exWordAdmis(ctx, res) { exportWordDoc(`admis-${ctx.session.annee}.doc`, 'Liste des admis', exHtmlAdmis(ctx, res, 'alpha')); }

function exDocParEcole(ctx, res) {
  const groupes = new Map();
  res.lignes.forEach((l) => { const k = l.candidat.ecole || '—'; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(l); });
  let html = exEntete(ctx, 'Résultats par école');
  [...groupes.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).forEach(([ecole, ls]) => {
    const adm = ls.filter((l) => l.decision === 'admis').length, pres = ls.filter((l) => l.decision !== 'absent').length;
    html += `<h4 style="margin:16px 0 4px;break-after:avoid;">${esc(ecole)} — ${adm} admis sur ${pres} présents${pres ? ` (${exFmt(adm / pres * 100, 1)} %)` : ''}</h4>`
      + exTab(['N°', 'N° table', 'Nom et prénom(s)', 'Sexe', 'Moyenne /20', 'Décision', 'Mention'],
        ls.sort((a, b) => exCmpNom(a.candidat, b.candidat)).map((l, i) => [i + 1, esc(l.candidat.numeroTable), esc(exNomComplet(l.candidat)), exSexe(l.candidat), exFmt(l.moyenne), esc(EX_DECISIONS[l.decision] + (l.repeche ? ' (repêché)' : '')), esc(l.mention)]), { centre: [0, 1, 3, 4] });
  });
  exPrint('Résultats par école', html);
}

function exHtmlStatsBloc(ctx, res) {
  const st = res.stats;
  const lig = (lib, r) => [esc(lib), r.inscrits, r.presents, r.admis, r.ajournes, r.taux === null ? '—' : exFmt(r.taux, 1) + ' %'];
  const ent = (t) => [t, 'Inscrits', 'Présents', 'Admis', 'Ajournés', 'Taux'];
  return `<div class="table-wrap" style="margin-bottom:12px;">${exTab(ent('Ensemble'), [lig('Garçons', st.garcons), lig('Filles', st.filles), lig('Total', st.global)], { centre: [1, 2, 3, 4, 5], fs: 12 })}</div>
    ${st.handicap ? `<div class="table-wrap" style="margin-bottom:12px;">${exTab(ent('Catégorie'), [lig('Situation de handicap', st.handicap), lig('Candidats bilingues', st.bilingues)], { centre: [1, 2, 3, 4, 5], fs: 12 })}</div>` : ''}
    <div class="table-wrap" style="margin-bottom:12px;">${exTab(ent('École'), st.parEcole.map((r) => lig(r.cle, r)), { centre: [1, 2, 3, 4, 5], fs: 12 })}</div>
    <div class="table-wrap" style="margin-bottom:12px;">${exTab(ent('Centre'), st.parCentre.map((r) => lig(exCentreNom(ctx, r.cle) || 'Non affecté', r)), { centre: [1, 2, 3, 4, 5], fs: 12 })}</div>
    <div class="table-wrap" style="margin-bottom:12px;">${exTab(['Épreuve', 'Copies notées', 'Moyenne /20'], st.parEpreuve.map((e) => [esc(e.nom), e.nb, exFmt(e.moyenne)]), { centre: [1, 2], fs: 12 })}</div>
    ${st.parMention.length ? `<div class="table-wrap">${exTab(['Mention', 'Admis'], st.parMention.map((m) => [esc(m.label), m.nb]), { centre: [1], fs: 12 })}</div>` : ''}`;
}
function exDocStats(ctx, res) {
  exPrint('Statistiques', exEntete(ctx, "Statistiques de l'examen", `Moyenne générale : ${exFmt(res.stats.moyenneGenerale)} /20 · seuil d'admission : ${exFmt(res.seuil)} /20`) + exHtmlStatsBloc(ctx, res));
}

function exDocPV(ctx, res) {
  const { session } = ctx;
  const date = session.dateResultats ? formatDate(session.dateResultats) : formatDate(todayISO());
  const bureau = ctx.jurys.filter((j) => ['president', 'vice_president', 'secretaire', 'membre'].includes(j.fonction));
  // Un procès-verbal par jury, comme dans la SIGEC : les candidats sont regroupés par jury de rattachement
  const parJury = new Map();
  res.lignes.forEach((l) => {
    const cen = ctx.centres.find((k) => k._uuid === l.candidat.centreUuid);
    const j = cen ? exNomJury(cen) : 'Candidats non affectés';
    if (!parJury.has(j)) parJury.set(j, []);
    parJury.get(j).push(l);
  });
  const pages = [...parJury.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true })).map(([jury, ls]) => {
    const g = exCompte(ls);
    const repeches = ls.filter((l) => l.decision === 'admis' && l.repeche);
    const ajParJury = ls.filter((l) => l.decision === 'ajourne' && l.calc === 'admis');
    const centresDuJury = ctx.centres.filter((k) => exNomJury(k) === jury).map((k) => k.nom);
    const membres = bureau.concat(ctx.jurys.filter((j) => j.fonction === 'chef_centre' && ctx.centres.some((k) => k._uuid === j.centreUuid && exNomJury(k) === jury)));
    return exEntete(ctx, 'Procès-verbal de délibération', `<b>${esc(jury)}</b>${centresDuJury.length ? ' — centres : ' + esc(centresDuJury.join(', ')) : ''}`)
      + `<p style="font-size:12.5px;">Le jury de l'examen (${esc(exTitreExamen(session).toLowerCase())}), session ${esc(session.annee)}, s'est réuni le ${esc(date)} pour délibérer sur les résultats des candidats. Après correction${session.doubleCorrection ? ' (double correction avec arbitrage au-delà de ' + exFmt(exNum(session.toleranceEcart) ?? 3) + ' point(s)/20)' : ''}, il a retenu comme seuil d'admission la moyenne de <b>${exFmt(res.seuil)}/20</b>.</p>`
      + exTab(['Inscrits', 'Absents', 'Présents', 'Admis', 'Ajournés', 'Taux de réussite'], [[g.inscrits, g.absents, g.presents, g.admis, g.ajournes, g.taux === null ? '—' : exFmt(g.taux, 1) + ' %']], { centre: [0, 1, 2, 3, 4, 5], fs: 12 })
      + `<p style="font-size:12.5px;margin-top:10px;">Parmi les admis, <b>${repeches.length}</b> candidat(s) ont été repêché(s) par décision du jury${ajParJury.length ? ` ; <b>${ajParJury.length}</b> candidat(s) ont été ajourné(s) par décision du jury malgré une moyenne suffisante` : ''}.</p>`
      + ((repeches.length || ajParJury.length) ? exTab(['N° PV', 'Nom et prénom(s)', 'Moyenne /20', 'Décision du jury', 'Motif'], [...repeches, ...ajParJury].map((l) => [esc(l.candidat.numeroPV), esc(exNomComplet(l.candidat)), exFmt(l.moyenne), esc(EX_DECISIONS[l.decision]), esc(l.motif)]), { centre: [0, 2], fs: 11.5 }) : '')
      + `<h4 style="margin:14px 0 4px;">Résultats du jury</h4>`
      + exTab(['N° PV', 'N° table', 'Nom et prénom(s)', 'Sexe', 'École', 'Moyenne /20', 'Décision', 'Mention'],
        [...ls].sort((a, b) => String(a.candidat.numeroPV || '\uffff').localeCompare(String(b.candidat.numeroPV || '\uffff'))).map((l) => [esc(l.candidat.numeroPV), esc(l.candidat.numeroTable), esc(exNomComplet(l.candidat)), exSexe(l.candidat), esc(l.candidat.ecole), exFmt(l.moyenne), esc(EX_DECISIONS[l.decision] + (l.repeche ? ' (repêché)' : '')), esc(l.mention)]), { centre: [0, 1, 3, 5], fs: 10.5 })
      + `<p style="font-size:12.5px;margin-top:10px;">Fait pour servir et valoir ce que de droit. Ont signé les membres du jury :</p>`
      + exTab(['Nom et prénom(s)', 'Fonction', 'Signature'], (membres.length ? membres : [{ nom: '', prenom: '', fonction: 'president' }]).map((j) => [esc(exNomComplet(j)), esc(exLib(EX_FONCTIONS, j.fonction)), '']), { fs: 12, hauteur: 42 });
  });
  exPrint('Procès-verbaux de délibération', pages.join(EX_SAUT));
}

/* Convocation / réquisition des acteurs (jurys, surveillants, correcteurs…) */
function exDocConvocationsActeurs(ctx, liste) {
  const { session } = ctx;
  if (!liste.length) { toast('Aucun acteur à convoquer.'); return; }
  const periode = [session.dateDebut, session.dateFin].filter(Boolean).map((d) => formatDate(d)).join(' au ');
  const blocs = [...liste].sort((a, b) => exCmpNom(a, b)).map((j) => {
    const cen = ctx.centres.find((k) => k._uuid === j.centreUuid);
    const ep = (session.epreuves || []).find((e) => e.code === j.epreuveCode);
    return `<div style="border:1px solid #333;padding:14px 16px;margin-bottom:16px;break-inside:avoid;page-break-inside:avoid;font-size:12.5px;">
      ${exEntete(ctx, "Ordre de réquisition / convocation")}
      <p style="margin:6px 0;"><b>${esc(exNomComplet(j))}</b>${j.grade ? ' (' + esc(j.grade) + ')' : ''}${j.ecoleOrigine ? ', ' + esc(j.ecoleOrigine) : ''}, est requis(e) pour l'examen en qualité de <b>${esc(exLib(EX_FONCTIONS, j.fonction))}</b>.</p>
      ${exTab(['Jury', 'Centre', 'Salle / épreuve', 'Période'], [[esc(cen ? exNomJury(cen) : '—'), esc(cen ? cen.nom + (cen.localite ? ' — ' + cen.localite : '') : 'à préciser'), esc([j.salle, ep ? ep.nom : ''].filter(Boolean).join(' · ') || '—'), esc(periode || 'à préciser')]], { fs: 12 })}
      <div style="text-align:right;margin-top:8px;font-size:12px;">Le Directeur / Le Chef de CEB<div style="height:38px;"></div></div></div>`;
  });
  const pages = [];
  for (let i = 0; i < blocs.length; i += 3) pages.push(blocs.slice(i, i + 3).join(''));
  exPrint('Convocations des acteurs', pages.join(EX_SAUT));
}

function exDocReleves(ctx, res, lignes) {
  const { session } = ctx;
  if (!lignes.length) { toast('Aucun relevé à imprimer.'); return; }
  const eps = session.epreuves || [];
  const blocs = lignes.map((l) => {
    const c = l.candidat;
    return `<div style="border:1px solid #333;padding:14px 16px;margin-bottom:16px;break-inside:avoid;page-break-inside:avoid;font-size:12.5px;">
      ${exEntete(ctx, 'Relevé de notes')}
      <p style="margin:4px 0;"><b>${esc(exNomComplet(c))}</b> · ${exSexe(c) === 'F' ? 'née' : 'né'} le ${esc(exQuand(c) || '—')} · école : ${esc(c.ecole || '—')} · n° de table : <b>${esc(c.numeroTable || '—')}</b></p>
      ${exTab(['Épreuve', 'Coef.', 'Note', 'Note /20'], l.details.map((d, i) => [esc(eps[i].nom), esc(eps[i].coef), d.etat === 'absent' ? 'Absent' : d.valeur === null ? '—' : `${exFmt(d.valeur)} / ${esc(eps[i].bareme)}`, d.sur20 === null ? '—' : exFmt(d.sur20)]), { centre: [1, 2, 3], fs: 12 })}
      <p style="margin:8px 0 0;">Moyenne : <b>${exFmt(l.moyenne)} / 20</b> · Décision : <b>${esc(EX_DECISIONS[l.decision] + (l.repeche ? ' (repêché)' : ''))}</b>${l.mention ? ' · Mention : <b>' + esc(l.mention) + '</b>' : ''}${l.rang ? ' · Rang : ' + l.rang : ''}</p></div>`;
  });
  const pages = [];
  for (let i = 0; i < blocs.length; i += 2) pages.push(blocs.slice(i, i + 2).join(''));
  exPrint('Relevés de notes', pages.join(EX_SAUT));
}

function exDocAttestations(ctx, res, lignes) {
  const { session } = ctx;
  if (!lignes.length) { toast('Aucun admis à qui délivrer une attestation.'); return; }
  const pres = exNomJure(exPrems(ctx, 'president'));
  const date = session.dateResultats ? formatDate(session.dateResultats) : formatDate(todayISO());
  const pages = lignes.map((l) => {
    const c = l.candidat, f = exSexe(c) === 'F';
    return exEntete(ctx, 'Attestation provisoire de réussite')
      + `<div style="font-size:14px;line-height:1.9;margin-top:26px;">
        <p>Le Président du jury de l'examen (${esc(exTitreExamen(session).toLowerCase())}), session ${esc(session.annee)}${session.ceb ? ', CEB de ' + esc(session.ceb) : ''}, atteste que :</p>
        <p style="text-align:center;font-size:17px;"><b>${esc(exNomComplet(c))}</b></p>
        <p>${f ? 'née' : 'né'} le ${esc(exQuand(c) || '………………')}, ${f ? 'élève' : 'élève'} de l'école ${esc(c.ecole || '………………')}, n° de table <b>${esc(c.numeroTable || '—')}</b>, a été déclaré${f ? 'e' : ''} <b>ADMIS${f ? 'E' : ''}</b> avec la moyenne de <b>${exFmt(l.moyenne)}/20</b>${l.mention ? ` (mention ${esc(l.mention)})` : ''}${l.repeche ? ' par décision du jury' : ''}.</p>
        <p style="font-size:12.5px;">Cette attestation provisoire est délivrée à l'intéressé${f ? 'e' : ''} pour servir et valoir ce que de droit, dans l'attente de la délivrance du diplôme.</p>
        <p style="text-align:right;margin-top:24px;">Fait le ${esc(date)}</p></div>`
      + exSignatures([`Le Président du jury${pres ? ' — ' + pres : ''}`]);
  });
  exPrint('Attestations de réussite', pages.join(EX_SAUT));
}

function exCsvResultats(ctx, res, lignes) {
  const eps = ctx.session.epreuves || [];
  download(`resultats-${ctx.session.annee}.csv`, toCSV(lignes, [
    { label: 'Rang', value: (l) => l.rang ?? '' }, { label: 'N° table', value: (l) => l.candidat.numeroTable }, { label: 'Nom', value: (l) => l.candidat.nom }, { label: 'Prénom', value: (l) => l.candidat.prenom },
    { label: 'Sexe', value: (l) => exSexe(l.candidat) }, { label: 'École', value: (l) => l.candidat.ecole }, { label: 'Examen', value: (l) => l.candidat.examens || 'CEP seul' },
    { label: 'Centre', value: (l) => exCentreNom(ctx, l.candidat.centreUuid) },
    ...eps.map((e, i) => ({ label: `${e.nom} (/${e.bareme})`, value: (l) => (l.details[i].etat === 'absent' ? 'ABS' : l.details[i].valeur === null ? '' : exFmt(l.details[i].valeur)) })),
    { label: 'Moyenne /20', value: (l) => (l.moyenne === null ? '' : exFmt(l.moyenne)) }, { label: 'Décision', value: (l) => EX_DECISIONS[l.decision] + (l.repeche ? ' (repêché)' : '') },
    { label: 'Mention', value: (l) => l.mention }, { label: 'Motif', value: (l) => l.motif }
  ]), 'text/csv;charset=utf-8');
}
