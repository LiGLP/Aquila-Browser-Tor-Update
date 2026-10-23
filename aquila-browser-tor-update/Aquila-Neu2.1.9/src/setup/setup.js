const { ipcRenderer } = require('electron');

let currentStep = 1;
let selectedLanguage = 'de';
let selectedTheme = 'aquila';
const totalSteps = 3;

const steps = document.querySelectorAll('.step');
const progressFill = document.getElementById('progress-fill');
const btnBack = document.getElementById('btn-back');
const btnNext = document.getElementById('btn-next');

document.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
        card.parentElement.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedLanguage = card.dataset.lang;
        updateSummary();
    });
});

document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedTheme = card.dataset.theme;
        updateSummary();
    });
});

function updateUI() {
    steps.forEach((step, i) => {
        step.classList.toggle('active', i === currentStep - 1);
    });

    progressFill.style.width = `${(currentStep / totalSteps) * 100}%`;
    btnBack.disabled = currentStep === 1;

    if (currentStep === totalSteps) {
        btnNext.className = 'btn btn-start';
        btnNext.innerHTML = `
            Los geht's
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
        `;
    } else {
        btnNext.className = 'btn btn-next';
        btnNext.innerHTML = `
            Weiter
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
            </svg>
        `;
    }
}

function updateSummary() {
    const langNames = { de: 'Deutsch', en: 'English' };
    const themeNames = {
        'aquila': 'Aquila',
        'red-dusk': 'Rote Dämmerung',
        'yellow-soul': 'Gelbe Seele',
        'nico': 'Nico',
        'white-rose': 'Weiße Rose',
        'dark-night': 'Dunkle Nacht'
    };
    document.getElementById('selected-lang').textContent = langNames[selectedLanguage] || selectedLanguage;
    document.getElementById('selected-theme').textContent = themeNames[selectedTheme] || selectedTheme;
}

btnBack.addEventListener('click', () => {
    if (currentStep > 1) {
        currentStep--;
        updateUI();
    }
});

btnNext.addEventListener('click', () => {
    if (currentStep < totalSteps) {
        currentStep++;
        updateUI();
    } else {
        btnNext.disabled = true;
        btnNext.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="animation: spin 0.8s linear infinite;">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
            </svg>
            Starte...
        `;
        setTimeout(() => {
            ipcRenderer.send('setup-complete', {
                language: selectedLanguage,
                theme: selectedTheme
            });
        }, 600);
    }
});

updateUI();
updateSummary();