/* ============================================================
   app-crud.js — Moteur générique de gestion (liste + formulaire)
   Utilisé pour les modules administratifs simples
   ============================================================ */

/**
 * config = {
 *   store, title, icon, subtitle,
 *   fields: [{key,label,type,required,options|optionsFn,placeholder,fixed}],
 *   columns: [{key,label,render(row)}],
 *   filterFn(row) -> bool (optionnel, pour les vues filtrées),
 *   fixedValues: {} (valeurs imposées à la création),
 *   onSaveExtra(obj, form) (optionnel),
 *   searchKeys: [..] clés utilisées pour la recherche texte
 * }
 */
async function renderCrudView(root, config) {
  let rows = await DB.getAll(config.store);
  if (config.filterFn) rows = rows.filter(config.filterFn);
  rows.sort((a, b) => (b.id || 0) - (a.id || 0));

  root.innerHTML = `
    <div class="table-toolbar">
      <input class="search-input" id="crud-search" placeholder="Rechercher…">
      <div class="spacer" style="flex:1;"></div>
      ${(config.extraButtons || []).map((b) => `<button class="btn ${b.className || 'btn-sm'}" id="${b.id}">${esc(b.label)}</button>`).join('')}
      <button class="btn btn-accent" id="crud-add">+ Ajouter</button>
      <button class="btn btn-sm" id="crud-pdf">Exporter PDF</button>
      <button class="btn btn-sm" id="crud-export">Exporter CSV</button>
    </div>
    ${config.subtitle ? `<p class="text-soft" style="margin-top:-6px;">${esc(config.subtitle)}</p>` : ''}
    <div id="crud-table"></div>
  `;

  const doRender = async (filterText) => {
    let list = rows;
    if (filterText) {
      const f = filterText.toLowerCase();
      const keys = config.searchKeys || config.fields.map((x) => x.key);
      list = rows.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(f)));
    }
    $('#crud-table').innerHTML = list.length ? `
      <div class="table-wrap"><table>
        <thead><tr>${config.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${list.map((r) => `<tr>${config.columns.map((c) => `<td class="wrap">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}
          <td class="no-print"><div class="flex gap-8">
            <button class="btn btn-sm" onclick="crudEdit('${config.store}',${r.id})">Modifier</button>
            <button class="btn btn-sm btn-danger" onclick="crudDelete('${config.store}',${r.id})">Suppr.</button>
          </div></td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty-state"><div class="big">∅</div>Aucun élément enregistré pour le moment.</div>`;
  };
  await doRender('');
  $('#crud-search').oninput = (e) => doRender(e.target.value);
  (config.extraButtons || []).forEach((b) => { $('#' + b.id).onclick = () => b.onClick(config); });
  $('#crud-add').onclick = () => openCrudForm(config, null);
  $('#crud-pdf').onclick = () => {
    const headers = config.columns.map((c) => c.label || ' ');
    const matrix = rows.map((r) => config.columns.map((c) => c.render ? stripTags(c.render(r)) : (r[c.key] ?? '')));
    pdfTable(config.title, headers, matrix);
  };
  $('#crud-export').onclick = () => {
    const csv = toCSV(rows, config.columns.map((c) => ({ label: c.label, value: c.render ? (r) => stripTags(c.render(r)) : c.key })));
    download(`${config.store}.csv`, csv, 'text/csv;charset=utf-8');
  };

  window._crudConfigs = window._crudConfigs || {};
  window._crudConfigs[config.store + (config.key || '')] = config;
  window.crudEdit = (store, id) => openCrudForm(findCrudConfig(store), id);
  window.crudDelete = async (store, id) => {
    if (await confirmDialog('Supprimer définitivement cet enregistrement ?')) {
      await DB.delete(store, id);
      toast('Élément supprimé.');
      onRouteChange();
    }
  };
}

function stripTags(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }

function findCrudConfig(store) {
  const map = window._crudConfigs || {};
  const key = Object.keys(map).find((k) => k.startsWith(store));
  return map[key];
}

async function resolveOptions(field) {
  if (field.optionsFn) return await field.optionsFn();
  return field.options || [];
}

/* ---------- Téléversement de fichiers (documents et photos) ---------- */
const TAILLE_MAX_FICHIER_MO = 4;

function formatTailleFichier(octets) {
  if (octets >= 1048576) return (octets / 1048576).toFixed(1) + ' Mo';
  return Math.max(1, Math.round(octets / 1024)) + ' Ko';
}
function lireFichierDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Lecture impossible'));
    r.readAsDataURL(file);
  });
}
function compresserImage(file, maxDim = 1600, qualite = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * ratio); c.height = Math.round(img.height * ratio);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', qualite));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}
function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function telechargerFichier(f) {
  const url = URL.createObjectURL(dataUrlToBlob(f.dataUrl));
  const a = document.createElement('a');
  a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function openCrudForm(config, id) {
  const row = id ? await DB.get(config.store, id) : { ...(config.fixedValues || {}) };
  const fileState = {};
  const fieldsHtml = [];
  for (const f of config.fields) {
    if (f.fixed) continue;
    const val = row[f.key] ?? '';
    let input = '';
    if (f.type === 'select') {
      const opts = await resolveOptions(f);
      input = `<select id="cf-${f.key}" ${f.required ? 'required' : ''}><option value="">—</option>${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="cf-${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
    } else if (f.type === 'files') {
      fileState[f.key] = { list: Array.isArray(row[f.key]) ? [...row[f.key]] : [], pending: 0 };
      input = `<div id="cf-${f.key}-list" class="files-list"></div>
        <input id="cf-${f.key}" type="file" multiple accept="${esc(f.accept || '*/*')}" style="margin-top:8px;">
        <div class="text-soft" style="font-size:12px;margin-top:4px;">Photos et documents (PDF, Word, Excel, PowerPoint…). Max ${TAILLE_MAX_FICHIER_MO} Mo par fichier ; les photos sont réduites automatiquement.</div>`;
    } else if (f.type === 'checkbox') {
      input = `<select id="cf-${f.key}"><option value="">—</option><option value="oui" ${val === 'oui' ? 'selected' : ''}>Oui</option><option value="non" ${val === 'non' ? 'selected' : ''}>Non</option></select>`;
    } else {
      input = `<input id="cf-${f.key}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>`;
    }
    fieldsHtml.push(`<div class="field ${f.full ? 'full' : ''}"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${input}</div>`);
  }
  const overlay0 = openModal(id ? `Modifier — ${config.title}` : `Ajouter — ${config.title}`, `<div class="form-grid">${fieldsHtml.join('')}</div>`, {
    onSave: async (overlay) => {
      const obj = id ? { ...row } : { ...(config.fixedValues || {}) };
      for (const f of config.fields) {
        if (f.fixed) continue;
        if (f.type === 'files') {
          const st = fileState[f.key];
          while (st.pending > 0) await new Promise((r) => setTimeout(r, 60)); // attend la fin de lecture des fichiers
          obj[f.key] = st.list;
          continue;
        }
        const el2 = $(`#cf-${f.key}`, overlay);
        if (!el2) continue;
        if (f.required && !el2.value) { toast(`Le champ "${f.label}" est obligatoire.`); el2.focus(); return false; }
        obj[f.key] = f.type === 'number' ? (el2.value === '' ? '' : Number(el2.value)) : el2.value;
      }
      if (config.onSaveExtra) config.onSaveExtra(obj);
      if (id) await DB.put(config.store, obj); else await DB.add(config.store, obj);
      toast(id ? 'Modifications enregistrées.' : 'Ajouté avec succès.');
      onRouteChange();
      return true;
    }
  });

  // Champs de téléversement : liste des fichiers joints + lecture des nouveaux fichiers choisis
  config.fields.filter((f) => f.type === 'files').forEach((f) => {
    const st = fileState[f.key];
    const listEl = $(`#cf-${f.key}-list`, overlay0), inputEl = $(`#cf-${f.key}`, overlay0);
    const renderList = () => {
      listEl.innerHTML = st.list.length ? st.list.map((fi, i) => `<div class="flex gap-8 items-center" style="margin:4px 0;">
          ${fi.type && fi.type.startsWith('image/') ? `<img src="${fi.dataUrl}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border);">` : '<span style="font-size:22px;">📄</span>'}
          <span style="flex:1;font-weight:600;word-break:break-all;">${esc(fi.name)} <span class="text-soft" style="font-weight:400;">(${formatTailleFichier(fi.size || 0)})</span></span>
          <button type="button" class="btn btn-sm btn-danger" data-rm="${i}">Retirer</button>
        </div>`).join('') : '<div class="text-soft">Aucun fichier joint.</div>';
      $all('[data-rm]', listEl).forEach((b) => { b.onclick = () => { st.list.splice(Number(b.dataset.rm), 1); renderList(); }; });
    };
    renderList();
    inputEl.onchange = async () => {
      const files = [...inputEl.files];
      inputEl.value = '';
      for (const file of files) {
        if (file.size > 25 * 1048576) { toast(`« ${file.name} » est trop volumineux.`); continue; }
        st.pending++;
        try {
          const estImage = file.type.startsWith('image/');
          const dataUrl = estImage ? await compresserImage(file) : await lireFichierDataUrl(file);
          const taille = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
          if (taille > TAILLE_MAX_FICHIER_MO * 1048576) { toast(`« ${file.name} » dépasse ${TAILLE_MAX_FICHIER_MO} Mo.`); }
          else st.list.push({ name: estImage ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : file.name, type: estImage ? 'image/jpeg' : (file.type || 'application/octet-stream'), size: taille, dataUrl });
        } catch (e) { toast(`Impossible de lire « ${file.name} ».`); }
        st.pending--;
        renderList();
      }
    };
  });
}

/* ---------- Impression de document (reçus, bulletins, attestations…) ---------- */
async function printDocument(title, bodyHtml, opts = {}) {
  const meta = (await DB.getAll('meta'))[0] || {};
  const win = document.createElement('div');
  win.className = 'modal-overlay';
  win.innerHTML = `<div class="modal" style="max-width:800px;">
    <div class="modal-head"><h3>${esc(title)}</h3></div>
    <div class="modal-body">
      <div id="doc-print-area" style="font-family:Georgia,serif; padding:10px;">
        ${opts.sansCadre ? '' : `<div class="pd-entete" style="display:flex; align-items:center; gap:14px; border-bottom:2px solid #1E3A4C; padding-bottom:10px; margin-bottom:16px;">
          ${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" alt="" style="height:58px; width:58px; object-fit:contain; flex-shrink:0;">` : ''}
          <div style="flex:1; text-align:center;">
            <div style="font-size:11px; letter-spacing:.05em;">BURKINA FASO — Unité · Progrès · Justice</div>
            <h2 style="margin:6px 0 0;">${esc(meta.nomEcole || 'École Primaire Publique')}</h2>
            <div style="font-size:12px; color:#555;">Année scolaire ${esc(meta.anneeScolaire || '')}</div>
          </div>
          ${meta.logoDataUrl ? `<div style="width:58px; flex-shrink:0;"></div>` : ''}
        </div>`}
        ${bodyHtml}
        ${opts.sansCadre ? '' : `<div class="pd-signature" style="margin-top:40px; display:flex; justify-content:space-between; align-items:flex-end; font-size:13px;">
          <div>Fait le ${formatDate(todayISO())}</div>
          <div style="text-align:center; min-width:220px;">
            <div>Le Directeur / La Directrice</div>
            <div style="height:70px; margin:6px 0 4px; display:flex; align-items:center; justify-content:center; gap:8px;">
              ${meta.cachetDataUrl ? `<img src="${meta.cachetDataUrl}" alt="" style="max-height:70px; max-width:90px; object-fit:contain; opacity:.92;">` : ''}
              ${meta.signatureDataUrl ? `<img src="${meta.signatureDataUrl}" alt="" style="max-height:50px; max-width:130px; object-fit:contain;">` : ''}
            </div>
            <div style="border-top:1px solid #333; padding-top:4px; min-height:14px;">${esc(meta.nomDirecteur || '')}</div>
          </div>
        </div>`}
      </div>
    </div>
    <div class="modal-foot no-print" style="flex-wrap:wrap; gap:8px;">
      <button class="btn modal-cancel">Fermer</button>
      <button class="btn" id="btn-print-now">Imprimer</button>
      <button class="btn btn-primary" id="btn-pdf-p">⬇ PDF A4 portrait</button>
      <button class="btn btn-primary" id="btn-pdf-l">⬇ PDF A4 paysage</button>
      <button class="btn" id="btn-word-p">⬇ Word (.docx) portrait</button>
      <button class="btn" id="btn-word-l">⬇ Word (.docx) paysage</button>
    </div>
  </div>`;
  document.body.appendChild(win);
  $('.modal-cancel', win).onclick = () => win.remove();
  $('#btn-print-now', win).onclick = () => imprimerA4($('#doc-print-area', win));
  const zoneDoc = $('#doc-print-area', win);
  $('#btn-pdf-p', win).onclick = () => telechargerPDF(zoneDoc, title, 'portrait');
  $('#btn-pdf-l', win).onclick = () => telechargerPDF(zoneDoc, title, 'landscape');
  $('#btn-word-p', win).onclick = () => telechargerWord(zoneDoc, title, 'portrait');
  $('#btn-word-l', win).onclick = () => telechargerWord(zoneDoc, title, 'landscape');
  try { /* orientation conseillée : paysage si un tableau est trop large pour la page portrait */
    if (pdfOrientationConseillee(zoneDoc) === 'landscape') { $('#btn-pdf-l', win).textContent += ' (conseillé)'; $('#btn-word-l', win).textContent += ' (conseillé)'; } else { $('#btn-pdf-p', win).textContent += ' (conseillé)'; $('#btn-word-p', win).textContent += ' (conseillé)'; }
  } catch (e) { /* sans importance */ }
}
