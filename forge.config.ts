import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import path from "path";

const config: ForgeConfig = {
  packagerConfig: {
    name: "Qwen Studio",
    executableName: "qwen-studio",
    icon: path.join(__dirname, "resources/icon"),
    asar: false,
    out: "dist/forge-out",
    ignore: (fileName) => {
      return !(
        fileName.startsWith('/out') ||
        fileName.startsWith('/resources') ||
        fileName.startsWith('/node_modules') ||
        fileName.startsWith('/package.json')
      );
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ["linux"]),
    new MakerDeb(
      {
        options: {
          name: "qwen-studio",
          productName: "Qwen Studio",
          genericName: "Qwen AI Chat",
          categories: ["Utility", "Development"],
          icon: path.join(__dirname, "resources/icon.png"),
          depends: [
            "libnotify4",
            "libnss3",
            "libatk1.0-0",
            "libatk-bridge2.0-0",
            "libgtk-3-0",
          ],
        },
      },
      ["linux"],
    ),
    new MakerRpm(
      {
        options: {
          name: "qwen-studio",
          productName: "Qwen Studio",
          genericName: "Qwen AI Chat",
          categories: ["Utility", "Development"],
          icon: path.join(__dirname, "resources/icon.png"),
        },
      },
      ["linux"],
    ),
  ],
  plugins: [],
  hooks: {
    postMake: async (forgeConfig, makeResults) => {
      console.log("✅ Build completed! Artifacts:");
      makeResults.forEach((result) => {
        result.artifacts.forEach((artifact) => {
          console.log(`  📦 ${artifact}`);
        });
      });
      return makeResults;
    },
  },
};

export default config;
