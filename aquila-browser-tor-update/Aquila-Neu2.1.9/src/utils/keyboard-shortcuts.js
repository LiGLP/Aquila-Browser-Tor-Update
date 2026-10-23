let ctx = null;

function init(context) {
    ctx = context;

    document.addEventListener('keydown', (e) => {
        const activeTab = ctx.getCurrentTab();
        const key = e.key.toLowerCase();

        if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && key === 'i')) {
            e.preventDefault();
            if (activeTab && activeTab.webview) activeTab.webview.openDevTools();
            return;
        }

        if (e.key === 'F11') {
            e.preventDefault();
            ipcRenderer.invoke('toggle-fullscreen');
            return;
        }

        if (e.key === 'F5' || (e.ctrlKey && key === 'r')) {
            e.preventDefault();
            if (activeTab && activeTab.webview) activeTab.webview.reload();
            else if (activeTab && activeTab.isHome) ctx.loadQuickAccess();
            return;
        }

        if (e.altKey && e.shiftKey && key === 'n') {
            e.preventDefault();
            ctx.createTorTab();
            return;
        }

        if (e.ctrlKey && key === 't') {
            e.preventDefault();
            if (activeTab && activeTab.isTor) ctx.createTorTab();
            else ctx.createTab();
            return;
        }

        if (e.ctrlKey && key === 'w') {
            e.preventDefault();
            if (activeTab) ctx.closeTab(activeTab.id);
            return;
        }

        if (e.ctrlKey && key === 'l') {
            e.preventDefault();
            const addressInput = document.getElementById('address-input');
            if (addressInput) { addressInput.focus(); addressInput.select(); }
            return;
        }

        if (e.ctrlKey && !e.shiftKey && key === 's') {
            e.preventDefault();
            if (activeTab && activeTab.webview) ipcRenderer.invoke('save-page', activeTab.webview.getWebContentsId());
            return;
        }

        if (e.ctrlKey && key === 'p') {
            e.preventDefault();
            if (activeTab && activeTab.webview) ipcRenderer.invoke('print-page', activeTab.webview.getWebContentsId());
            return;
        }

        if (e.ctrlKey && key === 'u') {
            e.preventDefault();
            if (activeTab && activeTab.webview) {
                const src = 'view-source:' + activeTab.webview.getURL();
                if (activeTab.isTor) ctx.createTorTab(src); else ctx.createTab(src);
            }
            return;
        }

        if (e.ctrlKey && e.shiftKey && key === 'c') {
            e.preventDefault();
            if (activeTab && activeTab.webview) activeTab.webview.openDevTools();
            return;
        }

        if (e.key === 'Escape') {
            ctx.hideContextMenu();
            if (ctx.getIsInHtmlFullscreen()) ipcRenderer.invoke('exit-html-fullscreen');
            return;
        }

        if (e.ctrlKey && e.key === 'Tab') {
            e.preventDefault();
            const tabs = ctx.getTabs();
            const idx = tabs.findIndex(t => t.id === ctx.getActiveTabId());
            const next = (idx + 1) % tabs.length;
            ctx.switchToTab(tabs[next].id);
            return;
        }
    });

    document.addEventListener('mouseup', (e) => {
        const activeTab = ctx.getCurrentTab();
        if (!activeTab || !activeTab.webview) return;
        if (e.button === 3) {
            e.preventDefault();
            try { if (activeTab.webview.canGoBack()) activeTab.webview.goBack(); } catch (ex) {}
        }
        if (e.button === 4) {
            e.preventDefault();
            try { if (activeTab.webview.canGoForward()) activeTab.webview.goForward(); } catch (ex) {}
        }
    });
}

module.exports = { init };