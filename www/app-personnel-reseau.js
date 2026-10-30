/* ============================================================
   app-personnel-reseau.js — Personnel du réseau et mouvements
   ------------------------------------------------------------
   CEB, DPEPPNF, DREPPNF et ministère voient le personnel de leur zone,
   par DREPPNF > DPEPPNF > CEB > école (publiques et privées), et le
   journal des mouvements (changement d'école, de CEB, de province, de
   région). Même écran et mêmes colonnes à tous les niveaux.
   Tables et droits : supabase-personnel.sql (zone appliquée par le serveur).
   ============================================================ */

const PR_NIV = ['region', 'province', 'ceb', 'ecole'];
const PR_LIB = { region: 'DREPPNF (région)', province: 'DPEPPNF (province)', ceb: 'CEB', ecole: 'École' };
const PR_TYPE = { ecole: 'Changement d’école', ceb: 'Changement de CEB', province: 'Changement de province', region: 'Changement de région' };
const PR_ETAT = { chemin: [], onglet: '', statut: '', q: '' };
/* Chaque niveau voit les onglets de son ressort : du sien vers le bas. */
const PR_ONGLETS = {
  ministere: ['region', 'province', 'ceb', 'ecole', 'agents', 'mvts'],
  dreppnf: ['province', 'ceb', 'ecole', 'agents', 'mvts'],
  dpeppnf: ['ceb', 'ecole', 'agents', 'mvts'],
  ceb: ['ecole', 'agents', 'mvts'],
  ecole: ['agents', 'mvts']
};
const PR_ONG_LIB = { region: 'DREPPNF', province: 'DPEPPNF', ceb: 'CEB', ecole: 'Écoles', agents: 'Personnel', mvts: 'Mouvements' };
function prNiveau() { const n = typeof cepNiveauCompte === 'function' ? cepNiveauCompte() : null; return n || (prRoleEcole() ? 'ecole' : null); }

function prNorm(t) { return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function prCle(o, niv, pref) {
  if (niv === 'ecole') return o.id || o[(pref || '') + 'ecole'];
  const r = prNorm(o[pref + 'region']), p = prNorm(o[pref + 'province']), c = prNorm(o[pref + 'ceb']);
  return niv === 'region' ? r : niv === 'province' ? r + '|' + p : r + '|' + p + '|' + c;
}
function prDansChemin(o, chemin, pref) {
  return chemin.every((k, i) => (PR_NIV[i] === 'ecole' ? (o.id || o[pref + 'ecole']) : prCle(o, PR_NIV[i], pref)) === k);
}

/* Agrégation (fonction pure, testable) : une ligne par unité du niveau suivant le chemin */
function prAgreger(d, chemin, statut, nivForce) {
  const niv = nivForce || PR_NIV[chemin.length];
  const ecoles = d.ecoles.filter((e) => prDansChemin(e, chemin, '') && (!statut || e.statut === statut));
  const lignes = new Map(), ecoleCle = new Map();
  ecoles.forEach((e) => {
    const k = niv === 'ecole' ? e.id : prCle(e, niv, '');
    ecoleCle.set(e.id, k);
    if (!lignes.has(k)) lignes.set(k, { cle: k, nom: niv === 'region' ? e.region : niv === 'province' ? e.province : niv === 'ceb' ? e.ceb : e.nom, parent: [e.region, e.province, e.ceb].filter(Boolean).slice(0, PR_NIV.indexOf(niv)).join(' › '), publiques: 0, privees: 0, agents: 0, entrees: 0, sorties: 0 });
    lignes.get(k)[e.statut === 'Privée' ? 'privees' : 'publiques']++;
  });
  d.personnel.filter((p) => p.actif !== false && ecoleCle.has(p.ecole_id)).forEach((p) => { lignes.get(ecoleCle.get(p.ecole_id)).agents++; });
  d.mouvements.forEach((m) => {
    const a = niv === 'ecole' ? m.de_ecole : prCle(m, niv, 'de_'), b = niv === 'ecole' ? m.vers_ecole : prCle(m, niv, 'vers_');
    if (a === b) return;
    if (lignes.has(a)) lignes.get(a).sorties++;
    if (lignes.has(b)) lignes.get(b).entrees++;
  });
  return { niveau: niv, lignes: [...lignes.values()].sort((x, y) => String(x.nom).localeCompare(String(y.nom), 'fr')) };
}

async function prLire(table, ordre) {
  const supa = window.supaClient;
  if (!supa) { const e = new Error('Pas de connexion internet.'); e.horsLigne = true; throw e; }
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const r = await supa.from(table).select('*').order(ordre, { ascending: false }).range(from, from + 999);
    if (r.error) throw r.error;
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return out;
}
async function prCharger() {
  const [ecoles, personnel, mouvements] = await Promise.all([prLire('reseau_ecoles', 'created_at'), prLire('reseau_personnel', 'created_at'), prLire('reseau_mouvements', 'created_at')]);
  return { ecoles, personnel, mouvements };
}
function prMsg(e) { return /row-level security|permission denied|refus/i.test(e.message || '') ? 'Action refusée : droits insuffisants pour cette zone.' : (e.message || 'Erreur'); }

/* ---- Mutations vers une autre zone : arrivées visibles automatiquement dans la zone d'arrivée ---- */
/* Pure : dernier mouvement d'arrivée par agent, s'il date de moins de `jours` jours (mouvements du plus récent au plus ancien). */
function prArrivees(mouvements, jours, maintenant) {
  const lim = (maintenant || Date.now()) - (jours || 60) * 86400000;
  const res = new Map();
  (mouvements || []).forEach((m) => {
    if (!m.personnel_id || res.has(m.personnel_id)) return;
    const t = new Date(m.date_effet || m.created_at).getTime();
    if (m.vers_ecole && t >= lim) res.set(m.personnel_id, m);
  });
  return res;
}
function prBadgeArrivee(m) {
  const d = new Date(m.date_effet || m.created_at);
  const date = isNaN(d) ? '' : ' · ' + d.toLocaleDateString('fr-FR');
  return `<br><span class="badge badge-vert" style="font-weight:600;">Arrivé(e) de ${esc(m.de_nom || 'une autre école')}${m.de_ceb ? ' (' + esc(m.de_ceb) + ')' : ''}${date}</span>`;
}
/* La zone (région / province / CEB) est-elle couverte par le compte connecté ? (pour choisir le message affiché) */
function prZoneCouvre(region, province, ceb) {
  const n = typeof cepNiveauCompte === 'function' ? cepNiveauCompte() : null, u = (typeof currentUser !== 'undefined' && currentUser) || {};
  if (n === 'ministere') return true;
  if (n === 'dreppnf') return !!u.region && prNorm(u.region) === prNorm(region);
  if (n === 'dpeppnf') return !!u.region && !!u.province && prNorm(u.region) === prNorm(region) && prNorm(u.province) === prNorm(province);
  if (n === 'ceb') return !!u.region && !!u.province && !!u.ceb && prNorm(u.region) === prNorm(region) && prNorm(u.province) === prNorm(province) && prNorm(u.ceb) === prNorm(ceb);
  return false;
}
/* Annonce en temps réel : arrivée dans ma zone, départ de ma zone, mouvement concernant mon école. */
function prDemarrerTempsReel() {
  if (window._prRt || !window.supaClient || !prNiveau()) return;
  window._prRt = window.supaClient.channel('reseau_mouvements_rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reseau_mouvements' }, (payload) => {
      const m = payload.new || {}, moi = typeof currentUser !== 'undefined' && currentUser && m.auteur && m.auteur === currentUser.id;
      if (!moi) {
        const arrivee = prZoneCouvre(m.vers_region, m.vers_province, m.vers_ceb), depart = prZoneCouvre(m.de_region, m.de_province, m.de_ceb);
        if (prNiveau() === 'ecole') toast(`Mouvement concernant votre école : ${m.agent}`);
        else if (arrivee && !depart) toast(`Arrivée dans votre zone : ${m.agent} (de ${m.de_nom || '—'} vers ${m.vers_nom})`);
        else if (depart && !arrivee) toast(`Départ de votre zone : ${m.agent} → ${m.vers_nom} (${m.vers_ceb || ''})`);
        else toast(`Mutation : ${m.agent} → ${m.vers_nom}`);
      }
      if (location.hash === '#/personnel-reseau' && typeof scheduleSyncRerender === 'function') scheduleSyncRerender();
    })
    .subscribe();
}
window.prDemarrerTempsReel = prDemarrerTempsReel;

/* Choix de l'école d'arrivée : recherche dans TOUT le pays (autre CEB, province ou région) ; repli sur la zone si hors ligne. */
function prChoixEcole(id, d, exclureId) {
  const lib = (e) => `${e.nom} (${e.statut}) — ${e.ceb}, ${e.province}, ${e.region}`;
  const opts = (liste) => (liste || []).filter((e) => e.id !== exclureId).map((e) => `<option value="${esc(e.id)}">${esc(lib(e))}</option>`).join('') || '<option value="" disabled>Aucune école trouvée</option>';
  let t = null;
  window.prRechercherEcoles = (txt) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const sel = document.getElementById(id); if (!sel) return;
      const q = prNorm(txt);
      let liste;
      try { liste = await cepRpc('reseau_ecoles_recherche', { p_q: txt || '' }); }
      catch (e) { liste = d.ecoles.filter((x) => !q || prNorm(lib(x)).includes(q)); }
      sel.innerHTML = opts(liste);
    }, 300);
  };
  return `<label style="margin-top:8px;display:block;">École d’arrivée (recherche dans tout le pays)</label>
    <input id="${id}-q" style="width:100%" placeholder="Nom de l’école, CEB, province ou région" oninput="prRechercherEcoles(this.value)">
    <select id="${id}" style="width:100%;margin-top:6px;" size="5">${opts(d.ecoles)}</select>
    <p class="text-soft" style="font-size:12px;margin:4px 0 0;">Dans une autre CEB, province ou région ? L’agent apparaît automatiquement dans cette zone.</p>`;
}
function prToastMutation(m) {
  toast(m && m.vers_nom ? `Mutation enregistrée : ${m.agent} → ${m.vers_nom} (${m.vers_ceb || ''}). Il apparaît dans la zone d’arrivée.` : 'Mutation enregistrée');
}

function prHtml(d, niveau, E) {
  const ong = PR_ONGLETS[niveau];
  if (!ong.includes(E.onglet)) E.onglet = ong[0];
  const ecolesPortee = d.ecoles.filter((e) => !E.statut || e.statut === E.statut);
  const idsPortee = new Set(ecolesPortee.map((e) => e.id));
  const agents = d.personnel.filter((p) => p.actif !== false && idsPortee.has(p.ecole_id));
  const mvts = E.statut ? d.mouvements.filter((m) => idsPortee.has(m.de_ecole) || idsPortee.has(m.vers_ecole)) : d.mouvements;
  const ecoleDe = new Map(d.ecoles.map((e) => [e.id, e]));
  const arrivees = prArrivees(d.mouvements);
  const peutMuter = niveau !== 'ecole';
  const carte = (t, v, p) => `<div class="card stat-card"><div class="accent-bar"></div><div class="label">${t}</div><div class="value">${v}</div><div class="text-soft" style="font-size:12px;">${p || ''}</div></div>`;
  const pub = ecolesPortee.filter((e) => e.statut !== 'Privée').length;
  const nb = (niv) => new Set(ecolesPortee.map((e) => prCle(e, niv, ''))).size;
  const structure = niveau === 'ministere' ? carte('DREPPNF / DPEPPNF', nb('region') + ' / ' + nb('province'), 'régions · provinces')
    : niveau === 'dreppnf' ? carte('DPEPPNF / CEB', nb('province') + ' / ' + nb('ceb'), 'provinces · circonscriptions')
    : niveau === 'dpeppnf' ? carte('CEB', nb('ceb'), 'circonscriptions') : '';
  const kpis = `<div class="stats-grid">${carte('Agents', agents.length, 'en poste')}${carte('Écoles', ecolesPortee.length, `${pub} publiques · ${ecolesPortee.length - pub} privées`)}${structure}${carte('Mouvements', mvts.length, 'enregistrés')}</div>`;
  const onglets = `<div class="no-print" style="display:flex;gap:6px;margin:12px 0;flex-wrap:wrap;overflow-x:auto;">${ong.map((k) => `<button class="btn btn-sm ${E.onglet === k ? 'btn-primary' : ''}" data-onglet="${k}">${PR_ONG_LIB[k]}</button>`).join('')}</div>`;
  let corps;
  if (!['agents', 'mvts'].includes(E.onglet)) {
    const agg = prAgreger(d, [], E.statut, E.onglet);
    corps = agg.lignes.length ? `<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>${PR_LIB[agg.niveau]}</th><th>Rattaché à</th><th>Agents</th><th>Publ.</th><th>Priv.</th><th>Entrées</th><th>Sorties</th></tr></thead><tbody>${agg.lignes.map((l) => `<tr><td class="wrap" style="font-weight:700;">${esc(l.nom)}</td><td class="wrap">${esc(l.parent) || '—'}</td><td><b>${l.agents}</b></td><td>${l.publiques}</td><td>${l.privees}</td><td class="in" style="color:var(--vert,#1f6b4a)">${l.entrees ? `+${l.entrees}` : 0}</td><td style="color:var(--terre,#b5472f)">${l.sorties ? `−${l.sorties}` : 0}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><div class="big">∅</div>Aucune école enregistrée dans votre zone pour le moment.</div>';
  } else if (E.onglet === 'agents') {
    const q = prNorm(E.q), liste = agents.filter((p) => { const e = ecoleDe.get(p.ecole_id); return !q || prNorm([p.nom, p.prenom, p.matricule, p.fonction, p.classe, e && e.nom, e && e.ceb].join(' ')).includes(q); });
    const colsZone = niveau === 'ecole' ? '' : '<th>CEB</th><th>Province</th><th>Région</th>';
    corps = `<input id="pr-q" class="search-input no-print" placeholder="${niveau === 'ecole' ? 'Rechercher un agent' : 'Rechercher un agent, une école, une CEB'}" value="${esc(E.q)}" style="margin-bottom:8px;width:100%;max-width:420px;"><div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Agent</th><th>Matricule</th><th>Fonction</th><th>Classe</th>${niveau === 'ecole' ? '' : '<th>École</th>'}${colsZone}${peutMuter ? '<th></th>' : ''}</tr></thead><tbody>${liste.slice(0, 300).map((p) => { const e = ecoleDe.get(p.ecole_id) || {}; return `<tr><td class="wrap" style="font-weight:700;">${esc(p.nom)} ${esc(p.prenom || '')}${arrivees.has(p.id) ? prBadgeArrivee(arrivees.get(p.id)) : ''}</td><td>${esc(p.matricule || '—')}</td><td>${esc(p.fonction || '—')}</td><td>${esc(p.classe || '—')}</td>${niveau === 'ecole' ? '' : `<td class="wrap">${esc(e.nom)} <span class="badge ${e.statut === 'Privée' ? 'badge-ocre' : 'badge-vert'}">${esc(e.statut || '')}</span></td><td>${esc(e.ceb)}</td><td>${esc(e.province)}</td><td>${esc(e.region)}</td>`}${peutMuter ? `<td class="no-print"><button class="btn btn-sm" data-muter="${esc(p.id)}">Muter</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="9">Aucun agent.</td></tr>`}</tbody></table></div>${liste.length > 300 ? `<p class="text-soft">300 premiers sur ${liste.length} : affinez la recherche.</p>` : ''}`;
  } else {
    corps = `${peutMuter ? '<div class="no-print" style="margin-bottom:8px;"><button class="btn btn-primary btn-sm" id="pr-mvt">+ Enregistrer un mouvement</button></div>' : '<p class="text-soft no-print">Les mutations sont enregistrées par la CEB. Vous voyez ici les arrivées et départs de votre école.</p>'}<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Date</th><th>Agent</th><th>Type</th><th>De</th><th>Vers</th><th>Motif</th></tr></thead><tbody>${mvts.map((m) => `<tr><td>${esc(formatDate(m.date_effet))}</td><td class="wrap" style="font-weight:700;">${esc(m.agent)}</td><td><span class="badge badge-indigo">${esc(PR_TYPE[m.type] || m.type)}</span></td><td class="wrap">${esc(m.de_nom)}<br><small class="text-soft">${esc([m.de_ceb, m.de_province, m.de_region].join(' · '))}</small></td><td class="wrap">${esc(m.vers_nom)}<br><small class="text-soft">${esc([m.vers_ceb, m.vers_province, m.vers_region].join(' · '))}</small></td><td class="wrap">${esc(m.motif || '')}</td></tr>`).join('') || '<tr><td colspan="6">Aucun mouvement.</td></tr>'}</tbody></table></div>`;
  }
  const actionsCeb = niveau === 'ceb' ? '<button class="btn btn-sm" id="pr-ecole">+ École</button><button class="btn btn-sm" id="pr-agent">+ Agent</button>' : '';
  const zone = niveau === 'ministere' ? 'Tout le pays' : niveau === 'ecole' ? 'Votre école' : esc([currentUser.region && 'Région ' + currentUser.region, currentUser.province && 'Province ' + currentUser.province, currentUser.ceb && 'CEB ' + currentUser.ceb].filter(Boolean).join(' · ') || 'Zone non renseignée');
  const statutSel = niveau === 'ecole' ? '' : `<select id="pr-statut" class="search-input"><option value="">Publiques et privées</option><option ${E.statut === 'Publique' ? 'selected' : ''}>Publique</option><option ${E.statut === 'Privée' ? 'selected' : ''}>Privée</option></select>`;
  return `<div class="table-toolbar no-print"><div style="flex:1;min-width:200px;"><div style="font-weight:800;font-size:16px;">Personnel et mouvements — ${esc(CEP_NIVEAU_LIB[niveau])}${currentUser.structure ? ' — ' + esc(currentUser.structure) : ''}</div>
    <div class="text-soft" style="font-size:12.5px;">${zone}</div></div>
    ${statutSel}${actionsCeb}<button class="btn btn-sm" id="pr-actu">Actualiser</button></div>${kpis}${onglets}${corps}`;
}

/* Saisie d'un mouvement depuis l'onglet « Mouvements » : on cherche l'agent, on choisit l'école d'arrivée. */
function prFormMouvement(d, apres) {
  const actifs = d.personnel.filter((p) => p.actif !== false), ecoleDe = new Map(d.ecoles.map((e) => [e.id, e]));
  const lib = (p) => `${p.nom} ${p.prenom || ''} — ${(ecoleDe.get(p.ecole_id) || {}).nom || ''}`;
  window.prRemplirAgents = (txt) => { const q = prNorm(txt), sel = document.getElementById('pmv-ag'); if (!sel) return; sel.innerHTML = actifs.filter((p) => !q || prNorm(lib(p)).includes(q)).slice(0, 60).map((p) => `<option value="${esc(p.id)}">${esc(lib(p))}</option>`).join('') || '<option value="">Aucun agent trouvé</option>'; };
  openModal('Enregistrer un mouvement', `<label>Rechercher l’agent</label><input id="pmv-q" style="width:100%" placeholder="Nom ou école" oninput="prRemplirAgents(this.value)">
    <label style="margin-top:8px;display:block;">Agent</label><select id="pmv-ag" style="width:100%"></select>
    ${prChoixEcole('pmv-vers', d)}
    <label style="margin-top:8px;display:block;">Date d’effet</label><input type="date" id="pmv-date" value="${new Date().toISOString().slice(0, 10)}">
    <label style="margin-top:8px;display:block;">Motif</label><input id="pmv-motif" style="width:100%" placeholder="Ex. : affectation, rapprochement, promotion">`, {
    saveLabel: 'Valider le mouvement',
    onSave: async (ov) => {
      const ag = $('#pmv-ag', ov).value, vers = $('#pmv-vers', ov).value;
      if (!ag) { toast('Choisissez un agent.'); return false; }
      if (!vers) { toast('Choisissez l’école d’arrivée.'); return false; }
      const p = actifs.find((x) => x.id === ag);
      if (p && p.ecole_id === vers) { toast('L’agent est déjà dans cette école.'); return false; }
      try { const r = await cepRpc('reseau_muter', { p_personnel: ag, p_vers: vers, p_date: $('#pmv-date', ov).value, p_motif: $('#pmv-motif', ov).value }); prToastMutation(r); apres(); }
      catch (e) { toast(prMsg(e)); return false; }
    }
  });
  window.prRemplirAgents('');
}

function prFormMutation(d, agentId, apres) {
  const p = d.personnel.find((x) => x.id === agentId); if (!p) return;
  const cur = d.ecoles.find((e) => e.id === p.ecole_id) || {};
  openModal(`Muter ${p.nom} ${p.prenom || ''}`, `<p class="text-soft">Actuellement : ${esc(cur.nom)} — ${esc(cur.ceb)}</p>
    ${prChoixEcole('pm-vers', d, p.ecole_id)}
    <label style="margin-top:8px;display:block;">Date d’effet</label><input type="date" id="pm-date" value="${new Date().toISOString().slice(0, 10)}">
    <label style="margin-top:8px;display:block;">Motif</label><input id="pm-motif" style="width:100%" placeholder="Ex. : affectation, rapprochement, promotion">`, {
    saveLabel: 'Valider la mutation',
    onSave: async (ov) => {
      const vers = $('#pm-vers', ov).value; if (!vers) { toast('Choisissez l’école d’arrivée.'); return false; }
      try { const r = await cepRpc('reseau_muter', { p_personnel: agentId, p_vers: vers, p_date: $('#pm-date', ov).value, p_motif: $('#pm-motif', ov).value }); prToastMutation(r); apres(); }
      catch (e) { toast(prMsg(e)); return false; }
    }
  });
}
function prFormEcole(apres) {
  openModal('Nouvelle école', `<label>Nom de l’école</label><input id="pe-nom" style="width:100%"><label style="margin-top:8px;display:block;">Statut</label><select id="pe-st"><option>Publique</option><option>Privée</option></select>
    <p class="text-soft">Rattachée à votre CEB : ${esc(currentUser.ceb || '—')}.</p>`, {
    onSave: async (ov) => {
      const nom = $('#pe-nom', ov).value.trim(); if (!nom) { toast('Indiquez le nom de l’école.'); return false; }
      const r = await window.supaClient.from('reseau_ecoles').insert({ nom, statut: $('#pe-st', ov).value, region: currentUser.region, province: currentUser.province, ceb: currentUser.ceb });
      if (r.error) { toast(prMsg(r.error)); return false; } toast('École ajoutée'); apres();
    }
  });
}
function prFormAgent(d, apres) {
  if (!d.ecoles.length) { toast('Ajoutez d’abord une école.'); return; }
  openModal('Nouvel agent', `<label>Nom</label><input id="pa-nom" style="width:100%"><label style="margin-top:8px;display:block;">Prénom</label><input id="pa-pre" style="width:100%">
    <label style="margin-top:8px;display:block;">Matricule</label><input id="pa-mat" style="width:100%"><label style="margin-top:8px;display:block;">Fonction</label><input id="pa-fon" style="width:100%" placeholder="Instituteur, directeur…">
    <label style="margin-top:8px;display:block;">École</label><select id="pa-eco" style="width:100%">${d.ecoles.map((e) => `<option value="${esc(e.id)}">${esc(e.nom)} (${esc(e.statut)})</option>`).join('')}</select>`, {
    onSave: async (ov) => {
      const nom = $('#pa-nom', ov).value.trim(); if (!nom) { toast('Indiquez le nom.'); return false; }
      const r = await window.supaClient.from('reseau_personnel').insert({ nom, prenom: $('#pa-pre', ov).value.trim(), matricule: $('#pa-mat', ov).value.trim(), fonction: $('#pa-fon', ov).value.trim(), ecole_id: $('#pa-eco', ov).value });
      if (r.error) { toast(prMsg(r.error)); return false; } toast('Agent ajouté'); apres();
    }
  });
}

ROUTES['#/personnel-reseau'] = async (root) => {
  const niveau = prNiveau();
  if (!niveau) { root.innerHTML = '<div class="alert alert-terre">Cette page est réservée aux comptes du réseau et à la direction de l’école.</div>'; return; }
  let d;
  try { d = await prCharger(); } catch (e) { root.innerHTML = `<div class="alert alert-terre">${esc(e.horsLigne ? 'Pas de connexion internet.' : prMsg(e))}</div>`; return; }
  const dessiner = () => {
    root.innerHTML = prHtml(d, niveau, PR_ETAT);
    if ($('#pr-statut', root)) $('#pr-statut', root).onchange = (e) => { PR_ETAT.statut = e.target.value; dessiner(); };
    $('#pr-actu', root).onclick = () => onRouteChange();
    if ($('#pr-ecole', root)) { $('#pr-ecole', root).onclick = () => prFormEcole(onRouteChange); $('#pr-agent', root).onclick = () => prFormAgent(d, onRouteChange); }
    if ($('#pr-mvt', root)) $('#pr-mvt', root).onclick = () => prFormMouvement(d, onRouteChange);
    $all('[data-onglet]', root).forEach((b) => { b.onclick = () => { PR_ETAT.onglet = b.dataset.onglet; dessiner(); }; });
    $all('[data-muter]', root).forEach((b) => { b.onclick = () => prFormMutation(d, b.dataset.muter, onRouteChange); });
    const q = $('#pr-q', root); if (q) q.oninput = () => { PR_ETAT.q = q.value; dessiner(); const n = $('#pr-q', root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
  };
  dessiner();
};

/* ============================================================
   CÔTÉ ÉCOLE : remontée automatique des enseignants et de leur classe
   Déclenchée à chaque écriture dans « enseignants » ou « classes » (hook de db.js),
   au démarrage et au retour de la connexion. La direction n'a rien à faire.
   ============================================================ */
const PR_SYNC = { etat: '', quand: null, timer: null, derniere: '', enCours: false };

/* Pure : enseignants + classes -> lignes à envoyer. La classe tenue vient de la classe
   (titulaire), à défaut de la classe choisie dans la fiche de l'enseignant. */
function prConstruireAgents(enseignants, classes) {
  return enseignants.filter((e) => e._uuid && e.nom).map((e) => {
    let cl = classes.filter((c) => c.enseignantId === e.id || (Array.isArray(c.enseignantIds) && c.enseignantIds.includes(e.id))).map((c) => c.nom);
    if (!cl.length && e.classeId) { const c = classes.find((x) => x.id === e.classeId); if (c) cl = [c.nom]; }
    return { uuid: e._uuid, nom: e.nom, prenom: e.prenom || '', matricule: e.matricule || '', fonction: e.fonction || 'Enseignant', classe: cl.join(' / ') };
  });
}
function prRoleEcole() { return !!currentUser && ['directeur', 'directeur_adjoint', 'secretaire'].includes(currentUser.role); }

async function prPublierEcole(force) {
  if (!prRoleEcole() || PR_SYNC.enCours) return;
  const supa = window.supaClient;
  if (!supa || (typeof navigator !== 'undefined' && navigator.onLine === false)) { PR_SYNC.etat = 'En attente de connexion : l’envoi se fera au retour d’internet.'; return; }
  if (!currentUser.ceb || !currentUser.province || !currentUser.region) { PR_SYNC.etat = 'École non rattachée à sa CEB : demandez à la CEB de renseigner la zone de votre compte.'; return; }
  PR_SYNC.enCours = true;
  try {
    const [ens, classes, metaArr] = await Promise.all([DB.getAll('enseignants'), DB.getAll('classes'), DB.getAll('meta')]);
    const meta = metaArr[0] || {}, nom = (meta.nomEcole || currentUser.structure || '').trim();
    if (!nom) { PR_SYNC.etat = 'Nom de l’école manquant : renseignez-le dans Paramètres.'; return; }
    const agents = prConstruireAgents(ens, classes), statut = meta.statutEcole === 'Privée' ? 'Privée' : 'Publique';
    const empreinte = JSON.stringify([nom, statut, agents]);
    if (!force && empreinte === PR_SYNC.derniere) return;
    if (!agents.length) { PR_SYNC.etat = 'Aucun enseignant enregistré : rien à envoyer.'; return; }
    const r = await supa.rpc('reseau_ecole_publier', { p_nom: nom, p_statut: statut, p_agents: agents });
    if (r.error) throw r.error;
    PR_SYNC.derniere = empreinte; PR_SYNC.quand = new Date();
    PR_SYNC.etat = `Transmis à la CEB ${currentUser.ceb} : ${agents.length} agent(s) avec leur classe.`;
  } catch (e) { PR_SYNC.etat = 'Envoi à la CEB impossible pour le moment : ' + prMsg(e) + ' Nouvel essai automatique.'; setTimeout(() => prPlanifier(60000), 0); }
  finally { PR_SYNC.enCours = false; }
}
function prPlanifier(delai) {
  if (!prRoleEcole()) return;
  clearTimeout(PR_SYNC.timer);
  PR_SYNC.timer = setTimeout(() => prPublierEcole(false), delai === undefined ? 2500 : delai);
}
window.prNotifierChangement = (store) => { if (store === 'enseignants' || store === 'classes') prPlanifier(); };
if (typeof window.addEventListener === 'function') window.addEventListener('online', () => prPlanifier(1000));

/* Bandeau d'état sur la page Enseignants */
(function () {
  const orig = ROUTES['#/enseignants'];
  if (!orig) return;
  ROUTES['#/enseignants'] = async (root) => {
    await orig(root);
    if (!prRoleEcole() || (typeof getHashParams === 'function' && getHashParams().get('id'))) return;
    const bande = document.createElement('div');
    bande.className = 'alert alert-ocre no-print'; bande.style.marginBottom = '12px';
    const dessiner = () => { bande.innerHTML = `<b>Remontée vers la CEB.</b> ${esc(PR_SYNC.etat || 'Automatique : chaque affectation d’un enseignant à une classe est envoyée à votre CEB.')} <button class="btn btn-sm" id="pr-env" style="margin-left:8px;">Envoyer maintenant</button>`; $('#pr-env', bande).onclick = async () => { await prPublierEcole(true); dessiner(); toast(PR_SYNC.etat); }; };
    dessiner(); root.insertBefore(bande, root.firstChild);
  };
})();
