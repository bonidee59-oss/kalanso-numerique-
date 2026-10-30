/* Tests des matricules CEP (v53) : synthèse de la remontée, association aux candidats, formats. */
const vm = require('vm');
const { creer } = require('./harness');
const ctx = creer(['tests/stub-routes.js', 'app-matricules-cep.js']);
let ok_ = 0, ko = 0;
const g = (nom) => vm.runInContext(nom, ctx);
const ok = (c, m) => { if (c) { ok_++; console.log('ok : ' + m); } else { ko++; console.log('ÉCHEC : ' + m); } };
vm.runInContext("var formatDate = (d) => String(d).split('-').reverse().join('/');", ctx);

/* Formats */
ok(g('mcPrefixeDefaut')('2025-2026') === 'CEP-2026-' && g('mcPrefixeDefaut')('2026') === 'CEP-2026-', 'préfixe par défaut : CEP-<année de fin>-');
ok(g('mcExemple')('CEP-2026-', 6, 1) === 'CEP-2026-000001' && g('mcExemple')('X', 4, 12345) === 'X12345', 'exemple de matricule (largeur fixe, jamais tronqué)');

/* Synthèse de la remontée */
const regions = [
  { region: 'Centre', ecoles_reseau: 10, listes: 8, validees: 8, a_corriger: 0, candidats: 800, candidats_valides: 800, numerotes: 0, publies: 0 },
  { region: 'Nord', ecoles_reseau: 5, listes: 5, validees: 5, a_corriger: 0, candidats: 400, candidats_valides: 400, numerotes: 0, publies: 0 }
];
let t = ctx.mcSynthese({ regions });
ok(t.toutRemonte && t.enAttenteCEB === 0, 'toutes les listes validées : « tout est remonté »');
ok(t.ecolesSansListe === 2 && t.candidatsValides === 1200 && t.resteANumeroter === 1200, '2 écoles sans liste signalées ; 1200 candidats à numéroter');
t = ctx.mcSynthese({ regions: [{ ...regions[0], validees: 6 }, regions[1]] });
ok(!t.toutRemonte && t.enAttenteCEB === 2, '2 listes en attente de la CEB : remontée incomplète');
t = ctx.mcSynthese({ regions: [{ ...regions[0], a_corriger: 1, validees: 7 }, regions[1]] });
ok(!t.toutRemonte && t.aCorriger === 1, 'une liste à corriger : remontée incomplète');
t = ctx.mcSynthese({ regions: [{ ...regions[0], numerotes: 800 }, { ...regions[1], numerotes: 400, publies: 400 }] });
ok(t.toutNumerote && !t.toutPublie && t.dejaNumerote, 'tout numéroté, pas encore tout publié');
t = ctx.mcSynthese({ regions: [{ ...regions[0], numerotes: 800, publies: 800 }, { ...regions[1], numerotes: 400, publies: 400 }] });
ok(t.toutPublie, 'tout publié');
t = ctx.mcSynthese(null);
ok(t.listes === 0 && !t.toutRemonte, 'aucune donnée : rien de remonté, sans erreur');

/* Matricules ↔ candidats */
const data = [{ nom: 'Ouédraogo', prenom: 'Awa', dateNaissance: '2014-03-02', eleveUuid: 'u1' }, { nom: 'Sawadogo', prenom: 'Ali', dateNaissance: '2014-05-09' }];
const lignes = ctx.mcLignes(data, ['CEP-2026-000001', 'CEP-2026-000002']);
ok(lignes[0].matriculeCEP === 'CEP-2026-000001' && lignes[1].matriculeCEP === 'CEP-2026-000002' && lignes[1].nom === 'Sawadogo', 'matricules alignés sur les candidats, dans le même ordre');
ok(ctx.mcLignes(data, ['A'])[1].matriculeCEP === '', 'matricule manquant : champ vide, pas d\'erreur');
ok(ctx.mcPlage(['B-3', 'B-1', 'B-2']) === 'B-1 → B-3' && ctx.mcPlage([]) === '—' && ctx.mcPlage(['Z']) === 'Z', 'plage de matricules d\'une liste');
const locaux = [
  { id: 1, eleveUuid: 'u1', nom: 'X', prenom: 'Y' },                                   // retrouvé par l'uuid de l'élève
  { id: 2, nom: 'sawadogo', prenom: 'ALI', dateNaissance: '2014-05-09' },              // retrouvé par nom + prénom + naissance (accents/casse ignorés)
  { id: 3, nom: 'Autre', prenom: 'Personne', dateNaissance: '2013-01-01' },            // absent de la liste
  { id: 4, eleveUuid: 'u1', matriculeCEP: 'CEP-2026-000001' }                          // déjà à jour : pas de réécriture
];
const paires = ctx.mcAppariement(lignes, locaux, (r) => (r.eleveUuid ? r.eleveUuid : g('mcCle')(r)));
ok(paires.length === 2 && paires.find((p) => p.rec.id === 1).matricule === 'CEP-2026-000001' && paires.find((p) => p.rec.id === 2).matricule === 'CEP-2026-000002', 'association par uuid puis par nom+prénom+naissance');
ok(!paires.some((p) => p.rec.id === 3 || p.rec.id === 4), 'candidat absent ou déjà à jour : ignoré');
ok(g('mcEntetesCSV')(true)[0].label === 'Région' && g('mcEntetesCSV')(false)[0].label === 'École', 'export CSV : colonnes de zone pour les niveaux supérieurs');
ok(/Réservé au ministère|ministère/.test(ctx.mcMsg(new Error('Réservé au ministère'))) && /supabase-matricules-cep/.test(ctx.mcMsg(new Error('Could not find the function public.cep_matricules_etat'))), 'messages d\'erreur compréhensibles');

console.log(`\n${ok_} réussi(s), ${ko} échec(s)`);
if (ko) { console.log('Des tests échouent.'); process.exit(1); }
console.log('Tous les tests passent.');
