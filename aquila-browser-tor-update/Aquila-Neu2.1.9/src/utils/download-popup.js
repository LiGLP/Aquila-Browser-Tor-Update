let activePopups = {};
let styleInjected = false;

function init() {
    ipcRenderer.on('download-started', (event, dlInfo) => { show(dlInfo); });
    ipcRenderer.on('download-progress', (event, data) => { update(data); });
    ipcRenderer.on('download-done', (event, data) => { finish(data); });
}

function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var s = document.createElement('style');
    s.textContent =
        '.dl-popup{position:fixed;bottom:20px;right:20px;background:var(--bg-primary,#0a1628);border:1px solid var(--border-color,#1e3a5f);border-radius:12px;padding:16px;min-width:320px;max-width:400px;z-index:10002;box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:ctxFadeIn 0.15s ease-out;display:flex;flex-direction:column;gap:10px;}' +
        '.dl-popup-header{display:flex;align-items:center;gap:10px;}' +
        '.dl-popup-icon{width:32px;height:32px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:rgba(59,130,246,0.15);border-radius:8px;}' +
        '.dl-popup-icon svg{width:18px;height:18px;fill:#3b82f6;}' +
        '.dl-popup-icon.done svg{fill:#10b981;}' +
        '.dl-popup-icon.done{background:rgba(16,185,129,0.15);}' +
        '.dl-popup-info{flex:1;min-width:0;}' +
        '.dl-popup-name{font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.dl-popup-status{font-size:11px;color:var(--text-secondary);margin-top:2px;}' +
        '.dl-popup-progress{height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;}' +
        '.dl-popup-progress-bar{height:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:2px;transition:width 0.3s;}' +
        '.dl-popup-actions{display:flex;gap:8px;}' +
        '.dl-popup-btn{flex:1;padding:8px 12px;border:1px solid var(--border-color,#1e3a5f);border-radius:8px;background:rgba(255,255,255,0.05);color:var(--text-primary);cursor:pointer;font-size:12px;font-weight:600;transition:background 0.15s;display:flex;align-items:center;justify-content:center;gap:6px;}' +
        '.dl-popup-btn:hover{background:rgba(255,255,255,0.1);}' +
        '.dl-popup-btn.primary{background:rgba(59,130,246,0.2);border-color:rgba(59,130,246,0.4);}' +
        '.dl-popup-btn.primary:hover{background:rgba(59,130,246,0.35);}' +
        '.dl-popup-close{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;border:none;color:var(--text-secondary);transition:background 0.15s;}' +
        '.dl-popup-close:hover{background:rgba(255,255,255,0.1);}';
    document.head.appendChild(s);
}

function show(dlInfo) {
    injectStyle();
    var existing = document.getElementById('dl-popup-' + dlInfo.id);
    if (existing) existing.remove();

    var popup = document.createElement('div');
    popup.className = 'dl-popup';
    popup.id = 'dl-popup-' + dlInfo.id;
    popup.style.position = 'relative';
    popup.innerHTML =
        '<button class="dl-popup-close" onclick="this.parentElement.remove()"><svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg></button>' +
        '<div class="dl-popup-header">' +
            '<div class="dl-popup-icon"><svg viewBox="0 0 24 24"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg></div>' +
            '<div class="dl-popup-info">' +
                '<div class="dl-popup-name">' + dlInfo.filename + '</div>' +
                '<div class="dl-popup-status" id="dl-status-' + dlInfo.id + '">Download gestartet...</div>' +
            '</div>' +
        '</div>' +
        '<div class="dl-popup-progress"><div class="dl-popup-progress-bar" id="dl-bar-' + dlInfo.id + '" style="width:0%;"></div></div>';
    document.body.appendChild(popup);
    activePopups[dlInfo.id] = { savePath: dlInfo.savePath, filename: dlInfo.filename };
}

function update(data) {
    var bar = document.getElementById('dl-bar-' + data.id);
    var status = document.getElementById('dl-status-' + data.id);
    if (bar) bar.style.width = data.percent + '%';
    if (status) {
        var speedMB = (data.speed / (1024 * 1024)).toFixed(1);
        var receivedMB = (data.receivedBytes / (1024 * 1024)).toFixed(1);
        var totalMB = data.totalBytes > 0 ? (data.totalBytes / (1024 * 1024)).toFixed(1) : '?';
        status.textContent = receivedMB + ' MB / ' + totalMB + ' MB (' + data.percent + '%) — ' + speedMB + ' MB/s';
    }
}

async function finish(data) {
    var popup = document.getElementById('dl-popup-' + data.id);
    if (!popup) return;
    var info = activePopups[data.id] || {};
    var savePath = data.savePath || info.savePath || '';
    var filename = data.filename || info.filename || 'Datei';

    var icon = popup.querySelector('.dl-popup-icon');
    if (icon) icon.classList.add('done');

    var progressDiv = popup.querySelector('.dl-popup-progress');
    if (progressDiv) progressDiv.remove();

    var status = document.getElementById('dl-status-' + data.id);

    if (data.state === 'completed') {
        var safetyResult = { safe: true, warnings: [] };
        try {
            safetyResult = await ipcRenderer.invoke('check-download-safety', savePath);
        } catch(e) {}

        if (!safetyResult.safe) {
            if (icon) {
                icon.classList.remove('done');
                icon.style.background = 'rgba(239,68,68,0.15)';
                icon.querySelector('svg').style.fill = '#ef4444';
            }
            if (status) {
                status.style.color = '#ef4444';
                status.textContent = '⚠ ' + safetyResult.warnings.join(', ');
            }
            var warningNote = document.createElement('div');
            warningNote.style.cssText = 'font-size:11px;color:#f59e0b;padding:6px 10px;background:rgba(245,158,11,0.1);border-radius:6px;border:1px solid rgba(245,158,11,0.2);';
            warningNote.textContent = 'Diese Datei könnte schädlich sein. Öffne sie nur, wenn du der Quelle vertraust.';
            popup.appendChild(warningNote);
        } else {
            if (status) status.textContent = 'Download abgeschlossen ✓';
        }

        var actions = document.createElement('div');
        actions.className = 'dl-popup-actions';
        actions.innerHTML =
            '<button class="dl-popup-btn primary" id="dl-open-' + data.id + '"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>Öffnen</button>' +
            '<button class="dl-popup-btn" id="dl-folder-' + data.id + '"><svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:currentColor;"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>Ordner</button>';
        popup.appendChild(actions);

        document.getElementById('dl-open-' + data.id).addEventListener('click', function() {
            ipcRenderer.invoke('open-download-file', savePath);
            popup.remove();
            delete activePopups[data.id];
        });
        document.getElementById('dl-folder-' + data.id).addEventListener('click', function() {
            ipcRenderer.invoke('show-download-in-folder', savePath);
        });
    } else {
        if (status) status.textContent = 'Download fehlgeschlagen';
        if (icon) {
            icon.classList.remove('done');
            icon.style.background = 'rgba(239,68,68,0.15)';
            icon.querySelector('svg').style.fill = '#ef4444';
        }
    }

    setTimeout(function() {
        if (popup && popup.parentNode && !popup.matches(':hover')) {
            popup.style.animation = 'slideOut 0.3s ease';
            setTimeout(function() { if (popup.parentNode) popup.remove(); }, 300);
        }
    }, 15000);
}

module.exports = { init };