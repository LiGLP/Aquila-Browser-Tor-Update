const { safeStorage, ipcMain } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const IS_MAC = process.platform === 'darwin';
const PASSWORDS_FILE = path.join(os.homedir(), '.aquila-browser', 'passwords.enc');
const PASSWORDS_DIR = path.dirname(PASSWORDS_FILE);

let passwordCache = null;
let cacheTime = 0;
const CACHE_TTL = 10000;

function ensureDir() {
  if (!fs.existsSync(PASSWORDS_DIR)) fs.mkdirSync(PASSWORDS_DIR, { recursive: true });
}

function loadPasswords() {
  const now = Date.now();
  if (passwordCache && (now - cacheTime) < CACHE_TTL) return passwordCache;
  try {
    if (!fs.existsSync(PASSWORDS_FILE)) { passwordCache = []; cacheTime = now; return []; }
    const raw = fs.readFileSync(PASSWORDS_FILE);
    const decrypted = safeStorage.decryptString(Buffer.from(raw));
    passwordCache = JSON.parse(decrypted);
    cacheTime = now;
    return passwordCache;
  } catch (e) {
    passwordCache = [];
    cacheTime = now;
    return [];
  }
}

function savePasswords(passwords) {
  ensureDir();
  const json = JSON.stringify(passwords);
  const encrypted = safeStorage.encryptString(json);
  fs.writeFileSync(PASSWORDS_FILE, encrypted);
  passwordCache = passwords;
  cacheTime = Date.now();
}

function invalidateCache() {
  passwordCache = null;
  cacheTime = 0;
}

function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function findPasswordsForDomain(domain) {
  const passwords = loadPasswords();
  const clean = domain.replace(/^www\./, '').toLowerCase();
  return passwords.filter(p => {
    const pd = (p.domain || '').replace(/^www\./, '').toLowerCase();
    return pd === clean || pd.endsWith('.' + clean) || clean.endsWith('.' + pd);
  });
}

function addPassword(entry) {
  const passwords = loadPasswords();
  const existing = passwords.find(p =>
    p.domain === entry.domain && p.username === entry.username
  );
  if (existing) {
    existing.password = entry.password;
    existing.updatedAt = new Date().toISOString();
    if (entry.url) existing.url = entry.url;
    if (entry.title) existing.title = entry.title;
  } else {
    passwords.push({
      id: generateId(),
      domain: entry.domain,
      url: entry.url || '',
      title: entry.title || '',
      username: entry.username,
      password: entry.password,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  savePasswords(passwords);
  return { success: true };
}

function updatePassword(id, updates) {
  const passwords = loadPasswords();
  const entry = passwords.find(p => p.id === id);
  if (!entry) return { success: false, error: 'Nicht gefunden' };
  if (updates.username !== undefined) entry.username = updates.username;
  if (updates.password !== undefined) entry.password = updates.password;
  if (updates.url !== undefined) entry.url = updates.url;
  if (updates.title !== undefined) entry.title = updates.title;
  entry.updatedAt = new Date().toISOString();
  savePasswords(passwords);
  return { success: true };
}

function deletePassword(id) {
  let passwords = loadPasswords();
  const before = passwords.length;
  passwords = passwords.filter(p => p.id !== id);
  if (passwords.length === before) return { success: false, error: 'Nicht gefunden' };
  savePasswords(passwords);
  return { success: true };
}

function getAllPasswords() {
  return loadPasswords().map(p => ({
    id: p.id,
    domain: p.domain,
    url: p.url,
    title: p.title,
    username: p.username,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }));
}

function getPasswordWithSecret(id) {
  const passwords = loadPasswords();
  return passwords.find(p => p.id === id) || null;
}

function searchPasswords(query) {
  const passwords = loadPasswords();
  const q = query.toLowerCase();
  return passwords.filter(p =>
    (p.domain && p.domain.toLowerCase().includes(q)) ||
    (p.username && p.username.toLowerCase().includes(q)) ||
    (p.title && p.title.toLowerCase().includes(q)) ||
    (p.url && p.url.toLowerCase().includes(q))
  ).map(p => ({
    id: p.id,
    domain: p.domain,
    url: p.url,
    title: p.title,
    username: p.username,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }));
}

function generatePassword(length = 20) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*_+-=?';
  const all = upper + lower + digits + special;
  const bytes = crypto.randomBytes(length);
  let password = '';
  password += upper[bytes[0] % upper.length];
  password += lower[bytes[1] % lower.length];
  password += digits[bytes[2] % digits.length];
  password += special[bytes[3] % special.length];
  for (let i = 4; i < length; i++) {
    password += all[bytes[i] % all.length];
  }
  const arr = password.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

function readKeychainPassword(domain) {
  if (!IS_MAC) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', [
      'find-internet-password',
      '-s', domain,
      '-g'
    ], { timeout: 5000 }, (error, stdout, stderr) => {
      if (error) { resolve(null); return; }
      let username = null;
      let password = null;
      const acctMatch = stdout.match(/"acct"<blob>="([^"]*)"/);
      if (acctMatch) username = acctMatch[1];
      const pwMatch = stderr.match(/password:\s*"([^"]*)"/);
      if (pwMatch) password = pwMatch[1];
      if (!password) {
        const hexMatch = stderr.match(/password:\s*0x([0-9A-Fa-f]+)/);
        if (hexMatch) {
          try { password = Buffer.from(hexMatch[1], 'hex').toString('utf8'); } catch (e) {}
        }
      }
      if (username || password) {
        resolve({ domain, username: username || '', password: password || '' });
      } else {
        resolve(null);
      }
    });
  });
}

function readKeychainPasswordsForDomain(domain) {
  if (!IS_MAC) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('/usr/bin/security', [
      'find-internet-password',
      '-s', domain,
      '-a', '',
      '-g'
    ], { timeout: 5000 }, () => {
      readKeychainPassword(domain).then(result => {
        resolve(result ? [result] : []);
      });
    });
  });
}

function importFromKeychain(domain) {
  if (!IS_MAC) return Promise.resolve({ success: false, error: 'Nur auf macOS verfügbar' });
  return readKeychainPassword(domain).then(result => {
    if (!result || !result.password) return { success: false, error: 'Kein Passwort gefunden' };
    addPassword({
      domain: result.domain,
      username: result.username,
      password: result.password,
      title: domain,
      url: 'https://' + domain
    });
    return { success: true, domain: result.domain, username: result.username };
  });
}

function exportPasswords() {
  const passwords = loadPasswords();
  return passwords.map(p => ({
    domain: p.domain,
    url: p.url,
    title: p.title,
    username: p.username,
    password: p.password
  }));
}

function importPasswords(entries) {
  let imported = 0;
  entries.forEach(entry => {
    if (entry.domain && entry.username && entry.password) {
      addPassword({
        domain: entry.domain,
        url: entry.url || '',
        title: entry.title || entry.domain,
        username: entry.username,
        password: entry.password
      });
      imported++;
    }
  });
  return { success: true, imported };
}

function getStats() {
  const passwords = loadPasswords();
  const domains = new Set(passwords.map(p => p.domain));
  const weakPasswords = passwords.filter(p => p.password && p.password.length < 10).length;
  const duplicatePasswords = (() => {
    const seen = {};
    let dupes = 0;
    passwords.forEach(p => {
      if (seen[p.password]) dupes++;
      else seen[p.password] = true;
    });
    return dupes;
  })();
  return {
    total: passwords.length,
    domains: domains.size,
    weak: weakPasswords,
    duplicates: duplicatePasswords
  };
}

function registerIPC() {
  ipcMain.handle('psw-get-for-domain', (event, url) => {
    const domain = extractDomain(url);
    return findPasswordsForDomain(domain).map(p => ({
      id: p.id,
      domain: p.domain,
      username: p.username,
      password: p.password
    }));
  });

  ipcMain.handle('psw-save', (event, entry) => {
    return addPassword({
      domain: extractDomain(entry.url || entry.domain),
      url: entry.url || '',
      title: entry.title || '',
      username: entry.username,
      password: entry.password
    });
  });

  ipcMain.handle('psw-update', (event, { id, updates }) => {
    return updatePassword(id, updates);
  });

  ipcMain.handle('psw-delete', (event, id) => {
    return deletePassword(id);
  });

  ipcMain.handle('psw-get-all', () => {
    return getAllPasswords();
  });

  ipcMain.handle('psw-get-secret', (event, id) => {
    const entry = getPasswordWithSecret(id);
    if (!entry) return null;
    return { id: entry.id, domain: entry.domain, username: entry.username, password: entry.password };
  });

  ipcMain.handle('psw-search', (event, query) => {
    return searchPasswords(query);
  });

  ipcMain.handle('psw-generate', (event, length) => {
    return generatePassword(length || 20);
  });

  ipcMain.handle('psw-keychain-lookup', async (event, url) => {
    const domain = extractDomain(url);
    return readKeychainPassword(domain);
  });

  ipcMain.handle('psw-keychain-import', async (event, domain) => {
    return importFromKeychain(domain);
  });

  ipcMain.handle('psw-export', () => {
    return exportPasswords();
  });

  ipcMain.handle('psw-import', (event, entries) => {
    return importPasswords(entries);
  });

  ipcMain.handle('psw-stats', () => {
    return getStats();
  });

  ipcMain.handle('psw-check-available', () => {
    return {
      available: safeStorage.isEncryptionAvailable(),
      platform: process.platform,
      keychainSupport: IS_MAC
    };
  });
}

module.exports = {
  registerIPC,
  findPasswordsForDomain,
  addPassword,
  updatePassword,
  deletePassword,
  getAllPasswords,
  getPasswordWithSecret,
  searchPasswords,
  generatePassword,
  readKeychainPassword,
  importFromKeychain,
  exportPasswords,
  importPasswords,
  getStats,
  extractDomain,
  invalidateCache
};