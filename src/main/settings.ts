/**
 * Simple JSON settings manager
 * Reads/writes to ~/.config/qwen-studio/settings.json
 * Replaces electron-settings for MCP config
 */

import { app } from "electron";
import fs from "fs";
import path from "path";

const SETTINGS_DIR = app.getPath("userData");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

/**
 * Read settings from JSON file
 */
export async function getSettings(): Promise<Record<string, any>> {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error("[Settings] Failed to read settings:", error);
  }
  return {};
}

/**
 * Write settings to JSON file
 */
export async function setSettings(data: Record<string, any>): Promise<void> {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("[Settings] Failed to write settings:", error);
    throw error;
  }
}

/**
 * Get a specific setting
 */
export async function getSetting(key: string, defaultValue?: any): Promise<any> {
  const settings = await getSettings();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

/**
 * Set a specific setting
 */
export async function setSetting(key: string, value: any): Promise<void> {
  const settings = await getSettings();
  settings[key] = value;
  await setSettings(settings);
}

/**
 * Check if a setting exists
 */
export async function hasSetting(key: string): Promise<boolean> {
  const settings = await getSettings();
  return key in settings;
}
