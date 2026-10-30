/* Mini banc d'essai : charge les fichiers de l'appli dans un contexte Node avec un faux navigateur. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const racine = path.join(__dirname, '..', 'www');
function creer(fichiers, extra) {
  const rpcLog = [];
  const mem = [];
  let idSeq = 1;
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, Set, Map, Number, String, Array, Object, Error, RegExp, isNaN, TextEncoder,
    crypto: { randomUUID: () => 'uuid-' + (idSeq++) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: '' }, navigator: {},
    document: { addEventListener() {}, createElement: () => ({ style: {}, addEventListener() {}, setAttribute() {} }), documentElement: { setAttribute() {} }, body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } }, head: { appendChild() {} }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  };
  ctx.window = ctx; ctx.window.addEventListener = () => {}; ctx.addEventListener = () => {};
  ctx.__toasts = []; ctx.__rpcLog = rpcLog;
  ctx.supaClient = null;
  // base locale en mémoire
  ctx.DB = {
    async getAll(s) { return mem.filter((r) => r.__s === s).map(({ __s, ...r }) => ({ ...r })); },
    async add(s, o) { const id = idSeq++; mem.push({ ...o, id, __s: s }); return id; },
    async put(s, o) { const i = mem.findIndex((r) => r.__s === s && r.id === o.id); if (i < 0) throw new Error('absent'); mem[i] = { ...o, __s: s }; return o.id; },
    async delete(s, id) { const i = mem.findIndex((r) => r.__s === s && r.id === id); if (i >= 0) mem.splice(i, 1); },
    async get(s, id) { const r = mem.find((x) => x.__s === s && x.id === id); return r ? { ...r } : undefined; }
  };
  ctx.deterministicUuid = (s) => 'd-' + s.length;
  ctx.genUuid = () => 'u-' + (idSeq++);
  vm.createContext(ctx);
  fichiers.forEach((f) => { try { vm.runInContext(fs.readFileSync(path.join(f.startsWith('tests/') ? path.join(__dirname, '..') : racine, f), 'utf8'), ctx, { filename: f }); } catch (e) { e.message = f + ' : ' + e.message; throw e; } });
  if (extra) vm.runInContext(extra, ctx);
  return ctx;
}
module.exports = { creer };
