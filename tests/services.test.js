const { creer } = require('./harness');
const ctx = creer(['tests/stub-services.js', 'app-bureaux.js', 'app-services.js']);
const ok = (c, m) => { if (!c) { console.error('ECHEC :', m); process.exit(1); } console.log('ok :', m); };
const run = (code) => require('vm').runInContext(code, ctx);

// --- Les 11 services demandés, sans doublon
const S = run('SERVICES');
ok(S.length === 11, '11 services du DPEPPNF');
ok(new Set(S.map((s) => s.code)).size === 11, 'codes uniques');
ok(['secretariat', 'sgrfm', 'sgrh', 'sep', 'sepp', 'senf', 'sec', 'speiefg', 'sempc', 'sascl', 'sctic'].every((c) => S.some((s) => s.code === c)), 'tous les codes attendus');
ok(run('serviceInfo("sempc").sigle') === 'SEmPC', 'sigle SEmPC');

// --- Les homologues pointent vers des codes qui existent des deux côtés
const codesB = run('BUREAUX').map((b) => b.code), codesS = S.map((s) => s.code);
ok(Object.entries(run('SERVICE_DU_BUREAU')).every(([b, s]) => codesB.includes(b) && codesS.includes(s)), 'bureau → service : codes valides');
ok(Object.values(run('BUREAUX_DU_SERVICE')).flat().every((b) => codesB.includes(b)) && Object.keys(run('BUREAUX_DU_SERVICE')).length === 11, 'service → bureaux : 11 entrées, codes valides');
ok(run('BUREAU_NATURES').every((n) => codesB.includes(n.bureau) && codesS.includes(n.service)), 'chaque nature a un bureau ET un service');
ok(run('BUREAU_NATURES.length') === 12, '3 natures ajoutées (inclusion, citoyenneté, numérique)');
ok(run('BUREAU_NATURES.find(n=>n.code==="personnel").service') === 'sgrh', 'personnel → SGRH');

// --- Rôle et niveau
ok(run('ROLES_RESEAU').includes('service') && run('ROUTE_ROLES["#/publications"]').includes('service'), 'rôle service : réseau + publications');
run('currentUser = { role: "service", service: "sgrh" }'); ok(run('resNiveau()') === 'dpeppnf', 'un service publie au niveau DPEPPNF');
run('currentUser = { role: "bureau", bureau: "bgrh" }'); ok(run('resNiveau()') === 'ceb', 'un bureau publie au niveau CEB');
ok(run('labelRole("service")') === 'Service du DPEPPNF', 'libellé du rôle');

// --- Libellés des destinataires
const dest = (d) => { ctx.__d = d; return run('svDestinataires(__d)'); };
ok(dest({ cibles: ['ceb'], bureaux: ['bgrh', 'bse'] }).join('|') === 'CEB (BGRH, BSE)', 'service → bureaux nommés');
ok(dest({ cibles: ['dpeppnf'], services: ['sgrh', 'sempc'] }).join('|') === 'DPEPPNF (SGRH, SEmPC)', 'bureau → services nommés');
ok(dest({ cibles: ['ecole', 'ceb'], bureaux: ['scr'], ceb_dest: ['Réo 1'] }).join('|') === 'École|CEB (Scr)|limité aux CEB : Réo 1', 'écoles + bureau + CEB visée');
ok(dest({ cibles: ['dpeppnf'] }).join('|') === 'DPEPPNF', 'sans service précis → DPEPPNF');

// --- DREPPNF (version 49)
ok(run('ROLES_RESEAU').includes('service_reg') && run('ROUTE_ROLES["#/publications"]').includes('service_reg'), 'rôle service_reg : réseau + publications');
run('currentUser = { role: "service_reg", service: "sec" }'); ok(run('resNiveau()') === 'dreppnf', 'un service régional publie au niveau DREPPNF');
ok(run('labelRole("service_reg")') === 'Service de la DREPPNF', 'libellé du rôle régional');
ok(dest({ cibles: ['dreppnf'], services_reg: ['sec', 'sep'] }).join('|') === 'DREPPNF (SEC, SEP)', 'vers services de la DREPPNF nommés');
ok(dest({ cibles: ['dpeppnf', 'ceb'], services: ['sec'], bureaux: ['bec'], province_dest: ['Sanguié'] }).join('|') === 'DPEPPNF (SEC)|CEB (BEC)|limité aux provinces : Sanguié', 'service régional → DPEPPNF + CEB, provinces visées');
ok(dest({ cibles: ['dreppnf'] }).join('|') === 'DREPPNF', 'sans service précis → DREPPNF');

// --- Ministère : services du Secrétariat général (version 50)
const M = run('SERVICES_MIN');
ok(M.length === 6 && new Set(M.map((s) => s.code)).size === 6, '6 services du Secrétariat général, codes uniques');
ok(['be', 'spsg', 'scc', 'sqe', 'sai', 'spsga'].every((c) => M.some((s) => s.code === c)), 'BE, SP/SG, SCC, SQE, SAI, SP/SGA');
ok(run('serviceInfo("spsg").sigle') === 'SP/SG' && run('serviceInfo("sai").nom') === "Service d'accueil et d'information", 'serviceInfo retrouve les services du SG');
ok(!M.some((m) => S.some((x) => x.code === m.code)), 'aucun code en commun avec les services des directions');
ok(run('ROLES_RESEAU').includes('service_min') && run('ROUTE_ROLES["#/publications"]').includes('service_min'), 'rôle service_min : réseau + publications');
run('currentUser = { role: "service_min", service: "scc" }'); ok(run('resNiveau()') === 'ministere', 'un service du SG publie au niveau ministère');
ok(run('labelRole("service_min")') === 'Service du Secrétariat général', 'libellé du rôle ministère');
ok(dest({ cibles: ['ministere'], services_min: ['be', 'sai'] }).join('|') === 'Ministère (BE, SAI)', 'vers services du SG nommés');
ok(dest({ cibles: ['ministere'] }).join('|') === 'Ministère', 'sans service précis → Ministère (SCC)');
ok(dest({ cibles: ['ecole', 'dreppnf'], services_reg: ['sep'], region_dest: ['Centre-Ouest'] }).join('|') === 'École|DREPPNF (SEP)|limité aux régions : Centre-Ouest', 'filtre par régions');

// --- resCharger : fausse base, avec repli si la migration n'est pas passée
function faux(docs, colonnesAbsentes) {
  const q = (cols) => ({ order() { return this; }, limit() { return Promise.resolve(colonnesAbsentes.some((c) => cols.includes(c)) ? { error: { message: 'column does not exist' } } : { data: docs.map((d) => ({ ...d })) }); } });
  ctx.window.supaClient = { from: (t) => t === 'circuit_accuses' ? { select: () => Promise.resolve({ data: [] }) } : { select: (c) => q(c) } };
}
const D = [{ id: 1, niveau: 'dpeppnf', cibles: ['ceb'], bureaux: ['bec'], services: [], nature: 'examens', categorie: 'Calendrier', ceb_dest: [] }];
faux(D, []);
const D2 = [{ id: 9, niveau: 'dreppnf', cibles: ['dreppnf'], services_reg: ['sgrh'], nature: 'personnel', categorie: 'Note' }];
let r; run('resCharger()').then((x) => { r = x; return null; }).then(() => {
  ok(r.docs[0].cibles[0] === 'CEB (BEC)' && r.docs[0].categorie === 'BEC · Calendrier', 'resCharger : destinataires et catégorie lisibles');
  faux([{ id: 2, niveau: 'ceb', cibles: ['ecole'], categorie: 'Rapport' }], ['services_reg']);
  return run('resCharger()');
}).then((x) => {
  ok(x.docs.length === 1, 'repli si services_reg/province_dest absents (base en version 48)');
  faux(D2, []);
  return run('resCharger()');
}).then((x) => {
  ok(x.docs[0].cibles[0] === 'DREPPNF (SGRH)' && x.docs[0].categorie === 'SGRH · Note', 'resCharger : services de la DREPPNF lisibles');
  faux([{ id: 2, niveau: 'ceb', cibles: ['ecole'], categorie: 'Rapport' }], ['services_min']);
  return run('resCharger()');
}).then((x) => {
  ok(x.docs.length === 1, 'repli si services_min/region_dest absents (base en version 49)');
  faux([{ id: 5, niveau: 'ministere', cibles: ['ministere'], services_min: ['sqe'], nature: 'x', categorie: 'Note' }], []);
  return run('resCharger()');
}).then((x) => {
  ok(x.docs[0].cibles[0] === 'Ministère (SQE)' && x.docs[0].categorie === 'SQE · Note', 'resCharger : services du SG lisibles');
  faux([{ id: 2, niveau: 'ceb', cibles: ['ecole'], categorie: 'Rapport' }], ['services']);
  return run('resCharger()');
}).then((x) => {
  ok(x.docs.length === 1 && x.docs[0].cibles[0] === 'École', 'repli si services/ceb_dest absents');
  faux([{ id: 3, niveau: 'ceb', cibles: ['ecole'] }], ['services', 'bureaux']);
  return run('resCharger()');
}).then((x) => { ok(x.docs.length === 1, 'repli si aucune colonne de bureau/service'); console.log('Tous les tests passent.'); }).catch((e) => { console.error('ECHEC :', e); process.exit(1); });
