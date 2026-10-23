const { TouchBar, nativeImage } = require('electron');
const https = require('https');
const { IS_MAC } = require('./platform');

function fetchUrl(url) {
  return new Promise((resolve) => {
    const tryFetch = (currentUrl, redirects) => {
      if (redirects > 3) return resolve(null);
      try {
        const req = https.get(currentUrl, { timeout: 3000 }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            req.destroy();
            return tryFetch(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve(buffer.length > 200 ? buffer : null);
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch (e) {
        resolve(null);
      }
    };
    tryFetch(url, 0);
  });
}

function bufferToIcon(buffer) {
  try {
    const img = nativeImage.createFromBuffer(buffer);
    if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
  } catch (e) {}
  return null;
}

async function fetchFavicon(domain) {
  const sources = [
    `https://favicon.vemetric.com/${domain}?format=png&size=32`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];

  for (const url of sources) {
    const buffer = await fetchUrl(url);
    if (buffer) {
      const icon = bufferToIcon(buffer);
      if (icon) return icon;
    }
  }
  return null;
}

function setupTouchBar(mainWindow, loadData) {
  if (!IS_MAC || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const { TouchBarButton, TouchBarSpacer, TouchBarLabel } = TouchBar;
    const data = loadData();
    const quickAccess = (data.quickAccess || []).slice(0, 6);

    if (quickAccess.length === 0) {
      mainWindow.setTouchBar(new TouchBar({ items: [new TouchBarLabel({ label: '⚡ Keine Quick Access' })] }));
      return;
    }

    const domains = quickAccess.map(qa => {
      try {
        return new URL(qa.url.startsWith('http') ? qa.url : 'https://' + qa.url).hostname;
      } catch (e) { return ''; }
    });

    Promise.all(domains.map(domain => domain ? fetchFavicon(domain) : Promise.resolve(null))).then(icons => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const items = [];
      items.push(new TouchBarLabel({ label: '⚡' }));
      items.push(new TouchBarSpacer({ size: 'small' }));

      quickAccess.forEach((qa, i) => {
        const icon = icons[i];
        items.push(new TouchBarButton({
          label: icon ? '' : (qa.name || '?').substring(0, 2),
          icon: icon || undefined,
          backgroundColor: '#1e3a5f',
          accessibilityLabel: qa.name || qa.url,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send('open-external-url', qa.url);
            }
          }
        }));
      });

      mainWindow.setTouchBar(new TouchBar({ items }));
    });
  } catch (e) {}
}

module.exports = { setupTouchBar };