// Resalta bloques de código en modo solo-lectura sin montar CodeMirror.
//
// Montar un `EditorView` por bloque de código visible (como hace CodeBlockView
// al editar) es caro si una nota tiene muchos bloques: cada uno dispara su
// propio import de lenguaje + parseo + DOM del editor. Para la vista estática
// (no-edición) reutilizamos el mismo parser Lezer y el mismo `HighlightStyle`
// (`nibletCodeHighlightStyle`) para generar HTML una sola vez, cacheado por
// texto+lenguaje, y solo cuando el bloque entra en viewport (ver
// `CodeBlockStatic` en BlockEditor.tsx). Así el highlighting coincide
// pixel-a-pixel entre "viendo" y "editando" sin pagar el costo de un editor
// completo para bloques que no se están tocando.
import { highlightCode } from "@lezer/highlight";
import { resolveCodeLanguageDescription } from "./codeLanguages";
import { nibletCodeHighlightStyle } from "./codeMirrorBlock";

const cache = new Map<string, string>();
const MAX_CACHE = 60;

function cacheKey(language: string | undefined, text: string): string {
  return `${language ?? ""}\0${text}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rememberCache(key: string, html: string): void {
  cache.set(key, html);
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Devuelve el HTML ya resaltado si está en caché, sin disparar cálculo. */
export function peekHighlightedCode(
  text: string,
  language: string | undefined,
): string | null {
  return cache.get(cacheKey(language, text)) ?? null;
}

/** Calcula (o reutiliza de caché) el HTML resaltado para un bloque de código. */
export async function highlightCodeStatic(
  text: string,
  language: string | undefined,
): Promise<string> {
  const key = cacheKey(language, text);
  const cached = cache.get(key);
  if (cached) return cached;

  const desc = resolveCodeLanguageDescription(language);
  if (!desc) {
    const html = escapeHtml(text);
    rememberCache(key, html);
    return html;
  }

  let html: string;
  try {
    const support = await desc.load();
    const tree = support.language.parser.parse(text);
    const parts: string[] = [];
    highlightCode(
      text,
      tree,
      nibletCodeHighlightStyle,
      (piece, classes) => {
        parts.push(classes ? `<span class="${classes}">${escapeHtml(piece)}</span>` : escapeHtml(piece));
      },
      () => parts.push("\n"),
    );
    html = parts.join("");
  } catch {
    html = escapeHtml(text);
  }

  rememberCache(key, html);
  return html;
}
