const { loadData } = require('./data-store');

let cachedGeolocation = null;

async function fetchRealGeolocation() {
  if (cachedGeolocation) return cachedGeolocation;
  try {
    const https = require('https');
    const tryApi = (url) => new Promise((resolve) => {
      const req = https.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
    const ipapi = await tryApi('https://ipapi.co/json/');
    if (ipapi && ipapi.latitude && ipapi.longitude) {
      cachedGeolocation = {
        latitude: ipapi.latitude,
        longitude: ipapi.longitude,
        accuracy: 100,
        city: ipapi.city,
        region: ipapi.region,
        country: ipapi.country_name
      };
      return cachedGeolocation;
    }
    const ipinfo = await tryApi('https://ipinfo.io/json');
    if (ipinfo && ipinfo.loc) {
      const [lat, lng] = ipinfo.loc.split(',').map(Number);
      if (lat && lng) {
        cachedGeolocation = {
          latitude: lat,
          longitude: lng,
          accuracy: 200,
          city: ipinfo.city,
          region: ipinfo.region,
          country: ipinfo.country
        };
        return cachedGeolocation;
      }
    }
    cachedGeolocation = { latitude: 51.1657, longitude: 10.4515, accuracy: 5000 };
    return cachedGeolocation;
  } catch (error) {
    cachedGeolocation = { latitude: 51.1657, longitude: 10.4515, accuracy: 5000 };
    return cachedGeolocation;
  }
}

function domainHasGeolocationPermission(url) {
  try {
    const currentData = loadData();
    if (!currentData.permissions) return false;
    const domain = new URL(url).hostname;
    const existing = currentData.permissions.find(
      p => p.domain === domain && p.type === 'geolocation' && p.granted
    );
    return !!existing;
  } catch (e) {
    return false;
  }
}

async function injectGeolocationToWebContents(wc) {
  try {
    if (!wc || wc.isDestroyed()) return;
    const location = await fetchRealGeolocation();
    await wc.executeJavaScript(
      `if(typeof window.__aquilaSetGeoLocation==='function'){window.__aquilaSetGeoLocation(${location.latitude},${location.longitude},${location.accuracy});}`
    ).catch(() => {});
  } catch (e) {}
}

async function setGeolocationOverride(wc) {
  try {
    if (!wc || wc.isDestroyed()) return;
    const location = await fetchRealGeolocation();
    wc.executeJavaScript(
      `if(typeof window.__aquilaSetGeoLocation==='function'){window.__aquilaSetGeoLocation(${location.latitude},${location.longitude},${location.accuracy});}`
    ).catch(() => {});
  } catch (error) {}
}

module.exports = {
  fetchRealGeolocation,
  domainHasGeolocationPermission,
  injectGeolocationToWebContents,
  setGeolocationOverride
};