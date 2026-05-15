/**
 * Runtime Manager — bundled bun + uv binary path resolution
 *
 * Downloads and manages the bundled runtimes (bun, uv, uvx) that MCP
 * servers depend on. Handles platform-specific paths for Linux/macOS/Windows.
 *
 * Key functions:
 * - getRuntimePaths() — Returns absolute paths to bun, uv, uvx binaries
 * - ensureRuntimesExecutable() — chmod 0o755 on Linux/macOS (dev mode only)
 * - getPlatformName()/getPlatformDir() — Platform detection helpers
 *
 * Note: electron-builder nests project resources/ inside process.resourcesPath,
 * creating a double nesting (resources/resources/bun/...). This is handled
 * by checking app.isPackaged and adjusting the path accordingly.
 */

import path from "path";
import fs from "fs";
import { app } from "electron";
import type { RuntimePaths } from "../shared/types.js";

/**
 * Get platform-specific paths for bundled runtimes
 * Supports Linux (x64/arm64), macOS, and Windows
 */
export function getRuntimePaths(): RuntimePaths {
  const platform = process.platform;
  const arch = process.arch;
  // In production, process.resourcesPath points to the app's resources dir
  // electron-builder nests our project resources/ inside it, creating resources/resources/
  // In development, fall back to project root
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), "resources");

  if (platform === "linux") {
    const archDir = arch === "arm64" ? "linux-arm64" : "linux-x64";
    const bunDir = arch === "arm64" ? "bun-linux-arm64" : "bun-linux-x64";
    const uvDir =
      arch === "arm64" ? "uv-aarch64-unknown-linux-musl" : "uv-x86_64-unknown-linux-musl";
    return {
      bun: app.isPackaged
        ? path.join(resourcesPath, "resources", "bun", archDir, bunDir, "bun")
        : path.join(resourcesPath, "bun", archDir, bunDir, "bun"),
      uv: app.isPackaged
        ? path.join(resourcesPath, "resources", "uv", archDir, uvDir, "uv")
        : path.join(resourcesPath, "uv", archDir, uvDir, "uv"),
      uvx: app.isPackaged
        ? path.join(resourcesPath, "resources", "uv", archDir, uvDir, "uvx")
        : path.join(resourcesPath, "uv", archDir, uvDir, "uvx"),
    };
  }

  if (platform === "darwin") {
    const archDir = arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    return {
      bun: app.isPackaged
        ? path.join(resourcesPath, "resources", "bun", archDir, "bun")
        : path.join(resourcesPath, "bun", archDir, "bun"),
      uv: app.isPackaged
        ? path.join(resourcesPath, "resources", "uv", archDir, "uv")
        : path.join(resourcesPath, "uv", archDir, "uv"),
      uvx: app.isPackaged
        ? path.join(resourcesPath, "resources", "uv", archDir, "uvx")
        : path.join(resourcesPath, "uv", archDir, "uvx"),
    };
  }

  if (platform === "win32") {
    return {
      bun: app.isPackaged
        ? path.join(resourcesPath, "resources", "bun", "win-x64", "bun.exe")
        : path.join(resourcesPath, "bun", "win-x64", "bun.exe"),
      uv: app.isPackaged
        ? path.join(resourcesPath, "resources", "uv", "win-x64", "uv.exe")
        : path.join(resourcesPath, "uv", "win-x64", "uv.exe"),
      uvx: app.isPackaged
        ? path.join(resourcesPath, "resources", "uv", "win-x64", "uvx.exe")
        : path.join(resourcesPath, "uv", "win-x64", "uvx.exe"),
    };
  }

  throw new Error(`Unsupported platform: ${platform}, arch: ${arch}`);
}

/**
 * Get the path to the bundled bun runtime
 */
export function getBunPath(): string {
  return getRuntimePaths().bun;
}

/**
 * Get the path to the bundled uv runtime
 */
export function getUvPath(): string {
  return getRuntimePaths().uv;
}

/**
 * Get the path to the bundled uvx runtime
 */
export function getUvxPath(): string {
  return getRuntimePaths().uvx;
}

/**
 * Check if a bundled runtime exists and is executable
 */
export function checkRuntimeExists(runtimePath: string): boolean {
  try {
    return (
      fs.existsSync(runtimePath) && fs.accessSync(runtimePath, fs.constants.X_OK) === undefined
    );
  } catch {
    return false;
  }
}

/**
 * Ensure bundled runtimes are executable (Linux/macOS)
 */
export async function ensureRuntimesExecutable(): Promise<void> {
  if (process.platform === "win32") return;
  // Skip chmod on packaged apps — files are already executable from the RPM
  if (app.isPackaged) return;

  const runtimes = getRuntimePaths();
  const chmod = require("fs").promises.chmod;

  for (const runtimePath of Object.values(runtimes)) {
    try {
      if (fs.existsSync(runtimePath)) {
        await chmod(runtimePath, 0o755);
        console.log(`[Runtime] Made executable: ${runtimePath}`);
      }
    } catch (error) {
      console.warn(`[Runtime] Failed to chmod ${runtimePath}:`, error);
    }
  }
}

/**
 * Get platform name for display
 */
export function getPlatformName(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") return `Linux ${arch}`;
  if (platform === "darwin") return `macOS ${arch}`;
  if (platform === "win32") return `Windows ${arch}`;
  return `${platform} ${arch}`;
}

/**
 * Get platform directory name (for auto-updater, etc.)
 */
export function getPlatformDir(platform = process.platform, arch = process.arch): string {
  if (platform === "darwin") return arch === "arm64" ? "mac-arm64" : "mac-x64";
  if (platform === "win32") return "win-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
  throw new Error(`Unsupported platform: ${platform}, arch: ${arch}`);
}
