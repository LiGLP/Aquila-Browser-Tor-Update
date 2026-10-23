const { ipcRenderer: _storeIpc } = require('electron');

const STORE_API = 'http://2.59.132.39:3000';
let storeAddons = [];
let storeFetched = false;
let storeInitialized = false;
let currentStoreTab = 'store';
let chromeExtensions = [];
let browserVersion = '0.0.0';

try {
    const pkg = require('../package.json');
    browserVersion = pkg.version || '0.0.0';
} catch (e) {
    try {
        const pkg = require('./package.json');
        browserVersion = pkg.version || '0.0.0';
    } catch (e2) {
        browserVersion = '0.0.0';
    }
}

function compareSemver(a, b) {
    const pa = (a || '0.0.0').split('.').map(Number);
    const pb = (b || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

function isAddonCompatible(addon) {
    if (!addon.compatibility) return true;
    const { minVersion, maxVersion } = addon.compatibility;
    if (minVersion && compareSemver(browserVersion, minVersion) < 0) return false;
    if (maxVersion && compareSemver(browserVersion, maxVersion) > 0) return false;
    return true;
}

function initStore() {
    if (storeInitialized) return;
    storeInitialized = true;

    const tabs = document.querySelectorAll('#store-tabs .store-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.storeTab;
            if (!target) return;
            switchStoreTab(target);
        });
    });

    const modal = document.getElementById('extensions-modal');
    const closeBtn = document.getElementById('close-extensions');
    const overlay = modal ? modal.querySelector('.modal-overlay') : null;

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
            closeAddonDetail();
        });
    }
    if (overlay) {
        overlay.addEventListener('click', () => {
            modal.classList.remove('active');
            closeAddonDetail();
        });
    }
}

function switchStoreTab(tabName) {
    currentStoreTab = tabName;
    closeAddonDetail();

    document.querySelectorAll('#store-tabs .store-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.storeTab === tabName);
    });

    document.querySelectorAll('.store-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('store-panel-' + tabName);
    if (panel) panel.classList.add('active');

    if (tabName === 'store') { refreshIpcInstalledAddons().then(() => loadStoreAddons()); }
    if (tabName === 'chrome-extensions') renderChromeExtensionsPanel();
    if (tabName === 'installed') { refreshIpcInstalledAddons().then(() => renderInstalledPanel()); }
}

function openStoreModal() {
    const modal = document.getElementById('extensions-modal');
    if (!modal) return;
    if (!storeInitialized) initStore();
    modal.classList.add('active');
    switchStoreTab('store');
    updateInstalledBadge();
}

async function fetchStoreAddons() {
    try {
        const http = require('http');
        return new Promise((resolve) => {
            const req = http.get(STORE_API + '/api/addons', {
                timeout: 10000,
                headers: { 'X-Aquila-Key': 'AquilaBrowser-Internal-2025' }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && parsed.success && Array.isArray(parsed.addons)) {
                            resolve({ success: true, addons: parsed.addons });
                        } else {
                            resolve({ success: false, addons: [], error: 'Ungültige API-Antwort' });
                        }
                    } catch (e) {
                        resolve({ success: false, addons: [], error: 'JSON Parse Fehler' });
                    }
                });
            });
            req.on('error', (e) => { resolve({ success: false, addons: [], error: 'Verbindungsfehler: ' + e.message }); });
            req.on('timeout', () => { req.destroy(); resolve({ success: false, addons: [], error: 'Timeout' }); });
        });
    } catch (e) {
        return { success: false, addons: [], error: e.message };
    }
}

async function loadStoreAddons() {
    const panel = document.getElementById('store-panel-store');
    if (!panel) return;

    if (storeFetched && storeAddons.length > 0) {
        renderStorePanel(panel, storeAddons);
        return;
    }

    panel.innerHTML = '<div class="store-loading"><div class="store-loading-spinner"></div><span>Aquila Addons werden geladen...</span></div>';

    const result = await fetchStoreAddons();

    if (result.success && result.addons.length > 0) {
        storeAddons = result.addons;
        storeFetched = true;
        renderStorePanel(panel, storeAddons);
    } else {
        renderStoreEmpty(panel, result.error);
    }
}

function renderStorePanel(panel, addons) {
    let html = '<div style="padding:24px;">';
    html += '<p style="font-size:11px;opacity:0.5;margin-bottom:16px;">Aquila Browser v' + browserVersion + '</p>';

    const featured = addons.filter(a => a.featured);
    const regular = addons.filter(a => !a.featured);

    if (featured.length > 0) {
        html += '<div style="margin-bottom:28px;">';
        html += '<h3 class="store-section-title"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>Empfohlen</h3>';
        html += '<div class="addon-grid">';
        featured.forEach(addon => { html += renderAddonCard(addon); });
        html += '</div></div>';
    }

    if (regular.length > 0) {
        html += '<div>';
        html += '<h3 class="store-section-title"><svg viewBox="0 0 24 24"><path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/></svg>Alle Addons</h3>';
        html += '<div class="addon-grid">';
        regular.forEach(addon => { html += renderAddonCard(addon); });
        html += '</div></div>';
    }

    if (featured.length === 0 && regular.length === 0) {
        html += '<div class="addon-grid">';
        addons.forEach(addon => { html += renderAddonCard(addon); });
        html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;

    panel.querySelectorAll('.addon-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.addon-install-btn')) return;
            const addonId = card.dataset.addonId;
            const addon = storeAddons.find(a => a.id === addonId);
            if (addon) openAddonDetail(addon);
        });
    });

    panel.querySelectorAll('.addon-install-btn:not(.incompatible)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const addonId = btn.dataset.addonId;
            installStoreAddon(addonId);
        });
    });
}

function getCompatibilityLabel(addon) {
    if (!addon.compatibility) return '';
    const { minVersion, maxVersion } = addon.compatibility;
    if (minVersion && maxVersion) return 'v' + minVersion + ' – v' + maxVersion;
    if (minVersion) return 'ab v' + minVersion;
    if (maxVersion) return 'bis v' + maxVersion;
    return '';
}

function renderAddonCard(addon) {
    const iconUrl = addon.icon ? STORE_API + '/addons/icons/' + addon.icon : '';
    const isInstalled = isAddonInstalled(addon.id);
    const compatible = isAddonCompatible(addon);

    let iconHtml = '';
    if (iconUrl) {
        iconHtml = '<img src="' + iconUrl + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
            '<svg viewBox="0 0 24 24" style="display:none;"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
    } else {
        iconHtml = '<svg viewBox="0 0 24 24"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
    }

    let tagsHtml = '';
    if (addon.tags && addon.tags.length > 0) {
        tagsHtml = '<div class="addon-card-tags">';
        addon.tags.slice(0, 3).forEach(tag => {
            tagsHtml += '<span class="addon-card-tag">' + tag + '</span>';
        });
        tagsHtml += '</div>';
    }

    let compatHtml = '';
    const compatLabel = getCompatibilityLabel(addon);
    if (compatLabel) {
        compatHtml = '<span class="addon-compat-label' + (!compatible ? ' incompatible' : '') + '">' + compatLabel + '</span>';
    }

    let btnHtml = '';
    if (!compatible) {
        btnHtml = '<button class="addon-install-btn incompatible" data-addon-id="' + addon.id + '" disabled title="Nicht kompatibel mit v' + browserVersion + '">Inkompatibel</button>';
    } else if (isInstalled) {
        btnHtml = '<button class="addon-install-btn installed" data-addon-id="' + addon.id + '">✓ Installiert</button>';
    } else {
        btnHtml = '<button class="addon-install-btn" data-addon-id="' + addon.id + '">Installieren</button>';
    }

    return '<div class="addon-card' + (!compatible ? ' addon-card-incompatible' : '') + '" data-addon-id="' + addon.id + '">' +
        '<div class="addon-card-header">' +
            '<div class="addon-icon">' + iconHtml + '</div>' +
            '<div class="addon-card-info">' +
                '<p class="addon-card-name">' + (addon.name || 'Unbekannt') + '</p>' +
                '<p class="addon-card-author">von ' + (addon.author || 'LotusCity') + '</p>' +
            '</div>' +
        '</div>' +
        (addon.description ? '<p class="addon-card-desc">' + addon.description + '</p>' : '') +
        '<div class="addon-card-footer">' +
            tagsHtml +
            compatHtml +
            btnHtml +
        '</div>' +
    '</div>';
}

function openAddonDetail(addon) {
    const overlay = document.getElementById('addon-detail-overlay');
    if (!overlay) return;

    const iconUrl = addon.icon ? STORE_API + '/addons/icons/' + addon.icon : '';
    const isInstalled = isAddonInstalled(addon.id);
    const compatible = isAddonCompatible(addon);

    let iconHtml = '';
    if (iconUrl) {
        iconHtml = '<img src="' + iconUrl + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">' +
            '<svg viewBox="0 0 24 24" style="display:none;"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
    } else {
        iconHtml = '<svg viewBox="0 0 24 24"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
    }

    let previewsHtml = '';
    if (addon.previews && addon.previews.length > 0) {
        previewsHtml = '<div class="addon-detail-section"><h3>Vorschau</h3><div class="addon-previews">';
        addon.previews.forEach(preview => {
            const previewUrl = STORE_API + '/addons/previews/' + preview;
            previewsHtml += '<img class="addon-preview-img" src="' + previewUrl + '" alt="Preview" onerror="this.style.display=\'none\';">';
        });
        previewsHtml += '</div></div>';
    }

    let tagsHtml = '';
    if (addon.tags && addon.tags.length > 0) {
        tagsHtml = '<div class="addon-detail-section"><h3>Tags</h3><div class="addon-detail-tags">';
        addon.tags.forEach(tag => {
            tagsHtml += '<span class="addon-card-tag" style="font-size:12px;padding:4px 12px;">' + tag + '</span>';
        });
        tagsHtml += '</div></div>';
    }

    let changelogHtml = '';
    if (addon.changelog) {
        changelogHtml = '<div class="addon-detail-section"><h3>Changelog</h3><p>' + addon.changelog.replace(/\n/g, '<br>') + '</p></div>';
    }

    let compatDetailHtml = '';
    if (addon.compatibility) {
        const compatLabel = getCompatibilityLabel(addon);
        compatDetailHtml = '<div class="addon-detail-section"><h3>Kompatibilität</h3>' +
            '<p>Benötigt: <strong>' + compatLabel + '</strong></p>' +
            '<p>Deine Version: <strong>v' + browserVersion + '</strong> — ' +
            (compatible
                ? '<span style="color:#22c55e;">✓ Kompatibel</span>'
                : '<span style="color:#ef4444;">✗ Nicht kompatibel</span>') +
            '</p></div>';
    }

    let btnHtml = '';
    if (!compatible) {
        btnHtml = '<button class="addon-detail-install-btn incompatible" id="addon-detail-install-btn" data-addon-id="' + addon.id + '" disabled>Inkompatibel</button>';
    } else if (isInstalled) {
        btnHtml = '<button class="addon-detail-install-btn installed" id="addon-detail-install-btn" data-addon-id="' + addon.id + '">✓ Installiert</button>';
    } else {
        btnHtml = '<button class="addon-detail-install-btn" id="addon-detail-install-btn" data-addon-id="' + addon.id + '">Installieren</button>';
    }

    overlay.innerHTML =
        '<button class="addon-detail-back" id="addon-detail-back-btn">' +
            '<svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>' +
            'Zurück zum Store' +
        '</button>' +
        '<div class="addon-detail-hero">' +
            '<div class="addon-detail-icon">' + iconHtml + '</div>' +
            '<div class="addon-detail-meta">' +
                '<h2 class="addon-detail-name">' + (addon.name || 'Unbekannt') + '</h2>' +
                '<p class="addon-detail-author-line">von ' + (addon.author || 'LotusCity') + '</p>' +
                '<div class="addon-detail-actions">' +
                    btnHtml +
                    '<span class="addon-detail-version">v' + (addon.version || '1.0.0') + '</span>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div class="addon-detail-body">' +
            (addon.description ? '<div class="addon-detail-section"><h3>Beschreibung</h3><p>' + addon.description + '</p></div>' : '') +
            compatDetailHtml +
            previewsHtml +
            tagsHtml +
            changelogHtml +
            (addon.permissions && addon.permissions.length > 0 ?
                '<div class="addon-detail-section"><h3>Berechtigungen</h3><p>' + addon.permissions.join(', ') + '</p></div>' : '') +
        '</div>';

    overlay.classList.add('active');

    document.getElementById('addon-detail-back-btn').addEventListener('click', closeAddonDetail);

    const installBtn = document.getElementById('addon-detail-install-btn');
    if (installBtn && !isInstalled && compatible) {
        installBtn.addEventListener('click', () => {
            installStoreAddon(addon.id);
        });
    }
}

function closeAddonDetail() {
    const overlay = document.getElementById('addon-detail-overlay');
    if (overlay) overlay.classList.remove('active');
}

let ipcInstalledAddons = [];

async function refreshIpcInstalledAddons() {
    try {
        ipcInstalledAddons = await _storeIpc.invoke('get-installed-addons') || [];
    } catch (e) {
        ipcInstalledAddons = [];
    }
}

function isAddonInstalled(addonId) {
    if (window.AddonLoader && window.AddonLoader.isLoaded(addonId)) return true;
    if (ipcInstalledAddons.find(a => a.id === addonId)) return true;
    return false;
}

async function installStoreAddon(addonId) {
    const addon = storeAddons.find(a => a.id === addonId);
    if (!addon) return;

    if (!isAddonCompatible(addon)) {
        showStoreNotification('Dieses Addon ist nicht kompatibel mit deiner Browser-Version (v' + browserVersion + ')', 'error');
        return;
    }

    const allBtns = document.querySelectorAll('.addon-install-btn[data-addon-id="' + addonId + '"], #addon-detail-install-btn[data-addon-id="' + addonId + '"]');
    allBtns.forEach(btn => {
        btn.textContent = 'Installiere...';
        btn.disabled = true;
    });

    try {
        let result;

        if (window.AddonLoader) {
            result = await window.AddonLoader.installFromStore(addonId);
        } else {
            result = await _storeIpc.invoke('download-store-addon', addonId);

            if (result.success && result.scriptPath) {
                try {
                    const script = document.createElement('script');
                    script.src = result.scriptPath;
                    script.dataset.addonId = addonId;
                    await new Promise((resolve, reject) => {
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('Script load failed'));
                        document.head.appendChild(script);
                    });

                    if (!_fallbackScripts) _fallbackScripts = {};
                    _fallbackScripts[addonId] = script;

                    const states = await _storeIpc.invoke('get-addon-states') || {};
                    states[addonId] = true;
                    await _storeIpc.invoke('save-addon-states', states);

                    if (window.AquilaAddons && window.AquilaAddons[addonId]) {
                        try { window.AquilaAddons[addonId].activate(); } catch (e) {}
                    }
                } catch (e) {
                    result = { success: true, warning: 'Heruntergeladen, Script konnte aber nicht geladen werden' };
                }
            }
        }

        if (result.success) {
            allBtns.forEach(btn => {
                btn.textContent = '✓ Installiert';
                btn.classList.add('installed');
                btn.disabled = false;
            });
            showStoreNotification(addon.name + ' wurde installiert!', 'success');
            await refreshIpcInstalledAddons();
            updateInstalledBadge();
        } else {
            allBtns.forEach(btn => {
                btn.textContent = 'Installieren';
                btn.disabled = false;
            });
            showStoreNotification('Fehler: ' + (result.error || 'Installation fehlgeschlagen'), 'error');
        }
    } catch(e) {
        allBtns.forEach(btn => {
            btn.textContent = 'Installieren';
            btn.disabled = false;
        });
        showStoreNotification('Fehler: ' + e.message, 'error');
    }
}

let _fallbackScripts = {};

function fallbackDeactivateAddon(addonId) {
    if (window.AquilaAddons && window.AquilaAddons[addonId]) {
        try { window.AquilaAddons[addonId].deactivate(); } catch (e) {}
    }

    document.querySelectorAll('[data-addon-id="' + addonId + '"]').forEach(el => {
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') {
            el.remove();
        }
    });

    document.querySelectorAll('style').forEach(s => {
        if (s.id && s.id.toLowerCase().includes(addonId.toLowerCase())) s.remove();
    });

    document.querySelectorAll('[id*="' + addonId + '"], [class*="' + addonId + '"]').forEach(el => {
        try { el.remove(); } catch (e) {}
    });
}

function fallbackUninstallAddon(addonId) {
    fallbackDeactivateAddon(addonId);

    if (_fallbackScripts[addonId]) {
        const script = _fallbackScripts[addonId];
        if (script.parentNode) script.remove();
        delete _fallbackScripts[addonId];
    }

    if (window.AquilaAddons) delete window.AquilaAddons[addonId];
}

function renderStoreEmpty(panel, error) {
    panel.innerHTML =
        '<div class="store-empty">' +
            '<svg viewBox="0 0 24 24"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>' +
            '<h3>Keine Addons verfügbar</h3>' +
            '<p>Der Aquila Store ist gerade nicht erreichbar oder es sind noch keine Addons vorhanden.</p>' +
            (error ? '<p style="font-size:11px;margin-top:8px;opacity:0.6;">' + error + '</p>' : '') +
            '<button onclick="loadStoreAddons()" style="margin-top:16px;padding:8px 22px;background:var(--primary-color,#1e90ff);border:none;border-radius:8px;color:white;cursor:pointer;font-weight:600;font-size:13px;">Erneut versuchen</button>' +
        '</div>';
}

function renderChromeExtensionsPanel() {
    const panel = document.getElementById('store-panel-chrome-extensions');
    if (!panel) return;

    panel.innerHTML =
        '<div class="chrome-ext-section" style="padding:20px 20px 40px 20px;display:flex;flex-direction:column;gap:14px;">' +
            '<div class="chrome-ext-install-box" style="border-color:var(--primary-color,#1e90ff);background:linear-gradient(135deg,rgba(30,144,255,0.08),rgba(30,144,255,0.02));">' +
                '<h3 style="display:flex;align-items:center;gap:8px;margin:0 0 6px 0;font-size:14px;"><svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--primary-color,#1e90ff);flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>Chrome Web Store</h3>' +
                '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px 0;">Durchsuche den Chrome Web Store direkt im Browser und installiere Extensions mit einem Klick.</p>' +
                '<button id="chrome-ext-open-store-btn" style="padding:8px 20px;background:var(--primary-color,#1e90ff);border:none;border-radius:8px;color:white;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;transition:filter 0.15s;">' +
                    '<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:white;"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>' +
                    'Chrome Web Store öffnen' +
                '</button>' +
            '</div>' +
            '<div class="chrome-ext-install-box">' +
                '<h3 style="margin:0 0 6px 0;font-size:14px;">Manuelle Installation</h3>' +
                '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px 0;">Extension ID oder Chrome Web Store URL eingeben.</p>' +
                '<div class="chrome-ext-form">' +
                    '<input type="text" id="chrome-ext-id-input" placeholder="Extension ID oder Web Store URL...">' +
                    '<button id="chrome-ext-install-btn">Installieren</button>' +
                '</div>' +
            '</div>' +
            '<div class="chrome-ext-install-box">' +
                '<h3 style="margin:0 0 6px 0;font-size:14px;">Empfohlene Extensions</h3>' +
                '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px 0;">Beliebte Extensions die gut mit Aquila funktionieren:</p>' +
                '<div class="chrome-ext-recommended" id="chrome-ext-recommended"></div>' +
            '</div>' +
        '</div>';

    var recContainer = document.getElementById('chrome-ext-recommended');
    if (recContainer) {
        var recommended = [
            { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', desc: 'Effizienter Ad-Blocker (MV3, ~20MB RAM)', domain: 'ublockorigin.com' },
            { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden', desc: 'Passwort-Manager', domain: 'bitwarden.com' },
            { id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader', desc: 'Dunkles Theme für alle Webseiten', domain: 'darkreader.org' },
            { id: 'bgnkhhnnamicmpeenaelnjfhikgbkllg', name: 'AdGuard', desc: 'Werbeblocker & Datenschutz', domain: 'adguard.com' },
            { id: 'gighmmpiobklfepjocnamgkkbiglidom', name: 'AdBlock', desc: 'Klassischer Werbeblocker', domain: 'getadblock.com' },
            { id: 'hdokiejnpimakedhajhdlcegeplioahd', name: 'LastPass', desc: 'Passwort-Manager', domain: 'lastpass.com' }
        ];

        var recHtml = '';
        recommended.forEach(function(ext) {
            var iconUrl = 'https://www.google.com/s2/favicons?domain=' + ext.domain + '&sz=128';
            recHtml += '<div class="chrome-ext-rec-item" data-ext-id="' + ext.id + '">' +
                '<div class="chrome-ext-rec-icon"><img src="' + iconUrl + '" alt="" style="width:24px;height:24px;border-radius:4px;" onerror="this.outerHTML=\'<svg viewBox=\\\'0 0 24 24\\\' style=\\\'width:24px;height:24px;fill:var(--primary-color,#1e90ff)\\\'><path d=\\\'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z\\\'/></svg>\'"></div>' +
                '<div class="chrome-ext-rec-info">' +
                    '<span class="chrome-ext-rec-name">' + ext.name + '</span>' +
                    '<span class="chrome-ext-rec-desc">' + ext.desc + '</span>' +
                '</div>' +
                '<button class="chrome-ext-rec-btn" data-ext-id="' + ext.id + '">Installieren</button>' +
            '</div>';
        });
        recContainer.innerHTML = recHtml;

        recContainer.querySelectorAll('.chrome-ext-rec-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var extId = btn.dataset.extId;
                btn.textContent = 'Installiere...';
                btn.disabled = true;
                installChromeExtension(extId, null).then(function() {
                    btn.textContent = '✓ Installiert';
                    btn.classList.add('installed');
                }).catch(function() {
                    btn.textContent = 'Installieren';
                    btn.disabled = false;
                });
            });
        });
    }

    var openStoreBtn = document.getElementById('chrome-ext-open-store-btn');
    if (openStoreBtn) {
        openStoreBtn.addEventListener('click', function() {
            if (window.createTab) window.createTab('https://chromewebstore.google.com/');
            var modal = document.getElementById('extensions-modal');
            if (modal) modal.classList.remove('active');
        });
    }

    var installBtn = document.getElementById('chrome-ext-install-btn');
    var input = document.getElementById('chrome-ext-id-input');

    if (installBtn && input) {
        installBtn.addEventListener('click', function() {
            var extId = input.value.trim();
            if (extId) {
                var extracted = extractExtensionId(extId);
                installChromeExtension(extracted, input);
            }
        });
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                var extId = input.value.trim();
                if (extId) {
                    var extracted = extractExtensionId(extId);
                    installChromeExtension(extracted, input);
                }
            }
        });
    }
}

function extractExtensionId(input) {
    input = input.trim();
    var urlMatch = input.match(/chromewebstore\.google\.com\/detail\/[^\/]*\/([a-z]{32})/);
    if (urlMatch) return urlMatch[1];
    var oldUrlMatch = input.match(/chrome\.google\.com\/webstore\/detail\/[^\/]*\/([a-z]{32})/);
    if (oldUrlMatch) return oldUrlMatch[1];
    var idMatch = input.match(/^([a-z]{32})$/);
    if (idMatch) return idMatch[1];
    var partialMatch = input.match(/([a-z]{32})/);
    if (partialMatch) return partialMatch[1];
    return input;
}

const HIGH_MEMORY_EXTENSIONS = {
    'cjpalhdlnbpafiamejdnhcphjbkeiagm': { name: 'uBlock Origin', alt: 'ddkjiahejlhfcafbddmgiahcphecmpfh', altName: 'uBlock Origin Lite' }
};

async function installChromeExtension(extensionId, input) {
    const heavyExt = HIGH_MEMORY_EXTENSIONS[extensionId];
    if (heavyExt) {
        const useAlt = confirm(
            heavyExt.name + ' (MV2) verbraucht sehr viel RAM (2-6 GB) und kann den Browser verlangsamen.\n\n' +
            'Empfehlung: ' + heavyExt.altName + ' (MV3) — gleiche Funktion, nur ~20 MB RAM.\n\n' +
            'OK = ' + heavyExt.altName + ' installieren\n' +
            'Abbrechen = ' + heavyExt.name + ' trotzdem installieren'
        );
        if (useAlt) {
            extensionId = heavyExt.alt;
            if (input) input.value = extensionId;
        }
    }
    const installBtn = document.getElementById('chrome-ext-install-btn');
    if (installBtn) {
        installBtn.textContent = 'Installiere...';
        installBtn.disabled = true;
    }

    const result = await _storeIpc.invoke('install-extension', extensionId);

    if (result.success) {
        showStoreNotification('Extension erfolgreich installiert!', 'success');
        if (input) input.value = '';
        updateInstalledBadge();
        chromeExtensions = await _storeIpc.invoke('get-extensions');
    } else {
        showStoreNotification('Fehler: ' + result.error, 'error');
    }

    if (installBtn) {
        installBtn.textContent = 'Installieren';
        installBtn.disabled = false;
    }
}

async function renderInstalledPanel() {
    const panel = document.getElementById('store-panel-installed');
    console.log('[DEBUG] [RENDER-INSTALLED] called, panel found:', !!panel);
    if (!panel) return;

    chromeExtensions = await _storeIpc.invoke('get-extensions');
    const loaderAddons = window.AddonLoader ? window.AddonLoader.getAll() : [];
    const loaderIds = new Set(loaderAddons.map(a => a.id));
    const aquilaAddons = [...loaderAddons];

    console.log('[DEBUG] [RENDER-INSTALLED] chromeExtensions count:', chromeExtensions.length);
    console.log('[DEBUG] [RENDER-INSTALLED] loaderAddons count:', loaderAddons.length);
    console.log('[DEBUG] [RENDER-INSTALLED] ipcInstalledAddons count:', ipcInstalledAddons.length);

    ipcInstalledAddons.forEach(a => {
        if (!loaderIds.has(a.id)) {
            aquilaAddons.push({
                id: a.id,
                name: a.name || a.id,
                version: a.version || '1.0.0',
                enabled: true,
                bundled: !!a.bundled
            });
        }
    });

    console.log('[DEBUG] [RENDER-INSTALLED] aquilaAddons final count:', aquilaAddons.length);
    aquilaAddons.forEach(a => console.log('[DEBUG] [RENDER-INSTALLED] addon:', a.id, '| bundled:', a.bundled));
    chromeExtensions.forEach(e => console.log('[DEBUG] [RENDER-INSTALLED] chrome-ext:', e.id, e.name));

    let html = '<div class="installed-section">';

    const totalCount = chromeExtensions.length + aquilaAddons.length;

    if (totalCount === 0) {
        html += '<div class="store-empty">' +
            '<svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>' +
            '<h3>Nichts installiert</h3>' +
            '<p>Du hast noch keine Extensions oder Addons installiert.</p>' +
        '</div>';
    }

    if (aquilaAddons.length > 0) {
        html += '<div class="installed-group">';
        html += '<h3 class="installed-group-title">' +
            '<svg viewBox="0 0 24 24"><path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/></svg>' +
            'Aquila Addons (' + aquilaAddons.length + ')' +
        '</h3>';

        aquilaAddons.forEach(addon => {
            const isEnabled = addon.enabled;
            const isBundled = addon.bundled !== false;
            console.log('[DEBUG] [RENDER-INSTALLED] rendering addon:', addon.id, '| isBundled:', isBundled, '| showDeleteBtn:', !isBundled);
            html += '<div class="installed-item" data-addon-id="' + addon.id + '">' +
                '<div class="installed-item-icon">' +
                    '<svg viewBox="0 0 24 24"><path d="M4 10v7h3v-7H4zm6 0v7h3v-7h-3zM2 22h19v-3H2v3zm14-12v7h3v-7h-3zm-4.5-9L2 6v2h19V6l-9.5-5z"/></svg>' +
                '</div>' +
                '<div class="installed-item-info">' +
                    '<p class="installed-item-name">' + addon.name + '</p>' +
                    '<p class="installed-item-version">Version ' + addon.version +
                        ' · <span style="color:' + (isEnabled ? '#22c55e' : 'var(--text-secondary)') + ';">' +
                        (isEnabled ? 'Aktiviert' : 'Deaktiviert') + '</span></p>' +
                '</div>' +
                '<label class="addon-toggle" data-addon-id="' + addon.id + '">' +
                    '<input type="checkbox" ' + (isEnabled ? 'checked' : '') + '>' +
                    '<span class="addon-toggle-slider"></span>' +
                '</label>' +
                (!isBundled ? '<button class="installed-item-remove" data-uninstall-addon="' + addon.id + '" title="Deinstallieren">' +
                    '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
                '</button>' : '') +
            '</div>';
        });

        html += '</div>';
    }

    if (chromeExtensions.length > 0) {
        html += '<div class="installed-group">';
        html += '<h3 class="installed-group-title">' +
            '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' +
            'Chrome Extensions (' + chromeExtensions.length + ')' +
        '</h3>';

        chromeExtensions.forEach(ext => {
            html += '<div class="installed-item" data-ext-id="' + ext.id + '">' +
                '<div class="installed-item-icon">' +
                    '<svg viewBox="0 0 24 24"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>' +
                '</div>' +
                '<div class="installed-item-info">' +
                    '<p class="installed-item-name">' + ext.name + '</p>' +
                    '<p class="installed-item-version">Version ' + ext.version + ' · ID: ' + ext.id + '</p>' +
                '</div>' +
                '<button class="installed-item-remove" data-ext-id="' + ext.id + '" title="Deinstallieren">' +
                    '<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>' +
                '</button>' +
            '</div>';
        });

        html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;

    const extBtns = panel.querySelectorAll('.installed-item-remove[data-ext-id]');
    const addonBtns = panel.querySelectorAll('.installed-item-remove[data-uninstall-addon]');
    console.log('[DEBUG] [RENDER-INSTALLED] ext delete buttons found:', extBtns.length);
    console.log('[DEBUG] [RENDER-INSTALLED] addon delete buttons found:', addonBtns.length);

    panel.querySelectorAll('.addon-toggle input').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const addonId = e.target.closest('.addon-toggle').dataset.addonId;
            const wantEnabled = e.target.checked;
            e.target.disabled = true;

            if (window.AddonLoader) {
                if (wantEnabled) {
                    await window.AddonLoader.enable(addonId);
                    showStoreNotification(addonId + ' aktiviert', 'success');
                } else {
                    await window.AddonLoader.disable(addonId);
                    showStoreNotification(addonId + ' deaktiviert', 'success');
                }

                const verified = await _storeIpc.invoke('get-addon-states');
                const actualState = verified ? verified[addonId] === true : wantEnabled;
                e.target.checked = actualState;
                e.target.disabled = false;
            } else {
                if (wantEnabled) {
                    if (window.AquilaAddons && window.AquilaAddons[addonId]) {
                        try { window.AquilaAddons[addonId].activate(); } catch (err) {}
                    }
                    showStoreNotification(addonId + ' aktiviert', 'success');
                } else {
                    fallbackDeactivateAddon(addonId);
                    showStoreNotification(addonId + ' deaktiviert', 'success');
                }

                const states = await _storeIpc.invoke('get-addon-states') || {};
                states[addonId] = wantEnabled;
                await _storeIpc.invoke('save-addon-states', states);
                e.target.disabled = false;
            }

            await renderInstalledPanel();
        });
    });

    extBtns.forEach(btn => {
        console.log('[DEBUG] [RENDER-INSTALLED] attaching click handler to ext btn:', btn.dataset.extId);
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const extId = btn.dataset.extId;
            console.log('[DEBUG] [UNINSTALL-EXT-UI] button clicked, extId:', extId);
            const ext = chromeExtensions.find(ex => ex.id === extId);
            const extName = ext ? ext.name : extId;
            console.log('[DEBUG] [UNINSTALL-EXT-UI] extName:', extName, '| found:', !!ext);
            if (!await window.aqConfirm('"' + extName + '" wirklich deinstallieren?')) {
                console.log('[DEBUG] [UNINSTALL-EXT-UI] cancelled by user');
                return;
            }
            btn.disabled = true;
            console.log('[DEBUG] [UNINSTALL-EXT-UI] invoking uninstall-extension IPC...');
            const result = await _storeIpc.invoke('uninstall-extension', extId);
            console.log('[DEBUG] [UNINSTALL-EXT-UI] result:', JSON.stringify(result));
            if (result.success) {
                showStoreNotification(extName + ' wurde deinstalliert', 'success');
                await renderInstalledPanel();
                updateInstalledBadge();
            } else {
                btn.disabled = false;
                showStoreNotification('Fehler: ' + (result.error || 'Deinstallation fehlgeschlagen'), 'error');
            }
        });
    });

    addonBtns.forEach(btn => {
        console.log('[DEBUG] [RENDER-INSTALLED] attaching click handler to addon btn:', btn.dataset.uninstallAddon);
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const addonId = btn.dataset.uninstallAddon;
            console.log('[DEBUG] [UNINSTALL-ADDON-UI] button clicked, addonId:', addonId);
            const loaderAddon = window.AddonLoader ? window.AddonLoader.getAll().find(a => a.id === addonId) : null;
            const ipcAddon = ipcInstalledAddons.find(a => a.id === addonId);
            const addonName = (loaderAddon ? loaderAddon.name : null) || (ipcAddon ? ipcAddon.name : null) || addonId;
            console.log('[DEBUG] [UNINSTALL-ADDON-UI] addonName:', addonName, '| loaderAddon:', !!loaderAddon, '| ipcAddon:', !!ipcAddon);
            if (!await window.aqConfirm('"' + addonName + '" wirklich deinstallieren?')) {
                console.log('[DEBUG] [UNINSTALL-ADDON-UI] cancelled by user');
                return;
            }
            btn.disabled = true;
            let result;
            if (window.AddonLoader && window.AddonLoader.isLoaded(addonId)) {
                console.log('[DEBUG] [UNINSTALL-ADDON-UI] using AddonLoader.uninstall');
                result = await window.AddonLoader.uninstall(addonId);
            } else {
                console.log('[DEBUG] [UNINSTALL-ADDON-UI] using fallback + IPC');
                fallbackUninstallAddon(addonId);
                result = await _storeIpc.invoke('uninstall-aquila-addon', addonId);
            }
            console.log('[DEBUG] [UNINSTALL-ADDON-UI] result:', JSON.stringify(result));
            if (result.success) {
                showStoreNotification(addonName + ' wurde deinstalliert', 'success');
                await refreshIpcInstalledAddons();
                await renderInstalledPanel();
                updateInstalledBadge();
            } else {
                btn.disabled = false;
                showStoreNotification('Fehler: ' + (result.error || 'Deinstallation fehlgeschlagen'), 'error');
            }
        });
    });
}

async function updateInstalledBadge() {
    try {
        const extensions = await _storeIpc.invoke('get-extensions');
        const loaderAddons = window.AddonLoader ? window.AddonLoader.getAll() : [];
        const loaderIds = new Set(loaderAddons.map(a => a.id));
        let extraCount = 0;
        ipcInstalledAddons.forEach(a => { if (!loaderIds.has(a.id)) extraCount++; });
        const total = extensions.length + loaderAddons.length + extraCount;
        const badge = document.getElementById('installed-count-badge');
        if (!badge) return;
        if (total > 0) {
            badge.textContent = total;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    } catch(e) {}
}

let storeNotifTimeout = null;

function showStoreNotification(message, type) {
    let notif = document.querySelector('.store-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.className = 'store-notification';
        document.body.appendChild(notif);
    }
    if (storeNotifTimeout) clearTimeout(storeNotifTimeout);

    notif.style.cssText = 'position:fixed;top:80px;right:20px;' +
        'background:' + (type === 'success' ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)') + ';' +
        'color:white;padding:14px 22px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);' +
        'z-index:100001;font-weight:500;font-size:13px;max-width:400px;' +
        'animation:storeNotifIn 0.25s ease-out;';
    notif.textContent = message;

    storeNotifTimeout = setTimeout(() => {
        notif.style.animation = 'storeNotifOut 0.25s ease-in';
        setTimeout(() => { if (notif.parentNode) notif.remove(); }, 250);
    }, 3500);
}

const storeStyle = document.createElement('style');
storeStyle.textContent =
    '@keyframes storeNotifIn{from{transform:translateX(400px);opacity:0;}to{transform:translateX(0);opacity:1;}}' +
    '@keyframes storeNotifOut{from{transform:translateX(0);opacity:1;}to{transform:translateX(400px);opacity:0;}}' +
    '.addon-toggle{position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;cursor:pointer;}' +
    '.addon-toggle input{opacity:0;width:0;height:0;}' +
    '.addon-toggle-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,0.12);transition:0.2s;border-radius:22px;}' +
    '.addon-toggle-slider::before{content:"";position:absolute;height:16px;width:16px;left:3px;bottom:3px;background:var(--text-secondary,#6b8cae);transition:0.2s;border-radius:50%;}' +
    '.addon-toggle input:checked + .addon-toggle-slider{background:rgba(34,197,94,0.3);}' +
    '.addon-toggle input:checked + .addon-toggle-slider::before{transform:translateX(18px);background:#22c55e;}' +
    '.addon-card-incompatible{opacity:0.5;pointer-events:auto;}' +
    '.addon-install-btn.incompatible{background:rgba(239,68,68,0.2)!important;color:#ef4444!important;cursor:not-allowed!important;border:1px solid rgba(239,68,68,0.3)!important;}' +
    '.addon-detail-install-btn.incompatible{background:rgba(239,68,68,0.2)!important;color:#ef4444!important;cursor:not-allowed!important;border:1px solid rgba(239,68,68,0.3)!important;}' +
    '.addon-compat-label{font-size:10px;opacity:0.6;margin-right:8px;white-space:nowrap;}' +
    '.addon-compat-label.incompatible{color:#ef4444;opacity:1;}' +
    '.store-panel{overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;}' +
    '.store-panel::-webkit-scrollbar{width:6px;}' +
    '.store-panel::-webkit-scrollbar-track{background:transparent;}' +
    '.store-panel::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}' +
    '.store-panel::-webkit-scrollbar-thumb:hover{background:rgba(30,144,255,0.5);}' +
    '.installed-section{overflow-y:auto;}' +
    '@media (max-height:860px){' +
        '.store-tabs{padding:0 12px;}' +
        '.store-tab{padding:8px 12px;font-size:12px;}' +
        '.addon-grid{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;}' +
        '.addon-card{padding:12px;gap:8px;}' +
        '.addon-card-header{gap:8px;}' +
        '.addon-icon{width:36px;height:36px;border-radius:8px;}' +
        '.addon-card-name{font-size:12px;}' +
        '.addon-card-author{font-size:10px;}' +
        '.addon-card-desc{font-size:11px;}' +
        '.addon-install-btn{padding:4px 10px;font-size:10px;}' +
        '.store-section-title{font-size:13px;margin-bottom:10px;}' +
        '.installed-item{padding:8px 12px;gap:8px;}' +
        '.installed-item-icon{width:28px;height:28px;border-radius:6px;}' +
        '.installed-item-icon svg{width:14px;height:14px;}' +
        '.installed-item-name{font-size:12px;}' +
        '.installed-item-version{font-size:10px;}' +
        '.installed-item-remove{width:26px;height:26px;}' +
        '.installed-item-remove svg{width:13px;height:13px;}' +
        '.installed-group-title{font-size:11px;margin-bottom:8px;}' +
        '.installed-group{margin-bottom:16px;}' +
        '.chrome-ext-section{padding:14px;}' +
        '.chrome-ext-install-box{padding:14px;}' +
        '.chrome-ext-install-box h3{font-size:13px;margin-bottom:4px;}' +
        '.chrome-ext-install-box p{font-size:11px;margin-bottom:10px;}' +
        '.chrome-ext-form input{padding:7px 10px;font-size:12px;}' +
        '.chrome-ext-form button{padding:7px 14px;font-size:12px;}' +
        '.chrome-ext-quick{padding:4px 10px;font-size:11px;}' +
        '.addon-detail-hero{padding:16px;}' +
        '.addon-detail-icon{width:52px;height:52px;border-radius:12px;}' +
        '.addon-detail-name{font-size:16px;}' +
        '.addon-detail-author-line{font-size:11px;}' +
        '.addon-detail-install-btn{padding:7px 18px;font-size:12px;}' +
        '.addon-detail-body{padding:0 16px 16px;}' +
        '.addon-detail-section h3{font-size:12px;}' +
        '.addon-detail-section p{font-size:11px;}' +
    '}';
document.head.appendChild(storeStyle);

(function _initStoreBindings() {
    const extBtn = document.getElementById('extensions-btn');
    if (extBtn) {
        extBtn.addEventListener('click', openStoreModal);
    }
    updateInstalledBadge();
})();

window.openStoreModal = openStoreModal;
window.loadStoreAddons = loadStoreAddons;
window.installExtensionById = function(extensionId) {
    installChromeExtension(extensionId, null);
};