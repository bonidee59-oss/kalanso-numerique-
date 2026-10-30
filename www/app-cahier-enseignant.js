/* ============================================================
   app-cahier-enseignant.js — Cahier de bord de l'enseignant (NOUVEAU MODULE)
   ------------------------------------------------------------
   Reprend le document officiel « Cahier de bord de l'enseignant »
   (identification, effectifs, matériel, mobilier, plan d'amélioration
   de la classe, suivi PAI/PAC, feuilles de notes). Utilise le moteur
   de app-cahier-bord.js ; un enregistrement par enseignant, par onglet
   et par année scolaire dans le magasin 'cahierEnseignant'.
   ============================================================ */

const CE_PROF = ['Cultivateurs', 'Éleveurs', 'Fonctionnaires', 'Militaires', 'Commerçants', 'Retraités', 'Autres', 'EDI', 'HP', 'HV', 'HA'];
const CE_AGES = ['5 ans', '6 ans', '7 ans', '8 ans', '9 ans', '10 ans', '11 ans', '12 ans', '13 ans', '14 ans', '15 ans', '15 ans et +'];
const CE_MAT = [['Livres guides', 'Lecture / Exp. orale'], ['', 'Calcul'], ['', 'SVT / Exo. sens'], ['', 'Histoire'], ['', 'Géographie'],
  ['Livres d\'élèves', 'Lecture'], ['', 'Calcul'], ['', 'SVT'], ['', 'Histoire'], ['', 'Géographie'],
  ['Matériel de calcul', 'Règle plate'], ['', 'Équerre'], ['', 'Compas'], ['', 'Rapporteur']].map(([genre, des]) => ({ genre, des }));
const CE_ECART = cbC('ecart', 'Écart observé', { auto: (r) => ((r.pa === undefined || r.pa === '' || r.pv === undefined || r.pv === '') ? '' : cbNum(r.pa) - cbNum(r.pv)) });
const CE_PROBLEMES = [['pPrep', 'La préparation des leçons'], ['pMat', 'La disponibilité du matériel didactique'], ['pOrg', 'L\'organisation de la classe'],
  ['pEns', 'L\'enseignement des disciplines'], ['pEcr', 'Les travaux écrits'], ['pCah', 'Les cahiers de leçons']];

const CE_TABS = [
  { id: 'e_ident', titre: 'Identification', act: 'Remplir depuis l\'application', blocs: [
    { t: 'champs', champs: [['matricule', 'N° matricule'], ['nom', 'Nom et prénom(s)'], ['sexe', 'Sexe', ['M', 'F']], ['grade', 'Grade'], ['classe', 'Classe tenue'], ['tacheSec', 'Tâche secondaire'],
      ['ancG', 'Ancienneté générale'], ['ancCorps', 'Ancienneté dans le corps'], ['ancPoste', 'Ancienneté dans le poste']] },
    cbT('Ehier', 'Identification de la hiérarchie', [cbC('q', 'Qualification', { fixe: 1 }), cbC('nom', 'Nom et prénom(s)'), cbC('contact', 'Contacts')],
      { init: [{ q: 'D.E' }, { q: 'CCEB' }, { q: 'IEPENF responsable de la zone d\'encadrement' }], fixe: 1 }),
    cbG('Eeff', 'Effectif des élèves', ['Effectif'], ['Effectif en début d\'année', 'Dont redoublant(e)s', 'Effectif en fin d\'année'], CB_GFT, { auto: 1, lab: '' }) ] },
  { id: 'e_eleves', titre: 'Répartition des élèves', act: 'Calculer les âges depuis les élèves', blocs: [
    cbG('Eprof', 'Répartition des élèves selon la profession du père', ['Garçons (G)', 'Filles (F)'], CE_PROF, [''], { totalRow: 1, lab: 'Sexe' }),
    cbG('Eages', 'Répartition des élèves selon l\'âge et le sexe', ['Garçons (G)', 'Filles (F)'], CE_AGES, [''], { totalRow: 1, lab: 'Sexe' }),
    cbT('Eresp', 'Responsabilisation des élèves', [cbC('x', 'Identification', { fixe: 1 }), cbC('chef', 'Chef de classe'), cbC('adj', 'Chef adjoint'), cbC('hyg', 'Responsable à l\'hygiène')],
      { init: [{ x: 'Nom' }, { x: 'Prénom(s)' }], fixe: 1 }) ] },
  { id: 'e_materiel', titre: 'Matériel & mobilier', blocs: [
    cbT('Emat', 'Situation des manuels et du matériel didactique en classe', [cbC('genre', 'Genre'), cbC('des', 'Désignation'), cbC('qte', 'Quantité', { type: 'number' }), cbC('bon', 'État : bon', { type: 'number' }), cbC('mauv', 'État : mauvais', { type: 'number' }), cbC('obs', 'Observations')], { init: CE_MAT }),
    cbG('Emob', 'Mobilier scolaire en classe', ['Bon(s)', 'Passable(s)', 'Mauvais'], ['Tables-bancs', 'Bureaux', 'Chaises', 'Armoires', 'Tableaux d\'affichage', 'Autres (préciser)'], [''], { totalRow: 1, lab: 'État' }) ] },
  { id: 'e_pai', titre: 'Plan d\'amélioration', blocs: [
    { t: 'champs', champs: [['dreppnf', 'DREPPNF'], ['dpepnf', 'DPEPPNF'], ['ceb', 'CEB'], ['commune', 'Commune'], ['encadreur', 'Nom et prénom de l\'encadreur'],
      ['statut', 'École', ['Publique', 'Privée']], ['classe', 'Classe'], ['eff', 'Effectif', 'number'], ['effG', 'dont garçons', 'number'], ['effF', 'dont filles', 'number'],
      ['nom', 'Nom et prénom de l\'enseignant'], ['grade', 'Grade'], ['anc', 'Ancienneté']] },
    cbT('Eres', 'Résultats des élèves dans les différentes matières (évaluation diagnostique ou, à défaut, propositions de fin d\'année)', [cbC('d1', 'Disciplines'), cbC('p1', '%', { type: 'number' }), cbC('d2', 'Disciplines'), cbC('p2', '%', { type: 'number' })], { n: 7 }),
    ...CE_PROBLEMES.map(([k, l]) => cbTxt(k, 'Principaux problèmes rencontrés — ' + l)),
    cbT('Eins', 'Analyse des données recueillies (disciplines à faible taux)', [cbC('ins', 'Insuffisances'), cbC('cau', 'Causes')], { n: 3 }),
    cbTxt('Easp', 'Aspect à améliorer en priorité en vue de l\'amélioration des résultats des élèves'),
    cbT('Epb', 'Analyse du problème', [cbC('pb', 'Problème'), cbC('man', 'Manifestations'), cbC('cau', 'Causes')], { n: 5 }),
    { t: 'champs', champs: [['objDisc', 'Objectif général : améliorer les résultats en (discipline)'], ['objDe', 'de (%)', 'number'], ['objA', 'à (%)', 'number']] },
    cbT('Eplan', 'Plan d\'amélioration', [cbC('obj', 'Objectifs spécifiques'), cbC('act', 'Activités'), cbC('cal', 'Calendrier d\'exécution'), cbC('ind', 'Indicateurs de progrès'), cbC('met', 'Méthodes de collecte de données')], { n: 8 }),
    cbT('Esout', 'Soutien', [cbC('p', 'Personnes ressources', { fixe: 1 }), cbC('nat', 'Nature de l\'appui / conseil'), cbC('per', 'Période souhaitée')],
      { init: [{ p: 'Encadreurs' }, { p: 'Directeur d\'école' }, { p: 'Collègues' }, { p: 'Autres' }], fixe: 1 }) ] },
  { id: 'e_suivi', titre: 'Suivi du PAI / PAC', blocs: [0, 1, 2].flatMap((i) => [
    cbT('Esuivi' + i, `Tableau de suivi du PAI et du PAC : ${CB_SUIVI[i]} trimestre`, [cbC('disc', 'Discipline'), cbC('pd', '% début'), cbC('pv', '% visé'), cbC('ech', 'Échéance'), cbC('pa', '% atteint'), CE_ECART, cbC('obs', 'Observations : raisons ou causes')], { n: 4 }),
    cbT('Emens' + i, 'Tableau de suivi mensuel du PAI', [cbC('per', 'Période'), cbC('act', 'Activités'), cbC('td', 'Taux de départ'), cbC('ta', 'Taux atteint'), cbC('obs', 'Observations')], { n: 4 }),
    cbTxt('Esol' + i, 'Solutions préconisées'), cbTxt('Eexp' + i, 'Expériences à partager') ]) },
  { id: 'e_notes', titre: 'Feuilles de notes', blocs: [
    cbT('Enotes', 'Feuilles de notes', [cbC('date', 'Date', { type: 'date' }), cbC('evt', 'Événements', { type: 'area' }), cbC('obs', 'Observations', { type: 'area' })], { n: 14 }) ] }
];
CE_TABS.forEach((t) => t.blocs.forEach((b) => { if (b.k) CB_BLOCS[b.k] = b; }));

/* ---------------- Remplissages automatiques ---------------- */
async function ceClasse(cfg) {
  const e = cfg.ensRec || {};
  const classes = await DB.getAll('classes');
  const classe = classes.find((c) => c.id === e.classeId) || classesDeEnseignant(e, classes)[0] || null;
  return { e, classe };
}
CB_ACT.e_ident = async (d, cfg) => {
  const { e, classe } = await ceClasse(cfg);
  if (!d.nom) d.nom = `${e.nom || ''} ${e.prenom || ''}`.trim();
  if (!d.matricule && e.matricule) d.matricule = e.matricule;
  if (!d.sexe && (e.sexe === 'M' || e.sexe === 'F')) d.sexe = e.sexe;
  if (classe) {
    d.classe = classe.nom;
    const actifs = (await DB.getAll('eleves')).filter((x) => x.classeId === classe.id && (x.statut || 'actif') === 'actif');
    d.Eeff = { c: { ...((d.Eeff || {}).c || {}), '0|2|0': actifs.filter((x) => x.sexe !== 'F').length, '0|2|1': actifs.filter((x) => x.sexe === 'F').length } };
  }
};
CB_ACT.e_eleves = async (d, cfg) => {
  const { classe } = await ceClasse(cfg);
  if (!classe) { toast('Aucune classe n\'est rattachée à cet enseignant (voir « Enseignants » ou « Classes »).'); return false; }
  if (Object.keys((d.Eages || {}).c || {}).length && !(await confirmDialog('Remplacer le tableau « âge et sexe » par le calcul à partir des élèves ?'))) return false;
  const c = {}; let ignores = 0;
  (await DB.getAll('eleves')).filter((x) => x.classeId === classe.id && (x.statut || 'actif') === 'actif').forEach((x) => {
    const age = calcAge(x.dateNaissance);
    if (age === '—') { ignores++; return; }
    const g = age >= 16 ? 11 : Math.min(Math.max(age, 5), 15) - 5;
    const key = `${x.sexe === 'F' ? 1 : 0}|${g}|0`;
    c[key] = (c[key] || 0) + 1;
  });
  d.Eages = { c };
  if (ignores) toast(`${ignores} élève(s) ignoré(s) (date de naissance manquante).`);
};

/* ---------------- Page : choix de l'enseignant puis cahier ---------------- */
ROUTES['#/cahier-enseignant'] = async (root) => {
  const tous = await DB.getAll('enseignants');
  const liste = currentUser.role === 'enseignant' ? tous.filter((e) => e.id === currentUser.enseignantDossierId) : tous;
  if (!liste.length) {
    root.innerHTML = '<div class="alert alert-terre">Aucun dossier enseignant n\'est rattaché à votre compte. Demandez au directeur de relier votre compte à votre fiche dans « Enseignants ».</div>';
    return;
  }
  liste.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  root.innerHTML = `<div class="field" style="max-width:380px;margin-bottom:14px;"><label>Enseignant</label>
    <select id="ce-ens">${liste.map((e) => `<option value="${e.id}">${esc(e.nom)} ${esc(e.prenom)}</option>`).join('')}</select></div><div id="ce-page"></div>`;
  const ouvrir = async () => {
    const e = liste.find((x) => x.id === Number($('#ce-ens').value));
    if (!e._uuid) { e._uuid = genUuid(); await DB.put('enseignants', e); } // identifiant de synchro stable entre appareils
    await cbPage($('#ce-page'), { tabs: CE_TABS, store: 'cahierEnseignant', titre: `Cahier de bord de l'enseignant — ${e.nom} ${e.prenom}`, ens: e._uuid, ensRec: e });
  };
  $('#ce-ens').onchange = ouvrir;
  await ouvrir();
};
