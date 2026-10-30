/* ============================================================
   app-cahier-sync.js — Synchronisation des cahiers de bord avec les
   données déjà saisies dans l'application (NOUVEAU MODULE)
   ------------------------------------------------------------
   Remplace les remplissages automatiques de app-cahier-bord.js et
   app-cahier-enseignant.js (même mécanisme CB_ACT) :
   - à la première ouverture d'un onglet jamais enregistré, il est rempli
     automatiquement (sans question) ;
   - ensuite, le bouton « Synchroniser avec l'application » recalcule les
     données dérivées (avec confirmation si des valeurs existent déjà).
   Chaque action reçoit (d, cfg, auto) ; auto = true : aucune boîte de dialogue.
   Sources : élèves, classes, enseignants, patrimoine, évaluations,
   visites, réunions, calendrier scolaire.
   ============================================================ */

const csNorm = (n) => String(n || '').toUpperCase().replace(/\s/g, '');
const csSexe = (e) => (e.sexe === 'F' ? 1 : 0);

/* Contexte commun : classes / élèves de l'année en cours, helpers de classement */
async function csCtx(cfg) {
  const [classes, eleves, ens] = await Promise.all([DB.getAll('classes'), DB.getAll('eleves'), DB.getAll('enseignants')]);
  const y0 = Number(String(cfg.annee).split('-')[0]);
  const niv = new Map(classes.map((c) => [c.id, CB_CLS.indexOf(csNorm(c.niveau)) >= 0 ? CB_CLS.indexOf(csNorm(c.niveau)) : CB_CLS.indexOf(csNorm(c.nom))]));
  const prev = `${y0 - 1}-${y0}`;
  return {
    classes, eleves, ens, y0,
    debut: `${y0}-09-01`, fin: `${y0 + 1}-08-31`,
    idx: (classeId) => (niv.has(classeId) ? niv.get(classeId) : -1),
    actifs: eleves.filter((e) => (e.statut || 'actif') === 'actif'),
    /* redoublant = a redoublé dans la même classe l'année précédente (historique de passage) */
    redoublant: (e) => (e.historiqueClasses || []).some((h) => h.anneeScolaire === prev && h.decision === 'redouble' && h.classeId === e.classeId)
  };
}

/* Profession du père (texte libre) → catégorie du cahier */
function csProfession(txt) {
  const t = String(txt || '').toLowerCase();
  if (!t.trim()) return null;
  const regles = [
    ['Cultivateurs', /cultiv|agricul|paysan|exploitant/], ['Éleveurs', /éleve|eleve(?!s)|pasteur|bouvier/],
    ['Retraités', /retrait/], ['Militaires', /militaire|gendarme|policier|soldat|garde forestier|douanier/],
    ['Fonctionnaires', /fonctionnaire|enseignant|instituteur|infirmier|agent de l|agent d.état|magistrat|médecin|medecin/],
    ['Commerçants', /commer|vendeur|boutiqu|marchand|revendeur/], ['Artisans', /artisan|tailleur|forgeron|menuis|soudeur|couturier|tisserand|potier/],
    ['Ouvriers', /ouvrier|maçon|macon|mécanicien|mecanicien|chauffeur|manœuvre|manoeuvre|plombier|électricien/]
  ];
  const r = regles.find(([, re]) => re.test(t));
  return r ? r[0] : 'Autres';
}
function csSituation(txt) {
  const t = String(txt || '').toLowerCase(), r = [];
  if (/déplac|deplac|\bedi\b/.test(t)) r.push('EDI');
  if (/handicap.*phys|phys.*handicap|moteur/.test(t)) r.push('HP');
  if (/visuel|aveugle|malvoyant/.test(t)) r.push('HV');
  if (/auditif|sourd|malentendant/.test(t)) r.push('HA');
  return r;
}
const csAdd = (c, key) => { c[key] = (c[key] || 0) + 1; };

/* Répartition par profession du père : liste = catégories en colonnes (grille ligne = sexe) ou en lignes (grille classes) */
function csProfessions(eleves, liste, cle) {
  const c = {}; let sans = 0;
  eleves.forEach((e) => {
    const p = csProfession(e.professionParents);
    if (p) { const i = liste.indexOf(p) >= 0 ? liste.indexOf(p) : liste.indexOf('Autres'); csAdd(c, cle(e, i)); } else sans++;
    csSituation(e.situationParticuliere).forEach((s) => { if (liste.indexOf(s) >= 0) csAdd(c, cle(e, liste.indexOf(s))); });
  });
  return { c, sans };
}
function csAge(e) { const a = calcAge(e.dateNaissance); return a === '—' ? null : a; }

/* Fusionne des lignes de journal (date / événement / observations) sans doublon, triées par date */
function csJournal(rows, items, min) {
  const garde = rows.filter((r) => r.date || r.evt || r.obs);
  const vus = new Set(garde.map((r) => `${r.date}|${r.evt}`));
  items.forEach((it) => { if (!vus.has(`${it.date}|${it.evt}`)) { vus.add(`${it.date}|${it.evt}`); garde.push(it); } });
  garde.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
  while (garde.length < min) garde.push({});
  return garde;
}
async function csVisitesReunions(ctx, avecReunions) {
  const [visites, reunions] = await Promise.all([DB.getAll('visites'), avecReunions ? DB.getAll('reunions') : []]);
  const dansAnnee = (r) => r.date && r.date >= ctx.debut && r.date <= ctx.fin;
  return [
    ...visites.filter(dansAnnee).map((v) => ({ date: v.date, evt: `Visite d'encadrement (${v.type || 'autre'}${v.inspecteur ? ' — ' + v.inspecteur : ''})`,
      obs: [v.observations, v.recommandations && 'Recommandations : ' + v.recommandations].filter(Boolean).join(' — ') })),
    ...reunions.filter(dansAnnee).map((r) => ({ date: r.date, evt: `Réunion — ${r.sujet || r.type || ''}`, obs: r.decisions || '' }))
  ];
}
function csEncadreur(visites, type) {
  const v = visites.filter((x) => x.inspecteur && (x.type || '').toUpperCase() === type).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return v ? v.inspecteur : '';
}

/* ======================= Cahier du directeur ======================= */
CB_ACT.ident = async (d, cfg) => {
  const [metaAll, ctx] = await Promise.all([DB.getAll('meta'), csCtx(cfg)]);
  const meta = metaAll[0] || {};
  if (!d.nom && meta.nomDirecteur) d.nom = meta.nomDirecteur;
  if (!d.ecole && meta.nomEcole) d.ecole = meta.nomEcole;
  if (!d.fonction) d.fonction = 'Directeur';
  d.nbClasses = ctx.classes.length;
  d.effG = ctx.actifs.filter((e) => !csSexe(e)).length;
  d.effF = ctx.actifs.filter(csSexe).length;
};

CB_ACT.personnel = async (d, cfg) => {
  const ctx = await csCtx(cfg);
  const cn = Object.fromEntries(ctx.classes.map((c) => [c.id, c.nom]));
  const rows = cbRows(CB_BLOCS.pers, d).filter((r) => r.nom || r.matricule);
  ctx.ens.forEach((e) => {
    const nom = `${e.nom || ''} ${e.prenom || ''}`.trim();
    const ligne = rows.find((r) => (e.matricule && r.matricule === e.matricule) || r.nom === nom);
    const classe = cn[e.classeId] || classesDeEnseignant(e, ctx.classes).map((c) => c.nom).join(' / ');
    if (ligne) { if (!ligne.classe && classe) ligne.classe = classe; return; }
    rows.push({ matricule: e.matricule || '', nom, fonction: e.fonction || '', classe });
  });
  while (rows.length < 15) rows.push({});
  d.pers = rows;
};

CB_ACT.eleves = async (d, cfg, auto) => {
  if (!auto && (Object.keys((d.ages || {}).c || {}).length || Object.keys((d.prof || {}).c || {}).length)
    && !(await confirmDialog('Remplacer les tableaux « profession du père » et « âges et sexes » par le calcul à partir des élèves ?'))) return false;
  const ctx = await csCtx(cfg);
  const els = ctx.actifs.filter((e) => ctx.idx(e.classeId) >= 0);
  const p = csProfessions(els, CB_PROF, (e, i) => `${i}|${ctx.idx(e.classeId)}|${csSexe(e)}`);
  const ages = {}; let sansDate = 0;
  els.forEach((e) => { const a = csAge(e); if (a === null) { sansDate++; return; } csAdd(ages, `${Math.min(Math.max(a, 5), 15) - 5}|${ctx.idx(e.classeId)}|${csSexe(e)}`); });
  d.prof = { c: p.c }; d.ages = { c: ages };
  if (!auto && (p.sans || sansDate)) toast(`${p.sans} élève(s) sans profession et ${sansDate} sans date de naissance ne sont pas comptés.`);
};

CB_ACT.patrimoine = async (d) => {
  const [eq, infra] = await Promise.all([DB.getAll('patrimoineClasse'), DB.getAll('patrimoineInfra')]);
  const mob = { ...((d.mob || {}).c || {}) };
  mob['0|0|0'] = eq.reduce((t, r) => t + (Number(r.tablesBancsBon) || 0), 0);
  mob['0|0|1'] = eq.reduce((t, r) => t + (Number(r.tablesBancsMauvais) || 0), 0);
  d.mob = { ...(d.mob || {}), c: mob };
  const types = { 'Salle de classe': 0, Logement: 1, Cuisine: 2, Toilettes: 3 };
  const imm = { ...((d.imm || {}).c || {}) };
  Object.values(types).forEach((i) => { imm[`${i}|0|0`] = 0; imm[`${i}|0|1`] = 0; });
  infra.forEach((r) => { const i = types[r.type]; if (i !== undefined) imm[`${i}|0|${r.etat === 'mauvais' ? 1 : 0}`] += Number(r.nombre) || 0; }); // « moyen » compté en B
  d.imm = { ...(d.imm || {}), c: imm };
};

CB_ACT.plans = async (d, cfg) => {
  const ctx = await csCtx(cfg);
  cbRows(CB_BLOCS.pai, d).forEach((r) => { const i = CB_CLS.indexOf(csNorm(r.classe)); r.eff = String(ctx.actifs.filter((e) => ctx.idx(e.classeId) === i).length); });
};

CB_ACT.notes = async (d, cfg) => {
  const ctx = await csCtx(cfg);
  d.notes = csJournal(cbRows(CB_BLOCS.notes, d), await csVisitesReunions(ctx, true), 12);
};

CB_ACT.programme = async (d, cfg) => {
  const ctx = await csCtx(cfg);
  const acts = (await DB.getAll('activites')).filter((a) => a.date && a.date >= ctx.debut && a.date <= ctx.fin).sort((a, b) => a.date.localeCompare(b.date));
  const rows = cbRows(CB_BLOCS.prog, d).filter((r) => r.act || r.obj);
  const vus = new Set(rows.map((r) => `${r.act}|${r.ech}`));
  acts.forEach((a) => {
    const act = a.titre + (a.categorie ? ` (${a.categorie})` : ''), ech = formatDate(a.date);
    if (!vus.has(`${act}|${ech}`)) rows.push({ act, ech, obj: a.description || '' });
  });
  rows.forEach((r, i) => { if (!r.n) r.n = String(i + 1); });
  while (rows.length < 9) rows.push({});
  d.prog = rows;
};

CB_ACT.bilan = async (d, cfg, auto) => {
  if (!auto && !(await confirmDialog('Synchroniser « Effectif fin », « Promus », « Abandons », « Départs » et « Redoublants » avec les élèves ? Les valeurs saisies dans ces colonnes seront remplacées.'))) return false;
  const ctx = await csCtx(cfg);
  const c = { ...((d.bil || {}).c || {}) };
  for (let i = 0; i < 6; i++) [1, 2, 3, 6, 7].forEach((g) => { c[`${i}|${g}|0`] = 0; c[`${i}|${g}|1`] = 0; });
  const col = { actif: 1, abandon: 3, transfere: 6 };
  ctx.eleves.forEach((e) => {
    const i = ctx.idx(e.classeId), g = col[e.statut || 'actif'];
    if (i >= 0 && g !== undefined) csAdd(c, `${i}|${g}|${csSexe(e)}`);
    if (i >= 0 && g === 1 && ctx.redoublant(e)) csAdd(c, `${i}|7|${csSexe(e)}`);
    (e.historiqueClasses || []).filter((h) => h.anneeScolaire === cfg.annee && h.decision === 'admis').forEach((h) => {
      const j = ctx.idx(h.classeId); if (j >= 0) csAdd(c, `${j}|2|${csSexe(e)}`);
    });
  });
  d.bil = { ...(d.bil || {}), c };
};

/* ======================= Cahier de l'enseignant ======================= */
async function csEns(cfg) {
  const ctx = await csCtx(cfg);
  const e = cfg.ensRec || {};
  const classe = ctx.classes.find((c) => c.id === e.classeId) || classesDeEnseignant(e, ctx.classes)[0] || null;
  const elevesClasse = classe ? ctx.actifs.filter((x) => x.classeId === classe.id) : [];
  return { ctx, e, classe, elevesClasse };
}
function csAnciennete(date) {
  if (!date) return '';
  const n = Math.floor((Date.now() - new Date(date).getTime()) / (365.25 * 864e5));
  return n >= 0 ? `${n} an${n > 1 ? 's' : ''}` : '';
}

CB_ACT.e_ident = async (d, cfg) => {
  const { ctx, e, classe, elevesClasse } = await csEns(cfg);
  d.nom = `${e.nom || ''} ${e.prenom || ''}`.trim() || d.nom;
  if (e.matricule) d.matricule = e.matricule;
  if (e.datePriseService) d.ancPoste = csAnciennete(e.datePriseService);
  if (classe) {
    d.classe = classe.nom;
    const c = { ...((d.Eeff || {}).c || {}) };
    c['0|2|0'] = elevesClasse.filter((x) => !csSexe(x)).length; c['0|2|1'] = elevesClasse.filter(csSexe).length;
    const red = elevesClasse.filter(ctx.redoublant);
    c['0|1|0'] = red.filter((x) => !csSexe(x)).length; c['0|1|1'] = red.filter(csSexe).length;
    d.Eeff = { ...(d.Eeff || {}), c };
  }
  const visites = await DB.getAll('visites');
  const h = cbRows(CB_BLOCS.Ehier, d);
  if (!h[1].nom) h[1].nom = csEncadreur(visites, 'CCEB');
  if (!h[2].nom) h[2].nom = csEncadreur(visites, 'IEP');
};

CB_ACT.e_eleves = async (d, cfg, auto) => {
  const { classe, elevesClasse } = await csEns(cfg);
  if (!classe) { if (!auto) toast('Aucune classe n\'est rattachée à cet enseignant (voir « Enseignants »).'); return false; }
  if (!auto && (Object.keys((d.Eages || {}).c || {}).length || Object.keys((d.Eprof || {}).c || {}).length)
    && !(await confirmDialog('Remplacer les tableaux « profession du père » et « âge et sexe » par le calcul à partir des élèves de la classe ?'))) return false;
  const p = csProfessions(elevesClasse, CE_PROF, (e, i) => `${csSexe(e)}|${i}|0`);
  const ages = {}; let sansDate = 0;
  elevesClasse.forEach((e) => { const a = csAge(e); if (a === null) { sansDate++; return; } csAdd(ages, `${csSexe(e)}|${a >= 16 ? 11 : Math.min(Math.max(a, 5), 15) - 5}|0`); });
  d.Eprof = { c: p.c }; d.Eages = { c: ages };
  if (!auto && (p.sans || sansDate)) toast(`${p.sans} élève(s) sans profession et ${sansDate} sans date de naissance ne sont pas comptés.`);
};

CB_ACT.e_materiel = async (d, cfg) => {
  const { classe } = await csEns(cfg);
  if (!classe) return false;
  const eq = (await DB.getAll('patrimoineClasse')).find((r) => r.classeId === classe.id);
  if (!eq) return false;
  d.Emob = { ...(d.Emob || {}), c: { ...((d.Emob || {}).c || {}), '0|0|0': Number(eq.tablesBancsBon) || 0, '2|0|0': Number(eq.tablesBancsMauvais) || 0 } };
};

CB_ACT.e_pai = async (d, cfg) => {
  const { ctx, e, classe, elevesClasse } = await csEns(cfg);
  d.nom = `${e.nom || ''} ${e.prenom || ''}`.trim() || d.nom;
  if (e.datePriseService) d.anc = csAnciennete(e.datePriseService);
  const visites = await DB.getAll('visites');
  if (!d.encadreur) d.encadreur = csEncadreur(visites, 'IEP') || csEncadreur(visites, 'CCEB');
  if (!classe) return;
  d.classe = classe.nom; d.eff = elevesClasse.length;
  d.effG = elevesClasse.filter((x) => !csSexe(x)).length; d.effF = elevesClasse.filter(csSexe).length;
  /* Résultats par discipline : % de notes ≥ seuil dans les évaluations de la classe pour l'année */
  const stats = {};
  (await DB.getAll('evaluations')).filter((ev) => ev.classeId === classe.id && (ev.anneeScolaire || cfg.annee) === cfg.annee).forEach((ev) => {
    (ev.notes || []).forEach((n) => {
      const v = noteSur20(ev, n); if (v === null) return;
      const m = (ev.matieresEval || []).find((x) => x.matiereId === n.matiereId);
      const nom = m ? m.nom : (ev.nom || 'Discipline');
      const s = (stats[nom] = stats[nom] || { t: 0, r: 0 });
      s.t++; if (v >= SEUIL_MOYENNE) s.r++;
    });
  });
  const disc = Object.entries(stats).map(([nom, s]) => ({ nom, pct: Math.round((s.r / s.t) * 100) }));
  if (!disc.length) return;
  const rows = cbRows(CB_BLOCS.Eres, d);
  while (rows.length < Math.ceil(disc.length / 2)) rows.push({});
  rows.forEach((r) => { r.d1 = r.p1 = r.d2 = r.p2 = ''; });
  disc.forEach((x, j) => { const r = rows[Math.floor(j / 2)], k = j % 2 + 1; r['d' + k] = x.nom; r['p' + k] = x.pct; });
  const faibles = disc.filter((x) => x.pct < 50).sort((a, b) => a.pct - b.pct);
  const ins = cbRows(CB_BLOCS.Eins, d);
  faibles.slice(0, ins.length).forEach((x, j) => { if (!ins[j].ins) ins[j].ins = `${x.nom} (${x.pct} % de réussite)`; });
  if (faibles.length && !d.objDisc) { d.objDisc = faibles[0].nom; d.objDe = faibles[0].pct; }
};

CB_ACT.e_notes = async (d, cfg) => {
  const { ctx } = await csEns(cfg);
  d.Enotes = csJournal(cbRows(CB_BLOCS.Enotes, d), await csVisitesReunions(ctx, false), 14);
};

/* Libellé unique pour le bouton de chaque onglet synchronisable */
[...CB_TABS, ...CE_TABS].forEach((t) => { if (CB_ACT[t.id]) t.act = 'Synchroniser avec l\'application'; });
