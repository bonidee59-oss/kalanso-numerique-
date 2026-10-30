/* ============================================================
   app-examens-calcul.js — Espace Examen CEP / CEB : calculs purs
   ------------------------------------------------------------
   Aucune dépendance à l'interface ni à la base : répartition des
   candidats en centres/salles, numéros de table, codes d'anonymat,
   note finale (simple ou double correction + arbitrage), moyennes,
   décisions, mentions, classement et statistiques.
   Les références entre enregistrements se font par _uuid (stable
   d'un appareil à l'autre), jamais par identifiant local.
   ============================================================ */

const EX_EXAMENS = ['CEP seul', 'CEP + EG', 'CEP + ET', 'EG seul', 'ET seul'];
const EX_TYPES = { cep: 'CEP', cep_concours: "CEP + concours d'entrée en 6e", blanc: 'Examen blanc (entraînement)' };
const EX_FONCTIONS = [
  ['president', 'Président du jury'], ['vice_president', 'Vice-président'], ['secretaire', 'Secrétaire du jury'],
  ['chef_centre', 'Chef de centre'], ['secretaire_centre', 'Secrétaire de centre'],
  ['correcteur', 'Correcteur'], ['surveillant', 'Surveillant'], ['membre', 'Membre du jury (délibération)']
];
const EX_STATUTS_CAND = [['inscrit', 'Inscrit'], ['present', 'Présent'], ['absent', 'Absent'], ['exclu', 'Exclu (fraude)']];
const EX_DECISIONS = { admis: 'Admis', ajourne: 'Ajourné', absent: 'Absent', exclu: 'Exclu', en_attente: 'En attente' };

/* Valeurs de départ MODIFIABLES : épreuves, coefficients, barèmes, seuil et mentions
   doivent être alignés sur la note de service de votre DREPPNF / CEB. */
const EX_EPREUVES_DEFAUT = [
  { code: 'E1', nom: 'Dictée et questions', coef: 1, bareme: 20, date: '', heure: '' },
  { code: 'E2', nom: 'Mathématiques', coef: 1, bareme: 20, date: '', heure: '' },
  { code: 'E3', nom: "Sciences d'observation", coef: 1, bareme: 20, date: '', heure: '' },
  { code: 'E4', nom: 'Histoire - Géographie', coef: 1, bareme: 20, date: '', heure: '' },
  { code: 'E5', nom: 'Éducation civique', coef: 1, bareme: 20, date: '', heure: '' } // matière évaluée au CEP depuis 2026
];
const EX_MENTIONS_DEFAUT = [
  { label: 'Passable', min: 10 }, { label: 'Assez bien', min: 12 }, { label: 'Bien', min: 14 }, { label: 'Très bien', min: 16 }
];

/* ---------------- Utilitaires numériques ---------------- */
function exNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function exArrondi(n, d = 2) { const p = Math.pow(10, d); return Math.round((n + Number.EPSILON) * p) / p; }
function exFmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return exArrondi(n, d).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d });
}
function exSalles(centre) {
  const nb = Math.max(0, Math.floor(Number(centre && centre.nbSalles) || 0));
  return Array.from({ length: nb }, (_, i) => `Salle ${i + 1}`);
}
function exCmpNom(a, b) {
  return `${a.nom || ''} ${a.prenom || ''}`.localeCompare(`${b.nom || ''} ${b.prenom || ''}`, 'fr', { sensitivity: 'base' });
}
function exCleEcole(e) { return String(e || '').trim().toLowerCase(); }
function exAleaInt(max) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % max; }
  return Math.floor(Math.random() * max);
}

/* ---------------- Répartition en centres / salles + numéros de table ----------------
   mode 'alpha'   : ordre alphabétique, rempli salle après salle
   mode 'melange' : les écoles sont mélangées proportionnellement dans chaque salle
   Les places sont réparties de façon équilibrée sur TOUTES les salles des centres fournis
   (aucune salle n'est remplie à ras bord pendant qu'une autre reste vide). */
function exRepartir(candidats, centres, mode, prefixe) {
  const slots = [];
  [...centres].sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || ''), 'fr')).forEach((c) => {
    exSalles(c).forEach((s) => slots.push({ centreUuid: c._uuid, salle: s, cap: Math.max(0, Math.floor(Number(c.capaciteSalle) || 0)) }));
  });
  const aPlacer = [...candidats];
  const capTotale = slots.reduce((s, x) => s + x.cap, 0);
  if (!slots.length || !capTotale) return { erreur: "Aucune salle avec une capacité : créez d'abord les centres (nombre de salles et places par salle)." };
  if (capTotale < aPlacer.length) return { erreur: `Capacité insuffisante : ${capTotale} places pour ${aPlacer.length} candidats (il manque ${aPlacer.length - capTotale} places).` };

  let ordre = aPlacer.sort(exCmpNom);
  if (mode === 'melange') {
    const groupes = new Map();
    ordre.forEach((c) => { const k = exCleEcole(c.ecole); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(c); });
    const cles = [];
    let gi = 0;
    groupes.forEach((liste) => { liste.forEach((c, j) => cles.push({ c, cle: (j + 0.5) / liste.length, g: gi })); gi++; });
    cles.sort((a, b) => a.cle - b.cle || a.g - b.g);
    ordre = cles.map((x) => x.c);
  }

  const r = ordre.length / capTotale;
  let cumCap = 0, deja = 0, p = 0, numero = 0;
  const largeur = Math.max(3, String(ordre.length).length);
  const affectations = [];
  slots.forEach((slot) => {
    cumCap += slot.cap;
    const cible = Math.round(r * cumCap);
    const q = cible - deja;
    deja = cible;
    for (let i = 0; i < q && p < ordre.length; i++, p++) {
      numero++;
      affectations.push({ uuid: ordre[p]._uuid, centreUuid: slot.centreUuid, salle: slot.salle, numeroTable: (prefixe || '') + String(numero).padStart(largeur, '0') });
    }
  });
  return { affectations };
}

/* ---------------- Jury, numéros PV, doubles réquisitions ----------------
   Comme dans la SIGEC : un JURY regroupe plusieurs centres de composition ; chaque
   candidat reçoit un numéro PV, numéroté dans son jury (centre, salle, n° de table). */
function exNomJury(centre) { return String((centre && centre.jury) || '').trim() || 'Jury unique'; }
function exNumerosPV(candidats, centres) {
  const parCentre = new Map(centres.map((c) => [c._uuid, c]));
  const groupes = new Map();
  candidats.filter((c) => c.centreUuid && parCentre.has(c.centreUuid)).forEach((c) => {
    const j = exNomJury(parCentre.get(c.centreUuid));
    if (!groupes.has(j)) groupes.set(j, []);
    groupes.get(j).push(c);
  });
  const res = new Map();
  groupes.forEach((liste) => {
    liste.sort((a, b) => String(parCentre.get(a.centreUuid).nom).localeCompare(String(parCentre.get(b.centreUuid).nom), 'fr')
      || String(a.salle).localeCompare(String(b.salle), 'fr', { numeric: true })
      || String(a.numeroTable).localeCompare(String(b.numeroTable)) || exCmpNom(a, b));
    const w = Math.max(3, String(liste.length).length);
    liste.forEach((c, i) => res.set(c._uuid, String(i + 1).padStart(w, '0')));
  });
  return res;
}
const exSansAccent = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/* Une même personne enregistrée plusieurs fois dans la session = double réquisition à vérifier */
function exDoublesRequisitions(jurys) {
  const m = new Map();
  jurys.forEach((j) => { const k = exSansAccent(`${j.nom} ${j.prenom}`); if (!k.trim()) return; if (!m.has(k)) m.set(k, []); m.get(k).push(j); });
  return [...m.values()].filter((l) => l.length > 1);
}

/* ---------------- Codes d'anonymat uniques ---------------- */
function exGenererAnonymats(candidats, existants) {
  // existants : codes déjà attribués (Set) à ne jamais réutiliser quand on complète une liste
  const n = candidats.length + (existants ? existants.size : 0);
  const chiffres = n * 2 <= 9000 ? 4 : 5;
  const base = Math.pow(10, chiffres - 1), etendue = 9 * base;
  const utilises = new Set(existants || []), res = new Map();
  candidats.forEach((c) => {
    let code;
    do { code = String(base + exAleaInt(etendue)); } while (utilises.has(code));
    utilises.add(code);
    res.set(c._uuid, code);
  });
  return res;
}

/* ---------------- Note finale d'une copie ----------------
   etat : vide | incomplet | ecart | ok | absent | fraude
   Simple correction : n1.  Double correction : moyenne de n1 et n2 ;
   si l'écart dépasse la tolérance (points sur 20, ramenée au barème), une 3e
   correction n3 (arbitrage) est exigée et devient la note finale. */
function exNoteFinale(note, ep, session) {
  if (!note) return { valeur: null, etat: 'vide' };
  if (note.fraude) return { valeur: 0, etat: 'fraude' };
  if (note.absent) return { valeur: null, etat: 'absent' };
  const n1 = exNum(note.n1), n2 = exNum(note.n2), n3 = exNum(note.n3);
  if (n3 !== null) return { valeur: n3, etat: 'ok', arbitre: true };
  if (session && session.doubleCorrection) {
    if (n1 === null && n2 === null) return { valeur: null, etat: 'vide' };
    if (n1 === null || n2 === null) return { valeur: null, etat: 'incomplet' };
    const bareme = Number(ep && ep.bareme) || 20;
    const tol = (exNum(session.toleranceEcart) ?? 3) * bareme / 20;
    const ecart = Math.abs(n1 - n2);
    if (ecart > tol + 1e-9) return { valeur: null, etat: 'ecart', ecart };
    return { valeur: (n1 + n2) / 2, etat: 'ok', ecart };
  }
  return n1 === null ? { valeur: null, etat: 'vide' } : { valeur: n1, etat: 'ok' };
}

function exMention(moyenne, mentions) {
  let res = '';
  [...(mentions || [])].sort((a, b) => Number(a.min) - Number(b.min)).forEach((m) => { if (moyenne + 1e-9 >= Number(m.min)) res = m.label; });
  return res;
}

/* ---------------- Résultats complets d'une session ---------------- */
function exCalculerResultats(session, candidats, notes) {
  const eps = session.epreuves || [];
  const idx = new Map();
  notes.forEach((n) => idx.set(`${n.epreuveCode}|${n.anonymat}`, n));
  const somCoef = eps.reduce((s, e) => s + (Number(e.coef) || 0), 0) || 1;
  const seuilBrut = exNum(session.seuilAdmission);
  const seuil = seuilBrut === null ? 10 : seuilBrut;
  const elim = exNum(session.noteEliminatoire) || 0;

  const lignes = candidats.map((c) => {
    const details = eps.map((ep) => {
      const note = c.anonymat ? idx.get(`${ep.code}|${c.anonymat}`) : null;
      const f = exNoteFinale(note, ep, session);
      const bareme = Number(ep.bareme) || 20;
      return { code: ep.code, ...f, sur20: f.valeur === null ? null : f.valeur / bareme * 20 };
    });
    let calc, motif = '', moyenne = null, points = null;
    if (c.statut === 'absent') { calc = 'absent'; motif = "Absent à l'examen"; }
    else if (c.statut === 'exclu') { calc = 'exclu'; motif = 'Exclu (fraude)'; }
    else if (!eps.length) { calc = 'en_attente'; motif = 'Aucune épreuve définie'; }
    else if (details.some((d) => d.etat === 'absent')) { calc = 'absent'; motif = 'Absent à une épreuve'; }
    else if (details.some((d) => ['vide', 'incomplet', 'ecart'].includes(d.etat))) {
      calc = 'en_attente';
      motif = details.some((d) => d.etat === 'ecart') ? 'Écart à arbitrer (3e correction)' : 'Notes incomplètes';
    } else {
      points = details.reduce((s, d, i) => s + d.sur20 * (Number(eps[i].coef) || 0), 0);
      moyenne = exArrondi(points / somCoef, 2);
      if (elim > 0 && details.some((d) => d.sur20 < elim - 1e-9)) { calc = 'ajourne'; motif = 'Note éliminatoire'; }
      else calc = moyenne + 1e-9 >= seuil ? 'admis' : 'ajourne';
    }
    let decision = calc, repeche = false;
    if (['admis', 'ajourne'].includes(calc) && ['admis', 'ajourne'].includes(c.decisionManuelle) && c.decisionManuelle !== calc) {
      decision = c.decisionManuelle;
      repeche = decision === 'admis';
      motif = c.motifDecision || (repeche ? 'Repêché par le jury' : 'Ajourné par le jury');
    }
    return {
      candidat: c, details, points, moyenne, calc, decision, repeche, motif,
      mention: decision === 'admis' && !repeche && moyenne !== null ? exMention(moyenne, session.mentions) : '',
      rang: null
    };
  });

  const classables = lignes.filter((l) => l.moyenne !== null && ['admis', 'ajourne'].includes(l.decision)).sort((a, b) => b.moyenne - a.moyenne);
  classables.forEach((l, i) => { l.rang = i > 0 && l.moyenne === classables[i - 1].moyenne ? classables[i - 1].rang : i + 1; });
  return { lignes, stats: exStats(lignes, session), seuil };
}

function exCompte(ls) {
  const absents = ls.filter((l) => l.decision === 'absent').length;
  const presents = ls.length - absents;
  const admis = ls.filter((l) => l.decision === 'admis').length;
  return {
    inscrits: ls.length, absents, presents, admis,
    ajournes: ls.filter((l) => l.decision === 'ajourne').length,
    exclus: ls.filter((l) => l.decision === 'exclu').length,
    attente: ls.filter((l) => l.decision === 'en_attente').length,
    taux: presents ? admis / presents * 100 : null
  };
}
function exGrouper(lignes, cle) {
  const m = new Map();
  lignes.forEach((l) => { const k = cle(l) || '—'; if (!m.has(k)) m.set(k, []); m.get(k).push(l); });
  return [...m.entries()].map(([k, ls]) => ({ cle: k, ...exCompte(ls) })).sort((a, b) => String(a.cle).localeCompare(String(b.cle), 'fr'));
}
function exStats(lignes, session) {
  const eps = session.epreuves || [];
  const avecMoy = lignes.filter((l) => l.moyenne !== null && l.decision !== 'absent');
  return {
    global: exCompte(lignes),
    garcons: exCompte(lignes.filter((l) => l.candidat.sexe !== 'F')),
    filles: exCompte(lignes.filter((l) => l.candidat.sexe === 'F')),
    handicap: exCompte(lignes.filter((l) => l.candidat.handicap)),
    bilingues: exCompte(lignes.filter((l) => l.candidat.bilingue)),
    parEcole: exGrouper(lignes, (l) => l.candidat.ecole),
    parCentre: exGrouper(lignes, (l) => l.candidat.centreUuid),
    moyenneGenerale: avecMoy.length ? avecMoy.reduce((s, l) => s + l.moyenne, 0) / avecMoy.length : null,
    parEpreuve: eps.map((ep, i) => {
      const v = lignes.map((l) => l.details[i].sur20).filter((x) => x !== null);
      return { code: ep.code, nom: ep.nom, moyenne: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null, nb: v.length };
    }),
    parMention: (session.mentions || []).map((m) => ({ label: m.label, nb: lignes.filter((l) => l.mention === m.label).length }))
  };
}
