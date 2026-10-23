const { session } = require('electron');
const { PLATFORM, getFullChromeVersion, getChromeMajorVersion, getChromeUserAgent } = require('./platform');

let proxyState = { enabled: false, server: '2.59.132.39:3128' };

const AD_BLOCK_DOMAINS_BASIC = new Set([
  'ads.yahoo.com',
  'advertising.com',
  'adnxs.com',
  'adsrvr.org',
  'adcolony.com',
  'moatads.com',
  'scorecardresearch.com'
]);

const AD_BLOCK_DOMAINS_AGGRESSIVE = new Set([
  ...AD_BLOCK_DOMAINS_BASIC,
  'amazon-adsystem.com',
  'criteo.com',
  'criteo.net',
  'outbrain.com',
  'taboola.com',
  'facebook.com/tr',
  'facebook.net/signals',
  'analytics.tiktok.com',
  'casalemedia.com',
  'rubiconproject.com',
  'openx.net',
  'pubmatic.com',
  'sharethrough.com',
  'bidswitch.net',
  'contextweb.com',
  'indexexchange.com',
  'smartadserver.com',
  'media.net',
  'popads.net',
  'propellerads.com',
  'revcontent.com',
  'mgid.com'
]);

function isYouTubeOrGoogleVideo(url) {
  return url.includes('youtube.com') ||
         url.includes('googlevideo.com') ||
         url.includes('ytimg.com') ||
         url.includes('youtube-nocookie.com') ||
         url.includes('yt3.ggpht.com') ||
         url.includes('doubleclick.net') ||
         url.includes('googlesyndication.com') ||
         url.includes('googleadservices.com') ||
         url.includes('google.com/pagead') ||
         url.includes('google.com/ads');
}

function isCrunchyrollOrCDN(url) {
  if (!url) return false;
  var lower = typeof url === 'string' ? url.toLowerCase() : '';
  return lower.includes('crunchyroll.com')
    || lower.includes('vrv.co')
    || lower.includes('crunchyrollsvc.com')
    || lower.includes('cr-play-service')
    || lower.includes('cr-license-proxy')
    || lower.includes('cr-unblocker')
    || lower.includes('img1.ak.crunchyroll.com')
    || lower.includes('fy.v.vrv.co')
    || lower.includes('dl.v.vrv.co')
    || lower.includes('a-vrv.akamaized.net')
    || lower.includes('cr-play.akamaized.net');
}

function shouldBlockAd(url, adBlockerLevel) {
  if (adBlockerLevel === 'aus') return false;
  var domains = adBlockerLevel === 'aggressiv' ? AD_BLOCK_DOMAINS_AGGRESSIVE : AD_BLOCK_DOMAINS_BASIC;
  for (var d of domains) {
    if (url.includes(d)) return true;
  }
  return false;
}

function isCloudflareUrl(hostname) {
  return hostname === 'challenges.cloudflare.com' ||
         hostname.endsWith('.challenges.cloudflare.com');
}

function applyChromeHeaders(targetSession, devtoolsCustomUA) {
  var userAgent = getChromeUserAgent();
  var major = getChromeMajorVersion();
  var fullVersion = getFullChromeVersion();

  targetSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      try {
        var url = details.url;
        if (!url || typeof url !== 'string') { callback({}); return; }

        if (url.startsWith('chrome-extension://') || url.startsWith('devtools://') || url.startsWith('data:')) {
          callback({});
          return;
        }

        if (isYouTubeOrGoogleVideo(url)) { callback({}); return; }

        var headers = details.requestHeaders;
        if (!headers || typeof headers !== 'object') { callback({}); return; }

        delete headers['X-Electron-Version'];
        delete headers['X-Electron'];
        delete headers['X-Requested-With'];

        headers['User-Agent'] = devtoolsCustomUA || userAgent;

        if (isCrunchyrollOrCDN(url)) {
          var currentOrigin = headers['Origin'] || '';
          if (!currentOrigin || currentOrigin.includes('electron') || currentOrigin.includes('file://')) {
            headers['Origin'] = 'https://static.crunchyroll.com';
            headers['Referer'] = 'https://static.crunchyroll.com/';
          }
          headers['Sec-CH-UA'] = '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not-A.Brand";v="99"';
          headers['Sec-CH-UA-Mobile'] = '?0';
          headers['Sec-CH-UA-Platform'] = PLATFORM.secPlatform;
          callback({ requestHeaders: headers });
          return;
        }

        var parsedUrl = null;
        try { parsedUrl = new URL(url); } catch(e) {}

        if (parsedUrl) {
          var host = parsedUrl.hostname;
          if (isCloudflareUrl(host) || parsedUrl.pathname.includes('/cdn-cgi/')) {
            callback({ requestHeaders: headers });
            return;
          }
        }

        headers['Sec-CH-UA'] = '"Chromium";v="' + major + '", "Google Chrome";v="' + major + '", "Not-A.Brand";v="99"';
        headers['Sec-CH-UA-Mobile'] = '?0';
        headers['Sec-CH-UA-Platform'] = PLATFORM.secPlatform;

        if (parsedUrl) {
          var hostname = parsedUrl.hostname;
          var isGoogle = hostname.includes('google.com') ||
                         hostname.includes('googleapis.com') ||
                         hostname.includes('gstatic.com');

          if (isGoogle) {
            headers['Sec-CH-UA-Full-Version-List'] = '"Chromium";v="' + fullVersion + '", "Google Chrome";v="' + fullVersion + '", "Not-A.Brand";v="99.0.0.0"';
            headers['Sec-CH-UA-Arch'] = '"' + PLATFORM.architecture + '"';
            headers['Sec-CH-UA-Bitness'] = '"' + PLATFORM.bitness + '"';
            headers['Sec-CH-UA-Platform-Version'] = '"' + PLATFORM.platformVersion + '"';
            headers['Sec-CH-UA-Model'] = '""';
            headers['Sec-CH-UA-WoW64'] = PLATFORM.wow64 ? '?1' : '?0';
          }

          if (hostname === '2.59.132.39') {
            headers['X-Aquila-Key'] = 'AquilaBrowser-Internal-2025';
          }
        }

        callback({ requestHeaders: headers });
      } catch(e) {
        callback({});
      }
    }
  );
}

function optimizeSession(browserSession) {
  browserSession.setUserAgent(getChromeUserAgent());
}

async function applyProxySettings(enabled, server) {
  try {
    var browserSession = session.fromPartition('persist:main');
    var defaultSess = session.defaultSession;
    if (!enabled || !server) {
      await browserSession.setProxy({ mode: 'direct' });
      await defaultSess.setProxy({ mode: 'direct' });
      proxyState.enabled = false;
      proxyState.server = server || '2.59.132.39:3128';
      return true;
    }
    var proxyConfig = {
      proxyRules: 'http=' + server + ';https=' + server,
      proxyBypassRules: 'localhost,127.0.0.1,::1,2.59.132.39,<local>,chrome-extension://*'
    };
    await browserSession.setProxy(proxyConfig);
    await defaultSess.setProxy(proxyConfig);
    proxyState.enabled = true;
    proxyState.server = server;
    return true;
  } catch (e) {
    try {
      await session.fromPartition('persist:main').setProxy({ mode: 'direct' });
      await session.defaultSession.setProxy({ mode: 'direct' });
    } catch (f) {}
    proxyState.enabled = false;
    return false;
  }
}

function testProxyConnection(server) {
  return new Promise((resolve) => {
    try {
      var nodeNet = require('net');
      var parts = (server || '').split(':');
      var host = parts[0];
      var port = parseInt(parts[1]) || 3128;
      if (!host) { resolve(false); return; }
      var socket = new nodeNet.Socket();
      socket.setTimeout(5000);
      socket.connect(port, host, () => { socket.write('HEAD http://example.com HTTP/1.0\r\n\r\n'); });
      socket.on('data', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    } catch (e) { resolve(false); }
  });
}

module.exports = {
  proxyState,
  isYouTubeOrGoogleVideo,
  isCrunchyrollOrCDN,
  shouldBlockAd,
  applyChromeHeaders,
  optimizeSession,
  applyProxySettings,
  testProxyConnection
};