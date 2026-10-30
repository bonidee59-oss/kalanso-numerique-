/* ============================================================
   app-courrier.js — Registre du courrier DÉPART et ARRIVÉE
   ------------------------------------------------------------
   Reprend les registres papier de l'école :
     • « DÉPART »  : n° d'ordre · nombre de pièces · date du départ ·
                     destinataire · objet · n° d'archive · observations
     • « ARRIVÉE » : n° d'ordre · date d'arrivée · expéditeur ·
                     référence · objet · nombre de pièces · n° d'archive ·
                     suite donnée · observations

   Un seul magasin « courriers » (synchronisé avec Supabase par db.js,
   aucun script SQL à ajouter : la table app_data est générique).
   Chaque enregistrement porte :  sens = 'depart' | 'arrivee'
   et  registre = libellé du registre (par défaut l'année scolaire),
   la numérotation repartant de 01 pour chaque registre et chaque sens,
   comme sur les cahiers papier.
   Les copies scannées / photos du courrier peuvent être jointes.
   ============================================================ */

const CR_ETAT = { tab: 'depart', q: '', registre: '' };
const CR_LABEL = { depart: 'Courrier départ', arrivee: 'Courrier arrivée' };

function crAutorise() { return typeof routeAutorisee === 'function' && routeAutorisee('#/courrier'); }
const crNum = (n) => (n ? String(n).padStart(2, '0') : '');

async function crRegistreParDefaut() {
  const meta = (await DB.getAll('meta'))[0] || {};
  return meta.anneeScolaire || String(new Date().getFullYear());
}

async function crCharger(sens) {
  const tous = await DB.getAll('courriers');
  const liste = tous.filter((c) => c.sens === sens);
  const compte = {};
  liste.forEach((c) => { const k = `${c.registre}|${c.numeroOrdre}`; if (c.numeroOrdre) compte[k] = (compte[k] || 0) + 1; });
  liste.forEach((c) => { c._doublon = !!(c.numeroOrdre && compte[`${c.registre}|${c.numeroOrdre}`] > 1); });
  liste.sort((a, b) => String(b.registre || '').localeCompare(String(a.registre || '')) || (Number(a.numeroOrdre) || 1e9) - (Number(b.numeroOrdre) || 1e9) || (a.id - b.id));
  return liste;
}

async function crProchainNumero(sens, registre, ignoreId) {
  const tous = await DB.getAll('courriers');
  return tous.filter((c) => c.sens === sens && c.registre === registre && c.id !== ignoreId)
    .reduce((m, c) => Math.max(m, Number(c.numeroOrdre) || 0), 0) + 1;
}

/* ---------------- Page ---------------- */
ROUTES['#/courrier'] = async (root) => {
  const p = getHashParams().get('tab');
  if (p === 'depart' || p === 'arrivee') CR_ETAT.tab = p;
  root.innerHTML = `<div class="tabs no-print" id="cr-tabs">
      <button class="tab" data-tab="depart">Courrier départ</button>
      <button class="tab" data-tab="arrivee">Courrier arrivée</button>
    </div><div id="cr-contenu"></div>`;
  const montrer = async (t) => {
    if (t !== CR_ETAT.tab) { CR_ETAT.q = ''; }
    CR_ETAT.tab = t;
    $all('.tab', $('#cr-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    const c = $('#cr-contenu');
    c.innerHTML = '<p class="text-soft">Chargement…</p>';
    await crRender(c, t);
  };
  $('#cr-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) montrer(b.dataset.tab); };
  await montrer(CR_ETAT.tab);
};

const crCol = {
  depart: [
    { label: "N° d'ordre", cls: 'c', val: (c) => crNum(c.numeroOrdre) },
    { label: 'Nombre de pièces', cls: 'c', val: (c) => crNum(c.nbPieces) },
    { label: 'Date du départ', val: (c) => (c.date ? formatDate(c.date) : '') },
    { label: 'Destinataire', val: (c) => c.destinataire || '' },
    { label: 'Objet', val: (c) => c.objet || '' },
    { label: "N° d'archive", cls: 'c', val: (c) => c.numeroArchive || '' },
    { label: 'Observations', val: (c) => c.observations || '' }
  ],
  arrivee: [
    { label: "N° d'ordre", cls: 'c', val: (c) => crNum(c.numeroOrdre) },
    { label: "Date d'arrivée", val: (c) => (c.date ? formatDate(c.date) : '') },
    { label: 'Expéditeur', val: (c) => c.expediteur || '' },
    { label: 'Référence du courrier', val: (c) => c.reference || '' },
    { label: 'Objet', val: (c) => c.objet || '' },
    { label: 'Nombre de pièces', cls: 'c', val: (c) => crNum(c.nbPieces) },
    { label: "N° d'archive", cls: 'c', val: (c) => c.numeroArchive || '' },
    { label: 'Suite donnée / transmis à', val: (c) => c.suite || '' },
    { label: 'Observations', val: (c) => c.observations || '' }
  ]
};

async function crRender(c, sens) {
  const toutes = await crCharger(sens);
  const defaut = await crRegistreParDefaut();
  const registres = [...new Set([defaut, ...toutes.map((x) => x.registre).filter(Boolean)])].sort().reverse();
  if (!CR_ETAT.registre || !registres.includes(CR_ETAT.registre)) CR_ETAT.registre = defaut;
  const nbDoublons = new Set(toutes.filter((x) => x._doublon).map((x) => `${x.registre}|${x.numeroOrdre}`)).size;

  c.innerHTML = `
    <div class="alert alert-vert">${sens === 'depart'
      ? "Registre du courrier DÉPART : chaque lettre, note de service ou rapport envoyé reçoit un n° d'ordre et un n° d'archive."
      : "Registre du courrier ARRIVÉE : chaque courrier reçu (CEB, DPENA, mairie, parents…) est enregistré à sa réception avec la suite donnée."}
      Synchronisé sur tous les appareils.</div>
    ${nbDoublons ? `<div class="alert alert-terre">⚠ ${nbDoublons} n° d'ordre utilisé(s) plusieurs fois (saisie sur deux appareils hors ligne ?). Corrigez-les avec « Modifier ».</div>` : ''}
    <div class="grid grid-4" style="margin-bottom:14px;" id="cr-stats"></div>
    <div class="table-toolbar">
      <input class="search-input" id="cr-q" placeholder="Rechercher (objet, ${sens === 'depart' ? 'destinataire' : 'expéditeur'}, n°…)" value="${esc(CR_ETAT.q)}">
      <select id="cr-registre" class="search-input" style="min-width:130px;">${registres.map((x) => `<option ${x === CR_ETAT.registre ? 'selected' : ''}>${esc(x)}</option>`).join('')}<option value="__tous" ${CR_ETAT.registre === '__tous' ? 'selected' : ''}>Tous les registres</option></select>
      <div style="flex:1;"></div>
      <button class="btn btn-accent" id="cr-add">+ Enregistrer un courrier</button>
      <button class="btn btn-sm" id="cr-print">Imprimer / PDF</button>
      <button class="btn btn-sm" id="cr-csv">Excel (CSV)</button>
      <button class="btn btn-sm" id="cr-word">Word (.doc)</button>
    </div>
    <div id="cr-liste"></div>`;

  let liste = toutes;
  const rendre = () => {
    CR_ETAT.q = $('#cr-q').value; CR_ETAT.registre = $('#cr-registre').value;
    const q = CR_ETAT.q.toLowerCase();
    liste = toutes.filter((x) => (CR_ETAT.registre === '__tous' || x.registre === CR_ETAT.registre)
      && (!q || [crNum(x.numeroOrdre), x.objet, x.destinataire, x.expediteur, x.reference, x.numeroArchive, x.suite, x.observations].join(' ').toLowerCase().includes(q)));
    const mois = todayISO().slice(0, 7);
    $('#cr-stats').innerHTML = `
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">${sens === 'depart' ? 'Courriers envoyés' : 'Courriers reçus'} (registre affiché)</div><div class="value">${liste.length}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Ce mois-ci</div><div class="value">${liste.filter((x) => (x.date || '').startsWith(mois)).length}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Sans n° d'archive</div><div class="value">${liste.filter((x) => !x.numeroArchive).length}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Avec pièce scannée</div><div class="value">${liste.filter((x) => (x.fichiers || []).length).length}</div></div>`;
    const cols = crCol[sens];
    $('#cr-liste').innerHTML = liste.length ? `<div class="table-wrap"><table style="font-size:12.5px;"><thead><tr>
      ${cols.map((k) => `<th>${esc(k.label)}</th>`).join('')}<th class="no-print"></th></tr></thead>
      <tbody>${liste.map((x) => `<tr>${cols.map((k, i) => `<td class="${k.cls === 'c' ? '' : 'wrap'}" ${k.cls === 'c' ? 'style="text-align:center;font-weight:600;"' : ''}>${esc(k.val(x)) || '<span class="text-soft">—</span>'}${i === 0 && x._doublon ? ' <span class="badge badge-terre" title="Numéro utilisé plusieurs fois">double</span>' : ''}</td>`).join('')}
        <td class="no-print"><div class="flex gap-8">
          ${(x.fichiers || []).length ? `<button class="btn btn-sm" onclick="crVoirFichiers(${x.id})" title="Pièces jointes">📎 ${x.fichiers.length}</button>` : ''}
          <button class="btn btn-sm" onclick="crModifier(${x.id})">Modifier</button>
          <button class="btn btn-sm btn-danger" onclick="crSupprimer(${x.id})">Suppr.</button>
        </div></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty-state"><div class="big">✉</div>Aucun courrier enregistré dans ce registre.</div>';
  };
  $('#cr-q').oninput = rendre;
  $('#cr-registre').onchange = rendre;
  rendre();
  $('#cr-add').onclick = () => crFormulaire(sens, null);
  $('#cr-print').onclick = () => printDocument(CR_LABEL[sens], crHtml(sens, liste));
  $('#cr-word').onclick = () => exportWordDoc(`registre-${sens === 'depart' ? 'courrier-depart' : 'courrier-arrivee'}.doc`, CR_LABEL[sens], crHtml(sens, liste));
  $('#cr-csv').onclick = () => download(`registre-${sens === 'depart' ? 'courrier-depart' : 'courrier-arrivee'}.csv`,
    toCSV(liste, [{ label: 'Registre', value: 'registre' }, ...crCol[sens].map((k) => ({ label: k.label, value: (x) => k.val(x) }))]), 'text/csv;charset=utf-8');
}

/* Mise en page « registre papier » pour l'impression et Word */
function crHtml(sens, liste) {
  const cols = crCol[sens];
  const registre = CR_ETAT.registre && CR_ETAT.registre !== '__tous' ? ` ${esc(CR_ETAT.registre)}` : '';
  return `<h3 style="text-align:center;">${sens === 'depart' ? 'COURRIER DÉPART' : 'COURRIER ARRIVÉE'}${registre}</h3>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:11px;">
      <thead><tr>${cols.map((k, i) => `<th>${esc(k.label)}<br>(${i + 1})</th>`).join('')}</tr></thead>
      <tbody>${liste.map((x) => `<tr>${cols.map((k) => `<td ${k.cls === 'c' ? 'style="text-align:center;"' : ''}>${esc(k.val(x))}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">Aucun courrier</td></tr>`}</tbody></table>`;
}

/* ---------------- Formulaire ---------------- */
async function crFormulaire(sens, id) {
  if (!crAutorise()) { toast("Votre profil n'a pas accès au registre du courrier."); return; }
  const ex = id ? await DB.get('courriers', id) : null;
  const registre0 = ex ? ex.registre : (CR_ETAT.registre && CR_ETAT.registre !== '__tous' ? CR_ETAT.registre : await crRegistreParDefaut());
  const numero0 = ex ? ex.numeroOrdre : await crProchainNumero(sens, registre0);
  const v = (k) => esc(ex ? (ex[k] ?? '') : '');
  const tousReg = [...new Set((await DB.getAll('courriers')).map((x) => x.registre).filter(Boolean))];
  const fichiers = ex && Array.isArray(ex.fichiers) ? [...ex.fichiers] : [];
  const etat = { pending: 0 };
  const arr = sens === 'arrivee';

  const ov = openModal(`${ex ? 'Modifier' : 'Enregistrer'} — ${CR_LABEL[sens]}`, `
    <div class="form-grid">
      <div class="field"><label>Registre (année) *</label><input id="cr-f-registre" list="cr-f-reglist" value="${esc(registre0)}"><datalist id="cr-f-reglist">${tousReg.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
        <small>Un registre par année : la numérotation repart de 01.</small></div>
      <div class="field"><label>N° d'ordre *</label><input type="number" min="1" id="cr-f-num" value="${numero0}"></div>
      <div class="field"><label>${arr ? "Date d'arrivée" : 'Date du départ'} *</label><input type="date" id="cr-f-date" value="${ex ? esc(ex.date || '') : todayISO()}"></div>
      <div class="field"><label>Nombre de pièces</label><input type="number" min="1" id="cr-f-pieces" value="${ex ? esc(ex.nbPieces || '') : 1}"></div>
      ${arr ? `
      <div class="field full"><label>Expéditeur *</label><input id="cr-f-exp" value="${v('expediteur')}" placeholder="CEB de …, DPENA, Mairie, parent d'élève…"></div>
      <div class="field full"><label>Référence du courrier (n° et date de la lettre reçue)</label><input id="cr-f-ref" value="${v('reference')}"></div>`
      : `
      <div class="field full"><label>Destinataire *</label><input id="cr-f-dest" value="${v('destinataire')}" placeholder="CEB de …, DPENA, collègues de l'école, parents…"></div>`}
      <div class="field full"><label>Objet *</label><textarea id="cr-f-objet" placeholder="${arr ? 'Convocation, circulaire, demande…' : 'Note de service, rapport de rentrée, correspondance…'}">${v('objet')}</textarea></div>
      <div class="field"><label>N° d'archive</label><input id="cr-f-arch" value="${v('numeroArchive')}" placeholder="${ex ? '' : crNum(numero0)}"><small>Laissé vide : repris du n° d'ordre.</small></div>
      ${arr ? `<div class="field"><label>Suite donnée / transmis à</label><input id="cr-f-suite" value="${v('suite')}"></div>` : ''}
      <div class="field full"><label>Observations</label><textarea id="cr-f-obs">${v('observations')}</textarea></div>
      <div class="field full"><label>Copie scannée / photo du courrier</label>
        <div id="cr-f-files"></div>
        <input id="cr-f-file" type="file" multiple accept="image/*,application/pdf" style="margin-top:8px;">
        <div class="text-soft" style="font-size:12px;margin-top:4px;">Photos (réduites automatiquement) ou PDF. Max ${TAILLE_MAX_FICHIER_MO} Mo par fichier.</div></div>
    </div>`, {
    wide: true,
    onSave: async (o) => {
      while (etat.pending > 0) await new Promise((r) => setTimeout(r, 60));
      const g = (s) => ($(s, o) ? $(s, o).value.trim() : '');
      const registre = g('#cr-f-registre'), date = g('#cr-f-date'), objet = g('#cr-f-objet');
      const numero = Number(g('#cr-f-num'));
      const tiers = arr ? g('#cr-f-exp') : g('#cr-f-dest');
      if (!registre) { toast('Indiquez le registre (année).'); return false; }
      if (!Number.isInteger(numero) || numero < 1) { toast("Le n° d'ordre doit être un entier positif."); return false; }
      if (!date) { toast(arr ? "Indiquez la date d'arrivée." : 'Indiquez la date du départ.'); return false; }
      if (!tiers) { toast(arr ? "Indiquez l'expéditeur." : 'Indiquez le destinataire.'); return false; }
      if (!objet) { toast("Indiquez l'objet du courrier."); return false; }
      const tous = await DB.getAll('courriers');
      const autre = tous.find((x) => x.id !== id && x.sens === sens && x.registre === registre && Number(x.numeroOrdre) === numero);
      if (autre) { toast(`Le n° ${crNum(numero)} est déjà attribué dans le registre ${registre} (« ${autre.objet || ''} »).`); return false; }
      const obj = ex ? { ...(await DB.get('courriers', id)) } : { sens };
      Object.assign(obj, {
        sens, registre, numeroOrdre: numero, date, objet,
        nbPieces: g('#cr-f-pieces') ? Number(g('#cr-f-pieces')) : '',
        numeroArchive: g('#cr-f-arch') || crNum(numero),
        observations: g('#cr-f-obs'), fichiers
      });
      if (arr) Object.assign(obj, { expediteur: tiers, reference: g('#cr-f-ref'), suite: g('#cr-f-suite') });
      else obj.destinataire = tiers;
      if (ex) await DB.put('courriers', obj); else await DB.add('courriers', obj);
      CR_ETAT.registre = registre;
      toast(ex ? 'Courrier modifié.' : `Courrier n° ${crNum(numero)} enregistré.`);
      onRouteChange();
      return true;
    }
  });

  // Mise à jour automatique du prochain n° quand on change de registre (création seulement)
  if (!ex) {
    $('#cr-f-registre', ov).onchange = async () => {
      const r = $('#cr-f-registre', ov).value.trim();
      if (r) $('#cr-f-num', ov).value = await crProchainNumero(sens, r);
    };
  }
  const listEl = $('#cr-f-files', ov), inputEl = $('#cr-f-file', ov);
  const renderList = () => {
    listEl.innerHTML = fichiers.length ? fichiers.map((fi, i) => `<div class="flex gap-8 items-center" style="margin:4px 0;">
        ${fi.type && fi.type.startsWith('image/') ? `<img src="${fi.dataUrl}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">` : '<span style="font-size:22px;">📄</span>'}
        <span style="flex:1;font-weight:600;word-break:break-all;">${esc(fi.name)} <span class="text-soft" style="font-weight:400;">(${formatTailleFichier(fi.size || 0)})</span></span>
        <button type="button" class="btn btn-sm btn-danger" data-rm="${i}">Retirer</button></div>`).join('') : '<div class="text-soft">Aucune pièce jointe.</div>';
    $all('[data-rm]', listEl).forEach((b) => { b.onclick = () => { fichiers.splice(Number(b.dataset.rm), 1); renderList(); }; });
  };
  renderList();
  inputEl.onchange = async () => {
    const files = [...inputEl.files];
    inputEl.value = '';
    for (const file of files) {
      if (file.size > 25 * 1048576) { toast(`« ${file.name} » est trop volumineux.`); continue; }
      etat.pending++;
      try {
        const estImage = file.type.startsWith('image/');
        const dataUrl = estImage ? await compresserImage(file) : await lireFichierDataUrl(file);
        const taille = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
        if (taille > TAILLE_MAX_FICHIER_MO * 1048576) toast(`« ${file.name} » dépasse ${TAILLE_MAX_FICHIER_MO} Mo.`);
        else fichiers.push({ name: estImage ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name, type: estImage ? 'image/jpeg' : (file.type || 'application/octet-stream'), size: taille, dataUrl });
      } catch (e) { toast(`Impossible de lire « ${file.name} ».`); }
      etat.pending--;
      renderList();
    }
  };
}

function crModifier(id) { return DB.get('courriers', id).then((c) => c && crFormulaire(c.sens, id)); }

async function crSupprimer(id) {
  if (!crAutorise()) { toast("Votre profil n'a pas accès au registre du courrier."); return; }
  if (await confirmDialog('Supprimer ce courrier du registre ? Son n° d\'ordre restera vide dans la numérotation.')) {
    await DB.delete('courriers', id);
    toast('Courrier supprimé.');
    onRouteChange();
  }
}

async function crVoirFichiers(id) {
  const c = await DB.get('courriers', id);
  if (!c || !(c.fichiers || []).length) return;
  const ov = openModal(`Pièces jointes — courrier n° ${crNum(c.numeroOrdre)}`, c.fichiers.map((f, i) => `
    <div style="margin-bottom:12px;">
      ${f.type && f.type.startsWith('image/') ? `<img src="${f.dataUrl}" alt="" style="max-width:100%;border:1px solid var(--border);border-radius:8px;">` : '<span style="font-size:28px;">📄</span>'}
      <div class="flex gap-8 items-center" style="margin-top:6px;"><span style="flex:1;word-break:break-all;">${esc(f.name)}</span><button class="btn btn-sm" data-dl="${i}">Télécharger</button></div>
    </div>`).join(''), { hideSave: true, wide: true });
  $all('[data-dl]', ov).forEach((b) => { b.onclick = () => telechargerFichier(c.fichiers[Number(b.dataset.dl)]); });
}
