const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.vbe',
  '.js', '.jse', '.wsf', '.wsh', '.ps1', '.ps2', '.psc1', '.msh', '.msh1',
  '.msh2', '.inf', '.reg', '.rgs', '.sct', '.shb', '.shs', '.ws',
  '.app', '.action', '.command', '.workflow',
  '.sh', '.csh', '.run', '.bin',
  '.dll', '.sys', '.drv', '.ocx',
  '.iso', '.img', '.dmg',
  '.jar', '.class',
  '.hta', '.cpl', '.msc', '.gadget'
]);

const SUSPICIOUS_DOUBLE_EXT = /\.(jpg|png|gif|pdf|doc|txt|mp3|mp4)\.(exe|scr|bat|cmd|com|pif|vbs|js|msi|ps1|sh)$/i;

function resolveDownloadPath(filename) {
  let dir;
  try {
    dir = app.getPath('downloads');
  } catch (e) {
    dir = path.join(os.homedir(), 'Downloads');
  }
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
  }
  let full = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(full)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    full = path.join(dir, `${base} (${i++})${ext}`);
  }
  return full;
}

function checkDownloadSafety(filePath) {
  try {
    const filename = path.basename(filePath).toLowerCase();
    const ext = path.extname(filename);
    const warnings = [];

    if (DANGEROUS_EXTENSIONS.has(ext)) {
      warnings.push('Potenziell gefährlicher Dateityp (' + ext + ')');
    }

    if (SUSPICIOUS_DOUBLE_EXT.test(filename)) {
      warnings.push('Verdächtige Doppel-Endung erkannt');
    }

    if (filename.includes('\u202e') || filename.includes('\u200e') || filename.includes('\u200f')) {
      warnings.push('Verdächtige Unicode-Zeichen im Dateinamen');
    }

    var fileSize = 0;
    try {
      var stats = fs.statSync(filePath);
      fileSize = stats.size;
    } catch(e) {}

    if (ext === '.exe' && fileSize > 0 && fileSize < 50000) {
      warnings.push('Ungewöhnlich kleine ausführbare Datei');
    }

    return {
      safe: warnings.length === 0,
      warnings: warnings,
      filename: filename,
      extension: ext,
      fileSize: fileSize
    };
  } catch (e) {
    return { safe: true, warnings: [], filename: '', extension: '', fileSize: 0 };
  }
}

module.exports = {
  resolveDownloadPath,
  checkDownloadSafety
};