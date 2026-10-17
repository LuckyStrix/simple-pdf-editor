const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// A PDF passed on the command line (e.g. "Open with Simple PDF Editor").
function pdfFromArgv(argv) {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith('.pdf') && fs.existsSync(a));
}

let win;
let pendingFile = pdfFromArgv(process.argv);

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Simple PDF Editor',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Open external links in the default browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('initial-file', () => {
  if (!pendingFile) return null;
  const file = pendingFile;
  pendingFile = null;
  return { name: path.basename(file), data: fs.readFileSync(file) };
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const file = pdfFromArgv(argv);
    if (file) win.webContents.send('open-file', { name: path.basename(file), data: fs.readFileSync(file) });
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
