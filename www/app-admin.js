/* ============================================================
   app-admin.js — COGES, Visites, Réunions, Bibliothèque, Calendrier,
                  Rapports, Utilisateurs, Paramètres
   ============================================================ */

/* ---------------- COGES ---------------- */
ROUTES['#/coges'] = (root) => renderCrudView(root, {
  store: 'coges', title: 'COGES — Comité de Gestion des Établissements Scolaires',
  subtitle: 'Membres du COGES et leurs fonctions.',
  fields: [
    { key: 'nom', label: 'Nom & prénom', type: 'text', required: true },
    { key: 'fonction', label: 'Fonction', type: 'text', placeholder: 'Président, trésorier, secrétaire, membre…' },
    { key: 'telephone', label: 'Téléphone', type: 'text' },
    { key: 'village', label: 'Village / secteur', type: 'text' }
  ],
  columns: [{ key: 'nom', label: 'Nom' }, { key: 'fonction', label: 'Fonction' }, { key: 'telephone', label: 'Téléphone' }, { key: 'village', label: 'Village / secteur' }]
});

/* ---------------- Visites d'encadrement ---------------- */
ROUTES['#/visites'] = (root) => renderCrudView(root, {
  store: 'visites', title: "Visites d'encadrement pédagogique",
  subtitle: 'Visites de la CCEB, IEP et autres structures d\'encadrement.',
  fields: [
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'type', label: "Type de visite", type: 'select', options: [{ value: 'CCEB', label: 'CCEB' }, { value: 'IEP', label: 'IEP' }, { value: 'autre', label: 'Autre' }] },
    { key: 'inspecteur', label: "Nom de l'encadreur", type: 'text' },
    { key: 'observations', label: 'Observations', type: 'textarea', full: true },
    { key: 'recommandations', label: 'Recommandations', type: 'textarea', full: true }
  ],
  columns: [{ key: 'date', label: 'Date', render: (r) => formatDate(r.date) }, { key: 'type', label: 'Type' }, { key: 'inspecteur', label: 'Encadreur' }, { key: 'recommandations', label: 'Recommandations' }]
});

/* ---------------- Réunions & décisions ---------------- */
ROUTES['#/reunions'] = (root) => renderCrudView(root, {
  store: 'reunions', title: 'Réunions & décisions',
  subtitle: 'Conseils des maîtres et réunions avec les parents d\'élèves.',
  fields: [
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'type', label: 'Type', type: 'select', options: [{ value: 'conseil des maitres', label: 'Conseil des maîtres' }, { value: 'parents', label: 'Réunion parents' }] },
    { key: 'sujet', label: 'Sujet', type: 'text', full: true, required: true },
    { key: 'presents', label: 'Présents', type: 'text', full: true },
    { key: 'decisions', label: 'Décisions / procès-verbal', type: 'textarea', full: true }
  ],
  columns: [
    { key: 'date', label: 'Date', render: (r) => formatDate(r.date) }, { key: 'type', label: 'Type' }, { key: 'sujet', label: 'Sujet' },
    { key: 'print', label: '', render: (r) => `<button class="btn btn-sm" onclick="event.stopPropagation(); imprimerPV(${r.id})">PV imprimable</button>` }
  ]
});

async function imprimerPV(id) {
  const r = await DB.get('reunions', id);
  printDocument('Procès-verbal de réunion', `
    <h3 style="text-align:center;">PROCÈS-VERBAL DE RÉUNION</h3>
    <p><strong>Date :</strong> ${formatDate(r.date)} &nbsp; <strong>Type :</strong> ${esc(r.type || '')}</p>
    <p><strong>Sujet :</strong> ${esc(r.sujet)}</p>
    <p><strong>Présents :</strong> ${esc(r.presents || '')}</p>
    <p><strong>Décisions :</strong><br>${esc(r.decisions || '').replace(/\n/g, '<br>')}</p>`);
}

/* ---------------- Bibliothèque numérique ---------------- */
ROUTES['#/documents'] = (root) => renderCrudView(root, {
  store: 'documents', title: 'Bibliothèque numérique', searchKeys: ['nom', 'categorie', 'notes'],
  subtitle: 'Fiches pédagogiques, guides, progressions, circulaires, rapports, documents administratifs.',
  fields: [
    { key: 'nom', label: 'Titre du document', type: 'text', required: true, full: true },
    { key: 'categorie', label: 'Catégorie', type: 'select', options: [
      { value: 'Fiche pédagogique', label: 'Fiche pédagogique' }, { value: 'Guide pédagogique', label: 'Guide pédagogique' },
      { value: 'Progression harmonisée', label: 'Progression harmonisée' }, { value: 'Emploi du temps', label: 'Emploi du temps' },
      { value: 'Rapport', label: 'Rapport' }, { value: 'Circulaire', label: 'Circulaire' }, { value: 'Document administratif', label: 'Document administratif' }, { value: 'Autre', label: 'Autre' }
    ]},
    { key: 'dateAjout', label: "Date d'ajout", type: 'date' },
    { key: 'fichiers', label: 'Documents et photos à téléverser', type: 'files', full: true,
      accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv' },
    { key: 'notes', label: 'Description / notes', type: 'textarea', full: true }
  ],
  columns: [
    { key: 'nom', label: 'Titre' }, { key: 'categorie', label: 'Catégorie' },
    { key: 'fichiers', label: 'Fichiers', render: (r) => (r.fichiers || []).map((f, i) => `<div class="flex gap-8 items-center" style="margin:3px 0;">
        ${f.type && f.type.startsWith('image/') ? `<img src="${f.dataUrl}" alt="" onclick="documentOuvrir(${r.id}, ${i})" style="width:42px;height:42px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;">` : '<span>📄</span>'}
        <a href="javascript:void(0)" onclick="documentOuvrir(${r.id}, ${i})" style="font-weight:600;">${esc(f.name)}</a>
        <button type="button" class="btn btn-sm no-print" onclick="documentTelecharger(${r.id}, ${i})" title="Télécharger">⬇</button>
      </div>`).join('') || '—' },
    { key: 'dateAjout', label: 'Ajouté le', render: (r) => formatDate(r.dateAjout) }
  ]
});

/* Ouverture / téléchargement des fichiers de la bibliothèque */
async function documentOuvrir(id, index) {
  const doc = await DB.get('documents', id);
  const f = doc && (doc.fichiers || [])[index];
  if (!f) return;
  if (f.type && f.type.startsWith('image/')) {
    const ov = openModal(f.name, `<div style="text-align:center;"><img src="${f.dataUrl}" alt="" style="max-width:100%;max-height:70vh;border-radius:8px;"></div>
      <div style="text-align:center;margin-top:12px;"><button type="button" class="btn btn-primary" id="doc-dl">⬇ Télécharger</button></div>`, { wide: true, hideSave: true });
    $('#doc-dl', ov).onclick = () => telechargerFichier(f);
  } else if (f.type === 'application/pdf') {
    window.open(URL.createObjectURL(dataUrlToBlob(f.dataUrl)), '_blank');
  } else {
    telechargerFichier(f);
  }
}
async function documentTelecharger(id, index) {
  const doc = await DB.get('documents', id);
  const f = doc && (doc.fichiers || [])[index];
  if (f) telechargerFichier(f);
}

/* ---------------- Calendrier scolaire ---------------- */
ROUTES['#/calendrier'] = (root) => renderCrudView(root, {
  store: 'activites', title: 'Calendrier scolaire',
  subtitle: 'Rentrée, vacances, compositions, CEP, réunions, journées pédagogiques, activités culturelles, formations.',
  fields: [
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'titre', label: "Intitulé de l'activité", type: 'text', required: true, full: true },
    { key: 'categorie', label: 'Catégorie', type: 'select', options: [
      { value: 'Rentrée', label: 'Rentrée scolaire' }, { value: 'Vacances', label: 'Vacances' }, { value: 'Composition', label: 'Composition' },
      { value: 'CEP', label: 'CEP' }, { value: 'Réunion', label: 'Réunion' }, { value: 'Journée pédagogique', label: 'Journée pédagogique' },
      { value: 'Activité culturelle', label: 'Activité culturelle' }, { value: 'Visite', label: "Visite d'encadrement" }, { value: 'Formation', label: 'Formation' }
    ]},
    { key: 'description', label: 'Description', type: 'textarea', full: true }
  ],
  columns: [{ key: 'date', label: 'Date', render: (r) => formatDate(r.date) }, { key: 'titre', label: 'Activité' }, { key: 'categorie', label: 'Catégorie' }]
});

/* ---------------- Comptes de connexion (Supabase Auth) ----------------
   Les comptes de connexion se créent désormais directement dans l'appli
   (voir openCreerCompte ci-dessous), sans passer par le tableau de bord
   Supabase — sauf le tout premier compte (le directeur), qui doit encore
   être créé manuellement une fois (voir guide-comptes-supabase.md), car il
   n'existe personne d'habilité avant lui pour le créer depuis l'appli. */
ROUTES['#/utilisateurs'] = async (root) => {
  root.innerHTML = `
    <div class="card">
      <div class="flex justify-between items-center">
        <h3 style="margin:0;">Comptes du personnel</h3>
        <button class="btn btn-primary btn-sm" id="compte-creer">+ Créer un compte</button>
      </div>
      <p class="text-soft">
        Le tout premier compte (directeur) est créé une seule fois dans Supabase
        (voir le guide fourni). Tous les autres comptes se créent ici.
      </p>
      <div id="compte-liste"><p class="text-soft">Chargement…</p></div>
    </div>`;

  $('#compte-creer').onclick = () => openCreerCompte();

  const { data, error } = await window.supaClient.from('profiles').select('id, nom, role').order('nom');
  const box = $('#compte-liste');
  if (error) { box.innerHTML = `<p class="text-soft">Impossible de charger la liste.</p>`; return; }
  if (!data.length) { box.innerHTML = `<p class="text-soft">Aucun compte pour le moment.</p>`; return; }
  const enseignants = await DB.getAll('enseignants');
  const dossierByProfileId = Object.fromEntries(enseignants.filter((e) => e.profileId).map((e) => [e.profileId, e]));
  box.innerHTML = `<table class="table"><thead><tr><th>Nom</th><th>Rôle</th><th>Dossier enseignant lié</th></tr></thead><tbody>
    ${data.map((p) => {
    const ens = dossierByProfileId[p.id];
    return `<tr><td>${esc(p.nom)}</td><td>${esc(labelRole(p.role))}</td><td>${ens ? `<a href="#/enseignants?id=${ens.id}">${esc(ens.nom)} ${esc(ens.prenom)}</a>` : '—'}</td></tr>`;
  }).join('')}
  </tbody></table>`;
};

const ROLES_PERSONNEL = [
  { value: 'directeur_adjoint', label: 'Directeur adjoint' },
  { value: 'secretaire', label: 'Secrétaire' },
  { value: 'comptable', label: 'Comptable' },
  { value: 'magasinier', label: 'Magasinier' },
  { value: 'cantine', label: 'Responsable cantine' },
  { value: 'enseignant', label: 'Enseignant' }
];

function genererMotDePasse() {
  // 8 caractères faciles à lire/dicter à l'oral (pas de 0/O ni 1/I/l ambigus).
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let mdp = '';
  for (let i = 0; i < 8; i++) mdp += alphabet[Math.floor(Math.random() * alphabet.length)];
  return mdp;
}

/* Création d'un compte de connexion + profil, sans jamais passer par le
   tableau de bord Supabase, et SANS déconnecter le directeur actuellement
   connecté : on utilise un second client Supabase, isolé, qui ne touche pas
   à la session en cours (persistSession: false). */
async function openCreerCompte() {
  const motDePasseInitial = genererMotDePasse();
  const enseignants = (await DB.getAll('enseignants')).sort((a, b) => (a.nom || '').localeCompare(b.nom));
  const overlay = openModal('Créer un compte', `
    <div class="form-grid">
      <div class="field"><label>Rôle *</label>
        <select id="cc-role">${ROLES_PERSONNEL.map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join('')}</select>
      </div>
      <div class="field" id="cc-lien-wrap" style="display:none;">
        <label>Lier à un enseignant déjà enregistré</label>
        <select id="cc-lien">
          <option value="">— Nouvelle personne (pas dans le dossier enseignants) —</option>
          ${enseignants.map((e) => `<option value="${e.id}">${esc(e.nom)} ${esc(e.prenom)}${e.email ? ' — ' + esc(e.email) : ''}</option>`).join('')}
        </select>
        <p class="text-soft" style="font-size:12px;">Choisir un nom ici remplit automatiquement les champs ci-dessous à partir de son dossier, et relie son compte à ce dossier.</p>
      </div>
      <div class="field"><label>Nom & prénom *</label><input id="cc-nom" placeholder="Ex : M. Ouédraogo"></div>
      <div class="field full"><label>E-mail de connexion *</label><input id="cc-email" type="email" placeholder="Ex : ouedraogo@ecole.bf"></div>
      <div class="field full">
        <label>Mot de passe initial</label>
        <input id="cc-mdp" value="${motDePasseInitial}">
        <p class="text-soft" style="font-size:12px;">Généré automatiquement — vous pouvez le remplacer. Notez-le : il faudra le communiquer à la personne.</p>
      </div>
    </div>
  `, {
    saveLabel: 'Créer le compte',
    onSave: async (overlay) => {
      const nom = $('#cc-nom', overlay).value.trim();
      const role = $('#cc-role', overlay).value;
      const email = $('#cc-email', overlay).value.trim();
      const mdp = $('#cc-mdp', overlay).value;
      const enseignantId = $('#cc-lien', overlay) ? Number($('#cc-lien', overlay).value) || null : null;
      if (!nom || !email || !mdp) { toast('Nom, e-mail et mot de passe sont obligatoires.'); return false; }
      if (mdp.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères.'); return false; }

      let tempClient;
      try {
        tempClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      } catch (e) {
        toast("Impossible d'initialiser la création de compte.");
        return false;
      }

      const { data, error } = await tempClient.auth.signUp({ email, password: mdp });
      if (error) {
        toast("Création du compte impossible : " + (error.message || 'erreur inconnue') + ". Vérifiez que la confirmation par e-mail est désactivée dans Supabase (voir le guide).");
        return false;
      }
      if (!data.user) {
        toast("Le compte n'a pas pu être créé (réponse inattendue du serveur).");
        return false;
      }

      // Le personnel créé hérite du rattachement de l'école (CEB, province, région), s'il est renseigné
      const profilNouveau = { id: data.user.id, nom, role };
      if (currentUser.ecole_id) profilNouveau.ecole_id = currentUser.ecole_id;
      if (currentUser.ceb && currentUser.province && currentUser.region) {
        Object.assign(profilNouveau, { structure: currentUser.structure || null, region: currentUser.region, province: currentUser.province, ceb: currentUser.ceb });
      }
      const { error: errProfil } = await window.supaClient.from('profiles').insert(profilNouveau);
      if (errProfil) {
        toast("Le compte de connexion a été créé, mais le profil n'a pas pu être enregistré : " + (errProfil.message || '') + ". Réessayez depuis Supabase directement pour ce cas.");
        return false;
      }

      // Relie le dossier enseignant existant à ce nouveau compte, pour
      // retrouver facilement qui a déjà un compte de connexion.
      if (enseignantId) {
        const ens = await DB.get('enseignants', enseignantId);
        if (ens) { ens.profileId = data.user.id; await DB.put('enseignants', ens); }
      }

      // On affiche le résultat dans CE modal (plutôt que d'en ouvrir un
      // second) : openModal() ferme tout modal déjà ouvert, ce qui aurait
      // fermé aussitôt un second modal empilé ici.
      overlay.querySelector('.modal-head h3').textContent = 'Compte créé';
      overlay.querySelector('.modal-body').innerHTML = `
        <p>Le compte de <strong>${esc(nom)}</strong> a été créé.</p>
        <p>Communiquez-lui ces identifiants pour sa première connexion :</p>
        <div class="card" style="background:var(--bg-soft,#f6f6f6);">
          <p style="margin:4px 0;"><strong>E-mail :</strong> ${esc(email)}</p>
          <p style="margin:4px 0;"><strong>Mot de passe :</strong> ${esc(mdp)}</p>
        </div>
        <p class="text-soft">Elle pourra le modifier une fois connectée.</p>`;
      const foot = overlay.querySelector('.modal-foot');
      foot.innerHTML = `<button class="btn btn-primary" id="cc-fermer">Fermer</button>`;
      $('#cc-fermer', overlay).addEventListener('click', () => closeModal());

      onRouteChange();
      return false; // on garde ce modal ouvert : c'est nous qui le fermons.
    }
  });
  const roleSelect = $('#cc-role', overlay);
  const lienWrap = $('#cc-lien-wrap', overlay);
  const lienSelect = $('#cc-lien', overlay);
  const majAffichageLien = () => { lienWrap.style.display = roleSelect.value === 'enseignant' ? '' : 'none'; };
  majAffichageLien();
  roleSelect.addEventListener('change', majAffichageLien);
  lienSelect.addEventListener('change', () => {
    const ens = enseignants.find((e) => String(e.id) === lienSelect.value);
    if (ens) {
      $('#cc-nom', overlay).value = `${ens.nom} ${ens.prenom || ''}`.trim();
      if (ens.email) $('#cc-email', overlay).value = ens.email;
    }
  });
}

/* ---------------- Rapports automatiques ---------------- */
ROUTES['#/rapports'] = async (root) => {
  root.innerHTML = `
    <div class="card">
      <h3>Générer un rapport</h3>
      <div class="form-grid">
        <div class="field"><label>Période</label><select id="rp-periode"><option value="jour">Journalier</option><option value="mois">Mensuel</option><option value="trimestre">Trimestriel</option><option value="annee">Annuel</option></select></div>
        <div class="field"><label>Date de référence</label><input type="date" id="rp-date" value="${todayISO()}"></div>
      </div>
      <button class="btn btn-primary" id="rp-generer" style="margin-top:12px;">Générer le rapport</button>
    </div>
    <div id="rp-result" style="margin-top:18px;"></div>`;
  $('#rp-generer').onclick = () => genererRapport($('#rp-periode').value, $('#rp-date').value);
};

function periodeBounds(periode, dateRef) {
  const d = new Date(dateRef);
  let start, end;
  if (periode === 'jour') { start = new Date(d); end = new Date(d); }
  else if (periode === 'mois') { start = new Date(d.getFullYear(), d.getMonth(), 1); end = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  else if (periode === 'trimestre') { const q = Math.floor(d.getMonth() / 3); start = new Date(d.getFullYear(), q * 3, 1); end = new Date(d.getFullYear(), q * 3 + 3, 0); }
  else { start = new Date(d.getFullYear(), 0, 1); end = new Date(d.getFullYear(), 11, 31); }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function genererRapport(periode, dateRef) {
  const { start, end } = periodeBounds(periode, dateRef);
  const [eleves, presences, evaluations, cotisations, fournitures, cantine, enseignants, activites] = await Promise.all([
    DB.getAll('eleves'), DB.getAll('presencesEleves'), DB.getAll('evaluations'), DB.getAll('cotisations'),
    DB.getAll('fournitures'), DB.getAll('cantine'), DB.getAll('enseignants'), DB.getAll('activites')
  ]);
  const presPeriode = presences.filter((p) => p.date >= start && p.date <= end);
  const tauxPresence = presPeriode.length ? Math.round((presPeriode.filter((p) => p.statut === 'present').length / presPeriode.length) * 100) : null;
  const evalsPeriode = evaluations.filter((e) => e.date >= start && e.date <= end);
  let som = 0, n = 0;
  evalsPeriode.forEach((ev) => (ev.notes || []).forEach((no) => { const v = noteSur20(ev, no); if (v !== null) { som += v; n++; } }));
  const moyenne = n ? (som / n).toFixed(1) : '—';
  const totalAttendu = cotisations.reduce((s, c) => s + (Number(c.montantAttendu) || 0), 0);
  const totalPaye = cotisations.reduce((s, c) => s + (Number(c.montantPaye) || 0), 0);
  const activitesPeriode = activites.filter((a) => a.date >= start && a.date <= end);

  const html = `
    <h3 style="text-align:center;">RAPPORT ${periode.toUpperCase()} — DU ${formatDate(start)} AU ${formatDate(end)}</h3>
    <table style="width:100%;" border="1" cellpadding="6">
      <tr><td>Élèves inscrits (actifs)</td><td>${eleves.filter((e) => (e.statut || 'actif') === 'actif').length}</td></tr>
      <tr><td>Enseignants</td><td>${enseignants.length}</td></tr>
      <tr><td>Taux de présence de la période</td><td>${tauxPresence === null ? 'Non renseigné' : tauxPresence + '%'}</td></tr>
      <tr><td>Moyenne générale des évaluations de la période</td><td>${moyenne}${moyenne !== '—' ? '/' + MOYENNE_BASE : ''}</td></tr>
      <tr><td>Cotisations encaissées (cumul)</td><td>${fmtMontant(totalPaye)} / ${fmtMontant(totalAttendu)} attendus</td></tr>
      <tr><td>Articles en alerte de stock (fournitures)</td><td>${fournitures.filter((f) => Number(f.quantite) <= Number(f.seuil || 0)).length}</td></tr>
      <tr><td>Produits cantine en alerte</td><td>${cantine.filter((c) => Number(c.quantite) <= Number(c.seuil || 0)).length}</td></tr>
      <tr><td>Activités réalisées sur la période</td><td>${activitesPeriode.map((a) => esc(a.titre)).join(', ') || 'Aucune'}</td></tr>
    </table>`;
  $('#rp-result').innerHTML = `<div class="card">${html}
    <div class="flex gap-8 no-print" style="margin-top:12px;">
      <button class="btn btn-primary" id="rp-print">Imprimer / PDF</button>
      <button class="btn" id="rp-csv">Exporter en Excel (CSV)</button>
    </div></div>`;
  $('#rp-print').onclick = () => printDocument(`Rapport ${periode}`, html);
  $('#rp-csv').onclick = () => {
    const rows = [
      { label: 'Élèves actifs', value: eleves.filter((e) => (e.statut || 'actif') === 'actif').length },
      { label: 'Enseignants', value: enseignants.length },
      { label: 'Taux de présence (%)', value: tauxPresence ?? '' },
      { label: 'Moyenne générale', value: moyenne },
      { label: 'Cotisations encaissées', value: totalPaye },
      { label: 'Cotisations attendues', value: totalAttendu }
    ];
    const csv = '\uFEFF' + rows.map((r) => `"${r.label}";"${r.value}"`).join('\n');
    download(`rapport-${periode}-${start}.csv`, csv, 'text/csv;charset=utf-8');
  };
}

/* ---------------- Paramètres ---------------- */
let _paramMedia = {}; // changements d'images en attente, avant clic sur "Enregistrer"

function champMedia(id, label, currentUrl) {
  return `<div class="field" style="margin-top:14px;">
    <label>${label}</label>
    <div class="flex gap-8" style="margin-top:6px; align-items:center;">
      <div class="media-preview" id="${id}-preview">${currentUrl ? `<img src="${currentUrl}" alt="">` : `<span class="text-soft" style="font-size:10.5px;">Aucun</span>`}</div>
      <label class="btn btn-sm" style="cursor:pointer;">Choisir un fichier<input type="file" accept="image/*" id="${id}-file" style="display:none;"></label>
      <button type="button" class="btn btn-sm btn-danger" id="${id}-remove" ${currentUrl ? '' : 'style="display:none;"'}>Retirer</button>
    </div>
  </div>`;
}

ROUTES['#/parametres'] = async (root) => {
  _paramMedia = {};
  const meta = (await DB.getAll('meta'))[0] || { nomEcole: '', anneeScolaire: anneeScolaireCourante() };
  root.innerHTML = `
    <div class="grid grid-2" style="align-items:start;">
      <div class="card">
        <h3>Établissement</h3>
        <div class="field"><label>Nom de l'école</label><input id="pm-nom" value="${esc(meta.nomEcole || '')}"></div>
        <div class="field"><label>Statut de l'école</label><select id="pm-statut"><option value="Publique" ${meta.statutEcole !== 'Privée' ? 'selected' : ''}>Publique</option><option value="Privée" ${meta.statutEcole === 'Privée' ? 'selected' : ''}>Privée</option></select></div>
        <div class="field" style="margin-top:10px;"><label>Année scolaire</label><input id="pm-annee" value="${esc(meta.anneeScolaire || '')}"></div>
        <div class="field" style="margin-top:10px;"><label>Nom du directeur / de la directrice</label><input id="pm-directeur" value="${esc(meta.nomDirecteur || '')}" placeholder="Ex : M. KABORÉ Issa"></div>
        <div class="field" style="margin-top:10px;"><label>Région (DREPPNF)</label><input id="pm-region" value="${esc(meta.region || '')}" placeholder="Ex : GUIRIKO"></div>
        <div class="field" style="margin-top:10px;"><label>Province / Commune (DPEPPNF)</label><input id="pm-dpeppnf" value="${esc(meta.dpeppnf || '')}" placeholder="Ex : Tuy"></div>
        <div class="field" style="margin-top:10px;"><label>CEB</label><input id="pm-ceb" value="${esc(meta.ceb || '')}" placeholder="Ex : Koti"></div>
        <div class="field" style="margin-top:10px;"><label>Lieu (« Fait à »)</label><input id="pm-lieu" value="${esc(meta.lieu || '')}"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" id="pm-save">Enregistrer</button>
      </div>
      <div class="card">
        <h3>Documents officiels</h3>
        <p class="text-soft">Le logo, le cachet et la signature apparaissent automatiquement sur tous les documents imprimés (bulletins, certificats, attestations, reçus, procès-verbaux…). Utilisez des images légères (fond transparent de préférence pour le cachet et la signature).</p>
        ${champMedia('pm-logo', "Logo de l'école", meta.logoDataUrl)}
        ${champMedia('pm-cachet', 'Cachet / tampon officiel', meta.cachetDataUrl)}
        ${champMedia('pm-signature', 'Signature du directeur / de la directrice', meta.signatureDataUrl)}
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px; align-items:start;">
      <div class="card">
        <h3>Apparence</h3>
        <p class="text-soft">Basculer entre le mode clair et le mode sombre.</p>
        <button class="btn" onclick="toggleTheme()">Changer de thème</button>
      </div>
      <div class="card">
        <h3>Sauvegarde & restauration</h3>
        <p class="text-soft">Exportez régulièrement une sauvegarde complète des données de l'école (élèves, classes, finances…) et conservez-la en lieu sûr (clé USB, carte SD).</p>
        <div class="flex gap-8" style="flex-wrap:wrap;">
          <button class="btn btn-accent" id="pm-export">Exporter une sauvegarde (JSON)</button>
          <label class="btn" style="cursor:pointer;">Importer une sauvegarde<input type="file" id="pm-import" accept="application/json" style="display:none;"></label>
        </div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:16px; align-items:start;">
      <div class="card">
        <h3>Réinitialisation</h3>
        <p class="text-soft">Supprime toutes les données de l'application sur cet appareil. Irréversible — exportez une sauvegarde avant.</p>
        <button class="btn btn-danger" id="pm-reset">Réinitialiser toutes les données</button>
      </div>
    </div>`;

  ['logo', 'cachet', 'signature'].forEach((key) => {
    const field = key + 'DataUrl';
    $(`#pm-${key}-file`).onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        _paramMedia[field] = reader.result;
        $(`#pm-${key}-preview`).innerHTML = `<img src="${reader.result}" alt="">`;
        $(`#pm-${key}-remove`).style.display = '';
      };
      reader.readAsDataURL(file);
    };
    $(`#pm-${key}-remove`).onclick = () => {
      _paramMedia[field] = null;
      $(`#pm-${key}-preview`).innerHTML = `<span class="text-soft" style="font-size:10.5px;">Aucun</span>`;
      $(`#pm-${key}-remove`).style.display = 'none';
    };
  });

  $('#pm-save').onclick = async () => {
    meta.nomEcole = $('#pm-nom').value; meta.statutEcole = $('#pm-statut').value; meta.anneeScolaire = $('#pm-annee').value;
    meta.nomDirecteur = $('#pm-directeur').value;
    meta.region = $('#pm-region').value; meta.dpeppnf = $('#pm-dpeppnf').value; meta.ceb = $('#pm-ceb').value; meta.lieu = $('#pm-lieu').value;
    ['logoDataUrl', 'cachetDataUrl', 'signatureDataUrl'].forEach((f) => {
      if (f in _paramMedia) { if (_paramMedia[f]) meta[f] = _paramMedia[f]; else delete meta[f]; }
    });
    if (meta.id) await DB.put('meta', meta); else meta.id = await DB.add('meta', meta);
    _paramMedia = {};
    toast('Paramètres enregistrés.');
  };
  $('#pm-export').onclick = async () => {
    const dump = await exportAllData();
    download(`sauvegarde-ecole-${todayISO()}.json`, JSON.stringify(dump), 'application/json');
  };
  $('#pm-import').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!(await confirmDialog('Importer cette sauvegarde remplacera toutes les données actuelles. Continuer ?'))) return;
    const text = await file.text();
    try { await importAllData(JSON.parse(text)); toast('Sauvegarde importée avec succès.'); location.hash = '#/dashboard'; onRouteChange(); }
    catch (err) { toast('Fichier de sauvegarde invalide.'); }
  };
  $('#pm-reset').onclick = async () => {
    if (await confirmDialog('Cette action supprimera DÉFINITIVEMENT toutes les données. Confirmer ?')) {
      for (const s of STORES) await DB.clear(s);
      await seedIfEmpty();
      toast('Données réinitialisées.');
      logout();
    }
  };
};
