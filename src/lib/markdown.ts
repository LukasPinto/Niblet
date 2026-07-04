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
import rehypeStringify from "rehype-stringify";
import type { NoteEntry } from "./tauri";
import { loadImageDataUri } from "./imageCache";
import {
  decorateInternalLinks,
  preprocessWikilinks,
} from "./linkParser";
import { codeLanguageLabel } from "./codeLanguages";
import { highlightCodeStatic } from "./codeStaticHighlight";
import { leadingIndentLevel, INDENT_PX_PER_LEVEL } from "./blockParser";

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

// El resaltado de sintaxis de los bloques de código se hace aparte, en
// `highlightCodeBlocks`, reusando el mismo parser/estilo que Bloques (para
// que ambas vistas se vean idénticas). remark-rehype ya etiqueta el `<code>`
// con `language-xxx` a partir del fence, así que no hace falta un plugin de
// highlighting aquí.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify);

/**
 * Sustituye los `src` de imágenes locales (relativas a la raíz del vault) por
 * data-URIs en base64, para que la webview de Tauri pueda mostrarlas. Las
 * imágenes se cargan en paralelo y desde una caché compartida.
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

  const resolved = await Promise.all(
    [...sources].map(async (src) => {
      try {
        const uri = await loadImageDataUri(`${vaultPath}/${decodeURI(src)}`);
        return [src, uri] as const;
      } catch {
        return [src, null] as const;
      }
    }),
  );

  let out = html;
  for (const [src, uri] of resolved) {
    if (!uri) continue; // imagen no encontrada: se deja el src original
    out = out.split(`src="${src}"`).join(`src="${uri}"`);
  }
  return out;
}

/**
 * Codifica los espacios dentro del destino de imágenes/enlaces Markdown
 * (`![alt](ruta con espacios.png)` o `[texto](Nota con espacios.md)`).
 *
 * CommonMark corta el destino en el primer espacio si no está escapado, por lo
 * que las notas estilo Obsidian —con nombres de archivo con espacios— no se
 * renderizan en la vista previa (sí en la vista de bloques, que usa un parser
 * propio más laxo). Sustituimos ` ` por `%20` para que remark conserve la ruta
 * completa; `resolveImages`/`resolveNoteTarget` hacen `decodeURI` al leerla.
 */
/** Convierte embeds Obsidian `![[ruta]]` / `![[ruta|alt]]` a imagen Markdown. */
function preprocessObsidianImageEmbeds(md: string): string {
  return md.replace(
    /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_full, path: string, alt?: string) => {
      const src = path.trim().replace(/ /g, "%20");
      const label = alt?.trim() ?? "";
      return `![${label}](${src})`;
    },
  );
}

function encodeSpacesInLinkTargets(md: string): string {
  return md.replace(
    /(!?\[[^\]]*\]\()([^)]+)(\))/g,
    (full, pre: string, dest: string, post: string) => {
      // No tocar destinos con título entre comillas: `(ruta "título")`.
      if (/\s"[^"]*"\s*$/.test(dest)) return full;
      const d = dest.trim();
      // No tocar URLs externas ni enlaces ya resueltos a notas.
      if (/^(https?:|mailto:|tel:|#|data:|note:|note-unresolved:)/i.test(d)) {
        return full;
      }
      return pre + d.replace(/ /g, "%20") + post;
    },
  );
}

const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;

function leadingWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === "\t") w += 2;
    else if (ch === " ") w += 1;
    else break;
  }
  return w;
}

/**
 * Reconstruye el anidamiento de listas para que CommonMark lo interprete igual
 * que la vista de bloques.
 *
 * Las notas estilo Obsidian anidan listas con indentación arbitraria y numeran
 * las sublistas de forma continua (`2.`, `3.`…). CommonMark, en cambio, solo
 * anida una lista ordenada si empieza en `1.` y exige que la indentación
 * supere el ancho del marcador padre; de lo contrario colapsa los sub-ítems
 * como texto de continuación. Aquí deducimos la profundidad de cada ítem por su
 * indentación (pila) y reemitimos con 4 espacios por nivel y renumerando cada
 * sublista desde 1.
 */
function normalizeListNesting(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let stack: { rawIndent: number; counter: number }[] = [];

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const m = line.match(LIST_ITEM_RE);
    if (!m) {
      // Una línea de nivel raíz que no es lista corta la lista actual.
      if (line.trim() !== "" && leadingWidth(line) === 0) stack = [];
      out.push(line);
      continue;
    }

    const indent = leadingWidth(m[1]);
    const ordered = /\d/.test(m[2]);
    const text = m[4];

    while (stack.length && stack[stack.length - 1].rawIndent > indent) stack.pop();

    let depth: number;
    if (stack.length && stack[stack.length - 1].rawIndent === indent) {
      stack[stack.length - 1].counter += 1;
      depth = stack.length - 1;
    } else {
      stack.push({ rawIndent: indent, counter: 1 });
      depth = stack.length - 1;
    }

    const marker = ordered ? `${stack[depth].counter}.` : "-";
    out.push(`${"    ".repeat(depth)}${marker} ${text}`);
  }
  return out.join("\n");
}

function isTableRowLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.length > 1;
}

function isTableSeparatorLine(line: string): boolean {
  let t = line.trim();
  if (!t.includes("-")) return false;
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  const cells = t.split("|");
  return cells.length > 0 && cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

/** Coincide con el marcador de divisor que usa la vista de Bloques (ver `blockToMarkdown`). */
function isDividerLine(line: string): boolean {
  return /^\s*(---|\*\*\*|___)\s*$/.test(line);
}

const LIST_LINE_RE = /^\s*([-*+]|\d+[.)])\s+/;
const HEADING_LINE_RE = /^#{1,6}\s/;
const QUOTE_LINE_RE = /^>\s?/;

/**
 * Una línea "de contenido suelto": ni encabezado, lista, cita, divisor, fence
 * ni fila de tabla. Incluye párrafos de texto y líneas que son solo una
 * imagen `![]()`.
 */
function isPlainContentLine(line: string): boolean {
  if (line.trim() === "") return false;
  if (LIST_LINE_RE.test(line)) return false;
  if (HEADING_LINE_RE.test(line)) return false;
  if (QUOTE_LINE_RE.test(line)) return false;
  if (isDividerLine(line)) return false;
  if (/^\s*```/.test(line)) return false;
  if (isTableRowLine(line) || isTableSeparatorLine(line)) return false;
  return true;
}

/**
 * Garantiza líneas en blanco alrededor de tablas, bloques de código cercados,
 * divisores, y entre líneas de "contenido suelto" consecutivas.
 *
 * CommonMark exige una línea en blanco para separar una tabla (o fence) del
 * párrafo/lista anterior; si no, absorbe la tabla como texto de continuación
 * del último ítem (por eso una tabla pegada a una lista salía en crudo). Con
 * un divisor `---` el problema es peor: sin línea en blanco, CommonMark lo
 * interpreta como el subrayado de un encabezado Setext y se COME tanto el
 * divisor como el párrafo anterior (que pasa a ser un `<h2>`).
 *
 * Además, dos líneas de texto/imagen consecutivas sin línea en blanco son UN
 * solo párrafo para CommonMark (continuación "perezosa"), pero en Bloques
 * cada línea es su propio bloque con su propio margen — por eso una imagen
 * seguida de texto (o de otra imagen) salía pegada en Vista y separada en
 * Bloques. La vista de bloques no tiene el concepto de párrafo multilínea
 * (salvo fences/tablas), así que aquí, solo para la Vista, insertamos las
 * líneas en blanco necesarias para que cada línea sea su propio párrafo.
 */
function separateBlockElements(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  const ensureBlank = () => {
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
  };
  let inFence = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceToggle = /^\s*```/.test(line);

    if (inFence) {
      out.push(line);
      if (fenceToggle) inFence = false;
      continue;
    }
    if (inTable) {
      if (isTableRowLine(line)) {
        out.push(line);
        continue;
      }
      inTable = false;
      if (line.trim() !== "") ensureBlank(); // separa la tabla del texto siguiente
    }
    if (fenceToggle) {
      ensureBlank();
      out.push(line);
      inFence = true;
      continue;
    }
    if (
      isTableRowLine(line) &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      ensureBlank();
      out.push(line);
      inTable = true;
      continue;
    }
    if (isDividerLine(line)) {
      ensureBlank();
      out.push(line);
      continue;
    }
    if (isPlainContentLine(line) && out.length && isPlainContentLine(out[out.length - 1])) {
      out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Línea que es únicamente una imagen `![alt](src)`, con indentación opcional. */
const IMAGE_ONLY_LINE_RE = /^(\s*)(!\[[^\]]*\]\([^)]+\))\s*$/;

/**
 * Extrae, en orden de aparición, el nivel de indentación (mismo esquema que
 * Bloques: `leadingIndentLevel`, 2 espacios por nivel) de cada línea que es
 * solo una imagen suelta.
 *
 * CommonMark ignora hasta 3 espacios de indentación y convierte 4+ en un
 * bloque de código indentado, así que no se puede indentar imágenes dejando
 * los espacios en el markdown. Se extrae el nivel aquí, se quita la
 * indentación antes de parsear (`stripImageLineIndent`) y se vuelve a aplicar
 * como `padding-left` inline sobre el `<p>` resultante (`applyImageIndents`).
 */
function extractImageIndents(md: string): number[] {
  const levels: number[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(IMAGE_ONLY_LINE_RE);
    if (m) levels.push(leadingIndentLevel(m[1]));
  }
  return levels;
}

function stripImageLineIndent(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      const m = line.match(IMAGE_ONLY_LINE_RE);
      return m ? m[2] : line;
    })
    .join("\n");
}

/**
 * Aplica, en el mismo orden que `extractImageIndents`, el nivel de
 * indentación como `padding-left` a cada `<p>` que contiene solo una imagen.
 * `separateBlockElements` ya garantiza que cada imagen suelta cae en su
 * propio `<p>` (nunca fusionada con texto u otra imagen).
 */
function applyImageIndents(html: string, levels: number[]): string {
  if (levels.length === 0) return html;
  let i = 0;
  return html.replace(/<p>(\s*<img\b[^>]*>\s*)<\/p>/gi, (full, inner: string) => {
    const level = levels[i];
    i += 1;
    if (!level) return full;
    return `<p style="padding-left:${level * INDENT_PX_PER_LEVEL}px">${inner}</p>`;
  });
}

const htmlCache = new Map<string, string>();
const MAX_HTML_CACHE = 24;
/** Incrementar al cambiar post-procesado HTML de la Vista. */
const PREVIEW_HTML_VERSION = 8;

function previewCacheKey(
  content: string,
  vaultPath?: string,
  notes?: NoteEntry[],
): string {
  return `${PREVIEW_HTML_VERSION}\0${vaultPath ?? ""}\0${notes?.length ?? 0}\0${content}`;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Revierte el escapado HTML que aplica rehype-stringify al texto de un `<code>`. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&"); // al final: evita descodificar entidades dentro de otras entidades
}

/** Versión de `String.replace` con una función de reemplazo asíncrona. */
async function replaceAsync(
  str: string,
  regex: RegExp,
  asyncFn: (match: RegExpMatchArray) => Promise<string>,
): Promise<string> {
  const matches = [...str.matchAll(regex)];
  if (matches.length === 0) return str;
  const replacements = await Promise.all(matches.map(asyncFn));
  let result = "";
  let lastIndex = 0;
  matches.forEach((m, i) => {
    result += str.slice(lastIndex, m.index);
    result += replacements[i];
    lastIndex = m.index! + m[0].length;
  });
  result += str.slice(lastIndex);
  return result;
}

/**
 * Resalta cada bloque de código con el mismo parser/estilo que usa Bloques
 * (`highlightCodeStatic`, CodeMirror/Lezer) en vez del tema de highlight.js,
 * para que ambas vistas se vean idénticas, y añade la cabecera (etiqueta de
 * lenguaje + botón "Copiar") que ya tiene Bloques.
 *
 * Los hijos de `<pre>` se envuelven en un `<div class="md-code-body">` en vez
 * de agregar un wrapper alrededor de `<pre>`: así `<pre>` sigue siendo el
 * hermano directo que usan las reglas de margen de `.md-preview`
 * (`p + pre`, `pre + h2`, …) y no se rompe el espaciado entre bloques.
 */
function highlightCodeBlocks(html: string): Promise<string> {
  return replaceAsync(
    html,
    /<pre>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    async (m) => {
      const attrs = m[1];
      const rawBody = m[2];
      const langMatch = /class="[^"]*language-([\w+-]+)/i.exec(attrs);
      const lang = langMatch?.[1];
      const text = decodeHtmlEntities(rawBody).replace(/\n+$/, "");
      const label = escapeHtmlText(codeLanguageLabel(lang));
      const highlighted = await highlightCodeStatic(text, lang);
      const codeAttrs = lang ? ` class="language-${lang}"` : "";
      const header =
        `<div class="md-code-header" contenteditable="false">` +
        `<span class="md-code-lang">${label}</span>` +
        `<button type="button" class="md-code-copy-btn">Copiar</button>` +
        `</div>`;
      return `<pre>${header}<div class="md-code-body"><code${codeAttrs}>${highlighted}</code></div></pre>`;
    },
  );
}

/** Renderiza Markdown (sin frontmatter) a HTML. */
export async function renderMarkdown(
  content: string,
  vaultPath?: string,
  notes?: NoteEntry[],
): Promise<string> {
  const cacheKey = previewCacheKey(content, vaultPath, notes);
  const cached = htmlCache.get(cacheKey);
  if (cached) return cached;

  let md = content.replace(/\r\n/g, "\n");
  md = normalizeListNesting(md);
  md = separateBlockElements(md);
  md = preprocessObsidianImageEmbeds(md);
  if (notes?.length) md = preprocessWikilinks(md, notes);
  md = encodeSpacesInLinkTargets(md);
  const imageIndents = extractImageIndents(md);
  md = stripImageLineIndent(md);
  const file = await processor.process(md);
  let html = String(file);
  html = applyImageIndents(html, imageIndents);
  html = await highlightCodeBlocks(html);
  html = decorateInternalLinks(html);
  if (vaultPath) html = await resolveImages(html, vaultPath);

  htmlCache.set(cacheKey, html);
  if (htmlCache.size > MAX_HTML_CACHE) {
    const oldest = htmlCache.keys().next().value;
    if (oldest) htmlCache.delete(oldest);
  }
  return html;
}

/** Convierte un valor de frontmatter en texto legible para tablas. */
export function displayValue(value: FrontmatterValue | undefined): string {
  if (value == null) return "";
  return Array.isArray(value) ? value.join(", ") : value;
}
