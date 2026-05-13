/**
 * qwen-core Auto-Configurator
 * 
 * Automatically detects, validates, and configures qwen-core MCP server
 * on first run or when configuration is missing.
 * 
 * Features:
 * - Auto-detects qwen-core in multiple locations
 * - Validates installation and dependencies
 * - Creates default configuration
 * - Provides migration from old configs
 * - Handles both dev and production modes
 */

import { app } from "electron";
import path from "path";
import fs from "fs";
import type { McpServerConfig } from "../shared/types.js";
import { getBunPath } from "./runtime.js";

/**
 * Possible qwen-core locations to check
 */
const QWEN_CORE_LOCATIONS = [
  // Inside qwen-studio project (development)
  path.join(app.getAppPath(), "qwen-core"),
  path.join(process.cwd(), "qwen-core"),
  
  // Bundled in production
  path.join(process.resourcesPath, "resources", "qwen-core"),
  
  // Global installations
  path.join(app.getPath("home"), ".qwen-core"),
  path.join(app.getPath("appData"), "qwen-core"),
  
  // System-wide
  "/opt/qwen-core",
  "/usr/share/qwen-core",
];

/**
 * Result of qwen-core detection
 */
interface QwenCoreDetectionResult {
  found: boolean;
  location: string | null;
  version: string | null;
  hasSource: boolean;
  hasNodeModules: boolean;
  isValid: boolean;
  error?: string;
}

/**
 * Detect qwen-core installation
 * Checks multiple locations and validates the installation
 */
export async function detectQwenCore(): Promise<QwenCoreDetectionResult> {
  for (const location of QWEN_CORE_LOCATIONS) {
    try {
      const result = await validateQwenCoreLocation(location);
      if (result.found && result.isValid) {
        console.log(`[AutoConfig] Found valid qwen-core at: ${location}`);
        return result;
      }
    } catch (error) {
      console.debug(`[AutoConfig] ${location}: ${(error as Error).message}`);
    }
  }
  
  return {
    found: false,
    location: null,
    version: null,
    hasSource: false,
    hasNodeModules: false,
    isValid: false,
    error: "qwen-core not found in any known location"
  };
}

/**
 * Validate a specific qwen-core location
 */
async function validateQwenCoreLocation(
  location: string
): Promise<QwenCoreDetectionResult> {
  try {
    // Check if directory exists
    if (!fs.existsSync(location)) {
      return {
        found: false,
        location,
        version: null,
        hasSource: false,
        hasNodeModules: false,
        isValid: false
      };
    }

    // Check for package.json
    const packageJsonPath = path.join(location, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return {
        found: true,
        location,
        version: null,
        hasSource: false,
        hasNodeModules: false,
        isValid: false,
        error: "Missing package.json"
      };
    }

    // Read and parse package.json
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf-8")
    );
    
    if (packageJson.name !== "qwen-core") {
      return {
        found: true,
        location,
        version: packageJson.version || null,
        hasSource: false,
        hasNodeModules: false,
        isValid: false,
        error: `Wrong package: ${packageJson.name}`
      };
    }

    // Check for source files
    const srcIndex = path.join(location, "src", "index.ts");
    const hasSource = fs.existsSync(srcIndex);

    // Check for node_modules (dev mode)
    const nodeModules = path.join(location, "node_modules");
    const hasNodeModules = fs.existsSync(nodeModules);

    // Validate based on mode
    const isValid = app.isPackaged 
      ? hasSource // Production: just need source (bundled)
      : hasSource && hasNodeModules; // Dev: need both

    if (!isValid && !app.isPackaged) {
      return {
        found: true,
        location,
        version: packageJson.version || null,
        hasSource,
        hasNodeModules,
        isValid: false,
        error: !hasSource 
          ? "Missing src/index.ts" 
          : "Missing node_modules (run npm install)"
      };
    }

    return {
      found: true,
      location,
      version: packageJson.version || null,
      hasSource,
      hasNodeModules,
      isValid: true
    };
  } catch (error) {
    return {
      found: false,
      location,
      version: null,
      hasSource: false,
      hasNodeModules: false,
      isValid: false,
      error: (error as Error).message
    };
  }
}

/**
 * Generate MCP server config for detected qwen-core
 */
export function generateQwenCoreConfig(
  location: string
): McpServerConfig {
  const isDev = !app.isPackaged;
  
  return {
    command: "bun", // Will be replaced with bundled bun by adaptConfig
    args: [
      "tsx",
      path.join(location, "src", "index.ts")
    ],
    cwd: location,
    env: {
      MCP_ALLOWED_DIRS: `${app.getPath("home")},/tmp`,
      MCP_TIMEOUT: "60000",
      ...(isDev 
        ? { DEBUG_MCP: "true" } 
        : {}
      )
    }
  };
}

/**
 * Auto-configure qwen-core
 * 
 * Call this during app initialization to ensure qwen-core
 * is properly configured in MCP settings.
 */
export async function autoConfigureQwenCore(
  getCurrentConfig: () => Promise<any>,
  saveConfig: (config: any) => Promise<void>
): Promise<{ success: boolean; message: string }> {
  try {
    console.log("[AutoConfig] Starting qwen-core auto-configuration...");
    
    // Detect qwen-core
    const detection = await detectQwenCore();
    
    if (!detection.found || !detection.isValid) {
      const msg = `qwen-core not found: ${detection.error || "Invalid installation"}`;
      console.warn("[AutoConfig]", msg);
      return {
        success: false,
        message: msg
      };
    }
    
    // Get current config
    const currentConfig = await getCurrentConfig();
    
    // Check if qwen-core already configured
    if (currentConfig["qwen-core"]) {
      console.log("[AutoConfig] qwen-core already configured");
      
      // Verify the path is still valid
      const existingPath = currentConfig["qwen-core"].args?.find(
        (arg: string) => arg.includes("qwen-core")
      );
      
      if (existingPath && fs.existsSync(existingPath)) {
        return {
          success: true,
          message: "qwen-core configuration verified"
        };
      }
      
      console.log("[AutoConfig] Existing path invalid, updating...");
    }
    
    // Generate new config
    const newConfig = generateQwenCoreConfig(detection.location!);
    
    // Update config
    currentConfig["qwen-core"] = newConfig;
    await saveConfig(currentConfig);
    
    const msg = `qwen-core auto-configured: ${detection.location} (v${detection.version})`;
    console.log("[AutoConfig]", msg);
    
    return {
      success: true,
      message: msg
    };
  } catch (error) {
    const msg = `Auto-configuration failed: ${(error as Error).message}`;
    console.error("[AutoConfig]", msg);
    
    return {
      success: false,
      message: msg
    };
  }
}

/**
 * Quick setup helper - installs dependencies if missing
 */
export async function ensureQwenCoreDependencies(
  location: string
): Promise<{ success: boolean; message: string }> {
  if (app.isPackaged) {
    // In production, dependencies should be bundled
    return {
      success: true,
      message: "Production mode - dependencies bundled"
    };
  }
  
  const nodeModules = path.join(location, "node_modules");
  
  if (fs.existsSync(nodeModules)) {
    return {
      success: true,
      message: "Dependencies already installed"
    };
  }
  
  // Check for package.json
  const packageJson = path.join(location, "package.json");
  if (!fs.existsSync(packageJson)) {
    return {
      success: false,
      message: "No package.json found"
    };
  }
  
  // In dev mode, user should run npm install
  return {
    success: false,
    message: "Run 'npm install' in qwen-core directory"
  };
}

/**
 * Get qwen-core status for UI display
 */
export async function getQwenCoreStatus(): Promise<{
  configured: boolean;
  running: boolean;
  version: string | null;
  location: string | null;
  issues: string[];
}> {
  const detection = await detectQwenCore();
  const issues: string[] = [];
  
  if (!detection.found) {
    issues.push("qwen-core not found");
  } else if (!detection.isValid) {
    issues.push(detection.error || "Invalid installation");
  }
  
  if (!detection.hasNodeModules && !app.isPackaged) {
    issues.push("Missing dependencies (run npm install)");
  }
  
  return {
    configured: detection.isValid,
    running: false, // Would need to check MCP server status
    version: detection.version,
    location: detection.location,
    issues
  };
}
