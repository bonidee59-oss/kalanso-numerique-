/* ============================================================
   app-ui.js — Couche de design (v45) : icônes, menu, en-têtes de rubrique,
   tableau de bord, connexion. Chargé en dernier : il enveloppe les
   fonctions existantes sans modifier la logique métier.
   ============================================================ */
const UI_ICONS = {
  dash:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  up:'<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  down:'<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  updown:'<path d="M8 4v16m0 0-3-3m3 3 3-3"/><path d="M16 20V4m0 0-3 3m3-3 3 3"/>',
  cap:'<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  grid:'<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c3 0 5 1.5 5 4.5"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clip:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  bars:'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/>',
  book:'<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  next:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8m-3-3 3 3-3 3"/>',
  pen:'<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>',
  warn:'<path d="M12 3 2 20h20Z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/>',
  school:'<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-5h6v5"/><path d="M12 10v.01"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  pin:'<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>',
  wallet:'<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Z"/><circle cx="16.5" cy="14.5" r="1.2"/>',
  box:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  food:'<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10"/><path d="M17 21V3c-2.5 1.5-3.5 4-3.5 8h3.5"/>',
  trend:'<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  flag:'<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  home:'<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  shield:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  chat:'<path d="M4 5h16v11H9l-5 4Z"/>',
  folder:'<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  pie:'<path d="M12 3a9 9 0 1 0 9 9h-9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
  key:'<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6"/><circle cx="18" cy="18" r="2.5"/>',
  heart:'<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11Z"/>',
  sliders:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell:'<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/>',
  moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  chev:'<path d="m9 6 6 6-6 6"/>',
  out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  wifi:'<path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><path d="M12 19.5v.01"/>'
};
function uiIcon(n, s) {
  s = s || 18;
  return `<svg class="i" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICONS[n] || UI_ICONS.dash}</svg>`;
}

/* Icône + courte description de chaque rubrique */
const UI_RUB = {
  '#/dashboard':['dash',"Vue d'ensemble de l'école"],
  '#/publications':['updown','Documents envoyés et reçus dans le réseau.'],
  '#/liste-ceb':['up',"Transmettre la liste des élèves à la CEB."],
  '#/listes-ceb':['down',"Listes d'élèves reçues des écoles."],
  '#/comptes-reseau':['users','Accès des écoles et structures du réseau.'],
  '#/eleves':['cap','Dossiers, inscriptions et suivi des élèves.'],
  '#/classes':['grid','Classes, salles et enseignants affectés.'],
  '#/enseignants':['user','Dossiers et affectations du personnel enseignant.'],
  '#/presences':['check','Présences et absences du jour.'],
  '#/registre-appel':['clip','Appel journalier, classe par classe.'],
  '#/registre-mensuel':['bars','Rapport mensuel des effectifs et présences.'],
  '#/registre-matricule':['book','Registre matricule officiel de l\'école.'],
  '#/evaluations':['file','Notes, compositions et bulletins.'],
  '#/passage':['next','Passage des élèves en classe supérieure.'],
  '#/cahier-enseignant':['pen','Cahier de bord de la classe.'],
  '#/cahier-semaine':['book','Cahier de la cour : une classe de permanence par semaine.'],
  '#/abandons':['warn','Repérer et suivre les élèves à risque.'],
  '#/cep':['star','Vue d\'ensemble du circuit du CEP.'],
  '#/cep-documents':['updown','Documents descendants et ascendants du CEP.'],
  '#/cep-ecole':['school','Inscriptions et résultats au CEP.'],
  '#/examens':['layers','Espace Examen de la CEB.'],
  '#/exam-dpeppnf':['layers','Consolidation provinciale.'],
  '#/exam-dreppnf':['layers','Consolidation régionale.'],
  '#/exam-sg':['layers','Bilan national.'],
  '#/cep-tableau':['dash','Indicateurs du CEP par niveau.'],
  '#/cep-calendrier':['cal','Étapes et dates limites du CEP.'],
  '#/cep-validation':['check','Remontées à valider ou à renvoyer.'],
  '#/centres-ceb':['pin','Centres d\'examen et présidents.'],
  '#/jour-j':['target','Suivi des centres le jour de l\'examen.'],
  '#/personnel-reseau':['users','Personnel et mouvements du réseau.'],
  '#/scanner':['check','Scanner des documents papier et les envoyer en PDF.'],
  '#/matricules-cep':['check','Numéros matricules des candidats au CEP, créés par le ministère.'],
  '#/cotisations':['wallet','Cotisations des parents et reçus.'],
  '#/fournitures':['box','Stock de fournitures et mouvements.'],
  '#/cantine':['food','Vivres, repas et stocks de la cantine.'],
  '#/finances':['trend','Recettes et dépenses de l\'école.'],
  '#/discipline':['flag','Incidents et sanctions.'],
  '#/patrimoine':['home','Bâtiments, mobilier et matériel.'],
  '#/cahier-bord':['pen','Cahier de bord du directeur.'],
  '#/courrier':['mail','Courrier départ et arrivée.'],
  '#/coges':['shield','Réunions et décisions du COGES.'],
  '#/visites':['eye','Visites d\'encadrement et rapports.'],
  '#/reunions':['chat','Réunions et décisions prises.'],
  '#/documents':['folder','Bibliothèque de documents de l\'école.'],
  '#/calendrier':['cal','Activités et dates de l\'année scolaire.'],
  '#/rapports':['pie','Rapports et statistiques à imprimer.'],
  '#/utilisateurs':['key','Comptes et droits d\'accès.'],
  '#/gestion-parents':['heart','Accès des parents au suivi de leur enfant.'],
  '#/parametres':['sliders','Identité de l\'école, logo, cachet, sauvegarde.']
};
const UI_GROUPS = [
  { c:'#2C7BA6', i:'dash' }, { c:'#6A5ACD', i:'updown' }, { c:'#2C7BA6', i:'cap' }, { c:'#23815A', i:'book' },
  { c:'#D4912A', i:'star' }, { c:'#C4492A', i:'target' }, { c:'#8B5BB0', i:'users' }, { c:'#1B8A8F', i:'wallet' },
  { c:'#9A7340', i:'home' }, { c:'#4F6475', i:'sliders' }
];
function uiGroupIdx(hash) { return Math.max(0, MENU.findIndex((g) => g.items.some((i) => i.hash === hash))); }
function uiRubIcon(hash) { return (UI_RUB[hash] || [])[0] || 'dash'; }

/* ---------- Menu latéral : groupes repliables, icônes, recherche ---------- */
window._navOpen = window._navOpen || {};
function buildNav() {
  const nav = document.getElementById('nav'); if (!nav) return;
  const qEl = document.getElementById('nav-q');
  const q = qEl ? qEl.value.trim().toLowerCase() : '';
  const actif = uiGroupIdx(currentRoute);
  nav.innerHTML = '';
  MENU.forEach((g, gi) => {
    const items = g.items.filter((it) => routeAutorisee(it.hash) && (!q || it.label.toLowerCase().includes(q)));
    if (!items.length) return;
    const flat = !g.title;
    const open = flat || q || window._navOpen[gi] === true || (window._navOpen[gi] === undefined && gi === actif);
    const box = document.createElement('div');
    box.className = 'nav-group' + (flat ? ' flat' : '') + (open ? ' open' : '');
    box.style.setProperty('--g', UI_GROUPS[gi % UI_GROUPS.length].c);
    if (!flat) {
      const t = document.createElement('button');
      t.className = 'nav-group-title'; t.type = 'button';
      t.innerHTML = `<span class="dot"></span>${esc(g.title)}<span class="cnt">${items.length}</span><span class="chev">${uiIcon('chev', 14)}</span>`;
      t.onclick = () => { window._navOpen[gi] = !open; buildNav(); };
      box.appendChild(t);
    }
    const list = document.createElement('div'); list.className = 'nav-items';
    items.forEach((it) => {
      const b = document.createElement('button');
      b.className = 'nav-item' + (currentRoute === it.hash ? ' active' : '');
      b.innerHTML = `<span class="ic">${uiIcon(uiRubIcon(it.hash), 16)}</span><span>${esc(it.label)}</span>`;
      b.onclick = () => { fermerMenu(); location.hash = it.hash; };
      list.appendChild(b);
    });
    box.appendChild(list); nav.appendChild(box);
  });
}

/* ---------- Coquille : logo, recherche, carte utilisateur, icônes de la barre ---------- */
const _uiRenderShell = renderShell;
renderShell = function () {
  _uiRenderShell();
  const sb = document.getElementById('sidebar'); if (!sb) return;
  const mark = sb.querySelector('.mark'); if (mark) mark.innerHTML = uiIcon('cap', 22);
  const nav = document.getElementById('nav');
  if (nav && !document.getElementById('nav-q')) {
    nav.insertAdjacentHTML('beforebegin', `<div class="nav-search">${uiIcon('search', 16)}<input id="nav-q" type="search" placeholder="Chercher une rubrique" autocomplete="off"></div>`);
    document.getElementById('nav-q').oninput = () => buildNav();
  }
  const foot = sb.querySelector('.sidebar-foot');
  if (foot) {
    const nom = currentUser.nom || '?';
    foot.innerHTML = `<div class="me">${esc(nom.trim()[0] || '?').toUpperCase()}</div>
      <div class="who"><b>${esc(nom)}</b><span>${esc(labelRole(currentUser.role))}${currentUser.structure ? ' · ' + esc(currentUser.structure) : ''}</span></div>
      <button class="out" type="button" title="Changer de profil" aria-label="Changer de profil" onclick="logout()">${uiIcon('out', 17)}</button>`;
  }
  const tb = document.querySelector('.topbar');
  if (tb && !tb.querySelector('.tb-titles')) {
    const h = document.getElementById('page-title');
    const w = document.createElement('div'); w.className = 'tb-titles';
    w.innerHTML = '<span class="crumb" id="page-crumb"></span>';
    h.parentNode.insertBefore(w, h); w.appendChild(h);
  }
  const set = (id, ic) => { const e = document.getElementById(id); if (e) e.innerHTML = uiIcon(ic, 19); };
  set('burger', 'menu'); set('alert-bell', 'bell'); set('theme-btn', 'moon');
  const bu = document.getElementById('burger'); if (bu) bu.setAttribute('aria-label', 'Ouvrir le menu');
  onRouteChange();
};

/* ---------- En-tête de chaque rubrique ---------- */
const _uiOnRoute = onRouteChange;
onRouteChange = async function () {
  await _uiOnRoute();
  const c = document.getElementById('content'); if (!c) return;
  const gi = uiGroupIdx(currentRoute);
  const g = MENU[gi] || {};
  const crumb = document.getElementById('page-crumb');
  if (crumb) crumb.textContent = g.title || 'Accueil';
  c.querySelectorAll(':scope > .rub-head').forEach((e) => e.remove());
  if (currentRoute === '#/dashboard' || !UI_RUB[currentRoute] || !routeAutorisee(currentRoute)) return;
  const label = (ROUTE_TITLES && ROUTE_TITLES[currentRoute]) || '';
  c.insertAdjacentHTML('afterbegin', `<div class="rub-head" style="--g:${UI_GROUPS[gi % UI_GROUPS.length].c}">
    <div class="rub-ic">${uiIcon(uiRubIcon(currentRoute), 24)}</div>
    <div style="position:relative;min-width:0"><div class="grp">${esc(g.title || '')}</div><h2>${esc(label)}</h2><p>${esc(UI_RUB[currentRoute][1])}</p></div></div>`);
};

/* ---------- Tableau de bord : icônes, actions rapides, rubriques ---------- */
const UI_EMOJI = { '🎓':'cap', '🧑‍🏫':'user', '✅':'check', '⚠️':'warn', '📊':'bars', '💰':'wallet', '📦':'box' };
function uiRubriques() {
  const cartes = MENU.map((g, gi) => ({ g, gi, items: g.items.filter((i) => routeAutorisee(i.hash)) }))
    .filter((x) => x.g.title && x.items.length);
  if (!cartes.length) return '';
  return `<div class="section-title no-print"><h2>Vos rubriques</h2><div class="line"></div></div>
  <div class="rub-grid">${cartes.map((x) => `<section class="rub-card${x.items.length > 6 ? ' wide' : ''}" style="--g:${UI_GROUPS[x.gi % UI_GROUPS.length].c}">
    <header><div class="rub-ic">${uiIcon(UI_GROUPS[x.gi % UI_GROUPS.length].i, 20)}</div><div><h3>${esc(x.g.title)}</h3><small>${x.items.length} rubrique${x.items.length > 1 ? 's' : ''}</small></div></header>
    <div class="rub-links">${x.items.map((i) => `<a class="rub-link" href="${i.hash}"><span class="ri">${uiIcon(uiRubIcon(i.hash), 15)}</span>${esc(i.label)}</a>`).join('')}</div>
  </section>`).join('')}</div>`;
}
function uiDecorerDashboard(root) {
  if (root.querySelector('.rub-grid')) return;
  root.querySelectorAll('.stat-card .icon').forEach((e) => { const k = UI_EMOJI[e.textContent.trim()]; if (k) e.innerHTML = uiIcon(k, 20); });
  const hero = root.querySelector('.dash-hero');
  if (hero) {
    const h1 = hero.querySelector('h1'); if (h1) h1.textContent = h1.textContent.replace(/\s*👋\s*/, '');
    const dc = hero.querySelector('.date-chip'); if (dc) dc.innerHTML = uiIcon('cal', 15) + dc.textContent.replace('📅', '').trim();
    const act = [['#/registre-appel', 'check', "Faire l'appel"], ['#/eleves', 'plus', 'Nouvel élève'], ['#/cotisations', 'wallet', 'Encaisser une cotisation'], ['#/evaluations', 'file', 'Saisir des notes']]
      .filter((a) => routeAutorisee(a[0])).slice(0, 4);
    if (act.length) hero.insertAdjacentHTML('beforeend', `<div class="hero-actions no-print">${act.map((a) => `<a href="${a[0]}">${uiIcon(a[1], 16)}${a[2]}</a>`).join('')}</div>`);
  }
  const titre = root.querySelector('.section-title');
  const html = uiRubriques();
  if (html) { if (titre) titre.insertAdjacentHTML('beforebegin', html); else root.insertAdjacentHTML('beforeend', html); }
}
{
  const _uiDash = ROUTES['#/dashboard'];
  ROUTES['#/dashboard'] = async function (root) {
    await _uiDash(root); uiDecorerDashboard(root);
    if (typeof cantineDashboardHtml === 'function' && routeAutorisee('#/cantine')) {
      try {
        const h = await cantineDashboardHtml(); if (!h) return;
        const grille = root.querySelector('.rub-grid');
        const ancre = grille ? grille.previousElementSibling : root.querySelector('.section-title');
        if (ancre) ancre.insertAdjacentHTML('beforebegin', h); else root.insertAdjacentHTML('beforeend', h);
      } catch (e) { console.error(e); }
    }
  };
}

/* ---------- Écran de connexion ---------- */
const _uiLogin = renderLogin;
renderLogin = function (msg) {
  _uiLogin(msg);
  const sc = document.querySelector('.login-screen'), card = document.querySelector('.login-card');
  if (!sc || !card || sc.classList.contains('split')) return;
  sc.classList.add('split');
  const side = document.createElement('div'); side.className = 'login-form-side'; side.appendChild(card);
  sc.appendChild(side);
  const st = card.querySelector('.woven-stripe'); if (st) st.remove();
  const h1 = card.querySelector('h1'); if (h1) h1.textContent = 'Bon retour';
  const p = card.querySelector('p'); if (p) p.textContent = 'Entrez le compte fourni par votre établissement.';
  const li = (ic, t) => `<li><span class="t">${uiIcon(ic, 16)}</span><span>${t}</span></li>`;
  sc.insertAdjacentHTML('afterbegin', `<aside class="login-brand">
    <div class="logo"><span class="mark">${uiIcon('cap', 24)}</span>École Numérique</div>
    <div><h2>Toute votre école, au même endroit</h2><ul>
      ${li('cap', 'Élèves, présences, notes et bulletins')}
      ${li('star', "Circuit du CEP, de l'école jusqu'au ministère")}
      ${li('wifi', 'Fonctionne sans internet, se synchronise au retour du réseau')}
    </ul></div>
    <div class="foot" style="font-size:12.5px;color:#9FB6BF">Gestion d'école primaire · Burkina Faso</div>
  </aside>`);
};
