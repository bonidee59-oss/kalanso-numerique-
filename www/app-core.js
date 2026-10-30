/* ============================================================
   app-core.js — Amorçage, navigation, utilitaires, tableau de bord
   ============================================================ */

let currentUser = null;
let currentRoute = '#/dashboard';

/* ---------------- Helpers génériques ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR');
}

function calcAge(dob) {
  if (!dob) return '—';
  const d = new Date(dob), n = new Date();
  let age = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) age--;
  return age;
}

function fmtMontant(n) {
  n = Number(n) || 0;
  return n.toLocaleString('fr-FR') + ' FCFA';
}

function uidCourt() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

/* Les matricules ne sont plus générés par l'application : ils se saisissent à la main (matricule officiel). */

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function toCSV(rows, headers) {
  const esc2 = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map((h) => esc2(h.label)).join(';')];
  rows.forEach((r) => lines.push(headers.map((h) => esc2(typeof h.value === 'function' ? h.value(r) : r[h.value])).join(';')));
  return '\uFEFF' + lines.join('\n');
}

/* Export PDF générique (impression navigateur) réutilisé par toutes les rubriques.
   headers : tableau de libellés de colonnes.
   matrixRows : tableau de lignes, chaque ligne étant un tableau de valeurs texte. */
function pdfTable(title, headers, matrixRows, introHtml) {
  const html = `${introHtml || ''}<h3 style="text-align:center;">${esc(title.toUpperCase())}</h3>
    <table style="width:100%; border-collapse:collapse;" border="1" cellpadding="6">
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${matrixRows.length ? matrixRows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Aucune donnée</td></tr>`}</tbody>
    </table>`;
  printDocument(title, html);
}

function toast(msg) {
  let wrap = $('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function confirmDialog(msg) {
  return new Promise((resolve) => {
    openModal('Confirmation', `<p>${esc(msg)}</p>`, {
      saveLabel: 'Confirmer',
      danger: true,
      onSave: () => { resolve(true); return true; }
    });
    const overlay = $('.modal-overlay');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { resolve(false); closeModal(); } }, { once: true });
    $('.modal-cancel', overlay)?.addEventListener('click', () => resolve(false), { once: true });
  });
}

/* ---------------- Modal générique ---------------- */
function closeModal() {
  const o = $('.modal-overlay');
  if (o) o.remove();
}

function openModal(title, bodyHtml, opts = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="${opts.wide ? 'max-width:920px' : ''}">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">
        <button class="btn modal-cancel">Annuler</button>
        ${opts.hideSave ? '' : `<button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'} modal-save">${esc(opts.saveLabel || 'Enregistrer')}</button>`}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  $('.modal-cancel', overlay).addEventListener('click', () => { if (opts.onCancel) opts.onCancel(); closeModal(); });
  if (!opts.hideSave) {
    $('.modal-save', overlay).addEventListener('click', async () => {
      const ok = opts.onSave ? await opts.onSave(overlay) : true;
      if (ok !== false) closeModal();
    });
  }
  return overlay;
}

/* ---------------- Thème ---------------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(cur);
}

/* ---------------- Menu ---------------- */
const MENU = [
  { items: [{ hash: '#/dashboard', label: 'Tableau de bord', icon: '◆' }] },
  { title: 'Publications', items: [
    { hash: '#/publications', label: 'Documents publiés', icon: '⇅' },
    { hash: '#/scanner', label: 'Scanner un document', icon: '⎙' },
    { hash: '#/liste-ceb', label: 'Liste des élèves → CEB', icon: '⇪' },
    { hash: '#/listes-ceb', label: "Listes d'élèves des écoles", icon: '⇩' },
    { hash: '#/comptes-reseau', label: 'Comptes des structures', icon: '◉' }
  ]},
  { title: 'Scolarité', items: [
    { hash: '#/eleves', label: 'Élèves', icon: '●' },
    { hash: '#/classes', label: 'Classes', icon: '▦' },
    { hash: '#/enseignants', label: 'Enseignants', icon: '☺' },
    { hash: '#/presences', label: 'Présences', icon: '✓' },
    { hash: '#/registre-appel', label: "Registre d'appel journalier", icon: '◎' },
    { hash: '#/registre-mensuel', label: 'Rapport mensuel (registre)', icon: '▤' },
    { hash: '#/registre-matricule', label: 'Registre matricule', icon: '▥' }
  ]},
  { title: 'Pédagogie', items: [
    { hash: '#/evaluations', label: 'Évaluations & bulletins', icon: '#' },
    { hash: '#/passage', label: 'Passage de classe', icon: '➔' },
    { hash: '#/cahier-enseignant', label: "Cahier de bord de l'enseignant", icon: '✎' },
    { hash: '#/cahier-semaine', label: 'Cahier de chemin (semaine)', icon: '▤' },
    { hash: '#/abandons', label: 'Suivi des abandons', icon: '!' }
  ]},
  { title: 'CEP — circuit officiel', items: [
    { hash: '#/cep', label: "Vue d'ensemble du CEP", icon: '★' },
    { hash: '#/cep-documents', label: 'Documents ▼ descendants / ▲ ascendants', icon: '⇅' },
    { hash: '#/cep-ecole', label: 'École : inscriptions & résultats', icon: '●' },
    { hash: '#/examens', label: 'CEB : Espace Examen', icon: '▦' },
    { hash: '#/exam-dpeppnf', label: 'DPEPPNF — consolidation provinciale', icon: '▲' },
    { hash: '#/exam-dreppnf', label: 'DREPPNF — consolidation régionale', icon: '▲' },
    { hash: '#/exam-sg', label: 'Ministère (SG MEBAPLN) — bilan national', icon: '▲' }
  ]},
  { title: 'CEP en direct (serveur)', items: [
    { hash: '#/cep-tableau', label: 'Tableau de bord du CEP', icon: '◆' },
    { hash: '#/cep-calendrier', label: 'Calendrier et échéances', icon: '▢' },
    { hash: '#/cep-validation', label: 'Remontées et validation', icon: '✓' },
    { hash: '#/centres-ceb', label: 'Centres et présidents', icon: '▦' },
    { hash: '#/jour-j', label: 'Suivi du jour J', icon: '⌖' },
    { hash: '#/matricules-cep', label: 'Matricules des candidats', icon: '№' }
  ]},
  { title: 'Personnel du réseau', items: [
    { hash: '#/personnel-reseau', label: 'Personnel et mouvements', icon: '☰' }
  ]},
  { title: 'Gestion', items: [
    { hash: '#/cotisations', label: 'Cotisations', icon: '$' },
    { hash: '#/fournitures', label: 'Fournitures', icon: '▧' },
    { hash: '#/cantine', label: 'Cantine', icon: '◍' },
    { hash: '#/finances', label: 'Finances', icon: '¤' },
    { hash: '#/discipline', label: 'Discipline', icon: '⚑' }
  ]},
  { title: 'Patrimoine', items: [
    { hash: '#/patrimoine', label: 'Patrimoine & infrastructures', icon: '⌂' }
  ]},
  { title: 'Administration', items: [
    { hash: '#/cahier-bord', label: 'Cahier de bord du directeur', icon: '✎' },
    { hash: '#/courrier', label: 'Courrier départ / arrivée', icon: '✉' },
    { hash: '#/coges', label: 'COGES', icon: '◈' },
    { hash: '#/visites', label: "Visites d'encadrement", icon: '⌖' },
    { hash: '#/reunions', label: 'Réunions & décisions', icon: '☰' },
    { hash: '#/documents', label: 'Bibliothèque numérique', icon: '▥' },
    { hash: '#/calendrier', label: 'Calendrier scolaire', icon: '▢' },
    { hash: '#/rapports', label: 'Rapports', icon: '▣' },
    { hash: '#/utilisateurs', label: 'Utilisateurs', icon: '◉' },
    { hash: '#/gestion-parents', label: 'Espace parents', icon: '☺' },
    { hash: '#/parametres', label: 'Paramètres', icon: '⚙' }
  ]}
];

const ROUTE_TITLES = {};
MENU.forEach((g) => g.items.forEach((i) => { ROUTE_TITLES[i.hash] = i.label; }));

/* ---------------- Permissions par rôle ----------------
   Une route absente de cette table est accessible à tous les rôles connectés
   (cas du tableau de bord). Garde ceci cohérent avec les policies RLS côté
   Supabase (voir supabase-setup.sql) pour les rubriques sensibles : un rôle
   qui n'a pas le droit ici ne l'a de toute façon pas côté serveur. */
const ROUTE_ROLES = {
  '#/eleves': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/classes': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/enseignants': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/presences': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/registre-appel': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/registre-mensuel': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/registre-matricule': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/evaluations': ['directeur', 'directeur_adjoint', 'enseignant'],
  '#/abandons': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/cotisations': ['directeur', 'directeur_adjoint', 'comptable'],
  '#/finances': ['directeur', 'directeur_adjoint', 'comptable'],
  '#/fournitures': ['directeur', 'directeur_adjoint', 'magasinier', 'secretaire'],
  '#/cantine': ['directeur', 'directeur_adjoint', 'cantine'],
  '#/discipline': ['directeur', 'directeur_adjoint', 'secretaire', 'enseignant'],
  '#/patrimoine': ['directeur', 'directeur_adjoint', 'magasinier'],
  '#/cahier-enseignant': ['directeur', 'directeur_adjoint', 'enseignant'],
  '#/cahier-semaine': ['directeur', 'directeur_adjoint', 'enseignant'],
  '#/cahier-bord': ['directeur', 'directeur_adjoint'],
  '#/courrier': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/coges': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/visites': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/reunions': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/documents': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/calendrier': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/rapports': ['directeur', 'directeur_adjoint'],
  '#/passage': ['directeur', 'directeur_adjoint'],
  '#/examens': ['ceb'],
  '#/exam-dpeppnf': ['dpeppnf'],
  '#/exam-dreppnf': ['dreppnf'],
  '#/exam-sg': ['ministere'],
  '#/cep': ['directeur', 'directeur_adjoint', 'secretaire', 'ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/publications': ['directeur', 'directeur_adjoint', 'secretaire', 'ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/comptes-reseau': ['ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/personnel-reseau': ['directeur', 'directeur_adjoint', 'secretaire', 'ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/matricules-cep': ['directeur', 'directeur_adjoint', 'secretaire', 'ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/cep-tableau': ['ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/cep-calendrier': ['ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre', 'directeur', 'directeur_adjoint', 'secretaire'],
  '#/cep-validation': ['ceb', 'dpeppnf', 'dreppnf', 'ministere'],
  '#/centres-ceb': ['ceb'],
  '#/jour-j': ['centre', 'ceb'],
  '#/liste-ceb': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/listes-ceb': ['ceb'],
  '#/cep-documents': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/cep-ecole': ['directeur', 'directeur_adjoint', 'secretaire'],
  '#/utilisateurs': ['directeur', 'directeur_adjoint'],
  '#/gestion-parents': ['directeur', 'directeur_adjoint'],
  '#/parametres': ['directeur', 'directeur_adjoint']
};

/* Comptes du réseau (hors école) : CEB, DPEPPNF, DREPPNF, ministère.
   Ils n'ont accès à AUCUNE rubrique de l'école : seules les pages listées
   explicitement pour leur rôle dans ROUTE_ROLES (+ leur tableau de bord)
   sont autorisées. Toute autre adresse est refusée. */
const ROLES_RESEAU = ['ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre']; // « centre » = président de centre (compte créé par la CEB)
function estCompteReseau() { return !!currentUser && ROLES_RESEAU.includes(currentUser.role); }

function routeAutorisee(hash) {
  if (estCompteReseau()) {
    if (hash === '#/dashboard') return true;
    const a = ROUTE_ROLES[hash];
    return !!a && a.includes(currentUser.role);
  }
  const allowed = ROUTE_ROLES[hash];
  return !allowed || (currentUser && allowed.includes(currentUser.role));
}

/* ---------------- Restriction "un enseignant ne voit que sa/ses classes" ----------------
   Un enseignant est rattaché à sa classe soit via son propre dossier
   (enseignants.classeId), soit via la classe elle-même (classes.enseignantId).
   On calcule la liste une fois à la connexion et on la garde sur currentUser. */
/* Plusieurs enseignants peuvent être affectés à une même classe (selon l'effectif).
   classes.enseignantIds = tous les enseignants affectés ; classes.enseignantId = le titulaire
   (conservé pour la compatibilité avec les anciennes données). */
function idsEnseignantsClasse(c) {
  const s = new Set((c && Array.isArray(c.enseignantIds) ? c.enseignantIds : []).map(Number));
  if (c && c.enseignantId) s.add(Number(c.enseignantId));
  return Array.from(s);
}
function enseignantsDeClasse(c, enseignants) {
  const ids = idsEnseignantsClasse(c);
  return enseignants.filter((e) => ids.includes(e.id) || e.classeId === c.id);
}
function classesDeEnseignant(e, classes) {
  return classes.filter((c) => c.id === e.classeId || idsEnseignantsClasse(c).includes(e.id));
}

async function chargerClassesEnseignant() {
  currentUser.classeIds = null; // null = pas de restriction (tous les autres rôles)
  if (currentUser.role !== 'enseignant') return;
  const [enseignants, classes] = await Promise.all([DB.getAll('enseignants'), DB.getAll('classes')]);
  const monDossier = enseignants.find((e) => e.profileId === currentUser.id);
  const ids = new Set();
  if (monDossier) {
    if (monDossier.classeId) ids.add(monDossier.classeId);
    classes.filter((c) => idsEnseignantsClasse(c).includes(monDossier.id)).forEach((c) => ids.add(c.id));
  }
  currentUser.classeIds = Array.from(ids); // tableau vide = aucune classe rattachée pour l'instant
  currentUser.enseignantDossierId = monDossier ? monDossier.id : null;
}

/* true si l'utilisateur courant peut voir cette classeId (pas de restriction
   pour les autres rôles ; un enseignant ne voit que ses classes rattachées). */
function classeVisible(classeId) {
  if (!currentUser || !currentUser.classeIds) return true;
  return currentUser.classeIds.includes(Number(classeId));
}

/* Filtre une liste d'objets ayant un champ classeId selon la restriction ci-dessus. */
function filtrerParClasseVisible(liste, champ = 'classeId') {
  if (!currentUser || !currentUser.classeIds) return liste;
  return liste.filter((r) => currentUser.classeIds.includes(Number(r[champ])));
}

/* ---------------- Boot ---------------- */
window.addEventListener('DOMContentLoaded', boot);

/* Miroirs de la bibliothèque Supabase, essayés l'un après l'autre si le chargement initial a échoué (réseau mobile, hébergeur bloqué…) */
const SUPABASE_MIROIRS = [
  'vendor/supabase.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fastly.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://gcore.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js'
];
async function chargerSupabaseSecours() {
  for (const url of SUPABASE_MIROIRS) {
    if (window.supabase) break;
    await new Promise((res) => {
      const s = document.createElement('script');
      s.src = url; s.onload = s.onerror = () => res();
      setTimeout(res, 8000); // un hébergeur muet ne doit pas bloquer les suivants
      document.head.appendChild(s);
    });
  }
  if (window.supabase && !window.supaClient) {
    supaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    window.supaClient = supaClient;
  }
}

/* ---------------- Session permanente ----------------
   La session Supabase est déjà mémorisée par le navigateur. On en garde en plus une copie de
   secours : si la session principale disparaît ou ne peut pas être renouvelée (réseau coupé,
   stockage nettoyé), on la rouvre avec cette copie au lieu de redemander l'identifiant. */
const SESSION_BACKUP_KEY = 'ecole-bf-session-backup';
let deconnexionVolontaire = false;
function sauvegarderSession(s) {
  try { localStorage.setItem(SESSION_BACKUP_KEY, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, user: { id: s.user.id, email: s.user.email } })); } catch (e) {}
}
async function restaurerSession() {
  let copie = null;
  try { copie = JSON.parse(localStorage.getItem(SESSION_BACKUP_KEY) || 'null'); } catch (e) {}
  if (!copie || !copie.refresh_token) return null;
  try {
    const { data, error } = await withTimeout(window.supaClient.auth.setSession({ access_token: copie.access_token, refresh_token: copie.refresh_token }), 8000);
    if (!error && data && data.session) { sauvegarderSession(data.session); return data.session; }
    // Refus explicite du serveur : la copie n'est plus valable
    if (error && !/fetch|network|timeout/i.test(String(error.message || error))) { localStorage.removeItem(SESSION_BACKUP_KEY); return null; }
  } catch (e) { /* réseau absent : voir ci-dessous */ }
  // Pas de réseau : on ouvre l'application hors ligne avec le dernier profil connu (la session se renouvellera au retour d'internet)
  if (copie.user && localStorage.getItem(PROFILE_CACHE_KEY + ':' + copie.user.id)) return { user: copie.user };
  return null;
}

async function boot() {
  applyTheme(localStorage.getItem('theme') || 'light');
  if (!window.supaClient) { showBootMessage('Chargement de la bibliothèque de connexion…'); await chargerSupabaseSecours(); }
  if (!window.supaClient) {
    document.body.innerHTML = `<div class="login-screen"><div class="login-card">
      <h1>Chargement impossible</h1>
      <p class="text-soft">Une connexion internet est nécessaire pour le tout premier chargement de l'application sur cet appareil. Ensuite, elle fonctionnera hors ligne. Vérifiez votre connexion et appuyez sur "Réessayer".</p>
      <button class="btn-primary" onclick="location.reload()">Réessayer</button>
    </div></div>`;
    return;
  }
  showBootMessage('Connexion en cours…');
  // Demande au navigateur de ne pas effacer les données du site (session comprise) quand il manque de place
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  let { data: { session } } = await window.supaClient.auth.getSession();
  if (!session) session = await restaurerSession();
  if (session) {
    await afterLogin(session.user);
  } else {
    renderLogin();
  }
  window.supaClient.auth.onAuthStateChange(async (event, s) => {
    if (s && s.refresh_token) sauvegarderSession(s);
    if (event === 'SIGNED_OUT') {
      // Déconnexion non demandée (jeton perdu, effacé par le navigateur…) : on tente de rouvrir la session sans redemander le mot de passe
      const rouverte = deconnexionVolontaire ? null : await restaurerSession();
      if (rouverte) return;
      currentUser = null; renderLogin();
    }
  });
  // Au retour dans l'application (téléphone sorti de veille), on vérifie / renouvelle la session
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && currentUser) window.supaClient.auth.getSession(); });
  window.addEventListener('hashchange', onRouteChange);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function showBootMessage(msg) {
  document.body.innerHTML = `<div class="login-screen"><div class="login-card">
    <div class="woven-stripe"><span></span><span></span><span></span><span></span><span></span></div>
    <p class="text-soft">${esc(msg)}</p>
  </div></div>`;
}

/* Une requête réseau qui échoue franchement (pas de connexion) est déjà
   rapide, mais sur un réseau mobile faible elle peut rester "en attente"
   très longtemps avant d'échouer. On la borne donc explicitement pour ne
   jamais laisser l'écran de démarrage figé. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

const PROFILE_CACHE_KEY = 'ecole-bf-profil-cache';

/* Appelé une fois qu'une session Supabase valide existe : récupère le profil
   (nom + rôle) de l'utilisateur, puis initialise le reste de l'application.
   Le profil est mis en cache localement : si le réseau est absent ou trop
   lent au démarrage, on redémarre quand même avec le dernier profil connu
   au lieu de rejeter la connexion. La liste des écoles/données locales
   (IndexedDB) est de toute façon déjà sur l'appareil. */
async function afterLogin(authUser) {
  showBootMessage('Chargement de votre profil…');
  let profile = null;
  try {
    const { data, error } = await withTimeout(
      window.supaClient.from('profiles').select('*').eq('id', authUser.id).single(),
      4000
    );
    if (error || !data) throw error || new Error('profil introuvable');
    profile = data;
    try { localStorage.setItem(PROFILE_CACHE_KEY + ':' + authUser.id, JSON.stringify(profile)); } catch (e) {}
  } catch (e) {
    // Réseau absent/lent : on retombe sur le dernier profil connu pour cet
    // utilisateur, mémorisé lors d'une précédente connexion réussie.
    try {
      const cached = localStorage.getItem(PROFILE_CACHE_KEY + ':' + authUser.id);
      if (cached) profile = JSON.parse(cached);
    } catch (e2) {}
    if (!profile) {
      renderLogin("Impossible de récupérer votre profil (pas de connexion et aucune connexion précédente enregistrée sur cet appareil). Connectez-vous une première fois avec internet.");
      return;
    }
  }
  currentUser = {
    id: authUser.id, email: authUser.email, nom: profile.nom, role: profile.role,
    structure: profile.structure || '', region: profile.region || '', province: profile.province || '', ceb: profile.ceb || '',
    ecole_id: profile.ecole_id || '', centre_id: profile.centre_id || '', bureau: profile.bureau || '', service: profile.service || ''
  };
  // Compte du réseau (CEB, DPEPPNF, DREPPNF, ministère) : aucune donnée d'école, aucune synchronisation
  // de l'école. Base locale seule (pour son espace Examen), puis coquille avec menu restreint.
  if (ROLES_RESEAU.includes(profile.role)) {
    showBootMessage('Chargement…');
    choisirBaseLocale('u-' + authUser.id);
    await openDB();
    renderShell();
    return;
  }
  // Compte parent : espace dédié, sans synchronisation des données de l'école (voir app-parents.js)
  if (profile.role === 'parent') { await afficherEspaceParent(); return; }
  showBootMessage('Chargement des données…');
  choisirBaseLocale(currentUser.ecole_id);
  await openDB();
  // La synchronisation doit passer AVANT la création des classes par défaut :
  // sinon, sur un appareil qui n'a pas encore les données de l'école, les 6
  // classes standards sont créées localement, puis les vraies classes de
  // l'école arrivent en plus par la synchronisation → classes en double.
  // syncBootstrap a son propre délai plafonné à 4s, donc ceci ne bloque pas
  // le démarrage plus longtemps qu'avant.
  if (typeof syncBootstrap === 'function') await syncBootstrap();
  await seedIfEmpty();
  if (typeof prPlanifier === 'function') prPlanifier(4000); // remontée des enseignants vers la CEB
  await chargerClassesEnseignant();
  renderShell();
  // La migration et le temps réel, eux, peuvent continuer en arrière-plan
  // sans retarder l'affichage.
  (async () => {
    if (typeof migratePedagogieEvaluations === 'function') await migratePedagogieEvaluations();
    if (typeof startRealtime === 'function') startRealtime();
  })();
}

/* ---------------- Écran de connexion (email + mot de passe) ---------------- */
function renderLogin(errorMsg) {
  document.body.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="woven-stripe"><span></span><span></span><span></span><span></span><span></span></div>
        <h1 style="margin-bottom:2px;">École Numérique</h1>
        <p class="text-soft" style="margin-top:0;">Connectez-vous avec le compte fourni par votre établissement.</p>
        <form id="login-form" style="margin-top:18px; display:flex; flex-direction:column; gap:10px;">
          <input type="text" inputmode="email" id="login-email" placeholder="E-mail ou numéro de téléphone" required autocomplete="username" autocapitalize="none" style="padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
          <input type="password" id="login-password" placeholder="Mot de passe" required autocomplete="current-password" style="padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
          <div id="login-error" class="text-soft" style="color:#B23A3A; min-height:18px;">${errorMsg ? esc(errorMsg) : ''}</div>
          <button type="submit" class="btn btn-primary" id="login-submit">Se connecter</button>
        </form>
      </div>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = identifiantVersEmail($('#login-email').value);
    const password = $('#login-password').value;
    const btn = $('#login-submit');
    btn.disabled = true; btn.textContent = 'Connexion…';
    try {
      const { data, error } = await withTimeout(
        window.supaClient.auth.signInWithPassword({ email, password }),
        8000
      );
      if (error) {
        $('#login-error').textContent = "Identifiants incorrects, ou compte introuvable.";
        btn.disabled = false; btn.textContent = 'Se connecter';
        return;
      }
      await afterLogin(data.user);
    } catch (e) {
      $('#login-error').textContent = "Connexion au serveur impossible (vérifiez votre connexion internet). La toute première connexion sur un appareil nécessite internet.";
      btn.disabled = false; btn.textContent = 'Se connecter';
    }
  });
}

function labelRole(role) {
  return {
    directeur: 'Directeur', directeur_adjoint: 'Directeur adjoint', secretaire: 'Secrétariat',
    comptable: 'Comptabilité', magasinier: 'Magasinier', cantine: 'Gestion cantine', enseignant: 'Enseignant', parent: 'Parent',
    ceb: 'CEB', dpeppnf: 'DPEPPNF', dreppnf: 'DREPPNF', ministere: 'Ministère', centre: 'Président de centre'
  }[role] || role;
}

async function logout() {
  deconnexionVolontaire = true;
  try { localStorage.removeItem(SESSION_BACKUP_KEY); } catch (e) {}
  await window.supaClient.auth.signOut();
  currentUser = null;
  deconnexionVolontaire = false;
  // Rechargement complet : la base locale, la synchro et les caches de l'école précédente sont repartis de zéro
  location.reload();
}

/* ---------------- Coquille applicative (sidebar + topbar) ---------------- */
function renderShell() {
  document.body.innerHTML = `
    <div id="app">
      <div class="sidebar-backdrop" id="backdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="mark">É</div>
          <div><div class="name">École Numérique</div><div class="sub">Burkina Faso</div></div>
        </div>
        <div class="woven-stripe"><span></span><span></span><span></span><span></span><span></span></div>
        <nav class="nav-scroll" id="nav"></nav>
        <div class="sidebar-foot">
          Connecté : <strong>${esc(currentUser.nom)}</strong><br>${esc(labelRole(currentUser.role))}${currentUser.structure ? ' — ' + esc(currentUser.structure) : ''}
          <div style="margin-top:8px;"><button class="btn btn-sm" style="width:100%;" onclick="logout()">Changer de profil</button></div>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <button class="burger icon-btn" id="burger">☰</button>
          <h1 class="page-title" id="page-title"></h1>
          <div class="spacer"></div>
          <button class="sync-btn" id="sync-btn" type="button" title="Synchronisation en temps réel">
            <span class="sync-dot" id="sync-dot"></span>
            <span id="sync-label">Hors ligne</span>
            <span class="sync-fill-track"><span class="sync-fill" id="sync-fill"></span></span>
          </button>
          <button class="icon-btn" id="alert-bell" title="Alertes">🔔</button>
          <button class="icon-btn" id="theme-btn" title="Mode clair/sombre">◐</button>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>`;
  buildNav();
  if (typeof setSyncBadge === 'function') setSyncBadge(window.lastSyncState || 'offline');
  $('#burger').onclick = () => { $('#sidebar').classList.toggle('open'); $('#backdrop').classList.toggle('show'); };
  $('#backdrop').onclick = fermerMenu;
  if (!window._menuEscBound) { window._menuEscBound = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerMenu(); }); }
  $('#theme-btn').onclick = () => toggleTheme();
  $('#alert-bell').onclick = () => showAlertsPanel();
  if (estCompteReseau()) { $('#alert-bell').style.display = 'none'; $('#sync-btn').style.display = 'none'; }
  onRouteChange();
}

function fermerMenu() {
  const sb = document.getElementById('sidebar'), bd = document.getElementById('backdrop');
  if (sb) sb.classList.remove('open');
  if (bd) bd.classList.remove('show');
}

function buildNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  MENU.forEach((group) => {
    const items = group.items.filter((item) => routeAutorisee(item.hash));
    if (!items.length) return;
    if (group.title) {
      const t = document.createElement('div');
      t.className = 'nav-group-title'; t.textContent = group.title;
      nav.appendChild(t);
    }
    items.forEach((item) => {
      const b = document.createElement('button');
      b.className = 'nav-item' + (currentRoute === item.hash ? ' active' : '');
      b.innerHTML = `<span class="ic">${item.icon}</span><span>${esc(item.label)}</span>`;
      b.onclick = () => { fermerMenu(); location.hash = item.hash; };
      nav.appendChild(b);
    });
  });
}

const ROUTES = {}; // rempli par les autres fichiers app-*.js : ROUTES['#/xxx'] = renderFn

async function onRouteChange() {
  fermerMenu();
  const hash = location.hash || '#/dashboard';
  currentRoute = hash.split('?')[0];
  if (!$('#content')) return;
  buildNav();
  $('#page-title').textContent = ROUTE_TITLES[currentRoute] || 'École Numérique';
  if (!routeAutorisee(currentRoute)) {
    $('#content').innerHTML = `<div class="alert alert-terre">Votre profil (${esc(labelRole(currentUser.role))}) n'a pas accès à cette page.</div>`;
    return;
  }
  const fn = ROUTES[currentRoute] || renderDashboard;
  $('#content').innerHTML = '<p class="text-soft">Chargement…</p>';
  try {
    await fn($('#content'));
  } catch (err) {
    console.error(err);
    $('#content').innerHTML = `<div class="alert alert-terre">Une erreur est survenue lors de l'affichage de cette page.</div>`;
  }
}
ROUTES['#/dashboard'] = renderDashboard;

/* ================= Statuts de présence (partagés) ================= */
/* Ajout additif : les statuts historiques 'present' / 'absent' / 'retard'
   gardent exactement le même comportement. Les nouveaux statuts du
   Registre d'appel journalier (absent_justifie, absent_non_justifie, malade)
   sont simplement reconnus comme des absences dans les calculs partagés. */
const PRESENCE_STATUTS = [
  { value: 'present', label: 'Présent', badge: 'vert', absence: false },
  { value: 'retard', label: 'Retard', badge: 'ocre', absence: false },
  { value: 'absent_justifie', label: 'Absent justifié', badge: 'ocre', absence: true },
  { value: 'absent_non_justifie', label: 'Absent non justifié', badge: 'terre', absence: true },
  { value: 'malade', label: 'Malade', badge: 'indigo', absence: true },
  { value: 'absent', label: 'Absent', badge: 'terre', absence: true } // valeur historique, conservée pour compatibilité
];
function isPresenceAbsente(statut) {
  const conf = PRESENCE_STATUTS.find((s) => s.value === statut);
  return conf ? conf.absence : statut === 'absent';
}
function labelPresenceStatut(statut) {
  const conf = PRESENCE_STATUTS.find((s) => s.value === statut);
  return conf ? conf.label : statut;
}

/* ================= Moteur d'alertes ================= */
async function computeAlerts(classeIds) {
  const alerts = [];
  const [eleves, presences, cotisations, fournitures, cantine, reunions, visites] = await Promise.all([
    DB.getAll('eleves'), DB.getAll('presencesEleves'), DB.getAll('cotisations'),
    DB.getAll('fournitures'), DB.getAll('cantine'), DB.getAll('reunions'), DB.getAll('visites')
  ]);

  // absences répétées (3+ absences sur les 14 derniers jours)
  const since = Date.now() - 14 * 86400000;
  const absCount = {};
  presences.filter((p) => isPresenceAbsente(p.statut) && new Date(p.date).getTime() >= since && (!classeIds || classeIds.includes(Number(p.classeId))))
    .forEach((p) => { absCount[p.eleveId] = (absCount[p.eleveId] || 0) + 1; });
  const nbAbsRisque = Object.values(absCount).filter((n) => n >= 3).length;
  if (nbAbsRisque > 0) alerts.push({ level: 'terre', msg: `${nbAbsRisque} élève(s) avec absences répétées (14 derniers jours)`, link: '#/abandons' });

  // Le reste (cotisations, stock, cantine) concerne la gestion globale de
  // l'école : non pertinent pour la vue restreinte d'un enseignant.
  if (classeIds) return alerts;

  // cotisations impayées
  const impayes = cotisations.filter((c) => (Number(c.montantPaye) || 0) < (Number(c.montantAttendu) || 0));
  if (impayes.length > 0) alerts.push({ level: 'ocre', msg: `${impayes.length} parent(s) n'ont pas soldé la cotisation`, link: '#/cotisations' });

  // rupture de stock fournitures
  const ruptures = fournitures.filter((f) => Number(f.quantite) <= Number(f.seuil || 0));
  if (ruptures.length > 0) alerts.push({ level: 'terre', msg: `${ruptures.length} article(s) en rupture ou seuil bas de stock`, link: '#/fournitures' });

  // vivres insuffisants / péremption proche
  const soon = Date.now() + 14 * 86400000;
  const vivresBas = cantine.filter((c) => Number(c.quantite) <= Number(c.seuil || 0));
  const vivresPerime = cantine.filter((c) => c.datePeremption && new Date(c.datePeremption).getTime() <= soon);
  if (vivresBas.length > 0) alerts.push({ level: 'terre', msg: `${vivresBas.length} produit(s) de cantine en stock insuffisant`, link: '#/cantine' });
  if (vivresPerime.length > 0) alerts.push({ level: 'ocre', msg: `${vivresPerime.length} produit(s) de cantine proches de la péremption`, link: '#/cantine' });

  // réunions à venir (7 jours)
  const soon7 = Date.now() + 7 * 86400000;
  const reunionsAVenir = reunions.filter((r) => r.date && new Date(r.date).getTime() >= Date.now() && new Date(r.date).getTime() <= soon7);
  if (reunionsAVenir.length > 0) alerts.push({ level: 'vert', msg: `${reunionsAVenir.length} réunion(s) prévue(s) cette semaine`, link: '#/reunions' });

  const visitesAVenir = visites.filter((v) => v.date && new Date(v.date).getTime() >= Date.now() && new Date(v.date).getTime() <= soon7);
  if (visitesAVenir.length > 0) alerts.push({ level: 'vert', msg: `${visitesAVenir.length} visite(s) d'encadrement prévue(s) cette semaine`, link: '#/visites' });

  return alerts;
}

function alertBadgeClass(level) { return { terre: 'alert-terre', ocre: 'alert-ocre', vert: 'alert-vert' }[level] || 'alert-ocre'; }

async function showAlertsPanel() {
  const alerts = await computeAlerts();
  const body = alerts.length
    ? alerts.map((a) => `<div class="alert ${alertBadgeClass(a.level)}" style="cursor:pointer;" onclick="location.hash='${a.link}'; closeModal();">${esc(a.msg)}</div>`).join('')
    : `<div class="empty-state"><div class="big">✓</div>Aucune alerte pour le moment.</div>`;
  openModal('Alertes & notifications', body, { hideSave: true });
}

/* ================= Tableau de bord ================= */
async function renderDashboard(root) {
  if (currentUser && currentUser.classeIds) return renderDashboardEnseignant(root);
  const [eleves, classes, enseignants, presences, cotisations, fournitures, cantine, activites, evaluations] = await Promise.all([
    DB.getAll('eleves'), DB.getAll('classes'), DB.getAll('enseignants'), DB.getAll('presencesEleves'),
    DB.getAll('cotisations'), DB.getAll('fournitures'), DB.getAll('cantine'), DB.getAll('activites'), DB.getAll('evaluations')
  ]);
  const actifs = eleves.filter((e) => (e.statut || 'actif') === 'actif');
  const filles = actifs.filter((e) => e.sexe === 'F').length;
  const garcons = actifs.filter((e) => e.sexe === 'M').length;
  const today = todayISO();
  const presToday = presences.filter((p) => p.date === today);
  const presents = presToday.filter((p) => p.statut === 'present').length;
  const absents = presToday.filter((p) => isPresenceAbsente(p.statut)).length;
  const tauxPresence = presToday.length ? Math.round((presents / presToday.length) * 100) : null;
  const abandons = eleves.filter((e) => e.statut === 'abandon').length;
  const tauxAbandon = eleves.length ? Math.round((abandons / eleves.length) * 100) : 0;

  const totalAttendu = cotisations.reduce((s, c) => s + (Number(c.montantAttendu) || 0), 0);
  const totalPaye = cotisations.reduce((s, c) => s + (Number(c.montantPaye) || 0), 0);

  const alerts = await computeAlerts();

  const effByClasse = classes.map((c) => ({ nom: c.nom, n: actifs.filter((e) => e.classeId === c.id).length }));

  // moyenne générale toutes évaluations confondues
  let sommeNotes = 0, nbNotes = 0;
  evaluations.forEach((ev) => (ev.notes || []).forEach((n) => { const v = noteSur20(ev, n); if (v !== null) { sommeNotes += v; nbNotes++; } }));
  const moyenneGenerale = nbNotes ? (sommeNotes / nbNotes).toFixed(1) : '—';

  const upcoming = activites.filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const dateAffichee = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  root.innerHTML = `
    <div class="dash-hero">
      <div class="dash-hero-row">
        <div>
          <div class="eyebrow">Tableau de bord</div>
          <h1>Bonjour, ${esc(currentUser && currentUser.nom ? currentUser.nom.split(' ')[0] : 'Directeur')} 👋</h1>
          <div class="sub">Vue d'ensemble de l'école — ${actifs.length} élèves actifs sur ${classes.length} classes.</div>
        </div>
        <div class="date-chip">📅 ${dateAffichee}</div>
      </div>
    </div>

    <div class="table-toolbar" style="margin-top:-4px;"><div style="flex:1;"></div><button class="btn btn-sm no-print" id="db-pdf">Exporter PDF</button></div>
    <div class="grid grid-4">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="icon">🎓</div><div class="label">Élèves inscrits</div><div class="value">${actifs.length}</div><div class="foot">${filles} filles · ${garcons} garçons</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="icon">🧑‍🏫</div><div class="label">Enseignants</div><div class="value">${enseignants.length}</div><div class="foot">${classes.length} classes / salles</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="icon">✅</div><div class="label">Taux de présence (jour)</div><div class="value">${tauxPresence === null ? '—' : tauxPresence + '%'}</div><div class="foot">${presents} présents · ${absents} absents aujourd'hui</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="icon">⚠️</div><div class="label">Taux d'abandon</div><div class="value">${tauxAbandon}%</div><div class="foot">${abandons} cas enregistrés</div></div>
    </div>

    <div class="grid grid-3" style="margin-top:14px;">
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="icon">📊</div><div class="label">Moyenne générale école</div><div class="value">${moyenneGenerale}${moyenneGenerale !== '—' ? '/' + MOYENNE_BASE : ''}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="icon">💰</div><div class="label">Cotisations encaissées</div><div class="value">${fmtMontant(totalPaye)}</div><div class="foot">sur ${fmtMontant(totalAttendu)} attendus</div></div>
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="icon">📦</div><div class="label">Stock fournitures</div><div class="value">${fournitures.length} art.</div><div class="foot">${fournitures.filter((f) => Number(f.quantite) <= Number(f.seuil || 0)).length} en alerte</div></div>
    </div>

    <div class="section-title"><h2>Effectif par classe</h2><div class="line"></div></div>
    <div class="card"><canvas class="chart" id="chart-classes"></canvas></div>

    <div class="grid grid-2" style="margin-top:20px; align-items:start;">
      <div>
        <div class="section-title"><h2>Alertes importantes</h2><div class="line"></div></div>
        <div class="card">${alerts.length ? alerts.map((a) => `<div class="alert ${alertBadgeClass(a.level)}" style="cursor:pointer;" onclick="location.hash='${a.link}'">${esc(a.msg)}</div>`).join('') : `<div class="empty-state">Aucune alerte. Tout va bien.</div>`}</div>
      </div>
      <div>
        <div class="section-title"><h2>Activités prévues</h2><div class="line"></div></div>
        <div class="card">${upcoming.length ? upcoming.map((a) => `<div class="flex justify-between" style="padding:7px 0; border-bottom:1px solid var(--border);"><span>${esc(a.titre)}</span><span class="chip">${formatDate(a.date)}</span></div>`).join('') : `<div class="empty-state">Aucune activité à venir. <br><button class="btn btn-sm" style="margin-top:8px;" onclick="location.hash='#/calendrier'">Ajouter au calendrier</button></div>`}</div>
      </div>
    </div>
  `;
  drawBarChart($('#chart-classes'), effByClasse.map((c) => c.nom), effByClasse.map((c) => c.n), 'Élèves');
  $('#db-pdf').onclick = () => {
    const headers = ['Indicateur', 'Valeur'];
    const matrix = [
      ['Élèves inscrits (actifs)', `${actifs.length} (${filles} filles, ${garcons} garçons)`],
      ['Enseignants', enseignants.length],
      ['Classes / salles', classes.length],
      ['Taux de présence du jour', tauxPresence === null ? '—' : tauxPresence + '%'],
      ["Taux d'abandon", tauxAbandon + '%'],
      ['Moyenne générale école', moyenneGenerale === '—' ? '—' : moyenneGenerale + '/' + MOYENNE_BASE],
      ['Cotisations encaissées', `${fmtMontant(totalPaye)} sur ${fmtMontant(totalAttendu)} attendus`],
      ['Articles en alerte de stock', fournitures.filter((f) => Number(f.quantite) <= Number(f.seuil || 0)).length]
    ];
    pdfTable('Tableau de bord — synthèse', headers, matrix);
  };
}

/* Vue du tableau de bord restreinte à un enseignant : uniquement les
   indicateurs de sa/ses classe(s), sans les données de gestion globale
   de l'école (finances, stock, cantine) qui ne le concernent pas. */
async function renderDashboardEnseignant(root) {
  const classeIds = currentUser.classeIds;
  if (!classeIds.length) {
    root.innerHTML = `<div class="empty-state">Aucune classe ne vous est encore rattachée. Contactez le directeur pour qu'il vous affecte une classe (dans "Classes", ou en créant votre compte lié à votre dossier enseignant).</div>`;
    return;
  }
  const [classes, eleves, presences, evaluations, activites] = await Promise.all([
    DB.getAll('classes'), DB.getAll('eleves'), DB.getAll('presencesEleves'), DB.getAll('evaluations'), DB.getAll('activites')
  ]);
  const mesClasses = classes.filter((c) => classeIds.includes(c.id));
  const mesEleves = eleves.filter((e) => classeIds.includes(e.classeId));
  const actifs = mesEleves.filter((e) => (e.statut || 'actif') === 'actif');
  const filles = actifs.filter((e) => e.sexe === 'F').length;
  const garcons = actifs.filter((e) => e.sexe === 'M').length;
  const today = todayISO();
  const presToday = presences.filter((p) => p.date === today && classeIds.includes(p.classeId));
  const presents = presToday.filter((p) => p.statut === 'present').length;
  const absents = presToday.filter((p) => isPresenceAbsente(p.statut)).length;
  const tauxPresence = presToday.length ? Math.round((presents / presToday.length) * 100) : null;
  const abandons = mesEleves.filter((e) => e.statut === 'abandon').length;

  const alerts = await computeAlerts(classeIds);

  let sommeNotes = 0, nbNotes = 0;
  evaluations.filter((ev) => classeIds.includes(ev.classeId)).forEach((ev) => (ev.notes || []).forEach((n) => { const v = noteSur20(ev, n); if (v !== null) { sommeNotes += v; nbNotes++; } }));
  const moyenneGenerale = nbNotes ? (sommeNotes / nbNotes).toFixed(1) : '—';

  const upcoming = activites.filter((a) => a.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  root.innerHTML = `
    <div class="section-title"><h2>${esc(mesClasses.map((c) => c.nom).join(', ') || 'Ma classe')}</h2><div class="line"></div></div>
    <div class="grid grid-4">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Élèves inscrits</div><div class="value">${actifs.length}</div><div class="foot">${filles} filles · ${garcons} garçons</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Taux de présence (jour)</div><div class="value">${tauxPresence === null ? '—' : tauxPresence + '%'}</div><div class="foot">${presents} présents · ${absents} absents aujourd'hui</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Moyenne générale</div><div class="value">${moyenneGenerale}${moyenneGenerale !== '—' ? '/' + MOYENNE_BASE : ''}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Abandons</div><div class="value">${abandons}</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:20px; align-items:start;">
      <div>
        <div class="section-title"><h2>Alertes</h2><div class="line"></div></div>
        <div class="card">${alerts.length ? alerts.map((a) => `<div class="alert ${alertBadgeClass(a.level)}" style="cursor:pointer;" onclick="location.hash='${a.link}'">${esc(a.msg)}</div>`).join('') : `<div class="empty-state">Aucune alerte. Tout va bien.</div>`}</div>
      </div>
      <div>
        <div class="section-title"><h2>Activités prévues</h2><div class="line"></div></div>
        <div class="card">${upcoming.length ? upcoming.map((a) => `<div class="flex justify-between" style="padding:7px 0; border-bottom:1px solid var(--border);"><span>${esc(a.titre)}</span><span class="chip">${formatDate(a.date)}</span></div>`).join('') : `<div class="empty-state">Aucune activité à venir.</div>`}</div>
      </div>
    </div>
  `;
}

/* ================= Mini moteur de graphiques (canvas natif) ================= */
function drawBarChart(canvas, labels, values, seriesName) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 300), h = 220;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...values);
  const padL = 30, padB = 26, padT = 14;
  const chartW = w - padL - 10, chartH = h - padB - padT;
  const barW = chartW / (labels.length || 1) * 0.6;
  const gap = chartW / (labels.length || 1);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.strokeStyle = isDark ? '#2C3A3E' : '#DBDACF';
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + chartH); ctx.lineTo(padL + chartW, padT + chartH); ctx.stroke();
  ctx.fillStyle = isDark ? '#AEB8B4' : '#4C5A60';
  ctx.font = '11px sans-serif';
  labels.forEach((lab, i) => {
    const val = values[i] || 0;
    const bh = (val / max) * chartH;
    const x = padL + i * gap + (gap - barW) / 2;
    const y = padT + chartH - bh;
    const grad = ctx.createLinearGradient(0, y, 0, padT + chartH);
    grad.addColorStop(0, '#3C9BC4'); grad.addColorStop(1, '#12384C');
    ctx.fillStyle = grad;
    const r = Math.min(6, barW / 2, Math.max(0, bh));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, [r, r, 0, 0]);
    else ctx.rect(x, y, barW, bh);
    ctx.fill();
    ctx.fillStyle = isDark ? '#EDEFEA' : '#20272B';
    ctx.textAlign = 'center';
    ctx.fillText(val, x + barW / 2, y - 5);
    ctx.fillStyle = isDark ? '#AEB8B4' : '#4C5A60';
    ctx.fillText(lab, x + barW / 2, padT + chartH + 16);
  });
}

function drawPieChart(canvas, labels, values, colors) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(rect.width, 260), h = 220;
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = 70, cy = h / 2, r = 62;
  let start = -Math.PI / 2;
  labels.forEach((lab, i) => {
    const slice = (values[i] / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    start += slice;
  });
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  labels.forEach((lab, i) => {
    const ly = 34 + i * 20;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(160, ly - 9, 10, 10);
    ctx.fillStyle = isDark ? '#EDEFEA' : '#20272B';
    ctx.fillText(`${lab} (${values[i]})`, 176, ly);
  });
}
