const PARTNER_API = 'http://2.59.132.39:3000';

let cachedPartners = [];
let partnersFetched = false;
let ctx = null;

function init(context) {
    ctx = context;
    initModal();
}

function initModal() {
    const partnersBtn = document.getElementById('partners-btn');
    const closePartnersBtn = document.getElementById('close-partners');
    const modal = document.getElementById('partners-modal');
    const overlay = modal ? modal.querySelector('.modal-overlay') : null;
    if (partnersBtn) partnersBtn.addEventListener('click', () => { openModal(); });
    if (closePartnersBtn) closePartnersBtn.addEventListener('click', () => { closeModal(); });
    if (overlay) overlay.addEventListener('click', () => { closeModal(); });
}

function updateBadge(count) {
    const badge = document.getElementById('partners-count-badge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else badge.style.display = 'none';
}

function fetchDirect() {
    return new Promise((resolve) => {
        try {
            const http = require('http');
            const url = 'http://2.59.132.39:3000/api/partners';
            const req = http.get(url, {
                timeout: 10000,
                headers: { 'X-Aquila-Key': 'AquilaBrowser-Internal-2025' }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && parsed.success && Array.isArray(parsed.partners)) {
                            resolve({ success: true, partners: parsed.partners });
                        } else {
                            resolve({ success: false, partners: [], error: 'Ungültige API-Antwort' });
                        }
                    } catch (e) {
                        resolve({ success: false, partners: [], error: 'JSON Parse Fehler: ' + e.message });
                    }
                });
            });
            req.on('error', (e) => { resolve({ success: false, partners: [], error: 'Verbindungsfehler: ' + e.message }); });
            req.on('timeout', () => { req.destroy(); resolve({ success: false, partners: [], error: 'Timeout nach 10s' }); });
        } catch (e) {
            resolve({ success: false, partners: [], error: 'HTTP Fehler: ' + e.message });
        }
    });
}

async function fetch() {
    try {
        const data = await ipcRenderer.invoke('fetch-partners');
        if (data && data.success && Array.isArray(data.partners) && data.partners.length > 0) {
            cachedPartners = data.partners;
            partnersFetched = true;
            updateBadge(cachedPartners.length);
            return { partners: data.partners, error: null };
        }
    } catch (e) {}
    try {
        const data = await fetchDirect();
        if (data.success && data.partners.length > 0) {
            cachedPartners = data.partners;
            partnersFetched = true;
            updateBadge(cachedPartners.length);
            return { partners: data.partners, error: null };
        }
        return { partners: [], error: data.error || 'Keine Partner' };
    } catch (e) {}
    if (cachedPartners.length > 0) return { partners: cachedPartners, error: null };
    return { partners: [], error: 'Partner API nicht erreichbar' };
}

function openModal() {
    const modal = document.getElementById('partners-modal');
    if (!modal) return;
    modal.classList.add('active');
    loadIntoModal();
}

function closeModal() {
    const modal = document.getElementById('partners-modal');
    if (modal) modal.classList.remove('active');
}

async function loadIntoModal() {
    var container = document.getElementById('partners-grid-container');
    if (!container) return;
    if (cachedPartners.length > 0) { renderGrid(container, cachedPartners); return; }
    container.innerHTML = '<div class="partners-loading"><div class="partners-loading-spinner"></div><span>Partner werden geladen...</span></div>';
    var result = await fetch();
    if (!document.getElementById('partners-modal') || !document.getElementById('partners-modal').classList.contains('active')) return;
    if (result.partners && result.partners.length > 0) { renderGrid(container, result.partners); return; }
    container.innerHTML = '<div class="partners-error">' +
        '<svg viewBox="0 0 24 24" style="width:48px;height:48px;fill:rgba(239,68,68,0.8);margin-bottom:12px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>' +
        '<p style="font-size:15px;font-weight:600;margin:0 0 6px 0;color:rgba(239,68,68,0.9);">Partner konnten nicht geladen werden</p>' +
        '<p style="font-size:12px;margin:0 0 16px 0;">' + (result.error || 'Verbindungsfehler') + '</p>' +
        '<button onclick="loadPartnersIntoModal()" style="padding:8px 20px;background:var(--primary-color,#1e90ff);border:none;border-radius:6px;color:white;cursor:pointer;font-weight:600;font-size:13px;">Erneut versuchen</button></div>';
}

function renderGrid(container, partners) {
    if (!container || !partners) return;
    var grid = document.createElement('div');
    grid.className = 'partner-grid';
    for (var i = 0; i < partners.length; i++) {
        var partner = partners[i];
        if (!partner || !partner.name) continue;
        var logoUrl = partner.logo ? PARTNER_API + '/logos/' + partner.logo : '';
        var card = document.createElement('div');
        card.className = 'partner-card';
        var initial = (partner.name || '?').charAt(0).toUpperCase();
        var tagsHtml = '';
        if (partner.tags && partner.tags.length > 0) {
            tagsHtml = '<div class="partner-tags">';
            for (var t = 0; t < partner.tags.length; t++) tagsHtml += '<span class="partner-tag">' + partner.tags[t] + '</span>';
            tagsHtml += '</div>';
        }
        var linksHtml = '';
        if (partner.website) linksHtml += '<button class="partner-link-btn" data-url="' + partner.website + '"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>Website</button>';
        if (partner.discord) linksHtml += '<button class="partner-link-btn" data-url="' + partner.discord + '"><svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>Discord</button>';
        var cardHtml = '<div class="partner-card-header"><div class="partner-avatar">';
        if (logoUrl) {
            cardHtml += '<img src="' + logoUrl + '" alt="' + partner.name + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';">';
            cardHtml += '<div class="partner-avatar-placeholder" style="display:none;">' + initial + '</div>';
        } else cardHtml += '<div class="partner-avatar-placeholder">' + initial + '</div>';
        cardHtml += '</div><div class="partner-header-info"><p class="partner-name">' + partner.name + '</p>';
        if (partner.since) cardHtml += '<p class="partner-since">Partner seit ' + partner.since + '</p>';
        cardHtml += '</div></div>' + tagsHtml;
        if (partner.description) cardHtml += '<p class="partner-description">' + partner.description + '</p>';
        if (linksHtml) cardHtml += '<div class="partner-links">' + linksHtml + '</div>';
        card.innerHTML = cardHtml;
        var linkBtns = card.querySelectorAll('.partner-link-btn');
        for (var j = 0; j < linkBtns.length; j++) {
            linkBtns[j].addEventListener('click', function() {
                var url = this.getAttribute('data-url');
                if (url && ctx) ctx.createTab(url);
                closeModal();
            });
        }
        grid.appendChild(card);
    }
    container.innerHTML = '';
    container.appendChild(grid);
}

module.exports = {
    init,
    fetch,
    openModal,
    closeModal,
    loadIntoModal
};