const { ipcRenderer } = require('electron');
require('./utils/modal.js');



let browserData = null;
let dataCache = null;
let dataCacheTime = 0;
const DATA_CACHE_TTL = 5000;

let currentLang = 'de';

const path = require('path');
let translations = { de: {}, en: {} };
try {
    translations.de = require(path.join(__dirname, 'renderer', 'language', 'de'));
    translations.en = require(path.join(__dirname, 'renderer', 'language', 'en'));
} catch(e) {
    console.error('[i18n] Sprachdateien konnten nicht geladen werden:', e.message);
}

function t(key) {
    return (translations[currentLang] || translations['de'])[key] || translations['de'][key] || key;
}

window.t = t;

async function init() {
    console.log('[DEBUG] R-1 - renderer init started');
    try {
        browserData = await getDataCached();
        console.log('[DEBUG] R-2 - data loaded');

        applyTheme(browserData.settings.theme);
        console.log('[DEBUG] R-3 - theme applied:', browserData.settings.theme);
        if (browserData.settings.compactTabs) document.body.classList.add('compact-tabs');
        applyLanguage(browserData.settings.language);
        console.log('[DEBUG] R-4 - language applied');

        setupTitlebar();
        console.log('[DEBUG] R-5 - titlebar setup');
        setupNavigation();
        console.log('[DEBUG] R-6 - navigation setup');
        setupModals();
        console.log('[DEBUG] R-7 - modals setup');
        setupBookmarkStar();
        setupProxyIndicator();
        console.log('[DEBUG] R-8 - bookmark star + proxy setup');

        updatePartnersButtonVisibility(browserData.settings.disableSponsoredContent);

        createHomeTab();
        console.log('[DEBUG] R-9 - home tab created');

        if (browserData.settings.sessionRestore) {
            console.log('[DEBUG] R-9a - restoring session...');
            const lastSession = await ipcRenderer.invoke('get-session');
            if (lastSession && lastSession.length > 0) {
                console.log('[DEBUG] R-9b - restoring', lastSession.length, 'tabs');
                lastSession.forEach((entry, i) => {
                    if (!entry.url || entry.url === 'aquila://home') return;
                    createTab(entry.url);
                    const restoredTab = window.tabs[window.tabs.length - 1];
                    if (!restoredTab || !restoredTab.webview) return;
                    const wv = restoredTab.webview;
                    const onReady = () => {
                        setTimeout(() => {
                            try {
                                wv.src = entry.url;
                            } catch (e) {}
                        }, 300 + i * 150);
                    };
                    if (wv.isConnected) {
                        onReady();
                    } else {
                        wv.addEventListener('dom-ready', onReady, { once: true });
                    }
                });
            }
        }

        console.log('[DEBUG] R-10 - init complete');
    } catch(e) {
        console.log('[DEBUG] R-ERR - init crashed:', e.message, e.stack);
    }
}

async function getDataCached() {
    const now = Date.now();
    if (dataCache && (now - dataCacheTime) < DATA_CACHE_TTL) {
        return dataCache;
    }
    dataCache = await ipcRenderer.invoke('get-data');
    dataCacheTime = now;
    return dataCache;
}

function invalidateDataCache() {
    dataCache = null;
    dataCacheTime = 0;
}

function applyTheme(themeName) {
    const themeLink = document.getElementById('theme-stylesheet');
    if (themeLink.href.endsWith(`${themeName}.css`)) return;
    themeLink.href = `styles/themes/${themeName}.css`;
}

function applyLanguage(lang) {
    currentLang = (lang === 'en') ? 'en' : 'de';

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.getAttribute('data-i18n-title'));
    });
}

window.applyLanguage = applyLanguage;

function setupTitlebar() {
    document.getElementById('minimize-btn').addEventListener('click', () => {
        ipcRenderer.invoke('window-minimize');
    });

    document.getElementById('maximize-btn').addEventListener('click', async () => {
        const isMaximized = await ipcRenderer.invoke('window-maximize');
        updateMaximizeIcon(isMaximized);
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.invoke('window-close');
    });
}

function updateMaximizeIcon(isMaximized) {
    const svg = document.getElementById('maximize-btn').querySelector('svg');
    svg.innerHTML = isMaximized
        ? '<path d="M0,3v7h7V3H0z M6,9H1V4h5V9z M10,0v1H3v1h8V0H10z"/>'
        : '<path d="M0,0v10h10V0H0z M9,9H1V1h8V9z"/>';
}

function setupNavigation() {
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const reloadBtn = document.getElementById('reload-btn');
    const addressInput = document.getElementById('address-input');

    backBtn.addEventListener('click', () => {
        const activeTab = getCurrentTab();
        if (activeTab && activeTab.webview) activeTab.webview.goBack();
    });

    forwardBtn.addEventListener('click', () => {
        const activeTab = getCurrentTab();
        if (activeTab && activeTab.webview) activeTab.webview.goForward();
    });

    reloadBtn.addEventListener('click', async () => {
        const activeTab = getCurrentTab();
        if (activeTab) {
            if (activeTab.isHome) {
                loadQuickAccess();
            } else if (activeTab.webview) {
                const currentUrl = activeTab.url;
                const data = await getDataCached();

                if (data.settings.httpsOnly && currentUrl.startsWith('http://') && !currentUrl.includes('localhost')) {
                    const httpsUrl = currentUrl.replace('http://', 'https://');
                    activeTab.webview.src = httpsUrl;
                    activeTab.url = httpsUrl;
                } else {
                    activeTab.webview.reload();
                }
            }
        }
    });

    addressInput.addEventListener('focus', () => {
        addressInput.select();
    });
}

function setupBookmarkStar() {
    const bookmarkStarBtn = document.getElementById('bookmark-star-btn');
    if (bookmarkStarBtn) bookmarkStarBtn.addEventListener('click', toggleCurrentBookmark);
}

let proxyStyleInjected = false;

function injectProxyIcon() {
    if (document.getElementById('proxy-indicator')) return;
    const bookmarkStar = document.getElementById('bookmark-star-btn');
    if (!bookmarkStar) return;

    if (!proxyStyleInjected) {
        const style = document.createElement('style');
        style.textContent = `
            #proxy-indicator {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 30px;
                height: 30px;
                border-radius: 6px;
                cursor: default;
                flex-shrink: 0;
            }
            #proxy-indicator:hover { background: rgba(255,255,255,0.07); }
            #proxy-tooltip {
                position: absolute;
                bottom: calc(100% + 8px);
                left: 50%;
                transform: translateX(-50%);
                background: rgba(10,22,40,0.97);
                color: #e0e0e0;
                padding: 6px 12px;
                border-radius: 6px;
                font-size: 12px;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s;
                z-index: 10000;
                border: 1px solid rgba(255,255,255,0.1);
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            }
            #proxy-indicator:hover #proxy-tooltip { opacity: 1; }
        `;
        document.head.appendChild(style);
        proxyStyleInjected = true;
    }

    const indicator = document.createElement('div');
    indicator.id = 'proxy-indicator';
    indicator.innerHTML = `
        <div id="proxy-tooltip"></div>
        <svg id="proxy-icon-normal" viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;display:block;">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
        </svg>
        <svg id="proxy-icon-error" viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;display:none;">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
            <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
    `;

    bookmarkStar.after(indicator);
}

function updateProxyIndicator(enabled, connected) {
    let indicator = document.getElementById('proxy-indicator');

    if (!enabled) {
        if (indicator) indicator.style.display = 'none';
        return;
    }

    if (!indicator) {
        injectProxyIcon();
        indicator = document.getElementById('proxy-indicator');
        if (!indicator) return;
    }

    indicator.style.display = 'flex';

    const normalIcon = document.getElementById('proxy-icon-normal');
    const errorIcon = document.getElementById('proxy-icon-error');
    const tooltip = document.getElementById('proxy-tooltip');

    if (connected) {
        indicator.style.color = '#10b981';
        if (normalIcon) normalIcon.style.display = 'block';
        if (errorIcon) errorIcon.style.display = 'none';
        if (tooltip) tooltip.textContent = 'Du bist mit dem Proxy verbunden';
    } else {
        indicator.style.color = '#ef4444';
        if (normalIcon) normalIcon.style.display = 'none';
        if (errorIcon) errorIcon.style.display = 'block';
        if (tooltip) tooltip.textContent = 'Fehler bei der Verbindung mit dem Proxy';
    }
}

async function setupProxyIndicator() {
    const data = await getDataCached();
    if (!data.settings.proxyEnabled) return;
    injectProxyIcon();
    const result = await ipcRenderer.invoke('test-proxy', data.settings.proxyServer || '2.59.132.39:3128');
    updateProxyIndicator(true, result.success);
}

window.updateProxyIndicator = updateProxyIndicator;
window.injectProxyIcon = injectProxyIcon;

async function toggleCurrentBookmark() {
    const activeTab = getCurrentTab();
    if (!activeTab || activeTab.isHome || !activeTab.url) return;

    invalidateDataCache();
    const data = await getDataCached();
    const existingBookmark = data.bookmarks.find(b => b.url === activeTab.url);

    if (existingBookmark) {
        await ipcRenderer.invoke('delete-bookmark', existingBookmark.id);
    } else {
        await ipcRenderer.invoke('add-bookmark', {
            title: activeTab.title || activeTab.url,
            url: activeTab.url
        });
    }

    invalidateDataCache();
    updateBookmarkStarState();
    updateTabBookmarkIcon(activeTab);
}

async function updateBookmarkStarState() {
    const activeTab = getCurrentTab();
    const bookmarkStarBtn = document.getElementById('bookmark-star-btn');

    if (!bookmarkStarBtn) return;

    if (!activeTab || activeTab.isHome || !activeTab.url) {
        bookmarkStarBtn.style.display = 'none';
        return;
    }

    bookmarkStarBtn.style.display = 'flex';

    const data = await getDataCached();
    const isBookmarked = data.bookmarks.some(b => b.url === activeTab.url);

    const starOutline = bookmarkStarBtn.querySelector('.star-outline');
    const starFilled = bookmarkStarBtn.querySelector('.star-filled');

    if (isBookmarked) {
        starOutline.style.display = 'none';
        starFilled.style.display = 'block';
        bookmarkStarBtn.title = t('nav.bookmark_remove');
    } else {
        starOutline.style.display = 'block';
        starFilled.style.display = 'none';
        bookmarkStarBtn.title = t('nav.bookmark_add');
    }
}

function navigateToUrl(input) {
    let url = input.trim();
    if (!url) return;

    const activeTab = getCurrentTab();
    const inTor = !!(activeTab && activeTab.isTor);

    if (!/^https?:\/\//i.test(url)) {
        if (url.includes('.') && !url.includes(' ')) {
            url = (inTor && /^[^\/]+\.onion(\/|:|$)/i.test(url) ? 'http://' : 'https://') + url;
        } else if (inTor) {
            url = window.TOR_SEARCH_URL + encodeURIComponent(url);
        } else {
            url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
        }
    }

    if (activeTab) {
        if (activeTab.isHome) {
            createTab(url);
        } else if (activeTab.webview) {
            activeTab.webview.src = url;
        }
    }
}

function updateNavigationState() {
    const activeTab = getCurrentTab();
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    const addressInput = document.getElementById('address-input');

    if (activeTab && activeTab.webview) {
        try {
            backBtn.disabled = !activeTab.webview.canGoBack();
            forwardBtn.disabled = !activeTab.webview.canGoForward();
        } catch(e) {
            backBtn.disabled = true;
            forwardBtn.disabled = true;
        }

        if (activeTab.isErrorPage && activeTab.failedUrl) {
            addressInput.value = activeTab.failedUrl;
        } else if (activeTab.isTor && window.isTorHomeUrl && window.isTorHomeUrl(activeTab.url)) {
            addressInput.value = '';
        } else {
            addressInput.value = activeTab.url || '';
        }

        if (activeTab.isTor) {
            if (window.setAquilaActivity) window.setAquilaActivity();
        } else if (window.updateTabActivity) {
            try {
                window.updateTabActivity(activeTab.webview.getTitle(), activeTab.url || '');
            } catch(e) {}
        }

        try {
            var wcId = activeTab.webview.getWebContentsId();
            if (wcId) {
                ipcRenderer.send('set-active-tab-wc', wcId);
            }
        } catch(e) {}

        if (!activeTab.isTor && typeof window.notifyActiveTabToExtensions === 'function') {
            window.notifyActiveTabToExtensions();
        }
    } else {
        backBtn.disabled = true;
        forwardBtn.disabled = true;
        addressInput.value = '';

        if (window.setAquilaActivity) window.setAquilaActivity();
    }

    updateBookmarkStarState();
}

function setupModals() {
    setupModal('bookmarks');
    setupModal('history');
    setupModal('downloads');
    setupModal('settings');
}

function setupModal(modalName) {
    const btn = document.getElementById(`${modalName}-btn`);
    const modal = document.getElementById(`${modalName}-modal`);
    const closeBtn = document.getElementById(`close-${modalName}`);

    if (btn && modal && closeBtn) {
        btn.addEventListener('click', () => {
            modal.classList.add('active');
            invalidateDataCache();
            if (modalName === 'bookmarks') loadBookmarks();
            if (modalName === 'history') loadHistory();
            if (modalName === 'downloads') loadDownloads();
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        const overlay = modal.querySelector('.modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => {
                modal.classList.remove('active');
            });
        }
    }
}

window.updatePartnersButtonVisibility = function(disabled) {
    const btn = document.getElementById('partners-btn');
    if (!btn) return;
    btn.style.display = disabled ? 'none' : '';
};

let notificationTimeout = null;

function showNotification(message, type) {
    let notification = document.querySelector('.extension-notification');

    if (!notification) {
        notification = document.createElement('div');
        notification.className = 'extension-notification';
        document.body.appendChild(notification);
    }

    if (notificationTimeout) clearTimeout(notificationTimeout);

    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)'};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10001;
        animation: slideIn 0.3s ease;
        font-weight: 500;
    `;
    notification.textContent = message;

    notificationTimeout = setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) notification.remove();
        }, 300);
    }, 3000);
}

const style = document.createElement('style');
style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(400px); opacity: 0; } }
`;
document.head.appendChild(style);



function getFaviconUrl(url) {
    try {
        const urlObj = new URL(url);
        return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
    } catch (e) {
        return '';
    }
}

async function loadBookmarks() {
    const data = await getDataCached();
    const container = document.getElementById('bookmarks-list');

    if (data.bookmarks.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);"><p>${t('modal.bookmarks.none')}</p></div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    data.bookmarks.forEach(bookmark => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.cssText = 'display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-color); gap: 12px; cursor: pointer;';

        div.innerHTML = `
            <img src="${getFaviconUrl(bookmark.url)}" alt="" style="width: 24px; height: 24px; flex-shrink: 0;" onerror="this.style.display='none'">
            <div class="item-info" style="flex: 1; min-width: 0;">
                <div class="item-title" style="color: var(--text-primary); font-weight: 500; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${bookmark.title || bookmark.url}</div>
                <div class="item-url" style="color: var(--text-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${bookmark.url}</div>
            </div>
            <button style="padding: 8px; background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: rgba(220, 38, 38, 1);">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        `;

        div.addEventListener('click', (e) => {
            if (!e.target.closest('button')) openBookmark(bookmark.url);
        });

        div.querySelector('button').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteBookmark(bookmark.id);
        });

        fragment.appendChild(div);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

async function loadHistory() {
    const data = await getDataCached();
    const container = document.getElementById('history-list');

    if (data.history.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);"><p>${t('modal.history.none')}</p></div>`;
        return;
    }

    const locale = currentLang === 'en' ? 'en-US' : 'de-DE';
    const fragment = document.createDocumentFragment();

    const clearAllBtn = document.createElement('div');
    clearAllBtn.style.cssText = 'padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: flex-end;';
    clearAllBtn.innerHTML = `
        <button style="padding: 10px 20px; background: rgba(220, 38, 38, 0.9); border: none; border-radius: 8px; color: white; cursor: pointer; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: white;">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            ${t('modal.history.clear_all')}
        </button>
    `;
    clearAllBtn.querySelector('button').addEventListener('click', clearAllHistory);
    fragment.appendChild(clearAllBtn);

    data.history.slice(0, 100).forEach(entry => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.cssText = 'display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-color); gap: 12px; cursor: pointer;';

        div.innerHTML = `
            <img src="${getFaviconUrl(entry.url)}" alt="" style="width: 24px; height: 24px; flex-shrink: 0;" onerror="this.style.display='none'">
            <div class="item-info" style="flex: 1; min-width: 0;">
                <div class="item-title" style="color: var(--text-primary); font-weight: 500; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${entry.title || entry.url}</div>
                <div class="item-url" style="color: var(--text-secondary); font-size: 12px; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${entry.url}</div>
                <div class="item-time" style="color: var(--text-secondary); font-size: 11px;">${new Date(entry.timestamp).toLocaleString(locale)}</div>
            </div>
            <button style="padding: 8px; background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <svg viewBox="0 0 24 24" style="width: 18px; height: 18px; fill: rgba(220, 38, 38, 1);">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
            </button>
        `;

        div.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); deleteHistoryEntry(entry.id); });
        div.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                createTab(entry.url);
                document.getElementById('history-modal').classList.remove('active');
            }
        });
        fragment.appendChild(div);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

async function loadDownloads() {
    const data = await getDataCached();
    const container = document.getElementById('downloads-list');
    const locale = currentLang === 'en' ? 'en-US' : 'de-DE';

    if (data.downloads.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);"><p>${t('modal.downloads.none')}</p></div>`;
        return;
    }

    const fragment = document.createDocumentFragment();

    data.downloads.forEach(dl => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="item-info">
                <div class="item-title">${dl.filename}</div>
                <div class="item-url">${dl.url}</div>
                <div class="item-time">${new Date(dl.timestamp).toLocaleString(locale)}</div>
            </div>
        `;
        fragment.appendChild(div);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

window.navigateToUrl = navigateToUrl;
window.updateNavigationState = updateNavigationState;
window.updateBookmarkStarState = updateBookmarkStarState;
window.showNotification = showNotification;

window.openBookmark = function(url) {
    const activeTab = getCurrentTab();
    if (activeTab && activeTab.isHome) {
        createTab(url);
    } else {
        navigateToUrl(url);
    }
    document.getElementById('bookmarks-modal').classList.remove('active');
};

window.deleteBookmark = async function(id) {
    await ipcRenderer.invoke('delete-bookmark', id);
    invalidateDataCache();
    loadBookmarks();
    updateBookmarkStarState();

    const tabs = window.tabs || [];
    tabs.forEach(tab => {
        if (tab.webview) updateTabBookmarkIcon(tab);
    });
};

window.deleteHistoryEntry = async function(id) {
    await ipcRenderer.invoke('delete-history-entry', id);
    invalidateDataCache();
    loadHistory();
};

window.clearAllHistory = async function() {
    const confirmed = await window.aqConfirm(t('confirm.clear_history'));
    if (!confirmed) return;
    await ipcRenderer.invoke('clear-history');
    invalidateDataCache();
    loadHistory();
};

document.addEventListener('DOMContentLoaded', init);