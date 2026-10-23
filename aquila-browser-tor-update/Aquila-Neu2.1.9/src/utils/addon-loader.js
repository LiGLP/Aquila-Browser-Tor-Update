const _ipc = require('electron').ipcRenderer;

window.AquilaAddons = window.AquilaAddons || {};

const AddonLoader = {
    _enabledAddons: {},
    _loadedScripts: {},
    _addonMeta: {},
    _installedList: [],
    _ready: false,

    async init() {
        if (this._ready) return;

        try {
            const states = await _ipc.invoke('get-addon-states');
            this._enabledAddons = states || {};
        } catch (e) {
            this._enabledAddons = {};
        }

        await this._discoverAndLoad();
        this._activateEnabled();
        this._autoEnableNewAddons();
        await this._verifyStates();
        this._ready = true;
    },

    async _discoverAndLoad() {
        let addonList = [];
        try {
            addonList = await _ipc.invoke('get-installed-addons');
        } catch (e) {
            addonList = [];
        }
        if (!Array.isArray(addonList)) return;
        this._installedList = addonList;

        for (const addon of addonList) {
            if (this._loadedScripts[addon.id]) continue;
            this._addonMeta[addon.id] = { bundled: !!addon.bundled };
            await this._loadScript(addon);
        }
    },

    async _loadScript(addon) {
        try {
            const script = document.createElement('script');
            script.src = addon.scriptPath;
            script.dataset.addonId = addon.id;
            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = () => reject(new Error('Script load failed: ' + addon.scriptPath));
                document.head.appendChild(script);
            });
            this._loadedScripts[addon.id] = script;
            return true;
        } catch (e) {
            console.error('[AddonLoader] Failed to load ' + addon.id + ':', e);
            return false;
        }
    },

    _activateEnabled() {
        for (const id of Object.keys(this._enabledAddons)) {
            if (this._enabledAddons[id] !== true) continue;
            if (!window.AquilaAddons[id]) continue;
            try {
                window.AquilaAddons[id].activate();
            } catch (e) {
                console.error('[AddonLoader] Failed to activate ' + id + ':', e);
            }
        }
    },

    _autoEnableNewAddons() {
        let changed = false;
        for (const addon of this._installedList) {
            if (addon.id in this._enabledAddons) continue;
            if (!window.AquilaAddons[addon.id]) continue;
            this._enabledAddons[addon.id] = true;
            changed = true;
            try { window.AquilaAddons[addon.id].activate(); } catch(e) {}
        }
        if (changed) this._saveStates();
    },

    _verifyStates() {
        return _ipc.invoke('get-addon-states').then(saved => {
            for (const id of Object.keys(this._enabledAddons)) {
                if (this._enabledAddons[id] === false && saved && saved[id] !== false) {
                    _ipc.invoke('save-addon-states', this._enabledAddons);
                    return;
                }
            }
        }).catch(() => {});
    },

    isEnabled(addonId) {
        return this._enabledAddons[addonId] === true;
    },

    isLoaded(addonId) {
        return !!window.AquilaAddons[addonId] || !!this._loadedScripts[addonId];
    },

    getAll() {
        const result = [];
        const seen = new Set();

        for (const id of Object.keys(window.AquilaAddons)) {
            const addon = window.AquilaAddons[id];
            const meta = this._addonMeta[id] || {};
            seen.add(id);
            result.push({
                id: addon.id || id,
                name: addon.name || id,
                version: addon.version || '1.0.0',
                enabled: this.isEnabled(id),
                bundled: meta.bundled !== false
            });
        }

        for (const addon of this._installedList) {
            if (seen.has(addon.id)) continue;
            seen.add(addon.id);
            result.push({
                id: addon.id,
                name: addon.name || addon.id,
                version: addon.version || '1.0.0',
                enabled: this.isEnabled(addon.id),
                bundled: !!addon.bundled
            });
        }

        return result;
    },

    async enable(addonId) {
        if (this._enabledAddons[addonId] === true) {
            if (window.AquilaAddons[addonId]) {
                try { window.AquilaAddons[addonId].activate(); } catch(e) {}
            }
            return true;
        }

        if (!window.AquilaAddons[addonId]) {
            const installed = this._installedList.find(a => a.id === addonId);
            if (installed) await this._loadScript(installed);
        }

        this._enabledAddons[addonId] = true;
        await this._saveStates();

        if (window.AquilaAddons[addonId]) {
            try { window.AquilaAddons[addonId].activate(); } catch(e) {}
        }

        return true;
    },

    async disable(addonId) {
        if (window.AquilaAddons[addonId]) {
            try { window.AquilaAddons[addonId].deactivate(); } catch(e) {
                console.error('[AddonLoader] deactivate() threw for ' + addonId + ':', e);
            }
        }

        this._enabledAddons[addonId] = false;
        await this._saveStates();
        return true;
    },

    async toggle(addonId) {
        if (this.isEnabled(addonId)) return await this.disable(addonId);
        return await this.enable(addonId);
    },

    async installFromStore(addonId) {
        const result = await _ipc.invoke('download-store-addon', addonId);
        if (!result.success) return result;

        if (!this._loadedScripts[addonId] && result.scriptPath) {
            this._addonMeta[addonId] = { bundled: false };
            const loaded = await this._loadScript({ id: addonId, scriptPath: result.scriptPath });
            if (!loaded) return { success: false, error: 'Script konnte nicht geladen werden' };
        }

        this._enabledAddons[addonId] = true;
        await this._saveStates();

        try {
            this._installedList = await _ipc.invoke('get-installed-addons') || [];
        } catch(e) {}

        if (window.AquilaAddons[addonId]) {
            try { window.AquilaAddons[addonId].activate(); } catch(e) {}
        }

        return { success: true };
    },

    async uninstall(addonId) {
        if (window.AquilaAddons[addonId]) {
            try { window.AquilaAddons[addonId].deactivate(); } catch(e) {}
        }

        delete this._enabledAddons[addonId];
        await this._saveStates();

        if (this._loadedScripts[addonId]) {
            const script = this._loadedScripts[addonId];
            if (script.parentNode) script.remove();
            delete this._loadedScripts[addonId];
        }

        delete window.AquilaAddons[addonId];
        delete this._addonMeta[addonId];
        this._installedList = this._installedList.filter(a => a.id !== addonId);

        return await _ipc.invoke('uninstall-aquila-addon', addonId);
    },

    async _saveStates() {
        try {
            const result = await _ipc.invoke('save-addon-states', this._enabledAddons);
            return result !== false;
        } catch (e) {
            console.error('[AddonLoader] _saveStates failed:', e);
            return false;
        }
    }
};

window.AddonLoader = AddonLoader;

async function waitForIPC(channel, retries = 10, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await _ipc.invoke(channel);
        } catch(e) {
            if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
        }
    }
    return null;
}

(async function _initAddonLoader() {
    const states = await waitForIPC('get-addon-states');
    if (states !== null) AddonLoader._enabledAddons = states || {};
    AddonLoader.init();
})();