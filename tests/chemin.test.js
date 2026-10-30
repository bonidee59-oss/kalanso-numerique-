const { creer } = require('./harness');
const ctx = creer(['tests/stub-routes.js', 'app-cahier-semaine.js']);
const ok = (c, m) => { if (!c) { console.error('ECHEC :', m); process.exit(1); } console.log('ok :', m); };
const W = (l, extra) => ({ type: 'semaine', annee: '2026-2027', lundi: l, classeNom: '', enseignantNom: '', jours: {}, ...extra });

// dates
ok(ctx.chmLundi('2026-10-30') === '2026-10-26', 'lundi d\'un vendredi');
ok(ctx.chmLundi('2026-11-01') === '2026-10-26', 'lundi d\'un dimanche = lundi précédent');
ok(ctx.chmAdd('2026-12-28', 7) === '2027-01-04', 'passage d\'année');
ok(ctx.chmAnnee('2026-10-05') === '2026-2027' && ctx.chmAnnee('2027-06-01') === '2026-2027' && ctx.chmAnnee('2026-09-01') === '2026-2027' && ctx.chmAnnee('2026-08-31') === '2025-2026', 'année scolaire');
// ordre par défaut
ok(ctx.chmOrdreParDefaut([{ nom: 'CM2' }, { nom: 'CP1' }, { nom: 'CE1' }, { nom: 'Maternelle' }]).join() === 'CP1,CE1,CM2,Maternelle', 'ordre CP1→CM2');
// lundis & semaines sautées
const l = ctx.chmLundis('2026-10-07', '2026-11-02', ['2026-10-19']);
ok(l.join() === '2026-10-05,2026-10-12,2026-10-26,2026-11-02', 'lundis hors semaines sautées');
// rotation
const ordre = ['CP1', 'CP2', 'CE1'];
const ens = (c) => 'Maître ' + c;
let s = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((x) => W(x));
ctx.chmAffecter(s, ordre, ens);
ok(s.map((x) => x.classeNom).join() === 'CP1,CP2,CE1,CP1,CP2', 'rotation circulaire');
ok(s[1].enseignantNom === 'Maître CP2', 'enseignant = titulaire de la classe');
// semaine commencée : verrouillée, la rotation reprend après elle
s = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((x) => W(x));
s[1].classeNom = 'CE1'; s[1].jours = { '2026-10-13': { entrees: [{ id: 'a', evenement: 'x' }] } };
ctx.chmAffecter(s, ordre, ens);
ok(s.map((x) => x.classeNom).join() === 'CP1,CE1,CP1,CP2', 'semaine commencée conservée, rotation reprise après elle');
// semaine modifiée à la main
s = ['2026-10-05', '2026-10-12', '2026-10-19'].map((x) => W(x));
s[0].classeNom = 'CP2'; s[0].manuel = true;
ctx.chmAffecter(s, ordre, ens);
ok(s.map((x) => x.classeNom).join() === 'CP2,CE1,CP1', 'semaine modifiée à la main conservée');
// remplaçant conservé
s = [W('2026-10-05', { enseignantNom: 'Remplaçant', enseignantManuel: true })];
ctx.chmAffecter(s, ordre, ens);
ok(s[0].enseignantNom === 'Remplaçant', 'enseignant remplaçant non écrasé');
// idempotence
const m = ctx.chmAffecter(s, ordre, ens);
ok(m.length === 0, 'second passage : rien à modifier');
ok(ctx.chmAffecter([W('2026-10-05')], [], ens).length === 0, 'ordre vide : aucune modification');
console.log('chemin : tous les tests passent');
