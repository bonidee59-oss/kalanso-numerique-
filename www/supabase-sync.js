/* ============================================================
   supabase-sync.js — Synchronisation temps réel multi-utilisateurs
   ------------------------------------------------------------
   Couvre toutes les rubriques de données, y compris 'meta' (nom de l'école,
   logo, cachet, signature du directeur) afin que les documents imprimés
   soient identiques sur tous les appareils. Voir SYNCED_STORES dans db.js.
   N'utilise QUE la clé publique (publishable) — jamais la clé secrète.
   Fonctionne en mode "best effort" : si hors ligne ou si Supabase
   n'est pas joignable, l'application continue de fonctionner
   normalement en local (IndexedDB), et se resynchronise dès que
   la connexion revient.

   VERSION 51 — correctifs de fiabilité (notes qui disparaissaient, lenteur) :
   1) Ce qui est reçu n'est plus renvoyé au serveur (fin des « échos » qui écrasaient les saisies récentes).
   2) File d'attente d'envoi (outbox) conservée sur l'appareil : rien n'est perdu hors ligne, envois groupés.
   3) Évaluations fusionnées NOTE PAR NOTE (horodatage « t » de chaque note) au lieu d'écraser toute la ligne.
   4) Téléchargement par pages (la limite de 1000 lignes ne tronque plus rien), dans le bon ordre
      (classes → élèves → notes…), avec repère de synchro pris sur l'horloge du SERVEUR.
   5) Rattrapage au retour du réseau / de l'application (iOS coupe la connexion temps réel en arrière-plan).
   6) Index en mémoire : fini les recherches répétées dans de grandes listes.
   7) Le rafraîchissement automatique n'a plus lieu pendant une saisie.
   ============================================================ */

const SUPABASE_URL = 'https://vjjlyxmeaekktpkikrjd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_YFjhXZzAkcxO2feoxqTa4g_LhrbjdfA';
const SYNC_TABLE = 'app_data';

/* Le client Supabase est créé immédiatement (et non plus seulement dans
   syncBootstrap) car app-core.js en a besoin dès le démarrage pour
   l'authentification (écran de connexion), avant même de savoir si la
   synchronisation temps réel sera activée. */
let supaClient = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    // Session conservée en permanence sur l'appareil et renouvelée automatiquement : on ne retape pas le mot de passe
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: window.localStorage }
  })
  : null;
window.supaClient = supaClient;
/* Identifiant de l'école du compte connecté : toutes les lectures/écritures de la
   table partagée sont limitées à cette école (les règles RLS l'imposent aussi côté serveur). */
function ecoleSync() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.ecole_id) || null; }
let syncEnabled = false;
let lastSyncState = 'offline';
window.lastSyncState = lastSyncState;

/* Références entre magasins à traduire en clés stables pour le voyage réseau
   (les identifiants locaux sont propres à chaque appareil et n'ont aucun sens
   une fois envoyés ailleurs). "nom" = clé stable naturelle (ex. nom de classe).
   "_uuid" = identifiant de synchronisation de l'enregistrement référencé. */
const FK_CONFIG = {
  eleves: [{ field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' }],
  presencesEleves: [
    { field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' },
    { field: 'eleveId', refStore: 'eleves', by: '_uuid', payloadField: 'eleveUuid' }
  ],
  cotisations: [{ field: 'eleveId', refStore: 'eleves', by: '_uuid', payloadField: 'eleveUuid' }],
  enseignants: [{ field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' }],
  // Titulaire de la classe (les enseignants supplémentaires : enseignantIds, traité à part plus bas)
  classes: [{ field: 'enseignantId', refStore: 'enseignants', by: '_uuid', payloadField: 'enseignantUuid' }],
  presencesEnseignants: [{ field: 'enseignantId', refStore: 'enseignants', by: '_uuid', payloadField: 'enseignantUuid' }],
  evaluations: [{ field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' }],
  matieres: [{ field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' }],
  preparations: [
    { field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' },
    { field: 'enseignantId', refStore: 'enseignants', by: '_uuid', payloadField: 'enseignantUuid' }
  ],
  cahierTexte: [{ field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' }],
  abandonsSuivi: [{ field: 'eleveId', refStore: 'eleves', by: '_uuid', payloadField: 'eleveUuid' }],
  patrimoineClasse: [{ field: 'classeId', refStore: 'classes', by: 'nom', payloadField: 'classeNom' }]
  // discipline : cas particulier (cibleId pointe vers eleves OU enseignants
  // selon cibleType) — traité séparément ci-dessous.
  // fournitures, cantine, repas, coges, visites, reunions, activites,
  // utilisateurs, documents, finances, patrimoineDomaine, patrimoineInfra :
  // aucune référence à traduire, synchronisation directe.
};

/* ---------------- Cache mémoire + index ----------------
   Les lignes de chaque magasin sont gardées en mémoire, avec des index (id, uuid, nom)
   tenus à jour à chaque écriture (voir updateSyncCache, appelé depuis db.js) : plus aucune
   relecture complète ni recherche linéaire pour résoudre une référence. */
const _storeCache = new Map(); // store -> tableau de lignes en mémoire
const _idxCache = new Map();   // store -> { byId, byUuid, byNom }
const _chargements = new Map();
async function getAllCached(store) {
  if (_storeCache.has(store)) return _storeCache.get(store);
  if (!_chargements.has(store)) {
    _chargements.set(store, DB.getAll(store).then((rows) => { _storeCache.set(store, rows); _chargements.delete(store); return rows; }));
  }
  return _chargements.get(store);
}
function indexer(idx, r) {
  idx.byId.set(r.id, r);
  if (r._uuid) idx.byUuid.set(r._uuid, r);
  if (r.nom !== undefined) idx.byNom.set(r.nom, r);
}
async function getIdx(store) {
  let idx = _idxCache.get(store);
  if (idx) return idx;
  const rows = await getAllCached(store);
  idx = { byId: new Map(), byUuid: new Map(), byNom: new Map() };
  for (const r of rows) indexer(idx, r);
  _idxCache.set(store, idx);
  return idx;
}
function updateSyncCache(store, action, obj) {
  const rows = _storeCache.get(store);
  if (!rows) return; // pas encore chargé : rien à maintenir, il sera chargé à la demande
  const i = rows.findIndex((r) => r.id === obj.id);
  const ancien = i >= 0 ? rows[i] : null;
  if (action === 'delete') { if (i >= 0) rows.splice(i, 1); }
  else if (i >= 0) rows[i] = obj;
  else rows.push(obj);
  const idx = _idxCache.get(store);
  if (idx) {
    if (ancien) {
      idx.byId.delete(ancien.id);
      if (ancien._uuid) idx.byUuid.delete(ancien._uuid);
      if (ancien.nom !== undefined && idx.byNom.get(ancien.nom) === ancien) idx.byNom.delete(ancien.nom);
    }
    if (action !== 'delete') indexer(idx, obj);
  }
}
window.updateSyncCache = updateSyncCache;
window.invalidateSyncCacheStore = (store) => { _storeCache.delete(store); _idxCache.delete(store); };

async function resolveIdToKey(store, localId, by) {
  if (localId === undefined || localId === null || localId === '') return null;
  const idx = await getIdx(store);
  const row = idx.byId.get(Number(localId));
  if (!row) return null;
  return by === '_uuid' ? (row._uuid || null) : row[by];
}
async function resolveKeyToId(store, keyValue, by) {
  if (!keyValue) return undefined;
  const idx = await getIdx(store);
  let found;
  if (by === '_uuid') found = idx.byUuid.get(keyValue);
  else if (by === 'nom') found = idx.byNom.get(keyValue);
  else found = (await getAllCached(store)).find((r) => r[by] === keyValue);
  return found ? found.id : undefined;
}

/* ---------------- Ne jamais renvoyer ce qui vient d'être reçu ----------------
   Quand on enregistre localement une ligne reçue du serveur, db.js déclenche normalement
   un envoi. Cet ensemble l'en empêche : c'était la cause principale des notes écrasées. */
const _appliquant = new Set();
async function ecrireDistant(fn, store, uuid) {
  const k = store + '|' + uuid;
  _appliquant.add(k);
  try { return await fn(); } finally { _appliquant.delete(k); }
}

/* ---------------- File d'attente d'envoi (outbox) ----------------
   On ne garde que « quelle ligne est à envoyer » (store + uuid + action), jamais les données :
   au moment de l'envoi on relit la version LA PLUS RÉCENTE de la ligne sur l'appareil.
   Conservée dans localStorage : survit à la fermeture de l'application et aux coupures. */
const OUTBOX_KEY = 'ecoleNumeriqueOutbox';
let _outbox = null, _outboxEcole = null;
function outboxLoad() {
  const ecole = ecoleSync();
  if (_outbox && _outboxEcole === ecole) return _outbox;
  _outbox = new Map(); _outboxEcole = ecole;
  try {
    const raw = localStorage.getItem(OUTBOX_KEY + ':' + (ecole || ''));
    if (raw) JSON.parse(raw).forEach((e) => _outbox.set(e.store + '|' + e.uuid, e));
  } catch (e) { /* file illisible : on repart d'une file vide */ }
  return _outbox;
}
function outboxSave() {
  try { localStorage.setItem(OUTBOX_KEY + ':' + (_outboxEcole || ''), JSON.stringify([..._outbox.values()])); } catch (e) { /* quota : la file reste en mémoire */ }
}
window.syncEnAttente = () => outboxLoad().size;

function enfiler(store, uuid, action) {
  const ob = outboxLoad();
  const k = store + '|' + uuid;
  const prev = ob.get(k);
  ob.set(k, { store, uuid, action, n: (prev ? prev.n : 0) + 1 });
  outboxSave();
  setSyncBadge(navigator.onLine === false ? 'offline' : 'pending');
  planifierEnvoi(1500);
}
function acquitter(e) {
  const ob = outboxLoad();
  const k = e.store + '|' + e.uuid;
  const cur = ob.get(k);
  if (cur && cur.n === e.n) ob.delete(k); // modifiée entre-temps : elle reste en file
  outboxSave();
}

/* ---------------- Poussée locale → Supabase ---------------- */
async function syncPush(store, action, obj) {
  if (!syncEnabled || !supaClient || !obj || !obj._uuid) return;
  if (_appliquant.has(store + '|' + obj._uuid)) return; // donnée reçue du serveur : on ne la renvoie pas
  enfiler(store, obj._uuid, action === 'delete' ? 'delete' : 'upsert');
}
window.syncPush = syncPush;

let _envoiEnCours = false, _envoiTimer = null, _delaiRepli = 5000;
function planifierEnvoi(ms) { clearTimeout(_envoiTimer); _envoiTimer = setTimeout(flushOutbox, ms); }

/* Erreur « réseau » (à réessayer) ou refus du serveur (règle de sécurité, contrainte…) */
const estRefusServeur = (error) => !!(error && (error.code || error.status >= 400) && error.status !== 0 && !/fetch|network|timeout/i.test(error.message || ''));

async function flushOutbox() {
  if (_envoiEnCours) { planifierEnvoi(1000); return; }
  if (!syncEnabled || !supaClient) return;
  const ob = outboxLoad();
  if (!ob.size) { setSyncBadge('online'); return; }
  if (navigator.onLine === false) { setSyncBadge('offline'); return; }
  _envoiEnCours = true;
  let ok = true;
  try {
    const ecole = ecoleSync();
    const entrees = [...ob.values()];
    const lignes = [];
    for (const e of entrees.filter((x) => x.action !== 'delete')) {
      const idx = await getIdx(e.store);
      const obj = idx.byUuid.get(e.uuid);
      if (!obj) { acquitter(e); continue; } // supprimée localement entre-temps
      lignes.push({ e, store: e.store, uuid: e.uuid, payload: await buildRemotePayload(e.store, obj) });
    }
    // Évaluations : on fusionne avec la version du serveur avant d'écrire, pour ne jamais effacer les notes d'un autre appareil
    const evs = lignes.filter((l) => l.store === 'evaluations');
    if (evs.length) {
      const { data, error } = await supaClient.from(SYNC_TABLE).select('uuid,data').eq('ecole_id', ecole).eq('store', 'evaluations').in('uuid', evs.map((l) => l.uuid));
      if (error) throw error;
      const distant = new Map((data || []).map((r) => [r.uuid, r.data || {}]));
      evs.forEach((l) => { const d = distant.get(l.uuid); if (d) l.payload = fusionEvaluationPayload(l.payload, d); });
    }
    const maintenant = new Date().toISOString(); // le serveur le remplace par SA propre heure (voir supabase-sync-v51.sql)
    for (let i = 0; i < lignes.length; i += 50) {
      const lot = lignes.slice(i, i + 50);
      const rows = lot.map((l) => ({ ecole_id: ecole, store: l.store, uuid: l.uuid, data: l.payload, updated_at: maintenant }));
      const { error } = await supaClient.from(SYNC_TABLE).upsert(rows, { onConflict: 'ecole_id,store,uuid' });
      if (!error) { lot.forEach((l) => acquitter(l.e)); continue; }
      if (!estRefusServeur(error)) throw error;
      // Une ligne refusée ne doit pas bloquer les autres : on les envoie une par une
      for (let j = 0; j < lot.length; j++) {
        const r = await supaClient.from(SYNC_TABLE).upsert(rows[j], { onConflict: 'ecole_id,store,uuid' });
        if (!r.error) acquitter(lot[j].e);
        else if (estRefusServeur(r.error)) {
          console.warn('Ligne refusée par le serveur (abandonnée) :', lot[j].store, lot[j].uuid, r.error.message);
          window.syncRejets = (window.syncRejets || 0) + 1;
          acquitter(lot[j].e);
        } else throw r.error;
      }
    }
    // Suppressions, groupées par rubrique
    const parStore = new Map();
    for (const e of entrees.filter((x) => x.action === 'delete')) {
      if (!parStore.has(e.store)) parStore.set(e.store, []);
      parStore.get(e.store).push(e);
    }
    for (const [store, liste] of parStore) {
      const { error } = await supaClient.from(SYNC_TABLE).delete().eq('ecole_id', ecole).eq('store', store).in('uuid', liste.map((x) => x.uuid));
      if (error) { if (estRefusServeur(error)) { liste.forEach(acquitter); } else throw error; }
      else liste.forEach(acquitter);
    }
    _delaiRepli = 5000;
    setSyncBadge(ob.size ? 'pending' : 'online');
    pulseSyncIndicator();
  } catch (e) {
    ok = false;
    console.warn('Envoi différé (hors ligne ?) :', e.message || e);
    setSyncBadge('offline');
    _delaiRepli = Math.min(_delaiRepli * 2, 60000);
    planifierEnvoi(_delaiRepli);
  } finally {
    _envoiEnCours = false;
  }
  if (ok && outboxLoad().size) planifierEnvoi(400); // des modifications sont arrivées pendant l'envoi
}
window.flushOutbox = flushOutbox;

/* ---------------- Fabrication des données à envoyer ---------------- */
const cleNote = (n) => n.eleveUuid + '|' + (n.matiereUuid || '');

/* Fusion note par note : pour une même case (élève × matière), la note la plus récente (horodatage « t ») gagne ;
   à égalité, c'est la version « prioritaire » qui gagne. Une note n'est jamais perdue parce qu'un autre appareil
   a enregistré autre chose dans la même évaluation. */
function fusionNotes(prio, autre, matieres) {
  const m = new Map();
  (autre || []).forEach((n) => m.set(cleNote(n), n));
  (prio || []).forEach((n) => { const o = m.get(cleNote(n)); if (!o || (n.t || 0) >= (o.t || 0)) m.set(cleNote(n), n); });
  let out = [...m.values()];
  // Une matière supprimée de l'évaluation ne doit pas ressusciter ses notes
  if (Array.isArray(matieres) && matieres.length && matieres.every((x) => x.matiereUuid)) {
    const ok = new Set(matieres.map((x) => x.matiereUuid));
    out = out.filter((n) => !n.matiereUuid || ok.has(n.matiereUuid));
  }
  return out;
}
function fusionEvaluationPayload(prio, autre) {
  const res = { ...autre, ...prio };
  const matieres = Array.isArray(prio.matieresEval) ? prio.matieresEval : autre.matieresEval;
  if (matieres) res.matieresEval = matieres;
  res.notes = fusionNotes(prio.notes, autre.notes, matieres);
  if (Array.isArray(prio.appreciations) || Array.isArray(autre.appreciations)) {
    const m = new Map();
    (autre.appreciations || []).forEach((a) => m.set(a.eleveUuid, a));
    (prio.appreciations || []).forEach((a) => m.set(a.eleveUuid, a));
    res.appreciations = [...m.values()];
  }
  return res;
}
const trierNotes = (notes) => (notes || []).map((n) => cleNote(n) + '=' + n.note + '@' + (n.t || 0)).sort().join(';');

async function buildRemotePayload(store, obj) {
  const payload = { ...obj };

  for (const fk of FK_CONFIG[store] || []) {
    if (obj[fk.field] !== undefined && obj[fk.field] !== null && obj[fk.field] !== '') {
      payload[fk.payloadField] = await resolveIdToKey(fk.refStore, obj[fk.field], fk.by);
    }
    delete payload[fk.field];
  }

  // Cas particulier : discipline (cibleId pointe vers eleves ou enseignants selon cibleType)
  if (store === 'discipline' && obj.cibleId) {
    const refStore = obj.cibleType === 'enseignant' ? 'enseignants' : 'eleves';
    payload.cibleUuid = await resolveIdToKey(refStore, obj.cibleId, '_uuid');
    delete payload.cibleId;
  }

  // Cas particulier : plusieurs enseignants par classe (liste d'identifiants locaux -> liste d'uuid)
  if (store === 'classes' && Array.isArray(obj.enseignantIds)) {
    payload.enseignantUuids = (await Promise.all(obj.enseignantIds.map((i) => resolveIdToKey('enseignants', i, '_uuid')))).filter(Boolean);
    delete payload.enseignantIds;
  }

  if (store === 'evaluations') {
    // Notes : chaque note référence un élève et une matière (+ horodatage « t » pour la fusion)
    if (Array.isArray(obj.notes)) {
      const notes = [];
      for (const n of obj.notes) {
        const eleveUuid = (await resolveIdToKey('eleves', n.eleveId, '_uuid')) || n.eleveUuid || null;
        if (!eleveUuid) continue;
        const matiereUuid = n.matiereId != null
          ? ((await resolveIdToKey('matieres', n.matiereId, '_uuid')) || n.matiereUuid || null)
          : (n.matiereUuid || null);
        const o = { eleveUuid, matiereUuid, note: n.note };
        if (n.t) o.t = n.t;
        notes.push(o);
      }
      payload.notes = notes;
    }
    // Barème/coefficient figés au moment de la création de l'évaluation
    if (Array.isArray(obj.matieresEval)) {
      const ms = [];
      for (const m of obj.matieresEval) {
        const matiereUuid = m.matiereId != null ? ((await resolveIdToKey('matieres', m.matiereId, '_uuid')) || m.matiereUuid || null) : (m.matiereUuid || null);
        ms.push({ matiereUuid, nom: m.nom, coefficient: m.coefficient, bareme: m.bareme });
      }
      payload.matieresEval = ms;
    }
    // Appréciations par élève
    if (Array.isArray(obj.appreciations)) {
      const as = [];
      for (const a of obj.appreciations) {
        const eleveUuid = (await resolveIdToKey('eleves', a.eleveId, '_uuid')) || a.eleveUuid || null;
        if (eleveUuid) as.push({ eleveUuid, texte: a.texte });
      }
      payload.appreciations = as;
    }
  }

  return payload;
}

/* ---------------- Abonnement temps réel (à appeler après le démarrage) ----------------
   Le rafraîchissement automatique reconstruit la page : il ne se déclenche que si des données ont
   réellement changé, et jamais pendant qu'on saisit (champ actif, ou valeur tapée non encore validée). */
let _derniereInteraction = 0;
['keydown', 'input', 'change', 'pointerdown', 'touchstart'].forEach((nom) => {
  if (typeof document !== 'undefined') document.addEventListener(nom, () => { _derniereInteraction = Date.now(); }, { passive: true, capture: true });
});
function saisieEnCours() {
  const recent = Date.now() - _derniereInteraction;
  const actif = document.activeElement;
  if (actif && ['INPUT', 'TEXTAREA', 'SELECT'].includes(actif.tagName) && recent < 60000) return true;
  if (recent > 20000) return false;
  const champs = document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=search]), textarea, select');
  for (const c of champs) {
    if (c.type === 'checkbox' || c.type === 'radio') { if (c.checked !== c.defaultChecked) return true; }
    else if (c.tagName === 'SELECT') { if (Array.from(c.options).some((o) => o.selected !== o.defaultSelected)) return true; }
    else if (c.value !== c.defaultValue) return true;
  }
  return false;
}
let _syncRenderDebounce = null;
function scheduleSyncRerender() {
  clearTimeout(_syncRenderDebounce);
  _syncRenderDebounce = setTimeout(() => {
    if (saisieEnCours()) { scheduleSyncRerender(); return; } // réessaie plus tard, sans perdre la saisie
    if (typeof onRouteChange === 'function') onRouteChange();
  }, 1200);
}

let _realtimeCoupe = false;
function startRealtime() {
  if (!syncEnabled || !supaClient) return;
  try { if (typeof window.prDemarrerTempsReel === 'function') window.prDemarrerTempsReel(); } catch (e) { /* annonce des mutations : facultative */ }
  supaClient.channel('app_data_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: SYNC_TABLE, filter: `ecole_id=eq.${ecoleSync()}` }, async (payload) => {
      const store = payload.new?.store || payload.old?.store;
      if (!store || !SYNCED_STORES.has(store)) return;
      let change = false;
      try {
        if (payload.eventType === 'DELETE') change = await removeByUuid(store, payload.old.uuid);
        else change = await mergeRemoteRow(store, payload.new);
      } catch (e) { console.warn('Mise à jour reçue ignorée :', e.message || e); }
      if (change) { scheduleSyncRerender(); pulseSyncIndicator(); }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setSyncBadge(outboxLoad().size ? 'pending' : 'online');
        if (_realtimeCoupe) { _realtimeCoupe = false; rattraper(true); } // ce qui s'est passé pendant la coupure
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        _realtimeCoupe = true;
        setSyncBadge('offline');
      }
    });
}

/* ---------------- Récupération Supabase → local (fusion) ---------------- */
const LAST_SYNC_KEY = 'ecoleNumeriqueSync2'; // v51 : repère pris sur l'horloge du serveur
const PAGE = 1000;
/* Ordre de fusion : les rubriques dont les autres dépendent d'abord */
const ORDRE_FUSION = ['classes', 'enseignants', 'meta', 'matieres', 'eleves', 'utilisateurs'];
const _enAttente = new Map(); // lignes reçues dont une référence n'est pas encore connue (store|uuid -> {store, tentative})
let _pullEnCours = null;

function pullAllSyncedStores() {
  if (_pullEnCours) return _pullEnCours;
  _pullEnCours = _pullAll().finally(() => { _pullEnCours = null; });
  return _pullEnCours;
}
async function _pullAll() {
  const ecole = ecoleSync();
  const cleSync = LAST_SYNC_KEY + ':' + ecole;
  const depuis = localStorage.getItem(cleSync);
  // marge de 2 minutes : une ligne validée un peu après son horodatage n'est jamais manquée (la fusion est sans effet si rien n'a changé)
  const seuil = depuis ? new Date(new Date(depuis).getTime() - 120000).toISOString() : null;
  const stores = [...ORDRE_FUSION.filter((s) => SYNCED_STORES.has(s)), ...[...SYNCED_STORES].filter((s) => !ORDRE_FUSION.includes(s))];
  // 1) Téléchargement en parallèle, par pages de 1000
  const lots = new Map();
  await Promise.all(stores.map(async (store) => {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = supaClient.from(SYNC_TABLE).select('*').eq('ecole_id', ecole).eq('store', store)
        .order('updated_at', { ascending: true }).order('uuid', { ascending: true }).range(from, from + PAGE - 1);
      if (seuil) q = q.gt('updated_at', seuil);
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    lots.set(store, rows);
  }));
  // 2) Fusion dans l'ordre (une rubrique à la fois)
  let nbChanges = 0, maxVu = depuis || null;
  for (const store of stores) {
    for (const row of lots.get(store) || []) {
      if (await mergeRemoteRow(store, row)) nbChanges++;
      if (!maxVu || row.updated_at > maxVu) maxVu = row.updated_at;
    }
  }
  // N'enregistre le repère qu'après succès complet : une synchro interrompue ne doit rien faire sauter
  if (maxVu) localStorage.setItem(cleSync, maxVu);
  return nbChanges;
}

/* Rejoue les lignes dont une référence (classe, élève, matière…) n'était pas encore arrivée */
let _repriseTimer = null;
function planifierReprise() {
  clearTimeout(_repriseTimer);
  _repriseTimer = setTimeout(async () => {
    if (!_enAttente.size) return;
    const attente = [..._enAttente.entries()];
    _enAttente.clear();
    const parStore = new Map();
    attente.forEach(([, v]) => { if (!parStore.has(v.store)) parStore.set(v.store, []); parStore.get(v.store).push(v); });
    let change = false;
    try {
      for (const [store, liste] of parStore) {
        const { data, error } = await supaClient.from(SYNC_TABLE).select('*').eq('ecole_id', ecoleSync()).eq('store', store).in('uuid', liste.map((v) => v.uuid));
        if (error) throw error;
        for (const row of data || []) {
          const v = liste.find((x) => x.uuid === row.uuid);
          if (await mergeRemoteRow(store, row, v ? v.tentative : 0)) change = true;
        }
      }
    } catch (e) { attente.forEach(([k, v]) => _enAttente.set(k, v)); }
    if (change) scheduleSyncRerender();
  }, 800);
}

async function mergeRemoteRow(store, row, tentative = 0) {
  const idx = await getIdx(store);
  const existant = idx.byUuid.get(row.uuid);
  const cle = store + '|' + row.uuid;
  const enFile = outboxLoad().get(cle);
  if (enFile && enFile.action === 'delete') return false;                 // suppression locale en attente d'envoi
  if (enFile && existant && store !== 'evaluations') return false;        // modification locale en attente : elle sera envoyée et fera foi

  let pl = row.data || {};
  let besoinEnvoi = false;
  if (store === 'evaluations' && existant) {
    const local = await buildRemotePayload(store, existant);
    pl = fusionEvaluationPayload(enFile ? local : pl, enFile ? pl : local);
    besoinEnvoi = !enFile && trierNotes(pl.notes) !== trierNotes((row.data || {}).notes); // notes que le serveur n'avait pas encore
  }

  let incomplet = false;
  const obj = { ...pl, _uuid: row.uuid };
  delete obj.id; // l'id local est toujours généré par l'appareil, jamais reçu du réseau

  for (const fk of FK_CONFIG[store] || []) {
    if (pl[fk.payloadField] !== undefined) {
      const localId = await resolveKeyToId(fk.refStore, pl[fk.payloadField], fk.by);
      if (localId !== undefined) obj[fk.field] = localId;
      else if (pl[fk.payloadField] !== null) incomplet = true;
      delete obj[fk.payloadField];
    }
  }

  if (store === 'discipline' && pl.cibleUuid) {
    const refStore = pl.cibleType === 'enseignant' ? 'enseignants' : 'eleves';
    const localId = await resolveKeyToId(refStore, pl.cibleUuid, '_uuid');
    if (localId !== undefined) obj.cibleId = localId; else incomplet = true;
    delete obj.cibleUuid;
  }

  if (store === 'classes' && Array.isArray(pl.enseignantUuids)) {
    const ids = (await Promise.all(pl.enseignantUuids.map((u) => resolveKeyToId('enseignants', u, '_uuid')))).filter((i) => i !== undefined);
    if (ids.length < pl.enseignantUuids.length) incomplet = true;
    obj.enseignantIds = ids;
    delete obj.enseignantUuids;
  }

  if (store === 'evaluations') {
    if (Array.isArray(pl.matieresEval)) {
      obj.matieresEval = [];
      for (const m of pl.matieresEval) {
        const id = m.matiereUuid ? await resolveKeyToId('matieres', m.matiereUuid, '_uuid') : undefined;
        const o = { matiereId: id, nom: m.nom, coefficient: m.coefficient, bareme: m.bareme };
        if (m.matiereUuid && id === undefined) { o.matiereUuid = m.matiereUuid; incomplet = true; }
        obj.matieresEval.push(o);
      }
    }
    if (Array.isArray(pl.notes)) {
      obj.notes = [];
      for (const n of pl.notes) {
        const eleveId = await resolveKeyToId('eleves', n.eleveUuid, '_uuid');
        const matiereId = n.matiereUuid ? await resolveKeyToId('matieres', n.matiereUuid, '_uuid') : undefined;
        const o = { eleveId, matiereId, note: n.note };
        if (n.t) o.t = n.t;
        // Une note dont l'élève/la matière n'est pas encore arrivé est CONSERVÉE (avec son uuid), jamais jetée
        if (eleveId === undefined) { o.eleveUuid = n.eleveUuid; incomplet = true; }
        if (n.matiereUuid && matiereId === undefined) { o.matiereUuid = n.matiereUuid; incomplet = true; }
        obj.notes.push(o);
      }
    }
    if (Array.isArray(pl.appreciations)) {
      obj.appreciations = [];
      for (const a of pl.appreciations) {
        const eleveId = await resolveKeyToId('eleves', a.eleveUuid, '_uuid');
        if (eleveId === undefined) { obj.appreciations.push({ eleveId, eleveUuid: a.eleveUuid, texte: a.texte }); incomplet = true; }
        else obj.appreciations.push({ eleveId, texte: a.texte });
      }
    }
  }

  let change = false;
  if (existant) {
    const nouveau = { ...existant, ...obj, id: existant.id };
    if (JSON.stringify(existant) !== JSON.stringify(nouveau)) {
      await ecrireDistant(() => DB.put(store, nouveau), store, row.uuid);
      change = true;
    }
  } else {
    await ecrireDistant(() => DB.add(store, obj), store, row.uuid);
    change = true;
  }

  if (incomplet && tentative < 20) _enAttente.set(cle, { store, uuid: row.uuid, tentative: tentative + 1 });
  else _enAttente.delete(cle);
  if (change && ['classes', 'enseignants', 'matieres', 'eleves'].includes(store) && _enAttente.size) planifierReprise();
  if (besoinEnvoi) enfiler(store, row.uuid, 'upsert');
  return change;
}

async function removeByUuid(store, uuid) {
  const idx = await getIdx(store);
  const existant = idx.byUuid.get(uuid);
  if (!existant) return false;
  if (outboxLoad().has(store + '|' + uuid)) return false; // modifiée localement : on garde
  await ecrireDistant(() => DB.delete(store, existant.id), store, uuid);
  return true;
}

/* ---------------- Rattrapage : retour du réseau, retour dans l'application ----------------
   Sur téléphone, la connexion temps réel est coupée quand l'application passe en arrière-plan :
   au retour, on récupère ce qui a changé et on envoie ce qui attendait. */
let _dernierRattrapage = 0;
async function rattraper(force) {
  if (!syncEnabled || !supaClient) return;
  const maintenant = Date.now();
  if (!force && maintenant - _dernierRattrapage < 20000) return;
  _dernierRattrapage = maintenant;
  try {
    setSyncBadge('connecting');
    await flushOutbox();
    const n = await pullAllSyncedStores();
    if (n) scheduleSyncRerender();
    setSyncBadge(outboxLoad().size ? 'pending' : 'online');
  } catch (e) { setSyncBadge('offline'); }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rattraper(false); });
  window.addEventListener('online', () => rattraper(true));
  window.addEventListener('offline', () => setSyncBadge('offline'));
}

/* ---------------- Amorçage (bloquant) : à appeler AVANT seedIfEmpty() ----------------
   Récupère ce qui existe déjà côté serveur pour qu'un nouvel appareil n'aille
   pas recréer ses propres classes/profils par défaut en double. Ne bloque
   jamais longtemps : abandonne après un court délai si hors ligne. */
async function syncBootstrap() {
  if (!supaClient) {
    console.warn("Bibliothèque Supabase non chargée — l'application fonctionne en mode local uniquement.");
    return;
  }
  if (!ecoleSync()) {
    console.warn("Compte non rattaché à une école (profil sans ecole_id) : synchronisation désactivée. Rejouez supabase-setup.sql puis reconnectez-vous.");
    return;
  }
  try {
    syncEnabled = true;
    setSyncBadge('connecting');
    const pull = pullAllSyncedStores();
    pull.then((n) => { if (n) scheduleSyncRerender(); return flushOutbox(); }).catch(() => {});
    await Promise.race([pull, new Promise((resolve) => setTimeout(resolve, 4000))]); // ne bloque pas le démarrage si hors ligne
    setSyncBadge(outboxLoad().size ? 'pending' : 'online');
  } catch (e) {
    console.warn('Synchronisation initiale indisponible (hors ligne ?) :', e.message || e);
    setSyncBadge('offline');
  }
}

/* ---------------- Indicateur de connexion (bouton + trait qui se remplit) ---------------- */
function setSyncBadge(state) {
  lastSyncState = state;
  window.lastSyncState = state;
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;
  const map = {
    online: ['vert', 'Synchronisé'],
    offline: ['terre', 'Hors ligne'],
    connecting: ['ocre', 'Connexion…'],
    pending: ['ocre', 'Envoi en cours…']
  };
  const [color, texte] = map[state] || map.offline;
  dot.className = `sync-dot sync-dot-${color}`;
  const n = typeof window.syncEnAttente === 'function' ? window.syncEnAttente() : 0;
  label.textContent = (state === 'offline' && n) ? `Hors ligne (${n} à envoyer)` : texte;
}

/* Anime le trait du bouton de synchro à chaque mise à jour (au lieu d'empiler
   des bandeaux "Mise à jour reçue en temps réel" à l'écran). Ignore les appels
   trop rapprochés (< 400 ms) : sans ça, une rafale de mises à jour (ex. une
   synchro qui rattrape plusieurs changements d'un coup) relance l'animation
   des dizaines de fois par seconde et donne cette impression de "tremblement"
   à l'écran, en plus de forcer inutilement le navigateur à recalculer
   l'affichage à chaque fois. */
let _lastPulseAt = 0;
function pulseSyncIndicator() {
  const maintenant = Date.now();
  if (maintenant - _lastPulseAt < 400) return;
  _lastPulseAt = maintenant;
  const fill = document.getElementById('sync-fill');
  const btn = document.getElementById('sync-btn');
  if (!fill) return;
  if (btn) btn.title = 'Dernière mise à jour : ' + new Date().toLocaleTimeString('fr-FR');
  fill.style.transition = 'none';
  fill.style.width = '0%';
  void fill.offsetWidth; // force le recalcul avant de relancer l'animation
  fill.style.transition = 'width .6s ease';
  fill.style.width = '100%';
  clearTimeout(window._syncFillTimeout);
  window._syncFillTimeout = setTimeout(() => {
    fill.style.transition = 'width .4s ease';
    fill.style.width = '0%';
  }, 650);
}
