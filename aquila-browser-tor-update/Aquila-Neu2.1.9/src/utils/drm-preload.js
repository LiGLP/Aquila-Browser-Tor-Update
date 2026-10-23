'use strict';

(function () {
  if (typeof navigator === 'undefined' || !navigator.requestMediaKeySystemAccess) return;

  var _orig = navigator.requestMediaKeySystemAccess.bind(navigator);

  function patchCap(cap) {
    if (!cap) return cap;
    cap = Object.assign({}, cap);
    if (!cap.robustness || cap.robustness === '') {
      var isVideo = cap.contentType && cap.contentType.includes('video');
      cap.robustness = isVideo ? 'SW_SECURE_DECODE' : 'SW_SECURE_CRYPTO';
    }
    return cap;
  }

  function patchConfig(cfg) {
    cfg = Object.assign({}, cfg);
    if (!cfg.persistentState) cfg.persistentState = 'optional';
    if (!cfg.distinctiveIdentifier) cfg.distinctiveIdentifier = 'optional';
    if (!cfg.sessionTypes || cfg.sessionTypes.length === 0) cfg.sessionTypes = ['temporary'];
    if (!cfg.initDataTypes || cfg.initDataTypes.length === 0) cfg.initDataTypes = ['cenc', 'webm'];

    if (cfg.videoCapabilities) cfg.videoCapabilities = cfg.videoCapabilities.map(patchCap);
    if (cfg.audioCapabilities) cfg.audioCapabilities = cfg.audioCapabilities.map(patchCap);

    if (!cfg.videoCapabilities || cfg.videoCapabilities.length === 0) {
      cfg.videoCapabilities = [
        { contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: 'SW_SECURE_DECODE' },
        { contentType: 'video/mp4; codecs="avc1.640028"', robustness: 'SW_SECURE_DECODE' },
        { contentType: 'video/webm; codecs="vp9"', robustness: 'SW_SECURE_DECODE' }
      ];
    }

    if (!cfg.audioCapabilities || cfg.audioCapabilities.length === 0) {
      cfg.audioCapabilities = [
        { contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: 'SW_SECURE_CRYPTO' },
        { contentType: 'audio/webm; codecs="opus"', robustness: 'SW_SECURE_CRYPTO' }
      ];
    }

    return cfg;
  }

  Object.defineProperty(navigator, 'requestMediaKeySystemAccess', {
    value: function (keySystem, configs) {
      if (keySystem === 'com.widevine.alpha' && Array.isArray(configs)) {
        configs = configs.map(patchConfig);
      }
      return _orig(keySystem, configs).catch(function (err) {
        if (keySystem === 'com.widevine.alpha' && Array.isArray(configs)) {
          var fallbackConfigs = configs.map(function (cfg) {
            cfg = Object.assign({}, cfg);
            var clearRobustness = function (cap) {
              if (!cap) return cap;
              cap = Object.assign({}, cap);
              cap.robustness = '';
              return cap;
            };
            if (cfg.videoCapabilities) cfg.videoCapabilities = cfg.videoCapabilities.map(clearRobustness);
            if (cfg.audioCapabilities) cfg.audioCapabilities = cfg.audioCapabilities.map(clearRobustness);
            return cfg;
          });
          return _orig(keySystem, fallbackConfigs);
        }
        throw err;
      });
    },
    writable: false,
    configurable: false
  });

  var _createElement = document.createElement.bind(document);
  document.createElement = function (tagName) {
    var el = _createElement(tagName);
    if (tagName.toLowerCase() === 'video' || tagName.toLowerCase() === 'audio') {
      try {
        Object.defineProperty(el, 'canPlayType', {
          value: function (type) {
            if (type.includes('mp4') || type.includes('avc1') || type.includes('mp4a')) return 'probably';
            if (type.includes('webm') || type.includes('vorbis') || type.includes('vp8') || type.includes('vp9') || type.includes('opus')) return 'probably';
            return HTMLMediaElement.prototype.canPlayType.call(el, type);
          },
          writable: false,
          configurable: true
        });
      } catch (e) {}
    }
    return el;
  };
})();