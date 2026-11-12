# ❄️ Deskfall

**Snow falls on your desktop.** It piles up on top of your windows and your taskbar, windows
get twinkling holiday lights, a little snowplow comes by to clear the taskbar, and you can roll
snowballs and build snowmen with your mouse.

Deskfall is free and open source (MIT). It is a transparent, click-through overlay: you keep
using your computer normally while it snows.

> 🇹🇷 **Türkçe:** Deskfall masaüstünüze kar yağdırır. Kar pencerelerin ve görev çubuğunun
> üstünde birikir, pencerelerde yılbaşı ışıkları yanar, minik bir kar küreme aracı görev
> çubuğunu temizler, fareyle kartopu yuvarlayıp kardan adam yapabilirsiniz. Menü, sistem dili
> Türkçe ise Türkçe görünür.

## ✨ Features

- **Snowfall** with depth, wind gusts and occasional large crystal flakes
- **Snow piles up** on the top edge of every window, and only on the parts you can see. It
  drapes over the rounded corners like a soft blanket.
- **Shake it off**: move a window quickly, close it or minimize it, and its snow falls down and
  lands on whatever is below. A fast flick of the mouse through a pile knocks snow off.
- **Holiday lights** along the top of each window (all windows, only the active one, or off)
- **Snowplow** 🚜: drives along the taskbar every minute or two, pushing a wedge of snow.
  - **Click it** to shoo it away: it raises its blade and leaves without clearing anything.
  - **Block it** with a snowman: it honks and turns around.
- **Snowmen** ⛄
  - **Drag along the taskbar snow** to roll a snowball; it grows as it picks up snow.
  - **Lift a ball and drop it on another** to stack it.
  - **Two or three balls** become a snowman with eyes that follow your cursor, a carrot nose, a
    scarf, stick arms and sometimes a top hat. Snowmen blink and wave.
  - **Double-click** a snowman to knock it over.
- **Stays out of the way**
  - Pauses completely on any screen with a maximized or fullscreen window (no CPU or GPU used
    there).
  - Draws at 30 fps.
  - Never covers the taskbar.
- **Multi-monitor** and high-DPI aware
- Tray menu in **English and Turkish**

## 📥 Install

Download the installer for your system from the
[**latest release**](https://github.com/biyusku/deskfall/releases/latest):

| System | File | Notes |
|---|---|---|
| **Windows** 10/11 | `Deskfall-Setup-x.y.z.exe` | One click, starts right away. Or use the portable `.exe`. |
| **macOS** (Apple Silicon & Intel) | `Deskfall-x.y.z-*.dmg` | The app is not signed yet: the first time, right-click the app → **Open**. |
| **Linux** | `Deskfall-x.y.z.AppImage` or `.deb` | AppImage: `chmod +x` it and run. Needs a compositing desktop for transparency. |

Then look for the ❄️ snowflake in your system tray / menu bar.

## 🎮 Usage

- **Right-click the tray snowflake** for every setting: intensity, wind, lights, snowplow,
  snowmen, pausing on maximized windows and starting with your computer.
- **Click the tray snowflake**, or press **Ctrl+Alt+K** (**⌘⌥K** on macOS), to show or hide the
  snow.

## 🖥️ Platform support

| Feature | Windows | macOS | Linux (X11) | Linux (Wayland) |
|---|:-:|:-:|:-:|:-:|
| Falling snow, wind, tray menu | ✅ | ✅ | ✅ | ✅ |
| Snow piling on taskbar / Dock / panel, snowplow | ✅ | ✅ | ✅ | ✅ |
| Snowmen (mouse play), clicking the plow | ✅ | ✅ | ⚠️ | ⚠️ |
| Snow piling on windows, lights on windows | ✅ | 🚧 | 🚧 | ❌ |
| Pause on maximized windows | ✅ | 🚧 | 🚧 | ❌ |

✅ works · ⚠️ limited (Electron cannot forward mouse movement through click-through windows on
Linux) · 🚧 planned: needs a native window tracker (see below) · ❌ Wayland does not let apps
see other windows' positions

## 🛠️ Development

You need [Node.js](https://nodejs.org/) 22 or newer.

```bash
git clone https://github.com/biyusku/deskfall.git
cd deskfall
npm install
npm start            # build and run
npm test             # unit tests (vitest)
npm run typecheck    # TypeScript
npm run dist         # build an installer for your current OS into release/
```

### How it works

| Part | Path | Role |
|---|---|---|
| Main process | `src/main/` | One transparent, always-on-top, click-through window per display; tray menu, settings, window tracking |
| Window tracker | `src/helper/winlist.ps1` | Windows only. A tiny PowerShell/C# helper that streams visible window rectangles and z-order as JSON lines. |
| Renderer | `src/renderer/` | Canvas simulation |

The renderer is split into these modules:

| File | What it does |
|---|---|
| `snow-layer.ts` | Height map of snow on an edge |
| `surfaces.ts` | Which window edges are visible and where flakes land |
| `flakes.ts` | Falling snow |
| `plow.ts` | Snowplow |
| `snowman.ts` | Snowballs and snowmen |
| `garland.ts` | Holiday lights |
| `draw-snow.ts` | Drawing the snow blankets |

The overlay only becomes clickable while your cursor is over snow you can play with, or over the
snowplow. Everything else passes straight through to the windows underneath.

### Contributing

Issues and pull requests are welcome! The most wanted contributions are:

1. **macOS window tracker**: a small Swift helper using `CGWindowListCopyWindowInfo`. It must
   print the same JSON format as `winlist.ps1`.
2. **Linux X11 window tracker**: `_NET_CLIENT_LIST_STACKING` plus window geometry.
3. Screenshots and a demo GIF for this README

Please run `npm run typecheck && npm test` before opening a pull request.

## 📄 License

[MIT](LICENSE) © biyusku and Deskfall contributors
