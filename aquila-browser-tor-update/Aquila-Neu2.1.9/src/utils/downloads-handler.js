(function() {
    const { ipcRenderer } = require('electron');

    const activeDownloads = new Map();
    const pendingAutoOpen = new Set();

    function fmtBytes(b) {
        if (!b || b <= 0) return '0 B';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(2) + ' MB';
    }

    function fmtSpeed(bps) {
        if (!bps || bps <= 0) return '0 Mbit/s';
        const m = (bps * 8) / 1e6;
        if (m >= 1000) return (m / 1000).toFixed(1) + ' Gbit/s';
        if (m < 0.1) return (m * 1000).toFixed(0) + ' Kbit/s';
        return m.toFixed(1) + ' Mbit/s';
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s || '');
        return d.innerHTML;
    }

    function faviconOf(url) {
        try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
        catch { return ''; }
    }

    function ensurePopup() {
        let pop = document.getElementById('dl-popup');
        if (pop) return pop;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes dl-slide-in {
                from { opacity: 0; transform: translateX(20px); }
                to   { opacity: 1; transform: translateX(0); }
            }
            @keyframes dl-item-in {
                from { opacity: 0; transform: translateX(8px); }
                to   { opacity: 1; transform: translateX(0); }
            }
            .dl-item-wrap { animation: dl-item-in 0.2s ease-out; }
            .dl-item-wrap[data-clickable="true"] { cursor: pointer; transition: background 0.15s; }
            .dl-item-wrap[data-clickable="true"]:hover { background: rgba(255,255,255,0.04); }
            .dl-item-wrap[data-clickable="true"]:active { background: rgba(255,255,255,0.07); }
            .dl-autoopen-hint {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-top: 5px;
                padding: 4px 8px;
                background: rgba(59,130,246,0.1);
                border-radius: 6px;
                font-size: 10px;
                color: var(--primary-color, #1e90ff);
                animation: dl-item-in 0.2s ease-out;
            }
            #dl-popup-list::-webkit-scrollbar { width: 3px; }
            #dl-popup-list::-webkit-scrollbar-track { background: transparent; }
            #dl-popup-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
        `;
        document.head.appendChild(style);

        pop = document.createElement('div');
        pop.id = 'dl-popup';
        pop.style.cssText = `
            position: fixed;
            top: 150px;
            right: 16px;
            width: 320px;
            background: var(--bg-secondary, #0d1f3c);
            border: 1px solid var(--border-color, #1e3a5f);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            z-index: 10001;
            display: none;
            overflow: hidden;
            animation: dl-slide-in 0.25s ease;
        `;

        pop.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border-color,#1e3a5f);">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:36px;height:36px;background:rgba(59,130,246,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:var(--primary-color,#1e90ff);">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                    </div>
                    <div>
                        <div id="dl-popup-title" style="font-size:13px;font-weight:700;color:var(--text-primary,#e0e0e0);">Downloads</div>
                        <div id="dl-popup-sub" style="font-size:11px;color:var(--text-secondary,#8899aa);">Wird heruntergeladen...</div>
                    </div>
                </div>
                <button id="dl-popup-close" style="background:none;border:none;cursor:pointer;color:var(--text-secondary,#8899aa);font-size:20px;line-height:1;padding:0 2px;border-radius:4px;display:flex;align-items:center;justify-content:center;transition:background 0.15s;">×</button>
            </div>
            <div id="dl-popup-list" style="max-height:280px;overflow-y:auto;"></div>
        `;

        document.body.appendChild(pop);

        document.getElementById('dl-popup-close').addEventListener('click', () => {
            pop.style.display = 'none';
        });

        return pop;
    }

    function updateSubtitle() {
        const sub = document.getElementById('dl-popup-sub');
        if (!sub) return;
        const active = Array.from(activeDownloads.values()).filter(d => d.state === 'progressing').length;
        sub.textContent = active > 0 ? `${active} aktiv` : 'Abgeschlossen';
    }

    function handleItemDblClick(dlId) {
        const dl = activeDownloads.get(dlId);
        if (!dl) return;

        if (dl.state === 'completed' && dl.savePath) {
            ipcRenderer.invoke('open-download-file', dl.savePath);
            return;
        }

        if (dl.state === 'progressing') {
            pendingAutoOpen.add(dlId);
            const hintEl = document.getElementById(`dl-hint-${dlId}`);
            if (hintEl) {
                hintEl.style.display = 'flex';
            }
            return;
        }
    }

    function buildItemEl(dl) {
        const ok  = dl.state === 'completed';
        const bad = dl.state === 'interrupted' || dl.state === 'cancelled';
        const col = ok ? '#10b981' : bad ? '#ef4444' : 'var(--primary-color,#1e90ff)';
        const pct = ok ? 100 : (dl.percent || 0);
        const hasPendingOpen = pendingAutoOpen.has(dl.id);

        const wrap = document.createElement('div');
        wrap.className = 'dl-item-wrap';
        wrap.id = `dl-item-${dl.id}`;
        wrap.setAttribute('data-clickable', 'true');
        wrap.style.cssText = 'padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);';

        wrap.addEventListener('dblclick', () => handleItemDblClick(dl.id));

        wrap.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;">
                <div style="width:28px;height:28px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
                    ${dl.favicon
                        ? `<img src="${dl.favicon}" style="width:20px;height:20px;border-radius:3px;" onerror="this.style.display='none'">`
                        : `<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:var(--text-secondary,#8899aa);"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>`
                    }
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:12px;font-weight:600;color:var(--text-primary,#e0e0e0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(dl.filename)}">${esc(dl.filename)}</div>
                    <div style="font-size:11px;color:var(--text-secondary,#8899aa);margin-top:2px;">
                        ${ok
                            ? `<span style="color:#10b981;">✓ Fertig · ${fmtBytes(dl.totalBytes)}</span>`
                            : bad
                                ? `<span style="color:#ef4444;">✗ ${dl.state === 'cancelled' ? 'Abgebrochen' : 'Fehlgeschlagen'}</span>`
                                : `<span id="dl-info-${dl.id}">${fmtBytes(dl.receivedBytes)}${dl.totalBytes > 0 ? ' / ' + fmtBytes(dl.totalBytes) : ''} · ${fmtSpeed(dl.speed)}</span>`
                        }
                    </div>
                </div>
                <span id="dl-pct-${dl.id}" style="font-size:12px;font-weight:700;color:${col};flex-shrink:0;">${pct}%</span>
            </div>
            <div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
                <div id="dl-bar-${dl.id}" style="height:100%;width:${pct}%;background:${col};border-radius:2px;transition:width 0.3s ease;"></div>
            </div>
            <div id="dl-hint-${dl.id}" class="dl-autoopen-hint" style="display:${hasPendingOpen && !ok ? 'flex' : 'none'};">
                <svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:currentColor;flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-5 5 5h-4v4h-2z"/></svg>
                Wird nach Abschluss automatisch geöffnet
            </div>
        `;

        return wrap;
    }

    function refreshPopup() {
        const pop = ensurePopup();
        const list = document.getElementById('dl-popup-list');
        if (!list) return;

        if (activeDownloads.size === 0) {
            pop.style.display = 'none';
            return;
        }

        pop.style.display = 'block';
        list.innerHTML = '';
        activeDownloads.forEach(dl => list.appendChild(buildItemEl(dl)));
        updateSubtitle();
    }

    function syncBadge() {
        const btn = document.getElementById('downloads-btn');
        if (!btn) return;
        const n = Array.from(activeDownloads.values()).filter(d => d.state === 'progressing').length;
        let badge = document.getElementById('dl-btn-badge');
        if (n > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.id = 'dl-btn-badge';
                badge.style.cssText = `
                    position:absolute;top:1px;right:1px;
                    background:var(--primary-color,#1e90ff);
                    color:white;font-size:9px;font-weight:700;
                    border-radius:50%;min-width:14px;height:14px;
                    display:flex;align-items:center;justify-content:center;
                    pointer-events:none;padding:0 2px;
                `;
                btn.style.position = 'relative';
                btn.appendChild(badge);
            }
            badge.textContent = n;
        } else if (badge) {
            badge.remove();
        }
    }

    function showSafetyWarning(data) {
        let overlay = document.getElementById('dl-safety-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'dl-safety-overlay';
        overlay.style.cssText = `
            position:fixed;top:0;left:0;right:0;bottom:0;
            background:rgba(0,0,0,0.6);
            z-index:10100;
            display:flex;align-items:center;justify-content:center;
            animation: dl-item-in 0.15s ease-out;
        `;

        const warningItems = data.warnings.map(w => `
            <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;">
                <svg viewBox="0 0 24 24" fill="none" style="width:16px;height:16px;flex-shrink:0;margin-top:1px;">
                    <path d="M12 3 L22 19.5 L2 19.5 Z" stroke="#f59e0b" stroke-width="1.5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
                    <path d="M12 10 L12 14" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="12" cy="17" r="1" fill="#f59e0b"/>
                </svg>
                <span style="font-size:12px;color:var(--text-primary,#e0e0e0);">${esc(w)}</span>
            </div>
        `).join('');

        overlay.innerHTML = `
            <div style="
                width:380px;
                background:var(--bg-secondary, #0d1f3c);
                border:1px solid rgba(239,68,68,0.4);
                border-radius:16px;
                box-shadow:0 12px 48px rgba(0,0,0,0.6);
                overflow:hidden;
                animation: dl-slide-in 0.2s ease-out;
            ">
                <div style="padding:20px 20px 0 20px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                        <div style="width:42px;height:42px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg viewBox="0 0 120 120" fill="none" style="width:42px;height:42px;filter:drop-shadow(0 0 12px rgba(239,68,68,0.3));">
                                <circle cx="60" cy="60" r="55" stroke="#ef4444" stroke-width="3" fill="none"/>
                                <circle cx="60" cy="60" r="45" stroke="#ef4444" stroke-width="2" opacity="0.3" fill="none"/>
                                <path d="M60 35 L60 70" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>
                                <circle cx="60" cy="82" r="3" fill="#ef4444"/>
                            </svg>
                        </div>
                        <div>
                            <div style="font-size:15px;font-weight:700;color:#ef4444;">Sicherheitswarnung</div>
                            <div style="font-size:11px;color:var(--text-secondary,#8899aa);margin-top:2px;">Potenziell gefährliche Datei erkannt</div>
                        </div>
                    </div>
                    <div style="
                        background:rgba(0,0,0,0.2);
                        border-radius:10px;
                        padding:10px 12px;
                        margin-bottom:14px;
                        display:flex;align-items:center;gap:10px;
                    ">
                        <svg viewBox="0 0 24 24" fill="none" style="width:20px;height:20px;flex-shrink:0;">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="var(--text-secondary,#8899aa)" stroke-width="1.5" stroke-linejoin="round"/>
                            <path d="M14 2v6h6" stroke="var(--text-secondary,#8899aa)" stroke-width="1.5" stroke-linejoin="round"/>
                        </svg>
                        <div style="min-width:0;">
                            <div style="font-size:12px;font-weight:600;color:var(--text-primary,#e0e0e0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(data.filename)}">${esc(data.filename)}</div>
                            <div style="font-size:10px;color:var(--text-secondary,#8899aa);margin-top:1px;">${esc(data.extension.toUpperCase())} Datei</div>
                        </div>
                    </div>
                    <div style="margin-bottom:16px;">
                        ${warningItems}
                    </div>
                </div>
                <div style="display:flex;gap:10px;padding:0 20px 20px 20px;">
                    <button id="dl-safety-cancel" style="
                        flex:1;padding:10px 0;border:1px solid var(--border-color,#1e3a5f);
                        background:transparent;color:var(--text-primary,#e0e0e0);
                        border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;
                        transition:background 0.15s;
                    ">Abbrechen</button>
                    <button id="dl-safety-allow" style="
                        flex:1;padding:10px 0;border:none;
                        background:rgba(239,68,68,0.2);color:#ef4444;
                        border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;
                        transition:background 0.15s;
                    ">Trotzdem herunterladen</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                ipcRenderer.send('download-safety-response', { id: data.id, allow: false });
                overlay.remove();
            }
        });

        document.getElementById('dl-safety-cancel').addEventListener('click', () => {
            ipcRenderer.send('download-safety-response', { id: data.id, allow: false });
            overlay.remove();
        });

        document.getElementById('dl-safety-allow').addEventListener('click', () => {
            ipcRenderer.send('download-safety-response', { id: data.id, allow: true });
            overlay.remove();
        });

        document.getElementById('dl-safety-cancel').addEventListener('mouseenter', function() { this.style.background = 'rgba(255,255,255,0.05)'; });
        document.getElementById('dl-safety-cancel').addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
        document.getElementById('dl-safety-allow').addEventListener('mouseenter', function() { this.style.background = 'rgba(239,68,68,0.35)'; });
        document.getElementById('dl-safety-allow').addEventListener('mouseleave', function() { this.style.background = 'rgba(239,68,68,0.2)'; });
    }

    ipcRenderer.on('download-safety-warning', (event, data) => {
        showSafetyWarning(data);
    });

    ipcRenderer.on('download-started', (event, dl) => {
        dl.favicon = faviconOf(dl.url || '');
        activeDownloads.set(dl.id, dl);
        refreshPopup();
        syncBadge();
    });

    ipcRenderer.on('download-progress', (event, data) => {
        const dl = activeDownloads.get(data.id);
        if (!dl) return;
        Object.assign(dl, data);

        const infoEl = document.getElementById(`dl-info-${data.id}`);
        const pctEl  = document.getElementById(`dl-pct-${data.id}`);
        const barEl  = document.getElementById(`dl-bar-${data.id}`);

        if (infoEl) infoEl.textContent = `${fmtBytes(data.receivedBytes)}${data.totalBytes > 0 ? ' / ' + fmtBytes(data.totalBytes) : ''} · ${fmtSpeed(data.speed)}`;
        if (pctEl)  pctEl.textContent  = data.percent + '%';
        if (barEl)  barEl.style.width  = data.percent + '%';

        updateSubtitle();
        syncBadge();
    });

    ipcRenderer.on('download-done', (event, data) => {
        const dl = activeDownloads.get(data.id);
        if (!dl) return;
        dl.state = data.state;
        if (data.state === 'completed') {
            dl.percent       = 100;
            dl.totalBytes    = data.totalBytes || dl.totalBytes;
            dl.receivedBytes = dl.totalBytes;
        }
        refreshPopup();
        syncBadge();

        if (data.state === 'completed' && pendingAutoOpen.has(data.id) && dl.savePath) {
            pendingAutoOpen.delete(data.id);
            ipcRenderer.invoke('open-download-file', dl.savePath);
        } else {
            pendingAutoOpen.delete(data.id);
        }

        setTimeout(() => {
            activeDownloads.delete(data.id);
            if (activeDownloads.size === 0) {
                const pop = document.getElementById('dl-popup');
                if (pop) pop.style.display = 'none';
            } else {
                refreshPopup();
            }
            syncBadge();
        }, data.state === 'completed' ? 5000 : 8000);
    });

})();