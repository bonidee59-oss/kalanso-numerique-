/* ============================================================
   app-cep-calendrier.js — Calendrier du CEP avec échéances
   ------------------------------------------------------------
   Le ministère fixe les dates (inscriptions, dépôt des épreuves,
   composition, correction, dépôt des résultats, délibération), pour tous
   les niveaux ou pour un niveau précis. Chaque niveau voit ses échéances,
   ses retards et ses alertes. La CEB marque « fait » les étapes qui ne se
   déduisent pas des données (dépôt des épreuves, correction, délibération).
   ============================================================ */

function cepHtmlCalendrier(d, niveau, units, aujourdhui, extra) {
  const cal = d.calendrier || [];
  const lignes = CEP_ETAPES.filter((e) => CEP_ETAPES_NIVEAU[niveau].includes(e.code)).map((e) => {
    const ech = cepEcheance(cal, e.code, niveau);
    let fait = null, prog = '';
    if (units && units.length) {
      const faits = units.filter((u) => cepEtapeFaiteCeb(e, u)).length;
      fait = faits === units.length; prog = `${faits} / ${units.length} CEB`;
    } else if (extra && extra[e.code] !== undefined) fait = !!extra[e.code];
    const st = cepEtatEcheance(ech, !!fait, aujourdhui);
    return { e, ech, st, prog, texte: cepTexteEcheance(st) };
  });
  const alertes = lignes.filter((l) => l.st.etat === 'retard' || l.st.etat === 'bientot');
  const cls = { fait: 'vert', retard: 'terre', bientot: 'ocre', a_venir: 'indigo', pas_commence: 'indigo', sans_date: 'indigo' };
  return `${alertes.length ? `<div class="alert ${alertes.some((a) => a.st.etat === 'retard') ? 'alert-terre' : 'alert-ocre'}" style="margin-bottom:12px;"><b>Alertes :</b><ul style="margin:6px 0 0 18px;">${alertes.map((a) => `<li>${esc(a.e.label)} — ${esc(a.texte)}${a.ech ? ' (avant le ' + esc(formatDate(a.ech.date_limite)) + ')' : ''}</li>`).join('')}</ul></div>` : ''}
    ${cal.length ? '' : '<div class="alert alert-ocre" style="margin-bottom:12px;">Le ministère n\'a pas encore fixé le calendrier de cette année.</div>'}
    <div class="table-wrap"><table class="table" style="font-size:13px;"><thead><tr><th>Étape</th><th>Du</th><th>Date limite</th>${units ? '<th>Avancement</th>' : ''}<th>Situation</th><th></th></tr></thead><tbody>
    ${lignes.map((l) => `<tr><td class="wrap"><b>${esc(l.e.label)}</b><div class="text-soft" style="font-size:12px;">${esc(l.e.aide)}</div>${l.ech && l.ech.note ? `<div style="font-size:12px;">Note : ${esc(l.ech.note)}</div>` : ''}</td>
      <td>${l.ech && l.ech.date_debut ? esc(formatDate(l.ech.date_debut)) : '—'}</td><td style="font-weight:700;">${l.ech ? esc(formatDate(l.ech.date_limite)) : '—'}</td>
      ${units ? `<td>${esc(l.prog)}</td>` : ''}
      <td><span class="badge badge-${cls[l.st.etat]}">${esc(l.texte)}</span></td>
      <td class="no-print">${niveau === 'ceb' && l.e.auto === null ? `<button class="btn btn-sm" data-marquer="${l.e.code}" data-etat="${l.st.etat === 'fait' ? '0' : '1'}">${l.st.etat === 'fait' ? 'Annuler « fait »' : 'Marquer comme fait'}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function cepFormCalendrier(annee, cal, apres) {
  const val = (e, n, k) => { const l = cal.find((x) => x.etape === e && x.niveau === n); return l ? (l[k] || '') : ''; };
  const niveaux = ['ecole', 'ceb', 'dpeppnf', 'dreppnf'];
  const ov = openModal('Calendrier du CEP', `
    <div class="field"><label>Année *</label><input id="cal-annee" value="${esc(annee)}" placeholder="Ex : 2026-2027"></div>
    <p class="text-soft" style="font-size:12.5px;">Pour chaque étape, indiquez la date limite pour tous les niveaux. Si un niveau a une autre date (par exemple la CEB doit déposer plus tôt que la province), ouvrez « Dates par niveau ».</p>
    ${CEP_ETAPES.map((e) => `<div class="card" style="padding:10px 14px;margin-bottom:8px;"><b>${esc(e.label)}</b>
      <div class="form-grid" style="margin-top:6px;">
        <div class="field"><label>Début (facultatif)</label><input type="date" data-e="${e.code}" data-n="tous" data-k="date_debut" value="${esc(val(e.code, 'tous', 'date_debut'))}"></div>
        <div class="field"><label>Date limite</label><input type="date" data-e="${e.code}" data-n="tous" data-k="date_limite" value="${esc(val(e.code, 'tous', 'date_limite'))}"></div>
        <div class="field full"><label>Note (facultatif)</label><input data-e="${e.code}" data-n="tous" data-k="note" value="${esc(val(e.code, 'tous', 'note'))}" maxlength="300"></div>
      </div>
      <details><summary style="cursor:pointer;font-size:13px;">Dates par niveau</summary>
        ${niveaux.filter((n) => CEP_ETAPES_NIVEAU[n].includes(e.code)).map((n) => `<div class="field" style="margin-top:6px;"><label>${esc(CEP_NIVEAU_LIB[n])} — date limite propre</label><input type="date" data-e="${e.code}" data-n="${n}" data-k="date_limite" value="${esc(val(e.code, n, 'date_limite'))}"></div>`).join('')}
      </details></div>`).join('')}`, {
    wide: true, saveLabel: 'Enregistrer le calendrier',
    onSave: async (o) => {
      const an = $('#cal-annee', o).value.trim();
      if (!an) { toast("Indiquez l'année."); return false; }
      const par = new Map();
      $all('[data-e]', o).forEach((i) => {
        const k = i.dataset.e + '|' + i.dataset.n;
        if (!par.has(k)) par.set(k, { etape: i.dataset.e, niveau: i.dataset.n });
        par.get(k)[i.dataset.k] = i.value.trim();
      });
      const lignes = [...par.values()].filter((l) => l.date_limite).map((l) => ({ etape: l.etape, niveau: l.niveau, date_limite: l.date_limite, date_debut: l.date_debut || null, note: l.note || null }));
      for (const l of lignes) if (l.date_debut && l.date_debut > l.date_limite) { toast(`L'étape « ${CEP_ETAPES.find((e) => e.code === l.etape).label} » commence après sa date limite.`); return false; }
      try { await cepRpc('cep_calendrier_definir', { p_annee: an, p_lignes: lignes }); }
      catch (e) { toast(e.horsLigne ? 'Connexion internet nécessaire pour enregistrer le calendrier.' : e.message); return false; }
      CEP_ETAT.annee = an; toast('Calendrier enregistré.'); apres();
      return true;
    }
  });
  return ov;
}

ROUTES['#/cep-calendrier'] = async (root) => {
  const role = currentUser.role;
  const niveau = ['ceb', 'dpeppnf', 'dreppnf', 'ministere', 'centre'].includes(role) ? role : 'ecole';
  let annees = [];
  try { annees = await cepAnneesConnues(); } catch (e) { /* hors ligne */ }
  if (!CEP_ETAT.annee) CEP_ETAT.annee = annees[0] || (typeof anneeScolaireCourante === 'function' ? anneeScolaireCourante() : '');
  if (CEP_ETAT.annee && !annees.includes(CEP_ETAT.annee)) annees.unshift(CEP_ETAT.annee);
  const cleCache = `calendrier:${currentUser.id}:${CEP_ETAT.annee}`;
  let d, units = null, extra = {};
  try {
    if (['ceb', 'dpeppnf', 'dreppnf', 'ministere'].includes(niveau)) { d = await cepChargerDonnees(CEP_ETAT.annee, CEP_ETAT.type); units = cepConstruireUnites(d); }
    else {
      const { data, error } = await window.supaClient.from('cep_calendrier').select('*').eq('annee', CEP_ETAT.annee);
      if (error) throw cepConvertirErreur(error);
      d = { calendrier: data || [] };
      if (niveau === 'ecole' && currentUser.ecole_id) {
        const r = await window.supaClient.from('listes_eleves').select('id').eq('ecole_id', currentUser.ecole_id).eq('type', 'cep').eq('annee', CEP_ETAT.annee).limit(1);
        extra.inscriptions = !!(r.data && r.data.length);
      }
    }
    await cepCacheEcrire(cleCache, { d: { calendrier: d.calendrier }, extra });
  } catch (e) {
    const c = await cepCacheLire(cleCache);
    if (c && e.horsLigne) { d = c.valeur.d; extra = c.valeur.extra || {}; units = null; toast('Pas de connexion : dernier calendrier connu.'); }
    else { root.innerHTML = `<div class="alert alert-terre">${esc(e.message)}</div>`; return; }
  }
  root.innerHTML = `<div class="table-toolbar no-print">
      <div style="flex:1;font-weight:800;font-size:16px;">Calendrier du CEP — ${esc(CEP_NIVEAU_LIB[niveau])}</div>
      <select id="cal-an" class="search-input">${annees.map((a) => `<option ${a === CEP_ETAT.annee ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      ${role === 'ministere' ? '<button class="btn btn-accent" id="cal-edit">Modifier le calendrier</button>' : ''}
    </div>${cepHtmlCalendrier(d, niveau, units, cepAujourdhui(), extra)}`;
  $('#cal-an', root).onchange = (e) => { CEP_ETAT.annee = e.target.value; onRouteChange(); };
  if ($('#cal-edit', root)) $('#cal-edit', root).onclick = () => cepFormCalendrier(CEP_ETAT.annee, d.calendrier || [], () => onRouteChange());
  $all('[data-marquer]', root).forEach((b) => {
    b.onclick = async () => {
      try { await cepRpc('cep_etape_marquer', { p_annee: CEP_ETAT.annee, p_etape: b.dataset.marquer, p_fait: b.dataset.etat === '1' }); toast('Enregistré.'); onRouteChange(); }
      catch (e) { toast(e.horsLigne ? 'Connexion internet nécessaire.' : e.message); }
    };
  });
};
