/**
 * MCP Config Adapter — rewrites MCP server configs to use bundled runtimes
 *
 * The official Qwen Desktop app uses `adaptConfig()` to replace command names
 * (npx, bun, uvx) with actual bundled binary paths. This module replicates
 * that behavior for Linux:
 * - Replaces `npx` → bundled `bun` path
 * - Replaces `bun` → bundled `bun` path
 * - Replaces `uvx` → bundled `uvx` path
 * - Fixes macOS paths (/Users) to Linux home directory
 * - Sets PATH environment with bundled runtime directories
 * - Handles qwen-core bundled path (dev vs production)
 */

import path from "path";
import os from "os";
import { app } from "electron";
import { getBunPath, getUvxPath } from "./runtime.js";
import type { McpConfig, McpServerConfig } from "../shared/types.js";

/**
 * Get the path to qwen-core's src/index.ts
 * In development: uses the local qwen-core folder in the project
 * In production: uses the bundled qwen-core inside resources
 */
export function getQwenCorePath(): string {
  if (app.isPackaged) {
    // In production, qwen-core is bundled at resources/qwen-core/
    return path.join(process.resourcesPath, "qwen-core", "src", "index.ts");
  }
  // In development, use the local qwen-core folder
  // Option 1: qwen-core is a subfolder in the project root
  const localQwenCore = path.join(app.getAppPath(), "qwen-core", "src", "index.ts");
  
  // Check if local path exists, otherwise try relative to current working dir
  try {
    const fs = require("fs");
    if (fs.existsSync(localQwenCore)) {
      return localQwenCore;
    }
  } catch {}
  
  // Option 2: fallback to relative path from where app is run
  return path.join(process.cwd(), "qwen-core", "src", "index.ts");
}

/**
 * Get the default MCP config for qwen-core
 * Returns a config that can be adapted by adaptConfig()
 */
export function getDefaultQwenCoreConfig(): McpServerConfig {
  return {
    command: "npx", // Will be replaced with system npx path by adaptConfig()
    args: ["tsx", getQwenCorePath()],
    cwd: app.isPackaged 
      ? path.join(process.resourcesPath, "qwen-core")
      : path.join(app.getAppPath(), "qwen-core"),
  };
}

/**
 * Adapt MCP config to use bundled runtimes
 * Replaces "npx", "bun", "uvx" with bundled binary paths
 * This is the Linux equivalent of the official app's adaptConfig function
 */
export function adaptConfig(configs: McpConfig): McpConfig {
  const adapted = { ...configs };
  const correctBunPath = getBunPath();
  const correctUvxPath = getUvxPath();

  for (const key in adapted) {
    const config = adapted[key];
    let cmd = config.command;

    // qwen-core uses npx tsx - use system npx
    if (key === "qwen-core") {
      cmd = "npx";
      // Update cwd and path for packaged app
      if (app.isPackaged) {
        config.cwd = path.join(process.resourcesPath, "qwen-core");
        // Update the path argument to use bundled location
        const corePath = getQwenCorePath();
        if (config.args) {
          config.args = config.args.map((arg: string) => 
            arg.includes("qwen-core") ? corePath : arg
          );
        }
      }
    }
    // Always normalize to the correct bundled runtime path
    // Replace any path ending with /bun (from any source) with the bundled one
    else if (cmd.endsWith("/bun") || cmd === "bun" || cmd === "npx") {
      cmd = correctBunPath;
      if (
        config.command === "npx" ||
        (!config.command.endsWith("/bun") && config.command !== correctBunPath)
      ) {
        config.args = config.args || [];
        if (!config.args.includes("-y")) {
          config.args.unshift("-y");
        }
        if (!config.args.includes("x")) {
          config.args.unshift("x");
        }
      }
    }

    // Replace any path ending with /uvx or "uvx" with bundled one
    if (cmd.endsWith("/uvx") || cmd === "uvx") {
      cmd = correctUvxPath;
    }

    config.command = cmd;

    // Fix macOS paths (/Users) to Linux home directory
    if (config.args && config.args.length > 0) {
      const homeDir = os.homedir();
      config.args = config.args.map((arg: string) => {
        if (arg === "/Users" || arg.startsWith("/Users/")) {
          return arg.replace("/Users", homeDir);
        }
        return arg;
      });
    }

    // Set PATH environment with Linux standard paths + bundled bin
    // In production, project resources are nested at resources/resources/ inside process.resourcesPath
    const runtimeDir = app.isPackaged
      ? path.join(process.resourcesPath, "resources")
      : path.join(process.cwd(), "resources");
    const bunDir = path.join(
      runtimeDir,
      "bun",
      process.arch === "arm64" ? "linux-arm64" : "linux-x64",
    );
    const uvDir = path.join(
      runtimeDir,
      "uv",
      process.arch === "arm64" ? "linux-arm64" : "linux-x64",
    );

    const PATH = [
      bunDir,
      uvDir,
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/snap/bin",
      path.join(os.homedir(), ".local", "bin"),
    ].join(":");

    config.env = {
      HOME: os.homedir(),
      USER: process.env.USER || os.userInfo().username,
      PATH,
      MCP_ALLOWED_DIRS: [
        os.homedir(),
        path.join(os.homedir(), "Projects"),
        "/tmp",
      ].join(","),
      MCP_TIMEOUT: "60000",
    };
  }

  return adapted;
}
