import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import colors from "colors/safe";
import { ZipArchive, type Archiver, type ZipOptions } from "archiver";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import type { Manifest } from "webextension-polyfill";
import path from "node:path";

import manifest from "./src/manifest.json";

type BuildTarget = "chrome" | "firefox";

type ManifestWithBackground = Manifest.WebExtensionManifest & {
  background?: {
    service_worker?: string;
    scripts?: string[];
    type?: "module" | string;
  };
  browser_specific_settings?: {
    gecko?: {
      id?: string;
      strict_min_version?: string;
    };
  };
};

type ZipExtensionPluginOptions = {
  outDir?: string;
  zipName?: string;
  zipPath?: string;
  zipOptions?: ZipOptions;
  createEmptyOutDir?: boolean;
};

const target = (process.env.TARGET ?? "chrome") as BuildTarget;
const ffAddonId = process.env.FF_ADDON_ID;
const isFirefox = target === "firefox";

if (target !== "chrome" && target !== "firefox") {
  throw new Error(
    `Invalid TARGET: ${target}. Specify TARGET=chrome or TARGET=firefox`,
  );
}

if (isFirefox && !ffAddonId) {
  throw new Error("FF_ADDON_ID is required for firefox builds");
}

function webExtensionManifestPlugin(target: BuildTarget): Plugin {
  let viteConfig: ResolvedConfig;
  let outDir: string;

  return {
    name: "webextension-manifest-target-fix",
    apply: "build",

    configResolved(config) {
      viteConfig = config;
      outDir = resolve(viteConfig.root, viteConfig.build.outDir);
    },

    async writeBundle() {
      const outManifestPath = resolve(outDir, "manifest.json");
      const nextManifest = structuredClone(manifest) as ManifestWithBackground;

      if (target === "firefox") {
        const serviceWorker = nextManifest.background?.service_worker;

        if (serviceWorker) {
          nextManifest.background = {
            scripts: [serviceWorker],
            type: "module",
          };
        }

        nextManifest.browser_specific_settings = {
          ...nextManifest.browser_specific_settings,
          gecko: {
            ...nextManifest.browser_specific_settings?.gecko,
            id: ffAddonId,
          },
        };
      } else {
        const backgroundScript = nextManifest.background?.scripts?.[0];
        const serviceWorker =
          nextManifest.background?.service_worker ?? backgroundScript;

        if (serviceWorker) {
          nextManifest.background = {
            service_worker: serviceWorker,
            type: "module",
          };
        }

        delete nextManifest.browser_specific_settings;
      }

      await fs.mkdir(outDir, {
        recursive: true,
      });

      await fs.writeFile(
        outManifestPath,
        `${JSON.stringify(nextManifest, null, 2)}\n`,
        "utf8",
      );
    },
  };
}

function zipExtensionPlugin(options: ZipExtensionPluginOptions = {}): Plugin {
  let viteConfig: ResolvedConfig;
  let outDir: string;
  let zipPath: string;

  async function zipDirectory(
    sourceDir: string,
    outputZipPath: string,
  ): Promise<void> {
    if (options.createEmptyOutDir !== false) {
      await fs.mkdir(sourceDir, {
        recursive: true,
      });
    }

    await fs.mkdir(dirname(outputZipPath), {
      recursive: true,
    });

    await fs.rm(outputZipPath, {
      force: true,
    });

    return new Promise((resolvePromise, rejectPromise) => {
      const output = createWriteStream(outputZipPath);

      const archive: Archiver = new ZipArchive({
        zlib: {
          level: 9,
        },
        ...options.zipOptions,
      });

      output.on("close", resolvePromise);
      output.on("error", rejectPromise);

      archive.on("error", rejectPromise);

      archive.on("warning", (error) => {
        viteConfig.logger.warn(
          colors.yellow(`[webextension-zip-output] ${error.message}`),
        );
      });

      archive.pipe(output);
      archive.directory(sourceDir, false);

      archive.finalize().catch(rejectPromise);
    });
  }

  return {
    name: "webextension-zip-output",
    apply: "build",

    configResolved(config) {
      viteConfig = config;

      outDir = resolve(
        viteConfig.root,
        options.outDir ?? viteConfig.build.outDir,
      );

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      zipPath =
        options.zipPath ??
        resolve(
          viteConfig.root,
          options.zipName ?? `../${basename(outDir)}-${timestamp}.zip`,
        );
    },

    async buildStart() {
      if (options.createEmptyOutDir !== false) {
        await fs.mkdir(outDir, {
          recursive: true,
        });
      }
    },

    async closeBundle() {
      await zipDirectory(outDir, zipPath);

      const zipStats = await fs.stat(zipPath);
      const relativeZipPath = relative(viteConfig.root, zipPath);

      viteConfig.logger.info(
        [
          "",
          `${colors.green("✓")} ${colors.bold("created")} ${colors.cyan(
            relativeZipPath,
          )} ${colors.gray(formatBytes(zipStats.size))}`,
          "",
        ].join("\n"),
      );
    },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} kB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default defineConfig({
  root: "src",
  publicDir: "../public",

  plugins: [
    webExtensionManifestPlugin(target),

    zipExtensionPlugin({
      zipName: `../dist-${target}.zip`,
    }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    outDir: "../dist",
    emptyOutDir: true,
    modulePreload: false,

    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/popup.html"),
        devtools: resolve(__dirname, "src/devtools.html"),
        "devtools-panel": resolve(__dirname, "src/devtools-panel.html"),
        content: resolve(__dirname, "src/components/content/content.ts"),
        "listener-tracker": resolve(
          __dirname,
          "src/components/Inspector/tabs/javascript/tracker.ts",
        ),
        background: resolve(__dirname, "src/background.ts"),
      },

      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") {
            return "background.js";
          }

          return "assets/[name].js";
        },

        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },

});
