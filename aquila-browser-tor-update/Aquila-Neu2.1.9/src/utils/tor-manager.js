const { app, session, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodeNet = require('net');
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const { getChromeUserAgent } = require('./platform');

const TOR_PARTITION = 'aquila-tor';
const TOR_ROOT = path.join(app.getPath('userData'), 'tor');
const TOR_BUNDLE_DIR = path.join(TOR_ROOT, 'bundle');
const TOR_DATA_DIR = path.join(TOR_ROOT, 'data');
const TOR_DOWNLOADS_JSON = 'https://aus1.torproject.org/torbrowser/update_3/release/downloads.json';
const TOR_DIST_BASE = 'https://dist.torproject.org/torbrowser/';
const TOR_CHECK_URL = 'https://check.torproject.org/api/ip';
const BLACKHOLE_PROXY = 'socks5://127.0.0.1:9';
const EXE = process.platform === 'win32' ? 'tor.exe' : 'tor';

const events = new EventEmitter();

let torSession = null;
let torProcess = null;
let control = null;
let startPromise = null;
let stopping = false;
let procGen = 0;
let lastErrorLines = [];

const state = {
  status: 'off',
  progress: 0,
  message: '',
  error: '',
  socksPort: null,
  exitCountry: '',
  bridges: 'none',
  exitIp: null,
  binarySource: null
};

function getState() { return { ...state }; }

function setState(patch) {
  Object.assign(state, patch);
  events.emit('state', getState());
}

function isTorSession(sess) {
  return !!(sess && torSession && sess === torSession);
}

function isTorContents(wc) {
  try { return !!(wc && !wc.isDestroyed() && isTorSession(wc.session)); } catch (e) { return false; }
}

function getTorSession() {
  if (torSession) return torSession;
  torSession = session.fromPartition(TOR_PARTITION);
  torSession.setProxy({ proxyRules: BLACKHOLE_PROXY, proxyBypassRules: '<-loopback>' }).catch(() => {});
  torSession.setUserAgent(getChromeUserAgent());
  try { torSession.setSpellCheckerEnabled(false); } catch (e) {}

  const allowed = ['fullscreen', 'clipboard-sanitized-write'];
  torSession.setPermissionRequestHandler((wc, permission, callback) => callback(allowed.includes(permission)));
  torSession.setPermissionCheckHandler((wc, permission) => allowed.includes(permission));
  return torSession;
}

function fileExists(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; }
}

function findOnPath() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    const candidate = path.join(d, EXE);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function knownSystemLocations() {
  const home = app.getPath('home');
  if (process.platform === 'win32') {
    return [
      path.join(home, 'Desktop', 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Tor Browser', 'Browser', 'TorBrowser', 'Tor', 'tor.exe')
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin/tor',
      '/usr/local/bin/tor',
      '/Applications/Tor Browser.app/Contents/MacOS/Tor/tor'
    ];
  }
  return ['/usr/bin/tor', '/usr/sbin/tor', '/usr/local/bin/tor'];
}

function bundledBinary() {
  return path.join(TOR_BUNDLE_DIR, 'tor', EXE);
}

function resolveTorBinary(customPath) {
  if (customPath && fileExists(customPath)) return { binary: customPath, source: 'custom' };
  if (fileExists(bundledBinary())) return { binary: bundledBinary(), source: 'bundled' };
  const onPath = findOnPath();
  if (onPath) return { binary: onPath, source: 'system' };
  const known = knownSystemLocations().find(fileExists);
  if (known) return { binary: known, source: 'system' };
  return null;
}

function bundlePlatform() {
  const arch = process.arch;
  if (process.platform === 'win32') return arch === 'ia32' ? 'windows-i686' : 'windows-x86_64';
  if (process.platform === 'darwin') return arch === 'arm64' ? 'macos-aarch64' : 'macos-x86_64';
  if (process.platform === 'linux') {
    if (arch === 'x64') return 'linux-x86_64';
    if (arch === 'ia32') return 'linux-i686';
  }
  return null;
}

async function fetchText(url) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' für ' + url);
  return res.text();
}

async function downloadToFile(url, dest, onProgress) {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status + ' für ' + url);
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      if (onProgress) onProgress(received, total);
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  return hash.digest('hex');
}

function systemTar() {
  if (process.platform === 'win32') {
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fileExists(sysTar)) return sysTar;
  }
  return 'tar';
}

function extractTarGz(archive, destDir) {
  return new Promise((resolve, reject) => {
    execFile(systemTar(), ['-xzf', archive, '-C', destDir], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error('Entpacken fehlgeschlagen: ' + (stderr || err.message)));
      else resolve();
    });
  });
}

async function downloadTorBundle() {
  const platform = bundlePlatform();
  if (!platform) throw new Error('Für dieses System gibt es kein offizielles Tor-Paket. Bitte Tor über den Paketmanager installieren oder den Pfad in den Tor-Einstellungen angeben.');

  setState({ status: 'downloading', progress: 0, message: 'Suche aktuelle Tor-Version…', error: '' });
  const meta = JSON.parse(await fetchText(TOR_DOWNLOADS_JSON));
  const version = meta && meta.version;
  if (!version || !/^[0-9][0-9a-z.\-]*$/i.test(version)) throw new Error('Unbekannte Antwort von torproject.org');

  const fileName = 'tor-expert-bundle-' + platform + '-' + version + '.tar.gz';
  const baseUrl = TOR_DIST_BASE + version + '/';

  const sums = await fetchText(baseUrl + 'sha256sums-signed-build.txt');
  let expected = null;
  for (const line of sums.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === fileName) { expected = m[1].toLowerCase(); break; }
  }
  if (!expected) throw new Error('Keine Prüfsumme für ' + fileName + ' gefunden');

  fs.mkdirSync(TOR_ROOT, { recursive: true });
  const archive = path.join(TOR_ROOT, fileName);
  const actual = await downloadToFile(baseUrl + fileName, archive, (received, total) => {
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    setState({ progress: pct, message: 'Lade Tor ' + version + ' herunter… ' + (total > 0 ? pct + '%' : Math.round(received / 1048576) + ' MB') });
  });

  if (actual !== expected) {
    try { fs.unlinkSync(archive); } catch (e) {}
    throw new Error('Prüfsumme des Tor-Downloads stimmt nicht – Download verworfen');
  }

  setState({ message: 'Entpacke Tor…' });
  fs.rmSync(TOR_BUNDLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(TOR_BUNDLE_DIR, { recursive: true });
  await extractTarGz(archive, TOR_BUNDLE_DIR);
  try { fs.unlinkSync(archive); } catch (e) {}

  if (!fileExists(bundledBinary())) throw new Error('Tor-Binary nach dem Entpacken nicht gefunden');
  if (process.platform !== 'win32') {
    const ptDir = path.join(TOR_BUNDLE_DIR, 'tor', 'pluggable_transports');
    const execs = [bundledBinary()];
    try { fs.readdirSync(ptDir).forEach(f => { if (!f.endsWith('.json') && !f.endsWith('.txt')) execs.push(path.join(ptDir, f)); }); } catch (e) {}
    execs.forEach(f => { try { fs.chmodSync(f, 0o755); } catch (e) {} });
  }
  fs.writeFileSync(path.join(TOR_BUNDLE_DIR, 'VERSION'), version);
  return bundledBinary();
}

function findPtDir(binary) {
  const dir = path.dirname(binary);
  for (const name of ['pluggable_transports', 'PluggableTransports']) {
    const candidate = path.join(dir, name);
    if (fileExists(path.join(candidate, 'pt_config.json'))) return candidate;
  }
  return null;
}

function findGeoipDir(binary) {
  const candidates = [
    path.join(path.dirname(binary), '..', 'data'),
    path.join(path.dirname(binary), 'data')
  ];
  return candidates.find(d => fileExists(path.join(d, 'geoip'))) || null;
}

function bridgeTorrcLines(binary, bridges, customBridges) {
  if (!bridges || bridges === 'none') return [];
  const ptDir = findPtDir(binary);
  const lines = ['UseBridges 1'];

  if (ptDir) {
    const cfg = JSON.parse(fs.readFileSync(path.join(ptDir, 'pt_config.json'), 'utf8'));
    const rel = path.relative(path.dirname(binary), ptDir) + path.sep;
    Object.values(cfg.pluggableTransports || {}).forEach(v => {
      if (typeof v === 'string') lines.push(v.replace(/\$\{pt_path\}/g, rel));
    });
    if (bridges !== 'custom') {
      const builtin = (cfg.bridges || {})[bridges];
      if (!Array.isArray(builtin) || builtin.length === 0) throw new Error('Keine eingebauten "' + bridges + '"-Bridges gefunden');
      builtin.forEach(b => lines.push('Bridge ' + b));
      return lines;
    }
  } else if (bridges !== 'custom') {
    throw new Error('Diese Tor-Installation enthält keine Pluggable Transports. Nutze das automatisch geladene Tor-Paket oder eigene Bridges.');
  }

  const custom = String(customBridges || '').split(/\r?\n/).map(l => l.trim().replace(/^bridge\s+/i, '')).filter(Boolean);
  if (custom.length === 0) throw new Error('Keine eigenen Bridges eingetragen');
  custom.forEach(b => {
    if (/[\r\n]/.test(b)) return;
    lines.push('Bridge ' + b);
  });
  return lines;
}

function sanitizeCountry(cc) {
  return /^[a-z]{2}$/i.test(cc || '') ? cc.toLowerCase() : '';
}

class TorControl {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.buffer = '';
    this.pending = [];
    this.current = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = nodeNet.connect(this.port, '127.0.0.1');
      socket.setEncoding('utf8');
      socket.once('connect', () => { this.socket = socket; resolve(); });
      socket.once('error', reject);
      socket.on('data', d => this.onData(d));
      socket.on('close', () => {
        this.socket = null;
        this.pending.splice(0).forEach(p => p.reject(new Error('Control-Verbindung geschlossen')));
      });
    });
  }

  onData(data) {
    this.buffer += data;
    let idx;
    while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.current.push(line);
      if (/^\d{3} /.test(line)) {
        const reply = this.current;
        this.current = [];
        const p = this.pending.shift();
        if (!p) continue;
        if (line.startsWith('2')) p.resolve(reply);
        else p.reject(new Error(line));
      }
    }
  }

  send(command) {
    if (!this.socket) return Promise.reject(new Error('Keine Control-Verbindung'));
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(command + '\r\n');
    });
  }

  close() {
    try { if (this.socket) this.socket.destroy(); } catch (e) {}
    this.socket = null;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function start(config) {
  if (state.status === 'connected' || state.status === 'connecting' || state.status === 'starting') return Promise.resolve(getState());
  if (startPromise) return startPromise;
  startPromise = doStart(config || {})
    .catch(err => {
      if (stopping) return;
      killProcess();
      setState({ status: 'error', error: err.message || String(err), message: '' });
    })
    .then(() => { startPromise = null; return getState(); });
  return startPromise;
}

async function doStart(config) {
  stopping = false;
  lastErrorLines = [];
  getTorSession();

  let resolved = resolveTorBinary(config.binaryPath);
  if (!resolved) resolved = { binary: await downloadTorBundle(), source: 'bundled' };

  const exitCountry = sanitizeCountry(config.exitCountry);
  const bridges = config.bridges || 'none';
  setState({ status: 'starting', progress: 0, message: 'Starte Tor…', error: '', exitIp: null, binarySource: resolved.source, exitCountry, bridges });

  fs.mkdirSync(TOR_DATA_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') { try { fs.chmodSync(TOR_DATA_DIR, 0o700); } catch (e) {} }

  const [socksPort, controlPort] = await Promise.all([getFreePort(), getFreePort()]);
  const cookieFile = path.join(TOR_DATA_DIR, 'control_auth_cookie');
  try { fs.unlinkSync(cookieFile); } catch (e) {}

  const torrcLines = ['ClientOnly 1', 'AvoidDiskWrites 1', 'CookieAuthentication 1'];
  if (exitCountry) torrcLines.push('ExitNodes {' + exitCountry + '}', 'StrictNodes 1');
  torrcLines.push(...bridgeTorrcLines(resolved.binary, bridges, config.customBridges));
  const torrcPath = path.join(TOR_ROOT, 'torrc');
  fs.writeFileSync(torrcPath, torrcLines.join('\n') + '\n');

  const args = [
    '-f', torrcPath,
    '--SocksPort', '127.0.0.1:' + socksPort,
    '--ControlPort', '127.0.0.1:' + controlPort,
    '--CookieAuthFile', cookieFile,
    '--DataDirectory', TOR_DATA_DIR,
    '--__OwningControllerProcess', String(process.pid),
    '--Log', 'notice stdout'
  ];
  const geoipDir = findGeoipDir(resolved.binary);
  if (geoipDir) args.push('--GeoIPFile', path.join(geoipDir, 'geoip'), '--GeoIPv6File', path.join(geoipDir, 'geoip6'));

  const binDir = path.dirname(resolved.binary);
  const env = { ...process.env };
  if (process.platform === 'linux') env.LD_LIBRARY_PATH = binDir + (env.LD_LIBRARY_PATH ? path.delimiter + env.LD_LIBRARY_PATH : '');
  if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = binDir;

  const proc = spawn(resolved.binary, args, { cwd: binDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  torProcess = proc;
  const gen = ++procGen;

  await new Promise((resolve, reject) => {
    let settled = false;
    let controlStarted = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve();
    };

    const onLine = (line) => {
      if (/\[(err|warn)\]/.test(line) && !/see warnings above/i.test(line)) {
        lastErrorLines.push(line.replace(/^.*?\[(err|warn)\]\s*/, ''));
        if (lastErrorLines.length > 5) lastErrorLines.shift();
      }
      if (!controlStarted && /Opened Control listener/i.test(line)) {
        controlStarted = true;
        connectControl(controlPort, cookieFile).catch(() => {});
      }
      const m = line.match(/Bootstrapped (\d+)%(?: \([^)]*\))?: (.*)$/);
      if (m) {
        const pct = parseInt(m[1], 10);
        setState({ status: pct >= 100 ? 'connected' : 'connecting', progress: pct, message: m[2].trim(), socksPort });
        if (pct >= 100) finish();
      }
    };

    let stdoutBuf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        onLine(stdoutBuf.slice(0, idx).trim());
        stdoutBuf = stdoutBuf.slice(idx + 1);
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', chunk => chunk.split('\n').forEach(l => l.trim() && onLine('[err] ' + l.trim())));

    proc.once('error', err => finish(new Error('Tor konnte nicht gestartet werden: ' + err.message)));
    proc.once('exit', code => {
      if (gen !== procGen) { finish(new Error('Tor wurde beendet')); return; }
      torProcess = null;
      if (control) { control.close(); control = null; }
      getTorSession().setProxy({ proxyRules: BLACKHOLE_PROXY, proxyBypassRules: '<-loopback>' }).catch(() => {});
      const reason = lastErrorLines.length ? lastErrorLines[lastErrorLines.length - 1] : 'Tor wurde beendet (Code ' + code + ')';
      if (!settled) finish(new Error(reason));
      else if (!stopping) setState({ status: 'error', error: reason, progress: 0, message: '', exitIp: null });
    });

    getTorSession().setProxy({ proxyRules: 'socks5://127.0.0.1:' + socksPort, proxyBypassRules: '<-loopback>' }).catch(() => {});
  });

  getTorSession().closeAllConnections().catch(() => {});
  refreshExitIp();
}

async function connectControl(port, cookieFile) {
  const client = new TorControl(port);
  await client.connect();
  let cookie = null;
  for (let i = 0; i < 20 && !cookie; i++) {
    try { cookie = fs.readFileSync(cookieFile); } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  if (!cookie) { client.close(); throw new Error('Tor-Cookie nicht gefunden'); }
  await client.send('AUTHENTICATE ' + cookie.toString('hex'));
  await client.send('TAKEOWNERSHIP').catch(() => {});
  control = client;
}

function killProcess() {
  procGen++;
  if (control) { control.close(); control = null; }
  if (torProcess) {
    try { torProcess.kill(); } catch (e) {}
    torProcess = null;
  }
}

async function stop() {
  stopping = true;
  if (control) { try { await control.send('SIGNAL SHUTDOWN'); } catch (e) {} }
  killProcess();
  const sess = getTorSession();
  await sess.setProxy({ proxyRules: BLACKHOLE_PROXY, proxyBypassRules: '<-loopback>' }).catch(() => {});
  await sess.closeAllConnections().catch(() => {});
  await clearTorData();
  setState({ status: 'off', progress: 0, message: '', error: '', socksPort: null, exitIp: null });
  return getState();
}

async function clearTorData() {
  const sess = getTorSession();
  await Promise.all([
    sess.clearStorageData().catch(() => {}),
    sess.clearCache().catch(() => {}),
    sess.clearAuthCache().catch(() => {}),
    sess.clearHostResolverCache().catch(() => {})
  ]);
}

async function newCircuit() {
  if (!control || state.status !== 'connected') throw new Error('Tor ist nicht verbunden');
  await control.send('SIGNAL NEWNYM');
  await getTorSession().closeAllConnections().catch(() => {});
  setState({ exitIp: null });
  refreshExitIp();
  return getState();
}

async function newIdentity() {
  await clearTorData();
  return newCircuit();
}

async function setExitCountry(cc) {
  const country = sanitizeCountry(cc);
  setState({ exitCountry: country });
  if (!control || state.status !== 'connected') return getState();
  if (country) await control.send('SETCONF ExitNodes={' + country + '} StrictNodes=1');
  else await control.send('RESETCONF ExitNodes StrictNodes');
  return newCircuit();
}

let exitIpRequest = 0;
async function refreshExitIp() {
  if (state.status !== 'connected') return null;
  const id = ++exitIpRequest;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await getTorSession().fetch(TOR_CHECK_URL, { signal: ctrl.signal, cache: 'no-store' });
    const json = await res.json();
    if (id === exitIpRequest) setState({ exitIp: json && json.IsTor ? json.IP : null });
  } catch (e) {
  } finally {
    clearTimeout(timer);
  }
  return state.exitIp;
}

function shutdown() {
  stopping = true;
  killProcess();
}

module.exports = {
  TOR_PARTITION,
  events,
  getState,
  getTorSession,
  isTorSession,
  isTorContents,
  start,
  stop,
  newCircuit,
  newIdentity,
  setExitCountry,
  refreshExitIp,
  shutdown
};
