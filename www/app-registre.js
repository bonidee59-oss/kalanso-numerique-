/* ============================================================
   app-registre.js — Registre d'appel journalier (NOUVEAU MODULE)
   ------------------------------------------------------------
   Ce module est entièrement additif : il n'altère aucune fonction
   existante. Il réutilise le même magasin IndexedDB "presencesEleves"
   que le module Présences, ce qui garantit une synchronisation
   automatique avec :
     - le Tableau de bord (statistiques du jour, alertes)
     - le dossier de chaque élève (onglet "Présences")
     - la fiche de classe (taux de présence, cahier d'appel)
     - le suivi des abandons et les Rapports automatiques
   sans qu'aucune de ces vues n'ait besoin d'être modifiée : elles
   lisent déjà "presencesEleves" en direct.
   ============================================================ */

const REGISTRE_STATUTS = [
  { value: 'present', label: 'Présent' },
  { value: 'absent_justifie', label: 'Absent justifié' },
  { value: 'absent_non_justifie', label: 'Absent non justifié' },
  { value: 'retard', label: 'Retard' },
  { value: 'malade', label: 'Malade' }
];

ROUTES['#/registre-appel'] = async (root) => {
  const classes = await classeOptions();
  root.innerHTML = `
    <div class="alert alert-vert">Registre synchronisé automatiquement avec les dossiers élèves, le tableau de bord et les rapports.</div>
    <div class="table-toolbar">
      <select id="ra-classe" class="search-input">${classes.length ? classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('') : '<option value="">Aucune classe</option>'}</select>
      <input type="date" id="ra-date" class="search-input" value="${todayISO()}">
      <input class="search-input" id="ra-search" placeholder="Rechercher un élève (nom, matricule)…">
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="ra-print">Imprimer / PDF</button>
      <button class="btn btn-sm" id="ra-csv">Excel (CSV)</button>
      <button class="btn btn-sm" id="ra-word">Word (.doc)</button>
      <button class="btn btn-sm" id="ra-mensuel">📊 Rapport mensuel</button>
      <button class="btn btn-sm" id="ra-ferie">📅 Jour non travaillé</button>
    </div>
    <div id="ra-jour-ferie-banner"></div>
    <div id="ra-summary" class="grid grid-4" style="margin-bottom:14px;"></div>
    <div id="ra-list"></div>`;

  let currentList = []; // conservé pour l'impression / l'export après chargement

  const load = async () => {
    const classeId = Number($('#ra-classe').value);
    const date = $('#ra-date').value;
    if (!classeId || !date) { $('#ra-list').innerHTML = `<div class="empty-state">Sélectionnez une classe et une date.</div>`; return; }

    // Un jour non travaillé (férié, événement, enseignant absent…) bloque la saisie de
    // l'appel pour ce jour-là, sur toute l'école ou juste cette classe selon ce qui a été déclaré.
    const joursNT = (await DB.getAll('joursNonTravailles')).filter((j) => j.date === date && (j.portee === 'ecole' || j.classeId === classeId));
    if (joursNT.length) {
      const j = joursNT[0];
      $('#ra-jour-ferie-banner').innerHTML = `<div class="alert alert-ocre">📅 <strong>Jour non travaillé</strong> (${j.portee === 'ecole' ? "toute l'école" : 'cette classe'}) — ${esc(j.motif || 'sans précision')}. L'appel n'est pas comptabilisé pour cette date. <button class="btn btn-sm no-print" id="ra-annuler-ferie" style="margin-left:8px;">Annuler</button></div>`;
      $('#ra-annuler-ferie').onclick = async () => { if (await confirmDialog('Annuler la déclaration « jour non travaillé » pour cette date ?')) { await DB.delete('joursNonTravailles', j.id); toast('Jour non travaillé annulé.'); load(); } };
      $('#ra-list').innerHTML = '';
      $('#ra-summary').innerHTML = '';
      return;
    }
    $('#ra-jour-ferie-banner').innerHTML = '';

    const [eleves, presencesAll, classe] = await Promise.all([DB.getAll('eleves'), DB.getAll('presencesEleves'), DB.get('classes', classeId)]);
    // Toujours reconstruit depuis la base : un élève ajouté, transféré ou radié
    // apparaît/disparaît automatiquement, sans aucune mise à jour manuelle.
    const eleveActifs = eleves.filter((e) => e.classeId === classeId && (e.statut || 'actif') === 'actif').sort((a, b) => a.nom.localeCompare(b.nom));
    const existing = Object.fromEntries(presencesAll.filter((p) => p.classeId === classeId && p.date === date).map((p) => [p.eleveId, p]));
    const since14 = Date.now() - 14 * 86400000;

    const q = ($('#ra-search').value || '').toLowerCase();
    currentList = eleveActifs.filter((e) => !q || `${e.nom} ${e.prenom} ${e.matricule}`.toLowerCase().includes(q)).map((e) => {
      const absences14 = presencesAll.filter((p) => p.eleveId === e.id && isPresenceAbsente(p.statut) && new Date(p.date).getTime() >= since14).length;
      return { eleve: e, cur: existing[e.id] || {}, risque: absences14 >= 3, absences14 };
    });

    $('#ra-list').innerHTML = currentList.length ? `
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Élève</th><th>Matricule</th><th>Statut</th><th>Motif / observation</th><th>Risque</th></tr></thead>
      <tbody>${currentList.map(({ eleve: e, cur, risque, absences14 }) => `<tr data-eleve="${e.id}">
        <td>${esc(e.nom)} ${esc(e.prenom)}</td>
        <td>${esc(e.matricule)}</td>
        <td><select class="ra-statut">${REGISTRE_STATUTS.map((s) => `<option value="${s.value}" ${(cur.statut === s.value) || (!cur.statut && s.value === 'present') || (cur.statut === 'absent' && s.value === 'absent_non_justifie') ? 'selected' : ''}>${s.label}</option>`).join('')}</select></td>
        <td><input class="ra-motif" style="width:100%;" value="${esc(cur.motif || '')}" placeholder="Motif si absence/maladie"></td>
        <td>${risque ? `<button class="btn btn-sm btn-danger no-print" title="${absences14} absence(s) sur 14 jours" onclick="openSuiviAbandon(${e.id})">⚠ À risque</button>` : '<span class="text-soft">—</span>'}</td>
      </tr>`).join('')}</tbody></table></div>
      <button class="btn btn-primary no-print" id="ra-save" style="margin-top:12px;">Enregistrer l'appel</button>
      </div>` : `<div class="empty-state">Aucun élève actif ${q ? 'ne correspond à la recherche' : "dans cette classe"}.</div>`;

    updateSummary();
    $all('.ra-statut').forEach((s) => s.onchange = updateSummary);
    const saveBtn = $('#ra-save');
    if (saveBtn) saveBtn.onclick = async () => {
      const rows = $all('tr[data-eleve]');
      for (const r of rows) {
        const eleveId = Number(r.dataset.eleve);
        const statut = $('.ra-statut', r).value;
        const motif = $('.ra-motif', r).value;
        const prev = existing[eleveId];
        const obj = { id: prev ? prev.id : undefined, eleveId, classeId, date, statut, motif };
        if (prev) await DB.put('presencesEleves', obj); else { delete obj.id; await DB.add('presencesEleves', obj); }
      }
      toast("Registre d'appel enregistré — historiques élèves, tableau de bord et rapports mis à jour.");
      load();
    };

    function updateSummary() {
      const statuses = $all('.ra-statut').map((s) => s.value);
      const compte = (v) => statuses.filter((s) => s === v).length;
      $('#ra-summary').innerHTML = `
        <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Présents</div><div class="value">${compte('present')}</div></div>
        <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Absents (justifiés + non justifiés)</div><div class="value">${compte('absent_justifie') + compte('absent_non_justifie')}</div></div>
        <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Retards</div><div class="value">${compte('retard')}</div></div>
        <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Malades</div><div class="value">${compte('malade')}</div></div>`;
    }
  };

  $('#ra-classe').onchange = load;
  $('#ra-date').onchange = load;
  $('#ra-search').oninput = load;
  $('#ra-print').onclick = () => imprimerRegistre();
  $('#ra-csv').onclick = () => exporterRegistreCSV();
  $('#ra-word').onclick = () => exporterRegistreWord();
  $('#ra-mensuel').onclick = () => { const cid = Number($('#ra-classe').value) || ''; location.hash = `#/registre-mensuel?classeId=${cid}`; };
  $('#ra-ferie').onclick = () => openJourNonTravailleForm(classes, $('#ra-date').value, Number($('#ra-classe').value), load);

  async function imprimerRegistre() {
    const classeId = Number($('#ra-classe').value);
    const classe = classeId ? await DB.get('classes', classeId) : null;
    const date = $('#ra-date').value;
    const rows = currentList.map(({ eleve: e }, i) => {
      const rowEl = $all('tr[data-eleve]')[i];
      const statut = rowEl ? labelPresenceStatut($('.ra-statut', rowEl).value) : '';
      const motif = rowEl ? $('.ra-motif', rowEl).value : '';
      return `<tr><td>${esc(e.matricule)}</td><td>${esc(e.nom)} ${esc(e.prenom)}</td><td>${esc(statut)}</td><td>${esc(motif)}</td></tr>`;
    }).join('');
    printDocument(`Registre d'appel — ${classe ? classe.nom : ''} — ${formatDate(date)}`, `
      <h3 style="text-align:center;">REGISTRE D'APPEL JOURNALIER</h3>
      <p><strong>Classe :</strong> ${classe ? esc(classe.nom) : ''} &nbsp; <strong>Date :</strong> ${formatDate(date)}</p>
      <table style="width:100%;" border="1" cellpadding="6">
        <thead><tr><th>Matricule</th><th>Nom & prénom</th><th>Statut</th><th>Motif</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4">Aucun élève</td></tr>'}</tbody>
      </table>`);
  }

  function exporterRegistreCSV() {
    const date = $('#ra-date').value;
    const rows = currentList.map(({ eleve: e }, i) => {
      const rowEl = $all('tr[data-eleve]')[i];
      return { matricule: e.matricule, nom: e.nom, prenom: e.prenom, statut: rowEl ? labelPresenceStatut($('.ra-statut', rowEl).value) : '', motif: rowEl ? $('.ra-motif', rowEl).value : '' };
    });
    const csv = toCSV(rows, [
      { label: 'Matricule', value: 'matricule' }, { label: 'Nom', value: 'nom' }, { label: 'Prénom', value: 'prenom' },
      { label: 'Statut', value: 'statut' }, { label: 'Motif', value: 'motif' }
    ]);
    download(`registre-appel-${date}.csv`, csv, 'text/csv;charset=utf-8');
  }

  async function exporterRegistreWord() {
    const classeId = Number($('#ra-classe').value);
    const classe = classeId ? await DB.get('classes', classeId) : null;
    const date = $('#ra-date').value;
    const rows = currentList.map(({ eleve: e }, i) => {
      const rowEl = $all('tr[data-eleve]')[i];
      const statut = rowEl ? labelPresenceStatut($('.ra-statut', rowEl).value) : '';
      const motif = rowEl ? $('.ra-motif', rowEl).value : '';
      return `<tr><td>${esc(e.matricule)}</td><td>${esc(e.nom)} ${esc(e.prenom)}</td><td>${esc(statut)}</td><td>${esc(motif)}</td></tr>`;
    }).join('');
    const bodyHtml = `<h2 style="text-align:center;">Registre d'appel — ${classe ? esc(classe.nom) : ''} — ${formatDate(date)}</h2>
      <table border="1" cellpadding="6" style="border-collapse:collapse; width:100%;">
        <tr><th>Matricule</th><th>Nom &amp; prénom</th><th>Statut</th><th>Motif</th></tr>
        ${rows}
      </table>`;
    exportWordDoc(`registre-appel-${date}.doc`, "Registre d'appel", bodyHtml);
  }

  if (classes.length) load();
};

/* ---------- Jours non travaillés (fériés, événements, enseignant absent…) ----------
   Un jour déclaré « non travaillé » bloque la saisie de l'appel ce jour-là (voir load()
   ci-dessus) et est exclu du calcul des demi-jours de classe dans le rapport mensuel
   (voir calculerRapportMensuel) : pas de cours, donc pas de travail comptabilisé. */
const MOTIFS_JOUR_NON_TRAVAILLE = ['Jour férié', 'Événement scolaire', "Absence de l'enseignant", 'Intempéries', 'Autre'];

async function openJourNonTravailleForm(classes, dateDefaut, classeIdDefaut, onChange) {
  const renderListe = async (overlay) => {
    const jours = (await DB.getAll('joursNonTravailles')).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const classesMap = Object.fromEntries(classes.map((c) => [c.value, c.label]));
    $('#jnt-liste', overlay).innerHTML = jours.length ? jours.map((j) => `<tr>
        <td>${formatDate(j.date)}</td>
        <td>${j.portee === 'ecole' ? "Toute l'école" : esc(classesMap[j.classeId] || 'Classe supprimée')}</td>
        <td>${esc(j.motif || '—')}</td>
        <td class="no-print"><button class="btn btn-sm btn-danger jnt-del" data-id="${j.id}">Supprimer</button></td>
      </tr>`).join('') : '<tr><td colspan="4" class="text-soft">Aucun jour non travaillé déclaré.</td></tr>';
    $all('.jnt-del', overlay).forEach((b) => {
      b.onclick = async () => {
        if (!(await confirmDialog('Supprimer cette déclaration de jour non travaillé ?'))) return;
        await DB.delete('joursNonTravailles', Number(b.dataset.id));
        toast('Jour non travaillé supprimé.');
        renderListe(overlay);
        if (onChange) onChange();
      };
    });
  };

  const overlay = openModal('Jour non travaillé', `
    <div class="form-grid">
      <div class="field"><label>Date</label><input type="date" id="jnt-date" value="${esc(dateDefaut || todayISO())}"></div>
      <div class="field"><label>Portée</label><select id="jnt-portee">
        <option value="ecole">Toute l'école</option>
        <option value="classe">Une seule classe</option>
      </select></div>
      <div class="field" id="jnt-champ-classe"><label>Classe concernée</label><select id="jnt-classe">${classes.map((c) => `<option value="${c.value}" ${c.value === classeIdDefaut ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label>Motif</label><select id="jnt-motif-type">${MOTIFS_JOUR_NON_TRAVAILLE.map((m) => `<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="field full"><label>Précision (optionnel)</label><input id="jnt-motif-detail" placeholder="Ex : Tabaski, réunion pédagogique, maladie de Mme X…"></div>
    </div>
    <div class="section-title" style="margin:16px 0 8px;"><h2 style="font-size:14px;">Jours déjà déclarés</h2><div class="line"></div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Portée</th><th>Motif</th><th></th></tr></thead><tbody id="jnt-liste"></tbody></table></div>`, {
    wide: true, saveLabel: 'Déclarer ce jour non travaillé',
    onSave: async (ov) => {
      const date = $('#jnt-date', ov).value;
      if (!date) { toast('Choisissez une date.'); return false; }
      const portee = $('#jnt-portee', ov).value;
      const classeId = portee === 'classe' ? Number($('#jnt-classe', ov).value) : null;
      if (portee === 'classe' && !classeId) { toast('Choisissez une classe.'); return false; }
      const motifType = $('#jnt-motif-type', ov).value;
      const motifDetail = $('#jnt-motif-detail', ov).value.trim();
      const motif = motifDetail ? `${motifType} — ${motifDetail}` : motifType;
      const existants = (await DB.getAll('joursNonTravailles')).filter((j) => j.date === date && j.portee === portee && j.classeId === classeId);
      if (existants.length) { toast('Ce jour est déjà déclaré non travaillé pour cette portée.'); return false; }
      await DB.add('joursNonTravailles', { date, portee, classeId, motif });
      toast('Jour non travaillé déclaré.');
      if (onChange) onChange();
      return true;
    }
  });

  const majChampClasse = () => { $('#jnt-champ-classe', overlay).style.display = $('#jnt-portee', overlay).value === 'classe' ? '' : 'none'; };
  $('#jnt-portee', overlay).onchange = majChampClasse;
  majChampClasse();
  renderListe(overlay);
}

/* ---------- Export Word (.doc via HTML — ouvrable par Microsoft Word / LibreOffice, 100% hors ligne) ---------- */
function exportWordDoc(filename, title, bodyHtml) {
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
  <head><meta charset="UTF-8"><title>${esc(title)}</title></head>
  <body>${bodyHtml}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   Rapport mensuel du registre d'appel — grille officielle MENA
   ------------------------------------------------------------
   Reconstruit, à partir des appels déjà saisis dans "presencesEleves",
   les rubriques du registre d'appel papier : nombre de demi-jours de
   classe, effectifs, présences possibles, absences, présences
   effectives, élèves à risque (plus de 3 absences), pourcentage
   d'absences — par mois (Septembre à Juillet), avec Total annuel et
   Moyenne annuelle, pour Garçons / Filles / Total. Les visas du
   Directeur et de l'Encadreur Pédagogique se saisissent mois par mois
   et sont conservés dans le magasin "rapportsMensuels".
   ============================================================ */

const MOIS_ANNEE_SCOLAIRE = [
  { label: 'Septembre', num: 9, offsetAn: 0 }, { label: 'Octobre', num: 10, offsetAn: 0 },
  { label: 'Novembre', num: 11, offsetAn: 0 }, { label: 'Décembre', num: 12, offsetAn: 0 },
  { label: 'Janvier', num: 1, offsetAn: 1 }, { label: 'Février', num: 2, offsetAn: 1 },
  { label: 'Mars', num: 3, offsetAn: 1 }, { label: 'Avril', num: 4, offsetAn: 1 },
  { label: 'Mai', num: 5, offsetAn: 1 }, { label: 'Juin', num: 6, offsetAn: 1 }, { label: 'Juillet', num: 7, offsetAn: 1 }
];

async function calculerRapportMensuel(classeId, anneeScolaire) {
  const [presencesAll, elevesAll, visasAll, joursNTAll] = await Promise.all([DB.getAll('presencesEleves'), DB.getAll('eleves'), DB.getAll('rapportsMensuels'), DB.getAll('joursNonTravailles')]);
  // Dates déclarées non travaillées pour cette classe (toute l'école, ou cette classe en particulier) :
  // aucun cours n'y a eu lieu, donc elles ne comptent pas dans les demi-jours de classe,
  // même si des présences y avaient été saisies par erreur avant la déclaration.
  const datesNonTravaillees = new Set(joursNTAll.filter((j) => j.portee === 'ecole' || j.classeId === classeId).map((j) => j.date));
  const presencesClasse = presencesAll.filter((p) => p.classeId === classeId && !datesNonTravaillees.has(p.date));
  const eleveMap = Object.fromEntries(elevesAll.map((e) => [e.id, e]));
  const sexeDe = (eleve) => (eleve && String(eleve.sexe || '').trim().toUpperCase() === 'F') ? 'f' : 'g';
  const m = (anneeScolaire || '').match(/^(\d{4})-(\d{4})$/);
  const y1 = m ? Number(m[1]) : new Date().getFullYear();
  const y2 = m ? Number(m[2]) : y1 + 1;
  const vide = () => ({ g: 0, f: 0, t: 0 });

  return MOIS_ANNEE_SCOLAIRE.map((mDef) => {
    const annee = mDef.offsetAn === 0 ? y1 : y2;
    const presencesMois = presencesClasse.filter((p) => {
      const d = new Date(`${p.date}T00:00:00`);
      return d.getFullYear() === annee && (d.getMonth() + 1) === mDef.num;
    });

    // (1) Demi-jours de classe du mois : horaire du primaire au Burkina Faso —
    // lundi, mardi, jeudi, vendredi = journée complète (2 demi-jours) ;
    // mercredi = matin seulement, 7h30-11h30 (1 demi-jour) ;
    // samedi et dimanche = pas de cours (0, et ignorés même si un appel y existe par erreur).
    const datesDistinctes = Array.from(new Set(presencesMois.map((p) => p.date)));
    const demiJours = datesDistinctes.reduce((s, d) => {
      const jourSemaine = new Date(`${d}T00:00:00`).getDay(); // 0=dimanche … 3=mercredi … 6=samedi
      if (jourSemaine === 3) return s + 1;
      if (jourSemaine === 0 || jourSemaine === 6) return s;
      return s + 2;
    }, 0);

    const parEleve = {};
    presencesMois.forEach((p) => {
      if (!parEleve[p.eleveId]) parEleve[p.eleveId] = { present: 0, absent: 0 };
      if (isPresenceAbsente(p.statut)) parEleve[p.eleveId].absent++; else parEleve[p.eleveId].present++;
    });

    // (2) Effectif ayant fréquenté l'école ce mois : tout élève pour qui un appel a été
    // saisi ce mois-ci (présent OU absent) — pas seulement ceux présents au moins une fois,
    // sinon un élève malade tout le mois disparaîtrait à tort de cette colonne, et pas un
    // effectif figé non plus, sinon un départ ou une arrivée en cours d'année fausserait
    // les mois passés.
    const effectif = vide(), absences = vide(), eleves3ouMoins = vide(), elevesPlus3 = vide(), absencesImputables = vide();
    Object.entries(parEleve).forEach(([eleveId, cpt]) => {
      const eleve = eleveMap[eleveId];
      const sexe = sexeDe(eleve);
      effectif[sexe]++; effectif.t++;
      absences[sexe] += cpt.absent; absences.t += cpt.absent;
      if (cpt.absent <= 3) { eleves3ouMoins[sexe]++; eleves3ouMoins.t++; }
      else { elevesPlus3[sexe]++; elevesPlus3.t++; absencesImputables[sexe] += cpt.absent; absencesImputables.t += cpt.absent; }
    });

    const possibles = vide(), effectives = vide();
    ['g', 'f', 't'].forEach((k) => { possibles[k] = demiJours * effectif[k]; effectives[k] = possibles[k] - absences[k]; });
    const pourcentageAbsences = { g: possibles.g ? (absences.g / possibles.g) * 100 : null, f: possibles.f ? (absences.f / possibles.f) * 100 : null, t: possibles.t ? (absences.t / possibles.t) * 100 : null };

    const visa = visasAll.find((v) => v.classeId === classeId && v.anneeScolaire === anneeScolaire && v.moisLabel === mDef.label) || {};

    return {
      label: mDef.label, aDesDonnees: datesDistinctes.length > 0, demiJours, effectif, possibles, absences, effectives,
      eleves3ouMoins, elevesPlus3, absencesImputables, pourcentageAbsences,
      visaId: visa.id || null, visaDirecteur: visa.visaDirecteur || '', visaEncadreur: visa.visaEncadreur || ''
    };
  });
}

function sommeColonne(lignes, cle, sk) { return lignes.reduce((s, l) => s + (l[cle][sk] || 0), 0); }

ROUTES['#/registre-mensuel'] = async (root) => {
  const classes = await classeOptions();
  const meta = (await DB.getAll('meta'))[0] || {};
  const qp = getHashParams();
  const classeDefaut = Number(qp.get('classeId')) || (classes[0] ? classes[0].value : '');
  const anneeActive = meta.anneeScolaire || anneeScolaireCourante();
  const anneesDisponibles = Array.from(new Set([
    anneeActive,
    ...(await DB.getAll('evaluations')).map((e) => e.anneeScolaire).filter(Boolean)
  ])).sort().reverse();

  root.innerHTML = `
    <div class="alert alert-vert">Reconstruit automatiquement à partir des appels déjà saisis dans « Registre d'appel journalier » : rien à ressaisir. Pour les colonnes d'effectifs (2, 6, 7), la ligne TOTAL ANNUEL reprend le dernier mois renseigné plutôt qu'une somme des mois (additionner un effectif d'un mois à l'autre n'aurait pas de sens) ; la ligne MOYENNE ANNUELLE, elle, en fait la moyenne.</div>
    <div class="table-toolbar">
      <select id="rm-classe" class="search-input">${classes.length ? classes.map((c) => `<option value="${c.value}" ${c.value === classeDefaut ? 'selected' : ''}>${esc(c.label)}</option>`).join('') : '<option value="">Aucune classe</option>'}</select>
      <select id="rm-annee" class="search-input" style="max-width:130px;">${anneesDisponibles.map((a) => `<option value="${esc(a)}" ${a === anneeActive ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select id="rm-mois" class="search-input" style="max-width:150px;" title="Mois affiché dans la carte « Demi-journées de travail »"></select>
      <div style="flex:1;"></div>
      <button class="btn btn-sm no-print" id="rm-save-visas">Enregistrer les visas</button>
      <button class="btn btn-sm no-print" id="rm-print">Imprimer / PDF</button>
      <button class="btn btn-sm no-print" id="rm-csv">Excel (CSV)</button>
    </div>
    <div id="rm-resume" class="grid grid-3" style="margin-bottom:14px;"></div>
    <div id="rm-tableau"></div>`;

  const GFT = ['g', 'f', 't'];
  const LABEL_GFT = { g: 'Garçons', f: 'Filles', t: 'Total' };
  // cumulable:true -> le Total annuel additionne les mois (demi-jours, présences, absences : ça a un sens de cumuler).
  // cumulable:false -> ce sont des effectifs (nombre d'élèves) : les additionner sur 11 mois donnerait un nombre
  // absurde (ex. 66 élèves x 9 mois). Le Total annuel reprend donc le dernier mois renseigné.
  const RUBRIQUES = [
    { cle: 'effectif', num: 2, titre: "Nombre total d'élèves ayant fréquenté l'école pendant le mois", cumulable: false },
    { cle: 'possibles', num: 3, titre: 'Total des présences possibles ou maximum', cumulable: true },
    { cle: 'absences', num: 4, titre: 'Total des absences du mois', cumulable: true },
    { cle: 'effectives', num: 5, titre: 'Total des présences effectives', cumulable: true },
    { cle: 'eleves3ouMoins', num: 6, titre: "Nombre d'élèves ayant trois absences ou moins", cumulable: false },
    { cle: 'elevesPlus3', num: 7, titre: "Nombre d'élèves ayant plus de trois absences", cumulable: false },
    { cle: 'absencesImputables', num: 8, titre: 'Total des absences imputables aux élèves ayant plus de trois absences', cumulable: true }
  ];

  const fmtPct = (v) => (v === null || v === undefined || isNaN(v)) ? '—' : v.toFixed(1) + '%';

  const construireTableau = (lignes) => {
    const theadRubriques = `<th rowspan="2" class="col-rang grp-end">Mois</th><th rowspan="2" class="grp-end">(1)<br>Demi-jours de<br>classe du mois</th>`
      + RUBRIQUES.map((r) => `<th colspan="3" class="grp-end">(${r.num})<br>${esc(r.titre)}</th>`).join('')
      + `<th colspan="3" class="grp-end">(9)<br>Pourcentage des absences</th><th rowspan="2" class="no-print grp-end">(10)<br>Visa du Directeur</th><th rowspan="2" class="no-print">(11)<br>Visa de l'Encadreur</th>`;
    const theadGFT = RUBRIQUES.map(() => GFT.map((k) => `<th${k === 't' ? ' class="grp-end"' : ''}>${LABEL_GFT[k]}</th>`).join('')).join('') + GFT.map((k) => `<th${k === 't' ? ' class="grp-end"' : ''}>${LABEL_GFT[k]}</th>`).join('');

    const ligneHtml = (l, idx, editable) => `<tr data-mois="${esc(l.label)}">
      <td class="col-rang grp-end">${esc(l.label)}</td>
      <td class="grp-end" style="text-align:center;">${l.aDesDonnees ? l.demiJours : '—'}</td>
      ${RUBRIQUES.map((r) => GFT.map((k) => `<td${k === 't' ? ' class="grp-end"' : ''} style="text-align:center;">${l.aDesDonnees ? l[r.cle][k] : '—'}</td>`).join('')).join('')}
      ${GFT.map((k) => `<td${k === 't' ? ' class="grp-end"' : ''} style="text-align:center;">${l.aDesDonnees ? fmtPct(l.pourcentageAbsences[k]) : '—'}</td>`).join('')}
      <td class="no-print grp-end">${editable ? `<input class="rm-visa-directeur" data-mois="${esc(l.label)}" style="width:100%;" value="${esc(l.visaDirecteur)}" placeholder="Date / visa">` : ''}</td>
      <td class="no-print">${editable ? `<input class="rm-visa-encadreur" data-mois="${esc(l.label)}" style="width:100%;" value="${esc(l.visaEncadreur)}" placeholder="Date / visa">` : ''}</td>
    </tr>`;

    // Ligne TOTAL ANNUEL (sommes) et MOYENNE ANNUELLE (moyennes sur les mois renseignés)
    const moisAvecDonnees = lignes.filter((l) => l.aDesDonnees);
    const nb = moisAvecDonnees.length || 1;
    const totalDemiJours = lignes.reduce((s, l) => s + (l.aDesDonnees ? l.demiJours : 0), 0);
    const dernierMoisAvecDonnees = moisAvecDonnees.length ? moisAvecDonnees[moisAvecDonnees.length - 1] : null;
    const totalRub = {};
    RUBRIQUES.forEach((r) => {
      totalRub[r.cle] = {};
      GFT.forEach((k) => {
        totalRub[r.cle][k] = r.cumulable
          ? lignes.reduce((s, l) => s + (l.aDesDonnees ? l[r.cle][k] : 0), 0)
          : (dernierMoisAvecDonnees ? dernierMoisAvecDonnees[r.cle][k] : 0);
      });
    });
    const totalPourcentage = { g: totalRub.possibles.g ? (totalRub.absences.g / totalRub.possibles.g) * 100 : null, f: totalRub.possibles.f ? (totalRub.absences.f / totalRub.possibles.f) * 100 : null, t: totalRub.possibles.t ? (totalRub.absences.t / totalRub.possibles.t) * 100 : null };

    const moyDemiJours = moisAvecDonnees.length ? Math.round(totalDemiJours / nb) : 0;
    const moyRub = {};
    RUBRIQUES.forEach((r) => { moyRub[r.cle] = {}; GFT.forEach((k) => { moyRub[r.cle][k] = moisAvecDonnees.length ? Math.round(totalRub[r.cle][k] / nb) : 0; }); });
    const moyPourcentage = { g: moisAvecDonnees.length ? moisAvecDonnees.reduce((s, l) => s + (l.pourcentageAbsences.g || 0), 0) / nb : null, f: moisAvecDonnees.length ? moisAvecDonnees.reduce((s, l) => s + (l.pourcentageAbsences.f || 0), 0) / nb : null, t: moisAvecDonnees.length ? moisAvecDonnees.reduce((s, l) => s + (l.pourcentageAbsences.t || 0), 0) / nb : null };

    const ligneBilan = (titre, demiJoursVal, rub, pct) => `<tr style="font-weight:700; background:var(--sand-100, #f3ede2);">
      <td class="col-rang grp-end">${titre}</td>
      <td class="grp-end" style="text-align:center;">${demiJoursVal}</td>
      ${RUBRIQUES.map((r) => GFT.map((k) => `<td${k === 't' ? ' class="grp-end"' : ''} style="text-align:center;">${rub[r.cle][k]}</td>`).join('')).join('')}
      ${GFT.map((k) => `<td${k === 't' ? ' class="grp-end"' : ''} style="text-align:center;">${fmtPct(pct[k])}</td>`).join('')}
      <td class="no-print grp-end"></td><td class="no-print"></td>
    </tr>`;

    return `<div class="table-wrap"><table class="table-rubriques" style="font-size:12px;">
      <thead><tr>${theadRubriques}</tr><tr>${theadGFT}</tr></thead>
      <tbody>${lignes.map((l, i) => ligneHtml(l, i, true)).join('')}
        ${ligneBilan('TOTAL ANNUEL', totalDemiJours, totalRub, totalPourcentage)}
        ${ligneBilan('MOYENNE ANNUELLE', moyDemiJours, moyRub, moyPourcentage)}
      </tbody>
    </table></div>`;
  };

  let lignesCourantes = [];
  const load = async () => {
    const classeId = Number($('#rm-classe').value);
    const anneeScolaire = $('#rm-annee').value;
    if (!classeId) { $('#rm-tableau').innerHTML = '<div class="empty-state">Choisissez une classe.</div>'; return; }
    lignesCourantes = await calculerRapportMensuel(classeId, anneeScolaire);
    const moisRenseignes = lignesCourantes.filter((l) => l.aDesDonnees);
    const totalAbs = sommeColonne(moisRenseignes, 'absences', 't'), totalPoss = sommeColonne(moisRenseignes, 'possibles', 't');
    const tauxAbsGlobal = totalPoss ? (totalAbs / totalPoss) * 100 : null;
    const totalAbsG = sommeColonne(moisRenseignes, 'absences', 'g'), totalPossG = sommeColonne(moisRenseignes, 'possibles', 'g');
    const totalAbsF = sommeColonne(moisRenseignes, 'absences', 'f'), totalPossF = sommeColonne(moisRenseignes, 'possibles', 'f');
    const tauxG = totalPossG ? (totalAbsG / totalPossG) * 100 : null, tauxF = totalPossF ? (totalAbsF / totalPossF) * 100 : null;
    // Demi-journées de travail : affichées pour UN mois (le total annuel reste dans le tableau, ligne TOTAL ANNUEL)
    const selMois = $('#rm-mois');
    const moisPrec = selMois.value;
    selMois.innerHTML = lignesCourantes.map((l) => `<option value="${esc(l.label)}">${esc(l.label)}${l.aDesDonnees ? '' : ' (aucun appel)'}</option>`).join('');
    const dernierAvecDonnees = moisRenseignes.length ? moisRenseignes[moisRenseignes.length - 1].label : (lignesCourantes[0] ? lignesCourantes[0].label : '');
    selMois.value = lignesCourantes.some((l) => l.label === moisPrec) ? moisPrec : dernierAvecDonnees;
    const ligneMois = lignesCourantes.find((l) => l.label === selMois.value);
    const demiJoursMois = ligneMois && ligneMois.aDesDonnees ? ligneMois.demiJours : '—';

    $('#rm-resume').innerHTML = `
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Demi-journées de travail (${esc(selMois.value)})</div><div class="value">${demiJoursMois}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Taux global de présence</div><div class="value">${tauxAbsGlobal === null ? '—' : (100 - tauxAbsGlobal).toFixed(1) + '%'}</div><div class="foot">Taux d'absence : ${fmtPct(tauxAbsGlobal)}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Présence filles / garçons</div><div class="value" style="font-size:18px;">${tauxF === null ? '—' : (100 - tauxF).toFixed(1) + '%'} / ${tauxG === null ? '—' : (100 - tauxG).toFixed(1) + '%'}</div></div>`;

    $('#rm-tableau').innerHTML = construireTableau(lignesCourantes);
  };

  $('#rm-classe').onchange = load;
  $('#rm-annee').onchange = load;
  $('#rm-mois').onchange = load;

  $('#rm-save-visas').onclick = async () => {
    const classeId = Number($('#rm-classe').value), anneeScolaire = $('#rm-annee').value;
    for (const l of lignesCourantes) {
      const dEl = $(`.rm-visa-directeur[data-mois="${CSS.escape(l.label)}"]`);
      const eEl = $(`.rm-visa-encadreur[data-mois="${CSS.escape(l.label)}"]`);
      const visaDirecteur = dEl ? dEl.value.trim() : '';
      const visaEncadreur = eEl ? eEl.value.trim() : '';
      if (!visaDirecteur && !visaEncadreur && !l.visaId) continue;
      const obj = { id: l.visaId || undefined, classeId, anneeScolaire, moisLabel: l.label, visaDirecteur, visaEncadreur };
      if (l.visaId) await DB.put('rapportsMensuels', obj); else { delete obj.id; await DB.add('rapportsMensuels', obj); }
    }
    toast('Visas enregistrés.');
    load();
  };

  $('#rm-print').onclick = async () => {
    const classe = await DB.get('classes', Number($('#rm-classe').value));
    printDocument(`Rapport mensuel — ${classe ? classe.nom : ''}`, `
      <h3 style="text-align:center;">RAPPORT MENSUEL DU REGISTRE D'APPEL</h3>
      <p style="text-align:center;">Classe : ${classe ? esc(classe.nom) : ''} &nbsp; Année scolaire : ${esc($('#rm-annee').value)}</p>
      ${construireTableau(lignesCourantes)}`);
  };

  $('#rm-csv').onclick = async () => {
    const headers = ['Mois', 'Demi-jours', ...RUBRIQUES.flatMap((r) => GFT.map((k) => `${r.titre} (${LABEL_GFT[k]})`)), 'Abs % Garçons', 'Abs % Filles', 'Abs % Total'];
    const rows = lignesCourantes.map((l) => [l.label, l.aDesDonnees ? l.demiJours : '',
      ...RUBRIQUES.flatMap((r) => GFT.map((k) => l.aDesDonnees ? l[r.cle][k] : '')),
      ...GFT.map((k) => l.aDesDonnees && l.pourcentageAbsences[k] !== null ? l.pourcentageAbsences[k].toFixed(1) : '')]);
    const csv = toCSV(rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]]))), headers.map((h) => ({ label: h, value: h })));
    download(`rapport-mensuel-${$('#rm-annee').value}.csv`, csv, 'text/csv;charset=utf-8');
  };

  if (classes.length) load();
};
