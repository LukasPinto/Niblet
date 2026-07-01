#!/usr/bin/env node
/**
 * Copia instaladores finales a release-assets/ con nombres legibles.
 *
 * Uso:
 *   node scripts/stage-release-assets.mjs windows
 *   node scripts/stage-release-assets.mjs macos-arm64
 *   node scripts/stage-release-assets.mjs macos-x64
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "release-assets");

const TARGETS = {
  windows: {
    bundleRoot: path.join(projectRoot, "src-tauri", "target", "release", "bundle"),
    stage() {
      const nsisDir = path.join(this.bundleRoot, "nsis");
      if (!existsSync(nsisDir)) {
        throw new Error(`No existe ${nsisDir}`);
      }

      const setups = readdirSync(nsisDir).filter(
        (f) => f.endsWith(".exe") && !f.toLowerCase().includes("portable"),
      );
      if (setups.length !== 1) {
        throw new Error(
          `Se esperaba un instalador NSIS en ${nsisDir}, encontrados: ${setups.length}`,
        );
      }

      const dest = path.join(outDir, `niblet-${version}-windows-x64.exe`);
      copyFileSync(path.join(nsisDir, setups[0]), dest);
      console.log(`[stage] ${dest}`);

      const zipName = `niblet-${version}-windows-x64.zip`;
      const zipPath = path.join(outDir, zipName);
      if (!existsSync(zipPath)) {
        throw new Error(
          `Falta ${zipPath}. Ejecutá scripts/package-windows-portable.mjs antes.`,
        );
      }
      console.log(`[stage] ${zipPath} (portable)`);
    },
  },
  "macos-arm64": {
    bundleRoot: path.join(
      projectRoot,
      "src-tauri",
      "target",
      "aarch64-apple-darwin",
      "release",
      "bundle",
    ),
    stage() {
      stageDmg(this.bundleRoot, `Niblet-${version}-macOS-arm64.dmg`);
    },
  },
  "macos-x64": {
    bundleRoot: path.join(
      projectRoot,
      "src-tauri",
      "target",
      "x86_64-apple-darwin",
      "release",
      "bundle",
    ),
    stage() {
      stageDmg(this.bundleRoot, `Niblet-${version}-macOS-x64.dmg`);
    },
  },
};

function readVersion() {
  const fromEnv = process.env.VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/i, "");

  const pkg = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  return pkg.version;
}

function stageDmg(bundleRoot, fileName) {
  const dmgDir = path.join(bundleRoot, "dmg");
  if (!existsSync(dmgDir)) {
    throw new Error(`No existe ${dmgDir}`);
  }

  const dmgs = readdirSync(dmgDir).filter((f) => f.endsWith(".dmg"));
  if (dmgs.length !== 1) {
    throw new Error(
      `Se esperaba un .dmg en ${dmgDir}, encontrados: ${dmgs.length}`,
    );
  }

  const dest = path.join(outDir, fileName);
  copyFileSync(path.join(dmgDir, dmgs[0]), dest);
  console.log(`[stage] ${dest}`);
}

const targetKey = process.argv[2];
const version = readVersion();

if (!targetKey || !TARGETS[targetKey]) {
  console.error(
    "Uso: node scripts/stage-release-assets.mjs <windows|macos-arm64|macos-x64>",
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
TARGETS[targetKey].stage();
