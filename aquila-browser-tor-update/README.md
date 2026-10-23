# Aquila Browser - Tor Update

This update adds a Tor mode to the Aquila Browser. It lets you open private tabs that route all traffic through the Tor network, similar to the "Private Window with Tor" feature in Brave. The design and behavior of this feature are inspired by Brave.

## Features

- **Tor tabs**: Open a private tab with Tor from the onion button in the toolbar, the tab context menu, or with `Alt + Shift + N`. Pressing `Ctrl + T` inside a Tor tab opens another Tor tab.
- **Built-in Tor process**: Aquila starts and manages its own Tor process. If Tor is already installed on the system (or the Tor Browser is found), that binary is used. Otherwise the official Tor Expert Bundle is downloaded from torproject.org on first use and verified against the published SHA256 checksums.
- **New Tor connection**: Request new circuits to get a different exit IP. The current exit IP is shown in the Tor panel.
- **New identity**: Clears all cookies, cache and site data of the Tor tabs and builds new circuits.
- **Exit country**: Choose the country of the exit node (for example Germany, Switzerland, Netherlands, USA). Changes apply live without restarting Tor.
- **Bridges**: Connect through obfs4, Snowflake or meek bridges if Tor is blocked on your network, or enter your own bridge lines from bridges.torproject.org.
- **.onion support**: Tor tabs can open onion services. Searches from the address bar go to the DuckDuckGo onion service.
- **Connection status**: The Tor start page and the toolbar button show the bootstrap progress and connection state.

## Privacy protections

Tor tabs are kept separate from normal browsing:

- Tor tabs use their own in-memory session. Nothing is written to disk, and all data is discarded when the last Tor tab is closed.
- Fail-closed networking: if Tor is not running or not yet connected, requests in Tor tabs fail instead of going out directly.
- No history, no session restore and no download history for Tor tabs.
- Extensions are disabled in Tor tabs.
- WebRTC is restricted so it cannot leak your real IP address.
- No DNS prefetching, no favicon lookups and no address bar suggestions that would bypass Tor.
- Location, camera, microphone and notification permissions are always denied.
- Pop-ups and links opened from a Tor tab stay in Tor tabs.
- Discord Rich Presence never shows Tor tab activity.

## Limitations

Tor mode in Aquila improves your privacy, but it does not make you fully anonymous. Websites can still identify you if you log in or enter personal information, and browser fingerprinting protections are not as strong as in the official Tor Browser. If you need the strongest possible anonymity, use the [Tor Browser](https://www.torproject.org/download/).

New circuits apply to the whole Tor session. Per-site circuit isolation is not available yet.

## Requirements

- Windows, macOS or Linux (x64; arm64 on macOS)
- An internet connection to download Tor on first use, or an existing Tor installation

On Linux you can also install Tor through your package manager, for example `sudo apt install tor`.

## Project files

| File | Purpose |
| --- | --- |
| `src/utils/tor-manager.js` | Starts and controls the Tor process, downloads Tor, handles circuits, exit country and bridges |
| `src/renderer/tor.js` | Toolbar button and Tor panel |
| `src/tor/tor-home.html` | Start page for new Tor tabs |
| `src/styles/components/tor.css` | Styles for Tor tabs and the Tor panel |

Changes to existing files: `main.js`, `src/index.html`, `src/renderer/tabs.js`, `src/renderer/renderer.js`, `src/renderer/suggestions.js`, `src/utils/keyboard-shortcuts.js`, `src/utils/discord-rpc.js` and the language files.

## Acknowledgements

- Inspired by the Private Window with Tor feature in [Brave](https://brave.com/).
- Uses [Tor](https://www.torproject.org/) by The Tor Project.

## License

Aquila Browser is licensed under the Apache License 2.0.
