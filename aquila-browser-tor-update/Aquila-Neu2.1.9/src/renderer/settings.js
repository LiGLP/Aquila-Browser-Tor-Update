let currentSettings = null;
let performanceInterval = null;
let currentPermissions = [];
let permissionSearchQuery = '';
let permissionTypeFilter = 'all';
let isPerformancePanelVisible = false;
let perfElements = null;
let discordSiteSearchQuery = '';

const spinStyle = document.createElement('style');
spinStyle.textContent = `
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes settingPulse{
  0%{box-shadow:0 0 0 0 rgba(59,130,246,0.5);background:rgba(59,130,246,0.12);}
  60%{box-shadow:0 0 0 6px rgba(59,130,246,0);background:rgba(59,130,246,0.06);}
  100%{box-shadow:0 0 0 0 rgba(59,130,246,0);background:transparent;}
}
`;
document.head.appendChild(spinStyle);

const searchStyle = document.createElement('style');
searchStyle.textContent = `
.settings-search-wrap{padding:10px 12px 6px;position:relative;}
.settings-search-input{
  width:100%;box-sizing:border-box;
  background:var(--bg-secondary);
  border:1px solid var(--border-color);
  border-radius:8px;
  padding:7px 32px 7px 10px;
  color:var(--text-primary);
  font-size:12px;outline:none;
  transition:border-color 0.2s;
}
.settings-search-input:focus{border-color:var(--primary-color);}
.settings-search-icon{
  position:absolute;right:22px;top:50%;transform:translateY(-50%);
  width:14px;height:14px;fill:var(--text-secondary);pointer-events:none;
}
.settings-search-dropdown{
  position:fixed;
  background:var(--bg-secondary);
  border:1px solid var(--border-color);
  border-radius:10px;
  z-index:99999;
  overflow:hidden;
  box-shadow:0 12px 32px rgba(0,0,0,0.35);
  max-height:340px;
  overflow-y:auto;
}
.settings-search-result{
  display:flex;align-items:center;gap:10px;
  padding:9px 12px;cursor:pointer;
  transition:background 0.12s;
  border-bottom:1px solid rgba(255,255,255,0.04);
}
.settings-search-result:last-child{border-bottom:none;}
.settings-search-result:hover,.settings-search-result.active{background:rgba(59,130,246,0.12);}
.settings-search-result-icon{
  width:30px;height:30px;border-radius:7px;
  background:rgba(59,130,246,0.12);
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
}
.settings-search-result-icon svg{width:15px;height:15px;fill:var(--primary-color);}
.settings-search-result-info{flex:1;min-width:0;}
.settings-search-result-title{font-size:12px;color:var(--text-primary);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.settings-search-result-section{font-size:10px;color:var(--text-secondary);margin-top:1px;}
.settings-search-result-section span{
  display:inline-block;background:rgba(255,255,255,0.07);
  border-radius:4px;padding:1px 6px;
}
.settings-search-no-result{padding:18px;text-align:center;color:var(--text-secondary);font-size:12px;}
.setting-item-highlight{
  animation:settingPulse 1.8s ease forwards;
  border-radius:8px;
}
.settings-group-label{
  font-size:10px;font-weight:600;
  color:var(--text-secondary);
  text-transform:uppercase;letter-spacing:0.6px;
  padding:6px 12px 4px;
  opacity:0.6;
}
`;
document.head.appendChild(searchStyle);

const SECTION_ICONS = {
    security:    '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
    browser:     '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4v-8h16v8zm0-10H4V6h16v2z"/>',
    discord:     '<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.045.03.06a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>',
    performance: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>',
    privacy:     '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>',
    permissions: '<path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>'
};

const SETTINGS_SEARCH_INDEX = [
    { key: 'httpsOnly',            section: 'security',    sectionLabel: 'Sicherheit',    title: 'HTTPS Erzwingen',              terms: ['https','ssl','sicher','secure','verschlüsselung','encryption'] },
    { key: 'incognito',            section: 'security',    sectionLabel: 'Sicherheit',    title: 'Inkognito-Modus',              terms: ['inkognito','privat','privacy','incognito','anonym'] },
    { key: 'adBlocker',            section: 'security',    sectionLabel: 'Sicherheit',    title: 'Werbeblocker',                 terms: ['werbeblocker','adblocker','werbung','ads','blocker','aggressiv','basis'] },
    { key: 'drmEnabled',           section: 'security',    sectionLabel: 'Sicherheit',    title: 'DRM-Unterstützung',            terms: ['drm','digital rights','widevine','netflix','streaming'] },
    { key: 'language',             section: 'browser',     sectionLabel: 'Browser',       title: 'Sprache',                      terms: ['sprache','language','deutsch','english','locale'] },
    { key: 'theme',                section: 'browser',     sectionLabel: 'Browser',       title: 'Design / Theme',               terms: ['theme','design','farbe','color','aquila','dark','night','cosmic','erscheinung','aussehen'] },
    { key: 'compactTabs',          section: 'browser',     sectionLabel: 'Browser',       title: 'Kompakte Tabs',                terms: ['kompakt','tabs','schmaler','compact','tab breite'] },
    { key: 'newTabBtnInline',      section: 'browser',     sectionLabel: 'Browser',       title: 'Neuer-Tab-Button Position',    terms: ['neuer tab button','inline','tab position','new tab'] },
    { key: 'defaultBrowser',       section: 'browser',     sectionLabel: 'Browser',       title: 'Standardbrowser',              terms: ['standardbrowser','default browser','standard','protokoll'] },
    { key: 'autostart',            section: 'browser',     sectionLabel: 'Browser',       title: 'Autostart',                    terms: ['autostart','systemstart','startup','boot','automatisch starten'] },
    { key: 'sessionRestore',       section: 'browser',     sectionLabel: 'Browser',       title: 'Session wiederherstellen',     terms: ['session','tabs wiederherstellen','restore','neustart','tabs'] },
    { key: 'newWindowBehavior',    section: 'browser',     sectionLabel: 'Browser',       title: 'Neues Fenster Verhalten',      terms: ['neues fenster','popup','window','verhalten','öffnen'] },
    { key: 'disableSponsoredContent', section: 'browser',  sectionLabel: 'Browser',       title: 'Gesponserte Inhalte',          terms: ['sponsor','werbung','gesponsert','promoted','partner'] },
    { key: 'proxyEnabled',         section: 'browser',     sectionLabel: 'Browser',       title: 'Proxy',                        terms: ['proxy','vpn','server','host','port','ip','netzwerk','network'] },
    { key: 'customBackground',     section: 'browser',     sectionLabel: 'Browser',       title: 'Hintergrundbild',              terms: ['hintergrund','background','bild','wallpaper','foto','image'] },
    { key: 'loadingScreen',        section: 'browser',     sectionLabel: 'Browser',       title: 'Ladescreen',                   terms: ['ladescreen','loading','startscreen','intro','animation'] },
    { key: 'loadingSound',         section: 'browser',     sectionLabel: 'Browser',       title: 'Startsound',                   terms: ['sound','startsound','ton','audio','musik','start','ladescreen'] },
    { key: 'muteStartupSound',     section: 'browser',     sectionLabel: 'Browser',       title: 'Startsound stummschalten',     terms: ['stumm','mute','sound aus','kein ton','silent'] },
    { key: 'loadingSubtitle',      section: 'browser',     sectionLabel: 'Browser',       title: 'Ladescreen Untertitel',        terms: ['untertitel','subtitle','ladescreen text','custom text'] },
    { key: 'discordRPC',           section: 'discord',     sectionLabel: 'Discord',       title: 'Discord Rich Presence',        terms: ['discord','rpc','rich presence','status','aktivität','activity'] },
    { key: 'discordShowTab',       section: 'discord',     sectionLabel: 'Discord',       title: 'Aktuellen Tab anzeigen',       terms: ['discord tab','discord anzeigen','domain','tab anzeigen'] },
    { key: 'discordButtons',       section: 'discord',     sectionLabel: 'Discord',       title: 'Buttons anzeigen',             terms: ['discord buttons','links','url','visit','besuchen','button','visit page'] },
    { key: 'discordSiteFilter',    section: 'discord',     sectionLabel: 'Discord',       title: 'Webseiten-Filter',             terms: ['filter','webseiten','domain','whitelist','erlaubt','sites','seiten','nur bestimmte'] },
    { key: 'minimalMode',          section: 'performance', sectionLabel: 'Performance',   title: 'Minimaler Modus',              terms: ['minimal','minimal mode','einfach','reduziert','simpel'] },
    { key: 'performanceMode',      section: 'performance', sectionLabel: 'Performance',   title: 'Performance Modus',            terms: ['performance','modus','cpu','ram','limit','leistung','optimierung'] },
    { key: 'ramLimit',             section: 'performance', sectionLabel: 'Performance',   title: 'RAM-Limit',                    terms: ['ram','speicher','memory','limit','arbeitsspeicher'] },
    { key: 'cpuLimit',             section: 'performance', sectionLabel: 'Performance',   title: 'CPU-Limit',                    terms: ['cpu','prozessor','limit','auslastung','processor'] },
    { key: 'clearData',            section: 'privacy',     sectionLabel: 'Datenschutz',   title: 'Browserdaten löschen',         terms: ['daten löschen','cookies','cache','history','verlauf','bereinigen','clear'] },
    { key: 'exportData',           section: 'privacy',     sectionLabel: 'Datenschutz',   title: 'Daten exportieren',            terms: ['exportieren','backup','export','sichern','lesezeichen'] },
    { key: 'importData',           section: 'privacy',     sectionLabel: 'Datenschutz',   title: 'Daten importieren',            terms: ['importieren','import','wiederherstellen','migration','lesezeichen'] },
    { key: 'permissionsSearch',    section: 'permissions', sectionLabel: 'Berechtigungen', title: 'Berechtigungen verwalten',    terms: ['berechtigungen','permissions','kamera','mikrofon','standort','benachrichtigung','camera','microphone','geolocation','notification'] }
];

const BROWSER_STATUS_ICONS = {
    default: '<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:#10b981;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
    notDefault: '<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:var(--text-secondary);"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
    error: '<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:#ef4444;"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/></svg>',
    loading: '<svg viewBox="0 0 24 24" style="width:24px;height:24px;fill:#3b82f6;animation:spin 1s linear infinite;"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>'
};

let searchDropdownEl = null;
let searchActiveIndex = -1;
let searchCurrentResults = [];

function initSettingsSearch() {
    const firstNavBtn = document.querySelector('.settings-nav-btn');
    if (!firstNavBtn || document.getElementById('settings-search-input')) return;

    const navContainer = firstNavBtn.parentElement;

    const wrap = document.createElement('div');
    wrap.className = 'settings-search-wrap';
    wrap.innerHTML = `
        <div style="position:relative;">
            <input
                type="text"
                id="settings-search-input"
                class="settings-search-input"
                placeholder="${window.t('settings.search_placeholder')}"
                autocomplete="off"
            >
            <svg class="settings-search-icon" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
        </div>
    `;

    navContainer.insertBefore(wrap, firstNavBtn);

    searchDropdownEl = document.createElement('div');
    searchDropdownEl.className = 'settings-search-dropdown';
    searchDropdownEl.id = 'settings-search-dropdown';
    searchDropdownEl.style.display = 'none';
    document.body.appendChild(searchDropdownEl);

    const input = document.getElementById('settings-search-input');

    input.addEventListener('input', () => {
        searchActiveIndex = -1;
        handleSettingsSearch(input);
    });

    input.addEventListener('keydown', (e) => {
        if (searchDropdownEl.style.display === 'none') return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            searchActiveIndex = Math.min(searchActiveIndex + 1, searchCurrentResults.length - 1);
            renderSearchDropdown(searchCurrentResults);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            searchActiveIndex = Math.max(searchActiveIndex - 1, -1);
            renderSearchDropdown(searchCurrentResults);
        } else if (e.key === 'Enter') {
            if (searchActiveIndex >= 0 && searchCurrentResults[searchActiveIndex]) {
                const r = searchCurrentResults[searchActiveIndex];
                navigateToSetting(r.section, r.key);
                input.value = '';
            }
        } else if (e.key === 'Escape') {
            searchDropdownEl.style.display = 'none';
            input.blur();
        }
    });

    searchDropdownEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target) && !searchDropdownEl.contains(e.target)) {
            searchDropdownEl.style.display = 'none';
        }
    });

    window.addEventListener('resize', () => {
        if (searchDropdownEl.style.display !== 'none') {
            positionSearchDropdown(input);
        }
    });

    window.addEventListener('scroll', () => {
        if (searchDropdownEl.style.display !== 'none') {
            positionSearchDropdown(input);
        }
    }, true);
}

function positionSearchDropdown(input) {
    const rect = input.getBoundingClientRect();
    searchDropdownEl.style.top  = (rect.bottom + 4) + 'px';
    searchDropdownEl.style.left = rect.left + 'px';
    searchDropdownEl.style.width = Math.max(rect.width, 260) + 'px';
}

function handleSettingsSearch(input) {
    const q = input.value.trim().toLowerCase();
    if (!q) {
        searchDropdownEl.style.display = 'none';
        searchCurrentResults = [];
        return;
    }

    const results = SETTINGS_SEARCH_INDEX.filter(entry =>
        entry.title.toLowerCase().includes(q) ||
        entry.terms.some(t => t.toLowerCase().includes(q))
    ).slice(0, 8);

    searchCurrentResults = results;
    positionSearchDropdown(input);
    renderSearchDropdown(results);
    searchDropdownEl.style.display = 'block';
}

function renderSearchDropdown(results) {
    if (results.length === 0) {
        searchDropdownEl.innerHTML = `<div class="settings-search-no-result">${window.t('settings.search_no_result')}</div>`;
        return;
    }

    searchDropdownEl.innerHTML = results.map((r, i) => `
        <div
            class="settings-search-result${i === searchActiveIndex ? ' active' : ''}"
            onmouseenter="searchActiveIndex=${i};renderSearchDropdown(searchCurrentResults)"
            onpointerdown="event.preventDefault();navigateToSetting('${r.section}','${r.key}')"
        >
            <div class="settings-search-result-icon">
                <svg viewBox="0 0 24 24">${SECTION_ICONS[r.section] || SECTION_ICONS.browser}</svg>
            </div>
            <div class="settings-search-result-info">
                <div class="settings-search-result-title">${highlightMatch(r.title, document.getElementById('settings-search-input')?.value || '')}</div>
                <div class="settings-search-result-section"><span>${r.sectionLabel}</span></div>
            </div>
        </div>
    `).join('');
}

function highlightMatch(text, query) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx)
        + '<strong style="color:var(--primary-color);">' + text.slice(idx, idx + query.length) + '</strong>'
        + text.slice(idx + query.length);
}

window.navigateToSetting = function(section, key) {
    if (searchDropdownEl) searchDropdownEl.style.display = 'none';
    const input = document.getElementById('settings-search-input');
    if (input) input.value = '';

    const navBtn = document.querySelector(`.settings-nav-btn[data-section="${section}"]`);
    if (navBtn) {
        navBtn.click();
        setTimeout(() => {
            const el = document.querySelector(`[data-setting-key="${key}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.remove('setting-item-highlight');
                void el.offsetWidth;
                el.classList.add('setting-item-highlight');
                setTimeout(() => el.classList.remove('setting-item-highlight'), 2000);
            }
        }, 80);
    }
};

async function loadSettings() {
    const data = await ipcRenderer.invoke('get-data');
    currentSettings = data.settings;
    currentPermissions = data.permissions || [];

    const realAutostart = await ipcRenderer.invoke('get-autostart');
    currentSettings.autostart = realAutostart;

    renderSecurityPanel();
    renderBrowserPanel();
    renderDiscordPanel();
    renderPerformancePanel();
    renderPrivacyPanel();
    renderPermissionsPanel();

    initSettingsSearch();

    const activeSection = document.querySelector('.settings-nav-btn.active');
    if (activeSection && activeSection.dataset.section === 'performance') {
        startPerformanceMonitoring();
    }
}

function cachePerfElements() {
    perfElements = {
        systemRamDisplay:   document.getElementById('system-ram-display'),
        systemCpuDisplay:   document.getElementById('system-cpu-display'),
        systemRamProgress:  document.getElementById('system-ram-progress'),
        systemCpuProgress:  document.getElementById('system-cpu-progress'),
        browserRamDisplay:  document.getElementById('browser-ram-display'),
        browserCpuDisplay:  document.getElementById('browser-cpu-display'),
        browserRamProgress: document.getElementById('browser-ram-progress'),
        browserCpuProgress: document.getElementById('browser-cpu-progress')
    };
}

function startPerformanceMonitoring() {
    stopPerformanceMonitoring();
    isPerformancePanelVisible = true;
    cachePerfElements();
    updatePerformanceOnce();
    performanceInterval = setInterval(async () => {
        if (!isPerformancePanelVisible) {
            stopPerformanceMonitoring();
            return;
        }
        const stats = await ipcRenderer.invoke('get-performance-stats');
        updatePerformanceDisplay(stats);
    }, 3000);
}

function stopPerformanceMonitoring() {
    isPerformancePanelVisible = false;
    if (performanceInterval) {
        clearInterval(performanceInterval);
        performanceInterval = null;
    }
    perfElements = null;
}

async function updatePerformanceOnce() {
    const stats = await ipcRenderer.invoke('get-performance-stats');
    updatePerformanceDisplay(stats);
}

function getProgressGradient(percent, isBrowser) {
    if (isBrowser) {
        if (percent < 5)  return 'linear-gradient(90deg, #3b82f6, #60a5fa)';
        if (percent < 10) return 'linear-gradient(90deg, #f59e0b, #fbbf24)';
        return 'linear-gradient(90deg, #ef4444, #f87171)';
    }
    if (percent < 50) return 'linear-gradient(90deg, #10b981, #34d399)';
    if (percent < 80) return 'linear-gradient(90deg, #f59e0b, #fbbf24)';
    return 'linear-gradient(90deg, #ef4444, #f87171)';
}

function updatePerformanceDisplay(stats) {
    if (!perfElements) cachePerfElements();
    const el = perfElements;

    if (el.systemRamDisplay) el.systemRamDisplay.textContent = `${stats.system.ram.used} MB / ${stats.system.ram.total} MB (${stats.system.ram.percent}%)`;
    if (el.systemRamProgress) {
        el.systemRamProgress.style.width = `${stats.system.ram.percent}%`;
        el.systemRamProgress.style.background = getProgressGradient(stats.system.ram.percent, false);
    }
    if (el.systemCpuDisplay) {
        const coreText = stats.system.cpu.physicalCores
            ? `${stats.system.cpu.physicalCores} ${window.t('settings.cpu_cores')} (${stats.system.cpu.cores} ${window.t('settings.cpu_threads')})`
            : `${stats.system.cpu.cores} ${window.t('settings.cpu_cores')}`;
        el.systemCpuDisplay.textContent = `${stats.system.cpu.percent}% (${coreText})`;
    }
    if (el.systemCpuProgress) {
        el.systemCpuProgress.style.width = `${stats.system.cpu.percent}%`;
        el.systemCpuProgress.style.background = getProgressGradient(stats.system.cpu.percent, false);
    }
    if (el.browserRamDisplay) el.browserRamDisplay.textContent = `${stats.browser.ram.used} MB (${stats.browser.ram.percent}${window.t('settings.perf_of_system')})`;
    if (el.browserRamProgress) {
        const adjustedPercent = Math.min(100, stats.browser.ram.percent * 10);
        el.browserRamProgress.style.width = `${adjustedPercent}%`;
        el.browserRamProgress.style.background = getProgressGradient(stats.browser.ram.percent, true);
    }
    if (el.browserCpuDisplay) el.browserCpuDisplay.textContent = `${stats.browser.cpu.percent}%`;
    if (el.browserCpuProgress) {
        el.browserCpuProgress.style.width = `${stats.browser.cpu.percent}%`;
        el.browserCpuProgress.style.background = getProgressGradient(stats.browser.cpu.percent, true);
    }
}

function renderSecurityPanel() {
    const panel = document.getElementById('security-panel');

    const drmStatusHtml = currentSettings.drmEnabled
        ? `<span style="color: #10b981;">${window.t('settings.drm_status_active')}</span> ${window.t('settings.drm_status_active_desc')}`
        : `<span style="color: #ef4444;">${window.t('settings.drm_status_inactive')}</span> ${window.t('settings.drm_status_inactive_desc')}`;

    panel.innerHTML = `
        <div class="setting-group">
            <h3 class="setting-group-title">${window.t('settings.group.security')}</h3>

            <div class="setting-item" data-setting-key="httpsOnly">
                <div class="setting-info">
                    <h3>${window.t('settings.https_title')}</h3>
                    <p>${window.t('settings.https_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.httpsOnly ? 'active' : ''}"
                     onclick="toggleSetting('httpsOnly')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="incognito">
                <div class="setting-info">
                    <h3>${window.t('settings.incognito_title')}</h3>
                    <p>${window.t('settings.incognito_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.incognito ? 'active' : ''}"
                     onclick="toggleSetting('incognito')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="adBlocker">
                <div class="setting-info">
                    <h3>${window.t('settings.adblocker_title')}</h3>
                    <p>${window.t('settings.adblocker_desc')}</p>
                </div>
                <select class="setting-select" onchange="updateSetting('adBlocker', this.value)">
                    <option value="aus"       ${currentSettings.adBlocker === 'aus'       ? 'selected' : ''}>${window.t('settings.adblocker_off')}</option>
                    <option value="basis"     ${currentSettings.adBlocker === 'basis'     ? 'selected' : ''}>${window.t('settings.adblocker_basic')}</option>
                    <option value="aggressiv" ${currentSettings.adBlocker === 'aggressiv' ? 'selected' : ''}>${window.t('settings.adblocker_aggressive')}</option>
                </select>
            </div>

            <div class="setting-item" data-setting-key="drmEnabled">
                <div class="setting-info">
                    <h3>${window.t('settings.drm_title')}</h3>
                    <p>${window.t('settings.drm_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.drmEnabled ? 'active' : ''}"
                     onclick="toggleSetting('drmEnabled')">
                    <div class="toggle-handle"></div>
                </div>
            </div>
            <div style="padding: 0 16px 16px; color: var(--text-secondary); font-size: 12px; line-height: 1.5;">
                ${drmStatusHtml}
            </div>
        </div>
    `;
}

function renderBrowserPanel() {
    const panel = document.getElementById('browser-panel');
    const bgPath = currentSettings.customBackground ? currentSettings.customBackground.replace(/\\/g, '/') : '';
    const proxyEnabled = !!currentSettings.proxyEnabled;
    const proxyServer = currentSettings.proxyServer || '2.59.132.39:3128';

    panel.innerHTML = `
        <div class="setting-group">
            <h3 class="setting-group-title">${window.t('settings.group.appearance')}</h3>

            <div class="setting-item" data-setting-key="language">
                <div class="setting-info">
                    <h3>${window.t('settings.language_title')}</h3>
                    <p>${window.t('settings.language_desc')}</p>
                </div>
                <select class="setting-select" onchange="updateSetting('language', this.value)">
                    <option value="de" ${currentSettings.language === 'de' ? 'selected' : ''}>Deutsch</option>
                    <option value="en" ${currentSettings.language === 'en' ? 'selected' : ''}>English</option>
                </select>
            </div>

            <div class="setting-item" data-setting-key="theme">
                <div class="setting-info">
                    <h3>${window.t('settings.theme_title')}</h3>
                    <p>${window.t('settings.theme_desc')}</p>
                </div>
                <select class="setting-select" onchange="changeTheme(this.value)">
                    <option value="aquila"        ${currentSettings.theme === 'aquila'        ? 'selected' : ''}>Aquila</option>
                    <option value="aquila-modern" ${currentSettings.theme === 'aquila-modern' ? 'selected' : ''}>${window.t('settings.theme_aquila_modern')}</option>
                    <option value="aquila-glas"   ${currentSettings.theme === 'aquila-glas'   ? 'selected' : ''}>${window.t('settings.theme_aquila_glas')}</option>
                    <option value="red-dusk"      ${currentSettings.theme === 'red-dusk'      ? 'selected' : ''}>${window.t('settings.theme_red_dusk')}</option>
                    <option value="yellow-soul"   ${currentSettings.theme === 'yellow-soul'   ? 'selected' : ''}>${window.t('settings.theme_yellow_soul')}</option>
                    <option value="white-rose"    ${currentSettings.theme === 'white-rose'    ? 'selected' : ''}>${window.t('settings.theme_white_rose')}</option>
                    <option value="dark-night"    ${currentSettings.theme === 'dark-night'    ? 'selected' : ''}>${window.t('settings.theme_dark_night')}</option>
                    <option value="green-forest"  ${currentSettings.theme === 'green-forest'  ? 'selected' : ''}>${window.t('settings.theme_green_forest')}</option>
                    <option value="aero-7"        ${currentSettings.theme === 'aero-7'        ? 'selected' : ''}>${window.t('settings.theme_aero')}</option>
                    <option value="xp-luna"       ${currentSettings.theme === 'xp-luna'       ? 'selected' : ''}>${window.t('settings.theme_xp')}</option>
                    <option value="cosmic"        ${currentSettings.theme === 'cosmic'        ? 'selected' : ''}>${window.t('settings.theme_cosmic')}</option>
                    <option disabled>${window.t('settings.theme_partner_separator')}</option>
                    <option value="nico"          ${currentSettings.theme === 'nico'          ? 'selected' : ''}>ItsNico_Mc (Partner)</option>
                    <option value="tasty"         ${currentSettings.theme === 'tasty'         ? 'selected' : ''}>Tasty (Partner)</option>
                    <option value="dieelfefx"     ${currentSettings.theme === 'dieelfefx'     ? 'selected' : ''}>DieElfeFX (Partner)</option>
                    <option value="wavebots"      ${currentSettings.theme === 'wavebots'      ? 'selected' : ''}>Wave Bots (Partner)</option>
                </select>
            </div>

            <div class="setting-item" data-setting-key="compactTabs">
                <div class="setting-info">
                    <h3>${window.t('settings.compact_tabs_title')}</h3>
                    <p>${window.t('settings.compact_tabs_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.compactTabs ? 'active' : ''}"
                     onclick="toggleSetting('compactTabs')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="newTabBtnInline">
                <div class="setting-info">
                    <h3>${window.t('settings.newtab_btn_title')}</h3>
                    <p>${window.t('settings.newtab_btn_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.newTabBtnInline ? 'active' : ''}"
                     onclick="toggleSetting('newTabBtnInline')">
                    <div class="toggle-handle"></div>
                </div>
            </div>
        </div>

        <div class="setting-group" style="margin-top: 24px;">
            <h3 class="setting-group-title">${window.t('settings.group.behavior')}</h3>

            <div class="setting-item" data-setting-key="defaultBrowser">
                <div class="setting-info">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span id="default-browser-icon" style="display:flex;align-items:center;">${BROWSER_STATUS_ICONS.notDefault}</span>
                        <div>
                            <h3>${window.t('settings.default_browser_title')}</h3>
                            <p id="default-browser-status" style="margin: 4px 0 0 0;">${window.t('settings.default_browser_checking')}</p>
                        </div>
                    </div>
                </div>
                <button class="setting-btn" id="set-default-browser-btn" onclick="setDefaultBrowser()">${window.t('settings.default_browser_set_btn')}</button>
            </div>

            <div class="setting-item" data-setting-key="autostart">
                <div class="setting-info">
                    <h3>${window.t('settings.autostart_title')}</h3>
                    <p>${window.t('settings.autostart_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.autostart ? 'active' : ''}"
                     onclick="toggleSetting('autostart')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="sessionRestore">
                <div class="setting-info">
                    <h3>${window.t('settings.session_restore_title')}</h3>
                    <p>${window.t('settings.session_restore_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.sessionRestore ? 'active' : ''}"
                     onclick="toggleSetting('sessionRestore')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="newWindowBehavior">
                <div class="setting-info">
                    <h3>${window.t('settings.new_window_title')}</h3>
                    <p>${window.t('settings.new_window_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.newWindowBehavior ? 'active' : ''}"
                     onclick="toggleSetting('newWindowBehavior')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="disableSponsoredContent">
                <div class="setting-info">
                    <h3>${window.t('settings.sponsored_title')}</h3>
                    <p>${window.t('settings.sponsored_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.disableSponsoredContent ? 'active' : ''}"
                     onclick="toggleSetting('disableSponsoredContent')">
                    <div class="toggle-handle"></div>
                </div>
            </div>
        </div>

        <div class="setting-group" style="margin-top: 24px;">
            <h3 class="setting-group-title">${window.t('settings.group.proxy')}</h3>

            <div class="setting-item" data-setting-key="proxyEnabled">
                <div class="setting-info">
                    <h3>${window.t('settings.proxy_title')}</h3>
                    <p>${window.t('settings.proxy_desc')}</p>
                </div>
                <div class="toggle-switch ${proxyEnabled ? 'active' : ''}"
                     onclick="toggleSetting('proxyEnabled')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            ${proxyEnabled ? `
            <div style="padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input
                        type="text"
                        id="proxy-server-input"
                        class="setting-input"
                        value="${proxyServer}"
                        placeholder="host:port"
                        style="flex: 1;"
                        onchange="saveProxyServer(this.value)"
                        onblur="saveProxyServer(this.value)"
                    >
                    <button class="setting-btn" id="proxy-test-btn" onclick="testProxyConnection()">
                        ${window.t('settings.proxy_test_btn')}
                    </button>
                </div>
                <div id="proxy-status-line" style="font-size: 12px; color: var(--text-secondary); min-height: 18px;"></div>
            </div>
            ` : ''}
        </div>

        <div class="setting-group" style="margin-top: 24px;">
            <h3 class="setting-group-title">${window.t('settings.group.background')}</h3>

            <div class="setting-item" data-setting-key="customBackground" style="flex-direction: column; align-items: flex-start; gap: 16px;">
                <div class="setting-info">
                    <h3>${window.t('settings.bg_title')}</h3>
                    <p>${window.t('settings.bg_desc')}</p>
                </div>

                ${bgPath ? `
                    <div style="width: 100%; border-radius: 10px; overflow: hidden; position: relative; height: 140px; border: 1px solid var(--border-color);">
                        <img src="file:///${bgPath}" style="width: 100%; height: 100%; object-fit: cover; display: block;" alt="${window.t('settings.bg_title')}">
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 8px 12px; background: linear-gradient(transparent, rgba(0,0,0,0.6));">
                            <span style="color: white; font-size: 11px; opacity: 0.9;">${window.t('settings.bg_active_label')}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; width: 100%;">
                        <button class="setting-btn" style="flex: 1;" onclick="selectCustomBackground()">
                            <span style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; fill: currentColor;"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                                ${window.t('settings.bg_change')}
                            </span>
                        </button>
                        <button class="setting-btn" style="flex: 1; background: rgba(220,38,38,0.15); border-color: rgba(220,38,38,0.4); color: rgba(239,68,68,1);" onclick="removeCustomBackground()">
                            <span style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <svg viewBox="0 0 24 24" style="width: 15px; height: 15px; fill: currentColor;"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                                ${window.t('settings.bg_remove')}
                            </span>
                        </button>
                    </div>
                ` : `
                    <div style="width: 100%; border: 2px dashed var(--border-color); border-radius: 10px; padding: 32px; display: flex; flex-direction: column; align-items: center; gap: 12px; cursor: pointer; transition: border-color 0.2s;" onclick="selectCustomBackground()" onmouseenter="this.style.borderColor='var(--primary-color)'" onmouseleave="this.style.borderColor='var(--border-color)'">
                        <svg viewBox="0 0 24 24" style="width: 40px; height: 40px; fill: var(--text-secondary);">
                            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                        </svg>
                        <span style="color: var(--text-secondary); font-size: 13px;">${window.t('settings.bg_click_hint')}</span>
                        <span style="color: var(--text-secondary); font-size: 11px; opacity: 0.7;">${window.t('settings.bg_formats')}</span>
                    </div>
                `}
            </div>
        </div>

        <div class="setting-group" style="margin-top: 24px;">
            <h3 class="setting-group-title">${window.t('settings.group.loading')}</h3>

            <div class="setting-item" data-setting-key="loadingScreen">
                <div class="setting-info">
                    <h3>${window.t('settings.loading_screen_title')}</h3>
                    <p>${window.t('settings.loading_screen_desc')}</p>
                </div>
                <select class="setting-select" onchange="updateSetting('loadingScreen', this.value)">
                    <option value="loading.html" ${currentSettings.loadingScreen === 'loading.html' ? 'selected' : ''}>Aquila</option>
                    <option value="cosmic.html"  ${currentSettings.loadingScreen === 'cosmic.html'  ? 'selected' : ''}>Cosmic</option>
                    <option value="hacking.html" ${currentSettings.loadingScreen === 'hacking.html' ? 'selected' : ''}>Hacking</option>
                    <option value="forest.html"  ${currentSettings.loadingScreen === 'forest.html'  ? 'selected' : ''}>Forest</option>
                    <option value="inferno.html" ${currentSettings.loadingScreen === 'inferno.html' ? 'selected' : ''}>Inferno</option>
                    <option value="synthwave.html" ${currentSettings.loadingScreen === 'synthwave.html' ? 'selected' : ''}>Synthwave</option>
                    <option value="win7.html"    ${currentSettings.loadingScreen === 'win7.html'    ? 'selected' : ''}>Windows 7 Loading</option>
                    <option value="win95.html"   ${currentSettings.loadingScreen === 'win95.html'   ? 'selected' : ''}>Windows 95 Loading</option>
                </select>
            </div>

            <div class="setting-item" data-setting-key="loadingSound">
                <div class="setting-info">
                    <h3>${window.t('settings.loading_sound_title')}</h3>
                    <p>${window.t('settings.loading_sound_desc')}</p>
                </div>
                <select class="setting-select" onchange="updateSetting('loadingSound', this.value)">
                    <option value="aquila.mp3"     ${currentSettings.loadingSound === 'aquila.mp3'     ? 'selected' : ''}>Aquila</option>
                    <option value="vienna.mp3"     ${currentSettings.loadingSound === 'vienna.mp3'     ? 'selected' : ''}>Vienna</option>
                    <option value="win7.mp3"       ${currentSettings.loadingSound === 'win7.mp3'       ? 'selected' : ''}>Windows7</option>
                    <option value="win95.mp3"      ${currentSettings.loadingSound === 'win95.mp3'      ? 'selected' : ''}>Windows95</option>
                    <option value="win98.mp3"      ${currentSettings.loadingSound === 'win98.mp3'      ? 'selected' : ''}>Windows98</option>
                    <option value="macintrosh.mp3" ${currentSettings.loadingSound === 'macintrosh.mp3' ? 'selected' : ''}>Mac Intro</option>
                </select>
            </div>

            <div class="setting-item" data-setting-key="muteStartupSound">
                <div class="setting-info">
                    <h3>${window.t('settings.mute_sound_title')}</h3>
                    <p>${window.t('settings.mute_sound_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.muteStartupSound ? 'active' : ''}"
                     onclick="toggleSetting('muteStartupSound')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="loadingSubtitle">
                <div class="setting-info">
                    <h3>${window.t('settings.loading_subtitle_title')}</h3>
                    <p>${window.t('settings.loading_subtitle_desc')}</p>
                </div>
                <input type="text" class="setting-input"
                       value="${currentSettings.loadingSubtitle || ''}"
                       placeholder="${window.t('settings.loading_subtitle_placeholder')}"
                       onchange="saveLoadingSubtitle(this.value)"
                       onblur="saveLoadingSubtitle(this.value)">
            </div>
        </div>
    `;

    updateDefaultBrowserStatus();

    if (currentSettings.proxyEnabled) {
        refreshProxyStatus();
    }
}

function renderDiscordSitesList() {
    const container = document.getElementById('discord-sites-list');
    if (!container) return;

    const sites = (currentSettings.discordAllowedSites || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    const filtered = discordSiteSearchQuery
        ? sites.filter(s => s.includes(discordSiteSearchQuery.toLowerCase()))
        : sites;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:14px 0;color:var(--text-secondary);font-size:12px;opacity:0.7;">
                ${discordSiteSearchQuery ? 'Keine Übereinstimmung gefunden' : 'Noch keine Webseiten hinzugefügt'}
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(site => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:rgba(255,255,255,0.05);border-radius:7px;margin-bottom:4px;border:1px solid var(--border-color);">
            <div style="display:flex;align-items:center;gap:8px;">
                <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:var(--primary-color);flex-shrink:0;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                <span style="font-size:12px;color:var(--text-primary);">${site}</span>
            </div>
            <button
                onclick="removeDiscordSite('${site}')"
                style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:5px;color:#ef4444;cursor:pointer;padding:3px 8px;font-size:11px;transition:background 0.15s;"
                onmouseenter="this.style.background='rgba(239,68,68,0.22)'"
                onmouseleave="this.style.background='rgba(239,68,68,0.12)'"
            >Entfernen</button>
        </div>
    `).join('');
}

function renderDiscordPanel() {
    const panel = document.getElementById('discord-panel');
    if (!panel) return;

    const showTab       = !!currentSettings.discordShowTab;
    const showButtons   = currentSettings.discordButtons !== false;
    const siteFilter    = !!currentSettings.discordSiteFilter;

    panel.innerHTML = `
        <div class="setting-group">
            <h3 class="setting-group-title">Discord Rich Presence</h3>

            <div class="setting-item" data-setting-key="discordRPC">
                <div class="setting-info">
                    <h3>${window.t('settings.discord_title')}</h3>
                    <p>${window.t('settings.discord_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.discordRPC ? 'active' : ''}"
                     onclick="toggleSetting('discordRPC')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            ${currentSettings.discordRPC ? `
            <div class="setting-item" data-setting-key="discordShowTab">
                <div class="setting-info">
                    <h3>${window.t('settings.discord_show_tab_title')}</h3>
                    <p>${window.t('settings.discord_show_tab_desc')}</p>
                </div>
                <div class="toggle-switch ${showTab ? 'active' : ''}"
                     onclick="toggleSetting('discordShowTab')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="discordButtons">
                <div class="setting-info">
                    <h3>Buttons anzeigen</h3>
                    <p>${showButtons
                        ? (showTab ? 'Zeigt den Aquila Discord-Button und einen Link zum aktuellen Tab.' : 'Zeigt den Aquila Discord-Button.')
                        : 'Keine Buttons werden im Status angezeigt.'
                    }</p>
                </div>
                <div class="toggle-switch ${showButtons ? 'active' : ''}"
                     onclick="toggleSetting('discordButtons')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            ${showTab ? `
            <div class="setting-item" data-setting-key="discordSiteFilter">
                <div class="setting-info">
                    <h3>Webseiten-Filter</h3>
                    <p>Nur bestimmte Webseiten im Discord-Status anzeigen. Alle anderen werden ausgeblendet.</p>
                </div>
                <div class="toggle-switch ${siteFilter ? 'active' : ''}"
                     onclick="toggleSetting('discordSiteFilter')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            ${siteFilter ? `
            <div style="padding: 0 16px 16px;">
                <div style="background: var(--bg-secondary); border-radius: 10px; padding: 14px; border: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 10px;">
                    <div style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Erlaubte Webseiten</div>
                    <div style="display: flex; gap: 8px;">
                        <input
                            type="text"
                            id="discord-site-add-input"
                            class="setting-input"
                            placeholder="z.B. youtube.com"
                            style="flex: 1;"
                            onkeydown="if(event.key==='Enter') addDiscordSite()"
                        >
                        <button
                            class="setting-btn"
                            onclick="addDiscordSite()"
                            style="flex-shrink:0;"
                        >Hinzufügen</button>
                    </div>
                    <div style="position: relative;">
                        <input
                            type="text"
                            class="setting-input"
                            placeholder="Webseiten durchsuchen..."
                            value="${discordSiteSearchQuery}"
                            oninput="filterDiscordSitesSearch(this.value)"
                            style="width: 100%; box-sizing: border-box; padding-left: 30px;"
                        >
                        <svg viewBox="0 0 24 24" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);width:13px;height:13px;fill:var(--text-secondary);pointer-events:none;">
                            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        </svg>
                    </div>
                    <div id="discord-sites-list" style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column;"></div>
                </div>
            </div>
            ` : ''}
            ` : ''}

            <div style="padding: 0 16px 16px;">
                <div style="background: var(--bg-secondary); border-radius: 12px; padding: 16px; border: 1px solid var(--border-color);">
                    <div style="font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">${window.t('settings.discord_preview_label')}</div>
                    <div style="display: flex; gap: 14px; align-items: flex-start;">
                        <div style="width: 60px; height: 60px; border-radius: 12px; background: linear-gradient(135deg, #5865F2, #7289DA); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                            <svg viewBox="0 0 24 24" style="width: 32px; height: 32px; fill: white;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">Aquila Browser</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${showTab ? window.t('settings.discord_preview_watching') : 'Version ' + (currentSettings._appVersion || '1.0.0')}</div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 1px;">${showTab ? 'youtube.com' : window.t('settings.discord_preview_tagline')}</div>
                            ${showButtons ? `
                            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
                                <div style="background:rgba(255,255,255,0.1);border-radius:4px;padding:4px 10px;font-size:11px;color:var(--text-primary);">Join Discord</div>
                                ${showTab ? `<div style="background:rgba(255,255,255,0.1);border-radius:4px;padding:4px 10px;font-size:11px;color:var(--text-primary);">Visit Page</div>` : ''}
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
            ` : `
            <div style="padding: 0 16px 16px;">
                <div style="background: var(--bg-secondary); border-radius: 12px; padding: 20px; border: 1px solid var(--border-color); text-align: center;">
                    <svg viewBox="0 0 24 24" style="width: 32px; height: 32px; fill: var(--text-secondary); opacity: 0.4; margin-bottom: 8px;">
                        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/>
                    </svg>
                    <div style="font-size: 13px; color: var(--text-secondary);">${window.t('settings.discord_disabled_label')}</div>
                </div>
            </div>
            `}
        </div>
    `;

    if (currentSettings.discordRPC && currentSettings.discordShowTab && currentSettings.discordSiteFilter) {
        renderDiscordSitesList();
    }
}

async function updateDefaultBrowserStatus() {
    const statusText = document.getElementById('default-browser-status');
    const statusIcon = document.getElementById('default-browser-icon');
    const button = document.getElementById('set-default-browser-btn');
    if (!statusText || !statusIcon || !button) return;

    const platform = await ipcRenderer.invoke('get-platform');

    if (platform === 'windows') {
        statusText.textContent = window.t('settings.default_browser_windows_desc');
        statusText.style.color = 'var(--text-secondary)';
        statusIcon.innerHTML = BROWSER_STATUS_ICONS.notDefault;
        button.textContent = window.t('settings.default_browser_windows_btn');
        button.disabled = false;
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
        return;
    }

    try {
        const isDefault = await ipcRenderer.invoke('check-default-browser-status');
        if (isDefault) {
            statusText.textContent = window.t('settings.default_browser_is_default');
            statusText.style.color = '#10b981';
            statusIcon.innerHTML = BROWSER_STATUS_ICONS.default;
            button.textContent = window.t('settings.default_browser_already_set');
            button.disabled = true;
            button.style.opacity = '0.6';
            button.style.cursor = 'not-allowed';
        } else {
            statusText.textContent = window.t('settings.default_browser_not_default');
            statusText.style.color = 'var(--text-secondary)';
            statusIcon.innerHTML = BROWSER_STATUS_ICONS.notDefault;
            button.textContent = window.t('settings.default_browser_set_btn');
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }
    } catch (error) {
        statusText.textContent = window.t('settings.default_browser_error');
        statusText.style.color = '#ef4444';
        statusIcon.innerHTML = BROWSER_STATUS_ICONS.error;
    }
}

async function refreshProxyStatus() {
    const statusLine = document.getElementById('proxy-status-line');
    if (!statusLine) return;
    const server = currentSettings.proxyServer || '2.59.132.39:3128';
    statusLine.style.color = 'var(--text-secondary)';
    statusLine.textContent = window.t('settings.proxy_testing');
    const result = await ipcRenderer.invoke('test-proxy', server);
    if (result.success) {
        statusLine.style.color = '#10b981';
        statusLine.textContent = window.t('settings.proxy_connected');
        if (window.updateProxyIndicator) window.updateProxyIndicator(true, true);
    } else {
        statusLine.style.color = '#ef4444';
        statusLine.textContent = window.t('settings.proxy_error');
        if (window.updateProxyIndicator) window.updateProxyIndicator(true, false);
    }
}

window.saveLoadingSubtitle = async function(value) {
    currentSettings.loadingSubtitle = value.trim();
    await saveSettings();
};

window.saveProxyServer = async function(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    currentSettings.proxyServer = trimmed;
    await saveSettings();
    if (currentSettings.proxyEnabled) {
        await ipcRenderer.invoke('set-proxy-enabled', { enabled: true, server: trimmed });
        refreshProxyStatus();
    }
};

window.testProxyConnection = async function() {
    const btn = document.getElementById('proxy-test-btn');
    const statusLine = document.getElementById('proxy-status-line');
    if (!statusLine) return;
    if (btn) { btn.disabled = true; btn.textContent = window.t('settings.proxy_testing'); }
    statusLine.style.color = 'var(--text-secondary)';
    statusLine.textContent = window.t('settings.proxy_testing');
    const server = (document.getElementById('proxy-server-input') || {}).value || currentSettings.proxyServer || '2.59.132.39:3128';
    const result = await ipcRenderer.invoke('test-proxy', server);
    if (result.success) {
        statusLine.style.color = '#10b981';
        statusLine.textContent = window.t('settings.proxy_connected');
        if (window.updateProxyIndicator) window.updateProxyIndicator(true, true);
    } else {
        statusLine.style.color = '#ef4444';
        statusLine.textContent = window.t('settings.proxy_error');
        if (window.updateProxyIndicator) window.updateProxyIndicator(true, false);
    }
    if (btn) { btn.disabled = false; btn.textContent = window.t('settings.proxy_test_btn'); }
};

window.addDiscordSite = async function() {
    const input = document.getElementById('discord-site-add-input');
    if (!input) return;
    const raw = input.value.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
    if (!raw) return;
    const sites = (currentSettings.discordAllowedSites || '')
        .split(',').map(s => s.trim()).filter(Boolean);
    if (!sites.includes(raw)) {
        sites.push(raw);
        currentSettings.discordAllowedSites = sites.join(',');
        await saveSettings();
    }
    input.value = '';
    renderDiscordSitesList();
};

window.removeDiscordSite = async function(domain) {
    const sites = (currentSettings.discordAllowedSites || '')
        .split(',').map(s => s.trim()).filter(s => s && s !== domain);
    currentSettings.discordAllowedSites = sites.join(',');
    await saveSettings();
    renderDiscordSitesList();
};

window.filterDiscordSitesSearch = function(query) {
    discordSiteSearchQuery = query.trim().toLowerCase();
    renderDiscordSitesList();
};

function renderPerformancePanel() {
    const panel = document.getElementById('performance-panel');
    const osModule = require('os');
    const totalRAM = osModule.totalmem() / (1024 * 1024);
    const ramLimitPercent = currentSettings.ramLimit || 50;
    const ramLimitMB = Math.floor((totalRAM * ramLimitPercent) / 100);
    const cpuLimitPercent = currentSettings.cpuLimit || 50;

    panel.innerHTML = `
        <div class="setting-group">
            <h3 class="setting-group-title">${window.t('settings.group.performance')}</h3>

            <div class="setting-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                <div style="width: 100%;">
                    <h3 style="margin: 0 0 8px 0;">${window.t('settings.perf_system_title')}</h3>
                </div>
                <div style="width: 100%; background: var(--bg-secondary); border-radius: 8px; padding: 16px; border: 1px solid var(--border-color);">
                    <div style="margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_ram_label')}</span>
                            <span id="system-ram-display" style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_loading')}</span>
                        </div>
                        <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div id="system-ram-progress" style="height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_cpu_label')}</span>
                            <span id="system-cpu-display" style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_loading')}</span>
                        </div>
                        <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div id="system-cpu-progress" style="height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="setting-item" style="flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 16px;">
                <div style="width: 100%;">
                    <h3 style="margin: 0 0 8px 0;">${window.t('settings.perf_browser_title')}</h3>
                </div>
                <div style="width: 100%; background: var(--bg-secondary); border-radius: 8px; padding: 16px; border: 1px solid var(--border-color);">
                    <div style="margin-bottom: 14px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_ram_browser_label')}</span>
                            <span id="browser-ram-display" style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_loading')}</span>
                        </div>
                        <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div id="browser-ram-progress" style="height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                            <span style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_cpu_browser_label')}</span>
                            <span id="browser-cpu-display" style="font-size: 12px; color: var(--text-secondary);">${window.t('settings.perf_loading')}</span>
                        </div>
                        <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div id="browser-cpu-progress" style="height: 100%; width: 0%; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="minimalMode" style="margin-top: 16px;">
                <div class="setting-info">
                    <h3>${window.t('settings.minimal_mode_title')}</h3>
                    <p>${window.t('settings.minimal_mode_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.minimalMode ? 'active' : ''}"
                     onclick="toggleSetting('minimalMode')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            <div class="setting-item" data-setting-key="performanceMode">
                <div class="setting-info">
                    <h3>${window.t('settings.perf_mode_title')}</h3>
                    <p>${window.t('settings.perf_mode_desc')}</p>
                </div>
                <div class="toggle-switch ${currentSettings.performanceMode ? 'active' : ''}"
                     onclick="toggleSetting('performanceMode')">
                    <div class="toggle-handle"></div>
                </div>
            </div>

            ${currentSettings.performanceMode ? `
            <div style="padding: 16px; background: var(--bg-secondary); border-radius: 8px; border: 1px solid var(--border-color); margin-top: 8px; display: flex; flex-direction: column; gap: 20px;">
                <div data-setting-key="ramLimit">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div>
                            <h3 style="margin: 0 0 2px 0; font-size: 14px;">${window.t('settings.ram_limit_title')}</h3>
                            <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">${window.t('settings.ram_limit_desc')}</p>
                        </div>
                        <span id="ram-limit-value" style="font-size: 12px; color: var(--primary-color); font-weight: 600; white-space: nowrap; margin-left: 12px;">${ramLimitMB} MB (${ramLimitPercent}%)</span>
                    </div>
                    <input type="range" min="10" max="90" value="${ramLimitPercent}"
                           style="width: 100%; accent-color: var(--primary-color); cursor: pointer;"
                           oninput="updateSliderValue('ramLimit', this.value)"
                           onchange="updateSliderValue('ramLimit', this.value)">
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-top: 2px;">
                        <span>10%</span><span>50%</span><span>90%</span>
                    </div>
                </div>

                <div data-setting-key="cpuLimit">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div>
                            <h3 style="margin: 0 0 2px 0; font-size: 14px;">${window.t('settings.cpu_limit_title')}</h3>
                            <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">${window.t('settings.cpu_limit_desc')}</p>
                        </div>
                        <span id="cpu-limit-value" style="font-size: 12px; color: var(--primary-color); font-weight: 600; white-space: nowrap; margin-left: 12px;">${cpuLimitPercent}%</span>
                    </div>
                    <input type="range" min="10" max="90" value="${cpuLimitPercent}"
                           style="width: 100%; accent-color: var(--primary-color); cursor: pointer;"
                           oninput="updateSliderValue('cpuLimit', this.value)"
                           onchange="updateSliderValue('cpuLimit', this.value)">
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-top: 2px;">
                        <span>10%</span><span>50%</span><span>90%</span>
                    </div>
                </div>
            </div>
            ` : ''}
        </div>
    `;

    perfElements = null;
}

function renderPrivacyPanel() {
    const panel = document.getElementById('privacy-panel');

    panel.innerHTML = `
        <div class="setting-group">
            <h3 class="setting-group-title">${window.t('settings.group.privacy')}</h3>

            <div class="setting-item" data-setting-key="clearData">
                <div class="setting-info">
                    <h3>${window.t('settings.clear_data_title')}</h3>
                    <p>${window.t('settings.clear_data_desc')}</p>
                </div>
                <button class="setting-btn" onclick="clearBrowsingData()">${window.t('settings.clear_data_btn')}</button>
            </div>
        </div>

        <div class="setting-group" style="margin-top: 24px;">
            <h3 class="setting-group-title">${window.t('settings.group.migration')}</h3>

            <div class="setting-item" data-setting-key="exportData">
                <div class="setting-info">
                    <h3>${window.t('settings.export_title')}</h3>
                    <p>${window.t('settings.export_desc')}</p>
                </div>
                <button class="setting-btn" id="export-data-btn" onclick="exportBrowserData()">
                    <span style="display:flex;align-items:center;gap:6px;">
                        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;">
                            <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/>
                        </svg>
                        ${window.t('settings.export_btn')}
                    </span>
                </button>
            </div>

            <div class="setting-item" data-setting-key="importData">
                <div class="setting-info">
                    <h3>${window.t('settings.import_title')}</h3>
                    <p>${window.t('settings.import_desc')}</p>
                </div>
                <button class="setting-btn" id="import-data-btn" onclick="importBrowserData()">
                    <span style="display:flex;align-items:center;gap:6px;">
                        <svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;">
                            <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>
                        </svg>
                        ${window.t('settings.import_btn')}
                    </span>
                </button>
            </div>
        </div>
    `;
}

function renderPermissionsPanel() {
    const panel = document.getElementById('permissions-panel');

    const permissionNames = {
        'microphone':    window.t('settings.perm_microphone'),
        'camera':        window.t('settings.perm_camera'),
        'notifications': window.t('settings.perm_notifications'),
        'geolocation':   window.t('settings.perm_geolocation')
    };

    const permissionIcons = {
        'microphone':    '<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>',
        'camera':        '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
        'notifications': '<path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>',
        'geolocation':   '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>'
    };

    let filteredPermissions = currentPermissions;
    if (permissionSearchQuery) filteredPermissions = filteredPermissions.filter(p => p.domain.toLowerCase().includes(permissionSearchQuery.toLowerCase()));
    if (permissionTypeFilter !== 'all') filteredPermissions = filteredPermissions.filter(p => p.type === permissionTypeFilter);

    const permissionsHTML = filteredPermissions.length > 0
        ? filteredPermissions.map(perm => `
            <div class="permission-item">
                <div class="permission-item-icon"><svg viewBox="0 0 24 24">${permissionIcons[perm.type] || permissionIcons['notifications']}</svg></div>
                <div class="permission-item-info">
                    <div class="permission-item-domain">${perm.domain}</div>
                    <div class="permission-item-type">${permissionNames[perm.type] || perm.type}</div>
                </div>
                <div class="permission-item-status ${perm.granted ? 'granted' : 'denied'}">${perm.granted ? window.t('settings.perm_allowed') : window.t('settings.perm_blocked')}</div>
                <button class="permission-item-delete" onclick="deletePermission('${perm.domain}', '${perm.type}')">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        `).join('')
        : `<div class="no-permissions">${window.t('settings.perm_none')}</div>`;

    panel.innerHTML = `
        <div class="setting-group">
            <h3 class="setting-group-title">${window.t('settings.group.permissions')}</h3>
            <div class="permissions-filters" data-setting-key="permissionsSearch">
                <input type="text" class="permission-search"
                       placeholder="${window.t('settings.perm_search_placeholder')}"
                       value="${permissionSearchQuery}"
                       oninput="updatePermissionSearch(this.value)">
                <select class="permission-type-filter" onchange="updatePermissionTypeFilter(this.value)">
                    <option value="all"           ${permissionTypeFilter === 'all'           ? 'selected' : ''}>${window.t('settings.perm_all')}</option>
                    <option value="microphone"    ${permissionTypeFilter === 'microphone'    ? 'selected' : ''}>${window.t('settings.perm_microphone')}</option>
                    <option value="camera"        ${permissionTypeFilter === 'camera'        ? 'selected' : ''}>${window.t('settings.perm_camera')}</option>
                    <option value="notifications" ${permissionTypeFilter === 'notifications' ? 'selected' : ''}>${window.t('settings.perm_notifications')}</option>
                    <option value="geolocation"   ${permissionTypeFilter === 'geolocation'   ? 'selected' : ''}>${window.t('settings.perm_geolocation')}</option>
                </select>
            </div>
            <div class="permissions-list">${permissionsHTML}</div>
        </div>
    `;
}

window.updatePermissionSearch = function(value) { permissionSearchQuery = value; renderPermissionsPanel(); };
window.updatePermissionTypeFilter = function(value) { permissionTypeFilter = value; renderPermissionsPanel(); };

window.deletePermission = async function(domain, type) {
    if (confirm(window.t('settings.confirm_delete_perm').replace('{domain}', domain))) {
        const data = await ipcRenderer.invoke('get-data');
        data.permissions = data.permissions.filter(p => !(p.domain === domain && p.type === type));
        await ipcRenderer.invoke('save-data', data);
        currentPermissions = data.permissions;
        renderPermissionsPanel();
    }
};

window.selectCustomBackground = async function() {
    const result = await ipcRenderer.invoke('show-open-dialog', {
        title: window.t('settings.bg_dialog_title'),
        filters: [{ name: window.t('settings.bg_dialog_filter'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
        properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const savedPath = await ipcRenderer.invoke('save-custom-background', result.filePaths[0]);
        if (savedPath) {
            currentSettings.customBackground = savedPath;
            await saveSettings();
            renderBrowserPanel();
            if (window.applyCustomBackgroundToHomeTabs) window.applyCustomBackgroundToHomeTabs();
        }
    }
};

window.removeCustomBackground = async function() {
    if (!currentSettings.customBackground) return;
    await ipcRenderer.invoke('remove-custom-background', currentSettings.customBackground);
    currentSettings.customBackground = '';
    await saveSettings();
    renderBrowserPanel();
    if (window.applyCustomBackgroundToHomeTabs) window.applyCustomBackgroundToHomeTabs();
};

window.applyNewTabBtnPosition = function(inline) {
    if (inline) document.body.classList.add('newtab-inline');
    else document.body.classList.remove('newtab-inline');
};

window.applyCompactTabs = function(enabled) {
    if (enabled) document.body.classList.add('compact-tabs');
    else document.body.classList.remove('compact-tabs');
};

window.toggleSetting = async function(key) {
    currentSettings[key] = !currentSettings[key];
    await saveSettings();

    if (key === 'autostart') {
        await ipcRenderer.invoke('set-autostart', currentSettings[key]);
    }
    if (key === 'discordRPC') {
        if (currentSettings[key]) {
            if (typeof window.initializeDiscordRPC === 'function') window.initializeDiscordRPC();
        } else {
            if (typeof window.destroyDiscordRPC === 'function') window.destroyDiscordRPC();
        }
        renderDiscordPanel();
        return;
    }
    if (key === 'discordShowTab') {
        if (typeof window.updateTabActivity === 'function') {
            if (currentSettings[key]) {
                const activeWebview = document.querySelector('webview.active');
                if (activeWebview) {
                    window.updateTabActivity(activeWebview.getTitle(), activeWebview.getURL());
                }
            } else {
                if (typeof window.setAquilaActivity === 'function') window.setAquilaActivity();
            }
        }
        renderDiscordPanel();
        return;
    }
    if (key === 'discordButtons') {
        if (typeof window.setAquilaActivity === 'function') window.setAquilaActivity();
        renderDiscordPanel();
        return;
    }
    if (key === 'discordSiteFilter') {
        discordSiteSearchQuery = '';
        renderDiscordPanel();
        return;
    }
    if (key === 'minimalMode' && typeof window.updateMinimalMode === 'function') {
        window.updateMinimalMode(currentSettings[key]);
    }
    if (key === 'drmEnabled') {
        showRestartNotification(window.t('settings.drm_restart'));
    }
    if (key === 'disableSponsoredContent' && typeof window.updatePartnersButtonVisibility === 'function') {
        window.updatePartnersButtonVisibility(currentSettings[key]);
    }
    if (key === 'newTabBtnInline' && typeof window.applyNewTabBtnPosition === 'function') {
        window.applyNewTabBtnPosition(currentSettings[key]);
    }
    if (key === 'compactTabs' && typeof window.applyCompactTabs === 'function') {
        window.applyCompactTabs(currentSettings[key]);
    }
    if (key === 'proxyEnabled') {
        const server = currentSettings.proxyServer || '2.59.132.39:3128';
        await ipcRenderer.invoke('set-proxy-enabled', { enabled: currentSettings[key], server });
        if (window.updateProxyIndicator) {
            if (!currentSettings[key]) {
                window.updateProxyIndicator(false, false);
            }
        }
    }

    loadSettings();
};

window.updateSetting = async function(key, value) {
    currentSettings[key] = value;
    await saveSettings();

    if (key === 'language' && typeof window.applyLanguage === 'function') {
        window.applyLanguage(value);
        loadSettings();
    }
};

window.changeTheme = async function(theme) {
    currentSettings.theme = theme;
    await saveSettings();
    applyTheme(theme);
};

window.updateSliderValue = function(key, value) {
    const intValue = parseInt(value);
    currentSettings[key] = intValue;
    saveSettings();

    if (key === 'ramLimit') {
        const osModule = require('os');
        const totalRAM = osModule.totalmem() / (1024 * 1024);
        const ramMB = Math.floor((totalRAM * intValue) / 100);
        const display = document.getElementById('ram-limit-value');
        if (display) display.textContent = `${ramMB} MB (${intValue}%)`;
    } else if (key === 'cpuLimit') {
        const display = document.getElementById('cpu-limit-value');
        if (display) display.textContent = `${intValue}%`;
    }
};

window.clearBrowsingData = async function() {
    if (confirm(window.t('settings.confirm_clear_data'))) {
        await ipcRenderer.invoke('clear-history');
        alert(window.t('settings.alert_data_cleared'));
    }
};

window.exportBrowserData = async function() {
    const btn = document.getElementById('export-data-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${window.t('settings.exporting')}</span>`; }
    try {
        const result = await ipcRenderer.invoke('export-browser-data');
        if (result.success) {
            showRestartNotification(`${window.t('settings.export_success_prefix')}${result.path}`);
        }
    } catch (err) {
        alert(window.t('settings.export_error_prefix') + err.message);
    }
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span style="display:flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>${window.t('settings.export_btn')}</span>`;
    }
};

window.importBrowserData = async function() {
    const btn = document.getElementById('import-data-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = `<span>${window.t('settings.importing')}</span>`; }
    try {
        const result = await ipcRenderer.invoke('import-browser-data');
        if (result.success) {
            showRestartNotification(`${window.t('settings.import_success_prefix')}${result.count.bookmarks} ${window.t('settings.import_success_bookmarks')} ${result.count.history} ${window.t('settings.import_success_history')}`);
        } else if (result.error) {
            alert(window.t('settings.import_error_prefix') + result.error);
        }
    } catch (err) {
        alert(window.t('settings.import_error_prefix') + err.message);
    }
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span style="display:flex;align-items:center;gap:6px;"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:currentColor;"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>${window.t('settings.import_btn')}</span>`;
    }
};

window.setDefaultBrowser = async function() {
    const button = document.getElementById('set-default-browser-btn');
    const statusText = document.getElementById('default-browser-status');
    const statusIcon = document.getElementById('default-browser-icon');
    if (!button || !statusText || !statusIcon) return;

    const platform = await ipcRenderer.invoke('get-platform');

    button.disabled = true;
    button.textContent = window.t('settings.default_browser_registering');
    statusIcon.innerHTML = BROWSER_STATUS_ICONS.loading;
    statusText.textContent = window.t('settings.default_browser_registering_status');
    statusText.style.color = '#3b82f6';

    try {
        const result = await ipcRenderer.invoke('register-default-browser');
        if (result.success) {
            if (platform === 'windows') {
                statusText.textContent = window.t('settings.default_browser_windows_opened');
                statusText.style.color = '#10b981';
                statusIcon.innerHTML = BROWSER_STATUS_ICONS.default;
                button.textContent = window.t('settings.default_browser_windows_btn');
                button.disabled = false;
                button.style.opacity = '1';
                button.style.cursor = 'pointer';
            } else {
                statusText.textContent = result.message;
                statusText.style.color = '#3b82f6';
                statusIcon.innerHTML = BROWSER_STATUS_ICONS.loading;
                setTimeout(() => updateDefaultBrowserStatus(), 3000);
            }
        } else {
            statusText.textContent = result.error;
            statusText.style.color = '#ef4444';
            statusIcon.innerHTML = BROWSER_STATUS_ICONS.error;
            button.disabled = false;
            button.textContent = window.t('settings.default_browser_retry');
        }
    } catch (error) {
        statusText.textContent = window.t('settings.default_browser_error');
        statusText.style.color = '#ef4444';
        statusIcon.innerHTML = BROWSER_STATUS_ICONS.error;
        button.disabled = false;
        button.textContent = window.t('settings.default_browser_retry');
    }
};

function showRestartNotification(message) {
    let notif = document.querySelector('.settings-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.className = 'settings-notification';
        notif.style.cssText = `
            position: fixed; top: 80px; right: 20px; background: rgba(59,130,246,0.95);
            color: white; padding: 16px 24px; border-radius: 10px; z-index: 10001;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-width: 400px; font-size: 13px;
            line-height: 1.5; animation: slideIn 0.3s ease; white-space: pre-line;
        `;
        document.body.appendChild(notif);
    }
    notif.textContent = message;
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => { if (notif.parentNode) notif.remove(); }, 300);
    }, 4000);
}

async function saveSettings() {
    const data = await ipcRenderer.invoke('get-data');
    data.settings = currentSettings;
    await ipcRenderer.invoke('save-data', data);
}

window.loadSettings = loadSettings;

const settingsNavBtns = document.querySelectorAll('.settings-nav-btn');
const settingsPanels = document.querySelectorAll('.settings-panel');

settingsNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        settingsNavBtns.forEach(b => b.classList.remove('active'));
        settingsPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById(`${btn.dataset.section}-panel`);
        if (panel) panel.classList.add('active');

        if (btn.dataset.section === 'performance') {
            startPerformanceMonitoring();
        } else {
            stopPerformanceMonitoring();
        }
    });
});

document.getElementById('settings-btn').addEventListener('click', loadSettings);
document.getElementById('close-settings').addEventListener('click', () => {
    stopPerformanceMonitoring();
    if (searchDropdownEl) searchDropdownEl.style.display = 'none';
});

const settingsModal = document.getElementById('settings-modal');
if (settingsModal) {
    const modalOverlay = settingsModal.querySelector('.modal-overlay');
    if (modalOverlay) modalOverlay.addEventListener('click', () => {
        stopPerformanceMonitoring();
        if (searchDropdownEl) searchDropdownEl.style.display = 'none';
    });
}