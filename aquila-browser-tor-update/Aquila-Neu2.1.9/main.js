const { app, BrowserWindow, ipcMain, session, protocol, shell, webContents, dialog, components, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  IS_WINDOWS, IS_MAC, IS_LINUX, PLATFORM,
  getFullChromeVersion, getChromeMajorVersion, getChromeUserAgent, getUpdatePlatform
} = require('./src/utils/platform');

const { createPreloadScript } = require('./src/utils/preload');
const { loadData, saveData, getFilterSettings, DATA_PATH, EXTENSIONS_PATH, EXTENSIONS_CACHE_PATH, BACKGROUNDS_PATH, PRELOAD_PATH } = require('./src/utils/data-store');

const DRM_PRELOAD_PATH = path.join(__dirname, 'src', 'utils', 'drm-preload.js');
let _drmInjectCode = null;
function getDrmInjectCode() {
  if (_drmInjectCode === null) {
    try { _drmInjectCode = fs.readFileSync(DRM_PRELOAD_PATH, 'utf8'); } catch (e) { _drmInjectCode = ''; }
  }
  return _drmInjectCode;
}

let _addonIPC = false;
function ensureAddonIPC() {
  if (!_addonIPC) { _addonIPC = true; require('./addon-manager').registerAddonIPC(); }
}

let _geoModule = null;
function geo() {
  if (!_geoModule) _geoModule = require('./src/utils/geolocation');
  return _geoModule;
}

let _netModule = null;
function networking() {
  if (!_netModule) _netModule = require('./src/utils/network');
  return _netModule;
}

let _torModule = null;
function tor() {
  if (!_torModule) _torModule = require('./src/utils/tor-manager');
  return _torModule;
}

let _dlModule = null;
function downloads() {
  if (!_dlModule) _dlModule = require('./src/utils/downloads');
  return _dlModule;
}

let _tbModule = null;
function touchbar() {
  if (!_tbModule) _tbModule = require('./src/utils/touchbar');
  return _tbModule;
}

let _apiModule = null;
function api() {
  if (!_apiModule) _apiModule = require('./src/utils/api');
  return _apiModule;
}

let _defBrowserModule = null;
function defBrowser() {
  if (!_defBrowserModule) _defBrowserModule = require('./src/utils/default-browser');
  return _defBrowserModule;
}

let _extModule = null;
function ext() {
  if (!_extModule) _extModule = require('./src/utils/extensions');
  return _extModule;
}

let _memModule = null;
function mem() {
  if (!_memModule) _memModule = require('./src/utils/memory-manager');
  return _memModule;
}

let _pswModule = null;
function psw() {
  if (!_pswModule) _pswModule = require('./src/utils/apple-psw');
  return _pswModule;
}

ipcMain.handle('get-app-version', () => app.getVersion());

const DEBUG_MODE = false;

let mainWindow;
let loadingWindow;
let setupWindow;
let extensions;
let isCreatingOwnWindow = false;
let isFullyLoaded = false;
let resourceThrottleTimer = null;
let extMonitorTimer = null;
let extensionBackgroundPages = new Map();
let startupUrl = null;
let isHtmlFullscreen = false;
let devtoolsCustomUA = null;
let pendingTabCallbacks = new Map();
let tabCallbackCounter = 0;
const allowedWindows = new Set();
const extensionWindows = new WeakSet();
let geoLocationPromise = null;
let pendingExternalUrls = [];
let pendingUrlFlushTimer = null;
let lastSelectedTabId = null;

let _settingsCache = null;
let _settingsCacheTime = 0;

function getCachedData() {
  const now = Date.now();
  if (!_settingsCache || (now - _settingsCacheTime) > 5000) {
    _settingsCache = loadData();
    _settingsCacheTime = now;
  }
  return _settingsCache;
}

function invalidateCache() {
  _settingsCache = null;
  _settingsCacheTime = 0;
}

if (!fs.existsSync(EXTENSIONS_PATH)) fs.mkdirSync(EXTENSIONS_PATH, { recursive: true });
if (!fs.existsSync(BACKGROUNDS_PATH)) fs.mkdirSync(BACKGROUNDS_PATH, { recursive: true });

function selectTabForExtensions(wc) {
  if (!extensions || !mainWindow || mainWindow.isDestroyed()) return;
  if (!wc || wc.isDestroyed()) return;
  if (tor().isTorContents(wc)) return;
  try {
    var wcId = wc.id;
    if (wcId === lastSelectedTabId) return;
    lastSelectedTabId = wcId;
    extensions.selectTab(wc, mainWindow);
  } catch(e) {}
}

function selectAllExistingTabs() {
  if (!extensions || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    var allWC = webContents.getAllWebContents();
    var selected = false;
    for (var i = 0; i < allWC.length; i++) {
      var wc = allWC[i];
      if (wc.isDestroyed()) continue;
      try {
        if (wc.getType() === 'webview') {
          var url = wc.getURL();
          if (url && !url.startsWith('chrome-extension://') && url !== 'about:blank') {
            if (!selected) {
              selectTabForExtensions(wc);
              selected = true;
            }
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
}

function hasExtensionBlocker(browserSession) {
  try {
    const exts = Array.from(browserSession.getAllExtensions());
    return exts.some(e => {
      const perms = e.manifest && e.manifest.permissions;
      return Array.isArray(perms) && perms.includes('webRequest') && perms.includes('webRequestBlocking');
    });
  } catch(e) { return false; }
}

let builtinBlockerRegistered = false;

function registerBuiltinAdBlocker(targetSession) {
  builtinBlockerRegistered = true;
  targetSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const url = details.url.toLowerCase();

    if (url.startsWith('chrome-extension://')) {
      callback({ cancel: false });
      return;
    }

    if (networking().isYouTubeOrGoogleVideo(url)) {
      callback({ cancel: false });
      return;
    }

    if (networking().isCrunchyrollOrCDN(url)) {
      callback({ cancel: false });
      return;
    }

    const filterSettings = getFilterSettings();
    if (filterSettings.adBlocker && networking().shouldBlockAd(url, filterSettings.adBlocker)) {
      callback({ cancel: true });
      return;
    }

    callback({ cancel: false });
  });
}

function isCrunchyrollUrl(url) {
  if (!url) return false;
  return url.includes('crunchyroll.com') || url.includes('vrv.co') || url.includes('prd.crunchyrollsvc.com');
}

function isCrunchyrollDomain(hostname) {
  if (!hostname) return false;
  return hostname.includes('crunchyroll.com')
    || hostname.includes('vrv.co')
    || hostname.includes('crunchyrollsvc.com')
    || hostname.includes('a-vrv.akamaized.net')
    || hostname.includes('cr-play.akamaized.net');
}

function extractUrlFromArgs(args) {
  if (!args || !Array.isArray(args)) return null;
  const skipExts = ['.exe', '.dll', '.node', '.asar', '.js'];
  const ownExe = app.isPackaged ? app.getPath('exe').toLowerCase() : '';
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (!arg || typeof arg !== 'string') continue;
    const cleaned = arg.replace(/^["']|["']$/g, '').trim();
    if (!cleaned || cleaned.startsWith('-') || cleaned.startsWith('--')) continue;
    if (cleaned.toLowerCase() === ownExe) continue;
    const lower = cleaned.toLowerCase();
    if (skipExts.some(e => lower.endsWith(e))) continue;
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://') || cleaned.startsWith('file://')) return cleaned;
    const fileExts = ['.pdf', '.html', '.htm', '.svg', '.txt', '.xml', '.json',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif', '.avif',
      '.xhtml', '.shtml', '.xht', '.mhtml', '.mht',
      '.mp3', '.mp4', '.webm', '.ogg', '.wav', '.m4a', '.flac', '.aac', '.opus',
      '.mov', '.mkv', '.avi', '.m4v', '.3gp'];
    if (fileExts.some(e => lower.endsWith(e))) {
      try {
        const resolved = path.resolve(cleaned);
        if (fs.existsSync(resolved)) return 'file:///' + resolved.replace(/\\/g, '/');
      } catch (e) {}
    }
    if (/^[a-zA-Z]:\\/.test(cleaned) || cleaned.startsWith('/')) {
      if (skipExts.some(e => lower.endsWith(e))) continue;
      try {
        const resolved = path.resolve(cleaned);
        if (fs.existsSync(resolved)) return 'file:///' + resolved.replace(/\\/g, '/');
      } catch (e) {}
    }
  }
  return null;
}

startupUrl = extractUrlFromArgs(process.argv);

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (isFullyLoaded && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('open-external-url', url);
  } else {
    pendingExternalUrls.push(url);
    schedulePendingUrlFlush();
  }
});

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('http', process.execPath, [path.resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('https', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('http');
  app.setAsDefaultProtocolClient('https');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) { app.quit(); return; }

app.on('second-instance', (event, commandLine) => {
  const url = extractUrlFromArgs(commandLine);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  if (url) sendUrlToRenderer(url);
});

function sendUrlToRenderer(url) {
  if (!url) return;
  if (isFullyLoaded && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('open-external-url', url);
  } else {
    pendingExternalUrls.push(url);
    schedulePendingUrlFlush();
  }
}

function schedulePendingUrlFlush() {
  if (pendingUrlFlushTimer) return;
  pendingUrlFlushTimer = setInterval(() => {
    if (pendingExternalUrls.length === 0) { clearInterval(pendingUrlFlushTimer); pendingUrlFlushTimer = null; return; }
    if (isFullyLoaded && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      flushPendingUrls();
      clearInterval(pendingUrlFlushTimer);
      pendingUrlFlushTimer = null;
    }
  }, 300);
}

function flushPendingUrls() {
  if (pendingExternalUrls.length === 0 || !isFullyLoaded) return;
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  const urls = [...pendingExternalUrls];
  pendingExternalUrls = [];
  urls.forEach(url => mainWindow.webContents.send('open-external-url', url));
}

app.commandLine.appendSwitch('disable-features', 'AutomationControlled,ThirdPartyCookieDeprecationTrial,TrackingProtection3pcd,ThirdPartyStoragePartitioning');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512 --expose-gc');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '256');
app.commandLine.appendSwitch('enable-features', 'CastMediaRouteProvider,MediaRouter');
if (IS_LINUX) app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');

const originalConsoleError = console.error;
console.error = function(...args) {
  const full = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  if (full.includes('Render frame was disposed') || full.includes('Error sending from webFrameMain') || full.includes('interface_endpoint_client')) return;
  originalConsoleError.apply(console, args);
};

process.on('uncaughtException', (error) => {
  if (error.message && error.message.includes('Render frame was disposed')) return;
  originalConsoleError('[UNCAUGHT]', error);
});

function isExtensionUrl(url) {
  return typeof url === 'string' && url.startsWith('chrome-extension://');
}


function isOAuthUrl(url) {
  if (!url) return false;
  const oauthDomains = [
    'accounts.google.com',
    'appleid.apple.com',
    'login.microsoftonline.com',
    'github.com/login/oauth',
    'github.com/login',
    'github.com/session',
    'api.twitter.com/oauth',
    'facebook.com/dialog/oauth',
    'facebook.com/v',
    'discord.com/oauth2',
    'discord.com/login',
    'login.live.com',
    'consent.google.com',
    'myaccount.google.com',
    'googleapis.com/oauth',
    'id.twitch.tv',
    'login.yahoo.com',
    'open.spotify.com/login'
  ];
  return oauthDomains.some(d => url.includes(d));
}

function setupOAuthWindow(win) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed()) return;

  const chromeUA = getChromeUserAgent();
  const chromeMajor = getChromeMajorVersion();
  wc.setUserAgent(chromeUA);

  const antiDetectionScript = `
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {}, id: undefined };
      if (!window.chrome.csi) window.chrome.csi = () => ({});
      if (!window.chrome.loadTimes) window.chrome.loadTimes = () => ({});
      if (!window.chrome.app) window.chrome.app = { isInstalled: false, getIsInstalled: () => false, getDetails: () => null, runningState: () => 'cannot_run' };

      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: [
            { brand: 'Google Chrome', version: '${chromeMajor}' },
            { brand: 'Chromium', version: '${chromeMajor}' },
            { brand: 'Not-A.Brand', version: '24' }
          ],
          mobile: false,
          platform: '${IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'}',
          getHighEntropyValues: (hints) => Promise.resolve({
            brands: [
              { brand: 'Google Chrome', version: '${chromeMajor}' },
              { brand: 'Chromium', version: '${chromeMajor}' },
              { brand: 'Not-A.Brand', version: '24' }
            ],
            mobile: false,
            platform: '${IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'}',
            platformVersion: '${IS_WINDOWS ? '15.0.0' : IS_MAC ? '14.0.0' : '6.5.0'}',
            architecture: 'x86',
            bitness: '64',
            model: '',
            uaFullVersion: '${getFullChromeVersion()}'
          })
        })
      });

      if (window.process) delete window.process;
      if (window.require) delete window.require;
      if (window.module) delete window.module;
      if (window.exports) delete window.exports;
      if (window.__dirname) delete window.__dirname;
      if (window.__filename) delete window.__filename;

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Google Inc. (NVIDIA)';
        if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)';
        return getParameter.call(this, parameter);
      };
    } catch(e) {}
  `;

  wc.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    wc.executeJavaScript(antiDetectionScript).catch(() => {});
  });

  wc.on('did-finish-load', () => {
    wc.executeJavaScript(antiDetectionScript).catch(() => {});
  });

  wc.executeJavaScript(antiDetectionScript).catch(() => {});

const isAuthFlowUrl = (url) => {
    if (!url) return true;
    if (url === 'about:blank') return true;

    const authPatterns = [
      'accounts.google.com',
      'consent.google.com',
      'myaccount.google.com/auth',
      'gstatic.com',
      'googleapis.com/identitytoolkit',
      'googleapis.com/oauth',
      'google.com/signin',
      'google.com/ServiceLogin',
      'google.com/CheckCookie',
      'google.com/AccountChooser',
      'google.com/speedbump',
      'google.com/interstitial',
      'google.com/o/oauth2',
      '/signin',
      '/login/oauth',
      '/challenge',
      '/approval',
      '/ServiceLogin',
      '/CheckCookie',
      '/AccountChooser',
      '/o/oauth2',
      'youtube.com/signin',
      'youtube.com/accounts',
      'youtube.com/o/oauth2',
      'login.microsoftonline.com',
      'appleid.apple.com',
      'github.com/login',
      'github.com/session',
      'discord.com/login',
      'discord.com/oauth2',
      'login.live.com',
      'id.twitch.tv',
      'login.yahoo.com',
      'open.spotify.com/login'
    ];

    return authPatterns.some(p => url.includes(p));
  };

  let authCompleted = false;

  const handleAuthComplete = (url) => {
    if (authCompleted) return;
    authCompleted = true;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('oauth-completed', url);
    }
    setTimeout(() => {
      try { if (!win.isDestroyed()) win.close(); } catch(e) {}
    }, 300);
  };

  wc.on('did-navigate', (e, url) => {
    if (!isAuthFlowUrl(url)) {
      handleAuthComplete(url);
    }
  });

  wc.on('will-redirect', (e, url) => {
    if (!isAuthFlowUrl(url)) {
      handleAuthComplete(url);
    }
  });
}

function forwardUrlToRenderer(url) {
  if (!url || !mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents || mainWindow.webContents.isDestroyed()) return;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
    mainWindow.webContents.send('open-external-url', url);
  }
}

function isDroppableFileUrl(url) {
  if (!url || !url.startsWith('file://')) return false;
  const lower = url.toLowerCase();
  const supportedExts = ['.pdf', '.html', '.htm', '.svg', '.txt', '.xml', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif', '.avif'];
  return supportedExts.some(ext => lower.endsWith(ext));
}

function getTotalExtensionMemoryMB() {
  let total = 0;
  try {
    app.getAppMetrics().forEach(metric => {
      if (metric.type === 'Extension' || (metric.name && metric.name.includes('extension'))) {
        total += metric.memory ? Math.round(metric.memory.workingSetSize / 1024) : 0;
      }
    });
  } catch(e) {}
  return total;
}

let gcCycleCount = 0;
function startPeriodicGC() {
  setInterval(() => {
    if (!isFullyLoaded) return;
    gcCycleCount++;
    const data = getCachedData();
    if (data.settings.performanceMode) {
      try {
        const metrics = app.getAppMetrics();
        let totalRamKB = 0;
        metrics.forEach(m => { if (m.memory && m.memory.workingSetSize) totalRamKB += m.memory.workingSetSize; });
        const totalRamMB = totalRamKB / 1024;
        const totalSysMB = os.totalmem() / (1024 * 1024);
        const ramLimitMB = (totalSysMB * (data.settings.ramLimit || 50)) / 100;
        if (totalRamMB > ramLimitMB) {
          if (global.gc) global.gc();
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('enforce-memory-limit');
        }
        const cpus = os.cpus();
        let totalIdle = 0, totalTick = 0;
        cpus.forEach(cpu => { for (let t in cpu.times) totalTick += cpu.times[t]; totalIdle += cpu.times.idle; });
        const cpuUsage = Math.round(100 - (totalIdle / totalTick * 100));
        if (cpuUsage > (data.settings.cpuLimit || 50)) {
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('enforce-cpu-limit');
        }
      } catch (e) {}
    }
    if (gcCycleCount % 4 === 0 && global.gc) global.gc();
  }, 90000);
}

function resolveMediaPermissionType(details) {
  const mediaTypes = details.mediaTypes || [];
  if (mediaTypes.includes('video') && mediaTypes.includes('audio')) return 'camera';
  if (mediaTypes.includes('video')) return 'camera';
  return 'microphone';
}

function setupPermissionHandlers(targetSession) {
  targetSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const autoApprove = ['protected-media-identifier', 'fullscreen', 'clipboard-sanitized-write', 'window-management', 'autoplay', 'encrypted-media'];
    if (autoApprove.includes(permission)) { callback(true); return; }
    const supported = ['notifications', 'geolocation', 'media'];
    if (!supported.includes(permission)) { callback(false); return; }
    let permissionType = permission === 'media' ? resolveMediaPermissionType(details) : permission;
    const currentData = loadData();
    if (!currentData.permissions) { currentData.permissions = []; saveData(currentData); invalidateCache(); }
    let domain;
    try { domain = new URL(details.requestingUrl).hostname; } catch (e) { domain = details.requestingUrl; }
    const existing = currentData.permissions.find(p => p.domain === domain && p.type === permissionType);
    if (existing) {
      if (existing.granted && permissionType === 'geolocation') geo().setGeolocationOverride(wc);
      callback(existing.granted);
      return;
    }
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('permission-request', { domain, url: details.requestingUrl, type: permissionType, mediaTypes: details.mediaTypes });
      let hasResponded = false;
      const responseHandler = (event, response) => {
        if (hasResponded) return;
        hasResponded = true;
        if (response.remember) {
          currentData.permissions.push({ domain: response.domain, type: response.type, granted: response.granted, timestamp: new Date().toISOString() });
          saveData(currentData);
          invalidateCache();
        }
        if (response.granted && response.type === 'geolocation') geo().setGeolocationOverride(wc);
        callback(response.granted);
      };
      ipcMain.once('permission-response', responseHandler);
      setTimeout(() => { if (!hasResponded) { hasResponded = true; ipcMain.removeListener('permission-response', responseHandler); callback(false); } }, 30000);
    } else { callback(false); }
  });

  targetSession.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    const alwaysAllow = ['protected-media-identifier', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'window-management', 'local-fonts', 'idle-detection', 'storage-access', 'top-level-storage-access', 'autoplay', 'encrypted-media', 'midi', 'background-sync', 'persistent-storage', 'accelerometer', 'gyroscope', 'magnetometer', 'screen-wake-lock', 'display-capture'];
    if (alwaysAllow.includes(permission)) return true;
    let domain;
    try { domain = new URL(requestingOrigin).hostname; } catch (e) { domain = requestingOrigin; }
    const currentData = getCachedData();
    if (!currentData.permissions) return false;
    if (permission === 'geolocation') {
      const e = currentData.permissions.find(p => p.domain === domain && p.type === 'geolocation');
      return e ? e.granted : false;
    }
    if (permission === 'notifications') {
      const e = currentData.permissions.find(p => p.domain === domain && p.type === 'notifications');
      return e ? e.granted : false;
    }
    if (permission === 'media') {
      return !!(currentData.permissions.find(p => p.domain === domain && p.type === 'microphone' && p.granted) || currentData.permissions.find(p => p.domain === domain && p.type === 'camera' && p.granted));
    }
    return false;
  });
}

function createLoadingWindow(loadingScreen) {
  isCreatingOwnWindow = true;
  loadingWindow = new BrowserWindow({
    width: 800, height: 600, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: true, v8CacheOptions: 'code' }
  });
  isCreatingOwnWindow = false;
  allowedWindows.add(loadingWindow);
  loadingWindow.loadFile(path.join(__dirname, 'loadingscreen', loadingScreen));
  loadingWindow.center();
  const data = getCachedData();
  if (data.settings.muteStartupSound) {
    loadingWindow.webContents.once('did-finish-load', () => {
      loadingWindow.webContents.setAudioMuted(true);
      loadingWindow.webContents.executeJavaScript(`document.querySelectorAll('audio,video').forEach(function(el){el.muted=true;el.pause();});window.__aquilaMuteSound=true;`).catch(() => {});
    });
  }
}

function createSetupWindow() {
  isCreatingOwnWindow = true;
  setupWindow = new BrowserWindow({
    width: 900, height: 700, frame: false, resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, enableRemoteModule: true, backgroundThrottling: true, v8CacheOptions: 'code' }
  });
  isCreatingOwnWindow = false;
  allowedWindows.add(setupWindow);
  setupWindow.loadFile(path.join(__dirname, 'src', 'setup', 'setup.html'));
  setupWindow.center();
  setupWindow.on('closed', () => { setupWindow = null; });
}

function cleanupLoadingWindow() {
  if (!loadingWindow || loadingWindow.isDestroyed()) {
    loadingWindow = null;
    return;
  }

  const wc = loadingWindow.webContents;
  if (!wc || wc.isDestroyed()) {
    try { loadingWindow.destroy(); } catch(e) {}
    loadingWindow = null;
    return;
  }

  loadingWindow.setOpacity(0);
  loadingWindow.hide();

  const MAX_WAIT = 30000;
  const CHECK_INTERVAL = 500;
  let elapsed = 0;

  function destroyNow() {
    if (!loadingWindow || loadingWindow.isDestroyed()) { loadingWindow = null; return; }
    console.log('[DEBUG] MW-50d - loading window destroyed');
    try { loadingWindow.removeAllListeners(); loadingWindow.destroy(); } catch(e) {}
    loadingWindow = null;
  }

  function checkAudio() {
    if (!loadingWindow || loadingWindow.isDestroyed()) { loadingWindow = null; return; }
    elapsed += CHECK_INTERVAL;
    if (elapsed >= MAX_WAIT) { destroyNow(); return; }
    wc.executeJavaScript(
      "!!(Array.from(document.querySelectorAll('audio,video')).find(function(el){ return !el.paused && !el.ended; }))"
    ).then(function(isPlaying) {
      if (isPlaying) {
        setTimeout(checkAudio, CHECK_INTERVAL);
      } else {
        destroyNow();
      }
    }).catch(function() {
      destroyNow();
    });
  }

  checkAudio();
}

function createMainWindow() {
  console.log('[DEBUG] MW-1 - createMainWindow start');
  isCreatingOwnWindow = true;
  const browserSession = session.fromPartition('persist:main');
  console.log('[DEBUG] MW-2 - session created');
  networking().optimizeSession(browserSession);
  networking().applyChromeHeaders(browserSession, devtoolsCustomUA);
  console.log('[DEBUG] MW-3 - session optimized');
  const { ElectronChromeExtensions } = require('electron-chrome-extensions');
  ElectronChromeExtensions.handleCRXProtocol(browserSession);
  console.log('[DEBUG] MW-4 - CRX protocol handled');

  extensions = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: browserSession,
    createTab(details) {
      return new Promise((resolve, reject) => {
        if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) { reject(new Error('No main window')); return; }
        const callbackId = ++tabCallbackCounter;
        pendingTabCallbacks.set(callbackId, { resolve, reject });
        mainWindow.webContents.send('extension-create-tab-request', { callbackId, url: details.url || 'about:blank', active: details.active !== false });
        setTimeout(() => { if (pendingTabCallbacks.has(callbackId)) { pendingTabCallbacks.delete(callbackId); resolve([mainWindow.webContents, mainWindow]); } }, 5000);
      });
    },
    selectTab(wc) { if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('extension-select-tab', wc.id); },
    removeTab(wc) { if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('extension-remove-tab', wc.id); },
    createWindow() { return Promise.resolve(mainWindow); }
  });

  ipcMain.on('extension-tab-created', (event, { callbackId, webContentsId }) => {
    const cb = pendingTabCallbacks.get(callbackId);
    if (!cb) return;
    pendingTabCallbacks.delete(callbackId);
    try { const wc = webContents.fromId(webContentsId); cb.resolve(wc && !wc.isDestroyed() ? [wc, mainWindow] : [mainWindow.webContents, mainWindow]); }
    catch(e) { cb.resolve([mainWindow.webContents, mainWindow]); }
  });

  const handleWillDownload = (item, recordHistory) => {
    const savePath = downloads().resolveDownloadPath(item.getFilename());
    item.setSavePath(savePath);
    const dlId = Date.now();
    const safety = downloads().checkDownloadSafety(savePath);

    if (!safety.safe && mainWindow && !mainWindow.isDestroyed()) {
      item.pause();
      mainWindow.webContents.send('download-safety-warning', { id: dlId, filename: item.getFilename(), url: item.getURL(), savePath, warnings: safety.warnings, extension: safety.extension });
      const confirmHandler = (evt, response) => {
        if (response.id !== dlId) return;
        ipcMain.removeListener('download-safety-response', confirmHandler);
        if (response.allow) {
          item.resume();
          mainWindow.webContents.send('download-started', { id: dlId, filename: item.getFilename(), url: item.getURL(), savePath, totalBytes: item.getTotalBytes(), receivedBytes: 0, speed: 0, percent: 0, state: 'progressing' });
        } else {
          item.cancel();
        }
      };
      ipcMain.on('download-safety-response', confirmHandler);
      setTimeout(() => { ipcMain.removeListener('download-safety-response', confirmHandler); if (item.isPaused()) item.cancel(); }, 60000);
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-started', { id: dlId, filename: item.getFilename(), url: item.getURL(), savePath, totalBytes: item.getTotalBytes(), receivedBytes: 0, speed: 0, percent: 0, state: 'progressing' });
    }
    let lastBytes = 0, lastTime = Date.now();
    item.on('updated', (e, state) => {
      const now = Date.now();
      const dt = Math.max(0.05, (now - lastTime) / 1000);
      const received = item.getReceivedBytes();
      const tot = item.getTotalBytes();
      const speed = Math.max(0, (received - lastBytes) / dt);
      lastBytes = received; lastTime = now;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-progress', { id: dlId, receivedBytes: received, totalBytes: tot, speed, percent: tot > 0 ? Math.round((received / tot) * 100) : 0, state });
    });
    item.once('done', (e, state) => {
      const tot = item.getTotalBytes() || lastBytes;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download-done', { id: dlId, state, filename: item.getFilename(), savePath, totalBytes: tot });
      if (state === 'completed' && recordHistory) {
        const data = loadData();
        data.downloads.unshift({ id: dlId, filename: item.getFilename(), url: item.getURL(), savePath, totalBytes: tot, timestamp: new Date().toISOString() });
        if (data.downloads.length > 100) data.downloads = data.downloads.slice(0, 100);
        saveData(data);
        invalidateCache();
      }
    });
  };
  browserSession.on('will-download', (event, item) => handleWillDownload(item, true));
  tor().getTorSession().on('will-download', (event, item) => handleWillDownload(item, false));

  const windowOptions = {
    width: 1400, height: 900, minWidth: 800, minHeight: 600, frame: false, show: false, backgroundColor: '#001122',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
      enableRemoteModule: true,
      session: browserSession,
      backgroundThrottling: true,
      offscreen: false,
      enableWebSQL: false,
      v8CacheOptions: 'code',
      disableBlinkFeatures: 'AutomationControlled'
    }
  };
  if (IS_MAC) windowOptions.titleBarStyle = 'hiddenInset';

  mainWindow = new BrowserWindow(windowOptions);
  isCreatingOwnWindow = false;
  allowedWindows.add(mainWindow);
  console.log('[DEBUG] MW-5 - BrowserWindow created');

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.log('[DEBUG] RENDERER CRASHED:', details.reason, details.exitCode);
  });

  mainWindow.webContents.on('crashed', (event, killed) => {
    console.log('[DEBUG] RENDERER CRASHED (legacy):', killed);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.log('[DEBUG] MW did-fail-load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message.startsWith('[DEBUG]')) {
      console.log(message);
    } else if (level >= 2) {
      console.log('[RENDERER ' + (level === 3 ? 'ERROR' : 'WARN') + ']', message, '(' + sourceId + ':' + line + ')');
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = params.src || '';
    const isExt = src.startsWith('chrome-extension://');

    console.log('[DEBUG] will-attach-webview src:', src, 'isExt:', isExt);
    if (params.partition === tor().TOR_PARTITION) {
      webPreferences.nodeIntegration = false;
      delete webPreferences.preload;
      delete webPreferences.preloadURL;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.plugins = false;
      webPreferences.enableWebSQL = false;
      return;
    }
    if (isExt) {
      console.log('[DEBUG] will-attach-webview SKIP for extension, preload:', webPreferences.preload, 'preloadURL:', webPreferences.preloadURL);
      return;
    }

    const isEmpty = !src || src === '' || src === 'about:blank';
    const isYT = src.includes('youtube.com') || src.includes('googlevideo.com');
    const isCR = isCrunchyrollUrl(src);
    webPreferences.nodeIntegration = false;
    delete webPreferences.preloadURL;
    webPreferences.plugins = true;
    webPreferences.backgroundThrottling = true;
    webPreferences.autoplayPolicy = 'no-user-gesture-required';
    webPreferences.offscreen = false;
    webPreferences.enableWebSQL = false;
    webPreferences.v8CacheOptions = 'code';
    if (isEmpty) { webPreferences.sandbox = false; webPreferences.contextIsolation = false; delete webPreferences.preload; }
    else if (isYT) { webPreferences.contextIsolation = false; webPreferences.sandbox = false; delete webPreferences.preload; }
    else if (isCR) { webPreferences.contextIsolation = false; webPreferences.sandbox = false; webPreferences.preload = DRM_PRELOAD_PATH; }
    else { webPreferences.preload = PRELOAD_PATH; webPreferences.contextIsolation = false; webPreferences.sandbox = false; webPreferences.disableBlinkFeatures = 'AutomationControlled'; }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url && details.url !== 'about:blank') mainWindow.webContents.send('open-external-url', details.url);
    return { action: 'deny' };
  });

  function onMainContentReady() {
    console.log('[DEBUG] MW-10 - onMainContentReady fired');
    const browserSession = session.fromPartition('persist:main');
    console.log('[DEBUG] MW-11 - loading extensions...');
    ext().loadExistingExtensionsOptimized(browserSession, EXTENSIONS_PATH).then(() => {
      console.log('[DEBUG] MW-12 - extensions loaded OK');
      ext().updateExtensionsList(browserSession, mainWindow);

      setTimeout(() => {
        selectAllExistingTabs();
        console.log('[DEBUG] MW-12a - initial selectAllExistingTabs done');
      }, 500);

      setTimeout(() => {
        selectAllExistingTabs();
      }, 2000);

      setTimeout(() => {
        selectAllExistingTabs();
      }, 5000);

      if (hasExtensionBlocker(browserSession)) {
        console.log('[DEBUG] MW-13 - extension blocker found, skipping builtin adblocker');
      } else {
        console.log('[DEBUG] MW-13 - no extension blocker, registering builtin');
        registerBuiltinAdBlocker(browserSession);
      }
    }).catch((err) => {
      console.log('[DEBUG] MW-12-ERR - extension load failed:', err.message);
      registerBuiltinAdBlocker(browserSession);
    }).finally(() => {
      console.log('[DEBUG] MW-14 - finally block, setting isFullyLoaded');
      setTimeout(() => {
        isFullyLoaded = true;
        startPeriodicGC();
        mem().start();
        console.log('[DEBUG] MW-15 - startup complete, memory manager started');
        if (global.gc) global.gc();
        if (startupUrl) { pendingExternalUrls.unshift(startupUrl); startupUrl = null; }
        flushPendingUrls();
      }, 1000);
    });
  }

  function loadMainPage() {
    console.log('[DEBUG] MW-20 - loadMainPage called');
    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[DEBUG] MW-21 - index.html did-finish-load');
      onMainContentReady();
    });
  }

  ipcMain.on('skip-update', () => { console.log('[DEBUG] MW-30 - skip-update received'); if (mainWindow && !mainWindow.isDestroyed()) loadMainPage(); });

  console.log('[DEBUG] MW-6 - starting update check...');
  api().apiRequest(`/api/update/check?platform=${getUpdatePlatform()}`).then((result) => {
    console.log('[DEBUG] MW-7 - update check response:', result.ok);
    let hasUpdate = false, updateData = null;
    if (result.ok && result.data.success) {
      const remote = result.data.update;
      const current = app.getVersion();
      if (remote.version.localeCompare(current, undefined, { numeric: true, sensitivity: 'base' }) > 0 && remote.fileName) {
        hasUpdate = true;
        updateData = { currentVersion: current, remoteVersion: remote.version, releaseNotes: remote.releaseNotes, fileName: remote.fileName, sha256: remote.sha256 };
      }
    }
    if (hasUpdate) {
      console.log('[DEBUG] MW-8 - update available, loading update.html');
      mainWindow.loadFile(path.join(__dirname, 'src', 'update.html'));
      mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send('update-info', updateData));
    } else { console.log('[DEBUG] MW-8 - no update, loading main page'); loadMainPage(); }
  }).catch((err) => {
    console.log('[DEBUG] MW-7-ERR - update check failed:', err.message);
    loadMainPage();
  });

  let mainShown = false;
  function showMainWindow() {
    if (mainShown) return;
    mainShown = true;
    console.log('[DEBUG] MW-50 - showMainWindow called');

    if (loadingWindow && !loadingWindow.isDestroyed()) {
      console.log('[DEBUG] MW-50a - hiding loading window...');
      try {
        loadingWindow.setOpacity(0);
        loadingWindow.hide();
      } catch(e) {}
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[DEBUG] MW-50e - showing mainWindow...');
      mainWindow.show();
      mainWindow.maximize();
      console.log('[DEBUG] MW-50g - mainWindow shown + maximized');
    }

    cleanupLoadingWindow();

    console.log('[DEBUG] MW-50h - showMainWindow finished');
  }

  mainWindow.once('ready-to-show', () => {
    console.log('[DEBUG] MW-51 - ready-to-show fired');
    setTimeout(showMainWindow, 3500);
  });

  setTimeout(() => {
    console.log('[DEBUG] MW-52 - 12s fallback timer fired, mainShown:', mainShown);
    showMainWindow();
  }, 12000);

  touchbar().setupTouchBar(mainWindow, loadData);

  mainWindow.on('leave-full-screen', () => {
    if (isHtmlFullscreen) { isHtmlFullscreen = false; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('html-fullscreen-leave'); }
  });

  mainWindow.on('closed', () => {
    console.log('[DEBUG] MW-CLOSED - mainWindow closed event fired');
    mainWindow = null; isFullyLoaded = false;
    extensionBackgroundPages.clear(); pendingTabCallbacks.clear();
    lastSelectedTabId = null;
    if (pendingUrlFlushTimer) { clearInterval(pendingUrlFlushTimer); pendingUrlFlushTimer = null; }
    if (extMonitorTimer) { clearInterval(extMonitorTimer); extMonitorTimer = null; }
  });

  mainWindow.on('unresponsive', () => {
    console.log('[DEBUG] MW-UNRESPONSIVE - mainWindow became unresponsive');
  });

  mainWindow.webContents.on('destroyed', () => {
    console.log('[DEBUG] MW-WC-DESTROYED - webContents destroyed');
  });
}

app.whenReady().then(async () => {
  try {
    console.log('[DEBUG] 1 - app.whenReady fired');
    createPreloadScript(PRELOAD_PATH);
    console.log('[DEBUG] 2 - preload script created');
    ensureAddonIPC();
    console.log('[DEBUG] 3 - addon IPC registered');
    psw().registerIPC();
    console.log('[DEBUG] 3b - password manager IPC registered');

    const initData = (() => { try { if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch (e) {} return { settings: { drmEnabled: true } }; })();
    console.log('[DEBUG] 4 - initData loaded, drmEnabled:', initData.settings.drmEnabled);
    geoLocationPromise = geo().fetchRealGeolocation();
    console.log('[DEBUG] 5 - geo started');

    if (initData.settings && initData.settings.drmEnabled !== false) {
      console.log('[DEBUG] 6 - waiting for DRM components...');
      if (components && components.whenReady) {
        try {
          await components.whenReady();
          console.log('[DEBUG] 7 - components.whenReady resolved');
          await new Promise(r => setTimeout(r, 2000));
          console.log('[DEBUG] 8 - DRM 2s delay done');
        } catch (err) {
          console.log('[DEBUG] 7-ERR - components.whenReady failed:', err.message);
        }
      } else {
        console.log('[DEBUG] 6-SKIP - no components.whenReady');
      }
    } else {
      console.log('[DEBUG] 6-SKIP - DRM disabled');
    }

    app.on('child-process-gone', (event, details) => {
      console.log('[DEBUG] CHILD-PROCESS-GONE:', details.type, details.reason, 'exitCode:', details.exitCode, 'name:', details.name || 'unknown');
    });

    app.on('gpu-process-crashed', (event, killed) => {
      console.log('[DEBUG] GPU-PROCESS-CRASHED, killed:', killed);
    });

    app.on('browser-window-created', (event, window) => {
      if (isCreatingOwnWindow || allowedWindows.has(window)) return;
      const wc = window.webContents;
      if (!wc || wc.isDestroyed()) return;

      if (wc.getType() === 'backgroundPage') {
        allowedWindows.add(window);
        extensionWindows.add(window);
        return;
      }

    try { window.setOpacity(0); window.hide(); } catch(e) {}
      const initialUrl = wc.getURL();
      if (isExtensionUrl(initialUrl)) { allowedWindows.add(window); extensionWindows.add(window); return; }
      if (isOAuthUrl(initialUrl)) {
        allowedWindows.add(window);
        setupOAuthWindow(window);
        try { window.setOpacity(1); window.show(); window.center(); } catch(e) {}
        return;
      }
      let resolved = false;
      function destroyAsUnauthorized(url) {
        if (resolved) return; resolved = true;
        if (url && url !== 'about:blank') forwardUrlToRenderer(url);
        try { window.setOpacity(0); window.hide(); } catch(e) {}
        setTimeout(() => { try { if (window && !window.isDestroyed()) { window.removeAllListeners(); window.destroy(); } } catch(e) {} }, 50);
      }
      wc.on('did-navigate', (e, url) => {
        if (resolved) return;
        if (isExtensionUrl(url)) { resolved = true; allowedWindows.add(window); extensionWindows.add(window); window.setOpacity(0); window.hide(); }
        else if (isOAuthUrl(url)) { resolved = true; allowedWindows.add(window); try { window.setOpacity(1); window.show(); window.center(); } catch(e) {} }
        else if (url && url !== 'about:blank') destroyAsUnauthorized(url);
      });
      setTimeout(() => {
        if (resolved || window.isDestroyed()) return;
        const url = wc.isDestroyed() ? '' : wc.getURL();
        if (isExtensionUrl(url)) { resolved = true; allowedWindows.add(window); extensionWindows.add(window); window.setOpacity(0); window.hide(); }
        else {
          try { if (!wc.isDestroyed() && wc.getType() === 'backgroundPage') { resolved = true; allowedWindows.add(window); extensionWindows.add(window); return; } } catch(e) {}
          destroyAsUnauthorized(url);
        }
      }, 2000);
    });

    function injectGoogleAuthFix(wc) {
  if (!wc || wc.isDestroyed()) return;
  const chromeMajor = getChromeMajorVersion();
  wc.executeJavaScript(`
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {}, id: undefined };
      if (!window.chrome.csi) window.chrome.csi = () => ({});
      if (!window.chrome.loadTimes) window.chrome.loadTimes = () => ({});
      if (!window.chrome.app) window.chrome.app = { isInstalled: false, getIsInstalled: () => false, getDetails: () => null, runningState: () => 'cannot_run' };

      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: [
            { brand: 'Google Chrome', version: '${chromeMajor}' },
            { brand: 'Chromium', version: '${chromeMajor}' },
            { brand: 'Not-A.Brand', version: '24' }
          ],
          mobile: false,
          platform: '${IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'}',
          getHighEntropyValues: (hints) => Promise.resolve({
            brands: [
              { brand: 'Google Chrome', version: '${chromeMajor}' },
              { brand: 'Chromium', version: '${chromeMajor}' },
              { brand: 'Not-A.Brand', version: '24' }
            ],
            mobile: false,
            platform: '${IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'}',
            platformVersion: '${IS_WINDOWS ? '15.0.0' : IS_MAC ? '14.0.0' : '6.5.0'}',
            architecture: 'x86',
            bitness: '64',
            model: '',
            uaFullVersion: '${getFullChromeVersion()}'
          })
        })
      });

      if (window.process) delete window.process;
      if (window.require) delete window.require;
      if (window.module) delete window.module;
      if (window.exports) delete window.exports;
      if (window.__dirname) delete window.__dirname;
      if (window.__filename) delete window.__filename;
    } catch(e) {}
  `).catch(() => {});
}

function setupGoogleAuthHeaders(targetSession) {
  const chromeMajor = getChromeMajorVersion();
  const fullVersion = getFullChromeVersion();

  targetSession.webRequest.onBeforeSendHeaders({ urls: [
    '*://*.google.com/*',
    '*://accounts.google.com/*',
    '*://*.youtube.com/*',
    '*://*.googleapis.com/*',
    '*://*.gstatic.com/*'
  ]}, (details, callback) => {
    const headers = details.requestHeaders;

    headers['Sec-CH-UA'] = '"Google Chrome";v="' + chromeMajor + '", "Chromium";v="' + chromeMajor + '", "Not-A.Brand";v="24"';
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"' + (IS_WINDOWS ? 'Windows' : IS_MAC ? 'macOS' : 'Linux') + '"';
    headers['Sec-CH-UA-Platform-Version'] = '"' + (IS_WINDOWS ? '15.0.0' : IS_MAC ? '14.0.0' : '6.5.0') + '"';
    headers['Sec-CH-UA-Full-Version'] = '"' + fullVersion + '"';
    headers['Sec-CH-UA-Full-Version-List'] = '"Google Chrome";v="' + fullVersion + '", "Chromium";v="' + fullVersion + '", "Not-A.Brand";v="24.0.0.0"';
    headers['Sec-CH-UA-Arch'] = '"x86"';
    headers['Sec-CH-UA-Bitness'] = '"64"';
    headers['Sec-CH-UA-Model'] = '""';

    if (headers['User-Agent'] && (headers['User-Agent'].includes('Electron') || headers['User-Agent'].includes('electron'))) {
      headers['User-Agent'] = getChromeUserAgent();
    }

    callback({ requestHeaders: headers });
  });
}


function sendToMainWindow(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function setupTorWebContents(contents) {
  try { contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch (e) {}
  contents.setUserAgent(getChromeUserAgent());
  contents.setWindowOpenHandler((details) => {
    if (details.url && details.url !== 'about:blank') sendToMainWindow('open-tor-url', details.url);
    return { action: 'deny' };
  });
  contents.on('before-input-event', (event, input) => {
    if (input.control && input.key.toLowerCase() === 'w') { event.preventDefault(); sendToMainWindow('close-active-tab'); }
  });
  contents.on('enter-html-full-screen', () => { if (mainWindow && !mainWindow.isDestroyed()) { isHtmlFullscreen = true; mainWindow.setFullScreen(true); mainWindow.webContents.send('html-fullscreen-enter'); } });
  contents.on('leave-html-full-screen', () => { if (mainWindow && !mainWindow.isDestroyed()) { isHtmlFullscreen = false; mainWindow.setFullScreen(false); mainWindow.webContents.send('html-fullscreen-leave'); } });
}

app.on('web-contents-created', (event, contents) => {
      contents.setMaxListeners(25);
      if (tor().isTorContents(contents)) { setupTorWebContents(contents); return; }
      contents.setWindowOpenHandler((details) => {
        if (isExtensionUrl(details.url)) return { action: 'allow' };
        if (isOAuthUrl(details.url)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 600, height: 720, frame: true, autoHideMenuBar: true,
              webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, partition: 'persist:main', disableBlinkFeatures: 'AutomationControlled' }
            }
          };
        }
        if (details.url && details.url !== 'about:blank' && mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('open-external-url', details.url);
        return { action: 'deny' };
      });
      contents.on('did-create-window', (win, details) => {
        try { win.setOpacity(0); win.hide(); } catch(e) {}
        if (isExtensionUrl(details.url)) { allowedWindows.add(win); extensionWindows.add(win); return; }
        if (isOAuthUrl(details.url)) {
          allowedWindows.add(win);
          setupOAuthWindow(win);
          try { win.setOpacity(1); win.show(); win.center(); } catch(e) {}
          return;
        }
        if (details.url && details.url !== 'about:blank' && mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('open-external-url', details.url);
        setTimeout(() => { try { if (!win.isDestroyed()) { win.removeAllListeners(); win.destroy(); } } catch(e) {} }, 50);
      });
      if (contents.getType() === 'webview') {
        contents.on('did-attach', () => {
          try {
            const url = contents.getURL();
            if (url.startsWith('chrome-extension://')) {
              console.log('[DEBUG] EXT-WEBVIEW attached:', url, 'wcId:', contents.id);
            }
          } catch(e) {}
        });
        contents.on('before-input-event', (event, input) => {
          if (input.control && input.key.toLowerCase() === 'w') { event.preventDefault(); if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('close-active-tab'); }
        });
        contents.on('will-navigate', (navEvent, url) => {
          if (isDroppableFileUrl(url)) { navEvent.preventDefault(); if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('open-dropped-file', url); return; }
          if (url && url.includes('accounts.google.com') && (url.includes('/signin') || url.includes('/ServiceLogin') || url.includes('/o/oauth2') || url.includes('/AccountChooser'))) {
            navEvent.preventDefault();
            let cleanUrl = url.replace(/app=desktop/g, 'app=web');
            isCreatingOwnWindow = true;
            const authWin = new BrowserWindow({
              width: 600, height: 720, frame: true, autoHideMenuBar: true, parent: mainWindow,
              webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, partition: 'persist:main', disableBlinkFeatures: 'AutomationControlled' }
            });
            isCreatingOwnWindow = false;
            allowedWindows.add(authWin);
            setupOAuthWindow(authWin);
            authWin.loadURL(cleanUrl);
            authWin.show();
            authWin.center();
          }
        });
        contents.on('did-navigate', (e, url) => {
          if (!isExtensionUrl(url) && geo().domainHasGeolocationPermission(url)) setTimeout(() => geo().injectGeolocationToWebContents(contents), 500);
          if (!isExtensionUrl(url) && contents.id === activeTabWcId && extensions && mainWindow && !mainWindow.isDestroyed()) {
            try { extensions.selectTab(contents, mainWindow); } catch(e) {}
          }
          if (url && url.includes('accounts.google.com')) {
            injectGoogleAuthFix(contents);
          }
        });
        contents.on('did-navigate-in-page', (e, url) => { if (!isExtensionUrl(url) && geo().domainHasGeolocationPermission(url)) geo().injectGeolocationToWebContents(contents); });
        contents.on('did-finish-load', () => {
          try {
            const url = contents.getURL();
            if (!isExtensionUrl(url) && geo().domainHasGeolocationPermission(url)) geo().injectGeolocationToWebContents(contents);
            if (!isExtensionUrl(url) && contents.id === activeTabWcId && extensions && mainWindow && !mainWindow.isDestroyed()) {
              extensions.selectTab(contents, mainWindow);
            }
            if (url && url.includes('accounts.google.com')) {
              injectGoogleAuthFix(contents);
            }
          } catch(e) {}
        });
        let tabAdded = false;
        let isExtensionWebview = false;
        const tryAddTab = () => {
          if (isExtensionWebview || tabAdded) return;
          const wcUrl = contents.getURL();
          if (wcUrl && wcUrl.startsWith('chrome-extension://')) { isExtensionWebview = true; return; }
          console.log('[DEBUG] tryAddTab called, url:', wcUrl, 'extensions exists:', !!extensions, 'mainWindow exists:', !!(mainWindow && !mainWindow.isDestroyed()));
          if (extensions && mainWindow && !mainWindow.isDestroyed()) {
            try {
              extensions.addTab(contents, mainWindow);
              tabAdded = true;
              console.log('[DEBUG] addTab SUCCESS for:', wcUrl);
              if (activeTabWcId === null || activeTabWcId === contents.id) {
                extensions.selectTab(contents, mainWindow);
                activeTabWcId = contents.id;
                console.log('[DEBUG] selectTab auto-called for:', wcUrl);
              }
            } catch (err) { console.log('[DEBUG] addTab FAILED:', err.message); }
          } else {
            setTimeout(() => {
              if (isExtensionWebview || tabAdded) return;
              if (extensions && mainWindow && !mainWindow.isDestroyed() && !contents.isDestroyed()) {
                const retryUrl = contents.getURL();
                if (retryUrl && retryUrl.startsWith('chrome-extension://')) { isExtensionWebview = true; return; }
                try {
                  extensions.addTab(contents, mainWindow);
                  tabAdded = true;
                  console.log('[DEBUG] addTab SUCCESS (retry) for:', retryUrl);
                  if (activeTabWcId === null || activeTabWcId === contents.id) {
                    extensions.selectTab(contents, mainWindow);
                    activeTabWcId = contents.id;
                  }
                } catch (err) { console.log('[DEBUG] addTab FAILED (retry):', err.message); }
              }
            }, 500);
          }
        };
        setTimeout(() => {
          if (tabAdded || isExtensionWebview) return;
          try {
            const url = contents.getURL();
            if (url && url.startsWith('chrome-extension://')) { isExtensionWebview = true; return; }
          } catch(e) {}
          tryAddTab();
        }, 100);
        tryAddTab();
        contents.once('destroyed', () => { if (tabAdded && extensions) { try { extensions.removeTab(contents, mainWindow); } catch(e) {} } });
        contents.on('enter-html-full-screen', () => { if (mainWindow && !mainWindow.isDestroyed()) { isHtmlFullscreen = true; mainWindow.setFullScreen(true); mainWindow.webContents.send('html-fullscreen-enter'); } });
        contents.on('leave-html-full-screen', () => { if (mainWindow && !mainWindow.isDestroyed()) { isHtmlFullscreen = false; mainWindow.setFullScreen(false); mainWindow.webContents.send('html-fullscreen-leave'); } });
        contents.setUserAgent(getChromeUserAgent());
        contents.on('frame-created', (event, details) => {
          var frame = details.frame;
          frame.once('dom-ready', () => {
            try {
              var frameUrl = frame.url || '';
              if (frameUrl.includes('static.crunchyroll.com') || frameUrl.includes('player.html')) {
                frame.executeJavaScript(getDrmInjectCode()).catch(() => {});
              }
            } catch (e) {}
          });
        });
      }
    });

    const defaultSession = session.defaultSession;
    networking().applyChromeHeaders(defaultSession, devtoolsCustomUA);

    defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const url = details.url.toLowerCase();
      if (networking().isYouTubeOrGoogleVideo(url)) { callback({ cancel: false }); return; }
      if (networking().isCrunchyrollOrCDN(url)) { callback({ cancel: false }); return; }
      const filterSettings = getFilterSettings();
      if (filterSettings.httpsOnly && url.startsWith('http://') && !url.includes('localhost') && !url.includes('2.59.132.39')) { callback({ cancel: false, redirectURL: url.replace('http://', 'https://') }); return; }
      if (networking().shouldBlockAd(url, filterSettings.adBlocker)) { callback({ cancel: true }); return; }
      callback({ cancel: false });
    });

    const mainSession = session.fromPartition('persist:main');
    mainSession.cookies.set({ url: 'https://challenges.cloudflare.com', name: 'test', value: '1', sameSite: 'no_restriction', secure: true }).catch(() => {});
    mainSession.cookies.set({ url: 'https://www.crunchyroll.com', name: 'test', value: '1', sameSite: 'no_restriction', secure: true }).catch(() => {});

    mainSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = details.responseHeaders || {};
      try {
        const url = new URL(details.url);

        if (url.hostname.includes('youtube.com') || url.hostname.includes('googlevideo.com') || url.hostname.includes('ytimg.com')) {
          const cspKeys = Object.keys(headers).filter(k => k.toLowerCase() === 'content-security-policy');
          cspKeys.forEach(k => { if (Array.isArray(headers[k])) headers[k] = headers[k].map(v => v.replace(/require-trusted-types-for\s+'script'\s*;?/gi, '').replace(/trusted-types\s+[^;]*;?/gi, '')); });
          callback({ responseHeaders: headers }); return;
        }

        if (isCrunchyrollDomain(url.hostname) || url.hostname.includes('akamaized.net') || url.hostname.includes('cr-play') || url.hostname.includes('cr-license')) {
          delete headers['x-frame-options'];
          delete headers['X-Frame-Options'];
          Object.keys(headers).filter(k => k.toLowerCase() === 'content-security-policy').forEach(k => delete headers[k]);
          Object.keys(headers).filter(k => k.toLowerCase() === 'content-security-policy-report-only').forEach(k => delete headers[k]);
          if (!Object.keys(headers).find(k => k.toLowerCase() === 'access-control-allow-origin')) headers['Access-Control-Allow-Origin'] = ['https://static.crunchyroll.com'];
          if (!Object.keys(headers).find(k => k.toLowerCase() === 'access-control-allow-credentials')) headers['Access-Control-Allow-Credentials'] = ['true'];
          if (!Object.keys(headers).find(k => k.toLowerCase() === 'access-control-allow-headers')) headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization'];
          callback({ responseHeaders: headers }); return;
        }

        if (url.hostname.includes('cloudflare.com') || url.hostname.includes('hcaptcha.com')) {
          delete headers['x-frame-options']; delete headers['X-Frame-Options'];
          Object.keys(headers).filter(k => k.toLowerCase() === 'content-security-policy').forEach(k => delete headers[k]);
        }
      } catch(e) {}
      callback({ responseHeaders: headers });
    });

    setupPermissionHandlers(mainSession);

    tor().getTorSession();
    tor().events.on('state', (st) => sendToMainWindow('tor-state', st));

    defaultSession.webRequest.onErrorOccurred((details) => {
      if (['net::ERR_SSL_PROTOCOL_ERROR', 'net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID'].includes(details.error)) {
        if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('https-error', { url: details.url, error: details.error });
      }
    });
    mainSession.webRequest.onErrorOccurred((details) => {
      if (isExtensionUrl(details.url)) return;
      if (['net::ERR_SSL_PROTOCOL_ERROR', 'net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID'].includes(details.error)) {
        if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('https-error', { url: details.url, error: details.error });
      }
    });

    console.log('[DEBUG] 20 - setting up sessions done');

    const data = getCachedData();
    if (data.settings.proxyEnabled && data.settings.proxyServer) networking().applyProxySettings(data.settings.proxyEnabled, data.settings.proxyServer);

    console.log('[DEBUG] 21 - firstRun:', data.firstRun);

    if (data.firstRun) {
      createLoadingWindow(data.settings.loadingScreen);
      setTimeout(() => { if (loadingWindow) { loadingWindow.close(); loadingWindow = null; } createSetupWindow(); }, 3000);
    } else {
      console.log('[DEBUG] 22 - creating loading window:', data.settings.loadingScreen);
      createLoadingWindow(data.settings.loadingScreen);
      console.log('[DEBUG] 23 - creating main window...');
      createMainWindow();
      console.log('[DEBUG] 24 - createMainWindow() returned');
    }
  } catch(e) { console.log('[DEBUG] FATAL ERROR:', e.stack || e.message); dialog.showErrorBox('Startup Error', e.stack || e.message); }
});

ipcMain.handle('check-update', async () => {
  const result = await api().apiRequest(`/api/update/check?platform=${getUpdatePlatform()}`);
  if (!result.ok || !result.data.success) return { success: false, error: result.error || 'API Fehler' };
  const remote = result.data.update;
  const current = app.getVersion();
  const isNewer = remote.version.localeCompare(current, undefined, { numeric: true, sensitivity: 'base' }) > 0;
  return { success: true, hasUpdate: isNewer, currentVersion: current, remoteVersion: remote.version, releaseNotes: remote.releaseNotes, releaseDate: remote.releaseDate, fileName: remote.fileName, sha256: remote.sha256 };
});

ipcMain.handle('download-install-update', async (event, { fileName, sha256 }) => {
  const safeName = path.basename(fileName);
  const tmpPath = path.join(app.getPath('temp'), safeName);
  const http = require('http');
  const { createHash } = require('crypto');
  const { UPDATE_API, AQUILA_KEY } = api();
  return new Promise((resolve) => {
    const req = http.get(`${UPDATE_API}/api/update/download?platform=${getUpdatePlatform()}`, { headers: { 'X-Aquila-Key': AQUILA_KEY } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve({ success: false, error: `Server antwortete mit ${res.statusCode}` }); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0, fakePercent = 0;
      const chunks = [];
      const fakeInterval = total === 0 ? setInterval(() => { fakePercent = Math.min(fakePercent + 1, 95); if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-progress', { percent: fakePercent, receivedBytes: received, totalBytes: 0 }); }, 800) : null;
      res.on('data', (chunk) => { chunks.push(chunk); received += chunk.length; const percent = total > 0 ? Math.round((received / total) * 100) : 0; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-download-progress', { percent, receivedBytes: received, totalBytes: total }); });
      res.on('end', () => {
        if (fakeInterval) clearInterval(fakeInterval);
        try {
          const buffer = Buffer.concat(chunks);
          if (sha256) { const hash = createHash('sha256').update(buffer).digest('hex'); if (hash !== sha256) { resolve({ success: false, error: 'SHA256 Prüfung fehlgeschlagen' }); return; } }
          fs.writeFileSync(tmpPath, buffer);
          if (IS_LINUX) {
            const lower = safeName.toLowerCase();
            if (lower.endsWith('.appimage')) { fs.chmodSync(tmpPath, '755'); require('child_process').exec(`"${tmpPath}"`, () => {}); setTimeout(() => app.quit(), 1500); resolve({ success: true }); }
            else if (lower.endsWith('.deb')) { require('child_process').exec(`xdg-open "${tmpPath}"`, () => {}); setTimeout(() => app.quit(), 2000); resolve({ success: true }); }
            else { shell.openPath(tmpPath).then(() => { setTimeout(() => app.quit(), 1500); resolve({ success: true }); }).catch((e) => resolve({ success: false, error: e.message })); }
          } else {
            shell.openPath(tmpPath).then(() => { setTimeout(() => app.quit(), IS_MAC ? 2000 : 1500); resolve({ success: true }); }).catch((e) => resolve({ success: false, error: e.message }));
          }
        } catch (e) { resolve({ success: false, error: e.message }); }
      });
      res.on('error', (e) => resolve({ success: false, error: e.message }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
});

ipcMain.handle('register-default-browser', async () => {
  const result = await defBrowser().registerAsDefaultBrowser();
  if (result.success) {
    if (IS_WINDOWS) { await new Promise(r => setTimeout(r, 500)); shell.openExternal('ms-settings:defaultapps'); return { success: true, message: 'Browser wurde registriert!' }; }
    if (IS_MAC) { shell.openExternal('x-apple.systempreferences:com.apple.preference.general'); return { success: true, message: result.message || 'Browser wurde registriert!' }; }
    return { success: true, message: 'Browser wurde als Standard registriert!' };
  }
  return { success: false, error: result.error };
});

ipcMain.handle('check-default-browser-status', async () => defBrowser().checkIfDefaultBrowser());
ipcMain.handle('set-proxy-enabled', async (event, { enabled, server }) => ({ success: await networking().applyProxySettings(enabled, server) }));
ipcMain.handle('test-proxy', async (event, server) => ({ success: await networking().testProxyConnection(server) }));
ipcMain.handle('get-proxy-state', () => ({ ...networking().proxyState }));

function getTorSettings() {
  const data = loadData();
  return { exitCountry: '', bridges: 'none', customBridges: '', binaryPath: '', ...(data.settings.tor || {}) };
}
ipcMain.handle('tor-get-state', () => ({ ...tor().getState(), settings: getTorSettings() }));
ipcMain.handle('tor-start', () => tor().start(getTorSettings()));
ipcMain.handle('tor-stop', () => tor().stop());
ipcMain.handle('tor-restart', async () => { await tor().stop(); return tor().start(getTorSettings()); });
ipcMain.handle('tor-new-circuit', async () => { try { return { success: true, state: await tor().newCircuit() }; } catch (e) { return { success: false, error: e.message }; } });
ipcMain.handle('tor-new-identity', async () => { try { return { success: true, state: await tor().newIdentity() }; } catch (e) { return { success: false, error: e.message }; } });
ipcMain.handle('tor-refresh-ip', () => tor().refreshExitIp());
ipcMain.handle('tor-save-settings', async (event, patch) => {
  const data = loadData();
  const current = getTorSettings();
  const next = { ...current };
  if (patch && typeof patch.exitCountry === 'string') next.exitCountry = /^[a-z]{2}$/i.test(patch.exitCountry) ? patch.exitCountry.toLowerCase() : '';
  if (patch && ['none', 'obfs4', 'snowflake', 'meek', 'custom'].includes(patch.bridges)) next.bridges = patch.bridges;
  if (patch && typeof patch.customBridges === 'string') next.customBridges = patch.customBridges.slice(0, 20000);
  if (patch && typeof patch.binaryPath === 'string') next.binaryPath = patch.binaryPath.trim();
  data.settings.tor = next;
  saveData(data);
  invalidateCache();

  const st = tor().getState();
  const running = ['connected', 'connecting', 'starting'].includes(st.status);
  const needsRestart = next.bridges !== current.bridges || next.customBridges !== current.customBridges || next.binaryPath !== current.binaryPath;
  if (running && needsRestart) { await tor().stop(); tor().start(next); }
  else if (next.exitCountry !== current.exitCountry) { try { await tor().setExitCountry(next.exitCountry); } catch (e) {} }
  return { ...tor().getState(), settings: next };
});
ipcMain.handle('get-pending-urls', () => { const urls = [...pendingExternalUrls]; pendingExternalUrls = []; if (startupUrl) { urls.unshift(startupUrl); startupUrl = null; } return urls; });
ipcMain.handle('open-dropped-pdf', (event, filePath) => { const p = path.resolve(filePath); return (fs.existsSync(p) && p.toLowerCase().endsWith('.pdf')) ? `file://${p.replace(/\\/g, '/')}` : null; });
ipcMain.handle('open-download-file', (event, filePath) => { try { if (filePath && fs.existsSync(filePath)) { shell.openPath(filePath); return { success: true }; } return { success: false, error: 'Datei nicht gefunden' }; } catch (e) { return { success: false, error: e.message }; } });
ipcMain.handle('show-download-in-folder', (event, filePath) => { try { if (filePath && fs.existsSync(filePath)) { shell.showItemInFolder(filePath); return { success: true }; } } catch (e) {} return { success: false }; });
ipcMain.handle('check-download-safety', (event, filePath) => downloads().checkDownloadSafety(filePath));
ipcMain.handle('verify-dropped-file', (event, filePath) => { try { const p = path.resolve(filePath); if (fs.existsSync(p)) { const exts = ['.pdf', '.html', '.htm', '.svg', '.txt', '.xml', '.json', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif', '.avif']; return exts.some(ext => p.toLowerCase().endsWith(ext)); } } catch (e) {} return false; });
ipcMain.handle('show-open-dialog', async (event, options) => dialog.showOpenDialog(mainWindow, options));
ipcMain.handle('save-custom-background', async (event, sourcePath) => { try { if (!fs.existsSync(BACKGROUNDS_PATH)) fs.mkdirSync(BACKGROUNDS_PATH, { recursive: true }); const ext = path.extname(sourcePath).toLowerCase(); const destPath = path.join(BACKGROUNDS_PATH, `custom-bg${ext}`); fs.readdirSync(BACKGROUNDS_PATH).filter(f => f.startsWith('custom-bg')).forEach(f => { try { fs.unlinkSync(path.join(BACKGROUNDS_PATH, f)); } catch (e) {} }); fs.copyFileSync(sourcePath, destPath); return destPath; } catch (e) { return null; } });
ipcMain.handle('remove-custom-background', async (event, filePath) => { try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {} return true; });
ipcMain.handle('exit-html-fullscreen', () => { if (isHtmlFullscreen && mainWindow && !mainWindow.isDestroyed()) { isHtmlFullscreen = false; mainWindow.setFullScreen(false); mainWindow.webContents.send('html-fullscreen-leave'); } return true; });

ipcMain.handle('select-tab', (event, webContentsId) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      selectTabForExtensions(wc);
    }
  } catch (e) {}
  return true;
});

let activeTabWcId = null;

ipcMain.on('set-active-tab-wc', (event, wcId) => {
  activeTabWcId = wcId;
  try {
    const wc = webContents.fromId(wcId);
    if (wc && !wc.isDestroyed() && !tor().isTorContents(wc) && extensions && mainWindow && !mainWindow.isDestroyed()) {
      extensions.selectTab(wc, mainWindow);
    }
  } catch (e) {}
});


ipcMain.on('tab-activated', (event, webContentsId) => {
  try {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      selectTabForExtensions(wc);
    }
  } catch(e) {}
});

ipcMain.on('extension-open-options', (event, url) => { if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('extension-create-tab', url); });
ipcMain.handle('get-extension-options-url', (event, extensionId) => { try { const e = Array.from(session.fromPartition('persist:main').getAllExtensions()).find(x => x.id === extensionId); if (!e || !e.manifest) return null; const p = (e.manifest.options_ui && e.manifest.options_ui.page) || e.manifest.options_page; return p ? `chrome-extension://${extensionId}/${p.replace(/^\//, '')}` : null; } catch(e) { return null; } });
ipcMain.handle('list-all-webcontents', async () => { try { return webContents.getAllWebContents().map(wc => { try { return { id: wc.id, url: wc.getURL(), type: wc.getType() }; } catch(e) { return { id: 'unknown', error: e.message }; } }); } catch(e) { return []; } });
ipcMain.handle('force-gc', () => { if (global.gc) { global.gc(); return { success: true }; } return { success: false }; });

ipcMain.handle('install-extension', async (event, extensionId) => {
  try {
    const browserSession = session.fromPartition('persist:main');

    const alreadyLoaded = Array.from(browserSession.getAllExtensions()).find(e => e.id === extensionId);
    if (alreadyLoaded) {
      try { browserSession.removeExtension(extensionId); } catch (err) {}
    }

    const { installExtension } = require('@iamevan/electron-chrome-web-store');
    await installExtension(extensionId, { session: browserSession, extensionsPath: EXTENSIONS_PATH });
    ext().invalidateExtensionsCache();
    await ext().loadExistingExtensions(browserSession, EXTENSIONS_PATH);
    ext().updateExtensionsList(browserSession, mainWindow);

    setTimeout(() => { selectAllExistingTabs(); }, 1000);

    if (global.gc) setTimeout(() => { if (global.gc) global.gc(); }, 2000);
    return { success: true };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('uninstall-extension', async (event, extensionId) => {
    console.log('[UNINSTALL-EXT] Start, extensionId:', extensionId);
    try {
        const browserSession = session.fromPartition('persist:main');

        try { 
            browserSession.removeExtension(extensionId);
            console.log('[UNINSTALL-EXT] removeExtension OK');
        } catch (err) {
            console.log('[UNINSTALL-EXT] removeExtension FAILED:', err.message);
        }

        webContents.getAllWebContents().forEach(wc => {
            try {
                const url = wc.getURL();
                if (url.startsWith('chrome-extension://' + extensionId + '/')) {
                    console.log('[UNINSTALL-EXT] destroying webcontents:', url);
                    wc.destroy();
                }
            } catch(e) {
                console.log('[UNINSTALL-EXT] webcontents destroy error:', e.message);
            }
        });

        const extDir = path.join(EXTENSIONS_PATH, extensionId);
        console.log('[UNINSTALL-EXT] extDir:', extDir);
        console.log('[UNINSTALL-EXT] extDir exists:', fs.existsSync(extDir));

        if (fs.existsSync(extDir)) {
            fs.rmSync(extDir, { recursive: true, force: true });
            console.log('[UNINSTALL-EXT] rmSync done, exists after:', fs.existsSync(extDir));
        } else {
            console.log('[UNINSTALL-EXT] WARNING: extDir not found, nothing deleted');
        }

        extensionBackgroundPages.delete(extensionId);
        ext().invalidateExtensionsCache();
        ext().updateExtensionsList(browserSession, mainWindow);
        console.log('[UNINSTALL-EXT] cache invalidated, list updated');

        if (!hasExtensionBlocker(browserSession) && !builtinBlockerRegistered) {
            registerBuiltinAdBlocker(browserSession);
        }

        if (global.gc) global.gc();
        console.log('[UNINSTALL-EXT] SUCCESS');
        return { success: true };
    } catch (error) {
        console.log('[UNINSTALL-EXT] FATAL ERROR:', error.message, error.stack);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-extensions', () => { try { return Array.from(session.fromPartition('persist:main').getAllExtensions()).map(e => ({ id: e.id, name: e.name, version: e.version, enabled: true, path: e.path, manifest: e.manifest })); } catch (error) { return getCachedData().extensions || []; } });
ipcMain.handle('get-extension-memory', () => {
  const stats = mem().getStats();
  return {
    perProcess: stats.bgPages.reduce((acc, bp) => { acc[bp.url || 'background'] = bp.memoryMB; return acc; }, {}),
    totalMB: stats.totalExtMB,
    limitMB: 0
  };
});
ipcMain.handle('force-extension-cleanup', () => {
  mem().forceGCOnBackgroundPages();
  mem().trimBackgroundPageMemory();
  setTimeout(() => { if (global.gc) global.gc(); }, 1000);
  return { success: true };
});

ipcMain.on('setup-complete', (event, settings) => { const data = loadData(); data.firstRun = false; data.settings = { ...data.settings, ...settings }; saveData(data); invalidateCache(); if (setupWindow) { setupWindow.close(); setupWindow = null; } createLoadingWindow(data.settings.loadingScreen); createMainWindow(); });
ipcMain.handle('get-data', () => loadData());
ipcMain.handle('save-data', (event, data) => { saveData(data); invalidateCache(); return true; });
ipcMain.handle('delete-permission', (event, { domain, type }) => { const data = loadData(); if (!data.permissions) data.permissions = []; data.permissions = data.permissions.filter(p => !(p.domain === domain && p.type === type)); saveData(data); invalidateCache(); return data.permissions; });

let previousCPUTimes = (() => { const cpus = os.cpus(); let totalIdle = 0, totalTick = 0; cpus.forEach(cpu => { for (let type in cpu.times) totalTick += cpu.times[type]; totalIdle += cpu.times.idle; }); return { idle: totalIdle, total: totalTick }; })();

ipcMain.handle('get-performance-stats', async () => {
  const totalMemory = os.totalmem(); const freeMemory = os.freemem(); const usedMemory = totalMemory - freeMemory;
  const currentCPU = (() => { const cpus = os.cpus(); let ti = 0, tt = 0; cpus.forEach(cpu => { for (let t in cpu.times) tt += cpu.times[t]; ti += cpu.times.idle; }); return { idle: ti, total: tt }; })();
  const cpuUsagePercent = (currentCPU.total - previousCPUTimes.total) > 0 ? Math.round(100 - ((currentCPU.idle - previousCPUTimes.idle) / (currentCPU.total - previousCPUTimes.total) * 100)) : 0;
  previousCPUTimes = currentCPU;
  let browserMemoryMB = 0, browserCPUPercent = 0;
  try { const m = app.getAppMetrics(); let tk = 0, tc = 0; m.forEach(x => { if (x.memory && x.memory.workingSetSize) tk += x.memory.workingSetSize; if (x.cpu && typeof x.cpu.percentCPUUsage === 'number') tc += x.cpu.percentCPUUsage; }); browserMemoryMB = tk > 0 ? Math.round(tk / 1024) : Math.round(process.memoryUsage().rss / (1024 * 1024)); browserCPUPercent = Math.min(100, Math.max(0, Math.round(tc))); } catch (e) { browserMemoryMB = Math.round(process.memoryUsage().rss / (1024 * 1024)); }
  const totalMB = Math.round(totalMemory / (1024 * 1024));
  return { system: { ram: { used: Math.round(usedMemory / (1024 * 1024)), total: totalMB, percent: Math.round((usedMemory / totalMemory) * 100) }, cpu: { percent: cpuUsagePercent, cores: os.cpus().length } }, browser: { ram: { used: browserMemoryMB, percent: Math.round((browserMemoryMB / totalMB) * 100) }, cpu: { percent: browserCPUPercent } }, extensions: { ram: { used: getTotalExtensionMemoryMB(), limit: 0 } } };
});

ipcMain.handle('add-bookmark', (event, bookmark) => { const data = loadData(); data.bookmarks.push({ ...bookmark, id: Date.now(), timestamp: new Date().toISOString() }); saveData(data); invalidateCache(); touchbar().setupTouchBar(mainWindow, loadData); return data.bookmarks; });
ipcMain.handle('delete-bookmark', (event, id) => { const data = loadData(); data.bookmarks = data.bookmarks.filter(b => b.id !== id); saveData(data); invalidateCache(); touchbar().setupTouchBar(mainWindow, loadData); return data.bookmarks; });
ipcMain.handle('add-history', (event, entry) => { const data = loadData(); if (!data.settings.incognito) { data.history.unshift({ ...entry, id: Date.now(), timestamp: new Date().toISOString() }); if (data.history.length > 1000) data.history = data.history.slice(0, 1000); saveData(data); invalidateCache(); } return data.history; });
ipcMain.handle('delete-history-entry', (event, id) => { const data = loadData(); data.history = data.history.filter(h => h.id !== id); saveData(data); invalidateCache(); return data.history; });
ipcMain.handle('clear-history', () => { const data = loadData(); data.history = []; saveData(data); invalidateCache(); return true; });
ipcMain.handle('add-download', (event, download) => { const data = loadData(); data.downloads.unshift({ ...download, id: Date.now(), timestamp: new Date().toISOString() }); saveData(data); invalidateCache(); return data.downloads; });
ipcMain.handle('add-quick-access', (event, item) => { const data = loadData(); data.quickAccess.push(item); saveData(data); invalidateCache(); touchbar().setupTouchBar(mainWindow, loadData); return data.quickAccess; });
ipcMain.handle('delete-quick-access', (event, index) => { const data = loadData(); data.quickAccess.splice(index, 1); saveData(data); invalidateCache(); touchbar().setupTouchBar(mainWindow, loadData); return data.quickAccess; });
ipcMain.handle('update-setting', (event, { key, value }) => { const data = loadData(); data.settings[key] = value; saveData(data); invalidateCache(); return true; });
ipcMain.handle('get-error-page-path', () => `file://${path.join(__dirname, 'src', 'error-page.html')}`);
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => { if (mainWindow) { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); } return mainWindow ? mainWindow.isMaximized() : false; });
ipcMain.handle('window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('before-app-close'); mainWindow.close(); } });
ipcMain.handle('open-devtools', (event, webContentsId) => { try { const wc = webContents.fromId(webContentsId); if (wc && !wc.isDestroyed()) { wc.openDevTools({ mode: 'detach' }); return { success: true }; } } catch (err) {} return { success: false }; });

ipcMain.handle('export-browser-data', async () => {
  try {
    const data = loadData();
    const exportData = { exportDate: new Date().toISOString(), browserVersion: app.getVersion(), source: 'Aquila Browser', bookmarks: data.bookmarks, history: data.history, quickAccess: data.quickAccess, settings: data.settings };
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Browser-Daten exportieren', defaultPath: `aquila-export-${new Date().toISOString().split('T')[0]}.json`, filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
    if (!result.canceled && result.filePath) { fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2)); return { success: true, path: result.filePath }; }
  } catch (err) {}
  return { success: false };
});

ipcMain.handle('import-browser-data', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Browser-Daten importieren', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (!result.canceled && result.filePaths.length > 0) {
      const importData = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const data = loadData();
      if (importData.bookmarks) { const existing = new Set(data.bookmarks.map(b => b.url)); importData.bookmarks.forEach(b => { if (!existing.has(b.url)) data.bookmarks.push(b); }); }
      if (importData.history) data.history = [...importData.history, ...data.history].slice(0, 1000);
      if (importData.quickAccess) data.quickAccess = importData.quickAccess;
      saveData(data);
      invalidateCache();
      return { success: true, count: { bookmarks: (importData.bookmarks || []).length, history: (importData.history || []).length } };
    }
  } catch (err) { return { success: false, error: err.message }; }
  return { success: false };
});

ipcMain.handle('save-page-as-pdf', async (event, webContentsId) => { try { const wc = webContents.fromId(webContentsId); if (!wc || wc.isDestroyed()) return { success: false }; const title = wc.getTitle() || 'page'; const result = await dialog.showSaveDialog(mainWindow, { title: 'Als PDF speichern', defaultPath: `${title.replace(/[<>:"/\\|?*]/g, '_')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (!result.canceled && result.filePath) { fs.writeFileSync(result.filePath, await wc.printToPDF({ printBackground: true })); return { success: true, path: result.filePath }; } } catch (err) {} return { success: false }; });
ipcMain.handle('save-page', async (event, webContentsId) => { try { const wc = webContents.fromId(webContentsId); if (!wc || wc.isDestroyed()) return { success: false }; const title = wc.getTitle() || 'page'; const result = await dialog.showSaveDialog(mainWindow, { title: 'Speichern unter', defaultPath: `${title.replace(/[<>:"/\\|?*]/g, '_')}.html`, filters: [{ name: 'Webseite (komplett)', extensions: ['html'] }, { name: 'Alle Dateien', extensions: ['*'] }] }); if (!result.canceled && result.filePath) { await wc.savePage(result.filePath, 'HTMLComplete'); return { success: true }; } } catch (err) {} return { success: false }; });
ipcMain.handle('print-page', (event, webContentsId) => { try { const wc = webContents.fromId(webContentsId); if (wc && !wc.isDestroyed()) wc.print(); } catch (err) {} });
ipcMain.handle('toggle-fullscreen', () => { if (mainWindow) { mainWindow.setFullScreen(!mainWindow.isFullScreen()); return mainWindow.isFullScreen(); } return false; });

ipcMain.handle('fetch-partners', async () => {
  const http = require('http');
  const { AQUILA_KEY } = api();
  return new Promise((resolve) => {
    const req = http.get('http://2.59.132.39:3000/api/partners', { timeout: 8000, headers: { 'X-Aquila-Key': AQUILA_KEY } }, (res) => {
      let data = ''; res.on('data', (chunk) => { data += chunk; }); res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false, partners: [], error: 'JSON Parse Error' }); } });
    });
    req.on('error', (e) => resolve({ success: false, partners: [], error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ success: false, partners: [], error: 'Timeout' }); });
  });
});

ipcMain.handle('save-session', (event, sessionTabs) => { const data = loadData(); data.lastSession = sessionTabs || []; saveData(data); invalidateCache(); return true; });
ipcMain.handle('get-session', () => getCachedData().lastSession || []);
ipcMain.handle('clear-session', () => { const data = loadData(); data.lastSession = []; saveData(data); invalidateCache(); return true; });
ipcMain.handle('devtools-set-ua', (event, ua) => { devtoolsCustomUA = ua || null; return true; });
ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-autostart', (event, enabled) => {
  if (IS_LINUX) {
    try {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'aquila-browser.desktop');
      if (enabled) { if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true }); fs.writeFileSync(desktopFile, `[Desktop Entry]\nType=Application\nName=Aquila Browser\nExec="${app.getPath('exe')}"\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n`); }
      else { if (fs.existsSync(desktopFile)) fs.unlinkSync(desktopFile); }
    } catch (e) {}
  } else { app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') }); }
  return true;
});
ipcMain.handle('get-platform', () => IS_WINDOWS ? 'windows' : IS_MAC ? 'macos' : 'linux');

app.on('before-quit', () => {
  console.log('[DEBUG] APP-BEFORE-QUIT fired');
});

app.on('will-quit', () => {
  console.log('[DEBUG] APP-WILL-QUIT fired');
  if (_torModule) _torModule.shutdown();
});

app.on('window-all-closed', () => {
  console.log('[DEBUG] APP-WINDOW-ALL-CLOSED fired');
  mem().stop();
  if (resourceThrottleTimer) clearInterval(resourceThrottleTimer);
  if (extMonitorTimer) clearInterval(extMonitorTimer);
  if (pendingUrlFlushTimer) { clearInterval(pendingUrlFlushTimer); pendingUrlFlushTimer = null; }
  extensionBackgroundPages.clear(); pendingTabCallbacks.clear();
  lastSelectedTabId = null;
  if (!IS_MAC) app.quit();
});

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });