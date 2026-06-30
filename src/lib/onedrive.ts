// Sincronización con OneDrive vía Microsoft Graph.
//
// La autenticación (Device Code Flow + refresh tokens) vive en el backend Rust
// (commands/onedrive.rs): no hay redirect_uri ni puerto local, así que funciona
// igual en cualquier máquina. Aquí solo pedimos un access token a Rust y
// hacemos las llamadas REST a Graph (la webview de Tauri permite CORS a Graph).
import { invoke } from "@tauri-apps/api/core";
import {
  listNotes,
  listImages,
  readNote,
  writeNote,
  readFileBytes,
  writeFileBytes,
  recordSave,
  recordFileSave,
  hashFile,
} from "./tauri";
import { useDatabaseViewStore } from "../stores/databaseViewStore";
import { useVaultStore } from "../stores/vaultStore";
import { DB_VIEWS_REL } from "./database/viewConfig";
import { CONFIG_REL, isVaultMetaPath } from "./vaultPaths";

/** Extensiones de imagen que se sincronizan (alineadas con Rust IMAGE_EXTS). */
const SYNC_IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

const GRAPH = "https://graph.microsoft.com/v1.0";

/* ---------- Auth (delegada a Rust) ---------- */
export interface DeviceCodeInfo {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
  message: string;
}

export const isConfigured = () => invoke<boolean>("onedrive_configured");
export const getClientId = () => invoke<string>("onedrive_get_client_id");
export const setClientId = (clientId: string) =>
  invoke<void>("onedrive_set_client_id", { clientId });
export const getAccount = () => invoke<string | null>("onedrive_account");
export const logout = () => invoke<void>("onedrive_logout");
export const startDeviceLogin = () => invoke<DeviceCodeInfo>("onedrive_device_start");
export const pollDeviceLogin = (deviceCode: string) =>
  invoke<string>("onedrive_device_poll", { deviceCode });

async function token(): Promise<string> {
  return invoke<string>("onedrive_token");
}

/* ---------- Tipos de archivo sincronizable ---------- */

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isSyncableImage(name: string): boolean {
  return SYNC_IMAGE_EXTS.includes(fileExt(name));
}

function isSyncableVaultFile(name: string): boolean {
  return name.endsWith(".md") || isSyncableImage(name);
}

function isBinaryRel(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  return isSyncableImage(base);
}

function mimeForPath(relPath: string): string {
  const ext = fileExt(relPath);
  switch (ext) {
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

interface LocalSyncFile {
  path: string;
  rel_path: string;
  isBinary: boolean;
}

async function listLocalSyncFiles(vault: string): Promise<LocalSyncFile[]> {
  const [notes, images] = await Promise.all([listNotes(vault), listImages(vault)]);
  return [
    ...notes.map((n) => ({ path: n.path, rel_path: n.rel_path, isBinary: false })),
    ...images.map((i) => ({ path: i.path, rel_path: i.rel_path, isBinary: true })),
  ];
}

async function readLocalFile(local: LocalSyncFile): Promise<string | Uint8Array> {
  if (local.isBinary) {
    const bytes = await readFileBytes(local.path);
    return new Uint8Array(bytes);
  }
  return readNote(local.path);
}

async function writeLocalFile(
  vault: string,
  absPath: string,
  rel: string,
  data: string | Uint8Array,
  isBinary: boolean,
): Promise<void> {
  if (isBinary) {
    await writeFileBytes(absPath, Array.from(data as Uint8Array));
    await recordFileSave(vault, rel);
  } else {
    await writeNote(absPath, data as string);
    await recordSave(vault, rel, data as string);
  }
}

/* ---------- Graph helpers ---------- */
async function graph(path: string, init?: RequestInit): Promise<Response> {
  const t = await token();
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, ...(init?.headers ?? {}) },
  });
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

interface RemoteItem {
  relPath: string;
  id: string;
  modified: string;
}

async function listRemote(folder: string): Promise<RemoteItem[]> {
  const items: RemoteItem[] = [];
  async function walk(prefix: string): Promise<void> {
    const path = prefix ? `${folder}/${prefix}` : folder;
    const res = await graph(`/me/drive/root:/${encodePath(path)}:/children`);
    if (res.status === 404) return; // la carpeta aún no existe
    if (!res.ok) throw new Error(`Graph ${res.status} al listar ${path}`);
    const data = await res.json();
    for (const child of data.value ?? []) {
      const rel = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.folder) {
        await walk(rel);
      } else if (typeof child.name === "string" && isSyncableVaultFile(child.name)) {
        items.push({ relPath: rel, id: child.id, modified: child.lastModifiedDateTime });
      }
    }
  }
  await walk("");
  return items;
}

async function uploadFile(
  folder: string,
  relPath: string,
  content: string | Uint8Array,
): Promise<string> {
  const full = `${folder}/${relPath}`;
  const mime = mimeForPath(relPath);
  const res = await graph(`/me/drive/root:/${encodePath(full)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: (content instanceof Uint8Array ? content : content) as BodyInit,
  });
  if (!res.ok) throw new Error(`Subida falló (${res.status}) para ${relPath}`);
  const data = await res.json();
  return data.lastModifiedDateTime as string;
}

async function downloadFile(
  folder: string,
  relPath: string,
  asBinary: boolean,
): Promise<string | Uint8Array> {
  const full = `${folder}/${relPath}`;
  const res = await graph(`/me/drive/root:/${encodePath(full)}:/content`);
  if (!res.ok) throw new Error(`Descarga falló (${res.status}) para ${relPath}`);
  if (asBinary) return new Uint8Array(await res.arrayBuffer());
  return res.text();
}

/* ---------- Estado de sync por vault (localStorage) ---------- */
interface SyncRecord {
  localHash: string;
  remoteModified: string;
}
type SyncState = Record<string, SyncRecord>;

function stateKey(vault: string): string {
  return `niblet-sync-${vault}`;
}
function loadState(vault: string): SyncState {
  try {
    return JSON.parse(localStorage.getItem(stateKey(vault)) ?? "{}");
  } catch {
    return {};
  }
}
function saveState(vault: string, s: SyncState): void {
  localStorage.setItem(stateKey(vault), JSON.stringify(s));
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: string[];
}

/**
 * Sincroniza bidireccional con auto-resolución last-write-wins.
 * Solo marca conflicto cuando AMBOS lados cambiaron desde el último sync.
 */
export async function syncAll(vault: string, folder: string): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, downloaded: 0, conflicts: [] };
  const localFiles = await listLocalSyncFiles(vault);
  const remote = await listRemote(folder);
  const remoteByRel = new Map(remote.map((r) => [r.relPath, r]));
  const localByRel = new Map(localFiles.map((f) => [f.rel_path, f]));
  const state = loadState(vault);

  const allRels = new Set<string>([...localByRel.keys(), ...remoteByRel.keys()]);

  for (const rel of allRels) {
    if (isVaultMetaPath(rel)) continue;
    const local = localByRel.get(rel);
    const rem = remoteByRel.get(rel);
    const rec = state[rel];
    const isBinary = local?.isBinary ?? isBinaryRel(rel);

    if (local && !rem) {
      const content = await readLocalFile(local);
      const modified = await uploadFile(folder, rel, content);
      state[rel] = { localHash: await hashFile(local.path), remoteModified: modified };
      result.uploaded++;
    } else if (!local && rem) {
      const content = await downloadFile(folder, rel, isBinary);
      const path = `${vault}/${rel}`;
      await writeLocalFile(vault, path, rel, content, isBinary);
      state[rel] = { localHash: await hashFile(path), remoteModified: rem.modified };
      result.downloaded++;
    } else if (local && rem) {
      const localHash = await hashFile(local.path);
      const localChanged = !rec || rec.localHash !== localHash;
      const remoteChanged = !rec || rec.remoteModified !== rem.modified;

      if (localChanged && remoteChanged) {
        result.conflicts.push(rel);
      } else if (localChanged) {
        const content = await readLocalFile(local);
        const modified = await uploadFile(folder, rel, content);
        state[rel] = { localHash, remoteModified: modified };
        result.uploaded++;
      } else if (remoteChanged) {
        const content = await downloadFile(folder, rel, isBinary);
        await writeLocalFile(vault, local.path, rel, content, isBinary);
        state[rel] = { localHash: await hashFile(local.path), remoteModified: rem.modified };
        result.downloaded++;
      }
    }
  }

  saveState(vault, state);
  await syncMetadataFiles(vault, folder, state, result);
  return result;
}

function metadataFilesToSync(): string[] {
  const files = [DB_VIEWS_REL];
  if (useVaultStore.getState().config.includeConfigInSync) {
    files.push(CONFIG_REL);
  }
  return files;
}

async function syncMetadataFiles(
  vault: string,
  folder: string,
  state: SyncState,
  result: SyncResult,
): Promise<void> {
  for (const rel of metadataFilesToSync()) {
    const localPath = `${vault}/${rel}`;
    const rec = state[rel];
    let localExists = false;
    let localHash = "";
    try {
      localHash = await hashFile(localPath);
      localExists = true;
    } catch {
      localExists = false;
    }

    let remoteModified: string | null = null;
    let remoteExists = false;
    try {
      const full = `${folder}/${rel}`;
      const res = await graph(`/me/drive/root:/${encodePath(full)}`);
      if (res.ok) {
        const data = await res.json();
        remoteModified = data.lastModifiedDateTime as string;
        remoteExists = true;
      }
    } catch {
      remoteExists = false;
    }

    if (localExists && !remoteExists) {
      const content = await readNote(localPath);
      const modified = await uploadFile(folder, rel, content);
      state[rel] = { localHash, remoteModified: modified };
      result.uploaded++;
    } else if (!localExists && remoteExists) {
      const content = await downloadFile(folder, rel, false);
      await writeNote(localPath, content as string);
      state[rel] = { localHash: await hashFile(localPath), remoteModified: remoteModified! };
      result.downloaded++;
      if (rel === DB_VIEWS_REL) {
        await useDatabaseViewStore.getState().load(vault);
      }
    } else if (localExists && remoteExists) {
      const localChanged = !rec || rec.localHash !== localHash;
      const remoteChanged = !rec || rec.remoteModified !== remoteModified;
      if (localChanged && remoteChanged) {
        result.conflicts.push(rel);
      } else if (localChanged) {
        const content = await readNote(localPath);
        const modified = await uploadFile(folder, rel, content);
        state[rel] = { localHash, remoteModified: modified };
        result.uploaded++;
      } else if (remoteChanged) {
        const content = await downloadFile(folder, rel, false);
        await writeNote(localPath, content as string);
        state[rel] = { localHash: await hashFile(localPath), remoteModified: remoteModified! };
        result.downloaded++;
        if (rel === DB_VIEWS_REL) {
          await useDatabaseViewStore.getState().load(vault);
        }
      }
    }
  }
  saveState(vault, state);
}

/** Resuelve un conflicto concreto a favor de un lado y actualiza el estado. */
export async function resolveConflict(
  vault: string,
  folder: string,
  rel: string,
  choice: "local" | "remote",
): Promise<void> {
  const path = `${vault}/${rel}`;
  const state = loadState(vault);
  const isBinary = isBinaryRel(rel);

  if (choice === "local") {
    const content = isBinary
      ? new Uint8Array(await readFileBytes(path))
      : await readNote(path);
    const modified = await uploadFile(folder, rel, content);
    state[rel] = { localHash: await hashFile(path), remoteModified: modified };
  } else {
    const content = await downloadFile(folder, rel, isBinary);
    await writeLocalFile(vault, path, rel, content, isBinary);
    state[rel] = { localHash: await hashFile(path), remoteModified: new Date().toISOString() };
  }
  saveState(vault, state);
}
