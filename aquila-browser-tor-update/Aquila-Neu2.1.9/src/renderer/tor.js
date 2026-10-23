let torState = { status: 'off', progress: 0, message: '', error: '', exitIp: null, exitCountry: '', bridges: 'none' };
let torSettings = { exitCountry: '', bridges: 'none', customBridges: '', binaryPath: '' };
let torPanelEl = null;
let torBusy = false;

const TOR_COUNTRIES = [
    ['', 'tor.country_auto'],
    ['de', 'Deutschland'], ['at', 'Österreich'], ['ch', 'Schweiz'], ['nl', 'Niederlande'],
    ['fr', 'Frankreich'], ['se', 'Schweden'], ['no', 'Norwegen'], ['fi', 'Finnland'],
    ['is', 'Island'], ['lu', 'Luxemburg'], ['ro', 'Rumänien'], ['pl', 'Polen'],
    ['cz', 'Tschechien'], ['gb', 'Großbritannien'], ['us', 'USA'], ['ca', 'Kanada'],
    ['jp', 'Japan'], ['sg', 'Singapur']
];

const TOR_BRIDGES = [
    ['none', 'tor.bridges_none'],
    ['obfs4', 'obfs4'],
    ['snowflake', 'Snowflake'],
    ['meek', 'meek (Azure)'],
    ['custom', 'tor.bridges_custom']
];

function tt(key) {
    return typeof window.t === 'function' ? window.t(key) : key;
}

function torEscape(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function torStatusText(st) {
    if (st.status === 'downloading') return st.message || tt('tor.status_downloading');
    if (st.status === 'starting') return tt('tor.status_starting');
    if (st.status === 'connecting') return tt('tor.status_connecting') + ' ' + (st.progress || 0) + '%';
    if (st.status === 'connected') return tt('tor.status_connected');
    if (st.status === 'error') return tt('tor.status_error');
    return tt('tor.status_off');
}

function pushTorStateToTab(tab) {
    if (!tab || !tab.isTor || !tab.webview || !window.isTorHomeUrl(tab.url)) return;
    try {
        tab.webview.executeJavaScript('window.aquilaTorStatus && window.aquilaTorStatus(' + JSON.stringify(torState) + ')').catch(() => {});
    } catch (e) {}
}

function retryFailedTorTabs() {
    (window.tabs || []).forEach(tab => {
        if (tab.isTor && tab.isErrorPage && tab.failedUrl && tab.webview) {
            tab.isErrorPage = false;
            tab.webview.src = tab.failedUrl;
        }
    });
}

function updateTorButton() {
    const btn = document.getElementById('tor-btn');
    if (!btn) return;
    btn.dataset.status = torState.status;
    btn.title = 'Tor: ' + torStatusText(torState);
}

function updateTorUi() {
    const tab = typeof window.getCurrentTab === 'function' ? window.getCurrentTab() : null;
    document.body.classList.toggle('tor-active', !!(tab && tab.isTor));
    const input = document.getElementById('address-input');
    if (input) input.placeholder = tab && tab.isTor ? tt('tor.search_placeholder') : tt('nav.search_placeholder');
    updateTorButton();
}

function renderTorPanel() {
    if (!torPanelEl) return;
    const st = torState;
    const running = ['starting', 'connecting', 'connected', 'downloading'].includes(st.status);
    const connected = st.status === 'connected';
    const progress = connected ? 100 : (st.progress || 0);

    let detail = '';
    if (st.status === 'error') detail = st.error;
    else if (connected) detail = st.exitIp ? tt('tor.exit_ip') + ': ' + st.exitIp : tt('tor.exit_ip_loading');
    else if (running) detail = st.message;

    const countryOptions = TOR_COUNTRIES.map(([code, label]) =>
        '<option value="' + code + '"' + (torSettings.exitCountry === code ? ' selected' : '') + '>' + torEscape(code ? label + ' (' + code.toUpperCase() + ')' : tt(label)) + '</option>'
    ).join('');
    const bridgeOptions = TOR_BRIDGES.map(([code, label]) =>
        '<option value="' + code + '"' + (torSettings.bridges === code ? ' selected' : '') + '>' + torEscape(label.startsWith('tor.') ? tt(label) : label) + '</option>'
    ).join('');

    torPanelEl.innerHTML =
        '<div class="tor-panel-header">' +
            '<div class="tor-panel-status" data-status="' + st.status + '"><span class="tor-dot"></span><span>' + torEscape(torStatusText(st)) + '</span></div>' +
            '<div class="tor-progress"><div style="width:' + progress + '%"></div></div>' +
            (detail ? '<div class="tor-panel-detail">' + torEscape(detail) + '</div>' : '') +
        '</div>' +
        '<button class="tor-panel-btn primary" data-action="new-tab">' + tt('tor.new_tab') + '<span>Alt+Shift+N</span></button>' +
        '<button class="tor-panel-btn" data-action="new-circuit"' + (connected && !torBusy ? '' : ' disabled') + '>' + tt('tor.new_circuit') + '</button>' +
        '<button class="tor-panel-btn" data-action="new-identity"' + (connected && !torBusy ? '' : ' disabled') + '>' + tt('tor.new_identity') + '</button>' +
        '<div class="tor-panel-section">' +
            '<label>' + tt('tor.exit_country') + '<select data-field="exitCountry">' + countryOptions + '</select></label>' +
            '<label>' + tt('tor.bridges') + '<select data-field="bridges">' + bridgeOptions + '</select></label>' +
            (torSettings.bridges === 'custom'
                ? '<textarea data-field="customBridges" rows="3" spellcheck="false" placeholder="obfs4 1.2.3.4:443 FINGERPRINT cert=… iat-mode=0">' + torEscape(torSettings.customBridges) + '</textarea>' +
                  '<button class="tor-panel-btn small" data-action="save-bridges">' + tt('tor.save_bridges') + '</button>'
                : '') +
            '<p class="tor-panel-hint">' + tt('tor.bridges_hint') + '</p>' +
        '</div>' +
        '<button class="tor-panel-btn" data-action="' + (running ? 'stop' : 'start') + '">' + (running ? tt('tor.stop') : tt('tor.connect')) + '</button>';
}

function positionTorPanel() {
    const btn = document.getElementById('tor-btn');
    if (!btn || !torPanelEl) return;
    const rect = btn.getBoundingClientRect();
    torPanelEl.style.top = (rect.bottom + 8) + 'px';
    torPanelEl.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
}

function closeTorPanel() {
    if (torPanelEl) torPanelEl.remove();
    torPanelEl = null;
    document.removeEventListener('mousedown', onTorOutsideClick, true);
}

function onTorOutsideClick(e) {
    const btn = document.getElementById('tor-btn');
    if (torPanelEl && !torPanelEl.contains(e.target) && !(btn && btn.contains(e.target))) closeTorPanel();
}

async function openTorPanel() {
    if (torPanelEl) { closeTorPanel(); return; }
    try {
        const res = await ipcRenderer.invoke('tor-get-state');
        torSettings = res.settings || torSettings;
        delete res.settings;
        torState = res;
    } catch (e) {}

    torPanelEl = document.createElement('div');
    torPanelEl.className = 'tor-panel';
    torPanelEl.addEventListener('click', onTorPanelClick);
    torPanelEl.addEventListener('change', onTorPanelChange);
    document.body.appendChild(torPanelEl);
    renderTorPanel();
    positionTorPanel();
    document.addEventListener('mousedown', onTorOutsideClick, true);
    if (torState.status === 'connected' && !torState.exitIp) ipcRenderer.invoke('tor-refresh-ip').catch(() => {});
}

async function runTorAction(channel) {
    torBusy = true;
    renderTorPanel();
    try {
        const res = await ipcRenderer.invoke(channel);
        if (res && res.success === false && window.showNotification) window.showNotification(res.error, 'error');
        return res;
    } finally {
        torBusy = false;
        renderTorPanel();
    }
}

async function onTorPanelClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'new-tab') {
        closeTorPanel();
        window.createTorTab();
    } else if (action === 'new-circuit') {
        const res = await runTorAction('tor-new-circuit');
        if (res && res.success) {
            const tab = window.getCurrentTab();
            if (tab && tab.isTor && tab.webview && !window.isTorHomeUrl(tab.url)) {
                try { tab.webview.reload(); } catch (err) {}
            }
        }
    } else if (action === 'new-identity') {
        const ok = typeof window.aqConfirm === 'function' ? await window.aqConfirm(tt('tor.new_identity_confirm')) : true;
        if (!ok) return;
        const res = await runTorAction('tor-new-identity');
        if (res && res.success) {
            (window.tabs || []).forEach(tab => {
                if (tab.isTor && tab.webview && !window.isTorHomeUrl(tab.url)) {
                    try { tab.webview.reload(); } catch (err) {}
                }
            });
        }
    } else if (action === 'start') {
        ipcRenderer.invoke('tor-start').catch(() => {});
    } else if (action === 'stop') {
        ipcRenderer.invoke('tor-stop').catch(() => {});
    } else if (action === 'save-bridges') {
        const area = torPanelEl.querySelector('[data-field="customBridges"]');
        await saveTorSettings({ bridges: 'custom', customBridges: area ? area.value : '' });
    }
}

async function onTorPanelChange(e) {
    const field = e.target.dataset.field;
    if (field === 'exitCountry') {
        await saveTorSettings({ exitCountry: e.target.value });
    } else if (field === 'bridges') {
        if (e.target.value === 'custom') {
            torSettings.bridges = 'custom';
            renderTorPanel();
            return;
        }
        await saveTorSettings({ bridges: e.target.value });
    }
}

async function saveTorSettings(patch) {
    torBusy = true;
    renderTorPanel();
    try {
        const res = await ipcRenderer.invoke('tor-save-settings', patch);
        torSettings = res.settings || torSettings;
        delete res.settings;
        torState = res;
    } catch (e) {
        if (window.showNotification) window.showNotification(e.message, 'error');
    } finally {
        torBusy = false;
        renderTorPanel();
    }
}

ipcRenderer.on('tor-state', (event, st) => {
    const wasConnected = torState.status === 'connected';
    torState = st;
    updateTorButton();
    renderTorPanel();
    (window.tabs || []).forEach(pushTorStateToTab);
    if (st.status === 'connected' && !wasConnected) retryFailedTorTabs();
    if (st.status === 'error' && !wasConnected && torPanelEl === null && (window.tabs || []).some(t => t.isTor) && window.showNotification) {
        window.showNotification('Tor: ' + st.error, 'error');
    }
});

window.addEventListener('resize', positionTorPanel);

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('tor-btn');
    if (btn) btn.addEventListener('click', openTorPanel);
    ipcRenderer.invoke('tor-get-state').then(res => {
        torSettings = res.settings || torSettings;
        delete res.settings;
        torState = res;
        updateTorUi();
    }).catch(() => {});
});

window.updateTorUi = updateTorUi;
window.pushTorStateToTab = pushTorStateToTab;
window.openTorPanel = openTorPanel;
