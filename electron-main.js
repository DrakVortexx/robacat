/**
 * Electron entry — load app.html after starting server separately.
 * Usage: npm start (in one terminal), then npm run electron
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const PORT = process.env.PORT || 3847;

function createWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 400,
    minHeight: 600,
    backgroundColor: '#0f1116',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${PORT}/app.html`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
