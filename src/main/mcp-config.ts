/**
 * MCP Config Adapter — rewrites MCP server configs to use bundled runtimes
 *
 * Simplified configuration for built-in qwen-core:
 * - Single source of truth for qwen-core path
 * - Uses app.isPackaged to differentiate dev/prod
 * - Minimal path rewriting - just ensure bundled runtimes are used
 * - Validates qwen-core exists before connecting
 */

import path from "path";
import os from "os";
import { app } from "electron";
import fs from "fs";
import { getBunPath, getUvxPath } from "./runtime.js";
import type { McpConfig, McpServerConfig } from "../shared/types.js";

/**
 * Get the path to qwen-core's src/index.ts
 * Single, reliable source of truth based on app.isPackaged
 */
export function getQwenCorePath(): string {
  if (app.isPackaged) {
    // Production: qwen-core bundled at resources/qwen-core/
    return path.join(process.resourcesPath, "qwen-core", "src", "index.ts");
  }
  // Development: qwen-core in project root
  return path.join(app.getAppPath(), "qwen-core", "src", "index.ts");
}

/**
 * Get the qwen-core directory path
 */
export function getQwenCoreDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "qwen-core");
  }
  return path.join(app.getAppPath(), "qwen-core");
}

/**
 * Validate that qwen-core exists and is properly set up
 */
export function validateQwenCore(): { valid: boolean; error?: string } {
  const corePath = getQwenCorePath();
  const coreDir = getQwenCoreDir();

  // Check if directory exists
  if (!fs.existsSync(coreDir)) {
    return { valid: false, error: `qwen-core directory not found: ${coreDir}` };
  }

  // Check if source file exists
  if (!fs.existsSync(corePath)) {
    return { valid: false, error: `qwen-core entry point not found: ${corePath}` };
  }

  // In dev mode, also check for package.json
  if (!app.isPackaged) {
    const packageJson = path.join(coreDir, "package.json");
    if (!fs.existsSync(packageJson)) {
      return {
        valid: false,
        error: `qwen-core package.json not found (run npm install in qwen-core)`,
      };
    }
  }

  return { valid: true };
}

/**
 * Get the default MCP config for qwen-core
 * Returns a config ready for use (no adaptation needed for qwen-core)
 */
export function getDefaultQwenCoreConfig(): McpServerConfig {
  const coreDir = getQwenCoreDir();
  const corePath = getQwenCorePath();

  return {
    command: "bun", // Will be replaced with bundled bun path by adaptConfig
    args: ["run", corePath],
    cwd: coreDir,
    env: {
      MCP_ALLOWED_DIRS: `${os.homedir()},${path.join(os.homedir(), "Projects")},/tmp`,
      MCP_TIMEOUT: "60000",
    },
  };
}

/**
 * Adapt MCP config to use bundled runtimes
 * Simplified: just ensure command uses correct bundled binary path
 */
export function adaptConfig(configs: McpConfig): McpConfig {
  const adapted = { ...configs };
  const correctBunPath = getBunPath();
  const correctUvxPath = getUvxPath();
  const homeDir = os.homedir();

  for (const key in adapted) {
    const config = adapted[key];

    // Replace command with bundled runtime if needed
    if (config.command === "bun" || config.command.endsWith("/bun")) {
      config.command = correctBunPath;
    } else if (config.command === "uvx" || config.command.endsWith("/uvx")) {
      config.command = correctUvxPath;
    } else if (config.command === "npx") {
      // For npx, use bundled bun with -y x flags
      config.command = correctBunPath;
      config.args = config.args || [];
      if (!config.args.includes("-y")) config.args.unshift("-y");
      if (!config.args.includes("x")) config.args.unshift("x");
    }

    // Set consistent environment for all MCP servers
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

    config.env = {
      HOME: homeDir,
      USER: process.env.USER || os.userInfo().username,
      PATH: [
        bunDir,
        uvDir,
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/snap/bin",
        path.join(homeDir, ".local", "bin"),
      ].join(":"),
      MCP_ALLOWED_DIRS: [homeDir, path.join(homeDir, "Projects"), "/tmp"].join(","),
      MCP_TIMEOUT: "60000",
      ...config.env, // Preserve any server-specific env vars
    };
  }

  return adapted;
}
