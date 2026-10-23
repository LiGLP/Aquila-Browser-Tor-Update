const modalStyles = `
  #aq-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }
  #aq-modal-overlay.aq-visible {
    opacity: 1;
    pointer-events: all;
  }
  #aq-modal-box {
    background: var(--bg-primary, #1e2027);
    border: 1px solid var(--border-color, rgba(255,255,255,0.08));
    border-radius: 12px;
    padding: 28px 28px 20px;
    min-width: 340px;
    max-width: 480px;
    width: 100%;
    box-shadow: 0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
    transform: scale(0.94) translateY(6px);
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  #aq-modal-overlay.aq-visible #aq-modal-box {
    transform: scale(1) translateY(0);
  }
  #aq-modal-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
    font-size: 18px;
  }
  #aq-modal-icon.aq-confirm { background: rgba(239, 68, 68, 0.12); }
  #aq-modal-icon.aq-alert   { background: rgba(234, 179, 8, 0.12); }
  #aq-modal-icon.aq-prompt  { background: color-mix(in srgb, var(--primary-color, #6366f1) 15%, transparent); }
  #aq-modal-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #f1f1f1);
    margin-bottom: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  #aq-modal-message {
    font-size: 13.5px;
    color: var(--text-secondary, #9ca3af);
    line-height: 1.55;
    margin-bottom: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    word-break: break-word;
  }
  #aq-modal-input-wrap {
    margin-top: 14px;
  }
  #aq-modal-input {
    width: 100%;
    background: var(--bg-secondary, #13151a);
    border: 1px solid var(--border-color, rgba(255,255,255,0.1));
    border-radius: 7px;
    padding: 9px 12px;
    font-size: 13.5px;
    color: var(--text-primary, #f1f1f1);
    outline: none;
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: border-color 0.15s;
  }
  #aq-modal-input:focus {
    border-color: var(--primary-color, #6366f1);
  }
  #aq-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color, rgba(255,255,255,0.06));
  }
  .aq-btn {
    padding: 7px 18px;
    border-radius: 7px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    transition: opacity 0.12s, transform 0.1s;
    outline: none;
  }
  .aq-btn:active { transform: scale(0.97); }
  .aq-btn-cancel {
    background: var(--bg-secondary, rgba(255,255,255,0.06));
    color: var(--text-secondary, #9ca3af);
    border: 1px solid var(--border-color, rgba(255,255,255,0.08));
  }
  .aq-btn-cancel:hover {
    background: var(--hover-color, rgba(255,255,255,0.1));
    color: var(--text-primary, #d1d5db);
  }
  .aq-btn-ok {
    background: #ef4444;
    color: #fff;
  }
  .aq-btn-ok.aq-alert-ok {
    background: #eab308;
    color: #111;
  }
  .aq-btn-ok.aq-prompt-ok {
    background: var(--primary-color, #6366f1);
    color: #fff;
  }
  .aq-btn-ok:hover { opacity: 0.88; }
`;

const ICONS = {
  confirm: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  alert:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  prompt:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color, #6366f1)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

let _styleInjected = false;
function injectStyles() {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement('style');
  s.id = 'aq-modal-styles';
  s.textContent = modalStyles;
  document.head.appendChild(s);
}

function buildOverlay() {
  let overlay = document.getElementById('aq-modal-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'aq-modal-overlay';
  overlay.innerHTML = `
    <div id="aq-modal-box">
      <div id="aq-modal-icon"></div>
      <div id="aq-modal-title"></div>
      <div id="aq-modal-message"></div>
      <div id="aq-modal-input-wrap" style="display:none">
        <input id="aq-modal-input" type="text" autocomplete="off" spellcheck="false" />
      </div>
      <div id="aq-modal-footer">
        <button class="aq-btn aq-btn-cancel" id="aq-btn-cancel">Abbrechen</button>
        <button class="aq-btn aq-btn-ok" id="aq-btn-ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function showModal({ type = 'confirm', title = 'aquila-browser', message = '', defaultValue = '' }) {
  return new Promise((resolve) => {
    injectStyles();
    const overlay   = buildOverlay();
    const icon      = document.getElementById('aq-modal-icon');
    const titleEl   = document.getElementById('aq-modal-title');
    const msgEl     = document.getElementById('aq-modal-message');
    const inputWrap = document.getElementById('aq-modal-input-wrap');
    const input     = document.getElementById('aq-modal-input');
    const btnOk     = document.getElementById('aq-btn-ok');
    const btnCancel = document.getElementById('aq-btn-cancel');

    icon.className = `aq-modal-icon aq-${type}`;
    icon.innerHTML = ICONS[type] || ICONS.alert;
    titleEl.textContent = title;
    msgEl.textContent = message;
    btnOk.className = `aq-btn aq-btn-ok aq-${type}-ok`;

    if (type === 'prompt') {
      inputWrap.style.display = 'block';
      input.value = defaultValue || '';
    } else {
      inputWrap.style.display = 'none';
    }

    if (type === 'alert') {
      btnCancel.style.display = 'none';
      btnOk.textContent = 'OK';
    } else if (type === 'confirm') {
      btnCancel.style.display = '';
      btnCancel.textContent = 'Abbrechen';
      btnOk.textContent = 'OK';
    } else {
      btnCancel.style.display = '';
      btnCancel.textContent = 'Abbrechen';
      btnOk.textContent = 'OK';
    }

    requestAnimationFrame(() => {
      overlay.classList.add('aq-visible');
      if (type === 'prompt') setTimeout(() => input.focus(), 80);
    });

    function close(result) {
      overlay.classList.remove('aq-visible');
      btnOk.onclick = null;
      btnCancel.onclick = null;
      document.removeEventListener('keydown', onKey);
      setTimeout(() => resolve(result), 160);
    }

    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); close(type === 'prompt' ? input.value : true); }
      else if (e.key === 'Escape') { e.preventDefault(); close(type === 'prompt' ? null : false); }
    }

    btnOk.onclick = () => close(type === 'prompt' ? input.value : true);
    btnCancel.onclick = () => close(type === 'prompt' ? null : false);
    document.addEventListener('keydown', onKey);
  });
}

window.alert = (message = '') => {
  showModal({ type: 'alert', title: 'Hinweis', message: String(message) });
};

window.confirm = (message = '') => {
  showModal({ type: 'confirm', title: 'aquila-browser', message: String(message) }).then(() => {});
  return false;
};

window.prompt = (message = '', defaultValue = '') => {
  showModal({ type: 'prompt', title: 'Eingabe', message: String(message), defaultValue }).then(() => {});
  return null;
};

window.aqConfirm = (message, title = 'aquila-browser') =>
  showModal({ type: 'confirm', title, message: String(message) });

window.aqAlert = (message, title = 'Hinweis') =>
  showModal({ type: 'alert', title, message: String(message) });

window.aqPrompt = (message, defaultValue = '', title = 'Eingabe') =>
  showModal({ type: 'prompt', title, message: String(message), defaultValue });

if (typeof module !== 'undefined') {
  module.exports = { aqConfirm: window.aqConfirm, aqAlert: window.aqAlert, aqPrompt: window.aqPrompt };
}