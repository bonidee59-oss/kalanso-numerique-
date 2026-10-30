/* ============================================================
   app-pedagogie.js — Évaluations, Abandons
   ============================================================ */

/* ---------------- Évaluations & bulletins ----------------
   Modèle : chaque classe a sa propre liste de matières (table 'matieres',
   coefficient + barème modifiables sans jamais toucher aux évaluations
   déjà créées). Chaque évaluation fige un instantané ('matieresEval') des
   matières actives au moment de sa création, et ses notes ('notes')
   croisent élèves x matières de cet instantané. Tout est lu et écrit
   depuis les magasins déjà existants (classes, eleves) + les 2 nouveaux
   magasins additifs (matieres, evaluations enrichi) — rien n'est
   recréé ni cassé côté données existantes. */

/* Mémorise les derniers choix de l'utilisateur pour ne pas les perdre
   après un rafraîchissement de la vue (ex. après création). */
let _evUIState = { annee: null, classeId: null, evalId: null };

/* --------- Utilitaires globaux réutilisés par la fiche élève, les bulletins,
   le tableau de bord et les rapports : convertissent une note (nouveau modèle
   multi-matières, ou ancien modèle à discipline unique le temps que la
   migration s'exécute) sur 20, en respectant le barème réel de la matière. */
function matiereDefDeNote(ev, matiereId) {
  if (Array.isArray(ev.matieresEval) && matiereId != null) {
    return ev.matieresEval.find((m) => m.matiereId === matiereId) || null;
  }
  return null;
}
/* Base de la moyenne : au primaire (Burkina Faso) les moyennes sont sur 10. */
const MOYENNE_BASE = 10;
const SEUIL_MOYENNE = MOYENNE_BASE / 2;

function noteSur20(ev, noteEntry) {
  if (!noteEntry || noteEntry.note === '' || noteEntry.note === null || noteEntry.note === undefined) return null;
  const mDef = matiereDefDeNote(ev, noteEntry.matiereId);
  const bareme = mDef ? (Number(mDef.bareme) || 20) : (Number(ev.bareme) || 20);
  return (Number(noteEntry.note) / bareme) * MOYENNE_BASE;
}

/* --------- Migration additive : anciennes évaluations (1 seule discipline
   par évaluation) -> nouveau modèle multi-matières. Ne supprime rien :
   crée une matière par discipline rencontrée si besoin, et conserve le
   barème d'origine sur l'instantané de l'évaluation. Idempotente. */
async function migratePedagogieEvaluations() {
  const evals = await DB.getAll('evaluations');
  const aMigrer = evals.filter((e) => Array.isArray(e.notes) && e.notes.length && e.notes.some((n) => n.matiereId === undefined));
  if (!aMigrer.length) return;
  const meta = (await DB.getAll('meta'))[0] || {};
  let matieresAll = await DB.getAll('matieres');
  for (const ev of aMigrer) {
    const discipline = ev.discipline || 'Matière';
    let matiere = matieresAll.find((m) => m.classeId === ev.classeId && m.nom === discipline);
    if (!matiere) {
      const newId = await DB.add('matieres', {
        classeId: ev.classeId, nom: discipline, coefficient: 1,
        bareme: Number(ev.bareme) || 20, actif: true, ordre: matieresAll.length
      });
      matiere = { id: newId, classeId: ev.classeId, nom: discipline, coefficient: 1, bareme: Number(ev.bareme) || 20, actif: true };
      matieresAll.push(matiere);
    }
    ev.anneeScolaire = ev.anneeScolaire || meta.anneeScolaire || anneeScolaireCourante();
    ev.nom = ev.nom || ev.type || discipline;
    ev.matieresEval = [{ matiereId: matiere.id, nom: matiere.nom, coefficient: matiere.coefficient, bareme: Number(ev.bareme) || matiere.bareme }];
    ev.notes = (ev.notes || []).map((n) => ({ eleveId: n.eleveId, matiereId: matiere.id, note: n.note }));
    ev.statut = ev.statut || 'brouillon';
    ev.verrouillee = !!ev.verrouillee;
    await DB.put('evaluations', ev);
  }
}

ROUTES['#/evaluations'] = async (root) => {
  const [classes, metaAll] = await Promise.all([classeOptions(), DB.getAll('meta')]);
  const meta = metaAll[0] || {};
  const anneeActuelle = meta.anneeScolaire || anneeScolaireCourante();
  if (!classes.length) { root.innerHTML = `<div class="empty-state">Créez d'abord une classe pour utiliser ce module.</div>`; return; }

  const evalsAll = await DB.getAll('evaluations');
  const annees = Array.from(new Set([anneeActuelle, ...evalsAll.map((e) => e.anneeScolaire).filter(Boolean)])).sort().reverse();

  const anneeSel = annees.includes(_evUIState.annee) ? _evUIState.annee : anneeActuelle;
  const classeSel = classes.some((c) => c.value === _evUIState.classeId) ? _evUIState.classeId : classes[0].value;

  root.innerHTML = `
    <div class="table-toolbar">
      <select id="ev-annee" class="search-input" style="max-width:130px;">${annees.map((a) => `<option value="${esc(a)}" ${a === anneeSel ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <select id="ev-classe" class="search-input" style="max-width:220px;">${classes.map((c) => `<option value="${c.value}" ${c.value === classeSel ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      <select id="ev-eval" class="search-input" style="max-width:280px;"></select>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="ev-matieres">Gérer les matières</button>
      <button class="btn btn-accent" id="ev-add">+ Nouvelle évaluation</button>
    </div>
    <div id="ev-body"></div>`;

  const refreshEvalOptions = async (preferId) => {
    const classeId = Number($('#ev-classe').value);
    const annee = $('#ev-annee').value;
    const evals = (await DB.getAll('evaluations'))
      .filter((e) => e.classeId === classeId && (e.anneeScolaire || anneeActuelle) === annee)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('#ev-eval').innerHTML = evals.length
      ? evals.map((e) => `<option value="${e.id}">${esc(e.nom)} — ${formatDate(e.date)}${e.statut === 'publie' ? ' ✓ publiée' : ' (brouillon)'}</option>`).join('')
      : `<option value="">— Aucune évaluation —</option>`;
    const target = preferId || _evUIState.evalId;
    if (target && evals.some((e) => e.id === target)) $('#ev-eval').value = target;
    _evUIState.evalId = Number($('#ev-eval').value) || null;
  };

  const loadBody = async () => {
    _evUIState.annee = $('#ev-annee').value;
    _evUIState.classeId = Number($('#ev-classe').value);
    _evUIState.evalId = Number($('#ev-eval').value) || null;
    if (!_evUIState.evalId) { $('#ev-body').innerHTML = `<div class="empty-state">Aucune évaluation pour cette classe et cette année scolaire. Cliquez sur « + Nouvelle évaluation ».</div>`; return; }
    await renderEvaluationGrid($('#ev-body'), _evUIState.evalId);
  };

  $('#ev-annee').onchange = async () => { await refreshEvalOptions(); await loadBody(); };
  $('#ev-classe').onchange = async () => { await refreshEvalOptions(); await loadBody(); };
  $('#ev-eval').onchange = loadBody;
  $('#ev-matieres').onclick = () => openGererMatieres(Number($('#ev-classe').value));
  $('#ev-add').onclick = () => openEvaluationForm(Number($('#ev-classe').value), $('#ev-annee').value);

  await refreshEvalOptions();
  await loadBody();
};

/* --------- Gestion des matières d'une classe --------- */
/* --------- Synchronisation des matières avec les évaluations en brouillon ---------
   Les évaluations déjà publiées/verrouillées gardent leurs matières figées (bulletins
   déjà sortis = intouchables). Les évaluations encore en brouillon, elles, sont mises à
   jour tout de suite : une matière ajoutée ou supprimée apparaît/disparaît immédiatement
   dans la grille des notes de ces évaluations. */
async function synchroniserAjoutMatiereEvaluations(classeId, matiere) {
  const evals = (await DB.getAll('evaluations')).filter((e) => e.classeId === classeId && e.statut !== 'publie' && !e.verrouillee);
  for (const ev of evals) {
    ev.matieresEval = ev.matieresEval || [];
    if (ev.matieresEval.some((m) => m.matiereId === matiere.id)) continue;
    ev.matieresEval.push({ matiereId: matiere.id, nom: matiere.nom, coefficient: matiere.coefficient, bareme: matiere.bareme });
    const eleveIds = new Set((ev.notes || []).map((n) => n.eleveId));
    ev.notes = ev.notes || [];
    eleveIds.forEach((eleveId) => ev.notes.push({ eleveId, matiereId: matiere.id, note: '' }));
    await DB.put('evaluations', ev);
  }
}

async function supprimerMatiereEtSynchroniser(classeId, matiereId) {
  await DB.delete('matieres', matiereId);
  const evals = (await DB.getAll('evaluations')).filter((e) => e.classeId === classeId && e.statut !== 'publie' && !e.verrouillee);
  for (const ev of evals) {
    ev.matieresEval = (ev.matieresEval || []).filter((m) => m.matiereId !== matiereId);
    ev.notes = (ev.notes || []).filter((n) => n.matiereId !== matiereId);
    await DB.put('evaluations', ev);
  }
}

async function openGererMatieres(classeId) {
  if (!classeId) { toast('Choisissez une classe.'); return; }
  const classe = await DB.get('classes', classeId);

  const renderList = async (overlay) => {
    const matieres = (await DB.getAll('matieres')).filter((m) => m.classeId === classeId)
      .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || (a.nom || '').localeCompare(b.nom || ''));
    $('#gm-body', overlay).innerHTML = matieres.length ? matieres.map((m) => `<tr data-id="${m.id}">
        <td>${esc(m.nom)}</td>
        <td style="text-align:center;">${m.coefficient}</td>
        <td style="text-align:center;">${m.bareme}</td>
        <td class="no-print"><button type="button" class="btn btn-sm btn-danger gm-del" data-id="${m.id}">Supprimer</button></td>
      </tr>`).join('') : `<tr><td colspan="4" class="text-soft">Aucune matière pour cette classe.</td></tr>`;
    $all('.gm-del', overlay).forEach((btn) => {
      btn.onclick = async () => {
        if (!(await confirmDialog('Supprimer cette matière ? Elle disparaîtra immédiatement des évaluations en brouillon de cette classe.'))) return;
        await supprimerMatiereEtSynchroniser(classeId, Number(btn.dataset.id));
        toast('Matière supprimée.');
        await renderList(overlay);
        onRouteChange();
      };
    });
  };

  const overlay = openModal(`Gérer les matières — ${classe ? esc(classe.nom) : ''}`, `
    <p class="text-soft">Les évaluations déjà publiées/verrouillées gardent leurs matières telles quelles. Les évaluations en brouillon sont mises à jour immédiatement : une matière ajoutée ou supprimée apparaît ou disparaît tout de suite dans leur grille de notes.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Matière</th><th>Coefficient</th><th>Barème</th><th></th></tr></thead>
      <tbody id="gm-body"></tbody>
    </table></div>
    <div class="form-grid" style="margin-top:16px;">
      <div class="field"><label>Nouvelle matière</label><input id="gm-new-nom" placeholder="Ex : Calcul"></div>
      <div class="field"><label>Coefficient</label><input id="gm-new-coef" type="number" min="0.5" step="0.5" value="1"></div>
      <div class="field"><label>Barème</label><input id="gm-new-bareme" type="number" min="1" step="1" value="20"></div>
    </div>
    <button type="button" class="btn btn-accent" id="gm-add" style="margin-top:10px;">+ Ajouter la matière</button>`, {
    wide: true, hideSave: true
  });

  $('#gm-add', overlay).onclick = async () => {
    const nom = $('#gm-new-nom', overlay).value.trim();
    if (!nom) { toast('Indiquez le nom de la matière.'); return; }
    const coefficient = Number($('#gm-new-coef', overlay).value) || 1;
    const bareme = Number($('#gm-new-bareme', overlay).value) || 20;
    const matieresExistantes = (await DB.getAll('matieres')).filter((m) => m.classeId === classeId);
    const newId = await DB.add('matieres', { classeId, nom, coefficient, bareme, actif: true, ordre: matieresExistantes.length });
    await synchroniserAjoutMatiereEvaluations(classeId, { id: newId, nom, coefficient, bareme });
    $('#gm-new-nom', overlay).value = '';
    $('#gm-new-coef', overlay).value = 1;
    $('#gm-new-bareme', overlay).value = 20;
    toast('Matière ajoutée.');
    await renderList(overlay);
    onRouteChange();
  };

  await renderList(overlay);
}

/* --------- Création d'une évaluation --------- */
async function openEvaluationForm(classeId, anneeScolaire) {
  if (!classeId) { toast('Choisissez une classe.'); return; }
  const matieresActives = (await DB.getAll('matieres')).filter((m) => m.classeId === classeId && m.actif !== false)
    .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0) || (a.nom || '').localeCompare(b.nom || ''));

  openModal('Nouvelle évaluation', `<div class="form-grid">
    <div class="field full"><label>Nom de l'évaluation</label>
      <input id="nv-nom" list="nv-nom-list" placeholder="Ex : Composition 1">
      <datalist id="nv-nom-list">
        <option value="Composition 1"><option value="Composition 2"><option value="Composition 3">
        <option value="Devoir"><option value="Examen"><option value="Évaluation continue">
      </datalist>
    </div>
    <div class="field"><label>Date</label><input type="date" id="nv-date" value="${todayISO()}"></div>
  </div>
  <p class="text-soft" style="margin-top:8px;">${matieresActives.length
    ? `${matieresActives.length} matière(s) active(s) seront incluses : ${matieresActives.map((m) => esc(m.nom)).join(', ')}.`
    : `Aucune matière active pour cette classe. Utilisez « Gérer les matières » avant de créer une évaluation.`}</p>`, {
    onSave: async () => {
      const nom = $('#nv-nom').value.trim();
      if (!nom) { toast("Indiquez le nom de l'évaluation."); return false; }
      if (!matieresActives.length) { toast('Ajoutez au moins une matière active avant de créer une évaluation.'); return false; }
      const eleves = (await DB.getAll('eleves')).filter((e) => e.classeId === classeId && (e.statut || 'actif') === 'actif');
      const matieresEval = matieresActives.map((m) => ({ matiereId: m.id, nom: m.nom, coefficient: Number(m.coefficient) || 1, bareme: Number(m.bareme) || 20 }));
      const notes = [];
      eleves.forEach((e) => matieresEval.forEach((m) => notes.push({ eleveId: e.id, matiereId: m.matiereId, note: '' })));
      const id2 = await DB.add('evaluations', {
        classeId, anneeScolaire, date: $('#nv-date').value, nom,
        statut: 'brouillon', verrouillee: false, matieresEval, notes
      });
      _evUIState.evalId = id2;
      toast('Évaluation créée. Saisissez les notes.');
      onRouteChange();
      return true;
    }
  });
}

/* --------- Appréciation suggérée à partir de la moyenne (barème francophone standard) --------- */
function appreciationSuggeree(moyenne) {
  if (moyenne === null || moyenne === undefined) return '';
  const m = moyenne * (20 / MOYENNE_BASE); // barème francophone standard ramené sur 20
  if (m >= 16) return 'Excellent';
  if (m >= 14) return 'Très bien';
  if (m >= 12) return 'Bien';
  if (m >= SEUIL_MOYENNE * (20 / MOYENNE_BASE)) return 'Passable'; // à partir de la moyenne (5/10)
  return 'Insuffisant'; // en dessous de la moyenne (5/10)
}

/* --------- Calcul des moyennes, points pondérés et classement --------- */
function computeEvaluationStats(ev, eleveMap, eleveIds) {
  const matieres = ev.matieresEval || [];
  const appreciationsMap = Object.fromEntries((ev.appreciations || []).map((a) => [a.eleveId, a.texte]));
  const rows = eleveIds.map((eleveId) => {
    const eleve = eleveMap[eleveId];
    let sommePonderee = 0, sommeCoef = 0, nbNotes = 0, total = 0, totalBareme = 0;
    const cells = matieres.map((m) => {
      const n = (ev.notes || []).find((x) => x.eleveId === eleveId && x.matiereId === m.matiereId);
      const note = (n && n.note !== '' && n.note !== null && n.note !== undefined) ? Number(n.note) : null;
      let pts = null;
      if (note !== null && m.bareme) {
        pts = (note / m.bareme) * MOYENNE_BASE * (Number(m.coefficient) || 1);
        sommePonderee += pts; sommeCoef += (Number(m.coefficient) || 1); nbNotes++;
        total += note; totalBareme += (Number(m.bareme) || 20);
      }
      return { matiereId: m.matiereId, note, pts };
    });
    const moyenne = sommeCoef ? sommePonderee / sommeCoef : null;
    const appreciation = appreciationsMap[eleveId] !== undefined && appreciationsMap[eleveId] !== ''
      ? appreciationsMap[eleveId]
      : (moyenne !== null ? appreciationSuggeree(moyenne) : '');
    return { eleveId, eleve, cells, moyenne, nbNotes, rang: null, total, totalBareme, appreciation };
  });
  const classables = rows.filter((r) => r.moyenne !== null).sort((a, b) => b.moyenne - a.moyenne);
  let rang = 0, rangReel = 0, prevMoy = null;
  classables.forEach((r) => {
    rangReel++;
    if (prevMoy === null || Math.abs(r.moyenne - prevMoy) > 0.0001) { rang = rangReel; prevMoy = r.moyenne; }
    r.rang = rang;
  });
  const moyenneClasse = classables.length ? classables.reduce((s, r) => s + r.moyenne, 0) / classables.length : null;
  const moyennesParMatiere = matieres.map((m, i) => {
    const notes = rows.map((r) => r.cells[i].note).filter((n) => n !== null);
    return { matiere: m, moyenne: notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null, nb: notes.length };
  });
  return { rows, moyenneClasse, moyennesParMatiere, effectif: rows.length, nbClasses: classables.length };
}

/* --------- Tableau de saisie des notes --------- */
async function renderEvaluationGrid(root, evalId) {
  const ev = await DB.get('evaluations', evalId);
  if (!ev) { root.innerHTML = `<div class="empty-state">Évaluation introuvable.</div>`; return; }
  const eleves = await DB.getAll('eleves');
  const eleveMap = Object.fromEntries(eleves.map((e) => [e.id, e]));
  const eleveIds = [];
  (ev.notes || []).forEach((n) => { if (!eleveIds.includes(n.eleveId)) eleveIds.push(n.eleveId); });
  const matieres = ev.matieresEval || [];
  const locked = !!ev.verrouillee;

  root.innerHTML = `
    <div class="table-toolbar" style="margin-top:-4px;">
      <div><strong>${esc(ev.nom)}</strong> &nbsp;${formatDate(ev.date)} ${locked ? '<span class="badge badge-terre">Verrouillée</span>' : '<span class="badge badge-ocre">Brouillon</span>'}</div>
      <div style="flex:1;"></div>
      <button class="btn btn-sm no-print" id="ev-save">Enregistrer</button>
      <button class="btn btn-sm no-print" id="ev-classer" title="Trier les lignes de la grille par ordre de mérite">🏆 Classer par mérite</button>
      ${ev.statut === 'publie'
        ? `<button class="btn btn-sm no-print" id="ev-unpublish">Déverrouiller</button>`
        : `<button class="btn btn-accent no-print" id="ev-publish">Publier</button>`}
      <button class="btn btn-sm no-print" id="ev-print">Imprimer</button>
      <button class="btn btn-sm no-print" id="ev-synoptique">Tableau synoptique</button>
      <button class="btn btn-sm btn-danger no-print" id="ev-delete">Supprimer</button>
    </div>
    <div id="ev-table-wrap"></div>`;

  // Ordre d'affichage des lignes figé une fois pour toutes (alphabétique), pour que les
  // élèves ne changent pas de ligne à chaque saisie de note (seul le rang affiché bouge).
  let rowOrderIds = null;

  const renderTable = () => {
    // Mémorise la case active pour y remettre le curseur après le rafraîchissement de la grille
    const actif = document.activeElement;
    const restore = actif && actif.classList && actif.classList.contains('note-input')
      ? { e: actif.dataset.eleve, m: actif.dataset.matiere } : null;
    const stats = computeEvaluationStats(ev, eleveMap, eleveIds);
    if (!rowOrderIds) {
      rowOrderIds = [...stats.rows]
        .sort((a, b) => (a.eleve ? a.eleve.nom + a.eleve.prenom : '').localeCompare(b.eleve ? b.eleve.nom + b.eleve.prenom : ''))
        .map((r) => r.eleveId);
    }
    const byId = new Map(stats.rows.map((r) => [r.eleveId, r]));
    const ordered = rowOrderIds.map((id) => byId.get(id)).filter(Boolean);
    const nbReussite = ordered.filter((r) => r.moyenne !== null && r.moyenne >= SEUIL_MOYENNE).length;
    const tauxReussite = stats.nbClasses ? (nbReussite / stats.nbClasses) * 100 : null;
    $('#ev-table-wrap').innerHTML = `<div class="table-wrap eval-grid"><table>
      <thead><tr><th class="col-rang">Rang</th><th class="col-eleve">Élève</th>${matieres.map((m) => `<th>${esc(m.nom)}<br><span class="text-soft" style="font-weight:400;">coef ${m.coefficient} · /${m.bareme}</span></th>`).join('')}<th>Total</th><th>Moyenne /${MOYENNE_BASE}</th><th>Appréciation</th></tr></thead>
      <tbody>${ordered.length ? ordered.map((r) => {
        const rangCouleur = r.moyenne === null ? 'inherit' : (r.moyenne >= SEUIL_MOYENNE ? 'var(--vert-600)' : 'var(--terre-600)');
        return `<tr>
        <td class="col-rang"><strong style="color:${rangCouleur};">${r.rang ?? '—'}</strong></td>
        <td class="col-eleve"><button type="button" class="eleve-nom-btn" onclick="openEleveEvaluationForm(${ev.id}, ${r.eleveId})" style="background:none;border:none;padding:0;font:inherit;font-weight:600;color:${r.eleve && r.eleve.sexe === 'F' ? '#dc2626' : '#2563eb'};text-align:left;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${r.eleve ? esc(r.eleve.nom + ' ' + r.eleve.prenom) : '—'}</button></td>
        ${r.cells.map((c) => {
          if (locked) return `<td style="text-align:center;font-weight:800;font-size:16px;">${c.note === null ? '—' : c.note}</td>`;
          const mDef = matieres.find((m) => m.matiereId === c.matiereId) || {};
          return `<td><input type="number" class="note-input" min="0" max="${mDef.bareme || 20}" step="0.25" data-eleve="${r.eleveId}" data-matiere="${c.matiereId}" value="${c.note === null ? '' : c.note}" style="width:70px;font-weight:800;font-size:16px;color:#111;text-align:center;"></td>`;
        }).join('')}
        <td style="text-align:center;">${r.nbNotes ? `${r.total}/${r.totalBareme}` : '—'}</td>
        <td><strong>${r.moyenne !== null ? r.moyenne.toFixed(2) : '—'}</strong></td>
        <td>${r.appreciation ? esc(r.appreciation) : '—'}</td>
      </tr>`;
      }).join('') : `<tr><td colspan="${matieres.length + 5}">Aucun élève dans cette évaluation.</td></tr>`}</tbody>
      <tfoot><tr><td class="col-rang"></td><td class="col-eleve">Moyenne / matière</td>${stats.moyennesParMatiere.map((m) => `<td>${m.moyenne !== null ? m.moyenne.toFixed(2) : '—'}</td>`).join('')}<td></td><td>${stats.moyenneClasse !== null ? stats.moyenneClasse.toFixed(2) : '—'}</td><td></td></tr></tfoot>
    </table></div>
    <p class="text-soft" style="margin-top:6px;">Saisissez les notes directement dans la grille, ou cliquez sur le nom d'un élève pour ouvrir sa fiche. Noms en <strong style="color:#2563eb;">bleu</strong> = garçons, en <strong style="color:#dc2626;">rouge</strong> = filles. Le rang est affiché en <strong style="color:var(--vert-600);">vert</strong> pour les élèves qui ont la moyenne, en <strong style="color:var(--terre-600);">rouge</strong> pour les autres.</p>
    <div class="grid grid-4" style="margin-top:12px;">
      <div class="card stat-card c-indigo"><div class="label">Élèves évalués</div><div class="value">${stats.nbClasses}/${eleveIds.length}</div></div>
      <div class="card stat-card c-vert"><div class="label">Ont eu la moyenne</div><div class="value">${nbReussite}/${stats.nbClasses}</div></div>
      <div class="card stat-card c-ocre"><div class="label">Moyenne de la classe</div><div class="value">${stats.moyenneClasse !== null ? stats.moyenneClasse.toFixed(2) + '/' + MOYENNE_BASE : '—'}</div></div>
      <div class="card stat-card c-terre"><div class="label">Taux de réussite</div><div class="value">${tauxReussite !== null ? tauxReussite.toFixed(0) + '%' : '—'}</div></div>
      <div class="card stat-card c-indigo"><div class="label">Statut</div><div class="value" style="font-size:16px;">${ev.statut === 'publie' ? 'Publiée' + (locked ? ' 🔒' : '') : 'Brouillon'}</div></div>
    </div>`;

    if (!locked) {
      // Navigation au clavier : flèches (et Entrée = ligne suivante) pour passer d'une case à l'autre
      $all('.note-input', $('#ev-table-wrap')).forEach((inp) => {
        inp.addEventListener('keydown', (e) => {
          const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'];
          if (!keys.includes(e.key)) return;
          const tr = inp.closest('tr');
          const cells = $all('.note-input', tr);
          const rows = $all('tbody tr', $('#ev-table-wrap')).filter((r) => $all('.note-input', r).length);
          let col = cells.indexOf(inp), row = rows.indexOf(tr);
          if (e.key === 'ArrowLeft') col--;
          else if (e.key === 'ArrowRight') col++;
          else if (e.key === 'ArrowUp') row--;
          else row++; // ArrowDown ou Enter
          if (row < 0 || row >= rows.length || col < 0 || col >= cells.length) { e.preventDefault(); return; }
          e.preventDefault();
          const cible = $all('.note-input', rows[row])[col];
          if (cible) { cible.focus(); cible.select(); }
        });
      });
      $all('.note-input', $('#ev-table-wrap')).forEach((inp) => {
        inp.addEventListener('change', async () => {
          const bareme = Number(inp.max) || 20;
          let val = inp.value === '' ? '' : Number(inp.value);
          if (val !== '' && (isNaN(val) || val < 0 || val > bareme)) {
            toast(`La note ne peut pas dépasser le barème (${bareme}).`);
            val = Math.min(Math.max(isNaN(val) ? 0 : val, 0), bareme);
          }
          const eId = Number(inp.dataset.eleve), mId = Number(inp.dataset.matiere);
          // On repart de la version enregistrée (elle a pu recevoir les notes d'un collègue) et on ne change QUE cette case
          const frais = (await DB.get('evaluations', ev.id)) || ev;
          frais.notes = frais.notes || [];
          const maj = Date.now();
          const n = frais.notes.find((x) => x.eleveId === eId && x.matiereId === mId);
          if (n) { n.note = val; n.t = maj; } else frais.notes.push({ eleveId: eId, matiereId: mId, note: val, t: maj });
          await DB.put('evaluations', frais);
          Object.assign(ev, frais);
          renderTable();
        });
      });
      if (restore) {
        const back = $('#ev-table-wrap').querySelector(`.note-input[data-eleve="${restore.e}"][data-matiere="${restore.m}"]`);
        if (back) { back.focus(); back.select(); }
      }
    }
  };
  renderTable();

  $('#ev-save').onclick = async () => { await DB.put('evaluations', ev); toast('Notes enregistrées.'); };
  $('#ev-classer').onclick = () => {
    const stats = computeEvaluationStats(ev, eleveMap, eleveIds);
    // 1er au 1er rang, puis par ordre alphabétique entre élèves à égalité ; les non-notés restent en bas.
    rowOrderIds = [...stats.rows].sort((a, b) => {
      if (a.moyenne === null && b.moyenne === null) return (a.eleve ? a.eleve.nom + a.eleve.prenom : '').localeCompare(b.eleve ? b.eleve.nom + b.eleve.prenom : '');
      if (a.moyenne === null) return 1;
      if (b.moyenne === null) return -1;
      if (b.moyenne !== a.moyenne) return b.moyenne - a.moyenne;
      return (a.eleve ? a.eleve.nom + a.eleve.prenom : '').localeCompare(b.eleve ? b.eleve.nom + b.eleve.prenom : '');
    }).map((r) => r.eleveId);
    renderTable();
    toast('Élèves classés par ordre de mérite.');
  };
  $('#ev-delete').onclick = async () => {
    if (await confirmDialog('Supprimer cette évaluation et toutes ses notes ?')) { await DB.delete('evaluations', ev.id); toast('Évaluation supprimée.'); _evUIState.evalId = null; onRouteChange(); }
  };
  $('#ev-print').onclick = () => imprimerEvaluation(ev, computeEvaluationStats(ev, eleveMap, eleveIds));
  $('#ev-synoptique').onclick = () => choisirMatieresSynoptique(ev, computeEvaluationStats(ev, eleveMap, eleveIds));
  const pubBtn = $('#ev-publish');
  if (pubBtn) pubBtn.onclick = async () => { ev.statut = 'publie'; ev.verrouillee = true; await DB.put('evaluations', ev); toast('Évaluation publiée et verrouillée.'); onRouteChange(); };
  const unpubBtn = $('#ev-unpublish');
  if (unpubBtn) unpubBtn.onclick = async () => { ev.verrouillee = false; await DB.put('evaluations', ev); toast('Évaluation déverrouillée : les notes redeviennent modifiables.'); onRouteChange(); };
}

/* --------- Formulaire de saisie par élève ---------
   Ouvert en cliquant sur le nom d'un élève dans la grille : affiche cet
   élève seul, avec toutes les matières de l'évaluation, le total des
   notes, la moyenne (calculés en direct pendant la saisie) et une
   appréciation. Au clic sur « Valider », les notes et l'appréciation
   repartent dans la grille déjà existante (aucun autre changement d'interface). */
async function openEleveEvaluationForm(evalId, eleveId) {
  const ev = await DB.get('evaluations', evalId);
  if (!ev) return;
  const eleve = await DB.get('eleves', eleveId);
  const matieres = ev.matieresEval || [];
  const locked = !!ev.verrouillee;
  const getNoteVal = (matiereId) => {
    const n = (ev.notes || []).find((x) => x.eleveId === eleveId && x.matiereId === matiereId);
    return n && n.note !== '' && n.note !== null && n.note !== undefined ? n.note : '';
  };
  const appreciationActuelle = (ev.appreciations || []).find((a) => a.eleveId === eleveId);

  const champs = matieres.map((m, i) => `<div class="field">
    <label style="font-size:15px;font-weight:800;color:#111;text-transform:none;letter-spacing:0;">${esc(m.nom)} <span style="font-size:13px;font-weight:600;color:#333;">(coef ${m.coefficient} · /${m.bareme})</span></label>
    <input type="number" min="0" max="${m.bareme}" step="0.25" class="eev-note" style="font-weight:800;font-size:16px;color:#111;" data-i="${i}" data-matiere="${m.matiereId}" data-bareme="${m.bareme}" data-coef="${m.coefficient}" value="${getNoteVal(m.matiereId)}" ${locked ? 'disabled' : ''}>
  </div>`).join('');

  const overlay = openModal(`${eleve ? esc(eleve.nom + ' ' + eleve.prenom) : 'Élève'} — ${esc(ev.nom)}`, `
    <div class="form-grid">${champs || '<p class="text-soft">Aucune matière dans cette évaluation.</p>'}</div>
    <div class="form-grid" style="margin-top:16px; padding-top:14px; border-top:1px solid var(--border);">
      <div class="field"><label style="font-size:15px;font-weight:800;color:#111;">Total des notes</label><input type="text" id="eev-total" value="—" disabled style="font-weight:800;font-size:16px;color:#111;-webkit-text-fill-color:#111;opacity:1;"></div>
      <div class="field"><label style="font-size:15px;font-weight:800;color:#111;">Moyenne (/${MOYENNE_BASE})</label><input type="text" id="eev-moyenne" value="—" disabled style="font-weight:800;font-size:16px;color:#111;-webkit-text-fill-color:#111;opacity:1;"></div>
      <div class="field full"><label style="font-size:15px;font-weight:800;color:#111;">Appréciation</label><input type="text" id="eev-appreciation" style="font-weight:800;font-size:16px;color:#111;-webkit-text-fill-color:#111;opacity:1;" value="${esc(appreciationActuelle ? appreciationActuelle.texte : '')}" ${locked ? 'disabled' : ''} placeholder="Suggestion automatique selon la moyenne"></div>
    </div>`, {
    wide: true,
    hideSave: locked,
    saveLabel: 'Valider',
    onSave: locked ? undefined : async (ov) => {
      ev.notes = ev.notes || [];
      $all('.eev-note', ov).forEach((inp) => {
        const matiereId = Number(inp.dataset.matiere);
        const val = inp.value === '' ? '' : Number(inp.value);
        let n = ev.notes.find((x) => x.eleveId === eleveId && x.matiereId === matiereId);
        if (!n) { n = { eleveId, matiereId, note: '' }; ev.notes.push(n); }
        n.note = val; n.t = Date.now();
      });
      ev.appreciations = ev.appreciations || [];
      let a = ev.appreciations.find((x) => x.eleveId === eleveId);
      const texte = $('#eev-appreciation', ov).value.trim();
      if (!a) { a = { eleveId, texte: '' }; ev.appreciations.push(a); }
      a.texte = texte;
      await DB.put('evaluations', ev);
      toast('Notes validées pour cet élève.');
      onRouteChange();
      return true;
    }
  });

  const appreciationInput = $('#eev-appreciation', overlay);
  if (appreciationActuelle && appreciationActuelle.texte) appreciationInput.dataset.touched = '1';
  appreciationInput.addEventListener('input', () => { appreciationInput.dataset.touched = '1'; });

  const recompute = () => {
    let total = 0, totalBareme = 0, sommeNorm = 0, sommeCoef = 0, n = 0;
    $all('.eev-note', overlay).forEach((inp) => {
      const v = inp.value;
      if (v === '') return;
      const bareme = Number(inp.dataset.bareme) || 20, coef = Number(inp.dataset.coef) || 1;
      const note = Number(v);
      total += note; totalBareme += bareme;
      sommeNorm += (note / bareme) * MOYENNE_BASE * coef; sommeCoef += coef; n++;
    });
    const moyenne = sommeCoef ? sommeNorm / sommeCoef : null;
    $('#eev-total', overlay).value = n ? `${total}/${totalBareme}` : '—';
    $('#eev-moyenne', overlay).value = moyenne !== null ? moyenne.toFixed(2) : '—';
    if (!locked && !appreciationInput.dataset.touched) appreciationInput.value = moyenne !== null ? appreciationSuggeree(moyenne) : '';
  };
  if (!locked) $all('.eev-note', overlay).forEach((inp) => inp.addEventListener('input', recompute));
  recompute();
}

async function imprimerEvaluation(ev, stats) {
  const classe = await DB.get('classes', ev.classeId);
  const matieres = ev.matieresEval || [];
  const sorted = [...stats.rows].sort((a, b) => {
    if (a.moyenne === null && b.moyenne === null) return 0;
    if (a.moyenne === null) return 1;
    if (b.moyenne === null) return -1;
    return b.moyenne - a.moyenne;
  });
  printDocument(`${ev.nom} — ${classe ? classe.nom : ''}`, `
    <h3 style="text-align:center;">${esc(ev.nom.toUpperCase())} — ${esc(classe ? classe.nom : '')}</h3>
    <p style="text-align:center;">${formatDate(ev.date)}${ev.anneeScolaire ? ' · Année scolaire ' + esc(ev.anneeScolaire) : ''}</p>
    <table style="width:100%;" border="1" cellpadding="5">
      <thead><tr><th>Rang</th><th>Élève</th>${matieres.map((m) => `<th>${esc(m.nom)} (coef ${m.coefficient})</th>`).join('')}<th>Total</th><th>Moyenne /${MOYENNE_BASE}</th><th>Appréciation</th></tr></thead>
      <tbody>${sorted.length ? sorted.map((r) => `<tr><td><strong style="color:${r.moyenne === null ? 'inherit' : (r.moyenne >= SEUIL_MOYENNE ? 'var(--vert-600)' : 'var(--terre-600)')};">${r.rang ?? '—'}</strong></td><td>${r.eleve ? esc(r.eleve.nom + ' ' + r.eleve.prenom) : '—'}</td>${r.cells.map((c) => `<td>${c.note !== null ? c.note : '—'}</td>`).join('')}<td>${r.nbNotes ? `${r.total}/${r.totalBareme}` : '—'}</td><td><strong>${r.moyenne !== null ? r.moyenne.toFixed(2) : '—'}</strong></td><td>${esc(r.appreciation || '—')}</td></tr>`).join('') : `<tr><td colspan="${matieres.length + 5}">Aucune donnée</td></tr>`}</tbody>
    </table>
    <p style="margin-top:14px;"><strong>Moyenne de la classe :</strong> ${stats.moyenneClasse !== null ? stats.moyenneClasse.toFixed(2) + '/' + MOYENNE_BASE : '—'} &nbsp; <strong>Élèves évalués :</strong> ${stats.nbClasses}/${stats.effectif}</p>`);
}

/* --------- Tableau synoptique (statistiques par matière) ---------
   Format classique utilisé après une évaluation : pour chaque matière,
   effectif noté, moyenne, note la plus haute/basse, nombre et taux de
   réussite (seuil 5/10) — puis la synthèse globale de la classe.
   Distinct du tableau nominatif (« Imprimer », qui liste chaque élève) :
   celui-ci sert à l'analyse et au rapport à l'inspection. */
function statsMatiereSynoptique(ev, matiere) {
  const notesSur20 = (ev.notes || [])
    .filter((n) => n.matiereId === matiere.matiereId && n.note !== '' && n.note !== null && n.note !== undefined)
    .map((n) => (Number(n.note) / (Number(matiere.bareme) || 20)) * MOYENNE_BASE);
  if (!notesSur20.length) return { effectifNote: 0, moyenne: null, max: null, min: null, nbReussite: 0, tauxReussite: null };
  const somme = notesSur20.reduce((a, b) => a + b, 0);
  const nbReussite = notesSur20.filter((n) => n >= SEUIL_MOYENNE).length;
  return {
    effectifNote: notesSur20.length,
    moyenne: somme / notesSur20.length,
    max: Math.max(...notesSur20),
    min: Math.min(...notesSur20),
    nbReussite,
    tauxReussite: Math.round((nbReussite / notesSur20.length) * 100)
  };
}

/* Choix des matières du tableau synoptique : on décoche celles dont on ne veut pas le tableau
   (ex. matière non enseignée dans la classe). Le choix est retenu sur cet appareil pour cette évaluation. */
function choisirMatieresSynoptique(ev, stats) {
  const matieres = ev.matieresEval || [];
  if (matieres.length <= 1) return imprimerTableauSynoptique(ev, stats);
  const cle = 'synoptique-exclus-' + ev.id;
  let exclus = [];
  try { exclus = JSON.parse(localStorage.getItem(cle) || '[]').map(String); } catch (e) { exclus = []; }
  openModal('Tableau synoptique : choisir les matières', `<p class="text-soft" style="margin-top:0;">Décochez les matières dont vous ne voulez pas le tableau synoptique.</p>
    ${matieres.map((m) => `<label style="display:flex; gap:10px; align-items:center; padding:7px 0;"><input type="checkbox" class="syn-chk" value="${esc(String(m.matiereId))}" ${exclus.includes(String(m.matiereId)) ? '' : 'checked'}> ${esc(m.nom)}</label>`).join('')}`, {
    saveLabel: 'Afficher le tableau',
    onSave: async (ov) => {
      const cases = $all('.syn-chk', ov), gardees = cases.filter((c) => c.checked).map((c) => c.value);
      if (!gardees.length) { toast('Gardez au moins une matière.'); return false; }
      try { localStorage.setItem(cle, JSON.stringify(cases.filter((c) => !c.checked).map((c) => c.value))); } catch (e) { /* sans importance */ }
      closeModal();
      imprimerTableauSynoptique(ev, stats, gardees);
      return false;
    }
  });
}

async function imprimerTableauSynoptique(ev, stats, idsMatieres) {
  const [classe, metaArr, eleves] = await Promise.all([DB.get('classes', ev.classeId), DB.getAll('meta'), DB.getAll('eleves')]);
  const meta = metaArr[0] || {};
  const eleveMap = Object.fromEntries(eleves.map((e) => [e.id, e]));
  const matieres = (ev.matieresEval || []).filter((m) => !idsMatieres || idsMatieres.includes(String(m.matiereId)));
  const idsGardes = new Set(matieres.map((m) => String(m.matiereId)));
  const notesGardees = (ev.notes || []).filter((n) => idsGardes.has(String(n.matiereId)));
  const sexeDe = (id) => ((eleveMap[id] && eleveMap[id].sexe) || '').toUpperCase().startsWith('F') ? 'F' : 'G';

  // Élèves ayant composé = au moins une note saisie
  const composants = new Set();
  notesGardees.forEach((n) => { if (n.note !== '' && n.note !== null && n.note !== undefined) composants.add(n.eleveId); });
  const nbG = [...composants].filter((id) => sexeDe(id) === 'G').length;
  const nbF = composants.size - nbG;

  // Par matière : effectifs G/F/T dans [0-4,99] et [5-10]
  const cases = matieres.map((m) => {
    const c = { bas: { G: 0, F: 0 }, haut: { G: 0, F: 0 } };
    (ev.notes || []).filter((n) => n.matiereId === m.matiereId).forEach((n) => {
      const v = noteSur20(ev, n); if (v === null) return;
      c[v >= SEUIL_MOYENNE ? 'haut' : 'bas'][sexeDe(n.eleveId)]++;
    });
    return c;
  });
  const p2 = (n) => String(n).padStart(2, '0');
  const bleu = 'color:#1a3fa8; font-family:"Segoe Print","Comic Sans MS",cursive;';
  const cel = (n) => `<td style="text-align:center; ${bleu}">${p2(n)}</td>`;
  // % = part des élèves notés dans la matière qui se trouvent dans cette tranche (les deux lignes totalisent 100 %)
  const pct = (c, cle) => { const tot = c.bas.G + c.bas.F + c.haut.G + c.haut.F; if (!tot) return '—'; return (Math.round((c[cle].G + c[cle].F) / tot * 1000) / 10).toString().replace('.', ',') + ' %'; };
  const celP = (txt) => `<td style="text-align:center; white-space:nowrap; ${bleu}">${txt}</td>`;
  const ligne = (lib, cle) => `<tr><td style="text-align:center; white-space:nowrap;">${lib}</td>${cases.map((c) => cel(c[cle].G) + cel(c[cle].F) + cel(c[cle].G + c[cle].F) + celP(pct(c, cle))).join('')}</tr>`;
  const pt = (v) => `<span style="${bleu}">${esc(v || '')}</span>`;
  const fin = '.'.repeat(18);
  const dateFait = formatDate(ev.date || todayISO());

  printDocument(`Tableau synoptique — ${ev.nom} — ${classe ? classe.nom : ''}`, `
    <div style="font-size:12px; line-height:1.35;">
      <div style="display:flex; justify-content:space-between; gap:20px;">
        <div style="flex:1; text-transform:uppercase;">
          MINISTÈRE DE L’ENSEIGNEMENT DE BASE, DE L’ALPHABÉTISATION ET DE LA PROMOTION DES LANGUES NATIONALES
          <div>********************</div>
          RÉGION DU ${esc((meta.region || '………').toUpperCase())}
          <div>********************</div>
          DIRECTION RÉGIONALE DE L’ÉDUCATION PRÉSCOLAIRE, PRIMAIRE ET NON FORMELLE
          <div>********************</div>
          SERVICE DE L’ENSEIGNEMENT PRIMAIRE
          <div>********************</div>
        </div>
        <div style="text-align:center; white-space:nowrap;">
          <div style="text-transform:uppercase;">Burkina Faso</div>
          <div>*******</div>
          <strong>La Patrie ou la Mort, nous Vaincrons.</strong>
        </div>
      </div>

      <h4 style="text-align:center; margin:18px 0 10px; font-family:Arial,sans-serif;">TABLEAU SYNOPTIQUE DES RÉSULTATS DE L’ÉVALUATION ${esc((ev.nom || '').toUpperCase())} DES CLASSES DE ${esc((classe ? classe.nom : '').toUpperCase())} (niveau école)</h4>

      <div style="display:flex; flex-wrap:wrap; gap:6px 24px; margin-bottom:6px;">
        <span>DREPPNF : ${esc((meta.region || '').toUpperCase())}</span>
        <span>DPEPPNF : ${pt(meta.dpeppnf)}</span>
        <span>CEB : ${pt(meta.ceb)}</span>
        <span>ÉCOLE : ${pt(meta.nomEcole)}</span>
      </div>
      <div>Année scolaire : <strong>${esc(ev.anneeScolaire || meta.anneeScolaire || '')}</strong></div>
      <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
        <span><strong>${esc(classe ? classe.nom : '')} : Effectif des élèves ayant composé :</strong> ${pt(composants.size)}</span>
        <span>Garçons : ${pt(nbG)} &nbsp;&nbsp; Filles : ${pt(nbF)}</span>
      </div>

      <table style="width:100%; border-collapse:collapse; font-size:12px;" border="1" cellpadding="6">
        <thead>
          <tr>
            <th rowspan="2" style="width:90px;"></th>
            ${matieres.map((m) => `<th colspan="4" style="font-weight:normal;">${esc(m.nom)}</th>`).join('')}
          </tr>
          <tr>${matieres.map(() => '<th>G</th><th>F</th><th>T</th><th>%</th>').join('')}</tr>
        </thead>
        <tbody>
          ${ligne('[0 - 4,99]', 'bas')}
          ${ligne('[5 - 10]', 'haut')}
        </tbody>
      </table>

      <div style="margin-top:28px; display:flex; justify-content:flex-end;">
        <div style="text-align:center; min-width:260px;">
          <div>Fait à ${pt(meta.lieu || '')}${meta.lieu ? '' : fin}, le ${esc(dateFait)}</div>
          <div style="margin-top:6px;">Le directeur de l’école</div>
          <div style="height:80px; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${meta.cachetDataUrl ? `<img src="${meta.cachetDataUrl}" alt="" style="max-height:80px; max-width:100px; object-fit:contain;">` : ''}
            ${meta.signatureDataUrl ? `<img src="${meta.signatureDataUrl}" alt="" style="max-height:60px; max-width:140px; object-fit:contain;">` : ''}
          </div>
          <div style="${bleu} font-size:15px;">${esc((meta.nomDirecteur || '').toUpperCase())}</div>
        </div>
      </div>
    </div>`, { sansCadre: true });
}


/* ---------------- Suivi des abandons (détection intelligente) ---------------- */
ROUTES['#/abandons'] = async (root) => {
  const [elevesAll, presences, evaluations, suivis, classes] = await Promise.all([
    DB.getAll('eleves'), DB.getAll('presencesEleves'), DB.getAll('evaluations'), DB.getAll('abandonsSuivi'), DB.getAll('classes')
  ]);
  const eleves = filtrerParClasseVisible(elevesAll);
  const classeMap = Object.fromEntries(classes.map((c) => [c.id, c.nom]));
  const actifs = eleves.filter((e) => (e.statut || 'actif') === 'actif');
  const since30 = Date.now() - 30 * 86400000;

  const risques = actifs.map((e) => {
    const pres = presences.filter((p) => p.eleveId === e.id && new Date(p.date).getTime() >= since30);
    const absences = pres.filter((p) => isPresenceAbsente(p.statut)).length;
    const tauxAbs = pres.length ? absences / pres.length : 0;
    const notes = [];
    evaluations.filter((ev) => ev.classeId === e.classeId).forEach((ev) => (ev.notes || []).filter((x) => x.eleveId === e.id).forEach((n) => { const v = noteSur20(ev, n); if (v !== null) notes.push(v); }));
    const moyenne = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null;
    const raisons = [];
    if (absences >= 5 || tauxAbs > 0.25) raisons.push('Absences répétées');
    if (moyenne !== null && moyenne < SEUIL_MOYENNE * 0.8) raisons.push('Résultats faibles');
    if (e.situationParticuliere) raisons.push('Situation sociale signalée : ' + e.situationParticuliere);
    return { eleve: e, absences, moyenne, raisons };
  }).filter((r) => r.raisons.length > 0).sort((a, b) => b.raisons.length - a.raisons.length);

  const abandonsConfirmes = eleves.filter((e) => e.statut === 'abandon');
  const parClasse = {}, parSexe = { M: 0, F: 0 }, parVillage = {};
  abandonsConfirmes.forEach((e) => {
    const cn = classeMap[e.classeId] || '—'; parClasse[cn] = (parClasse[cn] || 0) + 1;
    parSexe[e.sexe] = (parSexe[e.sexe] || 0) + 1;
    const v = e.village || 'Non renseigné'; parVillage[v] = (parVillage[v] || 0) + 1;
  });

  root.innerHTML = `
    <div class="alert alert-ocre">Détection automatique basée sur les absences des 30 derniers jours et les résultats aux évaluations. À confirmer par un suivi humain.</div>
    <div class="section-title"><h2>Élèves à risque d'abandon</h2><div class="line"></div></div>
    <div class="table-toolbar" style="margin-top:-4px;"><div style="flex:1;"></div><button class="btn btn-sm no-print" id="ab-pdf">Exporter PDF</button></div>
    <div class="table-wrap"><table><thead><tr><th>Élève</th><th>Classe</th><th>Absences (30j)</th><th>Moyenne</th><th>Raisons</th><th></th></tr></thead>
      <tbody>${risques.length ? risques.map((r) => `<tr>
        <td>${esc(r.eleve.nom)} ${esc(r.eleve.prenom)}</td><td>${esc(classeMap[r.eleve.classeId] || '—')}</td><td>${r.absences}</td><td>${r.moyenne !== null ? r.moyenne.toFixed(1) + '/' + MOYENNE_BASE : '—'}</td>
        <td class="wrap">${r.raisons.map((x) => `<span class="badge badge-terre" style="margin-right:4px;">${esc(x)}</span>`).join('')}</td>
        <td class="no-print"><button class="btn btn-sm" onclick="openSuiviAbandon(${r.eleve.id})">Suivre</button></td>
      </tr>`).join('') : `<tr><td colspan="6" class="text-soft">Aucun élève signalé à risque actuellement.</td></tr>`}</tbody></table></div>

    <div class="section-title"><h2>Suivi en cours</h2><div class="line"></div></div>
    <div id="suivi-list"></div>

    <div class="section-title"><h2>Statistiques des abandons confirmés</h2><div class="line"></div></div>
    <div class="grid grid-3">
      <div class="card"><h3>Par classe</h3>${Object.entries(parClasse).map(([k, v]) => `<div class="flex justify-between"><span>${esc(k)}</span><strong>${v}</strong></div>`).join('') || '<p class="text-soft">Aucun cas.</p>'}</div>
      <div class="card"><h3>Par sexe</h3><div class="flex justify-between"><span>Filles</span><strong>${parSexe.F || 0}</strong></div><div class="flex justify-between"><span>Garçons</span><strong>${parSexe.M || 0}</strong></div></div>
      <div class="card"><h3>Par village</h3>${Object.entries(parVillage).map(([k, v]) => `<div class="flex justify-between"><span>${esc(k)}</span><strong>${v}</strong></div>`).join('') || '<p class="text-soft">Aucun cas.</p>'}</div>
    </div>`;

  $('#ab-pdf').onclick = () => {
    const headers = ['Élève', 'Classe', 'Absences (30j)', 'Moyenne', 'Raisons'];
    const matrix = risques.map((r) => [`${r.eleve.nom} ${r.eleve.prenom}`, classeMap[r.eleve.classeId] || '—', r.absences, r.moyenne !== null ? r.moyenne.toFixed(1) + '/' + MOYENNE_BASE : '—', r.raisons.join(', ')]);
    pdfTable("Élèves à risque d'abandon", headers, matrix);
  };

  const suivis2 = await DB.getAll('abandonsSuivi');
  const eleveMap = Object.fromEntries(eleves.map((e) => [e.id, e]));
  $('#suivi-list').innerHTML = suivis2.length ? `<div class="table-wrap"><table><thead><tr><th>Élève</th><th>Détecté le</th><th>Rencontre parents</th><th>Visite domicile</th><th>Solution</th><th>Résultat</th><th>Statut</th><th></th></tr></thead>
    <tbody>${suivis2.map((s) => `<tr>
      <td>${eleveMap[s.eleveId] ? esc(eleveMap[s.eleveId].nom + ' ' + eleveMap[s.eleveId].prenom) : '—'}</td>
      <td>${formatDate(s.dateDetection)}</td><td>${esc(s.rencontreParents || '')}</td><td>${esc(s.visiteDomicile || '')}</td>
      <td class="wrap">${esc(s.solution || '')}</td><td class="wrap">${esc(s.resultat || '')}</td><td>${esc(s.statut || 'En cours')}</td>
      <td class="no-print"><button class="btn btn-sm" onclick="openSuiviAbandon(${s.eleveId})">Modifier</button></td>
    </tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">Aucun suivi enregistré pour le moment.</div>`;
};

async function openSuiviAbandon(eleveId) {
  const all = await DB.getAll('abandonsSuivi');
  const row = all.find((s) => s.eleveId === eleveId) || { eleveId, dateDetection: todayISO() };
  openModal('Suivi anti-abandon', `<div class="form-grid">
    <div class="field"><label>Rencontre avec les parents</label><input id="sa-rencontre" value="${esc(row.rencontreParents || '')}" placeholder="Date / compte-rendu"></div>
    <div class="field"><label>Visite à domicile</label><input id="sa-visite" value="${esc(row.visiteDomicile || '')}" placeholder="Date / compte-rendu"></div>
    <div class="field full"><label>Motif identifié</label><textarea id="sa-motif">${esc(row.motif || '')}</textarea></div>
    <div class="field full"><label>Solution proposée</label><textarea id="sa-solution">${esc(row.solution || '')}</textarea></div>
    <div class="field full"><label>Résultat du suivi</label><textarea id="sa-resultat">${esc(row.resultat || '')}</textarea></div>
    <div class="field"><label>Statut</label><select id="sa-statut">
      <option ${row.statut === 'En cours' || !row.statut ? 'selected' : ''}>En cours</option>
      <option ${row.statut === 'Résolu' ? 'selected' : ''}>Résolu</option>
      <option ${row.statut === 'Abandon confirmé' ? 'selected' : ''}>Abandon confirmé</option>
    </select></div>
  </div>`, {
    onSave: async () => {
      row.rencontreParents = $('#sa-rencontre').value; row.visiteDomicile = $('#sa-visite').value;
      row.motif = $('#sa-motif').value; row.solution = $('#sa-solution').value; row.resultat = $('#sa-resultat').value;
      row.statut = $('#sa-statut').value;
      if (row.id) await DB.put('abandonsSuivi', row); else await DB.add('abandonsSuivi', row);
      if (row.statut === 'Abandon confirmé') { const e = await DB.get('eleves', eleveId); const ancien = e.statut; e.statut = 'abandon'; registreMajSortieEleve(e, ancien); await DB.put('eleves', e); }
      toast('Suivi enregistré.');
      onRouteChange();
      return true;
    }
  });
}

/* ============================================================
   Passage de classe — fin d'année scolaire et suivi pluriannuel
   ============================================================
   Chaque élève reçoit, à chaque passage validé, une ligne dans son propre
   historique (eleve.historiqueClasses) : classe et année concernées, décision
   (admis / redouble / quitte l'école), et moyenne annuelle calculée à partir
   de toutes les compositions de l'année. Rien n'est supprimé : les évaluations
   et bulletins de l'année qui se termine restent consultables exactement comme
   avant, puisqu'ils gardent leur propre classeId et anneeScolaire figés. */

const ORDRE_NIVEAUX = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];

/* Règle de passage en vigueur au Burkina Faso (MENA) :
   - CP1, CE1, CM1 : passage automatique de tous les élèves, aucun redoublement.
   - CP2, CE2 : seuls 10 % des élèves n'ayant pas eu la moyenne redoublent (les autres
     passent malgré tout) ; c'est un quota qui limite le taux de redoublement.
   - CM2 : non concerné par ces deux règles (le passage dépend du CEP), laissé au choix
     du directeur avec une simple suggestion basée sur la moyenne. */
const NIVEAUX_SANS_REDOUBLEMENT = ['CP1', 'CE1', 'CM1'];
const NIVEAUX_QUOTA_REDOUBLEMENT = ['CP2', 'CE2'];
const QUOTA_REDOUBLEMENT = 0.10;

function niveauSuivant(niveau) {
  const i = ORDRE_NIVEAUX.indexOf(niveau);
  if (i === -1 || i === ORDRE_NIVEAUX.length - 1) return null; // CM2 : fin du primaire
  return ORDRE_NIVEAUX[i + 1];
}

/* Moyenne d'un élève sur toute une année scolaire : moyenne simple des
   moyennes obtenues à chaque composition de cette classe et cette année. */
async function moyenneAnnuelleEleve(eleveId, classeId, anneeScolaire) {
  const evals = (await DB.getAll('evaluations')).filter((e) => e.classeId === classeId && (e.anneeScolaire || anneeScolaireCourante()) === anneeScolaire);
  const eleve = await DB.get('eleves', eleveId);
  const eleveMap = { [eleveId]: eleve };
  const moyennes = [];
  for (const ev of evals) {
    const stats = computeEvaluationStats(ev, eleveMap, [eleveId]);
    const r = stats.rows[0];
    if (r && r.moyenne !== null) moyennes.push(r.moyenne);
  }
  return moyennes.length ? moyennes.reduce((a, b) => a + b, 0) / moyennes.length : null;
}

ROUTES['#/passage'] = async (root) => {
  const meta = (await DB.getAll('meta'))[0] || { anneeScolaire: anneeScolaireCourante() };
  const anneeSortante = meta.anneeScolaire || anneeScolaireCourante();
  const m = anneeSortante.match(/^(\d{4})-(\d{4})$/);
  const anneeSuivanteDefaut = m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : '';
  const classes = (await DB.getAll('classes')).filter((c) => ORDRE_NIVEAUX.includes(c.niveau))
    .sort((a, b) => ORDRE_NIVEAUX.indexOf(a.niveau) - ORDRE_NIVEAUX.indexOf(b.niveau));
  const classesByNiveau = Object.fromEntries(classes.map((c) => [c.niveau, c]));
  const eleves = (await DB.getAll('eleves')).filter((e) => (e.statut || 'actif') === 'actif');

  root.innerHTML = `
    <div class="card">
      <p>Ce passage clôture l'année scolaire <strong>${esc(anneeSortante)}</strong> : chaque élève reçoit une décision (admis·e, redouble, ou quitte l'école) et avance vers l'année suivante. <strong>Rien n'est supprimé</strong> : les notes et bulletins de ${esc(anneeSortante)} restent consultables comme avant dans « Évaluations &amp; bulletins ».</p>
      <p class="text-soft" style="margin-top:6px;">Règle appliquée automatiquement : passage sans redoublement en CP1, CE1 et CM1 ; en CP2 et CE2, seuls 10&nbsp;% des élèves n'ayant pas eu la moyenne redoublent. Chaque décision reste modifiable avant de valider.</p>
      <div class="form-grid" style="margin-top:10px;">
        <div class="field"><label>Nouvelle année scolaire</label><input id="pg-annee" value="${esc(anneeSuivanteDefaut)}" placeholder="2027-2028"></div>
      </div>
    </div>
    <div id="pg-classes" style="margin-top:14px;"><div class="empty-state">Calcul des moyennes annuelles…</div></div>
    <div class="table-toolbar no-print" style="margin-top:14px;"><div style="flex:1;"></div><button class="btn btn-accent" id="pg-valider">Valider le passage de classe</button></div>`;

  const blocs = [];
  for (const c of classes) {
    const elevesClasse = eleves.filter((e) => e.classeId === c.id).sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
    if (!elevesClasse.length) continue;
    const estDernierNiveau = !niveauSuivant(c.niveau);
    const sansRedoublement = NIVEAUX_SANS_REDOUBLEMENT.includes(c.niveau);
    const soumisQuota = NIVEAUX_QUOTA_REDOUBLEMENT.includes(c.niveau);

    // 1) moyenne annuelle de chaque élève de la classe
    const rows = [];
    for (const e of elevesClasse) rows.push({ eleve: e, moy: await moyenneAnnuelleEleve(e.id, c.id, anneeSortante) });

    // 2) décision suggérée selon la règle en vigueur au Burkina Faso pour ce niveau
    const suggestions = {};
    let noteQuota = '';
    if (sansRedoublement) {
      rows.forEach((r) => { suggestions[r.eleve.id] = 'admis'; });
    } else if (soumisQuota) {
      const echecs = rows.filter((r) => r.moy !== null && r.moy < SEUIL_MOYENNE);
      const nbRedoublants = Math.round(echecs.length * QUOTA_REDOUBLEMENT);
      const echecsTries = [...echecs].sort((a, b) => a.moy - b.moy); // les plus faibles moyennes d'abord
      rows.forEach((r) => { suggestions[r.eleve.id] = 'admis'; }); // par défaut : admis (y compris sans la moyenne)
      echecsTries.slice(0, nbRedoublants).forEach((r) => { suggestions[r.eleve.id] = 'redouble'; });
      noteQuota = `<p class="text-soft" style="margin:4px 0 10px;">Règle MENA : au plus ${Math.round(QUOTA_REDOUBLEMENT * 100)}&nbsp;% des élèves n'ayant pas eu la moyenne redoublent. ${echecs.length} élève(s) sans la moyenne → <strong>${nbRedoublants} redoublant(s)</strong> retenu(s) (les plus faibles moyennes) ; les ${echecs.length - nbRedoublants} autre(s) passent malgré tout. Modifiable élève par élève si besoin.</p>`;
    } else {
      rows.forEach((r) => { suggestions[r.eleve.id] = r.moy === null ? 'admis' : (r.moy >= SEUIL_MOYENNE ? 'admis' : 'redouble'); });
    }

    const lignes = rows.map(({ eleve: e, moy }) => `<tr data-eleve="${e.id}" data-classe="${c.id}">
        <td>${esc(e.nom)} ${esc(e.prenom)}</td>
        <td style="text-align:center;">${moy !== null ? moy.toFixed(2) + '/' + MOYENNE_BASE : '—'}</td>
        <td><select class="pg-decision">
          <option value="admis" ${suggestions[e.id] === 'admis' ? 'selected' : ''}>${estDernierNiveau ? 'Admis(e) — fin du primaire' : 'Admis(e) en ' + niveauSuivant(c.niveau)}</option>
          ${sansRedoublement ? '' : `<option value="redouble" ${suggestions[e.id] === 'redouble' ? 'selected' : ''}>Redouble le ${esc(c.niveau)}</option>`}
          <option value="abandon">Quitte l'école</option>
        </select></td>
      </tr>`).join('');

    blocs.push(`<div class="section-title"><h2>${esc(c.nom)} <span class="text-soft" style="font-weight:400;">(${elevesClasse.length} élève${elevesClasse.length > 1 ? 's' : ''})</span></h2><div class="line"></div></div>
      ${sansRedoublement ? `<p class="text-soft" style="margin:4px 0 10px;">Règle MENA : passage automatique, sans redoublement à ce niveau.</p>` : noteQuota}
      <div class="table-wrap"><table><thead><tr><th>Élève</th><th>Moyenne annuelle</th><th>Décision</th></tr></thead><tbody>${lignes}</tbody></table></div>`);
  }
  $('#pg-classes').innerHTML = blocs.join('') || '<div class="empty-state">Aucun élève actif à faire passer.</div>';

  $('#pg-valider').onclick = async () => {
    const nouvelleAnnee = $('#pg-annee').value.trim();
    if (!nouvelleAnnee) { toast('Indiquez la nouvelle année scolaire.'); return; }
    const lignes = $all('#pg-classes tr[data-eleve]');
    if (!lignes.length) { toast('Aucun élève à faire passer.'); return; }
    if (!(await confirmDialog(`Valider le passage de classe de ${lignes.length} élève(s) vers l'année ${nouvelleAnnee} ? Cette action déplace les élèves admis vers la classe supérieure et change l'année scolaire active de l'école.`))) return;

    for (const tr of lignes) {
      const eleveId = Number(tr.dataset.eleve), classeId = Number(tr.dataset.classe);
      const decision = $('.pg-decision', tr).value;
      const classe = classes.find((c) => c.id === classeId);
      const eleve = await DB.get('eleves', eleveId);
      if (!eleve) continue;
      const moy = await moyenneAnnuelleEleve(eleveId, classeId, anneeSortante);
      eleve.historiqueClasses = [...(eleve.historiqueClasses || []), {
        classeId, niveau: classe ? classe.niveau : eleve.niveau, anneeScolaire: anneeSortante,
        decision, moyenneAnnuelle: moy, jusquau: todayISO()
      }];
      if (decision === 'abandon') {
        eleve.statut = 'abandon';
      } else if (decision === 'admis') {
        const suivant = classe ? niveauSuivant(classe.niveau) : null;
        if (suivant && classesByNiveau[suivant]) {
          eleve.classeId = classesByNiveau[suivant].id;
          eleve.niveau = suivant;
        } else {
          eleve.statut = 'diplome'; // dernier niveau admis : fin du primaire
        }
      } // redouble : classe inchangée
      registreMajSortieEleve(eleve, 'actif'); // abandon / fin du primaire : date de sortie du registre matricule
      await DB.put('eleves', eleve);
    }

    meta.anneeScolaire = nouvelleAnnee;
    await DB.put('meta', meta);
    toast(`Passage de classe effectué. Année scolaire active : ${nouvelleAnnee}.`);
    location.hash = '#/dashboard';
  };
};
