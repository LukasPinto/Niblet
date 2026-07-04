// Conversión Markdown <-> bloques para el editor tipo Notion.
// Cada bloque representa una unidad editable (párrafo, encabezado, tarea…).
// El round-trip markdownToBlocks → blocksToMarkdown preserva el contenido.

import { normalizeCodeLanguageId } from "./codeLanguages";

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "numberedList"
  | "taskItem"
  | "quote"
  | "code"
  | "image"
  | "divider"
  | "table";

export interface TableData {
  rows: string[][];
  headerRow: boolean;
}

export interface Block {
  id: string;
  type: BlockType;
  /** Para `image`: la ruta/`src` de la imagen. Resto: el texto del bloque. */
  text: string;
  /** Solo para `taskItem`. */
  checked?: boolean;
  /** Solo para `image`: texto alternativo. */
  alt?: string;
  /** Solo para `code`: etiqueta del fence Markdown (p. ej. `javascript`). */
  language?: string;
  /** Solo para `table`: celdas de la tabla. */
  table?: TableData;
  /** Niveles de indentación (0 = raíz). Aplica a taskItem, bulletList, numberedList. */
  indent?: number;
}

/** Coincide con una línea que es únicamente una imagen Markdown `![alt](src)`,
 *  admitiendo indentación (imágenes dentro de listas). */
const IMAGE_LINE_RE = /^(\s*)!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export const MAX_BLOCK_INDENT = 6;
export const INDENT_SPACES_PER_LEVEL = 2;
/** px por nivel de indentación en pantalla (Bloques y Vista deben coincidir). */
export const INDENT_PX_PER_LEVEL = 22;

let counter = 0;
export function newBlockId(): string {
  counter += 1;
  return `b${Date.now().toString(36)}-${counter}`;
}

/** Cuenta espacios/tabs al inicio de la línea (tab = 2 espacios). */
export function leadingIndentLevel(line: string): number {
  let spaces = 0;
  for (const ch of line) {
    if (ch === " ") spaces += 1;
    else if (ch === "\t") spaces += INDENT_SPACES_PER_LEVEL;
    else break;
  }
  return Math.floor(spaces / INDENT_SPACES_PER_LEVEL);
}

/** Prefijo de espacios para serializar un nivel de indentación. */
export function indentPrefix(level: number): string {
  return " ".repeat(Math.max(0, level) * INDENT_SPACES_PER_LEVEL);
}

export function isIndentableBlockType(type: BlockType): boolean {
  return (
    type === "taskItem" ||
    type === "bulletList" ||
    type === "numberedList" ||
    type === "image" ||
    type === "table" ||
    // En citas, indent = nivel de anidación (`> > …`), no espacios.
    type === "quote"
  );
}

export function emptyBlock(type: BlockType = "paragraph", indent = 0): Block {
  return {
    id: newBlockId(),
    type,
    text: "",
    checked: type === "taskItem" ? false : undefined,
    indent: isIndentableBlockType(type) ? indent : undefined,
  };
}

/** Tabla vacía por defecto: encabezado + 1 fila, 3 columnas. */
export function emptyTable(cols = 3): Block {
  const header = Array(cols).fill("");
  const row = Array(cols).fill("");
  return {
    id: newBlockId(),
    type: "table",
    text: "",
    table: { rows: [header, row], headerRow: true },
  };
}

export function normalizeTableRows(rows: string[][]): string[][] {
  if (rows.length === 0) return [[""]];
  const cols = Math.max(...rows.map((r) => r.length), 1);
  return rows.map((r) => {
    const copy = [...r];
    while (copy.length < cols) copy.push("");
    return copy.slice(0, cols);
  });
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
  if (cells.length === 0) return false;
  // Cada celda del separador: guiones con colones de alineación opcionales.
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
}

function parseTableRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function escapeTableCell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Metadatos de cada tipo para el menú "/" y el render. */
export const BLOCK_TYPES: { type: BlockType; label: string; icon: string; hint: string }[] = [
  { type: "paragraph", label: "Texto", icon: "¶", hint: "Párrafo simple" },
  { type: "heading1", label: "Encabezado 1", icon: "H₁", hint: "Título grande" },
  { type: "heading2", label: "Encabezado 2", icon: "H₂", hint: "Título mediano" },
  { type: "heading3", label: "Encabezado 3", icon: "H₃", hint: "Título pequeño" },
  { type: "bulletList", label: "Lista", icon: "•", hint: "Lista con viñetas" },
  { type: "numberedList", label: "Lista numerada", icon: "1.", hint: "Lista ordenada" },
  { type: "taskItem", label: "Tarea", icon: "☐", hint: "Casilla de verificación" },
  { type: "quote", label: "Cita", icon: "❝", hint: "Bloque de cita" },
  { type: "code", label: "Código", icon: "</>", hint: "Bloque de código" },
  { type: "table", label: "Tabla", icon: "⊞", hint: "Tabla editable" },
  { type: "divider", label: "Divisor", icon: "—", hint: "Línea separadora" },
];

export interface MarkdownShortcut {
  type: BlockType;
  /** Texto restante tras quitar el prefijo Markdown. */
  rest: string;
  checked?: boolean;
}

/**
 * Detecta un prefijo Markdown escrito "en caliente" dentro de un bloque de
 * párrafo y devuelve el tipo de bloque al que debe transformarse.
 * Devuelve null si el texto no empieza por un atajo reconocido.
 */
export function detectMarkdownShortcut(text: string): MarkdownShortcut | null {
  // Tarea: "- [ ] ", "- [x] " o el atajo corto "[] " / "[ ] " / "[x] ".
  let m = text.match(/^[-*]\s\[([ xX]?)\]\s(.*)$/);
  if (m) return { type: "taskItem", rest: m[2], checked: m[1].toLowerCase() === "x" };
  m = text.match(/^\[([ xX]?)\]\s(.*)$/);
  if (m) return { type: "taskItem", rest: m[2], checked: m[1].toLowerCase() === "x" };

  // Encabezados: "# ", "## ", "### ".
  m = text.match(/^(#{1,3})\s(.*)$/);
  if (m) {
    const type =
      m[1].length === 1 ? "heading1" : m[1].length === 2 ? "heading2" : "heading3";
    return { type, rest: m[2] };
  }

  // Listas y cita.
  m = text.match(/^[-*]\s(.*)$/);
  if (m) return { type: "bulletList", rest: m[1] };
  m = text.match(/^\d+\.\s(.*)$/);
  if (m) return { type: "numberedList", rest: m[1] };
  m = text.match(/^>\s(.*)$/);
  if (m) return { type: "quote", rest: m[1] };

  // Bloques sin espacio final: código y divisor (coincidencia exacta).
  if (text === "```") return { type: "code", rest: "" };
  if (text === "---" || text === "***" || text === "___") {
    return { type: "divider", rest: "" };
  }
  return null;
}

export function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Líneas en blanco separan bloques en Markdown pero no son contenido;
    // crear párrafos vacíos aquí duplicaba el espaciado respecto a la Vista.
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Bloque de código con fences ```
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1]?.trim() ?? "";
      const inner: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        inner.push(lines[i]);
        i += 1;
      }
      i += 1; // saltar el fence de cierre
      blocks.push({
        id: newBlockId(),
        type: "code",
        text: inner.join("\n"),
        language: lang ? normalizeCodeLanguageId(lang) || undefined : undefined,
      });
      continue;
    }

    // Tabla GFM: fila | separador | filas…
    if (
      isTableRowLine(line) &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const header = parseTableRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRowLine(lines[i]) && !isTableSeparatorLine(lines[i])) {
        body.push(parseTableRow(lines[i]));
        i += 1;
      }
      blocks.push({
        id: newBlockId(),
        type: "table",
        text: "",
        indent: leadingIndentLevel(line) || undefined,
        table: {
          rows: normalizeTableRows([header, ...body]),
          headerRow: true,
        },
      });
      continue;
    }

    // Citas: consume el grupo de líneas `>` consecutivas. El nivel de
    // anidación (número de `>`) va en `indent`; las líneas contiguas del mismo
    // nivel forman UN bloque (texto con \n) y las líneas de cita en blanco
    // (`>`) actúan como separador, igual que las líneas en blanco entre bloques.
    if (line.startsWith(">")) {
      let run: { level: number; texts: string[] } | null = null;
      const flushQuote = () => {
        if (!run) return;
        blocks.push({
          id: newBlockId(),
          type: "quote",
          text: run.texts.join("\n"),
          indent: run.level || undefined,
        });
        run = null;
      };
      while (i < lines.length && lines[i].startsWith(">")) {
        let rest = lines[i];
        let level = -1;
        while (rest.startsWith(">")) {
          rest = rest.slice(1);
          if (rest.startsWith(" ")) rest = rest.slice(1);
          level += 1;
        }
        if (rest.trim() === "") flushQuote();
        else if (run && run.level === level) run.texts.push(rest);
        else {
          flushQuote();
          run = { level, texts: [rest] };
        }
        i += 1;
      }
      flushQuote();
      continue;
    }

    let block: Block;
    const imageMatch = line.match(IMAGE_LINE_RE);
    if (imageMatch) {
      block = {
        id: newBlockId(),
        type: "image",
        text: imageMatch[3],
        alt: imageMatch[2],
        indent: leadingIndentLevel(imageMatch[1]) || undefined,
      };
    } else if (/^#\s+/.test(line)) {
      block = { id: newBlockId(), type: "heading1", text: line.replace(/^#\s+/, "") };
    } else if (/^##\s+/.test(line)) {
      block = { id: newBlockId(), type: "heading2", text: line.replace(/^##\s+/, "") };
    } else if (/^###\s+/.test(line)) {
      block = { id: newBlockId(), type: "heading3", text: line.replace(/^###\s+/, "") };
    } else if (/^\s*-\s*\[([ xX])\]\s+/.test(line)) {
      const m = line.match(/^(\s*)-\s*\[([ xX])\]\s+(.*)$/)!;
      block = {
        id: newBlockId(),
        type: "taskItem",
        text: m[3],
        checked: m[2].toLowerCase() === "x",
        indent: leadingIndentLevel(m[1]),
      };
    } else if (/^\s*[-*]\s+/.test(line)) {
      const m = line.match(/^(\s*)[-*]\s+(.*)$/)!;
      block = {
        id: newBlockId(),
        type: "bulletList",
        text: m[2],
        indent: leadingIndentLevel(m[1]),
      };
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const m = line.match(/^(\s*)\d+\.\s+(.*)$/)!;
      block = {
        id: newBlockId(),
        type: "numberedList",
        text: m[2],
        indent: leadingIndentLevel(m[1]),
      };
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      block = { id: newBlockId(), type: "divider", text: "" };
    } else {
      block = { id: newBlockId(), type: "paragraph", text: line };
    }
    blocks.push(block);
    i += 1;
  }

  // Quitar párrafos vacíos iniciales/finales redundantes pero garantizar ≥1 bloque.
  while (blocks.length > 1 && blocks[0].type === "paragraph" && blocks[0].text === "") {
    blocks.shift();
  }
  while (blocks.length > 1 && blocks[blocks.length - 1].type === "paragraph" && blocks[blocks.length - 1].text === "") {
    blocks.pop();
  }
  if (blocks.length === 0) blocks.push(emptyBlock());
  return blocks;
}

const blocksCache = new Map<string, Block[]>();
const MAX_BLOCKS_CACHE = 32;
/** Incrementar al cambiar reglas de parseo para invalidar entradas antiguas. */
const BLOCKS_CACHE_VERSION = 3;

function blocksCacheKey(md: string): string {
  return `${BLOCKS_CACHE_VERSION}\0${md}`;
}

/** Copia superficial de bloques para edición (no mutar la caché). */
export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({
    ...b,
    table: b.table
      ? { headerRow: b.table.headerRow, rows: b.table.rows.map((r) => [...r]) }
      : undefined,
  }));
}

/** Parsea markdown → bloques con caché por contenido (misma sesión). */
export function getOrParseBlocks(md: string): Block[] {
  const key = blocksCacheKey(md);
  const hit = blocksCache.get(key);
  if (hit) return hit;
  const parsed = markdownToBlocks(md);
  blocksCache.set(key, parsed);
  if (blocksCache.size > MAX_BLOCKS_CACHE) {
    const oldest = blocksCache.keys().next().value;
    if (oldest) blocksCache.delete(oldest);
  }
  return parsed;
}

/** Precalienta la caché de bloques (p. ej. en idle al abrir una nota). */
export function warmBlocksCache(md: string): void {
  getOrParseBlocks(md);
}

/**
 * Numeración local de las listas ordenadas: un contador por nivel de
 * indentación que se reinicia al cambiar de lista (otra lista, o un bloque
 * ajeno a listas). Es la única fuente de verdad, usada tanto para mostrar la
 * numeración en el editor como para serializar el markdown, de modo que ambos
 * coincidan.
 */
export function computeOrderedOrdinals(blocks: Block[]): Map<string, number> {
  const map = new Map<string, number>();
  const counters: Record<number, number> = {};
  const clearDeeper = (lvl: number) => {
    for (const k of Object.keys(counters)) if (+k > lvl) delete counters[+k];
  };
  for (const b of blocks) {
    const lvl = b.indent ?? 0;
    if (b.type === "numberedList") {
      clearDeeper(lvl);
      counters[lvl] = (counters[lvl] ?? 0) + 1;
      map.set(b.id, counters[lvl]);
    } else if (b.type === "bulletList" || b.type === "taskItem") {
      clearDeeper(lvl);
      delete counters[lvl];
    } else if (b.type !== "image") {
      for (const k of Object.keys(counters)) delete counters[+k];
    }
  }
  return map;
}

export function blockToMarkdown(b: Block, ordinal = 1): string {
  const pad = indentPrefix(b.indent ?? 0);
  switch (b.type) {
    case "heading1":
      return `# ${b.text}`;
    case "heading2":
      return `## ${b.text}`;
    case "heading3":
      return `### ${b.text}`;
    case "bulletList":
      return `${pad}- ${b.text}`;
    case "numberedList":
      return `${pad}${ordinal}. ${b.text}`;
    case "taskItem":
      return `${pad}- [${b.checked ? "x" : " "}] ${b.text}`;
    case "quote": {
      // Un marcador `> ` por nivel de anidación, en cada línea del bloque.
      // Las líneas vacías serializan como `>` (sin espacio colgante).
      const marker = "> ".repeat((b.indent ?? 0) + 1);
      return b.text
        .split("\n")
        .map((l) => (marker + l).replace(/[ \t]+$/, ""))
        .join("\n");
    }
    case "code": {
      const lang = b.language?.trim();
      const id = lang ? normalizeCodeLanguageId(lang) : "";
      return id ? `\`\`\`${id}\n${b.text}\n\`\`\`` : "```\n" + b.text + "\n```";
    }
    case "table": {
      const data = b.table;
      if (!data?.rows.length) return "";
      const normalized = normalizeTableRows(data.rows);
      const lines: string[] = [];
      if (data.headerRow && normalized.length > 0) {
        lines.push(`${pad}| ${normalized[0].map(escapeTableCell).join(" | ")} |`);
        lines.push(`${pad}| ${normalized[0].map(() => "---").join(" | ")} |`);
        for (let r = 1; r < normalized.length; r++) {
          lines.push(`${pad}| ${normalized[r].map(escapeTableCell).join(" | ")} |`);
        }
      } else {
        for (const row of normalized) {
          lines.push(`${pad}| ${row.map(escapeTableCell).join(" | ")} |`);
        }
      }
      return lines.join("\n");
    }
    case "image":
      return `${pad}![${b.alt ?? ""}](${b.text})`;
    case "divider":
      return "---";
    default:
      return b.text;
  }
}

export function blocksToMarkdown(blocks: Block[]): string {
  const ordinals = computeOrderedOrdinals(blocks);
  const parts: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const prev = i > 0 ? blocks[i - 1] : null;
    // Dos citas contiguas necesitan separador: sin él, al reparsear (y en la
    // Vista) se fusionarían en una sola. Mismo nivel → línea en blanco (citas
    // independientes). Nivel menor que el anterior → `>` (corta la
    // continuación perezosa de CommonMark sin cerrar la cita exterior).
    // Nivel mayor → nada: `> > …` tras `> …` anida dentro de la misma cita.
    if (prev?.type === "quote" && b.type === "quote") {
      const prevLevel = prev.indent ?? 0;
      const level = b.indent ?? 0;
      if (level === prevLevel) parts.push("");
      else if (level < prevLevel) parts.push(">");
    }
    parts.push(blockToMarkdown(b, ordinals.get(b.id)));
  }
  return parts.join("\n");
}
