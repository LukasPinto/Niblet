// Caché de imágenes del vault como data-URIs base64.
//
// Cada imagen se lee desde Rust (IPC) y se codifica en base64 una sola vez; el
// resultado se reutiliza mientras dure la sesión. Sin esto, una nota con muchas
// imágenes (p. ej. writeups con 40+ capturas) vuelve a leer y recodificar todo
// cada vez que se abre o se re-renderiza, lo que traba la UI.
import { readImageBase64 } from "./tauri";

const cache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

const MAX_CONCURRENT = 4;
let inFlight = 0;
const waitQueue: Array<() => void> = [];

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
}

function runQueued<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      inFlight += 1;
      fn()
        .then(resolve, reject)
        .finally(() => {
          inFlight -= 1;
          const next = waitQueue.shift();
          if (next) next();
        });
    };
    if (inFlight < MAX_CONCURRENT) start();
    else waitQueue.push(start);
  });
}

/** Data-URI ya resuelto (acceso síncrono). */
export function peekImageDataUri(absPath: string): string | undefined {
  return resolved.get(absPath);
}

/** Devuelve (y cachea) el data-URI base64 de una imagen dada su ruta absoluta. */
export function loadImageDataUri(absPath: string): Promise<string> {
  const cached = resolved.get(absPath);
  if (cached) return Promise.resolve(cached);

  const hit = cache.get(absPath);
  if (hit) return hit;

  const ext = absPath.split(".").pop() ?? "png";
  const p = runQueued(() =>
    readImageBase64(absPath).then((b64) => {
      const uri = `data:${mimeForExt(ext)};base64,${b64}`;
      resolved.set(absPath, uri);
      return uri;
    }),
  ).catch((e) => {
    cache.delete(absPath);
    throw e;
  });
  cache.set(absPath, p);
  return p;
}

/** Invalida una entrada (p. ej. tras mover o reemplazar una imagen). */
export function invalidateImage(absPath: string): void {
  cache.delete(absPath);
  resolved.delete(absPath);
}

const IMAGE_MD_RE = /!\[[^\]]*\]\(([^)]+)\)/g;

/** Rutas relativas al vault en el markdown (`![alt](ruta.png)`). */
export function extractMarkdownImageSrcs(md: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(IMAGE_MD_RE)) {
    const src = m[1].trim();
    if (/^(https?:|data:|mailto:)/i.test(src)) continue;
    out.push(src);
  }
  return out;
}

/** Precarga imágenes del markdown en segundo plano (cola limitada). */
export function prefetchMarkdownImages(md: string, vaultPath: string): void {
  for (const src of extractMarkdownImageSrcs(md)) {
    void loadImageDataUri(`${vaultPath}/${decodeURI(src)}`);
  }
}
