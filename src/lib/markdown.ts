// Parseo y serialización de Markdown + frontmatter.
//
// Nota: en lugar de `gray-matter` (que arrastra `Buffer`/`js-yaml` y suele
// dar problemas dentro de la webview de Tauri) usamos un parser de
// frontmatter propio y ligero que cubre el subconjunto YAML que necesita
// Niblet: escalares y arrays inline `[a, b]` o listas con guiones.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { readImageBase64 } from "./tauri";
import type { NoteEntry } from "./tauri";
import {
  decorateInternalLinks,
  preprocessWikilinks,
} from "./linkParser";

export type FrontmatterValue = string | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedNote {
  data: Frontmatter;
  content: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseScalar(raw: string): FrontmatterValue {
  let v = raw.trim();
  // array inline: [a, b, c]
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  // quitar comillas
  v = v.replace(/^["']|["']$/g, "");
  return v;
}

export function parseFrontmatter(raw: string): ParsedNote {
  const match = raw.match(FM_RE);
  if (!match) return { data: {}, content: raw };

  const data: Frontmatter = {};
  const lines = match[1].split(/\r?\n/);
  let lastListKey: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // elemento de lista en varias líneas:  - valor
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && lastListKey) {
      const arr = (data[lastListKey] as string[]) ?? [];
      arr.push(listItem[1].trim().replace(/^["']|["']$/g, ""));
      data[lastListKey] = arr;
      continue;
    }
    const kv = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2];
    if (value.trim() === "|" || value.trim() === "|-") {
      const block: string[] = [];
      i += 1;
      while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
        block.push(lines[i].replace(/^\s{2}/, ""));
        i += 1;
      }
      i -= 1;
      data[key] = block.join("\n");
      lastListKey = null;
    } else if (value.trim() === "") {
      // posible lista en líneas siguientes
      data[key] = [];
      lastListKey = key;
    } else {
      data[key] = parseScalar(value);
      lastListKey = null;
    }
  }
  return { data, content: raw.slice(match[0].length) };
}

function serializeScalar(value: string): string {
  if (value.includes("\n")) {
    return "|\n" + value.split("\n").map((line) => `  ${line}`).join("\n");
  }
  return value;
}

function serializeValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  return serializeScalar(value);
}

export function stringifyFrontmatter(data: Frontmatter, content: string): string {
  const keys = Object.keys(data);
  if (keys.length === 0) return content;
  const body = keys.map((k) => {
    const v = data[k];
    if (Array.isArray(v)) return `${k}: ${serializeValue(v)}`;
    if (typeof v === "string" && v.includes("\n")) {
      return `${k}: ${serializeScalar(v)}`;
    }
    return `${k}: ${serializeValue(v)}`;
  }).join("\n");
  return `---\n${body}\n---\n\n${content.replace(/^\n+/, "")}`;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeHighlight, { detect: true, ignoreMissing: true })
  .use(rehypeStringify);

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
}

/**
 * Sustituye los `src` de imágenes locales (relativas a la raíz del vault) por
 * data-URIs en base64, para que la webview de Tauri pueda mostrarlas.
 */
async function resolveImages(html: string, vaultPath: string): Promise<string> {
  const re = /<img\b[^>]*?\ssrc="([^"]+)"[^>]*>/gi;
  const sources = new Set<string>();
  for (const m of html.matchAll(re)) {
    const src = m[1];
    if (/^(https?:|data:)/i.test(src)) continue;
    sources.add(src);
  }
  if (sources.size === 0) return html;

  let out = html;
  for (const src of sources) {
    const rel = decodeURI(src);
    const absPath = `${vaultPath}/${rel}`;
    try {
      const b64 = await readImageBase64(absPath);
      const ext = rel.split(".").pop() ?? "png";
      out = out
        .split(`src="${src}"`)
        .join(`src="data:${mimeForExt(ext)};base64,${b64}"`);
    } catch {
      /* imagen no encontrada: se deja el src original */
    }
  }
  return out;
}

/** Renderiza Markdown (sin frontmatter) a HTML. */
export async function renderMarkdown(
  content: string,
  vaultPath?: string,
  notes?: NoteEntry[],
): Promise<string> {
  let md = content;
  if (notes?.length) md = preprocessWikilinks(md, notes);
  const file = await processor.process(md);
  let html = String(file);
  html = decorateInternalLinks(html);
  if (vaultPath) html = await resolveImages(html, vaultPath);
  return html;
}

/** Convierte un valor de frontmatter en texto legible para tablas. */
export function displayValue(value: FrontmatterValue | undefined): string {
  if (value == null) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}
