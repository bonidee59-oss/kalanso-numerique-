const { creer } = require('./harness');
const ctx = creer(['tests/stub-routes.js', 'app-personnel-reseau.js']);
const E = (id, nom, st, r, p, c) => ({ id, nom, statut: st, region: r, province: p, ceb: c });
const d = {
  ecoles: [E('a', 'EPP A', 'Publique', 'Centre', 'Kadiogo', 'Ouaga 1'), E('b', 'Ecole B', 'Privée', 'Centre', 'Kadiogo', 'Ouaga 1'),
    E('c', 'EPP C', 'Publique', 'Centre', 'Kadiogo', 'Ouaga 2'), E('d', 'EPP D', 'Publique', 'Hauts-Bassins', 'Houet', 'Bobo 1')],
  personnel: [{ id: 1, ecole_id: 'a' }, { id: 2, ecole_id: 'b' }, { id: 3, ecole_id: 'c' }, { id: 4, ecole_id: 'd' }],
  mouvements: [{ de_ecole: 'a', vers_ecole: 'b', de_region: 'Centre', de_province: 'Kadiogo', de_ceb: 'Ouaga 1', vers_region: 'Centre', vers_province: 'Kadiogo', vers_ceb: 'Ouaga 1' },
    { de_ecole: 'a', vers_ecole: 'c', de_region: 'Centre', de_province: 'Kadiogo', de_ceb: 'Ouaga 1', vers_region: 'Centre', vers_province: 'Kadiogo', vers_ceb: 'Ouaga 2' },
    { de_ecole: 'c', vers_ecole: 'd', de_region: 'Centre', de_province: 'Kadiogo', de_ceb: 'Ouaga 2', vers_region: 'Hauts-Bassins', vers_province: 'Houet', vers_ceb: 'Bobo 1' }]
};
const ok = (c, m) => { if (!c) { console.error('ECHEC :', m); process.exit(1); } console.log('ok :', m); };
let a = ctx.prAgreger(d, [], '');
const reg = Object.fromEntries(a.lignes.map((l) => [l.nom, l]));
ok(a.niveau === 'region' && reg.Centre.agents === 3 && reg['Hauts-Bassins'].agents === 1, 'agents par région');
ok(reg.Centre.sorties === 1 && reg['Hauts-Bassins'].entrees === 1, 'mutation inter-région comptée en sortie/entrée');
a = ctx.prAgreger(d, ['centre', 'centre|kadiogo'], '');
const ceb = Object.fromEntries(a.lignes.map((l) => [l.nom, l]));
ok(a.niveau === 'ceb' && ceb['Ouaga 1'].sorties === 1 && ceb['Ouaga 2'].entrees === 1 && ceb['Ouaga 2'].sorties === 1, 'mouvements entre CEB');
a = ctx.prAgreger(d, ['centre', 'centre|kadiogo', 'centre|kadiogo|ouaga1'], '');
ok(a.niveau === 'ecole' && a.lignes.length === 2 && a.lignes.find((l) => l.nom === 'Ecole B').entrees === 1, 'niveau école, mutation intra-CEB');
a = ctx.prAgreger(d, [], 'Privée');
ok(a.lignes.length === 1 && a.lignes[0].privees === 1 && a.lignes[0].agents === 1, 'filtre école privée');
// --- remontée école -> CEB
const ens = [{ id: 1, _uuid: 'u1', nom: 'Traoré', prenom: 'Awa', fonction: 'Instituteur' }, { id: 2, _uuid: 'u2', nom: 'Zongo', classeId: 12 }, { id: 3, nom: 'SansUuid' }, { id: 4, _uuid: 'u4', nom: 'Libre' }];
const cls = [{ id: 10, nom: 'CM1', enseignantId: 1 }, { id: 11, nom: 'CM2', enseignantId: 1 }, { id: 12, nom: 'CE1', enseignantId: null }];
const ag = ctx.prConstruireAgents(ens, cls);
ok(ag.length === 3, 'agent sans identifiant de synchronisation ignoré');
ok(ag[0].classe === 'CM1 / CM2', 'classe tenue = classes dont il est titulaire (multigrade)');
ok(ag[1].classe === 'CE1', 'à défaut, classe choisie dans la fiche enseignant');
ok(ag[2].classe === '' && ag[2].fonction === 'Enseignant', 'enseignant sans classe : envoyé quand même, classe vide');
// --- onglets par niveau : agrégation directe au niveau voulu, sans descendre région par région
a = ctx.prAgreger(d, [], '', 'ceb');
const cebs = Object.fromEntries(a.lignes.map((l) => [l.nom, l]));
ok(a.niveau === 'ceb' && a.lignes.length === 3 && cebs['Ouaga 1'].agents === 2 && cebs['Bobo 1'].entrees === 1, 'onglet CEB : toutes les CEB du périmètre');
a = ctx.prAgreger(d, [], 'Privée', 'ecole');
ok(a.niveau === 'ecole' && a.lignes.length === 1 && a.lignes[0].nom === 'Ecole B' && a.lignes[0].entrees === 1, 'onglet Écoles filtré sur les privées');
a = ctx.prAgreger({ ecoles: [d.ecoles[0]], personnel: [d.personnel[0]], mouvements: d.mouvements }, [], '', 'ecole');
ok(a.lignes.length === 1 && a.lignes[0].agents === 1 && a.lignes[0].sorties === 2, 'niveau école : ne voit que sa propre école et ses départs');

// --- Mutations vers une autre zone (v52) : arrivées visibles dans la zone d'arrivée
const vm = require('vm');
const maintenant = Date.UTC(2026, 9, 27);
const mv = [
  { personnel_id: 'p1', vers_ecole: 'c', de_nom: 'EPP A', de_ceb: 'Ouaga 1', date_effet: '2026-10-20' },
  { personnel_id: 'p1', vers_ecole: 'a', de_nom: 'Ancienne', date_effet: '2025-01-10' },
  { personnel_id: 'p2', vers_ecole: 'd', de_nom: 'EPP C', date_effet: '2026-02-01' },
  { personnel_id: 'p3', vers_ecole: 'b', de_nom: 'EPP A', date_effet: '2026-10-25' }
];
const arr = ctx.prArrivees(mv, 60, maintenant);
ok(arr.has('p1') && arr.get('p1').de_nom === 'EPP A', 'arrivée récente détectée (le mouvement le plus récent fait foi)');
ok(!arr.has('p2'), 'arrivée ancienne (> 60 jours) : pas d\'étiquette');
ok(arr.size === 2 && arr.has('p3'), 'une étiquette par agent');
vm.runInContext("var esc = (t) => String(t == null ? '' : t);", ctx);
ok(/Arrivé\(e\) de EPP A \(Ouaga 1\)/.test(ctx.prBadgeArrivee(arr.get('p1'))), 'étiquette « Arrivé(e) de … (CEB) »');
vm.runInContext("var cepNiveauCompte = () => 'dpeppnf'; var currentUser = { region: 'Centre', province: 'Kadiogo' };", ctx);
ok(ctx.prZoneCouvre('Centre', 'Kadiogo', 'Ouaga 1') === true && ctx.prZoneCouvre('Centre', 'Bazèga', 'X') === false && ctx.prZoneCouvre('Hauts-Bassins', 'Kadiogo', 'X') === false, 'DPEPPNF : zone = sa province');
vm.runInContext("cepNiveauCompte = () => 'ceb'; currentUser = { region: 'Centre', province: 'Kadiogo', ceb: 'Ouaga 2' };", ctx);
ok(ctx.prZoneCouvre('Centre', 'Kadiogo', 'Ouaga 2') === true && ctx.prZoneCouvre('Centre', 'Kadiogo', 'Ouaga 1') === false, 'CEB : zone = sa circonscription');
vm.runInContext("cepNiveauCompte = () => 'ministere';", ctx);
ok(ctx.prZoneCouvre('Nord', 'Yatenga', 'Ouahigouya') === true, 'ministère : tout le pays');
