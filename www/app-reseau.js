/* ============================================================
   app-reseau.js — Comptes du réseau et publications de documents
   ------------------------------------------------------------
   Ministère → DREPPNF → DPEPPNF → CEB → École
   - Chaque niveau a SON compte (comme le directeur pour l'école).
     Les comptes CEB, DPEPPNF, DREPPNF et ministère ne voient aucune
     rubrique de l'école (voir routeAutorisee dans app-core.js et les règles
     RLS dans supabase-setup.sql).
   - Rubrique « Documents publiés » (#/publications) : chaque niveau publie
     un document directement dans l'application, vers un ou plusieurs autres
     niveaux ; les destinataires le reçoivent et accusent réception.
   - Rubrique « Comptes des structures » (#/comptes-reseau) : chaque niveau
     crée les comptes du niveau juste en dessous.
   Tout passe par Supabase (tables circuit_documents et circuit_accuses) :
   une connexion internet est nécessaire pour publier et consulter.
   ============================================================ */

const RES_NIVEAUX = ['ministere', 'dreppnf', 'dpeppnf', 'ceb', 'ecole'];
const RES_INFO = {
  ministere: { sigle: 'Ministère', nom: 'Ministère (SG MEBAPLN)', route: '#/exam-sg' },
  dreppnf: { sigle: 'DREPPNF', nom: 'Direction régionale (DREPPNF)', route: '#/exam-dreppnf' },
  dpeppnf: { sigle: 'DPEPPNF', nom: 'Direction provinciale (DPEPPNF)', route: '#/exam-dpeppnf' },
  ceb: { sigle: 'CEB', nom: "Circonscription d'éducation de base (CEB)", route: '#/examens' },
  ecole: { sigle: 'École', nom: 'École primaire', route: '#/cep-ecole' }
};
const RES_ROLES_ECOLE = ['directeur', 'directeur_adjoint', 'secretaire', 'comptable', 'magasinier', 'cantine', 'enseignant'];
const RES_CATEGORIES = [
  'Circulaire / note de service', 'Calendrier', 'Instructions', 'Communiqué', 'Modèle de document / formulaire',
  "Liste / état de situation", 'Rapport', 'Procès-verbal', 'Résultats', 'Demande / correspondance', 'Autre'
];
// Qui reçoit par défaut les documents d'un niveau (modifiable à chaque publication)
const RES_CIBLES_DEFAUT = {
  ministere: ['dreppnf', 'dpeppnf', 'ceb', 'ecole'],
  dreppnf: ['dpeppnf', 'ceb', 'ecole'],
  dpeppnf: ['ceb', 'ecole'],
  ceb: ['ecole', 'dpeppnf'],
  ecole: ['ceb']
};
// Compte que chaque niveau a le droit de créer (le niveau juste en dessous)
const RES_CREABLE = { ministere: 'dreppnf', dreppnf: 'dpeppnf', dpeppnf: 'ceb', ceb: 'directeur' };
const RES_PJ_MAX = (typeof EX_PJ_MAX !== 'undefined') ? EX_PJ_MAX : 1.5 * 1024 * 1024;
const RES_ETAT = { onglet: 'recus' };

/* ---------------- Aides ---------------- */
function resRang(n) { return RES_NIVEAUX.indexOf(n); }

/* Niveau du réseau du compte connecté (null pour comptable, enseignant, etc. : pas de publication). */
function resNiveau() {
  if (!currentUser) return null;
  const r = currentUser.role;
  if (ROLES_RESEAU.includes(r)) return r;
  if (['directeur', 'directeur_adjoint', 'secretaire'].includes(r)) return 'ecole';
  return null;
}
function resEstDirection() { return !!currentUser && ['directeur', 'directeur_adjoint'].includes(currentUser.role); }

/* Zone portée par un document publié par ce niveau (région, province, CEB), vide pour ce qui est au-dessus. */
function resZone(niveau) {
  const r = resRang(niveau);
  return {
    region: r >= 1 ? (currentUser.region || null) : null,
    province: r >= 2 ? (currentUser.province || null) : null,
    ceb: r >= 3 ? (currentUser.ceb || null) : null
  };
}
function resZoneManquante(niveau) {
  const r = resRang(niveau);
  if (r >= 1 && !currentUser.region) return niveau === 'ecole' ? 'rattachement' : 'la région';
  if (r >= 2 && !currentUser.province) return niveau === 'ecole' ? 'rattachement' : 'la province';
  if (r >= 3 && !currentUser.ceb) return niveau === 'ecole' ? 'rattachement' : 'la CEB';
  return '';
}
/* Texte qui précise qui recevra le document pour un niveau destinataire donné. */
function resPortee(niveau, cible) {
  const echelon = Math.min(resRang(niveau), resRang(cible));
  if (echelon <= 0) return 'dans tout le pays';
  if (echelon === 1) return `de la région ${currentUser.region || '?'}`;
  if (echelon === 2) return `de la province ${currentUser.province || '?'}`;
  return `de la CEB ${currentUser.ceb || '?'}`;
}
function resMsgErreur(e) {
  const m = String((e && (e.message || e.details)) || e || '');
  if (/does not exist|schema cache|could not find/i.test(m)) return "Les tables ou colonnes des publications sont introuvables : exécutez à nouveau supabase-setup.sql dans Supabase (SQL Editor), puis rechargez la page.";
  if (/row-level security|violates/i.test(m)) return "Action refusée par les règles d'accès (rattachement incomplet ou droits insuffisants).";
  if (/fetch|network|timeout|failed/i.test(m)) return "Connexion internet requise pour cette rubrique.";
  return m || 'Erreur inconnue.';
}
function resSigle(n) { return (RES_INFO[n] || {}).sigle || n; }

/* ---------------- Chargement ---------------- */
async function resCharger() {
  const supa = window.supaClient;
  const [d, a] = await Promise.all([
    supa.from('circuit_documents')
      .select('id,niveau,emetteur_id,emetteur_nom,structure,region,province,ceb,cibles,categorie,reference,objet,echeance,pj_nom,created_at')
      .order('created_at', { ascending: false }).limit(300),
    supa.from('circuit_accuses').select('doc_id,user_id,nom,structure,accuse_le')
  ]);
  if (d.error) throw d.error;
  return { docs: d.data || [], accuses: a.error ? [] : (a.data || []) };
}

/* ============================================================
   TABLEAU DE BORD DU RÉSEAU (comptes CEB, DPEPPNF, DREPPNF, ministère)
   ============================================================ */
const _resDashboardEcole = ROUTES['#/dashboard'];
ROUTES['#/dashboard'] = async (root) => {
  if (estCompteReseau()) return resDashboard(root);
  return _resDashboardEcole(root);
};

async function resDashboard(root) {
  const niveau = resNiveau(), info = RES_INFO[niveau];
  const zone = [currentUser.region && `Région ${currentUser.region}`, currentUser.province && `Province ${currentUser.province}`, currentUser.ceb && `CEB ${currentUser.ceb}`].filter(Boolean).join(' · ');
  let recus = '—', aTraiter = '—', publies = '—';
  try {
    const { docs, accuses } = await resCharger();
    const moi = currentUser.id;
    const mesAccuses = new Set(accuses.filter((x) => x.user_id === moi).map((x) => x.doc_id));
    const r = docs.filter((x) => x.emetteur_id !== moi);
    recus = r.length; aTraiter = r.filter((x) => !mesAccuses.has(x.id)).length;
    publies = docs.length - r.length;
  } catch (e) { /* hors ligne : les compteurs restent vides */ }
  root.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:800;font-size:17px;">${esc(info.sigle)}${currentUser.structure ? ' — ' + esc(currentUser.structure) : ''}</div>
      <div class="text-soft">${esc(info.nom)}${zone ? ' · ' + esc(zone) : ''}</div>
      <div class="text-soft" style="margin-top:4px;">Connecté : <b>${esc(currentUser.nom)}</b></div>
    </div>
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Documents à accuser</div><div class="value">${aTraiter}</div></div>
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Documents reçus</div><div class="value">${recus}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Documents publiés</div><div class="value">${publies}</div></div>
    </div>
    <div class="card">
      <div class="flex gap-8" style="flex-wrap:wrap;">
        <a class="btn btn-accent" href="#/cep-tableau">Tableau de bord du CEP</a>
        <a class="btn" href="#/cep-calendrier">Calendrier et échéances</a>
        <a class="btn" href="#/cep-validation">Remontées et validation</a>
        <a class="btn btn-accent" href="#/publications">Documents publiés</a>
        ${niveau === 'ceb' ? '<a class="btn btn-accent" href="#/listes-ceb">Listes d\'élèves des écoles</a>' : ''}
        <a class="btn" href="#/cep">Circuit officiel du CEP</a>
        <a class="btn" href="${info.route}">Mon espace de travail</a>
        ${RES_CREABLE[niveau] ? '<a class="btn" href="#/comptes-reseau">Comptes des structures</a>' : ''}
      </div>
    </div>`;
}

/* ============================================================
   DOCUMENTS PUBLIÉS
   ============================================================ */
ROUTES['#/publications'] = async (root) => {
  const niveau = resNiveau();
  if (!niveau) { root.innerHTML = `<div class="alert alert-terre">Votre profil n'a pas accès aux publications.</div>`; return; }
  const info = RES_INFO[niveau];
  root.innerHTML = `
    <div id="pb-rattachement"></div>
    <div class="table-toolbar no-print">
      <span class="text-soft" style="font-size:12.5px;">Vous publiez au nom de : <b>${esc(info.sigle)}${currentUser.structure ? ' — ' + esc(currentUser.structure) : ''}</b></span>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="pb-actu">Actualiser</button>
      <button class="btn btn-accent" id="pb-new">+ Publier un document</button>
    </div>
    <div class="tabs no-print" id="pb-tabs">
      <button class="tab ${RES_ETAT.onglet === 'recus' ? 'active' : ''}" data-t="recus">Reçus</button>
      <button class="tab ${RES_ETAT.onglet === 'publies' ? 'active' : ''}" data-t="publies">Publiés par moi</button>
    </div>
    <div id="pb-liste"><p class="text-soft">Chargement…</p></div>`;

  $('#pb-tabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { RES_ETAT.onglet = b.dataset.t; onRouteChange(); } };
  $('#pb-actu').onclick = () => onRouteChange();
  $('#pb-new').onclick = () => resFormPublier(niveau);
  resCarteRattachement(niveau);

  let data;
  try { data = await resCharger(); } catch (e) { $('#pb-liste').innerHTML = `<div class="alert alert-terre">${esc(resMsgErreur(e))}</div>`; return; }
  const moi = currentUser.id;
  const mesAccuses = new Set(data.accuses.filter((x) => x.user_id === moi).map((x) => x.doc_id));
  const parDoc = {};
  data.accuses.forEach((x) => { (parDoc[x.doc_id] = parDoc[x.doc_id] || []).push(x); });
  const recus = data.docs.filter((d) => d.emetteur_id !== moi);
  const publies = data.docs.filter((d) => d.emetteur_id === moi);
  const nbARecevoir = recus.filter((d) => !mesAccuses.has(d.id)).length;
  const onglet = $(`#pb-tabs [data-t="recus"]`);
  if (onglet && nbARecevoir) onglet.textContent = `Reçus (${nbARecevoir} à accuser)`;

  const box = $('#pb-liste');
  if (RES_ETAT.onglet === 'recus') {
    box.innerHTML = recus.length ? `<div class="table-wrap"><table class="table" style="font-size:13px;"><thead><tr><th>Objet</th><th>Date</th><th>Réf.</th><th>Catégorie</th><th>De</th><th>Échéance</th><th>Statut</th><th></th></tr></thead><tbody>
      ${recus.map((d) => `<tr>
        <td class="wrap" style="font-weight:700;">${esc(d.objet)}${d.pj_nom ? ' 📎' : ''}</td>
        <td>${esc(formatDate(String(d.created_at).slice(0, 10)))}</td>
        <td>${esc(d.reference) || '—'}</td>
        <td class="wrap">${esc(d.categorie) || '—'}</td>
        <td class="wrap">${esc(resSigle(d.niveau))}${d.structure ? ' ' + esc(d.structure) : ''}</td>
        <td>${d.echeance ? esc(formatDate(d.echeance)) : '—'}</td>
        <td>${mesAccuses.has(d.id) ? '<span class="badge badge-vert">Accusé</span>' : '<span class="badge badge-ocre">Nouveau</span>'}</td>
        <td><div class="flex gap-8"><button class="btn btn-sm" data-ouvrir="${d.id}">Ouvrir</button>${mesAccuses.has(d.id) ? '' : `<button class="btn btn-sm" data-accuse="${d.id}">Accuser réception</button>`}</div></td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty-state"><div class="big">⇅</div>Aucun document reçu pour le moment.</div>`;
  } else {
    box.innerHTML = publies.length ? `<div class="table-wrap"><table class="table" style="font-size:13px;"><thead><tr><th>Objet</th><th>Date</th><th>Réf.</th><th>Destinataires</th><th>Accusés</th><th></th></tr></thead><tbody>
      ${publies.map((d) => `<tr>
        <td class="wrap" style="font-weight:700;">${esc(d.objet)}${d.pj_nom ? ' 📎' : ''}</td>
        <td>${esc(formatDate(String(d.created_at).slice(0, 10)))}</td>
        <td>${esc(d.reference) || '—'}</td>
        <td class="wrap">${d.cibles.map((c) => esc(resSigle(c))).join(', ')}</td>
        <td>${(parDoc[d.id] || []).length}</td>
        <td><div class="flex gap-8"><button class="btn btn-sm" data-ouvrir="${d.id}">Ouvrir</button><button class="btn btn-sm btn-danger" data-retirer="${d.id}">Retirer</button></div></td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty-state"><div class="big">⇅</div>Vous n'avez rien publié. Utilisez « Publier un document ».</div>`;
  }

  $all('[data-ouvrir]', box).forEach((b) => { b.onclick = () => resOuvrir(b.dataset.ouvrir, parDoc); });
  $all('[data-accuse]', box).forEach((b) => { b.onclick = () => resAccuser(b.dataset.accuse, niveau); });
  $all('[data-retirer]', box).forEach((b) => {
    b.onclick = async () => {
      const d = publies.find((x) => x.id === b.dataset.retirer);
      if (!d || !(await confirmDialog(`Retirer « ${d.objet} » ? Il disparaîtra aussi chez les destinataires.`))) return;
      const { error } = await window.supaClient.from('circuit_documents').delete().eq('id', d.id);
      if (error) { toast(resMsgErreur(error)); return; }
      toast('Document retiré.'); onRouteChange();
    };
  });
};

async function resAccuser(id, niveau) {
  const { error } = await window.supaClient.from('circuit_accuses').insert({
    doc_id: id, user_id: currentUser.id, nom: currentUser.nom, structure: currentUser.structure || resSigle(niveau)
  });
  if (error && error.code !== '23505') { toast(resMsgErreur(error)); return; }
  toast('Réception enregistrée.');
  onRouteChange();
}

async function resOuvrir(id, parDoc) {
  const { data: d, error } = await window.supaClient.from('circuit_documents').select('*').eq('id', id).single();
  if (error || !d) { toast(resMsgErreur(error)); return; }
  const accuses = d.emetteur_id === currentUser.id ? (parDoc[d.id] || []) : [];
  const ov = openModal(d.objet, `
    <p class="text-soft" style="font-size:12.5px;">${esc(d.categorie || '')}${d.reference ? ' · réf. ' + esc(d.reference) : ''} · de <b>${esc(resSigle(d.niveau))}${d.structure ? ' ' + esc(d.structure) : ''}</b> (${esc(d.emetteur_nom)}) · publié le ${esc(formatDate(String(d.created_at).slice(0, 10)))}${d.echeance ? ' · <b>à traiter avant le ' + esc(formatDate(d.echeance)) + '</b>' : ''}</p>
    <p class="text-soft" style="font-size:12px;">Destinataires : ${d.cibles.map((c) => esc(resSigle(c))).join(', ')}</p>
    <div style="white-space:pre-wrap;font-size:14px;margin:10px 0;">${esc(d.contenu) || '<span class="text-soft">(pas de texte)</span>'}</div>
    ${d.pj_data ? `<button class="btn btn-sm" id="pb-pj">📎 ${esc(d.pj_nom || 'pièce jointe')} (${Math.round(d.pj_data.length * 0.75 / 1024)} Ko)</button>` : ''}
    ${d.emetteur_id === currentUser.id ? `<h4 style="margin:14px 0 6px;">Accusés de réception (${accuses.length})</h4>${accuses.length ? `<ul style="margin:0 0 0 18px;">${accuses.map((x) => `<li>${esc(x.structure || '')} — ${esc(x.nom || '')} <span class="text-soft">(${esc(formatDate(String(x.accuse_le).slice(0, 10)))})</span></li>`).join('')}</ul>` : '<p class="text-soft">Aucun accusé pour le moment.</p>'}` : ''}`,
  { saveLabel: 'Fermer', onSave: async () => true });
  if (d.pj_data) $('#pb-pj', ov).onclick = () => exTelechargerBase64(d.pj_nom || 'document', d.pj_type, d.pj_data);
}

function resFormPublier(niveau) {
  const manque = resZoneManquante(niveau);
  if (manque === 'rattachement') { toast("Rattachez d'abord votre école à sa CEB (carte en haut de la page)."); return; }
  if (manque) { toast(`Votre compte n'a pas ${manque} renseignée : contactez la structure qui a créé votre compte.`); return; }
  const autres = RES_NIVEAUX.filter((n) => n !== niveau);
  const defauts = RES_CIBLES_DEFAUT[niveau] || [];
  let pj = null;
  const ov = openModal('Publier un document', `
    <div class="form-grid">
      <div class="field full"><label>Objet *</label><input id="pu-objet"></div>
      <div class="field full"><label>Destinataires * <span class="text-soft" style="font-weight:400;">(vous pouvez en cocher plusieurs)</span></label>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${autres.map((n) => `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;"><input type="checkbox" class="pu-cible" value="${n}" ${defauts.includes(n) ? 'checked' : ''} style="margin-top:3px;"><span><b>${esc(RES_INFO[n].sigle)}</b> <span class="text-soft">${esc(resPortee(niveau, n))}</span></span></label>`).join('')}
        </div></div>
      <div class="field"><label>Catégorie</label><select id="pu-cat">${RES_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Référence / n°</label><input id="pu-ref" placeholder="Ex : N°2026-014/…"></div>
      <div class="field"><label>À traiter avant le</label><input type="date" id="pu-ech"></div>
      <div class="field full"><label>Texte / instructions</label><textarea id="pu-txt" style="min-height:120px;"></textarea></div>
      <div class="field full"><label>Pièce jointe (PDF, image, Word…, 1,5 Mo max)</label><input type="file" id="pu-pj"><small id="pu-pj-info"></small></div>
    </div>`, {
    saveLabel: 'Publier',
    onSave: async (o) => {
      const objet = $('#pu-objet', o).value.trim();
      const cibles = $all('.pu-cible', o).filter((c) => c.checked).map((c) => c.value);
      if (!objet) { toast("Indiquez l'objet du document."); return false; }
      if (!cibles.length) { toast('Choisissez au moins un destinataire.'); return false; }
      const z = resZone(niveau);
      const ech = $('#pu-ech', o).value;
      const row = {
        niveau, emetteur_id: currentUser.id, emetteur_nom: currentUser.nom,
        structure: currentUser.structure || null, region: z.region, province: z.province, ceb: z.ceb,
        cibles, categorie: $('#pu-cat', o).value, reference: $('#pu-ref', o).value.trim() || null,
        objet, contenu: $('#pu-txt', o).value.trim() || null, echeance: ech || null,
        pj_nom: pj ? pj.nom : null, pj_type: pj ? pj.type : null, pj_data: pj ? pj.data : null
      };
      const btn = $('.modal-save', o); btn.disabled = true;
      const { error } = await window.supaClient.from('circuit_documents').insert(row);
      btn.disabled = false;
      if (error) { toast(resMsgErreur(error)); return false; }
      toast('Document publié.');
      RES_ETAT.onglet = 'publies';
      onRouteChange();
      return true;
    }
  });
  $('#pu-pj', ov).onchange = async (e) => {
    const f = e.target.files[0]; pj = null; $('#pu-pj-info', ov).textContent = '';
    if (!f) return;
    if (f.size > RES_PJ_MAX) { toast('Pièce jointe trop volumineuse (1,5 Mo maximum).'); e.target.value = ''; return; }
    pj = { nom: f.name, type: f.type || 'application/octet-stream', data: await exLireBase64(f) };
    $('#pu-pj-info', ov).textContent = `${f.name} — ${Math.round(f.size / 1024)} Ko`;
  };
}

/* ---------------- Rattachement de l'école à sa CEB ----------------
   Une école reçoit les documents de SA CEB, de sa province et de sa région.
   Le rattachement s'obtient soit à la création du compte par la CEB (automatique),
   soit ici : la direction choisit sa CEB dans la liste des CEB qui ont un compte. */
function resCarteRattachement(niveau) {
  const box = $('#pb-rattachement');
  if (!box || niveau !== 'ecole') return;
  const ok = currentUser.ceb && currentUser.province && currentUser.region;
  if (ok) {
    box.innerHTML = `<div class="card" style="margin-bottom:12px;padding:10px 16px;"><span class="text-soft">École rattachée à :</span> <b>CEB ${esc(currentUser.ceb)}</b> · province ${esc(currentUser.province)} · région ${esc(currentUser.region)}
      ${resEstDirection() ? ' <button class="btn btn-sm" id="pb-rattacher" style="margin-left:8px;">Modifier</button>' : ''}</div>`;
  } else {
    box.innerHTML = `<div class="alert alert-ocre" style="margin-bottom:12px;">Votre école n'est pas encore <b>rattachée à sa CEB</b> : elle ne peut ni recevoir ni publier de documents.
      ${resEstDirection() ? ' <button class="btn btn-sm btn-accent" id="pb-rattacher" style="margin-left:8px;">Rattacher mon école</button>' : ' La direction doit faire ce rattachement.'}</div>`;
  }
  const b = $('#pb-rattacher'); if (b) b.onclick = () => resFormRattacher();
}

async function resFormRattacher() {
  const { data, error } = await window.supaClient.rpc('liste_cebs');
  if (error) { toast(resMsgErreur(error)); return; }
  const liste = data || [];
  if (!liste.length) { openModal('Rattacher mon école', `<p>Aucune CEB n'a encore de compte dans l'application. Demandez à votre CEB de créer d'abord son compte (ou de créer le vôtre).</p>`, { saveLabel: 'Fermer', onSave: async () => true }); return; }
  const ov = openModal('Rattacher mon école à sa CEB', `
    <div class="field"><label>Ma CEB *</label>
      <select id="rt-ceb">${liste.map((c, i) => `<option value="${i}" ${norm(c.ceb) === norm(currentUser.ceb) ? 'selected' : ''}>${esc(c.region)} — ${esc(c.province)} — CEB ${esc(c.ceb)}</option>`).join('')}</select>
      <p class="text-soft" style="font-size:12px;">Choisissez avec soin : c'est ce choix qui détermine les documents que reçoit l'école.</p></div>`, {
    saveLabel: 'Enregistrer',
    onSave: async (o) => {
      const c = liste[Number($('#rt-ceb', o).value)];
      const maj = { region: c.region, province: c.province, ceb: c.ceb };
      try { const m = (await DB.getAll('meta'))[0]; if (m && m.nomEcole) maj.structure = m.nomEcole; } catch (e) { /* facultatif */ }
      // Tout le personnel de l'école partage le même rattachement
      const { error: e2 } = await window.supaClient.from('profiles').update(maj).in('role', RES_ROLES_ECOLE);
      if (e2) { toast(resMsgErreur(e2)); return false; }
      Object.assign(currentUser, maj);
      try {
        const k = PROFILE_CACHE_KEY + ':' + currentUser.id;
        const cache = JSON.parse(localStorage.getItem(k) || '{}');
        localStorage.setItem(k, JSON.stringify({ ...cache, ...maj }));
      } catch (e) { /* le cache sera rafraîchi à la prochaine connexion */ }
      toast('École rattachée.');
      onRouteChange();
      return true;
    }
  });
  function norm(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
}

/* ============================================================
   COMPTES DES STRUCTURES : chaque niveau crée le niveau juste en dessous
   ============================================================ */
ROUTES['#/comptes-reseau'] = async (root) => {
  const niveau = resNiveau();
  const roleCree = RES_CREABLE[currentUser.role];
  if (!roleCree) { root.innerHTML = `<div class="alert alert-terre">Votre profil ne peut pas créer de comptes.</div>`; return; }
  const libelle = { dreppnf: 'DREPPNF (région)', dpeppnf: 'DPEPPNF (province)', ceb: 'CEB', directeur: "Directeur d'école" }[roleCree];
  root.innerHTML = `
    <div class="card">
      <div class="flex justify-between items-center">
        <h3 style="margin:0;">Comptes : ${esc(libelle)}</h3>
        <button class="btn btn-primary btn-sm" id="cr-creer">+ Créer un compte</button>
      </div>
      <p class="text-soft">En tant que <b>${esc(RES_INFO[niveau].sigle)}</b>, vous créez ici les comptes du niveau juste en dessous. Chaque compte reçoit automatiquement son rattachement (région, province, CEB), qui détermine les documents qu'il reçoit.</p>
      <div id="cr-liste"><p class="text-soft">Chargement…</p></div>
    </div>`;
  $('#cr-creer').onclick = () => resFormCompte(roleCree);
  const { data, error } = await window.supaClient.from('profiles').select('id,nom,role,structure,region,province,ceb').eq('role', roleCree).order('structure');
  const box = $('#cr-liste');
  if (error) { box.innerHTML = `<div class="alert alert-terre">${esc(resMsgErreur(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = `<p class="text-soft">Aucun compte pour le moment.</p>`; return; }
  box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Structure</th><th>Responsable</th><th>Rattachement</th><th></th></tr></thead><tbody>
    ${data.map((p) => `<tr><td class="wrap">${esc(p.structure) || '—'}</td><td>${esc(p.nom)}</td>
      <td class="wrap text-soft">${[p.region && 'Région ' + p.region, p.province && 'Province ' + p.province, p.ceb && 'CEB ' + p.ceb].filter(Boolean).map(esc).join(' · ') || '—'}</td>
      <td><button class="btn btn-sm btn-danger" data-retirer="${p.id}">Retirer l'accès</button></td></tr>`).join('')}
  </tbody></table></div>`;
  $all('[data-retirer]', box).forEach((b) => {
    b.onclick = async () => {
      const p = data.find((x) => x.id === b.dataset.retirer);
      if (!p || !(await confirmDialog(`Retirer l'accès de « ${p.structure || p.nom} » ? Son compte ne pourra plus rien consulter dans l'application.`))) return;
      const { error: e } = await window.supaClient.from('profiles').delete().eq('id', p.id);
      if (e) { toast(resMsgErreur(e)); return; }
      toast('Accès retiré.'); onRouteChange();
    };
  });
};

function resFormCompte(roleCree) {
  const me = currentUser;
  // Ce que le créateur doit lui-même avoir pour pouvoir rattacher le nouveau compte
  const requis = { dreppnf: [], dpeppnf: ['region'], ceb: ['region', 'province'], directeur: ['region', 'province', 'ceb'] }[roleCree];
  const nomChamp = { region: 'sa région', province: 'sa province', ceb: 'sa CEB' };
  const manque = requis.find((k) => !me[k]);
  if (manque) { toast(`Votre propre compte n'a pas ${nomChamp[manque]} renseignée : contactez la structure qui l'a créé.`); return; }

  const champ = {
    dreppnf: { label: 'Région *', ph: 'Ex : Centre-Ouest' },
    dpeppnf: { label: 'Province *', ph: 'Ex : Sanguié' },
    ceb: { label: 'Nom de la CEB *', ph: 'Ex : Koudougou 1' },
    directeur: { label: "Nom de l'école *", ph: 'Ex : EPP de Réo A' }
  }[roleCree];
  const mdp0 = (typeof genererMotDePasse === 'function') ? genererMotDePasse() : Math.random().toString(36).slice(2, 10).toUpperCase();

  openModal('Créer un compte', `
    <div class="form-grid">
      <div class="field full"><label>${esc(champ.label)}</label><input id="cn-zone" placeholder="${esc(champ.ph)}"></div>
      <div class="field full"><label>Nom du responsable *</label><input id="cn-nom" placeholder="Ex : M. Ouédraogo"></div>
      <div class="field full"><label>E-mail de connexion *</label><input id="cn-email" type="email" placeholder="Ex : responsable@exemple.bf"></div>
      <div class="field full"><label>Mot de passe initial</label><input id="cn-mdp" value="${esc(mdp0)}">
        <p class="text-soft" style="font-size:12px;">Généré automatiquement — vous pouvez le remplacer. Notez-le : il faudra le communiquer à la personne.</p></div>
    </div>`, {
    saveLabel: 'Créer le compte',
    onSave: async (o) => {
      const zone = $('#cn-zone', o).value.trim(), nom = $('#cn-nom', o).value.trim();
      const email = $('#cn-email', o).value.trim(), mdp = $('#cn-mdp', o).value;
      if (!zone || !nom || !email || !mdp) { toast('Tous les champs sont obligatoires.'); return false; }
      if (mdp.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères.'); return false; }

      // Profil à enregistrer : le nouveau compte hérite du rattachement du créateur
      const profil = { nom, role: roleCree, structure: null, region: null, province: null, ceb: null };
      if (roleCree === 'dreppnf') { profil.region = zone; profil.structure = `DREPPNF ${zone}`; }
      if (roleCree === 'dpeppnf') { profil.region = me.region; profil.province = zone; profil.structure = `DPEPPNF ${zone}`; }
      if (roleCree === 'ceb') { profil.region = me.region; profil.province = me.province; profil.ceb = zone; profil.structure = `CEB ${zone}`; }
      if (roleCree === 'directeur') { profil.region = me.region; profil.province = me.province; profil.ceb = me.ceb; profil.structure = zone; }

      // Second client isolé : la session du créateur n'est pas touchée
      let temp;
      try { temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
      catch (e) { toast("Impossible d'initialiser la création de compte."); return false; }
      const { data, error } = await temp.auth.signUp({ email, password: mdp });
      if (error) { toast('Création du compte impossible : ' + (error.message || 'erreur inconnue') + '. Vérifiez que la confirmation par e-mail est désactivée dans Supabase (voir le guide).'); return false; }
      if (!data.user) { toast("Le compte n'a pas pu être créé (réponse inattendue du serveur)."); return false; }
      const { error: e2 } = await window.supaClient.from('profiles').insert({ id: data.user.id, ...profil });
      if (e2) { toast("Compte de connexion créé, mais profil refusé : " + resMsgErreur(e2)); return false; }

      o.querySelector('.modal-head h3').textContent = 'Compte créé';
      o.querySelector('.modal-body').innerHTML = `
        <p>Le compte de <strong>${esc(profil.structure)}</strong> (${esc(nom)}) a été créé.</p>
        <p>Communiquez-lui ces identifiants pour sa première connexion :</p>
        <div class="card" style="background:var(--bg-soft,#f6f6f6);">
          <p style="margin:4px 0;"><strong>E-mail :</strong> ${esc(email)}</p>
          <p style="margin:4px 0;"><strong>Mot de passe :</strong> ${esc(mdp)}</p>
        </div>`;
      o.querySelector('.modal-foot').innerHTML = `<button class="btn btn-primary" id="cn-fermer">Fermer</button>`;
      $('#cn-fermer', o).addEventListener('click', () => closeModal());
      onRouteChange();
      return false; // le modal reste ouvert : c'est nous qui le fermons
    }
  });
}
