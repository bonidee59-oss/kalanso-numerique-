/* ============================================================
   app-examens-remontee.js — Remontée des résultats du CEP
   ------------------------------------------------------------
   CEB  →  DPEPPNF (province)  →  DREPPNF (région)  →  SG MEBAPLN (national)

   Principe : chaque niveau produit un « bordereau de remontée » (fichier .json,
   chiffres agrégés uniquement : AUCUN nom de candidat ne quitte la CEB). Le niveau
   supérieur importe les bordereaux reçus, les contrôle, les consolide, puis produit
   à son tour son propre bordereau vers le niveau suivant.
   Contrôles à l'import : niveau attendu, cohérence des totaux, examen blanc refusé,
   empreinte d'intégrité (détecte une erreur ou une modification du fichier ; ce
   n'est pas une signature électronique), zone (province / région) et doublons.
   Magasin synchronisé : examRemontees (kind = recu | config | envoi).
   ============================================================ */

const EX_NIVEAUX = {
  ceb: { sigle: 'CEB', nom: 'Circonscription d\'éducation de base' },
  dpeppnf: { sigle: 'DPEPPNF', nom: 'Direction provinciale', route: '#/exam-dpeppnf', enfant: 'ceb', unite: 'CEB', zone: 'Province', parent: 'DREPPNF', signataire: 'Le Directeur provincial' },
  dreppnf: { sigle: 'DREPPNF', nom: 'Direction régionale', route: '#/exam-dreppnf', enfant: 'dpeppnf', unite: 'Province', zone: 'Région', parent: 'SG MEBAPLN', signataire: 'Le Directeur régional' },
  sg: { sigle: 'SG MEBAPLN', nom: 'Secrétariat général du MEBAPLN', route: '#/exam-sg', enfant: 'dreppnf', unite: 'Région', zone: 'National', parent: null, signataire: 'Le Secrétaire général' }
};
const EX_BASE_CLES = ['inscrits', 'absents', 'presents', 'admis', 'ajournes', 'exclus', 'attente'];
const EX_REM = { dpeppnf: '', dreppnf: '', sg: '' }; // clé « année|type » affichée dans chaque rubrique

/* ---------------- Calculs purs ---------------- */
function exBase(c) { const o = {}; EX_BASE_CLES.forEach((k) => { o[k] = (c && c[k]) || 0; }); return o; }
function exSommeBases(l) { const o = {}; EX_BASE_CLES.forEach((k) => { o[k] = l.reduce((s, b) => s + ((b && b[k]) || 0), 0); }); return o; }
function exTauxBase(b) { return b && b.presents ? b.admis / b.presents * 100 : null; }
function exEmpreinte(p) { const c = { ...p }; delete c.empreinte; return deterministicUuid('remontee:' + JSON.stringify(c)); }
const exPct = (n) => (n === null || n === undefined ? '—' : exFmt(n, 1) + ' %');

function exMoyennePonderee(items) { // items : [{ v, n }]
  const l = items.filter((x) => x.v !== null && x.v !== undefined && x.n > 0);
  const n = l.reduce((s, x) => s + x.n, 0);
  return n ? exArrondi(l.reduce((s, x) => s + x.v * x.n, 0) / n, 2) : null;
}

/* Bordereau d'une CEB, construit à partir de ses résultats clôturés */
function exConstruireBordereauCEB(session, res, emetteur, effectifs) {
  const ecoles = new Map();
  res.lignes.forEach((l) => { const k = l.candidat.ecole || '—'; if (!ecoles.has(k)) ecoles.set(k, []); ecoles.get(k).push(l); });
  const unites = [...ecoles.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([nom, ls]) => ({
    nom, niveau: 'ecole', total: exBase(exCompte(ls)), garcons: exBase(exCompte(ls.filter((l) => l.candidat.sexe !== 'F'))), filles: exBase(exCompte(ls.filter((l) => l.candidat.sexe === 'F')))
  }));
  const st = res.stats;
  const avecMoy = res.lignes.filter((l) => l.moyenne !== null && l.decision !== 'absent').length;
  const p = {
    format: 'ecole-numerique/remontee', version: 1, niveau: 'ceb', annee: session.annee, typeExamen: session.type, libelle: session.libelle,
    emetteur, genere: new Date().toISOString(), seuil: res.seuil, effectifs,
    total: exBase(st.global), garcons: exBase(st.garcons), filles: exBase(st.filles),
    moyenneGenerale: st.moyenneGenerale === null ? null : exArrondi(st.moyenneGenerale, 2), nbMoyennes: avecMoy,
    epreuves: st.parEpreuve.map((e) => ({ nom: e.nom, moyenne: e.moyenne === null ? null : exArrondi(e.moyenne, 2), nb: e.nb })),
    unites, partiel: false, manquants: []
  };
  p.empreinte = exEmpreinte(p);
  return p;
}

/* Consolidation de bordereaux de même niveau → chiffres du niveau, et bordereau montant */
function exConsolider(payloads) {
  const epr = new Map();
  payloads.forEach((p) => (p.epreuves || []).forEach((e) => { if (!epr.has(e.nom)) epr.set(e.nom, []); epr.get(e.nom).push({ v: e.moyenne, n: e.nb }); }));
  return {
    total: exSommeBases(payloads.map((p) => p.total)), garcons: exSommeBases(payloads.map((p) => p.garcons)), filles: exSommeBases(payloads.map((p) => p.filles)),
    effectifs: { jurys: 0, centres: 0, salles: 0, ...Object.fromEntries(['jurys', 'centres', 'salles'].map((k) => [k, payloads.reduce((s, p) => s + ((p.effectifs && p.effectifs[k]) || 0), 0)])) },
    nbMoyennes: payloads.reduce((s, p) => s + (p.nbMoyennes || 0), 0),
    moyenneGenerale: exMoyennePonderee(payloads.map((p) => ({ v: p.moyenneGenerale, n: p.nbMoyennes || 0 }))),
    epreuves: [...epr.entries()].map(([nom, l]) => ({ nom, moyenne: exMoyennePonderee(l), nb: l.reduce((s, x) => s + x.n, 0) }))
  };
}
function exConstruireBordereauNiveau(niveau, payloads, emetteur, annee, typeExamen, libelle, manquants) {
  const c = exConsolider(payloads);
  const unites = payloads.map((p) => ({
    nom: p.emetteur.nom, niveau: p.niveau, total: p.total, garcons: p.garcons, filles: p.filles, partiel: !!p.partiel,
    // un seul niveau de détail est transmis vers le haut (les écoles restent à la CEB)
    enfants: p.niveau === 'ceb' ? [] : (p.unites || []).map((u) => ({ nom: u.nom, niveau: u.niveau, total: u.total, garcons: u.garcons, filles: u.filles }))
  })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const p = {
    format: 'ecole-numerique/remontee', version: 1, niveau, annee, typeExamen, libelle, emetteur, genere: new Date().toISOString(),
    seuil: payloads.length && payloads.every((x) => x.seuil === payloads[0].seuil) ? payloads[0].seuil : null,
    effectifs: c.effectifs, total: c.total, garcons: c.garcons, filles: c.filles, moyenneGenerale: c.moyenneGenerale, nbMoyennes: c.nbMoyennes,
    epreuves: c.epreuves, unites, partiel: manquants.length > 0 || payloads.some((x) => x.partiel), manquants
  };
  p.empreinte = exEmpreinte(p);
  return p;
}

/* Contrôle d'un bordereau reçu : renvoie la liste des anomalies (vide = accepté) */
function exValiderBordereau(p, niveauRubrique) {
  if (!p || typeof p !== 'object' || p.format !== 'ecole-numerique/remontee') return ["Ce fichier n'est pas un bordereau de remontée de l'application."];
  const err = [], cfg = EX_NIVEAUX[niveauRubrique];
  if (p.version !== 1) err.push('Version de format non prise en charge.');
  if (p.niveau !== cfg.enfant) err.push(`Ce bordereau est de niveau « ${(EX_NIVEAUX[p.niveau] || {}).sigle || p.niveau} » ; cette rubrique reçoit des bordereaux de niveau « ${EX_NIVEAUX[cfg.enfant].sigle} ».`);
  if (!p.emetteur || typeof p.emetteur.nom !== 'string' || !p.emetteur.nom.trim()) err.push("Émetteur non renseigné ou invalide.");
  if (typeof p.annee !== 'string' || !p.annee || typeof p.typeExamen !== 'string' || !p.typeExamen) err.push("Année / type d'examen non renseignés ou invalides.");
  if (typeof p.genere !== 'string') err.push("Date d'établissement manquante.");
  if (p.unites && !Array.isArray(p.unites)) err.push("Liste des unités invalide.");
  if (p.typeExamen === 'blanc') err.push('Un examen blanc ne peut pas être remonté.');
  const bases = ['total', 'garcons', 'filles'];
  bases.forEach((k) => {
    const b = p[k];
    if (!b || EX_BASE_CLES.some((c) => !Number.isInteger(b[c]) || b[c] < 0)) { err.push(`Effectifs « ${k} » absents ou invalides.`); return; }
    if (b.presents !== b.inscrits - b.absents) err.push(`Incohérence (${k}) : présents ≠ inscrits − absents.`);
    if (b.admis + b.ajournes + b.exclus + b.attente !== b.presents) err.push(`Incohérence (${k}) : admis + ajournés + exclus + en attente ≠ présents.`);
  });
  if (!err.length && EX_BASE_CLES.some((c) => p.total[c] !== p.garcons[c] + p.filles[c])) err.push("Incohérence : le total n'égale pas garçons + filles.");
  if (!err.length && p.total.attente > 0 && p.niveau === 'ceb') err.push(`${p.total.attente} candidat(s) encore « en attente » : la CEB doit terminer sa délibération avant de transmettre.`);
  if (p.empreinte !== exEmpreinte(p)) err.push("Empreinte invalide : le fichier a été modifié ou corrompu. Demandez à l'émetteur de le régénérer.");
  return err;
}

/* ---------------- Accès aux données ---------------- */
async function exRemDonnees(niveau) {
  const tous = await DB.getAll('examRemontees');
  return {
    tous,
    recus: tous.filter((r) => r.kind === 'recu' && r.niveau === niveau),
    config: tous.find((r) => r.kind === 'config' && r.niveau === niveau) || null,
    envois: tous.filter((r) => r.kind === 'envoi' && r.niveau === niveau).sort((a, b) => String(b.date).localeCompare(String(a.date)))
  };
}
async function exRemEnregistrer(obj) {
  const ex = (await DB.getAll('examRemontees')).find((r) => r._uuid === obj._uuid);
  if (ex) await DB.put('examRemontees', { ...ex, ...obj });
  else await DB.add('examRemontees', obj);
}
const exCleSession = (p) => `${p.annee}|${p.typeExamen}`;
const exLibCle = (cle) => { const [a, t] = cle.split('|'); return `${EX_TYPES[t] || t} — ${a}`; };
const exMemeZone = (a, b) => exSansAccent(a) === exSansAccent(b);

/* ---------------- Impression ---------------- */
function exEnteteNiveau(titre, sous) {
  return `<div style="text-align:center;margin-bottom:12px;"><div style="font-size:11px;letter-spacing:.05em;">BURKINA FASO — Unité · Progrès · Justice</div>
    <div style="font-size:12px;margin-top:2px;">MINISTÈRE DE L'ÉDUCATION DE BASE, DE L'ALPHABÉTISATION ET DE LA PROMOTION DES LANGUES NATIONALES (MEBAPLN)</div>
    <h3 style="margin:10px 0 2px;">${esc(titre.toUpperCase())}</h3>${sous ? `<div style="font-size:12px;color:#444;">${sous}</div>` : ''}</div>`;
}
function exLigneUnite(nom, p) {
  return [esc(nom), p.total.inscrits, p.total.presents, p.total.admis, p.total.ajournes + p.total.exclus + p.total.attente, exPct(exTauxBase(p.total)), p.filles.admis, exPct(exTauxBase(p.filles)), p.garcons.admis, exPct(exTauxBase(p.garcons))];
}
const EX_ENT_UNITES = (u) => [u, 'Inscrits', 'Présents', 'Admis', 'Non admis', 'Taux', 'Filles admises', 'Taux filles', 'Garçons admis', 'Taux garçons'];

function exDocEtatRecapitulatif(niveau, cle, payloads, cons, config) {
  const cfg = EX_NIVEAUX[niveau];
  const lignes = [...payloads].sort((a, b) => a.emetteur.nom.localeCompare(b.emetteur.nom, 'fr', { numeric: true })).map((p) => exLigneUnite(p.emetteur.nom + (p.partiel ? ' (partiel)' : ''), p));
  const tot = { total: cons.total, filles: cons.filles, garcons: cons.garcons };
  lignes.push(['<b>TOTAL</b>', ...exLigneUnite('', tot).slice(1).map((c) => `<b>${c}</b>`)]);
  exPrint('État récapitulatif', exEnteteNiveau(`Résultats du ${exLibCle(cle)} — état récapitulatif`, `${esc(cfg.sigle)}${config && config.zone ? ' — ' + esc(config.zone) : ''} · ${payloads.length} ${esc(cfg.unite)}(s) reçue(s)`)
    + exTab(EX_ENT_UNITES(cfg.unite), lignes, { centre: [1, 2, 3, 4, 5, 6, 7, 8, 9], fs: 10.5 })
    + `<p style="font-size:12px;margin-top:10px;">Moyenne générale : <b>${exFmt(cons.moyenneGenerale)} /20</b> · ${cons.effectifs.jurys} jury(s), ${cons.effectifs.centres} centre(s), ${cons.effectifs.salles} salle(s).</p>`
    + (cons.epreuves.length ? exTab(['Épreuve', 'Copies notées', 'Moyenne /20'], cons.epreuves.map((e) => [esc(e.nom), e.nb, exFmt(e.moyenne)]), { centre: [1, 2], fs: 11 }) : '')
    + exSignatures([cfg.signataire]));
}
function exDocBordereauTransmission(p, vers) {
  const t = p.total;
  exPrint('Bordereau de transmission', exEnteteNiveau('Bordereau de transmission des résultats', `${esc(exLibCle(exCleSession(p)))}`)
    + `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:10px;">
      <tr><td style="width:30%;background:#eee;"><b>Émetteur</b></td><td>${esc(EX_NIVEAUX[p.niveau].sigle)} — ${esc(p.emetteur.nom)}${p.emetteur.province && p.niveau === 'ceb' ? ' · province : ' + esc(p.emetteur.province) : ''}${p.emetteur.region ? ' · région : ' + esc(p.emetteur.region) : ''}</td></tr>
      <tr><td style="background:#eee;"><b>Destinataire</b></td><td>${esc(vers)}</td></tr>
      <tr><td style="background:#eee;"><b>Établi le</b></td><td>${esc(formatDate(p.genere.slice(0, 10)))}</td></tr>
      <tr><td style="background:#eee;"><b>Empreinte du fichier</b></td><td style="font-family:monospace;">${esc(p.empreinte)}</td></tr>
      ${p.partiel ? `<tr><td style="background:#eee;"><b>Remontée</b></td><td><b>PARTIELLE</b>${p.manquants.length ? ' — manquants : ' + esc(p.manquants.join(', ')) : ''}</td></tr>` : ''}</table>`
    + exTab(['Inscrits', 'Absents', 'Présents', 'Admis', 'Ajournés', 'Taux de réussite', 'Filles admises', 'Taux filles'], [[t.inscrits, t.absents, t.presents, t.admis, t.ajournes + t.exclus + t.attente, exPct(exTauxBase(t)), p.filles.admis, exPct(exTauxBase(p.filles))]], { centre: [0, 1, 2, 3, 4, 5, 6, 7], fs: 12 })
    + `<p style="font-size:11.5px;margin-top:10px;color:#444;">Le fichier de remontée joint contient uniquement des effectifs agrégés (aucune donnée nominative). Son empreinte permet au destinataire de vérifier qu'il n'a pas été altéré.</p>`
    + exSignatures([p.niveau === 'ceb' ? 'Le Chef de CEB' : EX_NIVEAUX[p.niveau].signataire]));
}

/* ---------------- CEB : transmettre à la DPEPPNF (depuis l'onglet Résultats) ---------------- */
async function exTransmettreCEB(ctx, res) {
  const { session } = ctx;
  if (!exDirection()) { toast('Seule la direction peut transmettre les résultats.'); return; }
  if (session.type === 'blanc') { toast('Un examen blanc ne peut pas être remonté.'); return; }
  if (!session.resultatsVerrouilles) { toast("Clôturez d'abord la délibération."); return; }
  if (res.stats.global.attente) { toast(`${res.stats.global.attente} candidat(s) sont encore en attente.`); return; }
  const g = res.stats.global;
  const ov = openModal('Transmettre les résultats à la DPEPPNF', `
    <p>Un fichier de remontée sera créé avec les <b>chiffres agrégés</b> de la CEB (aucun nom de candidat) : ${g.inscrits} inscrits, ${g.presents} présents, ${g.admis} admis (${exPct(g.taux)}).</p>
    <div class="form-grid">
      <div class="field full"><label>CEB *</label><input id="ex-t-ceb" value="${esc(session.ceb || ctx.meta.ceb || '')}"></div>
      <div class="field"><label>Province *</label><input id="ex-t-prov" value="${esc(session.province || '')}"></div>
      <div class="field"><label>Région *</label><input id="ex-t-reg" value="${esc(session.region || '')}"></div>
    </div>
    <p class="text-soft" style="font-size:12px;">Envoyez ensuite le fichier .json à la DPEPPNF (WhatsApp, e-mail, clé USB) ; elle l'importe dans sa rubrique.</p>`, {
    saveLabel: 'Créer le fichier et le bordereau',
    onSave: async (o) => {
      const g2 = (s) => $(s, o).value.trim();
      if (!g2('#ex-t-ceb') || !g2('#ex-t-prov') || !g2('#ex-t-reg')) { toast('Indiquez la CEB, la province et la région.'); return false; }
      await DB.put('examSessions', { ...(await DB.get('examSessions', session.id)), ceb: g2('#ex-t-ceb'), province: g2('#ex-t-prov'), region: g2('#ex-t-reg') });
      const effectifs = { jurys: new Set(ctx.centres.map(exNomJury)).size, centres: ctx.centres.length, salles: ctx.centres.reduce((s, c) => s + exSalles(c).length, 0) };
      const p = exConstruireBordereauCEB(session, res, { nom: g2('#ex-t-ceb'), ceb: g2('#ex-t-ceb'), province: g2('#ex-t-prov'), region: g2('#ex-t-reg') }, effectifs);
      download(`remontee-ceb-${exSansAccent(p.emetteur.nom).replace(/[^a-z0-9]+/g, '-')}-${session.annee}.json`, JSON.stringify(p), 'application/json;charset=utf-8');
      await exRemEnregistrer({ _uuid: genUuid(), kind: 'envoi', niveau: 'ceb', annee: p.annee, typeExamen: p.typeExamen, vers: 'DPEPPNF', empreinte: p.empreinte, date: new Date().toISOString(), par: currentUser ? currentUser.nom : '' });
      toast('Fichier de remontée créé.');
      setTimeout(() => exDocBordereauTransmission(p, `DPEPPNF de ${p.emetteur.province}`), 400);
      return true;
    }
  });
}

/* ---------------- Rubriques DPEPPNF / DREPPNF / SG ---------------- */
['dpeppnf', 'dreppnf', 'sg'].forEach((niveau) => { ROUTES[EX_NIVEAUX[niveau].route] = (root) => exRemPage(root, niveau); });

async function exRemPage(root, niveau) {
  const cfg = EX_NIVEAUX[niveau];
  const { recus, config, envois } = await exRemDonnees(niveau);
  const cles = [...new Set(recus.map((r) => `${r.annee}|${r.typeExamen}`))].sort().reverse();
  if (!cles.includes(EX_REM[niveau])) EX_REM[niveau] = cles[0] || '';
  const cle = EX_REM[niveau];
  const dsCle = recus.filter((r) => `${r.annee}|${r.typeExamen}` === cle).map((r) => r.payload);
  const cons = exConsolider(dsCle);
  const attendus = (config && config.attendus) || [];
  const recusNoms = new Set(dsCle.map((p) => exSansAccent(p.emetteur.nom)));
  const manquants = attendus.filter((a) => !recusNoms.has(exSansAccent(a)));
  const dir = exDirection();

  root.innerHTML = `
    <div class="table-toolbar no-print">
      <div style="flex:1;min-width:200px;"><div style="font-weight:700;font-size:16px;">${esc(cfg.sigle)} — ${esc(cfg.nom)}${config && config.zone ? ' · ' + esc(config.zone) : ''}</div>
        <div class="text-soft" style="font-size:12.5px;">Reçoit les bordereaux des ${esc(cfg.unite)} et les consolide${cfg.parent ? ', puis les transmet à la ' + esc(cfg.parent) : ''}.</div></div>
      ${cles.length ? `<select id="ex-rm-cle" class="search-input">${cles.map((k) => `<option value="${esc(k)}" ${k === cle ? 'selected' : ''}>${esc(exLibCle(k))}</option>`).join('')}</select>` : ''}
      <button class="btn btn-sm" id="ex-rm-cfg">Paramètres</button>
      <button class="btn btn-accent" id="ex-rm-imp">Importer des bordereaux</button>
    </div>
    ${!config || !config.zone ? `<div class="alert alert-ocre">${niveau === 'sg' ? "Vous pouvez renseigner un intitulé" : 'Renseignez d\'abord votre ' + esc(cfg.zone.toLowerCase())} dans « Paramètres » (et la liste des ${esc(cfg.unite)} attendues pour détecter les manquants).</div>` : ''}
    ${dsCle.length ? `
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">${esc(cfg.unite)} reçues</div><div class="value">${dsCle.length}${attendus.length ? ' / ' + attendus.length : ''}</div><div class="foot">${manquants.length ? manquants.length + ' manquante(s)' : attendus.length ? 'toutes reçues' : ''}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Présents</div><div class="value">${cons.total.presents}</div><div class="foot">sur ${cons.total.inscrits} inscrits</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Admis</div><div class="value">${cons.total.admis}</div><div class="foot">${cons.filles.admis} filles · ${cons.garcons.admis} garçons</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Taux de réussite</div><div class="value">${exPct(exTauxBase(cons.total))}</div><div class="foot">filles ${exPct(exTauxBase(cons.filles))} · garçons ${exPct(exTauxBase(cons.garcons))}</div></div>
    </div>
    ${manquants.length ? `<div class="alert alert-ocre"><b>${manquants.length} ${esc(cfg.unite)}(s) n'ont pas encore transmis :</b> ${manquants.map(esc).join(', ')}.</div>` : ''}
    ${dsCle.some((p) => p.partiel) ? '<div class="alert alert-ocre">Certains bordereaux reçus sont marqués « partiels » (unités manquantes à leur niveau).</div>' : ''}
    <div class="table-toolbar no-print">
      <button class="btn btn-sm" id="ex-rm-etat">État récapitulatif (PDF)</button>
      <button class="btn btn-sm" id="ex-rm-csv">Excel (CSV)</button>
      ${cfg.parent && dir ? `<button class="btn btn-accent" id="ex-rm-up">Transmettre à la ${esc(cfg.parent)}</button>` : ''}
    </div>
    <div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr>
      <th>${esc(cfg.unite)}</th><th>Reçu le</th><th>Inscrits</th><th>Présents</th><th>Admis</th><th>Taux</th><th>Taux filles</th><th class="no-print"></th></tr></thead>
      <tbody>${recus.filter((r) => `${r.annee}|${r.typeExamen}` === cle).sort((a, b) => a.emetteurNom.localeCompare(b.emetteurNom, 'fr', { numeric: true })).map((r) => {
        const p = r.payload;
        return `<tr><td class="wrap" style="font-weight:700;">${esc(r.emetteurNom)}${p.partiel ? ' <span class="badge badge-ocre">partiel</span>' : ''}</td>
          <td>${esc(formatDate(String(r.recuLe).slice(0, 10)))}</td><td>${p.total.inscrits}</td><td>${p.total.presents}</td><td>${p.total.admis}</td>
          <td style="font-weight:700;">${exPct(exTauxBase(p.total))}</td><td>${exPct(exTauxBase(p.filles))}</td>
          <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-voir="${r.id}">Détail</button>${dir ? `<button class="btn btn-sm btn-danger" data-del="${r.id}">Retirer</button>` : ''}</div></td></tr>`;
      }).join('')}</tbody></table></div>
    ${cons.epreuves.length ? `<h3 style="margin:18px 0 8px;">Moyennes par épreuve (pondérées)</h3><div class="table-wrap">${exTab(['Épreuve', 'Copies notées', 'Moyenne /20'], cons.epreuves.map((e) => [esc(e.nom), e.nb, exFmt(e.moyenne)]), { centre: [1, 2], fs: 12 })}</div>` : ''}`
      : `<div class="empty-state"><div class="big">📥</div>Aucun bordereau reçu. ${esc(cfg.unite === 'CEB' ? "Les CEB transmettent leurs résultats depuis l'Espace Examen (onglet Résultats & PV, bouton « Transmettre à la DPEPPNF »)." : 'Importez les fichiers de remontée envoyés par les ' + cfg.unite + 's.')}</div>`}
    ${envois.length ? `<h3 style="margin:18px 0 8px;">Transmissions effectuées</h3><div class="table-wrap">${exTab(['Date', 'Examen', 'Vers', 'Empreinte', 'Par'], envois.map((e) => [esc(formatDate(String(e.date).slice(0, 10))), esc(exLibCle(`${e.annee}|${e.typeExamen}`)), esc(e.vers), `<span style="font-family:monospace;">${esc(e.empreinte)}</span>`, esc(e.par)]), { fs: 11.5 })}</div>` : ''}`;

  if ($('#ex-rm-cle')) $('#ex-rm-cle').onchange = (e) => { EX_REM[niveau] = e.target.value; onRouteChange(); };
  $('#ex-rm-cfg').onclick = () => exRemParametres(niveau, config);
  $('#ex-rm-imp').onclick = () => exRemImporter(niveau, config);
  if ($('#ex-rm-etat')) $('#ex-rm-etat').onclick = () => exDocEtatRecapitulatif(niveau, cle, dsCle, cons, config);
  if ($('#ex-rm-csv')) $('#ex-rm-csv').onclick = () => download(`consolidation-${niveau}-${cle.replace('|', '-')}.csv`, toCSV(dsCle, [
    { label: cfg.unite, value: (p) => p.emetteur.nom }, { label: 'Inscrits', value: (p) => p.total.inscrits }, { label: 'Présents', value: (p) => p.total.presents },
    { label: 'Admis', value: (p) => p.total.admis }, { label: 'Taux (%)', value: (p) => (exTauxBase(p.total) === null ? '' : exFmt(exTauxBase(p.total), 1)) },
    { label: 'Filles admises', value: (p) => p.filles.admis }, { label: 'Garçons admis', value: (p) => p.garcons.admis }, { label: 'Partiel', value: (p) => (p.partiel ? 'oui' : '') }
  ]), 'text/csv;charset=utf-8');
  if ($('#ex-rm-up')) $('#ex-rm-up').onclick = () => exRemTransmettre(niveau, cle, dsCle, config, manquants);
  $all('[data-voir]', root).forEach((b) => { b.onclick = () => exRemDetail(niveau, recus.find((r) => r.id === Number(b.dataset.voir))); });
  $all('[data-del]', root).forEach((b) => {
    b.onclick = async () => {
      const r = recus.find((x) => x.id === Number(b.dataset.del));
      if (r && await confirmDialog(`Retirer le bordereau de « ${r.emetteurNom} » de la consolidation ?`)) { await DB.delete('examRemontees', r.id); toast('Bordereau retiré.'); onRouteChange(); }
    };
  });
}

function exRemDetail(niveau, r) {
  const p = r.payload, cfg = EX_NIVEAUX[niveau];
  const sous = p.niveau === 'ceb' ? 'École' : EX_NIVEAUX[p.niveau] ? (p.niveau === 'dpeppnf' ? 'CEB' : 'Province') : 'Unité';
  openModal(`${p.emetteur.nom} — détail`, `
    <p class="text-soft" style="font-size:12.5px;">${esc(exLibCle(exCleSession(p)))} · établi le ${esc(formatDate(p.genere.slice(0, 10)))}${p.emetteur.province ? ' · province : ' + esc(p.emetteur.province) : ''}${p.emetteur.region ? ' · région : ' + esc(p.emetteur.region) : ''} · seuil ${p.seuil === null ? 'variable' : exFmt(p.seuil) + '/20'} · moyenne générale ${exFmt(p.moyenneGenerale)}/20</p>
    <div class="table-wrap">${exTab(EX_ENT_UNITES(sous), (p.unites || []).map((u) => exLigneUnite(u.nom, u)), { centre: [1, 2, 3, 4, 5, 6, 7, 8, 9], fs: 11 })}</div>
    ${p.manquants && p.manquants.length ? `<div class="alert alert-ocre" style="margin-top:8px;">Manquants à son niveau : ${p.manquants.map(esc).join(', ')}</div>` : ''}`, { wide: true, saveLabel: 'Fermer', onSave: async () => true });
}

async function exRemParametres(niveau, config) {
  const cfg = EX_NIVEAUX[niveau];
  openModal(`Paramètres — ${cfg.sigle}`, `
    <div class="form-grid">
      <div class="field full"><label>${esc(cfg.zone === 'National' ? 'Intitulé' : cfg.zone)} *</label><input id="ex-cf-zone" value="${esc((config && config.zone) || (niveau === 'sg' ? 'National' : ''))}" placeholder="${niveau === 'dpeppnf' ? 'Ex : nom de la province' : niveau === 'dreppnf' ? 'Ex : nom de la région' : ''}"></div>
      ${niveau === 'dpeppnf' ? `<div class="field full"><label>Région de rattachement *</label><input id="ex-cf-parent" value="${esc((config && config.parent) || '')}"><small>Nécessaire pour que la DREPPNF contrôle l'origine de votre bordereau.</small></div>` : ''}
      <div class="field full"><label>${esc(cfg.unite)}(s) attendue(s) — une par ligne</label><textarea id="ex-cf-att" style="min-height:120px;">${esc(((config && config.attendus) || []).join('\n'))}</textarea><small>Permet de voir en un coup d'œil quelles ${esc(cfg.unite)} n'ont pas encore transmis.</small></div>
    </div>`, {
    onSave: async (o) => {
      const zone = $('#ex-cf-zone', o).value.trim();
      if (!zone) { toast('Indiquez ' + (niveau === 'sg' ? "l'intitulé." : 'votre ' + cfg.zone.toLowerCase() + '.')); return false; }
      const parent = $('#ex-cf-parent', o) ? $('#ex-cf-parent', o).value.trim() : '';
      if (niveau === 'dpeppnf' && !parent) { toast('Indiquez la région de rattachement.'); return false; }
      await exRemEnregistrer({ _uuid: deterministicUuid(`examRemConfig:${niveau}`), kind: 'config', niveau, zone, parent, attendus: $('#ex-cf-att', o).value.split('\n').map((x) => x.trim()).filter(Boolean) });
      toast('Paramètres enregistrés.');
      onRouteChange();
      return true;
    }
  });
}

/* Import d'un ou plusieurs fichiers .json */
function exRemImporter(niveau, config) {
  const cfg = EX_NIVEAUX[niveau];
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json'; inp.multiple = true;
  inp.onchange = async () => {
    const rapport = [];
    const { recus } = await exRemDonnees(niveau);
    for (const f of inp.files) {
      let p;
      try { p = JSON.parse(await f.text()); } catch (e) { rapport.push([f.name, ['Fichier illisible (JSON invalide).']]); continue; }
      const err = exValiderBordereau(p, niveau);
      if (!err.length && config && config.zone) {
        const zoneP = niveau === 'dpeppnf' ? p.emetteur.province : niveau === 'dreppnf' ? p.emetteur.region : '';
        if (niveau !== 'sg' && zoneP && !exMemeZone(zoneP, config.zone) && !(await confirmDialog(`Ce bordereau (« ${p.emetteur.nom} ») indique ${cfg.zone.toLowerCase()} « ${zoneP} », différente de la vôtre (« ${config.zone} »). L'importer quand même ?`))) { rapport.push([f.name, ['Ignoré : zone différente.']]); continue; }
      }
      if (err.length) { rapport.push([f.name, err]); continue; }
      const uuid = deterministicUuid(`examRem:${niveau}:${exCleSession(p)}:${exSansAccent(p.emetteur.nom)}`);
      const deja = recus.find((r) => r._uuid === uuid);
      if (deja) {
        const plusRecent = String(p.genere) > String(deja.payload.genere);
        if (!(await confirmDialog(`Un bordereau de « ${p.emetteur.nom} » existe déjà pour cette session (établi le ${formatDate(deja.payload.genere.slice(0, 10))}). Le nouveau est ${plusRecent ? 'plus récent' : 'PLUS ANCIEN'} (${formatDate(p.genere.slice(0, 10))}). Remplacer ?`))) { rapport.push([f.name, ['Ignoré : bordereau déjà reçu.']]); continue; }
      }
      await exRemEnregistrer({ _uuid: uuid, kind: 'recu', niveau, annee: p.annee, typeExamen: p.typeExamen, emetteurNom: p.emetteur.nom, payload: p, recuLe: new Date().toISOString() });
      EX_REM[niveau] = exCleSession(p);
      rapport.push([f.name, []]);
    }
    const ok = rapport.filter((r) => !r[1].length).length;
    openModal(`Import : ${ok} bordereau(x) accepté(s) sur ${rapport.length}`, rapport.map(([n, e]) => `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><b>${esc(n)}</b> — ${e.length ? `<span style="color:var(--terre-600);">refusé</span><ul style="margin:4px 0 0 18px;">${e.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span style="color:var(--vert-600);">accepté ✔</span>'}</div>`).join(''), { saveLabel: 'Fermer', onSave: async () => { onRouteChange(); return true; } });
    onRouteChange();
  };
  inp.click();
}

/* Transmission vers le niveau supérieur */
async function exRemTransmettre(niveau, cle, payloads, config, manquants) {
  const cfg = EX_NIVEAUX[niveau];
  if (!exDirection()) { toast('Seule la direction peut transmettre.'); return; }
  if (!config || !config.zone || (niveau === 'dpeppnf' && !config.parent)) { toast('Complétez d\'abord les paramètres (zone et région).'); return; }
  if (!payloads.length) { toast('Aucun bordereau à consolider.'); return; }
  if (manquants.length && !(await confirmDialog(`${manquants.length} ${cfg.unite}(s) n'ont pas transmis (${manquants.slice(0, 5).join(', ')}${manquants.length > 5 ? '…' : ''}). Transmettre quand même une remontée PARTIELLE ?`))) return;
  const [annee, typeExamen] = cle.split('|');
  const emetteur = niveau === 'dpeppnf' ? { nom: config.zone, province: config.zone, region: config.parent } : { nom: config.zone, province: '', region: config.zone };
  const p = exConstruireBordereauNiveau(niveau, payloads, emetteur, annee, typeExamen, payloads[0].libelle || '', manquants);
  download(`remontee-${niveau}-${exSansAccent(config.zone).replace(/[^a-z0-9]+/g, '-')}-${annee}.json`, JSON.stringify(p), 'application/json;charset=utf-8');
  await exRemEnregistrer({ _uuid: genUuid(), kind: 'envoi', niveau, annee, typeExamen, vers: cfg.parent, empreinte: p.empreinte, date: new Date().toISOString(), par: currentUser ? currentUser.nom : '' });
  toast('Fichier de remontée créé.');
  setTimeout(() => exDocBordereauTransmission(p, cfg.parent === 'DREPPNF' ? `DREPPNF — région ${config.parent}` : 'Secrétariat général du MEBAPLN'), 400);
  onRouteChange();
}
