/* ============================================================
   app-cep-core.js — Circuit du CEP par le serveur : noyau
   ------------------------------------------------------------
   Calculs purs (testables sans navigateur), envoi vers le serveur avec
   file d'attente hors ligne, échéances, anomalies, agrégation par zone.
   AUCUN nom de candidat ne passe ici : seulement des chiffres.
   Tables et fonctions serveur : voir supabase-circuit.sql.
   ============================================================ */

const CEP_NIVEAU_LIB = { ecole: 'École', centre: 'Centre', ceb: 'CEB', dpeppnf: 'DPEPPNF', dreppnf: 'DREPPNF', ministere: 'Ministère' };
const CEP_ETAPES = [
  { code: 'inscriptions', label: 'Inscriptions', auto: 'effectifs', aide: "Les écoles publient leurs candidats ; la CEB transmet ses effectifs." },
  { code: 'depot_epreuves', label: 'Dépôt des épreuves', auto: null, aide: "Marqué « fait » à la main par la CEB." },
  { code: 'composition', label: 'Composition', auto: 'jourj', aide: "Suivi du jour J saisi par les centres (toutes les épreuves de tous les centres)." },
  { code: 'correction', label: 'Correction', auto: null, aide: "Marqué « fait » à la main par la CEB." },
  { code: 'depot_resultats', label: 'Dépôt des résultats', auto: 'bordereau', aide: "La CEB transmet son bordereau de résultats." },
  { code: 'deliberation', label: 'Délibération', auto: null, aide: "Marqué « fait » à la main par la CEB." }
];
// Étapes qui concernent chaque niveau (pour « mes échéances »)
const CEP_ETAPES_NIVEAU = {
  ecole: ['inscriptions'],
  centre: ['composition'],
  ceb: CEP_ETAPES.map((e) => e.code),
  dpeppnf: CEP_ETAPES.map((e) => e.code),
  dreppnf: CEP_ETAPES.map((e) => e.code),
  ministere: CEP_ETAPES.map((e) => e.code)
};
const CEP_RISQUES = {
  normal: { label: 'Normal', badge: 'vert' },
  ferme: { label: 'Fermé', badge: 'terre' },
  delocalise: { label: 'Délocalisé', badge: 'ocre' },
  securise: { label: 'Sécurisé', badge: 'indigo' }
};
const CEP_INCIDENTS = { fraude: 'Fraude ou tentative', sante: 'Santé (malaise, blessure)', securite: 'Sécurité', logistique: 'Matériel ou logistique', autre: 'Autre' };
const CEP_ETAT = { annee: '', type: 'cep', chemin: [], filtre: 'tous' };

/* ---------------- Utilitaires purs ---------------- */
const cepNorm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const cepCleZone = (r, p, c) => `${cepNorm(r)}|${cepNorm(p)}|${cepNorm(c)}`;
const cepNb = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const cepPct = (a, b) => (b > 0 ? a / b * 100 : null);
const cepFmtPct = (n) => (n === null || n === undefined ? '—' : (Math.round(n * 10) / 10).toString().replace('.', ',') + ' %');
const cepArr1 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
function cepJoursEntre(isoFin, isoRef) { // jours entiers de isoRef à isoFin (négatif = dépassé)
  const a = String(isoFin || '').slice(0, 10).split('-').map(Number), b = String(isoRef || '').slice(0, 10).split('-').map(Number);
  if (a.length < 3 || b.length < 3 || a.some(isNaN) || b.some(isNaN)) return null;
  return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
}
const cepAujourdhui = () => new Date().toISOString().slice(0, 10);

/* ---------------- Échéances ---------------- */
function cepEcheance(calendrier, etape, niveau) {
  const l = (calendrier || []).filter((x) => x.etape === etape);
  return l.find((x) => x.niveau === niveau) || l.find((x) => x.niveau === 'tous') || null;
}
/* etat : fait | retard | bientot | a_venir | pas_commence | sans_date */
function cepEtatEcheance(ech, fait, aujourdhui, seuil) {
  if (fait) return { etat: 'fait', jours: ech ? cepJoursEntre(ech.date_limite, aujourdhui) : null };
  if (!ech) return { etat: 'sans_date', jours: null };
  const jours = cepJoursEntre(ech.date_limite, aujourdhui);
  if (jours !== null && jours < 0) return { etat: 'retard', jours };
  if (ech.date_debut && cepJoursEntre(ech.date_debut, aujourdhui) > 0) return { etat: 'pas_commence', jours };
  if (jours !== null && jours <= (seuil === undefined ? 7 : seuil)) return { etat: 'bientot', jours };
  return { etat: 'a_venir', jours };
}
function cepTexteEcheance(e) {
  if (e.etat === 'fait') return 'Fait';
  if (e.etat === 'sans_date') return 'Date non fixée';
  if (e.etat === 'retard') return `En retard de ${Math.abs(e.jours)} jour(s)`;
  if (e.etat === 'bientot') return e.jours === 0 ? "À faire aujourd'hui" : `À faire dans ${e.jours} jour(s)`;
  if (e.etat === 'pas_commence') return 'Pas encore commencé';
  return e.jours === null ? '' : `Dans ${e.jours} jour(s)`;
}

/* ---------------- Statut d'un document (effectifs ou bordereau) ---------------- */
function cepStatutDoc(r) {
  if (!r) return { cle: 'aucun', label: 'Pas transmis', badge: 'terre' };
  if (r.statut === 'a_corriger') return { cle: 'a_corriger', label: 'À corriger', badge: 'ocre' };
  if (r.statut === 'valide') {
    const n = { dpeppnf: 'DPEPPNF', dreppnf: 'DREPPNF', ministere: 'ministère' }[r.niveau_valide] || '';
    return { cle: 'valide', label: n ? `Validé (${n})` : 'Validé', badge: 'vert' };
  }
  return { cle: 'transmis', label: 'Transmis', badge: 'indigo' };
}
/* Que peut faire ce niveau sur ce document ? */
function cepActionsPossibles(role, r) {
  if (!r || !['dpeppnf', 'dreppnf', 'ministere'].includes(role)) return { valider: false, renvoyer: false };
  const rang = { dpeppnf: 1, dreppnf: 2, ministere: 3 };
  const rangValide = { dpeppnf: 1, dreppnf: 2, ministere: 3 }[r.niveau_valide] || 0;
  const valider = (role === 'dpeppnf' && r.statut === 'transmis') || (role === 'dreppnf' && r.statut === 'valide' && r.niveau_valide === 'dpeppnf')
    || (role === 'ministere' && r.statut === 'valide' && r.niveau_valide === 'dreppnf');
  const renvoyer = r.statut !== 'a_corriger' && rangValide <= rang[role];
  return { valider, renvoyer };
}

/* ---------------- Fabrication des chiffres à transmettre (depuis l'Espace Examen local) ---------------- */
function cepEffectifsDepuisSession(ctx, ecolesAttendues) {
  const cands = ctx.candidats || [];
  const f = cands.filter((c) => c.sexe === 'F').length;
  const ecoles = new Set(cands.map((c) => cepNorm(c.ecole)).filter(Boolean));
  const jurys = new Set((ctx.centres || []).map((c) => String(c.jury || '').trim() || 'Jury unique'));
  return {
    inscrits_f: f, inscrits_g: cands.length - f,
    nb_ecoles: ecoles.size, nb_ecoles_attendues: cepNb(ecolesAttendues),
    nb_centres: (ctx.centres || []).length, nb_jurys: jurys.size,
    nb_salles: (ctx.centres || []).reduce((s, c) => s + Math.max(0, Math.floor(cepNb(c.nbSalles))), 0),
    nb_handicap: cands.filter((c) => c.handicap).length, nb_bilingues: cands.filter((c) => c.bilingue).length
  };
}
function cepBaseServeur(ls) { // lignes de résultats -> chiffres attendus par le serveur
  const c = { inscrits: ls.length, absents: 0, admis: 0, ajournes: 0, exclus: 0, attente: 0 };
  ls.forEach((l) => {
    if (l.decision === 'absent') c.absents++; else if (l.decision === 'admis') c.admis++; else if (l.decision === 'ajourne') c.ajournes++;
    else if (l.decision === 'exclu') c.exclus++; else c.attente++;
  });
  return c;
}
function cepBordereauDepuisResultats(session, res) {
  const lignes = res.lignes || [];
  const F = cepBaseServeur(lignes.filter((l) => l.candidat.sexe === 'F')), G = cepBaseServeur(lignes.filter((l) => l.candidat.sexe !== 'F'));
  const h = lignes.filter((l) => l.candidat.handicap), b = lignes.filter((l) => l.candidat.bilingue);
  const st = res.stats || {};
  const avecMoy = lignes.filter((l) => l.moyenne !== null && l.moyenne !== undefined && l.decision !== 'absent').length;
  const out = {
    annee: session.annee, type: session.type,
    f: { inscrits: F.inscrits, absents: F.absents, admis: F.admis, ajournes: F.ajournes, exclus: F.exclus },
    g: { inscrits: G.inscrits, absents: G.absents, admis: G.admis, ajournes: G.ajournes, exclus: G.exclus },
    attente: F.attente + G.attente,
    moyenne: st.moyenneGenerale === null || st.moyenneGenerale === undefined ? null : cepArr1(st.moyenneGenerale),
    nb_moyennes: avecMoy, seuil: res.seuil === undefined || res.seuil === null ? null : cepNb(res.seuil),
    epreuves: (st.parEpreuve || []).map((e) => ({ nom: String(e.nom || '').slice(0, 60), moyenne: e.moyenne === null || e.moyenne === undefined ? null : cepArr1(e.moyenne), nb: cepNb(e.nb) })),
    handicap_inscrits: h.length, handicap_admis: h.filter((l) => l.decision === 'admis').length,
    bilingues_inscrits: b.length, bilingues_admis: b.filter((l) => l.decision === 'admis').length
  };
  return out;
}
/* Mêmes contrôles que le serveur, en français simple (le serveur re-vérifie toujours) */
function cepControlerBordereau(p) {
  const err = [];
  if (!p) return ['Aucun résultat à transmettre.'];
  if (p.type === 'blanc') err.push("Un examen blanc ne se transmet pas.");
  if (p.attente > 0) err.push(`${p.attente} candidat(s) sont encore « en attente » : terminez la délibération.`);
  [['filles', p.f], ['garçons', p.g]].forEach(([nom, b]) => {
    if (b.absents > b.inscrits) err.push(`Plus d'absents que d'inscrits chez les ${nom}.`);
    if (b.admis + b.ajournes + b.exclus !== b.inscrits - b.absents && !p.attente) err.push(`Chiffres des ${nom} incohérents : admis + ajournés + exclus doit égaler les présents.`);
  });
  if (p.f.inscrits + p.g.inscrits === 0) err.push('Aucun candidat : rien à transmettre.');
  return err;
}

/* ---------------- Unités (une par CEB) et agrégation ---------------- */
function cepConstruireUnites(d) {
  const m = new Map();
  const get = (r, p, c, nom) => {
    const k = cepCleZone(r, p, c);
    if (!m.has(k)) m.set(k, { cle: k, region: r || '', province: p || '', ceb: c || '', nom: nom || (c ? `CEB ${c}` : ''), eff: null, bord: null, cent: null, jourj: [], manuels: new Set(), risques: [] });
    const u = m.get(k); if (nom && !u.nom) u.nom = nom; return u;
  };
  (d.structures || []).filter((s) => s.role === 'ceb').forEach((s) => get(s.region, s.province, s.ceb, s.structure));
  (d.effectifs || []).forEach((r) => { get(r.region, r.province, r.ceb).eff = r; });
  (d.bordereaux || []).forEach((r) => { get(r.region, r.province, r.ceb).bord = r; });
  (d.centresResume || []).forEach((r) => { get(r.region, r.province, r.ceb).cent = r; });
  (d.jourjResume || []).forEach((r) => { get(r.region, r.province, r.ceb).jourj.push(r); });
  (d.centresRisque || []).forEach((r) => { get(r.region, r.province, r.ceb).risques.push(r); });
  (d.avancement || []).filter((a) => a.niveau === 'ceb').forEach((a) => { get(a.region, a.province, a.ceb).manuels.add(a.etape); });
  return [...m.values()].sort((a, b) => cepNorm(a.region).localeCompare(cepNorm(b.region)) || cepNorm(a.province).localeCompare(cepNorm(b.province)) || a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
}
function cepUniteADonnee(u) { return !!(u.eff || u.bord || u.cent || u.jourj.length); }

function cepAgreger(units) {
  const a = {
    nbCeb: units.length, sansDonnee: 0, effTransmis: 0, bordTransmis: 0, effValides: 0, bordValides: 0, aCorriger: 0,
    inscritsF: 0, inscritsG: 0, centres: 0, jurys: 0, salles: 0, aRisque: 0, handicap: 0, bilingues: 0, ecoles: 0, ecolesAttendues: 0,
    candidatsCentres: 0, centresComplets: 0,
    res: { inscrits: 0, absents: 0, admis: 0, ajournes: 0, exclus: 0, fAdmis: 0, fPresents: 0, gAdmis: 0, gPresents: 0, handicapInscrits: 0, handicapAdmis: 0, bilinguesInscrits: 0, bilinguesAdmis: 0 }
  };
  units.forEach((u) => {
    if (!cepUniteADonnee(u)) a.sansDonnee++;
    if (u.eff) {
      a.effTransmis++; a.inscritsF += cepNb(u.eff.inscrits_f); a.inscritsG += cepNb(u.eff.inscrits_g);
      a.jurys += cepNb(u.eff.nb_jurys); a.salles += cepNb(u.eff.nb_salles); a.handicap += cepNb(u.eff.nb_handicap); a.bilingues += cepNb(u.eff.nb_bilingues);
      a.ecoles += cepNb(u.eff.nb_ecoles); a.ecolesAttendues += cepNb(u.eff.nb_ecoles_attendues);
      if (u.eff.statut === 'valide') a.effValides++;
      if (u.eff.statut === 'a_corriger') a.aCorriger++;
    }
    if (u.cent) { a.centres += cepNb(u.cent.nb_centres); a.aRisque += cepNb(u.cent.nb_a_risque); a.candidatsCentres += cepNb(u.cent.nb_candidats); a.centresComplets += cepNb(u.cent.nb_complets); }
    else if (u.eff) a.centres += cepNb(u.eff.nb_centres);
    if (u.bord) {
      const b = u.bord, R = a.res; a.bordTransmis++;
      if (b.statut === 'valide') a.bordValides++;
      if (b.statut === 'a_corriger') a.aCorriger++;
      const fp = cepNb(b.f_inscrits) - cepNb(b.f_absents), gp = cepNb(b.g_inscrits) - cepNb(b.g_absents);
      R.inscrits += cepNb(b.f_inscrits) + cepNb(b.g_inscrits); R.absents += cepNb(b.f_absents) + cepNb(b.g_absents);
      R.admis += cepNb(b.f_admis) + cepNb(b.g_admis); R.ajournes += cepNb(b.f_ajournes) + cepNb(b.g_ajournes); R.exclus += cepNb(b.f_exclus) + cepNb(b.g_exclus);
      R.fAdmis += cepNb(b.f_admis); R.fPresents += fp; R.gAdmis += cepNb(b.g_admis); R.gPresents += gp;
      R.handicapInscrits += cepNb(b.handicap_inscrits); R.handicapAdmis += cepNb(b.handicap_admis);
      R.bilinguesInscrits += cepNb(b.bilingues_inscrits); R.bilinguesAdmis += cepNb(b.bilingues_admis);
    }
  });
  a.inscrits = a.inscritsF + a.inscritsG;
  a.res.presents = a.res.inscrits - a.res.absents;
  a.res.taux = cepPct(a.res.admis, a.res.presents);
  a.res.tauxF = cepPct(a.res.fAdmis, a.res.fPresents);
  a.res.tauxG = cepPct(a.res.gAdmis, a.res.gPresents);
  return a;
}

/* Arbre région → province → CEB selon le niveau du compte */
function cepConstruireArbre(units, structures, niveau) {
  const feuille = (u) => ({ cle: u.cle, niveau: 'ceb', nom: u.nom || `CEB ${u.ceb}`, region: u.region, province: u.province, ceb: u.ceb, unites: [u], enfants: [] });
  const regroupe = (liste, champ, nivNoeud, struct) => {
    const g = new Map();
    liste.forEach((u) => { const k = cepNorm(u[champ]); if (!g.has(k)) g.set(k, { nom: u[champ] || '—', unites: [] }); g.get(k).unites.push(u); });
    (struct || []).forEach((s) => { const k = cepNorm(s[champ]); if (k && !g.has(k)) g.set(k, { nom: s[champ], unites: [] }); });
    return [...g.entries()].map(([k, v]) => ({ cle: nivNoeud + ':' + k, niveau: nivNoeud, nom: v.nom, unites: v.unites, enfants: [] }));
  };
  let racines;
  if (niveau === 'ministere') {
    racines = regroupe(units, 'region', 'region', (structures || []).filter((s) => s.role === 'dreppnf'));
    racines.forEach((r) => {
      r.enfants = regroupe(r.unites, 'province', 'province', (structures || []).filter((s) => s.role === 'dpeppnf' && cepNorm(s.region) === cepNorm(r.nom)));
      r.enfants.forEach((p) => { p.enfants = p.unites.map(feuille); });
    });
  } else if (niveau === 'dreppnf') {
    racines = regroupe(units, 'province', 'province', (structures || []).filter((s) => s.role === 'dpeppnf'));
    racines.forEach((p) => { p.enfants = p.unites.map(feuille); });
  } else racines = units.map(feuille);
  const fin = (n) => { n.agg = cepAgreger(n.unites); n.enfants.forEach(fin); n.sansDonnee = n.unites.length === 0 || n.unites.every((u) => !cepUniteADonnee(u)); return n; };
  racines.forEach(fin);
  racines.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
  return racines;
}

/* ---------------- Étapes : situation d'un niveau ---------------- */
function cepEtapeFaiteCeb(etape, u) {
  if (etape.auto === 'effectifs') return !!u.eff;
  if (etape.auto === 'bordereau') return !!u.bord;
  if (etape.auto === 'jourj') return !!(u.cent && cepNb(u.cent.nb_centres) > 0 && cepNb(u.cent.nb_complets) >= cepNb(u.cent.nb_centres));
  return u.manuels.has(etape.code);
}
function cepSituationEtapes(niveau, units, calendrier, aujourdhui) {
  return CEP_ETAPES.filter((e) => CEP_ETAPES_NIVEAU[niveau].includes(e.code)).map((e) => {
    const ech = cepEcheance(calendrier, e.code, niveau);
    const faits = units.filter((u) => cepEtapeFaiteCeb(e, u)).length, total = units.length;
    const fait = total > 0 && faits === total;
    const st = cepEtatEcheance(ech, fait, aujourdhui);
    return { etape: e, echeance: ech, faits, total, fait, ...st, texte: cepTexteEcheance(st) };
  });
}

/* ---------------- Anomalies ---------------- */
function cepAnomalies(units, calendrier, aujourdhui) {
  const out = [];
  const add = (u, gravite, code, texte) => out.push({ gravite, code, cle: u.cle, zone: u.nom || `CEB ${u.ceb}`, texte });
  const ecI = cepEcheance(calendrier, 'inscriptions', 'ceb'), ecR = cepEcheance(calendrier, 'depot_resultats', 'ceb');
  units.forEach((u) => {
    if (!u.eff && ecI && cepJoursEntre(ecI.date_limite, aujourdhui) < 0) add(u, 'haute', 'retard_effectifs', `Effectifs d'inscription non transmis (échéance dépassée de ${Math.abs(cepJoursEntre(ecI.date_limite, aujourdhui))} jour(s)).`);
    if (!u.bord && ecR && cepJoursEntre(ecR.date_limite, aujourdhui) < 0) add(u, 'haute', 'retard_resultats', `Bordereau de résultats non transmis (échéance dépassée de ${Math.abs(cepJoursEntre(ecR.date_limite, aujourdhui))} jour(s)).`);
    [['effectifs', u.eff], ['bordereau', u.bord]].forEach(([nom, r]) => {
      if (r && r.statut === 'a_corriger') add(u, 'moyenne', 'a_corriger', `${nom === 'effectifs' ? 'Effectifs' : 'Bordereau'} renvoyé pour correction : ${r.motif_retour || 'motif non précisé'}.`);
    });
    if (u.eff && u.bord) {
      const ecart = (cepNb(u.bord.f_inscrits) + cepNb(u.bord.g_inscrits)) - (cepNb(u.eff.inscrits_f) + cepNb(u.eff.inscrits_g));
      if (ecart !== 0) add(u, 'haute', 'ecart_inscrits', `Le bordereau compte ${Math.abs(ecart)} inscrit(s) de ${ecart > 0 ? 'plus' : 'moins'} que les effectifs d'inscription.`);
    }
    if (u.eff && cepNb(u.eff.nb_ecoles_attendues) > cepNb(u.eff.nb_ecoles)) add(u, 'moyenne', 'ecoles_manquantes', `${cepNb(u.eff.nb_ecoles_attendues) - cepNb(u.eff.nb_ecoles)} école(s) n'ont pas publié leurs candidats.`);
    if (u.bord) {
      const pres = cepNb(u.bord.f_inscrits) + cepNb(u.bord.g_inscrits) - cepNb(u.bord.f_absents) - cepNb(u.bord.g_absents);
      const adm = cepNb(u.bord.f_admis) + cepNb(u.bord.g_admis);
      if (pres >= 20 && (adm === 0 || adm === pres)) add(u, 'moyenne', 'taux_atypique', `Taux de réussite atypique (${adm === 0 ? '0' : '100'} %) : à vérifier.`);
    }
    if (u.cent && cepNb(u.cent.nb_a_risque) > 0) add(u, 'haute', 'centre_risque', `${u.cent.nb_a_risque} centre(s) fermé(s), délocalisé(s) ou sécurisé(s).`);
    const nbC = u.cent ? cepNb(u.cent.nb_centres) : 0;
    u.jourj.forEach((j) => {
      const ep = j.epreuve_nom || j.epreuve_code;
      if (nbC && cepNb(j.nb_centres_saisis) === nbC && cepNb(u.cent.nb_candidats) > 0 && cepNb(j.nb_presents) + cepNb(j.nb_absents) !== cepNb(u.cent.nb_candidats)) {
        add(u, 'haute', 'jourj_ecart', `${ep} : présents + absents (${cepNb(j.nb_presents) + cepNb(j.nb_absents)}) ≠ candidats attendus (${cepNb(u.cent.nb_candidats)}).`);
      }
      if (cepNb(j.nb_enveloppes) > cepNb(j.nb_recus)) add(u, 'haute', 'enveloppe_sans_accuse', `${ep} : ${cepNb(j.nb_enveloppes) - cepNb(j.nb_recus)} enveloppe(s) ouverte(s) sans accusé de réception.`);
      if (cepNb(j.nb_scelles_anormaux) > 0) add(u, 'haute', 'scelle_anormal', `${ep} : ${j.nb_scelles_anormaux} paquet(s) reçu(s) avec scellé abîmé.`);
      const graves = cepNb(j.inc_fraude) + cepNb(j.inc_securite);
      if (graves > 0) add(u, 'moyenne', 'incidents', `${ep} : ${graves} incident(s) de fraude ou de sécurité signalé(s).`);
    });
  });
  return out.sort((a, b) => (a.gravite === b.gravite ? 0 : a.gravite === 'haute' ? -1 : 1));
}

/* ---------------- Erreurs et envoi ---------------- */
function cepConvertirErreur(e) {
  const m = String((e && (e.message || e.details)) || e || '');
  const code = e && e.code;
  const err = new Error(m);
  err.horsLigne = !code && /fetch|network|timeout|load failed|offline|connexion/i.test(m);
  if (/could not find the function|schema cache|does not exist|PGRST20[2-5]/i.test(m + ' ' + (code || ''))) err.message = "Le serveur n'est pas à jour : exécutez supabase-complet.sql dans Supabase (SQL Editor), puis rechargez la page.";
  else if (code === 'P0001' || code === '22023' || code === '42501') err.message = m;
  else if (/row-level security|permission denied/i.test(m)) err.message = "Action refusée : droits insuffisants ou zone du compte incomplète.";
  else if (code === '23514') err.message = 'Le serveur a refusé ces chiffres car ils sont incohérents. Vérifiez-les.';
  else if (err.horsLigne) err.message = 'Pas de connexion internet.';
  return err;
}
async function cepRpc(nom, args) {
  const supa = window.supaClient;
  if (!supa) { const e = new Error('Pas de connexion internet.'); e.horsLigne = true; throw e; }
  let r;
  try { r = await supa.rpc(nom, args || {}); } catch (e) { throw cepConvertirErreur(e); }
  if (r.error) throw cepConvertirErreur(r.error);
  return r.data;
}
async function cepLireTout(construire) {
  const out = [];
  for (let from = 0; from < 30000; from += 1000) {
    let r;
    try { r = await construire().range(from, from + 999); } catch (e) { throw cepConvertirErreur(e); }
    if (r.error) throw cepConvertirErreur(r.error);
    out.push(...(r.data || []));
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}

/* File d'attente hors ligne (magasin local « cepLocal », jamais synchronisé) */
async function cepLocalTous(kind) { return (await DB.getAll('cepLocal')).filter((r) => r.kind === kind); }
async function cepCacheEcrire(cle, valeur) {
  const ex = (await cepLocalTous('cache')).find((r) => r.cle === cle);
  const obj = { kind: 'cache', cle, valeur, le: new Date().toISOString() };
  if (ex) await DB.put('cepLocal', { ...ex, ...obj }); else await DB.add('cepLocal', obj);
}
async function cepCacheLire(cle) { const ex = (await cepLocalTous('cache')).find((r) => r.cle === cle); return ex ? ex : null; }
async function cepFileEnAttente() { return (await cepLocalTous('file')).filter((r) => !currentUser || r.user === currentUser.id); }
/* Envoie tout de suite ; sans connexion, met en file. Refus du serveur = erreur affichable (pas de file). */
async function cepEnvoyer(op) {
  try {
    const data = await cepRpc(op.rpc, op.args);
    const ex = (await cepLocalTous('file')).find((r) => r.cle === op.cle && r.user === (currentUser ? currentUser.id : ''));
    if (ex) await DB.delete('cepLocal', ex.id);
    return { envoye: true, data };
  } catch (e) {
    if (!e.horsLigne) throw e;
    const moi = currentUser ? currentUser.id : '';
    const ex = (await cepLocalTous('file')).find((r) => r.cle === op.cle && r.user === moi);
    const obj = { kind: 'file', cle: op.cle, rpc: op.rpc, args: op.args, libelle: op.libelle, user: moi, cree_le: new Date().toISOString(), erreur: '' };
    if (ex) await DB.put('cepLocal', { ...ex, ...obj }); else await DB.add('cepLocal', obj);
    return { envoye: false, enFile: true };
  }
}
let _cepRejeu = false;
async function cepRejouerFile() {
  if (_cepRejeu) return { ok: 0, refus: 0, reste: 0 };
  _cepRejeu = true;
  let ok = 0, refus = 0;
  try {
    for (const it of await cepFileEnAttente()) {
      try { await cepRpc(it.rpc, it.args); await DB.delete('cepLocal', it.id); ok++; }
      catch (e) {
        if (e.horsLigne) break;
        refus++; await DB.put('cepLocal', { ...it, erreur: e.message });
      }
    }
  } finally { _cepRejeu = false; }
  return { ok, refus, reste: (await cepFileEnAttente()).length };
}
if (typeof window !== 'undefined' && window.addEventListener && !window._cepOnline) {
  window._cepOnline = true;
  window.addEventListener('online', () => { if (typeof currentUser !== 'undefined' && currentUser && typeof cepRejouerFile === 'function') cepRejouerFile().then((r) => { if (r.ok && typeof toast === 'function') toast(`${r.ok} envoi(s) en attente transmis au serveur.`); }).catch(() => {}); });
}
function cepBandeauFile(n, refus) {
  if (!n) return '';
  return `<div class="alert alert-ocre" style="margin-bottom:12px;">${n} envoi(s) en attente de connexion${refus ? ` (dont ${refus} refusé(s) par le serveur)` : ''}. <button class="btn btn-sm" id="cep-rejouer" style="margin-left:8px;">Réessayer maintenant</button></div>`;
}
async function cepBrancherFile(root) {
  const b = $('#cep-rejouer', root); if (!b) return;
  b.onclick = async () => { const r = await cepRejouerFile(); toast(r.ok ? `${r.ok} envoi(s) transmis.` : (r.reste ? 'Toujours pas de connexion ou envoi refusé.' : 'Rien à envoyer.')); onRouteChange(); };
}

/* ---------------- Chargement des données d'un niveau ---------------- */
async function cepChargerDonnees(annee, type) {
  const supa = window.supaClient;
  if (!supa) { const e = new Error('Pas de connexion internet.'); e.horsLigne = true; throw e; }
  const [structures, effectifs, bordereaux, centresResume, jourjResume, centresRisque, calendrier, avancement] = await Promise.all([
    cepRpc('cep_structures'),
    cepLireTout(() => supa.from('cep_effectifs').select('*').eq('annee', annee).eq('type_examen', type)),
    cepLireTout(() => supa.from('cep_bordereaux').select('*').eq('annee', annee).eq('type_examen', type)),
    cepRpc('cep_centres_resume', { p_annee: annee }),
    cepRpc('cep_jourj_resume', { p_annee: annee }),
    cepLireTout(() => supa.from('cep_centres').select('id,annee,region,province,ceb,nom,jury,statut_risque,motif_risque,centre_accueil,risque_niveau,risque_par_nom,risque_le').eq('annee', annee).neq('statut_risque', 'normal')),
    cepLireTout(() => supa.from('cep_calendrier').select('*').eq('annee', annee)),
    cepLireTout(() => supa.from('cep_avancement').select('*').eq('annee', annee))
  ]);
  return { annee, type, structures: structures || [], effectifs, bordereaux, centresResume: centresResume || [], jourjResume: jourjResume || [], centresRisque, calendrier, avancement, charge_le: new Date().toISOString() };
}
async function cepAnneesConnues() {
  const supa = window.supaClient;
  const r = await Promise.all([supa.from('cep_calendrier').select('annee'), supa.from('cep_effectifs').select('annee'), supa.from('cep_centres').select('annee').limit(1000)]);
  const s = new Set(); r.forEach((x) => (x.data || []).forEach((l) => s.add(l.annee)));
  return [...s].sort().reverse();
}
