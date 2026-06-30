/** Nombres genéricos que suelen venir del portapapeles (WebView2 → `image.png`). */
const GENERIC_PASTE_NAME = /^image\.(png|jpe?g|gif|webp|bmp)$/i;

export function isGenericImageFilename(name: string): boolean {
  const base = name.split(/[/\\]/).pop() ?? name;
  const lower = base.toLowerCase();
  return (
    GENERIC_PASTE_NAME.test(base) ||
    lower === "clipboard.png" ||
    lower === "untitled.png" ||
    lower === "blob"
  );
}

export function mimeToExt(mime: string): string {
  const raw = mime.split("/")[1]?.split("+")[0] || "png";
  if (raw === "jpeg") return "jpg";
  if (raw === "svg+xml") return "svg";
  return raw.replace(/[^a-z0-9]/gi, "") || "png";
}

/** Nombre para arrastrar/soltar un archivo con nombre real (no genérico). */
export function filenameForDroppedImage(file: File): string {
  if (file.name && file.name.includes(".") && !isGenericImageFilename(file.name)) {
    return file.name;
  }
  return `Pasted image ${Date.now()}.${mimeToExt(file.type)}`;
}
