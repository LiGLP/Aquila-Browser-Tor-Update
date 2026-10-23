const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const util = require('util');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);
const { IS_WINDOWS, IS_MAC, IS_LINUX } = require('./platform');

function getRegExe() {
  return `"${path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')}"`;
}

async function registerBrowserWindows() {
  try {
    const reg = getRegExe();
    const exePath = app.getPath('exe').replace(/\\/g, '\\\\');
    const exeName = path.basename(exePath, '.exe');
    const appName = 'Aquila Browser';
    const progId = 'AquilaBrowser.HTML';
    const description = 'Fast, Modern, Powerful Browser';
    const commands = [
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}" /ve /d "${appName} HTML Document" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\Application" /v ApplicationIcon /d "${exePath},0" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\Application" /v ApplicationName /d "${appName}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\Application" /v ApplicationDescription /d "${description}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\Application" /v ApplicationCompany /d "LotusCity" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\DefaultIcon" /ve /d "${exePath},0" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\shell" /ve /d "open" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\shell\\open" /ve /d "&Open" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\${progId}\\shell\\open\\command" /ve /d "\\"${exePath}\\" \\"%1\\"" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}" /ve /d "${appName}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}" /v LocalizedString /d "${appName}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities" /v ApplicationName /d "${appName}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities" /v ApplicationIcon /d "${exePath},0" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities" /v ApplicationDescription /d "${description}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .htm /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .html /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .shtml /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .xht /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .xhtml /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .pdf /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .svg /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .mhtml /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .mht /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .webp /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .mp3 /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .mp4 /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .webm /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .ogg /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .wav /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .m4a /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .flac /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .aac /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .opus /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .mov /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .mkv /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .avi /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .m4v /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\FileAssociations" /v .3gp /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\Startmenu" /v StartMenuInternet /d "${exeName}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\URLAssociations" /v http /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\URLAssociations" /v https /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\Capabilities\\URLAssociations" /v ftp /d "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\DefaultIcon" /ve /d "${exePath},0" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\InstallInfo" /v IconsVisible /t REG_DWORD /d 1 /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\InstallInfo" /v ReinstallCommand /d "\\"${exePath}\\"" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\InstallInfo" /v HideIconsCommand /d "\\"${exePath}\\" /hideicons" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\InstallInfo" /v ShowIconsCommand /d "\\"${exePath}\\" /showicons" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Clients\\StartMenuInternet\\${exeName}\\shell\\open\\command" /ve /d "\\"${exePath}\\"" /f`,
      `${reg} add "HKCU\\SOFTWARE\\RegisteredApplications" /v "${exeName}" /d "SOFTWARE\\\\Clients\\\\StartMenuInternet\\\\${exeName}\\\\Capabilities" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.pdf\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.htm\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.html\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.svg\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.mhtml\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.webp\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.mp3\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.mp4\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.webm\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.ogg\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.wav\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.m4a\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.flac\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.mov\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.mkv\\OpenWithProgids" /v "${progId}" /f`,
      `${reg} add "HKCU\\SOFTWARE\\Classes\\.mp4\\OpenWithProgids" /v "${progId}" /f`
    ];
    for (const command of commands) {
      await execPromise(command);
    }
    try {
      await execPromise(`${reg} add "HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer" /v NoNewAppAlert /t REG_DWORD /d 1 /f`);
    } catch (err) {}
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function registerBrowserLinux() {
  try {
    const exePath = app.getPath('exe');
    const appName = 'Aquila Browser';
    const desktopId = 'aquila-browser';
    const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
    if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });
    const desktopContent = [
      '[Desktop Entry]',
      'Version=1.0',
      `Name=${appName}`,
      'Comment=Fast, Modern, Powerful Browser',
      `Exec="${exePath}" %U`,
      'Terminal=false',
      'Type=Application',
      'Categories=Network;WebBrowser;',
      'MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;',
      `StartupWMClass=${desktopId}`,
      ''
    ].join('\n');
    const desktopPath = path.join(desktopDir, `${desktopId}.desktop`);
    fs.writeFileSync(desktopPath, desktopContent);
    fs.chmodSync(desktopPath, '755');
    try { await execPromise('update-desktop-database ~/.local/share/applications/ 2>/dev/null'); } catch(e) {}
    try { await execPromise(`xdg-settings set default-web-browser ${desktopId}.desktop`); } catch(e) {}
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function registerBrowserMac() {
  try {
    app.setAsDefaultProtocolClient('http');
    app.setAsDefaultProtocolClient('https');
    return { success: true, message: 'Bitte wähle Aquila als Standard in den macOS Systemeinstellungen.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function registerAsDefaultBrowser() {
  if (IS_WINDOWS) return await registerBrowserWindows();
  if (IS_LINUX) return await registerBrowserLinux();
  if (IS_MAC) return await registerBrowserMac();
  return { success: false, error: 'Unbekanntes Betriebssystem' };
}

async function checkIfDefaultBrowser() {
  try {
    if (IS_WINDOWS) {
      const reg = getRegExe();
      const exePath = app.getPath('exe').toLowerCase();
      const exeName = path.basename(exePath).toLowerCase();

      for (const proto of ['http', 'https']) {
        try {
          const { stdout } = await execPromise(
            `${reg} query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${proto}\\UserChoice" /v ProgId`,
            { windowsHide: true }
          );
          const lines = stdout.split('\n');
          let progId = '';
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes('ProgId') && line.includes('REG_SZ')) {
              const parts = line.split('REG_SZ');
              if (parts[1]) { progId = parts[1].trim(); break; }
            }
          }
          if (!progId) continue;
          if (progId.toLowerCase().includes('aquila')) return true;
          if (progId.toLowerCase().includes('aquilabrowser')) return true;

          const regPaths = [
            `HKCU\\Software\\Classes\\${progId}\\shell\\open\\command`,
            `HKLM\\Software\\Classes\\${progId}\\shell\\open\\command`,
            `HKCR\\${progId}\\shell\\open\\command`
          ];
          for (const regPath of regPaths) {
            try {
              const { stdout: cmdOut } = await execPromise(`${reg} query "${regPath}" /ve`, { windowsHide: true });
              if (cmdOut.toLowerCase().includes(exeName)) return true;
            } catch (e) {}
          }

          if (progId.toLowerCase().startsWith('appx')) {
            const appRegPaths = [
              `HKCU\\Software\\Classes\\${progId}\\Application`,
              `HKLM\\Software\\Classes\\${progId}\\Application`,
              `HKCR\\${progId}\\Application`
            ];
            for (const appPath of appRegPaths) {
              try {
                const { stdout: appOut } = await execPromise(`${reg} query "${appPath}"`, { windowsHide: true });
                if (appOut.toLowerCase().includes('aquila')) return true;
                if (appOut.toLowerCase().includes(exeName)) return true;
              } catch (e) {}
            }
          }
        } catch (err) {}
      }

      try {
        const { stdout: psOut } = await execPromise(
          `powershell -NoProfile -Command "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice').ProgId"`,
          { windowsHide: true, timeout: 3000 }
        );
        const psProgId = psOut.trim();
        if (psProgId.toLowerCase().includes('aquila')) return true;
        try {
          const { stdout: psCmd } = await execPromise(
            `powershell -NoProfile -Command "(Get-ItemProperty 'HKCR:\\${psProgId}\\shell\\open\\command').'(default)'"`,
            { windowsHide: true, timeout: 3000 }
          );
          if (psCmd.toLowerCase().includes(exeName)) return true;
        } catch (e) {}
      } catch (e) {}

      return false;
    }

    if (IS_LINUX) {
      try {
        const { stdout } = await execPromise('xdg-settings get default-web-browser 2>/dev/null');
        return stdout.trim().toLowerCase().includes('aquila');
      } catch (e) {
        return false;
      }
    }

    if (IS_MAC) {
      return app.isDefaultProtocolClient('https') || app.isDefaultProtocolClient('http');
    }

    return false;
  } catch (error) {
    return false;
  }
}

module.exports = {
  registerAsDefaultBrowser,
  checkIfDefaultBrowser
};