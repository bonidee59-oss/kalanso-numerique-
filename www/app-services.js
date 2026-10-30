/* ============================================================
   app-services.js — Services du DPEPPNF et échanges avec les bureaux de la CEB (version 48)
   Le DPEPPNF crée un compte pour chacun de ses 11 services. Les services et les bureaux
   de la CEB s'envoient des documents dans les DEUX sens :
     service  → bureaux d'une, de plusieurs ou de toutes les CEB de la province, écoles, autres services
     bureau   → services du DPEPPNF, autres bureaux de sa CEB, écoles de sa CEB
   Version 49 : la DREPPNF a aussi ses 11 services (rôle « service_reg », même liste), qui échangent avec
   les services des DPEPPNF, les bureaux des CEB et les écoles de la région.
   Version 50 : le ministère a aussi ses services (rôle « service_min » : services du Secrétariat général —
   BE, SP/SG, SCC, SQE, SAI, SP/SGA), même procédure que la DREPPNF, avec un filtre « Régions concernées ».
   Données : rôles « service » / « service_reg » / « service_min » + profiles.service ; documents : colonnes services /
   services_reg / services_min / service_emetteur / ceb_dest / province_dest / region_dest
   (voir supabase-services.sql, supabase-dreppnf.sql et supabase-ministere.sql).
   Chargé après app-bureaux.js : il en remplace le formulaire et le chargement.
   ============================================================ */
const SERVICES = [
  { code: 'secretariat', sigle: 'Secrétariat', nom: 'Secrétariat', desc: 'Courrier, correspondance, accueil et archives.' },
  { code: 'sgrfm', sigle: 'SGRFM', nom: 'Service de Gestion des Ressources financières et matérielles', desc: 'Finances, matériel et équipements.' },
  { code: 'sgrh', sigle: 'SGRH', nom: 'Service de Gestion des Ressources humaines', desc: 'Personnel et gestion administrative des agents.' },
  { code: 'sep', sigle: 'SEP', nom: 'Service des Études et de la Planification', desc: 'Planification, carte scolaire et statistiques.' },
  { code: 'sepp', sigle: 'SEPP', nom: "Service de l'Éducation préscolaire et primaire", desc: "Suivi de l'éducation préscolaire et de l'enseignement primaire." },
  { code: 'senf', sigle: 'SENF', nom: "Service de l'Éducation non formelle", desc: "Suivi de l'éducation non formelle." },
  { code: 'sec', sigle: 'SEC', nom: 'Service des Examens et Concours', desc: 'Organisation et suivi des examens et concours.' },
  { code: 'speiefg', sigle: 'SPEIEFG', nom: "Service de la Promotion de l'Éducation inclusive, de l'Éducation des Filles et du Genre", desc: 'Inclusion scolaire, scolarisation des filles et égalité de genre.' },
  { code: 'sempc', sigle: 'SEmPC', nom: "Service de l'Éducation en matière de Population et de Citoyenneté", desc: 'Éducation à la citoyenneté et questions de population.' },
  { code: 'sascl', sigle: 'SASCL', nom: 'Service des Activités sportives, culturelles et des loisirs', desc: 'Activités sportives, culturelles et de loisirs.' },
  { code: 'sctic', sigle: 'SCTIC', nom: "Service de la Communication et des Technologies de l'Information et de la Communication", desc: 'Communication et outils numériques.' }
];
/* Services du Secrétariat général (ministère) — version 50 */
const SERVICES_MIN = [
  { code: 'be', sigle: 'BE', nom: "Bureau d'études", desc: 'Étude des dossiers, synthèse et préparation des projets de correspondance.' },
  { code: 'spsg', sigle: 'SP/SG', nom: 'Secrétariat particulier du Secrétaire général', desc: 'Courrier confidentiel et appui direct au Secrétaire général.' },
  { code: 'scc', sigle: 'SCC', nom: 'Service central du courrier', desc: 'Réception, enregistrement, expédition et ventilation du courrier.' },
  { code: 'sqe', sigle: 'SQE', nom: 'Service des questions environnementales', desc: 'Prise en compte des questions environnementales dans les politiques et projets éducatifs.' },
  { code: 'sai', sigle: 'SAI', nom: "Service d'accueil et d'information", desc: 'Accueil et orientation des usagers et partenaires du ministère.' },
  { code: 'spsga', sigle: 'SP/SGA', nom: 'Secrétariat particulier du Secrétaire général adjoint', desc: 'Appui direct au Secrétaire général adjoint, qui assiste le Secrétaire général.' }
];
const serviceInfo = (c) => SERVICES.find((s) => s.code === c) || SERVICES_MIN.find((s) => s.code === c) || { code: c, sigle: c || 'Service', nom: 'Service', desc: '' };

/* Homologues : quel service correspond à quel bureau de la CEB (sert aux cases cochées d'office) */
const SERVICE_DU_BUREAU = { scr: 'secretariat', bgrh: 'sgrh', bgrfm: 'sgrfm', bse: 'sep', bec: 'sec', bascl: 'sascl', bepres: 'sepp', beprim: 'sepp', benf: 'senf' };
const BUREAUX_DU_SERVICE = { secretariat: ['scr'], sgrh: ['bgrh'], sgrfm: ['bgrfm'], sep: ['bse'], sec: ['bec'], sascl: ['bascl'], sepp: ['bepres', 'beprim'], senf: ['benf'], speiefg: ['scr'], sempc: ['scr'], sctic: ['scr'] };

/* Nature du document : chaque nature pointe vers un bureau (CEB) ET un service (DPEPPNF) */
BUREAU_NATURES.forEach((n) => { n.service = SERVICE_DU_BUREAU[n.bureau]; });
BUREAU_NATURES.find((n) => n.code === 'pedagogie').service = 'sepp';
BUREAU_NATURES.push(
  { code: 'inclusion', label: 'Éducation inclusive, scolarisation des filles, genre', bureau: 'scr', service: 'speiefg' },
  { code: 'citoyennete', label: 'Éducation à la citoyenneté et à la population', bureau: 'scr', service: 'sempc' },
  { code: 'numerique', label: 'Communication et outils numériques', bureau: 'scr', service: 'sctic' }
);

/* ---------- Pures : libellés des destinataires (testées dans tests/services.test.js) ---------- */
function svDestinataires(d) {
  const out = [];
  const bx = d.bureaux || [], sv = d.services || [], sr = d.services_reg || [], sm = d.services_min || [];
  (d.cibles || []).forEach((c) => {
    if (c === 'ceb' && bx.length) out.push('CEB (' + bx.map((b) => bureauInfo(b).sigle).join(', ') + ')');
    else if (c === 'dpeppnf' && sv.length) out.push('DPEPPNF (' + sv.map((s) => serviceInfo(s).sigle).join(', ') + ')');
    else if (c === 'dreppnf' && sr.length) out.push('DREPPNF (' + sr.map((x) => serviceInfo(x).sigle).join(', ') + ')');
    else if (c === 'ministere' && sm.length) out.push('Ministère (' + sm.map((x) => serviceInfo(x).sigle).join(', ') + ')');
    else out.push(resSigle(c));
  });
  if (d.region_dest && d.region_dest.length) out.push('limité aux régions : ' + d.region_dest.join(', '));
  if (d.province_dest && d.province_dest.length) out.push('limité aux provinces : ' + d.province_dest.join(', '));
  if (d.ceb_dest && d.ceb_dest.length) out.push('limité aux CEB : ' + d.ceb_dest.join(', '));
  return out;
}
const svNorm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/* ---------- Droits ---------- */
ROLES_RESEAU.push('service', 'service_reg', 'service_min');
ROUTE_ROLES['#/publications'].push('service', 'service_reg', 'service_min');
const _svLabelRole = labelRole;
labelRole = function (r) { return r === 'service' ? 'Service du DPEPPNF' : r === 'service_reg' ? 'Service de la DREPPNF' : r === 'service_min' ? 'Service du Secrétariat général' : _svLabelRole(r); };
resNiveau = function () {
  if (!currentUser) return null;
  const r = currentUser.role;
  if (r === 'bureau') return 'ceb';
  if (r === 'service') return 'dpeppnf';
  if (r === 'service_reg') return 'dreppnf';
  if (r === 'service_min') return 'ministere';
  if (ROLES_RESEAU.includes(r)) return r;
  if (['directeur', 'directeur_adjoint', 'secretaire'].includes(r)) return 'ecole';
  return null;
};
const _svMsg = resMsgErreur;
resMsgErreur = function (e) {
  const m = String((e && (e.message || e.details)) || e || '');
  if (/services|services_reg|services_min|service_emetteur|ceb_dest|province_dest|region_dest|profiles_service|circuit_documents_cibles_check/i.test(m) && /column|schema cache|constraint|does not exist|violates/i.test(m))
    return "La base n'est pas à jour pour les services : exécutez supabase-services.sql, supabase-dreppnf.sql puis supabase-ministere.sql dans Supabase (SQL Editor), puis rechargez.";
  return _svMsg(e);
};

/* ---------- Chargement : tolère une base pas encore à jour ---------- */
resCharger = async function () {
  const supa = window.supaClient;
  const base = 'id,niveau,emetteur_id,emetteur_nom,structure,region,province,ceb,cibles,categorie,reference,objet,echeance,pj_nom,created_at';
  const req = (cols) => supa.from('circuit_documents').select(cols).order('created_at', { ascending: false }).limit(300);
  let d = await req(base + ',bureaux,bureau_emetteur,nature,services,service_emetteur,ceb_dest,services_reg,province_dest,services_min,region_dest');
  if (d.error) d = await req(base + ',bureaux,bureau_emetteur,nature,services,service_emetteur,ceb_dest,services_reg,province_dest');
  if (d.error) d = await req(base + ',bureaux,bureau_emetteur,nature,services,service_emetteur,ceb_dest');
  if (d.error) d = await req(base + ',bureaux,bureau_emetteur,nature');
  if (d.error) d = await req(base);
  const a = await supa.from('circuit_accuses').select('doc_id,user_id,nom,structure,accuse_le');
  if (d.error) throw d.error;
  const docs = (d.data || []).map((x) => {
    const dest = svDestinataires(x);
    const sigles = (x.bureaux || []).map((b) => bureauInfo(b).sigle).concat((x.services || []).map((s) => serviceInfo(s).sigle)).concat((x.services_reg || []).map((s) => serviceInfo(s).sigle)).concat((x.services_min || []).map((s) => serviceInfo(s).sigle));
    if (x.nature && sigles.length) x.categorie = sigles.join(', ') + (x.categorie ? ' · ' + x.categorie : '');
    x.cibles = dest;
    return x;
  });
  return { docs, accuses: a.error ? [] : (a.data || []) };
};

/* ---------- Ouvrir un document (même rendu, destinataires détaillés) ---------- */
resOuvrir = async function (id, parDoc) {
  const { data: d, error } = await window.supaClient.from('circuit_documents').select('*').eq('id', id).single();
  if (error || !d) { toast(resMsgErreur(error)); return; }
  const accuses = d.emetteur_id === currentUser.id ? (parDoc[d.id] || []) : [];
  const ov = openModal(d.objet, `
    <p class="text-soft" style="font-size:12.5px;">${esc(d.categorie || '')}${d.reference ? ' · réf. ' + esc(d.reference) : ''} · de <b>${esc(resSigle(d.niveau))}${d.structure ? ' ' + esc(d.structure) : ''}</b> (${esc(d.emetteur_nom)}) · publié le ${esc(formatDate(String(d.created_at).slice(0, 10)))}${d.echeance ? ' · <b>à traiter avant le ' + esc(formatDate(d.echeance)) + '</b>' : ''}</p>
    <p class="text-soft" style="font-size:12px;">Destinataires : ${svDestinataires(d).map(esc).join(', ')}</p>
    <div style="white-space:pre-wrap;font-size:14px;margin:10px 0;">${esc(d.contenu) || '<span class="text-soft">(pas de texte)</span>'}</div>
    ${d.pj_data ? `<button class="btn btn-sm" id="pb-pj">📎 ${esc(d.pj_nom || 'pièce jointe')} (${Math.round(d.pj_data.length * 0.75 / 1024)} Ko)</button>` : ''}
    ${d.emetteur_id === currentUser.id ? `<h4 style="margin:14px 0 6px;">Accusés de réception (${accuses.length})</h4>${accuses.length ? `<ul style="margin:0 0 0 18px;">${accuses.map((x) => `<li>${esc(x.structure || '')} — ${esc(x.nom || '')} <span class="text-soft">(${esc(formatDate(String(x.accuse_le).slice(0, 10)))})</span></li>`).join('')}</ul>` : '<p class="text-soft">Aucun accusé pour le moment.</p>'}` : ''}`,
  { saveLabel: 'Fermer', onSave: async () => true });
  if (d.pj_data) $('#pb-pj', ov).onclick = () => exTelechargerBase64(d.pj_nom || 'document', d.pj_type, d.pj_data);
};

/* ---------- Formulaire « Publier un document » : écoles, bureaux de CEB, services du DPEPPNF et de la DREPPNF ---------- */
resFormPublier = async function (niveau, pre) {
  pre = pre || {}; // préremplissage (scanner) : { objet, categorie, reference, contenu, pj, cibles, garderPage, onSent }
  const manque = resZoneManquante(niveau);
  if (manque === 'rattachement') { toast("Rattachez d'abord votre école à sa CEB (carte en haut de la page)."); return; }
  if (manque) { toast(`Votre compte n'a pas ${manque} renseignée : contactez la structure qui a créé votre compte.`); return; }
  const role = currentUser.role;
  const modeBureau = role === 'bureau', modeService = role === 'service', modeReg = role === 'service_reg', modeMin = role === 'service_min';
  const modeStructure = modeBureau || modeService || modeReg || modeMin;
  const autres = RES_NIVEAUX.filter((n) => n !== niveau);
  const defauts = RES_CIBLES_DEFAUT[niveau] || [];
  let pj = pre.pj || null, cebs = [], provinces = [], regions = [];
  if (modeService || modeReg || modeMin) {
    try {
      const { data } = await window.supaClient.rpc('liste_cebs');
      regions = Array.from(new Set((data || []).map((c) => c.region).filter(Boolean)));
      const zone = (data || []).filter((c) => svNorm(c.region) === svNorm(currentUser.region));
      cebs = zone.filter((c) => svNorm(c.province) === svNorm(currentUser.province)).map((c) => c.ceb);
      provinces = Array.from(new Set(zone.map((c) => c.province)));
    } catch (e) { /* sans la liste, le document part à toute la zone */ }
  }
  const lib = (cls, v, coche, off) => `<label style="display:flex;gap:6px;font-weight:400;align-items:center;"><input type="checkbox" class="${cls}" value="${esc(v.code || v)}" ${coche ? 'checked' : ''} ${off ? 'disabled' : ''}>${esc(v.sigle || v)}</label>`;
  const cases = (liste, cls, coches) => `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;">${liste.map((x) => lib(cls, x, coches.includes(x.code))).join('')}</div>`;
  const maCEB = esc(currentUser.ceb || ''), maProv = esc(currentUser.province || ''), maReg = esc(currentUser.region || '');
  const autreSvc = (c) => SERVICES.filter((s) => !(c && s.code === currentUser.service));
  const bxDefaut = (modeService || modeReg || modeMin) ? (BUREAUX_DU_SERVICE[currentUser.service] || []) : [];
  const svDefaut = modeReg ? [currentUser.service] : [];
  const natureHtml = `<select id="pu-nature">${modeStructure ? '<option value="">— Cocher à la main —</option>' : ''}${BUREAU_NATURES.map((n) => `<option value="${n.code}">${esc(n.label)} → ${esc(bureauInfo(n.bureau).sigle)} / ${esc(serviceInfo(n.service).sigle)}</option>`).join('')}</select>`;
  const note = (t) => `<small>${modeStructure ? '' : t}</small>`;
  const blocBx = `<div class="field full" id="pu-bx-box"><label>${modeBureau ? `Autres bureaux de la CEB ${maCEB}` : 'Bureaux des CEB'}</label>${cases(modeBureau ? BUREAUX.filter((b) => b.code !== currentUser.bureau) : BUREAUX, 'pu-bx', modeStructure ? bxDefaut : ['scr'])}${note('Sans bureau précis, le Secrétariat de la CEB le reçoit.')}</div>`;
  const blocSv = `<div class="field full" id="pu-sv-box"><label>Services des DPEPPNF${modeService ? ' (vos collègues)' : ''}</label>${cases(autreSvc(modeService), 'pu-sv', svDefaut)}${note('Sans service précis, le Secrétariat du DPEPPNF le reçoit.')}</div>`;
  const blocSm = `<div class="field full" id="pu-sm-box"><label>Services du Secrétariat général (ministère)${modeMin ? ' (vos collègues)' : ''}</label>${cases(SERVICES_MIN.filter((s) => !(modeMin && s.code === currentUser.service)), 'pu-sm', [])}${note('Sans service précis, le Service central du courrier (SCC) le reçoit.')}</div>`;
  const blocSr = `<div class="field full" id="pu-sr-box"><label>Services de la DREPPNF${modeReg ? ' (vos collègues)' : ''}</label>${cases(autreSvc(modeReg), 'pu-sr', [])}${note('Sans service précis, le Secrétariat de la DREPPNF le reçoit.')}</div>`;
  const filtre = (idToutes, cls, titre, toutes, valeurs) => `<div class="field full"><label>${titre}</label>
      <label style="display:flex;gap:6px;font-weight:400;align-items:center;"><input type="checkbox" id="${idToutes}" checked>${toutes}</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;">${valeurs.map((v) => lib(cls, v, false, true)).join('')}</div></div>`;
  const blocFiltre = modeService && cebs.length ? filtre('pu-ceb-toutes', 'pu-ceb', 'CEB concernées (écoles et bureaux)', `Toutes les CEB de la province ${maProv}`, cebs)
    : (modeReg && provinces.length ? filtre('pu-prov-toutes', 'pu-prov', 'Provinces concernées', `Toutes les provinces de la région ${maReg}`, provinces)
    : (modeMin && regions.length ? filtre('pu-reg-toutes', 'pu-reg', 'Régions concernées', 'Toutes les régions du pays', regions) : ''));
  const zoneEcoles = modeBureau ? 'de la CEB ' + maCEB : modeService ? 'de la province ' + maProv : modeMin ? 'du pays' : 'de la région ' + maReg;
  const destHtml = modeStructure ? `
      <div class="field full"><label>Destinataires * <span class="text-soft" style="font-weight:400;">(plusieurs choix possibles)</span></label>
        <label style="display:flex;gap:8px;font-weight:400;align-items:center;"><input type="checkbox" id="pu-ecole" ${modeBureau ? 'checked' : ''}>Toutes les écoles ${zoneEcoles}</label></div>
      ${blocFiltre}${blocBx}${blocSv}${blocSr}${blocSm}
      <div class="field full"><label>Raccourci : nature du document</label>${natureHtml}</div>` : `
      <div class="field full"><label>Destinataires * <span class="text-soft" style="font-weight:400;">(plusieurs choix possibles)</span></label>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${autres.map((n) => `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400;"><input type="checkbox" class="pu-cible" value="${n}" ${defauts.includes(n) ? 'checked' : ''} style="margin-top:3px;"><span><b>${esc(resSigle(n))}</b> <span class="text-soft">${esc(resPortee(niveau, n))}</span></span></label>`).join('')}
        </div></div>
      <div class="field full" id="pu-nat-box"><label>Nature du document (bureau / service concerné)</label>${natureHtml}</div>${niveau !== 'ceb' ? blocBx : ''}${niveau !== 'dpeppnf' ? blocSv : ''}${niveau !== 'dreppnf' ? blocSr : ''}${niveau !== 'ministere' ? blocSm : ''}`;
  const ov = openModal('Publier un document', `
    <div class="form-grid">
      <div class="field full"><label>Objet *</label><input id="pu-objet"></div>
      ${destHtml}
      <div class="field"><label>Type de document</label><select id="pu-cat">${RES_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Référence / n°</label><input id="pu-ref" placeholder="Ex : N°2026-014/…"></div>
      <div class="field"><label>À traiter avant le</label><input type="date" id="pu-ech"></div>
      <div class="field full"><label>Texte / instructions</label><textarea id="pu-txt" style="min-height:120px;"></textarea></div>
      <div class="field full"><label>Pièce jointe (PDF, image, Word…, 1,5 Mo max)</label><input type="file" id="pu-pj"><small id="pu-pj-info"></small>
        <div style="margin-top:6px;"><button type="button" class="btn btn-sm" id="pu-scan">📷 Scanner un document</button></div></div>
    </div>`, {
    saveLabel: 'Publier',
    onSave: async (o) => {
      const objet = $('#pu-objet', o).value.trim();
      const coches = (cls) => $all('.' + cls, o).filter((c) => c.checked).map((c) => c.value);
      let cibles, bureaux = [], services = [], servicesReg = [], servicesMin = [];
      if (modeStructure) {
        bureaux = coches('pu-bx'); services = coches('pu-sv'); servicesReg = coches('pu-sr'); servicesMin = coches('pu-sm');
        cibles = [$('#pu-ecole', o).checked && 'ecole', bureaux.length && 'ceb', services.length && 'dpeppnf', servicesReg.length && 'dreppnf', servicesMin.length && 'ministere'].filter(Boolean);
      } else {
        cibles = coches('pu-cible');
        if (cibles.includes('ceb') && niveau !== 'ceb') bureaux = coches('pu-bx');
        if (cibles.includes('dpeppnf') && niveau !== 'dpeppnf') services = coches('pu-sv');
        if (cibles.includes('dreppnf') && niveau !== 'dreppnf') servicesReg = coches('pu-sr');
        if (cibles.includes('ministere') && niveau !== 'ministere') servicesMin = coches('pu-sm');
      }
      if (!objet) { toast("Indiquez l'objet du document."); return false; }
      if (!cibles.length) { toast('Choisissez au moins un destinataire.'); return false; }
      const tCeb = $('#pu-ceb-toutes', o), tProv = $('#pu-prov-toutes', o), tReg = $('#pu-reg-toutes', o);
      const cebDest = tCeb && !tCeb.checked ? coches('pu-ceb') : [];
      const provDest = tProv && !tProv.checked ? coches('pu-prov') : [];
      const regDest = tReg && !tReg.checked ? coches('pu-reg') : [];
      if (tReg && !tReg.checked && !regDest.length) { toast('Cochez au moins une région, ou « Toutes les régions ».'); return false; }
      if (tCeb && !tCeb.checked && !cebDest.length) { toast('Cochez au moins une CEB, ou « Toutes les CEB ».'); return false; }
      if (tProv && !tProv.checked && !provDest.length) { toast('Cochez au moins une province, ou « Toutes les provinces ».'); return false; }
      const z = resZone(niveau), ech = $('#pu-ech', o).value;
      const natureCode = $('#pu-nature', o) ? $('#pu-nature', o).value : '';
      const row = {
        niveau, emetteur_id: currentUser.id, emetteur_nom: currentUser.nom,
        structure: currentUser.structure || null, region: z.region, province: z.province, ceb: z.ceb,
        cibles, categorie: $('#pu-cat', o).value, reference: $('#pu-ref', o).value.trim() || null,
        objet, contenu: $('#pu-txt', o).value.trim() || null, echeance: ech || null,
        pj_nom: pj ? pj.nom : null, pj_type: pj ? pj.type : null, pj_data: pj ? pj.data : null
      };
      const extra = {};
      if (modeBureau) extra.bureau_emetteur = currentUser.bureau;
      if (modeService || modeReg || modeMin) extra.service_emetteur = currentUser.service;
      if (bureaux.length) extra.bureaux = bureaux;
      if (services.length) extra.services = services;
      if (servicesReg.length) extra.services_reg = servicesReg;
      if (servicesMin.length) extra.services_min = servicesMin;
      if (natureCode && (bureaux.length || services.length || servicesReg.length)) extra.nature = natureCode;
      if (cebDest.length) extra.ceb_dest = cebDest;
      if (provDest.length) extra.province_dest = provDest;
      if (regDest.length) extra.region_dest = regDest;
      const btn = $('.modal-save', o); btn.disabled = true;
      let repli = false;
      let { error } = await window.supaClient.from('circuit_documents').insert({ ...row, ...extra });
      // Base pas encore à jour : un compte ordinaire publie quand même, sans bureau ni service précis
      if (error && !modeStructure && Object.keys(extra).length && /bureaux|services|nature|ceb_dest|province_dest|region_dest|schema cache|column/i.test(String(error.message || ''))) {
        ({ error } = await window.supaClient.from('circuit_documents').insert(row));
        if (!error) { repli = true; toast('Publié, mais sans bureau ni service précis : exécutez supabase-services.sql, supabase-dreppnf.sql et supabase-ministere.sql pour les activer.'); }
      }
      btn.disabled = false;
      if (error) { toast(resMsgErreur(error)); return false; }
      if (!repli) toast('Document publié.');
      if (typeof pre.onSent === 'function') { try { pre.onSent({ cibles, objet }); } catch (e) { console.warn(e); } }
      if (pre.garderPage) return true;
      RES_ETAT.onglet = 'publies'; onRouteChange(); return true;
    }
  });
  // Raccourci « nature » : coche le bureau et/ou le service correspondants (selon qui écrit)
  const nat = $('#pu-nature', ov);
  const fixer = (cls, codes) => $all('.' + cls, ov).forEach((c) => { c.checked = codes.includes(c.value); });
  if (nat) nat.onchange = () => {
    const n = BUREAU_NATURES.find((x) => x.code === nat.value); if (!n) return;
    if (!modeBureau) fixer('pu-bx', [n.bureau]);
    if (!modeService) fixer('pu-sv', [n.service]);
    if (!modeStructure || modeMin) fixer('pu-sr', [n.service]);
  };
  if (!modeStructure) {
    const c = (v) => $('.pu-cible[value="' + v + '"]', ov);
    const montrer = () => {
      const bx = !!(c('ceb') && c('ceb').checked && niveau !== 'ceb');
      const sv = !!(c('dpeppnf') && c('dpeppnf').checked && niveau !== 'dpeppnf');
      const sr = !!(c('dreppnf') && c('dreppnf').checked && niveau !== 'dreppnf');
      const sm = !!(c('ministere') && c('ministere').checked && niveau !== 'ministere');
      [['#pu-bx-box', bx], ['#pu-sv-box', sv], ['#pu-sr-box', sr], ['#pu-sm-box', sm]].forEach(([sel, v]) => { if ($(sel, ov)) $(sel, ov).style.display = v ? '' : 'none'; });
      $('#pu-nat-box', ov).style.display = (bx || sv || sr) ? '' : 'none';
    };
    ['ceb', 'dpeppnf', 'dreppnf', 'ministere'].forEach((v) => { if (c(v)) c(v).onchange = montrer; }); montrer();
  }
  [['pu-ceb-toutes', 'pu-ceb'], ['pu-prov-toutes', 'pu-prov'], ['pu-reg-toutes', 'pu-reg']].forEach(([idT, cls]) => {
    const t = $('#' + idT, ov);
    if (t) t.onchange = () => $all('.' + cls, ov).forEach((x) => { x.disabled = t.checked; if (t.checked) x.checked = false; });
  });
  /* Préremplissage (envoi depuis le scanner) et raccourci vers le scanner */
  if (pre.objet) $('#pu-objet', ov).value = pre.objet;
  if (pre.categorie && $all('#pu-cat option', ov).some((x) => x.value === pre.categorie)) $('#pu-cat', ov).value = pre.categorie;
  if (pre.reference) $('#pu-ref', ov).value = pre.reference;
  if (pre.contenu) $('#pu-txt', ov).value = pre.contenu;
  if (pre.pj) $('#pu-pj-info', ov).textContent = `${pre.pj.nom} — ${Math.round(pre.pj.data.length * 0.75 / 1024)} Ko (préparé par le scanner)`;
  if (Array.isArray(pre.cibles) && pre.cibles.length) $all('.pu-cible', ov).forEach((c) => { c.checked = pre.cibles.includes(c.value); if (c.onchange) c.onchange(); });
  const bScan = $('#pu-scan', ov);
  if (bScan) bScan.onclick = () => { closeModal(); location.hash = '#/scanner'; };
  $('#pu-pj', ov).onchange = async (e) => {
    const f = e.target.files[0]; pj = null; $('#pu-pj-info', ov).textContent = '';
    if (!f) return;
    if (f.size > RES_PJ_MAX) { toast('Pièce jointe trop volumineuse (1,5 Mo maximum).'); e.target.value = ''; return; }
    pj = { nom: f.name, type: f.type || 'application/octet-stream', data: await exLireBase64(f) };
    $('#pu-pj-info', ov).textContent = `${f.name} — ${Math.round(f.size / 1024)} Ko`;
  };
};

/* ---------- Le bureau voit aussi « Envoyer un document » avec tous les destinataires ---------- */
{
  const _avant = ROUTES['#/dashboard'];
  ROUTES['#/dashboard'] = async (root) => {
    if (currentUser && currentUser.role === 'bureau') {
      await _avant(root);
      const b = $('#bu-envoyer', root);
      if (b) { b.textContent = '+ Envoyer un document'; b.onclick = () => resFormPublier('ceb'); }
      return;
    }
    if (!currentUser || !['service', 'service_reg', 'service_min'].includes(currentUser.role)) return _avant(root);
    const reg = currentUser.role === 'service_reg', min = currentUser.role === 'service_min', s = serviceInfo(currentUser.service);
    let recus = '—', aTraiter = '—', publies = '—';
    try {
      const { docs, accuses } = await resCharger();
      const moi = currentUser.id, mes = new Set(accuses.filter((x) => x.user_id === moi).map((x) => x.doc_id));
      const r = docs.filter((x) => x.emetteur_id !== moi);
      recus = r.length; aTraiter = r.filter((x) => !mes.has(x.id)).length; publies = docs.length - r.length;
    } catch (e) { /* hors ligne */ }
    root.innerHTML = `
      <div class="dash-hero"><div class="dash-hero-row"><div>
        <div class="eyebrow">${esc(currentUser.structure || (min ? 'Service du Secrétariat général' : reg ? 'Service de la DREPPNF' : 'Service du DPEPPNF'))}</div>
        <h1>${esc(s.sigle)} — ${esc(s.nom)}</h1><div class="sub">${esc(s.desc)}</div></div>
        <div class="date-chip">Connecté : ${esc(currentUser.nom)}</div></div></div>
      <div class="grid grid-3">
        <div class="card stat-card c-ocre"><div class="label">Documents à accuser</div><div class="value">${aTraiter}</div><div class="foot">envoyés par les structures de votre zone ou la hiérarchie</div></div>
        <div class="card stat-card c-indigo"><div class="label">Documents reçus</div><div class="value">${recus}</div></div>
        <div class="card stat-card c-vert"><div class="label">Documents envoyés</div><div class="value">${publies}</div></div>
      </div>
      <div class="card" style="margin-top:14px;"><div class="flex gap-8" style="flex-wrap:wrap;">
        <a class="btn btn-accent" href="#/publications" onclick="RES_ETAT.onglet='recus'">Documents reçus</a>
        <button class="btn btn-primary" id="sv-envoyer">+ Envoyer un document</button>
        <a class="btn" href="#/publications" onclick="RES_ETAT.onglet='publies'">Documents envoyés</a>
      </div></div>`;
    $('#sv-envoyer', root).onclick = () => resFormPublier(min ? 'ministere' : reg ? 'dreppnf' : 'dpeppnf');
  };
}

/* ---------- Comptes des services : section ajoutée à « Comptes des structures » du DPEPPNF ---------- */
{
  const _avant = ROUTES['#/comptes-reseau'];
  ROUTES['#/comptes-reseau'] = async (root) => {
    await _avant(root);
    if (currentUser.role === 'dpeppnf') await svSectionComptes(root, 'service');
    if (currentUser.role === 'dreppnf') await svSectionComptes(root, 'service_reg');
    if (currentUser.role === 'ministere') await svSectionComptes(root, 'service_min');
  };
}
async function svSectionComptes(root, role) {
  const reg = role === 'service_reg', min = role === 'service_min';
  const liste = min ? SERVICES_MIN : SERVICES;
  const box = document.createElement('div'); box.className = 'card'; box.style.marginTop = '14px';
  box.innerHTML = `<h3 style="margin:0 0 4px;">${min ? 'Services du Secrétariat général' : 'Services de la ' + (reg ? 'DREPPNF' : 'DPEPPNF')}</h3>
    <p class="text-soft">Créez le compte de chaque service. Un service échange des documents avec les ${min ? 'services des DREPPNF et des DPEPPNF, les bureaux des CEB, les écoles du pays' : reg ? 'services des DPEPPNF, les bureaux des CEB, les écoles de la région' : 'bureaux des CEB de la province, les écoles'} et les autres services. Vous voyez tous les documents qu'ils envoient.</p>
    <div id="sv-liste"><p class="text-soft">Chargement…</p></div>`;
  root.appendChild(box);
  const { data, error } = await window.supaClient.from('profiles').select('id,nom,service,structure').eq('role', role);
  const zone = $('#sv-liste', box);
  if (error) { zone.innerHTML = `<div class="alert alert-ocre">${esc(resMsgErreur(error))}</div>`; return; }
  const parCode = Object.fromEntries((data || []).map((p) => [p.service, p]));
  zone.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Service</th><th>Responsable</th><th>Compte</th><th></th></tr></thead><tbody>
    ${liste.map((s) => { const p = parCode[s.code]; return `<tr><td class="wrap"><b>${esc(s.sigle)}</b><br><span class="text-soft" style="font-size:12px;">${esc(s.nom)}</span></td>
      <td>${p ? esc(p.nom) : '—'}</td><td>${p ? '<span class="badge badge-vert">Créé</span>' : '<span class="badge badge-ocre">À créer</span>'}</td>
      <td>${p ? `<button class="btn btn-sm btn-danger" data-sv-retirer="${p.id}">Retirer l'accès</button>` : `<button class="btn btn-sm btn-primary" data-sv-creer="${s.code}">Créer le compte</button>`}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  $all('[data-sv-creer]', zone).forEach((b) => { b.onclick = () => svFormCompte(b.dataset.svCreer, role); });
  $all('[data-sv-retirer]', zone).forEach((b) => {
    b.onclick = async () => {
      const p = (data || []).find((x) => x.id === b.dataset.svRetirer);
      if (!p || !(await confirmDialog(`Retirer l'accès du service « ${serviceInfo(p.service).sigle} » (${p.nom}) ?`))) return;
      const { error: e } = await window.supaClient.from('profiles').delete().eq('id', p.id);
      if (e) { toast(resMsgErreur(e)); return; }
      toast('Accès retiré.'); onRouteChange();
    };
  });
}

function svFormCompte(code, role) {
  const me = currentUser, s = serviceInfo(code), reg = role === 'service_reg', min = role === 'service_min';
  if (!min && (!me.region || (!reg && !me.province))) { toast("Votre compte n'a pas sa région ou sa province renseignée : contactez la structure qui l'a créé."); return; }
  const mdp0 = (typeof genererMotDePasse === 'function') ? genererMotDePasse() : Math.random().toString(36).slice(2, 10).toUpperCase();
  openModal(`Créer le compte — ${s.sigle}`, `
    <p class="text-soft">${esc(s.nom)}</p>
    <div class="form-grid">
      <div class="field full"><label>Nom du responsable du service *</label><input id="sc-nom" placeholder="Ex : M. Ouédraogo"></div>
      <div class="field full"><label>E-mail de connexion *</label><input id="sc-email" type="email" placeholder="Ex : sgrh@exemple.bf"></div>
      <div class="field full"><label>Mot de passe initial</label><input id="sc-mdp" value="${esc(mdp0)}"><small>Généré automatiquement — notez-le pour le communiquer au responsable.</small></div>
    </div>`, {
    saveLabel: 'Créer le compte',
    onSave: async (o) => {
      const nom = $('#sc-nom', o).value.trim(), email = $('#sc-email', o).value.trim(), mdp = $('#sc-mdp', o).value;
      if (!nom || !email || !mdp) { toast('Tous les champs sont obligatoires.'); return false; }
      if (mdp.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères.'); return false; }
      let temp;
      try { temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
      catch (e) { toast("Impossible d'initialiser la création de compte."); return false; }
      const { data, error } = await temp.auth.signUp({ email, password: mdp });
      if (error) { toast('Création impossible : ' + (error.message || 'erreur inconnue')); return false; }
      if (!data.user) { toast('Réponse inattendue du serveur.'); return false; }
      const profil = { id: data.user.id, nom, role, service: code, structure: `${s.sigle} — ${me.structure || (min ? 'Secrétariat général' : reg ? 'DREPPNF ' + me.region : 'DPEPPNF ' + me.province)}`, region: min ? null : me.region, province: (reg || min) ? null : me.province, ceb: null };
      const { error: e2 } = await window.supaClient.from('profiles').insert(profil);
      if (e2) { toast('Compte de connexion créé, mais profil refusé : ' + resMsgErreur(e2)); return false; }
      o.querySelector('.modal-head h3').textContent = 'Compte créé';
      o.querySelector('.modal-body').innerHTML = `<p>Le compte du service <strong>${esc(s.sigle)}</strong> (${esc(nom)}) est créé. Communiquez-lui :</p>
        <div class="card"><p style="margin:4px 0;"><strong>E-mail :</strong> ${esc(email)}</p><p style="margin:4px 0;"><strong>Mot de passe :</strong> ${esc(mdp)}</p></div>`;
      o.querySelector('.modal-foot').innerHTML = `<button class="btn btn-primary" id="sc-fermer">Fermer</button>`;
      $('#sc-fermer', o).addEventListener('click', () => { closeModal(); onRouteChange(); });
      return false;
    }
  });
}
