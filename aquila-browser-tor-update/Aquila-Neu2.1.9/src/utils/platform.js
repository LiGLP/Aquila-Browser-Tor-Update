const SIMULATED_PLATFORM = process.env.AQUILA_PLATFORM || process.platform;

const IS_WINDOWS = SIMULATED_PLATFORM === 'win32';
const IS_MAC = SIMULATED_PLATFORM === 'darwin';
const IS_LINUX = SIMULATED_PLATFORM === 'linux';

function getPlatformInfo() {
  if (IS_WINDOWS) {
    return {
      uaPlatform: 'Windows',
      uaOsString: 'Windows NT 10.0; Win64; x64',
      secPlatform: '"Windows"',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      wow64: false
    };
  }
  if (IS_MAC) {
    return {
      uaPlatform: 'macOS',
      uaOsString: 'Macintosh; Intel Mac OS X 10_15_7',
      secPlatform: '"macOS"',
      platformVersion: '13.0.0',
      architecture: 'arm',
      bitness: '64',
      wow64: false
    };
  }
  return {
    uaPlatform: 'Linux',
    uaOsString: 'X11; Linux x86_64',
    secPlatform: '"Linux"',
    platformVersion: '6.5.0',
    architecture: 'x86',
    bitness: '64',
    wow64: false
  };
}

const PLATFORM = getPlatformInfo();

function getFullChromeVersion() {
  return process.versions.chrome || '134.0.0.0';
}

function getChromeMajorVersion() {
  return (process.versions.chrome || '134').split('.')[0];
}

function getChromeUserAgent() {
  return `Mozilla/5.0 (${PLATFORM.uaOsString}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${getFullChromeVersion()} Safari/537.36`;
}

function getUpdatePlatform() {
  if (IS_WINDOWS) return 'win';
  if (IS_MAC) return 'mac';
  return 'linux';
}

module.exports = {
  IS_WINDOWS,
  IS_MAC,
  IS_LINUX,
  PLATFORM,
  getFullChromeVersion,
  getChromeMajorVersion,
  getChromeUserAgent,
  getUpdatePlatform
};