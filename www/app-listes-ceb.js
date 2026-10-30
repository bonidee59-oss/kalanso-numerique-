/* ============================================================
   app-listes-ceb.js — Listes nominatives d'élèves : école → CEB
   ------------------------------------------------------------
   ÉCOLE (#/liste-ceb) — la direction ou le secrétariat prépare la liste de
   ses élèves, la contrôle (anomalies bloquantes / avertissements), puis la
   PUBLIE dans le compte de sa CEB. Chaque publication est une version
   numérotée et non modifiable ; l'école suit ce qu'en fait la CEB
   (reçue, validée, à corriger + remarque).
   CEB (#/listes-ceb) — la CEB voit toutes les écoles de sa circonscription
   (y compris celles qui n'ont rien publié), RÉCUPÈRE les listes dans sa base
   locale (consultables ensuite hors ligne), contrôle leur intégrité, valide
   ou demande une correction, détecte les doublons entre écoles et exporte
   la liste consolidée (CSV) et l'état des effectifs (PDF).
   Tables Supabase : listes_eleves, listes_eleves_suivi (supabase-listes.sql).
   Minimisation des données : ni photo, ni téléphone, ni finances, ni
   discipline ne sont transmis ; les noms des parents seulement si la
   direction coche l'option.
   ============================================================ */

const LC_STATUTS_ELEVE = { actif: 'Actifs', transfere: 'Transférés', abandon: 'Abandons', diplome: 'Diplômés' };
const LC_STATUT_ELEVE_LIB = { actif: 'Actif', transfere: 'Transféré', abandon: 'Abandon', diplome: 'Diplômé' };
const lcLibStatut = (s) => LC_STATUT_ELEVE_LIB[s] || s || '';
const LC_ORDRE_NIVEAUX = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const LC_CLES_CEP_ANCIEN = ['matricule', 'nom', 'prenom', 'sexe', 'dateNaissance', 'lieuNaissance', 'classe', 'examens', 'besoins', 'eleveUuid']; // listes publiées avant les champs handicap/bilingue
const LC_CLES_CEP = [...LC_CLES_CEP_ANCIEN, 'handicap', 'bilingue'];
const LC_TYPE_LIB = { eleves: 'Liste des élèves', cep: 'Candidats au CEP' };
const LC_CLES = ['matricule', 'numeroOrdre', 'nom', 'prenom', 'sexe', 'dateNaissance', 'lieuNaissance', 'classe', 'niveau', 'statut', 'pere', 'mere'];
const LC_ETAT = { statuts: ['actif'], parents: false, filtre: 'tous', recherche: '', annee: '' };
const LC_STATUT_LISTE = {
  attente: { label: 'En attente', badge: 'terre' },
  nouvelle: { label: 'Nouvelle liste', badge: 'ocre' },
  recue: { label: 'Reçue', badge: 'indigo' },
  validee: { label: 'Validée', badge: 'vert' },
  a_corriger: { label: 'À corriger', badge: 'ocre' }
};

/* ---------------- Calculs purs (testables) ---------------- */
const lcNorm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const lcDate = (iso) => formatDate(String(iso || '').slice(0, 10));

function lcRangClasse(classe, niveau) {
  const k = String(niveau || classe || '').toUpperCase().replace(/\s+/g, '');
  const i = LC_ORDRE_NIVEAUX.findIndex((n) => k.startsWith(n));
  return i < 0 ? 99 : i;
}
function lcCmp(a, b) {
  return (lcRangClasse(a.classe, a.niveau) - lcRangClasse(b.classe, b.niveau))
    || String(a.classe || '').localeCompare(String(b.classe || ''), 'fr', { numeric: true })
    || `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr', { sensitivity: 'base' });
}
function lcAge(dob, ref) {
  const d = new Date(dob), n = ref || new Date();
  if (isNaN(d)) return null;
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
}

/* Ligne transmise à la CEB, construite à partir du dossier de l'élève */
function lcLigne(e, classe, avecParents) {
  const l = {
    matricule: String(e.matricule || '').trim(),
    numeroOrdre: e.numeroOrdre ? String(e.numeroOrdre) : '',
    nom: String(e.nom || '').trim(),
    prenom: String(e.prenom || '').trim(),
    sexe: e.sexe === 'F' ? 'F' : (e.sexe === 'M' ? 'M' : ''),
    dateNaissance: e.dateNaissance || '',
    lieuNaissance: String((e.fiche && e.fiche.lieuNaissance) || '').trim(),
    classe: classe ? String(classe.nom || '') : '',
    niveau: String(e.niveau || (classe && classe.niveau) || ''),
    statut: e.statut || 'actif'
  };
  if (avecParents) { l.pere = String(e.pere || '').trim(); l.mere = String(e.mere || '').trim(); }
  return l;
}

/* Contrôles avant publication.
   bloquantes : empêchent la publication ; avertissements : à confirmer. */
function lcControler(lignes, ref) {
  const bloquantes = [], avertissements = [];
  const parMat = new Map(), parIdent = new Map();
  lignes.forEach((l, i) => {
    const nom = `${l.nom} ${l.prenom}`.trim() || `(ligne ${i + 1})`;
    if (!l.nom || !l.prenom) bloquantes.push({ nom, msg: 'Nom ou prénom manquant' });
    if (!l.sexe) bloquantes.push({ nom, msg: 'Sexe non renseigné' });
    if (!l.classe) bloquantes.push({ nom, msg: 'Classe non renseignée' });
    if (!l.dateNaissance) avertissements.push({ nom, msg: 'Date de naissance manquante' });
    else {
      const age = lcAge(l.dateNaissance, ref);
      if (age === null) avertissements.push({ nom, msg: 'Date de naissance invalide' });
      else if (age < 3 || age > 18) avertissements.push({ nom, msg: `Âge inhabituel (${age} ans)` });
    }
    if (!l.matricule) avertissements.push({ nom, msg: 'Matricule non renseigné' });
    else { const k = lcNorm(l.matricule); if (!parMat.has(k)) parMat.set(k, []); parMat.get(k).push(nom); }
    if (l.nom && l.prenom && l.dateNaissance) {
      const k = `${lcNorm(l.nom)}|${lcNorm(l.prenom)}|${l.dateNaissance}`;
      if (!parIdent.has(k)) parIdent.set(k, []);
      parIdent.get(k).push(nom);
    }
  });
  parMat.forEach((noms, k) => { if (noms.length > 1) bloquantes.push({ nom: noms.join(' / '), msg: `Même matricule (${k.toUpperCase()}) attribué à plusieurs élèves` }); });
  parIdent.forEach((noms) => { if (noms.length > 1) avertissements.push({ nom: noms[0], msg: 'Possible doublon : même nom, prénom et date de naissance' }); });
  return { bloquantes, avertissements };
}

function lcStats(lignes) {
  const classes = new Map();
  let garcons = 0, filles = 0;
  lignes.forEach((l) => {
    const k = l.classe || '—';
    if (!classes.has(k)) classes.set(k, { classe: k, niveau: l.niveau, effectif: 0, garcons: 0, filles: 0 });
    const c = classes.get(k);
    c.effectif++;
    if (l.sexe === 'F') { c.filles++; filles++; } else if (l.sexe === 'M') { c.garcons++; garcons++; }
  });
  const parClasse = [...classes.values()].sort((a, b) => lcRangClasse(a.classe, a.niveau) - lcRangClasse(b.classe, b.niveau) || a.classe.localeCompare(b.classe, 'fr', { numeric: true }));
  return { effectif: lignes.length, garcons, filles, parClasse };
}

/* Forme canonique (ordre des colonnes fixe) : l'empreinte reste la même après un aller-retour dans la base */
function lcCanon(lignes, cles) { return JSON.stringify(lignes.map((l) => (cles || LC_CLES).map((k) => (l[k] === undefined || l[k] === null ? '' : String(l[k]))))); }
async function lcEmpreinte(lignes, cles) {
  const txt = lcCanon(lignes, cles);
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase();
    }
  } catch (e) { /* contexte non sécurisé : repli ci-dessous */ }
  return deterministicUuid('liste:' + txt).replace(/-/g, '').slice(0, 16).toUpperCase();
}

/* Doublons ENTRE écoles (listes déjà récupérées) : même identité, ou même matricule dans deux écoles */
function lcDoublonsEntreEcoles(locaux) {
  const idents = new Map(), mats = new Map();
  locaux.forEach((rec) => (rec.data || []).forEach((l) => {
    const eco = rec.ecole_nom || '—';
    if (l.nom && l.prenom && l.dateNaissance) {
      const k = `${lcNorm(l.nom)}|${lcNorm(l.prenom)}|${l.dateNaissance}`;
      if (!idents.has(k)) idents.set(k, []);
      idents.get(k).push({ l, ecole: eco, ecoleId: rec.ecole_id });
    }
    if (l.matricule) {
      const k = lcNorm(l.matricule);
      if (!mats.has(k)) mats.set(k, []);
      mats.get(k).push({ l, ecole: eco, ecoleId: rec.ecole_id });
    }
  }));
  const res = [];
  const autresEcoles = (arr) => new Set(arr.map((x) => x.ecoleId)).size > 1;
  idents.forEach((arr) => { if (autresEcoles(arr)) res.push({ type: 'Même identité', nom: `${arr[0].l.nom} ${arr[0].l.prenom}`, detail: `né(e) le ${formatDate(arr[0].l.dateNaissance)}`, ecoles: [...new Set(arr.map((x) => x.ecole))] }); });
  mats.forEach((arr, k) => {
    if (!autresEcoles(arr)) return;
    const memeNom = new Set(arr.map((x) => lcNorm(x.l.nom + ' ' + x.l.prenom))).size === 1;
    if (memeNom && res.some((r) => r.type === 'Même identité' && lcNorm(r.nom) === lcNorm(arr[0].l.nom + ' ' + arr[0].l.prenom))) return; // déjà signalé
    res.push({ type: 'Même matricule', nom: arr.map((x) => `${x.l.nom} ${x.l.prenom}`).filter((v, i, a) => a.indexOf(v) === i).join(' / '), detail: 'matricule ' + arr[0].l.matricule, ecoles: [...new Set(arr.map((x) => x.ecole))] });
  });
  return res.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/* ---------------- Aides d'affichage ---------------- */
function lcMsgErreur(e) {
  const m = String((e && (e.message || e.details)) || e || '');
  if (/listes_eleves|listes_eleves_suivi/i.test(m) && /does not exist|schema cache|could not find/i.test(m)) {
    return "La fonction « listes d'élèves » n'est pas encore installée sur le serveur : exécutez supabase-listes.sql dans Supabase (SQL Editor), puis rechargez la page.";
  }
  if (/listes_eleves/i.test(m) && /\btype\b/i.test(m) && /does not exist|schema cache|could not find|column/i.test(m)) {
    return "La mise à jour « candidats au CEP » n'est pas installée sur le serveur : exécutez de nouveau supabase-listes.sql dans Supabase (SQL Editor), puis rechargez la page.";
  }
  return resMsgErreur(e);
}
const lcBadge = (statut) => { const s = LC_STATUT_LISTE[statut] || { label: statut, badge: 'indigo' }; return `<span class="badge badge-${s.badge}">${esc(s.label)}</span>`; };
const lcBtnRetour = () => `<button class="btn btn-sm no-print" id="lc-retour" style="margin-bottom:10px;">← Retour</button>`;
function lcBrancherRetour(root) { const b = $('#lc-retour', root); if (b) b.onclick = () => { location.hash = '#/dashboard'; }; }

function lcTableHtml(lignes, avecParents) {
  const groupes = new Map();
  lignes.forEach((l) => { const k = l.classe || '—'; if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(l); });
  const nbCol = avecParents ? 9 : 7;
  let corps = '';
  groupes.forEach((arr, k) => {
    const f = arr.filter((l) => l.sexe === 'F').length;
    corps += `<tr><td colspan="${nbCol}" style="background:#eee;font-weight:700;">${esc(k)} — ${arr.length} élève(s) (${f} fille(s), ${arr.length - f} garçon(s))</td></tr>`;
    arr.forEach((l, i) => {
      corps += `<tr><td style="text-align:center;">${i + 1}</td><td>${esc(l.matricule) || '—'}</td><td>${esc(l.nom)}</td><td>${esc(l.prenom)}</td><td style="text-align:center;">${esc(l.sexe)}</td><td>${l.dateNaissance ? esc(formatDate(l.dateNaissance)) : '—'}${l.lieuNaissance ? ' à ' + esc(l.lieuNaissance) : ''}</td><td>${esc(lcLibStatut(l.statut))}</td>${avecParents ? `<td>${esc(l.pere)}</td><td>${esc(l.mere)}</td>` : ''}</tr>`;
    });
  });
  return `<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:11.5px;"><thead><tr><th>N°</th><th>Matricule</th><th>Nom</th><th>Prénom(s)</th><th>Sexe</th><th>Naissance</th><th>Statut</th>${avecParents ? '<th>Père</th><th>Mère</th>' : ''}</tr></thead><tbody>${corps}</tbody></table>`;
}
const lcEntetesCSV = (avecParents, ecole) => [
  ...(ecole ? [{ label: 'École', value: (r) => r._ecole }] : []),
  { label: 'Classe', value: 'classe' }, { label: 'Matricule', value: 'matricule' }, { label: "N° d'ordre", value: 'numeroOrdre' },
  { label: 'Nom', value: 'nom' }, { label: 'Prénom(s)', value: 'prenom' }, { label: 'Sexe', value: 'sexe' },
  { label: 'Date de naissance', value: (r) => (r.dateNaissance ? formatDate(r.dateNaissance) : '') }, { label: 'Lieu de naissance', value: 'lieuNaissance' },
  { label: 'Statut', value: (r) => lcLibStatut(r.statut) },
  ...(avecParents ? [{ label: 'Père', value: 'pere' }, { label: 'Mère', value: 'mere' }] : [])
];
const lcNomFichier = (s) => lcNorm(s).replace(/\s+/g, '-').slice(0, 40) || 'liste';

/* ============================================================
   ÉCOLE : préparer et publier la liste à la CEB
   ============================================================ */
ROUTES['#/liste-ceb'] = async (root) => {
  const [elevesAll, classes, metaArr, remAll] = await Promise.all([DB.getAll('eleves'), DB.getAll('classes'), DB.getAll('meta'), DB.getAll('examRemontees')]);
  const meta = metaArr[0] || {};
  const annee = meta.anneeScolaire || anneeScolaireCourante();
  const classeMap = new Map(classes.map((c) => [c.id, c]));
  const lignes = elevesAll.filter((e) => LC_ETAT.statuts.includes(e.statut || 'actif'))
    .map((e) => lcLigne(e, classeMap.get(e.classeId), LC_ETAT.parents)).sort(lcCmp);
  const ctl = lcControler(lignes), st = lcStats(lignes);
  const inscr = remAll.find((r) => r.kind === 'inscription' && r.annee === annee);
  const selCep = (inscr && inscr.selection) || {};
  const lignesCep = elevesAll.filter((e) => e._uuid && selCep[e._uuid] && selCep[e._uuid].candidat)
    .map((e) => ({ ...lcLigne(e, classeMap.get(e.classeId), false), examens: selCep[e._uuid].examens || 'CEP seul', besoins: selCep[e._uuid].besoins || '', handicap: !!e.handicap, bilingue: !!e.bilingue, eleveUuid: e._uuid })).sort(lcCmp);
  const ctlCep = lcControler(lignesCep), stCep = lcStats(lignesCep);
  lignesCep.filter((l) => !l.lieuNaissance).forEach((l) => ctlCep.avertissements.push({ nom: `${l.nom} ${l.prenom}`.trim(), msg: 'Lieu de naissance manquant' }));
  const rattachee = !!(currentUser.ceb && currentUser.province && currentUser.region);
  const nomEcole = (meta.nomEcole || currentUser.structure || '').trim();
  const publiable = rattachee && !!nomEcole && lignes.length > 0 && !ctl.bloquantes.length;
  const publiableCep = rattachee && !!nomEcole && lignesCep.length > 0 && !ctlCep.bloquantes.length;
  const liste = (arr, max) => arr.slice(0, max).map((a) => `<li><b>${esc(a.nom)}</b> — ${esc(a.msg)}</li>`).join('') + (arr.length > max ? `<li class="text-soft">… et ${arr.length - max} autre(s)</li>` : '');

  root.innerHTML = `
    ${lcBtnRetour()}
    <div id="pb-rattachement"></div>
    ${nomEcole ? '' : `<div class="alert alert-ocre" style="margin-bottom:12px;">Le <b>nom de l'école</b> n'est pas renseigné : indiquez-le dans <a href="#/parametres">Paramètres</a> avant de publier.</div>`}
    <div class="card" style="margin-bottom:14px;">
      <h3 style="margin:0 0 4px;">Liste des élèves à transmettre à la CEB — année ${esc(annee)}</h3>
      <p class="text-soft" style="margin:0 0 10px;font-size:13px;">Préparez la liste, vérifiez-la, puis publiez-la dans le compte de votre CEB. Chaque publication est une nouvelle version : la CEB voit toujours la dernière. Les photos, téléphones, finances et dossiers disciplinaires ne sont jamais transmis.</p>
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;">
        <span style="font-weight:600;">Élèves à inclure :</span>
        ${Object.entries(LC_STATUTS_ELEVE).map(([k, v]) => `<label style="display:flex;gap:6px;align-items:center;font-weight:400;"><input type="checkbox" class="lc-st" value="${k}" ${LC_ETAT.statuts.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}
        <label style="display:flex;gap:6px;align-items:center;font-weight:400;"><input type="checkbox" id="lc-parents" ${LC_ETAT.parents ? 'checked' : ''}> Joindre le nom des parents</label>
      </div>
    </div>
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Effectif de la liste</div><div class="value">${st.effectif}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Filles</div><div class="value">${st.filles}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Garçons</div><div class="value">${st.garcons}</div></div>
      <div class="card stat-card ${ctl.bloquantes.length ? 'c-terre' : 'c-vert'}"><div class="accent-bar"></div><div class="label">Anomalies bloquantes</div><div class="value">${ctl.bloquantes.length}</div></div>
    </div>
    ${ctl.bloquantes.length ? `<div class="alert alert-terre" style="margin-bottom:12px;"><b>À corriger avant de publier</b> (dans la rubrique <a href="#/eleves">Élèves</a>) :<ul style="margin:6px 0 0 18px;">${liste(ctl.bloquantes, 15)}</ul></div>` : ''}
    ${ctl.avertissements.length ? `<details class="card" style="margin-bottom:12px;padding:10px 16px;"><summary style="cursor:pointer;font-weight:600;">${ctl.avertissements.length} point(s) d'attention (non bloquants)</summary><ul style="margin:8px 0 0 18px;font-size:13px;">${liste(ctl.avertissements, 40)}</ul></details>` : ''}
    ${st.parClasse.length ? `<div class="table-wrap" style="margin-bottom:14px;"><table class="table" style="font-size:13px;"><thead><tr><th>Classe</th><th>Effectif</th><th>Filles</th><th>Garçons</th></tr></thead><tbody>
      ${st.parClasse.map((c) => `<tr><td>${esc(c.classe)}</td><td>${c.effectif}</td><td>${c.filles}</td><td>${c.garcons}</td></tr>`).join('')}
      <tr style="font-weight:700;"><td>Total</td><td>${st.effectif}</td><td>${st.filles}</td><td>${st.garcons}</td></tr></tbody></table></div>` : '<div class="empty-state">Aucun élève ne correspond aux statuts choisis.</div>'}
    <div class="flex gap-8 no-print" style="flex-wrap:wrap;margin-bottom:18px;">
      <button class="btn btn-accent" id="lc-pub" ${publiable ? '' : 'disabled'}>⇪ Publier à ma CEB</button>
      <button class="btn" id="lc-apercu" ${lignes.length ? '' : 'disabled'}>Aperçu / Imprimer</button>
      <button class="btn" id="lc-csv" ${lignes.length ? '' : 'disabled'}>Exporter (CSV)</button>
    </div>
    ${rattachee ? '' : `<p class="text-soft" style="font-size:12.5px;">La publication est possible dès que l'école est rattachée à sa CEB (carte ci-dessus).</p>`}
    <h3 style="margin:8px 0;">Publications de l'école</h3>
    <div id="lc-histo"><p class="text-soft">Chargement…</p></div>
    <div class="card" style="margin:22px 0 14px;" id="lc-cep-bloc">
      <h3 style="margin:0 0 4px;">Candidats au CEP à transmettre à la CEB — année ${esc(annee)}</h3>
      <p class="text-soft" style="margin:0 0 10px;font-size:13px;">La liste reprend les élèves cochés « Candidat » dans <a href="#/cep-ecole">École : inscriptions &amp; résultats</a>. Une fois publiée, elle arrive directement dans le compte de votre CEB, qui l'intègre à l'Espace Examen.</p>
      <div class="grid grid-4" style="margin-bottom:10px;">
        <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Candidats retenus</div><div class="value">${stCep.effectif}</div></div>
        <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Filles</div><div class="value">${stCep.filles}</div></div>
        <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Garçons</div><div class="value">${stCep.garcons}</div></div>
        <div class="card stat-card ${ctlCep.bloquantes.length ? 'c-terre' : 'c-vert'}"><div class="accent-bar"></div><div class="label">Anomalies bloquantes</div><div class="value">${ctlCep.bloquantes.length}</div></div>
      </div>
      ${ctlCep.bloquantes.length ? `<div class="alert alert-terre" style="margin-bottom:10px;"><b>À corriger avant de publier</b> (dans <a href="#/eleves">Élèves</a>) :<ul style="margin:6px 0 0 18px;">${liste(ctlCep.bloquantes, 8)}</ul></div>` : ''}
      ${ctlCep.avertissements.length ? `<details class="card" style="margin-bottom:10px;padding:10px 16px;"><summary style="cursor:pointer;font-weight:600;">${ctlCep.avertissements.length} point(s) d'attention (non bloquants)</summary><ul style="margin:8px 0 0 18px;">${liste(ctlCep.avertissements, 15)}</ul></details>` : ''}
      ${lignesCep.length ? `<div class="table-wrap" style="margin-bottom:10px;"><table class="table" style="font-size:12.5px;"><thead><tr><th>N°</th><th>Nom et prénom(s)</th><th>Sexe</th><th>Né(e) le</th><th>Lieu de naissance</th><th>Matricule</th><th>Classe</th><th>Examen</th><th>Handicap</th><th>Bilingue</th></tr></thead><tbody>
        ${lignesCep.map((l, i) => `<tr><td>${i + 1}</td><td class="wrap" style="font-weight:600;">${esc(l.nom)} ${esc(l.prenom)}</td><td>${esc(l.sexe)}</td><td>${l.dateNaissance ? esc(lcDate(l.dateNaissance)) : '—'}</td><td class="wrap">${esc(l.lieuNaissance) || '—'}</td><td>${esc(l.matricule) || '—'}</td><td>${esc(l.classe)}</td><td>${esc(l.examens)}</td><td>${l.handicap ? 'Oui' : ''}</td><td>${l.bilingue ? 'Oui' : ''}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty-state" style="margin-bottom:10px;">Aucun candidat retenu. Cochez les candidats dans <a href="#/cep-ecole">École : inscriptions &amp; résultats</a>.</div>`}
      <div class="flex gap-8 no-print" style="flex-wrap:wrap;margin-bottom:14px;">
        <button class="btn btn-accent" id="lc-pub-cep" ${publiableCep ? '' : 'disabled'}>⇪ Publier les candidats au CEP à ma CEB</button>
        <button class="btn" id="lc-csv-cep" ${lignesCep.length ? '' : 'disabled'}>Exporter (CSV)</button>
      </div>
      <h4 style="margin:6px 0;">Publications des candidats au CEP</h4>
      <div id="lc-histo-cep"><p class="text-soft">Chargement…</p></div>
    </div>`;

  lcBrancherRetour(root);
  resCarteRattachement('ecole');
  $all('.lc-st', root).forEach((c) => {
    c.onchange = () => { LC_ETAT.statuts = $all('.lc-st', root).filter((x) => x.checked).map((x) => x.value); onRouteChange(); };
  });
  $('#lc-parents', root).onchange = (e) => { LC_ETAT.parents = e.target.checked; onRouteChange(); };
  $('#lc-csv', root).onclick = () => download(`eleves-${lcNomFichier(nomEcole)}-${annee.replace(/\W+/g, '-')}.csv`, toCSV(lignes, lcEntetesCSV(LC_ETAT.parents, false)), 'text/csv;charset=utf-8');
  $('#lc-apercu', root).onclick = () => printDocument(`Liste nominative des élèves — ${annee}`,
    `<h3 style="text-align:center;margin:0 0 4px;">LISTE NOMINATIVE DES ÉLÈVES</h3>
     <p style="text-align:center;font-size:12px;margin:0 0 10px;">Effectif : ${st.effectif} (${st.filles} filles, ${st.garcons} garçons)${currentUser.ceb ? ' — CEB de ' + esc(currentUser.ceb) : ''}</p>${lcTableHtml(lignes, LC_ETAT.parents)}`);
  $('#lc-pub', root).onclick = () => lcPublier({ lignes, st, ctl, meta, annee, nomEcole });
  lcHistoriqueEcole($('#lc-histo', root), 'eleves');
  $('#lc-pub-cep', root).onclick = () => lcPublier({ type: 'cep', lignes: lignesCep, st: stCep, ctl: ctlCep, meta, annee, nomEcole });
  $('#lc-csv-cep', root).onclick = () => download(`candidats-cep-${lcNomFichier(nomEcole)}-${annee.replace(/\W+/g, '-')}.csv`, toCSV(lignesCep, [
    { label: 'Nom', value: 'nom' }, { label: 'Prénom(s)', value: 'prenom' }, { label: 'Sexe', value: 'sexe' },
    { label: 'Date de naissance', value: (r) => (r.dateNaissance ? formatDate(r.dateNaissance) : '') }, { label: 'Lieu de naissance', value: 'lieuNaissance' }, { label: 'Matricule', value: 'matricule' },
    { label: 'Classe', value: 'classe' }, { label: 'Examen', value: 'examens' }, { label: 'Besoins spécifiques', value: 'besoins' },
    { label: 'Situation de handicap', value: (r) => (r.handicap ? 'Oui' : '') }, { label: 'Candidat bilingue', value: (r) => (r.bilingue ? 'Oui' : '') }]), 'text/csv;charset=utf-8');
  lcHistoriqueEcole($('#lc-histo-cep', root), 'cep');
};

async function lcPublier(ctx) {
  const { lignes, st, ctl, annee, nomEcole } = ctx;
  const type = ctx.type || 'eleves', cep = type === 'cep';
  const supa = window.supaClient;
  if (!lignes.length || ctl.bloquantes.length) { toast(cep && !lignes.length ? 'Aucun candidat retenu : cochez-les dans « École : inscriptions & résultats ».' : "Corrigez d'abord les anomalies bloquantes."); return; }
  if (!currentUser.ceb || !currentUser.province || !currentUser.region) { toast("Rattachez d'abord l'école à sa CEB."); return; }
  const btn = $(cep ? '#lc-pub-cep' : '#lc-pub'); if (btn) btn.disabled = true;
  try {
    const empreinte = await lcEmpreinte(lignes, cep ? LC_CLES_CEP : undefined);
    const { data: v, error: ev } = await supa.from('listes_eleves').select('version,effectif,empreinte,created_at')
      .eq('ecole_id', currentUser.ecole_id).eq('annee', annee).eq('type', type).order('version', { ascending: false }).limit(1);
    if (ev) { toast(lcMsgErreur(ev)); return; }
    const prec = v && v[0];
    if (prec && prec.empreinte === empreinte) { toast(`Cette liste est identique à la version ${prec.version} déjà publiée : rien à envoyer.`); return; }
    const diff = prec ? st.effectif - prec.effectif : 0;
    const msg = `Publier ${st.effectif} ${cep ? 'candidat(s) au CEP' : 'élève(s)'} (${st.filles} filles, ${st.garcons} garçons) dans le compte de la CEB ${currentUser.ceb} ?`
      + (prec ? ` Elle remplacera la version ${prec.version} (${prec.effectif} élèves, ${diff >= 0 ? '+' : ''}${diff}).` : ' Ce sera la première version.')
      + (ctl.avertissements.length ? ` ${ctl.avertissements.length} point(s) d'attention subsistent.` : '');
    if (!(await confirmDialog(msg))) return;
    const row = {
      annee, version: prec ? prec.version + 1 : 1, ecole_nom: nomEcole,
      region: currentUser.region, province: currentUser.province, ceb: currentUser.ceb,
      type, emetteur_nom: currentUser.nom, effectif: st.effectif, garcons: st.garcons, filles: st.filles, empreinte, data: lignes
    };
    if (currentUser.ecole_id) row.ecole_id = currentUser.ecole_id;
    let r = await supa.from('listes_eleves').insert(row);
    if (r.error && r.error.code === '23505') { row.version += 1; r = await supa.from('listes_eleves').insert(row); }
    if (r.error) { toast(lcMsgErreur(r.error)); return; }
    toast(cep ? `Candidats au CEP publiés (version ${row.version}).` : `Liste publiée (version ${row.version}).`);
    onRouteChange();
  } finally { if (btn) btn.disabled = false; }
}

async function lcHistoriqueEcole(box, type) {
  type = type || 'eleves';
  if (!box) return;
  const supa = window.supaClient;
  if (!currentUser.ecole_id) { box.innerHTML = `<div class="alert alert-ocre">Compte non rattaché à une école : historique indisponible.</div>`; return; }
  const { data, error } = await supa.from('listes_eleves').select('id,annee,version,effectif,garcons,filles,created_at,emetteur_nom')
    .eq('ecole_id', currentUser.ecole_id).eq('type', type).order('created_at', { ascending: false }).limit(30);
  if (error) { box.innerHTML = `<div class="alert alert-terre">${esc(lcMsgErreur(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = `<div class="empty-state"><div class="big">⇪</div>${type === 'cep' ? 'Aucune liste de candidats publiée pour le moment.' : 'Aucune liste publiée pour le moment.'}</div>`; return; }
  const ids = data.map((d) => d.id);
  const s = await supa.from('listes_eleves_suivi').select('*').in('liste_id', ids);
  const suivi = new Map(((s.error ? [] : s.data) || []).map((x) => [x.liste_id, x]));
  const vigueur = new Set();
  const dernieres = new Map();
  data.forEach((d) => { const c = dernieres.get(d.annee); if (!c || d.version > c.version) dernieres.set(d.annee, d); });
  dernieres.forEach((d) => vigueur.add(d.id));
  box.innerHTML = `<div class="table-wrap"><table class="table" style="font-size:13px;"><thead><tr><th>Année</th><th>Version</th><th>Publiée le</th><th>Effectif</th><th>Suivi par la CEB</th><th></th></tr></thead><tbody>
    ${data.map((d) => { const x = suivi.get(d.id); const etat = x ? x.statut : 'envoyee';
      return `<tr><td>${esc(d.annee)}</td><td>v${d.version}${vigueur.has(d.id) ? ' <span class="badge badge-vert">en vigueur</span>' : ''}</td><td>${esc(lcDate(d.created_at))}</td><td>${d.effectif} <span class="text-soft">(${d.filles} F / ${d.garcons} G)</span></td>
      <td class="wrap">${x ? lcBadge(x.statut) + (x.remarque ? `<div style="margin-top:4px;"><b>Remarque de la CEB :</b> ${esc(x.remarque)}</div>` : '') + `<div class="text-soft" style="font-size:12px;">${esc(lcDate(x.traite_le))}</div>` : (vigueur.has(d.id) ? '<span class="badge badge-indigo">Envoyée — pas encore récupérée</span>' : '<span class="badge badge-indigo">Remplacée par une version plus récente</span>')}</td>
      <td>${etat === 'validee' ? '' : `<button class="btn btn-sm btn-danger" data-retirer="${d.id}">Retirer</button>`}</td></tr>`; }).join('')}
  </tbody></table></div>`;
  $all('[data-retirer]', box).forEach((b) => {
    b.onclick = async () => {
      const d = data.find((x) => x.id === b.dataset.retirer);
      if (!d || !(await confirmDialog(`Retirer la version ${d.version} (${d.annee}) ? Elle disparaîtra du compte de la CEB.`))) return;
      const r = await supa.from('listes_eleves').delete().eq('id', d.id).select('id');
      if (r.error) { toast(lcMsgErreur(r.error)); return; }
      if (!r.data || !r.data.length) { toast('Retrait impossible : la liste a déjà été validée par la CEB.'); return; }
      toast('Liste retirée.'); onRouteChange();
    };
  });
}

/* ============================================================
   CEB : récupérer, contrôler, valider les listes des écoles
   ============================================================ */
async function lcChargerCEB() {
  const supa = window.supaClient;
  const [l, s, p] = await Promise.all([
    supa.from('listes_eleves').select('id,ecole_id,annee,version,ecole_nom,effectif,garcons,filles,empreinte,emetteur_nom,created_at').eq('type', 'eleves').order('created_at', { ascending: false }).limit(1000),
    supa.from('listes_eleves_suivi').select('*'),
    supa.from('profiles').select('id,nom,structure,ecole_id').eq('role', 'directeur')
  ]);
  if (l.error) throw l.error;
  return { listes: l.data || [], suivi: s.error ? [] : (s.data || []), ecoles: p.error ? [] : (p.data || []) };
}

/* Une ligne par école de la circonscription : dernière version de l'année choisie + suivi + copie locale */
function lcConstruireLignes(remote, locaux, annee) {
  const ecoles = new Map();
  remote.ecoles.forEach((p) => { if (p.ecole_id && !ecoles.has(p.ecole_id)) ecoles.set(p.ecole_id, { ecole_id: p.ecole_id, nom: p.structure || p.nom || 'École', directeur: p.nom }); });
  const derniere = new Map();
  remote.listes.filter((x) => x.annee === annee).forEach((x) => {
    const c = derniere.get(x.ecole_id);
    if (!c || x.version > c.version) derniere.set(x.ecole_id, x);
    if (!ecoles.has(x.ecole_id)) ecoles.set(x.ecole_id, { ecole_id: x.ecole_id, nom: x.ecole_nom, directeur: x.emetteur_nom });
  });
  const suivi = new Map(remote.suivi.map((s) => [s.liste_id, s]));
  const loc = new Map(locaux.map((x) => [x.listeId, x]));
  return [...ecoles.values()].map((e) => {
    const liste = derniere.get(e.ecole_id) || null;
    const sv = liste ? suivi.get(liste.id) || null : null;
    return { ...e, liste, suivi: sv, local: liste ? loc.get(liste.id) || null : null, statut: !liste ? 'attente' : (!sv ? 'nouvelle' : sv.statut) };
  }).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr', { numeric: true }));
}

async function lcEnregistrerLocal(d) {
  const existants = await DB.getAll('listesCeb');
  for (const x of existants) { if (x.listeId === d.id || (x.ecole_id === d.ecole_id && x.annee === d.annee)) await DB.delete('listesCeb', x.id); }
  const data = Array.isArray(d.data) ? d.data : [];
  const integre = !d.empreinte || (await lcEmpreinte(data)) === d.empreinte;
  await DB.add('listesCeb', {
    listeId: d.id, ecole_id: d.ecole_id, annee: d.annee, version: d.version, ecole_nom: d.ecole_nom, ceb: d.ceb,
    effectif: d.effectif, garcons: d.garcons, filles: d.filles, empreinte: d.empreinte, integre,
    created_at: d.created_at, recupere_le: new Date().toISOString(), data
  });
  return integre;
}

ROUTES['#/listes-ceb'] = async (root) => {
  root.innerHTML = `${lcBtnRetour()}<p class="text-soft">Chargement…</p>`;
  let remote = null, horsLigne = false;
  const locauxTous = await DB.getAll('listesCeb');
  try { remote = await lcChargerCEB(); } catch (e) {
    if (/listes_eleves/i.test(String((e && e.message) || '')) && /does not exist|schema cache|could not find/i.test(String(e.message))) { root.innerHTML = `${lcBtnRetour()}<div class="alert alert-terre">${esc(lcMsgErreur(e))}</div>`; lcBrancherRetour(root); return; }
    horsLigne = true;
    remote = { ecoles: [], suivi: [], listes: locauxTous.map((x) => ({ id: x.listeId, ecole_id: x.ecole_id, annee: x.annee, version: x.version, ecole_nom: x.ecole_nom, effectif: x.effectif, garcons: x.garcons, filles: x.filles, empreinte: x.empreinte, emetteur_nom: '', created_at: x.created_at })) };
  }
  const annees = [...new Set([...remote.listes.map((x) => x.annee), ...locauxTous.map((x) => x.annee)])].sort().reverse();
  if (!LC_ETAT.annee || !annees.includes(LC_ETAT.annee)) LC_ETAT.annee = annees[0] || '';
  const annee = LC_ETAT.annee;
  const locaux = locauxTous.filter((x) => x.annee === annee);
  const lignes = lcConstruireLignes(remote, locaux, annee);
  const recues = lignes.filter((r) => r.liste);
  const tot = recues.reduce((a, r) => ({ e: a.e + r.liste.effectif, f: a.f + r.liste.filles, g: a.g + r.liste.garcons }), { e: 0, f: 0, g: 0 });
  const nb = (s) => lignes.filter((r) => r.statut === s).length;
  const aRecuperer = recues.filter((r) => !r.local).length;
  const q = lcNorm(LC_ETAT.recherche);
  const affichees = lignes.filter((r) => (LC_ETAT.filtre === 'tous' || r.statut === LC_ETAT.filtre || (LC_ETAT.filtre === 'atraiter' && (r.statut === 'nouvelle' || r.statut === 'recue'))) && (!q || lcNorm(r.nom).includes(q)));
  const doublons = lcDoublonsEntreEcoles(locaux.filter((x) => lignes.some((r) => r.liste && r.liste.id === x.listeId)));

  root.innerHTML = `
    ${lcBtnRetour()}
    ${horsLigne ? `<div class="alert alert-ocre" style="margin-bottom:12px;">Hors connexion : seules les listes déjà récupérées sur cet appareil sont affichées.</div>` : ''}
    <div class="card" style="margin-bottom:14px;padding:10px 16px;"><b>CEB ${esc(currentUser.ceb || '')}</b> <span class="text-soft">— listes nominatives d'élèves des écoles de la circonscription</span></div>
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Écoles de la CEB</div><div class="value">${lignes.length}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Listes publiées</div><div class="value">${recues.length}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">En attente</div><div class="value">${nb('attente')}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Élèves (listes publiées)</div><div class="value">${tot.e}</div><div class="text-soft" style="font-size:12px;">${tot.f} F / ${tot.g} G</div></div>
    </div>
    <div class="table-toolbar no-print">
      <select id="lc-annee" class="search-input">${annees.map((a) => `<option ${a === annee ? 'selected' : ''}>${esc(a)}</option>`).join('') || '<option>—</option>'}</select>
      <select id="lc-filtre" class="search-input">
        ${[['tous', 'Toutes les écoles'], ['atraiter', 'À traiter'], ['attente', 'En attente de liste'], ['validee', 'Validées'], ['a_corriger', 'À corriger']].map(([v, t]) => `<option value="${v}" ${LC_ETAT.filtre === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <input id="lc-q" class="search-input" placeholder="Rechercher une école…" value="${esc(LC_ETAT.recherche)}">
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="lc-actu">Actualiser</button>
      <button class="btn btn-accent" id="lc-recup" ${horsLigne || !aRecuperer ? 'disabled' : ''}>⇩ Récupérer les listes${aRecuperer ? ` (${aRecuperer})` : ''}</button>
    </div>
    <div class="flex gap-8 no-print" style="flex-wrap:wrap;margin:6px 0 12px;">
      <button class="btn btn-sm" id="lc-conso" ${locaux.length ? '' : 'disabled'}>Liste consolidée (CSV)</button>
      <button class="btn btn-sm" id="lc-recap" ${recues.length ? '' : 'disabled'}>État des effectifs (PDF)</button>
      <button class="btn btn-sm" id="lc-doubl" ${doublons.length ? '' : 'disabled'}>Doublons entre écoles (${doublons.length})</button>
    </div>
    ${affichees.length ? `<div class="table-wrap"><table class="table" style="font-size:13px;"><thead><tr><th>École</th><th>Directeur</th><th>Version</th><th>Publiée le</th><th>Effectif</th><th>Statut</th><th></th></tr></thead><tbody>
      ${affichees.map((r) => `<tr>
        <td class="wrap" style="font-weight:700;">${esc(r.nom)}</td><td class="wrap">${esc(r.directeur || '—')}</td>
        <td>${r.liste ? 'v' + r.liste.version : '—'}</td><td>${r.liste ? esc(lcDate(r.liste.created_at)) : '—'}</td>
        <td>${r.liste ? `${r.liste.effectif} <span class="text-soft">(${r.liste.filles} F / ${r.liste.garcons} G)</span>` : '—'}</td>
        <td class="wrap">${lcBadge(r.statut)}${r.local ? (r.local.integre ? ' <span class="badge badge-vert" title="Empreinte vérifiée">intègre</span>' : ' <span class="badge badge-terre" title="L\'empreinte ne correspond pas">à vérifier</span>') : (r.liste ? ' <span class="text-soft" style="font-size:12px;">non récupérée</span>' : '')}${r.suivi && r.suivi.remarque ? `<div class="text-soft" style="font-size:12px;">${esc(r.suivi.remarque)}</div>` : ''}</td>
        <td>${r.liste ? `<div class="flex gap-8" style="flex-wrap:wrap;">
          <button class="btn btn-sm" data-ouvrir="${r.ecole_id}">Ouvrir</button>
          ${r.local && r.statut !== 'validee' ? `<button class="btn btn-sm btn-accent" data-valider="${r.ecole_id}">Valider</button>` : ''}
          ${r.local && r.statut !== 'a_corriger' && r.statut !== 'validee' ? `<button class="btn btn-sm" data-corriger="${r.ecole_id}">À corriger</button>` : ''}
        </div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty-state"><div class="big">⇩</div>${lignes.length ? 'Aucune école ne correspond à ce filtre.' : "Aucune école n'est encore rattachée à votre CEB. Créez les comptes des directeurs dans « Comptes des structures »."}</div>`}`;

  lcBrancherRetour(root);
  const parEcole = (id) => lignes.find((r) => r.ecole_id === id);
  $('#lc-annee', root).onchange = (e) => { LC_ETAT.annee = e.target.value; onRouteChange(); };
  $('#lc-filtre', root).onchange = (e) => { LC_ETAT.filtre = e.target.value; onRouteChange(); };
  let t = null;
  $('#lc-q', root).oninput = (e) => { LC_ETAT.recherche = e.target.value; clearTimeout(t); t = setTimeout(() => { onRouteChange(); }, 350); };
  $('#lc-actu', root).onclick = () => onRouteChange();
  $('#lc-recup', root).onclick = () => lcRecuperer(recues.filter((r) => !r.local));
  $('#lc-conso', root).onclick = () => lcExportConsolide(locaux, annee);
  $('#lc-recap', root).onclick = () => lcEtatEffectifs(lignes, annee);
  $('#lc-doubl', root).onclick = () => lcAfficherDoublons(doublons);
  $all('[data-ouvrir]', root).forEach((b) => { b.onclick = () => lcOuvrir(parEcole(b.dataset.ouvrir)); });
  $all('[data-valider]', root).forEach((b) => {
    b.onclick = async () => {
      const r = parEcole(b.dataset.valider);
      if (!r || !(await confirmDialog(`Valider la liste de « ${r.nom} » (version ${r.liste.version}, ${r.liste.effectif} élèves) ? L'école ne pourra plus la retirer.`))) return;
      if (await lcTraiter(r, 'validee', null)) { toast('Liste validée.'); onRouteChange(); }
    };
  });
  $all('[data-corriger]', root).forEach((b) => {
    b.onclick = () => {
      const r = parEcole(b.dataset.corriger); if (!r) return;
      openModal(`Demander une correction — ${r.nom}`, `<div class="field"><label>Que doit corriger l'école ? *</label><textarea id="lc-rem" style="min-height:100px;" placeholder="Ex : 4 élèves de CM2 sans date de naissance ; matricule en double pour…"></textarea></div>`, {
        saveLabel: 'Envoyer à l\'école',
        onSave: async (o) => {
          const rem = $('#lc-rem', o).value.trim();
          if (!rem) { toast('Indiquez ce qui doit être corrigé.'); return false; }
          if (!(await lcTraiter(r, 'a_corriger', rem))) return false;
          toast('Demande de correction envoyée.'); onRouteChange(); return true;
        }
      });
    };
  });
};

async function lcTraiter(r, statut, remarque) {
  const { error } = await window.supaClient.from('listes_eleves_suivi').upsert({
    liste_id: r.liste.id, statut, remarque: remarque || null, traite_par: currentUser.id, traite_nom: currentUser.nom, traite_le: new Date().toISOString()
  }, { onConflict: 'liste_id' });
  if (error) { toast(lcMsgErreur(error)); return false; }
  return true;
}

async function lcRecuperer(aPrendre) {
  if (!aPrendre.length) { toast('Toutes les listes sont déjà récupérées.'); return; }
  const supa = window.supaClient;
  const btn = $('#lc-recup'); if (btn) btn.disabled = true;
  let n = 0, suspectes = 0;
  try {
    for (let i = 0; i < aPrendre.length; i += 5) {
      const lot = aPrendre.slice(i, i + 5);
      const { data, error } = await supa.from('listes_eleves').select('*').in('id', lot.map((r) => r.liste.id));
      if (error) { toast(lcMsgErreur(error)); break; }
      for (const d of data) { if (!(await lcEnregistrerLocal(d))) suspectes++; n++; }
      // Accusé de réception : seulement pour les listes sans suivi (ne rétrograde jamais une validation)
      const sans = lot.filter((r) => !r.suivi).map((r) => ({ liste_id: r.liste.id, statut: 'recue', traite_par: currentUser.id, traite_nom: currentUser.nom }));
      if (sans.length) await supa.from('listes_eleves_suivi').upsert(sans, { onConflict: 'liste_id', ignoreDuplicates: true });
      toast(`${Math.min(i + 5, aPrendre.length)} / ${aPrendre.length} liste(s) récupérée(s)…`);
    }
  } finally { if (btn) btn.disabled = false; }
  toast(n ? `${n} liste(s) récupérée(s)${suspectes ? ` — ${suspectes} à vérifier (empreinte différente)` : ''}.` : 'Aucune liste récupérée.');
  onRouteChange();
}

/* Ouvre la liste d'une école (copie locale, sinon récupération à la volée) */
async function lcOuvrir(r) {
  if (!r || !r.liste) return;
  let rec = r.local;
  if (!rec) {
    const { data, error } = await window.supaClient.from('listes_eleves').select('*').eq('id', r.liste.id).single();
    if (error || !data) { toast(lcMsgErreur(error)); return; }
    await lcEnregistrerLocal(data);
    rec = (await DB.getAll('listesCeb')).find((x) => x.listeId === r.liste.id);
    if (!r.suivi) await window.supaClient.from('listes_eleves_suivi').upsert({ liste_id: r.liste.id, statut: 'recue', traite_par: currentUser.id, traite_nom: currentUser.nom }, { onConflict: 'liste_id', ignoreDuplicates: true });
    onRouteChange();
  }
  const data = (rec.data || []).slice().sort(lcCmp);
  const avecParents = data.some((l) => l.pere || l.mere);
  const classes = [...new Set(data.map((l) => l.classe))];
  const ov = openModal(`${rec.ecole_nom} — liste v${rec.version}`, `
    <p class="text-soft" style="font-size:12.5px;margin:0 0 8px;">Publiée le ${esc(lcDate(rec.created_at))} · ${rec.effectif} élève(s) (${rec.filles} F / ${rec.garcons} G) · empreinte ${esc(rec.empreinte || '—')}
      ${rec.integre ? '<span class="badge badge-vert">intègre</span>' : '<span class="badge badge-terre">empreinte différente : à vérifier</span>'}</p>
    <div class="table-toolbar no-print">
      <input id="lo-q" class="search-input" placeholder="Rechercher un élève…">
      <select id="lo-cl" class="search-input"><option value="">Toutes les classes</option>${classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="lo-csv">CSV</button><button class="btn btn-sm" id="lo-pdf">PDF</button>
    </div>
    <div class="table-wrap" style="max-height:55vh;overflow:auto;"><table class="table" style="font-size:12.5px;"><thead><tr><th>Classe</th><th>Matricule</th><th>Nom</th><th>Prénom(s)</th><th>Sexe</th><th>Naissance</th><th>Statut</th>${avecParents ? '<th>Père</th><th>Mère</th>' : ''}</tr></thead><tbody id="lo-corps"></tbody></table></div>
    <p class="text-soft" id="lo-nb" style="font-size:12px;"></p>`, { wide: true, saveLabel: 'Fermer', onSave: async () => true });
  const filtrer = () => {
    const q = lcNorm($('#lo-q', ov).value), cl = $('#lo-cl', ov).value;
    const ok = data.filter((l) => (!cl || l.classe === cl) && (!q || lcNorm(`${l.nom} ${l.prenom} ${l.matricule}`).includes(q)));
    $('#lo-corps', ov).innerHTML = ok.map((l) => `<tr><td>${esc(l.classe)}</td><td>${esc(l.matricule) || '—'}</td><td>${esc(l.nom)}</td><td>${esc(l.prenom)}</td><td>${esc(l.sexe)}</td><td>${l.dateNaissance ? esc(formatDate(l.dateNaissance)) : '—'}${l.lieuNaissance ? ' à ' + esc(l.lieuNaissance) : ''}</td><td>${esc(lcLibStatut(l.statut))}</td>${avecParents ? `<td>${esc(l.pere)}</td><td>${esc(l.mere)}</td>` : ''}</tr>`).join('');
    $('#lo-nb', ov).textContent = `${ok.length} élève(s) affiché(s) sur ${data.length}.`;
    return ok;
  };
  $('#lo-q', ov).oninput = filtrer; $('#lo-cl', ov).onchange = filtrer; filtrer();
  $('#lo-csv', ov).onclick = () => download(`liste-${lcNomFichier(rec.ecole_nom)}-v${rec.version}.csv`, toCSV(data, lcEntetesCSV(avecParents, false)), 'text/csv;charset=utf-8');
  $('#lo-pdf', ov).onclick = () => exPrint(`Liste — ${rec.ecole_nom}`, `${exEnteteNiveau('Liste nominative des élèves', `${esc(rec.ecole_nom)} — année ${esc(rec.annee)} — CEB ${esc(currentUser.ceb || '')}<br>Version ${rec.version} publiée le ${esc(lcDate(rec.created_at))} — ${rec.effectif} élèves (${rec.filles} F / ${rec.garcons} G)`)}${lcTableHtml(data, avecParents)}${exSignatures(['Le Chef de la CEB'])}`);
}

function lcExportConsolide(locaux, annee) {
  const lignes = [];
  locaux.slice().sort((a, b) => String(a.ecole_nom).localeCompare(String(b.ecole_nom), 'fr', { numeric: true })).forEach((rec) => {
    (rec.data || []).slice().sort(lcCmp).forEach((l) => lignes.push({ ...l, _ecole: rec.ecole_nom }));
  });
  if (!lignes.length) { toast('Aucune liste récupérée à exporter.'); return; }
  const avecParents = lignes.some((l) => l.pere || l.mere);
  download(`liste-consolidee-CEB-${lcNomFichier(currentUser.ceb || '')}-${String(annee).replace(/\W+/g, '-')}.csv`, toCSV(lignes, lcEntetesCSV(avecParents, true)), 'text/csv;charset=utf-8');
  toast(`${lignes.length} élève(s) exportés (${locaux.length} école(s)).`);
}

function lcEtatEffectifs(lignes, annee) {
  const recues = lignes.filter((r) => r.liste);
  if (!recues.length) { toast('Aucune liste publiée.'); return; }
  const tot = recues.reduce((a, r) => ({ e: a.e + r.liste.effectif, f: a.f + r.liste.filles, g: a.g + r.liste.garcons }), { e: 0, f: 0, g: 0 });
  const th = (t) => `<th style="background:#eee;">${t}</th>`;
  const corps = lignes.map((r, i) => `<tr><td style="text-align:center;">${i + 1}</td><td>${esc(r.nom)}</td><td style="text-align:center;">${r.liste ? 'v' + r.liste.version : '—'}</td><td>${r.liste ? esc(lcDate(r.liste.created_at)) : '—'}</td>
    <td style="text-align:center;">${r.liste ? r.liste.filles : '—'}</td><td style="text-align:center;">${r.liste ? r.liste.garcons : '—'}</td><td style="text-align:center;font-weight:700;">${r.liste ? r.liste.effectif : '—'}</td><td>${esc(LC_STATUT_LISTE[r.statut].label)}</td></tr>`).join('');
  exPrint(`Effectifs des écoles — ${annee}`, `${exEnteteNiveau('État des effectifs des écoles', `CEB ${esc(currentUser.ceb || '')} — année scolaire ${esc(annee)} — ${recues.length} liste(s) publiée(s) sur ${lignes.length} école(s)`)}
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:11.5px;"><thead><tr>${['N°', 'École', 'Version', 'Publiée le', 'Filles', 'Garçons', 'Effectif', 'Statut'].map(th).join('')}</tr></thead><tbody>${corps}
    <tr style="font-weight:700;background:#f6f6f6;"><td colspan="4">TOTAL</td><td style="text-align:center;">${tot.f}</td><td style="text-align:center;">${tot.g}</td><td style="text-align:center;">${tot.e}</td><td></td></tr></tbody></table>
    ${exSignatures(['Le Chef de la CEB'])}`);
}

function lcAfficherDoublons(doublons) {
  openModal(`Doublons possibles entre écoles (${doublons.length})`, `
    <p class="text-soft" style="font-size:12.5px;">Élèves qui apparaissent dans plusieurs écoles de la circonscription (listes récupérées). Il peut s'agir d'un transfert non enregistré ou d'une erreur de saisie : à vérifier avec les directeurs.</p>
    <div class="table-wrap" style="max-height:55vh;overflow:auto;"><table class="table" style="font-size:12.5px;"><thead><tr><th>Élève</th><th>Critère</th><th>Écoles</th></tr></thead><tbody>
    ${doublons.map((d) => `<tr><td class="wrap" style="font-weight:600;">${esc(d.nom)}</td><td class="wrap">${esc(d.type)} <span class="text-soft">(${esc(d.detail)})</span></td><td class="wrap">${d.ecoles.map(esc).join(' · ')}</td></tr>`).join('')}</tbody></table></div>`,
    { wide: true, saveLabel: 'Fermer', onSave: async () => true });
}


/* ============================================================
   CEB : récupérer les candidats au CEP publiés par les écoles
   et les intégrer à la session de l'Espace Examen (sans doublon)
   ============================================================ */
async function lcRecupererCandidatsCEP(ctx) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  const supa = window.supaClient;
  if (!supa) { toast('Connexion au serveur indisponible : réessayez en ligne.'); return; }
  const { data, error } = await supa.from('listes_eleves').select('*').eq('type', 'cep').order('created_at', { ascending: false }).limit(500);
  if (error) { toast(lcMsgErreur(error)); return; }
  const annee = ctx.session.annee || '';
  const pool = (data || []).filter((d) => !annee || d.annee === annee);
  const derniere = new Map();
  pool.forEach((d) => { const c = derniere.get(d.ecole_id); if (!c || d.version > c.version) derniere.set(d.ecole_id, d); });
  const listes = [...derniere.values()].sort((a, b) => String(a.ecole_nom).localeCompare(String(b.ecole_nom), 'fr', { numeric: true }));
  if (!listes.length) { toast(`Aucune école n'a encore publié ses candidats${annee ? ' pour ' + annee : ''}.`); return; }
  const total = listes.reduce((s, d) => s + d.effectif, 0);
  if (!(await confirmDialog(`${listes.length} école(s) ont publié leurs candidats au CEP (${total} candidat(s) en tout). Les intégrer à la session « ${ctx.session.nom || annee} » ? Les candidats déjà présents ne seront pas dupliqués.`))) return;
  const rapport = [];
  const existants = [...ctx.candidats];
  const accuses = [];
  for (const d of listes) {
    const cands = Array.isArray(d.data) ? d.data : [];
    if (d.empreinte && (await lcEmpreinte(cands, LC_CLES_CEP)) !== d.empreinte && (await lcEmpreinte(cands, LC_CLES_CEP_ANCIEN)) !== d.empreinte) { rapport.push([d.ecole_nom, 'refusée : empreinte différente (liste altérée), demandez à l\'école de la republier']); continue; }
    const paquet = { ecole: { nom: d.ecole_nom }, candidats: cands.map((c) => ({ ...c, besoinsSpecifiques: c.besoins || '', handicap: !!c.handicap, bilingue: !!c.bilingue })) };
    const { ajouts, doublons, invalides } = exFusionInscriptions(existants, paquet);
    for (const c of ajouts) {
      const obj = {
        _uuid: genUuid(), sessionUuid: ctx.session._uuid, eleveUuid: c.eleveUuid || '', nom: c.nom, prenom: c.prenom, sexe: c.sexe === 'F' ? 'F' : 'M',
        dateNaissance: c.dateNaissance || '', lieuNaissance: c.lieuNaissance || '', matricule: c.matricule || '', ecole: d.ecole_nom,
        examens: EX_EXAMENS.includes(c.examens) ? c.examens : 'CEP seul',
        statut: 'inscrit', centreUuid: '', salle: '', numeroTable: '', anonymat: '', besoinsSpecifiques: c.besoinsSpecifiques || '', handicap: !!c.handicap, bilingue: !!c.bilingue
      };
      obj.id = await DB.add('examCandidats', obj);
      existants.push(obj);
    }
    accuses.push({ liste_id: d.id, statut: 'recue', traite_par: currentUser.id, traite_nom: currentUser.nom });
    rapport.push([d.ecole_nom, `v${d.version} : ${ajouts.length} ajouté(s)${doublons ? `, ${doublons} déjà présent(s)` : ''}${invalides ? `, ${invalides} invalide(s) ignoré(s)` : ''}`]);
  }
  // Accusé de réception (ne rétrograde jamais un statut déjà posé)
  if (accuses.length) await supa.from('listes_eleves_suivi').upsert(accuses, { onConflict: 'liste_id', ignoreDuplicates: true });
  openModal('Candidats publiés par les écoles', rapport.map(([n, m]) => `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><b>${esc(n)}</b><br>${esc(m)}</div>`).join('')
    + '<p class="text-soft" style="font-size:12px;margin-top:8px;">Pensez à relancer la répartition pour numéroter les nouveaux candidats.</p>', { saveLabel: 'Fermer', onSave: async () => { onRouteChange(); return true; } });
}
