/* École Numérique — enveloppe Windows (Electron). Charge simplement le dossier www/. */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let fenetre = null;

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#F3F4EF',
    title: 'École Numérique',
    icon: path.join(__dirname, '..', 'www', 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  Menu.setApplicationMenu(null);
  fenetre.loadFile(path.join(__dirname, '..', 'www', 'index.html'));

  /* Liens externes (http/https) → navigateur ; fenêtres d'impression et exports (about:, blob:) → autorisés */
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  fenetre.on('closed', () => { fenetre = null; });
}

app.on('second-instance', () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.whenReady().then(creerFenetre);
app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) creerFenetre(); });
