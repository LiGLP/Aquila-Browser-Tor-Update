const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { loadData, saveData, EXTENSIONS_CACHE_PATH } = require('./data-store');

function loadExtensionsCache() {
  try {
    if (fs.existsSync(EXTENSIONS_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(EXTENSIONS_CACHE_PATH, 'utf8'));
    }
  } catch (error) {}
  return { extensions: [], lastUpdate: 0 };
}

function saveExtensionsCache(cache) {
  try {
    fs.writeFileSync(EXTENSIONS_CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (error) {}
}

function invalidateExtensionsCache() {
  saveExtensionsCache({ extensions: [], lastUpdate: 0 });
}

function getLoadedExtensionIds(browserSession) {
  try {
    return new Set(Array.from(browserSession.getAllExtensions()).map(e => e.id));
  } catch (e) {
    return new Set();
  }
}

function updateExtensionsList(browserSession, mainWindow) {
  try {
    const installed = Array.from(browserSession.getAllExtensions());
    const data = loadData();
    data.extensions = installed.map(ext => ({
      id: ext.id, name: ext.name, version: ext.version, enabled: true, path: ext.path
    }));
    saveData(data);
    if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('extensions-updated', data.extensions);
    }
  } catch (error) {}
}

function getLatestVersionPath(extPath) {
  const versionDirs = fs.readdirSync(extPath).filter(f => {
    try { return fs.statSync(path.join(extPath, f)).isDirectory(); } catch (e) { return false; }
  });
  if (versionDirs.length === 0) return null;
  const latestVersion = versionDirs.sort().reverse()[0];
  return { fullPath: path.join(extPath, latestVersion), version: latestVersion };
}

async function loadExistingExtensions(browserSession, extensionsPath) {
  try {
    if (!fs.existsSync(extensionsPath)) return;

    const alreadyLoaded = getLoadedExtensionIds(browserSession);
    const extensionDirs = fs.readdirSync(extensionsPath);
    const loadedExtensions = [];

    for (const extId of extensionDirs) {
      if (alreadyLoaded.has(extId)) {
        const existing = Array.from(browserSession.getAllExtensions()).find(e => e.id === extId);
        if (existing) loadedExtensions.push({ id: extId, path: existing.path, version: existing.version });
        continue;
      }

      try {
        const extPath = path.join(extensionsPath, extId);
        if (!fs.existsSync(extPath) || !fs.statSync(extPath).isDirectory()) continue;

        const versionInfo = getLatestVersionPath(extPath);
        if (!versionInfo) continue;

        await browserSession.loadExtension(versionInfo.fullPath, { allowFileAccess: true });
        loadedExtensions.push({ id: extId, path: versionInfo.fullPath, version: versionInfo.version });
      } catch (err) {}
    }

    saveExtensionsCache({ extensions: loadedExtensions, lastUpdate: Date.now() });
  } catch (error) {}
}

async function loadExistingExtensionsOptimized(browserSession, extensionsPath) {
  try {
    const cache = loadExtensionsCache();
    const cacheAge = Date.now() - cache.lastUpdate;
    const cacheValid = cache.extensions && cache.extensions.length > 0 && cacheAge < 86400000;

    if (!cacheValid) {
      await loadExistingExtensions(browserSession, extensionsPath);
      return;
    }

    const alreadyLoaded = getLoadedExtensionIds(browserSession);
    const loadedExtensions = [];
    let cacheCorrupt = false;

    for (const ext of cache.extensions) {
      if (alreadyLoaded.has(ext.id)) {
        const existing = Array.from(browserSession.getAllExtensions()).find(e => e.id === ext.id);
        if (existing) loadedExtensions.push({ id: ext.id, path: existing.path, version: existing.version });
        continue;
      }

      try {
        if (!fs.existsSync(ext.path)) {
          cacheCorrupt = true;
          continue;
        }
        await browserSession.loadExtension(ext.path, { allowFileAccess: true });
        loadedExtensions.push(ext);
      } catch (err) {
        cacheCorrupt = true;
      }
    }

    if (cacheCorrupt && fs.existsSync(extensionsPath)) {
      const nowLoaded = getLoadedExtensionIds(browserSession);
      const extensionDirs = fs.readdirSync(extensionsPath);

      for (const extId of extensionDirs) {
        if (nowLoaded.has(extId)) continue;

        try {
          const extPath = path.join(extensionsPath, extId);
          if (!fs.existsSync(extPath) || !fs.statSync(extPath).isDirectory()) continue;

          const versionInfo = getLatestVersionPath(extPath);
          if (!versionInfo) continue;

          await browserSession.loadExtension(versionInfo.fullPath, { allowFileAccess: true });
          loadedExtensions.push({ id: extId, path: versionInfo.fullPath, version: versionInfo.version });
        } catch (err) {}
      }
    }

    saveExtensionsCache({ extensions: loadedExtensions, lastUpdate: Date.now() });
  } catch (error) {
    await loadExistingExtensions(browserSession, extensionsPath);
  }
}

module.exports = {
  loadExistingExtensions,
  loadExistingExtensionsOptimized,
  updateExtensionsList,
  invalidateExtensionsCache
};