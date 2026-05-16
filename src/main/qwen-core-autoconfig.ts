/**
 * qwen-core Auto-Configurator
 *
 * Ensures qwen-core is in the MCP config on first launch.
 * qwen-core is installed as an npm dependency.
 */

import type { McpServerConfig } from "../shared/types.js";
import { getDefaultQwenCoreConfig } from "./mcp-config.js";

/**
 * Auto-configure qwen-core on first launch
 */
export async function autoConfigureQwenCore(
  getCurrentConfig: () => Promise<any>,
  saveConfig: (config: any) => Promise<void>,
): Promise<{ success: boolean; message: string }> {
  try {
    const currentConfig = await getCurrentConfig();

    if (currentConfig["qwen-core"]) {
      return {
        success: true,
        message: "qwen-core already configured",
      };
    }

    currentConfig["qwen-core"] = getDefaultQwenCoreConfig();
    await saveConfig(currentConfig);

    return {
      success: true,
      message: "qwen-core auto-configured",
    };
  } catch (error) {
    return {
      success: false,
      message: `Auto-configuration failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Get qwen-core status for UI
 */
export async function getQwenCoreStatus(): Promise<{
  configured: boolean;
  running: boolean;
  version: string | null;
  issues: string[];
}> {
  const issues: string[] = [];

  return {
    configured: true,
    running: false,
    version: "2.1.1",
    issues,
  };
}
