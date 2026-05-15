/**
 * Auto-Updater — electron-updater integration for GitHub Releases
 *
 * Handles update checking, downloading, and installation via electron-updater.
 * Configured to use GitHub Releases as the update provider (see electron-builder.yml).
 *
 * Note: Auto-update is not yet fully configured for Linux. The update check
 * runs but GitHub releases may not exist yet. Errors are silently ignored.
 */

import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

export function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log("[Updater] Skipping update check in development mode");
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", info => {
    console.log(`[Updater] Update available: ${info.version}`);
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Available",
        message: `Version ${info.version} is available. Download now?`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(result => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("download-progress", progressObj => {
    console.log(`[Updater] Downloading: ${progressObj.percent}%`);
  });

  autoUpdater.on("update-downloaded", info => {
    console.log(`[Updater] Update downloaded: ${info.version}`);
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `Version ${info.version} has been downloaded. Restart to apply?`,
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(result => {
        if (result.response === 0) {
          setImmediate(() => autoUpdater.quitAndInstall());
        }
      });
  });

  autoUpdater.on("error", err => {
    console.error("[Updater] Update error:", err);
  });

  console.log("[Updater] Checking for updates...");
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    // Silently ignore update check errors (e.g., no GitHub releases yet)
  });
}
