/* ============================================================
   app-cep-tableaux.js — Tableau de bord du CEP en direct
   ------------------------------------------------------------
   DPEPPNF, DREPPNF, ministère (et la CEB pour sa propre zone) voient
   les données remontées par le serveur : inscrits (filles/garçons),
   centres, jurys, CEB ayant transmis, anomalies, centres à risque.
   Chaque niveau ne voit que SA zone (règles RLS) ; le ministère voit tout.
   Les zones sans donnée sont signalées clairement.
   ============================================================ */

function cepNiveauCompte() { return currentUser && ['ceb', 'dpeppnf', 'dreppnf', 'ministere'].includes(currentUser.role) ? currentUser.role : null; }

function cepNoeudCourant(racines, chemin) {
  let liste = racines, noeud = null;
  for (const k of chemin || []) { const n = liste.find((x) => x.cle === k); if (!n) break; noeud = n; liste = n.enfants; }
  return { noeud, liste };
}
const cepLibUnite = { ministere: 'Région', dreppnf: 'Province', dpeppnf: 'CEB', ceb: 'CEB' };
function cepBadgeDonnee(n) {
  if (n.sansDonnee) return '<span class="badge badge-terre">Aucune donnée</span>';
  const a = n.agg;
  if (n.niveau === 'ceb') return a.bordTransmis ? '<span class="badge badge-vert">Résultats transmis</span>' : '<span class="badge badge-indigo">Effectifs transmis</span>';
  return a.sansDonnee ? `<span class="badge badge-ocre">${a.sansDonnee} sans donnée</span>` : '<span class="badge badge-vert">Complet</span>';
}

/* HTML du tableau de bord (fonction pure : testable) */
function cepHtmlTableau(d, niveau, chemin, aujourdhui) {
  const units = cepConstruireUnites(d);
  const racines = cepConstruireArbre(units, d.structures, niveau);
  const { noeud, liste } = cepNoeudCourant(racines, chemin);
  const portee = noeud ? noeud.unites : units;
  const agg = cepAgreger(portee);
  const anomalies = cepAnomalies(units, d.calendrier, aujourdhui);
  const clesPortee = new Set(portee.map((u) => u.cle));
  const anomPortee = anomalies.filter((x) => clesPortee.has(x.cle));
  const nbAnomNoeud = (n) => anomalies.filter((x) => n.unites.some((u) => u.cle === x.cle)).length;
  const risques = (d.centresRisque || []).filter((c) => clesPortee.has(cepCleZone(c.region, c.province, c.ceb)));
  const sit = cepSituationEtapes(niveau, portee, d.calendrier, aujourdhui);
  const sansDonnee = liste.filter((n) => n.sansDonnee);
  const R = agg.res;

  const fil = noeud ? `<div class="no-print" style="margin-bottom:10px;font-size:13px;"><a href="#" data-haut="-1">Tout le périmètre</a>${(chemin || []).map((k, i) => { const nn = cepNoeudCourant(racines, chemin.slice(0, i + 1)).noeud; return ` › ${i === chemin.length - 1 ? `<b>${esc(nn ? nn.nom : k)}</b>` : `<a href="#" data-haut="${i}">${esc(nn ? nn.nom : k)}</a>`}`; }).join('')}</div>` : '';
  const carte = (cls, titre, val, pied) => `<div class="card stat-card ${cls}"><div class="accent-bar"></div><div class="label">${titre}</div><div class="value">${val}</div><div class="text-soft" style="font-size:12px;">${pied || ''}</div></div>`;
  const tr = (n) => {
    const a = n.agg, nb = nbAnomNoeud(n);
    return `<tr><td class="wrap" style="font-weight:700;">${esc(n.nom)}</td>
      <td>${n.sansDonnee ? '—' : `${a.inscrits} <span class="text-soft">(${a.inscritsF} F / ${a.inscritsG} G)</span>`}</td>
      <td>${n.sansDonnee ? '—' : a.centres}</td><td>${n.sansDonnee ? '—' : a.jurys}</td>
      <td>${n.niveau === 'ceb' ? (a.effTransmis ? 'Oui' : 'Non') : `${a.effTransmis} / ${a.nbCeb}`}</td>
      <td>${n.niveau === 'ceb' ? (a.bordTransmis ? 'Oui' : 'Non') : `${a.bordTransmis} / ${a.nbCeb}`}</td>
      <td>${a.centres ? `${a.centresComplets} / ${a.centres}` : '—'}</td>
      <td>${nb ? `<span class="badge badge-terre">${nb}</span>` : '0'}${a.aRisque ? ` <span class="badge badge-ocre">${a.aRisque} à risque</span>` : ''}</td>
      <td>${cepBadgeDonnee(n)}</td>
      <td class="no-print">${n.enfants.length ? `<button class="btn btn-sm" data-voir="${esc(n.cle)}">Voir le détail</button>` : ''}</td></tr>`;
  };
  const tableau = (niveau === 'ceb' && !noeud) || (noeud && !liste.length) ? '' : (liste.length ? `<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr>
      <th>${esc(liste[0] ? ({ region: 'Région', province: 'Province', ceb: 'CEB' }[liste[0].niveau]) : cepLibUnite[niveau])}</th><th>Inscrits</th><th>Centres</th><th>Jurys</th><th>Effectifs transmis</th><th>Résultats transmis</th><th>Jour J (centres complets)</th><th>Anomalies</th><th>État</th><th></th></tr></thead>
      <tbody>${liste.map(tr).join('')}</tbody></table></div>` : `<div class="empty-state"><div class="big">∅</div>Aucune structure connue dans votre zone pour le moment.</div>`);
  const ech = sit.map((s) => `<tr><td style="font-weight:700;">${esc(s.etape.label)}</td><td>${s.echeance ? esc(formatDate(s.echeance.date_limite)) : '—'}</td>
      <td>${s.total ? `${s.faits} / ${s.total}` : '—'}</td>
      <td><span class="badge badge-${{ fait: 'vert', retard: 'terre', bientot: 'ocre', a_venir: 'indigo', pas_commence: 'indigo', sans_date: 'indigo' }[s.etat]}">${esc(s.texte)}</span></td></tr>`).join('');
  return `${fil}
    ${d.horsLigne ? `<div class="alert alert-ocre" style="margin-bottom:12px;">Pas de connexion : ces chiffres datent du ${esc(formatDate(String(d.charge_le).slice(0, 10)))}.</div>` : ''}
    <div class="grid grid-4" style="margin-bottom:14px;">
      ${carte('c-indigo', 'Candidats inscrits', agg.effTransmis ? agg.inscrits : '—', agg.effTransmis ? `${agg.inscritsF} filles · ${agg.inscritsG} garçons` : 'aucun effectif transmis')}
      ${carte('c-ocre', 'Centres · jurys', agg.effTransmis || agg.centres ? `${agg.centres} · ${agg.jurys}` : '—', agg.aRisque ? `<b>${agg.aRisque} centre(s) à risque</b>` : 'aucun centre à risque signalé')}
      ${carte('c-vert', 'CEB ayant transmis', `${agg.effTransmis} / ${agg.nbCeb}`, `effectifs · résultats : ${agg.bordTransmis} / ${agg.nbCeb}`)}
      ${carte(anomPortee.length ? 'c-terre' : 'c-vert', 'Anomalies', anomPortee.length, `${agg.aCorriger} document(s) à corriger`)}
    </div>
    ${sansDonnee.length ? `<div class="alert alert-ocre" style="margin-bottom:12px;"><b>${sansDonnee.length} zone(s) sans aucune donnée :</b> ${sansDonnee.slice(0, 12).map((n) => esc(n.nom)).join(', ')}${sansDonnee.length > 12 ? '…' : ''}.</div>` : ''}
    ${portee.length === 0 ? '<div class="alert alert-ocre" style="margin-bottom:12px;">Aucune CEB n\'est enregistrée dans ce périmètre. Une zone sans compte de CEB ne peut pas apparaître ici.</div>' : ''}
    ${tableau}
    <h3 style="margin:18px 0 8px;">Échéances${noeud ? ' — ' + esc(noeud.nom) : ''}</h3>
    <div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Étape</th><th>Date limite</th><th>CEB à jour</th><th>Situation</th></tr></thead><tbody>${ech}</tbody></table></div>
    <h3 style="margin:18px 0 8px;">Résultats (bordereaux transmis)</h3>
    ${R.inscrits ? `<div class="grid grid-4"><div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Taux de réussite</div><div class="value">${cepFmtPct(R.taux)}</div><div class="text-soft" style="font-size:12px;">${R.admis} admis sur ${R.presents} présents</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Filles · garçons</div><div class="value">${cepFmtPct(R.tauxF)} · ${cepFmtPct(R.tauxG)}</div></div>
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Situation de handicap</div><div class="value">${R.handicapInscrits}</div><div class="text-soft" style="font-size:12px;">${R.handicapAdmis} admis</div></div>
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Candidats bilingues</div><div class="value">${R.bilinguesInscrits}</div><div class="text-soft" style="font-size:12px;">${R.bilinguesAdmis} admis</div></div></div>`
      : '<p class="text-soft">Aucun bordereau de résultats transmis pour le moment.</p>'}
    <h3 style="margin:18px 0 8px;">Centres à risque (${risques.length})</h3>
    ${risques.length ? `<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Centre</th><th>CEB</th><th>Situation</th><th>Motif</th><th></th></tr></thead><tbody>
      ${risques.map((c) => `<tr><td class="wrap" style="font-weight:700;">${esc(c.nom)}</td><td>${esc(c.ceb)}</td><td><span class="badge badge-${CEP_RISQUES[c.statut_risque].badge}">${esc(CEP_RISQUES[c.statut_risque].label)}</span>${c.centre_accueil ? `<div class="text-soft" style="font-size:12px;">Accueil : ${esc(c.centre_accueil)}</div>` : ''}</td>
        <td class="wrap">${esc(c.motif_risque)}<div class="text-soft" style="font-size:11.5px;">${esc(c.risque_par_nom || '')}${c.risque_le ? ' · ' + esc(formatDate(String(c.risque_le).slice(0, 10))) : ''}</div></td>
        <td class="no-print"><button class="btn btn-sm" data-risque="${esc(c.id)}">Modifier</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="text-soft">Aucun centre fermé, délocalisé ou sécurisé.</p>'}
    <h3 style="margin:18px 0 8px;">Anomalies (${anomPortee.length})</h3>
    ${anomPortee.length ? `<div class="table-wrap"><table class="table" style="font-size:12.5px;"><thead><tr><th>Gravité</th><th>Zone</th><th>Anomalie</th></tr></thead><tbody>
      ${anomPortee.slice(0, 60).map((a) => `<tr><td><span class="badge badge-${a.gravite === 'haute' ? 'terre' : 'ocre'}">${a.gravite === 'haute' ? 'À traiter' : 'À vérifier'}</span></td><td class="wrap">${esc(a.zone)}</td><td class="wrap">${esc(a.texte)}</td></tr>`).join('')}</tbody></table></div>
      ${anomPortee.length > 60 ? `<p class="text-soft">… et ${anomPortee.length - 60} autre(s).</p>` : ''}` : '<p class="text-soft">Aucune anomalie détectée.</p>'}`;
}

ROUTES['#/cep-tableau'] = async (root) => {
  const niveau = cepNiveauCompte();
  if (!niveau) { root.innerHTML = '<div class="alert alert-terre">Cette page est réservée aux comptes du réseau.</div>'; return; }
  const file = await cepFileEnAttente().catch(() => []);
  let annees = [];
  try { annees = await cepAnneesConnues(); } catch (e) { /* hors ligne */ }
  if (!CEP_ETAT.annee) CEP_ETAT.annee = annees[0] || (typeof anneeScolaireCourante === 'function' ? anneeScolaireCourante() : '');
  if (!annees.includes(CEP_ETAT.annee) && CEP_ETAT.annee) annees.unshift(CEP_ETAT.annee);
  const cleCache = `tableau:${currentUser.id}:${CEP_ETAT.annee}:${CEP_ETAT.type}`;
  let d;
  try { d = await cepChargerDonnees(CEP_ETAT.annee, CEP_ETAT.type); await cepCacheEcrire(cleCache, d); }
  catch (e) {
    const c = await cepCacheLire(cleCache);
    if (c && e.horsLigne) d = { ...c.valeur, horsLigne: true };
    else { root.innerHTML = `<div class="alert alert-terre">${esc(e.message)}</div>`; return; }
  }
  const dessiner = () => {
    root.innerHTML = `${cepBandeauFile(file.length, file.filter((x) => x.erreur).length)}
      <div class="table-toolbar no-print">
        <div style="flex:1;min-width:200px;"><div style="font-weight:800;font-size:16px;">${esc(CEP_NIVEAU_LIB[niveau])}${currentUser.structure ? ' — ' + esc(currentUser.structure) : ''}</div>
          <div class="text-soft" style="font-size:12.5px;">${niveau === 'ministere' ? 'Tout le pays' : esc([currentUser.region && 'Région ' + currentUser.region, currentUser.province && 'Province ' + currentUser.province, currentUser.ceb && 'CEB ' + currentUser.ceb].filter(Boolean).join(' · ') || 'Zone non renseignée')}</div></div>
        <select id="cep-annee" class="search-input">${annees.map((a) => `<option ${a === CEP_ETAT.annee ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <select id="cep-type" class="search-input"><option value="cep" ${CEP_ETAT.type === 'cep' ? 'selected' : ''}>CEP</option><option value="cep_concours" ${CEP_ETAT.type === 'cep_concours' ? 'selected' : ''}>CEP + concours 6e</option></select>
        <button class="btn btn-sm" id="cep-actu">Actualiser</button>
        <a class="btn btn-sm" href="#/cep-calendrier">Calendrier</a>
        <a class="btn btn-sm btn-accent" href="#/cep-validation">Remontées et validation</a>
      </div>
      ${cepHtmlTableau(d, niveau, CEP_ETAT.chemin, cepAujourdhui())}`;
    $('#cep-annee', root).onchange = (e) => { CEP_ETAT.annee = e.target.value; CEP_ETAT.chemin = []; onRouteChange(); };
    $('#cep-type', root).onchange = (e) => { CEP_ETAT.type = e.target.value; CEP_ETAT.chemin = []; onRouteChange(); };
    $('#cep-actu', root).onclick = () => onRouteChange();
    $all('[data-voir]', root).forEach((b) => { b.onclick = () => { CEP_ETAT.chemin = [...CEP_ETAT.chemin, b.dataset.voir]; dessiner(); }; });
    $all('[data-haut]', root).forEach((a) => { a.onclick = (e) => { e.preventDefault(); CEP_ETAT.chemin = CEP_ETAT.chemin.slice(0, Number(a.dataset.haut) + 1); dessiner(); }; });
    $all('[data-risque]', root).forEach((b) => { b.onclick = () => { const c = d.centresRisque.find((x) => x.id === b.dataset.risque); if (c) cepFormRisque(c); }; });
    cepBrancherFile(root);
  };
  dessiner();
  cepRejouerFile().catch(() => {});
};
