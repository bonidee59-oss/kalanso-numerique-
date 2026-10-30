/* ============================================================
   app-cep-jourj.js — Suivi du jour J, centres, centres à risque
   ------------------------------------------------------------
   Président de centre (rôle « centre », compte créé par la CEB) :
   pour chaque épreuve il saisit les présents, les absents, les incidents,
   l'ouverture de l'enveloppe et l'accusé de réception des épreuves.
   La saisie est gardée sur l'appareil puis envoyée dès que le réseau est
   là. La CEB peut saisir pour un centre qui n'a pas de réseau.
   Au-dessus de la CEB, seuls des chiffres arrivent : le texte libre des
   incidents n'est lisible que du centre et de la CEB.
   ============================================================ */

/* ---------- Fonctions pures ---------- */
function cepVersLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function cepDepuisLocal(v) { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
function cepEntierOuNull(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (t === '') return null;
  if (!/^\d{1,5}$/.test(t)) return NaN;
  return Number(t);
}
/* Contrôles de la saisie d'une épreuve (français simple). Renvoie { erreurs, avertissements } */
function cepControlerJourJ(s, attendus) {
  const erreurs = [], avertissements = [];
  if (Number.isNaN(s.presents)) erreurs.push('Le nombre de présents doit être un nombre entier.');
  if (Number.isNaN(s.absents)) erreurs.push("Le nombre d'absents doit être un nombre entier.");
  if (!erreurs.length) {
    if ((s.presents === null) !== (s.absents === null)) avertissements.push('Vous avez rempli les présents sans les absents (ou l\'inverse) : l\'épreuve ne sera pas comptée comme complète.');
    if (s.presents !== null && s.absents !== null && attendus > 0 && s.presents + s.absents !== attendus) avertissements.push(`Présents + absents (${s.presents + s.absents}) ne correspondent pas aux candidats attendus (${attendus}).`);
    if (s.enveloppe_le && !s.recu_le) avertissements.push("L'enveloppe est notée ouverte alors que la réception des épreuves n'est pas notée.");
    if (s.enveloppe_le && s.recu_le && new Date(s.enveloppe_le) < new Date(s.recu_le)) avertissements.push("L'enveloppe est ouverte avant la réception des épreuves : vérifiez les heures.");
  }
  (s.incidents || []).forEach((i, k) => { if (!CEP_INCIDENTS[i.type]) erreurs.push(`Incident ${k + 1} : type inconnu.`); if (String(i.description || '').length > 500) erreurs.push(`Incident ${k + 1} : description trop longue (500 caractères au maximum).`); });
  return { erreurs, avertissements };
}
function cepArgsJourJ(centreId, ep, s) {
  return {
    p_centre: centreId, p_epreuve_code: ep.code, p_epreuve_nom: ep.nom || null,
    p_presents: s.presents, p_absents: s.absents, p_enveloppe_le: s.enveloppe_le || null, p_recu_le: s.recu_le || null,
    p_scelle_intact: s.recu_le ? (s.scelle_intact === false ? false : true) : null,
    p_incidents: (s.incidents || []).map((i) => ({ type: i.type, gravite: i.gravite === 'majeur' ? 'majeur' : 'mineur', description: String(i.description || '').trim().slice(0, 500) || null })),
    p_maj_client: s.maj_client || new Date().toISOString()
  };
}
function cepListeCentresPublication(ctx) {
  const eps = (ctx.session.epreuves || []).map((e) => ({ code: e.code, nom: e.nom, date: e.date || '', heure: e.heure || '' }));
  return (ctx.centres || []).map((c) => ({
    id: c._uuid, nom: c.nom, jury: c.jury || '', localite: c.localite || '', nb_salles: Math.max(0, Math.floor(cepNb(c.nbSalles))), capacite: Math.max(0, Math.floor(cepNb(c.capaciteSalle))),
    nb_candidats: (ctx.candidats || []).filter((x) => x.centreUuid === c._uuid).length, epreuves: eps
  }));
}

/* ---------- Publication des centres (CEB) ---------- */
async function cepPublierCentres(ctx, silencieux) {
  const liste = cepListeCentresPublication(ctx);
  if (!liste.length) { if (!silencieux) toast("Aucun centre à publier : créez d'abord vos centres."); return false; }
  const r = await cepEnvoyer({ rpc: 'cep_centres_publier', cle: `centres:${ctx.session.annee}`, libelle: `Centres ${ctx.session.annee}`, args: { p_annee: ctx.session.annee, p_centres: liste } });
  if (!silencieux) toast(r.envoye ? `${liste.length} centre(s) publié(s).` : 'Pas de connexion : la liste des centres partira dès le retour du réseau.');
  return true;
}

/* ---------- Situation d'un centre (fermé, délocalisé, sécurisé) ---------- */
function cepFormRisque(c, apres) {
  const ov = openModal(`Situation du centre — ${c.nom}`, `
    <div class="form-grid">
      <div class="field full"><label>Situation *</label><select id="rk-st">${Object.entries(CEP_RISQUES).map(([k, v]) => `<option value="${k}" ${c.statut_risque === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      <div class="field full" id="rk-ch-motif"><label>Motif *</label><textarea id="rk-motif" style="min-height:70px;" maxlength="300" placeholder="Ex : menace sécuritaire, inondation de la route…">${esc(c.motif_risque || '')}</textarea></div>
      <div class="field full" id="rk-ch-accueil"><label>Centre d'accueil (si délocalisé)</label><input id="rk-accueil" value="${esc(c.centre_accueil || '')}" maxlength="120"></div>
    </div>`, {
    saveLabel: 'Enregistrer',
    onSave: async (o) => {
      const st = $('#rk-st', o).value, motif = $('#rk-motif', o).value.trim();
      if (st !== 'normal' && motif.length < 3) { toast('Indiquez le motif.'); return false; }
      if (st === 'delocalise' && !$('#rk-accueil', o).value.trim() && !(await confirmDialog("Aucun centre d'accueil indiqué. Enregistrer quand même ?"))) return false;
      try {
        const r = await cepEnvoyer({ rpc: 'cep_centre_marquer', cle: `risque:${c.id}`, libelle: `Situation du centre ${c.nom}`, args: { p_id: c.id, p_statut: st, p_motif: motif, p_accueil: $('#rk-accueil', o).value.trim() } });
        toast(r.envoye ? 'Situation du centre enregistrée.' : 'Pas de connexion : la situation partira dès le retour du réseau.');
        if (apres) apres(); else onRouteChange();
        return true;
      } catch (e) { toast(e.message); return false; }
    }
  });
  const maj = () => { const st = $('#rk-st', ov).value; $('#rk-ch-motif', ov).style.display = st === 'normal' ? 'none' : ''; $('#rk-ch-accueil', ov).style.display = st === 'delocalise' ? '' : 'none'; };
  $('#rk-st', ov).onchange = maj; maj();
}

/* ============================================================
   CEB : centres, situation, comptes des présidents de centre
   ============================================================ */
ROUTES['#/centres-ceb'] = async (root) => {
  if (currentUser.role !== 'ceb') { root.innerHTML = '<div class="alert alert-terre">Page réservée à la CEB.</div>'; return; }
  const supa = window.supaClient;
  const sessions = (await DB.getAll('examSessions')).filter((s) => s.type !== 'blanc').sort((a, b) => String(b.annee).localeCompare(String(a.annee)));
  if (!sessions.length) { root.innerHTML = '<div class="empty-state"><div class="big">▦</div>Créez d\'abord une session CEP dans l\'Espace Examen, puis vos centres.</div>'; return; }
  if (!sessions.some((s) => s._uuid === CEP_ETAT.sessionUuid)) CEP_ETAT.sessionUuid = sessions[0]._uuid;
  const session = sessions.find((s) => s._uuid === CEP_ETAT.sessionUuid);
  const ctx = await exChargerCtx(session);
  const file = await cepFileEnAttente().catch(() => []);
  let serveur = [], presidents = [], hors = false;
  try {
    serveur = await cepLireTout(() => supa.from('cep_centres').select('id,statut_risque,motif_risque,centre_accueil,nb_candidats,maj_le').eq('annee', session.annee));
    presidents = await cepLireTout(() => supa.from('profiles').select('id,nom,structure,centre_id').eq('role', 'centre'));
  } catch (e) { hors = true; }
  const srv = new Map(serveur.map((c) => [c.id, c]));
  const pres = new Map(presidents.map((p) => [p.centre_id, p]));
  root.innerHTML = `${cepBandeauFile(file.length, file.filter((x) => x.erreur).length)}
    ${hors ? '<div class="alert alert-ocre" style="margin-bottom:12px;">Pas de connexion : l\'état du serveur n\'est pas affiché.</div>' : ''}
    <div class="table-toolbar no-print"><select id="cc-session" class="search-input">${sessions.map((s) => `<option value="${esc(s._uuid)}" ${s._uuid === session._uuid ? 'selected' : ''}>${esc(s.libelle)}</option>`).join('')}</select><div style="flex:1;"></div>
      <button class="btn btn-accent" id="cc-pub">⇪ Publier la liste des centres</button></div>
    <p class="text-soft" style="font-size:13px;">Les centres créés dans l'Espace Examen doivent être publiés sur le serveur pour apparaître dans les tableaux de bord et pour que les présidents de centre puissent saisir le jour J. Seuls les noms de centres et des chiffres sont envoyés.</p>
    ${ctx.centres.length ? `<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Centre</th><th>Jury</th><th>Candidats</th><th>Sur le serveur</th><th>Situation</th><th>Président de centre</th><th></th></tr></thead><tbody>
    ${ctx.centres.map((c) => { const s = srv.get(c._uuid), p = pres.get(c._uuid), nb = ctx.candidats.filter((x) => x.centreUuid === c._uuid).length;
      return `<tr><td class="wrap" style="font-weight:700;">${esc(c.nom)}</td><td>${esc(exNomJury(c))}</td><td>${nb}</td>
        <td>${s ? '<span class="badge badge-vert">Publié</span>' : '<span class="badge badge-ocre">Non publié</span>'}${s && s.nb_candidats !== nb ? ' <span class="badge badge-ocre">à republier</span>' : ''}</td>
        <td>${s ? `<span class="badge badge-${CEP_RISQUES[s.statut_risque].badge}">${esc(CEP_RISQUES[s.statut_risque].label)}</span>` : '—'}</td>
        <td class="wrap">${p ? esc(p.nom) : '—'}</td>
        <td class="no-print"><div class="flex gap-8" style="flex-wrap:wrap;">${s ? `<button class="btn btn-sm" data-risque="${esc(c._uuid)}">Situation</button>` : ''}${s && !p ? `<button class="btn btn-sm btn-accent" data-pres="${esc(c._uuid)}">Créer le compte du président</button>` : ''}${s ? `<a class="btn btn-sm" href="#/jour-j?centre=${esc(c._uuid)}">Jour J</a>` : ''}</div></td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty-state">Aucun centre dans cette session. Créez-les dans l\'Espace Examen (onglet « Jurys &amp; centres »).</div>'}`;
  $('#cc-session', root).onchange = (e) => { CEP_ETAT.sessionUuid = e.target.value; onRouteChange(); };
  $('#cc-pub', root).onclick = async () => { await cepPublierCentres(ctx, false); onRouteChange(); };
  cepBrancherFile(root);
  $all('[data-risque]', root).forEach((b) => {
    b.onclick = () => { const c = ctx.centres.find((x) => x._uuid === b.dataset.risque), s = srv.get(b.dataset.risque); if (c && s) cepFormRisque({ id: c._uuid, nom: c.nom, ...s }); };
  });
  $all('[data-pres]', root).forEach((b) => { b.onclick = () => { const c = ctx.centres.find((x) => x._uuid === b.dataset.pres); if (c) cepFormPresident(c); }; });
};

function cepFormPresident(c) {
  const me = currentUser;
  if (!me.region || !me.province || !me.ceb) { toast("Votre compte n'a pas sa région, sa province et sa CEB renseignées."); return; }
  const mdp0 = (typeof genererMotDePasse === 'function') ? genererMotDePasse() : Math.random().toString(36).slice(2, 10).toUpperCase();
  openModal('Compte du président de centre', `
    <p>Centre : <b>${esc(c.nom)}</b>. Ce compte ne voit que le suivi du jour J de ce centre.</p>
    <div class="form-grid">
      <div class="field full"><label>Nom du président *</label><input id="pc-nom"></div>
      <div class="field full"><label>E-mail de connexion *</label><input id="pc-email" type="email"></div>
      <div class="field full"><label>Mot de passe initial</label><input id="pc-mdp" value="${esc(mdp0)}"><small>Notez-le : il faudra le communiquer à la personne.</small></div>
    </div>`, {
    saveLabel: 'Créer le compte',
    onSave: async (o) => {
      const nom = $('#pc-nom', o).value.trim(), email = $('#pc-email', o).value.trim(), mdp = $('#pc-mdp', o).value;
      if (!nom || !email || !mdp) { toast('Tous les champs sont obligatoires.'); return false; }
      if (mdp.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères.'); return false; }
      let temp;
      try { temp = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); } catch (e) { toast("Impossible d'initialiser la création de compte."); return false; }
      const { data, error } = await temp.auth.signUp({ email, password: mdp });
      if (error || !data.user) { toast('Création impossible : ' + ((error && error.message) || 'réponse inattendue') + '. Vérifiez que la confirmation par e-mail est désactivée (voir le guide).'); return false; }
      const { error: e2 } = await window.supaClient.from('profiles').insert({ id: data.user.id, nom, role: 'centre', structure: `Centre ${c.nom}`, region: me.region, province: me.province, ceb: me.ceb, centre_id: c._uuid });
      if (e2) { toast('Compte de connexion créé, mais profil refusé : ' + cepConvertirErreur(e2).message + ' (avez-vous exécuté supabase-complet.sql ?)'); return false; }
      o.querySelector('.modal-head h3').textContent = 'Compte créé';
      o.querySelector('.modal-body').innerHTML = `<p>Communiquez ces identifiants au président du centre <b>${esc(c.nom)}</b> :</p><div class="card"><p style="margin:4px 0;"><strong>E-mail :</strong> ${esc(email)}</p><p style="margin:4px 0;"><strong>Mot de passe :</strong> ${esc(mdp)}</p></div>`;
      o.querySelector('.modal-foot').innerHTML = '<button class="btn btn-primary" id="pc-fermer">Fermer</button>';
      $('#pc-fermer', o).addEventListener('click', () => { closeModal(); onRouteChange(); });
      return false;
    }
  });
}

/* ============================================================
   JOUR J : saisie par épreuve
   ============================================================ */
async function cepChargerCentreJourJ(centreId) {
  const supa = window.supaClient, cle = `centre:${centreId}`;
  try {
    const c = await supa.from('cep_centres').select('*').eq('id', centreId).single();
    if (c.error) throw cepConvertirErreur(c.error);
    const [j, i] = await Promise.all([
      cepLireTout(() => supa.from('cep_jourj').select('*').eq('centre_id', centreId)),
      cepLireTout(() => supa.from('cep_jourj_incidents').select('*').eq('centre_id', centreId))
    ]);
    const val = { centre: c.data, jourj: j, incidents: i };
    await cepCacheEcrire(cle, val);
    return { ...val, horsLigne: false };
  } catch (e) {
    const c = await cepCacheLire(cle);
    if (c && e.horsLigne) return { ...c.valeur, horsLigne: true, le: c.le };
    throw e;
  }
}
function cepSaisieInitiale(serveur, incidents, local) {
  const base = serveur ? {
    presents: serveur.presents, absents: serveur.absents, enveloppe_le: serveur.enveloppe_le, recu_le: serveur.recu_le, scelle_intact: serveur.scelle_intact,
    maj_client: serveur.maj_client, incidents: incidents.map((i) => ({ type: i.type, gravite: i.gravite, description: i.description || '' })), synchro: true
  } : { presents: null, absents: null, enveloppe_le: null, recu_le: null, scelle_intact: null, maj_client: null, incidents: [], synchro: false };
  if (local && local.saisie && (!base.maj_client || String(local.saisie.maj_client) > String(base.maj_client))) return { ...local.saisie, synchro: !!local.synchro };
  return base;
}
const cepEtatSynchro = (s) => (s.synchro ? '<span class="badge badge-vert">Enregistré sur le serveur</span>' : (s.maj_client ? '<span class="badge badge-ocre">Sur ce téléphone — en attente de connexion</span>' : '<span class="badge badge-indigo">Pas encore saisi</span>'));

function cepHtmlEpreuveJourJ(ep, s, attendus) {
  const k = esc(ep.code);
  return `<div class="card" style="margin-bottom:14px;" data-ep="${k}">
    <div class="flex justify-between items-center" style="gap:8px;flex-wrap:wrap;"><h3 style="margin:0;">${esc(ep.nom || ep.code)}</h3><span data-etat>${cepEtatSynchro(s)}</span></div>
    <p class="text-soft" style="margin:4px 0 10px;font-size:12.5px;">${ep.date ? esc(formatDate(ep.date)) : ''} ${esc(ep.heure || '')}</p>
    <div class="form-grid">
      <div class="field"><label>1. Épreuves reçues le</label><input type="datetime-local" data-f="recu" value="${esc(cepVersLocal(s.recu_le))}"><button type="button" class="btn btn-sm" data-maint="recu" style="margin-top:4px;">Reçues maintenant</button></div>
      <div class="field"><label>Scellé du paquet</label><select data-f="scelle"><option value="1" ${s.scelle_intact !== false ? 'selected' : ''}>Intact</option><option value="0" ${s.scelle_intact === false ? 'selected' : ''}>Abîmé ou ouvert</option></select></div>
      <div class="field"><label>2. Enveloppe ouverte le</label><input type="datetime-local" data-f="env" value="${esc(cepVersLocal(s.enveloppe_le))}"><button type="button" class="btn btn-sm" data-maint="env" style="margin-top:4px;">Ouverte maintenant</button></div>
      <div class="field"><label>3. Candidats présents</label><input inputmode="numeric" data-f="pres" value="${s.presents === null || s.presents === undefined ? '' : s.presents}"></div>
      <div class="field"><label>Candidats absents</label><input inputmode="numeric" data-f="abs" value="${s.absents === null || s.absents === undefined ? '' : s.absents}"></div>
      <div class="field"><label>Candidats attendus</label><div style="padding-top:8px;font-weight:700;">${attendus}</div></div>
    </div>
    <h4 style="margin:10px 0 4px;">4. Incidents</h4>
    <p class="text-soft" style="font-size:12px;margin:0 0 6px;">N'écrivez pas de noms de candidats si ce n'est pas nécessaire. Ce texte n'est lisible que par la CEB ; les niveaux supérieurs ne voient que des totaux.</p>
    <div data-incidents>${(s.incidents || []).map((i, n) => cepHtmlIncident(i, n)).join('')}</div>
    <div class="flex gap-8" style="flex-wrap:wrap;margin-top:8px;"><button type="button" class="btn btn-sm" data-add-inc>+ Signaler un incident</button><button type="button" class="btn btn-accent" data-save>Enregistrer cette épreuve</button></div></div>`;
}
const cepHtmlIncident = (i, n) => `<div class="card" style="padding:8px 10px;margin-bottom:6px;" data-inc="${n}"><div class="flex gap-8" style="flex-wrap:wrap;">
  <select data-i="type">${Object.entries(CEP_INCIDENTS).map(([k, v]) => `<option value="${k}" ${i.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
  <select data-i="gravite"><option value="mineur" ${i.gravite !== 'majeur' ? 'selected' : ''}>Mineur</option><option value="majeur" ${i.gravite === 'majeur' ? 'selected' : ''}>Majeur</option></select>
  <button type="button" class="btn btn-sm btn-danger" data-rm-inc>Retirer</button></div>
  <textarea data-i="desc" maxlength="500" style="width:100%;margin-top:6px;" placeholder="Ce qui s'est passé">${esc(i.description || '')}</textarea></div>`;

function cepLireFormEpreuve(carte, ancien) {
  const f = (n) => $(`[data-f="${n}"]`, carte);
  const recu = cepDepuisLocal(f('recu').value);
  return {
    presents: cepEntierOuNull(f('pres').value), absents: cepEntierOuNull(f('abs').value), enveloppe_le: cepDepuisLocal(f('env').value), recu_le: recu,
    scelle_intact: recu ? f('scelle').value !== '0' : null,
    incidents: $all('[data-inc]', carte).map((c) => ({ type: $('[data-i="type"]', c).value, gravite: $('[data-i="gravite"]', c).value, description: $('[data-i="desc"]', c).value.trim() })),
    maj_client: new Date().toISOString(), synchro: false, _ancien: ancien
  };
}

ROUTES['#/jour-j'] = async (root) => {
  const role = currentUser.role;
  if (role !== 'centre' && role !== 'ceb') { root.innerHTML = '<div class="alert alert-terre">Page réservée aux présidents de centre et à la CEB.</div>'; return; }
  let centreId = role === 'centre' ? currentUser.centre_id : (getHashParams().get('centre') || CEP_ETAT.centreId || '');
  const file = await cepFileEnAttente().catch(() => []);
  let choix = '';
  if (role === 'ceb') {
    let liste = [];
    try {
      const sess = (await DB.getAll('examSessions')).filter((s) => s.type !== 'blanc');
      const an = CEP_ETAT.annee || (sess[0] && sess[0].annee) || '';
      liste = await cepLireTout(() => window.supaClient.from('cep_centres').select('id,nom,annee').eq('annee', an).order('nom'));
      await cepCacheEcrire('centres-liste:' + currentUser.id, liste);
    } catch (e) { const c = await cepCacheLire('centres-liste:' + currentUser.id); liste = c ? c.valeur : []; }
    if (!centreId && liste[0]) centreId = liste[0].id;
    CEP_ETAT.centreId = centreId;
    choix = `<div class="table-toolbar no-print"><label class="text-soft">Centre</label><select id="jj-centre" class="search-input">${liste.map((c) => `<option value="${esc(c.id)}" ${c.id === centreId ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select><span class="text-soft" style="font-size:12.5px;">Vous saisissez pour le compte du centre.</span></div>`;
  }
  if (!centreId) { root.innerHTML = `${choix}<div class="empty-state"><div class="big">▦</div>${role === 'centre' ? "Votre compte n'est relié à aucun centre : contactez la CEB." : "Aucun centre publié. Publiez vos centres depuis « Centres et présidents »."}</div>`; return; }
  let d;
  try { d = await cepChargerCentreJourJ(centreId); } catch (e) { root.innerHTML = `${choix}<div class="alert alert-terre">${esc(e.horsLigne ? "Pas de connexion et aucune donnée de ce centre n'a encore été chargée sur ce téléphone : connectez-vous une première fois avec internet." : e.message)}</div>`; return; }
  const c = d.centre, eps = Array.isArray(c.epreuves) ? c.epreuves : [];
  const locaux = await cepLocalTous('jourj');
  const R = CEP_RISQUES[c.statut_risque] || CEP_RISQUES.normal;
  root.innerHTML = `${cepBandeauFile(file.length, file.filter((x) => x.erreur).length)}${choix}
    ${d.horsLigne ? '<div class="alert alert-ocre" style="margin-bottom:12px;">Pas de connexion : vous pouvez saisir, tout partira dès le retour du réseau.</div>' : ''}
    <div class="card" style="margin-bottom:14px;"><div style="font-weight:800;font-size:16px;">${esc(c.nom)}</div><div class="text-soft">${esc(exNomJuryTexte(c))} · ${c.nb_candidats} candidat(s) attendu(s) · <span class="badge badge-${R.badge}">${esc(R.label)}</span></div>
      ${c.statut_risque !== 'normal' ? `<div class="alert alert-ocre" style="margin-top:8px;">${esc(c.motif_risque || '')}${c.centre_accueil ? ' — accueil : ' + esc(c.centre_accueil) : ''}</div>` : ''}</div>
    ${eps.length ? eps.map((ep) => {
      const srv = d.jourj.find((x) => x.epreuve_code === ep.code), loc = locaux.find((x) => x.cle === `${centreId}:${ep.code}`);
      return cepHtmlEpreuveJourJ(ep, cepSaisieInitiale(srv, d.incidents.filter((x) => x.epreuve_code === ep.code), loc), c.nb_candidats);
    }).join('') : '<div class="alert alert-ocre">La CEB n\'a pas encore indiqué les épreuves de ce centre. Elle doit publier la liste des centres.</div>'}`;
  cepBrancherFile(root);
  if ($('#jj-centre', root)) $('#jj-centre', root).onchange = (e) => { CEP_ETAT.centreId = e.target.value; location.hash = '#/jour-j?centre=' + e.target.value; };
  $all('[data-ep]', root).forEach((carte) => {
    const ep = eps.find((x) => x.code === carte.dataset.ep);
    $all('[data-maint]', carte).forEach((b) => { b.onclick = () => { $(`[data-f="${b.dataset.maint}"]`, carte).value = cepVersLocal(new Date().toISOString()); }; });
    $('[data-add-inc]', carte).onclick = () => { $('[data-incidents]', carte).insertAdjacentHTML('beforeend', cepHtmlIncident({ type: 'autre', gravite: 'mineur', description: '' }, Date.now())); };
    carte.addEventListener('click', (e) => { const rm = e.target.closest('[data-rm-inc]'); if (rm) rm.closest('[data-inc]').remove(); });
    $('[data-save]', carte).onclick = async () => {
      const s = cepLireFormEpreuve(carte), ctl = cepControlerJourJ(s, c.nb_candidats);
      if (ctl.erreurs.length) { toast(ctl.erreurs[0]); return; }
      if (ctl.avertissements.length && !(await confirmDialog(ctl.avertissements.join(' ') + ' Enregistrer quand même ?'))) return;
      delete s._ancien;
      const cle = `${centreId}:${ep.code}`, ex = (await cepLocalTous('jourj')).find((x) => x.cle === cle);
      const rec = { kind: 'jourj', cle, saisie: s, synchro: false, user: currentUser.id };
      if (ex) await DB.put('cepLocal', { ...ex, ...rec }); else await DB.add('cepLocal', rec);
      let etat = { ...s };
      try {
        const r = await cepEnvoyer({ rpc: 'cep_jourj_enregistrer', cle: `jourj:${cle}`, libelle: `Jour J — ${ep.nom || ep.code}`, args: cepArgsJourJ(centreId, ep, s) });
        if (r.envoye) {
          const ex2 = (await cepLocalTous('jourj')).find((x) => x.cle === cle); if (ex2) await DB.put('cepLocal', { ...ex2, synchro: true });
          etat.synchro = true;
          toast(r.data === 'ignore' ? "Une saisie plus récente existe déjà sur le serveur : la vôtre n'a pas été retenue." : 'Épreuve enregistrée.');
        } else toast('Pas de connexion : enregistré sur ce téléphone, envoi dès le retour du réseau.');
      } catch (er) { toast(er.message); return; }
      $('[data-etat]', carte).innerHTML = cepEtatSynchro(etat);
    };
  });
  cepRejouerFile().then(async (r) => {
    if (r.ok) { for (const l of await cepLocalTous('jourj')) if (!l.synchro) await DB.put('cepLocal', { ...l, synchro: true }); }
  }).catch(() => {});
};
function exNomJuryTexte(c) { return String(c.jury || '').trim() || 'Jury unique'; }

/* Tableau de bord du président de centre */
const _cepDashboardAvant = ROUTES['#/dashboard'];
ROUTES['#/dashboard'] = async (root) => {
  if (!currentUser || currentUser.role !== 'centre') return _cepDashboardAvant(root);
  root.innerHTML = `<div class="card" style="margin-bottom:14px;"><div style="font-weight:800;font-size:17px;">Président de centre${currentUser.structure ? ' — ' + esc(currentUser.structure) : ''}</div>
    <div class="text-soft">Connecté : <b>${esc(currentUser.nom)}</b></div></div>
    <div class="card"><div class="flex gap-8" style="flex-wrap:wrap;"><a class="btn btn-accent" href="#/jour-j">Saisir le suivi du jour J</a><a class="btn" href="#/cep-calendrier">Calendrier du CEP</a></div></div>`;
};
