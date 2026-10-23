const fs = require('fs');
const { PLATFORM, getFullChromeVersion, getChromeMajorVersion } = require('./platform');

function createPreloadScript(preloadPath) {
  const fullVersion = getFullChromeVersion();
  const major = getChromeMajorVersion();
  const script = `(function() {
  'use strict';

  if (window.location.protocol === 'chrome-extension:') {
    return;
  }

  var h = window.location.hostname;

  if (h.includes('youtube.com') || h.includes('googlevideo.com') || h.includes('ytimg.com')) {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
    try { delete navigator.__proto__.webdriver; } catch(e) {}
    return;
  }

  if (h === 'challenges.cloudflare.com' || h.endsWith('.cloudflare.com') || h.endsWith('.hcaptcha.com')) {
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
    try { delete navigator.__proto__.webdriver; } catch(e) {}
    return;
  }

  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true
  });
  try { delete navigator.__proto__.webdriver; } catch(e) {}

  var __aquilaGeoCoords = null;
  var __aquilaGeoPending = [];
  var __aquilaGeoWatchers = {};
  var __aquilaGeoWatchId = 0;

  window.__aquilaSetGeoLocation = function(lat, lng, acc) {
    __aquilaGeoCoords = {
      latitude: lat,
      longitude: lng,
      accuracy: acc || 50,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    };
    var pos = { coords: Object.assign({}, __aquilaGeoCoords), timestamp: Date.now() };
    __aquilaGeoPending.forEach(function(cb) { try { cb(pos); } catch(e) {} });
    __aquilaGeoPending = [];
    Object.keys(__aquilaGeoWatchers).forEach(function(k) {
      try { __aquilaGeoWatchers[k](pos); } catch(e) {}
    });
  };

  var origGeo = navigator.geolocation;
  var fakeGeolocation = {
    getCurrentPosition: function(success, error, options) {
      if (__aquilaGeoCoords) {
        setTimeout(function() { success({ coords: Object.assign({}, __aquilaGeoCoords), timestamp: Date.now() }); }, 50);
      } else {
        __aquilaGeoPending.push(success);
        if (origGeo && origGeo.getCurrentPosition) {
          try {
            origGeo.getCurrentPosition.call(origGeo, function() {}, function() {}, options);
          } catch(e) {}
        }
        setTimeout(function() {
          var idx = __aquilaGeoPending.indexOf(success);
          if (idx !== -1) { __aquilaGeoPending.splice(idx, 1); if (error) error({ code: 2, message: 'Position unavailable' }); }
        }, (options && options.timeout) || 30000);
      }
    },
    watchPosition: function(success, error, options) {
      var id = ++__aquilaGeoWatchId;
      __aquilaGeoWatchers[id] = success;
      if (__aquilaGeoCoords) {
        setTimeout(function() { success({ coords: Object.assign({}, __aquilaGeoCoords), timestamp: Date.now() }); }, 50);
      } else {
        if (origGeo && origGeo.getCurrentPosition) {
          try {
            origGeo.getCurrentPosition.call(origGeo, function() {}, function() {}, options);
          } catch(e) {}
        }
      }
      return id;
    },
    clearWatch: function(id) { delete __aquilaGeoWatchers[id]; }
  };

  Object.defineProperty(navigator, 'geolocation', {
    get: function() { return fakeGeolocation; },
    configurable: true
  });

  var existingChrome = window.chrome || {};
  window.chrome = existingChrome;

  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: function() { return null; },
      getIsInstalled: function() { return false; },
      installState: function(cb) { if(cb) cb('not_installed'); },
      runningState: function() { return 'cannot_run'; }
    };
  }

  if (!window.chrome.csi) {
    window.chrome.csi = function() { return { pageT: Date.now(), startE: Date.now(), onloadT: Date.now() }; };
  }

  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        get requestTime() { return Date.now() / 1000; },
        get startLoadTime() { return Date.now() / 1000; },
        get commitLoadTime() { return Date.now() / 1000; },
        get finishDocumentLoadTime() { return Date.now() / 1000; },
        get finishLoadTime() { return Date.now() / 1000; },
        get firstPaintTime() { return Date.now() / 1000; },
        get firstPaintAfterLoadTime() { return 0; },
        get navigationType() { return 'Other'; },
        get wasFetchedViaSpdy() { return true; },
        get wasNpnNegotiated() { return true; },
        get npnNegotiatedProtocol() { return 'h2'; },
        get wasAlternateProtocolAvailable() { return false; },
        get connectionInfo() { return 'h2'; }
      };
    };
  }

  Object.defineProperty(navigator, 'languages', { get: function() { return ['de-DE', 'de', 'en-US', 'en']; }, configurable: true });
  Object.defineProperty(navigator, 'pdfViewerEnabled', { get: function() { return true; }, configurable: true });
  Object.defineProperty(navigator, 'vendor', { get: function() { return 'Google Inc.'; }, configurable: true });

  Object.defineProperty(navigator, 'userAgentData', {
    get: function() {
      return {
        brands: [
          { brand: 'Chromium', version: '${major}' },
          { brand: 'Google Chrome', version: '${major}' },
          { brand: 'Not-A.Brand', version: '99' }
        ],
        mobile: false,
        platform: '${PLATFORM.uaPlatform}',
        toJSON: function() {
          return { brands: this.brands, mobile: this.mobile, platform: this.platform };
        },
        getHighEntropyValues: function(hints) {
          return Promise.resolve({
            brands: [
              { brand: 'Chromium', version: '${major}' },
              { brand: 'Google Chrome', version: '${major}' },
              { brand: 'Not-A.Brand', version: '99' }
            ],
            mobile: false,
            platform: '${PLATFORM.uaPlatform}',
            platformVersion: '${PLATFORM.platformVersion}',
            architecture: '${PLATFORM.architecture}',
            bitness: '${PLATFORM.bitness}',
            model: '',
            uaFullVersion: '${fullVersion}',
            fullVersionList: [
              { brand: 'Chromium', version: '${fullVersion}' },
              { brand: 'Google Chrome', version: '${fullVersion}' },
              { brand: 'Not-A.Brand', version: '99.0.0.0' }
            ],
            wow64: ${PLATFORM.wow64}
          });
        }
      };
    },
    configurable: true
  });
})();`;
  fs.writeFileSync(preloadPath, script, 'utf8');
}

module.exports = { createPreloadScript };