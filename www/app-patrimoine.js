/* ============================================================
   app-patrimoine.js — Patrimoine & infrastructures (NOUVEAU MODULE)
   ------------------------------------------------------------
   Additif uniquement : nouveaux magasins IndexedDB dédiés
   (patrimoineDomaine, patrimoineInfra, patrimoineClasse), nouvel
   onglet de menu, aucune modification des modules existants.
   ============================================================ */

const ETATS_PATRIMOINE = [
  { value: 'bon', label: 'Bon état', badge: 'vert' },
  { value: 'moyen', label: 'État moyen', badge: 'ocre' },
  { value: 'mauvais', label: 'Mauvais état', badge: 'terre' }
];
function etatBadge(v) { const e = ETATS_PATRIMOINE.find((x) => x.value === v); return e ? `<span class="badge badge-${e.badge}">${e.label}</span>` : '<span class="text-soft">—</span>'; }

ROUTES['#/patrimoine'] = async (root) => {
  root.innerHTML = `
    <div id="pt-summary" class="grid grid-4" style="margin-bottom:16px;"></div>
    <div class="tabs" id="pt-tabs">
      <button class="tab active" data-tab="domaine">Domaine scolaire</button>
      <button class="tab" data-tab="infra">Infrastructures</button>
      <button class="tab" data-tab="classes">Équipement par classe</button>
    </div>
    <div id="pt-content"></div>`;

  await refreshResume();

  const show = (t) => {
    $all('.tab', $('#pt-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    if (t === 'domaine') renderDomaine($('#pt-content'));
    else if (t === 'infra') renderInfra($('#pt-content'));
    else renderEquipementClasses($('#pt-content'));
  };
  $('#pt-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); };
  show('domaine');
};

async function refreshResume() {
  const [domaineRows, infra, classes, eqClasses] = await Promise.all([
    DB.getAll('patrimoineDomaine'), DB.getAll('patrimoineInfra'), DB.getAll('classes'), DB.getAll('patrimoineClasse')
  ]);
  const domaine = domaineRows[0] || {};
  const nbSallesInfra = infra.filter((i) => i.type === 'Salle de classe').reduce((s, i) => s + (Number(i.nombre) || 0), 0);
  let tablesBon = 0, tablesMauvais = 0;
  eqClasses.forEach((e) => { tablesBon += Number(e.tablesBancsBon) || 0; tablesMauvais += Number(e.tablesBancsMauvais) || 0; });
  const totalTables = tablesBon + tablesMauvais;
  const pctBon = totalTables ? Math.round((tablesBon / totalTables) * 100) : null;

  $('#pt-summary').innerHTML = `
    <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Salles de classe (parc)</div><div class="value">${nbSallesInfra || classes.length}</div></div>
    <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Tables-bancs en bon état</div><div class="value">${pctBon === null ? '—' : pctBon + '%'}</div><div class="foot">${tablesBon} bon état / ${tablesMauvais} mauvais état</div></div>
    <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Domaine délimité</div><div class="value">${domaine.delimite === 'oui' ? 'Oui' : domaine.delimite === 'non' ? 'Non' : '—'}</div></div>
    <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Domaine clôturé</div><div class="value">${domaine.cloture === 'oui' ? 'Oui' : domaine.cloture === 'non' ? 'Non' : '—'}</div></div>`;
}

/* ---------------- Domaine scolaire ---------------- */
async function renderDomaine(root) {
  const rows = await DB.getAll('patrimoineDomaine');
  const d = rows[0] || {};
  root.innerHTML = `
    <div class="card">
      <h3>Domaine scolaire</h3>
      <div class="form-grid">
        <div class="field"><label>Superficie du domaine (m²)</label><input type="number" id="pd-superficie" value="${d.superficie ?? ''}"></div>
        <div class="field"><label>Domaine délimité</label><select id="pd-delimite"><option value="">—</option><option value="oui" ${d.delimite === 'oui' ? 'selected' : ''}>Oui</option><option value="non" ${d.delimite === 'non' ? 'selected' : ''}>Non</option></select></div>
        <div class="field"><label>Domaine clôturé</label><select id="pd-cloture"><option value="">—</option><option value="oui" ${d.cloture === 'oui' ? 'selected' : ''}>Oui</option><option value="non" ${d.cloture === 'non' ? 'selected' : ''}>Non</option></select></div>
        <div class="field"><label>Type de clôture (si clôturé)</label><input id="pd-typecloture" value="${esc(d.typeCloture || '')}" placeholder="Murs en dur, grillage, haie vive…"></div>
        <div class="field full"><label>Observations</label><textarea id="pd-obs">${esc(d.observations || '')}</textarea></div>
      </div>
      <button class="btn btn-primary btn-sm" id="pd-save" style="margin-top:12px;">Enregistrer</button>
      <button class="btn btn-sm" id="pd-pdf" style="margin-top:12px;">Exporter PDF</button>
    </div>`;
  $('#pd-save').onclick = async () => {
    const obj = {
      ...d,
      superficie: $('#pd-superficie').value === '' ? '' : Number($('#pd-superficie').value),
      delimite: $('#pd-delimite').value, cloture: $('#pd-cloture').value,
      typeCloture: $('#pd-typecloture').value, observations: $('#pd-obs').value
    };
    if (d.id) await DB.put('patrimoineDomaine', obj); else await DB.add('patrimoineDomaine', obj);
    toast('Domaine scolaire enregistré.');
    refreshResume();
  };
  $('#pd-pdf').onclick = () => {
    const headers = ['Caractéristique', 'Valeur'];
    const matrix = [
      ['Superficie du domaine', d.superficie ? `${d.superficie} m²` : '—'],
      ['Domaine délimité', d.delimite === 'oui' ? 'Oui' : d.delimite === 'non' ? 'Non' : '—'],
      ['Domaine clôturé', d.cloture === 'oui' ? 'Oui' : d.cloture === 'non' ? 'Non' : '—'],
      ['Type de clôture', d.typeCloture || '—'],
      ['Observations', d.observations || '—']
    ];
    pdfTable('Domaine scolaire', headers, matrix);
  };
}

/* ---------------- Infrastructures (bâtiments) ---------------- */
async function renderInfra(root) {
  await renderCrudView(root, {
    store: 'patrimoineInfra', title: 'Infrastructures',
    subtitle: 'Salles de classe, magasin, bureau, cuisine, toilettes, logements, bibliothèque…',
    fields: [
      { key: 'type', label: 'Type de local', type: 'select', required: true, options: [
        { value: 'Salle de classe', label: 'Salle de classe' }, { value: 'Magasin', label: 'Magasin' },
        { value: 'Bureau', label: 'Bureau du directeur' }, { value: 'Cuisine', label: 'Cuisine / cantine' },
        { value: 'Toilettes', label: 'Toilettes / latrines' }, { value: 'Logement', label: 'Logement enseignant' },
        { value: 'Bibliothèque', label: 'Bibliothèque' }, { value: 'Autre', label: 'Autre' }
      ]},
      { key: 'nombre', label: 'Nombre', type: 'number', required: true },
      { key: 'etat', label: 'État général', type: 'select', required: true, options: ETATS_PATRIMOINE.map((e) => ({ value: e.value, label: e.label })) },
      { key: 'observations', label: 'Observations', type: 'textarea', full: true }
    ],
    columns: [
      { key: 'type', label: 'Type' }, { key: 'nombre', label: 'Nombre' },
      { key: 'etat', label: 'État', render: (r) => etatBadge(r.etat) }, { key: 'observations', label: 'Observations' }
    ]
  });
  refreshResume();
}

/* ---------------- Équipement par classe ---------------- */
async function renderEquipementClasses(root) {
  const [classes, eqAll] = await Promise.all([DB.getAll('classes'), DB.getAll('patrimoineClasse')]);
  classes.sort((a, b) => (a.nom || '').localeCompare(b.nom));
  const eqByClasse = Object.fromEntries(eqAll.map((e) => [e.classeId, e]));
  // Garantit une fiche d'équipement par classe (créée automatiquement si absente)
  for (const c of classes) {
    if (!eqByClasse[c.id]) {
      const id2 = await DB.add('patrimoineClasse', { classeId: c.id, tablesBancsBon: 0, tablesBancsMauvais: 0, nbTableaux: 0, etatTableau: '', etatSalle: '' });
      eqByClasse[c.id] = { id: id2, classeId: c.id, tablesBancsBon: 0, tablesBancsMauvais: 0, nbTableaux: 0, etatTableau: '', etatSalle: '' };
    }
  }
  root.innerHTML = `
    <div class="table-toolbar"><div style="flex:1;"></div><button class="btn btn-sm" id="eq-pdf">Exporter PDF</button><button class="btn btn-sm" id="eq-export">Exporter CSV</button></div>
    <div class="table-wrap"><table><thead><tr>
      <th>Classe</th><th>Tables-bancs bon état</th><th>Tables-bancs mauvais état</th><th>Nb tableaux</th><th>État tableau</th><th>État de la salle</th><th></th>
    </tr></thead><tbody>${classes.map((c) => {
      const e = eqByClasse[c.id];
      return `<tr><td>${esc(c.nom)}</td><td>${e.tablesBancsBon || 0}</td><td>${e.tablesBancsMauvais || 0}</td><td>${e.nbTableaux || 0}</td><td>${etatBadge(e.etatTableau)}</td><td>${etatBadge(e.etatSalle)}</td>
        <td class="no-print"><button class="btn btn-sm" onclick="openEquipementClasseForm(${e.id},${c.id})">Modifier</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  $('#eq-pdf').onclick = () => {
    const headers = ['Classe', 'Tables-bancs bon état', 'Tables-bancs mauvais état', 'Nb tableaux', 'État tableau', 'État de la salle'];
    const matrix = classes.map((c) => {
      const e = eqByClasse[c.id];
      return [c.nom, e.tablesBancsBon || 0, e.tablesBancsMauvais || 0, e.nbTableaux || 0, stripTags(etatBadge(e.etatTableau)), stripTags(etatBadge(e.etatSalle))];
    });
    pdfTable('Équipement par classe', headers, matrix);
  };
  $('#eq-export').onclick = () => {
    const rows = classes.map((c) => ({ classe: c.nom, ...eqByClasse[c.id] }));
    const csv = toCSV(rows, [
      { label: 'Classe', value: 'classe' }, { label: 'Tables-bancs bon état', value: 'tablesBancsBon' },
      { label: 'Tables-bancs mauvais état', value: 'tablesBancsMauvais' }, { label: 'Nb tableaux', value: 'nbTableaux' },
      { label: 'État tableau', value: (r) => (ETATS_PATRIMOINE.find((x) => x.value === r.etatTableau) || {}).label || '' },
      { label: 'État de la salle', value: (r) => (ETATS_PATRIMOINE.find((x) => x.value === r.etatSalle) || {}).label || '' }
    ]);
    download('equipement-par-classe.csv', csv, 'text/csv;charset=utf-8');
  };
}

async function openEquipementClasseForm(id, classeId) {
  const row = await DB.get('patrimoineClasse', id);
  const classe = await DB.get('classes', classeId);
  openModal(`Équipement — ${classe ? classe.nom : ''}`, `<div class="form-grid">
    <div class="field"><label>Tables-bancs en bon état</label><input type="number" id="eq-bon" value="${row.tablesBancsBon || 0}"></div>
    <div class="field"><label>Tables-bancs en mauvais état</label><input type="number" id="eq-mauvais" value="${row.tablesBancsMauvais || 0}"></div>
    <div class="field"><label>Nombre de tableaux</label><input type="number" id="eq-tableaux" value="${row.nbTableaux || 0}"></div>
    <div class="field"><label>État du tableau</label><select id="eq-etat-tableau"><option value="">—</option>${ETATS_PATRIMOINE.map((e) => `<option value="${e.value}" ${row.etatTableau === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}</select></div>
    <div class="field"><label>État de la salle</label><select id="eq-etat-salle"><option value="">—</option>${ETATS_PATRIMOINE.map((e) => `<option value="${e.value}" ${row.etatSalle === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}</select></div>
    <div class="field full"><label>Observations</label><textarea id="eq-obs">${esc(row.observations || '')}</textarea></div>
  </div>`, {
    onSave: async () => {
      row.tablesBancsBon = Number($('#eq-bon').value) || 0;
      row.tablesBancsMauvais = Number($('#eq-mauvais').value) || 0;
      row.nbTableaux = Number($('#eq-tableaux').value) || 0;
      row.etatTableau = $('#eq-etat-tableau').value;
      row.etatSalle = $('#eq-etat-salle').value;
      row.observations = $('#eq-obs').value;
      await DB.put('patrimoineClasse', row);
      toast('Équipement de la classe mis à jour.');
      await refreshResume();
      renderEquipementClasses($('#pt-content'));
      return true;
    }
  });
}
