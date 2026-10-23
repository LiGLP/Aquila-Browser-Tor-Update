const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const STORE_API = 'http://2.59.132.39:3000';
const AQUILA_KEY = 'AquilaBrowser-Internal-2025';

let ADDONS_DIR;
let ADDON_STATES_FILE;
const BUNDLED_ADDONS_DIR = path.join(__dirname, 'src', 'addons');
const SRC_DIR = path.join(__dirname, 'src');

function toFileUrl(filePath) {
    const resolved = filePath.replace(/app\.asar([\/\\])/g, 'app.asar.unpacked$1');
    return 'file:///' + resolved.replace(/\\/g, '/');
}

function ensureDirs() {
    if (!fs.existsSync(ADDONS_DIR)) fs.mkdirSync(ADDONS_DIR, { recursive: true });
}

function getInstalledAddons() {
    ensureDirs();
    const addons = [];

    if (fs.existsSync(BUNDLED_ADDONS_DIR)) {
        const bundled = fs.readdirSync(BUNDLED_ADDONS_DIR);
        bundled.forEach(folder => {
            const folderPath = path.join(BUNDLED_ADDONS_DIR, folder);
            if (!fs.statSync(folderPath).isDirectory()) return;

            const manifestPath = path.join(folderPath, 'manifest.json');
            const scriptPath = path.join(folderPath, folder + '.js');

            if (fs.existsSync(scriptPath)) {
                let manifest = { id: folder, name: folder, version: '1.0.0', author: 'Aquila' };
                if (fs.existsSync(manifestPath)) {
                    try { manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) }; } catch (e) {}
                }
                addons.push({
                    id: manifest.id || folder,
                    name: manifest.name || folder,
                    version: manifest.version || '1.0.0',
                    author: manifest.author || 'Aquila',
                    scriptPath: toFileUrl(scriptPath),
                    bundled: true
                });
            }
        });
    }

    if (fs.existsSync(ADDONS_DIR)) {
        const installed = fs.readdirSync(ADDONS_DIR);
        installed.forEach(folder => {
            const folderPath = path.join(ADDONS_DIR, folder);
            if (!fs.statSync(folderPath).isDirectory()) return;
            if (addons.find(a => a.id === folder)) return;

            const manifestPath = path.join(folderPath, 'manifest.json');
            const scriptPath = path.join(folderPath, folder + '.js');

            if (fs.existsSync(scriptPath)) {
                let manifest = { id: folder, name: folder, version: '1.0.0', author: 'Unbekannt' };
                if (fs.existsSync(manifestPath)) {
                    try { manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) }; } catch (e) {}
                }
                addons.push({
                    id: manifest.id || folder,
                    name: manifest.name || folder,
                    version: manifest.version || '1.0.0',
                    author: manifest.author || 'Unbekannt',
                    scriptPath: toFileUrl(scriptPath),
                    bundled: false
                });
            }
        });
    }

    return addons;
}

function loadAddonStates() {
    try {
        if (!fs.existsSync(ADDON_STATES_FILE)) return {};
        return JSON.parse(fs.readFileSync(ADDON_STATES_FILE, 'utf-8'));
    } catch (e) {
        return {};
    }
}

function saveAddonStates(states) {
    try {
        fs.writeFileSync(ADDON_STATES_FILE, JSON.stringify(states, null, 2));
        return true;
    } catch (e) {
        return false;
    }
}

function httpGet(url) {
    return new Promise((resolve) => {
        const req = http.get(url, {
            timeout: 15000,
            headers: { 'X-Aquila-Key': AQUILA_KEY }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve({ success: true, data: JSON.parse(data) }); }
                catch (e) { resolve({ success: false, error: 'JSON Parse Error' }); }
            });
        });
        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    });
}

function httpDownloadFile(url, destPath) {
    return new Promise((resolve) => {
        const req = http.get(url, {
            timeout: 30000,
            headers: { 'X-Aquila-Key': AQUILA_KEY }
        }, (res) => {
            if (res.statusCode !== 200) {
                resolve({ success: false, error: 'HTTP ' + res.statusCode });
                return;
            }
            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve({ success: true });
            });
            fileStream.on('error', (e) => resolve({ success: false, error: e.message }));
        });
        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
    });
}

async function downloadStoreAddon(addonId) {
    const infoResult = await httpGet(STORE_API + '/api/addons/' + addonId);
    if (!infoResult.success || !infoResult.data.success) {
        return { success: false, error: infoResult.error || 'Addon nicht gefunden' };
    }

    const addon = infoResult.data.addon;
    if (!addon.file) {
        return { success: false, error: 'Kein Download für dieses Addon verfügbar' };
    }

    const addonDir = path.join(ADDONS_DIR, addonId);
    if (!fs.existsSync(addonDir)) fs.mkdirSync(addonDir, { recursive: true });

    const downloadUrl = STORE_API + '/addons/files/' + addon.file;
    const destFile = path.join(addonDir, addonId + '.js');
    const downloadResult = await httpDownloadFile(downloadUrl, destFile);

    if (!downloadResult.success) {
        try { fs.rmSync(addonDir, { recursive: true }); } catch (e) {}
        return { success: false, error: downloadResult.error };
    }

    const manifest = {
        id: addon.id,
        name: addon.name,
        version: addon.version || '1.0.0',
        author: addon.author || 'Unbekannt',
        description: addon.description || '',
        tags: addon.tags || []
    };
    fs.writeFileSync(path.join(addonDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return { success: true, scriptPath: toFileUrl(destFile) };
}

function uninstallAddon(addonId) {
    const addonDir = path.join(ADDONS_DIR, addonId);
    if (!fs.existsSync(addonDir)) {
        return { success: false, error: 'Addon nicht gefunden' };
    }

    try {
        fs.rmSync(addonDir, { recursive: true });

        const states = loadAddonStates();
        delete states[addonId];
        saveAddonStates(states);

        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function registerAddonIPC() {
    ADDONS_DIR = path.join(app.getPath('userData'), 'aquila-addons');
    ADDON_STATES_FILE = path.join(app.getPath('userData'), 'addon-states.json');
    ensureDirs();

    ipcMain.handle('get-installed-addons', () => {
        return getInstalledAddons();
    });

    ipcMain.handle('get-addon-states', () => {
        return loadAddonStates();
    });

    ipcMain.handle('save-addon-states', (event, states) => {
        return saveAddonStates(states);
    });

    ipcMain.handle('download-store-addon', async (event, addonId) => {
        return await downloadStoreAddon(addonId);
    });

    ipcMain.handle('uninstall-aquila-addon', (event, addonId) => {
        return uninstallAddon(addonId);
    });
}

module.exports = { registerAddonIPC, ensureDirs };