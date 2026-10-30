/* ============================================================
   app-parents.js — Espace parents (NOUVEAU MODULE)
   ------------------------------------------------------------
   Deux faces :
   1. #/gestion-parents (direction) : créer les comptes parents, les lier
      à leurs enfants, publier les fiches de suivi, rédiger les annonces.
   2. afficherEspaceParent() : écran réservé au rôle « parent » (affiché
      à la place de l'application de l'école).

   Sécurité : un parent n'a AUCUN accès aux données de l'école (app_data).
   La direction publie, depuis son appareil, une fiche par enfant lié dans
   la table parents_fiches ; les règles RLS (supabase-setup.sql) ne
   laissent lire à un parent que les fiches de ses propres enfants.
   ============================================================ */

const PARENT_DOMAINE = 'parents.ecole.bf';
const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0).replace(/[\u202f\u00a0]/g, ' ') + ' FCFA';

/* Identifiant saisi (e-mail ou n° de téléphone) → adresse e-mail de connexion */
function identifiantVersEmail(saisie) {
  const s = String(saisie || '').trim();
  if (s.includes('@')) return s;
  const chiffres = s.replace(/\D/g, '');
  return chiffres ? `${chiffres}@${PARENT_DOMAINE}` : s;
}

/* ====================== 1. Côté direction ====================== */
const gpErr = (e) => (e && e.message ? e.message : 'erreur inconnue');
const gpSqlManquant = '<p class="text-soft">Les tables de l\'espace parents sont introuvables. Exécutez à nouveau <code>supabase-setup.sql</code> dans Supabase (SQL Editor) puis rechargez cette page.</p>';

async function gpEnfantsUuid() {
  const eleves = await DB.getAll('eleves');
  for (const e of eleves) { if (!e._uuid) await DB.put('eleves', e); } // attribue l'identifiant de synchronisation
  return DB.getAll('eleves');
}

ROUTES['#/gestion-parents'] = async (root) => {
  root.innerHTML = `
    <div class="card" id="gp-comptes"></div>
    <div class="card" id="gp-pub" style="margin-top:16px;"></div>
    <div id="gp-annonces" style="margin-top:16px;"></div>`;
  gpAfficherPublication();
  gpAfficherComptes();
  const classes = await DB.getAll('classes');
  renderCrudView($('#gp-annonces'), {
    store: 'annoncesParents', title: 'Annonces aux parents',
    subtitle: 'Visibles dans l\'espace parents après « Publier maintenant ».',
    searchKeys: ['titre', 'message'],
    fields: [
      { key: 'titre', label: 'Titre', type: 'text', full: true, required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'classeNom', label: 'Destinataires', type: 'select', options: [{ value: '', label: 'Toute l\'école' }, ...classes.map((c) => ({ value: c.nom, label: 'Classe ' + c.nom }))] },
      { key: 'message', label: 'Message', type: 'textarea', full: true, required: true }
    ],
    columns: [
      { key: 'date', label: 'Date', render: (r) => formatDate(r.date) }, { key: 'titre', label: 'Titre' },
      { key: 'classeNom', label: 'Pour', render: (r) => esc(r.classeNom || 'Toute l\'école') }
    ]
  });
};

async function gpAfficherComptes() {
  const box = $('#gp-comptes');
  box.innerHTML = '<p class="text-soft">Chargement…</p>';
  const [pr, li, eleves, classes] = await Promise.all([
    window.supaClient.from('profiles').select('id,nom').eq('role', 'parent'),
    window.supaClient.from('parents_liens').select('*'),
    gpEnfantsUuid(), DB.getAll('classes')
  ]);
  if (pr.error || li.error) { box.innerHTML = `<h3>Comptes parents</h3>${gpSqlManquant}<p class="text-soft">${esc(gpErr(pr.error || li.error))}</p>`; return; }
  const parUuid = new Map(eleves.map((e) => [e._uuid, e]));
  const nomClasse = (id) => (classes.find((c) => c.id === id) || {}).nom || '';
  const cartes = pr.data.sort((a, b) => a.nom.localeCompare(b.nom)).map((p) => {
    const enfants = li.data.filter((l) => l.parent_id === p.id);
    return `<div class="card" style="margin-top:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <strong>${esc(p.nom)}</strong>
        <span><button class="btn btn-sm" data-add="${p.id}">+ Enfant</button> <button class="btn btn-sm btn-danger" data-del="${p.id}">Supprimer le compte</button></span>
      </div>
      <div style="margin-top:8px;">${enfants.length ? enfants.map((l) => {
        const e = parUuid.get(l.eleve_uuid);
        return `<span class="badge" style="margin:2px 4px 2px 0;">${e ? esc(e.nom + ' ' + (e.prenom || '')) + ' — ' + esc(nomClasse(e.classeId)) : 'Élève introuvable'}${l.lien ? ' (' + esc(l.lien) + ')' : ''} <a href="#" data-unlink="${p.id}|${l.eleve_uuid}" title="Retirer" style="text-decoration:none;">✕</a></span>`;
      }).join('') : '<span class="text-soft">Aucun enfant lié</span>'}</div></div>`;
  }).join('');
  box.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <h3 style="margin:0;">Comptes parents</h3><button class="btn btn-primary btn-sm" id="gp-new">+ Créer un compte parent</button></div>
    <p class="text-soft" style="font-size:13px;">Le parent se connecte avec son e-mail ou son numéro de téléphone et ne voit que les fiches de ses enfants.</p>
    ${cartes || '<p class="text-soft">Aucun compte parent pour l\'instant.</p>'}`;

  $('#gp-new', box).onclick = () => gpCreerCompte(eleves, classes);
  box.onclick = async (ev) => {
    const t = ev.target.closest('[data-add],[data-del],[data-unlink]'); if (!t) return;
    ev.preventDefault();
    if (t.dataset.add) return gpAjouterEnfants(t.dataset.add, eleves, classes, li.data);
    if (t.dataset.unlink) {
      const [pid, uuid] = t.dataset.unlink.split('|');
      const { error } = await window.supaClient.from('parents_liens').delete().eq('parent_id', pid).eq('eleve_uuid', uuid);
      if (error) return toast('Échec : ' + gpErr(error));
      return gpAfficherComptes();
    }
    if (t.dataset.del && await confirmDialog('Supprimer ce compte parent ? Il ne pourra plus accéder à l\'espace parents.')) {
      await window.supaClient.from('parents_liens').delete().eq('parent_id', t.dataset.del);
      const { error } = await window.supaClient.from('profiles').delete().eq('id', t.dataset.del);
      if (error) return toast('Échec : ' + gpErr(error));
      gpAfficherComptes();
    }
  };
}

/* Sélecteur d'enfants : recherche + cases à cocher, la sélection est conservée dans `choix` */
function gpSelecteurEnfants(zone, eleves, classes, choix, exclus) {
  const nomClasse = (id) => (classes.find((c) => c.id === id) || {}).nom || '';
  const actifs = eleves.filter((e) => (e.statut || 'actif') === 'actif' && !(exclus || new Set()).has(e._uuid))
    .sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
  zone.innerHTML = `<input class="gp-q" placeholder="Rechercher un élève (nom, prénom, matricule)…" style="width:100%; margin-bottom:6px;"><div class="gp-liste" style="max-height:220px; overflow:auto;"></div>`;
  const liste = $('.gp-liste', zone);
  const dessiner = () => {
    const q = $('.gp-q', zone).value.trim().toLowerCase();
    const trouves = actifs.filter((e) => choix.has(e._uuid) || !q || `${e.nom} ${e.prenom} ${e.matricule || ''}`.toLowerCase().includes(q)).slice(0, 40);
    liste.innerHTML = trouves.map((e) => `<label style="display:flex; gap:8px; align-items:center; padding:4px 0;"><input type="checkbox" data-u="${e._uuid}" ${choix.has(e._uuid) ? 'checked' : ''}> ${esc(e.nom)} ${esc(e.prenom || '')} — ${esc(nomClasse(e.classeId))}</label>`).join('') || '<p class="text-soft">Aucun élève trouvé.</p>';
  };
  $('.gp-q', zone).oninput = dessiner;
  liste.onchange = (ev) => { const u = ev.target.dataset.u; if (u) { ev.target.checked ? choix.add(u) : choix.delete(u); } };
  dessiner();
}

async function gpCreerCompte(eleves, classes) {
  const choix = new Set();
  const mdp0 = genererMotDePasse();
  const overlay = openModal('Créer un compte parent', `
    <div class="form-grid">
      <div class="field"><label>Nom du parent / tuteur *</label><input id="gp-nom" placeholder="Ex : Mme Ouédraogo"></div>
      <div class="field"><label>Lien avec l'enfant</label><select id="gp-lien"><option>Père</option><option>Mère</option><option>Tuteur</option><option>Tutrice</option></select></div>
      <div class="field full"><label>E-mail ou numéro de téléphone *</label><input id="gp-id" placeholder="Ex : 70 12 34 56 ou parent@mail.com"></div>
      <div class="field full"><label>Mot de passe initial</label><input id="gp-mdp" value="${mdp0}"></div>
      <div class="field full"><label>Enfant(s) à lier *</label><div id="gp-enfants"></div></div>
    </div>`, {
    saveLabel: 'Créer le compte',
    onSave: async (ov) => {
      const nom = $('#gp-nom', ov).value.trim(), saisie = $('#gp-id', ov).value.trim(), mdp = $('#gp-mdp', ov).value, lien = $('#gp-lien', ov).value;
      if (!nom || !saisie || !choix.size) { toast('Nom, identifiant et au moins un enfant sont obligatoires.'); return false; }
      if (mdp.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères.'); return false; }
      const email = identifiantVersEmail(saisie);
      const temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await temp.auth.signUp({ email, password: mdp });
      if (error || !data.user) { toast('Création impossible : ' + gpErr(error) + '. Si l\'adresse est refusée, utilisez une vraie adresse e-mail.'); return false; }
      const { error: e1 } = await window.supaClient.from('profiles').insert({ id: data.user.id, nom, role: 'parent' });
      if (e1) { toast('Compte créé mais profil refusé : ' + gpErr(e1) + ' (relancez supabase-setup.sql).'); return false; }
      const { error: e2 } = await window.supaClient.from('parents_liens').insert([...choix].map((u) => ({ parent_id: data.user.id, eleve_uuid: u, lien })));
      if (e2) { toast('Liaison aux enfants impossible : ' + gpErr(e2)); return false; }
      const enfants = eleves.filter((e) => choix.has(e._uuid)).map((e) => `${e.nom} ${e.prenom || ''}`.trim());
      ov.querySelector('.modal-head h3').textContent = 'Compte créé';
      ov.querySelector('.modal-body').innerHTML = `<p>Compte de <strong>${esc(nom)}</strong> créé. Communiquez ces accès :</p>
        <div class="card"><p><strong>Identifiant :</strong> ${esc(saisie)}</p><p><strong>Mot de passe :</strong> ${esc(mdp)}</p><p><strong>Adresse :</strong> ${esc(location.origin)}</p></div>
        <p class="text-soft">Les informations apparaîtront après « Publier maintenant ».</p>`;
      ov.querySelector('.modal-foot').innerHTML = '<button class="btn" id="gp-print">Imprimer la fiche d\'accès</button> <button class="btn btn-primary" id="gp-ok">Fermer</button>';
      $('#gp-ok', ov).onclick = () => closeModal();
      $('#gp-print', ov).onclick = () => { closeModal(); printDocument('Accès à l\'espace parents', `
        <h3 style="text-align:center;">ACCÈS À L'ESPACE PARENTS</h3>
        <p>Madame, Monsieur <strong>${esc(nom)}</strong>,</p>
        <p>Vous pouvez suivre la scolarité de : <strong>${esc(enfants.join(', '))}</strong> (présences, résultats, cotisation, annonces).</p>
        <table style="width:100%; border-collapse:collapse;" border="1" cellpadding="8"><tr><td>Adresse</td><td>${esc(location.origin)}</td></tr><tr><td>Identifiant</td><td>${esc(saisie)}</td></tr><tr><td>Mot de passe</td><td>${esc(mdp)}</td></tr></table>
        <p style="font-size:12px;">Gardez ces informations confidentielles.</p>`); };
      gpAfficherComptes();
      return false;
    }
  });
  gpSelecteurEnfants($('#gp-enfants', overlay), eleves, classes, choix);
}

async function gpAjouterEnfants(parentId, eleves, classes, liens) {
  const choix = new Set(), deja = new Set(liens.filter((l) => l.parent_id === parentId).map((l) => l.eleve_uuid));
  const overlay = openModal('Ajouter un enfant', '<div id="gp-enfants"></div>', {
    saveLabel: 'Ajouter',
    onSave: async () => {
      if (!choix.size) { toast('Choisissez au moins un élève.'); return false; }
      const { error } = await window.supaClient.from('parents_liens').insert([...choix].map((u) => ({ parent_id: parentId, eleve_uuid: u })));
      if (error) { toast('Échec : ' + gpErr(error)); return false; }
      gpAfficherComptes();
    }
  });
  gpSelecteurEnfants($('#gp-enfants', overlay), eleves, classes, choix, deja);
}

/* ---------- Fiche de suivi d'un élève (données publiées aux parents) ---------- */
async function gpConstruireFiches(eleves, meta) {
  const [classes, ens, presences, evals, cotis, discAll] = await Promise.all([DB.getAll('classes'), DB.getAll('enseignants'), DB.getAll('presencesEleves'), DB.getAll('evaluations'), DB.getAll('cotisations'), DB.getAll('discipline')]);
  const y0 = Number(String(meta.anneeScolaire || '').split('-')[0]) || new Date().getFullYear();
  const debut = `${y0}-09-01`, fin = `${y0 + 1}-08-31`;
  return eleves.map((e) => {
    const classe = classes.find((c) => c.id === e.classeId) || {};
    const profs = enseignantsDeClasse({ ...classe, id: e.classeId }, ens);
    const prof = profs.find((x) => x.id === classe.enseignantId) || profs[0];
    const pres = presences.filter((p) => p.eleveId === e.id && p.date >= debut && p.date <= fin);
    const nb = (s) => pres.filter((p) => p.statut === s).length;
    const evaluations = evals.filter((ev) => ev.classeId === e.classeId && ev.statut === 'publie').map((ev) => {
      const matieres = (ev.notes || []).filter((n) => n.eleveId === e.id).map((n) => {
        const v = noteSur20(ev, n); if (v === null) return null;
        const m = matiereDefDeNote(ev, n.matiereId);
        return { nom: m ? m.nom : (ev.nom || 'Discipline'), note: Math.round(v * 100) / 100, coef: m ? Number(m.coefficient) || 1 : 1 };
      }).filter(Boolean);
      if (!matieres.length) return null;
      const somme = matieres.reduce((t, m) => t + m.coef, 0);
      return { nom: ev.nom || 'Évaluation', date: ev.date || '', matieres, moyenne: Math.round((matieres.reduce((t, m) => t + m.note * m.coef, 0) / somme) * 100) / 100 };
    }).filter(Boolean).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const cot = cotis.find((c) => c.eleveId === e.id);
    // Bulletin : moyenne par matière (évaluations publiées seulement) + moyenne générale pondérée
    const parMatiere = {};
    evals.filter((ev) => ev.classeId === e.classeId && ev.statut === 'publie').forEach((ev) => {
      (ev.notes || []).filter((n) => n.eleveId === e.id).forEach((n) => {
        const v = noteSur20(ev, n); if (v === null || v === undefined || Number.isNaN(v)) return;
        const m = matiereDefDeNote(ev, n.matiereId);
        const nom = m ? m.nom : (ev.discipline || ev.nom || 'Matière');
        (parMatiere[nom] = parMatiere[nom] || { notes: [], coef: m ? (Number(m.coefficient) || 1) : 1 }).notes.push(v);
      });
    });
    const matBul = Object.entries(parMatiere).map(([nom, i]) => ({ nom, coef: i.coef, nb: i.notes.length, moyenne: Math.round((i.notes.reduce((a, b) => a + b, 0) / i.notes.length) * 100) / 100 }));
    const sCoef = matBul.reduce((t, m) => t + m.coef, 0);
    const bulletinEleve = { matieres: matBul, moyenneGenerale: sCoef ? Math.round((matBul.reduce((t, m) => t + m.moyenne * m.coef, 0) / sCoef) * 100) / 100 : null };
    return { uuid: e._uuid, data: {
      ecole: meta.nomEcole || '', directeur: meta.nomDirecteur || '', annee: meta.anneeScolaire || '', base: typeof MOYENNE_BASE !== 'undefined' ? MOYENNE_BASE : 10,
      nom: e.nom || '', prenom: e.prenom || '', matricule: e.matricule || '', classe: classe.nom || '',
      enseignant: profs.length ? [prof, ...profs.filter((x) => x !== prof)].map((p) => `${p.nom || ''} ${p.prenom || ''}`.trim()).join(', ') : '',
      presences: { presents: nb('present'), absents: pres.filter((p) => p.statut !== 'present' && p.statut !== 'retard').length, retards: nb('retard'),
        jours: pres.slice().sort((a, b) => b.date.localeCompare(a.date)).map((p) => ({ d: p.date, s: p.statut, m: p.motif || '' })),
        dernieres: pres.filter((p) => p.statut !== 'present').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((p) => ({ date: p.date, statut: p.statut, motif: p.motif || '' })) },
      evaluations,
      moyenneGenerale: evaluations.length ? Math.round((evaluations.reduce((t, x) => t + x.moyenne, 0) / evaluations.length) * 100) / 100 : null,
      cotisation: cot ? { attendu: Number(cot.montantAttendu) || 0, paye: Number(cot.montantPaye) || 0,
        paiements: (cot.paiements || []).map((p, i, arr) => ({ date: p.date, montant: Number(p.montant) || 0, mode: p.mode || '', recu: p.recu || '', cumul: arr.slice(0, i + 1).reduce((t, x) => t + (Number(x.montant) || 0), 0) })) } : null,
      bulletin: bulletinEleve,
      discipline: discAll.filter((d) => d.cibleType === 'eleve' && Number(d.cibleId) === e.id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).map((d) => ({ date: d.date || '', type: d.type || '', motif: d.motif || '', decision: d.decision || '' })),
      maj: new Date().toISOString()
    } };
  });
}

function gpAfficherPublication() {
  const box = $('#gp-pub');
  const derniere = localStorage.getItem('ecole-bf-parents-publication');
  box.innerHTML = `<h3>Publication</h3>
    <p class="text-soft" style="font-size:13px;">Les parents voient les informations telles qu'elles étaient à la <strong>dernière publication</strong> (présences au jour le jour, bulletin et résultats des évaluations publiées, reçus et cotisation, discipline, annonces). Publiez après chaque mise à jour importante.</p>
    <p style="font-size:13px;">Dernière publication : <strong>${derniere ? esc(new Date(derniere).toLocaleString('fr-FR')) : 'jamais'}</strong></p>
    <p class="text-soft" style="font-size:12px;">Publication <strong>automatique</strong> ~20 secondes après chaque modification (présences, évaluations, paiements, discipline), tant que l\'application est ouverte sur l\'appareil du directeur. Le bouton ci-dessous force une publication immédiate.</p>
    <button class="btn btn-primary" id="gp-publier">Publier maintenant</button>`;
  $('#gp-publier', box).onclick = async (ev) => {
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Publication…';
    try { const n = await gpPublier(); toast(`Publié : ${n.fiches} fiche(s), ${n.annonces} annonce(s).`); gpAfficherPublication(); }
    catch (e) { toast('Publication impossible : ' + gpErr(e)); btn.disabled = false; btn.textContent = 'Publier maintenant'; }
  };
}

async function gpPublier() {
  const sb = window.supaClient;
  const meta = (await DB.getAll('meta'))[0] || {};
  const { data: liens, error: eL } = await sb.from('parents_liens').select('eleve_uuid');
  if (eL) throw eL;
  const lies = new Set(liens.map((l) => l.eleve_uuid));
  const eleves = (await gpEnfantsUuid()).filter((e) => lies.has(e._uuid));
  const fiches = await gpConstruireFiches(eleves, meta);
  if (fiches.length) {
    const { error } = await sb.from('parents_fiches').upsert(fiches.map((f) => ({ eleve_uuid: f.uuid, data: f.data, updated_at: new Date().toISOString() })), { onConflict: 'eleve_uuid' });
    if (error) throw error;
  }
  // fiches d'enfants qui ne sont plus liés à personne
  const { data: exist } = await sb.from('parents_fiches').select('eleve_uuid');
  const orphelines = (exist || []).map((x) => x.eleve_uuid).filter((u) => !lies.has(u));
  if (orphelines.length) await sb.from('parents_fiches').delete().in('eleve_uuid', orphelines);
  // annonces
  const annonces = (await DB.getAll('annoncesParents')).filter((a) => a._uuid);
  if (annonces.length) {
    const { error } = await sb.from('parents_annonces').upsert(annonces.map((a) => ({ id: a._uuid, classe_nom: a.classeNom || null, data: { titre: a.titre, date: a.date, message: a.message }, updated_at: new Date().toISOString() })), { onConflict: 'id' });
    if (error) throw error;
  }
  const { data: ea } = await sb.from('parents_annonces').select('id');
  const gardees = new Set(annonces.map((a) => a._uuid));
  const aSupprimer = (ea || []).map((x) => x.id).filter((id) => !gardees.has(id));
  if (aSupprimer.length) await sb.from('parents_annonces').delete().in('id', aSupprimer);
  localStorage.setItem('ecole-bf-parents-publication', new Date().toISOString());
  return { fiches: fiches.length, annonces: annonces.length };
}

/* ---------- Publication automatique vers les comptes parents ----------
   Dès qu'une donnée utile aux parents change (présences, évaluations,
   paiements/reçus, discipline, élèves, annonces) — saisie locale OU reçue
   d'un autre appareil —, la fiche de chaque enfant lié est republiée ~20 s
   plus tard. Condition : une session directeur / adjoint doit être ouverte
   (seule la direction a le droit d'écrire dans parents_fiches). */
const GP_STORES_SUIVIS = new Set(['presencesEleves', 'evaluations', 'cotisations', 'discipline', 'eleves', 'classes', 'enseignants', 'annoncesParents', 'meta']);
let _gpTimer = null, _gpEnCours = false, _gpRelance = false;
function gpEstDirection() { return !!(typeof currentUser !== 'undefined' && currentUser && ['directeur', 'directeur_adjoint'].includes(currentUser.role) && window.supaClient); }
function gpPlanifier(delai) {
  if (!gpEstDirection()) return;
  clearTimeout(_gpTimer);
  _gpTimer = setTimeout(gpPublierAuto, delai || 20000);
}
async function gpPublierAuto() {
  if (!gpEstDirection()) return;
  if (_gpEnCours) { _gpRelance = true; return; }
  _gpEnCours = true;
  try {
    await gpPublier();
    if (document.getElementById('gp-pub')) gpAfficherPublication();
  } catch (e) { console.warn('Publication automatique aux parents impossible :', gpErr(e)); }
  finally { _gpEnCours = false; if (_gpRelance) { _gpRelance = false; gpPlanifier(5000); } }
}
window.gpNotifierChangement = (store) => { if (GP_STORES_SUIVIS.has(store)) gpPlanifier(); };
// première publication peu après l'ouverture de l'application par la direction
setTimeout(() => { if (gpEstDirection()) gpPlanifier(8000); }, 12000);

/* ====================== 2. Espace du parent ====================== */
function epFicheHtml(f, impression, idx) {
  const TS = impression ? 'style="width:100%;border-collapse:collapse;font-size:12px;" border="1" cellpadding="4"' : '';
  const tab = (tete, lignes) => `<div class="${impression ? '' : 'table-wrap'}"><table ${TS}><thead><tr>${tete.map((t) => `<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${lignes.join('')}</tbody></table></div>`;
  const p = f.presences || {}, base = f.base || 10;
  const statut = { present: ['vert', 'Présent(e)'], absent: ['terre', 'Absent(e)'], retard: ['ocre', 'Retard'], excuse: ['ocre', 'Excusé(e)'] };
  const badge = (s) => { const [c, l] = statut[s] || ['indigo', s || '—']; return impression ? l : `<span class="badge badge-${c}">${esc(l)}</span>`; };
  const jourFr = (d) => { const x = new Date(d + 'T12:00:00'); return Number.isNaN(x.getTime()) ? formatDate(d) : x.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }); };
  const sec = (titre) => `<h4 style="margin:16px 0 6px;">${esc(titre)}</h4>`;

  // Présences au jour le jour, regroupées par mois
  const jours = p.jours || [];
  const parMois = {};
  jours.forEach((j) => { (parMois[j.d.slice(0, 7)] = parMois[j.d.slice(0, 7)] || []).push(j); });
  const moisCles = Object.keys(parMois).sort().reverse();
  const moisLabel = (k) => { const x = new Date(k + '-15T12:00:00'); const t = x.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
  const blocMois = (k, ouvert) => {
    const l = parMois[k], a = l.filter((j) => j.s !== 'present' && j.s !== 'retard').length, r = l.filter((j) => j.s === 'retard').length;
    const t = tab(['Jour', 'Situation', 'Motif'], l.map((j) => `<tr><td>${esc(jourFr(j.d))}</td><td>${badge(j.s)}</td><td>${esc(j.m)}</td></tr>`));
    const titre = `${esc(moisLabel(k))} — ${l.length} appel(s), ${a} absence(s), ${r} retard(s)`;
    return impression ? `<h5 style="margin:10px 0 4px;">${titre}</h5>${t}` : `<details ${ouvert ? 'open' : ''} style="margin:6px 0;"><summary style="cursor:pointer; font-weight:600;">${titre}</summary>${t}</details>`;
  };
  const presHtml = jours.length ? moisCles.map((k, i) => blocMois(k, i === 0)).join('') : '<p class="text-soft">Le détail jour par jour apparaîtra à la prochaine publication de l\'école.</p>';

  // Bulletin
  const b = f.bulletin;
  const bulHtml = b && b.matieres && b.matieres.length
    ? `${tab(['Matière', 'Coef.', 'Nb notes', `Moyenne /${base}`], b.matieres.map((m) => `<tr><td>${esc(m.nom)}</td><td>${esc(m.coef)}</td><td>${esc(m.nb)}</td><td>${esc(m.moyenne)}</td></tr>`))}
       <p style="margin-top:8px;"><strong>Moyenne générale (pondérée) : ${esc(b.moyenneGenerale)} / ${base}</strong></p>`
    : '<p class="text-soft">Le bulletin sera disponible dès que des évaluations auront été publiées.</p>';

  // Détail des évaluations
  const evals = (f.evaluations || []).map((ev) => `<h5 style="margin:12px 0 4px;">${esc(ev.nom)}${ev.date ? ' — ' + esc(formatDate(ev.date)) : ''}</h5>${tab(['Discipline', `Note /${base}`], [
    ...ev.matieres.map((m) => `<tr><td>${esc(m.nom)}</td><td>${esc(m.note)}</td></tr>`), `<tr><td><strong>Moyenne</strong></td><td><strong>${esc(ev.moyenne)}</strong></td></tr>`])}`).join('');

  // Cotisation et reçus
  const c = f.cotisation;
  const recusHtml = c && (c.paiements || []).length
    ? tab(['Date', 'N° de reçu', 'Mode', 'Montant', ...(impression ? [] : [''])], c.paiements.map((x, j) => `<tr><td>${esc(formatDate(x.date))}</td><td>${esc(x.recu || '—')}</td><td>${esc(x.mode || '')}</td><td>${fcfa(x.montant)}</td>${impression ? '' : `<td><button class="btn btn-sm" data-recu="${idx}:${j}">Reçu</button></td>`}</tr>`))
    : '<p class="text-soft">Aucun paiement enregistré.</p>';
  const cotHtml = c
    ? `${tab(['Montant attendu', 'Montant payé', 'Reste à payer'], [`<tr><td>${fcfa(c.attendu)}</td><td>${fcfa(c.paye)}</td><td><strong>${fcfa(Math.max(0, c.attendu - c.paye))}</strong></td></tr>`])}${sec('Reçus de paiement')}${recusHtml}`
    : '<p class="text-soft">Aucune information de cotisation.</p>';

  // Discipline
  const typeD = { avertissement: ['ocre', 'Avertissement'], sanction: ['terre', 'Sanction'], recompense: ['vert', 'Récompense'] };
  const discHtml = (f.discipline || []).length
    ? tab(['Date', 'Type', 'Motif', 'Décision'], f.discipline.map((d) => { const [cl, l] = typeD[d.type] || ['indigo', d.type || '—']; return `<tr><td>${esc(formatDate(d.date))}</td><td>${impression ? esc(l) : `<span class="badge badge-${cl}">${esc(l)}</span>`}</td><td>${esc(d.motif)}</td><td>${esc(d.decision)}</td></tr>`; }))
    : '<p class="text-soft">Aucun évènement de discipline enregistré.</p>';

  return `<div style="margin-bottom:6px;"><strong>${esc(f.nom)} ${esc(f.prenom)}</strong> — Classe ${esc(f.classe)}${f.enseignant ? ' · Enseignant(e) : ' + esc(f.enseignant) : ''}${f.matricule ? ' · Matricule ' + esc(f.matricule) : ''}</div>
    <h4>Présences</h4>
    <p>Présent(e) : <strong>${p.presents || 0}</strong> · Absences : <strong>${p.absents || 0}</strong> · Retards : <strong>${p.retards || 0}</strong></p>
    ${presHtml}
    <h4 style="margin-top:18px;">Bulletin</h4>
    ${bulHtml}
    ${evals ? `${sec('Détail des évaluations')}${evals}` : ''}
    <h4 style="margin-top:18px;">Cotisation et reçus</h4>
    ${cotHtml}
    <h4 style="margin-top:18px;">Discipline</h4>
    ${discHtml}
    <p class="text-soft" style="font-size:12px;">Informations arrêtées au ${esc(new Date(f.maj).toLocaleString('fr-FR'))}.</p>`;
}

function epImprimerRecu(f, j) {
  const x = ((f.cotisation || {}).paiements || [])[j]; if (!x) return;
  const attendu = f.cotisation.attendu || 0, reste = Math.max(0, attendu - (x.cumul || 0));
  printDocument(`Reçu — ${f.prenom} ${f.nom}`, `<h3 style="text-align:center;">REÇU DE PAIEMENT</h3>
    <p style="text-align:center;">N° ${esc(x.recu || '—')} · ${esc(formatDate(x.date))}</p>
    <table style="width:100%;border-collapse:collapse;" border="1" cellpadding="6">
      <tr><td>Élève</td><td>${esc(f.nom)} ${esc(f.prenom)}</td></tr><tr><td>Matricule</td><td>${esc(f.matricule || '—')}</td></tr>
      <tr><td>Classe</td><td>${esc(f.classe)}</td></tr><tr><td>Motif</td><td>Cotisation scolaire</td></tr>
      <tr><td>Mode de paiement</td><td>${esc(x.mode || '—')}</td></tr>
      <tr><td><strong>Montant versé</strong></td><td><strong>${fcfa(x.montant)}</strong></td></tr>
      <tr><td>Total payé à cette date</td><td>${fcfa(x.cumul || 0)}</td></tr><tr><td>Montant attendu</td><td>${fcfa(attendu)}</td></tr>
      <tr><td>Reste à payer à cette date</td><td>${fcfa(reste)}</td></tr></table>
    <p style="margin-top:14px; font-size:12px;"><em>Duplicata imprimé depuis l'espace parents — le reçu original reste celui remis par l'école.</em></p>`);
}

async function afficherEspaceParent() {
  showBootMessage('Chargement de votre espace…');
  await openDB(); // base locale vide : sert uniquement à l'en-tête des impressions
  const cle = 'ecole-bf-parent-cache:' + currentUser.id;
  let fiches = [], annonces = [], horsLigne = false;
  try {
    const [f, a] = await withTimeout(Promise.all([window.supaClient.from('parents_fiches').select('*'), window.supaClient.from('parents_annonces').select('*')]), 10000);
    if (f.error || a.error) throw f.error || a.error;
    fiches = f.data.map((r) => ({ ...r.data, uuid: r.eleve_uuid }));
    annonces = a.data.map((r) => ({ ...r.data, id: r.id, classeNom: r.classe_nom }));
    try { localStorage.setItem(cle, JSON.stringify({ fiches, annonces })); } catch (e) {}
  } catch (e) {
    horsLigne = true;
    try { const c = JSON.parse(localStorage.getItem(cle) || 'null'); if (c) { fiches = c.fiches; annonces = c.annonces; } } catch (e2) {}
  }
  const meta = fiches[0] ? { nomEcole: fiches[0].ecole, nomDirecteur: fiches[0].directeur, anneeScolaire: fiches[0].annee } : null;
  if (meta && !(await DB.getAll('meta')).length) await DB.add('meta', meta);

  const classes = new Set(fiches.map((f) => f.classe));
  const visibles = annonces.filter((a) => !a.classeNom || classes.has(a.classeNom)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  document.body.innerHTML = `<div style="max-width:760px; margin:0 auto; padding:16px;">
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
      <div><h1 style="margin:0;">Espace parents</h1><div class="text-soft">${esc(fiches[0] ? fiches[0].ecole : '')} — ${esc(currentUser.nom)}</div></div>
      <span><button class="btn btn-sm" onclick="afficherEspaceParent()">Actualiser</button> <button class="btn btn-sm" onclick="logout()">Déconnexion</button></span>
    </div>
    ${horsLigne ? '<div class="alert alert-terre">Pas de connexion : dernières informations enregistrées sur cet appareil.</div>' : ''}
    ${visibles.length ? `<div class="card"><h3>Annonces de l'école</h3>${visibles.map((a) => `<div style="margin:10px 0;"><strong>${esc(a.titre)}</strong> <span class="text-soft">— ${esc(formatDate(a.date))}${a.classeNom ? ' · classe ' + esc(a.classeNom) : ''}</span><div style="white-space:pre-wrap;">${esc(a.message)}</div></div>`).join('')}</div>` : ''}
    ${fiches.length ? fiches.map((f, i) => `<div class="card" style="margin-top:14px;"><div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><h3 style="margin:0;">${esc(f.prenom)} ${esc(f.nom)}</h3><button class="btn btn-sm" data-print="${i}">Imprimer / PDF</button></div>${epFicheHtml(f, false, i)}</div>`).join('')
      : '<div class="card" style="margin-top:14px;"><p>Aucune information disponible pour le moment. L\'école n\'a pas encore publié la fiche de votre enfant.</p></div>'}
  </div>`;
  document.body.onclick = (ev) => {
    const r = ev.target.closest('[data-recu]');
    if (r) { const [i, j] = r.dataset.recu.split(':').map(Number); epImprimerRecu(fiches[i], j); return; }
    const b = ev.target.closest('[data-print]'); if (!b) return;
    const f = fiches[Number(b.dataset.print)];
    printDocument(`Fiche de suivi — ${f.prenom} ${f.nom}`, `<h3 style="text-align:center;">FICHE DE SUIVI DE L'ÉLÈVE</h3>${epFicheHtml(f, true, 0)}`);
  };
}

/* Le parent revoit les dernières informations dès qu'il revient sur l'application */
let _epVisibiliteBranchee = false, _epDernierChargement = Date.now();
if (!_epVisibiliteBranchee) {
  _epVisibiliteBranchee = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'parent' && Date.now() - _epDernierChargement > 60000) {
      _epDernierChargement = Date.now();
      afficherEspaceParent();
    }
  });
}
