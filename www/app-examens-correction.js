/* ============================================================
   app-examens-correction.js — Espace Examen : correction et résultats
   ------------------------------------------------------------
   CORRECTION : saisie des notes sous code d'anonymat uniquement (aucun
   nom à l'écran), épreuve par épreuve, avec double correction et
   arbitrage si l'écart dépasse la tolérance.
   RÉSULTATS : délibération (moyennes, décisions, repêchage motivé,
   classement, mentions), clôture, statistiques, documents, report des
   admis dans les dossiers élèves.
   ============================================================ */

/* ---------------- Enregistrement d'une note ----------------
   _uuid déterministe : une seule ligne par (session, épreuve, code), même si
   deux appareils saisissent en même temps → pas de doublon à la synchronisation. */
let _exFileNotes = Promise.resolve();
async function exSauverNoteInterne(session, epreuveCode, anonymat, champs) {
  const uuid = deterministicUuid(`examNote:${session._uuid}:${epreuveCode}:${anonymat}`);
  // Toujours relire la ligne en base : jamais de copie périmée qui écraserait une saisie précédente
  const tous = await DB.getAll('examNotes');
  const obj = { ...(tous.find((n) => n._uuid === uuid) || { _uuid: uuid, sessionUuid: session._uuid, epreuveCode, anonymat }) };
  Object.assign(obj, champs, { maj: new Date().toISOString(), par: currentUser ? currentUser.nom : '' });
  if (obj.id) await DB.put('examNotes', obj);
  else obj.id = await DB.add('examNotes', obj);
  return obj;
}
/* Les enregistrements passent l'un après l'autre : deux saisies rapprochées sur la même copie
   (ex. correcteur 1 puis correcteur 2) ne peuvent pas créer deux lignes ni s'écraser. */
function exSauverNote(session, epreuveCode, anonymat, champs) {
  const p = _exFileNotes.then(() => exSauverNoteInterne(session, epreuveCode, anonymat, champs));
  _exFileNotes = p.catch(() => {});
  return p;
}

function exCelluleEtat(f, bareme) {
  switch (f.etat) {
    case 'ok': return `<span class="badge badge-vert">${exFmt(f.valeur)} / ${esc(bareme)}${f.arbitre ? ' (arbitrage)' : ''}</span>`;
    case 'ecart': return `<span class="badge badge-terre">Écart ${exFmt(f.ecart)} → 3e correction</span>`;
    case 'incomplet': return '<span class="badge badge-ocre">2e note manquante</span>';
    case 'absent': return '<span class="badge badge-indigo">Absent</span>';
    case 'fraude': return '<span class="badge badge-terre">Fraude : 0</span>';
    default: return '<span class="text-soft">—</span>';
  }
}

EX_RENDERERS.correction = async (c, ctx) => {
  const { session, candidats, notes } = ctx;
  const eps = session.epreuves || [];
  const dir = exDirection();
  if (!eps.length) { c.innerHTML = '<div class="empty-state">Aucune épreuve définie : ouvrez « Paramètres de la session ».</div>'; return; }
  if (!candidats.length) { c.innerHTML = '<div class="empty-state"><div class="big">✎</div>Aucun candidat dans cette session.</div>'; return; }
  const aCoder = candidats.filter((x) => !x.anonymat && !['absent', 'exclu'].includes(x.statut));
  if (aCoder.length) {
    c.innerHTML = `<div class="alert alert-ocre">${aCoder.length} candidat(s) n'ont pas encore de code d'anonymat. La correction se fait uniquement sous codes (aucun nom n'apparaît).</div>
      ${dir ? '<button class="btn btn-accent" id="ex-co-gen">Générer les codes d\'anonymat</button>' : '<p class="text-soft">Demandez à la direction de générer les codes (onglet Candidats).</p>'}`;
    if ($('#ex-co-gen')) $('#ex-co-gen').onclick = () => exGenererCodes(ctx);
    return;
  }
  if (!eps.some((e) => e.code === EX_ETAT.epreuve)) EX_ETAT.epreuve = eps[0].code;
  const ep = eps.find((e) => e.code === EX_ETAT.epreuve);
  const bareme = Number(ep.bareme) || 20;
  const verrou = !!session.resultatsVerrouilles;
  const double = !!session.doubleCorrection;
  const a = exAnalyse(ctx);
  const cands = candidats.filter((x) => x.anonymat && !['absent', 'exclu'].includes(x.statut)).sort((x, y) => x.anonymat.localeCompare(y.anonymat));
  const idx = new Map();
  notes.filter((n) => n.epreuveCode === ep.code).forEach((n) => idx.set(n.anonymat, n));

  const inp = (an, k, n, off) => `<input class="ex-note" data-k="${k}" inputmode="decimal" autocomplete="off" value="${esc(n && n[k] !== undefined && n[k] !== null ? n[k] : '')}" ${verrou || off ? 'disabled' : ''} aria-label="${k} ${an}">`;
  const ligne = (x) => {
    const n = idx.get(x.anonymat) || null;
    const f = exNoteFinale(n, ep, session);
    const off = !!(n && (n.absent || n.fraude));
    return `<tr data-an="${esc(x.anonymat)}" class="${f.etat === 'ecart' ? 'ex-ligne-ecart' : ''}">
      <td style="font-family:var(--font-mono);font-weight:700;font-size:15px;">${esc(x.anonymat)}</td>
      <td>${inp(x.anonymat, 'n1', n, off)}</td>
      ${double ? `<td>${inp(x.anonymat, 'n2', n, off)}</td><td>${inp(x.anonymat, 'n3', n, off)}</td>` : ''}
      <td style="text-align:center;"><input type="checkbox" data-k="absent" ${n && n.absent ? 'checked' : ''} ${verrou ? 'disabled' : ''} aria-label="Absent ${esc(x.anonymat)}"></td>
      <td style="text-align:center;"><input type="checkbox" data-k="fraude" ${n && n.fraude ? 'checked' : ''} ${verrou ? 'disabled' : ''} aria-label="Fraude ${esc(x.anonymat)}"></td>
      <td class="ex-etat">${exCelluleEtat(f, bareme)}</td></tr>`;
  };

  c.innerHTML = `
    ${verrou ? '<div class="alert alert-vert">La délibération est clôturée : les notes sont en lecture seule.</div>' : ''}
    ${a.ecarts ? `<div class="alert alert-terre">${a.ecarts} copie(s) avec un écart supérieur à la tolérance : une 3e correction (arbitrage) est requise.</div>` : ''}
    <div class="tabs no-print" id="ex-co-eps" style="margin-bottom:10px;">${eps.map((e) => {
      const p = a.progression.find((q) => q.ep.code === e.code) || { faites: 0, total: 0 };
      return `<button class="tab ${e.code === ep.code ? 'active' : ''}" data-ep="${esc(e.code)}">${esc(e.nom)} <span class="text-soft">${p.faites}/${p.total}</span></button>`;
    }).join('')}</div>
    <div class="card" style="padding:12px 16px; margin-bottom:12px;">
      <div class="flex items-center gap-12" style="flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;"><div style="font-weight:700;">${esc(ep.nom)} — barème /${esc(bareme)} · coefficient ${esc(ep.coef)}</div>
          <div class="text-soft" style="font-size:12.5px;">${double ? `Double correction : saisissez les deux notes ; si l'écart dépasse ${exFmt(exNum(session.toleranceEcart) ?? 3)} pt/20, saisissez la 3e correction.` : 'Correction simple.'} Cochez « Abs. » pour un candidat absent à cette épreuve.</div></div>
        <button class="btn btn-sm no-print" id="ex-co-fiche">Fiche de correction anonyme (PDF)</button>
        <button class="btn btn-sm no-print" id="ex-co-fiches">Fiches de toutes les épreuves</button>
      </div>
      <div class="progress" style="margin-top:10px;"><div id="ex-co-bar" style="width:0%;"></div></div>
      <div class="text-soft" style="font-size:12px;margin-top:4px;" id="ex-co-txt"></div>
    </div>
    <div class="table-wrap"><table class="ex-grille" style="font-size:13px;"><thead><tr>
      <th>Code</th><th>${double ? 'Correcteur 1' : 'Note'}</th>${double ? '<th>Correcteur 2</th><th>3e (arbitrage)</th>' : ''}<th>Abs.</th><th>Fraude</th><th>Note finale</th></tr></thead>
      <tbody id="ex-co-corps">${cands.map(ligne).join('')}</tbody></table></div>`;

  const majProgression = () => {
    if (!$('#ex-co-bar')) return; // onglet quitté pendant qu'une sauvegarde se terminait
    let faites = 0;
    cands.forEach((x) => { const f = exNoteFinale(idx.get(x.anonymat) || null, ep, session); if (['ok', 'absent', 'fraude'].includes(f.etat)) faites++; });
    const pct = cands.length ? Math.round(faites / cands.length * 100) : 0;
    $('#ex-co-bar').style.width = pct + '%';
    $('#ex-co-txt').textContent = `${faites} copie(s) complète(s) sur ${cands.length} (${pct} %)`;
    const onglet = $(`[data-ep="${ep.code}"] .text-soft`, $('#ex-co-eps'));
    if (onglet) onglet.textContent = `${faites}/${cands.length}`;
  };
  majProgression();

  $('#ex-co-eps').onclick = (e) => { const b = e.target.closest('[data-ep]'); if (b) { EX_ETAT.epreuve = b.dataset.ep; onRouteChange(); } };
  $('#ex-co-fiche').onclick = () => exDocFichesCorrection(ctx, ep.code);
  $('#ex-co-fiches').onclick = () => exDocFichesCorrection(ctx, null);

  const corps = $('#ex-co-corps');
  if (!corps) return;
  corps.onchange = async (e) => {
    const el = e.target, tr = el.closest('tr');
    if (!tr || !el.dataset.k) return;
    if (session.resultatsVerrouilles) { toast('La délibération est clôturée.'); return; }
    const an = tr.dataset.an, k = el.dataset.k, n = idx.get(an) || null;
    const champs = {};
    if (k === 'absent' || k === 'fraude') {
      champs[k] = el.checked;
      if (el.checked) champs[k === 'absent' ? 'fraude' : 'absent'] = false;
    } else {
      const brut = el.value.trim();
      if (brut === '') champs[k] = '';
      else {
        const val = exNum(brut);
        if (val === null || val < 0 || val > bareme) { toast(`Note invalide : saisissez un nombre entre 0 et ${bareme}.`); el.value = n && n[k] !== undefined && n[k] !== null ? n[k] : ''; return; }
        champs[k] = val;
      }
    }
    try {
      const saved = await exSauverNote(session, ep.code, an, champs);
      idx.set(an, saved);
      const f = exNoteFinale(saved, ep, session);
      tr.classList.toggle('ex-ligne-ecart', f.etat === 'ecart');
      $('.ex-etat', tr).innerHTML = exCelluleEtat(f, bareme);
      const off = !!(saved.absent || saved.fraude);
      $all('input.ex-note', tr).forEach((x) => { x.disabled = off; });
      if (k === 'absent' || k === 'fraude') { const autre = $(`[data-k="${k === 'absent' ? 'fraude' : 'absent'}"]`, tr); if (autre) autre.checked = !!saved[k === 'absent' ? 'fraude' : 'absent']; }
      majProgression();
    } catch (err) { console.error(err); toast("Échec de l'enregistrement de cette note."); }
  };
  // Entrée = passer à la copie suivante dans la même colonne (saisie rapide au clavier ou sur téléphone)
  corps.onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('ex-note')) return;
    e.preventDefault();
    e.target.blur();
    const suiv = e.target.closest('tr').nextElementSibling;
    if (suiv) { const t = $(`input[data-k="${e.target.dataset.k}"]`, suiv); if (t && !t.disabled) { t.focus(); t.select(); } }
  };
};

/* ============================================================
   RÉSULTATS
   ============================================================ */
function exBadgeDecision(l) {
  const m = { admis: 'vert', ajourne: 'terre', absent: 'indigo', exclu: 'terre', en_attente: 'ocre' };
  return `<span class="badge badge-${m[l.decision] || 'indigo'}" ${l.motif ? `title="${esc(l.motif)}"` : ''}>${esc(EX_DECISIONS[l.decision])}${l.repeche ? ' (repêché)' : ''}</span>`;
}

EX_RENDERERS.resultats = async (c, ctx) => {
  const { session, candidats, notes } = ctx;
  const eps = session.epreuves || [];
  if (!candidats.length) { c.innerHTML = '<div class="empty-state"><div class="big">🏆</div>Aucun candidat dans cette session.</div>'; return; }
  const dir = exDirection(), verrou = !!session.resultatsVerrouilles;
  const res = exCalculerResultats(session, candidats, notes);
  const g = res.stats.global;
  const blanc = session.type === 'blanc';

  c.innerHTML = `
    ${g.attente ? `<div class="alert alert-ocre">${g.attente} candidat(s) en attente : notes incomplètes ou écart à arbitrer (onglet Correction). Leurs résultats ne sont pas encore définitifs.</div>` : ''}
    ${verrou ? `<div class="alert alert-vert">✔ Délibération clôturée${session.dateCloture ? ' le ' + formatDate(session.dateCloture) : ''}. Notes et décisions sont verrouillées.</div>` : ''}
    ${blanc ? '<div class="alert alert-ocre">Examen blanc : les résultats servent à l\'entraînement et ne peuvent pas être reportés dans les dossiers des élèves.</div>' : ''}
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Présents</div><div class="value">${g.presents}</div><div class="foot">sur ${g.inscrits} inscrits · ${g.absents} absent(s)</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Admis</div><div class="value">${g.admis}</div><div class="foot">${res.lignes.filter((l) => l.repeche).length} repêché(s) par le jury</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Ajournés</div><div class="value">${g.ajournes}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Taux de réussite</div><div class="value">${g.taux === null ? '—' : exFmt(g.taux, 1) + ' %'}</div><div class="foot">moyenne générale ${exFmt(res.stats.moyenneGenerale)} /20</div></div>
    </div>
    <div class="table-toolbar no-print">
      <button class="btn btn-sm" id="ex-r-admis">Liste des admis</button>
      <button class="btn btn-sm" id="ex-r-merite">Palmarès (mérite)</button>
      <button class="btn btn-sm" id="ex-r-ecole">Résultats par école</button>
      <button class="btn btn-sm" id="ex-r-pv">PV de délibération</button>
      <button class="btn btn-sm" id="ex-r-stats">Statistiques</button>
      <button class="btn btn-sm" id="ex-r-releves">Relevés de notes</button>
      <button class="btn btn-sm" id="ex-r-attest">Attestations de réussite</button>
      <button class="btn btn-sm" id="ex-r-csv">Excel (CSV)</button>
      <button class="btn btn-sm" id="ex-r-word">Admis (Word)</button>
      ${dir && verrou && !blanc ? '<button class="btn btn-sm" id="ex-r-ecoles">Résultats par école (▼ fichiers)</button>' : ''}
    </div>
    ${dir ? `<div class="table-toolbar no-print">
      ${verrou ? '<button class="btn btn-sm btn-danger" id="ex-r-ouvrir">Rouvrir la délibération</button>' : '<button class="btn btn-accent" id="ex-r-cloturer">Clôturer la délibération</button>'}
      ${verrou && !blanc ? '<button class="btn btn-sm" id="ex-r-report">Reporter les admis dans les dossiers élèves</button><button class="btn" id="ex-r-up">Transmettre à la DPEPPNF (fichier .json, secours)</button>' + (currentUser && currentUser.role === 'ceb' && typeof cepTransmettreBordereau === 'function' ? '<button class="btn btn-accent" id="ex-r-srv">⇪ Transmettre par le serveur</button>' : '') : ''}
    </div>` : ''}
    <div class="table-toolbar">
      <input class="search-input" id="ex-r-q" placeholder="Rechercher (nom, école, n° de table)">
      <select id="ex-r-dec" class="search-input"><option value="">Toutes les décisions</option>${Object.entries(EX_DECISIONS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
      <select id="ex-r-ord" class="search-input"><option value="merite">Classement par mérite</option><option value="alpha">Ordre alphabétique</option><option value="table">N° de table</option></select>
    </div>
    <div id="ex-r-tab"></div>
    <h3 style="margin:22px 0 8px;">Statistiques</h3>
    <div id="ex-r-stats-zone">${exHtmlStatsBloc(ctx, res)}</div>`;

  let vue = res.lignes;
  const rendre = () => {
    const q = $('#ex-r-q').value.toLowerCase(), dec = $('#ex-r-dec').value, ord = $('#ex-r-ord').value;
    vue = res.lignes.filter((l) => (!dec || l.decision === dec) && (!q || [exNomComplet(l.candidat), l.candidat.ecole, l.candidat.numeroTable].join(' ').toLowerCase().includes(q)));
    vue.sort((a, b) => ord === 'alpha' ? exCmpNom(a.candidat, b.candidat)
      : ord === 'table' ? String(a.candidat.numeroTable || '\uffff').localeCompare(String(b.candidat.numeroTable || '\uffff'))
      : (a.rang ?? 1e9) - (b.rang ?? 1e9) || exCmpNom(a.candidat, b.candidat));
    $('#ex-r-tab').innerHTML = `<div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr>
      <th>Candidat</th><th>Rang</th><th>N° table</th><th>École</th>${eps.map((e) => `<th title="${esc(e.nom)}">${esc(e.nom.length > 14 ? e.nom.slice(0, 13) + '…' : e.nom)}<br><span style="font-weight:400;">/${esc(e.bareme)} ×${esc(e.coef)}</span></th>`).join('')}
      <th>Moyenne /20</th><th>Décision</th><th>Mention</th>${dir && !verrou ? '<th class="no-print"></th>' : ''}</tr></thead>
      <tbody>${vue.map((l, i) => `<tr>
        <td class="wrap" style="font-weight:600;">${esc(exNomComplet(l.candidat))}</td>
        <td style="font-weight:700;">${l.rang ?? '—'}</td>
        <td>${esc(l.candidat.numeroTable) || '—'}</td>
        <td class="wrap">${esc(l.candidat.ecole) || '—'}</td>
        ${l.details.map((d) => `<td style="text-align:center;">${d.etat === 'absent' ? '<span class="text-soft">abs.</span>' : d.valeur === null ? '<span class="text-soft">—</span>' : exFmt(d.valeur) + (d.etat === 'fraude' ? ' ⚠' : '')}</td>`).join('')}
        <td style="font-weight:700;text-align:center;">${exFmt(l.moyenne)}</td>
        <td>${exBadgeDecision(l)}${l.motif && l.decision === 'en_attente' ? `<div class="text-soft" style="font-size:11px;">${esc(l.motif)}</div>` : ''}</td>
        <td>${esc(l.mention) || '—'}</td>
        ${dir && !verrou ? `<td class="no-print">${['admis', 'ajourne'].includes(l.calc) ? `<button class="btn btn-sm" data-dec="${i}">Décision du jury</button>` : ''}</td>` : ''}
      </tr>`).join('') || `<tr><td colspan="${eps.length + 8}">Aucun résultat.</td></tr>`}</tbody></table></div>`;
    $all('[data-dec]', $('#ex-r-tab')).forEach((b) => { b.onclick = () => exFormDecision(ctx, vue[Number(b.dataset.dec)]); });
  };
  ['#ex-r-q'].forEach((s) => { $(s).oninput = rendre; });
  ['#ex-r-dec', '#ex-r-ord'].forEach((s) => { $(s).onchange = rendre; });
  rendre();

  $('#ex-r-admis').onclick = () => exDocAdmis(ctx, res, 'alpha');
  $('#ex-r-merite').onclick = () => exDocAdmis(ctx, res, 'merite');
  $('#ex-r-ecole').onclick = () => exDocParEcole(ctx, res);
  $('#ex-r-pv').onclick = () => exDocPV(ctx, res);
  $('#ex-r-stats').onclick = () => exDocStats(ctx, res);
  $('#ex-r-releves').onclick = () => exDocReleves(ctx, res, vue.filter((l) => !['absent'].includes(l.decision)));
  $('#ex-r-attest').onclick = () => exDocAttestations(ctx, res, vue.filter((l) => l.decision === 'admis'));
  $('#ex-r-csv').onclick = () => exCsvResultats(ctx, res, vue);
  $('#ex-r-word').onclick = () => exWordAdmis(ctx, res);
  if ($('#ex-r-ecoles')) $('#ex-r-ecoles').onclick = () => exExporterResultatsEcoles(ctx, res);
  if ($('#ex-r-cloturer')) $('#ex-r-cloturer').onclick = () => exCloturer(ctx, res);
  if ($('#ex-r-ouvrir')) $('#ex-r-ouvrir').onclick = () => exRouvrir(ctx);
  if ($('#ex-r-report')) $('#ex-r-report').onclick = () => exReporterDossiers(ctx, res);
  if ($('#ex-r-up')) $('#ex-r-up').onclick = () => exTransmettreCEB(ctx, res);
  if ($('#ex-r-srv')) $('#ex-r-srv').onclick = () => cepTransmettreBordereau(ctx, res);
};

/* Décision du jury : repêchage ou ajournement motivé, au-dessus du calcul */
async function exFormDecision(ctx, l) {
  if (!exDirection()) { toast('Seule la direction peut enregistrer une décision du jury.'); return; }
  if (exVerrouille(ctx.session)) return;
  const cand = l.candidat;
  openModal(`Décision du jury — ${exNomComplet(cand)}`, `
    <p>Moyenne : <b>${exFmt(l.moyenne)}</b> / 20 · décision issue du calcul : <b>${esc(EX_DECISIONS[l.calc])}</b></p>
    <div class="form-grid">
      <div class="field full"><label>Décision</label><select id="ex-d-dec">
        <option value="">Appliquer le calcul (aucune décision manuelle)</option>
        <option value="admis" ${cand.decisionManuelle === 'admis' ? 'selected' : ''}>Admis (repêchage / délibération)</option>
        <option value="ajourne" ${cand.decisionManuelle === 'ajourne' ? 'selected' : ''}>Ajourné</option></select></div>
      <div class="field full"><label>Motif de la décision *</label><textarea id="ex-d-motif" placeholder="Ex : délibération du jury du …, moyenne à 0,05 pt du seuil…">${esc(cand.motifDecision || '')}</textarea></div>
    </div>`, {
    onSave: async (o) => {
      const dec = $('#ex-d-dec', o).value, motif = $('#ex-d-motif', o).value.trim();
      const effective = dec && dec !== l.calc ? dec : '';
      if (effective && !motif) { toast('Indiquez le motif de cette décision du jury.'); return false; }
      await DB.put('examCandidats', { ...(await DB.get('examCandidats', cand.id)), decisionManuelle: effective, motifDecision: effective ? motif : '' });
      toast(effective ? 'Décision du jury enregistrée.' : 'Décision calculée rétablie.');
      onRouteChange();
      return true;
    }
  });
}

async function exCloturer(ctx, res) {
  if (!exDirection()) return;
  if (res.stats.global.attente) { toast(`Impossible de clôturer : ${res.stats.global.attente} candidat(s) ont des notes incomplètes ou un écart à arbitrer.`); return; }
  if (!(await confirmDialog(`Clôturer la délibération ? ${res.stats.global.admis} admis, ${res.stats.global.ajournes} ajourné(s). Notes, statuts, répartition et décisions seront verrouillés (vous pourrez rouvrir).`))) return;
  await DB.put('examSessions', { ...(await DB.get('examSessions', ctx.session.id)), resultatsVerrouilles: true, dateCloture: todayISO(), cloturePar: currentUser.nom });
  toast('Délibération clôturée.');
  onRouteChange();
}
async function exRouvrir(ctx) {
  if (!exDirection()) return;
  if (!(await confirmDialog('Rouvrir la délibération ? Les notes et les décisions redeviennent modifiables et les résultats déjà imprimés pourraient changer.'))) return;
  await DB.put('examSessions', { ...(await DB.get('examSessions', ctx.session.id)), resultatsVerrouilles: false });
  toast('Délibération rouverte.');
  onRouteChange();
}

/* Report des admis dans les dossiers élèves : statut « Diplômé (CEP obtenu) » + date du CEP.
   Réutilise exactement les champs déjà lus par le registre matricule et la fiche élève. */
async function exReporterDossiers(ctx, res) {
  if (!exDirection() || ctx.session.type === 'blanc') return;
  if (!ctx.session.resultatsVerrouilles) { toast("Clôturez d'abord la délibération."); return; }
  const admis = res.lignes.filter((l) => l.decision === 'admis' && l.candidat.eleveUuid);
  if (!admis.length) { toast("Aucun admis n'est lié à un dossier élève de l'école."); return; }
  const date = ctx.session.dateResultats || todayISO();
  if (!(await confirmDialog(`Marquer ${admis.length} élève(s) de l'école comme « Diplômé (CEP obtenu) » avec la date du ${formatDate(date)} ? Le registre matricule et leur dossier seront mis à jour.`))) return;
  const eleves = await DB.getAll('eleves');
  let n = 0;
  for (const l of admis) {
    const e = eleves.find((x) => x._uuid === l.candidat.eleveUuid);
    if (!e) continue;
    e.statut = 'diplome';
    e.dateCEP = date;
    if (!e.dateSortie) e.dateSortie = date;
    if (!e.statutMotif) e.statutMotif = `CEP ${ctx.session.annee}`;
    await DB.put('eleves', e);
    n++;
  }
  await DB.put('examSessions', { ...(await DB.get('examSessions', ctx.session.id)), reporteLe: todayISO(), nbReportes: n });
  toast(`${n} dossier(s) élève mis à jour.`);
  onRouteChange();
}
