/* ============================================================
   app-people.js — Élèves, Classes, Enseignants, Présences
   ============================================================ */

function getHashParams() {
  const q = location.hash.split('?')[1];
  return new URLSearchParams(q || '');
}

async function classeOptions() {
  let classes = await DB.getAll('classes');
  if (currentUser && currentUser.classeIds) classes = classes.filter((c) => currentUser.classeIds.includes(c.id));
  classes.sort((a, b) => (a.nom || '').localeCompare(b.nom));
  return classes.map((c) => ({ value: c.id, label: c.nom }));
}
async function classeById(id) { return id ? await DB.get('classes', id) : null; }

function badgeStatutEleve(s) {
  const map = { actif: ['vert', 'Actif'], transfere: ['ocre', 'Transféré'], abandon: ['terre', 'Abandon'], diplome: ['indigo', 'Diplômé (CEP)'] };
  const [c, l] = map[s || 'actif'] || map.actif;
  return `<span class="badge badge-${c}">${l}</span>`;
}

/* ================= ÉLÈVES ================= */
ROUTES['#/eleves'] = async (root) => {
  const id = getHashParams().get('id');
  if (id) return renderEleveDetail(root, Number(id));
  return renderEleveList(root);
};

async function renderEleveList(root) {
  const [elevesAll, classesAll] = await Promise.all([DB.getAll('eleves'), DB.getAll('classes')]);
  const eleves = filtrerParClasseVisible(elevesAll);
  const classes = currentUser && currentUser.classeIds ? classesAll.filter((c) => currentUser.classeIds.includes(c.id)) : classesAll;
  eleves.sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  const classeMap = Object.fromEntries(classesAll.map((c) => [c.id, c.nom]));

  root.innerHTML = `
    <div class="table-toolbar">
      <input class="search-input" id="el-search" placeholder="Rechercher un élève (nom, matricule, village)…">
      <select id="el-filter-classe" class="search-input" style="min-width:140px;"><option value="">Toutes les classes</option>${classes.map((c) => `<option value="${c.id}">${esc(c.nom)}</option>`).join('')}</select>
      <div style="flex:1;"></div>
      <button class="btn btn-accent" id="el-add">+ Nouvel élève</button>
      <button class="btn btn-sm" id="el-pdf">Exporter PDF</button>
      <button class="btn btn-sm" id="el-export">Exporter CSV</button>
    </div>
    <div id="el-table"></div>`;

  const doRender = () => {
    const q = $('#el-search').value.toLowerCase();
    const cf = $('#el-filter-classe').value;
    let list = eleves.filter((e) => (!cf || String(e.classeId) === cf) &&
      (!q || `${e.nom} ${e.prenom} ${e.matricule} ${e.village}`.toLowerCase().includes(q)));
    $('#el-table').innerHTML = list.length ? `
      <div class="table-wrap"><table><thead><tr>
        <th></th><th>Matricule</th><th>Nom & prénom</th><th>Sexe</th><th>Âge</th><th>Classe</th><th>Statut</th><th></th>
      </tr></thead><tbody>
      ${list.map((e) => `<tr>
        <td><div class="avatar">${e.photo ? `<img src="${e.photo}">` : esc((e.nom || '?')[0])}</div></td>
        <td>${esc(e.matricule)}</td>
        <td>${esc(e.nom)} ${esc(e.prenom)}</td>
        <td>${e.sexe === 'F' ? 'Fille' : 'Garçon'}</td>
        <td>${calcAge(e.dateNaissance)}</td>
        <td>${esc(classeMap[e.classeId] || '—')}</td>
        <td>${badgeStatutEleve(e.statut)}</td>
        <td class="no-print"><button class="btn btn-sm" onclick="location.hash='#/eleves?id=${e.id}'">Dossier</button></td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty-state"><div class="big">∅</div>Aucun élève ne correspond. <button class="btn btn-sm" style="margin-top:8px;" onclick="document.getElementById('el-add').click()">Inscrire un élève</button></div>`;
  };
  doRender();
  $('#el-search').oninput = doRender;
  $('#el-filter-classe').onchange = doRender;
  $('#el-add').onclick = () => openEleveForm(null);
  $('#el-pdf').onclick = () => {
    const headers = ['Matricule', 'Nom & prénom', 'Sexe', 'Âge', 'Classe', 'Statut'];
    const matrix = eleves.map((e) => [e.matricule, `${e.nom} ${e.prenom}`, e.sexe === 'F' ? 'Fille' : 'Garçon', calcAge(e.dateNaissance), classeMap[e.classeId] || '—', ({ actif: 'Actif', transfere: 'Transféré', abandon: 'Abandon', diplome: 'Diplômé' })[e.statut || 'actif']]);
    pdfTable('Liste des élèves', headers, matrix);
  };
  $('#el-export').onclick = () => {
    const csv = toCSV(eleves, [
      { label: 'Matricule', value: 'matricule' }, { label: 'Nom', value: 'nom' }, { label: 'Prénom', value: 'prenom' },
      { label: 'Sexe', value: 'sexe' }, { label: 'Date naissance', value: 'dateNaissance' },
      { label: 'Classe', value: (r) => classeMap[r.classeId] || '' }, { label: 'Village', value: 'village' },
      { label: 'Téléphone parents', value: 'telParents' }, { label: 'Statut', value: (r) => r.statut || 'actif' }
    ]);
    download('eleves.csv', csv, 'text/csv;charset=utf-8');
  };
}

async function openEleveForm(id) {
  const row = id ? await DB.get('eleves', id) : {};
  const classes = await DB.getAll('classes');
  const body = `
    <div class="form-grid">
      <div class="field full flex items-center gap-12">
        <div class="avatar" id="photo-preview" style="width:56px;height:56px;">${row.photo ? `<img src="${row.photo}">` : '?'}</div>
        <input type="file" accept="image/*" id="f-photo">
      </div>
      <div class="field full"><label>Matricule (officiel, saisi à la main)</label><input id="f-matricule" value="${esc(row.matricule || '')}" placeholder="Laisser vide si pas encore attribué"></div>
      <div class="field"><label>Nom *</label><input id="f-nom" value="${esc(row.nom || '')}" required></div>
      <div class="field"><label>Prénom *</label><input id="f-prenom" value="${esc(row.prenom || '')}" required></div>
      <div class="field"><label>Sexe *</label><select id="f-sexe"><option value="M" ${row.sexe === 'M' ? 'selected' : ''}>Garçon</option><option value="F" ${row.sexe === 'F' ? 'selected' : ''}>Fille</option></select></div>
      <div class="field"><label>Date de naissance</label><input type="date" id="f-dateNaissance" value="${row.dateNaissance || ''}"></div>
      <div class="field"><label>Classe *</label><select id="f-classeId">${classes.map((c) => `<option value="${c.id}" ${row.classeId === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></div>
      <div class="field"><label>Date d'inscription</label><input type="date" id="f-dateInscription" value="${row.dateInscription || todayISO()}"></div>
      <div class="field"><label>Village</label><input id="f-village" value="${esc(row.village || '')}"></div>
      <div class="field"><label>Secteur</label><input id="f-secteur" value="${esc(row.secteur || '')}"></div>
      <div class="field"><label>Commune</label><input id="f-commune" value="${esc(row.commune || '')}"></div>
      <div class="field"><label>Province</label><input id="f-province" value="${esc(row.province || '')}"></div>
      <div class="field"><label>Région</label><input id="f-region" value="${esc(row.region || '')}"></div>
      <div class="field full"><label>Adresse</label><input id="f-adresse" value="${esc(row.adresse || '')}"></div>
      <div class="field"><label>Nom du père</label><input id="f-pere" value="${esc(row.pere || '')}"></div>
      <div class="field"><label>Nom de la mère</label><input id="f-mere" value="${esc(row.mere || '')}"></div>
      <div class="field"><label>Tuteur (si applicable)</label><input id="f-tuteur" value="${esc(row.tuteur || '')}"></div>
      <div class="field"><label>Téléphone des parents</label><input id="f-telParents" value="${esc(row.telParents || '')}"></div>
      <div class="field full"><label>Profession des parents</label><input id="f-professionParents" value="${esc(row.professionParents || '')}"></div>
      <div class="field full"><label>Situation particulière</label><input id="f-situationParticuliere" value="${esc(row.situationParticuliere || '')}" placeholder="Orphelin, handicap, boursier…"></div>
      <div class="field"><label>Situation de handicap</label><select id="f-handicap"><option value="">Non</option><option value="1" ${row.handicap ? 'selected' : ''}>Oui</option></select></div>
      <div class="field"><label>Candidat bilingue</label><select id="f-bilingue"><option value="">Non</option><option value="1" ${row.bilingue ? 'selected' : ''}>Oui</option></select></div>
      <div class="field full"><label>Observations</label><textarea id="f-observations">${esc(row.observations || '')}</textarea></div>
    </div>`;
  const overlay = openModal(id ? 'Modifier le dossier élève' : 'Inscrire un nouvel élève', body, {
    wide: true,
    onSave: async (ov) => {
      const nom = $('#f-nom', ov).value.trim();
      const prenom = $('#f-prenom', ov).value.trim();
      if (!nom || !prenom) { toast('Le nom et le prénom sont obligatoires.'); return false; }
      const classeId = Number($('#f-classeId', ov).value);
      const classe = classes.find((c) => c.id === classeId);
      const obj = {
        ...row, nom, prenom,
        matricule: $('#f-matricule', ov).value.trim(),
        sexe: $('#f-sexe', ov).value,
        dateNaissance: $('#f-dateNaissance', ov).value,
        classeId, niveau: classe ? classe.niveau : '',
        dateInscription: $('#f-dateInscription', ov).value,
        village: $('#f-village', ov).value, secteur: $('#f-secteur', ov).value,
        commune: $('#f-commune', ov).value, province: $('#f-province', ov).value, region: $('#f-region', ov).value,
        adresse: $('#f-adresse', ov).value, pere: $('#f-pere', ov).value, mere: $('#f-mere', ov).value,
        tuteur: $('#f-tuteur', ov).value, telParents: $('#f-telParents', ov).value,
        professionParents: $('#f-professionParents', ov).value, situationParticuliere: $('#f-situationParticuliere', ov).value,
        handicap: $('#f-handicap', ov).value === '1', bilingue: $('#f-bilingue', ov).value === '1',
        observations: $('#f-observations', ov).value,
        statut: row.statut || 'actif',
        historiqueClasses: row.historiqueClasses || []
      };
      const fileInput = $('#f-photo', ov);
      if (fileInput.files && fileInput.files[0]) {
        obj.photo = await fileToBase64(fileInput.files[0]);
      }
      if (!id) {
        obj.numeroOrdre = await prochainNumeroOrdre(); // registre matricule
        obj.id = await DB.add('eleves', obj);
        // crée automatiquement une fiche de cotisation vide
        await DB.add('cotisations', { eleveId: obj.id, montantAttendu: 0, montantPaye: 0, paiements: [] });
      } else {
        if (row.classeId !== classeId) {
          obj.historiqueClasses = [...(obj.historiqueClasses || []), { classeId: row.classeId, jusquau: todayISO() }];
        }
        await DB.put('eleves', obj);
      }
      toast('Dossier élève enregistré.');
      if (getHashParams().get('id')) onRouteChange(); else location.hash = `#/eleves?id=${obj.id}`;
      return true;
    }
  });
  $('#f-photo', overlay).onchange = async (e) => {
    if (e.target.files[0]) { const b64 = await fileToBase64(e.target.files[0]); $('#photo-preview', overlay).innerHTML = `<img src="${b64}">`; }
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function renderEleveDetail(root, id) {
  const eleve = await DB.get('eleves', id);
  if (!eleve) { root.innerHTML = `<div class="alert alert-terre">Élève introuvable.</div>`; return; }
  if (!classeVisible(eleve.classeId)) { root.innerHTML = `<div class="alert alert-terre">Cet élève n'appartient pas à votre classe.</div>`; return; }
  const classe = await classeById(eleve.classeId);
  root.innerHTML = `
    <button class="btn btn-sm no-print" onclick="location.hash='#/eleves'">← Retour à la liste</button>
    <div class="card" style="margin-top:12px;">
      <div class="flex items-center gap-12">
        <div class="avatar" style="width:64px;height:64px;font-size:22px;">${eleve.photo ? `<img src="${eleve.photo}">` : esc((eleve.nom || '?')[0])}</div>
        <div style="flex:1;">
          <h2 style="margin-bottom:2px;">${esc(eleve.nom)} ${esc(eleve.prenom)}</h2>
          <div class="text-soft">${eleve.matricule ? 'Matricule ' + esc(eleve.matricule) + ' · ' : ''}${classe ? esc(classe.nom) : '—'} · ${calcAge(eleve.dateNaissance)} ans ${badgeStatutEleve(eleve.statut)}</div>
        </div>
        <div class="flex gap-8 no-print">
          <button class="btn btn-sm" onclick="openEleveForm(${id})">Modifier</button>
          <button class="btn btn-sm" onclick="openStatutEleve(${id})">Statut</button>
          ${rmAutorise() ? `<button class="btn btn-sm" onclick="rmModifierEleve(${id})">Registre matricule</button>` : ''}
        </div>
      </div>
    </div>
    <div class="tabs no-print" id="el-tabs">
      ${['Infos', 'Fiche de scolarité', 'Présences', 'Évaluations', 'Cotisation', 'Discipline', 'Documents'].map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${t}">${t}</button>`).join('')}
    </div>
    <div id="el-tab-content"></div>`;

  const tabs = $('#el-tabs');
  const showTab = async (name) => {
    $all('.tab', tabs).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    const c = $('#el-tab-content');
    if (name === 'Infos') {
      c.innerHTML = `<div class="grid grid-2">
        <div class="card">
          <h3>Identité & scolarité</h3>
          ${infoRow('Sexe', eleve.sexe === 'F' ? 'Fille' : 'Garçon')}
          ${infoRow('Date de naissance', formatDate(eleve.dateNaissance))}
          ${infoRow("Date d'inscription", formatDate(eleve.dateInscription))}
          ${infoRow('Classe', classe ? classe.nom : '—')}
          ${infoRow("N° d'ordre (registre matricule)", eleve.numeroOrdre)}
          ${infoRow('Date de sortie définitive', eleve.dateSortie ? formatDate(eleve.dateSortie) : '')}
          ${infoRow('Date du CEP', eleve.dateCEP ? formatDate(eleve.dateCEP) : '')}
          ${infoRow('Situation particulière', eleve.situationParticuliere)}
          ${infoRow('Situation de handicap', eleve.handicap ? 'Oui' : 'Non')}
          ${infoRow('Candidat bilingue', eleve.bilingue ? 'Oui' : 'Non')}
          ${infoRow('Observations', eleve.observations)}
        </div>
        <div class="card">
          <h3>Famille & résidence</h3>
          ${infoRow('Père', eleve.pere)} ${infoRow('Mère', eleve.mere)} ${infoRow('Tuteur', eleve.tuteur)}
          ${infoRow('Téléphone parents', eleve.telParents)} ${infoRow('Profession', eleve.professionParents)}
          ${infoRow('Village', eleve.village)} ${infoRow('Secteur', eleve.secteur)} ${infoRow('Commune', eleve.commune)}
          ${infoRow('Province', eleve.province)} ${infoRow('Région', eleve.region)} ${infoRow('Adresse', eleve.adresse)}
        </div>
      </div>
      ${(eleve.historiqueClasses || []).length ? `<div class="card" style="margin-top:14px;"><h3>Parcours scolaire</h3>
        <div class="table-wrap" style="margin-top:8px;"><table><thead><tr><th>Année scolaire</th><th>Classe</th><th>Décision</th><th>Moyenne annuelle</th></tr></thead>
        <tbody>${[...eleve.historiqueClasses].reverse().map((h) => `<tr>
          <td>${esc(h.anneeScolaire || '—')}</td>
          <td>${esc(h.niveau || ('Classe #' + h.classeId))}</td>
          <td>${({ admis: 'Admis(e)', redouble: 'A redoublé', abandon: "A quitté l'école" })[h.decision] || (h.jusquau ? 'Changement de classe' : '—')}</td>
          <td>${h.moyenneAnnuelle != null ? h.moyenneAnnuelle.toFixed(2) + '/' + MOYENNE_BASE : '—'}</td>
        </tr>`).join('')}</tbody></table></div>
      </div>` : ''}`;
    } else if (name === 'Fiche de scolarité') {
      await renderFicheScolarite(c, id);
    } else if (name === 'Présences') {
      const pres = (await DB.getAll('presencesEleves')).filter((p) => p.eleveId === id).sort((a, b) => b.date.localeCompare(a.date));
      const total = pres.length, presents = pres.filter((p) => p.statut === 'present').length;
      const taux = total ? Math.round((presents / total) * 100) : null;
      c.innerHTML = `<div class="card"><div class="flex justify-between items-center"><h3>Registre de présence</h3><span class="chip">Taux global : ${taux === null ? '—' : taux + '%'}</span></div>
        <div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Date</th><th>Statut</th><th>Motif</th></tr></thead>
        <tbody>${pres.length ? pres.map((p) => `<tr><td>${formatDate(p.date)}</td><td>${presStatutBadge(p.statut)}</td><td>${esc(p.motif || '')}</td></tr>`).join('') : `<tr><td colspan="3" class="text-soft">Aucune donnée de présence.</td></tr>`}</tbody></table></div></div>`;
    } else if (name === 'Évaluations') {
      const evals = (await DB.getAll('evaluations')).filter((ev) => (ev.classeId === eleve.classeId) && (ev.notes || []).some((n) => n.eleveId === id));
      const rows2 = [];
      evals.forEach((ev) => {
        (ev.notes || []).filter((n) => n.eleveId === id).forEach((n) => {
          if (n.note === '' || n.note === null || n.note === undefined) return;
          const mDef = matiereDefDeNote(ev, n.matiereId);
          rows2.push({
            date: ev.date, evalNom: ev.nom || ev.type || '—',
            matiereNom: mDef ? mDef.nom : (ev.discipline || '—'),
            note: n.note, bareme: mDef ? mDef.bareme : (ev.bareme || 20),
            sur20: noteSur20(ev, n)
          });
        });
      });
      rows2.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const moyenne = rows2.length ? (rows2.reduce((s, r) => s + r.sur20, 0) / rows2.length).toFixed(1) : '—';
      c.innerHTML = `<div class="card"><div class="flex justify-between items-center"><h3>Résultats</h3><span class="chip">Moyenne : ${moyenne}${moyenne !== '—' ? '/' + MOYENNE_BASE : ''}</span></div>
        <div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>Date</th><th>Évaluation</th><th>Matière</th><th>Note</th></tr></thead>
        <tbody>${rows2.length ? rows2.map((r) => `<tr><td>${formatDate(r.date)}</td><td>${esc(r.evalNom)}</td><td>${esc(r.matiereNom)}</td><td>${r.note}/${r.bareme}</td></tr>`).join('') : `<tr><td colspan="4" class="text-soft">Aucune note enregistrée.</td></tr>`}</tbody></table></div>
        <button class="btn btn-sm no-print" style="margin-top:10px;" onclick="imprimerBulletin(${id})">Imprimer le bulletin</button>
        </div>`;
    } else if (name === 'Cotisation') {
      const cot = (await DB.getAll('cotisations')).find((x) => x.eleveId === id) || { montantAttendu: 0, montantPaye: 0, paiements: [] };
      const solde = (Number(cot.montantAttendu) || 0) - (Number(cot.montantPaye) || 0);
      c.innerHTML = `<div class="card">
        <h3>Cotisation scolaire</h3>
        <div class="grid grid-3">
          <div>${infoRow('Montant attendu', fmtMontant(cot.montantAttendu))}</div>
          <div>${infoRow('Montant payé', fmtMontant(cot.montantPaye))}</div>
          <div>${infoRow('Solde restant', fmtMontant(solde))}</div>
        </div>
        <button class="btn btn-sm no-print" style="margin-top:8px;" onclick="location.hash='#/cotisations'">Gérer dans le module Cotisations</button>
      </div>`;
    } else if (name === 'Discipline') {
      const items = (await DB.getAll('discipline')).filter((d) => d.cibleType === 'eleve' && Number(d.cibleId) === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      c.innerHTML = `<div class="card"><h3>Discipline & comportement</h3><div class="table-wrap" style="margin-top:8px;"><table><thead><tr><th>Date</th><th>Type</th><th>Motif</th><th>Décision</th></tr></thead>
      <tbody>${items.length ? items.map((it) => `<tr><td>${formatDate(it.date)}</td><td>${disciplineBadge(it.type)}</td><td class="wrap">${esc(it.motif)}</td><td class="wrap">${esc(it.decision)}</td></tr>`).join('') : `<tr><td colspan="4" class="text-soft">Aucun évènement.</td></tr>`}</tbody></table></div></div>`;
    } else if (name === 'Documents') {
      c.innerHTML = `<div class="card"><h3>Documents administratifs</h3><div class="flex gap-8" style="flex-wrap:wrap;">
        <button class="btn" onclick="genCertificatScolarite(${id})">Certificat de scolarité</button>
        <button class="btn" onclick="genAttestationFrequentation(${id})">Attestation de fréquentation</button>
        <button class="btn" onclick="genFicheInscription(${id})">Fiche d'inscription</button>
        <button class="btn" onclick="fsImprimer(${id}, true)">Fiche de scolarité (recto + verso)</button>
      </div></div>`;
    }
  };
  tabs.onclick = (e) => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); };
  showTab('Infos');
}

function infoRow(label, val) { return `<div class="flex justify-between" style="padding:5px 0; border-bottom:1px solid var(--border); font-size:13.5px;"><span class="text-soft">${esc(label)}</span><span style="text-align:right; max-width:60%;">${esc(val) || '—'}</span></div>`; }
function presStatutBadge(s) { const map = { present: ['vert', 'Présent'], absent: ['terre', 'Absent'], retard: ['ocre', 'Retard'], absent_justifie: ['ocre', 'Absent justifié'], absent_non_justifie: ['terre', 'Absent non justifié'], malade: ['indigo', 'Malade'] }; const [c, l] = map[s] || ['indigo', s]; return `<span class="badge badge-${c}">${l}</span>`; }
function disciplineBadge(t) { const map = { avertissement: ['ocre', 'Avertissement'], sanction: ['terre', 'Sanction'], recompense: ['vert', 'Récompense'] }; const [c, l] = map[t] || ['indigo', t]; return `<span class="badge badge-${c}">${l}</span>`; }

async function openStatutEleve(id) {
  const row = await DB.get('eleves', id);
  openModal('Changer le statut de l\'élève', `
    <div class="form-grid">
      <div class="field full"><label>Statut</label><select id="st-statut">
        <option value="actif" ${row.statut === 'actif' || !row.statut ? 'selected' : ''}>Actif</option>
        <option value="transfere" ${row.statut === 'transfere' ? 'selected' : ''}>Transféré</option>
        <option value="abandon" ${row.statut === 'abandon' ? 'selected' : ''}>Abandon</option>
        <option value="diplome" ${row.statut === 'diplome' ? 'selected' : ''}>Diplômé (CEP obtenu)</option>
      </select></div>
      <div class="field full"><label>Date de sortie définitive (ou d'obtention du CEP)</label><input type="date" id="st-date" value="${esc(row.dateSortie || todayISO())}"><small>Ignorée si le statut est « Actif ». Reprise dans le registre matricule.</small></div>
      <div class="field full"><label>Observation / motif</label><textarea id="st-motif" placeholder="École de destination, motif d'abandon, mention CEP…">${esc(row.statutMotif || '')}</textarea></div>
    </div>`, {
    onSave: async () => {
      const ancienStatut = row.statut || 'actif';
      row.statut = $('#st-statut').value;
      row.statutMotif = $('#st-motif').value;
      if (row.statut === 'actif') delete row.dateSortie;
      else {
        row.dateSortie = $('#st-date').value || row.dateSortie || todayISO();
        if (row.statut === 'diplome' && !row.dateCEP) row.dateCEP = row.dateSortie;
      }
      await DB.put('eleves', row);
      toast('Statut mis à jour.');
      onRouteChange();
      return true;
    }
  });
}

async function imprimerBulletin(id) {
  const eleve = await DB.get('eleves', id);
  const classe = await classeById(eleve.classeId);
  const evals = (await DB.getAll('evaluations')).filter((ev) => (ev.classeId === eleve.classeId) && (ev.notes || []).some((n) => n.eleveId === id));
  const parMatiere = {}; // nom de matière -> { notes: [/20], coefficient }
  evals.forEach((ev) => {
    (ev.notes || []).filter((n) => n.eleveId === id).forEach((n) => {
      if (n.note === '' || n.note === null || n.note === undefined) return;
      const mDef = matiereDefDeNote(ev, n.matiereId);
      const nom = mDef ? mDef.nom : (ev.discipline || 'Matière');
      const coefficient = mDef ? (Number(mDef.coefficient) || 1) : 1;
      parMatiere[nom] = parMatiere[nom] || { notes: [], coefficient };
      parMatiere[nom].notes.push(noteSur20(ev, n));
    });
  });
  const lignes = Object.entries(parMatiere).map(([nom, info]) => {
    const m = info.notes.reduce((a, b) => a + b, 0) / info.notes.length;
    return `<tr><td>${esc(nom)}</td><td>${info.coefficient}</td><td>${info.notes.length}</td><td>${m.toFixed(1)}/${MOYENNE_BASE}</td></tr>`;
  });
  let sommePonderee = 0, sommeCoef = 0;
  Object.values(parMatiere).forEach((info) => {
    const m = info.notes.reduce((a, b) => a + b, 0) / info.notes.length;
    sommePonderee += m * info.coefficient; sommeCoef += info.coefficient;
  });
  const moyGen = sommeCoef ? (sommePonderee / sommeCoef).toFixed(1) : '—';
  printDocument(`Bulletin — ${eleve.nom} ${eleve.prenom}`, `
    <h3 style="text-align:center;">BULLETIN DE NOTES</h3>
    <p><strong>${esc(eleve.nom)} ${esc(eleve.prenom)}</strong> ${eleve.matricule ? '— Matricule ' + esc(eleve.matricule) + ' ' : ''}— Classe ${classe ? esc(classe.nom) : ''}</p>
    <table style="width:100%; border-collapse:collapse;" border="1" cellpadding="6">
      <thead><tr><th>Matière</th><th>Coef.</th><th>Nb notes</th><th>Moyenne /${MOYENNE_BASE}</th></tr></thead>
      <tbody>${lignes.join('') || '<tr><td colspan="4">Aucune évaluation</td></tr>'}</tbody>
    </table>
    <p style="margin-top:16px; font-size:16px;"><strong>Moyenne générale (pondérée) : ${moyGen}${moyGen !== '—' ? '/' + MOYENNE_BASE : ''}</strong></p>
  `);
}

function genCertificatScolarite(id) {
  DB.get('eleves', id).then(async (eleve) => {
    const classe = await classeById(eleve.classeId);
    printDocument('Certificat de scolarité', `
      <h3 style="text-align:center;">CERTIFICAT DE SCOLARITÉ</h3>
      <p>Je soussigné(e), Directeur/Directrice de l'école, certifie que l'élève :</p>
      <p style="font-size:16px;"><strong>${esc(eleve.nom)} ${esc(eleve.prenom)}</strong>, né(e) le ${formatDate(eleve.dateNaissance)},</p>
      <p>est régulièrement inscrit(e) dans notre établissement en classe de <strong>${classe ? esc(classe.nom) : ''}</strong> au titre de l'année scolaire en cours${eleve.matricule ? ', sous le matricule ' + esc(eleve.matricule) : ''}.</p>
      <p>En foi de quoi, le présent certificat est délivré pour servir et valoir ce que de droit.</p>`);
  });
}
function genAttestationFrequentation(id) {
  DB.get('eleves', id).then(async (eleve) => {
    const classe = await classeById(eleve.classeId);
    printDocument('Attestation de fréquentation', `
      <h3 style="text-align:center;">ATTESTATION DE FRÉQUENTATION SCOLAIRE</h3>
      <p>Il est attesté que l'élève <strong>${esc(eleve.nom)} ${esc(eleve.prenom)}</strong> ${eleve.matricule ? '(matricule ' + esc(eleve.matricule) + ') ' : ''}fréquente assidûment la classe de <strong>${classe ? esc(classe.nom) : ''}</strong> dans notre établissement.</p>
      <p>La présente attestation est établie à la demande de l'intéressé(e) pour servir et valoir ce que de droit.</p>`);
  });
}
function genFicheInscription(id) {
  DB.get('eleves', id).then((eleve) => {
    printDocument('Fiche d\'inscription', `
      <h3 style="text-align:center;">FICHE D'INSCRIPTION</h3>
      <table style="width:100%;" cellpadding="5">
        <tr><td class="text-soft">Nom</td><td><strong>${esc(eleve.nom)}</strong></td><td class="text-soft">Prénom</td><td><strong>${esc(eleve.prenom)}</strong></td></tr>
        <tr><td class="text-soft">Sexe</td><td>${eleve.sexe === 'F' ? 'Fille' : 'Garçon'}</td><td class="text-soft">Né(e) le</td><td>${formatDate(eleve.dateNaissance)}</td></tr>
        <tr><td class="text-soft">Père</td><td>${esc(eleve.pere || '')}</td><td class="text-soft">Mère</td><td>${esc(eleve.mere || '')}</td></tr>
        <tr><td class="text-soft">Téléphone</td><td colspan="3">${esc(eleve.telParents || '')}</td></tr>
        <tr><td class="text-soft">Village / Secteur</td><td colspan="3">${esc(eleve.village || '')} ${esc(eleve.secteur || '')}</td></tr>
      </table>`);
  });
}

/* ================= CLASSES ================= */
ROUTES['#/classes'] = async (root) => {
  const id = getHashParams().get('id');
  if (id) return renderClasseDetail(root, Number(id));
  return renderClasseList(root);
};

async function renderClasseList(root) {
  const [classesAll, eleves, enseignants] = await Promise.all([DB.getAll('classes'), DB.getAll('eleves'), DB.getAll('enseignants')]);
  const classes = currentUser && currentUser.classeIds ? classesAll.filter((c) => currentUser.classeIds.includes(c.id)) : classesAll;
  classes.sort((a, b) => (a.nom || '').localeCompare(b.nom));
  const doublons = currentUser && currentUser.classeIds ? [] : detecterClassesDoublons(classes);
  root.innerHTML = `<div class="table-toolbar">
      <div style="flex:1;"></div>
      ${doublons.length ? `<button class="btn btn-sm" style="color:#B23A3A;" id="cl-fusion">⚠ Fusionner les classes en double (${doublons.reduce((n, g) => n + g.length - 1, 0)})</button>` : ''}
      <button class="btn btn-sm" id="cl-pdf">Exporter PDF</button></div>
    <div class="grid grid-3">${classes.map((c) => {
    const eff = eleves.filter((e) => e.classeId === c.id && (e.statut || 'actif') === 'actif').length;
    const profs = enseignantsDeClasse(c, enseignants);
    return `<div class="card">
      <div class="flex justify-between items-center"><h3 style="margin:0;">${esc(c.nom)}</h3><span class="chip">${eff} élève(s)</span></div>
      <p class="text-soft" style="margin:6px 0;">${profs.length > 1 ? 'Enseignants' : 'Enseignant'} : ${profs.length ? profs.map((t) => esc(t.nom + ' ' + t.prenom) + (t.id === c.enseignantId ? ' (titulaire)' : '')).join(', ') : 'non affecté'}</p>
      <button class="btn btn-sm" onclick="location.hash='#/classes?id=${c.id}'">Ouvrir la classe</button>
    </div>`;
  }).join('')}</div>`;
  $('#cl-pdf').onclick = () => {
    const headers = ['Classe', 'Effectif', 'Enseignant(s)'];
    const matrix = classes.map((c) => [c.nom, eleves.filter((e) => e.classeId === c.id && (e.statut || 'actif') === 'actif').length, (() => { const t = enseignantsDeClasse(c, enseignants); return t.length ? t.map((x) => `${x.nom} ${x.prenom}`).join(' ; ') : 'Non affecté'; })()]);
    pdfTable('Liste des classes', headers, matrix);
  };
  if (doublons.length) $('#cl-fusion').onclick = () => openFusionClassesDoublons(doublons, eleves);
}

/* ---------------- Fusion des classes en double (même nom) ----------------
   Regroupe les classes dont le nom est identique (espaces/majuscules
   ignorés). Dans chaque groupe, la classe conservée est celle qui a le
   plus d'élèves rattachés (c'est presque toujours la "vraie" classe ;
   les doublons créés automatiquement au démarrage n'ont pas d'élèves).
   Tout ce qui pointe vers les classes supprimées (élèves, présences,
   matières, évaluations, fiche patrimoine) est réattribué à la classe
   conservée avant suppression. */
function detecterClassesDoublons(classes) {
  const groupes = {};
  classes.forEach((c) => {
    const cle = (c.nom || '').trim().toLowerCase();
    if (!cle) return;
    (groupes[cle] = groupes[cle] || []).push(c);
  });
  return Object.values(groupes).filter((g) => g.length > 1);
}

async function openFusionClassesDoublons(doublons, eleves) {
  const detail = doublons.map((g) => {
    const effByClasse = g.map((c) => ({ c, eff: eleves.filter((e) => e.classeId === c.id).length }));
    effByClasse.sort((a, b) => b.eff - a.eff);
    const garde = effByClasse[0];
    return `<li><strong>${esc(garde.c.nom)}</strong> : ${effByClasse.length} classes fusionnées en une (celle avec ${garde.eff} élève(s) est conservée)</li>`;
  }).join('');
  openModal('Fusionner les classes en double', `
    <p>Les groupes suivants seront fusionnés en une seule classe chacun. Les élèves, présences, matières et évaluations des classes supprimées seront transférés vers la classe conservée.</p>
    <ul>${detail}</ul>
    <p class="text-soft">Cette action est irréversible.</p>
  `, {
    saveLabel: 'Fusionner',
    onSave: async () => {
      const resume = await fusionnerClassesDoublons();
      toast(`${resume.groupes} groupe(s) fusionné(s), ${resume.supprimees} classe(s) en double supprimée(s).`);
      onRouteChange();
      return true;
    }
  });
}

async function fusionnerClassesDoublons() {
  const classes = await DB.getAll('classes');
  const groupes = detecterClassesDoublons(classes);
  let supprimees = 0;
  for (const groupe of groupes) {
    const eleves = await DB.getAll('eleves');
    const effByClasse = groupe.map((c) => ({ c, eff: eleves.filter((e) => e.classeId === c.id).length }));
    effByClasse.sort((a, b) => b.eff - a.eff);
    const garde = effByClasse[0].c;
    const autres = effByClasse.slice(1).map((x) => x.c);

    // Compléter les champs vides de la classe conservée avec ceux des doublons.
    let modifGarde = false;
    for (const dup of autres) {
      if (!garde.salle && dup.salle) { garde.salle = dup.salle; modifGarde = true; }
      if (!garde.emploiDuTemps && dup.emploiDuTemps) { garde.emploiDuTemps = dup.emploiDuTemps; modifGarde = true; }
      if (!garde.enseignantId && dup.enseignantId) { garde.enseignantId = dup.enseignantId; modifGarde = true; }
      const fusion = Array.from(new Set([...idsEnseignantsClasse(garde), ...idsEnseignantsClasse(dup)]));
      if (fusion.length !== idsEnseignantsClasse(garde).length) { garde.enseignantIds = fusion; modifGarde = true; }
    }
    if (modifGarde) await DB.put('classes', garde);

    for (const dup of autres) {
      // Élèves
      for (const e of eleves.filter((x) => x.classeId === dup.id)) {
        e.classeId = garde.id;
        await DB.put('eleves', e);
      }
      // Présences
      for (const p of (await DB.getAll('presencesEleves')).filter((x) => x.classeId === dup.id)) {
        p.classeId = garde.id;
        await DB.put('presencesEleves', p);
      }
      // Matières (éviter les doublons de nom sur la classe conservée)
      const matieresGarde = (await DB.getAll('matieres')).filter((m) => m.classeId === garde.id);
      for (const m of (await DB.getAll('matieres')).filter((x) => x.classeId === dup.id)) {
        const existante = matieresGarde.find((mg) => (mg.nom || '').trim().toLowerCase() === (m.nom || '').trim().toLowerCase());
        if (existante) { await DB.delete('matieres', m.id); }
        else { m.classeId = garde.id; await DB.put('matieres', m); matieresGarde.push(m); }
      }
      // Évaluations
      for (const ev of (await DB.getAll('evaluations')).filter((x) => x.classeId === dup.id)) {
        ev.classeId = garde.id;
        await DB.put('evaluations', ev);
      }
      // Fiche patrimoine de la classe (une seule par classe)
      const patGarde = (await DB.getAll('patrimoineClasse')).find((x) => x.classeId === garde.id);
      const patDup = (await DB.getAll('patrimoineClasse')).find((x) => x.classeId === dup.id);
      if (patDup) {
        if (patGarde) await DB.delete('patrimoineClasse', patDup.id);
        else { patDup.classeId = garde.id; await DB.put('patrimoineClasse', patDup); }
      }
      await DB.delete('classes', dup.id);
      supprimees++;
    }
  }
  return { groupes: groupes.length, supprimees };
}

async function renderClasseDetail(root, id) {
  const classe = await DB.get('classes', id);
  if (!classe) { root.innerHTML = `<div class="alert alert-terre">Classe introuvable.</div>`; return; }
  if (!classeVisible(id)) { root.innerHTML = `<div class="alert alert-terre">Vous n'avez pas accès à cette classe.</div>`; return; }
  const [eleves, enseignants, presences, evaluations] = await Promise.all([DB.getAll('eleves'), DB.getAll('enseignants'), DB.getAll('presencesEleves'), DB.getAll('evaluations')]);
  const elevesClasse = eleves.filter((e) => e.classeId === id);
  const actifs = elevesClasse.filter((e) => (e.statut || 'actif') === 'actif');

  const presClasse = presences.filter((p) => p.classeId === id);
  const taux = presClasse.length ? Math.round((presClasse.filter((p) => p.statut === 'present').length / presClasse.length) * 100) : null;

  const evalsClasse = evaluations.filter((e) => e.classeId === id);
  let som = 0, n = 0;
  evalsClasse.forEach((ev) => (ev.notes || []).forEach((no) => { const v = noteSur20(ev, no); if (v !== null) { som += v; n++; } }));
  const moyenne = n ? (som / n).toFixed(1) : '—';

  // Années scolaires antérieures pour lesquelles on a un historique de passage dans CETTE classe
  const meta = (await DB.getAll('meta'))[0] || {};
  const anneeActive = meta.anneeScolaire || anneeScolaireCourante();
  const anneesHistoriques = Array.from(new Set(
    eleves.flatMap((e) => (e.historiqueClasses || []).filter((h) => h.classeId === id).map((h) => h.anneeScolaire))
  )).filter((a) => a && a !== anneeActive).sort().reverse();
  const anneesOptions = [anneeActive, ...anneesHistoriques];

  root.innerHTML = `
    <button class="btn btn-sm no-print" onclick="location.hash='#/classes'">← Toutes les classes</button>
    <div class="card" style="margin-top:12px;">
      <div class="flex justify-between items-center">
        <div><h2 style="margin-bottom:2px;">${esc(classe.nom)}</h2><span class="text-soft">Niveau ${esc(classe.niveau)}</span></div>
        <div class="flex gap-8 no-print">
          <button class="btn btn-sm" onclick="openClasseForm(${id})">Modifier</button>
          <button class="btn btn-sm" style="color:#B23A3A;" onclick="supprimerClasse(${id})">Supprimer</button>
        </div>
      </div>
    </div>
    <div class="grid grid-4" style="margin-top:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Effectif</div><div class="value">${actifs.length}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Taux de présence</div><div class="value">${taux === null ? '—' : taux + '%'}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Moyenne générale</div><div class="value">${moyenne}${moyenne !== '—' ? '/' + MOYENNE_BASE : ''}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Taux de réussite (≥${SEUIL_MOYENNE}/${MOYENNE_BASE})</div><div class="value">${tauxReussite(evalsClasse)}</div></div>
    </div>
    <div class="tabs no-print" id="cl-tabs">${['Élèves', 'Emploi du temps', 'Enseignant'].map((t, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
    <div id="cl-tab-content"></div>`;

  const showTab = (name) => {
    $all('.tab', $('#cl-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    const c = $('#cl-tab-content');
    if (name === 'Élèves') {
      const anneeChoisie = ($('#cl-annee') && $('#cl-annee').value) || anneeActive;
      const estAnneeActive = anneeChoisie === anneeActive;
      const roster = estAnneeActive
        ? elevesClasse.map((e) => ({ eleve: e, decision: null, moyenneAnnuelle: null }))
        : eleves.map((e) => {
            const entree = (e.historiqueClasses || []).find((h) => h.classeId === id && h.anneeScolaire === anneeChoisie);
            return entree ? { eleve: e, decision: entree.decision, moyenneAnnuelle: entree.moyenneAnnuelle } : null;
          }).filter(Boolean).sort((a, b) => (a.eleve.nom || '').localeCompare(b.eleve.nom || ''));
      const libelleDecision = { admis: 'Admis(e)', redouble: 'A redoublé', abandon: "A quitté l'école" };
      c.innerHTML = `
        <div class="table-toolbar no-print" style="margin:0 0 10px;">
          <label style="font-weight:700; font-size:13px;">Année scolaire</label>
          <select id="cl-annee" class="search-input" style="max-width:170px;">${anneesOptions.map((a) => `<option value="${esc(a)}" ${a === anneeChoisie ? 'selected' : ''}>${esc(a)}${a === anneeActive ? ' (en cours)' : ''}</option>`).join('')}</select>
          ${!estAnneeActive ? `<span class="chip">Effectif reconstitué d'après le passage de classe de ${esc(anneeChoisie)}</span>` : ''}
        </div>
        <div class="table-wrap"><table><thead><tr><th>Matricule</th><th>Nom & prénom</th><th>Sexe</th><th>${estAnneeActive ? 'Statut' : 'Décision ' + esc(anneeChoisie)}</th>${estAnneeActive ? '' : '<th>Moyenne annuelle</th>'}<th></th></tr></thead>
        <tbody>${roster.length ? roster.map(({ eleve: e, decision, moyenneAnnuelle }) => `<tr>
            <td>${esc(e.matricule)}</td><td>${esc(e.nom)} ${esc(e.prenom)}</td><td>${e.sexe === 'F' ? 'Fille' : 'Garçon'}</td>
            <td>${estAnneeActive ? badgeStatutEleve(e.statut) : (libelleDecision[decision] || '—')}</td>
            ${estAnneeActive ? '' : `<td>${moyenneAnnuelle != null ? moyenneAnnuelle.toFixed(2) + '/' + MOYENNE_BASE : '—'}</td>`}
            <td class="no-print"><button class="btn btn-sm" onclick="location.hash='#/eleves?id=${e.id}'">Dossier</button></td>
          </tr>`).join('') : `<tr><td colspan="${estAnneeActive ? 5 : 6}" class="text-soft">${estAnneeActive ? 'Aucun élève dans cette classe.' : "Aucune donnée pour cette année scolaire (aucun passage de classe n'a encore été validé pour " + esc(anneeChoisie) + ")."}</td></tr>`}</tbody></table></div>`;
      $('#cl-annee').onchange = () => showTab('Élèves');
    } else if (name === 'Emploi du temps') {
      c.innerHTML = `<div class="card"><label style="font-weight:700; font-size:12px;">Emploi du temps (texte libre)</label>
        <textarea id="cl-edt" style="width:100%; min-height:180px; margin-top:8px;">${esc(classe.emploiDuTemps || '')}</textarea>
        <button class="btn btn-primary btn-sm no-print" style="margin-top:10px;" onclick="saveEdt(${id})">Enregistrer</button></div>`;
    } else if (name === 'Enseignant') {
      const affectes = enseignantsDeClasse(classe, enseignants).map((en) => en.id);
      c.innerHTML = `<div class="card"><label style="font-weight:700; font-size:12px;">Enseignants affectés à cette classe</label>
        <p class="text-soft" style="margin:4px 0 8px;">Cochez tous les enseignants de la classe (plusieurs possibles selon l'effectif), puis choisissez le titulaire.</p>
        <div id="cl-ens-list">${enseignants.map((en) => `<label style="display:flex; gap:8px; align-items:center; padding:5px 0;"><input type="checkbox" class="cl-ens-chk" value="${en.id}" ${affectes.includes(en.id) ? 'checked' : ''}> ${esc(en.nom)} ${esc(en.prenom)}</label>`).join('') || '<p class="text-soft">Aucun enseignant enregistré.</p>'}</div>
        <label style="font-weight:700; font-size:12px; display:block; margin-top:10px;">Enseignant titulaire</label>
        <select id="cl-ens" style="margin-top:6px; width:100%; max-width:320px;"><option value="">— Aucun —</option>${enseignants.map((en) => `<option value="${en.id}" ${classe.enseignantId === en.id ? 'selected' : ''}>${esc(en.nom)} ${esc(en.prenom)}</option>`).join('')}</select>
        <div><button class="btn btn-primary btn-sm no-print" style="margin-top:10px;" onclick="saveClasseTitulaire(${id})">Enregistrer</button></div></div>`;
    }
  };
  $('#cl-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); };
  showTab('Élèves');
}

function tauxReussite(evalsClasse) {
  let total = 0, reussite = 0;
  evalsClasse.forEach((ev) => (ev.notes || []).forEach((n) => {
    const v = noteSur20(ev, n);
    if (v === null) return;
    total++; if (v >= SEUIL_MOYENNE) reussite++;
  }));
  return total ? Math.round((reussite / total) * 100) + '%' : '—';
}

async function saveEdt(id) { const classe = await DB.get('classes', id); classe.emploiDuTemps = $('#cl-edt').value; await DB.put('classes', classe); toast('Emploi du temps enregistré.'); }
async function saveClasseTitulaire(id) {
  const classe = await DB.get('classes', id);
  const ids = $all('.cl-ens-chk').filter((x) => x.checked).map((x) => Number(x.value));
  const titulaire = $('#cl-ens').value ? Number($('#cl-ens').value) : null;
  if (titulaire && !ids.includes(titulaire)) ids.push(titulaire); // le titulaire fait partie des enseignants de la classe
  classe.enseignantIds = ids;
  classe.enseignantId = titulaire;
  await DB.put('classes', classe);
  // Les dossiers dont la « classe principale » pointait ici mais qui ont été décochés sont détachés.
  for (const en of await DB.getAll('enseignants')) {
    if (en.classeId === id && !ids.includes(en.id)) { en.classeId = null; await DB.put('enseignants', en); }
  }
  toast('Enseignants de la classe mis à jour.'); onRouteChange();
}

async function openClasseForm(id) {
  const classe = await DB.get('classes', id);
  openModal('Modifier la classe', `<div class="form-grid">
    <div class="field"><label>Nom de la classe</label><input id="c-nom" value="${esc(classe.nom)}"></div>
    <div class="field"><label>Salle</label><input id="c-salle" value="${esc(classe.salle || '')}"></div>
  </div>`, {
    onSave: async () => { classe.nom = $('#c-nom').value; classe.salle = $('#c-salle').value; await DB.put('classes', classe); toast('Classe mise à jour.'); onRouteChange(); return true; }
  });
}

async function supprimerClasse(id) {
  const classe = await DB.get('classes', id);
  if (!classe) return;
  const eleves = await DB.getAll('eleves');
  const nbEleves = eleves.filter((e) => e.classeId === id).length;
  const avertissement = nbEleves
    ? `<p class="text-soft">⚠️ ${nbEleves} élève(s) sont actuellement rattaché(s) à cette classe. Ils resteront dans l'application mais ne seront plus associés à aucune classe.</p>`
    : '';
  openModal('Supprimer la classe', `<p>Supprimer définitivement la classe <strong>${esc(classe.nom)}</strong> ?</p>${avertissement}`, {
    saveLabel: 'Supprimer',
    onSave: async () => {
      await DB.delete('classes', id);
      toast('Classe supprimée.');
      location.hash = '#/classes';
      return true;
    }
  });
}

/* ================= ENSEIGNANTS ================= */
ROUTES['#/enseignants'] = async (root) => {
  const id = getHashParams().get('id');
  if (id) return renderEnseignantDetail(root, Number(id));
  return renderEnseignantList(root);
};

async function renderEnseignantList(root) {
  const [ens, classes] = await Promise.all([DB.getAll('enseignants'), DB.getAll('classes')]);
  const classeMap = Object.fromEntries(ens.map((e) => [e.id, classesDeEnseignant(e, classes).map((c) => c.nom).join(' / ')]));
  root.innerHTML = `<div class="table-toolbar"><input class="search-input" id="en-search" placeholder="Rechercher un enseignant…"><div style="flex:1;"></div><button class="btn btn-sm" id="en-pdf">Exporter PDF</button><button class="btn btn-accent" id="en-add">+ Nouvel enseignant</button></div><div id="en-table"></div>`;
  const doRender = () => {
    const q = $('#en-search').value.toLowerCase();
    const list = ens.filter((e) => !q || `${e.nom} ${e.prenom} ${e.matricule}`.toLowerCase().includes(q));
    $('#en-table').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Matricule</th><th>Nom & prénom</th><th>Fonction</th><th>Classe(s)</th><th>Téléphone</th><th></th></tr></thead>
      <tbody>${list.map((e) => `<tr><td><div class="avatar">${e.photo ? `<img src="${e.photo}">` : esc((e.nom || '?')[0])}</div></td><td>${esc(e.matricule)}</td><td>${esc(e.nom)} ${esc(e.prenom)}</td><td>${esc(e.fonction || 'Enseignant')}</td><td>${esc(classeMap[e.id] || '—')}</td><td>${esc(e.telephone || '')}</td><td class="no-print"><button class="btn btn-sm" onclick="location.hash='#/enseignants?id=${e.id}'">Dossier</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">Aucun enseignant enregistré.</div>`;
  };
  doRender(); $('#en-search').oninput = doRender;
  $('#en-add').onclick = () => openEnseignantForm(null);
  $('#en-pdf').onclick = () => {
    const headers = ['Matricule', 'Nom & prénom', 'Fonction', 'Classe titulaire', 'Téléphone'];
    const matrix = ens.map((e) => [e.matricule, `${e.nom} ${e.prenom}`, e.fonction || 'Enseignant', classeMap[e.id] || '—', e.telephone || '']);
    pdfTable('Liste des enseignants', headers, matrix);
  };
}

async function openEnseignantForm(id) {
  const row = id ? await DB.get('enseignants', id) : {};
  const classes = await DB.getAll('classes');
  const body = `<div class="form-grid">
    <div class="field full flex items-center gap-12"><div class="avatar" id="ep-preview" style="width:56px;height:56px;">${row.photo ? `<img src="${row.photo}">` : '?'}</div><input type="file" accept="image/*" id="ep-photo"></div>
    <div class="field full"><label>Matricule (officiel, saisi à la main)</label><input id="ep-matricule" value="${esc(row.matricule || '')}" placeholder="Laisser vide si pas encore attribué"></div>
    <div class="field"><label>Nom *</label><input id="ep-nom" value="${esc(row.nom || '')}"></div>
    <div class="field"><label>Prénom *</label><input id="ep-prenom" value="${esc(row.prenom || '')}"></div>
    <div class="field"><label>Fonction</label><input id="ep-fonction" value="${esc(row.fonction || 'Enseignant titulaire')}"></div>
    <div class="field"><label>Classe principale</label><select id="ep-classe"><option value="">—</option>${classes.map((c) => `<option value="${c.id}" ${row.classeId === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></div>
    <div class="field"><label>Téléphone</label><input id="ep-tel" value="${esc(row.telephone || '')}"></div>
    <div class="field"><label>Email</label><input id="ep-email" value="${esc(row.email || '')}"></div>
    <div class="field"><label>Date de prise de service</label><input type="date" id="ep-date" value="${row.datePriseService || ''}"></div>
    <div class="field full"><label>Observations</label><textarea id="ep-obs">${esc(row.observations || '')}</textarea></div>
  </div>`;
  const overlay = openModal(id ? 'Modifier enseignant' : 'Nouvel enseignant', body, {
    wide: true,
    onSave: async (ov) => {
      const nom = $('#ep-nom', ov).value.trim();
      if (!nom) { toast('Le nom est obligatoire.'); return false; }
      const obj = {
        ...row, nom, matricule: $('#ep-matricule', ov).value.trim(), prenom: $('#ep-prenom', ov).value, fonction: $('#ep-fonction', ov).value,
        classeId: $('#ep-classe', ov).value ? Number($('#ep-classe', ov).value) : null,
        telephone: $('#ep-tel', ov).value, email: $('#ep-email', ov).value,
        datePriseService: $('#ep-date', ov).value, observations: $('#ep-obs', ov).value
      };
      const fi = $('#ep-photo', ov);
      if (fi.files && fi.files[0]) obj.photo = await fileToBase64(fi.files[0]);
      if (!id) { obj.id = await DB.add('enseignants', obj); }
      else await DB.put('enseignants', obj);
      if (obj.classeId) {
        const cl = await DB.get('classes', obj.classeId);
        const lst = idsEnseignantsClasse(cl);
        if (!lst.includes(obj.id)) lst.push(obj.id);
        cl.enseignantIds = lst;
        if (!cl.enseignantId) cl.enseignantId = obj.id; // devient titulaire seulement si la classe n'en a pas
        await DB.put('classes', cl);
      }
      toast('Dossier enseignant enregistré.');
      if (getHashParams().get('id')) onRouteChange(); else location.hash = `#/enseignants?id=${obj.id}`;
      return true;
    }
  });
  $('#ep-photo', overlay).onchange = async (e) => { if (e.target.files[0]) { const b64 = await fileToBase64(e.target.files[0]); $('#ep-preview', overlay).innerHTML = `<img src="${b64}">`; } };
}

async function renderEnseignantDetail(root, id) {
  const ens = await DB.get('enseignants', id);
  if (!ens) { root.innerHTML = `<div class="alert alert-terre">Enseignant introuvable.</div>`; return; }
  const classesEns = classesDeEnseignant(ens, await DB.getAll('classes'));
  const presences = (await DB.getAll('presencesEnseignants')).filter((p) => p.enseignantId === id).sort((a, b) => b.date.localeCompare(a.date));
  const discipline = (await DB.getAll('discipline')).filter((d) => d.cibleType === 'enseignant' && Number(d.cibleId) === id);
  root.innerHTML = `
    <button class="btn btn-sm no-print" onclick="location.hash='#/enseignants'">← Retour</button>
    <div class="card" style="margin-top:12px;">
      <div class="flex items-center gap-12">
        <div class="avatar" style="width:60px;height:60px;">${ens.photo ? `<img src="${ens.photo}">` : esc((ens.nom || '?')[0])}</div>
        <div style="flex:1;"><h2 style="margin-bottom:2px;">${esc(ens.nom)} ${esc(ens.prenom)}</h2><span class="text-soft">${esc(ens.fonction || 'Enseignant')} · ${classesEns.length ? esc(classesEns.map((c) => c.nom).join(' / ')) : 'Non affecté'}</span>
          <div style="margin-top:4px;">${ens.profileId ? `<span class="chip" style="background:var(--vert,#3a7d44); color:#fff;">✓ Compte de connexion créé</span>` : `<span class="chip">Pas encore de compte de connexion</span>`}</div>
        </div>
        <div class="flex gap-8 no-print">${rmAutorise() ? `<button class="btn btn-sm" onclick="rmModifierEns(${id})">Registre du personnel</button>` : ''}<button class="btn btn-sm" onclick="openEnseignantForm(${id})">Modifier</button></div>
      </div>
      <div class="grid grid-2" style="margin-top:14px;">
        <div>${infoRow('Date et lieu de naissance', [ens.dateNaissance ? formatDate(ens.dateNaissance) : '', ens.lieuNaissance].filter(Boolean).join(' à '))}${infoRow('Téléphone', ens.telephone)}${infoRow('Email', ens.email)}${infoRow('Prise de service', formatDate(ens.datePriseService))}</div>
        <div>${infoRow('Observations', ens.observations)}</div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px; align-items:start;">
      <div class="card"><h3>Présences récentes</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Statut</th></tr></thead>
        <tbody>${presences.length ? presences.slice(0, 15).map((p) => `<tr><td>${formatDate(p.date)}</td><td>${presStatutBadge(p.statut)}</td></tr>`).join('') : `<tr><td colspan="2" class="text-soft">Aucune donnée.</td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Discipline / distinctions</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Motif</th></tr></thead>
        <tbody>${discipline.length ? discipline.map((d) => `<tr><td>${formatDate(d.date)}</td><td>${disciplineBadge(d.type)}</td><td class="wrap">${esc(d.motif)}</td></tr>`).join('') : `<tr><td colspan="3" class="text-soft">Aucun évènement.</td></tr>`}</tbody></table></div>
    </div>`;
}

/* ================= PRÉSENCES ================= */
ROUTES['#/presences'] = async (root) => {
  root.innerHTML = `<div class="tabs" id="pr-tabs">
      <button class="tab active" data-tab="eleves">Présences élèves</button>
      <button class="tab" data-tab="enseignants">Présences enseignants</button>
    </div><div id="pr-content"></div>`;
  const show = (t) => { $all('.tab', $('#pr-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t)); t === 'eleves' ? renderPresenceEleves($('#pr-content')) : renderPresenceEnseignants($('#pr-content')); };
  $('#pr-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); };
  show('eleves');
};

async function renderPresenceEleves(root) {
  const classes = await classeOptions();
  root.innerHTML = `
    <div class="table-toolbar">
      <select id="pe-classe" class="search-input">${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select>
      <input type="date" id="pe-date" class="search-input" value="${todayISO()}">
      <button class="btn btn-sm" id="pe-load">Charger</button>
      <button class="btn btn-sm" id="pe-pdf">Exporter PDF</button>
    </div>
    <div id="pe-list"></div>`;
  const load = async () => {
    const classeId = Number($('#pe-classe').value);
    const date = $('#pe-date').value;
    const [eleves, presences] = await Promise.all([DB.getAll('eleves'), DB.getAll('presencesEleves')]);
    const list = eleves.filter((e) => e.classeId === classeId && (e.statut || 'actif') === 'actif').sort((a, b) => a.nom.localeCompare(b.nom));
    const existing = Object.fromEntries(presences.filter((p) => p.classeId === classeId && p.date === date).map((p) => [p.eleveId, p]));
    $('#pe-list').innerHTML = list.length ? `
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Élève</th><th>Statut</th><th>Motif (si absent)</th></tr></thead>
      <tbody>${list.map((e) => {
        const cur = existing[e.id] || {};
        return `<tr data-eleve="${e.id}">
          <td>${esc(e.nom)} ${esc(e.prenom)}</td>
          <td><select class="pe-statut"><option value="present" ${cur.statut === 'present' || !cur.statut ? 'selected' : ''}>Présent</option><option value="absent" ${cur.statut === 'absent' ? 'selected' : ''}>Absent</option><option value="retard" ${cur.statut === 'retard' ? 'selected' : ''}>Retard</option></select></td>
          <td><input class="pe-motif" value="${esc(cur.motif || '')}" style="width:100%;"></td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <button class="btn btn-primary" id="pe-save" style="margin-top:12px;">Enregistrer l'appel</button>
      <span class="text-soft" style="margin-left:10px;" id="pe-summary"></span>
      </div>` : `<div class="empty-state">Aucun élève actif dans cette classe.</div>`;
    updateSummary();
    $all('.pe-statut').forEach((s) => s.onchange = updateSummary);
    $('#pe-save') && ($('#pe-save').onclick = async () => {
      const classeId2 = classeId, date2 = date;
      const rows = $all('tr[data-eleve]');
      for (const r of rows) {
        const eleveId = Number(r.dataset.eleve);
        const statut = $('.pe-statut', r).value;
        const motif = $('.pe-motif', r).value;
        const prev = existing[eleveId];
        const obj = { id: prev ? prev.id : undefined, eleveId, classeId: classeId2, date: date2, statut, motif };
        if (prev) await DB.put('presencesEleves', obj); else { delete obj.id; await DB.add('presencesEleves', obj); }
      }
      toast('Présences enregistrées.');
      load();
    });
    $('#pe-pdf').onclick = () => {
      const classe = classes.find((c) => c.value === classeId);
      const headers = ['Élève', 'Statut', 'Motif'];
      const matrix = list.map((e) => { const cur = existing[e.id] || {}; return [`${e.nom} ${e.prenom}`, labelPresenceStatut(cur.statut || 'present'), cur.motif || '']; });
      pdfTable(`Présences — ${classe ? classe.label : ''} — ${formatDate(date)}`, headers, matrix);
    };
    function updateSummary() {
      const statuses = $all('.pe-statut').map((s) => s.value);
      const p = statuses.filter((s) => s === 'present').length, a = statuses.filter((s) => s === 'absent').length, r = statuses.filter((s) => s === 'retard').length;
      const el2 = $('#pe-summary'); if (el2) el2.textContent = `${p} présent(s) · ${a} absent(s) · ${r} retard(s)`;
    }
  };
  $('#pe-load').onclick = load;
  if (classes.length) load();
}

async function renderPresenceEnseignants(root) {
  root.innerHTML = `<div class="table-toolbar"><input type="date" id="pn-date" class="search-input" value="${todayISO()}"><button class="btn btn-sm" id="pn-load">Charger</button><button class="btn btn-sm" id="pn-pdf">Exporter PDF</button></div><div id="pn-list"></div>`;
  const load = async () => {
    const date = $('#pn-date').value;
    const [ens, presences] = await Promise.all([DB.getAll('enseignants'), DB.getAll('presencesEnseignants')]);
    const existing = Object.fromEntries(presences.filter((p) => p.date === date).map((p) => [p.enseignantId, p]));
    $('#pn-list').innerHTML = ens.length ? `<div class="card"><div class="table-wrap"><table><thead><tr><th>Enseignant</th><th>Statut</th></tr></thead>
      <tbody>${ens.map((e) => { const cur = existing[e.id] || {}; return `<tr data-ens="${e.id}"><td>${esc(e.nom)} ${esc(e.prenom)}</td><td><select class="pn-statut"><option value="present" ${cur.statut === 'present' || !cur.statut ? 'selected' : ''}>Présent</option><option value="absent" ${cur.statut === 'absent' ? 'selected' : ''}>Absent</option><option value="conge" ${cur.statut === 'conge' ? 'selected' : ''}>Congé</option></select></td></tr>`; }).join('')}</tbody></table></div>
      <button class="btn btn-primary" id="pn-save" style="margin-top:12px;">Enregistrer</button></div>` : `<div class="empty-state">Aucun enseignant enregistré.</div>`;
    $('#pn-save') && ($('#pn-save').onclick = async () => {
      for (const r of $all('tr[data-ens]')) {
        const enseignantId = Number(r.dataset.ens);
        const statut = $('.pn-statut', r).value;
        const prev = existing[enseignantId];
        const obj = { id: prev ? prev.id : undefined, enseignantId, date, statut };
        if (prev) await DB.put('presencesEnseignants', obj); else { delete obj.id; await DB.add('presencesEnseignants', obj); }
      }
      toast('Présences enseignants enregistrées.');
      load();
    });
    $('#pn-pdf').onclick = () => {
      const headers = ['Enseignant', 'Statut'];
      const matrix = ens.map((e) => { const cur = existing[e.id] || {}; return [`${e.nom} ${e.prenom}`, ({ present: 'Présent', absent: 'Absent', conge: 'Congé' })[cur.statut || 'present']]; });
      pdfTable(`Présences enseignants — ${formatDate(date)}`, headers, matrix);
    };
  };
  $('#pn-load').onclick = load; load();
}
