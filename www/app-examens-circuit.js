/* ============================================================
   app-examens-circuit.js — Circuit officiel du CEP
   ------------------------------------------------------------
   Ministère (SG MEBAPLN / DGEC) → DREPPNF → DPEPPNF → CEB → École
   - Vue d'ensemble (#/cep) : l'organisation et le rôle de chaque niveau.
   - Documents (#/cep-documents) : documents DESCENDANTS (circulaires,
     calendrier, instructions… du ministère jusqu'aux écoles) et ASCENDANTS
     (listes, états, rapports, PV… des écoles jusqu'au ministère). Chaque
     niveau les importe, accuse réception, les relaie.
   - École (#/cep-ecole) : l'école inscrit ses candidats (fichier envoyé à la
     CEB) et reçoit en retour les résultats de ses candidats.
   - CEB : import des inscriptions des écoles, envoi des résultats par école.
   Tout circule par fichiers .json (aucun serveur commun) ; chaque fichier
   porte une empreinte qui détecte une erreur ou une modification. Magasin :
   examRemontees (kind = doc | identite | inscription | resultatsEcole).
   ============================================================ */

const EX_ORDRE = ['sg', 'dreppnf', 'dpeppnf', 'ceb', 'ecole'];
const EX_CIRCUIT = {
  sg: { sigle: 'Ministère', nom: 'SG MEBAPLN — Secrétariat général (direction générale des examens et concours)', route: '#/exam-sg',
    role: "Fixe le cadre national : circulaires, calendrier, instructions de conduite des épreuves. Reçoit le bilan national des résultats." },
  dreppnf: { sigle: 'DREPPNF', nom: 'Direction régionale', route: '#/exam-dreppnf',
    role: "Relaie les instructions aux provinces, coordonne l'organisation régionale, consolide les résultats des provinces et les transmet au ministère." },
  dpeppnf: { sigle: 'DPEPPNF', nom: 'Direction provinciale', route: '#/exam-dpeppnf',
    role: "Relaie les instructions aux CEB, suit l'organisation provinciale (centres, jurys), consolide les résultats des CEB et les transmet à la région." },
  ceb: { sigle: 'CEB', nom: "Circonscription d'éducation de base", route: '#/examens',
    role: "Organise l'examen : reçoit les inscriptions des écoles, constitue jurys, centres et salles, affecte les acteurs, supervise la correction, délibère, publie les résultats et les transmet à la province." },
  ecole: { sigle: 'École', nom: "École primaire", route: '#/cep-ecole',
    role: "Inscrit les candidats auprès de la CEB, applique les instructions reçues, reçoit les résultats de ses candidats." }
};
const EX_CAT_DESC = ['Circulaire / note de service', 'Calendrier des examens', 'Instructions de conduite des épreuves', 'Répartition des centres et des jurys', 'Modèle de document / formulaire', 'Communiqué (consignes, résultats)', 'Autre'];
const EX_CAT_ASC = ["Liste d'inscription des candidats", 'Effectifs / état de situation', 'Rapport de déroulement / incidents', 'Procès-verbal', 'Résultats (bordereau)', 'Demande / correspondance', 'Autre'];
const EX_PHASES = [
  ['Préparation', 'Circulaire d\'organisation, calendrier, modèles de documents (↓)'],
  ['Inscription', "Listes d'inscription des écoles (↑ vers la CEB), effectifs consolidés (↑)"],
  ['Organisation', 'Répartition des centres et des jurys, convocations des acteurs (↓)'],
  ['Composition', 'Instructions de conduite des épreuves (↓), rapports d\'incidents (↑)'],
  ['Correction et délibération', 'Procès-verbaux des jurys (↑)'],
  ['Résultats', 'Bordereaux de résultats (↑), résultats par école (↓), communiqué (↓)']
];
const EX_PJ_MAX = 1.5 * 1024 * 1024; // pièce jointe : 1,5 Mo maximum (le fichier circule par WhatsApp, e-mail…)
const EX_DOC = { sens: 'descendant' };

/* ---------------- Calculs purs ---------------- */
const exIdx = (n) => EX_ORDRE.indexOf(n);
function exDernierNiveau(p) { const c = p.chaine || []; return c.length ? c[c.length - 1].niveau : p.emetteur.niveau; }

function exValiderPaquet(p, format) {
  if (!p || typeof p !== 'object' || p.format !== format) return ["Ce fichier n'est pas du bon type pour cette opération."];
  const err = [];
  if (p.version !== 1) err.push('Version de format non prise en charge.');
  if (p.empreinte !== exEmpreinte(p)) err.push("Empreinte invalide : le fichier a été modifié ou corrompu. Demandez à l'émetteur de le régénérer.");
  return err;
}

function exConstruireDocument(o) {
  const p = {
    format: 'ecole-numerique/document', version: 1, id: genUuid(), sens: o.sens, categorie: o.categorie, reference: o.reference || '', objet: o.objet,
    contenu: o.contenu || '', echeance: o.echeance || '', annee: o.annee || '', emetteur: o.emetteur, chaine: [], genere: new Date().toISOString(), pj: o.pj || null
  };
  p.empreinte = exEmpreinte(p);
  return p;
}
function exRelayerDocument(p, relais) {
  const q = JSON.parse(JSON.stringify(p));
  q.chaine = [...(q.chaine || []), { niveau: relais.niveau, nom: relais.nom, date: new Date().toISOString() }];
  q.empreinte = exEmpreinte(q);
  return q;
}
function exValiderDocument(p, monNiveau) {
  const err = exValiderPaquet(p, 'ecole-numerique/document');
  if (err.length && !p) return err;
  if (!p || typeof p !== 'object' || p.format !== 'ecole-numerique/document') return err;
  if (!['descendant', 'ascendant'].includes(p.sens)) err.push('Sens du document invalide.');
  if (typeof p.id !== 'string' || !p.id) err.push('Identifiant du document manquant.');
  if (typeof p.objet !== 'string' || !p.objet.trim()) err.push('Objet du document manquant.');
  if (!p.emetteur || typeof p.emetteur.nom !== 'string' || exIdx(p.emetteur.niveau) < 0) err.push('Émetteur invalide.');
  if (p.pj && (typeof p.pj.data !== 'string' || typeof p.pj.nom !== 'string' || p.pj.data.length > EX_PJ_MAX * 1.4)) err.push('Pièce jointe invalide ou trop volumineuse.');
  if (!err.length) {
    const d = exIdx(exDernierNiveau(p)), moi = exIdx(monNiveau);
    if (p.sens === 'descendant' && !(d < moi)) err.push(`Ce document descendant vient de « ${EX_CIRCUIT[exDernierNiveau(p)].sigle} », qui n'est pas au-dessus de votre niveau (${EX_CIRCUIT[monNiveau].sigle}).`);
    if (p.sens === 'ascendant' && !(d > moi)) err.push(`Ce document ascendant vient de « ${EX_CIRCUIT[exDernierNiveau(p)].sigle} », qui n'est pas en dessous de votre niveau (${EX_CIRCUIT[monNiveau].sigle}).`);
  }
  return err;
}

function exConstruireInscriptions(ecole, annee, candidats) {
  const p = { format: 'ecole-numerique/inscriptions', version: 1, annee, ecole, genere: new Date().toISOString(), candidats };
  p.empreinte = exEmpreinte(p);
  return p;
}
const exCleCand = (c, ecole) => [exSansAccent(c.nom), exSansAccent(c.prenom), c.dateNaissance || '', exCleEcole(ecole)].join('|');
/* Fusion des inscriptions reçues avec les candidats déjà présents : aucun doublon */
function exFusionInscriptions(existants, paquet) {
  const vus = new Set(existants.map((c) => exCleCand(c, c.ecole)));
  const vusUuid = new Set(existants.filter((c) => c.eleveUuid).map((c) => `${exCleEcole(c.ecole)}|${c.eleveUuid}`));
  const ajouts = []; let doublons = 0, invalides = 0;
  (paquet.candidats || []).forEach((c) => {
    if (!c || typeof c.nom !== 'string' || !c.nom.trim() || typeof c.prenom !== 'string' || !c.prenom.trim()) { invalides++; return; }
    const k = exCleCand(c, paquet.ecole.nom), ku = c.eleveUuid ? `${exCleEcole(paquet.ecole.nom)}|${c.eleveUuid}` : null;
    if (vus.has(k) || (ku && vusUuid.has(ku))) { doublons++; return; }
    vus.add(k); if (ku) vusUuid.add(ku);
    ajouts.push(c);
  });
  return { ajouts, doublons, invalides };
}

function exConstruireResultatsEcole(session, res, ecole) {
  const ls = res.lignes.filter((l) => exCleEcole(l.candidat.ecole) === exCleEcole(ecole));
  const p = {
    format: 'ecole-numerique/resultats-ecole', version: 1, annee: session.annee, typeExamen: session.type, libelle: session.libelle, ceb: session.ceb || '',
    ecole, seuil: res.seuil, dateResultats: session.dateResultats || '', cloture: !!session.resultatsVerrouilles, genere: new Date().toISOString(),
    candidats: ls.map((l) => ({
      eleveUuid: l.candidat.eleveUuid || '', nom: l.candidat.nom, prenom: l.candidat.prenom, sexe: l.candidat.sexe === 'F' ? 'F' : 'M',
      numeroTable: l.candidat.numeroTable || '', moyenne: l.moyenne, decision: l.decision, repeche: !!l.repeche, mention: l.mention || '', rang: l.rang
    }))
  };
  p.empreinte = exEmpreinte(p);
  return p;
}

/* ---------------- Fichiers ---------------- */
function exLireBase64(file) {
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ko(r.error); r.readAsDataURL(file); });
}
function exTelechargerBase64(nom, mime, b64) {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([arr], { type: mime || 'application/octet-stream' }));
  a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
const exSlug = (s) => exSansAccent(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fichier';
function exChoisirFichiers(accept, multiple, cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
  inp.onchange = () => cb([...inp.files]);
  inp.click();
}

/* ---------------- Identité du niveau ---------------- */
async function exIdentite() {
  const [tous, meta0] = await Promise.all([DB.getAll('examRemontees'), DB.getAll('meta')]);
  const meta = meta0[0] || {};
  const id = tous.find((r) => r.kind === 'identite');
  // Compte du réseau : le niveau est celui de son rôle (ceb, dpeppnf, dreppnf, ministère = sg), pas un choix manuel
  const niveauCompte = currentUser && { ceb: 'ceb', dpeppnf: 'dpeppnf', dreppnf: 'dreppnf', ministere: 'sg' }[currentUser.role];
  const niveau = niveauCompte || (id && EX_CIRCUIT[id.niveau] ? id.niveau : 'ecole');
  const zone = (n) => { const c = tous.find((r) => r.kind === 'config' && r.niveau === n); return c ? c.zone : ''; };
  const noms = { ecole: meta.nomEcole || '', ceb: meta.ceb || '', dpeppnf: zone('dpeppnf') || meta.dpeppnf || '', dreppnf: zone('dreppnf') || meta.region || '', sg: 'SG MEBAPLN' };
  if (niveauCompte && currentUser.structure) noms[niveau] = currentUser.structure;
  return { niveau, nom: noms[niveau] || '', noms, meta, tous };
}

/* ============================================================
   VUE D'ENSEMBLE
   ============================================================ */
ROUTES['#/cep'] = async (root) => {
  const idt = await exIdentite();
  const docs = idt.tous.filter((r) => r.kind === 'doc');
  const nb = (sens, dir) => docs.filter((d) => d.sens === sens && d.direction === dir).length;
  root.innerHTML = `
    <div class="alert alert-ocre" style="margin-bottom:14px;">Le CEP s'organise de haut en bas puis de bas en haut : les <b>instructions descendent</b> du ministère jusqu'aux écoles, les <b>inscriptions, états et résultats remontent</b> des écoles jusqu'au ministère. Vous êtes : <b>${esc(EX_CIRCUIT[idt.niveau].sigle)}${idt.nom ? ' — ' + esc(idt.nom) : ''}</b> ${estCompteReseau() ? '' : '<a href="#/cep-documents" style="margin-left:6px;">(changer)</a>'}</div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${EX_ORDRE.map((n, i) => {
        const c = EX_CIRCUIT[n], moi = n === idt.niveau;
        return `<div class="card" style="padding:12px 16px;${moi ? 'border:2px solid var(--vert-600);' : ''}">
            <div class="flex items-center gap-12" style="flex-wrap:wrap;">
              <div style="flex:1;min-width:230px;"><div style="font-weight:800;font-size:15px;">${esc(c.sigle)}${moi ? ' <span class="badge badge-vert">vous</span>' : ''}</div>
                <div class="text-soft" style="font-size:12.5px;">${esc(c.nom)}</div>
                <div style="font-size:13px;margin-top:4px;">${esc(c.role)}</div></div>
              ${routeAutorisee(c.route) ? `<a class="btn btn-sm" href="${c.route}">Ouvrir</a>` : ''}
            </div></div>
          ${i < EX_ORDRE.length - 1 ? `<div style="text-align:center;font-size:12px;" class="text-soft">▼ instructions, calendrier, circulaires &nbsp;·&nbsp; ▲ inscriptions, états, résultats</div>` : ''}`;
      }).join('')}
    </div>
    <div class="grid grid-4" style="margin:16px 0;">
      <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">▼ Descendants reçus</div><div class="value">${nb('descendant', 'recu')}</div></div>
      <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">▼ Descendants émis</div><div class="value">${nb('descendant', 'emis')}</div></div>
      <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">▲ Ascendants reçus</div><div class="value">${nb('ascendant', 'recu')}</div></div>
      <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">▲ Ascendants émis</div><div class="value">${nb('ascendant', 'emis')}</div></div>
    </div>
    <h3 style="margin:8px 0;">Les temps de l'examen</h3>
    <div class="card" style="padding:6px 16px;">${EX_PHASES.map(([t, d], i) => `<div style="padding:10px 0;${i < EX_PHASES.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}"><b>${i + 1}. ${esc(t)}</b><div class="text-soft" style="font-size:12.5px;">${esc(d)}</div></div>`).join('')}</div>
    <p class="text-soft" style="font-size:12px;margin-top:10px;">Les catégories de documents sont indicatives : adaptez-les aux textes de votre ministère.</p>`;
};

/* ============================================================
   DOCUMENTS DESCENDANTS / ASCENDANTS
   ============================================================ */
ROUTES['#/cep-documents'] = async (root) => {
  const idt = await exIdentite();
  const mon = idt.niveau, cfg = EX_CIRCUIT[mon];
  const peutEmettreBas = mon !== 'ecole', peutEmettreHaut = mon !== 'sg';
  const sens = EX_DOC.sens;
  const docs = idt.tous.filter((r) => r.kind === 'doc' && r.sens === sens).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const dir = exDirection();
  const peutEmettre = sens === 'descendant' ? peutEmettreBas : peutEmettreHaut;

  root.innerHTML = `
    <div class="table-toolbar no-print">
      <label class="text-soft" style="font-size:12.5px;">Mon niveau</label>
      <select id="dc-niv" class="search-input">${EX_ORDRE.map((n) => `<option value="${n}" ${n === mon ? 'selected' : ''}>${esc(EX_CIRCUIT[n].sigle)}</option>`).join('')}</select>
      <input class="search-input" id="dc-nom" value="${esc(idt.nom)}" placeholder="Nom de mon entité (CEB, province, région, école)" style="min-width:220px;">
    </div>
    <div class="tabs no-print" id="dc-tabs">
      <button class="tab ${sens === 'descendant' ? 'active' : ''}" data-s="descendant">▼ Descendants (du ministère aux écoles)</button>
      <button class="tab ${sens === 'ascendant' ? 'active' : ''}" data-s="ascendant">▲ Ascendants (des écoles au ministère)</button>
    </div>
    <div class="table-toolbar no-print">
      <button class="btn btn-sm" id="dc-imp">Importer un document reçu</button>
      ${peutEmettre && dir ? `<button class="btn btn-accent" id="dc-new">+ Nouveau document ${sens === 'descendant' ? 'à diffuser vers le bas' : 'à envoyer vers le haut'}</button>` : ''}
      <div style="flex:1;"></div>
      <button class="btn btn-sm" id="dc-reg">Registre (PDF)</button>
    </div>
    ${sens === 'descendant' && !peutEmettreBas ? '<p class="text-soft" style="font-size:12.5px;">Une école reçoit les documents descendants mais n\'en émet pas.</p>' : ''}
    ${sens === 'ascendant' && !peutEmettreHaut ? '<p class="text-soft" style="font-size:12.5px;">Le ministère reçoit les documents ascendants mais n\'en émet pas vers le haut.</p>' : ''}
    ${docs.length ? `<div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr><th>Objet</th><th>Date</th><th>Réf.</th><th>Catégorie</th><th>De</th><th>Statut</th><th>Échéance</th><th class="no-print"></th></tr></thead><tbody>
      ${docs.map((d) => { const p = d.payload; return `<tr>
        <td class="wrap" style="font-weight:700;">${esc(p.objet)}${p.pj ? ' 📎' : ''}</td><td>${esc(formatDate(String(d.date).slice(0, 10)))}</td><td>${esc(p.reference) || '—'}</td>
        <td class="wrap">${esc(p.categorie)}</td><td class="wrap">${esc(EX_CIRCUIT[p.emetteur.niveau].sigle)} ${esc(p.emetteur.nom)}${(p.chaine || []).length ? `<div class="text-soft" style="font-size:11px;">via ${(p.chaine || []).map((c) => esc(EX_CIRCUIT[c.niveau].sigle)).join(' → ')}</div>` : ''}</td>
        <td>${d.direction === 'emis' ? '<span class="badge badge-indigo">Émis</span>' : d.accuse ? '<span class="badge badge-vert">Reçu · accusé</span>' : '<span class="badge badge-ocre">Reçu</span>'}</td>
        <td>${p.echeance ? esc(formatDate(p.echeance)) : '—'}</td>
        <td class="no-print"><div class="flex gap-8"><button class="btn btn-sm" data-ouvrir="${d.id}">Ouvrir</button>
          ${d.direction === 'recu' && !d.accuse ? `<button class="btn btn-sm" data-accuse="${d.id}">Accuser réception</button>` : ''}
          ${d.direction === 'recu' && dir && peutEmettre ? `<button class="btn btn-sm" data-relais="${d.id}">${sens === 'descendant' ? 'Relayer vers le bas' : 'Transmettre vers le haut'}</button>` : ''}
          ${dir ? `<button class="btn btn-sm btn-danger" data-del="${d.id}">Retirer</button>` : ''}</div></td></tr>`; }).join('')}
    </tbody></table></div>` : `<div class="empty-state"><div class="big">${sens === 'descendant' ? '▼' : '▲'}</div>Aucun document ${sens}. Importez un fichier reçu${peutEmettre ? ' ou créez un document' : ''}.</div>`}`;

  $('#dc-niv').onchange = async (e) => { await exSauverIdentite(e.target.value, idt.noms[e.target.value] || ''); onRouteChange(); };
  $('#dc-nom').onchange = async (e) => { await exSauverIdentite(mon, e.target.value.trim()); toast('Enregistré.'); onRouteChange(); };
  $('#dc-tabs').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) { EX_DOC.sens = b.dataset.s; onRouteChange(); } };
  $('#dc-imp').onclick = () => exImporterDocuments(idt);
  if ($('#dc-new')) $('#dc-new').onclick = () => exFormDocument(idt, sens);
  $('#dc-reg').onclick = () => exDocRegistre(idt, sens, docs);
  const par = (id) => docs.find((x) => x.id === Number(id));
  $all('[data-ouvrir]', root).forEach((b) => { b.onclick = () => exOuvrirDocument(par(b.dataset.ouvrir)); });
  $all('[data-accuse]', root).forEach((b) => { b.onclick = () => exAccuser(idt, par(b.dataset.accuse)); });
  $all('[data-relais]', root).forEach((b) => { b.onclick = () => exRelayer(idt, par(b.dataset.relais)); });
  $all('[data-del]', root).forEach((b) => { b.onclick = async () => { const d = par(b.dataset.del); if (d && await confirmDialog(`Retirer « ${d.payload.objet} » de la liste ?`)) { await DB.delete('examRemontees', d.id); onRouteChange(); } }; });
};

async function exSauverIdentite(niveau, nom) {
  const tous = await DB.getAll('examRemontees');
  const ex = tous.find((r) => r.kind === 'identite');
  if (ex) await DB.put('examRemontees', { ...ex, niveau, nom });
  else await DB.add('examRemontees', { _uuid: deterministicUuid('examIdentite'), kind: 'identite', niveau, nom });
}
async function exEnregistrerDoc(uuid, champs) {
  const ex = (await DB.getAll('examRemontees')).find((r) => r._uuid === uuid);
  if (ex) await DB.put('examRemontees', { ...ex, ...champs });
  else await DB.add('examRemontees', { _uuid: uuid, kind: 'doc', ...champs });
}

function exImporterDocuments(idt) {
  exChoisirFichiers('.json,application/json', true, async (files) => {
    const rapport = [];
    for (const f of files) {
      let p;
      try { p = JSON.parse(await f.text()); } catch (e) { rapport.push([f.name, ['Fichier illisible (JSON invalide).']]); continue; }
      const err = exValiderDocument(p, idt.niveau);
      if (err.length) { rapport.push([f.name, err]); continue; }
      const uuid = deterministicUuid(`examDoc:${p.id}:recu:${idt.niveau}`);
      const deja = idt.tous.find((r) => r._uuid === uuid);
      if (deja && !(await confirmDialog(`« ${p.objet} » a déjà été reçu (${deja.payload.chaine.length ? 'relayé' : 'original'}). Remplacer par ce fichier ?`))) { rapport.push([f.name, ['Ignoré : déjà reçu.']]); continue; }
      await exEnregistrerDoc(uuid, { direction: 'recu', sens: p.sens, docId: p.id, payload: p, date: new Date().toISOString(), accuse: deja ? deja.accuse : false });
      EX_DOC.sens = p.sens;
      rapport.push([f.name, []]);
    }
    const ok = rapport.filter((r) => !r[1].length).length;
    openModal(`Import : ${ok} document(s) accepté(s) sur ${rapport.length}`, rapport.map(([n, e]) => `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><b>${esc(n)}</b> — ${e.length ? `<span style="color:var(--terre-600);">refusé</span><ul style="margin:4px 0 0 18px;">${e.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span style="color:var(--vert-600);">accepté ✔</span>'}</div>`).join(''), { saveLabel: 'Fermer', onSave: async () => { onRouteChange(); return true; } });
    onRouteChange();
  });
}

function exOuvrirDocument(d) {
  if (!d) return;
  const p = d.payload;
  const ov = openModal(p.objet, `
    <p class="text-soft" style="font-size:12.5px;">${esc(p.categorie)}${p.reference ? ' · réf. ' + esc(p.reference) : ''} · de <b>${esc(EX_CIRCUIT[p.emetteur.niveau].sigle)} ${esc(p.emetteur.nom)}</b> · établi le ${esc(formatDate(p.genere.slice(0, 10)))}${p.echeance ? ' · <b>à traiter avant le ' + esc(formatDate(p.echeance)) + '</b>' : ''}</p>
    ${(p.chaine || []).length ? `<p class="text-soft" style="font-size:12px;">Circuit : ${esc(EX_CIRCUIT[p.emetteur.niveau].sigle)} → ${(p.chaine || []).map((c) => esc(EX_CIRCUIT[c.niveau].sigle + ' ' + c.nom)).join(' → ')}</p>` : ''}
    <div style="white-space:pre-wrap;font-size:14px;margin:10px 0;">${esc(p.contenu) || '<span class="text-soft">(pas de texte)</span>'}</div>
    ${p.pj ? `<button class="btn btn-sm" id="dc-pj">📎 ${esc(p.pj.nom)} (${Math.round(p.pj.data.length * 0.75 / 1024)} Ko)</button>` : ''}`, { saveLabel: 'Fermer', onSave: async () => true });
  if (p.pj) $('#dc-pj', ov).onclick = () => exTelechargerBase64(p.pj.nom, p.pj.type, p.pj.data);
}

async function exAccuser(idt, d) {
  if (!d) return;
  await exEnregistrerDoc(d._uuid, { accuse: true, accuseLe: new Date().toISOString(), accusePar: currentUser ? currentUser.nom : '' });
  toast('Réception enregistrée.');
  const p = d.payload;
  exPrint('Accusé de réception', exEnteteNiveau('Accusé de réception', esc(EX_CIRCUIT[idt.niveau].sigle + (idt.nom ? ' — ' + idt.nom : '')))
    + exTab(['Objet', 'Référence', 'Émis par', 'Établi le', 'Reçu le'], [[esc(p.objet), esc(p.reference), esc(EX_CIRCUIT[p.emetteur.niveau].sigle + ' ' + p.emetteur.nom), esc(formatDate(p.genere.slice(0, 10))), esc(formatDate(todayISO()))]], { fs: 12 })
    + `<p style="font-size:12px;margin-top:10px;">Empreinte du fichier reçu : <span style="font-family:monospace;">${esc(p.empreinte)}</span></p>`
    + exSignatures(['Le destinataire']));
  onRouteChange();
}

async function exRelayer(idt, d) {
  if (!d) return;
  const q = exRelayerDocument(d.payload, { niveau: idt.niveau, nom: idt.nom || EX_CIRCUIT[idt.niveau].sigle });
  download(`${exSlug(d.payload.objet)}-relais-${idt.niveau}.json`, JSON.stringify(q), 'application/json;charset=utf-8');
  await exEnregistrerDoc(deterministicUuid(`examDoc:${q.id}:emis:${idt.niveau}`), { direction: 'emis', sens: q.sens, docId: q.id, payload: q, date: new Date().toISOString(), accuse: true });
  toast('Fichier de relais créé : envoyez-le au niveau suivant.');
  onRouteChange();
}

function exFormDocument(idt, sens) {
  const cats = sens === 'descendant' ? EX_CAT_DESC : EX_CAT_ASC;
  let pj = null;
  const ov = openModal(sens === 'descendant' ? 'Nouveau document à diffuser vers le bas' : 'Nouveau document à envoyer vers le haut', `
    <div class="form-grid">
      <div class="field full"><label>Objet *</label><input id="dn-objet"></div>
      <div class="field"><label>Catégorie</label><select id="dn-cat">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label>Référence / n°</label><input id="dn-ref" placeholder="Ex : N°2026-014/…"></div>
      <div class="field"><label>À traiter avant le</label><input type="date" id="dn-ech"></div>
      <div class="field full"><label>Texte / instructions</label><textarea id="dn-txt" style="min-height:120px;"></textarea></div>
      <div class="field full"><label>Pièce jointe (PDF, image, Word…, 1,5 Mo max)</label><input type="file" id="dn-pj"><small id="dn-pj-info"></small></div>
    </div>`, {
    saveLabel: 'Créer le fichier',
    onSave: async (o) => {
      const objet = $('#dn-objet', o).value.trim();
      if (!objet) { toast("Indiquez l'objet du document."); return false; }
      const p = exConstruireDocument({
        sens, categorie: $('#dn-cat', o).value, reference: $('#dn-ref', o).value.trim(), objet, contenu: $('#dn-txt', o).value.trim(), echeance: $('#dn-ech', o).value,
        annee: idt.meta.anneeScolaire || '', emetteur: { niveau: idt.niveau, nom: idt.nom || EX_CIRCUIT[idt.niveau].sigle }, pj
      });
      download(`${exSlug(objet)}.json`, JSON.stringify(p), 'application/json;charset=utf-8');
      await exEnregistrerDoc(deterministicUuid(`examDoc:${p.id}:emis:${idt.niveau}`), { direction: 'emis', sens, docId: p.id, payload: p, date: p.genere, accuse: true });
      toast('Fichier créé : envoyez-le (WhatsApp, e-mail, clé USB).');
      onRouteChange();
      return true;
    }
  });
  $('#dn-pj', ov).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) { pj = null; return; }
    if (f.size > EX_PJ_MAX) { toast('Pièce jointe trop volumineuse (1,5 Mo maximum).'); e.target.value = ''; pj = null; return; }
    pj = { nom: f.name, type: f.type || 'application/octet-stream', data: await exLireBase64(f) };
    $('#dn-pj-info', ov).textContent = `${f.name} prête (${Math.round(f.size / 1024)} Ko).`;
  };
}

function exDocRegistre(idt, sens, docs) {
  exPrint('Registre des documents', exEnteteNiveau(`Registre des documents ${sens === 'descendant' ? 'descendants' : 'ascendants'}`, esc(EX_CIRCUIT[idt.niveau].sigle + (idt.nom ? ' — ' + idt.nom : '')))
    + exTab(['Date', 'Réf.', 'Objet', 'Catégorie', 'De', 'Statut', 'Échéance'], docs.map((d) => [esc(formatDate(String(d.date).slice(0, 10))), esc(d.payload.reference), esc(d.payload.objet), esc(d.payload.categorie), esc(EX_CIRCUIT[d.payload.emetteur.niveau].sigle + ' ' + d.payload.emetteur.nom), d.direction === 'emis' ? 'Émis' : d.accuse ? 'Reçu (accusé)' : 'Reçu', d.payload.echeance ? esc(formatDate(d.payload.echeance)) : '']), { fs: 10.5 }));
}

/* ============================================================
   ÉCOLE : inscriptions (→ CEB) et résultats (← CEB)
   ============================================================ */
let _exFileInsc = Promise.resolve();
async function exSauverSelection(annee, maj) {
  const p = _exFileInsc.then(async () => {
    const uuid = deterministicUuid(`examInsc:${annee}`);
    const ex = (await DB.getAll('examRemontees')).find((r) => r._uuid === uuid);
    const sel = { ...((ex && ex.selection) || {}) };
    maj(sel);
    if (ex) await DB.put('examRemontees', { ...ex, selection: sel });
    else await DB.add('examRemontees', { _uuid: uuid, kind: 'inscription', annee, selection: sel });
  });
  _exFileInsc = p.catch(() => {});
  return p;
}

ROUTES['#/cep-ecole'] = async (root) => {
  const [classes, eleves, tous, meta0] = await Promise.all([DB.getAll('classes'), DB.getAll('eleves'), DB.getAll('examRemontees'), DB.getAll('meta')]);
  const meta = meta0[0] || {};
  const annee = meta.anneeScolaire || anneeScolaireCourante();
  const insc = tous.find((r) => r.kind === 'inscription' && r.annee === annee);
  const sel = (insc && insc.selection) || {};
  const resRecs = tous.filter((r) => r.kind === 'resultatsEcole').sort((a, b) => String(b.payload.genere).localeCompare(String(a.payload.genere)));
  const res = resRecs[0] ? resRecs[0].payload : null;
  const cm2 = classes.find((k) => /CM2/i.test(k.nom || k.niveau || ''));
  if (!EX_DOC.classeId || !classes.some((k) => k.id === EX_DOC.classeId)) EX_DOC.classeId = (cm2 || classes[0] || {}).id;
  const liste = eleves.filter((e) => e.classeId === EX_DOC.classeId && (e.statut || 'actif') === 'actif').sort(exCmpNom);
  const nbCand = Object.values(sel).filter((s) => s && s.candidat).length;

  root.innerHTML = `
    <div class="alert alert-ocre">Espace de l'école <b>${esc(meta.nomEcole || '(nom de l\'école à renseigner dans les paramètres)')}</b> — CEB : <b>${esc(meta.ceb || '—')}</b>. Année ${esc(annee)}.</div>
    <h3 style="margin:8px 0;">1. Inscription des candidats (▲ envoyée à la CEB)</h3>
    <div class="table-toolbar no-print">
      <select id="ec-classe" class="search-input">${classes.map((k) => `<option value="${k.id}" ${k.id === EX_DOC.classeId ? 'selected' : ''}>${esc(k.nom)}</option>`).join('')}</select>
      <span class="badge badge-indigo">${nbCand} candidat(s) retenu(s)</span>
      <div style="flex:1;"></div>
      <button class="btn btn-accent" id="ec-gen">Créer le fichier d'inscription pour la CEB</button>
    </div>
    ${liste.length ? `<div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr><th>Élève</th><th>Candidat</th><th>Examen</th><th>Besoins spécifiques</th><th>Handicap</th><th>Bilingue</th><th>Dossier</th></tr></thead><tbody>
      ${liste.map((e) => { const s = sel[e._uuid] || {}; const ok = e.dateNaissance;
        return `<tr data-e="${esc(e._uuid || '')}" data-id="${e.id}"><td class="wrap" style="font-weight:600;">${esc(exNomComplet(e))} <span class="text-soft">(${e.sexe === 'F' ? 'F' : 'M'})</span></td>
          <td style="text-align:center;"><input type="checkbox" data-k="candidat" ${s.candidat ? 'checked' : ''}></td>
          <td><select data-k="examens" style="padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--card);color:var(--ink);">${EX_EXAMENS.map((x) => `<option ${(s.examens || 'CEP seul') === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
          <td><input data-k="besoins" value="${esc(s.besoins || '')}" placeholder="Aménagement…" style="min-width:160px;"></td>
          <td style="text-align:center;"><input type="checkbox" data-k="handicap" ${e.handicap ? 'checked' : ''} title="Situation de handicap (fiche de l'élève)"></td>
          <td style="text-align:center;"><input type="checkbox" data-k="bilingue" ${e.bilingue ? 'checked' : ''} title="Candidat bilingue (fiche de l'élève)"></td>
          <td>${ok ? '<span class="badge badge-vert">complet</span>' : '<span class="badge badge-ocre">date de naissance manquante</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<div class="empty-state">Aucun élève actif dans cette classe.</div>'}
    <h3 style="margin:22px 0 8px;">2. Résultats de l'école (▼ reçus de la CEB)</h3>
    <div class="table-toolbar no-print"><button class="btn btn-sm" id="ec-imp">Importer le fichier de résultats de la CEB</button></div>
    ${res ? `<div class="card" style="padding:12px 16px;margin-bottom:10px;"><b>${esc(res.libelle)}</b> — ${esc(res.ecole)} · CEB ${esc(res.ceb)} · établi le ${esc(formatDate(res.genere.slice(0, 10)))}${res.cloture ? '' : ' <span class="badge badge-ocre">provisoire (délibération non clôturée)</span>'}</div>
      <div class="grid grid-4" style="margin-bottom:10px;">
        <div class="card stat-card c-indigo"><div class="accent-bar"></div><div class="label">Candidats</div><div class="value">${res.candidats.length}</div></div>
        <div class="card stat-card c-vert"><div class="accent-bar"></div><div class="label">Admis</div><div class="value">${res.candidats.filter((c) => c.decision === 'admis').length}</div></div>
        <div class="card stat-card c-terre"><div class="accent-bar"></div><div class="label">Ajournés</div><div class="value">${res.candidats.filter((c) => c.decision === 'ajourne').length}</div></div>
        <div class="card stat-card c-ocre"><div class="accent-bar"></div><div class="label">Taux de réussite</div><div class="value">${(() => { const pr = res.candidats.filter((c) => c.decision !== 'absent').length; return pr ? exFmt(res.candidats.filter((c) => c.decision === 'admis').length / pr * 100, 1) + ' %' : '—'; })()}</div></div></div>
      <div class="table-toolbar no-print"><button class="btn btn-sm" id="ec-pdf">Résultats de l'école (PDF)</button>${res.typeExamen !== 'blanc' && res.cloture && exDirection() ? '<button class="btn btn-accent" id="ec-report">Reporter les admis dans les dossiers élèves</button>' : ''}</div>
      <div class="table-wrap"><table class="ex-grille" style="font-size:12.5px;"><thead><tr><th>Candidat</th><th>N° table</th><th>Moyenne /20</th><th>Décision</th><th>Mention</th><th>Rang</th></tr></thead><tbody>
      ${[...res.candidats].sort((a, b) => exCmpNom(a, b)).map((c) => `<tr><td class="wrap" style="font-weight:600;">${esc(exNomComplet(c))}</td><td>${esc(c.numeroTable) || '—'}</td><td style="text-align:center;">${exFmt(c.moyenne)}</td><td>${esc(EX_DECISIONS[c.decision] || c.decision)}${c.repeche ? ' (repêché)' : ''}</td><td>${esc(c.mention) || '—'}</td><td>${c.rang ?? '—'}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty-state">Aucun résultat reçu pour le moment. La CEB vous enverra un fichier après la délibération.</div>'}`;

  $('#ec-classe') && ($('#ec-classe').onchange = (e) => { EX_DOC.classeId = Number(e.target.value); onRouteChange(); });
  $all('tr[data-e] [data-k]', root).forEach((el) => {
    el.onchange = async () => {
      const tr = el.closest('tr'), uuid = tr.dataset.e;
      if (!uuid) { const e = eleves.find((x) => x.id === Number(tr.dataset.id)); if (e) { e._uuid = genUuid(); await DB.put('eleves', e); tr.dataset.e = e._uuid; } }
      const u = tr.dataset.e;
      if (el.dataset.k === 'handicap' || el.dataset.k === 'bilingue') { const el2 = eleves.find((x) => x.id === Number(tr.dataset.id)); if (el2) { el2[el.dataset.k] = el.checked; await DB.put('eleves', el2); } return; }
      await exSauverSelection(annee, (s) => {
        const cur = { ...(s[u] || {}) };
        const k = el.dataset.k;
        if (k === 'candidat') cur.candidat = el.checked; else if (k === 'examens') cur.examens = el.value; else cur.besoins = el.value.trim();
        s[u] = cur;
      });
    };
  });
  $('#ec-gen').onclick = () => exGenererInscriptions(meta, annee, eleves);
  $('#ec-imp').onclick = () => exImporterResultatsEcole(meta);
  if ($('#ec-pdf')) $('#ec-pdf').onclick = () => exDocResultatsEcole(res);
  if ($('#ec-report')) $('#ec-report').onclick = () => exReporterEcole(res, eleves);
};

async function exGenererInscriptions(meta, annee, eleves) {
  if (!routeAutorisee('#/cep-ecole')) return;
  const insc = (await DB.getAll('examRemontees')).find((r) => r.kind === 'inscription' && r.annee === annee);
  const sel = (insc && insc.selection) || {};
  const choisis = eleves.filter((e) => e._uuid && sel[e._uuid] && sel[e._uuid].candidat).sort(exCmpNom);
  if (!choisis.length) { toast('Cochez au moins un candidat.'); return; }
  if (!String(meta.nomEcole || '').trim() || !String(meta.ceb || '').trim()) { toast("Renseignez le nom de l'école et la CEB dans les paramètres de l'école."); return; }
  const sans = choisis.filter((e) => !e.dateNaissance);
  if (sans.length && !(await confirmDialog(`${sans.length} candidat(s) n'ont pas de date de naissance (${sans.slice(0, 3).map(exNomComplet).join(', ')}…). Créer le fichier quand même ?`))) return;
  const cands = choisis.map((e) => ({ eleveUuid: e._uuid, nom: e.nom || '', prenom: e.prenom || '', sexe: e.sexe === 'F' ? 'F' : 'M', dateNaissance: e.dateNaissance || '', lieuNaissance: String((e.fiche && e.fiche.lieuNaissance) || '').trim(), matricule: e.matricule || '', examens: sel[e._uuid].examens || 'CEP seul', besoinsSpecifiques: sel[e._uuid].besoins || '', handicap: !!e.handicap, bilingue: !!e.bilingue }));
  const p = exConstruireInscriptions({ nom: meta.nomEcole, ceb: meta.ceb, province: meta.dpeppnf || '', region: meta.region || '' }, annee, cands);
  download(`inscriptions-${exSlug(meta.nomEcole)}-${exSlug(annee)}.json`, JSON.stringify(p), 'application/json;charset=utf-8');
  await DB.add('examRemontees', { _uuid: genUuid(), kind: 'envoi', niveau: 'ecole', annee, typeExamen: 'cep', vers: 'CEB ' + meta.ceb, empreinte: p.empreinte, date: new Date().toISOString(), par: currentUser ? currentUser.nom : '' });
  toast(`Fichier d'inscription créé (${cands.length} candidats) : envoyez-le à la CEB.`);
  exPrint("Liste des candidats de l'école", exEnteteNiveau("Liste des candidats présentés par l'école", `${esc(meta.nomEcole)} — CEB ${esc(meta.ceb)} — ${esc(annee)}`)
    + exTab(['N°', 'Nom et prénom(s)', 'Sexe', 'Né(e) le', 'Lieu de naissance', 'Matricule', 'Examen', 'Besoins spécifiques', 'Handicap', 'Bilingue'], cands.map((c, i) => [i + 1, esc(exNomComplet(c)), c.sexe, c.dateNaissance ? esc(formatDate(c.dateNaissance)) : '—', esc(c.lieuNaissance) || '—', esc(c.matricule), esc(c.examens), esc(c.besoinsSpecifiques), c.handicap ? 'Oui' : '', c.bilingue ? 'Oui' : '']), { centre: [0, 2, 7, 8], fs: 11 })
    + exSignatures(["Le Directeur de l'école", 'Le Chef de CEB (visa)']));
}

function exImporterResultatsEcole(meta) {
  exChoisirFichiers('.json,application/json', false, async (files) => {
    const f = files[0]; if (!f) return;
    let p;
    try { p = JSON.parse(await f.text()); } catch (e) { toast('Fichier illisible.'); return; }
    const err = exValiderPaquet(p, 'ecole-numerique/resultats-ecole');
    if (err.length) { toast(err[0]); return; }
    if (exSansAccent(p.ecole) !== exSansAccent(meta.nomEcole) && !(await confirmDialog(`Ces résultats concernent l'école « ${p.ecole} », différente de la vôtre (« ${meta.nomEcole || 'non renseignée'} »). Les importer quand même ?`))) return;
    const uuid = deterministicUuid(`examResEcole:${p.annee}:${p.typeExamen}`);
    const ex = (await DB.getAll('examRemontees')).find((r) => r._uuid === uuid);
    if (ex) await DB.put('examRemontees', { ...ex, payload: p }); else await DB.add('examRemontees', { _uuid: uuid, kind: 'resultatsEcole', payload: p });
    toast(`Résultats importés (${p.candidats.length} candidats).`);
    onRouteChange();
  });
}
function exDocResultatsEcole(r) {
  exPrint("Résultats de l'école", exEnteteNiveau(`Résultats — ${r.libelle}`, `${esc(r.ecole)} — CEB ${esc(r.ceb)}`)
    + exTab(['N°', 'N° table', 'Nom et prénom(s)', 'Sexe', 'Moyenne /20', 'Décision', 'Mention'], [...r.candidats].sort(exCmpNom).map((c, i) => [i + 1, esc(c.numeroTable), esc(exNomComplet(c)), c.sexe, exFmt(c.moyenne), esc((EX_DECISIONS[c.decision] || c.decision) + (c.repeche ? ' (repêché)' : '')), esc(c.mention)]), { centre: [0, 1, 3, 4], fs: 11 })
    + exSignatures(["Le Directeur de l'école"]));
}
async function exReporterEcole(r, eleves) {
  const admis = r.candidats.filter((c) => c.decision === 'admis' && c.eleveUuid);
  if (!admis.length) { toast("Aucun admis n'est relié à un dossier de l'école."); return; }
  const date = r.dateResultats || todayISO();
  if (!(await confirmDialog(`Marquer ${admis.length} élève(s) comme « Diplômé (CEP obtenu) » au ${formatDate(date)} ?`))) return;
  let n = 0;
  for (const c of admis) {
    const e = eleves.find((x) => x._uuid === c.eleveUuid);
    if (!e) continue;
    e.statut = 'diplome'; e.dateCEP = date; if (!e.dateSortie) e.dateSortie = date; if (!e.statutMotif) e.statutMotif = `CEP ${r.annee}`;
    await DB.put('eleves', e); n++;
  }
  toast(`${n} dossier(s) mis à jour.`);
  onRouteChange();
}

/* ============================================================
   CEB : inscriptions reçues des écoles / résultats envoyés aux écoles
   ============================================================ */
function exImporterInscriptions(ctx) {
  if (!exAutorise() || exVerrouille(ctx.session)) return;
  exChoisirFichiers('.json,application/json', true, async (files) => {
    const rapport = [];
    let existants = [...ctx.candidats];
    for (const f of files) {
      let p;
      try { p = JSON.parse(await f.text()); } catch (e) { rapport.push([f.name, 'refusé : fichier illisible']); continue; }
      const err = exValiderPaquet(p, 'ecole-numerique/inscriptions');
      if (err.length) { rapport.push([f.name, 'refusé : ' + err[0]]); continue; }
      if (!p.ecole || typeof p.ecole.nom !== 'string' || !p.ecole.nom.trim() || !Array.isArray(p.candidats)) { rapport.push([f.name, 'refusé : contenu invalide']); continue; }
      const { ajouts, doublons, invalides } = exFusionInscriptions(existants, p);
      for (const c of ajouts) {
        const obj = {
          _uuid: genUuid(), sessionUuid: ctx.session._uuid, eleveUuid: c.eleveUuid || '', nom: c.nom, prenom: c.prenom, sexe: c.sexe === 'F' ? 'F' : 'M',
          dateNaissance: c.dateNaissance || '', lieuNaissance: c.lieuNaissance || '', matricule: c.matricule || '', ecole: p.ecole.nom, examens: EX_EXAMENS.includes(c.examens) ? c.examens : 'CEP seul',
          statut: 'inscrit', centreUuid: '', salle: '', numeroTable: '', anonymat: '', besoinsSpecifiques: c.besoinsSpecifiques || '', handicap: !!c.handicap, bilingue: !!c.bilingue
        };
        obj.id = await DB.add('examCandidats', obj);
        existants.push(obj);
      }
      rapport.push([f.name, `${p.ecole.nom} : ${ajouts.length} ajouté(s)${doublons ? `, ${doublons} déjà présent(s)` : ''}${invalides ? `, ${invalides} invalide(s) ignoré(s)` : ''}`]);
    }
    openModal('Inscriptions des écoles', rapport.map(([n, m]) => `<div style="padding:6px 0;border-bottom:1px solid var(--border);"><b>${esc(n)}</b><br>${esc(m)}</div>`).join('') + '<p class="text-soft" style="font-size:12px;margin-top:8px;">Pensez à relancer la répartition pour numéroter les nouveaux candidats.</p>', { saveLabel: 'Fermer', onSave: async () => { onRouteChange(); return true; } });
    onRouteChange();
  });
}

function exExporterResultatsEcoles(ctx, res) {
  if (!exDirection()) { toast('Seule la direction peut envoyer les résultats.'); return; }
  if (!ctx.session.resultatsVerrouilles) { toast("Clôturez d'abord la délibération."); return; }
  const ecoles = [...new Set(ctx.candidats.map((c) => c.ecole).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (!ecoles.length) { toast('Aucune école.'); return; }
  const ov = openModal('Résultats par école (▼ vers les écoles)', `
    <p>Chaque école reçoit un fichier <b>ne contenant que ses propres candidats</b> (moyenne, décision, mention, rang).</p>
    <div class="field"><label>École</label><select id="re-ecole">${ecoles.map((e) => `<option>${esc(e)}</option>`).join('')}</select></div>
    <button class="btn btn-sm" id="re-tous" style="margin-top:10px;">Télécharger un fichier par école (${ecoles.length})</button>`, {
    saveLabel: 'Télécharger pour cette école',
    onSave: async (o) => { const e = $('#re-ecole', o).value; const p = exConstruireResultatsEcole(ctx.session, res, e); download(`resultats-${exSlug(e)}-${exSlug(ctx.session.annee)}.json`, JSON.stringify(p), 'application/json;charset=utf-8'); toast(`Fichier créé pour ${e}.`); return true; }
  });
  $('#re-tous', ov).onclick = () => ecoles.forEach((e, i) => setTimeout(() => download(`resultats-${exSlug(e)}-${exSlug(ctx.session.annee)}.json`, JSON.stringify(exConstruireResultatsEcole(ctx.session, res, e)), 'application/json;charset=utf-8'), i * 400));
}
