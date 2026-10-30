/* ============================================================
   app-registre-matricule.js — Registre matricule (NOUVEAU MODULE)
   ------------------------------------------------------------
   Reprend les deux registres papier de l'école :
     1) « Registre matricule des élèves » (8 colonnes + observations)
     2) « Personnel enseignant » (13 colonnes)

   Principe de synchronisation : AUCUN magasin supplémentaire.
   Le registre est une VUE construite en direct à partir des dossiers
   « eleves » et « enseignants » (déjà synchronisés avec Supabase par
   db.js / supabase-sync.js). Les rubriques propres au registre
   (n° d'ordre, date d'entrée, date du CEP, date de sortie, carrière
   de l'enseignant…) sont stockées DANS ces mêmes dossiers : une
   modification faite dans le registre apparaît dans le dossier, et
   inversement, sur tous les appareils, sans aucun script SQL.

   Ce qui est repris automatiquement des autres rubriques :
     élèves      : nom, date de naissance, parents/tuteurs, profession,
                   domicile, date d'inscription (= entrée à l'école),
                   statut (sortie), redoublements, distinctions et
                   sanctions (Discipline), motif de transfert/abandon.
     enseignants : nom, classe tenue (Classes), congés et absences
                   (Présences enseignants), récompenses (Discipline).
   ============================================================ */

const RM_ETAT = { tab: 'eleves', q: '', classe: '', statut: '', annee: '' };
const RM_STATUT_LABEL = { actif: 'Actif', transfere: 'Transféré', abandon: 'Abandon', diplome: 'CEP obtenu' };

/* ---------------- Utilitaires ---------------- */
function rmAnneeDe(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return '';
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/* Prochain numéro d'ordre du registre (numérotation continue, jamais réutilisée) */
async function prochainNumeroOrdre() {
  const eleves = await DB.getAll('eleves');
  return eleves.reduce((m, e) => Math.max(m, Number(e.numeroOrdre) || 0), 0) + 1;
}

/* Appelée quand le statut d'un élève change (dossier, passage de classe, suivi des abandons) :
   date de sortie définitive posée automatiquement, retirée si l'élève redevient actif. */
function registreMajSortieEleve(eleve, ancienStatut) {
  const s = eleve.statut || 'actif';
  if (s === (ancienStatut || 'actif')) return eleve;
  if (s === 'actif') delete eleve.dateSortie;
  else if (!eleve.dateSortie) eleve.dateSortie = todayISO();
  return eleve;
}

function rmAutorise() { return typeof routeAutorisee === 'function' && routeAutorisee('#/registre-matricule'); }

/* ---------------- Construction des lignes ---------------- */
function rmObsAutoEleve(e, disc) {
  const parts = [];
  const statut = e.statut || 'actif';
  if (statut !== 'actif' && e.statutMotif) parts.push(`${RM_STATUT_LABEL[statut] || statut} : ${e.statutMotif}`);
  const red = (e.historiqueClasses || []).filter((h) => h.decision === 'redouble');
  if (red.length) parts.push('Redoublement : ' + red.map((h) => `${h.niveau || 'classe'}${h.anneeScolaire ? ' (' + h.anneeScolaire + ')' : ''}`).join(', '));
  const rec = disc.filter((d) => d.type === 'recompense');
  if (rec.length) {
    const motifs = rec.slice(0, 3).map((d) => d.motif).filter(Boolean);
    parts.push('Distinctions : ' + (motifs.length ? motifs.join(' ; ') : rec.length));
  }
  const nbSanc = disc.filter((d) => d.type === 'sanction').length, nbAv = disc.filter((d) => d.type === 'avertissement').length;
  if (nbSanc || nbAv) parts.push('Conduite : ' + [nbAv && `${nbAv} avertissement(s)`, nbSanc && `${nbSanc} sanction(s)`].filter(Boolean).join(', '));
  return parts;
}

function rmLigneEleve(e, classeMap, disc) {
  const statut = e.statut || 'actif';
  const entree = e.dateEntreeEcole || e.dateInscription || '';
  const parents = [e.pere && `Père : ${e.pere}`, e.mere && `Mère : ${e.mere}`, e.tuteur && `Tuteur : ${e.tuteur}`].filter(Boolean);
  const domicile = [e.adresse, e.village, e.secteur, e.commune].filter(Boolean).join(', ');
  return {
    e, id: e.id, numero: Number(e.numeroOrdre) || 0, nom: `${e.nom || ''} ${e.prenom || ''}`.trim(), matricule: e.matricule || '',
    dateNaissance: e.dateNaissance || '', parents, profession: e.professionParents || '', domicile,
    entree, cep: e.dateCEP || '', sortie: e.dateSortie || '', statut,
    cepAttendu: statut === 'diplome' && !e.dateCEP, sortieAttendue: statut !== 'actif' && !e.dateSortie,
    obsManuelle: e.observationsRegistre || '', obsAuto: rmObsAutoEleve(e, disc || []),
    classe: classeMap[e.classeId] || '', anneeEntree: rmAnneeDe(entree), doublon: false
  };
}

async function rmChargerEleves() {
  const [eleves, classes, discipline] = await Promise.all([DB.getAll('eleves'), DB.getAll('classes'), DB.getAll('discipline')]);
  const classeMap = Object.fromEntries(classes.map((c) => [c.id, c.nom]));
  const disc = {};
  discipline.filter((d) => d.cibleType === 'eleve').forEach((d) => { (disc[d.cibleId] = disc[d.cibleId] || []).push(d); });
  const lignes = eleves.map((e) => rmLigneEleve(e, classeMap, disc[e.id] || []));
  const compte = {};
  lignes.forEach((l) => { if (l.numero) compte[l.numero] = (compte[l.numero] || 0) + 1; });
  lignes.forEach((l) => { l.doublon = !!(l.numero && compte[l.numero] > 1); });
  lignes.sort((a, b) => (a.numero ? a.numero : 1e9) - (b.numero ? b.numero : 1e9) || a.nom.localeCompare(b.nom));
  return lignes;
}

function rmLigneEns(en, classes, pres, disc) {
  const classe = classes.find((c) => c.id === en.classeId) || classes.find((c) => c.enseignantId === en.id);
  const conges = pres.filter((p) => p.enseignantId === en.id && p.statut === 'conge').length;
  const abs = pres.filter((p) => p.enseignantId === en.id && p.statut === 'absent').length;
  return {
    en, id: en.id, nom: `${en.nom || ''} ${en.prenom || ''}`.trim(), matricule: en.matricule || '',
    naissance: [en.dateNaissance ? formatDate(en.dateNaissance) : '', en.lieuNaissance || ''].filter(Boolean).join(' à '),
    nominationCommune: en.dateNominationCommune || '', situation: en.situationAdmin || '', classe: classe ? classe.nom : '',
    serviceAnterieur: en.serviceAnterieurEleve || '', premiereNomination: en.datePremiereNomination || '',
    communes: en.communesExercees || '', interruptions: en.interruptions || '',
    interruptionsAuto: [conges && `${conges} jour(s) de congé enregistré(s)`, abs && `${abs} jour(s) d'absence enregistré(s)`].filter(Boolean),
    recompenses: en.recompenses || '',
    recompensesAuto: disc.filter((d) => d.cibleType === 'enseignant' && Number(d.cibleId) === en.id && d.type === 'recompense')
      .map((d) => `${d.motif || 'Distinction'}${d.date ? ' (' + formatDate(d.date) + ')' : ''}`),
    titres: en.titres || '', cessation: en.dateCessation || '', nouveauPoste: en.nouveauPoste || '', obs: en.observationsRegistre || ''
  };
}

async function rmChargerEns() {
  const [ens, classes, pres, disc] = await Promise.all([DB.getAll('enseignants'), DB.getAll('classes'), DB.getAll('presencesEnseignants'), DB.getAll('discipline')]);
  return ens.map((en) => rmLigneEns(en, classes, pres, disc)).sort((a, b) => a.nom.localeCompare(b.nom));
}

/* ---------------- Page ---------------- */
ROUTES['#/registre-matricule'] = async (root) => {
  const p = getHashParams().get('tab');
  if (p === 'eleves' || p === 'enseignants') RM_ETAT.tab = p;
  root.innerHTML = `<div class="tabs no-print" id="rm-tabs">
      <button class="tab" data-tab="eleves">Registre matricule des élèves</button>
      <button class="tab" data-tab="enseignants">Personnel enseignant</button>
    </div><div id="rm-contenu"></div>`;
  const montrer = async (t) => {
    RM_ETAT.tab = t;
    $all('.tab', $('#rm-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    const c = $('#rm-contenu');
    c.innerHTML = '<p class="text-soft">Chargement…</p>';
    await (t === 'eleves' ? rmRenderEleves(c) : rmRenderEns(c));
  };
  $('#rm-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) montrer(b.dataset.tab); };
  await montrer(RM_ETAT.tab);
};

const rmCelluleDate = (iso, attendu) => iso ? esc(formatDate(iso)) : (attendu ? '<em class="text-soft">à saisir</em>' : '—');

/* ---------------- Onglet élèves ---------------- */
async function rmRenderEleves(c) {
  const lignes = await rmChargerEleves();
  const sansNumero = lignes.filter((l) => !l.numero).length;
  const nbDoublons = new Set(lignes.filter((l) => l.doublon).map((l) => l.numero)).size;
  const classesDispo = [...new Set(lignes.map((l) => l.classe).filter(Boolean))].sort();
  const annees = [...new Set(lignes.map((l) => l.anneeEntree).filter(Boolean))].sort().reverse();
  const actifs = lignes.filter((l) => l.statut === 'actif').length;
  const cepN = lignes.filter((l) => l.cep || l.statut === 'diplome').length;

  c.innerHTML = `
    <div class="alert alert-vert">Registre construit en direct à partir des dossiers élèves : nom, naissance, parents, profession, domicile, statut, discipline… se mettent à jour tout seuls. Les rubriques propres au registre (n° d'ordre, entrée, CEP, sortie, observations) se saisissent ici ou dans le dossier de l'élève : c'est la même donnée.</div>
    ${sansNumero ? `<div class="alert alert-ocre">${sansNumero} élève(s) sans n° d'ordre. <button class="btn btn-sm no-print" id="rm-num" style="margin-left:8px;">Attribuer les numéros manquants</button></div>` : ''}
    ${nbDoublons ? `<div class="alert alert-terre">⚠ ${nbDoublons} numéro(s) d'ordre utilisé(s) plusieurs fois (saisie sur deux appareils hors ligne ?). Corrigez-les avec « Modifier ».</div>` : ''}
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Élèves inscrits au registre</div><div class="value">${lignes.length}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Actuellement à l'école</div><div class="value">${actifs}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Sortis (transfert, abandon, CEP)</div><div class="value">${lignes.length - actifs}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">CEP obtenus</div><div class="value">${cepN}</div></div>
    </div>
    <div class="table-toolbar">
      <input class="search-input" id="rm-q" placeholder="Rechercher (nom, matricule, n°, parent)…" value="${esc(RM_ETAT.q)}">
      <select id="rm-classe" class="search-input" style="min-width:120px;"><option value="">Toutes classes</option>${classesDispo.map((x) => `<option ${RM_ETAT.classe === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select id="rm-statut" class="search-input" style="min-width:120px;"><option value="">Tous statuts</option>${Object.entries(RM_STATUT_LABEL).map(([k, v]) => `<option value="${k}" ${RM_ETAT.statut === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="rm-annee" class="search-input" style="min-width:120px;"><option value="">Toutes années d'entrée</option>${annees.map((x) => `<option ${RM_ETAT.annee === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="rm-print">Imprimer / PDF</button>
      <button class="btn btn-sm" id="rm-csv">Excel (CSV)</button>
      <button class="btn btn-sm" id="rm-word">Word (.doc)</button>
    </div>
    <div id="rm-liste"></div>`;

  let liste = lignes;
  const rendre = () => {
    RM_ETAT.q = $('#rm-q').value; RM_ETAT.classe = $('#rm-classe').value; RM_ETAT.statut = $('#rm-statut').value; RM_ETAT.annee = $('#rm-annee').value;
    const q = RM_ETAT.q.toLowerCase();
    liste = lignes.filter((l) => (!RM_ETAT.classe || l.classe === RM_ETAT.classe) && (!RM_ETAT.statut || l.statut === RM_ETAT.statut) && (!RM_ETAT.annee || l.anneeEntree === RM_ETAT.annee)
      && (!q || `${l.numero} ${l.nom} ${l.matricule} ${l.parents.join(' ')}`.toLowerCase().includes(q)));
    $('#rm-liste').innerHTML = liste.length ? `<div class="table-wrap"><table style="font-size:12.5px;"><thead><tr>
      <th>N° d'ordre</th><th>Noms et prénoms des élèves</th><th>Date de naissance</th><th>Parents ou tuteurs</th><th>Profession et domicile</th>
      <th>Entrée à l'école</th><th>Obtention du CEP</th><th>Sortie définitive</th><th>Observations</th><th></th></tr></thead>
      <tbody>${liste.map((l) => `<tr>
        <td style="text-align:center;font-weight:700;">${l.numero || '<span class="text-soft">—</span>'}${l.doublon ? ' <span class="badge badge-terre" title="Numéro utilisé plusieurs fois">double</span>' : ''}</td>
        <td class="wrap"><strong>${esc(l.nom)}</strong><div class="text-soft" style="font-size:11px;">${[l.matricule, l.classe || '—'].filter(Boolean).map(esc).join(' · ')} · ${badgeStatutEleve(l.statut)}</div></td>
        <td>${rmCelluleDate(l.dateNaissance)}</td>
        <td class="wrap">${l.parents.length ? l.parents.map(esc).join('<br>') : '—'}</td>
        <td class="wrap">${esc(l.profession) || '—'}${l.domicile ? `<div class="text-soft" style="font-size:11px;">${esc(l.domicile)}</div>` : ''}</td>
        <td>${rmCelluleDate(l.entree)}</td>
        <td>${rmCelluleDate(l.cep, l.cepAttendu)}</td>
        <td>${rmCelluleDate(l.sortie, l.sortieAttendue)}</td>
        <td class="wrap">${esc(l.obsManuelle)}${l.obsAuto.length ? `<div class="text-soft" style="font-size:11px;">${l.obsAuto.map(esc).join(' · ')}</div>` : ''}</td>
        <td class="no-print"><button class="btn btn-sm" onclick="rmModifierEleve(${l.id})">Modifier</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">Aucun élève ne correspond.</div>';
  };
  ['#rm-q'].forEach((s) => { $(s).oninput = rendre; });
  ['#rm-classe', '#rm-statut', '#rm-annee'].forEach((s) => { $(s).onchange = rendre; });
  rendre();
  if ($('#rm-num')) $('#rm-num').onclick = rmAttribuerNumeros;
  $('#rm-print').onclick = () => printDocument('Registre matricule des élèves', rmHtmlEleves(liste));
  $('#rm-word').onclick = () => exportWordDoc('registre-matricule-eleves.doc', 'Registre matricule des élèves', rmHtmlEleves(liste));
  $('#rm-csv').onclick = () => download('registre-matricule-eleves.csv', toCSV(liste, [
    { label: "N° d'ordre", value: 'numero' }, { label: 'Matricule', value: 'matricule' }, { label: 'Noms et prénoms', value: 'nom' },
    { label: 'Date de naissance', value: 'dateNaissance' }, { label: 'Parents ou tuteurs', value: (l) => l.parents.join(' ; ') },
    { label: 'Profession des parents', value: 'profession' }, { label: 'Domicile', value: 'domicile' },
    { label: "Date d'entrée à l'école", value: 'entree' }, { label: 'Date du CEP', value: 'cep' }, { label: 'Date de sortie définitive', value: 'sortie' },
    { label: 'Statut', value: (l) => RM_STATUT_LABEL[l.statut] || l.statut }, { label: 'Classe', value: 'classe' },
    { label: 'Observations', value: (l) => [l.obsManuelle, ...l.obsAuto].filter(Boolean).join(' · ') }
  ]), 'text/csv;charset=utf-8');
}

function rmHtmlEleves(liste) {
  const th = ["N° d'ordre<br>(1)", 'Noms et prénoms des élèves<br>(2)', 'Date de naissance<br>(3)', 'Noms et prénoms des parents ou tuteurs<br>(4)',
    'Profession et domicile des parents ou tuteurs<br>(5)', "Date de l'entrée à l'école<br>(6)", "Date de l'obtention du C.E.P.<br>(7)", "Date de sortie définitive de l'école<br>(8)", 'Observations'];
  return `<h3 style="text-align:center;">REGISTRE MATRICULE DES ÉLÈVES</h3>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:11px;">
      <thead><tr>${th.map((t) => `<th>${t}</th>`).join('')}</tr></thead>
      <tbody>${liste.map((l) => `<tr>
        <td style="text-align:center;">${l.numero || ''}</td><td>${esc(l.nom)}</td><td>${l.dateNaissance ? esc(formatDate(l.dateNaissance)) : ''}</td>
        <td>${l.parents.map(esc).join('<br>')}</td><td>${esc(l.profession)}${l.domicile ? '<br>' + esc(l.domicile) : ''}</td>
        <td>${l.entree ? esc(formatDate(l.entree)) : ''}</td><td>${l.cep ? esc(formatDate(l.cep)) : ''}</td><td>${l.sortie ? esc(formatDate(l.sortie)) : ''}</td>
        <td>${[l.obsManuelle, ...l.obsAuto].filter(Boolean).map(esc).join('<br>')}</td></tr>`).join('') || '<tr><td colspan="9">Aucun élève</td></tr>'}</tbody></table>`;
}

async function rmAttribuerNumeros() {
  const eleves = await DB.getAll('eleves');
  const sans = eleves.filter((e) => !Number(e.numeroOrdre));
  if (!sans.length) return;
  if (!(await confirmDialog(`Attribuer un n° d'ordre à ${sans.length} élève(s) qui n'en ont pas, par date d'entrée puis ordre alphabétique ? À faire depuis un seul appareil, une seule fois (les numéros se synchronisent ensuite).`))) return;
  const cle = (e) => String(e.dateEntreeEcole || e.dateInscription || '9999');
  sans.sort((a, b) => cle(a).localeCompare(cle(b)) || (a.nom || '').localeCompare(b.nom || '') || (a.prenom || '').localeCompare(b.prenom || ''));
  let n = eleves.reduce((m, e) => Math.max(m, Number(e.numeroOrdre) || 0), 0);
  for (const e of sans) { e.numeroOrdre = ++n; await DB.put('eleves', e); }
  toast(`${sans.length} numéro(s) attribué(s).`);
  onRouteChange();
}

/* ---------------- Fiche registre d'un élève ---------------- */
async function rmModifierEleve(id) {
  if (!rmAutorise()) { toast("Votre profil n'a pas accès au registre matricule."); return; }
  const e = await DB.get('eleves', id);
  if (!e) return;
  const [classes, discipline] = await Promise.all([DB.getAll('classes'), DB.getAll('discipline')]);
  const l = rmLigneEleve(e, Object.fromEntries(classes.map((c) => [c.id, c.nom])), discipline.filter((d) => d.cibleType === 'eleve' && Number(d.cibleId) === id));
  const f = (k) => esc(e[k] || '');
  openModal(`Registre matricule — ${l.nom}`, `
    <div class="alert alert-vert" style="margin-bottom:12px;">
      <strong>${esc(l.nom)}</strong> — ${esc(l.classe || 'sans classe')} — né(e) le ${rmCelluleDate(l.dateNaissance)} — statut : ${esc(RM_STATUT_LABEL[l.statut])}<br>
      <span class="text-soft">${l.parents.length ? esc(l.parents.join(' · ')) : 'Parents non renseignés'}${l.profession ? ' — ' + esc(l.profession) : ''}</span><br>
      <span class="text-soft">Ces informations viennent du dossier de l'élève.</span>
      <button class="btn btn-sm" id="rm-dossier" style="margin-left:6px;">Ouvrir le dossier</button>
      <button class="btn btn-sm" id="rm-statut-btn">Changer le statut</button>
    </div>
    <div class="form-grid">
      <div class="field"><label>N° d'ordre</label><input type="number" min="1" id="rm-numero" value="${l.numero || ''}"></div>
      <div class="field"><label>Date de l'entrée à l'école</label><input type="date" id="rm-entree" value="${esc(l.entree)}"><small>Par défaut : date d'inscription du dossier.</small></div>
      <div class="field"><label>Date de l'obtention du C.E.P.</label><input type="date" id="rm-cep" value="${f('dateCEP')}"></div>
      <div class="field"><label>Date de sortie définitive de l'école</label><input type="date" id="rm-sortie" value="${f('dateSortie')}"><small>Posée automatiquement quand le statut passe à transféré, abandon ou CEP obtenu.</small></div>
      <div class="field full"><label>Observations (succès, aptitudes, conduite, école de destination…)</label><textarea id="rm-obs">${f('observationsRegistre')}</textarea>
        ${l.obsAuto.length ? `<small>Ajouté automatiquement : ${esc(l.obsAuto.join(' · '))}</small>` : ''}</div>
    </div>`, {
    wide: true,
    onSave: async (ov) => {
      const txt = $('#rm-numero', ov).value.trim();
      const numero = txt === '' ? 0 : Number(txt);
      if (txt !== '' && (!Number.isInteger(numero) || numero < 1)) { toast("Le n° d'ordre doit être un entier positif."); return false; }
      const tous = await DB.getAll('eleves');
      const autre = numero ? tous.find((x) => x.id !== id && Number(x.numeroOrdre) === numero) : null;
      if (autre) { toast(`Le n° ${numero} est déjà attribué à ${autre.nom} ${autre.prenom}.`); return false; }
      const entree = $('#rm-entree', ov).value, cep = $('#rm-cep', ov).value, sortie = $('#rm-sortie', ov).value;
      if (entree && sortie && sortie < entree) { toast("La date de sortie ne peut pas précéder la date d'entrée."); return false; }
      if (entree && cep && cep < entree) { toast("La date du CEP ne peut pas précéder la date d'entrée."); return false; }
      const frais = await DB.get('eleves', id); // dossier à jour (une synchro a pu arriver entre-temps)
      const poser = (k, v) => { if (v) frais[k] = v; else delete frais[k]; };
      poser('numeroOrdre', numero || '');
      poser('dateEntreeEcole', entree && entree !== (frais.dateInscription || '') ? entree : '');
      poser('dateCEP', cep); poser('dateSortie', sortie);
      poser('observationsRegistre', $('#rm-obs', ov).value.trim());
      await DB.put('eleves', frais);
      toast('Registre mis à jour — dossier élève synchronisé.');
      onRouteChange();
      return true;
    }
  });
  $('#rm-dossier').onclick = () => { closeModal(); location.hash = `#/eleves?id=${id}`; };
  $('#rm-statut-btn').onclick = () => { closeModal(); openStatutEleve(id); };
}

/* ---------------- Onglet personnel enseignant ---------------- */
async function rmRenderEns(c) {
  const lignes = await rmChargerEns();
  c.innerHTML = `
    <div class="alert alert-vert">Nom, classe tenue, congés/absences (Présences enseignants) et récompenses (Discipline) viennent des autres rubriques. La carrière (nominations, titres, interruptions…) se saisit avec « Modifier ».</div>
    <div class="table-toolbar">
      <input class="search-input" id="rm-q" placeholder="Rechercher un enseignant…" value="${esc(RM_ETAT.q)}">
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="rm-print">Imprimer / PDF</button>
      <button class="btn btn-sm" id="rm-csv">Excel (CSV)</button>
      <button class="btn btn-sm" id="rm-word">Word (.doc)</button>
    </div>
    <div id="rm-liste"></div>`;
  let liste = lignes;
  const rendre = () => {
    RM_ETAT.q = $('#rm-q').value;
    const q = RM_ETAT.q.toLowerCase();
    liste = lignes.filter((l) => !q || `${l.nom} ${l.matricule} ${l.classe}`.toLowerCase().includes(q));
    $('#rm-liste').innerHTML = liste.length ? `<div class="table-wrap"><table style="font-size:12px;"><thead><tr>
      <th>Noms et prénoms</th><th>Date et lieu de naissance</th><th>Nomination dans la Commune</th><th>T / S</th><th>Classe</th><th>Service antérieur (élève à l'école de)</th>
      <th>1re nomination dans l'enseignement</th><th>Communes successives</th><th>Interruptions de service</th><th>Récompenses</th><th>Titres de capacité</th><th>Cessation de fonctions / nouveau poste</th><th>Observations</th><th></th></tr></thead>
      <tbody>${liste.map((l) => `<tr>
        <td class="wrap"><strong>${esc(l.nom)}</strong>${l.matricule ? `<div class="text-soft" style="font-size:11px;">${esc(l.matricule)}</div>` : ''}</td>
        <td class="wrap">${esc(l.naissance) || '—'}</td><td>${rmCelluleDate(l.nominationCommune)}</td>
        <td style="text-align:center;">${esc(l.situation) || '—'}</td><td>${esc(l.classe) || '—'}</td><td class="wrap">${esc(l.serviceAnterieur) || '—'}</td>
        <td>${rmCelluleDate(l.premiereNomination)}</td><td class="wrap">${esc(l.communes) || '—'}</td>
        <td class="wrap">${esc(l.interruptions)}${l.interruptionsAuto.length ? `<div class="text-soft" style="font-size:11px;">${l.interruptionsAuto.map(esc).join(' · ')}</div>` : (l.interruptions ? '' : '—')}</td>
        <td class="wrap">${esc(l.recompenses)}${l.recompensesAuto.length ? `<div class="text-soft" style="font-size:11px;">${l.recompensesAuto.map(esc).join(' · ')}</div>` : (l.recompenses ? '' : '—')}</td>
        <td class="wrap">${esc(l.titres) || '—'}</td>
        <td class="wrap">${[l.cessation ? formatDate(l.cessation) : '', l.nouveauPoste].filter(Boolean).map(esc).join(' — ') || '—'}</td>
        <td class="wrap">${esc(l.obs) || '—'}</td>
        <td class="no-print"><button class="btn btn-sm" onclick="rmModifierEns(${l.id})">Modifier</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty-state">Aucun enseignant enregistré. Ajoutez-les dans « Enseignants ».</div>';
  };
  $('#rm-q').oninput = rendre;
  rendre();
  $('#rm-print').onclick = () => printDocument('Personnel enseignant', rmHtmlEns(liste));
  $('#rm-word').onclick = () => exportWordDoc('registre-personnel-enseignant.doc', 'Personnel enseignant', rmHtmlEns(liste));
  $('#rm-csv').onclick = () => download('registre-personnel-enseignant.csv', toCSV(liste, [
    { label: 'Matricule', value: 'matricule' }, { label: 'Noms et prénoms', value: 'nom' }, { label: 'Date et lieu de naissance', value: 'naissance' },
    { label: 'Nomination dans la Commune', value: 'nominationCommune' }, { label: 'Titulaire (T) / Stagiaire (S)', value: 'situation' }, { label: 'Classe', value: 'classe' },
    { label: 'Service antérieur', value: 'serviceAnterieur' }, { label: 'Première nomination', value: 'premiereNomination' }, { label: 'Communes successives', value: 'communes' },
    { label: 'Interruptions de service', value: (l) => [l.interruptions, ...l.interruptionsAuto].filter(Boolean).join(' ; ') },
    { label: 'Récompenses', value: (l) => [l.recompenses, ...l.recompensesAuto].filter(Boolean).join(' ; ') },
    { label: 'Titres de capacité', value: 'titres' }, { label: 'Date de cessation', value: 'cessation' }, { label: 'Nouveau poste', value: 'nouveauPoste' }, { label: 'Observations', value: 'obs' }
  ]), 'text/csv;charset=utf-8');
}

function rmHtmlEns(liste) {
  const th = ['Noms et prénoms<br>(1)', 'Date et lieu de naissance<br>(2)', 'Date de la nomination dans la Commune<br>(3)', 'Titulaire (T) ou stagiaire (S)<br>(4)', 'Classe<br>(5)',
    "Service antérieur : élève à l'école de (dates entrée et sortie)<br>(6)", "Date de la première nomination dans l'enseignement<br>(7)", 'Communes dans lesquelles le fonctionnaire a successivement exercé<br>(8)',
    'Interruptions de service (causes et durées)<br>(9)', 'Récompenses obtenues<br>(10)', 'Titres de capacité (diplômes et dates de délivrance)<br>(11)',
    'Date de cessation de fonctions dans la Commune et nouveau poste<br>(12)', 'Observations<br>(13)'];
  const cell = (v, auto) => [v, ...(auto || [])].filter(Boolean).map(esc).join('<br>');
  return `<h3 style="text-align:center;">PERSONNEL ENSEIGNANT</h3>
    <table border="1" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:10px;">
      <thead><tr>${th.map((t) => `<th>${t}</th>`).join('')}</tr></thead>
      <tbody>${liste.map((l) => `<tr><td>${esc(l.nom)}</td><td>${esc(l.naissance)}</td><td>${l.nominationCommune ? esc(formatDate(l.nominationCommune)) : ''}</td>
        <td style="text-align:center;">${esc(l.situation)}</td><td>${esc(l.classe)}</td><td>${esc(l.serviceAnterieur)}</td><td>${l.premiereNomination ? esc(formatDate(l.premiereNomination)) : ''}</td>
        <td>${esc(l.communes)}</td><td>${cell(l.interruptions, l.interruptionsAuto)}</td><td>${cell(l.recompenses, l.recompensesAuto)}</td><td>${esc(l.titres)}</td>
        <td>${[l.cessation ? formatDate(l.cessation) : '', l.nouveauPoste].filter(Boolean).map(esc).join('<br>')}</td><td>${esc(l.obs)}</td></tr>`).join('') || '<tr><td colspan="13">Aucun enseignant</td></tr>'}</tbody></table>`;
}

/* ---------------- Fiche registre d'un enseignant ---------------- */
async function rmModifierEns(id) {
  if (!rmAutorise()) { toast("Votre profil n'a pas accès au registre matricule."); return; }
  const en = await DB.get('enseignants', id);
  if (!en) return;
  const [classes, pres, disc] = await Promise.all([DB.getAll('classes'), DB.getAll('presencesEnseignants'), DB.getAll('discipline')]);
  const l = rmLigneEns(en, classes, pres, disc);
  const f = (k) => esc(en[k] || '');
  openModal(`Personnel enseignant — ${l.nom}`, `
    <div class="alert alert-vert" style="margin-bottom:12px;"><strong>${esc(l.nom)}</strong> — classe tenue : ${esc(l.classe || 'non affecté')}<br>
      <span class="text-soft">Nom et classe viennent du dossier enseignant et de « Classes ».</span>
      <button class="btn btn-sm" id="rm-dossier" style="margin-left:6px;">Ouvrir le dossier</button></div>
    <div class="form-grid">
      <div class="field"><label>Date de naissance</label><input type="date" id="rm-dn" value="${f('dateNaissance')}"></div>
      <div class="field"><label>Lieu de naissance</label><input id="rm-ln" value="${f('lieuNaissance')}"></div>
      <div class="field"><label>Date de la nomination dans la Commune</label><input type="date" id="rm-nc" value="${f('dateNominationCommune')}">
        ${en.datePriseService && !en.dateNominationCommune ? `<small><button type="button" class="btn btn-sm" id="rm-reprise">Reprendre la prise de service (${esc(formatDate(en.datePriseService))})</button></small>` : ''}</div>
      <div class="field"><label>Titulaire (T) ou stagiaire (S)</label><select id="rm-ts"><option value="">—</option><option value="T" ${en.situationAdmin === 'T' ? 'selected' : ''}>Titulaire (T)</option><option value="S" ${en.situationAdmin === 'S' ? 'selected' : ''}>Stagiaire (S)</option></select></div>
      <div class="field full"><label>Service antérieur — élève à l'école de (dates d'entrée et de sortie)</label><input id="rm-sa" value="${f('serviceAnterieurEleve')}"></div>
      <div class="field"><label>Date de la première nomination dans l'enseignement</label><input type="date" id="rm-pn" value="${f('datePremiereNomination')}"></div>
      <div class="field"><label>Date de cessation de fonctions dans la Commune</label><input type="date" id="rm-dc" value="${f('dateCessation')}"></div>
      <div class="field full"><label>Nouveau poste (si cessation)</label><input id="rm-np" value="${f('nouveauPoste')}"></div>
      <div class="field full"><label>Communes dans lesquelles il a successivement exercé (avec la date de chaque nomination)</label><textarea id="rm-co">${f('communesExercees')}</textarea></div>
      <div class="field full"><label>Interruptions de service (causes et durées)</label><textarea id="rm-in">${f('interruptions')}</textarea>
        ${l.interruptionsAuto.length ? `<small>Ajouté automatiquement (Présences enseignants) : ${esc(l.interruptionsAuto.join(' · '))}</small>` : ''}</div>
      <div class="field full"><label>Récompenses obtenues</label><textarea id="rm-re">${f('recompenses')}</textarea>
        ${l.recompensesAuto.length ? `<small>Ajouté automatiquement (Discipline) : ${esc(l.recompensesAuto.join(' · '))}</small>` : ''}</div>
      <div class="field full"><label>Titres de capacité (nature des diplômes et date de délivrance)</label><textarea id="rm-ti">${f('titres')}</textarea></div>
      <div class="field full"><label>Observations</label><textarea id="rm-ob">${f('observationsRegistre')}</textarea></div>
    </div>`, {
    wide: true,
    onSave: async (ov) => {
      const frais = await DB.get('enseignants', id);
      const poser = (k, sel) => { const v = $(sel, ov).value.trim(); if (v) frais[k] = v; else delete frais[k]; };
      poser('dateNaissance', '#rm-dn'); poser('lieuNaissance', '#rm-ln'); poser('dateNominationCommune', '#rm-nc'); poser('situationAdmin', '#rm-ts');
      poser('serviceAnterieurEleve', '#rm-sa'); poser('datePremiereNomination', '#rm-pn'); poser('dateCessation', '#rm-dc'); poser('nouveauPoste', '#rm-np');
      poser('communesExercees', '#rm-co'); poser('interruptions', '#rm-in'); poser('recompenses', '#rm-re'); poser('titres', '#rm-ti'); poser('observationsRegistre', '#rm-ob');
      await DB.put('enseignants', frais);
      toast('Registre mis à jour — dossier enseignant synchronisé.');
      onRouteChange();
      return true;
    }
  });
  $('#rm-dossier').onclick = () => { closeModal(); location.hash = `#/enseignants?id=${id}`; };
  if ($('#rm-reprise')) $('#rm-reprise').onclick = () => { $('#rm-nc').value = en.datePriseService; };
}
