const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_PATH = path.join(app.getPath('userData'), 'aquila-data.json');
const EXTENSIONS_PATH = path.join(app.getPath('userData'), 'Extensions');
const EXTENSIONS_CACHE_PATH = path.join(app.getPath('userData'), 'extensions-cache.json');
const BACKGROUNDS_PATH = path.join(app.getPath('userData'), 'backgrounds');
const PRELOAD_PATH = path.join(app.getPath('userData'), 'chrome-spoof-preload.js');

const dataCache = new Map();
let lastDataLoad = 0;
const DATA_CACHE_TTL = 1000;

let filterSettingsCache = null;
let filterSettingsCacheTime = 0;
const FILTER_CACHE_TTL = 5000;

let saveDataQueue = null;

function loadData() {
  const now = Date.now();
  if (dataCache.has('main') && (now - lastDataLoad) < DATA_CACHE_TTL) {
    return dataCache.get('main');
  }
  try {
    if (fs.existsSync(DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      if (!data.permissions) data.permissions = [];
      if (!data.extensions) data.extensions = [];
      dataCache.set('main', data);
      lastDataLoad = now;
      return data;
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
  const defaultData = {
    firstRun: true,
    settings: {
      language: 'de',
      theme: 'aquila',
      httpsOnly: true,
      incognito: false,
      adBlocker: 'basis',
      customFilters: [],
      newWindowBehavior: true,
      discordRPC: false,
      loadingScreen: 'loading.html',
      loadingSound: 'aquila.mp3',
      loadingSubtitle: '',
      performanceMode: false,
      minimalMode: false,
      ramLimit: 50,
      cpuLimit: 50,
      defaultBrowser: false,
      drmEnabled: true,
      customBackground: '',
      sessionRestore: false,
      proxyEnabled: false,
      proxyServer: '2.59.132.39:3128'
    },
    bookmarks: [],
    history: [],
    downloads: [],
    permissions: [],
    extensions: [],
    lastSession: [],
    quickAccess: [
      { name: 'KaiserOS', url: 'https://kaiseros.de', icon: '' },
      { name: 'Google', url: 'https://www.google.com', icon: '' },
      { name: 'YouTube', url: 'https://www.youtube.com', icon: '' },
      { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: '' }
    ]
  };
  dataCache.set('main', defaultData);
  lastDataLoad = Date.now();
  return defaultData;
}

function saveData(data) {
  try {
    if (!data.permissions) data.permissions = [];
    if (!data.extensions) data.extensions = [];
    dataCache.set('main', data);
    lastDataLoad = Date.now();
    filterSettingsCache = null;
    filterSettingsCacheTime = 0;
    if (saveDataQueue) clearTimeout(saveDataQueue);
    saveDataQueue = setTimeout(() => {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
      saveDataQueue = null;
    }, 100);
  } catch (error) {
    console.error('Error saving data:', error);
  }
}

function getFilterSettings() {
  const now = Date.now();
  if (filterSettingsCache && (now - filterSettingsCacheTime) < FILTER_CACHE_TTL) {
    return filterSettingsCache;
  }
  const data = loadData();
  filterSettingsCache = {
    httpsOnly: data.settings.httpsOnly,
    adBlocker: data.settings.adBlocker
  };
  filterSettingsCacheTime = now;
  return filterSettingsCache;
}

function clearDataCache() {
  dataCache.clear();
}

module.exports = {
  loadData,
  saveData,
  getFilterSettings,
  clearDataCache,
  DATA_PATH,
  EXTENSIONS_PATH,
  EXTENSIONS_CACHE_PATH,
  BACKGROUNDS_PATH,
  PRELOAD_PATH
};