/* ============================================================
   app-cahier-semaine.js — Cahier de chemin (cahier de semaine) (NOUVEAU MODULE)
   ------------------------------------------------------------
   Un cahier unique qui « tourne » de classe en classe : chaque semaine,
   l'enseignant de la classe de permanence y note, jour après jour, les
   événements qui se déroulent dans la cour de l'école (arrivée, rassemblement,
   récréation, sortie, incidents, visites…), avec les personnes concernées
   et la mesure prise. En fin de semaine il écrit un bilan et remet le cahier
   à la classe suivante ; le directeur vise.

   Un seul magasin « cahierSemaine » (synchronisé avec Supabase par db.js ;
   la table app_data est générique : aucun script SQL à ajouter).
   Deux sortes d'enregistrements :
     • type 'config'  : { annee, ordre:[noms de classes], sautees:[lundis] }
     • type 'semaine' : { annee, lundi, classeNom, enseignantNom, manuel,
                          jours:{ 'AAAA-MM-JJ': { entrees:[…], observation } },
                          bilan, dateRemise, visa:{ date, par } }
   Les classes sont référencées par leur NOM (et non par un identifiant
   local) : les identifiants numériques diffèrent d'un appareil à l'autre.
   ============================================================ */

const CHM_JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const CHM_MOMENTS = ['Arrivée des élèves', 'Rassemblement / levée des couleurs', 'Récréation', 'Pause de midi', 'Sortie des classes', 'Autre moment'];
const CHM_NIVEAUX = ['CP1', 'CP2', 'CE1', 'CE2', 'CM1', 'CM2'];
const CHM_ETAT = { tab: 'semaine', lundi: '', annee: '' };

/* ---------------- Dates (calcul en UTC : pas de décalage de fuseau) ---------------- */
function chmAdd(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function chmLundi(iso) { const d = new Date(iso + 'T00:00:00Z'); return chmAdd(iso, -((d.getUTCDay() + 6) % 7)); }
function chmAnnee(iso) { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); const a = m >= 9 ? y : y - 1; return `${a}-${a + 1}`; }
const chmJourLong = (iso, i) => `${CHM_JOURS[i]} ${formatDate(iso)}`;

/* ---------------- Rotation (fonctions pures, testées dans tests/chemin.test.js) ---------------- */
/* Ordre de rotation par défaut : CP1 → CM2, puis les autres classes par ordre alphabétique. */
function chmOrdreParDefaut(classes) {
  const rang = (c) => { const n = String(c.niveau || c.nom || '').toUpperCase().replace(/\s/g, ''); const i = CHM_NIVEAUX.indexOf(n); return i < 0 ? 99 : i; };
  return [...classes].sort((a, b) => rang(a) - rang(b) || String(a.nom || '').localeCompare(String(b.nom || ''))).map((c) => c.nom).filter(Boolean);
}

function chmALeContenu(s) {
  return Object.values(s.jours || {}).some((j) => (j.entrees || []).length || String(j.observation || '').trim());
}

/* Affecte une classe de permanence aux semaines (triées par date).
   Une semaine « verrouillée » (déjà commencée, ou modifiée à la main) garde sa classe
   et la rotation reprend à la classe qui la suit. ensDe(nomClasse) → nom de l'enseignant.
   Renvoie la liste des semaines modifiées. */
function chmAffecter(semaines, ordre, ensDe) {
  const modifiees = [];
  if (!ordre.length) return modifiees;
  let p = 0;
  [...semaines].sort((a, b) => a.lundi.localeCompare(b.lundi)).forEach((s) => {
    const verrou = chmALeContenu(s) || s.manuel;
    let changee = false;
    if (verrou) {
      const i = ordre.indexOf(s.classeNom);
      if (i >= 0) p = (i + 1) % ordre.length;
    } else {
      const nom = ordre[p]; p = (p + 1) % ordre.length;
      if (s.classeNom !== nom) { s.classeNom = nom; changee = true; }
    }
    if (!s.enseignantManuel) {
      const e = ensDe ? ensDe(s.classeNom) : '';
      if ((s.enseignantNom || '') !== e) { s.enseignantNom = e; changee = true; }
    }
    if (changee) modifiees.push(s);
  });
  return modifiees;
}

/* Lundis d'une période, hors semaines sautées (vacances). */
function chmLundis(debut, fin, sautees) {
  const r = []; let l = chmLundi(debut);
  const ex = new Set(sautees || []);
  while (l <= fin) { if (!ex.has(l)) r.push(l); l = chmAdd(l, 7); }
  return r;
}

/* ---------------- Données ---------------- */
async function chmDonnees() {
  const [tous, classes, ens, jnt, metas] = await Promise.all([DB.getAll('cahierSemaine'), DB.getAll('classes'), DB.getAll('enseignants'), DB.getAll('joursNonTravailles'), DB.getAll('meta')]);
  const triesId = [...tous].sort((a, b) => a.id - b.id);
  const vus = new Set(); const semaines = []; let doublons = 0;
  triesId.filter((x) => x.type === 'semaine').forEach((x) => { if (vus.has(x.lundi)) { doublons++; return; } vus.add(x.lundi); semaines.push(x); });
  semaines.sort((a, b) => a.lundi.localeCompare(b.lundi));
  return { semaines, doublons, configs: triesId.filter((x) => x.type === 'config'), classes, ens, jnt, meta: metas[0] || {} };
}

function chmConfig(D, annee) {
  return D.configs.find((c) => c.annee === annee) || { type: 'config', annee, ordre: chmOrdreParDefaut(D.classes), sautees: [] };
}
async function chmSauverConfig(cfg) {
  if (cfg.id) await DB.put('cahierSemaine', cfg); else cfg.id = await DB.add('cahierSemaine', cfg);
}
async function chmSauver(s) { await DB.put('cahierSemaine', s); }

function chmEnseignantDe(D) {
  return (nomClasse) => {
    const c = D.classes.find((x) => x.nom === nomClasse);
    if (!c) return '';
    const l = enseignantsDeClasse(c, D.ens);
    const t = l.find((e) => e.id === Number(c.enseignantId)) || l[0];
    return t ? `${t.prenom || ''} ${t.nom || ''}`.trim() : '';
  };
}

const chmDirection = () => !!currentUser && ['directeur', 'directeur_adjoint'].includes(currentUser.role);
function chmPeutEcrire(s, D) {
  if (!s || !currentUser) return false;
  if (chmDirection()) return true;
  if (s.visa) return false; // cahier visé : plus de modification par l'enseignant
  if (currentUser.role !== 'enseignant') return false;
  const c = D.classes.find((x) => x.nom === s.classeNom);
  return !!c && classeVisible(c.id);
}

/* Applique la rotation et enregistre les semaines modifiées de l'année. */
async function chmRecalculer(D, annee) {
  const cfg = chmConfig(D, annee);
  const sem = D.semaines.filter((s) => s.annee === annee);
  const modifiees = chmAffecter(sem, cfg.ordre, chmEnseignantDe(D));
  for (const s of modifiees) await chmSauver(s);
  return modifiees.length;
}

/* ---------------- Page ---------------- */
ROUTES['#/cahier-semaine'] = async (root) => {
  const p = getHashParams();
  if (p.get('tab') === 'semaine' || p.get('tab') === 'planning') CHM_ETAT.tab = p.get('tab');
  if (p.get('lundi')) CHM_ETAT.lundi = chmLundi(p.get('lundi'));
  root.innerHTML = `<div class="tabs no-print" id="chm-tabs">
      <button class="tab" data-tab="semaine">Cahier de la semaine</button>
      <button class="tab" data-tab="planning">Planning de rotation</button>
    </div><div id="chm-contenu"></div>`;
  const montrer = async (t) => {
    CHM_ETAT.tab = t;
    $all('.tab', $('#chm-tabs')).forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    const c = $('#chm-contenu');
    c.innerHTML = '<p class="text-soft">Chargement…</p>';
    if (t === 'planning') await chmRenderPlanning(c); else await chmRenderSemaine(c);
  };
  $('#chm-tabs').onclick = (e) => { const b = e.target.closest('.tab'); if (b) montrer(b.dataset.tab); };
  await montrer(CHM_ETAT.tab);
};

/* ============================================================
   Onglet 1 — Cahier de la semaine
   ============================================================ */
async function chmRenderSemaine(c) {
  const D = await chmDonnees();
  const lundi = CHM_ETAT.lundi || chmLundi(todayISO());
  CHM_ETAT.lundi = lundi;
  const sem = D.semaines.find((s) => s.lundi === lundi);
  const annee = chmAnnee(lundi);
  const samedi = chmAdd(lundi, 5);
  const nav = `<div class="flex gap-8 items-center no-print" style="margin-bottom:12px;flex-wrap:wrap;">
      <button class="btn btn-sm" data-act="prec">◀ Semaine précédente</button>
      <button class="btn btn-sm" data-act="now">Cette semaine</button>
      <button class="btn btn-sm" data-act="suiv">Semaine suivante ▶</button>
      <input type="date" id="chm-goto" value="${lundi}" title="Aller à la semaine contenant cette date" style="margin-left:6px;">
    </div>`;

  if (!sem) {
    c.innerHTML = `${nav}<div class="empty-state"><div class="big">✎</div>
      Aucune classe de permanence n'est programmée pour la semaine du ${formatDate(lundi)} au ${formatDate(samedi)}.
      ${chmDirection() ? `<div style="margin-top:12px;"><button class="btn btn-accent" data-act="creer">Programmer cette semaine</button>
        <button class="btn" data-act="planning">Générer tout le planning de l'année</button></div>`
        : '<div class="text-soft" style="margin-top:8px;">Demandez au directeur de générer le planning de rotation.</div>'}</div>`;
    chmBrancherSemaine(c, D, null);
    return;
  }

  const ecrit = chmPeutEcrire(sem, D);
  const semAnnee = D.semaines.filter((s) => s.annee === sem.annee);
  const numero = semAnnee.findIndex((s) => s.lundi === sem.lundi) + 1;
  const suivante = semAnnee[numero] || null; // semaine d'après (index numero = suivante)
  const cfg = chmConfig(D, sem.annee);
  const iNext = cfg.ordre.indexOf(sem.classeNom);
  const classeSuivante = suivante ? suivante.classeNom : (iNext >= 0 && cfg.ordre.length ? cfg.ordre[(iNext + 1) % cfg.ordre.length] : '');
  const aujourdhui = todayISO();
  const statut = aujourdhui < sem.lundi ? ['ocre', 'À venir'] : (aujourdhui > samedi ? ['indigo', 'Terminée'] : ['vert', 'En cours']);
  const jours = sem.jours || {};
  const nbEvt = Object.values(jours).reduce((t, j) => t + (j.entrees || []).length, 0);
  const nbJoursRens = CHM_JOURS.filter((_, i) => { const j = jours[chmAdd(lundi, i)]; return j && ((j.entrees || []).length || String(j.observation || '').trim()); }).length;

  const carteJour = (i) => {
    const iso = chmAdd(lundi, i), j = jours[iso] || { entrees: [], observation: '' };
    const ferie = D.jnt.find((x) => x.date === iso && x.portee === 'ecole');
    const lignes = (j.entrees || []).slice().sort((a, b) => String(a.heure || '99').localeCompare(String(b.heure || '99')));
    return `<div class="card" style="padding:14px 16px;margin-bottom:12px;${iso === aujourdhui ? 'border-left:4px solid var(--vert-600);' : ''}">
      <div class="flex gap-8 items-center" style="flex-wrap:wrap;margin-bottom:8px;">
        <h4 style="margin:0;flex:1;">${esc(chmJourLong(iso, i))}</h4>
        ${iso === aujourdhui ? '<span class="badge badge-vert">Aujourd\'hui</span>' : ''}
        ${ferie ? `<span class="badge badge-ocre">Jour non travaillé${ferie.motif ? ' : ' + esc(ferie.motif) : ''}</span>` : ''}
        ${i === 5 && !lignes.length && !String(j.observation || '').trim() ? '<span class="text-soft" style="font-size:12px;">(samedi : facultatif)</span>' : ''}
      </div>
      ${lignes.length ? `<div class="table-wrap"><table style="font-size:12.5px;"><thead><tr><th>Heure</th><th>Moment</th><th>Événement dans la cour</th><th>Élèves / personnes concernés</th><th>Mesure prise</th>${ecrit ? '<th class="no-print"></th>' : ''}</tr></thead><tbody>
        ${lignes.map((e) => `<tr><td style="white-space:nowrap;font-weight:600;">${esc(e.heure || '')}</td><td class="wrap">${esc(e.moment || '')}</td><td class="wrap">${esc(e.evenement || '')}</td><td class="wrap">${esc(e.concernes || '')}</td><td class="wrap">${esc(e.mesure || '')}</td>
          ${ecrit ? `<td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-act="edit" data-iso="${iso}" data-id="${esc(e.id)}">Modifier</button><button class="btn btn-sm btn-danger" data-act="del" data-iso="${iso}" data-id="${esc(e.id)}">×</button></div></td>` : ''}</tr>`).join('')}
        </tbody></table></div>`
      : `<div class="text-soft" style="font-size:13px;">${j.observation && /^R\.?A\.?S/i.test(j.observation) ? '' : 'Aucun événement noté.'}</div>`}
      ${ecrit ? `<div class="field full" style="margin-top:10px;"><label>Observation générale du jour</label>
          <textarea data-obs="${iso}" rows="2" placeholder="Ex. : journée calme, propreté de la cour, absence de collègue…">${esc(j.observation || '')}</textarea></div>
        <div class="flex gap-8 no-print" style="margin-top:8px;flex-wrap:wrap;">
          <button class="btn btn-sm btn-accent" data-act="add" data-iso="${iso}">+ Événement</button>
          <button class="btn btn-sm" data-act="obs" data-iso="${iso}">Enregistrer l'observation</button>
          ${!lignes.length ? `<button class="btn btn-sm" data-act="ras" data-iso="${iso}">R.A.S. (rien à signaler)</button>` : ''}
        </div>`
        : (j.observation ? `<p style="margin:8px 0 0;font-size:13px;"><b>Observation :</b> ${esc(j.observation)}</p>` : '')}
    </div>`;
  };

  c.innerHTML = `${nav}
    <div class="card" style="padding:16px 18px;margin-bottom:14px;">
      <div class="flex gap-8 items-center" style="flex-wrap:wrap;">
        <div style="flex:1;min-width:240px;">
          <div class="text-soft" style="font-size:12px;">Année scolaire ${esc(sem.annee)} · semaine n° ${numero}</div>
          <h3 style="margin:2px 0 4px;">Du lundi ${formatDate(sem.lundi)} au samedi ${formatDate(samedi)}</h3>
          <div>Classe de permanence : <b>${esc(sem.classeNom || '—')}</b> &nbsp;·&nbsp; Enseignant(e) de la semaine : <b>${esc(sem.enseignantNom || 'non renseigné')}</b></div>
        </div>
        <span class="badge badge-${statut[0]}">${statut[1]}</span>
        ${sem.visa ? `<span class="badge badge-vert">Visé le ${formatDate(sem.visa.date)}</span>` : ''}
      </div>
      ${ecrit ? '' : `<div class="alert alert-ocre" style="margin:12px 0 0;">${sem.visa && currentUser && currentUser.role === 'enseignant' ? 'Cahier visé par le directeur : lecture seule.' : 'Seul l\'enseignant de la classe de permanence (ou la direction) peut écrire dans ce cahier cette semaine.'}</div>`}
    </div>
    ${D.doublons ? `<div class="alert alert-terre">⚠ ${D.doublons} semaine(s) en double (saisie sur deux appareils hors ligne ?). Seule la plus ancienne est affichée.</div>` : ''}
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Événements notés</div><div class="value">${nbEvt}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Jours renseignés</div><div class="value">${nbJoursRens}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Cahier à remettre à</div><div class="value" style="font-size:20px;">${esc(classeSuivante || '—')}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Visa du directeur</div><div class="value" style="font-size:20px;">${sem.visa ? 'Oui' : 'En attente'}</div></div>
    </div>
    <div class="table-toolbar no-print" style="margin-bottom:10px;">
      <div style="flex:1;"></div>
      ${chmDirection() ? '<button class="btn btn-sm" data-act="modif-sem">Changer classe / enseignant</button>' : ''}
      <button class="btn btn-sm" data-act="print">Imprimer / PDF</button>
      <button class="btn btn-sm" data-act="word">Word (.doc)</button>
      <button class="btn btn-sm" data-act="csv">Excel (CSV)</button>
    </div>
    ${CHM_JOURS.map((_, i) => carteJour(i)).join('')}
    <div class="card" style="padding:14px 16px;margin-bottom:12px;">
      <h4 style="margin:0 0 8px;">Bilan de la semaine et passation du cahier</h4>
      ${ecrit ? `<div class="field full"><label>Bilan de la semaine (faits marquants, difficultés, suggestions)</label><textarea id="chm-bilan" rows="4">${esc(sem.bilan || '')}</textarea></div>
        <div class="form-grid" style="margin-top:10px;">
          <div class="field"><label>Cahier remis à la classe</label><input value="${esc(classeSuivante || '')}" disabled></div>
          <div class="field"><label>Date de remise du cahier</label><input type="date" id="chm-remise" value="${esc(sem.dateRemise || '')}"></div>
        </div>
        <div class="flex gap-8 no-print" style="margin-top:10px;"><button class="btn btn-accent" data-act="bilan">Enregistrer le bilan et la remise</button></div>`
        : `<p style="margin:0 0 6px;"><b>Bilan :</b> ${esc(sem.bilan || '—')}</p><p style="margin:0;"><b>Remis à la classe :</b> ${esc(classeSuivante || '—')} ${sem.dateRemise ? 'le ' + formatDate(sem.dateRemise) : '(pas encore remis)'}</p>`}
      ${chmDirection() ? `<div class="flex gap-8 no-print" style="margin-top:12px;">${sem.visa ? '<button class="btn btn-sm" data-act="devisa">Retirer le visa</button>' : '<button class="btn btn-sm btn-primary" data-act="visa">Viser le cahier de cette semaine</button>'}</div>` : ''}
    </div>`;
  chmBrancherSemaine(c, D, sem, { classeSuivante });
}

function chmBrancherSemaine(c, D, sem, ctx = {}) {
  const aller = (lundi) => { CHM_ETAT.lundi = lundi; chmRenderSemaine(c); };
  const goto = $('#chm-goto', c);
  if (goto) goto.onchange = () => { if (goto.value) aller(chmLundi(goto.value)); };
  c.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, iso = b.dataset.iso, id = b.dataset.id;
    const lundi = CHM_ETAT.lundi;
    if (act === 'prec') return aller(chmAdd(lundi, -7));
    if (act === 'suiv') return aller(chmAdd(lundi, 7));
    if (act === 'now') return aller(chmLundi(todayISO()));
    if (act === 'planning') { CHM_ETAT.tab = 'planning'; return onRouteChange(); }
    if (act === 'creer') {
      const annee = chmAnnee(lundi);
      const cfg = chmConfig(D, annee);
      if (!cfg.ordre.length) { toast("Aucune classe n'existe : créez d'abord les classes."); return; }
      const avant = D.semaines.filter((s) => s.lundi < lundi && s.annee === annee).pop();
      const i = avant ? cfg.ordre.indexOf(avant.classeNom) : -1;
      const nom = cfg.ordre[(i + 1) % cfg.ordre.length];
      await DB.add('cahierSemaine', { type: 'semaine', annee, lundi, classeNom: nom, enseignantNom: chmEnseignantDe(D)(nom), jours: {} });
      toast(`Semaine programmée : classe ${nom}.`);
      return aller(lundi);
    }
    if (!sem) return;
    if (act === 'print') return printDocument('Cahier de chemin', chmHtml(sem, D, ctx.classeSuivante));
    if (act === 'word') return exportWordDoc(`cahier-de-chemin-${sem.lundi}.doc`, 'Cahier de chemin', chmHtml(sem, D, ctx.classeSuivante));
    if (act === 'csv') return download(`cahier-de-chemin-${sem.lundi}.csv`, toCSV(chmLignes(sem), [
      { label: 'Date', value: (r) => r.date }, { label: 'Jour', value: 'jour' }, { label: 'Heure', value: 'heure' }, { label: 'Moment', value: 'moment' },
      { label: 'Événement', value: 'evenement' }, { label: 'Concernés', value: 'concernes' }, { label: 'Mesure prise', value: 'mesure' }, { label: 'Observation du jour', value: 'observation' }]), 'text/csv;charset=utf-8');
    if (act === 'modif-sem') return chmModifierSemaine(sem, D);
    if (act === 'visa' || act === 'devisa') {
      if (!chmDirection()) return;
      sem.visa = act === 'visa' ? { date: todayISO(), par: currentUser.nom || '' } : null;
      await chmSauver(sem); toast(act === 'visa' ? 'Cahier visé.' : 'Visa retiré.'); return onRouteChange();
    }
    if (!chmPeutEcrire(sem, D)) { toast("Vous ne pouvez pas modifier ce cahier."); return; }
    sem.jours = sem.jours || {};
    const jour = (d) => (sem.jours[d] = sem.jours[d] || { entrees: [], observation: '' });
    if (act === 'add') return chmFormulaire(sem, D, iso, null);
    if (act === 'edit') return chmFormulaire(sem, D, iso, id);
    if (act === 'del') {
      if (!(await confirmDialog('Supprimer cet événement du cahier ?'))) return;
      const j = jour(iso); j.entrees = (j.entrees || []).filter((e) => e.id !== id);
      await chmSauver(sem); toast('Événement supprimé.'); return onRouteChange();
    }
    if (act === 'obs') {
      const t = $(`[data-obs="${iso}"]`, c); jour(iso).observation = t ? t.value.trim() : '';
      await chmSauver(sem); toast('Observation enregistrée.'); return onRouteChange();
    }
    if (act === 'ras') {
      const j = jour(iso); if (!j.observation) j.observation = 'R.A.S. (rien à signaler)';
      await chmSauver(sem); toast('Jour marqué R.A.S.'); return onRouteChange();
    }
    if (act === 'bilan') {
      sem.bilan = ($('#chm-bilan', c).value || '').trim(); sem.dateRemise = $('#chm-remise', c).value || '';
      await chmSauver(sem); toast('Bilan enregistré.'); return onRouteChange();
    }
  };
}

/* Lignes à plat (impression, Word, CSV) : un jour sans événement donne une ligne avec son observation (ou R.A.S.). */
function chmLignes(sem) {
  const r = [];
  CHM_JOURS.forEach((nom, i) => {
    const iso = chmAdd(sem.lundi, i), j = (sem.jours || {})[iso] || {};
    const ev = (j.entrees || []).slice().sort((a, b) => String(a.heure || '99').localeCompare(String(b.heure || '99')));
    if (i === 5 && !ev.length && !String(j.observation || '').trim()) return; // samedi vide : ignoré
    if (!ev.length) r.push({ date: formatDate(iso), jour: nom, heure: '', moment: '', evenement: '', concernes: '', mesure: '', observation: j.observation || '' });
    ev.forEach((e, k) => r.push({ date: formatDate(iso), jour: nom, heure: e.heure || '', moment: e.moment || '', evenement: e.evenement || '', concernes: e.concernes || '', mesure: e.mesure || '', observation: k === 0 ? (j.observation || '') : '' }));
  });
  return r;
}

/* Page « papier » du cahier : s'imprime avec l'en-tête de l'école (printDocument). */
function chmHtml(sem, D, classeSuivante) {
  const lignes = chmLignes(sem);
  let dernier = '';
  const corps = lignes.map((l) => {
    const premiere = l.date !== dernier; dernier = l.date;
    const vide = !l.evenement;
    return `<tr><td style="white-space:nowrap;">${premiere ? `<b>${esc(l.jour)}</b><br>${esc(l.date)}` : ''}</td><td>${esc(l.heure)}</td><td>${esc(l.moment)}</td>
      <td>${vide ? `<i>${esc(l.observation || 'R.A.S.')}</i>` : esc(l.evenement)}</td><td>${esc(l.concernes)}</td><td>${esc(l.mesure)}</td></tr>`
      + (!vide && l.observation ? `<tr><td></td><td colspan="5"><i>Observation du jour : ${esc(l.observation)}</i></td></tr>` : '');
  }).join('');
  return `<h3 style="text-align:center;margin:0 0 4px;">CAHIER DE CHEMIN — SEMAINE DU ${esc(formatDate(sem.lundi))} AU ${esc(formatDate(chmAdd(sem.lundi, 5)))}</h3>
    <p style="text-align:center;margin:0 0 12px;font-size:13px;">Classe de permanence : <b>${esc(sem.classeNom || '')}</b> — Enseignant(e) : <b>${esc(sem.enseignantNom || '')}</b></p>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:11px;">
      <thead><tr><th>Jour</th><th>Heure</th><th>Moment</th><th>Événements dans la cour</th><th>Élèves / personnes concernés</th><th>Mesure prise</th></tr></thead>
      <tbody>${corps}</tbody></table>
    <p style="margin-top:14px;font-size:12px;"><b>Bilan de la semaine :</b> ${esc(sem.bilan || '')}</p>
    <p style="font-size:12px;">Cahier remis à la classe de <b>${esc(classeSuivante || '………')}</b> le ${sem.dateRemise ? esc(formatDate(sem.dateRemise)) : '………………'}</p>
    <table style="width:100%;margin-top:18px;font-size:12px;"><tr>
      <td style="text-align:center;width:50%;">L'enseignant(e) de la semaine<br><br><br>${esc(sem.enseignantNom || '')}</td>
      <td style="text-align:center;width:50%;">${sem.visa ? `Vu le ${esc(formatDate(sem.visa.date))}` : 'Visa'}<br><br><br></td></tr></table>`;
}

/* ---------------- Formulaire d'un événement ---------------- */
function chmFormulaire(sem, D, iso0, id) {
  const j0 = (sem.jours || {})[iso0] || { entrees: [] };
  const ex = id ? (j0.entrees || []).find((e) => e.id === id) : null;
  const v = (k) => esc(ex ? (ex[k] ?? '') : '');
  const jourOpt = CHM_JOURS.map((n, i) => { const d = chmAdd(sem.lundi, i); return `<option value="${d}" ${d === iso0 ? 'selected' : ''}>${esc(chmJourLong(d, i))}</option>`; }).join('');
  openModal(`${ex ? 'Modifier' : 'Ajouter'} un événement — cour de l'école`, `
    <div class="form-grid">
      <div class="field"><label>Jour *</label><select id="chm-f-jour">${jourOpt}</select></div>
      <div class="field"><label>Heure</label><input type="time" id="chm-f-heure" value="${v('heure')}"></div>
      <div class="field full"><label>Moment</label><select id="chm-f-moment"><option value="">—</option>${CHM_MOMENTS.map((m) => `<option ${ex && ex.moment === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
      <div class="field full"><label>Événement *</label><textarea id="chm-f-evt" placeholder="Ex. : bagarre entre deux élèves, élève blessé, visite d'un parent, retard de l'enseignant, pluie pendant le rassemblement…">${v('evenement')}</textarea></div>
      <div class="field full"><label>Élèves / personnes concernés</label><input id="chm-f-conc" value="${v('concernes')}" placeholder="Noms et classes"></div>
      <div class="field full"><label>Mesure prise / suite donnée</label><textarea id="chm-f-mes">${v('mesure')}</textarea></div>
    </div>`, {
    onSave: async (o) => {
      const g = (s) => ($(s, o) ? $(s, o).value.trim() : '');
      const evenement = g('#chm-f-evt'), jour = g('#chm-f-jour');
      if (!evenement) { toast("Décrivez l'événement."); return false; }
      const fresh = await DB.get('cahierSemaine', sem.id);
      fresh.jours = fresh.jours || {};
      const entree = { id: ex ? ex.id : `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, heure: g('#chm-f-heure'), moment: g('#chm-f-moment'), evenement, concernes: g('#chm-f-conc'), mesure: g('#chm-f-mes') };
      if (ex) { const a = fresh.jours[iso0]; if (a) a.entrees = (a.entrees || []).filter((e) => e.id !== ex.id); }
      const j = (fresh.jours[jour] = fresh.jours[jour] || { entrees: [], observation: '' });
      j.entrees = [...(j.entrees || []), entree];
      if (/^R\.?A\.?S/i.test(j.observation || '')) j.observation = ''; // plus « rien à signaler »
      await DB.put('cahierSemaine', fresh);
      toast(ex ? 'Événement modifié.' : 'Événement enregistré.');
      onRouteChange();
      return true;
    }
  });
}

function chmModifierSemaine(sem, D) {
  const noms = [...new Set([...D.classes.map((x) => x.nom).filter(Boolean), sem.classeNom].filter(Boolean))];
  const ensNoms = D.ens.map((e) => `${e.prenom || ''} ${e.nom || ''}`.trim()).filter(Boolean);
  openModal('Classe de permanence et enseignant de la semaine', `
    <div class="form-grid">
      <div class="field"><label>Classe de permanence</label><select id="chm-m-classe">${noms.map((n) => `<option ${n === sem.classeNom ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div class="field"><label>Enseignant(e) de la semaine</label><input id="chm-m-ens" list="chm-m-enslist" value="${esc(sem.enseignantNom || '')}"><datalist id="chm-m-enslist">${ensNoms.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <small>Laissez le titulaire de la classe, ou choisissez un remplaçant (absence, congé…).</small></div>
    </div>
    <div class="alert alert-ocre" style="margin-top:10px;">Les semaines suivantes non commencées seront recalculées pour continuer la rotation à partir de cette semaine.</div>`, {
    onSave: async (o) => {
      const classe = $('#chm-m-classe', o).value, ens = $('#chm-m-ens', o).value.trim();
      const fresh = await DB.get('cahierSemaine', sem.id);
      const auto = chmEnseignantDe(D)(classe);
      fresh.classeNom = classe; fresh.manuel = true;
      fresh.enseignantNom = ens || auto; fresh.enseignantManuel = !!ens && ens !== auto;
      await chmSauver(fresh);
      D.semaines = D.semaines.map((s) => (s.id === fresh.id ? fresh : s));
      const n = await chmRecalculer(D, fresh.annee);
      toast(`Semaine modifiée${n ? ` · ${n} semaine(s) suivante(s) recalculée(s)` : ''}.`);
      onRouteChange();
      return true;
    }
  });
}

/* ============================================================
   Onglet 2 — Planning de rotation
   ============================================================ */
async function chmRenderPlanning(c) {
  const D = await chmDonnees();
  const direction = chmDirection();
  const annees = [...new Set([chmAnnee(todayISO()), ...D.semaines.map((s) => s.annee)])].sort().reverse();
  if (!CHM_ETAT.annee || !annees.includes(CHM_ETAT.annee)) CHM_ETAT.annee = annees[0];
  const annee = CHM_ETAT.annee;
  const cfg = chmConfig(D, annee);
  const sem = D.semaines.filter((s) => s.annee === annee);
  const ensDe = chmEnseignantDe(D);
  const y0 = Number(annee.slice(0, 4));
  const aujourdhui = todayISO(), lundiNow = chmLundi(aujourdhui);
  const horsOrdre = D.classes.map((x) => x.nom).filter((n) => n && !cfg.ordre.includes(n));
  const existe = (n) => D.classes.some((x) => x.nom === n);

  const ordreHtml = cfg.ordre.length ? `<table style="font-size:13px;"><thead><tr><th>Ordre</th><th>Classe</th><th>Enseignant(e) titulaire</th>${direction ? '<th class="no-print"></th>' : ''}</tr></thead><tbody>
    ${cfg.ordre.map((n, i) => `<tr><td style="text-align:center;font-weight:600;">${i + 1}</td><td><b>${esc(n)}</b>${existe(n) ? '' : ' <span class="badge badge-terre">classe introuvable</span>'}</td>
      <td>${esc(ensDe(n)) || '<span class="badge badge-ocre">aucun enseignant affecté</span>'}</td>
      ${direction ? `<td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-act="haut" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-sm" data-act="bas" data-i="${i}" ${i === cfg.ordre.length - 1 ? 'disabled' : ''}>↓</button><button class="btn btn-sm btn-danger" data-act="retirer" data-i="${i}" title="Retirer de la rotation">×</button></div></td>` : ''}</tr>`).join('')}
    </tbody></table>` : '<div class="text-soft">Aucune classe dans la rotation.</div>';

  const statutSem = (s) => (aujourdhui < s.lundi ? ['ocre', 'À venir'] : (aujourdhui > chmAdd(s.lundi, 5) ? ['indigo', 'Terminée'] : ['vert', 'En cours']));
  const lignes = sem.map((s, i) => {
    const st = statutSem(s);
    const nbJ = CHM_JOURS.filter((_, k) => { const j = (s.jours || {})[chmAdd(s.lundi, k)]; return j && ((j.entrees || []).length || String(j.observation || '').trim()); }).length;
    return `<tr${s.lundi === lundiNow ? ' style="background:var(--vert-100);"' : ''}><td style="text-align:center;font-weight:600;">${i + 1}</td><td>${formatDate(s.lundi)} → ${formatDate(chmAdd(s.lundi, 5))}</td>
      <td><b>${esc(s.classeNom || '—')}</b>${s.manuel ? ' <span class="badge badge-ocre" title="Modifiée à la main">modifiée</span>' : ''}</td><td>${esc(s.enseignantNom || '—')}</td>
      <td style="text-align:center;">${nbJ}</td><td><span class="badge badge-${st[0]}">${st[1]}</span>${s.visa ? ' <span class="badge badge-vert">visé</span>' : ''}</td>
      <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-act="ouvrir" data-l="${s.lundi}">Ouvrir</button>
        ${direction ? `<button class="btn btn-sm" data-act="modif" data-id="${s.id}">Modifier</button><button class="btn btn-sm btn-danger" data-act="sauter" data-id="${s.id}" title="Semaine sans cahier (vacances, jour férié…)">Sauter</button>` : ''}</div></td></tr>`;
  }).join('');

  c.innerHTML = `
    <div class="alert alert-vert">Le cahier de chemin passe chaque semaine à la classe suivante, dans l'ordre ci-dessous. L'enseignant de la classe de permanence y écrit les événements de la cour, jour après jour.</div>
    <div class="table-toolbar no-print">
      <select id="chm-annee" class="search-input" style="min-width:130px;">${annees.map((a) => `<option ${a === annee ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="chm-print">Imprimer le planning</button>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px;">
      <div class="card" style="padding:14px 16px;"><h4 style="margin:0 0 8px;">Ordre de rotation des classes</h4>${ordreHtml}
        ${direction && horsOrdre.length ? `<div class="flex gap-8 no-print" style="margin-top:10px;"><select id="chm-ajout">${horsOrdre.map((n) => `<option>${esc(n)}</option>`).join('')}</select><button class="btn btn-sm" data-act="ajouter">+ Ajouter à la rotation</button></div>` : ''}</div>
      ${direction ? `<div class="card no-print" style="padding:14px 16px;"><h4 style="margin:0 0 8px;">Générer le planning</h4>
        <div class="form-grid"><div class="field"><label>Première semaine (date)</label><input type="date" id="chm-gdebut" value="${sem.length ? sem[0].lundi : (aujourdhui >= `${y0}-09-01` ? lundiNow : `${y0}-10-05`)}"></div>
          <div class="field"><label>Dernière semaine (date)</label><input type="date" id="chm-gfin" value="${sem.length ? sem[sem.length - 1].lundi : `${y0 + 1}-06-27`}"></div></div>
        <div class="flex gap-8" style="margin-top:10px;flex-wrap:wrap;"><button class="btn btn-accent" data-act="generer">Générer / compléter le planning</button><button class="btn btn-sm" data-act="recalc">Recalculer la rotation</button></div>
        <small class="text-soft" style="display:block;margin-top:8px;">Les semaines déjà commencées ou modifiées à la main ne changent pas. Les semaines entièrement non travaillées (calendrier de l'école) sont sautées.</small>
        ${(cfg.sautees || []).length ? `<div style="margin-top:10px;font-size:12.5px;"><b>Semaines sautées :</b> ${cfg.sautees.slice().sort().map((l) => `${formatDate(l)} <button class="btn btn-sm" data-act="retablir" data-l="${l}">Rétablir</button>`).join(' · ')}</div>` : ''}
      </div>` : ''}
    </div>
    ${sem.length ? `<div class="table-wrap"><table style="font-size:12.5px;"><thead><tr><th>N°</th><th>Semaine</th><th>Classe de permanence</th><th>Enseignant(e)</th><th>Jours renseignés</th><th>État</th><th class="no-print"></th></tr></thead><tbody>${lignes}</tbody></table></div>`
      : '<div class="empty-state"><div class="big">▤</div>Aucune semaine programmée pour cette année scolaire.</div>'}`;

  $('#chm-annee', c).onchange = (e) => { CHM_ETAT.annee = e.target.value; chmRenderPlanning(c); };
  $('#chm-print', c).onclick = () => printDocument('Planning du cahier de chemin', `<h3 style="text-align:center;">PLANNING DU CAHIER DE CHEMIN — ${esc(annee)}</h3>
    <table border="1" cellpadding="5" style="border-collapse:collapse;width:100%;font-size:11px;"><thead><tr><th>N°</th><th>Semaine</th><th>Classe</th><th>Enseignant(e)</th><th>Remise du cahier (date et visa)</th></tr></thead><tbody>
    ${sem.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(formatDate(s.lundi))} → ${esc(formatDate(chmAdd(s.lundi, 5)))}</td><td>${esc(s.classeNom || '')}</td><td>${esc(s.enseignantNom || '')}</td><td>&nbsp;</td></tr>`).join('')}</tbody></table>`);

  c.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'ouvrir') { CHM_ETAT.lundi = b.dataset.l; CHM_ETAT.tab = 'semaine'; return onRouteChange(); }
    if (!direction) return;
    const maj = async () => { onRouteChange(); };
    if (act === 'haut' || act === 'bas') {
      const i = Number(b.dataset.i), j = act === 'haut' ? i - 1 : i + 1;
      [cfg.ordre[i], cfg.ordre[j]] = [cfg.ordre[j], cfg.ordre[i]];
      await chmSauverConfig(cfg); toast("Ordre modifié. Utilisez « Recalculer la rotation » pour l'appliquer aux semaines à venir."); return maj();
    }
    if (act === 'retirer') {
      const n = cfg.ordre[Number(b.dataset.i)];
      if (!(await confirmDialog(`Retirer la classe ${n} de la rotation ?`))) return;
      cfg.ordre.splice(Number(b.dataset.i), 1); await chmSauverConfig(cfg); return maj();
    }
    if (act === 'ajouter') { cfg.ordre.push($('#chm-ajout', c).value); await chmSauverConfig(cfg); return maj(); }
    if (act === 'recalc') {
      if (!cfg.ordre.length) { toast("Aucune classe dans la rotation."); return; }
      if (!(await confirmDialog("Recalculer la classe de permanence des semaines non commencées, selon l'ordre ci-dessus ?"))) return;
      const n = await chmRecalculer(D, annee); toast(`${n} semaine(s) mise(s) à jour.`); return maj();
    }
    if (act === 'generer') {
      if (!cfg.ordre.length) { toast("Aucune classe dans la rotation : créez d'abord les classes."); return; }
      const d = $('#chm-gdebut', c).value, f = $('#chm-gfin', c).value;
      if (!d || !f || f < d) { toast('Indiquez une première et une dernière semaine valides.'); return; }
      if (chmAnnee(chmLundi(d)) !== annee || chmAnnee(chmLundi(f)) !== annee) { toast(`Les dates doivent être dans l'année scolaire ${annee}.`); return; }
      await chmSauverConfig(cfg);
      const ferie = new Set(D.jnt.filter((x) => x.portee === 'ecole').map((x) => x.date));
      const sansCours = (l) => [0, 1, 2, 3, 4].every((k) => ferie.has(chmAdd(l, k)));
      const deja = new Set(sem.map((s) => s.lundi));
      let cree = 0;
      for (const l of chmLundis(d, f, cfg.sautees)) {
        if (deja.has(l) || sansCours(l)) continue;
        const o = { type: 'semaine', annee, lundi: l, classeNom: '', enseignantNom: '', jours: {} };
        o.id = await DB.add('cahierSemaine', o); D.semaines.push(o); cree++;
      }
      D.semaines.sort((a, b) => a.lundi.localeCompare(b.lundi));
      await chmRecalculer(D, annee);
      toast(`${cree} semaine(s) ajoutée(s) au planning.`); return maj();
    }
    if (act === 'modif') { const s = D.semaines.find((x) => x.id === Number(b.dataset.id)); if (s) chmModifierSemaine(s, D); return; }
    if (act === 'sauter') {
      const s = D.semaines.find((x) => x.id === Number(b.dataset.id));
      if (!s) return;
      if (chmALeContenu(s)) { toast('Cette semaine contient déjà des notes : elle ne peut pas être sautée.'); return; }
      if (!(await confirmDialog(`Sauter la semaine du ${formatDate(s.lundi)} (pas de cahier : vacances, jour férié…) ? Les classes des semaines suivantes seront décalées.`))) return;
      await DB.delete('cahierSemaine', s.id);
      cfg.sautees = [...new Set([...(cfg.sautees || []), s.lundi])]; await chmSauverConfig(cfg);
      D.semaines = D.semaines.filter((x) => x.id !== s.id);
      await chmRecalculer(D, annee); toast('Semaine sautée.'); return maj();
    }
    if (act === 'retablir') {
      cfg.sautees = (cfg.sautees || []).filter((l) => l !== b.dataset.l); await chmSauverConfig(cfg);
      toast('Semaine rétablie : cliquez sur « Générer / compléter le planning ».'); return maj();
    }
  };
}
