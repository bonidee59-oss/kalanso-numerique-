/* ============================================================
   app-bureaux.js — Bureaux de la CEB (version 47)
   Le CCEB (compte « ceb ») crée un compte pour chacun des 9 bureaux.
   Chaque bureau : envoie des documents aux écoles de sa CEB, et reçoit
   les documents des écoles qui le concernent (selon la NATURE du document).
   Données : rôle « bureau » + colonne profiles.bureau ; documents :
   colonnes bureaux / bureau_emetteur / nature (voir supabase-bureaux.sql).
   Chargé après app-reseau.js : il en complète les fonctions.
   ============================================================ */
const BUREAUX = [
  { code: 'scr', sigle: 'Scr', nom: 'Secrétariat', desc: 'Courrier, accueil, classement, archives et gestion administrative.' },
  { code: 'bgrh', sigle: 'BGRH', nom: 'Bureau de Gestion des Ressources humaines', desc: 'Gestion du personnel et suivi des ressources humaines.' },
  { code: 'bgrfm', sigle: 'BGRFM', nom: 'Bureau de Gestion des Ressources financières et matérielles', desc: 'Suivi des ressources financières, du matériel et des équipements.' },
  { code: 'bse', sigle: 'BSE', nom: 'Bureau des Statistiques éducatives', desc: 'Collecte, traitement et suivi des données statistiques des écoles.' },
  { code: 'bec', sigle: 'BEC', nom: 'Bureau des Examens et Concours', desc: 'Organisation et suivi des examens et concours scolaires.' },
  { code: 'bascl', sigle: 'BASCL', nom: 'Bureau des Activités sportives, culturelles et des loisirs', desc: 'Activités sportives, culturelles et récréatives.' },
  { code: 'bepres', sigle: 'BEPres', nom: "Bureau de l'Éducation préscolaire", desc: 'Suivi des structures et activités préscolaires.' },
  { code: 'beprim', sigle: 'BEPrim', nom: "Bureau de l'Enseignement primaire", desc: 'Suivi pédagogique et administratif des écoles primaires.' },
  { code: 'benf', sigle: 'BENF', nom: "Bureau de l'Éducation non formelle", desc: "Suivi des activités d'éducation non formelle." }
];
/* Nature du document → bureau qui le reçoit (l'expéditeur peut ajuster) */
const BUREAU_NATURES = [
  { code: 'courrier', label: 'Courrier et correspondance générale', bureau: 'scr' },
  { code: 'personnel', label: 'Personnel : congés, affectations, prises de service, absences', bureau: 'bgrh' },
  { code: 'finances', label: 'Finances et matériel : rapports financiers, inventaires, besoins', bureau: 'bgrfm' },
  { code: 'statistiques', label: 'Statistiques : effectifs, données de rentrée, enquêtes', bureau: 'bse' },
  { code: 'examens', label: 'Examens et concours : listes, procès-verbaux, résultats', bureau: 'bec' },
  { code: 'activites', label: 'Activités sportives, culturelles et loisirs', bureau: 'bascl' },
  { code: 'prescolaire', label: 'Éducation préscolaire', bureau: 'bepres' },
  { code: 'pedagogie', label: 'Enseignement primaire : pédagogie, visites, évaluations', bureau: 'beprim' },
  { code: 'enf', label: 'Éducation non formelle', bureau: 'benf' }
];
const bureauInfo = (c) => BUREAUX.find((b) => b.code === c) || { code: c, sigle: c || 'Bureau', nom: 'Bureau de la CEB', desc: '' };

/* ---------- Droits : le bureau est un compte du réseau, limité aux publications ---------- */
ROLES_RESEAU.push('bureau');
ROUTE_ROLES['#/publications'].push('bureau');
const _bLabelRole = labelRole;
labelRole = function (r) { return r === 'bureau' ? 'Bureau de la CEB' : _bLabelRole(r); };
resNiveau = function () {
  if (!currentUser) return null;
  const r = currentUser.role;
  if (r === 'bureau') return 'ceb';
  if (ROLES_RESEAU.includes(r)) return r;
  if (['directeur', 'directeur_adjoint', 'secretaire'].includes(r)) return 'ecole';
  return null;
};
const _bMsg = resMsgErreur;
resMsgErreur = function (e) {
  const m = String((e && (e.message || e.details)) || e || '');
  if (/bureaux|bureau_emetteur|nature|profiles_bureau|profiles_role_check/i.test(m) && /column|schema cache|constraint|does not exist/i.test(m))
    return "La base n'est pas à jour pour les bureaux : exécutez supabase-bureaux.sql dans Supabase (SQL Editor), puis rechargez.";
  return _bMsg(e);
};

/* ---------- Chargement : colonnes des bureaux, avec repli si la base n'est pas encore à jour ---------- */
resCharger = async function () {
  const supa = window.supaClient;
  const base = 'id,niveau,emetteur_id,emetteur_nom,structure,region,province,ceb,cibles,categorie,reference,objet,echeance,pj_nom,created_at';
  const req = (cols) => supa.from('circuit_documents').select(cols).order('created_at', { ascending: false }).limit(300);
  let d = await req(base + ',bureaux,bureau_emetteur,nature');
  if (d.error) d = await req(base);
  const a = await supa.from('circuit_accuses').select('doc_id,user_id,nom,structure,accuse_le');
  if (d.error) throw d.error;
  const docs = (d.data || []).map((x) => {
    const bx = x.bureaux || [];
    if (bx.length && x.cibles.includes('ceb')) x.cibles = x.cibles.map((c) => (c === 'ceb' ? 'CEB (' + bx.map((b) => bureauInfo(b).sigle).join(', ') + ')' : c));
    if (x.nature && bx.length) x.categorie = bx.map((b) => bureauInfo(b).sigle).join(', ') + (x.categorie ? ' · ' + x.categorie : '');
    return x;
  });
  return { docs, accuses: a.error ? [] : (a.data || []) };
};

/* ---------- Formulaire « Publier un document » (avec bureaux) ---------- */
resFormPublier = function (niveau) {
  const manque = resZoneManquante(niveau);
  if (manque === 'rattachement') { toast("Rattachez d'abord votre école à sa CEB (carte en haut de la page)."); return; }
  if (manque) { toast(`Votre compte n'a pas ${manque} renseignée : contactez la structure qui a créé votre compte.`); return; }
  const modeBureau = currentUser.role === 'bureau';
  const autres = RES_NIVEAUX.filter((n) => n !== niveau);
  const defauts = RES_CIBLES_DEFAUT[niveau] || [];
  let pj = null;
  const bureauxUI = niveau !== 'ceb' ? `
      <div class="field full" id="pu-bx-box"><label>Nature du document (bureau de la CEB concerné)</label>
        <select id="pu-nature">${BUREAU_NATURES.map((n) => `<option value="${n.code}">${esc(n.label)} → ${esc(bureauInfo(n.bureau).sigle)}</option>`).join('')}</select>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;">${BUREAUX.map((b) => `<label style="display:flex;gap:6px;font-weight:400;align-items:center;"><input type="checkbox" class="pu-bx" value="${b.code}" ${b.code === 'scr' ? 'checked' : ''}>${esc(b.sigle)}</label>`).join('')}</div>
        <small>Le bureau coché reçoit le document dans son compte. Sans bureau précis, le Secrétariat le reçoit.</small></div>` : '';
  const ov = openModal('Publier un document', `
    <div class="form-grid">
      <div class="field full"><label>Objet *</label><input id="pu-objet"></div>
      ${modeBureau ? `<div class="field full"><label>Destinataires</label><div class="alert alert-vert" style="margin:0;">Toutes les écoles de la CEB ${esc(currentUser.ceb || '')}.</div></div>` : `
      <div class="field full"><label>Destinataires * <span class="text-soft" style="font-weight:400;">(plusieurs choix possibles)</span></label>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${autres.map((n) => `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;"><input type="checkbox" class="pu-cible" value="${n}" ${defauts.includes(n) ? 'checked' : ''} style="margin-top:3px;"><span><b>${esc(resSigle(n))}</b> <span class="text-soft">${esc(resPortee(niveau, n))}</span></span></label>`).join('')}
        </div></div>${bureauxUI}`}
      <div class="field"><label>Type de document</label><select id="pu-cat">${RES_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Référence / n°</label><input id="pu-ref" placeholder="Ex : N°2026-014/…"></div>
      <div class="field"><label>À traiter avant le</label><input type="date" id="pu-ech"></div>
      <div class="field full"><label>Texte / instructions</label><textarea id="pu-txt" style="min-height:120px;"></textarea></div>
      <div class="field full"><label>Pièce jointe (PDF, image, Word…, 1,5 Mo max)</label><input type="file" id="pu-pj"><small id="pu-pj-info"></small></div>
    </div>`, {
    saveLabel: 'Publier',
    onSave: async (o) => {
      const objet = $('#pu-objet', o).value.trim();
      const cibles = modeBureau ? ['ecole'] : $all('.pu-cible', o).filter((c) => c.checked).map((c) => c.value);
      if (!objet) { toast("Indiquez l'objet du document."); return false; }
      if (!cibles.length) { toast('Choisissez au moins un destinataire.'); return false; }
      const z = resZone(niveau), ech = $('#pu-ech', o).value;
      const versBureaux = !modeBureau && cibles.includes('ceb') && niveau !== 'ceb';
      const bureaux = versBureaux ? $all('.pu-bx', o).filter((c) => c.checked).map((c) => c.value) : [];
      const row = {
        niveau, emetteur_id: currentUser.id, emetteur_nom: currentUser.nom,
        structure: currentUser.structure || null, region: z.region, province: z.province, ceb: z.ceb,
        cibles, categorie: $('#pu-cat', o).value, reference: $('#pu-ref', o).value.trim() || null,
        objet, contenu: $('#pu-txt', o).value.trim() || null, echeance: ech || null,
        pj_nom: pj ? pj.nom : null, pj_type: pj ? pj.type : null, pj_data: pj ? pj.data : null
      };
      const extra = modeBureau ? { bureau_emetteur: currentUser.bureau, bureaux: [] } : (versBureaux ? { bureaux, nature: $('#pu-nature', o).value } : null);
      const btn = $('.modal-save', o); btn.disabled = true;
      let repli = false;
      let { error } = await window.supaClient.from('circuit_documents').insert(extra ? { ...row, ...extra } : row);
      // Base pas encore mise à jour : les documents ordinaires partent quand même (sans bureau)
      if (error && !modeBureau && extra && /bureaux|nature|schema cache|column/i.test(String(error.message || ''))) {
        ({ error } = await window.supaClient.from('circuit_documents').insert(row));
        if (!error) { repli = true; toast("Publié, mais sans bureau : exécutez supabase-bureaux.sql pour activer les bureaux."); }
      }
      btn.disabled = false;
      if (error) { toast(resMsgErreur(error)); return false; }
      if (!repli) toast('Document publié.');
      RES_ETAT.onglet = 'publies'; onRouteChange(); return true;
    }
  });
  const nat = $('#pu-nature', ov), cb = $('.pu-cible[value="ceb"]', ov);
  if (nat) {
    nat.onchange = () => { const b = BUREAU_NATURES.find((n) => n.code === nat.value).bureau; $all('.pu-bx', ov).forEach((c) => { c.checked = c.value === b; }); };
    const montrer = () => { $('#pu-bx-box', ov).style.display = cb && cb.checked ? '' : 'none'; };
    if (cb) cb.onchange = montrer; montrer();
  }
  $('#pu-pj', ov).onchange = async (e) => {
    const f = e.target.files[0]; pj = null; $('#pu-pj-info', ov).textContent = '';
    if (!f) return;
    if (f.size > RES_PJ_MAX) { toast('Pièce jointe trop volumineuse (1,5 Mo maximum).'); e.target.value = ''; return; }
    pj = { nom: f.name, type: f.type || 'application/octet-stream', data: await exLireBase64(f) };
    $('#pu-pj-info', ov).textContent = `${f.name} — ${Math.round(f.size / 1024)} Ko`;
  };
};

/* ---------- Tableau de bord d'un bureau ---------- */
{
  const _avant = ROUTES['#/dashboard'];
  ROUTES['#/dashboard'] = async (root) => {
    if (!currentUser || currentUser.role !== 'bureau') return _avant(root);
    const b = bureauInfo(currentUser.bureau);
    let recus = '—', aTraiter = '—', publies = '—';
    try {
      const { docs, accuses } = await resCharger();
      const moi = currentUser.id, mes = new Set(accuses.filter((x) => x.user_id === moi).map((x) => x.doc_id));
      const r = docs.filter((x) => x.emetteur_id !== moi);
      recus = r.length; aTraiter = r.filter((x) => !mes.has(x.id)).length; publies = docs.length - r.length;
    } catch (e) { /* hors ligne */ }
    root.innerHTML = `
      <div class="dash-hero"><div class="dash-hero-row"><div>
        <div class="eyebrow">${esc(currentUser.structure || 'Bureau de la CEB')}</div>
        <h1>${esc(b.sigle)} — ${esc(b.nom)}</h1><div class="sub">${esc(b.desc)}</div></div>
        <div class="date-chip">Connecté : ${esc(currentUser.nom)}</div></div></div>
      <div class="grid grid-3">
        <div class="card stat-card c-ocre"><div class="label">Documents à accuser</div><div class="value">${aTraiter}</div><div class="foot">envoyés par les écoles ou la hiérarchie</div></div>
        <div class="card stat-card c-indigo"><div class="label">Documents reçus</div><div class="value">${recus}</div></div>
        <div class="card stat-card c-vert"><div class="label">Documents envoyés aux écoles</div><div class="value">${publies}</div></div>
      </div>
      <div class="card" style="margin-top:14px;"><div class="flex gap-8" style="flex-wrap:wrap;">
        <a class="btn btn-accent" href="#/publications" onclick="RES_ETAT.onglet='recus'">Documents reçus</a>
        <button class="btn btn-primary" id="bu-envoyer">+ Envoyer un document aux écoles</button>
        <a class="btn" href="#/publications" onclick="RES_ETAT.onglet='publies'">Documents envoyés</a>
      </div></div>`;
    $('#bu-envoyer', root).onclick = () => resFormPublier('ceb');
  };
}

/* ---------- Comptes des bureaux : section ajoutée à « Comptes des structures » du CCEB ---------- */
{
  const _avant = ROUTES['#/comptes-reseau'];
  ROUTES['#/comptes-reseau'] = async (root) => {
    await _avant(root);
    if (currentUser.role === 'ceb') await bureauxSection(root);
  };
}
async function bureauxSection(root) {
  const box = document.createElement('div'); box.className = 'card'; box.style.marginTop = '14px';
  box.innerHTML = `<h3 style="margin:0 0 4px;">Bureaux de la CEB</h3>
    <p class="text-soft">Créez le compte de chaque bureau. Un bureau envoie des documents aux écoles de la CEB et reçoit ceux qui le concernent. Vous voyez tous les documents.</p>
    <div id="bu-liste"><p class="text-soft">Chargement…</p></div>`;
  root.appendChild(box);
  const { data, error } = await window.supaClient.from('profiles').select('id,nom,bureau,structure').eq('role', 'bureau');
  const zone = $('#bu-liste', box);
  if (error) { zone.innerHTML = `<div class="alert alert-ocre">${esc(resMsgErreur(error))}</div>`; return; }
  const parCode = Object.fromEntries((data || []).map((p) => [p.bureau, p]));
  zone.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Bureau</th><th>Responsable</th><th>Compte</th><th></th></tr></thead><tbody>
    ${BUREAUX.map((b) => { const p = parCode[b.code]; return `<tr><td class="wrap"><b>${esc(b.sigle)}</b><br><span class="text-soft" style="font-size:12px;">${esc(b.nom)}</span></td>
      <td>${p ? esc(p.nom) : '—'}</td><td>${p ? '<span class="badge badge-vert">Créé</span>' : '<span class="badge badge-ocre">À créer</span>'}</td>
      <td>${p ? `<button class="btn btn-sm btn-danger" data-bu-retirer="${p.id}">Retirer l'accès</button>` : `<button class="btn btn-sm btn-primary" data-bu-creer="${b.code}">Créer le compte</button>`}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $all('[data-bu-creer]', zone).forEach((b) => { b.onclick = () => bureauFormCompte(b.dataset.buCreer); });
  $all('[data-bu-retirer]', zone).forEach((b) => {
    b.onclick = async () => {
      const p = (data || []).find((x) => x.id === b.dataset.buRetirer);
      if (!p || !(await confirmDialog(`Retirer l'accès du bureau « ${bureauInfo(p.bureau).sigle} » (${p.nom}) ?`))) return;
      const { error: e } = await window.supaClient.from('profiles').delete().eq('id', p.id);
      if (e) { toast(resMsgErreur(e)); return; }
      toast('Accès retiré.'); onRouteChange();
    };
  });
}

function bureauFormCompte(code) {
  const me = currentUser, b = bureauInfo(code);
  if (!me.region || !me.province || !me.ceb) { toast("Votre compte n'a pas sa région, sa province ou sa CEB renseignée : contactez la structure qui l'a créé."); return; }
  const mdp0 = (typeof genererMotDePasse === 'function') ? genererMotDePasse() : Math.random().toString(36).slice(2, 10).toUpperCase();
  openModal(`Créer le compte — ${b.sigle}`, `
    <p class="text-soft">${esc(b.nom)}</p>
    <div class="form-grid">
      <div class="field full"><label>Nom du responsable du bureau *</label><input id="bc-nom" placeholder="Ex : M. Ouédraogo"></div>
      <div class="field full"><label>E-mail de connexion *</label><input id="bc-email" type="email" placeholder="Ex : bgrh@exemple.bf"></div>
      <div class="field full"><label>Mot de passe initial</label><input id="bc-mdp" value="${esc(mdp0)}"><small>Généré automatiquement — notez-le pour le communiquer au responsable.</small></div>
    </div>`, {
    saveLabel: 'Créer le compte',
    onSave: async (o) => {
      const nom = $('#bc-nom', o).value.trim(), email = $('#bc-email', o).value.trim(), mdp = $('#bc-mdp', o).value;
      if (!nom || !email || !mdp) { toast('Tous les champs sont obligatoires.'); return false; }
      if (mdp.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères.'); return false; }
      let temp;
      try { temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
      catch (e) { toast("Impossible d'initialiser la création de compte."); return false; }
      const { data, error } = await temp.auth.signUp({ email, password: mdp });
      if (error) { toast('Création impossible : ' + (error.message || 'erreur inconnue')); return false; }
      if (!data.user) { toast('Réponse inattendue du serveur.'); return false; }
      const profil = { id: data.user.id, nom, role: 'bureau', bureau: code, structure: `${b.sigle} — ${me.structure || 'CEB ' + me.ceb}`, region: me.region, province: me.province, ceb: me.ceb };
      const { error: e2 } = await window.supaClient.from('profiles').insert(profil);
      if (e2) { toast('Compte de connexion créé, mais profil refusé : ' + resMsgErreur(e2)); return false; }
      o.querySelector('.modal-head h3').textContent = 'Compte créé';
      o.querySelector('.modal-body').innerHTML = `<p>Le compte du bureau <strong>${esc(b.sigle)}</strong> (${esc(nom)}) est créé. Communiquez-lui :</p>
        <div class="card"><p style="margin:4px 0;"><strong>E-mail :</strong> ${esc(email)}</p><p style="margin:4px 0;"><strong>Mot de passe :</strong> ${esc(mdp)}</p></div>`;
      o.querySelector('.modal-foot').innerHTML = `<button class="btn btn-primary" id="bc-fermer">Fermer</button>`;
      $('#bc-fermer', o).addEventListener('click', () => { closeModal(); onRouteChange(); });
      return false;
    }
  });
}
