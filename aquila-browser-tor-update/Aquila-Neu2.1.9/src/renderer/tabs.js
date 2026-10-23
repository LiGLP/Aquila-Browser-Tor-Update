const splitView = require('./utils/split-view');
const partners = require('./utils/partners');
const downloadPopup = require('./utils/download-popup');
const shortcuts = require('./utils/keyboard-shortcuts');

let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let minimalModeEnabled = false;
let isInHtmlFullscreen = false;
const DEBUG_MODE = false;

let pendingNewWindowUrls = [];
let newWindowTimeout = null;
let pendingPermissionRequest = null;
let pendingFullscreenRequest = null;
let pendingHttpUrl = null;

let contextMenuEl = null;
let contextMenuOverlay = null;

let draggingTabId = null;

let bookmarkCache = null;
let bookmarkCacheTime = 0;
const BOOKMARK_CACHE_TTL = 3000;

const TOR_PARTITION = 'aquila-tor';
const TOR_HOME_URL = require('url').pathToFileURL(require('path').join(__dirname, 'tor', 'tor-home.html')).href;
const TOR_SEARCH_URL = 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/?q=';
const TOR_FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="13" r="9" fill="none" stroke="#a970ff" stroke-width="1.8"/><circle cx="12" cy="13" r="5.5" fill="none" stroke="#a970ff" stroke-width="1.6"/><circle cx="12" cy="13" r="2.4" fill="#a970ff"/><path d="M12 2.5c1.4 1.8 1.4 3.2 0 4.4" fill="none" stroke="#c8a6ff" stroke-width="1.6" stroke-linecap="round"/></svg>';

function isTorHomeUrl(url) {
    return typeof url === 'string' && url.split(/[?#]/)[0] === TOR_HOME_URL;
}

const SUSPEND_DELAY_MS = 5000;
const MAX_SUSPENDED_WEBVIEWS = 3;

if (DEBUG_MODE) console.log('[TABS] Script loaded');

function prefetchDNS(url) {
    try {
        if (url && url.startsWith('file:')) return;
        if (!url || url === 'aquila://home' || url === 'about:blank') return;
        var hostname = new URL(url.startsWith('http') ? url : 'https://' + url).hostname;
        if (!hostname || hostname === 'localhost') return;
        var link = document.createElement('link');
        link.rel = 'dns-prefetch';
        link.href = '//' + hostname;
        document.head.appendChild(link);
        setTimeout(function() { if (link.parentNode) link.parentNode.removeChild(link); }, 10000);
    } catch(e) {}
}

ipcRenderer.on('open-dropped-file', (event, url) => {
    if (DEBUG_MODE) console.log('[TABS] open-dropped-file IPC:', url);
    createTab(url);
});

ipcRenderer.on('extension-create-tab-request', async (event, data) => {
    if (DEBUG_MODE) console.log('[TABS] extension-create-tab-request:', data);
    const { callbackId, url, active } = data;
    const tab = await createTabInternal(url || 'about:blank', active);
    if (tab && tab.webview) {
        const onReady = () => {
            try {
                const wcId = tab.webview.getWebContentsId();
                if (DEBUG_MODE) console.log('[TABS] Extension tab ready, wcId:', wcId, 'callbackId:', callbackId);
                ipcRenderer.send('extension-tab-created', { callbackId, webContentsId: wcId });
            } catch (e) {
                if (DEBUG_MODE) console.error('[TABS] Failed to get webContentsId:', e.message);
                ipcRenderer.send('extension-tab-created', { callbackId, webContentsId: null });
            }
        };
        if (tab.webview.getWebContentsId && tab.webview.getWebContentsId()) {
            onReady();
        } else {
            tab.webview.addEventListener('dom-ready', onReady, { once: true });
        }
    } else if (tab && tab.isHome) {
        ipcRenderer.send('extension-tab-created', { callbackId, webContentsId: null });
    }
});

ipcRenderer.on('extension-select-tab', (event, webContentsId) => {
    if (splitView.isActive()) return;
    const tab = findTabByWebContentsId(webContentsId);
    if (tab) switchToTab(tab.id);
});

ipcRenderer.on('extension-remove-tab', (event, webContentsId) => {
    const tab = findTabByWebContentsId(webContentsId);
    if (tab) closeTab(tab.id);
});

ipcRenderer.on('extension-create-tab', (event, url) => {
    if (url) createTab(url);
});

ipcRenderer.on('oauth-completed', (event, url) => {
  const activeTab = getCurrentTab();
  if (activeTab && activeTab.webview && !activeTab.isHome) {
    activeTab.webview.src = url;
  } else if (activeTab && activeTab.isHome) {
    createTab(url);
  }
});



ipcRenderer.on('open-tor-url', (event, url) => {
    if (url) createTabInternal(url, true, { isTor: true });
});

ipcRenderer.on('open-external-url', async (event, url) => {
    if (!url) return;
    const data = await ipcRenderer.invoke('get-data');

    pendingNewWindowUrls.push(url);
    if (newWindowTimeout) clearTimeout(newWindowTimeout);

    if (data.settings.newWindowBehavior) {
        newWindowTimeout = setTimeout(() => {
            showNewWindowNotification([...pendingNewWindowUrls]);
            pendingNewWindowUrls = [];
            newWindowTimeout = null;
        }, 100);
    } else {
        newWindowTimeout = setTimeout(async () => {
            const urlsToOpen = [...pendingNewWindowUrls];
            pendingNewWindowUrls = [];
            newWindowTimeout = null;

            const tabsBefore = tabs.length;
            for (const u of urlsToOpen) {
                await createTabInternal(u, false);
            }
            const firstNew = tabs[tabsBefore];
            if (!firstNew) return;
            tabs.forEach(t => {
                if (t.element) t.element.classList.remove('active');
                if (t.content) t.content.classList.remove('active');
            });
            switchToTab(firstNew.id);
        }, 100);
    }
});

function findTabByWebContentsId(wcId) {
    if (!wcId) return null;
    for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        if (t.webview && !t.isHome) {
            try {
                if (t.webview.getWebContentsId() === wcId) return t;
            } catch (e) {}
        }
    }
    return null;
}

async function checkMinimalMode() {
    const data = await ipcRenderer.invoke('get-data');
    minimalModeEnabled = data.settings.minimalMode || false;
}

checkMinimalMode();

document.addEventListener('DOMContentLoaded', () => {
    initContextMenu();
    initDragDrop();

    splitView.init({
        getTabs: () => tabs,
        getActiveTabId: () => activeTabId,
        setActiveTabId: (id) => { activeTabId = id; },
        findTab: (id) => tabs.find(t => t.id === id),
        updateActiveTab: () => updateActiveTab(),
        updateNavigationState: () => updateNavigationState(),
        createTab: (url) => createTab(url)
    });

    partners.init({ createTab });

    downloadPopup.init();

    shortcuts.init({
        getCurrentTab,
        createTab,
        createTorTab,
        closeTab,
        switchToTab,
        getTabs: () => tabs,
        getActiveTabId: () => activeTabId,
        loadQuickAccess,
        hideContextMenu,
        getIsInHtmlFullscreen: () => isInHtmlFullscreen
    });

    window.addEventListener('resize', recalcTabWidths);
    ipcRenderer.invoke('get-data').then(data => {
        if (data.settings.newTabBtnInline) document.body.classList.add('newtab-inline');
    });
    partners.fetch().then(result => {
        if (result.partners.length === 0) {
            setTimeout(() => { partners.fetch(); }, 10000);
        }
    });
});

function initDragDrop() {
    let dropIndicator = document.querySelector('.pdf-drop-indicator');
    if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'pdf-drop-indicator';
        dropIndicator.textContent = 'Datei hier ablegen um zu öffnen';
        document.body.appendChild(dropIndicator);
    }

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            dropIndicator.classList.add('active');
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropIndicator.classList.remove('active');
        }
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropIndicator.classList.remove('active');

        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (files && files.length > 0) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = file.path;
                if (filePath) {
                    try {
                        const isSupported = await ipcRenderer.invoke('verify-dropped-file', filePath);
                        if (isSupported) {
                            const normalizedPath = filePath.replace(/\\/g, '/');
                            createTab('file:///' + normalizedPath);
                        }
                    } catch (err) {}
                }
            }
        }
    });
}

ipcRenderer.on('html-fullscreen-enter', () => { isInHtmlFullscreen = true; applyFullscreen(); });
ipcRenderer.on('html-fullscreen-leave', () => { isInHtmlFullscreen = false; exitFullscreen(); });

ipcRenderer.on('webview-new-window', async (event, url) => {
    const data = await ipcRenderer.invoke('get-data');
    if (data.settings.newWindowBehavior) {
        pendingNewWindowUrls.push(url);
        if (newWindowTimeout) clearTimeout(newWindowTimeout);
        newWindowTimeout = setTimeout(() => {
            showNewWindowNotification([...pendingNewWindowUrls]);
            pendingNewWindowUrls = [];
            newWindowTimeout = null;
        }, 100);
    } else {
        createTab(url);
    }
});

ipcRenderer.on('permission-request', (event, permissionData) => {
    pendingPermissionRequest = permissionData;
    showPermissionNotification(permissionData);
});

ipcRenderer.on('https-error', async (event, data) => {
    const appData = await ipcRenderer.invoke('get-data');
    if (!appData.settings.httpsOnly) return;
    const httpUrl = data.url.replace('https://', 'http://');
    pendingHttpUrl = httpUrl;
    showHttpsWarning(httpUrl);
});

function createHomeTab() {
    console.log('[DEBUG] T-1 - createHomeTab called');
    const homeTab = {
        id: tabIdCounter++,
        title: 'Aquila',
        url: 'aquila://home',
        isHome: true,
        element: null,
        content: null,
        isSuspended: false
    };
    tabs.push(homeTab);
    activeTabId = homeTab.id;
    console.log('[DEBUG] T-2 - home tab object created, id:', homeTab.id);
    renderTab(homeTab);
    console.log('[DEBUG] T-3 - renderTab done');
    renderTabContent(homeTab);
    console.log('[DEBUG] T-4 - renderTabContent done');
    updateActiveTab();
    console.log('[DEBUG] T-5 - updateActiveTab done');
}

async function createTabInternal(url = 'aquila://home', active = true, opts = {}) {
    var isTor = !!opts.isTor;
    if (isTor) {
        if (!url || url === 'aquila://home') url = TOR_HOME_URL;
        ipcRenderer.invoke('tor-start').catch(() => {});
    } else {
        prefetchDNS(url);
    }

    if (shouldUpgradeToHttps(url) && !(isTor && isOnionUrl(url))) {
        try {
            var d = await ipcRenderer.invoke('get-data');
            if (d.settings.httpsOnly) url = upgradeUrl(url);
        } catch (ex) {}
    }
    var isHome = !isTor && url === 'aquila://home';
    var tab = {
        id: tabIdCounter++,
        title: isHome ? 'Aquila' : (isTor && isTorHomeUrl(url) ? 'Privater Tab mit Tor' : 'Lädt...'),
        url: url,
        isHome: isHome,
        isTor: isTor,
        element: null,
        content: null,
        webview: null,
        isSuspended: false,
        isMuted: false,
        suspendedUrl: null
    };
    tabs.push(tab);
    if (active) activeTabId = tab.id;
    renderTab(tab);
    renderTabContent(tab);
    if (active) {
        updateActiveTab();
        updateNavigationState();
        var addressInput = document.getElementById('address-input');
        if (addressInput) {
            var showEmpty = isHome || isTorHomeUrl(url);
            addressInput.value = showEmpty ? '' : url;
            if (showEmpty) {
                setTimeout(function() {
                    addressInput.focus();
                    addressInput.select();
                }, 100);
            }
        }
    }
    if (!isHome) setupWebview(tab);
    return tab;
}

async function createTab(url = 'aquila://home') {
    return await createTabInternal(url, true);
}

async function createTorTab(url) {
    return await createTabInternal(url || TOR_HOME_URL, true, { isTor: true });
}

function createTabLike(tab, url) {
    if (tab && tab.isTor) return createTorTab(url);
    return createTab(url);
}

function isOnionUrl(url) {
    try { return new URL(url).hostname.endsWith('.onion'); } catch (e) { return false; }
}

function getTabDropIndex(mouseX) {
    const container = document.getElementById('tabs-container');
    const items = Array.from(container.querySelectorAll('.tab'));
    for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (mouseX < mid) return i;
    }
    return items.length;
}

function getTabIndicatorX(dropIndex) {
    const container = document.getElementById('tabs-container');
    const items = Array.from(container.querySelectorAll('.tab'));
    if (items.length === 0) return null;
    const containerRect = container.getBoundingClientRect();
    if (dropIndex >= items.length) {
        const last = items[items.length - 1].getBoundingClientRect();
        return last.right - containerRect.left + 1;
    }
    const target = items[dropIndex].getBoundingClientRect();
    return target.left - containerRect.left - 1;
}

function reorderTabs(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const moved = tabs.splice(fromIndex, 1)[0];
    tabs.splice(toIndex, 0, moved);
    const container = document.getElementById('tabs-container');
    const tabElements = Array.from(container.querySelectorAll('.tab'));
    const movedEl = tabElements[fromIndex];
    if (!movedEl) return;
    container.removeChild(movedEl);
    const newChildren = Array.from(container.querySelectorAll('.tab'));
    if (toIndex >= newChildren.length) {
        container.appendChild(movedEl);
    } else {
        container.insertBefore(movedEl, newChildren[toIndex]);
    }
}

function swapTabElements(container, draggedEl, otherEl, direction) {
    var otherRect = otherEl.getBoundingClientRect();

    var allEls = Array.from(container.querySelectorAll('.tab'));
    var dragIdx = allEls.indexOf(draggedEl);
    var otherIdx = allEls.indexOf(otherEl);

    if (direction === 'left') {
        container.insertBefore(draggedEl, otherEl);
    } else {
        if (otherEl.nextSibling) {
            container.insertBefore(draggedEl, otherEl.nextSibling);
        } else {
            container.appendChild(draggedEl);
        }
    }

    if (dragIdx >= 0 && otherIdx >= 0 && dragIdx < tabs.length && otherIdx < tabs.length) {
        var temp = tabs[dragIdx];
        tabs[dragIdx] = tabs[otherIdx];
        tabs[otherIdx] = temp;
    }

    var newOtherRect = otherEl.getBoundingClientRect();
    var deltaX = otherRect.left - newOtherRect.left;

    otherEl.style.transition = 'none';
    otherEl.style.transform = 'translateX(' + deltaX + 'px)';

    requestAnimationFrame(function() {
        requestAnimationFrame(function() {
            otherEl.style.transition = 'transform 0.15s ease';
            otherEl.style.transform = '';
        });
    });
}

function renderTab(tab) {
    const container = document.getElementById('tabs-container');
    const tabElement = document.createElement('div');
    tabElement.className = 'tab' + (tab.isTor ? ' tor-tab' : '');
    tabElement.dataset.tabId = tab.id;

    let faviconHtml = '';
    const isExtUrl = tab.url && tab.url.startsWith('chrome-extension://');

    if (tab.isTor) {
        faviconHtml = TOR_FAVICON_SVG;
    } else if (isExtUrl) {
        faviconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
    } else if (!tab.isHome && tab.url && tab.url !== 'aquila://home') {
        let faviconUrl = '';
        try {
            const url = new URL(tab.url.startsWith('http') ? tab.url : 'https://' + tab.url);
            faviconUrl = 'https://www.google.com/s2/favicons?domain=' + url.hostname + '&sz=64';
        } catch (e) {}
        if (faviconUrl) {
            faviconHtml = '<img src="' + faviconUrl + '" alt="" style="width:100%;height:100%;display:block;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';">' +
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" style="display:none;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
        }
    }

    if (!faviconHtml) {
        faviconHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><path d="' + (tab.isHome ? 'M5,16L3,5L8.5,10L12,4L15.5,10L21,5L19,16H5M19,19C19,19.6 18.6,20 18,20H6C5.4,20 5,19.6 5,19V18H19V19Z' : 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z') + '"/></svg>';
    }

    tabElement.innerHTML =
        '<div class="tab-favicon">' + faviconHtml + '</div>' +
        '<div class="tab-title">' + tab.title + '</div>' +
        '<svg class="tab-bookmark-icon" viewBox="0 0 24 24" style="width:16px;height:16px;fill:#fbbf24;margin-right:4px;display:none;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>' +
        '<div class="tab-audio-icon" style="display:none;" title="Klicken zum Stummschalten">' +
            '<svg class="tab-audio-speaker" viewBox="0 0 24 24" style="width:12px;height:12px;fill:var(--primary-color,#1e90ff);"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>' +
            '<svg class="tab-audio-muted" viewBox="0 0 24 24" style="width:12px;height:12px;fill:var(--text-secondary,#8899aa);display:none;"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>' +
        '</div>' +
        '<div class="tab-close"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg></div>';

    tabElement.querySelector('.tab-audio-icon').addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        toggleTabMute(tab.id);
    });

    tabElement.querySelector('.tab-close').addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); closeTab(tab.id); });
    tabElement.addEventListener('contextmenu', function(e) { e.preventDefault(); e.stopPropagation(); showTabContextMenu(e.clientX, e.clientY, tab); });

    tabElement.addEventListener('mousedown', function(e) {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            closeTab(tab.id);
            return;
        }
    });

    tabElement.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.tab-close')) return;
        e.preventDefault();

        const tabBarRect = document.querySelector('.tab-bar').getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;
        let dragOverlayEl = null;
        let ghostEl = null;
        let inSplitZone = false;
        let splitSide = null;

        const onMouseMove = (me) => {
            const dx = Math.abs(me.clientX - startX);
            const dy = Math.abs(me.clientY - startY);

            if (!moved && dx < 8 && dy < 8) return;

            if (!moved) {
                moved = true;
                draggingTabId = tab.id;
                tabElement.classList.add('tab-dragging');
                document.body.classList.add('is-tab-dragging');

                dragOverlayEl = document.createElement('div');
                dragOverlayEl.id = 'tab-drag-overlay';
                dragOverlayEl.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99997;background:transparent;cursor:grabbing;';
                document.body.appendChild(dragOverlayEl);

                ghostEl = document.createElement('div');
                ghostEl.className = 'tab-drag-ghost';
                var faviconEl = tabElement.querySelector('.tab-favicon');
                var titleEl = tabElement.querySelector('.tab-title');
                ghostEl.innerHTML = '<div class="tab-drag-ghost-favicon">' + (faviconEl ? faviconEl.innerHTML : '') + '</div><span>' + (titleEl ? titleEl.textContent : '') + '</span>';
                ghostEl.style.display = 'none';
                document.body.appendChild(ghostEl);
            }

            var isBelowTabBar = me.clientY > tabBarRect.bottom + 20;
            var canSplit = !tab.isHome && tabs.filter(function(t) { return !t.isHome; }).length >= 2;

            if (isBelowTabBar && canSplit) {
                inSplitZone = true;

                if (ghostEl) {
                    ghostEl.style.display = '';
                    ghostEl.style.left = (me.clientX + 12) + 'px';
                    ghostEl.style.top = (me.clientY - 14) + 'px';
                }

                splitView.showDropIndicator(true);
                var half = window.innerWidth / 2;
                var zoneLeft = document.getElementById('split-zone-left');
                var zoneRight = document.getElementById('split-zone-right');
                if (me.clientX < half) {
                    splitSide = 'left';
                    if (zoneLeft) zoneLeft.classList.add('hover');
                    if (zoneRight) zoneRight.classList.remove('hover');
                } else {
                    splitSide = 'right';
                    if (zoneLeft) zoneLeft.classList.remove('hover');
                    if (zoneRight) zoneRight.classList.add('hover');
                }
            } else {
                if (inSplitZone) {
                    inSplitZone = false;
                    splitSide = null;
                    splitView.showDropIndicator(false);
                }

                if (ghostEl) ghostEl.style.display = 'none';

                var tabsContainer = document.getElementById('tabs-container');
                var allTabEls = Array.from(tabsContainer.querySelectorAll('.tab'));
                var dragIndex = allTabEls.indexOf(tabElement);

                if (dragIndex > 0) {
                    var prevEl = allTabEls[dragIndex - 1];
                    var prevRect = prevEl.getBoundingClientRect();
                    var prevMid = prevRect.left + prevRect.width / 2;
                    if (me.clientX < prevMid) {
                        swapTabElements(tabsContainer, tabElement, prevEl, 'left');
                    }
                }

                var updatedEls = Array.from(tabsContainer.querySelectorAll('.tab'));
                var newDragIndex = updatedEls.indexOf(tabElement);

                if (newDragIndex < updatedEls.length - 1) {
                    var nextEl = updatedEls[newDragIndex + 1];
                    var nextRect = nextEl.getBoundingClientRect();
                    var nextMid = nextRect.left + nextRect.width / 2;
                    if (me.clientX > nextMid) {
                        swapTabElements(tabsContainer, tabElement, nextEl, 'right');
                    }
                }
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            var wasDragging = moved;
            var wasInSplitZone = inSplitZone;
            var finalSplitSide = splitSide;

            if (moved) {
                tabElement.classList.remove('tab-dragging');
                document.body.classList.remove('is-tab-dragging');
                if (dragOverlayEl) dragOverlayEl.remove();
                if (ghostEl) ghostEl.remove();
                splitView.showDropIndicator(false);
            }

            if (wasDragging && wasInSplitZone && finalSplitSide) {
                var currentTab = getCurrentTab();
                var draggedTab = tabs.find(function(t) { return t.id === tab.id; });
                if (draggedTab && !draggedTab.isHome) {
                    var otherTab = currentTab && currentTab.id !== tab.id && !currentTab.isHome ? currentTab : null;
                    if (!otherTab) otherTab = tabs.find(function(t) { return t.id !== tab.id && !t.isHome; });
                    if (otherTab) {
                        if (finalSplitSide === 'left') splitView.enable(tab.id, otherTab.id);
                        else splitView.enable(otherTab.id, tab.id);
                    }
                }
            } else if (!wasDragging) {
                switchToTab(tab.id);
            }

            draggingTabId = null;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    container.appendChild(tabElement);
    tab.element = tabElement;
    if (!tab.isHome && tab.url && !isExtUrl) updateTabBookmarkIcon(tab);
    recalcTabWidths();
}

function renderTabContent(tab) {
    const container = document.getElementById('tab-contents');
    const contentDiv = document.createElement('div');
    contentDiv.className = 'tab-content';
    contentDiv.dataset.tabId = tab.id;

    if (tab.isHome) {
        contentDiv.innerHTML = createHomePageHTML();
        container.appendChild(contentDiv);
        tab.content = contentDiv;
        setTimeout(() => { setupHomePageListeners(); loadQuickAccess(); }, 10);
    } else {
        const webview = document.createElement('webview');
        webview.src = tab.url;
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.setAttribute('partition', tab.isTor ? TOR_PARTITION : 'persist:main');
        if (!tab.isTor) webview.setAttribute('plugins', '');
        webview.setAttribute('allowfullscreen', '');
        webview.setAttribute('allowpopups', '');

        if (!tab.isTor && tab.url && (tab.url.toLowerCase().endsWith('.pdf') || tab.url.startsWith('file://'))) {
            webview.setAttribute('webpreferences', 'plugins=true');
        }

        contentDiv.appendChild(webview);
        container.appendChild(contentDiv);
        tab.content = contentDiv;
        tab.webview = webview;
    }
}

function isWebviewReady(wv) {
    if (!wv) return false;
    try { wv.getWebContentsId(); return true; } catch(e) { return false; }
}

function notifyExtensionActiveTab(tab) {
    if (!tab || tab.isHome || tab.isTor || !tab.webview) return;
    if (!isWebviewReady(tab.webview)) return;
    try {
        const wcId = tab.webview.getWebContentsId();
        if (wcId) ipcRenderer.invoke('select-tab', wcId).catch(() => {});
    } catch (e) {}
}


function switchToTab(tabId) {
    const previousTabId = activeTabId;
    const previousTab = tabs.find(t => t.id === previousTabId);
    activeTabId = tabId;

    if (typeof window.hideSuggestions === 'function') window.hideSuggestions();

    if (minimalModeEnabled) {
        if (previousTab && previousTab.id !== tabId) suspendTab(previousTab);
        const newTab = tabs.find(t => t.id === tabId);
        if (newTab) resumeTab(newTab);
    }

    const activeTab = tabs.find(t => t.id === tabId);

    if (!splitView.isActive()) {
        notifyExtensionActiveTab(activeTab);
    }

    updateActiveTab();
    updateNavigationState();

    if (activeTab && window.updateNewsCheck) {
        window.updateNewsCheck(activeTab.url || '');
    }

    if (splitView.isViewing()) {
        requestAnimationFrame(() => {
            splitView.forceResize(tabs.find(t => t.id === splitView.getLeftId()));
            splitView.forceResize(tabs.find(t => t.id === splitView.getRightId()));
        });
    }
}

function updateActiveTab() {
    const viewingSplit = splitView.isViewing();
    const splitContainer = document.getElementById('split-view-container');
    const tabContents = document.getElementById('tab-contents');

    if (splitView.isActive()) {
        if (viewingSplit) {
            if (splitContainer) splitContainer.classList.add('active');
            if (tabContents) tabContents.style.display = 'none';
        } else {
            if (splitContainer) splitContainer.classList.remove('active');
            if (tabContents) tabContents.style.display = '';
        }
    }

    tabs.forEach(tab => {
        const isSplitTab = splitView.isActive() && (tab.id === splitView.getLeftId() || tab.id === splitView.getRightId());
        if (tab.element) {
            if (viewingSplit && isSplitTab) tab.element.classList.add('active');
            else tab.element.classList.toggle('active', tab.id === activeTabId);
            tab.element.classList.toggle('split-active', splitView.isActive() && isSplitTab);
        }
        if (tab.content) {
            if (isSplitTab) tab.content.classList.add('active');
            else tab.content.classList.toggle('active', tab.id === activeTabId && !viewingSplit);
        }
    });

    splitView.updateIndicators();
    splitView.updatePaneFocus();
    const activeTab = getCurrentTab();
    if (typeof window.updateTorUi === 'function') window.updateTorUi();
    if (activeTab && activeTab.isHome) setTimeout(() => { setupHomePageListeners(); loadQuickAccess(); }, 50);
}

function destroyWebview(tab) {
    if (!tab || !tab.webview) return;
    try {
        tab.webview.stop();
        tab.webview.setAudioMuted(true);
    } catch (e) {}
    try {
        tab.webview.executeJavaScript(
            "document.querySelectorAll('video,audio').forEach(e=>e.pause());document.querySelectorAll('iframe').forEach(e=>e.remove());document.body.innerHTML='';"
        ).catch(() => {});
    } catch (e) {}
    setTimeout(() => {
        try {
            if (tab.webview && tab.webview.parentNode) {
                tab.webview.parentNode.removeChild(tab.webview);
            }
        } catch (e) {}
        tab.webview = null;
    }, 100);
}

function closeTab(tabId) {
    if (splitView.isActive() && splitView.containsTab(tabId)) splitView.disable();
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;
    const tab = tabs[tabIndex];

    destroyWebview(tab);

    if (tab.element) tab.element.remove();
    if (tab.content) tab.content.remove();
    tab.element = null;
    tab.content = null;

    tabs.splice(tabIndex, 1);

    if (tab.isTor && !tabs.some(t => t.isTor)) ipcRenderer.invoke('tor-new-identity').catch(() => {});

    if (tabs.length === 0) {
        createHomeTab();
    } else if (tab.id === activeTabId) {
        const newActiveTab = tabs[Math.max(0, tabIndex - 1)];
        switchToTab(newActiveTab.id);
    }

    recalcTabWidths();
    scheduleMemoryCleanup();
}

function toggleTabMute(tabId) {
    var tab = tabs.find(function(t) { return t.id === tabId; });
    if (!tab || !tab.webview || tab.isHome) return;
    try {
        var isMuted = tab.webview.isAudioMuted();
        tab.webview.setAudioMuted(!isMuted);
        tab.isMuted = !isMuted;
        if (tab.element) {
            var audioIcon = tab.element.querySelector('.tab-audio-icon');
            var speakerSvg = tab.element.querySelector('.tab-audio-speaker');
            var mutedSvg = tab.element.querySelector('.tab-audio-muted');
            var isPlaying = tab.element.classList.contains('media-playing');
            if (tab.isMuted) {
                tab.element.classList.add('tab-muted');
                if (audioIcon) {
                    audioIcon.style.display = 'flex';
                    audioIcon.classList.add('is-muted');
                    audioIcon.title = 'Klicken zum Lautschalten';
                }
                if (speakerSvg) speakerSvg.style.display = 'none';
                if (mutedSvg) mutedSvg.style.display = 'block';
            } else {
                tab.element.classList.remove('tab-muted');
                if (audioIcon) {
                    audioIcon.classList.remove('is-muted');
                    audioIcon.title = 'Klicken zum Stummschalten';
                    audioIcon.style.display = isPlaying ? 'flex' : 'none';
                }
                if (speakerSvg) speakerSvg.style.display = 'block';
                if (mutedSvg) mutedSvg.style.display = 'none';
            }
        }
    } catch (e) {}
}

window.toggleTabMute = toggleTabMute;

function scheduleMemoryCleanup() {
    if (scheduleMemoryCleanup._timer) return;
    scheduleMemoryCleanup._timer = setTimeout(() => {
        scheduleMemoryCleanup._timer = null;
        ipcRenderer.invoke('force-gc').catch(() => {});
    }, 2000);
}
scheduleMemoryCleanup._timer = null;

var recalcTabTimer = null;

function recalcTabWidths() {
    if (draggingTabId !== null) return;
    if (recalcTabTimer) return;
    recalcTabTimer = requestAnimationFrame(function() {
        recalcTabTimer = null;
        var container = document.getElementById('tabs-container');
        if (!container) return;
        var tabEls = Array.from(container.querySelectorAll('.tab'));
        var count = tabEls.length;
        if (count === 0) return;

        var bar = document.querySelector('.tab-bar');
        if (!bar) return;
        var newTabBtn = document.getElementById('new-tab-btn');
        var barWidth = bar.clientWidth;
        var btnWidth = newTabBtn ? newTabBtn.offsetWidth + 12 : 44;
        var available = barWidth - btnWidth - 16;
        var gap = parseInt(getComputedStyle(container).gap) || 4;
        var totalGaps = Math.max(0, count - 1) * gap;
        var perTab = Math.floor((available - totalGaps) / count);
        perTab = Math.max(34, Math.min(200, perTab));

        container.classList.remove('tabs-icon-only', 'tabs-compact-auto', 'tabs-narrow');
        if (perTab <= 50) {
            container.classList.add('tabs-icon-only');
        } else if (perTab <= 80) {
            container.classList.add('tabs-compact-auto');
        } else if (perTab <= 120) {
            container.classList.add('tabs-narrow');
        }

        tabEls.forEach(function(el) {
            el.style.minWidth = perTab + 'px';
            el.style.maxWidth = perTab + 'px';
        });
    });
}

function getCurrentTab() {
    return tabs.find(t => t.id === activeTabId);
}

function suspendTab(tab) {
    if (!tab || tab.isHome || tab.isSuspended || !tab.webview) return;
    try {
        tab.webview.setAudioMuted(true);
        tab.webview.executeJavaScript(
            "document.querySelectorAll('video,audio').forEach(e=>e.pause());"
        ).catch(() => {});
        tab.isSuspended = true;
        if (tab.element) tab.element.style.opacity = '0.6';
    } catch (e) {}
}

function deepSuspendTab(tab) {
    if (!tab || tab.isHome || !tab.webview) return;
    tab.suspendedUrl = tab.url;
    try {
        tab.webview.stop();
        tab.webview.executeJavaScript(
            "document.querySelectorAll('video,audio').forEach(e=>{e.pause();e.src='';});document.querySelectorAll('iframe').forEach(e=>e.remove());"
        ).catch(() => {});
        tab.webview.loadURL('about:blank').catch(() => {});
    } catch (e) {}
    tab.isSuspended = true;
    if (tab.element) tab.element.style.opacity = '0.5';
}

function resumeTab(tab) {
    if (!tab || tab.isHome) return;
    if (tab.suspendedUrl && tab.webview) {
        try {
            tab.webview.loadURL(tab.suspendedUrl).catch(() => {});
            tab.suspendedUrl = null;
        } catch (e) {}
    }
    if (!tab.isSuspended) return;
    try {
        if (tab.webview) tab.webview.setAudioMuted(false);
        tab.isSuspended = false;
        if (tab.element) tab.element.style.opacity = '1';
    } catch (e) {}
}

function applyFullscreen() {
    const titlebar = document.querySelector('.titlebar');
    const tabBar = document.querySelector('.tab-bar');
    const navBar = document.querySelector('.navigation-bar');
    const contentArea = document.querySelector('.content-area');
    if (titlebar) titlebar.style.display = 'none';
    if (tabBar) tabBar.style.display = 'none';
    if (navBar) navBar.style.display = 'none';
    if (contentArea) {
        contentArea.style.position = 'fixed';
        contentArea.style.top = '0';
        contentArea.style.left = '0';
        contentArea.style.width = '100vw';
        contentArea.style.height = '100vh';
        contentArea.style.zIndex = '99999';
        contentArea.style.background = '#000';
        contentArea.style.margin = '0';
        contentArea.style.padding = '0';
    }
}

function exitFullscreen() {
    const titlebar = document.querySelector('.titlebar');
    const tabBar = document.querySelector('.tab-bar');
    const navBar = document.querySelector('.navigation-bar');
    const contentArea = document.querySelector('.content-area');
    if (titlebar) titlebar.style.display = '';
    if (tabBar) tabBar.style.display = '';
    if (navBar) navBar.style.display = '';
    if (contentArea) {
        contentArea.style.position = '';
        contentArea.style.top = '';
        contentArea.style.left = '';
        contentArea.style.width = '';
        contentArea.style.height = '';
        contentArea.style.zIndex = '';
        contentArea.style.background = '';
        contentArea.style.margin = '';
        contentArea.style.padding = '';
    }
}

function createHomePageHTML() {
    return '<div class="home-page">' +
        '<div class="home-header">' +
            '<div class="home-logo-container">' +
                '<div class="logo-circle"></div><div class="logo-circle"></div><div class="logo-circle"></div>' +
                '<div class="logo-inner"><div class="crown"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="white"><path d="M5,16L3,5L8.5,10L12,4L15.5,10L21,5L19,16H5M19,19C19,19.6 18.6,20 18,20H6C5.4,20 5,19.6 5,19V18H19V19Z"/></svg></div></div>' +
            '</div>' +
            '<h1 class="home-title">Aquila</h1><p class="home-subtitle">' + window.t('home.subtitle') + '</p>' +
        '</div>' +
        '<div class="home-search"><div class="home-search-bar">' +
            '<svg class="home-search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' +
            '<input type="text" placeholder="' + window.t('home.search_placeholder') + '" id="home-search-input">' +
        '</div></div>' +
        '<div class="quick-access"><div class="quick-access-header"><h2 class="quick-access-title">' + window.t('home.quick_access') + '</h2><button class="add-quick-access">+ ' + window.t('home.add_btn') + '</button></div>' +
        '<div class="quick-access-grid" id="quick-access-grid"></div></div></div>';
}

function setupHomePageListeners() {
    const activeTab = getCurrentTab();
    if (!activeTab || !activeTab.isHome || !activeTab.content) return;
    const homeSearchInput = activeTab.content.querySelector('#home-search-input');
    if (homeSearchInput && !homeSearchInput.dataset.listenerAdded) {
        homeSearchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') navigateHomeTab(homeSearchInput.value); });
        homeSearchInput.dataset.listenerAdded = 'true';
    }
    const addQuickAccessBtn = activeTab.content.querySelector('.add-quick-access');
    if (addQuickAccessBtn && !addQuickAccessBtn.dataset.listenerAdded) {
        addQuickAccessBtn.addEventListener('click', showAddQuickAccessDialog);
        addQuickAccessBtn.dataset.listenerAdded = 'true';
    }
}


function navigateHomeTab(input) {
    if (!input || !input.trim()) return;
    input = input.trim();

    var url;
    if (/^(https?:\/\/|file:\/\/)/i.test(input)) {
        url = input;
    } else if (/^[a-zA-Z0-9-]+(\.[a-zA-Z]{2,})+/.test(input)) {
        url = 'https://' + input;
    } else {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(input);
    }

    var tab = getCurrentTab();
    if (!tab || !tab.isHome) {
        navigateToUrl(url);
        return;
    }

    tab.isHome = false;
    tab.url = url;
    tab.title = 'Lädt...';

    if (tab.content) tab.content.innerHTML = '';

    var webview = document.createElement('webview');
    webview.src = url;
    webview.style.width = '100%';
    webview.style.height = '100%';
    webview.setAttribute('partition', 'persist:main');
    webview.setAttribute('plugins', '');
    webview.setAttribute('allowfullscreen', '');
    webview.setAttribute('allowpopups', '');

    tab.content.appendChild(webview);
    tab.webview = webview;

    setupWebview(tab);
    updateTabTitle(tab.id, 'Lädt...');
    updateTabFavicon(tab);
    updateNavigationState();

    if (window.updateNewsCheck) {
        window.updateNewsCheck(url);
    }

    var addressInput = document.getElementById('address-input');
    if (addressInput) addressInput.value = url;
}

function applyBgToHomePage(homePage, bgPath) {
    if (!homePage) return;
    if (bgPath) {
        const normalizedPath = bgPath.replace(/\\/g, '/');
        homePage.style.backgroundImage = "url('file:///" + normalizedPath + "')";
        homePage.style.backgroundSize = 'cover';
        homePage.style.backgroundPosition = 'center';
        homePage.style.backgroundRepeat = 'no-repeat';
        homePage.style.backgroundAttachment = 'fixed';
        homePage.classList.add('has-custom-bg');
    } else {
        homePage.style.backgroundImage = '';
        homePage.style.backgroundSize = '';
        homePage.style.backgroundPosition = '';
        homePage.style.backgroundRepeat = '';
        homePage.style.backgroundAttachment = '';
        homePage.classList.remove('has-custom-bg');
    }
}

window.applyCustomBackgroundToHomeTabs = async function() {
    const data = await ipcRenderer.invoke('get-data');
    const bgPath = data.settings.customBackground || '';
    tabs.forEach(tab => {
        if (!tab.isHome || !tab.content) return;
        const homePage = tab.content.querySelector('.home-page');
        applyBgToHomePage(homePage, bgPath);
    });
};

function shouldUpgradeToHttps(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.startsWith('http://') && !lower.includes('localhost') && !lower.includes('2.59.132.39');
}

function upgradeUrl(url) {
    return url.replace(/^http:\/\//i, 'https://');
}

const IGNORED_ERROR_CODES = new Set([
    0, -1, -2, -3, -6, -9, -11, -13, -15, -21, -27, -30,
    -100, -101, -109, -118, -138, -324,
]);



function setupWebview(tab) {
    const webview = tab.webview;

    if (DEBUG_MODE) {
        webview.addEventListener('console-message', (e) => {
            if (e.level === 3) {
                console.log('[WEBVIEW]', e.message);
            }
        });
    }

    let isNavigating = false;
    let navigationTimer = null;
    let inPageNavTimer = null;
    let historyDebounceTimer = null;
    let lastHistoryUrl = '';
    let lastNavigatedUrl = '';
    let lastNavigatedTime = 0;

    function isYouTubeUrl(url) {
        return url && (url.includes('youtube.com') || url.includes('googlevideo.com') || url.includes('music.youtube.com'));
    }

    webview.addEventListener('context-menu', (e) => {
        e.preventDefault();
        const params = e.params || e.detail || {};
        const rect = webview.getBoundingClientRect();
        showPageContextMenu(rect.left + (params.x || 0), rect.top + (params.y || 0), params, webview, tab);
    });

    webview.addEventListener('did-navigate', (e) => {
        isNavigating = false;
        if (navigationTimer) { clearTimeout(navigationTimer); navigationTimer = null; }

        const now = Date.now();
        const isSameUrl = e.url === lastNavigatedUrl;
        const isTooFast = (now - lastNavigatedTime) < 800;

        if (isSameUrl && isTooFast) return;

        lastNavigatedUrl = e.url;
        lastNavigatedTime = now;

        if (!e.url.includes('error-page.html')) {
            tab.url = e.url;
            tab.isErrorPage = false;
            tab.failedUrl = null;
        }

        if (tab.id === activeTabId && isWebviewReady(webview)) {
            updateNavigationState();
        }
        updateTabFavicon(tab);

        if (tab.id === activeTabId && window.updateNewsCheck) {
            window.updateNewsCheck(e.url);
        }

        if (tab.id === activeTabId && window.updateTabActivity && !tab.isTor) {
            try {
                let navTitle = e.url;
                if (isWebviewReady(webview)) { try { navTitle = webview.getTitle() || e.url; } catch(ex) {} }
                window.updateTabActivity(navTitle, e.url);
            } catch(ex) {}
        }

        if (!tab.isTor && !e.url.includes('error-page.html') && !e.url.startsWith('chrome-extension://') && e.url !== lastHistoryUrl) {
            lastHistoryUrl = e.url;
            if (historyDebounceTimer) clearTimeout(historyDebounceTimer);
            historyDebounceTimer = setTimeout(() => {
                let histTitle = e.url;
                if (isWebviewReady(webview)) {
                    try { histTitle = webview.getTitle() || e.url; } catch(ex) {}
                }
                ipcRenderer.invoke('add-history', { title: histTitle, url: e.url });
            }, 300);
        }
    });

    webview.addEventListener('page-title-updated', (e) => {
        updateTabTitle(tab.id, e.title);
    });

    if (tab.isTor) {
        webview.addEventListener('dom-ready', () => {
            if (isTorHomeUrl(tab.url) && typeof window.pushTorStateToTab === 'function') window.pushTorStateToTab(tab);
        });
    }

    webview.addEventListener('did-navigate-in-page', (e) => {
        if (!e.isMainFrame) return;
        if (e.url.startsWith('chrome-extension://')) { tab.url = e.url; return; }

        tab.url = e.url;

        if (tab.id === activeTabId && window.updateNewsCheck) {
            window.updateNewsCheck(e.url);
        }

        if (inPageNavTimer) clearTimeout(inPageNavTimer);
        inPageNavTimer = setTimeout(() => {
            if (tab.id === activeTabId) updateNavigationState();
            updateTabFavicon(tab);
        }, 150);
    });

    webview.addEventListener('did-fail-load', async (e) => {
        if (!e.isMainFrame) return;
        if (IGNORED_ERROR_CODES.has(e.errorCode)) return;
        const validatedURL = e.validatedURL || '';
        if (validatedURL.startsWith('chrome-extension://')) return;
        if (tab.isErrorPage) return;
        if (validatedURL.includes('error-page.html')) return;
        if (!validatedURL || validatedURL === 'about:blank') return;

        const errorMessages = {
            '-105': 'DNS-Auflösung fehlgeschlagen',
            '-106': 'Internetverbindung unterbrochen',
            '-102': 'Verbindung abgelehnt',
            '-104': 'Verbindung fehlgeschlagen',
            '-200': 'SSL-Zertifikat ungültig',
            '-201': 'SSL-Zertifikatfehler',
            '-107': 'SSL-Protokollfehler',
            '-7': 'Verbindung unterbrochen',
        };
        const errorDescription = errorMessages[e.errorCode.toString()] || 'Verbindung fehlgeschlagen (Code: ' + e.errorCode + ')';

        if ((e.errorCode === -107 || e.errorCode === -200 || e.errorCode === -201) && validatedURL && validatedURL.startsWith('https://')) {
            const data = await ipcRenderer.invoke('get-data');
            if (data.settings.httpsOnly) {
                pendingHttpUrl = validatedURL.replace('https://', 'http://');
                showHttpsWarning(pendingHttpUrl);
                return;
            }
        }

        const failedUrl = validatedURL || tab.url;
        tab.failedUrl = failedUrl;
        tab.isErrorPage = true;

        const [errorPagePath, appData] = await Promise.all([
            ipcRenderer.invoke('get-error-page-path'),
            ipcRenderer.invoke('get-data')
        ]);

        const theme = (appData.settings && appData.settings.theme) || 'aquila-modern';

        webview.src = errorPagePath
            + '?code=' + e.errorCode
            + '&url=' + encodeURIComponent(failedUrl)
            + '&description=' + encodeURIComponent(errorDescription)
            + '&theme=' + encodeURIComponent(theme);

        updateTabTitle(tab.id, 'Verbindung fehlgeschlagen');
        if (tab.id === activeTabId) {
            setTimeout(() => updateNavigationState(), 100);
        }
    });

    webview.addEventListener('dom-ready', () => {
        isNavigating = false;
        if (!splitView.isActive() && tab.id === activeTabId) {
            notifyExtensionActiveTab(activeTab);
        }

        try {
            const currentUrl = tab.url || '';

            if (isYouTubeUrl(currentUrl)) {
                return;
            }

            if (currentUrl.includes('github.com')) {
                webview.insertCSS(`
                    html { overflow-x: clip !important; }
                    .js-yearly-contributions,
                    .ContributionCalendar,
                    .ContributionCalendar-grid { overflow-x: auto !important; max-width: 100%; }
                `).catch(() => {});

                webview.executeJavaScript(`
                    (function() {
                        if (typeof Turbo !== 'undefined' && Turbo.session) {
                            Turbo.session.drive = false;
                            Turbo.session.stop();
                        }

                        document.querySelectorAll('turbo-frame[src]').forEach(function(f) {
                            f.removeAttribute('src');
                            f.removeAttribute('loading');
                        });

                        var selectors = [
                            'footer',
                            '.AppHeader',
                            '.application-main',
                            '.js-header-wrapper',
                            '.Header',
                            'nav[aria-label="Global"]',
                            'main'
                        ];

                        selectors.forEach(function(sel) {
                            var els = document.querySelectorAll(sel);
                            if (els.length > 1) {
                                for (var i = 1; i < els.length; i++) {
                                    els[i].remove();
                                }
                            }
                        });

                        var turboFrameIds = {};
                        document.querySelectorAll('turbo-frame[id]').forEach(function(frame) {
                            var fid = frame.getAttribute('id');
                            if (turboFrameIds[fid]) {
                                frame.remove();
                            } else {
                                turboFrameIds[fid] = true;
                            }
                        });

                        if (!window.__aquilaGithubObserver) {
                            window.__aquilaGithubObserver = true;
                            var obs = new MutationObserver(function() {
                                selectors.forEach(function(sel) {
                                    var els = document.querySelectorAll(sel);
                                    if (els.length > 1) {
                                        for (var i = 1; i < els.length; i++) {
                                            els[i].remove();
                                        }
                                    }
                                });
                            });
                            obs.observe(document.body, { childList: true, subtree: true });
                        }
                    })();
                `).catch(() => {});
            }

            webview.executeJavaScript(`
                if (!window.__aquilaMouseFixApplied) {
                    window.__aquilaMouseFixApplied = true;
                    document.addEventListener('mouseup', function(e) {
                        if (e.button === 3 || e.button === 4) {
                            e.preventDefault();
                            if (e.button === 3) history.back();
                            else history.forward();
                        }
                    });
                }
            `).catch(() => {});
        } catch(e) {}
    });

    webview.addEventListener('media-started-playing', function() {
        if (tab.element) {
            tab.element.classList.add('media-playing');
            var audioIcon = tab.element.querySelector('.tab-audio-icon');
            if (audioIcon) {
                audioIcon.style.display = 'flex';
                if (tab.isMuted) audioIcon.classList.add('is-muted');
            }
        }
    });

    webview.addEventListener('media-paused', function() {
        if (tab.element) {
            tab.element.classList.remove('media-playing');
            if (!tab.isMuted) {
                var audioIcon = tab.element.querySelector('.tab-audio-icon');
                if (audioIcon) audioIcon.style.display = 'none';
            }
        }
    });
}

function initContextMenu() {
    contextMenuEl = document.createElement('div');
    contextMenuEl.id = 'custom-context-menu';
    contextMenuEl.style.display = 'none';
    document.body.appendChild(contextMenuEl);

    contextMenuOverlay = document.createElement('div');
    contextMenuOverlay.id = 'context-menu-overlay';
    contextMenuOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99998;display:none;';
    document.body.appendChild(contextMenuOverlay);

    contextMenuOverlay.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); hideContextMenu(); });
    contextMenuOverlay.addEventListener('contextmenu', (e) => { e.preventDefault(); hideContextMenu(); });

    document.addEventListener('mousedown', (e) => {
        if (contextMenuEl && contextMenuEl.style.display !== 'none' && !contextMenuEl.contains(e.target)) hideContextMenu();
    });

    const style = document.createElement('style');
    style.textContent =
        '#custom-context-menu{position:fixed;z-index:99999;background:var(--bg-primary,#0a1628);border:1px solid var(--border-color,#1e3a5f);border-radius:8px;padding:6px 0;min-width:260px;max-width:350px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-size:13px;color:var(--text-primary,#e0e0e0);animation:ctxFadeIn 0.12s ease-out;}' +
        '@keyframes ctxFadeIn{from{opacity:0;transform:scale(0.96);}to{opacity:1;transform:scale(1);}}' +
        '.ctx-item{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;cursor:pointer;transition:background 0.15s;user-select:none;}' +
        '.ctx-item:hover{background:var(--primary-color,#1e90ff);color:white;}' +
        '.ctx-item.disabled{opacity:0.4;pointer-events:none;}' +
        '.ctx-item .ctx-shortcut{font-size:11px;opacity:0.6;margin-left:24px;white-space:nowrap;}' +
        '.ctx-item:hover .ctx-shortcut{opacity:0.8;}' +
        '.ctx-separator{height:1px;background:var(--border-color,#1e3a5f);margin:4px 8px;}' +
        '.tab.tab-dragging{transform:translateY(-5px) scale(1.04);z-index:100;box-shadow:0 6px 24px rgba(30,144,255,0.35),0 0 0 2px var(--primary-color,#1e90ff);pointer-events:none;filter:brightness(1.15);}' +
        '.pdf-drop-indicator{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(30,144,255,0.15);border:4px dashed var(--primary-color,#1e90ff);z-index:99995;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:var(--primary-color,#1e90ff);pointer-events:none;opacity:0;transition:opacity 0.12s ease;}' +
        '.pdf-drop-indicator.active{pointer-events:auto;opacity:1;}' +
        '.tab-drag-ghost{position:fixed;display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:6px;font-size:12px;font-weight:500;color:var(--text-primary,#e0e0e0);background:var(--bg-primary,#0a1628);border:1px solid var(--primary-color,#1e90ff);box-shadow:0 4px 16px rgba(30,144,255,0.25),0 0 0 1px rgba(30,144,255,0.15);white-space:nowrap;pointer-events:none;z-index:100001;max-width:200px;opacity:0.95;height:28px;}' +
        '.tab-drag-ghost-favicon{width:14px;height:14px;flex-shrink:0;}' +
        '.tab-drag-ghost-favicon img{width:100%;height:100%;display:block;}' +
        '.tab-drag-ghost-favicon svg{width:100%;height:100%;}' +
        '.tab-drag-ghost span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        'body.is-tab-dragging,body.is-tab-dragging *{cursor:grabbing!important;}' +
        '.tab-audio-icon{align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;transition:background 0.15s,opacity 0.15s;opacity:0.7;}' +
        '.tab-audio-icon:hover{background:rgba(255,255,255,0.15);opacity:1;}' +
        '.tab-audio-icon.is-muted{opacity:0.5;}' +
        '.tab-audio-icon.is-muted:hover{opacity:0.9;}' +
        '@keyframes tab-audio-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.15);}}' +
        '.tab.media-playing:not(.tab-muted) .tab-audio-icon svg{animation:tab-audio-pulse 1.5s ease-in-out infinite;}' +
        '.tab.tab-muted .tab-audio-icon svg{animation:none;}';
    document.head.appendChild(style);
}

function showPageContextMenu(x, y, params, webview, tab) {
    hideContextMenu();
    params = params || {};
    const items = [];

    const canBack = (() => { try { return webview.canGoBack(); } catch(e) { return false; } })();
    const canFwd = (() => { try { return webview.canGoForward(); } catch(e) { return false; } })();

    items.push({ label: 'Zurück', shortcut: 'ALT + LEFT', action: () => { try { webview.goBack(); } catch(e) {} }, disabled: !canBack });
    items.push({ label: 'Vorwärts', shortcut: 'SHIFT + BACKSPACE', action: () => { try { webview.goForward(); } catch(e) {} }, disabled: !canFwd });
    items.push({ label: 'Neu laden', shortcut: 'F5', action: () => { try { webview.reload(); } catch(e) {} } });
    items.push({ separator: true });

    if (params.linkURL) {
        items.push({ label: tab && tab.isTor ? 'Link in neuem Tor-Tab öffnen' : 'Link in neuem Tab öffnen', action: () => createTabLike(tab, params.linkURL) });
        if (!(tab && tab.isTor)) items.push({ label: 'Link in neuem Tor-Tab öffnen', action: () => createTorTab(params.linkURL) });
        items.push({ label: 'Link-Adresse kopieren', action: () => navigator.clipboard.writeText(params.linkURL) });
        items.push({ separator: true });
    }

    if (params.srcURL && params.mediaType === 'image') {
        items.push({ label: 'Bild in neuem Tab öffnen', action: () => createTabLike(tab, params.srcURL) });
        items.push({ label: 'Bild-URL kopieren', action: () => navigator.clipboard.writeText(params.srcURL) });
        items.push({ separator: true });
    }

    if (params.selectionText) {
        items.push({ label: 'Kopieren', shortcut: 'CTRL + C', action: () => { try { webview.copy(); } catch(e) {} } });
        if (params.isEditable) items.push({ label: 'Ausschneiden', shortcut: 'CTRL + X', action: () => { try { webview.cut(); } catch(e) {} } });
        const searchText = params.selectionText.length > 25 ? params.selectionText.substring(0, 25) + '...' : params.selectionText;
        items.push({ label: '"' + searchText + '" suchen', action: () => {
            if (tab && tab.isTor) createTorTab(TOR_SEARCH_URL + encodeURIComponent(params.selectionText));
            else createTab('https://www.google.com/search?q=' + encodeURIComponent(params.selectionText));
        } });
        items.push({ separator: true });
    }

    if (params.isEditable) {
        if (!params.selectionText) items.push({ label: 'Kopieren', shortcut: 'CTRL + C', action: () => { try { webview.copy(); } catch(e) {} }, disabled: true });
        items.push({ label: 'Einfügen', shortcut: 'CTRL + V', action: () => { try { webview.paste(); } catch(e) {} } });
        items.push({ label: 'Alles auswählen', shortcut: 'CTRL + A', action: () => { try { webview.selectAll(); } catch(e) {} } });
        items.push({ separator: true });
    }

    items.push({ label: 'Zur Schnellwahl hinzufügen', action: () => addQuickAccessFromWebview(webview) });
    items.push({ label: 'Zu Lesezeichen hinzufügen...', action: () => { if (typeof toggleCurrentBookmark === 'function') toggleCurrentBookmark(); } });
    items.push({ separator: true });
    items.push({ label: 'Vollbild ein', shortcut: 'F11', action: () => ipcRenderer.invoke('toggle-fullscreen') });
    items.push({ separator: true });
    items.push({ label: 'Adresse kopieren', action: () => { try { navigator.clipboard.writeText(webview.getURL()); } catch(e) {} } });
    items.push({ separator: true });

    const wcId = (() => { try { return webview.getWebContentsId(); } catch(e) { return null; } })();
    items.push({ label: 'Speichern unter...', shortcut: 'CTRL + S', action: () => { if (wcId) ipcRenderer.invoke('save-page', wcId); } });
    items.push({ label: 'Als PDF speichern...', action: () => { if (wcId) ipcRenderer.invoke('save-page-as-pdf', wcId); } });
    items.push({ label: 'Drucken...', shortcut: 'CTRL + P', action: () => { if (wcId) ipcRenderer.invoke('print-page', wcId); } });
    items.push({ separator: true });
    items.push({ label: 'Seitenquelle', shortcut: 'CTRL + U', action: () => { try { createTabLike(tab, 'view-source:' + webview.getURL()); } catch(e) {} } });
    items.push({ label: 'Element untersuchen', shortcut: 'CTRL + SHIFT + C', action: () => { try { webview.openDevTools(); } catch(e) {} } });

    renderContextMenu(x, y, items);
}

function showTabContextMenu(x, y, tab) {
    hideContextMenu();
    var items = [];
    items.push({ label: 'Neuer Tab', shortcut: 'CTRL + T', action: function() { createTab(); } });
    items.push({ label: 'Neuer Tor-Tab', shortcut: 'ALT + SHIFT + N', action: function() { createTorTab(); } });
    items.push({ label: 'Tab duplizieren', action: function() { createTabLike(tab, tab.url); } });
    items.push({ separator: true });
    if (!tab.isHome && tab.webview) {
        var muted = false;
        try { muted = tab.webview.isAudioMuted(); } catch(e) {}
        items.push({ label: muted ? 'Tab laut schalten' : 'Tab stummschalten', action: function() { toggleTabMute(tab.id); } });
    }
    if (!tab.isHome && tabs.filter(function(t) { return !t.isHome; }).length >= 2) {
        items.push({ label: 'In Split-View öffnen', action: function() { splitView.openInSplit(tab.id); } });
    }
    items.push({ separator: true });
    items.push({ label: 'Tab neu laden', action: function() { try { if (tab.webview) tab.webview.reload(); } catch(e) {} } });
    items.push({ label: tab.isSuspended ? 'Tab aktivieren' : 'Tab suspendieren', action: function() { if (tab.isSuspended) resumeTab(tab); else suspendTab(tab); } });
    items.push({ separator: true });
    items.push({ label: 'Andere Tabs schließen', action: function() { closeOtherTabs(tab.id); } });
    items.push({ label: 'Tab schließen', shortcut: 'CTRL + W', action: function() { closeTab(tab.id); } });
    renderContextMenu(x, y, items);
}

function renderContextMenu(x, y, items) {
    contextMenuEl.innerHTML = '';
    items.forEach(item => {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.className = 'ctx-separator';
            contextMenuEl.appendChild(sep);
        } else {
            const el = document.createElement('div');
            el.className = 'ctx-item' + (item.disabled ? ' disabled' : '');
            el.innerHTML = '<span>' + item.label + '</span>' + (item.shortcut ? '<span class="ctx-shortcut">' + item.shortcut + '</span>' : '');
            if (!item.disabled) el.addEventListener('click', (e) => { e.stopPropagation(); item.action(); hideContextMenu(); });
            contextMenuEl.appendChild(el);
        }
    });
    contextMenuEl.style.display = 'block';
    if (contextMenuOverlay) contextMenuOverlay.style.display = 'block';
    const rect = contextMenuEl.getBoundingClientRect();
    y -= 10;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;
    contextMenuEl.style.left = x + 'px';
    contextMenuEl.style.top = y + 'px';
}

function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.style.display = 'none';
    if (contextMenuOverlay) contextMenuOverlay.style.display = 'none';
}

async function addQuickAccessFromWebview(webview) {
    try {
        const url = webview.getURL();
        const title = webview.getTitle() || url;
        await ipcRenderer.invoke('add-quick-access', { name: title.substring(0, 30), url: url, icon: '' });
        loadQuickAccess();
    } catch (e) {}
}

function closeOtherTabs(keepTabId) {
    const toClose = tabs.filter(t => t.id !== keepTabId).map(t => t.id);
    toClose.forEach(id => closeTab(id));
}

function updateTabTitle(tabId, title) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.title = title;
    const titleElement = tab.element ? tab.element.querySelector('.tab-title') : null;
    if (titleElement) titleElement.textContent = title;
    updateTabFavicon(tab);
}

function updateTabFavicon(tab) {
    if (!tab.element || tab.isHome || tab.isTor) return;
    const faviconContainer = tab.element.querySelector('.tab-favicon');
    if (!faviconContainer) return;
    const currentUrl = tab.url || '';

    if (currentUrl.startsWith('chrome-extension://')) {
        try {
            const extId = currentUrl.split('/')[2];
            const extBtn = document.querySelector('.ext-action-btn[data-extension-id="' + extId + '"]');
            if (extBtn) {
                const extImg = extBtn.querySelector('img');
                if (extImg && extImg.src) {
                    faviconContainer.innerHTML = '<img src="' + extImg.src + '" alt="" style="width:100%;height:100%;display:block;object-fit:contain;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';">' +
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" style="display:none;"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
                    updateTabBookmarkIcon(tab);
                    return;
                }
            }
        } catch(e) {}
        faviconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
        updateTabBookmarkIcon(tab);
        return;
    }

    let faviconUrl = '';
    if (currentUrl && currentUrl !== 'aquila://home') {
        try {
            const url = new URL(currentUrl.startsWith('http') ? currentUrl : 'https://' + currentUrl);
            faviconUrl = 'https://www.google.com/s2/favicons?domain=' + url.hostname + '&sz=64';
        } catch (e) {}
    }
    if (faviconUrl) {
        faviconContainer.innerHTML = '<img src="' + faviconUrl + '" alt="" style="width:100%;height:100%;display:block;" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';">' +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" style="display:none;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
    }
    updateTabBookmarkIcon(tab);
}

async function updateTabBookmarkIcon(tab) {
    if (!tab || !tab.element || tab.isHome || !tab.url) return;
    const bookmarkIcon = tab.element.querySelector('.tab-bookmark-icon');
    if (!bookmarkIcon) return;
    try {
        const now = Date.now();
        if (!bookmarkCache || (now - bookmarkCacheTime) > BOOKMARK_CACHE_TTL) {
            bookmarkCache = await ipcRenderer.invoke('get-data');
            bookmarkCacheTime = now;
        }
        bookmarkIcon.style.display = bookmarkCache.bookmarks.some(b => b.url === tab.url) ? 'block' : 'none';
    } catch (e) { bookmarkIcon.style.display = 'none'; }
}

function invalidateBookmarkCache() {
    bookmarkCache = null;
    bookmarkCacheTime = 0;
}

let pendingNewWindowUrls_notification = [];


function showNewWindowNotification(urls) {
    let notification = document.getElementById('new-window-notification');
    if (notification) notification.remove();

    notification = document.createElement('div');
    notification.id = 'new-window-notification';
    notification.style.cssText = [
        'position:fixed',
        'top:60px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:99999',
        'background:var(--bg-secondary,#0d1f3c)',
        'border:1px solid var(--border-color,#1e3a5f)',
        'border-radius:10px',
        'padding:14px 18px',
        'min-width:420px',
        'max-width:560px',
        'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
        'font-size:13px',
        'color:var(--text-primary,#e0e0e0)',
        'opacity:0',
        'transition:opacity 0.25s ease'
    ].join(';');

    const urlRowsHtml = urls.map(url => {
        let faviconUrl = '';
        try {
            faviconUrl = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
        } catch(e) {}
        return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <img src="${faviconUrl}" alt="" style="width:16px;height:16px;flex-shrink:0;border-radius:3px;"
                     onerror="this.style.display='none'">
                <span style="font-size:11px;color:var(--text-secondary,#8899aa);
                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${url}</span>
            </div>`;
    }).join('');

    const labelText = urls.length === 1
        ? 'Möchtest du einen neuen Tab öffnen?'
        : `Möchtest du ${urls.length} neue Tabs öffnen?`;

    const btnText = urls.length === 1 ? 'Öffnen' : `${urls.length} Tabs öffnen`;

    notification.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px;">${labelText}</div>
        <div style="margin-bottom:12px;max-height:120px;overflow-y:auto;">${urlRowsHtml}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button onclick="denyNewWindow()" style="
                padding:6px 14px;border-radius:6px;
                border:1px solid var(--border-color,#1e3a5f);
                background:transparent;color:var(--text-primary,#e0e0e0);
                cursor:pointer;font-size:12px;">Ablehnen</button>
            <button onclick="allowNewWindow()" style="
                padding:6px 14px;border-radius:6px;border:none;
                background:var(--primary-color,#1e90ff);
                color:white;cursor:pointer;font-size:12px;">${btnText}</button>
        </div>`;

    document.body.appendChild(notification);

    requestAnimationFrame(() => requestAnimationFrame(() => {
        notification.style.opacity = '1';
    }));

    pendingNewWindowUrls_notification = urls;
}

function hideNewWindowNotification() {
    const n = document.getElementById('new-window-notification');
    if (!n) return;
    n.style.opacity = '0';
    setTimeout(() => n.remove(), 250);
}

window.allowNewWindow = async function() {
    if (pendingNewWindowUrls_notification.length === 0) {
        hideNewWindowNotification();
        return;
    }

    const urls = [...pendingNewWindowUrls_notification];
    pendingNewWindowUrls_notification = [];
    hideNewWindowNotification();

    const tabsBefore = tabs.length;

    for (const url of urls) {
        await createTabInternal(url, false);
    }

    const firstNew = tabs[tabsBefore];
    if (!firstNew) return;

    tabs.forEach(t => {
        if (t.element) t.element.classList.remove('active');
        if (t.content) t.content.classList.remove('active');
    });

    switchToTab(firstNew.id);
};

window.denyNewWindow = function() {
    pendingNewWindowUrls_notification = [];
    hideNewWindowNotification();
};

window.allowPermission = function(remember) {
    if (pendingPermissionRequest) {
        ipcRenderer.send('permission-response', { domain: pendingPermissionRequest.domain, type: pendingPermissionRequest.type, granted: true, remember });
        pendingPermissionRequest = null;
    } else if (pendingFullscreenRequest) {
        if (remember) {
            ipcRenderer.invoke('get-data').then(data => {
                if (!data.permissions) data.permissions = [];
                data.permissions.push({ domain: pendingFullscreenRequest.domain, type: 'fullscreen', granted: true, timestamp: new Date().toISOString() });
                ipcRenderer.invoke('save-data', data);
            });
        }
        applyFullscreen();
        pendingFullscreenRequest = null;
    }
    hidePermissionNotification();
};

window.denyPermission = function() {
    if (pendingPermissionRequest) {
        ipcRenderer.send('permission-response', { domain: pendingPermissionRequest.domain, type: pendingPermissionRequest.type, granted: false, remember: false });
        pendingPermissionRequest = null;
    } else if (pendingFullscreenRequest) pendingFullscreenRequest = null;
    hidePermissionNotification();
};

function showPermissionNotification(pd) {
    const notification = document.getElementById('permission-notification');
    const domainEl = document.getElementById('permission-domain');
    const textEl = notification ? notification.querySelector('.permission-text') : null;
    const iconEl = notification ? notification.querySelector('.permission-icon-svg') : null;
    const rememberCb = document.getElementById('permission-remember');
    if (notification && domainEl && textEl && iconEl) {
        const names = { 'microphone': 'Mikrofon', 'camera': 'Kamera', 'notifications': 'Benachrichtigungen', 'geolocation': 'Standort', 'fullscreen': 'Vollbild' };
        const icons = {
            'microphone': '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>',
            'camera': '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5z"/>',
            'notifications': '<path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>',
            'geolocation': '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>',
            'fullscreen': '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>'
        };
        domainEl.textContent = pd.domain;
        textEl.textContent = 'Möchte ' + (names[pd.type] || pd.type) + ' verwenden';
        iconEl.innerHTML = icons[pd.type] || icons['notifications'];
        if (rememberCb) rememberCb.checked = false;
        notification.style.display = 'block';
    }
}

function hidePermissionNotification() { const n = document.getElementById('permission-notification'); if (n) n.style.display = 'none'; }

function showHttpsWarning(url) {
    const modal = document.getElementById('https-warning-modal');
    const urlEl = document.getElementById('https-warning-url');
    if (modal && urlEl) { urlEl.textContent = url; modal.classList.add('active'); }
}

function hideHttpsWarning() {
    const modal = document.getElementById('https-warning-modal');
    if (modal) modal.classList.remove('active');
    pendingHttpUrl = null;
}

async function disableHttpsAndRetry() {
    const data = await ipcRenderer.invoke('get-data');
    data.settings.httpsOnly = false;
    await ipcRenderer.invoke('save-data', data);
    hideHttpsWarning();
    if (pendingHttpUrl) setTimeout(() => navigateToUrl(pendingHttpUrl), 100);
    if (window.loadSettings) setTimeout(() => window.loadSettings(), 200);
}

window.hideHttpsWarning = hideHttpsWarning;
window.disableHttpsAndRetry = disableHttpsAndRetry;

function showAddQuickAccessDialog() {
    const modal = document.getElementById('add-quick-access-modal');
    if (modal) {
        modal.classList.add('active');
        const nameInput = document.getElementById('quick-access-name-input');
        const urlInput = document.getElementById('quick-access-url-input');
        const overlay = modal.querySelector('.modal-overlay');
        nameInput.value = ''; urlInput.value = ''; nameInput.focus();
        nameInput.onkeypress = (e) => { if (e.key === 'Enter') urlInput.focus(); };
        urlInput.onkeypress = (e) => { if (e.key === 'Enter') submitQuickAccessForm(); };
        overlay.onclick = hideAddQuickAccessDialog;
    }
}

function hideAddQuickAccessDialog() { const modal = document.getElementById('add-quick-access-modal'); if (modal) modal.classList.remove('active'); }

async function submitQuickAccessForm() {
    const name = document.getElementById('quick-access-name-input').value.trim();
    const url = document.getElementById('quick-access-url-input').value.trim();
    if (!name || !url) {
        await window.aqAlert('Bitte fülle beide Felder aus!');
        return;
    }
    addQuickAccessItem(name, url);
    hideAddQuickAccessDialog();
}

window.hideAddQuickAccessDialog = hideAddQuickAccessDialog;
window.submitQuickAccessForm = submitQuickAccessForm;

async function addQuickAccessItem(name, url) {
    await ipcRenderer.invoke('add-quick-access', { name, url: url.startsWith('http') ? url : 'https://' + url, icon: '' });
    loadQuickAccess();
}

async function loadQuickAccess() {
    const activeTab = getCurrentTab();
    if (!activeTab || !activeTab.isHome || !activeTab.content) return;
    const data = await ipcRenderer.invoke('get-data');
    const grid = activeTab.content.querySelector('#quick-access-grid');
    if (!grid) return;
    const homePage = activeTab.content.querySelector('.home-page');
    applyBgToHomePage(homePage, data.settings.customBackground || '');
    grid.innerHTML = '';
    data.quickAccess.forEach((item, index) => {
        let domain = '';
        try { domain = new URL(item.url.startsWith('http') ? item.url : 'https://' + item.url).hostname; } catch (e) {}
        const faviconUrl = domain ? 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=128' : '';
        const itemDiv = document.createElement('div');
        itemDiv.className = 'quick-access-item';
        itemDiv.innerHTML = '<div class="quick-access-icon">' +
            (faviconUrl ? '<img src="' + faviconUrl + '" alt="' + item.name + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\';"><svg viewBox="0 0 24 24" style="display:none;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>') +
            '</div><span class="quick-access-name">' + item.name + '</span>' +
            '<button class="quick-access-delete"><svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg></button>';
        itemDiv.addEventListener('click', (e) => { if (!e.target.closest('.quick-access-delete')) navigateHomeTab(item.url); });
        itemDiv.querySelector('.quick-access-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteQuickAccess(index); });
        grid.appendChild(itemDiv);
    });
}

async function deleteQuickAccess(index) {
    await ipcRenderer.invoke('delete-quick-access', index);
    loadQuickAccess();
}

document.getElementById('new-tab-btn').addEventListener('click', () => createTab());

window.updateMinimalMode = function(enabled) {
    minimalModeEnabled = enabled;
    if (enabled) tabs.forEach(t => { if (t.id !== activeTabId) suspendTab(t); });
    else tabs.forEach(t => { if (t.isSuspended) resumeTab(t); });
};

ipcRenderer.on('enforce-memory-limit', () => {
    const inactiveTabs = tabs.filter(t => t.id !== activeTabId && !t.isHome && t.webview && !t.isSuspended);
    inactiveTabs.forEach(t => deepSuspendTab(t));
});

ipcRenderer.on('enforce-cpu-limit', () => {
    tabs.forEach(t => { if (t.id !== activeTabId && !t.isSuspended) suspendTab(t); });
});

async function saveCurrentSession() {
    const sessionTabs = tabs
        .filter(t => !t.isHome && !t.isTor && (t.url || t.suspendedUrl) && t.url !== 'aquila://home')
        .map(t => ({ url: t.suspendedUrl || t.url, title: t.title || t.url }));
    await ipcRenderer.invoke('save-session', sessionTabs);
}

ipcRenderer.on('before-app-close', async () => {
    const data = await ipcRenderer.invoke('get-data');
    if (data.settings.sessionRestore) await saveCurrentSession();
    else await ipcRenderer.invoke('clear-session');
});

window.updateTabBookmarkIcon = updateTabBookmarkIcon;
window.invalidateBookmarkCache = invalidateBookmarkCache;
window.showNewWindowNotification = showNewWindowNotification;
window.createTab = createTab;
window.createTorTab = createTorTab;
window.isTorHomeUrl = isTorHomeUrl;
window.TOR_SEARCH_URL = TOR_SEARCH_URL;
window.tabs = tabs;
window.getCurrentTab = getCurrentTab;
window.fetchPartners = (...args) => partners.fetch(...args);
window.openPartnersModal = () => partners.openModal();
window.closePartnersModal = () => partners.closeModal();
window.loadPartnersIntoModal = () => partners.loadIntoModal();