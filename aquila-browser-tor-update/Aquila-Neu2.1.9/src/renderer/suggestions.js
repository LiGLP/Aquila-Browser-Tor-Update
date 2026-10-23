let suggestionsContainer = null;
let selectedSuggestionIndex = -1;
let currentSuggestions = [];
let suggestionDebounceTimer = null;
let cachedData = null;
let cachedDataTimestamp = 0;
const CACHE_TTL = 5000;
let suggestionGeneration = 0;
let suppressBlurHide = false;

function initializeSuggestions() {
    const addressBar = document.querySelector('.address-bar');
    const addressInput = document.getElementById('address-input');

    if (!addressBar || !addressInput) return;

    suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'address-suggestions';
    addressBar.appendChild(suggestionsContainer);

    suggestionsContainer.addEventListener('mousedown', function(e) {
        e.preventDefault();
        suppressBlurHide = true;
    });

    addressInput.addEventListener('input', debounceAddressInput);

    addressInput.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowDown' && suggestionsContainer && suggestionsContainer.classList.contains('active')) {
            e.preventDefault();
            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentSuggestions.length - 1);
            updateSelectedSuggestion();
            return;
        }
        if (e.key === 'ArrowUp' && suggestionsContainer && suggestionsContainer.classList.contains('active')) {
            e.preventDefault();
            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
            updateSelectedSuggestion();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopImmediatePropagation();

            var input = document.getElementById('address-input');
            var val = input ? input.value.trim() : '';

            if (suggestionsContainer && suggestionsContainer.classList.contains('active') && selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
                val = currentSuggestions[selectedSuggestionIndex].url;
            }

            hideSuggestions();

            if (val) {
                doNavigate(val);
            }

            if (input) input.blur();
            return;
        }
        if (e.key === 'Escape') {
            hideSuggestions();
            var input = document.getElementById('address-input');
            if (input) input.blur();
            return;
        }
    }, true);

    addressInput.addEventListener('focus', () => {
        if (addressInput.value.length > 0) {
            debounceAddressInput();
        }
    });

    addressInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (suppressBlurHide) {
                suppressBlurHide = false;
                return;
            }
            hideSuggestions();
        }, 200);
    });

    document.addEventListener('click', (e) => {
        if (!addressBar.contains(e.target)) {
            hideSuggestions();
        }
    });
}

function doNavigate(input) {
    if (!input || !input.trim()) return;
    input = input.trim();

    if (typeof window.navigateToUrl === 'function') {
        window.navigateToUrl(input);
        return;
    }

    var url = input;
    if (!/^https?:\/\//i.test(url)) {
        if (url.includes('.') && !url.includes(' ')) {
            url = 'https://' + url;
        } else {
            url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
        }
    }

    var activeTab = null;
    if (typeof window.getCurrentTab === 'function') activeTab = window.getCurrentTab();

    if (activeTab) {
        if (activeTab.isHome) {
            if (typeof window.createTab === 'function') window.createTab(url);
        } else if (activeTab.webview) {
            activeTab.webview.src = url;
        }
    }
}

function debounceAddressInput() {
    if (suggestionDebounceTimer) clearTimeout(suggestionDebounceTimer);
    suggestionDebounceTimer = setTimeout(handleAddressInput, 150);
}

async function handleAddressInput() {
    const addressInput = document.getElementById('address-input');
    if (!addressInput) return;

    const input = addressInput.value.trim();
    const gen = ++suggestionGeneration;

    if (input.length === 0) {
        hideSuggestions();
        return;
    }

    const currentTab = typeof window.getCurrentTab === 'function' ? window.getCurrentTab() : null;
    if (currentTab && currentTab.isTor) {
        hideSuggestions();
        return;
    }

    if (document.activeElement !== addressInput) {
        hideSuggestions();
        return;
    }

    const suggestions = await getSuggestions(input);

    if (gen !== suggestionGeneration) return;

    if (document.activeElement !== addressInput) {
        hideSuggestions();
        return;
    }

    const currentInput = addressInput.value.trim();
    if (currentInput.length === 0) {
        hideSuggestions();
        return;
    }

    displaySuggestions(suggestions);
}

async function getCachedData() {
    const now = Date.now();
    if (cachedData && (now - cachedDataTimestamp) < CACHE_TTL) {
        return cachedData;
    }
    try {
        cachedData = await ipcRenderer.invoke('get-data');
        cachedDataTimestamp = now;
    } catch(e) {
        cachedData = { history: [], bookmarks: [], quickAccess: [], settings: {} };
    }
    return cachedData;
}

function invalidateSuggestionCache() {
    cachedData = null;
    cachedDataTimestamp = 0;
}

async function getSuggestions(query) {
    const data = await getCachedData();
    const lowerQuery = query.toLowerCase();
    const results = [];

    const historyMatches = data.history
        .filter(item => {
            return item.title.toLowerCase().includes(lowerQuery) ||
                   item.url.toLowerCase().includes(lowerQuery);
        })
        .slice(0, 5);

    historyMatches.forEach(item => {
        results.push({
            title: item.title,
            url: item.url,
            type: 'Verlauf',
            favicon: getFaviconUrl(item.url)
        });
    });

    const bookmarkMatches = data.bookmarks
        .filter(item => {
            return item.title.toLowerCase().includes(lowerQuery) ||
                   item.url.toLowerCase().includes(lowerQuery);
        })
        .slice(0, 3);

    bookmarkMatches.forEach(item => {
        if (!results.some(r => r.url === item.url)) {
            results.push({
                title: item.title,
                url: item.url,
                type: 'Lesezeichen',
                favicon: getFaviconUrl(item.url)
            });
        }
    });

    if (results.length === 0 && isValidUrl(query)) {
        results.push({
            title: query,
            url: query.startsWith('http') ? query : `https://${query}`,
            type: 'Direkt',
            favicon: getFaviconUrl(query)
        });
    }

    return results.slice(0, 8);
}

function getFaviconUrl(url) {
    try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`;
    } catch (e) {
        return '';
    }
}

function isValidUrl(string) {
    const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w- .\/?%&=]*)?$/;
    return urlPattern.test(string);
}

function displaySuggestions(suggestions) {
    currentSuggestions = suggestions;
    selectedSuggestionIndex = -1;

    if (suggestions.length === 0) {
        hideSuggestions();
        return;
    }

    if (!suggestionsContainer) return;

    suggestionsContainer.innerHTML = '';

    const fragment = document.createDocumentFragment();

    suggestions.forEach((suggestion, index) => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.dataset.index = index;

        item.innerHTML = `
            <div class="suggestion-icon">
                ${suggestion.favicon ? `
                    <img src="${suggestion.favicon}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                    <svg viewBox="0 0 24 24" style="display: none;">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                ` : `
                    <svg viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                `}
            </div>
            <div class="suggestion-content">
                <div class="suggestion-title">${escapeHtml(suggestion.title)}</div>
                <div class="suggestion-url">${escapeHtml(suggestion.url)}</div>
            </div>
            <div class="suggestion-type">${suggestion.type}</div>
        `;

        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            suppressBlurHide = true;
        });

        item.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigateToSuggestion(suggestion);
        });

        item.addEventListener('mouseenter', () => {
            selectedSuggestionIndex = index;
            updateSelectedSuggestion();
        });

        fragment.appendChild(item);
    });

    suggestionsContainer.appendChild(fragment);
    suggestionsContainer.classList.add('active');
}

function hideSuggestions() {
    suggestionGeneration++;
    if (suggestionDebounceTimer) {
        clearTimeout(suggestionDebounceTimer);
        suggestionDebounceTimer = null;
    }
    if (suggestionsContainer) {
        suggestionsContainer.classList.remove('active');
        suggestionsContainer.innerHTML = '';
    }
    currentSuggestions = [];
    selectedSuggestionIndex = -1;
}

function updateSelectedSuggestion() {
    const items = suggestionsContainer.querySelectorAll('.suggestion-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedSuggestionIndex);
    });

    if (selectedSuggestionIndex >= 0) {
        items[selectedSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
    }
}

function navigateToSuggestion(suggestion) {
    hideSuggestions();
    doNavigate(suggestion.url);
    var input = document.getElementById('address-input');
    if (input) input.blur();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.hideSuggestions = hideSuggestions;

setTimeout(() => {
    initializeSuggestions();
}, 100);

window.getSelectedSuggestion = function() {
    if (suggestionsContainer && suggestionsContainer.classList.contains('active') && selectedSuggestionIndex >= 0 && currentSuggestions[selectedSuggestionIndex]) {
        return currentSuggestions[selectedSuggestionIndex];
    }
    return null;
};