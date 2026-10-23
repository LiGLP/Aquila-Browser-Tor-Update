let splitMode = false;
let splitLeftTabId = null;
let splitRightTabId = null;
let ctx = null;

function init(context) {
    ctx = context;
    initDropZone();
    injectStyles();
}

function injectStyles() {
    const style = document.createElement('style');
    style.textContent =
        '.split-drop-overlay{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;z-index:100000;pointer-events:none;opacity:0;transition:opacity 0.15s ease;}' +
        '.split-drop-overlay.active{pointer-events:auto;opacity:1;}' +
        '.split-drop-zone{flex:1;display:flex;align-items:center;justify-content:center;border:4px dashed transparent;transition:all 0.15s;font-size:18px;font-weight:700;color:transparent;background:transparent;}' +
        '.split-drop-zone.hover{border-color:var(--primary-color,#1e90ff);background:rgba(30,144,255,0.2);color:var(--text-primary,#e0e0e0);box-shadow:inset 0 0 60px rgba(30,144,255,0.1);}' +
        '.split-view-container{display:none;width:100%;height:100%;}' +
        '.split-view-container.active{display:flex;}' +
        '.split-pane{flex:1;overflow:hidden;position:relative;}' +
        '.split-pane .tab-content{display:block!important;width:100%!important;height:100%!important;position:relative!important;}' +
        '.split-pane .tab-content webview{width:100%!important;height:100%!important;display:flex!important;}' +
        '.split-pane-focused{outline:2px solid var(--primary-color,#1e90ff);outline-offset:-2px;z-index:1;}' +
        '.split-divider{width:6px;background:var(--border-color,#1e3a5f);cursor:col-resize;transition:background 0.2s;flex-shrink:0;}' +
        '.split-divider:hover{background:var(--primary-color,#1e90ff);}' +
        '.split-exit-btn{position:absolute;top:8px;right:8px;z-index:100;background:rgba(220,38,38,0.8);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;font-size:16px;transition:all 0.2s;}' +
        '.split-exit-btn:hover{background:rgba(220,38,38,1);transform:scale(1.1);}' +
        '.tab.split-active{border-bottom:2px solid var(--primary-color,#1e90ff)!important;}' +
        '.split-tab-badge{position:absolute;top:3px;right:22px;width:14px;height:14px;background:var(--primary-color,#1e90ff);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;pointer-events:none;z-index:5;}' +
        '.split-tab-connector{display:flex;align-items:center;justify-content:center;width:18px;flex-shrink:0;pointer-events:none;opacity:0.8;}';
    document.head.appendChild(style);
}

function initDropZone() {
    const overlay = document.createElement('div');
    overlay.className = 'split-drop-overlay';
    overlay.id = 'split-drop-overlay';
    overlay.innerHTML = '<div class="split-drop-zone" id="split-zone-left">← Links</div><div class="split-drop-zone" id="split-zone-right">Rechts →</div>';
    document.body.appendChild(overlay);
}

function isActive() {
    return splitMode;
}

function isViewing() {
    if (!ctx) return false;
    return splitMode && (ctx.getActiveTabId() === splitLeftTabId || ctx.getActiveTabId() === splitRightTabId);
}

function getLeftId() {
    return splitLeftTabId;
}

function getRightId() {
    return splitRightTabId;
}

function containsTab(tabId) {
    return tabId === splitLeftTabId || tabId === splitRightTabId;
}

function showDropIndicator(show) {
    const overlay = document.getElementById('split-drop-overlay');
    if (!overlay) return;
    if (show) overlay.classList.add('active');
    else {
        overlay.classList.remove('active');
        const left = document.getElementById('split-zone-left');
        const right = document.getElementById('split-zone-right');
        if (left) left.classList.remove('hover');
        if (right) right.classList.remove('hover');
    }
}

function forceResize(tab) {
    if (!tab || !tab.webview || tab.isHome) return;
    const wv = tab.webview;
    wv.style.display = 'none';
    wv.offsetHeight;
    wv.style.display = '';
    try { wv.executeJavaScript('window.dispatchEvent(new Event("resize"))').catch(() => {}); } catch(e) {}
    setTimeout(() => { wv.style.width = '99%'; requestAnimationFrame(() => { wv.style.width = '100%'; }); }, 50);
}

function openInSplit(tabId) {
    if (!ctx) return;
    const tabs = ctx.getTabs();
    const currentTab = tabs.find(t => t.id === ctx.getActiveTabId());
    if (!currentTab || currentTab.isHome) return;
    if (currentTab.id === tabId) {
        const otherTab = tabs.find(t => t.id !== tabId && !t.isHome);
        if (otherTab) enable(tabId, otherTab.id);
    } else enable(currentTab.id, tabId);
}

function enable(leftId, rightId) {
    if (!ctx) return;
    if (splitMode) disable();
    splitMode = true;
    splitLeftTabId = leftId;
    splitRightTabId = rightId;
    ctx.setActiveTabId(leftId);

    const contentArea = document.querySelector('.content-area');
    const tabContents = document.getElementById('tab-contents');
    let splitContainer = document.getElementById('split-view-container');

    if (!splitContainer) {
        splitContainer = document.createElement('div');
        splitContainer.id = 'split-view-container';
        splitContainer.className = 'split-view-container';
        splitContainer.innerHTML = '<div class="split-pane" id="split-left" style="position:relative;"></div><div class="split-divider" id="split-divider"></div><div class="split-pane" id="split-right" style="position:relative;"></div>';
        contentArea.insertBefore(splitContainer, tabContents);
        setupDivider();
    }

    const leftTab = ctx.findTab(leftId);
    const rightTab = ctx.findTab(rightId);
    const splitLeft = document.getElementById('split-left');
    const splitRight = document.getElementById('split-right');
    splitLeft.innerHTML = '';
    splitRight.innerHTML = '';
    tabContents.style.display = 'none';
    splitContainer.classList.add('active');

    if (leftTab && leftTab.content) { splitLeft.appendChild(leftTab.content); leftTab.content.classList.add('active'); }
    if (rightTab && rightTab.content) { splitRight.appendChild(rightTab.content); rightTab.content.classList.add('active'); }

    const exitBtn = document.createElement('button');
    exitBtn.className = 'split-exit-btn';
    exitBtn.innerHTML = '✕';
    exitBtn.title = 'Split View beenden';
    exitBtn.onclick = () => disable();
    splitLeft.appendChild(exitBtn);

    splitLeft.addEventListener('mousedown', () => {
        if (splitMode && ctx.getActiveTabId() !== splitLeftTabId) {
            ctx.setActiveTabId(splitLeftTabId);
            ctx.updateActiveTab();
            ctx.updateNavigationState();
        }
    });

    splitRight.addEventListener('mousedown', () => {
        if (splitMode && ctx.getActiveTabId() !== splitRightTabId) {
            ctx.setActiveTabId(splitRightTabId);
            ctx.updateActiveTab();
            ctx.updateNavigationState();
        }
    });

    ctx.updateActiveTab();
    setTimeout(() => { forceResize(leftTab); forceResize(rightTab); }, 100);
}

function disable() {
    const wasSplit = splitMode;
    splitMode = false;

    const splitContainer = document.getElementById('split-view-container');
    const tabContents = document.getElementById('tab-contents');

    const leftTab = ctx ? ctx.findTab(splitLeftTabId) : null;
    const rightTab = ctx ? ctx.findTab(splitRightTabId) : null;

    if (leftTab && leftTab.content) tabContents.appendChild(leftTab.content);
    if (rightTab && rightTab.content) tabContents.appendChild(rightTab.content);

    if (splitContainer) splitContainer.classList.remove('active');
    tabContents.style.display = '';

    splitLeftTabId = null;
    splitRightTabId = null;

    if (ctx) ctx.updateActiveTab();
    if (wasSplit) setTimeout(() => { if (leftTab) forceResize(leftTab); if (rightTab) forceResize(rightTab); }, 50);
}

function setupDivider() {
    const divider = document.getElementById('split-divider');
    if (!divider) return;
    let isDragging = false;
    let dragOverlay = null;

    divider.addEventListener('mousedown', (e) => {
        isDragging = true;
        e.preventDefault();
        e.stopPropagation();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        dragOverlay = document.createElement('div');
        dragOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:100002;cursor:col-resize;';
        document.body.appendChild(dragOverlay);

        var leftPane = document.getElementById('split-left');
        var rightPane = document.getElementById('split-right');
        if (leftPane) leftPane.style.pointerEvents = 'none';
        if (rightPane) rightPane.style.pointerEvents = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        var container = document.getElementById('split-view-container');
        if (!container) return;
        var rect = container.getBoundingClientRect();
        var percent = ((e.clientX - rect.left) / rect.width) * 100;
        var clamped = Math.max(20, Math.min(80, percent));
        var left = document.getElementById('split-left');
        var right = document.getElementById('split-right');
        if (left) left.style.flex = '0 0 ' + clamped + '%';
        if (right) right.style.flex = '0 0 ' + (100 - clamped) + '%';
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        if (dragOverlay) {
            dragOverlay.remove();
            dragOverlay = null;
        }

        var leftPane = document.getElementById('split-left');
        var rightPane = document.getElementById('split-right');
        if (leftPane) leftPane.style.pointerEvents = '';
        if (rightPane) rightPane.style.pointerEvents = '';

        setTimeout(() => {
            if (ctx) {
                forceResize(ctx.findTab(splitLeftTabId));
                forceResize(ctx.findTab(splitRightTabId));
            }
        }, 50);
    });
}

function updateIndicators() {
    document.querySelectorAll('.split-tab-badge').forEach(el => el.remove());
    document.querySelectorAll('.split-tab-connector').forEach(el => el.remove());
    if (!splitMode || !ctx) return;

    const leftTab = ctx.findTab(splitLeftTabId);
    const rightTab = ctx.findTab(splitRightTabId);

    [leftTab, rightTab].forEach((tab) => {
        if (!tab || !tab.element) return;
        const badge = document.createElement('div');
        badge.className = 'split-tab-badge';
        badge.title = 'Split View aktiv';
        badge.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>';
        tab.element.appendChild(badge);
    });

    if (leftTab && rightTab && leftTab.element && rightTab.element) {
        const leftIdx = Array.from(leftTab.element.parentElement.children).indexOf(leftTab.element);
        const rightIdx = Array.from(rightTab.element.parentElement.children).indexOf(rightTab.element);
        if (Math.abs(leftIdx - rightIdx) === 1) {
            const firstEl = leftIdx < rightIdx ? leftTab.element : rightTab.element;
            const connector = document.createElement('div');
            connector.className = 'split-tab-connector';
            connector.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="var(--primary-color, #1e90ff)"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>';
            firstEl.after(connector);
        }
    }
}

function updatePaneFocus() {
    if (!splitMode || !ctx) return;
    const splitLeft = document.getElementById('split-left');
    const splitRight = document.getElementById('split-right');
    if (splitLeft) splitLeft.classList.toggle('split-pane-focused', ctx.getActiveTabId() === splitLeftTabId);
    if (splitRight) splitRight.classList.toggle('split-pane-focused', ctx.getActiveTabId() === splitRightTabId);
}

module.exports = {
    init,
    isActive,
    isViewing,
    getLeftId,
    getRightId,
    containsTab,
    showDropIndicator,
    forceResize,
    openInSplit,
    enable,
    disable,
    updateIndicators,
    updatePaneFocus
};