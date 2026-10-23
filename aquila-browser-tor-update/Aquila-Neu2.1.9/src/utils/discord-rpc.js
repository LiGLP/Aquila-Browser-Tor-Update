let rpc = null;
let isRPCReady = false;
let rpcInterval = null;
let appVersion = '';
let reconnectTimeout = null;
const startTimestamp = new Date();

let cachedTitle = '';
let cachedUrl = '';
let cachedIsTab = false;

function extractDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, '');
    } catch (e) {
        return '';
    }
}

function attachWebviewListeners(webview) {
    if (webview._rpcListenerAttached) return;
    webview._rpcListenerAttached = true;

    if (webview.getAttribute('partition') === 'aquila-tor') return;

    webview.addEventListener('did-navigate', () => {
        if (!isRPCReady || !rpc || !webview.classList.contains('active')) return;
        updateTabActivity(webview.getTitle(), webview.getURL());
    });

    webview.addEventListener('did-navigate-in-page', () => {
        if (!isRPCReady || !rpc || !webview.classList.contains('active')) return;
        setTimeout(() => {
            updateTabActivity(webview.getTitle(), webview.getURL());
        }, 500);
    });

    webview.addEventListener('page-title-updated', (e) => {
        if (!isRPCReady || !rpc || !webview.classList.contains('active')) return;
        updateTabActivity(e.title, webview.getURL());
    });
}

function initWebviewListeners() {
    document.querySelectorAll('webview').forEach(attachWebviewListeners);

    const observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.tagName === 'WEBVIEW') {
                    attachWebviewListeners(node);
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

async function initializeDiscordRPC() {
    const data = await ipcRenderer.invoke('get-data');

    if (!data.settings.discordRPC) {
        destroyDiscordRPC();
        return;
    }

    if (rpc) return;

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    try {
        appVersion = await ipcRenderer.invoke('get-app-version');
    } catch (e) {
        appVersion = '0.0.0';
    }

    try {
        const { Client } = require('discord-rpc');
        const clientId = '1365707136088281138';
        rpc = new Client({ transport: 'ipc' });

        rpc.on('ready', () => {
            isRPCReady = true;
            restoreCachedActivity();
        });

        rpc.on('disconnected', () => {
            isRPCReady = false;
            rpc = null;
            stopRPCInterval();
            scheduleReconnect();
        });

        await rpc.login({ clientId });
        isRPCReady = true;

        refreshActivity();
        startRPCInterval();
        initWebviewListeners();

    } catch (error) {
        isRPCReady = false;
        rpc = null;
        stopRPCInterval();
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectTimeout) return;
    reconnectTimeout = setTimeout(async () => {
        reconnectTimeout = null;
        const data = await ipcRenderer.invoke('get-data');
        if (data.settings.discordRPC) {
            initializeDiscordRPC();
        }
    }, 5000);
}

async function restoreCachedActivity() {
    if (cachedIsTab && cachedUrl) {
        await updateTabActivity(cachedTitle, cachedUrl);
    } else {
        await setAquilaActivity();
    }
}

function startRPCInterval() {
    stopRPCInterval();
    rpcInterval = setInterval(() => {
        if (isRPCReady && rpc) {
            restoreCachedActivity();
        } else {
            stopRPCInterval();
        }
    }, 60000);
}

function stopRPCInterval() {
    if (rpcInterval) {
        clearInterval(rpcInterval);
        rpcInterval = null;
    }
}

async function refreshActivity() {
    const data = await ipcRenderer.invoke('get-data');
    if (data.settings.discordShowTab) {
        const activeWebview = document.querySelector('webview.active');
        if (activeWebview) {
            updateTabActivity(activeWebview.getTitle(), activeWebview.getURL());
            return;
        }
    }
    setAquilaActivity();
}

async function setAquilaActivity() {
    if (!isRPCReady || !rpc) return;

    cachedIsTab = false;
    cachedTitle = '';
    cachedUrl = '';

    const data = await ipcRenderer.invoke('get-data');
    const showButtons = data.settings.discordButtons !== false;

    const buttons = showButtons
        ? [{ label: 'Join Discord', url: 'https://discord.gg/b38W67FAYQ' }]
        : undefined;

    rpc.setActivity({
        details: 'Version ' + appVersion,
        state: 'Safe, Strong, Performance',
        startTimestamp: startTimestamp,
        largeImageKey: 'aquila_logo',
        largeImageText: 'Aquila Browser v' + appVersion + ' • Fast, Modern, Powerful',
        smallImageKey: 'browser_icon',
        smallImageText: 'Online',
        buttons: buttons,
        instance: false
    }).catch(() => {});
}

async function updateTabActivity(title, url) {
    if (!isRPCReady || !rpc) return;

    const data = await ipcRenderer.invoke('get-data');
    const currentTab = typeof window.getCurrentTab === 'function' ? window.getCurrentTab() : null;
    if (!data.settings.discordRPC || !data.settings.discordShowTab || (currentTab && currentTab.isTor)) {
        setAquilaActivity();
        return;
    }

    const domain = extractDomain(url);

    if (!domain || domain === '' || url.startsWith('aquila://')) {
        setAquilaActivity();
        return;
    }

    if (data.settings.discordSiteFilter) {
        const allowed = (data.settings.discordAllowedSites || '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        const isAllowed = allowed.some(a => domain === a || domain.endsWith('.' + a));
        if (!isAllowed) {
            setAquilaActivity();
            return;
        }
    }

    const truncatedTitle = title.length > 128 ? title.substring(0, 125) + '...' : title;
    const details = truncatedTitle || 'Browsing';

    cachedIsTab = true;
    cachedTitle = title;
    cachedUrl = url;

    const showButtons = data.settings.discordButtons !== false;

    let buttons;
    if (showButtons) {
        const safeUrl = url.length > 512 ? url.substring(0, 512) : url;
        buttons = [
            { label: 'Join Discord', url: 'https://discord.gg/b38W67FAYQ' },
            { label: 'Visit Page', url: safeUrl }
        ];
    } else {
        buttons = undefined;
    }

    rpc.setActivity({
        details: details,
        state: domain,
        startTimestamp: startTimestamp,
        largeImageKey: 'aquila_logo',
        largeImageText: 'Aquila Browser v' + appVersion + ' • Fast, Modern, Powerful',
        smallImageKey: 'browser_icon',
        smallImageText: 'Online',
        buttons: buttons,
        instance: false
    }).catch(() => {});
}

async function setCustomDiscordActivity(details, state) {
    if (!isRPCReady || !rpc) return;

    const data = await ipcRenderer.invoke('get-data');
    const showButtons = data.settings.discordButtons !== false;
    const buttons = showButtons
        ? [{ label: 'Join Discord', url: 'https://discord.gg/b38W67FAYQ' }]
        : undefined;

    rpc.setActivity({
        details: details || 'Surft im Internet',
        state: state || 'Aquila Browser v' + appVersion,
        startTimestamp: startTimestamp,
        largeImageKey: 'aquila_logo',
        largeImageText: 'Aquila Browser v' + appVersion + ' • Fast, Modern, Powerful',
        smallImageKey: 'browser_icon',
        smallImageText: 'Online',
        buttons: buttons,
        instance: false
    }).catch(() => {});
}

function clearDiscordActivity() {
    if (!isRPCReady || !rpc) return;
    rpc.clearActivity().catch(() => {});
}

function destroyDiscordRPC() {
    stopRPCInterval();
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    if (rpc) {
        try {
            rpc.clearActivity().catch(() => {});
            rpc.destroy();
        } catch (error) {}
        isRPCReady = false;
        rpc = null;
    }
}

window.addEventListener('beforeunload', () => {
    destroyDiscordRPC();
});

window.initializeDiscordRPC = initializeDiscordRPC;
window.destroyDiscordRPC = destroyDiscordRPC;
window.setCustomDiscordActivity = setCustomDiscordActivity;
window.setAquilaActivity = setAquilaActivity;
window.updateTabActivity = updateTabActivity;

setTimeout(async () => {
    const data = await ipcRenderer.invoke('get-data');
    if (data.settings.discordRPC) {
        initializeDiscordRPC();
    }
}, 1000);