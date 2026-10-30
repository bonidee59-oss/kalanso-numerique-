/* Faux environnement minimal pour charger app-bureaux.js puis app-services.js sans navigateur */
var ROUTES = { '#/dashboard': async () => {}, '#/comptes-reseau': async () => {} };
var ROUTE_ROLES = { '#/publications': ['directeur', 'ceb'] };
var ROLES_RESEAU = ['ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre'];
var currentUser = null;
function labelRole(r) { return r; }
function resNiveau() { return null; }
function resMsgErreur(e) { return String((e && e.message) || e || ''); }
function resSigle(n) { return ({ ceb: 'CEB', dpeppnf: 'DPEPPNF', dreppnf: 'DREPPNF', ecole: 'École', ministere: 'Ministère' })[n] || n; }
