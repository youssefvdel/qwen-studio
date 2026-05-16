/**
 * MCP Config Adapter — passes through configs without modification
 *
 * qwen-core is installed via npm dependency and runs via npx.
 * No runtime rewriting needed.
 */

import type { McpConfig, McpServerConfig } from "../shared/types.js";

/**
 * Get default MCP config for qwen-core
 * Uses npx to run the npm package
 */
export function getDefaultQwenCoreConfig(): McpServerConfig {
  return {
    command: "npx",
    args: ["-y", "qwen-core"],
  };
}

/**
 * Pass through config without modification
 * npx works fine on its own
 */
export function adaptConfig(configs: McpConfig): McpConfig {
  return { ...configs };
}
