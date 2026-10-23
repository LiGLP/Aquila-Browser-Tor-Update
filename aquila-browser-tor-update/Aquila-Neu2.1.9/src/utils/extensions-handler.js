let extensionButtons = [];
let activePopup = null;
let activePopupExtId = null;
let activeCloseListener = null;
let barReady = false;
let extensionsNotified = false;
let extensionsWarmedUp = false;
let startupNotifyTimer = null;
let startupNotifyAttempts = 0;
const MAX_STARTUP_NOTIFY_ATTEMPTS = 60;
const STARTUP_NOTIFY_INTERVAL = 500;

function initExtensionBar() {
    if (document.getElementById('extension-bar')) {
        barReady = true;
        console.log('[DEBUG] EXT-BAR - already exists, skipping init');
        return true;
    }

    const container = document.querySelector('.nav-actions');
    if (!container) {
        console.log('[DEBUG] EXT-BAR - .nav-actions not found, cannot init');
        return false;
    }

    const extensionBar = document.createElement('div');
    extensionBar.id = 'extension-bar';
    extensionBar.style.cssText = 'display:flex;align-items:center;gap:2px;padding:0 2px;';

    const extBtn = container.querySelector('#extensions-btn');
    if (extBtn) {
        container.insertBefore(extensionBar, extBtn);
    } else {
        container.insertBefore(extensionBar, container.firstChild);
    }

    barReady = true;
    console.log('[DEBUG] EXT-BAR - created and inserted into DOM');
    return true;
}

async function loadExtensionButtons() {
    console.log('[DEBUG] EXT-BUTTONS-1 - loadExtensionButtons called, barReady:', barReady);
    if (!barReady) {
        if (!initExtensionBar()) return;
    }

    const bar = document.getElementById('extension-bar');
    if (!bar) {
        console.log('[DEBUG] EXT-BUTTONS-2 - extension-bar element not found, aborting');
        return;
    }

    bar.innerHTML = '';
    extensionButtons = [];

    let extensions = [];
    try {
        extensions = await ipcRenderer.invoke('get-extensions');
        console.log('[DEBUG] EXT-BUTTONS-3 - got', extensions.length, 'extensions from main process');
    } catch (e) {
        console.log('[DEBUG] EXT-BUTTONS-ERR - get-extensions failed:', e.message);
        return;
    }

    if (!Array.isArray(extensions) || extensions.length === 0) {
        console.log('[DEBUG] EXT-BUTTONS-4 - no extensions to render');
        return;
    }

    let buttonCount = 0;
    extensions.forEach(ext => {
        if (!ext || !ext.manifest) return;
        const action = ext.manifest.browser_action || ext.manifest.action;
        if (!action) return;

        const btn = createExtensionButton(ext, action);
        bar.appendChild(btn);
        extensionButtons.push({
            id: ext.id,
            element: btn,
            manifest: ext.manifest,
            path: ext.path,
            name: ext.name
        });
        buttonCount++;
    });
    console.log('[DEBUG] EXT-BUTTONS-5 - rendered', buttonCount, 'extension buttons');
}

function getDefaultSvg(size) {
    const s = size || 20;
    return '<svg viewBox="0 0 24 24" style="width:' + s + 'px;height:' + s + 'px;fill:var(--text-primary,#e0e0e0)"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7 1.49 0 2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z"/></svg>';
}

function resolveIconUrl(extensionId, iconDef, extPath) {
    if (!iconDef) return null;
    let iconPath = '';
    if (typeof iconDef === 'string') {
        iconPath = iconDef;
    } else if (typeof iconDef === 'object') {
        iconPath = iconDef['48'] || iconDef['32'] || iconDef['64'] || iconDef['128'] || iconDef['16'] || iconDef['19'] || iconDef['38'] || Object.values(iconDef)[0] || '';
    }
    if (!iconPath) return null;

    if (extPath) {
        const path = require('path');
        const fullPath = path.join(extPath, iconPath.replace(/^\//, '')).replace(/\\/g, '/');
        return 'file:///' + fullPath;
    }

    return 'chrome-extension://' + extensionId + '/' + iconPath.replace(/^\//, '');
}

function createExtensionButton(ext, action) {
    const btn = document.createElement('button');
    btn.className = 'ext-action-btn';
    btn.dataset.extensionId = ext.id;
    btn.title = action.default_title || ext.name;

    const iconUrl = resolveIconUrl(ext.id, action.default_icon || ext.manifest.icons, ext.path);
    if (iconUrl) {
        const img = document.createElement('img');
        img.src = iconUrl;
        img.style.cssText = 'width:18px;height:18px;object-fit:contain;pointer-events:none;border-radius:3px;';
        img.addEventListener('error', function() { btn.innerHTML = getDefaultSvg(18); });
        btn.appendChild(img);
    } else {
        btn.innerHTML = getDefaultSvg(18);
    }

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        handleExtensionClick(ext, action, btn);
    });

    btn.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        e.stopPropagation();
        showExtContextMenu(e.clientX, e.clientY, ext);
    });

    return btn;
}

function notifyActiveTabToExtensions() {
    if (!window.getCurrentTab) return Promise.resolve(false);
    var ct = window.getCurrentTab();
    if (!ct || ct.isHome || !ct.webview) return Promise.resolve(false);
    try {
        var wcId = ct.webview.getWebContentsId();
        if (wcId) {
            console.log('[DEBUG] EXT-NOTIFY - notifying active tab, wcId:', wcId);
            return ipcRenderer.invoke('select-tab', wcId).then(function() {
                console.log('[DEBUG] EXT-NOTIFY - active tab notify SUCCESS, wcId:', wcId);
                return true;
            }).catch(function(e) {
                console.log('[DEBUG] EXT-NOTIFY - active tab notify FAILED:', e.message);
                return false;
            });
        }
    } catch(e) {
        console.log('[DEBUG] EXT-NOTIFY - getWebContentsId failed:', e.message);
    }
    return Promise.resolve(false);
}

function notifyAllTabsToExtensions() {
    if (!window.tabs || !Array.isArray(window.tabs)) return Promise.resolve(false);
    var notified = false;
    var promises = [];
    var tabCount = 0;
    for (var i = 0; i < window.tabs.length; i++) {
        var tab = window.tabs[i];
        if (tab.isHome || !tab.webview) continue;
        try {
            var wcId = tab.webview.getWebContentsId();
            if (wcId) {
                tabCount++;
                promises.push(
                    (function(id) {
                        return ipcRenderer.invoke('select-tab', id).then(function() {
                            notified = true;
                            return true;
                        }).catch(function() { return false; });
                    })(wcId)
                );
            }
        } catch(e) {}
    }
    console.log('[DEBUG] EXT-NOTIFY-ALL - found', tabCount, 'webview tabs to notify');
    if (promises.length === 0) return Promise.resolve(false);
    return Promise.all(promises).then(function(results) {
        var successCount = results.filter(function(r) { return r; }).length;
        console.log('[DEBUG] EXT-NOTIFY-ALL - results:', successCount, '/', results.length, 'succeeded');
        return notified;
    });
}

function warmupExtensions() {
    if (extensionsWarmedUp) {
        console.log('[DEBUG] EXT-WARMUP - already warmed up, skipping');
        return;
    }
    extensionsWarmedUp = true;

    if (!extensionButtons || extensionButtons.length === 0) {
        console.log('[DEBUG] EXT-WARMUP - no extension buttons to warm up');
        return;
    }

    console.log('[DEBUG] EXT-WARMUP - warming up', extensionButtons.length, 'extensions');

    var warmupContainer = document.createElement('div');
    warmupContainer.id = 'ext-warmup-container';
    warmupContainer.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;opacity:0;z-index:-1;';
    document.body.appendChild(warmupContainer);

    var warmupQueue = extensionButtons.slice();
    var warmupIndex = 0;

    function warmupNext() {
        if (warmupIndex >= warmupQueue.length) {
            console.log('[DEBUG] EXT-WARMUP - all extensions warmed up, cleaning container');
            setTimeout(function() {
                if (warmupContainer.parentNode) warmupContainer.remove();
            }, 1000);

            setTimeout(function() {
                console.log('[DEBUG] EXT-WARMUP - reloading active tab to apply extension filters');
                reloadActiveTabForExtensions();
            }, 500);
            return;
        }

        var extInfo = warmupQueue[warmupIndex];
        warmupIndex++;

        if (!extInfo || !extInfo.manifest) {
            console.log('[DEBUG] EXT-WARMUP - skipping extension without manifest at index:', warmupIndex - 1);
            warmupNext();
            return;
        }

        var action = extInfo.manifest.browser_action || extInfo.manifest.action;
        var bgPage = extInfo.manifest.background;
        var popupPath = action ? action.default_popup : null;

        var warmupUrl = null;

        if (popupPath) {
            warmupUrl = 'chrome-extension://' + extInfo.id + '/' + popupPath.replace(/^\//, '');
            console.log('[DEBUG] EXT-WARMUP - warming up via popup:', extInfo.name, 'url:', warmupUrl);
        } else if (bgPage) {
            var bgPath = bgPage.page || (bgPage.scripts ? '_generated_background_page.html' : null);
            if (bgPath) {
                warmupUrl = 'chrome-extension://' + extInfo.id + '/' + bgPath.replace(/^\//, '');
                console.log('[DEBUG] EXT-WARMUP - warming up via background:', extInfo.name, 'url:', warmupUrl);
            }
        }

        if (!warmupUrl) {
            console.log('[DEBUG] EXT-WARMUP - no warmup URL for:', extInfo.name, ', skipping');
            warmupNext();
            return;
        }

        var webview = document.createElement('webview');
        webview.style.cssText = 'width:1px;height:1px;';
        webview.setAttribute('partition', 'persist:main');
        webview.src = warmupUrl;

        var warmupTimeout = null;
        var cleaned = false;

        function cleanupWarmupWebview() {
            if (cleaned) return;
            cleaned = true;
            if (warmupTimeout) clearTimeout(warmupTimeout);
            try { webview.stop(); } catch(e) {}
            setTimeout(function() {
                try { if (webview.parentNode) webview.remove(); } catch(e) {}
                console.log('[DEBUG] EXT-WARMUP - cleaned up webview for:', extInfo.name);
                warmupNext();
            }, 100);
        }

        webview.addEventListener('dom-ready', function() {
            console.log('[DEBUG] EXT-WARMUP - dom-ready for:', extInfo.name);

            webview.executeJavaScript(
                '(function() {' +
                '  var r = {};' +
                '  r.hasChromeRuntime = typeof chrome !== "undefined" && typeof chrome.runtime !== "undefined";' +
                '  r.hasChromeWebRequest = typeof chrome !== "undefined" && typeof chrome.webRequest !== "undefined";' +
                '  try { r.runtimeId = chrome.runtime.id; } catch(e) { r.error = e.message; }' +
                '  return JSON.stringify(r);' +
                '})()'
            ).then(function(result) {
                console.log('[DEBUG] EXT-WARMUP - Chrome API check for', extInfo.name, ':', result);
            }).catch(function(e) {
                console.log('[DEBUG] EXT-WARMUP - Chrome API check failed for', extInfo.name, ':', e.message);
            });

            setTimeout(function() {
                cleanupWarmupWebview();
            }, 2000);
        });

        webview.addEventListener('did-fail-load', function(e) {
            console.log('[DEBUG] EXT-WARMUP - did-fail-load for:', extInfo.name, 'error:', e.errorCode, e.errorDescription);
            cleanupWarmupWebview();
        });

        warmupTimeout = setTimeout(function() {
            console.log('[DEBUG] EXT-WARMUP - timeout for:', extInfo.name, ', forcing cleanup');
            cleanupWarmupWebview();
        }, 8000);

        warmupContainer.appendChild(webview);
    }

    warmupNext();
}

function reloadActiveTabForExtensions() {
    if (!window.getCurrentTab) return;
    var ct = window.getCurrentTab();
    if (!ct || ct.isHome || !ct.webview) {
        console.log('[DEBUG] EXT-WARMUP-RELOAD - no active webview tab to reload');
        return;
    }
    try {
        var url = ct.webview.getURL();
        if (url && url !== 'about:blank' && !url.startsWith('chrome-extension://')) {
            console.log('[DEBUG] EXT-WARMUP-RELOAD - reloading active tab:', url);
            ct.webview.reload();
        } else {
            console.log('[DEBUG] EXT-WARMUP-RELOAD - skipping reload for url:', url);
        }
    } catch(e) {
        console.log('[DEBUG] EXT-WARMUP-RELOAD - reload failed:', e.message);
    }
}

function startStartupNotifyLoop() {
    if (startupNotifyTimer) {
        console.log('[DEBUG] EXT-STARTUP-LOOP - already running, skipping');
        return;
    }
    startupNotifyAttempts = 0;
    extensionsNotified = false;
    console.log('[DEBUG] EXT-STARTUP-LOOP - starting notify loop (interval:', STARTUP_NOTIFY_INTERVAL, 'ms, max:', MAX_STARTUP_NOTIFY_ATTEMPTS, 'attempts)');

    startupNotifyTimer = setInterval(function() {
        startupNotifyAttempts++;

        if (extensionsNotified || startupNotifyAttempts >= MAX_STARTUP_NOTIFY_ATTEMPTS) {
            console.log('[DEBUG] EXT-STARTUP-LOOP - stopping loop, notified:', extensionsNotified, 'attempts:', startupNotifyAttempts);
            clearInterval(startupNotifyTimer);
            startupNotifyTimer = null;

            if (extensionsNotified && !extensionsWarmedUp) {
                console.log('[DEBUG] EXT-STARTUP-LOOP - notify succeeded, starting warmup in 1s');
                setTimeout(function() {
                    warmupExtensions();
                }, 1000);
            }
            return;
        }

        if (startupNotifyAttempts % 10 === 0) {
            console.log('[DEBUG] EXT-STARTUP-LOOP - attempt', startupNotifyAttempts, '/', MAX_STARTUP_NOTIFY_ATTEMPTS, ', notified:', extensionsNotified);
        }

        notifyAllTabsToExtensions().then(function(success) {
            if (success && !extensionsNotified) {
                extensionsNotified = true;
                console.log('[DEBUG] EXT-STARTUP-LOOP - SUCCESS after', startupNotifyAttempts, 'attempts, stopping loop');
                clearInterval(startupNotifyTimer);
                startupNotifyTimer = null;

                notifyActiveTabToExtensions();

                if (!extensionsWarmedUp) {
                    console.log('[DEBUG] EXT-STARTUP-LOOP - starting warmup in 1s');
                    setTimeout(function() {
                        warmupExtensions();
                    }, 1000);
                }
            }
        });
    }, STARTUP_NOTIFY_INTERVAL);
}

async function handleExtensionClick(ext, action, btn) {
    console.log('[DEBUG] EXT-CLICK -', ext.name, '(' + ext.id + '), hasPopup:', !!action.default_popup);
    if (activePopupExtId === ext.id) {
        console.log('[DEBUG] EXT-CLICK - popup already open, closing');
        destroyPopup();
        return;
    }
    await notifyActiveTabToExtensions();
    if (action.default_popup) {
        showPopup(ext, action.default_popup, btn);
    }
}

function showPopup(ext, popupPath, anchorBtn) {
    destroyPopup();

    activePopupExtId = ext.id;
    if (anchorBtn) anchorBtn.classList.add('ext-popup-open');

    const popup = document.createElement('div');
    popup.className = 'ext-popup';
    popup.dataset.extensionId = ext.id;

    const btnRect = anchorBtn ? anchorBtn.getBoundingClientRect() : { bottom: 48, right: window.innerWidth - 8 };
    const popupW = 420;
    const popupH = 580;

    let top = btnRect.bottom + 6;
    let right = window.innerWidth - (anchorBtn ? btnRect.right : 8);

    if (top + popupH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - popupH - 8);
    if (right < 0) right = 8;

    popup.style.cssText = 'position:fixed;top:' + top + 'px;right:' + right + 'px;width:' + popupW + 'px;max-width:94vw;height:' + popupH + 'px;max-height:75vh;background:var(--bg-primary,#0d1b2e);border:1px solid var(--border-color,#1e3a5f);border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);z-index:99990;overflow:hidden;display:flex;flex-direction:column;animation:extPopIn 0.15s ease-out;';

    const manifest = ext.manifest || {};
    const optionsPage = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || null;
    const iconAction = manifest.browser_action || manifest.action || {};
    const iconUrl = resolveIconUrl(ext.id, iconAction.default_icon || manifest.icons, ext.path);

    const header = document.createElement('div');
    header.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--border-color,#1e3a5f);display:flex;align-items:center;justify-content:space-between;background:var(--bg-secondary,#0a1628);flex-shrink:0;user-select:none;';

    const titleArea = document.createElement('div');
    titleArea.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden;';

    if (iconUrl) {
        const img = document.createElement('img');
        img.src = iconUrl;
        img.style.cssText = 'width:16px;height:16px;flex-shrink:0;border-radius:3px;';
        img.onerror = function() { img.outerHTML = getDefaultSvg(16); };
        titleArea.appendChild(img);
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = ext.name;
    nameSpan.style.cssText = 'font-weight:600;font-size:13px;color:var(--text-primary,#e0e0e0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    titleArea.appendChild(nameSpan);

    const btnArea = document.createElement('div');
    btnArea.style.cssText = 'display:flex;align-items:center;gap:2px;flex-shrink:0;';

    if (optionsPage) {
        const optsBtn = mkHeaderBtn('\u2699', 'Einstellungen');
        optsBtn.addEventListener('click', function() { destroyPopup(); openOptions(ext); });
        btnArea.appendChild(optsBtn);
    }
    const closeBtn = mkHeaderBtn('\u00D7', 'Schliessen', '20px');
    closeBtn.addEventListener('click', destroyPopup);
    btnArea.appendChild(closeBtn);

    header.appendChild(titleArea);
    header.appendChild(btnArea);

    const cleanPath = popupPath.replace(/^\//, '');
    const popupUrl = 'chrome-extension://' + ext.id + '/' + cleanPath;

    console.log('[DEBUG] EXT-POPUP - creating webview for:', popupUrl);

    const webviewContainer = document.createElement('div');
    webviewContainer.style.cssText = 'flex:1;overflow:hidden;position:relative;min-height:0;';

    const webview = document.createElement('webview');
    webview.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;';
    webview.setAttribute('partition', 'persist:main');
    webview.setAttribute('allowpopups', '');
    webview.src = popupUrl;

    let hasResized = false;

    webview.addEventListener('dom-ready', function() {
        console.log('[DEBUG] EXT-POPUP - dom-ready fired for:', popupUrl);

        webview.executeJavaScript(
            '(function() {' +
            '  var result = {};' +
            '  result.hasChromeRuntime = typeof chrome !== "undefined" && typeof chrome.runtime !== "undefined";' +
            '  result.hasChromeStorage = typeof chrome !== "undefined" && typeof chrome.storage !== "undefined";' +
            '  result.hasChromeI18n = typeof chrome !== "undefined" && typeof chrome.i18n !== "undefined";' +
            '  result.hasChromeExtension = typeof chrome !== "undefined" && typeof chrome.extension !== "undefined";' +
            '  result.url = location.href;' +
            '  result.bodyHTML = document.body ? document.body.innerHTML.substring(0, 200) : "NO BODY";' +
            '  result.errors = [];' +
            '  try { result.runtimeId = chrome.runtime.id; } catch(e) { result.errors.push("runtime.id: " + e.message); }' +
            '  return JSON.stringify(result);' +
            '})()'
        ).then(function(r) {
            console.log('[DEBUG] EXT-POPUP - Chrome API check:', r);
        }).catch(function(e) {
            console.log('[DEBUG] EXT-POPUP - executeJS error:', e.message);
        });

        try { webview.setZoomFactor(1.0); } catch(e) {}

        try {
            webview.insertCSS(
                'html, body { width: 100% !important; max-width: 100% !important; overflow-x: hidden !important; box-sizing: border-box !important; }' +
                '::-webkit-scrollbar { width: 6px; }' +
                '::-webkit-scrollbar-track { background: transparent; }' +
                '::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }' +
                '::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }'
            ).catch(function() {});
        } catch(e) {}

        if (!hasResized) {
            hasResized = true;
            try {
                webview.executeJavaScript(
                    '(function() {' +
                    '  var body = document.body;' +
                    '  var html = document.documentElement;' +
                    '  if (!body) return JSON.stringify({w:0,h:0});' +
                    '  var w = Math.max(body.scrollWidth, body.offsetWidth, html.scrollWidth, html.offsetWidth);' +
                    '  var h = Math.max(body.scrollHeight, body.offsetHeight, html.scrollHeight, html.offsetHeight);' +
                    '  return JSON.stringify({w:w, h:h});' +
                    '})()'
                ).then(function(result) {
                    try {
                        var size = JSON.parse(result);
                        console.log('[DEBUG] EXT-POPUP - content size:', size.w, 'x', size.h);
                        if (size.w > 0 && size.h > 0) {
                            var newW = Math.max(320, Math.min(size.w + 2, 600));
                            var newH = Math.max(200, Math.min(size.h + 2, window.innerHeight * 0.75 - 40));
                            popup.style.width = newW + 'px';

                            var headerH = header.getBoundingClientRect().height || 38;
                            var totalH = newH + headerH;
                            var maxH = window.innerHeight * 0.75;
                            popup.style.height = Math.min(totalH, maxH) + 'px';

                            var popupRect = popup.getBoundingClientRect();
                            if (popupRect.right > window.innerWidth - 4) {
                                popup.style.right = '4px';
                            }
                            if (popupRect.bottom > window.innerHeight - 4) {
                                popup.style.top = Math.max(4, window.innerHeight - popupRect.height - 4) + 'px';
                            }
                        }
                    } catch(e) {}
                }).catch(function() {});
            } catch(e) {}
        }
    });

    webview.addEventListener('did-fail-load', function(e) {
        console.log('[DEBUG] EXT-POPUP - did-fail-load:', e.errorCode, e.errorDescription, e.validatedURL);
    });

    webview.addEventListener('console-message', function(e) {
        console.log('[DEBUG] EXT-POPUP-CONSOLE]', e.message);
    });

    webview.addEventListener('new-window', function(e) {
        e.preventDefault();
        console.log('[DEBUG] EXT-POPUP - new-window requested:', e.url);
        if (window.createTab) window.createTab(e.url);
        destroyPopup();
    });

    webviewContainer.appendChild(webview);
    popup.appendChild(header);
    popup.appendChild(webviewContainer);
    document.body.appendChild(popup);
    activePopup = popup;

    setTimeout(function() {
        var handler = function(e) {
            if (activePopup && !activePopup.contains(e.target) && (!anchorBtn || !anchorBtn.contains(e.target))) {
                destroyPopup();
            }
        };
        activeCloseListener = handler;
        document.addEventListener('mousedown', handler, true);
    }, 300);
}

function destroyPopup() {
    if (activeCloseListener) {
        document.removeEventListener('mousedown', activeCloseListener, true);
        activeCloseListener = null;
    }

    if (activePopupExtId) {
        console.log('[DEBUG] EXT-POPUP - destroying popup for:', activePopupExtId);
        var btn = document.querySelector('.ext-action-btn[data-extension-id="' + activePopupExtId + '"]');
        if (btn) btn.classList.remove('ext-popup-open');
    }
    activePopupExtId = null;

    if (activePopup) {
        var wv = activePopup.querySelector('webview');
        if (wv) {
            try { wv.stop(); } catch(e) {}
        }
        activePopup.remove();
        activePopup = null;
    }
}

function showExtContextMenu(x, y, ext) {
    var old = document.getElementById('ext-ctx-menu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'ext-ctx-menu';
    menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;background:var(--bg-primary,#0a1628);border:1px solid var(--border-color,#1e3a5f);border-radius:8px;padding:6px 0;min-width:210px;box-shadow:0 8px 32px rgba(0,0,0,0.55);z-index:999999;font-size:13px;animation:extCtxIn 0.1s ease-out;';

    var manifest = ext.manifest || {};
    var optionsPage = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page || null;

    var items = [
        { label: '\u2699 Einstellungen', disabled: !optionsPage, action: function() { openOptions(ext); } },
        { separator: true },
        {
            label: '\uD83D\uDDD1 Deinstallieren',
            action: function() {
                if (confirm('"' + ext.name + '" wirklich deinstallieren?')) {
                    if (window.uninstallExtension) window.uninstallExtension(ext.id);
                    else ipcRenderer.invoke('uninstall-extension', ext.id).then(function() { loadExtensionButtons(); });
                }
            }
        }
    ];

    items.forEach(function(item) {
        if (item.separator) {
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:var(--border-color,#1e3a5f);margin:4px 8px;';
            menu.appendChild(sep);
            return;
        }
        var el = document.createElement('div');
        el.style.cssText = 'padding:9px 16px;cursor:' + (item.disabled ? 'default' : 'pointer') + ';color:' + (item.disabled ? 'var(--text-secondary,#888)' : 'var(--text-primary,#e0e0e0)') + ';opacity:' + (item.disabled ? '0.45' : '1') + ';transition:background 0.12s;user-select:none;';
        el.textContent = item.label;
        if (!item.disabled) {
            el.addEventListener('mouseenter', function() { el.style.background = 'var(--primary-color,#1e90ff)'; el.style.color = '#fff'; });
            el.addEventListener('mouseleave', function() { el.style.background = ''; el.style.color = 'var(--text-primary,#e0e0e0)'; });
            el.addEventListener('click', function() { menu.remove(); item.action(); });
        }
        menu.appendChild(el);
    });

    document.body.appendChild(menu);

    var rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (y + rect.height > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

    var closeMenu = function(e) {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('mousedown', closeMenu, true);
        }
    };
    setTimeout(function() { document.addEventListener('mousedown', closeMenu, true); }, 50);
}

function openOptions(ext) {
    var manifest = ext.manifest || {};
    var optionsPage = (manifest.options_ui && manifest.options_ui.page) || manifest.options_page;
    if (!optionsPage) return;
    var url = 'chrome-extension://' + ext.id + '/' + optionsPage.replace(/^\//, '');
    console.log('[DEBUG] EXT-OPTIONS - opening options for:', ext.name, 'url:', url);
    if (window.createTab) window.createTab(url);
    else ipcRenderer.send('extension-open-options', url);
}

function mkHeaderBtn(label, title, fontSize) {
    var btn = document.createElement('button');
    btn.title = title;
    btn.textContent = label;
    btn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:var(--text-secondary,#aaa);font-size:' + (fontSize || '15px') + ';width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background 0.12s;flex-shrink:0;padding:0;';
    btn.addEventListener('mouseenter', function() { btn.style.background = 'rgba(255,255,255,0.1)'; });
    btn.addEventListener('mouseleave', function() { btn.style.background = ''; });
    return btn;
}

window.closeAllExtensionPopups = destroyPopup;
window.notifyActiveTabToExtensions = notifyActiveTabToExtensions;

let _lastNotifiedWcId = null;

function autoNotifyTabChange() {
    if (!window.getCurrentTab) return;
    var ct = window.getCurrentTab();
    if (!ct || ct.isHome || !ct.webview) {
        _lastNotifiedWcId = null;
        return;
    }
    try {
        var wcId = ct.webview.getWebContentsId();
        if (wcId && wcId !== _lastNotifiedWcId) {
            _lastNotifiedWcId = wcId;
            console.log('[DEBUG] EXT-AUTO-NOTIFY - tab changed, notifying wcId:', wcId);
            ipcRenderer.invoke('select-tab', wcId).catch(function() {});
        }
    } catch(e) {}
}

function setupWebviewAutoNotify() {
    console.log('[DEBUG] EXT-AUTO-NOTIFY - setting up MutationObserver for webview tracking');
    var tabContainer = document.getElementById('webview-container') || document.getElementById('tab-content') || document.body;

    var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var mutation = mutations[i];
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(function(node) {
                    if (node.tagName === 'WEBVIEW') {
                        attachWebviewListeners(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('webview').forEach(function(wv) {
                            attachWebviewListeners(wv);
                        });
                    }
                });
            }
            if (mutation.type === 'attributes') {
                if (mutation.target.tagName === 'WEBVIEW' || (mutation.target.classList && mutation.target.classList.contains('tab'))) {
                    autoNotifyTabChange();
                }
            }
        }
    });

    observer.observe(tabContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'src']
    });

    var existingWebviews = document.querySelectorAll('webview');
    console.log('[DEBUG] EXT-AUTO-NOTIFY - attaching to', existingWebviews.length, 'existing webviews');
    existingWebviews.forEach(function(wv) {
        attachWebviewListeners(wv);
    });
}

var _attachedWebviews = new WeakSet();

function attachWebviewListeners(webview) {
    if (_attachedWebviews.has(webview)) return;
    _attachedWebviews.add(webview);

    var srcUrl = '';
    try { srcUrl = webview.src || webview.getAttribute('src') || ''; } catch(e) {}
    console.log('[DEBUG] EXT-WEBVIEW-ATTACH - attaching listeners to webview, src:', srcUrl);

    webview.addEventListener('did-finish-load', function() {
        var url = '';
        try { url = webview.getURL(); } catch(e) {}
        if (url.startsWith('chrome-extension://')) return;
        console.log('[DEBUG] EXT-WEBVIEW - did-finish-load:', url, 'extensionsNotified:', extensionsNotified);
        autoNotifyTabChange();

        if (!extensionsNotified) {
            try {
                var wcId = webview.getWebContentsId();
                if (wcId) {
                    console.log('[DEBUG] EXT-WEBVIEW - first-load notify attempt, wcId:', wcId);
                    ipcRenderer.invoke('select-tab', wcId).then(function() {
                        extensionsNotified = true;
                        console.log('[DEBUG] EXT-WEBVIEW - first-load notify SUCCESS');
                    }).catch(function(e) {
                        console.log('[DEBUG] EXT-WEBVIEW - first-load notify FAILED:', e.message);
                    });
                }
            } catch(e) {
                console.log('[DEBUG] EXT-WEBVIEW - first-load getWebContentsId failed:', e.message);
            }
        }
    });

    webview.addEventListener('did-navigate', function() {
        var url = '';
        try { url = webview.getURL(); } catch(e) {}
        if (url.startsWith('chrome-extension://')) return;
        autoNotifyTabChange();
    });

    webview.addEventListener('did-start-loading', function() {
        autoNotifyTabChange();
    });

    webview.addEventListener('focus', function() {
        autoNotifyTabChange();
    });

    webview.addEventListener('dom-ready', function() {
        var url = '';
        try { url = webview.getURL(); } catch(e) {}
        if (url.startsWith('chrome-extension://')) return;

        if (!extensionsNotified) {
            try {
                var wcId = webview.getWebContentsId();
                if (wcId) {
                    console.log('[DEBUG] EXT-WEBVIEW - dom-ready notify attempt, wcId:', wcId, 'url:', url);
                    ipcRenderer.invoke('select-tab', wcId).then(function() {
                        extensionsNotified = true;
                        console.log('[DEBUG] EXT-WEBVIEW - dom-ready notify SUCCESS');
                    }).catch(function(e) {
                        console.log('[DEBUG] EXT-WEBVIEW - dom-ready notify FAILED:', e.message);
                    });
                }
            } catch(e) {}
        }
    });
}

ipcRenderer.on('extensions-updated', function() {
    console.log('[DEBUG] EXT-HANDLER - extensions-updated event received');
    destroyPopup();
    extensionsNotified = false;
    extensionsWarmedUp = false;
    setTimeout(function() {
        loadExtensionButtons().then(function() {
            console.log('[DEBUG] EXT-HANDLER - buttons reloaded after update, restarting notify loop');
            startStartupNotifyLoop();
        });
    }, 500);
});

ipcRenderer.on('extension-open-options', function(event, url) {
    console.log('[DEBUG] EXT-HANDLER - extension-open-options IPC:', url);
    if (window.createTab) window.createTab(url);
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && activePopup) destroyPopup();
});

document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        console.log('[DEBUG] EXT-HANDLER - visibility changed to visible, re-notifying');
        setTimeout(autoNotifyTabChange, 200);
    }
});

var extStyle = document.createElement('style');
extStyle.textContent = '@keyframes extPopIn{from{opacity:0;transform:translateY(-6px) scale(0.98);}to{opacity:1;transform:translateY(0) scale(1);}}' +
    '@keyframes extCtxIn{from{opacity:0;transform:scale(0.95);}to{opacity:1;transform:scale(1);}}' +
    '.ext-action-btn{width:30px;height:30px;padding:4px;background:transparent;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,transform 0.1s;position:relative;flex-shrink:0;}' +
    '.ext-action-btn:hover{background:var(--bg-secondary,rgba(255,255,255,0.08))!important;}' +
    '.ext-action-btn:active{transform:scale(0.88);}' +
    '.ext-action-btn.ext-popup-open{background:var(--bg-secondary,rgba(255,255,255,0.08))!important;outline:2px solid var(--primary-color,#1e90ff);outline-offset:-1px;border-radius:6px;}' +
    '#extension-bar{display:flex;align-items:center;gap:2px;}';
document.head.appendChild(extStyle);

function startExtensionHandler() {
    console.log('[DEBUG] EXT-HANDLER-1 - startExtensionHandler called');
    initExtensionBar();
    console.log('[DEBUG] EXT-HANDLER-2 - bar initialized');

    loadExtensionButtons().then(function() {
        console.log('[DEBUG] EXT-HANDLER-3 - buttons loaded');

        setTimeout(function() {
            setupWebviewAutoNotify();
            console.log('[DEBUG] EXT-HANDLER-4 - webview auto-notify setup done, starting startup loop');
            startStartupNotifyLoop();
        }, 300);

        var bar = document.getElementById('extension-bar');
        if (!bar || bar.children.length === 0) {
            console.log('[DEBUG] EXT-HANDLER-5 - no buttons rendered, scheduling retry');
            setTimeout(function() {
                loadExtensionButtons().then(function() {
                    console.log('[DEBUG] EXT-HANDLER-6 - retry buttons loaded');
                    var bar2 = document.getElementById('extension-bar');
                    if (!bar2 || bar2.children.length === 0) {
                        console.log('[DEBUG] EXT-HANDLER-7 - still no buttons, final retry in 3s');
                        setTimeout(function() { loadExtensionButtons(); }, 3000);
                    }
                });
            }, 2000);
        }
    }).catch(function(err) {
        console.log('[DEBUG] EXT-HANDLER-ERR:', err.message);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[DEBUG] EXT-HANDLER-0 - DOMContentLoaded, starting in 1.5s');
        setTimeout(startExtensionHandler, 1500);
    });
} else {
    console.log('[DEBUG] EXT-HANDLER-0 - DOM already ready, starting in 1.5s');
    setTimeout(startExtensionHandler, 1500);
}

module.exports = { initExtensionBar, loadExtensionButtons, destroyPopup, notifyActiveTabToExtensions };