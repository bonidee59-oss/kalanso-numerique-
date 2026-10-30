/* ============================================================
   app-gestion.js — Cotisations, Fournitures, Cantine, Finances, Discipline
   ============================================================ */

/* ================= COTISATIONS ================= */
ROUTES['#/cotisations'] = async (root) => {
  const [eleves, classes, cotisations] = await Promise.all([DB.getAll('eleves'), DB.getAll('classes'), DB.getAll('cotisations')]);
  const classeMap = Object.fromEntries(classes.map((c) => [c.id, c.nom]));
  // s'assurer qu'une fiche cotisation existe pour chaque élève actif
  const cotByEleve = Object.fromEntries(cotisations.map((c) => [c.eleveId, c]));
  for (const e of eleves) {
    if (!cotByEleve[e.id]) { const id2 = await DB.add('cotisations', { eleveId: e.id, montantAttendu: 0, montantPaye: 0, paiements: [] }); cotByEleve[e.id] = { id: id2, eleveId: e.id, montantAttendu: 0, montantPaye: 0, paiements: [] }; }
  }
  const rows = eleves.filter((e) => (e.statut || 'actif') === 'actif').map((e) => ({ eleve: e, cot: cotByEleve[e.id] }));
  const totalAttendu = rows.reduce((s, r) => s + (Number(r.cot.montantAttendu) || 0), 0);
  const totalPaye = rows.reduce((s, r) => s + (Number(r.cot.montantPaye) || 0), 0);
  const nonPayes = rows.filter((r) => (Number(r.cot.montantPaye) || 0) === 0 && (Number(r.cot.montantAttendu) || 0) > 0).length;
  const partiels = rows.filter((r) => (Number(r.cot.montantPaye) || 0) > 0 && (Number(r.cot.montantPaye) || 0) < (Number(r.cot.montantAttendu) || 0)).length;
  const soldes = rows.filter((r) => (Number(r.cot.montantAttendu) || 0) > 0 && (Number(r.cot.montantPaye) || 0) >= (Number(r.cot.montantAttendu) || 0)).length;

  root.innerHTML = `
    <div class="grid grid-4">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Total attendu</div><div class="value" style="font-size:19px;">${fmtMontant(totalAttendu)}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Total encaissé</div><div class="value" style="font-size:19px;">${fmtMontant(totalPaye)}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Reste à recouvrer</div><div class="value" style="font-size:19px;">${fmtMontant(totalAttendu - totalPaye)}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Non soldés / partiels</div><div class="value">${nonPayes} / ${partiels}</div><div class="foot">${soldes} parents à jour</div></div>
    </div>
    <div class="table-toolbar" style="margin-top:18px;">
      <select id="co-classe" class="search-input"><option value="">Toutes les classes</option>${classes.map((c) => `<option value="${c.id}">${esc(c.nom)}</option>`).join('')}</select>
      <select id="co-statut" class="search-input"><option value="">Tous les statuts</option><option value="paye">Payé</option><option value="partiel">Partiel</option><option value="impaye">Non payé</option></select>
      <input class="search-input" id="co-search" placeholder="Rechercher un élève…">
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="co-pdf">Exporter PDF</button>
      <button class="btn btn-sm" id="co-relance">Liste des relances (CSV)</button>
    </div>
    <div id="co-table"></div>`;

  let listCourante = rows;
  const doRender = () => {
    const cf = $('#co-classe').value, sf = $('#co-statut').value, q = $('#co-search').value.toLowerCase();
    let list = rows;
    if (cf) list = list.filter((r) => String(r.eleve.classeId) === cf);
    if (q) list = list.filter((r) => `${r.eleve.nom} ${r.eleve.prenom}`.toLowerCase().includes(q));
    if (sf) list = list.filter((r) => statutCot(r.cot) === sf);
    listCourante = list;
    $('#co-table').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Élève</th><th>Classe</th><th>Attendu</th><th>Payé</th><th>Solde</th><th>Statut</th><th></th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td>${esc(r.eleve.nom)} ${esc(r.eleve.prenom)}</td><td>${esc(classeMap[r.eleve.classeId] || '—')}</td>
        <td>${fmtMontant(r.cot.montantAttendu)}</td><td>${fmtMontant(r.cot.montantPaye)}</td>
        <td>${fmtMontant((Number(r.cot.montantAttendu) || 0) - (Number(r.cot.montantPaye) || 0))}</td>
        <td>${cotBadge(statutCot(r.cot))}</td>
        <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" onclick="openCotisationForm(${r.cot.id})">Paiement</button></div></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">Aucun résultat.</div>`;
  };
  doRender();
  $('#co-classe').onchange = doRender; $('#co-statut').onchange = doRender; $('#co-search').oninput = doRender;
  $('#co-pdf').onclick = () => {
    const headers = ['Élève', 'Classe', 'Attendu', 'Payé', 'Solde', 'Statut'];
    const matrix = listCourante.map((r) => [`${r.eleve.nom} ${r.eleve.prenom}`, classeMap[r.eleve.classeId] || '—', fmtMontant(r.cot.montantAttendu), fmtMontant(r.cot.montantPaye), fmtMontant((Number(r.cot.montantAttendu) || 0) - (Number(r.cot.montantPaye) || 0)), stripTags(cotBadge(statutCot(r.cot)))]);
    pdfTable('Cotisations scolaires', headers, matrix);
  };
  $('#co-relance').onclick = () => {
    const impayes = rows.filter((r) => statutCot(r.cot) !== 'paye');
    const csv = toCSV(impayes.map((r) => r), [
      { label: 'Nom', value: (r) => r.eleve.nom }, { label: 'Prénom', value: (r) => r.eleve.prenom },
      { label: 'Classe', value: (r) => classeMap[r.eleve.classeId] || '' }, { label: 'Téléphone parents', value: (r) => r.eleve.telParents || '' },
      { label: 'Attendu', value: (r) => r.cot.montantAttendu }, { label: 'Payé', value: (r) => r.cot.montantPaye },
      { label: 'Solde', value: (r) => (Number(r.cot.montantAttendu) || 0) - (Number(r.cot.montantPaye) || 0) }
    ]);
    download('relance-cotisations.csv', csv, 'text/csv;charset=utf-8');
  };
};

function statutCot(cot) {
  const a = Number(cot.montantAttendu) || 0, p = Number(cot.montantPaye) || 0;
  if (a === 0) return 'impaye';
  if (p >= a) return 'paye'; if (p > 0) return 'partiel'; return 'impaye';
}
function cotBadge(s) { return { paye: '<span class="badge badge-vert">Payé</span>', partiel: '<span class="badge badge-ocre">Partiel</span>', impaye: '<span class="badge badge-terre">Non payé</span>' }[s]; }

async function openCotisationForm(cotId) {
  const cot = await DB.get('cotisations', cotId);
  const eleve = await DB.get('eleves', cot.eleveId);
  openModal(`Cotisation — ${eleve.nom} ${eleve.prenom}`, `
    <div class="form-grid">
      <div class="field"><label>Montant attendu (FCFA)</label><input type="number" id="cf-attendu" value="${cot.montantAttendu || 0}"></div>
      <div class="field"><label>Montant déjà payé (FCFA)</label><input type="number" id="cf-paye" value="${cot.montantPaye || 0}" readonly style="background:var(--sand-100);"></div>
      <div class="field"><label>Nouveau versement (FCFA)</label><input type="number" id="cf-nouveau" value="0"></div>
      <div class="field"><label>Mode de paiement</label><select id="cf-mode"><option>Espèces</option><option>Mobile Money</option><option>Chèque</option><option>Virement</option></select></div>
    </div>
    <p class="text-soft" style="margin-top:8px;">Historique des paiements : ${(cot.paiements || []).length ? (cot.paiements.map((p) => `${formatDate(p.date)} — ${fmtMontant(p.montant)} (${esc(p.mode)})`).join(' · ')) : 'aucun'}</p>`, {
    saveLabel: 'Enregistrer',
    onSave: async () => {
      cot.montantAttendu = Number($('#cf-attendu').value) || 0;
      const nv = Number($('#cf-nouveau').value) || 0;
      if (nv > 0) {
        const recu = 'REC-' + uidCourt();
        cot.montantPaye = (Number(cot.montantPaye) || 0) + nv;
        cot.paiements = [...(cot.paiements || []), { date: todayISO(), montant: nv, mode: $('#cf-mode').value, recu }];
        await DB.put('cotisations', cot);
        toast('Paiement enregistré.');
        onRouteChange();
        imprimerRecu(cot, eleve, nv, recu, $('#cf-mode').value);
      } else {
        await DB.put('cotisations', cot);
        toast('Fiche mise à jour.');
        onRouteChange();
      }
      return true;
    }
  });
}

async function imprimerRecu(cot, eleve, montant, recu, mode) {
  const meta = (await DB.getAll('meta'))[0] || {};
  const classe = await classeById(eleve.classeId);
  const attendu = Number(cot.montantAttendu) || 0;
  const paye = Number(cot.montantPaye) || 0;
  const solde = Math.max(attendu - paye, 0);
  const statut = solde <= 0 && attendu > 0
    ? { label: 'SOLDÉ', cls: 'vert' }
    : (paye > 0 ? { label: 'PAIEMENT PARTIEL', cls: 'ocre' } : { label: 'NON SOLDÉ', cls: 'terre' });

  const win = document.createElement('div');
  win.className = 'modal-overlay';
  win.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="modal-head no-print"><h3>Reçu de paiement</h3></div>
    <div class="modal-body" style="padding:0;">
      <div id="recu-print-area" class="recu-moderne">
        <div class="recu-bandeau">
          ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" alt="" class="recu-logo">` : ''}
          <div class="recu-ecole">${esc(meta.nomEcole || 'École Primaire Publique')}</div>
          <div class="recu-annee">Année scolaire ${esc(meta.anneeScolaire || '—')}</div>
        </div>
        <div class="recu-corps">
          <div class="recu-titre">Reçu de paiement</div>
          <div class="recu-numero">N° ${esc(recu)} · ${formatDate(todayISO())}</div>
          <div class="recu-montant">${fmtMontant(montant)}</div>
          <div class="recu-mode">reçu via ${esc(mode)}</div>

          <div class="recu-sep"></div>
          <table class="recu-table">
            <tr><td>Élève</td><td>${esc(eleve.nom)} ${esc(eleve.prenom)}</td></tr>
            <tr><td>Matricule</td><td>${esc(eleve.matricule || '—')}</td></tr>
            <tr><td>Classe</td><td>${classe ? esc(classe.nom) : '—'}</td></tr>
            <tr><td>Motif</td><td>Cotisation scolaire</td></tr>
          </table>

          <div class="recu-sep"></div>
          <table class="recu-table">
            <tr><td>Total payé à ce jour</td><td>${fmtMontant(paye)}</td></tr>
            <tr><td>Montant attendu</td><td>${fmtMontant(attendu)}</td></tr>
            <tr class="recu-solde"><td>Solde restant</td><td>${fmtMontant(solde)}</td></tr>
          </table>

          <div class="recu-statut recu-statut-${statut.cls}">${statut.label}</div>

          ${(meta.cachetDataUrl || meta.signatureDataUrl || meta.nomDirecteur) ? `
          <div class="recu-signature">
            <div class="recu-signature-imgs">
              ${meta.cachetDataUrl ? `<img src="${meta.cachetDataUrl}" alt="" class="recu-cachet">` : ''}
              ${meta.signatureDataUrl ? `<img src="${meta.signatureDataUrl}" alt="" class="recu-sign">` : ''}
            </div>
            <div class="recu-signature-nom">${esc(meta.nomDirecteur || '')}</div>
          </div>` : ''}
        </div>
        <div class="recu-decoupe"></div>
        <div class="recu-pied">Merci pour votre versement · Reçu généré automatiquement, à conserver</div>
      </div>
    </div>
    <div class="modal-foot no-print">
      <button class="btn modal-cancel">Fermer</button>
      <button class="btn" id="btn-print-recu">Imprimer</button>
      <button class="btn btn-primary" id="btn-pdf-recu">⬇ PDF A4</button>
      <button class="btn" id="btn-word-recu">⬇ Word (.docx)</button>
    </div>
  </div>`;
  document.body.appendChild(win);
  $('.modal-cancel', win).onclick = () => win.remove();
  $('#btn-pdf-recu', win).onclick = () => telechargerPDF($('.modal-body', win), 'Reçu', 'portrait', 340);
  $('#btn-word-recu', win).onclick = () => telechargerWord($('.modal-body', win), 'Reçu', 'portrait', 340);
  $('#btn-print-recu', win).onclick = () => imprimerA4($('.modal-body', win), { orientation: 'portrait', extraCss: '.modal{max-width:340px !important; margin:0 auto !important;}' });
}

/* ================= FOURNITURES ================= */
ROUTES['#/fournitures'] = async (root) => {
  const items = await DB.getAll('fournitures');
  root.innerHTML = `
    <div class="table-toolbar"><input class="search-input" id="fo-search" placeholder="Rechercher un article…"><div style="flex:1;"></div><button class="btn btn-sm" id="fo-pdf">Exporter PDF</button><button class="btn btn-accent" id="fo-add">+ Nouvel article</button></div>
    <div id="fo-table"></div>`;
  let listCourante = items;
  const doRender = () => {
    const q = $('#fo-search').value.toLowerCase();
    const list = items.filter((i) => !q || (i.nom || '').toLowerCase().includes(q));
    listCourante = list;
    $('#fo-table').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Article</th><th>Catégorie</th><th>Stock</th><th>Seuil alerte</th><th>Statut</th><th></th></tr></thead>
      <tbody>${list.map((i) => `<tr>
        <td>${esc(i.nom)}</td><td>${esc(i.categorie || '')}</td><td>${i.quantite ?? 0} ${esc(i.unite || '')}</td><td>${i.seuil ?? 0}</td>
        <td>${Number(i.quantite) <= Number(i.seuil || 0) ? '<span class="badge badge-terre">Stock bas</span>' : '<span class="badge badge-vert">OK</span>'}</td>
        <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" onclick="openMouvementForm('fournitures',${i.id})">Mouvement</button><button class="btn btn-sm" onclick="openArticleForm('fournitures',${i.id})">Modifier</button></div></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">Aucun article. Ajoutez livres, cahiers, craies, ardoises…</div>`;
  };
  doRender(); $('#fo-search').oninput = doRender;
  $('#fo-add').onclick = () => openArticleForm('fournitures', null);
  $('#fo-pdf').onclick = () => {
    const headers = ['Article', 'Catégorie', 'Stock', 'Seuil', 'Statut'];
    const matrix = listCourante.map((i) => [i.nom, i.categorie || '', `${i.quantite ?? 0} ${i.unite || ''}`, i.seuil ?? 0, Number(i.quantite) <= Number(i.seuil || 0) ? 'Stock bas' : 'OK']);
    pdfTable('Fournitures scolaires', headers, matrix);
  };
};

async function openArticleForm(store, id) {
  const row = id ? await DB.get(store, id) : { mouvements: [] };
  const isCantine = store === 'cantine';
  openModal(id ? 'Modifier article' : 'Nouvel article', `<div class="form-grid">
    <div class="field full"><label>${isCantine ? 'Produit' : 'Article'}</label><input id="ar-nom" value="${esc(row.nom || row.produit || '')}"></div>
    ${isCantine ? '' : `<div class="field"><label>Catégorie</label><input id="ar-cat" value="${esc(row.categorie || '')}" placeholder="Livres, cahiers, craies…"></div>`}
    <div class="field"><label>Unité</label><input id="ar-unite" value="${esc(row.unite || (isCantine ? 'kg' : 'unité'))}"></div>
    <div class="field"><label>Stock initial</label><input type="number" id="ar-qte" value="${row.quantite ?? 0}"></div>
    <div class="field"><label>Seuil d'alerte</label><input type="number" id="ar-seuil" value="${row.seuil ?? 0}"></div>
    ${isCantine ? `<div class="field"><label>Date de péremption</label><input type="date" id="ar-perime" value="${row.datePeremption || ''}"></div>` : ''}
  </div>`, {
    onSave: async () => {
      const nom = $('#ar-nom').value.trim();
      if (!nom) { toast('Le nom est obligatoire.'); return false; }
      const obj = { ...row, quantite: Number($('#ar-qte').value) || 0, seuil: Number($('#ar-seuil').value) || 0, unite: $('#ar-unite').value };
      if (isCantine) { obj.produit = nom; obj.datePeremption = $('#ar-perime').value; }
      else { obj.nom = nom; obj.categorie = $('#ar-cat').value; }
      if (id) await DB.put(store, obj); else await DB.add(store, obj);
      toast('Article enregistré.'); onRouteChange(); return true;
    }
  });
}

async function openMouvementForm(store, id) {
  const row = await DB.get(store, id);
  const classes = await classeOptions();
  openModal(`Mouvement de stock — ${row.nom || row.produit}`, `<div class="form-grid">
    <div class="field"><label>Type</label><select id="mv-type"><option value="entree">Entrée</option><option value="sortie">Sortie</option></select></div>
    <div class="field"><label>Quantité</label><input type="number" id="mv-qte" value="1"></div>
    ${store === 'fournitures' ? `<div class="field"><label>Classe (si affectation)</label><select id="mv-classe"><option value="">—</option>${classes.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></div>` : ''}
    <div class="field full"><label>Motif</label><input id="mv-motif" placeholder="Achat, don, distribution…"></div>
  </div><p class="text-soft" style="margin-top:8px;">Stock actuel : ${row.quantite ?? 0} ${esc(row.unite || '')}</p>`, {
    onSave: async () => {
      const type = $('#mv-type').value, qte = Number($('#mv-qte').value) || 0;
      row.quantite = (Number(row.quantite) || 0) + (type === 'entree' ? qte : -qte);
      row.mouvements = [...(row.mouvements || []), { date: todayISO(), type, quantite: qte, classeId: $('#mv-classe') ? $('#mv-classe').value : null, motif: $('#mv-motif').value }];
      await DB.put(store, row);
      toast('Mouvement enregistré.'); onRouteChange(); return true;
    }
  });
}

/* ================= CANTINE ================= */
ROUTES['#/cantine'] = async (root) => {
  root.innerHTML = `<div class="tabs" id="ca-tabs"><button class="tab active" data-tab="stock">Stock des vivres</button><button class="tab" data-tab="rations">Rations du jour</button><button class="tab" data-tab="repas">Repas servis</button></div><div id="ca-content"></div>`;
  const show = (t) => { $all('.tab', $('#ca-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t)); t === 'stock' ? renderCantineStock($('#ca-content')) : t === 'rations' ? renderCantineRations($('#ca-content')) : renderRepas($('#ca-content')); };
  $('#ca-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); };
  show('stock');
};

async function renderCantineStock(root) {
  const items = await DB.getAll('cantine');
  root.innerHTML = `<div class="table-toolbar" style="flex-wrap:wrap;"><div style="flex:1;"></div>
    <button class="btn btn-sm" id="ct-bilan-jour">Bilan journalier</button>
    <button class="btn btn-sm" id="ct-bilan-mois">Bilan mensuel</button>
    <button class="btn btn-sm" id="ct-bilan-annee">Bilan annuel</button>
    <button class="btn btn-sm" id="ct-pdf">Exporter PDF</button>
    <button class="btn btn-accent" id="ct-add">+ Nouveau produit</button></div>
    <div class="table-wrap"><table><thead><tr><th>Produit</th><th>Stock</th><th>Seuil</th><th>Péremption</th><th>Statut</th><th></th></tr></thead>
    <tbody>${items.length ? items.map((i) => {
      const bas = Number(i.quantite) <= Number(i.seuil || 0);
      const perimeSoon = i.datePeremption && new Date(i.datePeremption).getTime() <= Date.now() + 14 * 86400000;
      return `<tr><td>${esc(i.produit)}</td><td>${i.quantite ?? 0} ${esc(i.unite || '')}</td><td>${i.seuil ?? 0}</td><td>${formatDate(i.datePeremption)}</td>
        <td>${bas ? '<span class="badge badge-terre">Stock bas</span>' : ''} ${perimeSoon ? '<span class="badge badge-ocre">Péremption proche</span>' : ''} ${!bas && !perimeSoon ? '<span class="badge badge-vert">OK</span>' : ''}</td>
        <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" onclick="openMouvementForm('cantine',${i.id})">Mouvement</button><button class="btn btn-sm" onclick="openArticleForm('cantine',${i.id})">Modifier</button></div></td></tr>`;
    }).join('') : `<tr><td colspan="6" class="text-soft">Aucun produit enregistré.</td></tr>`}</tbody></table></div>`;
  $('#ct-add').onclick = () => openArticleForm('cantine', null);
  $('#ct-bilan-jour').onclick = () => openModal('Bilan journalier des vivres', `
    <div class="field"><label>Date</label><input type="date" id="bj-date" value="${todayISO()}"></div>`, {
    saveLabel: 'Générer le bilan',
    onSave: async () => { await imprimerBilanCantine('jour', $('#bj-date').value); return true; }
  });
  $('#ct-bilan-mois').onclick = () => openModal('Bilan mensuel des vivres', `
    <div class="field"><label>Mois</label><input type="month" id="bm-mois" value="${todayISO().slice(0, 7)}"></div>`, {
    saveLabel: 'Générer le bilan',
    onSave: async () => { await imprimerBilanCantine('mois', $('#bm-mois').value); return true; }
  });
  $('#ct-bilan-annee').onclick = () => openModal('Bilan annuel des vivres', `
    <div class="field"><label>Année</label><input type="number" id="ba-annee" value="${new Date().getFullYear()}" min="2000" max="2100"></div>`, {
    saveLabel: 'Générer le bilan',
    onSave: async () => { await imprimerBilanCantine('annee', String($('#ba-annee').value)); return true; }
  });
  $('#ct-pdf').onclick = () => {
    const headers = ['Produit', 'Stock', 'Seuil', 'Péremption', 'Statut'];
    const matrix = items.map((i) => {
      const bas = Number(i.quantite) <= Number(i.seuil || 0);
      const perimeSoon = i.datePeremption && new Date(i.datePeremption).getTime() <= Date.now() + 14 * 86400000;
      return [i.produit, `${i.quantite ?? 0} ${i.unite || ''}`, i.seuil ?? 0, formatDate(i.datePeremption), bas ? 'Stock bas' : perimeSoon ? 'Péremption proche' : 'OK'];
    });
    pdfTable('Stock des vivres — cantine', headers, matrix);
  };
}

/* --------- Bilans des entrées/sorties de vivres (journalier / mensuel / annuel) ---------
   Chaque mouvement de stock (voir openMouvementForm) porte une date ('YYYY-MM-DD').
   On filtre ces mouvements selon la période choisie, produit par produit, pour obtenir
   entrées, sorties et solde de la période — le document est imprimé via printDocument,
   qui affiche automatiquement le logo, le cachet et la signature du directeur. */
function moisLabelFr(ym) {
  const noms = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const [y, m] = (ym || '').split('-').map(Number);
  return noms[(m || 1) - 1] ? `${noms[m - 1]} ${y}` : ym;
}

function mouvementsDansPeriode(mouvements, periode, ref) {
  return (mouvements || []).filter((m) => {
    if (!m.date || !ref) return false;
    if (periode === 'jour') return m.date === ref;
    if (periode === 'mois') return m.date.slice(0, 7) === ref;
    if (periode === 'annee') return m.date.slice(0, 4) === ref;
    return false;
  });
}

async function imprimerBilanCantine(periode, ref) {
  if (!ref) { toast('Choisissez une période.'); return; }
  const items = (await DB.getAll('cantine')).sort((a, b) => (a.produit || '').localeCompare(b.produit || ''));
  const lignes = items.map((i) => {
    const mvts = mouvementsDansPeriode(i.mouvements, periode, ref);
    const entrees = mvts.filter((m) => m.type === 'entree').reduce((s, m) => s + (Number(m.quantite) || 0), 0);
    const sorties = mvts.filter((m) => m.type === 'sortie').reduce((s, m) => s + (Number(m.quantite) || 0), 0);
    return { produit: i.produit, unite: i.unite || '', entrees, sorties, solde: entrees - sorties, stockActuel: i.quantite ?? 0, nbMouvements: mvts.length };
  });
  const totalMouvements = lignes.reduce((s, l) => s + l.nbMouvements, 0);
  const libellePeriode = periode === 'jour' ? `Journée du ${formatDate(ref)}`
    : periode === 'mois' ? `Mois de ${moisLabelFr(ref)}`
    : `Année ${ref}`;
  const titrePeriode = periode === 'jour' ? 'Bilan journalier' : periode === 'mois' ? 'Bilan mensuel' : 'Bilan annuel';

  printDocument(`${titrePeriode} des vivres — ${libellePeriode}`, `
    <h3 style="text-align:center;">${titrePeriode.toUpperCase()} DES ENTRÉES ET SORTIES DE VIVRES</h3>
    <p style="text-align:center;">${esc(libellePeriode)}</p>
    <table style="width:100%; border-collapse:collapse;" border="1" cellpadding="6">
      <thead><tr><th>Vivre</th><th>Entrées</th><th>Sorties</th><th>Solde de la période</th><th>Stock actuel</th></tr></thead>
      <tbody>${lignes.length ? lignes.map((l) => `<tr>
        <td>${esc(l.produit)}</td>
        <td>${l.entrees} ${esc(l.unite)}</td>
        <td>${l.sorties} ${esc(l.unite)}</td>
        <td>${l.solde > 0 ? '+' : ''}${l.solde} ${esc(l.unite)}</td>
        <td>${l.stockActuel} ${esc(l.unite)}</td>
      </tr>`).join('') : `<tr><td colspan="5">Aucun produit enregistré</td></tr>`}</tbody>
    </table>
    <p style="margin-top:14px;"><strong>Nombre total de mouvements enregistrés sur la période :</strong> ${totalMouvements}</p>
  `);
}

async function renderRepas(root) {
  const repas = (await DB.getAll('repas')).sort((a, b) => b.date.localeCompare(a.date));
  root.innerHTML = `<div class="table-toolbar"><div style="flex:1;"></div><button class="btn btn-sm" id="rp-pdf">Exporter PDF</button><button class="btn btn-accent" id="rp-add">+ Enregistrer un repas</button></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Élèves servis</th><th>Observations</th><th></th></tr></thead>
    <tbody>${repas.length ? repas.map((r) => `<tr><td>${formatDate(r.date)}</td><td>${r.nbServis}</td><td class="wrap">${esc(r.observations || '')}</td>
      <td class="no-print"><button class="btn btn-sm btn-danger" onclick="deleteRow('repas',${r.id})">Suppr.</button></td></tr>`).join('') : `<tr><td colspan="4" class="text-soft">Aucun repas enregistré.</td></tr>`}</tbody></table></div>`;
  $('#rp-pdf').onclick = () => {
    const headers = ['Date', 'Élèves servis', 'Observations'];
    const matrix = repas.map((r) => [formatDate(r.date), r.nbServis, r.observations || '']);
    pdfTable('Repas servis — cantine', headers, matrix);
  };
  $('#rp-add').onclick = () => openModal('Enregistrer un repas', `<div class="form-grid">
    <div class="field"><label>Date</label><input type="date" id="rp-date" value="${todayISO()}"></div>
    <div class="field"><label>Nombre d'élèves servis</label><input type="number" id="rp-nb" value="0"></div>
    <div class="field full"><label>Observations</label><textarea id="rp-obs"></textarea></div>
  </div>`, { onSave: async () => { await DB.add('repas', { date: $('#rp-date').value, nbServis: Number($('#rp-nb').value) || 0, observations: $('#rp-obs').value }); toast('Repas enregistré.'); onRouteChange(); return true; } });
}

async function deleteRow(store, id) { if (await confirmDialog('Supprimer cet enregistrement ?')) { await DB.delete(store, id); toast('Supprimé.'); onRouteChange(); } }

/* ================= FINANCES ================= */
ROUTES['#/finances'] = async (root) => {
  const [rows, cotisations] = await Promise.all([DB.getAll('finances'), DB.getAll('cotisations')]);
  // Les cotisations sont une recette : elles sont comptées automatiquement à partir du
  // module Cotisations (source unique), pas ressaisies ici, pour éviter tout doublon.
  const totalCotisations = cotisations.reduce((s, c) => s + (Number(c.montantPaye) || 0), 0);
  const autresRecettes = rows.filter((r) => ['don', 'subvention'].includes(r.type)).reduce((s, r) => s + (Number(r.montant) || 0), 0);
  const recettes = totalCotisations + autresRecettes;
  const depenses = rows.filter((r) => ['depense', 'reparation', 'achat'].includes(r.type)).reduce((s, r) => s + (Number(r.montant) || 0), 0);
  root.innerHTML = `<div class="grid grid-3">
    <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Recettes</div><div class="value" style="font-size:19px;">${fmtMontant(recettes)}</div><div class="foot">dont ${fmtMontant(totalCotisations)} de cotisations · ${fmtMontant(autresRecettes)} dons/subventions</div></div>
    <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Dépenses</div><div class="value" style="font-size:19px;">${fmtMontant(depenses)}</div></div>
    <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Solde</div><div class="value" style="font-size:19px;">${fmtMontant(recettes - depenses)}</div></div>
  </div>
  <p class="text-soft" style="margin-top:10px;">Les cotisations scolaires sont comptabilisées automatiquement comme recette dès leur encaissement dans le module <a href="#/cotisations">Cotisations</a> — inutile de les ressaisir ci-dessous.</p>
  <div style="margin-top:10px;" id="fin-crud"></div>`;
  renderCrudView($('#fin-crud'), {
    store: 'finances', title: 'Autres mouvements financiers',
    subtitle: "Dons, subventions, dépenses, réparations, achats. Les cotisations sont gérées dans le module Cotisations.",
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'type', label: 'Type', type: 'select', required: true, options: [
        { value: 'depense', label: 'Dépense' }, { value: 'don', label: 'Don' },
        { value: 'subvention', label: 'Subvention' }, { value: 'reparation', label: 'Réparation' }, { value: 'achat', label: 'Achat' }
      ]},
      { key: 'montant', label: 'Montant (FCFA)', type: 'number', required: true },
      { key: 'motif', label: 'Motif / description', type: 'text', full: true }
    ],
    columns: [
      { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
      { key: 'type', label: 'Type' }, { key: 'montant', label: 'Montant', render: (r) => fmtMontant(r.montant) }, { key: 'motif', label: 'Motif' }
    ]
  });
};

/* ================= DISCIPLINE ================= */
ROUTES['#/discipline'] = async (root) => {
  const estEnseignant = currentUser && currentUser.classeIds;
  root.innerHTML = estEnseignant
    ? `<div id="di-content"></div>`
    : `<div class="tabs" id="di-tabs"><button class="tab active" data-tab="eleve">Élèves</button><button class="tab" data-tab="enseignant">Enseignants</button></div><div id="di-content"></div>`;
  const show = (t) => { if (!estEnseignant) $all('.tab', $('#di-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t)); renderDisciplineTab($('#di-content'), t); };
  if (!estEnseignant) $('#di-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); };
  show('eleve');
};

async function renderDisciplineTab(root, cibleType) {
  const mesEleveIds = cibleType === 'eleve' && currentUser && currentUser.classeIds
    ? new Set(filtrerParClasseVisible(await DB.getAll('eleves')).map((e) => e.id))
    : null;
  const optionsFn = cibleType === 'eleve'
    ? async () => filtrerParClasseVisible(await DB.getAll('eleves')).map((e) => ({ value: e.id, label: `${e.nom} ${e.prenom}` }))
    : async () => (await DB.getAll('enseignants')).map((e) => ({ value: e.id, label: `${e.nom} ${e.prenom}` }));
  const names = Object.fromEntries((await DB.getAll(cibleType === 'eleve' ? 'eleves' : 'enseignants')).map((e) => [e.id, `${e.nom} ${e.prenom}`]));
  renderCrudView(root, {
    store: 'discipline', title: cibleType === 'eleve' ? 'Discipline — élèves' : 'Discipline — enseignants',
    filterFn: (r) => r.cibleType === cibleType && (!mesEleveIds || mesEleveIds.has(Number(r.cibleId))),
    fixedValues: { cibleType },
    fields: [
      { key: 'cibleType', label: '', type: 'text', fixed: true },
      { key: 'cibleId', label: cibleType === 'eleve' ? 'Élève' : 'Enseignant', type: 'select', optionsFn, required: true },
      { key: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'avertissement', label: 'Avertissement' }, { value: 'sanction', label: 'Sanction' }, { value: 'recompense', label: 'Récompense' }] },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'motif', label: 'Motif', type: 'text', full: true },
      { key: 'decision', label: 'Décision / mesure prise', type: 'textarea', full: true }
    ],
    columns: [
      { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
      { key: 'cibleId', label: cibleType === 'eleve' ? 'Élève' : 'Enseignant', render: (r) => esc(names[r.cibleId] || '—') },
      { key: 'type', label: 'Type', render: (r) => disciplineBadge(r.type) },
      { key: 'motif', label: 'Motif' }
    ]
  });
}
