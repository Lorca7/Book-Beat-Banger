'use strict';
const { app, BrowserWindow, ipcMain, dialog, systemPreferences, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');

let win = null;

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { label: 'Save Project…', accelerator: 'CmdOrCtrl+S', click: () => send('menu', 'save') },
        { type: 'separator' },
        { label: 'Export WAV…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Keyboard Shortcuts', click: () => send('menu', 'help') }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0f1013',
    title: 'Book Beat Banger',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

app.whenReady().then(async () => {
  // Allow microphone access for the renderer (sample recording).
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'media') {
      const wantsVideo = details && details.mediaTypes && details.mediaTypes.includes('video');
      return callback(!wantsVideo);
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media');

  ipcMain.handle('bbb:mic-access', async () => {
    if (process.platform !== 'darwin') return true;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') return false;
    return systemPreferences.askForMediaAccess('microphone');
  });

  ipcMain.handle('bbb:save-file', async (e, { name, data, filters }) => {
    const res = await dialog.showSaveDialog(win, { defaultPath: name, filters: filters || [] });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    await fs.writeFile(res.filePath, Buffer.from(data));
    return { ok: true, path: res.filePath };
  });

  ipcMain.handle('bbb:reveal', async (e, p) => { shell.showItemInFolder(p); return true; });

  buildMenu();
  await createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
