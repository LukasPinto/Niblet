#!/usr/bin/env node
/**
 * Empaqueta un .zip portable de Windows a partir de un build Tauri release.
 * Incluye el exe, DLLs hermanas y resources/ si el proyecto los define.
 */

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(projectRoot, "src-tauri", "target", "release");
const productName = "Niblet";
const cargoExeName = "niblet.exe";
const friendlyExeName = `${productName}.exe`;

/** Carpetas de build que no deben ir al zip portable. */
const SKIP_DIRS = new Set([
  "bundle",
  "deps",
  "build",
  "examples",
  "incremental",
  "nsis",
  "wix",
  ".fingerprint",
]);

function readVersion() {
  const fromEnv = process.env.VERSION?.trim();
  if (fromEnv) return fromEnv.replace(/^v/i, "");

  const pkg = JSON.parse(
    readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  );
  return pkg.version;
}

const README = `${productName} — paquete portable para Windows
==============================================

Descomprimí esta carpeta donde quieras y ejecutá ${friendlyExeName}.
No requiere instalador ni permisos de administrador.

Notas:

  - Necesitás Microsoft Edge WebView2 Runtime (habitual en Windows 10/11).
    Si la ventana queda en blanco: https://developer.microsoft.com/microsoft-edge/webview2/
  - La primera ejecución puede mostrar SmartScreen por no estar firmado.
    Elegí "Más información" → "Ejecutar de todas formas".
  - Los datos de la app viven en la carpeta del vault que elijas al abrir.
  - Esta build portable no se actualiza sola; descargá una versión nueva
    y reemplazá la carpeta cuando quieras actualizar.
`;

function copyReleaseSibling(srcName, stagingApp) {
  const srcPath = path.join(releaseDir, srcName);
  const destPath = path.join(stagingApp, srcName);

  if (SKIP_DIRS.has(srcName)) return false;

  const stat = lstatSync(srcPath);
  if (stat.isDirectory()) {
    cpSync(srcPath, destPath, { recursive: true });
    return true;
  }

  if (!stat.isFile()) return false;

  if (/\.(exe|pdb|rlib|d|exp|lib|ilk|txt)$/i.test(srcName)) {
    return false;
  }

  cpSync(srcPath, destPath);
  return true;
}

function main() {
  const exePath = path.join(releaseDir, cargoExeName);
  if (!existsSync(exePath)) {
    throw new Error(
      `No se encontró ${exePath}. ¿Completó bien "tauri build"?`,
    );
  }

  const version = readVersion();
  const zipBase = `niblet-${version}-windows-x64`;
  const stagingRoot = path.join(releaseDir, "..", "portable-staging");
  const stagingApp = path.join(stagingRoot, zipBase);

  if (existsSync(stagingRoot)) {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  mkdirSync(stagingApp, { recursive: true });

  cpSync(exePath, path.join(stagingApp, friendlyExeName));

  const copied = [];
  for (const sibling of readdirSync(releaseDir)) {
    if (sibling === cargoExeName) continue;
    if (copyReleaseSibling(sibling, stagingApp)) {
      copied.push(sibling);
    }
  }

  writeFileSync(path.join(stagingApp, "README-portable.txt"), README, "utf8");

  console.log(
    `[package-portable] ${friendlyExeName}` +
      (copied.length ? ` + ${copied.join(", ")}` : " (sin resources extra)"),
  );

  const outDir = path.join(projectRoot, "release-assets");
  mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `${zipBase}.zip`);

  const psCmd =
    `Compress-Archive -Path '${stagingApp.replace(/\\/g, "/")}/*' ` +
    `-DestinationPath '${zipPath.replace(/\\/g, "/")}' -Force`;
  const result = spawnSync("powershell", ["-NoProfile", "-Command", psCmd], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Compress-Archive falló (exit=${result.status})`);
  }

  const { size } = statSync(zipPath);
  console.log(
    `[package-portable] ${zipPath} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exit(1);
}
