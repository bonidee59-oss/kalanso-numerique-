/* ============================================================
   db.js — Couche d'accès aux données (IndexedDB)
   Ecole Numérique Burkina Faso
   ============================================================ */

let DB_NAME = 'ecole-bf-db';

/* Base locale (IndexedDB) propre à chaque école. Plusieurs écoles peuvent utiliser
   le même appareil : sans cela, les données de l'une se mélangeraient à celles de
   l'autre. La première école connectée sur l'appareil garde le nom historique
   (aucune donnée existante n'est déplacée) ; les suivantes ont leur propre base.
   cle = identifiant de l'école (ou 'u-<compte>' pour un compte du réseau).
   À appeler AVANT openDB(). */
function choisirBaseLocale(cle) {
  if (!cle) return;
  const CLE_PROPRIO = 'ecole-bf-db-proprietaire';
  let proprio = null;
  try { proprio = localStorage.getItem(CLE_PROPRIO); } catch (e) { /* stockage indisponible */ }
  if (!proprio) { try { localStorage.setItem(CLE_PROPRIO, cle); } catch (e) { /* idem */ } proprio = cle; }
  DB_NAME = proprio === cle ? 'ecole-bf-db' : 'ecole-bf-db-' + cle;
}
const DB_VERSION = 14;

const STORES = [
  'eleves', 'classes', 'enseignants', 'preparations', 'cahierTexte',
  'presencesEleves', 'presencesEnseignants', 'evaluations', 'matieres', 'cotisations',
  'fournitures', 'cantine', 'repas', 'discipline', 'coges', 'visites',
  'reunions', 'abandonsSuivi', 'activites', 'utilisateurs', 'documents',
  'finances', 'meta',
  'patrimoineDomaine', 'patrimoineInfra', 'patrimoineClasse',
  'rapportsMensuels', 'joursNonTravailles', 'cahierBord', 'cahierEnseignant', 'annoncesParents', 'courriers', 'cahierSemaine',
  'examSessions', 'examCentres', 'examJurys', 'examCandidats', 'examNotes', 'examRemontees',
  'listesCeb', // listes d'élèves récupérées par la CEB (copie locale, non synchronisée)
  'cepLocal' // circuit du CEP par le serveur : file d'attente hors ligne, copies de lecture, saisies du jour J (local, non synchronisé)
];

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((name) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        }
      });
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

/* --- Synchronisation temps réel (optionnelle) ---
   Ces magasins reçoivent un identifiant de synchronisation invisible (_uuid),
   utilisé uniquement pour le pont avec Supabase. Les identifiants locaux
   numériques ne changent pas et aucun autre fichier n'a besoin d'être modifié.
   Si supabase-sync.js n'est pas chargé (mode hors-ligne pur), ces points
   d'accroche ne font simplement rien. */
const SYNCED_STORES = new Set([
  'classes', 'eleves', 'enseignants', 'preparations', 'cahierTexte',
  'presencesEleves', 'presencesEnseignants', 'evaluations', 'matieres', 'cotisations',
  'fournitures', 'cantine', 'repas', 'discipline', 'coges', 'visites',
  'reunions', 'abandonsSuivi', 'activites', 'utilisateurs', 'documents',
  'finances', 'patrimoineDomaine', 'patrimoineInfra', 'patrimoineClasse',
  'meta', 'rapportsMensuels', 'joursNonTravailles', 'cahierBord', 'cahierEnseignant', 'annoncesParents', 'courriers', 'cahierSemaine',
  'examSessions', 'examCentres', 'examJurys', 'examCandidats', 'examNotes', 'examRemontees'
  // 'meta' est désormais synchronisé : nom de l'école, année scolaire, logo,
  // cachet et signature du directeur doivent être identiques sur tous les
  // appareils (ils apparaissent sur tous les documents imprimés).
]);

function genUuid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
  }));
}

/* Identifiant déterministe : la même clé texte (ex. "classe:CP1") donne
   TOUJOURS le même identifiant de synchronisation, même généré indépendamment
   sur deux appareils qui démarrent hors ligne avant toute synchronisation.
   Utilisé uniquement pour les données de référence créées automatiquement
   (classes standard, profils utilisateurs) afin d'éviter les doublons. */
function deterministicUuid(seed) {
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex = (a + b + a + b).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function notifySyncPush(store, action, obj) {
  if (typeof window !== 'undefined' && typeof window.gpNotifierChangement === 'function') {
    try { window.gpNotifierChangement(store); } catch (e) { /* publication aux parents : jamais bloquante */ }
  }
  if (typeof window !== 'undefined' && typeof window.prNotifierChangement === 'function') {
    try { window.prNotifierChangement(store); } catch (e) { /* remontée vers la CEB : jamais bloquante */ }
  }
  if (typeof window !== 'undefined' && typeof window.updateSyncCache === 'function') {
    try { window.updateSyncCache(store, action, obj); } catch (e) { /* le cache est un confort de performance, jamais bloquant */ }
  }
  if (SYNCED_STORES.has(store) && typeof window !== 'undefined' && typeof window.syncPush === 'function') {
    try { window.syncPush(store, action, obj); } catch (e) { /* la synchro est best-effort, jamais bloquante */ }
  }
}

/* Garde-fou (v51) : l'écran de saisie garde l'évaluation en mémoire pendant des minutes. Si la synchro a mis à jour
   la version enregistrée entre-temps (notes d'un collègue…), enregistrer la copie en mémoire écraserait ces notes.
   On conserve donc toute note enregistrée plus récemment (horodatage « t ») ou absente de la copie reçue. */
function protegerNotesEvaluation(ancien, obj) {
  if (!ancien || !Array.isArray(ancien.notes) || !ancien.notes.length) return obj;
  const cle = (n) => n.eleveId + '|' + (n.matiereId == null ? '' : n.matiereId);
  const matieres = Array.isArray(obj.matieresEval) && obj.matieresEval.length ? new Set(obj.matieresEval.map((m) => m.matiereId)) : null;
  const notes = (obj.notes || []).slice();
  const courantes = new Map(notes.map((n) => [cle(n), n]));
  let modifie = false;
  for (const o of ancien.notes) {
    if (o.eleveId === undefined) continue; // note encore en attente de son élève : gérée par la synchro
    const c = courantes.get(cle(o));
    if (!c) {
      if (matieres && o.matiereId != null && !matieres.has(o.matiereId)) continue; // matière retirée : pas de résurrection
      notes.push(o); modifie = true;
    } else if ((o.t || 0) > (c.t || 0)) { notes[notes.indexOf(c)] = o; modifie = true; }
  }
  return modifie ? { ...obj, notes } : obj;
}

const DB = {
  async getAll(store) {
    const os = await tx(store);
    return new Promise((res, rej) => {
      const r = os.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async get(store, id) {
    const os = await tx(store);
    return new Promise((res, rej) => {
      const r = os.get(Number(id));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async add(store, obj) {
    if (SYNCED_STORES.has(store) && !obj._uuid) obj._uuid = genUuid();
    const os = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = os.add(obj);
      r.onsuccess = () => { res(r.result); notifySyncPush(store, 'upsert', { ...obj, id: r.result }); };
      r.onerror = () => rej(r.error);
    });
  },
  async put(store, obj) {
    if (SYNCED_STORES.has(store) && !obj._uuid) obj._uuid = genUuid();
    if (store === 'evaluations' && obj.id != null) {
      try { const ancien = await DB.get(store, obj.id); if (ancien) obj = protegerNotesEvaluation(ancien, obj); } catch (e) { /* sans garde-fou en cas d'échec de lecture */ }
    }
    const os = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = os.put(obj);
      r.onsuccess = () => { res(r.result); notifySyncPush(store, 'upsert', obj); };
      r.onerror = () => rej(r.error);
    });
  },
  async delete(store, id) {
    let existing = null;
    if (SYNCED_STORES.has(store)) { try { existing = await DB.get(store, id); } catch (e) { /* ignore */ } }
    const os = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = os.delete(Number(id));
      r.onsuccess = () => { res(true); if (existing) notifySyncPush(store, 'delete', existing); };
      r.onerror = () => rej(r.error);
    });
  },
  async clear(store) {
    const os = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = os.clear();
      r.onsuccess = () => {
        res(true);
        if (typeof window !== 'undefined' && typeof window.invalidateSyncCacheStore === 'function') {
          try { window.invalidateSyncCacheStore(store); } catch (e) { /* confort de performance, jamais bloquant */ }
        }
      };
      r.onerror = () => rej(r.error);
    });
  },
  async count(store) {
    const os = await tx(store);
    return new Promise((res, rej) => {
      const r = os.count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
};

/* --- Sauvegarde / Restauration complète --- */
async function exportAllData() {
  const dump = {};
  for (const s of STORES) dump[s] = await DB.getAll(s);
  return dump;
}

async function importAllData(dump) {
  for (const s of STORES) {
    if (dump[s]) {
      await DB.clear(s);
      for (const row of dump[s]) await DB.put(s, row);
    }
  }
}

/* --- Amorçage initial (classes standard + admin) --- */
async function seedIfEmpty() {
  const nbClasses = await DB.count('classes');
  if (nbClasses === 0) {
    const niveaux = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
    for (const n of niveaux) {
      await DB.add('classes', {
        nom: n, niveau: n, enseignantId: null,
        emploiDuTemps: '', salle: '',
        _uuid: deterministicUuid('classe:' + n)
      });
    }
  }
  const nbUsers = await DB.count('utilisateurs');
  if (nbUsers === 0) {
    const roles = [
      { nom: 'Directeur / Directrice', role: 'directeur' },
      { nom: 'Directeur adjoint', role: 'directeur_adjoint' },
      { nom: 'Secrétariat', role: 'secretaire' },
      { nom: 'Comptabilité', role: 'comptable' },
      { nom: 'Magasinier', role: 'magasinier' },
      { nom: 'Gestion de la cantine', role: 'cantine' },
      { nom: 'Enseignant(e)', role: 'enseignant' }
    ];
    for (const r of roles) await DB.add('utilisateurs', { ...r, _uuid: deterministicUuid('utilisateur:' + r.role) });
  }
  const meta = await DB.getAll('meta');
  if (meta.length === 0) {
    await DB.add('meta', { cle: 'ecole', nomEcole: "École Primaire Publique", anneeScolaire: anneeScolaireCourante() });
  }
}

function anneeScolaireCourante() {
  const d = new Date();
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}
