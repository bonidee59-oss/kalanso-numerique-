/* ============================================================
   app-matricules-cep.js — Matricules des candidats au CEP (version 53)

   Circuit : l'école publie ses candidats → la CEB valide → la liste « monte » (DPEPPNF, DREPPNF, ministère) →
   le MINISTÈRE génère un numéro matricule unique par candidat puis le PUBLIE → chaque liste, avec ses matricules,
   redescend vers la DREPPNF, la DPEPPNF, la CEB et l'école concernées (chacun ne voit que sa zone).
   Données : tables cep_matricules / cep_matricule_series et fonctions cep_matricules_* (voir sql/supabase-matricules-cep.sql).
   ============================================================ */

const MC_ETAT = { annee: '', q: '' };
const MC_LIBELLES = { ministere: 'Ministère', dreppnf: 'DREPPNF', dpeppnf: 'DPEPPNF', ceb: 'CEB', directeur: 'École', directeur_adjoint: 'École', secretaire: 'École' };
const mcNorm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mcFinAnnee = (annee) => (String(annee || '').match(/(\d{4})\D*$/) || [])[1] || String(new Date().getFullYear());
const mcPrefixeDefaut = (annee) => 'CEP-' + mcFinAnnee(annee) + '-';
const mcExemple = (prefixe, largeur, n) => String(prefixe || '') + String(n).padStart(largeur || 6, '0');
const mcNum = (v) => Number(v) || 0;
function mcMsg(e) {
  const m = String((e && e.message) || e || '');
  if (e && e.horsLigne) return 'Pas de connexion internet.';
  if (/does not exist|schema cache|cep_matricules|Could not find the function/i.test(m)) return 'Fonction non installée : exécutez supabase-matricules-cep.sql dans Supabase.';
  if (/Réservé au ministère/i.test(m)) return 'Cette action est réservée au compte du ministère.';
  return m || 'Erreur.';
}

/* Pure : synthèse de l'état de la remontée à partir de la réponse du serveur (cep_matricules_etat). */
function mcSynthese(etat) {
  const t = { listes: 0, validees: 0, aCorriger: 0, candidats: 0, candidatsValides: 0, numerotes: 0, publies: 0, ecolesReseau: 0 };
  ((etat && etat.regions) || []).forEach((r) => {
    t.listes += mcNum(r.listes); t.validees += mcNum(r.validees); t.aCorriger += mcNum(r.a_corriger);
    t.candidats += mcNum(r.candidats); t.candidatsValides += mcNum(r.candidats_valides);
    t.numerotes += mcNum(r.numerotes); t.publies += mcNum(r.publies); t.ecolesReseau += mcNum(r.ecoles_reseau);
  });
  t.enAttenteCEB = t.listes - t.validees;                       // listes publiées par les écoles, pas encore validées par la CEB
  t.ecolesSansListe = Math.max(0, t.ecolesReseau - t.listes);    // écoles du réseau qui n'ont rien publié
  t.resteANumeroter = Math.max(0, t.candidatsValides - t.numerotes);
  t.toutRemonte = t.listes > 0 && t.enAttenteCEB === 0 && t.aCorriger === 0;
  t.dejaNumerote = t.numerotes > 0;
  t.toutNumerote = t.candidatsValides > 0 && t.resteANumeroter === 0;
  t.toutPublie = t.numerotes > 0 && t.publies >= t.numerotes;
  return t;
}
/* Pure : candidats d'une liste avec leur matricule (tableaux alignés dans le même ordre). */
function mcLignes(data, matricules) {
  return (data || []).map((c, i) => ({ ...c, matriculeCEP: (matricules || [])[i] || '' }));
}
function mcPlage(matricules) {
  const m = (matricules || []).filter(Boolean).slice().sort();
  return m.length ? (m.length === 1 ? m[0] : m[0] + ' → ' + m[m.length - 1]) : '—';
}
/* Clé d'identification d'un candidat côté appareil (identique à celle du serveur : uuid de l'élève, sinon nom + prénom + naissance). */
const mcCle = (c) => c.eleveUuid || (mcNorm(c.nom) + '|' + mcNorm(c.prenom) + '|' + (c.dateNaissance || ''));
/* Pure : à partir de lignes {…, matriculeCEP}, associe chaque enregistrement local à son matricule. */
function mcAppariement(lignes, locaux, cleLocal) {
  const parCle = new Map();
  lignes.forEach((l) => { if (l.matriculeCEP) parCle.set(mcCle(l), l.matriculeCEP); });
  const res = [];
  locaux.forEach((r) => { const m = parCle.get(cleLocal(r)); if (m && r.matriculeCEP !== m) res.push({ rec: r, matricule: m }); });
  return res;
}
const mcEntetesCSV = (avecZone) => [
  ...(avecZone ? [{ label: 'Région', value: '_region' }, { label: 'Province', value: '_province' }, { label: 'CEB', value: '_ceb' }] : []),
  { label: 'École', value: '_ecole' }, { label: 'Matricule CEP', value: 'matriculeCEP' },
  { label: 'Nom', value: 'nom' }, { label: 'Prénom(s)', value: 'prenom' }, { label: 'Sexe', value: 'sexe' },
  { label: 'Date de naissance', value: (r) => (r.dateNaissance ? formatDate(r.dateNaissance) : '') }, { label: 'Lieu de naissance', value: 'lieuNaissance' },
  { label: 'Classe', value: 'classe' }, { label: 'Examen', value: 'examens' }, { label: 'Matricule école', value: 'matricule' }
];
const mcNomFichier = (s) => mcNorm(s).replace(/\s+/g, '-').slice(0, 40) || 'liste';

/* ---------------- Lecture des listes avec matricules (par paquets) ---------------- */
async function mcChargerListes(ids, onProgres) {
  const supa = window.supaClient, out = [];
  for (let i = 0; i < ids.length; i += 25) {
    const { data, error } = await supa.from('listes_eleves').select('id,ecole_nom,version,region,province,ceb,data').in('id', ids.slice(i, i + 25));
    if (error) throw error;
    out.push(...(data || []));
    if (onProgres) onProgres(Math.min(ids.length, i + 25), ids.length);
  }
  return out;
}
async function mcLignesDe(lignesMat, onProgres) {
  const listes = await mcChargerListes(lignesMat.map((m) => m.liste_id), onProgres);
  const parId = new Map(listes.map((l) => [l.id, l]));
  const res = [];
  lignesMat.forEach((m) => {
    const l = parId.get(m.liste_id); if (!l) return;
    mcLignes(l.data, m.matricules).forEach((c) => res.push({ ...c, _ecole: m.ecole_nom || l.ecole_nom, _region: m.region, _province: m.province, _ceb: m.ceb }));
  });
  return res;
}
async function mcExporter(lignesMat, nomFichier, avecZone) {
  if (!lignesMat.length) { toast('Rien à exporter.'); return; }
  toast('Préparation du fichier…');
  try {
    const lignes = await mcLignesDe(lignesMat, (n, t) => { if (t > 50 && n % 100 === 0) toast(`Chargement ${n}/${t} listes…`); });
    lignes.sort((a, b) => String(a._region).localeCompare(String(b._region), 'fr') || String(a._province).localeCompare(String(b._province), 'fr') || String(a._ceb).localeCompare(String(b._ceb), 'fr', { numeric: true })
      || String(a._ecole).localeCompare(String(b._ecole), 'fr', { numeric: true }) || String(a.matriculeCEP).localeCompare(String(b.matriculeCEP)));
    download(nomFichier + '.csv', toCSV(lignes, mcEntetesCSV(avecZone)), 'text/csv;charset=utf-8');
    toast(`${lignes.length} candidat(s) exporté(s).`);
  } catch (e) { toast(mcMsg(e)); }
}

/* ============================================================
   MINISTÈRE : état de la remontée, génération, publication
   ============================================================ */
async function mcMinistere(root) {
  const supa = window.supaClient;
  if (!supa) { root.innerHTML = '<div class="alert alert-terre">Pas de connexion internet.</div>'; return; }
  let annees = [];
  try { annees = (await cepRpc('cep_matricules_annees')) || []; } catch (e) { root.innerHTML = `<div class="alert alert-terre">${esc(mcMsg(e))}</div>`; return; }
  const courante = (typeof anneeScolaireCourante === 'function') ? anneeScolaireCourante() : '';
  if (!MC_ETAT.annee || (annees.length && !annees.includes(MC_ETAT.annee))) MC_ETAT.annee = annees[0] || courante;
  let etat;
  try { etat = await cepRpc('cep_matricules_etat', { p_annee: MC_ETAT.annee }); } catch (e) { root.innerHTML = `<div class="alert alert-terre">${esc(mcMsg(e))}</div>`; return; }
  const t = mcSynthese(etat), serie = etat.serie;
  const ph = serie ? serie.prefixe : mcPrefixeDefaut(MC_ETAT.annee), lg = serie ? serie.largeur : 6, deb = serie ? serie.prochain : 1;
  const tuile = (label, val, sub) => `<div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">${label}</div><div class="value">${val}</div>${sub ? `<div class="text-soft" style="font-size:12px;">${sub}</div>` : ''}</div>`;
  const etape = (ok, titre, detail) => `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);"><span style="font-size:18px;">${ok ? '✅' : '⏳'}</span><div><b>${titre}</b><div class="text-soft" style="font-size:12.5px;">${detail}</div></div></div>`;
  const aOuvrir = annees.length ? annees : [MC_ETAT.annee];
  root.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
      <h2 style="margin:0;flex:1;min-width:220px;">Matricules des candidats au CEP</h2>
      <select id="mc-annee">${aOuvrir.map((a) => `<option ${a === MC_ETAT.annee ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <button class="btn btn-sm" id="mc-actu">Actualiser</button>
    </div>
    <div class="alert ${t.toutRemonte ? 'alert-vert' : 'alert-terre'}" style="margin-bottom:12px;">
      ${t.listes === 0 ? 'Aucune école n’a encore publié ses candidats pour cette année.'
        : t.toutRemonte ? `<b>Tous les candidats sont remontés</b> : ${t.validees} liste(s) validée(s) par les CEB, ${t.candidatsValides} candidat(s).${t.ecolesSansListe ? ` Attention : ${t.ecolesSansListe} école(s) du réseau n’ont publié aucune liste.` : ''}`
        : `<b>Remontée incomplète</b> : ${t.enAttenteCEB} liste(s) en attente de validation par la CEB${t.aCorriger ? ` (dont ${t.aCorriger} à corriger)` : ''}. Seules les listes validées peuvent être numérotées.`}
    </div>
    <div class="stats-grid" style="margin-bottom:12px;">
      ${tuile('Listes publiées', t.listes, `${t.validees} validée(s)`)}
      ${tuile('Candidats validés', t.candidatsValides, `sur ${t.candidats}`)}
      ${tuile('Numérotés', t.numerotes, t.resteANumeroter ? `${t.resteANumeroter} à numéroter` : 'tous')}
      ${tuile('Publiés (redescendus)', t.publies, t.numerotes ? `sur ${t.numerotes}` : '')}
    </div>
    <div class="card" style="padding:12px;margin-bottom:12px;">
      <h3 style="margin:0 0 6px;">1. Générer les numéros matricules</h3>
      <p class="text-soft" style="font-size:12.5px;margin:0 0 8px;">Un numéro unique par candidat, continu, ordonné par région → province → CEB → école. Un candidat déjà numéroté (liste corrigée puis republiée) garde son numéro.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="field"><label>Préfixe</label><input id="mc-pref" value="${esc(ph)}" maxlength="16" ${serie ? 'disabled' : ''}></div>
        <div class="field"><label>Chiffres</label><select id="mc-larg" ${serie ? 'disabled' : ''}>${[4, 5, 6, 7, 8, 9].map((n) => `<option ${n === lg ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Premier numéro</label><input id="mc-debut" type="number" min="1" value="${deb}" ${serie ? 'disabled' : ''}></div>
        <div class="field"><label>Exemple</label><div id="mc-ex" style="padding:8px 0;font-weight:700;font-family:monospace;">${esc(mcExemple(ph, lg, deb))}</div></div>
      </div>
      ${serie ? '<p class="text-soft" style="font-size:12px;margin:4px 0;">Format fixé pour cette année : il ne peut plus changer.</p>' : ''}
      <button class="btn btn-primary" id="mc-gen" ${t.validees === 0 || t.toutNumerote ? 'disabled' : ''}>${t.dejaNumerote ? 'Numéroter les listes restantes' : 'Générer les matricules'}</button>
    </div>
    <div class="card" style="padding:12px;margin-bottom:12px;">
      <h3 style="margin:0 0 6px;">2. Renvoyer les listes avec matricules</h3>
      <p class="text-soft" style="font-size:12.5px;margin:0 0 8px;">Publie chaque liste, avec ses matricules, vers l’école, la CEB, la DPEPPNF et la DREPPNF concernées. Un message est aussi publié dans « Documents ». Avant la publication, rien n’est visible en bas.</p>
      <button class="btn btn-primary" id="mc-pub" ${t.numerotes === 0 || t.toutPublie ? 'disabled' : ''}>Publier aux DREPPNF, DPEPPNF, CEB et écoles</button>
      <button class="btn" id="mc-exp-tout" ${t.numerotes === 0 ? 'disabled' : ''}>Exporter tout (CSV)</button>
    </div>
    <div class="card" style="padding:12px;margin-bottom:12px;">
      <h3 style="margin:0 0 4px;">Avancement</h3>
      ${etape(t.listes > 0, 'Listes publiées par les écoles', `${t.listes} liste(s)${t.ecolesReseau ? ` sur ${t.ecolesReseau} école(s) du réseau` : ''}`)}
      ${etape(t.toutRemonte, 'Validation par les CEB (montée au ministère)', `${t.validees} validée(s), ${t.enAttenteCEB} en attente`)}
      ${etape(t.toutNumerote, 'Matricules générés', `${t.numerotes} candidat(s) numéroté(s)`)}
      ${etape(t.toutPublie, 'Listes renvoyées aux niveaux', `${t.publies} candidat(s) publiés`)}
    </div>
    <div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Région</th><th>Écoles</th><th>Listes</th><th>Validées</th><th>Candidats validés</th><th>Numérotés</th><th>Publiés</th><th></th></tr></thead><tbody>
      ${(etat.regions || []).map((r) => `<tr><td class="wrap" style="font-weight:700;">${esc(r.region)}</td><td>${mcNum(r.ecoles_reseau) || '—'}</td><td>${r.listes}</td><td>${r.validees}</td><td>${r.candidats_valides}</td><td>${r.numerotes}</td><td>${r.publies}</td><td><button class="btn btn-sm" data-exp="${esc(r.region)}" ${mcNum(r.numerotes) ? '' : 'disabled'}>CSV</button></td></tr>`).join('') || '<tr><td colspan="8" class="text-soft">Aucune donnée.</td></tr>'}
    </tbody></table></div>`;
  const refaire = () => onRouteChange();
  $('#mc-annee', root).onchange = (e) => { MC_ETAT.annee = e.target.value; refaire(); };
  $('#mc-actu', root).onclick = refaire;
  const maj = () => { const p = $('#mc-pref', root), l = $('#mc-larg', root), d = $('#mc-debut', root); if (p && !p.disabled) $('#mc-ex', root).textContent = mcExemple(p.value, Number(l.value), Number(d.value) || 1); };
  ['#mc-pref', '#mc-larg', '#mc-debut'].forEach((s) => { const el = $(s, root); if (el) el.oninput = maj; });

  $('#mc-gen', root).onclick = async () => {
    const pref = ($('#mc-pref', root).value || '').trim(), larg = Number($('#mc-larg', root).value), debut = Number($('#mc-debut', root).value) || 1;
    if (!serie && !/^[A-Za-z0-9-]{0,16}$/.test(pref)) { toast('Préfixe : lettres, chiffres et tirets seulement (16 caractères au plus).'); return; }
    const avert = t.enAttenteCEB ? `\n\n⚠ ${t.enAttenteCEB} liste(s) ne sont pas encore validées par les CEB : elles ne seront pas numérotées maintenant (vous pourrez compléter plus tard, les numéros déjà donnés ne changent jamais).` : '';
    if (!(await confirmDialog(`Générer les matricules de ${t.resteANumeroter} candidat(s) pour ${MC_ETAT.annee} ?${serie ? '' : `\nFormat : ${mcExemple(pref, larg, debut)} …\nAttention : le format ne pourra plus être changé.`}${avert}`))) return;
    const btn = $('#mc-gen', root); btn.disabled = true;
    try {
      let tot = { listes: 0, candidats: 0 }, r;
      do {
        r = await cepRpc('cep_matricules_generer', { p_annee: MC_ETAT.annee, p_prefixe: pref, p_largeur: larg, p_debut: debut, p_max: 150 });
        tot.listes += r.listes; tot.candidats += r.candidats;
        btn.textContent = `Numérotation… ${tot.candidats} candidat(s), reste ${r.reste} liste(s)`;
      } while (r.reste > 0 && r.listes > 0);
      toast(`${tot.candidats} candidat(s) numéroté(s) dans ${tot.listes} liste(s).`);
    } catch (e) { toast(mcMsg(e)); }
    refaire();
  };
  $('#mc-pub', root).onclick = async () => {
    const avert = t.resteANumeroter ? `\n\n⚠ ${t.resteANumeroter} candidat(s) validés ne sont pas encore numérotés : ils ne seront pas inclus.` : '';
    if (!(await confirmDialog(`Publier les listes avec matricules (${t.numerotes} candidat(s)) aux DREPPNF, DPEPPNF, CEB et écoles ?${avert}`))) return;
    const btn = $('#mc-pub', root); btn.disabled = true;
    try {
      const r = await cepRpc('cep_matricules_publier', { p_annee: MC_ETAT.annee });
      toast(`${r.publiees} liste(s) publiée(s) (${r.candidats} candidat(s)).`);
      const { error } = await supa.from('circuit_documents').insert({
        niveau: 'ministere', emetteur_id: currentUser.id, emetteur_nom: currentUser.nom, structure: currentUser.structure || null,
        region: null, province: null, ceb: null, cibles: ['dreppnf', 'dpeppnf', 'ceb', 'ecole'], categorie: 'Liste / état de situation',
        objet: `Matricules des candidats au CEP ${MC_ETAT.annee} : listes disponibles`,
        contenu: `Les numéros matricules des candidats au CEP ${MC_ETAT.annee} ont été générés par le ministère. Ouvrez « Matricules des candidats » dans le menu pour consulter, exporter ou imprimer les listes de votre zone.`
      });
      if (error) toast('Les listes sont publiées, mais le message d’information n’a pas pu être envoyé.');
    } catch (e) { toast(mcMsg(e)); }
    refaire();
  };
  const chargerMat = async (region) => {
    let q = supa.from('cep_matricules').select('liste_id,ecole_nom,region,province,ceb,matricules').eq('annee', MC_ETAT.annee);
    if (region) q = q.eq('region', region);
    return cepLireTout(() => q.order('liste_id'));
  };
  $('#mc-exp-tout', root).onclick = async () => { try { await mcExporter(await chargerMat(null), `matricules-CEP-${mcNomFichier(MC_ETAT.annee)}`, true); } catch (e) { toast(mcMsg(e)); } };
  $all('[data-exp]', root).forEach((b) => { b.onclick = async () => { try { await mcExporter(await chargerMat(b.dataset.exp), `matricules-CEP-${mcNomFichier(MC_ETAT.annee)}-${mcNomFichier(b.dataset.exp)}`, true); } catch (e) { toast(mcMsg(e)); } }; });
}

/* ============================================================
   DREPPNF / DPEPPNF / CEB / ÉCOLE : listes avec matricules reçues du ministère
   ============================================================ */
async function mcRecus(root) {
  const supa = window.supaClient, role = currentUser.role, niveau = MC_LIBELLES[role] || '';
  if (!supa) { root.innerHTML = '<div class="alert alert-terre">Pas de connexion internet.</div>'; return; }
  let rows;
  try { rows = await cepLireTout(() => supa.from('cep_matricules').select('liste_id,annee,ecole_id,ecole_nom,region,province,ceb,nb_candidats,matricules').order('region').order('province').order('ceb').order('ecole_nom')); }
  catch (e) { root.innerHTML = `<div class="alert alert-terre">${esc(mcMsg(e))}</div>`; return; }
  const annees = [...new Set(rows.map((r) => r.annee))].sort().reverse();
  if (!MC_ETAT.annee || (annees.length && !annees.includes(MC_ETAT.annee))) MC_ETAT.annee = annees[0] || '';
  const ecole = ['directeur', 'directeur_adjoint', 'secretaire'].includes(role), ceb = role === 'ceb';
  const dessiner = () => {
    const q = mcNorm(MC_ETAT.q);
    const liste = rows.filter((r) => r.annee === MC_ETAT.annee && (!q || mcNorm(r.ecole_nom + ' ' + r.ceb + ' ' + r.province + ' ' + r.matricules.join(' ')).includes(q)));
    const total = liste.reduce((s, r) => s + r.nb_candidats, 0);
    root.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
        <h2 style="margin:0;flex:1;min-width:220px;">Matricules des candidats au CEP</h2>
        ${annees.length ? `<select id="mc-annee">${annees.map((a) => `<option ${a === MC_ETAT.annee ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : ''}
        <button class="btn btn-sm" id="mc-actu">Actualiser</button>
      </div>
      ${!rows.length ? `<div class="alert alert-terre">Le ministère n’a pas encore renvoyé les listes avec matricules. Elles apparaîtront ici dès leur publication${ceb || ecole ? ' (après validation des listes par la CEB)' : ''}.</div>` : `
      <div class="card" style="padding:12px;margin-bottom:10px;">
        <b>${total} candidat(s)</b> dans ${liste.length} liste(s) · ${esc(MC_ETAT.annee)}
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
          <input id="mc-q" placeholder="Rechercher (école, CEB, matricule)" value="${esc(MC_ETAT.q)}" style="flex:1;min-width:180px;">
          <button class="btn" id="mc-exp" ${liste.length ? '' : 'disabled'}>Exporter (CSV)</button>
          ${ceb ? '<button class="btn" id="mc-appliquer">Appliquer à l’Espace Examen</button>' : ''}
          ${ecole ? '<button class="btn" id="mc-appliquer">Appliquer à mes élèves</button>' : ''}
        </div>
      </div>
      <div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr>${ecole ? '' : '<th>CEB</th>'}<th>École</th><th>Candidats</th><th>Matricules</th><th></th></tr></thead><tbody>
        ${liste.map((r) => `<tr>${ecole ? '' : `<td class="wrap">${esc(r.ceb)}<div class="text-soft" style="font-size:11px;">${esc(r.province)}</div></td>`}<td class="wrap" style="font-weight:700;">${esc(r.ecole_nom)}</td><td>${r.nb_candidats}</td><td class="wrap" style="font-family:monospace;font-size:11.5px;">${esc(mcPlage(r.matricules))}</td><td><button class="btn btn-sm" data-voir="${esc(r.liste_id)}">Voir</button></td></tr>`).join('') || '<tr><td colspan="5" class="text-soft">Aucune liste.</td></tr>'}
      </tbody></table></div>`}`;
    $('#mc-actu', root).onclick = () => onRouteChange();
    if ($('#mc-annee', root)) $('#mc-annee', root).onchange = (e) => { MC_ETAT.annee = e.target.value; dessiner(); };
    const qEl = $('#mc-q', root); if (qEl) qEl.oninput = () => { MC_ETAT.q = qEl.value; dessiner(); const n = $('#mc-q', root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    if ($('#mc-exp', root)) $('#mc-exp', root).onclick = () => mcExporter(liste, `matricules-CEP-${mcNomFichier(MC_ETAT.annee)}-${mcNomFichier(currentUser.ceb || currentUser.province || currentUser.region || currentUser.structure || 'liste')}`, !ecole);
    $all('[data-voir]', root).forEach((b) => { b.onclick = () => mcVoir(rows.find((r) => r.liste_id === b.dataset.voir)); });
    if ($('#mc-appliquer', root)) $('#mc-appliquer', root).onclick = () => mcAppliquerLocal(liste, ceb ? 'ceb' : 'ecole');
  };
  dessiner();
}
async function mcVoir(r) {
  let lignes;
  try { lignes = (await mcLignesDe([r])).sort((a, b) => String(a.matriculeCEP).localeCompare(String(b.matriculeCEP))); } catch (e) { toast(mcMsg(e)); return; }
  openModal(`${r.ecole_nom} — ${lignes.length} candidat(s)`, `
    <div class="table-wrap" style="max-height:60vh;overflow:auto;"><table class="table" style="font-size:12.5px;"><thead><tr><th>Matricule CEP</th><th>Nom et prénom(s)</th><th>Sexe</th><th>Né(e) le</th></tr></thead><tbody>
      ${lignes.map((l) => `<tr><td style="font-family:monospace;font-weight:700;">${esc(l.matriculeCEP)}</td><td class="wrap">${esc(l.nom)} ${esc(l.prenom || '')}</td><td>${esc(l.sexe || '')}</td><td>${l.dateNaissance ? esc(formatDate(l.dateNaissance)) : ''}</td></tr>`).join('')}
    </tbody></table></div>`, { wide: true, saveLabel: 'Fermer', onSave: async () => true });
}
/* Reporte les matricules dans les données de l'appareil : candidats de l'Espace Examen (CEB) ou élèves (école). */
async function mcAppliquerLocal(liste, mode) {
  if (!(await confirmDialog(`Enregistrer le matricule CEP sur ${mode === 'ceb' ? 'les candidats de l’Espace Examen' : 'les fiches des élèves'} de cet appareil ?`))) return;
  try {
    const lignes = (await mcLignesDe(liste)).filter((l) => l.matriculeCEP);
    const store = mode === 'ceb' ? 'examCandidats' : 'eleves';
    const locaux = await DB.getAll(store);
    const paires = mcAppariement(lignes, locaux, (r) => (r.eleveUuid && mode === 'ceb') ? r.eleveUuid : (mode === 'ecole' && r._uuid ? r._uuid : mcCle(r)));
    for (const p of paires) await DB.put(store, { ...p.rec, matriculeCEP: p.matricule });
    toast(`${paires.length} fiche(s) mise(s) à jour sur ${lignes.length} candidat(s) de la liste.`);
  } catch (e) { toast(mcMsg(e)); }
}

ROUTES['#/matricules-cep'] = async (root) => {
  if (!currentUser || !MC_LIBELLES[currentUser.role]) { root.innerHTML = '<div class="alert alert-terre">Cette page est réservée à l’école, à la CEB, à la DPEPPNF, à la DREPPNF et au ministère.</div>'; return; }
  root.innerHTML = '<p class="text-soft">Chargement…</p>';
  if (currentUser.role === 'ministere') await mcMinistere(root); else await mcRecus(root);
};
