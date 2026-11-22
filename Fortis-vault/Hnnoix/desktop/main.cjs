const { app, BrowserWindow, dialog, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BACKEND_PORT = 47832;
const BACKEND_HOST = '127.0.0.1';

let backendApp;
let closeDatabase;
let backendServer;
let isQuitting = false;

app.setName('Fortis Vault');

function getOrCreateJwtSecret(userDataPath) {
  const secretPath = path.join(userDataPath, 'jwt-secret');
  try {
    const secret = fs.readFileSync(secretPath, 'utf8').trim();
    if (secret.length < 64) throw new Error('The saved Fortis Vault signing key is invalid.');
    return secret;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretPath, secret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return secret;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
}

function prepareBackend() {
  const userDataPath = app.getPath('userData');
  fs.mkdirSync(userDataPath, { recursive: true });

  process.env.NODE_ENV = 'production';
  process.env.DB_FILE = path.join(userDataPath, 'database.sqlite');
  process.env.FORTIS_ENV_FILE = path.join(userDataPath, '.env');
  process.env.JWT_SECRET = getOrCreateJwtSecret(userDataPath);

  backendApp = require('../backend/server');
  closeDatabase = require('../backend/config/db').closeDb;
}

function isAllowedExternalUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function openExternal(url) {
  shell.openExternal(url).catch((error) => {
    console.error('Unable to open external link:', error);
  });
}

function openWindow(origin) {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'Fortis Vault',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0b1220',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) openExternal(url);
  });

  window.once('ready-to-show', () => window.show());
  window.loadURL(origin);
}

async function startDesktopApp() {
  prepareBackend();
  backendServer = backendApp.listen(BACKEND_PORT, BACKEND_HOST);
  backendServer.once('error', (error) => {
    backendServer = null;
    dialog.showErrorBox(
      'Fortis Vault could not start',
      `The local application server could not start on ${BACKEND_HOST}:${BACKEND_PORT}.\n\n${error.message}`
    );
    if (closeDatabase) closeDatabase();
    app.quit();
  });
  backendServer.once('listening', () => {
    const origin = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
    backendApp.locals.desktopOrigin = origin;
    openWindow(origin);
  });
}

app.whenReady().then(startDesktopApp).catch((error) => {
  dialog.showErrorBox('Fortis Vault could not start', error.message);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendServer?.listening) {
    openWindow(`http://${BACKEND_HOST}:${BACKEND_PORT}`);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  isQuitting = true;

  if (!backendServer) return;
  event.preventDefault();
  const server = backendServer;
  backendServer = null;
  server.close((error) => {
    if (error) console.error('Unable to close Fortis Vault backend cleanly:', error);
    try {
      if (closeDatabase) closeDatabase();
    } finally {
      app.quit();
    }
  });
});
