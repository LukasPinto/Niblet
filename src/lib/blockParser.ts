// Conversión Markdown <-> bloques para el editor tipo Notion.
// Cada bloque representa una unidad editable (párrafo, encabezado, tarea…).
// El round-trip markdownToBlocks → blocksToMarkdown preserva el contenido.

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

/** Coincide con una línea que es únicamente una imagen Markdown `![alt](src)`. */
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export const MAX_BLOCK_INDENT = 6;
export const INDENT_SPACES_PER_LEVEL = 2;

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
  return type === "taskItem" || type === "bulletList" || type === "numberedList";
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
  return /^\|?\s*(:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line.trim());
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
        language: lang || undefined,
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
        table: {
          rows: normalizeTableRows([header, ...body]),
          headerRow: true,
        },
      });
      continue;
    }

    let block: Block;
    const imageMatch = line.match(IMAGE_LINE_RE);
    if (imageMatch) {
      block = { id: newBlockId(), type: "image", text: imageMatch[2], alt: imageMatch[1] };
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
    } else if (/^>\s?/.test(line)) {
      block = { id: newBlockId(), type: "quote", text: line.replace(/^>\s?/, "") };
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

export function blockToMarkdown(b: Block, index: number): string {
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
      return `${pad}${index + 1}. ${b.text}`;
    case "taskItem":
      return `${pad}- [${b.checked ? "x" : " "}] ${b.text}`;
    case "quote":
      return `> ${b.text}`;
    case "code": {
      const lang = b.language?.trim();
      return lang ? `\`\`\`${lang}\n${b.text}\n\`\`\`` : "```\n" + b.text + "\n```";
    }
    case "table": {
      const data = b.table;
      if (!data?.rows.length) return "";
      const normalized = normalizeTableRows(data.rows);
      const lines: string[] = [];
      if (data.headerRow && normalized.length > 0) {
        lines.push(`| ${normalized[0].map(escapeTableCell).join(" | ")} |`);
        lines.push(`| ${normalized[0].map(() => "---").join(" | ")} |`);
        for (let r = 1; r < normalized.length; r++) {
          lines.push(`| ${normalized[r].map(escapeTableCell).join(" | ")} |`);
        }
      } else {
        for (const row of normalized) {
          lines.push(`| ${row.map(escapeTableCell).join(" | ")} |`);
        }
      }
      return lines.join("\n");
    }
    case "image":
      return `![${b.alt ?? ""}](${b.text})`;
    case "divider":
      return "---";
    default:
      return b.text;
  }
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map((b, i) => blockToMarkdown(b, i)).join("\n");
}
