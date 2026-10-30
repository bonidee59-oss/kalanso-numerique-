/* Tests de la synchronisation (v51) : file d'attente, fusion des notes, pas d'écho, pagination, reprise. */
const vm = require('vm');
const { creer } = require('./harness');
let echecs = 0, ok_ = 0;
const ok = (c, msg) => { if (c) { ok_++; console.log('ok : ' + msg); } else { echecs++; console.log('ÉCHEC : ' + msg); } };
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- faux serveur Supabase (table app_data) ---- */
function fauxServeur() {
  const srv = { rows: [], journal: [], horloge: 0, panne: false };
  const tick = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++srv.horloge)).toISOString();
  srv.client = {
    from() {
      const q = { op: 'select', filtres: [], plage: null };
      const b = {
        select() { q.op = 'select'; return b; },
        eq(c, v) { q.filtres.push((r) => r[c] === v); return b; },
        gt(c, v) { q.filtres.push((r) => r[c] > v); return b; },
        in(c, vs) { q.filtres.push((r) => vs.includes(r[c])); return b; },
        order() { return b; },
        range(a, z) { q.plage = [a, z]; return b; },
        upsert(rows) { q.op = 'upsert'; q.rows = Array.isArray(rows) ? rows : [rows]; return b; },
        delete() { q.op = 'delete'; return b; },
        then(res, rej) {
          try {
            if (srv.panne) return res({ data: null, error: { message: 'Failed to fetch', status: 0 } });
            if (q.op === 'select') {
              let d = srv.rows.filter((r) => q.filtres.every((f) => f(r))).sort((x, y) => (x.updated_at < y.updated_at ? -1 : 1));
              srv.journal.push({ op: 'select', n: d.length });
              if (q.plage) d = d.slice(q.plage[0], q.plage[1] + 1);
              return res({ data: d.map((r) => ({ ...r })), error: null });
            }
            if (q.op === 'upsert') {
              q.rows.forEach((r) => {
                const i = srv.rows.findIndex((x) => x.ecole_id === r.ecole_id && x.store === r.store && x.uuid === r.uuid);
                const ligne = { ...r, updated_at: tick() }; // le serveur impose SON horodatage
                if (i >= 0) srv.rows[i] = ligne; else srv.rows.push(ligne);
              });
              srv.journal.push({ op: 'upsert', n: q.rows.length });
              return res({ data: null, error: null });
            }
            srv.rows = srv.rows.filter((r) => !q.filtres.every((f) => f(r)));
            srv.journal.push({ op: 'delete' });
            return res({ data: null, error: null });
          } catch (e) { rej(e); }
        }
      };
      return b;
    },
    channel() { return { on() { return this; }, subscribe() { return this; } }; }
  };
  srv.ajouter = (store, uuid, data) => srv.rows.push({ ecole_id: 'E1', store, uuid, data, updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++srv.horloge)).toISOString() });
  return srv;
}

/* ---- appareil de test : base locale qui prévient la synchro comme le fait db.js ---- */
function appareil() {
  const ctx = creer(['supabase-sync.js']);
  const run = (code) => vm.runInContext(code, ctx);
  const mem = new Map(); let seq = 1;
  const liste = (s) => { if (!mem.has(s)) mem.set(s, []); return mem.get(s); };
  const notifier = (s, a, o) => { ctx.updateSyncCache(s, a, o); ctx.syncPush(s, a, o); };
  ctx.DB = {
    async getAll(s) { return liste(s).map((r) => ({ ...r })); },
    async get(s, id) { const r = liste(s).find((x) => x.id === id); return r ? { ...r } : undefined; },
    async add(s, o) { const r = { ...o, id: seq++ }; if (!r._uuid) r._uuid = 'loc-' + r.id; liste(s).push(r); notifier(s, 'upsert', r); return r.id; },
    async put(s, o) { const l = liste(s); const i = l.findIndex((x) => x.id === o.id); l[i] = { ...o }; notifier(s, 'upsert', o); return o.id; },
    async delete(s, id) { const l = liste(s); const i = l.findIndex((x) => x.id === id); const ex = l[i]; l.splice(i, 1); notifier(s, 'delete', ex); }
  };
  const stockage = {};
  ctx.localStorage = { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; } };
  ctx.currentUser = { ecole_id: 'E1' };
  ctx.__stockage = stockage;
  run("const SYNCED_STORES = new Set(['classes','eleves','enseignants','matieres','evaluations','presencesEleves','meta']);");
  run('syncEnabled = true;');
  return { ctx, run, mem, liste };
}

(async () => {
  /* 1) Pas d'écho : une ligne reçue n'est JAMAIS renvoyée au serveur */
  {
    const srv = fauxServeur(); const a = appareil(); a.ctx.__srv = srv; a.run('supaClient = __srv.client;');
    srv.ajouter('eleves', 'ue1', { nom: 'Ouédraogo', prenom: 'Aminata' });
    const change = await a.run("mergeRemoteRow('eleves', { uuid: 'ue1', data: { nom: 'Ouédraogo', prenom: 'Aminata' }, updated_at: 'x' })");
    ok(change === true && a.liste('eleves').length === 1, 'ligne reçue enregistrée localement');
    ok(a.run('window.syncEnAttente()') === 0, 'ligne reçue : rien mis en file d\'envoi (pas d\'écho)');
    await a.run('flushOutbox()');
    ok(srv.journal.filter((j) => j.op === 'upsert').length === 0, 'ligne reçue : aucun envoi vers le serveur');
    const encore = await a.run("mergeRemoteRow('eleves', { uuid: 'ue1', data: { nom: 'Ouédraogo', prenom: 'Aminata' }, updated_at: 'x' })");
    ok(encore === false, 'même ligne reçue deux fois : aucun changement (pas de rafraîchissement inutile)');
  }

  /* 2) Envois groupés + coupure réseau sans perte */
  {
    const srv = fauxServeur(); const a = appareil(); a.ctx.__srv = srv; a.run('supaClient = __srv.client;');
    for (let i = 0; i < 120; i++) await a.ctx.DB.add('eleves', { nom: 'E' + i });
    ok(a.run('window.syncEnAttente()') === 120, '120 saisies mises en file');
    srv.panne = true;
    await a.run('flushOutbox()');
    ok(a.run('window.syncEnAttente()') === 120, 'réseau coupé : les 120 saisies restent en file (rien perdu)');
    ok(a.run('lastSyncState') === 'offline', 'réseau coupé : état « hors ligne »');
    srv.panne = false; srv.journal.length = 0;
    await a.run('flushOutbox()');
    const ups = srv.journal.filter((j) => j.op === 'upsert');
    ok(a.run('window.syncEnAttente()') === 0 && srv.rows.length === 120, 'réseau revenu : tout est envoyé');
    ok(ups.length === 3 && ups[0].n === 50, 'envois groupés par paquets de 50 (3 requêtes au lieu de 120)');
    ok(srv.rows.every((r) => /Z$/.test(r.updated_at)), 'horodatage imposé par le serveur');
  }

  /* 3) Évaluations : fusion note par note */
  {
    const srv = fauxServeur(); const a = appareil(); a.ctx.__srv = srv; a.run('supaClient = __srv.client;');
    const e1 = await a.ctx.DB.add('eleves', { nom: 'A', _uuid: 'ue1' });
    const e2 = await a.ctx.DB.add('eleves', { nom: 'B', _uuid: 'ue2' });
    const m1 = await a.ctx.DB.add('matieres', { nom: 'Maths', _uuid: 'um1' });
    await a.run('flushOutbox()'); srv.journal.length = 0;
    // l'évaluation locale a la note de A (récente) ; le serveur a la note de B (ajoutée par un collègue) et une ancienne note de A
    const evId = await a.ctx.DB.add('evaluations', { nom: 'Compo 1', _uuid: 'uv1', notes: [{ eleveId: e1, matiereId: m1, note: 10, t: 1000 }] });
    await a.run('flushOutbox()'); srv.journal.length = 0;
    srv.rows.find((r) => r.uuid === 'uv1').data.notes = [
      { eleveUuid: 'ue2', matiereUuid: 'um1', note: 15, t: 2000 },
      { eleveUuid: 'ue1', matiereUuid: 'um1', note: 5, t: 500 }
    ];
    const change = await a.run("mergeRemoteRow('evaluations', " + JSON.stringify(srv.rows.find((r) => r.uuid === 'uv1')) + ')');
    const ev = (await a.ctx.DB.getAll('evaluations'))[0];
    const noteDe = (id) => (ev.notes.find((n) => n.eleveId === id) || {}).note;
    ok(change && noteDe(e2) === 15, 'la note ajoutée par un collègue est reçue');
    ok(noteDe(e1) === 10, 'ma note plus récente n\'est pas écrasée par l\'ancienne du serveur');
    ok(a.run('window.syncEnAttente()') === 1, 'la note que le serveur n\'avait pas est remise en file d\'envoi');
    await a.run('flushOutbox()');
    const sn = srv.rows.find((r) => r.uuid === 'uv1').data.notes;
    ok(sn.length === 2 && sn.find((n) => n.eleveUuid === 'ue1').note === 10 && sn.find((n) => n.eleveUuid === 'ue2').note === 15, 'le serveur contient les deux notes après envoi');

    // envoi depuis un appareil qui ne connaît pas la note du collègue : elle n'est pas effacée
    const ev2 = (await a.ctx.DB.getAll('evaluations'))[0];
    ev2.notes = ev2.notes.filter((n) => n.eleveId !== e2); // copie « périmée » sans la note de B
    ev2.notes.push({ eleveId: e1, matiereId: m1, note: 12, t: 3000 });
    ev2.notes = ev2.notes.filter((n, i, t) => t.findIndex((x) => x.eleveId === n.eleveId) === i || n.t === 3000);
    await a.ctx.DB.put('evaluations', { ...ev2, notes: [{ eleveId: e1, matiereId: m1, note: 12, t: 3000 }] });
    await a.run('flushOutbox()');
    const fin = srv.rows.find((r) => r.uuid === 'uv1').data.notes;
    ok(fin.length === 2 && fin.find((n) => n.eleveUuid === 'ue2').note === 15 && fin.find((n) => n.eleveUuid === 'ue1').note === 12, 'copie périmée : la note du collègue survit, ma nouvelle note est envoyée');
  }

  /* 4) Note dont l'élève n'est pas encore arrivé : conservée puis rattachée */
  {
    const srv = fauxServeur(); const a = appareil(); a.ctx.__srv = srv; a.run('supaClient = __srv.client;');
    const m1 = await a.ctx.DB.add('matieres', { nom: 'Maths', _uuid: 'um1' });
    srv.ajouter('evaluations', 'uv9', { nom: 'Compo', notes: [{ eleveUuid: 'ue9', matiereUuid: 'um1', note: 13, t: 7 }] });
    await a.run("mergeRemoteRow('evaluations', " + JSON.stringify(srv.rows[0]) + ')');
    let ev = (await a.ctx.DB.getAll('evaluations'))[0];
    ok(ev.notes.length === 1 && ev.notes[0].eleveUuid === 'ue9' && ev.notes[0].note === 13, 'élève inconnu : la note est conservée (plus jetée)');
    srv.ajouter('eleves', 'ue9', { nom: 'Z' });
    await a.run("mergeRemoteRow('eleves', " + JSON.stringify(srv.rows[1]) + ')');
    await attendre(1300);
    ev = (await a.ctx.DB.getAll('evaluations'))[0];
    const eleve = (await a.ctx.DB.getAll('eleves'))[0];
    ok(ev.notes[0].eleveId === eleve.id && ev.notes[0].note === 13, 'l\'élève arrive : la note est rattachée automatiquement');
    srv.journal.length = 0;
    await a.run('flushOutbox()'); // seule la matière créée localement au début du test attend un envoi
    const envoyees = srv.journal.filter((j) => j.op === 'upsert').reduce((t, j) => t + j.n, 0);
    ok(envoyees === 1 && a.run('window.syncEnAttente()') === 0, 'rattachement : l\'évaluation et l\'élève reçus ne sont pas renvoyés au serveur');
  }

  /* 5) Pagination : plus de limite de 1000 lignes + repère de synchro du serveur */
  {
    const srv = fauxServeur(); const a = appareil(); a.ctx.__srv = srv; a.run('supaClient = __srv.client;');
    for (let i = 0; i < 2300; i++) srv.ajouter('presencesEleves', 'p' + i, { i });
    const n = await a.run('pullAllSyncedStores()');
    ok(a.liste('presencesEleves').length === 2300 && n === 2300, '2300 lignes téléchargées (pas de coupure à 1000)');
    const repere = a.ctx.__stockage['ecoleNumeriqueSync2:E1'];
    ok(repere === srv.rows[2299].updated_at, 'repère de synchro = horloge du serveur');
    srv.journal.length = 0;
    srv.ajouter('presencesEleves', 'nouveau', { i: -1 });
    const n2 = await a.run('pullAllSyncedStores()');
    ok(a.liste('presencesEleves').length === 2301 && n2 === 1, 'synchro suivante : seulement ce qui a changé');
  }

  /* 6) Garde-fou db.js : une copie périmée ne peut pas effacer une note plus récente */
  {
    const ctx = creer(['db.js']);
    const garde = vm.runInContext('protegerNotesEvaluation', ctx);
    const ancien = { id: 1, notes: [{ eleveId: 1, matiereId: 2, note: 14, t: 500 }, { eleveId: 3, matiereId: 2, note: 9, t: 400 }] };
    const perime = { id: 1, notes: [{ eleveId: 1, matiereId: 2, note: 8 }] };
    const res = garde(ancien, perime);
    ok(res.notes.find((n) => n.eleveId === 1).note === 14 && res.notes.some((n) => n.eleveId === 3), 'garde-fou : copie périmée → notes plus récentes conservées');
    const neuf = { id: 1, notes: [{ eleveId: 1, matiereId: 2, note: 18, t: 900 }] };
    ok(garde(ancien, neuf).notes.find((n) => n.eleveId === 1).note === 18, 'garde-fou : ma nouvelle saisie (plus récente) est enregistrée');
    const sansMatiere = { id: 1, matieresEval: [{ matiereId: 7 }], notes: [] };
    ok(garde(ancien, sansMatiere).notes.length === 0, 'garde-fou : une matière supprimée ne ressuscite pas ses notes');
  }

  console.log(`\n${ok_} réussi(s), ${echecs} échec(s)`);
  if (echecs) { console.log('Des tests échouent.'); process.exit(1); }
  console.log('Tous les tests passent.');
  process.exit(0);
})().catch((e) => { console.error('ERREUR', e); process.exit(1); });
