const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'data.json');
const backupDir = () => path.join(app.getPath('userData'), 'backups');

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Unreadable file: keep a copy so nothing is lost, then start fresh.
      try { fs.copyFileSync(dataFile(), dataFile() + '.corrupt-' + Date.now()); } catch (_) {}
    }
    return null;
  }
}

function writeDb(db) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, dataFile()); // atomic replace, no half-written file on power cut

  // One backup per day, kept forever so multi-year records are never purged.
  try {
    fs.mkdirSync(backupDir(), { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    fs.copyFileSync(dataFile(), path.join(backupDir(), 'data-' + today + '.json'));
  } catch (_) {}
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    title: 'Keval Brokers',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('db:load', () => readDb());
ipcMain.handle('db:save', (_e, db) => {
  writeDb(db);
  return true;
});

// Only WhatsApp click-to-chat links may be opened.
ipcMain.handle('wa:open', async (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\/wa\.me\/\d{10,15}\?text=/.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('bill:pdf', async (_e, html, suggestedName) => {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    const res = await dialog.showSaveDialog({
      defaultPath: String(suggestedName || 'bill.pdf').replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, pdf);
    shell.showItemInFolder(res.filePath);
    return res.filePath;
  } finally {
    win.destroy();
  }
});

ipcMain.handle('file:save', async (_e, content, suggestedName, filters) => {
  const res = await dialog.showSaveDialog({
    defaultPath: String(suggestedName || 'export.csv').replace(/[\\/:*?"<>|]/g, '_'),
    filters: Array.isArray(filters) && filters.length ? filters : [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, String(content || ''), 'utf8');
  shell.showItemInFolder(res.filePath);
  return res.filePath;
});

ipcMain.handle('file:open', async (_e, filters) => {
  const res = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: Array.isArray(filters) && filters.length ? filters : [{ name: 'All Files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  return { name: path.basename(filePath), content: fs.readFileSync(filePath, 'utf8') };
});

ipcMain.handle('backup:open', async () => {
  fs.mkdirSync(backupDir(), { recursive: true });
  await shell.openPath(backupDir());
  return backupDir();
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});