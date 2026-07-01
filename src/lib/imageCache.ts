// Caché de imágenes del vault como data-URIs base64.
//
// Cada imagen se lee desde Rust (IPC) y se codifica en base64 una sola vez; el
// resultado se reutiliza mientras dure la sesión. Sin esto, una nota con muchas
// imágenes (p. ej. writeups con 40+ capturas) vuelve a leer y recodificar todo
// cada vez que se abre o se re-renderiza, lo que traba la UI.
import { readImageBase64 } from "./tauri";

const cache = new Map<string, Promise<string>>();

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
}

/** Devuelve (y cachea) el data-URI base64 de una imagen dada su ruta absoluta. */
export function loadImageDataUri(absPath: string): Promise<string> {
  const hit = cache.get(absPath);
  if (hit) return hit;
  const ext = absPath.split(".").pop() ?? "png";
  const p = readImageBase64(absPath)
    .then((b64) => `data:${mimeForExt(ext)};base64,${b64}`)
    .catch((e) => {
      // No cachear fallos: permite reintentar (p. ej. si la imagen aparece luego).
      cache.delete(absPath);
      throw e;
    });
  cache.set(absPath, p);
  return p;
}

/** Invalida una entrada (p. ej. tras mover o reemplazar una imagen). */
export function invalidateImage(absPath: string): void {
  cache.delete(absPath);
}
