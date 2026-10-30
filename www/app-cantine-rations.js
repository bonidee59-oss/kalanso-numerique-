/* ============================================================
   app-cantine-rations.js — Rations journalières de la cantine
   Ration par élève (modifiable) : riz 150 g · haricots 35 g · huile 16 ml.
   Calcule, pour chaque classe et pour toute l'école, la quantité à prélever
   par jour. Utilisé par la rubrique Cantine (onglet « Rations du jour »)
   et par le tableau de bord.
   ============================================================ */
const CANTINE_RATION_DEFAUT = { riz: 150, haricots: 35, huile: 16 };

function cantineNb(v, def) { const n = Number(String(v).replace(',', '.')); return isFinite(n) && n >= 0 && v !== '' && v !== null && v !== undefined ? n : def; }

async function cantineReglages() {
  const m = (await DB.getAll('meta'))[0] || {};
  const r = m.rationCantine || {};
  return {
    ration: { riz: cantineNb(r.riz, 150), haricots: cantineNb(r.haricots, 35), huile: cantineNb(r.huile, 16) },
    base: m.baseCantine === 'presents' ? 'presents' : 'inscrits'
  };
}

async function cantineEnregistrerReglages(ration, base) {
  const m = (await DB.getAll('meta'))[0] || { nomEcole: '', anneeScolaire: typeof anneeScolaireCourante === 'function' ? anneeScolaireCourante() : '' };
  m.rationCantine = ration; m.baseCantine = base;
  if (m.id) await DB.put('meta', m); else m.id = await DB.add('meta', m);
}

/* Calcul par classe. base : 'inscrits' (élèves actifs) ou 'presents' (présents du jour). */
async function cantineCalcul() {
  const [{ ration, base }, eleves, classes, presences] = await Promise.all([cantineReglages(), DB.getAll('eleves'), DB.getAll('classes'), DB.getAll('presencesEleves')]);
  let cl = classes.slice();
  if (currentUser && currentUser.classeIds) cl = cl.filter((c) => currentUser.classeIds.includes(c.id));
  cl.sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr', { numeric: true }));
  const actifs = eleves.filter((e) => (e.statut || 'actif') === 'actif');
  const today = todayISO();
  const presJour = presences.filter((p) => p.date === today && !isPresenceAbsente(p.statut));
  const appelFait = presences.some((p) => p.date === today);
  const lignes = cl.map((c) => {
    const inscrits = actifs.filter((e) => e.classeId === c.id).length;
    const presents = presJour.filter((p) => Number(p.classeId) === Number(c.id)).length;
    const n = base === 'presents' ? presents : inscrits;
    return { nom: c.nom, inscrits, presents, n, riz: n * ration.riz, haricots: n * ration.haricots, huile: n * ration.huile };
  });
  const total = lignes.reduce((t, l) => ({ n: t.n + l.n, riz: t.riz + l.riz, haricots: t.haricots + l.haricots, huile: t.huile + l.huile }), { n: 0, riz: 0, haricots: 0, huile: 0 });
  return { ration, base, lignes, total, appelFait };
}

const cantineFmt = (v, u) => (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: v > 0 && v < 10000 ? 2 : 0 }) + ' ' + u;
const cantineLibBase = (b) => b === 'presents' ? "élèves présents aujourd'hui" : 'élèves inscrits';

/* Jours de stock restants pour un produit (si l'unité du stock est kg ou litre) */
async function cantineAutonomie(total) {
  const items = await DB.getAll('cantine');
  const cherche = (re, unites) => items.find((i) => re.test(i.produit || '') && unites.test(String(i.unite || '').trim()));
  const besoins = [[/riz/i, /^(kg|kilo)/i, total.riz / 1000, 'Riz'], [/haricot|ni[ée]b[ée]/i, /^(kg|kilo)/i, total.haricots / 1000, 'Haricots'], [/huile/i, /^(l|litre)/i, total.huile / 1000, 'Huile']];
  return besoins.map(([re, un, jour, nom]) => {
    const it = cherche(re, un);
    return { nom, stock: it ? Number(it.quantite) || 0 : null, jours: it && jour > 0 ? Math.floor((Number(it.quantite) || 0) / jour) : null };
  });
}

async function renderCantineRations(root) {
  const d = await cantineCalcul();
  const aut = await cantineAutonomie(d.total);
  const dateJ = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  root.innerHTML = `
    <div class="card no-print" style="margin-bottom:14px;">
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">
        <div class="field"><label>Riz par élève (g)</label><input type="number" min="0" step="1" id="rt-riz" value="${d.ration.riz}"></div>
        <div class="field"><label>Haricots par élève (g)</label><input type="number" min="0" step="1" id="rt-har" value="${d.ration.haricots}"></div>
        <div class="field"><label>Huile par élève (ml)</label><input type="number" min="0" step="1" id="rt-hui" value="${d.ration.huile}"></div>
        <div class="field"><label>Calcul sur</label><select id="rt-base"><option value="inscrits" ${d.base === 'inscrits' ? 'selected' : ''}>Élèves inscrits</option><option value="presents" ${d.base === 'presents' ? 'selected' : ''}>Présents du jour (appel)</option></select></div>
        <div class="field" style="justify-content:flex-end;"><button class="btn btn-primary" id="rt-save">Enregistrer</button></div>
      </div>
    </div>
    ${d.base === 'presents' && !d.appelFait ? `<div class="alert alert-ocre">Aucun appel enregistré aujourd'hui : les quantités sont à 0. Faites l'appel ou calculez sur les élèves inscrits.</div>` : ''}
    <div class="grid grid-3">
      <div class="card stat-card c-ocre"><div class="label">Riz à prélever</div><div class="value">${cantineFmt(d.total.riz, 'kg')}</div><div class="foot">${d.total.n} ${cantineLibBase(d.base)} × ${d.ration.riz} g</div></div>
      <div class="card stat-card c-terre"><div class="label">Haricots à prélever</div><div class="value">${cantineFmt(d.total.haricots, 'kg')}</div><div class="foot">${d.total.n} élèves × ${d.ration.haricots} g</div></div>
      <div class="card stat-card c-vert"><div class="label">Huile à prélever</div><div class="value">${cantineFmt(d.total.huile, 'L')}</div><div class="foot">${d.total.n} élèves × ${d.ration.huile} ml</div></div>
    </div>
    <div class="section-title"><h2>Par classe — ${esc(dateJ)}</h2><div class="line"></div><button class="btn btn-sm no-print" id="rt-pdf">Exporter PDF</button></div>
    <div class="table-wrap"><table><thead><tr><th>Classe</th><th>Élèves</th><th>Riz</th><th>Haricots</th><th>Huile</th></tr></thead>
      <tbody>${d.lignes.length ? d.lignes.map((l) => `<tr><td><b>${esc(l.nom)}</b></td><td>${l.n}</td><td>${cantineFmt(l.riz, 'kg')}</td><td>${cantineFmt(l.haricots, 'kg')}</td><td>${cantineFmt(l.huile, 'L')}</td></tr>`).join('') : `<tr><td colspan="5" class="text-soft">Aucune classe enregistrée.</td></tr>`}</tbody>
      <tfoot><tr><td><b>Total école</b></td><td><b>${d.total.n}</b></td><td><b>${cantineFmt(d.total.riz, 'kg')}</b></td><td><b>${cantineFmt(d.total.haricots, 'kg')}</b></td><td><b>${cantineFmt(d.total.huile, 'L')}</b></td></tr></tfoot></table></div>
    <div class="section-title"><h2>Stock disponible</h2><div class="line"></div></div>
    <div class="grid grid-3">${aut.map((a) => `<div class="card"><b>${a.nom}</b><div class="text-soft" style="margin-top:4px;">${a.stock === null ? `Produit introuvable dans le stock (nom « ${a.nom.toLowerCase()} », unité kg/litre).` : `${a.stock.toLocaleString('fr-FR')} en stock — environ <b>${a.jours}</b> jour(s) de cantine`}</div></div>`).join('')}</div>`;
  $('#rt-save').onclick = async () => {
    const r = { riz: cantineNb($('#rt-riz').value, 150), haricots: cantineNb($('#rt-har').value, 35), huile: cantineNb($('#rt-hui').value, 16) };
    await cantineEnregistrerReglages(r, $('#rt-base').value);
    toast('Ration enregistrée.'); renderCantineRations(root);
  };
  $('#rt-pdf').onclick = () => {
    const rows = d.lignes.map((l) => [l.nom, l.n, cantineFmt(l.riz, 'kg'), cantineFmt(l.haricots, 'kg'), cantineFmt(l.huile, 'L')]);
    rows.push(['Total école', d.total.n, cantineFmt(d.total.riz, 'kg'), cantineFmt(d.total.haricots, 'kg'), cantineFmt(d.total.huile, 'L')]);
    pdfTable(`Rations cantine du ${dateJ}`, ['Classe', 'Élèves', 'Riz', 'Haricots', 'Huile'], rows,
      `<p style="text-align:center;">Ration par élève : riz ${d.ration.riz} g · haricots ${d.ration.haricots} g · huile ${d.ration.huile} ml — calcul sur les ${cantineLibBase(d.base)}.</p>`);
  };
}

/* Bloc du tableau de bord (null si rien à afficher) */
async function cantineDashboardHtml() {
  const d = await cantineCalcul();
  if (!d.lignes.length) return '';
  const ic = (n) => (typeof uiIcon === 'function' ? uiIcon(n, 20) : '');
  return `<div class="section-title"><h2>Cantine : à prélever aujourd'hui</h2><div class="line"></div><a class="btn btn-sm no-print" href="#/cantine">Détails</a></div>
    <div class="grid grid-3">
      <div class="card stat-card c-ocre"><div class="icon">${ic('food')}</div><div class="label">Riz</div><div class="value">${cantineFmt(d.total.riz, 'kg')}</div><div class="foot">${d.ration.riz} g par élève</div></div>
      <div class="card stat-card c-terre"><div class="icon">${ic('food')}</div><div class="label">Haricots</div><div class="value">${cantineFmt(d.total.haricots, 'kg')}</div><div class="foot">${d.ration.haricots} g par élève</div></div>
      <div class="card stat-card c-vert"><div class="icon">${ic('food')}</div><div class="label">Huile</div><div class="value">${cantineFmt(d.total.huile, 'L')}</div><div class="foot">${d.ration.huile} ml par élève · ${d.total.n} ${cantineLibBase(d.base)}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:14px;"><table><thead><tr><th>Classe</th><th>Élèves</th><th>Riz</th><th>Haricots</th><th>Huile</th></tr></thead>
      <tbody>${d.lignes.map((l) => `<tr><td><b>${esc(l.nom)}</b></td><td>${l.n}</td><td>${cantineFmt(l.riz, 'kg')}</td><td>${cantineFmt(l.haricots, 'kg')}</td><td>${cantineFmt(l.huile, 'L')}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Total école</b></td><td><b>${d.total.n}</b></td><td><b>${cantineFmt(d.total.riz, 'kg')}</b></td><td><b>${cantineFmt(d.total.haricots, 'kg')}</b></td><td><b>${cantineFmt(d.total.huile, 'L')}</b></td></tr></tfoot></table></div>`;
}
