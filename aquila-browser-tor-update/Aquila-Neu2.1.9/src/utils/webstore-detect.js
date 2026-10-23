function extractExtensionIdFromUrl(url) {
    if (!url) return null;
    var match = url.match(/chromewebstore\.google\.com\/detail\/[^\/]*\/([a-z]{32})/);
    if (match) return match[1];
    var oldMatch = url.match(/chrome\.google\.com\/webstore\/detail\/[^\/]*\/([a-z]{32})/);
    if (oldMatch) return oldMatch[1];
    return null;
}

function showWebStoreInstallButton(extensionId, extensionName) {
    hideWebStoreInstallButton();
    var addressBar = document.querySelector('.address-bar');
    if (!addressBar) return;

    var btn = document.createElement('button');
    btn.id = 'webstore-install-btn';
    btn.dataset.extId = extensionId;
    btn.innerHTML = '<svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:white;"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span>Zu Aquila hinzufügen</span>';
    btn.title = (extensionName || 'Extension') + ' installieren';

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = btn.dataset.extId;
        btn.querySelector('span').textContent = 'Installiere...';
        btn.disabled = true;
        btn.style.opacity = '0.7';

        ipcRenderer.invoke('install-extension', id).then(function(result) {
            if (result.success) {
                btn.querySelector('span').textContent = '✓ Installiert';
                btn.style.background = 'rgba(34,197,94,0.9)';
                if (window.showNotification) window.showNotification('Extension installiert!', 'success');
                setTimeout(function() { hideWebStoreInstallButton(); }, 3000);
            } else {
                btn.querySelector('span').textContent = 'Fehler';
                btn.style.background = 'rgba(239,68,68,0.9)';
                if (window.showNotification) window.showNotification('Fehler: ' + (result.error || 'Installation fehlgeschlagen'), 'error');
                setTimeout(function() {
                    btn.querySelector('span').textContent = 'Zu Aquila hinzufügen';
                    btn.style.background = '';
                    btn.disabled = false;
                    btn.style.opacity = '';
                }, 3000);
            }
        });
    });

    addressBar.appendChild(btn);
}

function hideWebStoreInstallButton() {
    var existing = document.getElementById('webstore-install-btn');
    if (existing) existing.remove();
}

function checkWebStoreUrl(url) {
    if (!url) { hideWebStoreInstallButton(); return; }
    var extId = extractExtensionIdFromUrl(url);
    if (extId) {
        var parts = url.split('/detail/');
        var name = '';
        if (parts[1]) {
            name = parts[1].split('/')[0].replace(/-/g, ' ');
            name = name.charAt(0).toUpperCase() + name.slice(1);
        }
        showWebStoreInstallButton(extId, name);
    } else {
        hideWebStoreInstallButton();
    }
}

(function() {
    var style = document.createElement('style');
    style.textContent =
        '#webstore-install-btn{display:flex;align-items:center;gap:6px;padding:5px 14px;background:var(--primary-color,#1e90ff);border:none;border-radius:6px;color:white;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all 0.15s;margin-left:8px;animation:wsInstallIn 0.2s ease-out;}' +
        '#webstore-install-btn:hover{filter:brightness(1.15);transform:scale(1.02);}' +
        '@keyframes wsInstallIn{from{opacity:0;transform:scale(0.9);}to{opacity:1;transform:scale(1);}}' +
        '.chrome-ext-rec-item{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--bg-primary,#0a1628);border:1px solid var(--border-color,#1e3a5f);border-radius:10px;margin-bottom:8px;transition:border-color 0.15s;}' +
        '.chrome-ext-rec-item:hover{border-color:rgba(255,255,255,0.1);}' +
        '.chrome-ext-rec-icon{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,rgba(30,144,255,0.15),rgba(30,144,255,0.05));display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}' +
        '.chrome-ext-rec-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}' +
        '.chrome-ext-rec-name{font-size:13px;font-weight:600;color:var(--text-primary,#e0e0e0);}' +
        '.chrome-ext-rec-desc{font-size:11px;color:var(--text-secondary,#6b8cae);}' +
        '.chrome-ext-rec-btn{padding:6px 16px;background:var(--primary-color,#1e90ff);border:none;border-radius:6px;color:white;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all 0.15s;}' +
        '.chrome-ext-rec-btn:hover{filter:brightness(1.15);}' +
        '.chrome-ext-rec-btn.installed{background:rgba(34,197,94,0.2);color:#22c55e;cursor:default;}' +
        '.chrome-ext-rec-btn:disabled{opacity:0.6;cursor:wait;}' +
        '.chrome-ext-section{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent;}' +
        '.chrome-ext-section::-webkit-scrollbar{width:6px;}' +
        '.chrome-ext-section::-webkit-scrollbar-track{background:transparent;}' +
        '.chrome-ext-section::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px;}' +
        '.store-panel.active{display:block;height:100%;overflow-y:auto;}' +
        '.store-panel+.store-panel+.store-panel+.addon-detail-overlay{z-index:10;}' +
        '#extensions-modal .modal-content>div:last-child{display:flex;flex-direction:column;}' +
        '@media (max-height:700px){' +
            '.chrome-ext-install-box{padding:12px!important;}' +
            '.chrome-ext-install-box h3{font-size:13px!important;margin-bottom:4px!important;}' +
            '.chrome-ext-install-box p{font-size:11px!important;margin-bottom:8px!important;}' +
            '.chrome-ext-rec-item{padding:8px 10px!important;gap:8px!important;}' +
            '.chrome-ext-rec-icon{width:32px!important;height:32px!important;}' +
            '.chrome-ext-rec-icon img{width:20px!important;height:20px!important;}' +
            '.chrome-ext-rec-name{font-size:12px!important;}' +
            '.chrome-ext-rec-desc{font-size:10px!important;}' +
            '.chrome-ext-rec-btn{padding:4px 12px!important;font-size:10px!important;}' +
            '.chrome-ext-form input{padding:7px 10px!important;font-size:12px!important;}' +
            '.chrome-ext-form button{padding:7px 14px!important;font-size:12px!important;}' +
        '}';
    document.head.appendChild(style);
})();

var _origUpdateNavState = window.updateNavigationState;
window.updateNavigationState = function() {
    if (_origUpdateNavState) _origUpdateNavState();
    var activeTab = window.getCurrentTab ? window.getCurrentTab() : null;
    if (activeTab && activeTab.url) {
        checkWebStoreUrl(activeTab.url);
    } else {
        hideWebStoreInstallButton();
    }
};