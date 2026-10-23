const { app, webContents } = require('electron');

const INITIAL_GC_DELAY = 20000;
const GC_INTERVAL = 60000;
const BG_PAGE_MEMORY_WARN_MB = 400;
const BG_PAGE_MEMORY_FORCE_GC_MB = 600;
const TOTAL_EXT_MEMORY_WARN_MB = 800;

let monitorInterval = null;
let initialGCDone = false;

function getExtensionProcesses() {
  const metrics = app.getAppMetrics();
  const bgPages = [];

  try {
    webContents.getAllWebContents().forEach(wc => {
      try {
        if (wc.isDestroyed()) return;
        const wcType = wc.getType();
        if (wcType === 'backgroundPage') {
          const pid = wc.getOSProcessId();
          const metric = metrics.find(m => m.pid === pid);
          bgPages.push({
            wc,
            pid,
            url: wc.getURL(),
            memoryMB: metric && metric.memory ? Math.round(metric.memory.workingSetSize / 1024) : 0,
            cpuPercent: metric && metric.cpu ? Math.round(metric.cpu.percentCPUUsage * 100) / 100 : 0,
            crashed: wc.isCrashed()
          });
        }
      } catch(e) {}
    });
  } catch(e) {}

  return bgPages;
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

function forceGCOnBackgroundPages() {
  let cleaned = 0;
  try {
    webContents.getAllWebContents().forEach(wc => {
      try {
        if (wc.isDestroyed() || wc.isCrashed()) return;
        if (wc.getType() === 'backgroundPage') {
          wc.executeJavaScript(
            '(function(){' +
            'if(typeof gc==="function"){gc();return "gc-native"}' +
            'try{' +
            'var a=[];for(var i=0;i<50000;i++)a.push({x:i,y:"padding"});' +
            'a=null;' +
            'return "gc-pressure";' +
            '}catch(e){return "gc-error:"+e.message}' +
            '})()'
          ).then(r => {}).catch(() => {});
          cleaned++;
        }
      } catch(e) {}
    });
  } catch(e) {}
  return cleaned;
}

function trimBackgroundPageMemory() {
  try {
    webContents.getAllWebContents().forEach(wc => {
      try {
        if (wc.isDestroyed() || wc.isCrashed()) return;
        if (wc.getType() === 'backgroundPage') {
          wc.executeJavaScript(
            '(function(){' +
            'if(typeof caches!=="undefined"&&caches.keys){' +
            'caches.keys().then(function(n){n.forEach(function(k){caches.delete(k)})}).catch(function(){});' +
            '}' +
            'if(typeof chrome!=="undefined"&&chrome.runtime&&chrome.runtime.id){' +
            'try{' +
            'var w=self||window;' +
            'if(w.µBlock&&w.µBlock.staticNetFilteringEngine&&w.µBlock.staticNetFilteringEngine.matchStringReverse){' +
            'if(typeof gc==="function")gc();' +
            '}' +
            '}catch(e){}' +
            '}' +
            'if(typeof gc==="function")gc();' +
            '})()'
          ).catch(() => {});
        }
      } catch(e) {}
    });
  } catch(e) {}
}

function monitorCycle() {
  const bgPages = getExtensionProcesses();
  const totalExtMB = getTotalExtensionMemoryMB();

  bgPages.forEach(bp => {
    if (bp.crashed) return;

    if (bp.memoryMB > BG_PAGE_MEMORY_FORCE_GC_MB) {
      forceGCOnBackgroundPages();
      trimBackgroundPageMemory();

      setTimeout(() => {
        if (global.gc) global.gc();
      }, 2000);
    } else if (bp.memoryMB > BG_PAGE_MEMORY_WARN_MB) {
      forceGCOnBackgroundPages();
    }
  });

  if (totalExtMB > TOTAL_EXT_MEMORY_WARN_MB) {
    forceGCOnBackgroundPages();
    if (global.gc) global.gc();
  }
}

function doInitialCleanup() {
  if (initialGCDone) return;
  initialGCDone = true;

  forceGCOnBackgroundPages();

  setTimeout(() => {
    trimBackgroundPageMemory();
    if (global.gc) global.gc();
  }, 5000);

  setTimeout(() => {
    forceGCOnBackgroundPages();
    if (global.gc) global.gc();
  }, 15000);
}

function start() {
  setTimeout(doInitialCleanup, INITIAL_GC_DELAY);

  setTimeout(() => {
    monitorInterval = setInterval(monitorCycle, GC_INTERVAL);
  }, INITIAL_GC_DELAY + 10000);
}

function stop() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

function getStats() {
  return {
    bgPages: getExtensionProcesses(),
    totalExtMB: getTotalExtensionMemoryMB()
  };
}

module.exports = { start, stop, getStats, forceGCOnBackgroundPages, trimBackgroundPageMemory };