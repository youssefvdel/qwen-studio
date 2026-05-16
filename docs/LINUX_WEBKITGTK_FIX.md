# Qwen Studio - Linux WebKitGTK Fix

## Problem
On Linux, the Tauri app may show a blank white screen or crash immediately on startup. This is a known issue with WebKitGTK's GPU compositing and DMA buffer rendering on certain hardware/driver combinations (especially NVIDIA GPUs and some Wayland setups).

## Solution
Set these environment variables before running the app:

```bash
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
```

## Permanent Fix
The `package.json` scripts already include these variables for all Tauri commands:
- `npm run tauri:dev`
- `npm run tauri:build`
- `npm run tauri:build:rpm`
- `npm run tauri:build:deb`
- `npm run tauri:build:appimage`

## For Production Builds
When distributing the app, create a wrapper script or desktop entry that sets these variables:

```ini
[Desktop Entry]
Name=Qwen Studio
Exec=env WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 /usr/bin/qwen-studio
Type=Application
```

## References
- [Tauri Issue #7927](https://github.com/tauri-apps/tauri/issues/7927)
- [Tauri Issue #10626](https://github.com/tauri-apps/tauri/issues/10626)
- [Tauri Issue #13899](https://github.com/tauri-apps/tauri/issues/13899)
