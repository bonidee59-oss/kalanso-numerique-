/* ============================================================
   app-cep-validation.js — Remontées par le serveur + validation
   ------------------------------------------------------------
   CEB : transmet ses effectifs d'inscription et son bordereau de
         résultats (chiffres agrégés seulement), voit le statut
         (transmis, validé, à corriger), corrige et retransmet.
   DPEPPNF → DREPPNF → ministère : valident dans l'ordre, ou renvoient
         avec un motif. Tout est écrit dans le journal du serveur.
   Sans connexion, la transmission attend dans une file et part dès le
   retour du réseau ; le fichier .json reste la solution de secours
   (rubriques existantes de chaque niveau).
   ============================================================ */

const CEP_ACTIONS_LIB = {
  transmettre: 'a transmis', retransmettre: 'a retransmis après correction', valider: 'a validé', renvoyer: 'a renvoyé pour correction',
  marquer_centre: 'a changé la situation du centre', saisie_jourj: 'a saisi le suivi du jour J', definir_calendrier: 'a défini le calendrier',
  publier_centres: 'a publié la liste des centres', etape_faite: 'a marqué une étape comme faite', etape_annulee: 'a annulé une étape « faite »'
};
const CEP_DOC_LIB = { effectifs: "effectifs d'inscription", bordereau: 'bordereau de résultats', centre: 'centre', jourj: 'jour J', calendrier: 'calendrier', etape: 'étape' };

/* ---------- Transmission par la CEB (appelée aussi depuis l'Espace Examen) ---------- */
async function cepNombreEcolesAttendues() {
  try {
    const r = await window.supaClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'directeur');
    return r.error ? 0 : (r.count || 0);
  } catch (e) { return 0; }
}
async function cepTransmettreEffectifs(ctx) {
  if (currentUser.role !== 'ceb') { toast('Seul le compte de la CEB transmet les effectifs.'); return false; }
  const s = ctx.session;
  if (s.type === 'blanc') { toast('Un examen blanc ne se transmet pas.'); return false; }
  const p = cepEffectifsDepuisSession(ctx, await cepNombreEcolesAttendues());
  if (p.inscrits_f + p.inscrits_g === 0) { toast("Aucun candidat inscrit : il n'y a rien à transmettre."); return false; }
  const msg = `Transmettre les effectifs d'inscription au serveur ? ${p.inscrits_f + p.inscrits_g} candidats (${p.inscrits_f} filles, ${p.inscrits_g} garçons), ${p.nb_centres} centre(s), ${p.nb_jurys} jury(s). Aucun nom de candidat n'est envoyé.`;
  if (!(await confirmDialog(msg))) return false;
  try {
    const r = await cepEnvoyer({
      rpc: 'cep_effectifs_transmettre', cle: `effectifs:${s.annee}:${s.type}`, libelle: `Effectifs ${s.annee}`,
      args: { p_annee: s.annee, p_type: s.type, p_inscrits_f: p.inscrits_f, p_inscrits_g: p.inscrits_g, p_nb_ecoles: p.nb_ecoles, p_nb_ecoles_attendues: p.nb_ecoles_attendues,
        p_nb_centres: p.nb_centres, p_nb_jurys: p.nb_jurys, p_nb_salles: p.nb_salles, p_nb_handicap: p.nb_handicap, p_nb_bilingues: p.nb_bilingues }
    });
    toast(r.envoye ? 'Effectifs transmis.' : 'Pas de connexion : les effectifs partiront dès le retour du réseau.');
    if (typeof cepPublierCentres === 'function') await cepPublierCentres(ctx, true).catch(() => {});
    return true;
  } catch (e) { toast(e.message); return false; }
}
async function cepTransmettreBordereau(ctx, res) {
  if (currentUser.role !== 'ceb') { toast('Seul le compte de la CEB transmet les résultats.'); return false; }
  const s = ctx.session;
  if (s.type === 'blanc') { toast('Un examen blanc ne se transmet pas.'); return false; }
  if (!s.resultatsVerrouilles) { toast("Clôturez d'abord la délibération."); return false; }
  const p = cepBordereauDepuisResultats(s, res), err = cepControlerBordereau(p);
  if (err.length) { toast(err[0]); return false; }
  const nI = p.f.inscrits + p.g.inscrits, nA = p.f.admis + p.g.admis;
  if (!(await confirmDialog(`Transmettre le bordereau de résultats au serveur ? ${nI} inscrits, ${nA} admis. Seuls des chiffres sont envoyés (aucun nom de candidat).`))) return false;
  try {
    const r = await cepEnvoyer({
      rpc: 'cep_bordereau_transmettre', cle: `bordereau:${s.annee}:${s.type}`, libelle: `Bordereau ${s.annee}`,
      args: { p_annee: s.annee, p_type: s.type, p_f: p.f, p_g: p.g, p_moyenne: p.moyenne, p_nb_moyennes: p.nb_moyennes, p_seuil: p.seuil, p_epreuves: p.epreuves,
        p_handicap_inscrits: p.handicap_inscrits, p_handicap_admis: p.handicap_admis, p_bilingues_inscrits: p.bilingues_inscrits, p_bilingues_admis: p.bilingues_admis }
    });
    toast(r.envoye ? 'Bordereau transmis.' : 'Pas de connexion : le bordereau partira dès le retour du réseau.');
    return true;
  } catch (e) { toast(e.message); return false; }
}

/* ---------- HTML pur ---------- */
const cepBadgeDoc = (r) => { const s = cepStatutDoc(r); return `<span class="badge badge-${s.badge}">${esc(s.label)}</span>`; };
function cepHtmlSuiviDoc(titre, r, nature) {
  return `<div class="card" style="margin-bottom:12px;"><div class="flex justify-between items-center" style="gap:8px;flex-wrap:wrap;"><h3 style="margin:0;">${esc(titre)}</h3>${cepBadgeDoc(r)}</div>
    ${r ? `<p class="text-soft" style="margin:6px 0;font-size:13px;">Version ${r.version} · transmis le ${esc(formatDate(String(r.transmis_le).slice(0, 10)))} par ${esc(r.transmis_par_nom || '—')}${r.traite_par_nom ? ` · dernier traitement : ${esc(r.traite_par_nom)}` : ''}</p>` : '<p class="text-soft" style="margin:6px 0;">Rien n\'a encore été transmis.</p>'}
    ${r && r.statut === 'a_corriger' ? `<div class="alert alert-ocre"><b>Renvoyé par la ${esc(CEP_NIVEAU_LIB[r.renvoye_par_niveau] || '')} :</b> ${esc(r.motif_retour)}<div style="margin-top:6px;">Corrigez les données dans l'Espace Examen, puis retransmettez.</div></div>` : ''}
    <div class="flex gap-8 no-print" style="flex-wrap:wrap;"><button class="btn btn-accent" data-envoi="${nature}" ${r && r.statut === 'valide' && r.niveau_valide === 'ministere' ? 'disabled' : ''}>${r ? 'Retransmettre' : 'Transmettre'}</button></div></div>`;
}
function cepHtmlSuperieur(d, role, filtre) {
  const units = cepConstruireUnites(d);
  const lignes = [];
  units.forEach((u) => { [['effectifs', u.eff], ['bordereau', u.bord]].forEach(([nat, r]) => { if (r) lignes.push({ u, nat, r }); }); });
  const filtres = { tous: () => true, avalider: (l) => cepActionsPossibles(role, l.r).valider, acorriger: (l) => l.r.statut === 'a_corriger' };
  const aff = lignes.filter(filtres[filtre] || filtres.tous);
  const nbV = lignes.filter(filtres.avalider).length;
  return `<div class="table-toolbar no-print"><select id="cv-filtre" class="search-input">
      <option value="tous" ${filtre === 'tous' ? 'selected' : ''}>Tous les documents</option><option value="avalider" ${filtre === 'avalider' ? 'selected' : ''}>À valider par moi (${nbV})</option><option value="acorriger" ${filtre === 'acorriger' ? 'selected' : ''}>Renvoyés à la CEB</option></select></div>
    ${aff.length ? `<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>CEB</th><th>Document</th><th>Chiffres</th><th>Version</th><th>Statut</th><th></th></tr></thead><tbody>
    ${aff.map(({ u, nat, r }) => { const a = cepActionsPossibles(role, r);
      const chiffres = nat === 'effectifs' ? `${cepNb(r.inscrits_f) + cepNb(r.inscrits_g)} inscrits (${r.inscrits_f} F / ${r.inscrits_g} G)`
        : `${cepNb(r.f_admis) + cepNb(r.g_admis)} admis / ${cepNb(r.f_inscrits) + cepNb(r.g_inscrits) - cepNb(r.f_absents) - cepNb(r.g_absents)} présents`;
      return `<tr><td class="wrap" style="font-weight:700;">${esc(u.nom)}<div class="text-soft" style="font-size:11.5px;">${esc(u.province)}</div></td><td>${nat === 'effectifs' ? "Effectifs d'inscription" : 'Bordereau de résultats'}</td><td>${esc(chiffres)}</td>
        <td>v${r.version}</td><td>${cepBadgeDoc(r)}${r.statut === 'a_corriger' ? `<div class="text-soft" style="font-size:11.5px;">${esc(r.motif_retour)}</div>` : ''}</td>
        <td class="no-print"><div class="flex gap-8" style="flex-wrap:wrap;">${a.valider ? `<button class="btn btn-sm btn-accent" data-valider="${nat}:${r.id}">Valider</button>` : ''}${a.renvoyer ? `<button class="btn btn-sm" data-renvoyer="${nat}:${r.id}">Renvoyer</button>` : ''}</div></td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty-state"><div class="big">✓</div>Aucun document dans cette liste.</div>'}`;
}
function cepHtmlJournal(lignes) {
  return lignes.length ? `<div class="table-wrap"><table class="table" style="font-size:12px;"><thead><tr><th>Quand</th><th>Qui</th><th>Quoi</th><th>Zone</th><th>Motif</th></tr></thead><tbody>
    ${lignes.map((j) => `<tr><td>${esc(formatDate(String(j.le).slice(0, 10)))} ${esc(String(j.le).slice(11, 16))}</td><td class="wrap">${esc(j.acteur_nom)}<div class="text-soft" style="font-size:11px;">${esc(CEP_NIVEAU_LIB[j.acteur_role] || j.acteur_role)}</div></td>
      <td class="wrap">${esc(CEP_ACTIONS_LIB[j.action] || j.action)} (${esc(CEP_DOC_LIB[j.cible] || j.cible)}${j.version ? ' v' + j.version : ''})</td><td class="wrap">${esc([j.province, j.ceb].filter(Boolean).join(' / ')) || '—'}</td><td class="wrap">${esc(j.motif || '')}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="text-soft">Aucune opération enregistrée.</p>';
}

/* ---------- Page ---------- */
ROUTES['#/cep-validation'] = async (root) => {
  const niveau = cepNiveauCompte();
  if (!niveau) { root.innerHTML = '<div class="alert alert-terre">Cette page est réservée aux comptes du réseau.</div>'; return; }
  const supa = window.supaClient;
  const file = await cepFileEnAttente().catch(() => []);
  let annees = [];
  try { annees = await cepAnneesConnues(); } catch (e) { /* hors ligne */ }
  const sessions = niveau === 'ceb' ? (await DB.getAll('examSessions')).filter((s) => s.type !== 'blanc') : [];
  if (niveau === 'ceb' && sessions.length && !sessions.some((s) => s.annee === CEP_ETAT.annee && s.type === CEP_ETAT.type)) { CEP_ETAT.annee = sessions[0].annee; CEP_ETAT.type = sessions[0].type; }
  if (!CEP_ETAT.annee) CEP_ETAT.annee = annees[0] || (typeof anneeScolaireCourante === 'function' ? anneeScolaireCourante() : '');
  if (!annees.includes(CEP_ETAT.annee)) annees.unshift(CEP_ETAT.annee);
  let d;
  try { d = await cepChargerDonnees(CEP_ETAT.annee, CEP_ETAT.type); }
  catch (e) { root.innerHTML = `${cepBandeauFile(file.length, file.filter((x) => x.erreur).length)}<div class="alert alert-terre">${esc(e.horsLigne ? 'Connexion internet nécessaire pour voir les statuts. Vos envois en attente partiront dès le retour du réseau.' : e.message)}</div>`; cepBrancherFile(root); return; }
  const jr = await cepLireTout(() => supa.from('cep_journal').select('*').eq('annee', CEP_ETAT.annee).order('le', { ascending: false })).catch(() => []);
  const entete = `${cepBandeauFile(file.length, file.filter((x) => x.erreur).length)}
    <div class="table-toolbar no-print"><div style="flex:1;font-weight:800;font-size:16px;">Remontées et validation — ${esc(CEP_NIVEAU_LIB[niveau])}</div>
      <select id="cv-annee" class="search-input">${annees.map((a) => `<option ${a === CEP_ETAT.annee ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <button class="btn btn-sm" id="cv-actu">Actualiser</button></div>`;
  let corps;
  if (niveau === 'ceb') {
    const u = cepConstruireUnites(d)[0] || { eff: null, bord: null };
    const sess = sessions.find((s) => s.annee === CEP_ETAT.annee && s.type === CEP_ETAT.type);
    corps = `${sess ? '' : '<div class="alert alert-ocre">Aucune session CEP pour cette année dans votre Espace Examen.</div>'}
      ${cepHtmlSuiviDoc("Effectifs d'inscription", u.eff, 'effectifs')}${cepHtmlSuiviDoc('Bordereau de résultats', u.bord, 'bordereau')}
      <p class="text-soft" style="font-size:12.5px;">Sans connexion, vous pouvez aussi envoyer un fichier .json à la DPEPPNF depuis l'Espace Examen (solution de secours).</p>`;
  } else corps = cepHtmlSuperieur(d, niveau, CEP_ETAT.filtre);
  root.innerHTML = `${entete}${corps}<h3 style="margin:18px 0 8px;">Journal des opérations</h3>${cepHtmlJournal(jr.slice(0, 80))}`;
  $('#cv-annee', root).onchange = (e) => { CEP_ETAT.annee = e.target.value; onRouteChange(); };
  $('#cv-actu', root).onclick = () => onRouteChange();
  cepBrancherFile(root);
  if ($('#cv-filtre', root)) $('#cv-filtre', root).onchange = (e) => { CEP_ETAT.filtre = e.target.value; onRouteChange(); };
  $all('[data-envoi]', root).forEach((b) => {
    b.onclick = async () => {
      const sess = sessions.find((s) => s.annee === CEP_ETAT.annee && s.type === CEP_ETAT.type);
      if (!sess) { toast("Aucune session CEP pour cette année dans l'Espace Examen."); return; }
      const ctx = await exChargerCtx(sess);
      const ok = b.dataset.envoi === 'effectifs' ? await cepTransmettreEffectifs(ctx) : await cepTransmettreBordereau(ctx, exCalculerResultats(sess, ctx.candidats, ctx.notes));
      if (ok) onRouteChange();
    };
  });
  $all('[data-valider]', root).forEach((b) => {
    b.onclick = async () => {
      const [nat, id] = b.dataset.valider.split(':');
      if (!(await confirmDialog('Valider ce document ? Le niveau suivant pourra ensuite le valider à son tour.'))) return;
      try { await cepRpc('cep_valider', { p_nature: nat, p_id: id }); toast('Document validé.'); onRouteChange(); } catch (e) { toast(e.horsLigne ? 'Connexion internet nécessaire.' : e.message); }
    };
  });
  $all('[data-renvoyer]', root).forEach((b) => {
    b.onclick = () => {
      const [nat, id] = b.dataset.renvoyer.split(':');
      openModal('Renvoyer pour correction', `<div class="field"><label>Motif du renvoi *</label><textarea id="cv-motif" style="min-height:90px;" placeholder="Ex : le nombre d'inscrits ne correspond pas aux listes des écoles"></textarea><small>La CEB verra ce motif, corrigera et retransmettra.</small></div>`, {
        saveLabel: 'Renvoyer à la CEB',
        onSave: async (o) => {
          const motif = $('#cv-motif', o).value.trim();
          if (motif.length < 5) { toast('Indiquez le motif du renvoi.'); return false; }
          try { await cepRpc('cep_renvoyer', { p_nature: nat, p_id: id, p_motif: motif }); toast('Document renvoyé à la CEB.'); onRouteChange(); return true; }
          catch (e) { toast(e.horsLigne ? 'Connexion internet nécessaire.' : e.message); return false; }
        }
      });
    };
  });
};
