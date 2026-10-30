const assert = require('assert');
const { creer } = require('./harness');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✔', nom); } catch (e) { ko++; console.log('  ✘', nom, '\n     ', e.message); } };
const B = ['app-core.js', 'app-examens-calcul.js', 'app-cep-core.js', 'app-cep-tableaux.js', 'app-cep-calendrier.js', 'app-cep-validation.js', 'app-cep-jourj.js'];
const C = () => creer(B);
const J = (c, expr) => require('vm').runInContext(expr, c);

(async () => {
console.log('Zones, agrégation, sans donnée');
await t('normalisation de zone (accents, majuscules, espaces)', () => {
  const c = C(); assert.strictEqual(J(c, "cepCleZone('Centre-Ouest','Sanguié','Réo 1')"), 'centreouest|sangui|reo1'.replace('sangui', 'sanguie'));
});
const donnees = (c) => J(c, `({
  annee:'2026-2027', type:'cep', charge_le:'2026-10-18T10:00:00Z',
  structures:[
    {role:'dreppnf',structure:'DREPPNF Centre-Ouest',region:'Centre-Ouest',province:null,ceb:null},
    {role:'dreppnf',structure:'DREPPNF Hauts-Bassins',region:'Hauts-Bassins',province:null,ceb:null},
    {role:'dpeppnf',structure:'DPEPPNF Sanguié',region:'Centre-Ouest',province:'Sanguié',ceb:null},
    {role:'dpeppnf',structure:'DPEPPNF Boulkiemdé',region:'Centre-Ouest',province:'Boulkiemdé',ceb:null},
    {role:'dpeppnf',structure:'DPEPPNF Houet',region:'Hauts-Bassins',province:'Houet',ceb:null},
    {role:'ceb',structure:'CEB Réo 1',region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 1'},
    {role:'ceb',structure:'CEB Réo 2',region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 2'},
    {role:'ceb',structure:'CEB Koudougou 1',region:'Centre-Ouest',province:'Boulkiemdé',ceb:'Koudougou 1'}],
  effectifs:[
    {id:'e1',region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 1',inscrits_f:60,inscrits_g:70,nb_ecoles:10,nb_ecoles_attendues:12,nb_centres:3,nb_jurys:2,nb_salles:9,nb_handicap:2,nb_bilingues:5,statut:'transmis',version:1},
    {id:'e2',region:'centre ouest',province:'sanguie',ceb:'REO 2',inscrits_f:40,inscrits_g:50,nb_ecoles:8,nb_ecoles_attendues:8,nb_centres:2,nb_jurys:1,nb_salles:6,nb_handicap:0,nb_bilingues:0,statut:'a_corriger',motif_retour:'Effectifs trop bas',renvoye_par_niveau:'dpeppnf',version:2}],
  bordereaux:[{id:'b1',region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 1',f_inscrits:60,f_absents:5,f_admis:40,f_ajournes:15,f_exclus:0,g_inscrits:72,g_absents:6,g_admis:44,g_ajournes:22,g_exclus:0,handicap_inscrits:2,handicap_admis:1,bilingues_inscrits:5,bilingues_admis:4,statut:'valide',niveau_valide:'dpeppnf',version:1}],
  centresResume:[{region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 1',nb_centres:3,nb_jurys:2,nb_a_risque:1,nb_candidats:130,nb_complets:3}],
  jourjResume:[{region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 1',epreuve_code:'E1',epreuve_nom:'Dictée',nb_centres_saisis:3,nb_presents:120,nb_absents:8,nb_enveloppes:3,nb_recus:2,nb_scelles_anormaux:1,inc_fraude:1,inc_sante:2,inc_securite:0,inc_logistique:0,inc_autre:0}],
  centresRisque:[{id:'c1',region:'Centre-Ouest',province:'Sanguié',ceb:'Réo 1',nom:'EPP de Zawara',statut_risque:'delocalise',motif_risque:'Inondation',centre_accueil:'EPP Réo B',risque_par_nom:'M. Traoré'}],
  calendrier:[{etape:'inscriptions',niveau:'tous',date_limite:'2026-10-01'},{etape:'depot_resultats',niveau:'tous',date_limite:'2026-10-10'},{etape:'composition',niveau:'tous',date_debut:'2026-11-01',date_limite:'2026-11-05'}],
  avancement:[]})`);
await t('le DPEPPNF Sanguié : 2 CEB, 1 seule a des données de résultats', () => {
  const c = C(), d = donnees(c); c.__d = d;
  const r = J(c, "(()=>{const u=cepConstruireUnites(__d).filter(x=>cepNorm(x.province)==='sanguie');const a=cepAgreger(u);return {n:u.length,a:{inscrits:a.inscrits,f:a.inscritsF,eff:a.effTransmis,bord:a.bordTransmis,centres:a.centres,jurys:a.jurys,hand:a.handicap,bil:a.bilingues,taux:a.res.taux,corriger:a.aCorriger}}})()");
  assert.strictEqual(r.n, 2); assert.strictEqual(r.a.inscrits, 220); assert.strictEqual(r.a.f, 100); assert.strictEqual(r.a.eff, 2);
  assert.strictEqual(r.a.bord, 1); assert.strictEqual(r.a.hand, 2); assert.strictEqual(r.a.bil, 5); assert.strictEqual(r.a.corriger, 1);
  assert.strictEqual(r.a.centres, 5); // 3 (résumé serveur) + 2 (effectifs de Réo 2 sans résumé de centres)
  assert.ok(Math.abs(r.a.taux - 84 / 121 * 100) < 0.01);
});
await t("une zone écrite autrement (casse, accents) tombe dans la même CEB", () => {
  const c = C(); c.__d = donnees(c);
  assert.strictEqual(J(c, "cepConstruireUnites(__d).filter(x=>x.cle==='centreouest|sanguie|reo2').length"), 1);
});
await t('ministère : arbre régions > provinces > CEB, zones sans donnée signalées', () => {
  const c = C(); c.__d = donnees(c);
  const r = J(c, `(()=>{const u=cepConstruireUnites(__d);const ar=cepConstruireArbre(u,__d.structures,'ministere');
    return ar.map(r=>({nom:r.nom,sans:r.sansDonnee,prov:r.enfants.map(p=>({nom:p.nom,sans:p.sansDonnee,ceb:p.enfants.length}))}))})()`);
  assert.strictEqual(r.length, 2);
  const hb = r.find((x) => x.nom === 'Hauts-Bassins'); assert.strictEqual(hb.sans, true);
  assert.strictEqual(hb.prov[0].nom, 'Houet'); assert.strictEqual(hb.prov[0].sans, true); assert.strictEqual(hb.prov[0].ceb, 0);
  const co = r.find((x) => x.nom === 'Centre-Ouest'); assert.strictEqual(co.sans, false);
  assert.strictEqual(co.prov.find((p) => p.nom === 'Boulkiemdé').sans, true); // province avec CEB mais aucune donnée
});
await t('DREPPNF : arbre province > CEB ; DPEPPNF : liste de CEB', () => {
  const c = C(); c.__d = donnees(c);
  const dr = J(c, "cepConstruireArbre(cepConstruireUnites(__d).filter(u=>cepNorm(u.region)==='centreouest'),__d.structures.filter(s=>cepNorm(s.region)==='centreouest'),'dreppnf').map(p=>p.nom+':'+p.enfants.length)");
  assert.deepStrictEqual([...dr].sort(), ['Boulkiemdé:1', 'Sanguié:2']);
  const dp = J(c, "cepConstruireArbre(cepConstruireUnites(__d).filter(u=>cepNorm(u.province)==='sanguie'),[],'dpeppnf').map(n=>n.niveau)");
  assert.deepStrictEqual([...dp], ['ceb', 'ceb']);
});

console.log('Échéances et anomalies');
await t('retards : inscriptions et résultats dépassés pour une CEB sans envoi', () => {
  const c = C(); c.__d = donnees(c);
  const an = J(c, "cepAnomalies(cepConstruireUnites(__d),__d.calendrier,'2026-10-18').map(a=>a.code+'@'+a.zone)");
  assert.ok(an.includes('retard_effectifs@CEB Koudougou 1')); assert.ok(an.includes('retard_resultats@CEB Réo 2'));
  assert.ok(!an.includes('retard_effectifs@CEB Réo 1'));
});
await t('anomalies du jour J : enveloppe sans accusé, scellé abîmé, écart présents+absents, centre à risque, renvoi, écart inscrits', () => {
  const c = C(); c.__d = donnees(c);
  const codes = [...J(c, "cepAnomalies(cepConstruireUnites(__d),__d.calendrier,'2026-10-18').map(a=>a.code)")];
  ['enveloppe_sans_accuse', 'scelle_anormal', 'jourj_ecart', 'centre_risque', 'a_corriger', 'ecart_inscrits', 'incidents', 'ecoles_manquantes'].forEach((k) => assert.ok(codes.includes(k), 'manque ' + k));
});
await t("échéances : fait / retard / bientôt / à venir / pas commencé / sans date", () => {
  const c = C();
  const r = J(c, `(()=>{const e=(d,f,a,deb)=>cepEtatEcheance({date_limite:d,date_debut:deb},f,a).etat;
    return [e('2026-10-01',false,'2026-10-18'),e('2026-10-01',true,'2026-10-18'),e('2026-10-20',false,'2026-10-18'),e('2026-12-01',false,'2026-10-18'),e('2026-12-01',false,'2026-10-18','2026-11-01'),cepEtatEcheance(null,false,'2026-10-18').etat]})()`);
  assert.deepStrictEqual([...r], ['retard', 'fait', 'bientot', 'a_venir', 'pas_commence', 'sans_date']);
});
await t('échéance propre à un niveau prioritaire sur « tous »', () => {
  const c = C();
  assert.strictEqual(J(c, "cepEcheance([{etape:'composition',niveau:'tous',date_limite:'2026-11-05'},{etape:'composition',niveau:'ceb',date_limite:'2026-11-02'}],'composition','ceb').date_limite"), '2026-11-02');
  assert.strictEqual(J(c, "cepEcheance([{etape:'composition',niveau:'tous',date_limite:'2026-11-05'}],'composition','dpeppnf').date_limite"), '2026-11-05');
});
await t('situation des étapes : composition complète seulement si tous les centres sont complets', () => {
  const c = C(); c.__d = donnees(c);
  const r = J(c, "cepSituationEtapes('dpeppnf',cepConstruireUnites(__d).filter(u=>cepNorm(u.province)==='sanguie'),__d.calendrier,'2026-10-18').map(s=>s.etape.code+':'+s.faits+'/'+s.total+':'+s.etat)");
  assert.ok(r.includes('inscriptions:2/2:fait')); assert.ok(r.includes('depot_resultats:1/2:retard')); assert.ok(r.includes('composition:1/2:a_venir'.replace('a_venir', 'pas_commence')));
});

console.log('Validation hiérarchique (miroir des règles SQL)');
await t('chaîne DPEPPNF → DREPPNF → ministère', () => {
  const c = C();
  const a = (role, r) => J(c, `cepActionsPossibles('${role}', ${JSON.stringify(r)})`);
  const tr = { statut: 'transmis', niveau_valide: null }, vp = { statut: 'valide', niveau_valide: 'dpeppnf' }, vr = { statut: 'valide', niveau_valide: 'dreppnf' }, ac = { statut: 'a_corriger' };
  assert.strictEqual(a('dpeppnf', tr).valider, true); assert.strictEqual(a('dreppnf', tr).valider, false); assert.strictEqual(a('ministere', tr).valider, false);
  assert.strictEqual(a('dreppnf', vp).valider, true); assert.strictEqual(a('ministere', vp).valider, false); assert.strictEqual(a('ministere', vr).valider, true);
  assert.strictEqual(a('dpeppnf', vr).renvoyer, false, 'un niveau inférieur ne renvoie pas ce qu\'un supérieur a validé');
  assert.strictEqual(a('dreppnf', vp).renvoyer, true); assert.strictEqual(a('ministere', vr).renvoyer, true);
  assert.strictEqual(a('dpeppnf', ac).valider, false); assert.strictEqual(a('dpeppnf', ac).renvoyer, false); assert.strictEqual(a('ceb', tr).valider, false);
});
await t('statuts affichés', () => {
  const c = C();
  assert.strictEqual(J(c, "cepStatutDoc({statut:'valide',niveau_valide:'dreppnf'}).label"), 'Validé (DREPPNF)');
  assert.strictEqual(J(c, "cepStatutDoc(null).label"), 'Pas transmis'); assert.strictEqual(J(c, "cepStatutDoc({statut:'a_corriger'}).label"), 'À corriger');
});

console.log('Chiffres transmis : cohérence et AUCUN nom');
const resultatsFictifs = `({seuil:10,stats:{moyenneGenerale:11.2345,parEpreuve:[{nom:'Maths',moyenne:10.555,nb:5}]},lignes:[
  {candidat:{nom:'OUEDRAOGO',prenom:'Awa',sexe:'F',handicap:true,bilingue:false},decision:'admis',moyenne:12},
  {candidat:{nom:'SAWADOGO',prenom:'Idrissa',sexe:'M',handicap:false,bilingue:true},decision:'ajourne',moyenne:8},
  {candidat:{nom:'KABORE',prenom:'Fati',sexe:'F'},decision:'absent',moyenne:null},
  {candidat:{nom:'ZONGO',prenom:'Paul',sexe:'M',bilingue:true},decision:'admis',moyenne:14}]})`;
await t('bordereau fabriqué depuis les résultats : totaux, handicap, bilingues, arrondis', () => {
  const c = C(); c.__r = J(c, resultatsFictifs); c.__s = { annee: '2026-2027', type: 'cep' };
  const p = J(c, "cepBordereauDepuisResultats(__s,__r)");
  assert.deepStrictEqual({ ...p.f }, { inscrits: 2, absents: 1, admis: 1, ajournes: 0, exclus: 0 });
  assert.deepStrictEqual({ ...p.g }, { inscrits: 2, absents: 0, admis: 1, ajournes: 1, exclus: 0 });
  assert.strictEqual(p.handicap_inscrits, 1); assert.strictEqual(p.handicap_admis, 1); assert.strictEqual(p.bilingues_inscrits, 2); assert.strictEqual(p.bilingues_admis, 1);
  assert.strictEqual(p.moyenne, 11.23); assert.strictEqual(p.epreuves[0].moyenne, 10.56);
  assert.deepStrictEqual([...J(c, "cepControlerBordereau(cepBordereauDepuisResultats(__s,__r))")], []);
});
await t("aucun nom de candidat dans ce qui part vers le serveur (bordereau, effectifs, centres)", () => {
  const c = C(); c.__r = J(c, resultatsFictifs); c.__s = { annee: '2026-2027', type: 'cep' };
  c.__ctx = J(c, "({session:{annee:'2026-2027',type:'cep',epreuves:[{code:'E1',nom:'Dictée'}]},centres:[{_uuid:'c1',nom:'EPP Réo A',jury:'J1',nbSalles:3,capaciteSalle:30}],candidats:[{nom:'OUEDRAOGO',prenom:'Awa',sexe:'F',ecole:'EPP Réo A',centreUuid:'c1',handicap:true},{nom:'ZONGO',prenom:'Paul',sexe:'M',ecole:'EPP B',centreUuid:'c1',bilingue:true}]})");
  const sortie = JSON.stringify([J(c, "cepBordereauDepuisResultats(__s,__r)"), J(c, "cepEffectifsDepuisSession(__ctx,3)"), J(c, "cepListeCentresPublication(__ctx)")]);
  ['OUEDRAOGO', 'SAWADOGO', 'KABORE', 'ZONGO', 'Awa', 'Idrissa', 'Fati', 'Paul'].forEach((n) => assert.ok(!sortie.includes(n), 'fuite : ' + n));
});
await t("effectifs depuis la session : filles/garçons, écoles, centres, jurys, handicap, bilingues", () => {
  const c = C(); c.__ctx = J(c, "({candidats:[{sexe:'F',ecole:'A',handicap:true},{sexe:'M',ecole:'a'},{sexe:'M',ecole:'B',bilingue:true}],centres:[{jury:'J1',nbSalles:2},{jury:'J1',nbSalles:3},{jury:'',nbSalles:1}]})");
  const e = J(c, "cepEffectifsDepuisSession(__ctx,4)");
  assert.strictEqual(e.inscrits_f, 1); assert.strictEqual(e.inscrits_g, 2); assert.strictEqual(e.nb_ecoles, 2); assert.strictEqual(e.nb_centres, 3); assert.strictEqual(e.nb_jurys, 2);
  assert.strictEqual(e.nb_salles, 6); assert.strictEqual(e.nb_handicap, 1); assert.strictEqual(e.nb_bilingues, 1); assert.strictEqual(e.nb_ecoles_attendues, 4);
});
await t('contrôle bordereau : candidats en attente et incohérences refusés', () => {
  const c = C();
  const e1 = [...J(c, "cepControlerBordereau({type:'cep',attente:2,f:{inscrits:3,absents:0,admis:1,ajournes:0,exclus:0},g:{inscrits:1,absents:0,admis:1,ajournes:0,exclus:0}})")];
  assert.ok(e1[0].includes('en attente'));
  const e2 = [...J(c, "cepControlerBordereau({type:'cep',attente:0,f:{inscrits:3,absents:1,admis:1,ajournes:0,exclus:0},g:{inscrits:1,absents:0,admis:1,ajournes:0,exclus:0}})")];
  assert.ok(e2.some((m) => m.includes('incohérents')));
  assert.ok([...J(c, "cepControlerBordereau({type:'blanc',attente:0,f:{inscrits:1,absents:0,admis:1,ajournes:0,exclus:0},g:{inscrits:0,absents:0,admis:0,ajournes:0,exclus:0}})")].some((m) => m.includes('blanc')));
});

console.log('Affichage (HTML)');
await t('tableau de bord ministère : cartes, zones sans donnée, centres à risque, aucune fuite de texte HTML brut', () => {
  const c = C(); c.__d = donnees(c);
  const h = J(c, "cepHtmlTableau(__d,'ministere',[],'2026-10-18')");
  assert.ok(h.includes('Aucune donnée')); assert.ok(h.includes('Hauts-Bassins')); assert.ok(h.includes('EPP de Zawara')); assert.ok(h.includes('Délocalisé'));
  assert.ok(h.includes('1 centre(s) à risque') || h.includes('centre(s) à risque'));
  assert.ok(h.includes('Situation de handicap') && h.includes('Candidats bilingues'));
  assert.ok(!h.includes('undefined') && !h.includes('NaN'), 'undefined/NaN dans le HTML');
});
await t('descente dans une région puis une province', () => {
  const c = C(); c.__d = donnees(c);
  const h = J(c, "cepHtmlTableau(__d,'ministere',['region:centreouest','province:sangui'.replace('sangui','sanguie')],'2026-10-18')");
  assert.ok(h.includes('CEB Réo 1') && h.includes('CEB Réo 2') && !h.includes('Koudougou 1</td>'));
  assert.ok(!h.includes('undefined') && !h.includes('NaN'));
});
await t('tableau vide (aucune donnée du tout) sans erreur', () => {
  const c = C();
  const h = J(c, "cepHtmlTableau({annee:'2026-2027',structures:[],effectifs:[],bordereaux:[],centresResume:[],jourjResume:[],centresRisque:[],calendrier:[],avancement:[]},'dpeppnf',[],'2026-10-18')");
  assert.ok(h.includes('Aucune CEB')); assert.ok(!h.includes('undefined') && !h.includes('NaN'));
});
await t('hors ligne : bandeau avec la date', () => {
  const c = C(); c.__d = donnees(c); c.__d.horsLigne = true;
  assert.ok(J(c, "cepHtmlTableau(__d,'ministere',[],'2026-10-18')").includes('Pas de connexion'));
});
await t('calendrier : alertes de retard pour la CEB', () => {
  const c = C(); c.__d = donnees(c);
  const h = J(c, "cepHtmlCalendrier(__d,'ceb',cepConstruireUnites(__d).filter(u=>u.ceb==='Koudougou 1'),'2026-10-18',{})");
  assert.ok(h.includes('Alertes') && h.includes('En retard de 17 jour(s)'));
  assert.ok(J(c, "cepHtmlCalendrier({calendrier:[]},'ecole',null,'2026-10-18',{})").includes("pas encore fixé"));
});
await t('validation : la DPEPPNF voit « Valider » seulement sur ce qui est transmis', () => {
  const c = C(); c.__d = donnees(c);
  const h = J(c, "cepHtmlSuperieur(__d,'dpeppnf','tous')");
  assert.ok(h.includes('data-valider="effectifs:e1"')); assert.ok(!h.includes('data-valider="bordereau:b1"')); assert.ok(h.includes('Effectifs trop bas'));
  const h2 = J(c, "cepHtmlSuperieur(__d,'dreppnf','avalider')");
  assert.ok(h2.includes('data-valider="bordereau:b1"')); assert.ok(!h2.includes('data-valider="effectifs'));
});
await t('journal : libellés en français', () => {
  const c = C();
  const h = J(c, "cepHtmlJournal([{le:'2026-10-18T09:30:00Z',acteur_nom:'M. Traoré',acteur_role:'dpeppnf',action:'renvoyer',cible:'bordereau',version:2,province:'Sanguié',ceb:'Réo 1',motif:'Taux faux'}])");
  assert.ok(h.includes('a renvoyé pour correction') && h.includes('bordereau de résultats') && h.includes('Taux faux') && h.includes('09:30'));
});

console.log('Jour J');
await t('contrôles de saisie', () => {
  const c = C();
  assert.ok(J(c, "cepControlerJourJ({presents:NaN,absents:2,incidents:[]},10)").erreurs.length);
  assert.ok(J(c, "cepControlerJourJ({presents:8,absents:1,incidents:[]},10)").avertissements.some((m) => m.includes('ne correspondent pas')));
  assert.strictEqual(J(c, "cepControlerJourJ({presents:8,absents:2,incidents:[]},10)").avertissements.length, 0);
  assert.ok(J(c, "cepControlerJourJ({presents:8,absents:2,enveloppe_le:'2026-11-01T08:00:00Z',recu_le:'2026-11-01T09:00:00Z',incidents:[]},10)").avertissements.some((m) => m.includes('avant la réception')));
  assert.ok(J(c, "cepControlerJourJ({presents:null,absents:null,enveloppe_le:'2026-11-01T08:00:00Z',incidents:[]},10)").avertissements.some((m) => m.includes('réception')));
  assert.ok(J(c, "cepControlerJourJ({presents:1,absents:1,incidents:[{type:'inconnu'}]},2)").erreurs.length);
  assert.ok(Number.isNaN(J(c, "cepEntierOuNull('12a')"))); assert.strictEqual(J(c, "cepEntierOuNull('')"), null); assert.strictEqual(J(c, "cepEntierOuNull(' 7 ')"), 7);
});
await t("arguments envoyés au serveur : scellé seulement si reçu, incidents nettoyés", () => {
  const c = C();
  const a = J(c, "cepArgsJourJ('cid',{code:'E1',nom:'Dictée'},{presents:9,absents:1,recu_le:'2026-11-01T06:00:00Z',scelle_intact:false,enveloppe_le:null,incidents:[{type:'sante',gravite:'majeur',description:'  malaise  '}],maj_client:'2026-11-01T07:00:00Z'})");
  assert.strictEqual(a.p_scelle_intact, false); assert.strictEqual(a.p_incidents[0].description, 'malaise'); assert.strictEqual(a.p_incidents[0].gravite, 'majeur');
  assert.strictEqual(J(c, "cepArgsJourJ('cid',{code:'E1'},{presents:1,absents:0,recu_le:null,incidents:[]}).p_scelle_intact"), null);
});

console.log('Envoi hors ligne et reprise');
await t("hors ligne : mise en file, une seule entrée par document ; reprise au retour du réseau", async () => {
  const c = C(); J(c, "currentUser = { id: 'u1', role: 'ceb' }");
  let reseau = false; const appels = [];
  c.supaClient = { rpc: async (n, a) => { if (!reseau) throw new TypeError('Failed to fetch'); appels.push(n); return { data: { ok: true }, error: null }; } };
  const r1 = await J(c, "cepEnvoyer({rpc:'cep_effectifs_transmettre',cle:'effectifs:A:cep',libelle:'x',args:{p_annee:'A'}})");
  const r2 = await J(c, "cepEnvoyer({rpc:'cep_effectifs_transmettre',cle:'effectifs:A:cep',libelle:'x',args:{p_annee:'A',p_inscrits_f:1}})");
  assert.strictEqual(r1.enFile, true); assert.strictEqual(r2.enFile, true);
  assert.strictEqual((await J(c, "cepFileEnAttente()")).length, 1);
  assert.strictEqual((await J(c, "cepFileEnAttente()"))[0].args.p_inscrits_f, 1, 'le dernier envoi remplace le précédent');
  reseau = true;
  const rej = await J(c, "cepRejouerFile()");
  assert.strictEqual(rej.ok, 1); assert.strictEqual(rej.reste, 0); assert.deepStrictEqual(appels, ['cep_effectifs_transmettre']);
});
await t("refus du serveur : message clair, pas de mise en file", async () => {
  const c = C(); J(c, "currentUser = { id: 'u1', role: 'ceb' }");
  c.supaClient = { rpc: async () => ({ data: null, error: { code: 'P0001', message: 'Ces effectifs sont déjà validés par le ministère.' } }) };
  let msg = ''; try { await J(c, "cepEnvoyer({rpc:'x',cle:'k',args:{}})"); } catch (e) { msg = e.message; }
  assert.ok(msg.includes('validés par le ministère')); assert.strictEqual((await J(c, "cepFileEnAttente()")).length, 0);
});
await t("pendant l'attente, un refus du serveur est gardé avec son motif (pas de perte)", async () => {
  const c = C(); J(c, "currentUser = { id: 'u1', role: 'ceb' }"); let reseau = false;
  c.supaClient = { rpc: async () => { if (!reseau) throw new TypeError('Failed to fetch'); return { data: null, error: { code: 'P0001', message: 'Chiffres refusés.' } }; } };
  await J(c, "cepEnvoyer({rpc:'x',cle:'k',args:{}})"); reseau = true;
  const r = await J(c, "cepRejouerFile()"); assert.strictEqual(r.refus, 1);
  const f = await J(c, "cepFileEnAttente()"); assert.strictEqual(f.length, 1); assert.strictEqual(f[0].erreur, 'Chiffres refusés.');
});
await t('serveur pas à jour : message qui explique quoi faire', () => {
  const c = C();
  assert.ok(J(c, "cepConvertirErreur({code:'PGRST202',message:'Could not find the function public.cep_valider'}).message").includes('supabase-complet.sql'));
});
await t('pagination : lit plusieurs pages', async () => {
  const c = C(); const pages = [Array(1000).fill({ a: 1 }), Array(10).fill({ a: 2 })]; let i = 0;
  c.__q = () => ({ range: async () => ({ data: pages[i++], error: null }) });
  assert.strictEqual((await J(c, "cepLireTout(__q)")).length, 1010);
});

console.log('Droits des routes et rôles');
await t("routes : président de centre limité au jour J et au calendrier ; CEB, DPEPPNF etc. au tableau", () => {
  const c = C();
  const ok = (role, h) => { J(c, `currentUser = { role: '${role}' }`); return J(c, `routeAutorisee('${h}')`); };
  assert.strictEqual(ok('centre', '#/jour-j'), true); assert.strictEqual(ok('centre', '#/cep-calendrier'), true); assert.strictEqual(ok('centre', '#/dashboard'), true);
  ['#/eleves', '#/cep-tableau', '#/cep-validation', '#/examens', '#/publications', '#/centres-ceb'].forEach((h) => assert.strictEqual(ok('centre', h), false, 'centre → ' + h));
  assert.strictEqual(ok('ministere', '#/cep-tableau'), true); assert.strictEqual(ok('ministere', '#/jour-j'), false); assert.strictEqual(ok('dpeppnf', '#/centres-ceb'), false);
  assert.strictEqual(ok('ceb', '#/jour-j'), true); assert.strictEqual(ok('ceb', '#/centres-ceb'), true);
  assert.strictEqual(ok('directeur', '#/cep-calendrier'), true); assert.strictEqual(ok('directeur', '#/cep-tableau'), true === false);
  assert.strictEqual(ok('enseignant', '#/cep-calendrier'), false); assert.strictEqual(ok('enseignant', '#/eleves'), true, 'pas de régression école');
});
await t('un compte du réseau ne voit toujours aucune rubrique de l\'école', () => {
  const c = C(); ['dpeppnf', 'dreppnf', 'ministere', 'ceb', 'centre'].forEach((r) => { J(c, `currentUser = { role: '${r}' }`); ['#/eleves', '#/finances', '#/classes'].forEach((h) => assert.strictEqual(J(c, `routeAutorisee('${h}')`), false)); });
});

console.log('Handicap / bilingue et compatibilité des listes publiées');
await t('statistiques : handicap et bilingues comptés', () => {
  const c = C(); c.__l = J(c, "[{candidat:{sexe:'F',handicap:true},decision:'admis',details:[],moyenne:12},{candidat:{sexe:'M',bilingue:true},decision:'ajourne',details:[],moyenne:8},{candidat:{sexe:'M'},decision:'absent',details:[],moyenne:null}]");
  const s = J(c, "exStats(__l,{epreuves:[],mentions:[]})");
  assert.strictEqual(s.handicap.inscrits, 1); assert.strictEqual(s.handicap.admis, 1); assert.strictEqual(s.bilingues.inscrits, 1); assert.strictEqual(s.bilingues.admis, 0);
});
await t("liste CEP déjà publiée avant la mise à jour : son empreinte reste reconnue", async () => {
  const c = creer(['app-core.js', 'app-examens-calcul.js', 'app-examens-remontee.js', 'app-listes-ceb.js']);
  c.__old = J(c, "[{matricule:'1',nom:'A',prenom:'B',sexe:'F',dateNaissance:'2014-01-01',lieuNaissance:'Réo',classe:'CM2',examens:'CEP seul',besoins:'',eleveUuid:'u'}]");
  const ancien = await J(c, "lcEmpreinte(__old, LC_CLES_CEP_ANCIEN)"), nouveau = await J(c, "lcEmpreinte(__old, LC_CLES_CEP)");
  assert.notStrictEqual(ancien, nouveau, 'les deux jeux de colonnes donnent des empreintes différentes');
  assert.ok(J(c, "LC_CLES_CEP.includes('handicap') && LC_CLES_CEP.includes('bilingue') && LC_CLES_CEP_ANCIEN.length === 10"));
  const src = require('fs').readFileSync(__dirname + '/../www/app-listes-ceb.js', 'utf8');
  assert.ok(src.includes('LC_CLES_CEP_ANCIEN)) !== d.empreinte'), 'la récupération accepte aussi l\'ancienne empreinte');
});

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
})();
