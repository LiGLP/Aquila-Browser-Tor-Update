const REAL_CHROME_VERSION = process.versions.chrome || '134.0.6998.44';
const REAL_CHROME_MAJOR = REAL_CHROME_VERSION.split('.')[0];
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${REAL_CHROME_VERSION} Safari/537.36`;

Object.defineProperty(navigator, 'userAgent', { get: () => CHROME_UA, configurable: true });
Object.defineProperty(navigator, 'appVersion', { get: () => `5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${REAL_CHROME_VERSION} Safari/537.36`, configurable: true });
Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });
Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'], configurable: true });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });

try {
    const brands = [
        { brand: 'Chromium', version: REAL_CHROME_MAJOR },
        { brand: 'Google Chrome', version: REAL_CHROME_MAJOR },
        { brand: 'Not-A.Brand', version: '24' }
    ];
    const fullVersionList = [
        { brand: 'Chromium', version: REAL_CHROME_VERSION },
        { brand: 'Google Chrome', version: REAL_CHROME_VERSION },
        { brand: 'Not-A.Brand', version: '24.0.0.0' }
    ];
    const uaData = {
        brands: Object.freeze(brands.map(b => Object.freeze({ ...b }))),
        mobile: false,
        platform: 'Windows',
        getHighEntropyValues: (hints) => Promise.resolve({
            brands: Object.freeze(brands.map(b => Object.freeze({ ...b }))),
            fullVersionList: Object.freeze(fullVersionList.map(b => Object.freeze({ ...b }))),
            mobile: false, model: '', platform: 'Windows',
            platformVersion: '15.0.0', architecture: 'x86',
            bitness: '64', uaFullVersion: REAL_CHROME_VERSION, wow64: false
        }),
        toJSON: () => ({ brands, mobile: false, platform: 'Windows' })
    };
    try { Object.setPrototypeOf(uaData, NavigatorUAData.prototype); } catch(e) {}
    Object.defineProperty(navigator, 'userAgentData', { get: () => uaData, configurable: true });
} catch(e) {}

try { delete window.process; } catch(e) {}
try { delete window.module; } catch(e) {}
try { delete window.require; } catch(e) {}

['process', 'module', 'require', 'exports', '__dirname', '__filename', 'Buffer'].forEach(prop => {
    try { Object.defineProperty(window, prop, { get: () => undefined, set: () => {}, configurable: true }); } catch(e) {}
});

if (!window.chrome) window.chrome = {};

if (!window.chrome.app) {
    window.chrome.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
        runningState: () => 'cannot_run'
    };
}

if (!window.chrome.runtime) {
    window.chrome.runtime = {
        connect: () => ({
            name: '', disconnect: () => {},
            postMessage: () => {},
            onMessage: { addListener: () => {}, removeListener: () => {}, hasListeners: () => false },
            onDisconnect: { addListener: () => {}, removeListener: () => {}, hasListeners: () => false }
        }),
        sendMessage: (...args) => { if (typeof args[args.length - 1] === 'function') args[args.length - 1](undefined); },
        getManifest: () => undefined,
        getURL: () => '',
        id: undefined
    };
}

if (!window.chrome.webstore) {
    window.chrome.webstore = {
        install: () => {},
        onInstallStageChanged: { addListener: () => {}, removeListener: () => {} },
        onDownloadProgress: { addListener: () => {}, removeListener: () => {} }
    };
}

if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 0.1,
        startLoadTime: Date.now() / 1000 - 0.1,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
    });
}

if (!window.chrome.csi) {
    window.chrome.csi = () => ({ onloadT: Date.now(), pageT: Date.now() / 1000, startE: Date.now(), tran: 15 });
}

try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
} catch(e) {}

try {
    const oGP = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Google Inc. (NVIDIA)';
        if (p === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return oGP.call(this, p);
    };
} catch(e) {}

try {
    const oGP2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Google Inc. (NVIDIA)';
        if (p === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return oGP2.call(this, p);
    };
} catch(e) {}

try {
    const origToString = Function.prototype.toString;
    const nativeMap = new WeakMap();
    const markNative = (fn, name) => nativeMap.set(fn, `function ${name}() { [native code] }`);
    Function.prototype.toString = function() {
        return nativeMap.has(this) ? nativeMap.get(this) : origToString.call(this);
    };
    markNative(Function.prototype.toString, 'toString');
    if (window.chrome.loadTimes) markNative(window.chrome.loadTimes, 'loadTimes');
    if (window.chrome.csi) markNative(window.chrome.csi, 'csi');
} catch(e) {}