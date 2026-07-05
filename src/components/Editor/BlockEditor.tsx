import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react";
import { flushSync } from "react-dom";
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  type Block,
  type BlockType,
  type MarkdownShortcut,
  type TableData,
  BLOCK_TYPES,
  cloneBlocks,
  getOrParseBlocks,
  blocksToMarkdown,
  computeOrderedOrdinals,
  formatOrderedMarker,
  detectMarkdownShortcut,
  emptyBlock,
  emptyTable,
  newBlockId,
  isIndentableBlockType,
  MAX_BLOCK_INDENT,
  INDENT_PX_PER_LEVEL,
} from "../../lib/blockParser";
import {
  detectMetaSuggest,
  type MetaSuggestTrigger,
} from "../../lib/taskMetaSuggest";
import {
  type BlockInputEl,
  autoResizeTextarea,
  getBlockCaret,
  getBlockCaretClientRect,
  placeBlockCaret,
  readBlockText,
  setBlockCaret,
  setBlockText,
  syncBlockTextFromRef,
} from "../../lib/blockInput";
import TaskMetaSuggestPopover from "./TaskMetaSuggestPopover";
import WikilinkSuggestPopover from "./WikilinkSuggestPopover";
import CodeBlockView from "./CodeBlockView";
import CodeLanguagePicker from "./CodeLanguagePicker";
import TableBlockView from "./TableBlockView";
import { useVaultStore } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useSyncStore } from "../../stores/syncStore";
import { savePastedImage, saveClipboardImage } from "../../lib/tauri";
import { loadImageDataUri, peekImageDataUri } from "../../lib/imageCache";
import { buildNoteIndex, resolveNoteTarget } from "../../lib/linkParser";
import { closeAllCodeLangPickers } from "../../lib/blockEditorMenus";
import { decorateWikilinksInPlainText } from "../../lib/wikilinkDisplay";
import { useNoteLinkInteractions } from "../../hooks/useNoteLinkInteractions";
import { mimeToExt } from "../../lib/imageNames";
import { normalizeCodeLanguageId } from "../../lib/codeLanguages";
import { highlightCodeStatic, peekHighlightedCode } from "../../lib/codeStaticHighlight";
import {
  applyWikilinkSelection,
  detectWikilinkSuggest,
  filterNotesForWikilink,
  slashWikilinkMatches,
  SLASH_WIKILINK_COMMAND,
  type WikilinkSuggestTrigger,
} from "../../lib/wikilinkSuggest";

interface Props {
  /** Cuerpo Markdown (sin frontmatter). */
  content: string;
  /** Cambia cuando se abre otra nota: fuerza reconstruir los bloques. */
  noteKey: string;
  /** Incrementa cuando el contenido cambia externamente (p. ej. mover imagen). */
  contentEpoch?: number;
  /** Vista Bloques visible: controla carga diferida de imágenes y sincronización. */
  active?: boolean;
  onChange: (markdown: string) => void;
}

interface SlashState {
  blockId: string;
  query: string;
  index: number;
  /** Offset del `/` que abrió el comando dentro del texto del bloque. */
  start: number;
  /** Posición del cursor al abrir (para anclar el menú, estilo Notion). */
  left: number;
  top: number;
}

/**
 * Detecta un comando "/" en la posición del cursor, en cualquier parte del
 * bloque (no solo al inicio), al estilo Notion. El `/` debe ir al principio del
 * texto o precedido por un espacio, y la consulta no puede empezar por espacio
 * ni contener otro "/". Así se evitan falsos positivos como `and/or`, rutas o
 * `http://`.
 */
function detectSlashCommand(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  let i = cursor - 1;
  for (; i >= 0; i--) {
    const ch = text[i];
    if (ch === "/") break;
    if (ch === "\n") return null;
  }
  if (i < 0) return null;
  const prev = i > 0 ? text[i - 1] : "";
  if (prev !== "" && !/\s/.test(prev)) return null;
  const query = text.slice(i + 1, cursor);
  // Un espacio (o un "/") tras el comando lo cancela: evita que una frase normal
  // deje el menú "activo" y bloquee wikilinks/meta el resto de la línea.
  if (/[\s/]/.test(query)) return null;
  return { start: i, query };
}

interface MetaSuggestState extends MetaSuggestTrigger {
  blockId: string;
  left: number;
  top: number;
}

interface WikiSuggestState extends WikilinkSuggestTrigger {
  blockId: string;
  left: number;
  top: number;
  index: number;
}

type SlashEntry =
  | { kind: "wikilink"; label: string; icon: string; hint: string }
  | { kind: "block"; type: BlockType; label: string; icon: string; hint: string };

interface FocusReq {
  id: string;
  /** Un número coloca el cursor en ese offset exacto (p. ej. tras fusionar bloques). */
  pos: "start" | "end" | number;
  /** Texto a fijar imperativamente en el bloque antes de colocar el cursor.
   *  Necesario al crear/reutilizar un bloque con contenido y enfocarlo a la vez:
   *  el efecto de foco correría antes que la decoración y dejaría el DOM vacío. */
  setText?: string;
}

interface BlockMenuState {
  blockId: string;
  left: number;
  top: number;
}

/** Tipos a los que un bloque de texto puede "convertirse" conservando su
 *  contenido. Excluye imagen/tabla/divisor: no tienen texto que preservar. */
const TURN_INTO_TYPES = BLOCK_TYPES.filter(
  (t) => t.type !== "image" && t.type !== "table" && t.type !== "divider",
);

/** Un bloque con texto puede transformarse en otro tipo textual. */
function canTurnInto(type: BlockType): boolean {
  return type !== "image" && type !== "table" && type !== "divider";
}

/** Icono (lucide) de cada tipo de bloque, para los menús "/" y "convertir en". */
const BLOCK_TYPE_ICONS: Record<BlockType, LucideIcon> = {
  paragraph: Pilcrow,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  bulletList: List,
  numberedList: ListOrdered,
  taskItem: ListChecks,
  quote: Quote,
  code: Code,
  table: TableIcon,
  divider: Minus,
  image: ImageIcon,
};

function blockTypeIcon(type: BlockType) {
  const Icon = BLOCK_TYPE_ICONS[type];
  return <Icon style={{ width: 16, height: 16 }} />;
}

function clampBlockMenuPosition(left: number, top: number): { left: number; top: number } {
  const width = 280;
  const margin = 8;
  return {
    left: Math.min(Math.max(margin, left), window.innerWidth - width - margin),
    top: Math.min(Math.max(margin, top), window.innerHeight - margin - 320),
  };
}

type TaskBlockStatus = "todo" | "doing" | "done";

const TASK_STATUS_OPTIONS: { value: TaskBlockStatus; label: string }[] = [
  { value: "todo", label: "Pendiente" },
  { value: "doing", label: "En progreso" },
  { value: "done", label: "Hecho" },
];

function taskBlockStatus(block: Block): TaskBlockStatus {
  if (block.checked) return "done";
  if (block.doing) return "doing";
  return "todo";
}

const DRAG_THRESHOLD = 5;
const SLASH_PLACEHOLDER = "Escribe o pulsa '/' para comandos…";

/** Tipos de bloque "de texto": pueden recortarse parcialmente y fusionarse al
 *  borrar una selección nativa que los cruza. Código/imagen/divisor/tabla no. */
const TEXT_LIKE_BLOCK_TYPES = new Set<BlockType>([
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bulletList",
  "numberedList",
  "taskItem",
  "quote",
]);

/** Offset en texto plano de `(node, offset)` dentro de `root`, ignorando el
 *  marcado (spans de wikilinks, etc.) — igual que hace el navegador al medir
 *  una selección con `Range.toString()`. */
function plainTextOffsetWithin(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

/** Inverso de `plainTextOffsetWithin`: dado un offset de texto plano dentro de
 *  `root`, ubica el nodo de texto real y el offset dentro de él. */
function rangeBoundaryAtOffset(root: Node, offset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining };
    remaining -= node.data.length;
    last = node;
    node = walker.nextNode() as Text | null;
  }
  if (last) return { node: last, offset: last.data.length };
  return { node: root, offset: 0 };
}

/**
 * Bloque de código en modo solo-lectura: resalta con el mismo parser/estilo
 * que CodeMirror pero sin montar un editor. El texto plano se ve al instante;
 * el HTML resaltado se calcula perezosamente (solo si el bloque entra en
 * viewport) para no trabar la apertura de notas con muchos bloques de código.
 */
function CodeBlockStatic({ text, language }: { text: string; language?: string }) {
  const [html, setHtml] = useState<string | null>(() => peekHighlightedCode(text, language));
  const hostRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const cached = peekHighlightedCode(text, language);
    if (cached) {
      setHtml(cached);
      return;
    }
    setHtml(null);
    if (!language) return; // sin lenguaje elegido: no hay nada que resaltar

    let alive = true;
    let idleId: number | undefined;
    const schedule = () => {
      idleId =
        typeof window.requestIdleCallback === "function"
          ? window.requestIdleCallback(run, { timeout: 500 })
          : window.setTimeout(run, 0);
    };
    const run = () => {
      void highlightCodeStatic(text, language).then((h) => {
        if (alive) setHtml(h);
      });
    };

    const el = hostRef.current;
    if (!el) {
      schedule();
      return () => {
        alive = false;
      };
    }

    const rect = el.getBoundingClientRect();
    const inView = rect.bottom >= -400 && rect.top <= window.innerHeight + 400;
    let io: IntersectionObserver | null = null;
    if (inView) {
      schedule();
    } else {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            io = null;
            schedule();
          }
        },
        { rootMargin: "400px" },
      );
      io.observe(el);
    }

    return () => {
      alive = false;
      io?.disconnect();
      if (idleId !== undefined) {
        if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
        else window.clearTimeout(idleId);
      }
    };
  }, [text, language]);

  return (
    <pre className="code-block-static" ref={hostRef}>
      {html !== null ? (
        <code dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        text || " "
      )}
    </pre>
  );
}

/** Vista estática de un bloque (solo lectura). Un textarea/CodeMirror se monta al activar. */
function BlockDisplay({
  block,
  showSlashPlaceholder,
  ordinal,
  resolveWikiRel,
  onActivate,
  onToggleCheck,
  onLanguageChange,
  onDismissBlockMenus,
}: {
  block: Block;
  showSlashPlaceholder: boolean;
  ordinal?: number;
  resolveWikiRel: (title: string) => string | null;
  onActivate: (e: React.MouseEvent) => void;
  onToggleCheck: (id: string) => void;
  onLanguageChange: (id: string, language: string) => void;
  onDismissBlockMenus: () => void;
}) {
  // No preventDefault/activate aquí: se difiere a mouseup (ver activateCandidateRef
  // en BlockEditor) para no interceptar la selección nativa de texto al arrastrar.
  const activate = onActivate;

  const displayHtml = useMemo(() => {
    if (showSlashPlaceholder && block.text === "") return null;
    if (!block.text) return "\u00a0";
    return decorateWikilinksInPlainText(block.text, resolveWikiRel);
  }, [block.text, showSlashPlaceholder, resolveWikiRel]);

  if (block.type === "code") {
    return (
      <div className="block block-code">
        <CodeLanguagePicker
          blockId={block.id}
          value={normalizeCodeLanguageId(block.language ?? "")}
          text={block.text}
          onChange={(language) => onLanguageChange(block.id, language)}
          onDismissBlockMenus={onDismissBlockMenus}
        />
        <div onMouseDown={activate}>
          <CodeBlockStatic text={block.text} language={block.language} />
        </div>
      </div>
    );
  }

  if (block.type === "taskItem") {
    return (
      <div className={`block block-task ${block.checked ? "checked" : ""}`}>
        <span
          className={`cb ${block.checked ? "checked" : block.doing ? "doing" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCheck(block.id);
          }}
        />
        <div className="block-display" onMouseDown={activate}>
          {displayHtml === null ? (
            SLASH_PLACEHOLDER
          ) : (
            <span dangerouslySetInnerHTML={{ __html: displayHtml }} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`block block-${block.type}${showSlashPlaceholder && block.text === "" ? " block-display-ph" : ""}`}
      data-indent={Math.min(block.indent ?? 0, 3)}
      data-ord={
        block.type === "numberedList"
          ? formatOrderedMarker(ordinal ?? 1, block.indent ?? 0)
          : undefined
      }
      onMouseDown={activate}
    >
      <div className="block-display">
        {displayHtml === null ? (
          SLASH_PLACEHOLDER
        ) : (
          <span dangerouslySetInnerHTML={{ __html: displayHtml }} />
        )}
      </div>
    </div>
  );
}

/** Bloques donde Enter divide en un bloque nuevo y Shift+Enter inserta `\n`. */
function splitsOnEnter(type: BlockType): boolean {
  return (
    type === "paragraph" ||
    type === "quote" ||
    type === "heading1" ||
    type === "heading2" ||
    type === "heading3"
  );
}

/** Solo el último párrafo vacío al final del documento muestra el placeholder "/". */
function slashPlaceholderBlockId(blocks: Block[]): string | null {
  if (blocks.length === 0) return null;
  const last = blocks[blocks.length - 1];
  if (last.type === "paragraph" && last.text === "") return last.id;
  return null;
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

/** Rejilla de 6 puntos, como el asa de arrastre de Notion. */
function DragDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
      <circle cx="8" cy="5" r="1.5" />
      <circle cx="16" cy="5" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
      <circle cx="8" cy="19" r="1.5" />
      <circle cx="16" cy="19" r="1.5" />
    </svg>
  );
}

/**
 * Render de una imagen dentro del editor de bloques.
 *
 * La imagen no se lee hasta que el bloque se acerca al viewport
 * (IntersectionObserver), de modo que una nota con decenas de capturas no
 * dispara decenas de lecturas + codificaciones base64 al abrirse. El resultado
 * se cachea en `loadImageDataUri` para que scroll/re-render/reapertura sean
 * instantáneos.
 */
function ImageBlockView({
  src,
  alt,
  editorActive,
}: {
  src: string;
  alt: string;
  editorActive: boolean;
}) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const absPath = vaultPath ? `${vaultPath}/${decodeURI(src)}` : "";
  const [data, setData] = useState(() =>
    absPath ? peekImageDataUri(absPath) ?? "" : "",
  );
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!absPath) return;
    const cached = peekImageDataUri(absPath);
    if (cached) {
      setData(cached);
      return;
    }
    if (!editorActive) return;

    let alive = true;
    let io: IntersectionObserver | null = null;

    const startLoad = () => {
      loadImageDataUri(absPath)
        .then((uri) => {
          if (alive) setData(uri);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    };

    const el = hostRef.current;
    if (!el) {
      startLoad();
      return () => {
        alive = false;
      };
    }

    const rect = el.getBoundingClientRect();
    const inView = rect.bottom >= -400 && rect.top <= window.innerHeight + 400;
    if (inView) {
      startLoad();
      return () => {
        alive = false;
      };
    }

    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io?.disconnect();
          io = null;
          startLoad();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io?.disconnect();
    };
  }, [absPath, editorActive]);

  if (failed)
    return (
      <span className="block-image-missing">
        <TriangleAlert style={{ width: 15, height: 15, verticalAlign: "-3px" }} /> No se encontró: {src}
      </span>
    );
  if (!data) {
    return (
      <span ref={hostRef} className="block-image-loading muted">
        Cargando imagen…
      </span>
    );
  }
  return <img className="block-image-img" src={data} alt={alt} draggable={false} />;
}

/** Una fila editable. Solo monta textarea/CodeMirror cuando `isEditing` (patrón Logseq). */
const BlockRow = memo(function BlockRow({
  block,
  showSlashPlaceholder,
  registerRef,
  onInput,
  onCaretChange,
  onKeyDown,
  onToggleCheck,
  onLanguageChange,
  onTableChange,
  onDismissBlockMenus,
  resolveWikiRel,
  ordinal,
  editorActive,
  isEditing,
  onActivate,
  onTextareaMouseDown,
}: {
  block: Block;
  showSlashPlaceholder: boolean;
  ordinal?: number;
  registerRef: (id: string, el: BlockInputEl | null) => void;
  onInput: (id: string, el: BlockInputEl) => void;
  onCaretChange: (id: string, el: BlockInputEl) => void;
  onKeyDown: (e: React.KeyboardEvent, block: Block) => void;
  onToggleCheck: (id: string) => void;
  onLanguageChange: (id: string, language: string) => void;
  onTableChange: (id: string, table: TableData) => void;
  onDismissBlockMenus: () => void;
  onWikilinkOpen: (title: string) => void;
  resolveWikiRel: (title: string) => string | null;
  editorActive: boolean;
  isEditing: boolean;
  onActivate: (id: string, e: React.MouseEvent) => void;
  onTextareaMouseDown: (e: React.MouseEvent<HTMLTextAreaElement>, block: Block) => void;
}) {
  const ref = useRef<BlockInputEl | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (block.type === "image" || block.type === "divider" || block.type === "table") return;
    const el = ref.current;
    if (!(el instanceof HTMLTextAreaElement) || focusedRef.current) return;
    if (el.value !== block.text) el.value = block.text;
  }, [block.text, block.type]);

  const setTextareaRef = (el: HTMLTextAreaElement | null) => {
    ref.current = el;
    registerRef(block.id, el);
  };

  const setDivRef = (el: HTMLDivElement | null) => {
    ref.current = el;
    registerRef(block.id, el);
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    autoResizeTextarea(e.currentTarget);
    onInput(block.id, e.currentTarget);
  };

  if (block.type === "divider") {
    return (
      <div
        className="block block-divider"
        tabIndex={0}
        ref={setDivRef}
        onKeyDown={(e) => onKeyDown(e, block)}
      >
        <hr />
      </div>
    );
  }

  if (block.type === "image") {
    return (
      <div
        className="block block-image"
        tabIndex={0}
        ref={setDivRef}
        onKeyDown={(e) => onKeyDown(e, block)}
      >
        <ImageBlockView src={block.text} alt={block.alt ?? ""} editorActive={editorActive} />
      </div>
    );
  }

  if (block.type === "table") {
    return (
      <TableBlockView
        block={block}
        onChange={onTableChange}
        registerRef={registerRef}
        onKeyDown={onKeyDown}
      />
    );
  }

  if (!isEditing) {
    return (
      <BlockDisplay
        block={block}
        showSlashPlaceholder={showSlashPlaceholder}
        ordinal={ordinal}
        resolveWikiRel={resolveWikiRel}
        onActivate={(e) => onActivate(block.id, e)}
        onToggleCheck={onToggleCheck}
        onLanguageChange={onLanguageChange}
        onDismissBlockMenus={onDismissBlockMenus}
      />
    );
  }

  const editable = (
    <textarea
      className={`block-edit${showSlashPlaceholder ? "" : " no-ph"}`}
      rows={1}
      ref={setTextareaRef}
      placeholder={showSlashPlaceholder ? SLASH_PLACEHOLDER : undefined}
      defaultValue={block.text}
      onInput={handleTextareaInput}
      onSelect={(e) => onCaretChange(block.id, e.currentTarget)}
      onKeyUp={(e) => onCaretChange(block.id, e.currentTarget)}
      onClick={(e) => onCaretChange(block.id, e.currentTarget)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
      }}
      onKeyDown={(e) => onKeyDown(e, block)}
      onMouseDown={(e) => onTextareaMouseDown(e, block)}
    />
  );

  if (block.type === "taskItem") {
    return (
      <div className={`block block-task ${block.checked ? "checked" : ""}`}>
        <span
          className={`cb ${block.checked ? "checked" : block.doing ? "doing" : ""}`}
          onClick={() => onToggleCheck(block.id)}
        />
        {editable}
      </div>
    );
  }

  if (block.type === "code") {
    return (
      <CodeBlockView
        block={block}
        editorActive={editorActive}
        registerRef={registerRef}
        onInput={onInput}
        onCaretChange={onCaretChange}
        onKeyDown={onKeyDown}
        onLanguageChange={onLanguageChange}
        onDismissBlockMenus={onDismissBlockMenus}
      />
    );
  }

  return (
    <div
      className={`block block-${block.type}`}
      data-indent={Math.min(block.indent ?? 0, 3)}
      data-ord={
        block.type === "numberedList"
          ? formatOrderedMarker(ordinal ?? 1, block.indent ?? 0)
          : undefined
      }
    >
      {editable}
    </div>
  );
});

function BlockEditor({
  content,
  noteKey,
  contentEpoch = 0,
  active = true,
  onChange,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => cloneBlocks(getOrParseBlocks(content)));
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const editingBlockIdRef = useRef<string | null>(null);
  editingBlockIdRef.current = editingBlockId;
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [metaSuggest, setMetaSuggest] = useState<MetaSuggestState | null>(null);
  const [wikiSuggest, setWikiSuggest] = useState<WikiSuggestState | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockMenuState | null>(null);
  const refs = useRef<Map<string, BlockInputEl>>(new Map());
  const focusReq = useRef<FocusReq | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dragSession = useRef<{ index: number; startX: number; startY: number; dragging: boolean } | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // Hay un bloque enfocado (se está escribiendo). Oculta el añadir-bloque final.
  const [editing, setEditing] = useState(false);
  // Hay una selección de texto nativa en curso dentro del editor: también oculta
  // el añadir-bloque final para no estorbar al arrastrar una selección hasta él.
  const [selecting, setSelecting] = useState(false);
  const emitTimer = useRef<number | undefined>(undefined);
  const emitPending = useRef(false);
  const blocksRef = useRef(blocks);
  const isTypingRef = useRef(false);
  const undoStack = useRef<Block[][]>([]);
  const redoStack = useRef<Block[][]>([]);
  const historyPaused = useRef(false);
  const typingHistoryPushed = useRef(false);
  const MAX_UNDO = 100;
  // Durante el tecleo el texto vive en el DOM/refs; no pisar con state stale.
  if (!isTypingRef.current && !emitPending.current) {
    blocksRef.current = blocks;
  }
  // Puntero a la última `refreshEditing`; `commit` la usa aunque se defina antes.
  const refreshEditingRef = useRef<() => void>(() => {});

  // El padre guarda el markdown en el store global de pestañas, lo que re-renderiza
  // media app (barra lateral, paneles…) en cada cambio. Escribir caracter a caracter
  // no debe pagar ese coste: difundimos el cambio con debounce y lo vaciamos de
  // inmediato ante cambios estructurales, al perder foco y al desmontar.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const vaultPath = useVaultStore((s) => s.vaultPath);
  const notes = useNotesStore((s) => s.notes);
  const refreshImages = useNotesStore((s) => s.refreshImages);
  const currentNote = notes.find((n) => n.path === noteKey);
  const excludeRelPath = currentNote?.rel_path;
  const openByRelPath = useNotesStore((s) => s.openByRelPath);

  const openWikilink = useCallback(
    (title: string) => {
      const rel = resolveNoteTarget(title, "", buildNoteIndex(notes));
      if (rel) void openByRelPath(rel);
    },
    [notes, openByRelPath],
  );

  const resolveWikiRel = useCallback(
    (title: string) => resolveNoteTarget(title, "", buildNoteIndex(notes)),
    [notes],
  );

  const linkHover = useNoteLinkInteractions(currentNote?.rel_path ?? "");

  useEffect(() => {
    // El contenido se reemplazó desde fuera (otra nota / cambio en disco): descartamos
    // cualquier difusión local pendiente para no pisar el nuevo contenido.
    if (emitTimer.current !== undefined) {
      window.clearTimeout(emitTimer.current);
      emitTimer.current = undefined;
    }
    emitPending.current = false;
    undoStack.current = [];
    redoStack.current = [];
    typingHistoryPushed.current = false;
    setBlocks(cloneBlocks(getOrParseBlocks(content)));
    setEditingBlockId(null);
    setSlash(null);
    setMetaSuggest(null);
    setWikiSuggest(null);
    setBlockMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey, contentEpoch]);

  useLayoutEffect(() => {
    if (!focusReq.current) return;
    const { id, pos, setText } = focusReq.current;
    setEditingBlockId(id);
    const el = refs.current.get(id);
    if (!el) return;
    if (setText !== undefined) setBlockText(el, setText);
    if (typeof pos === "number") setBlockCaret(el, pos);
    else placeBlockCaret(el, pos);
    focusReq.current = null;
  });

  const fulfillFocusReq = useCallback((id: string, el: BlockInputEl) => {
    const req = focusReq.current;
    if (!req || req.id !== id) return;
    if (req.setText !== undefined) setBlockText(el, req.setText);
    if (typeof req.pos === "number") setBlockCaret(el, req.pos);
    else placeBlockCaret(el, req.pos);
    focusReq.current = null;
  }, []);

  const registerRef = useCallback(
    (id: string, el: BlockInputEl | null) => {
      if (el) {
        refs.current.set(id, el);
        fulfillFocusReq(id, el);
      } else {
        refs.current.delete(id);
      }
    },
    [fulfillFocusReq],
  );

  const syncBlocksFromRefs = useCallback((current: Block[]): Block[] => {
    return current.map((b) => {
      // Imagen/divisor no guardan texto editable en el DOM: su `text` (el src,
      // en imágenes) no debe sobrescribirse con el textContent del contenedor.
      if (b.type === "image" || b.type === "divider" || b.type === "table") return b;
      const el = refs.current.get(b.id);
      if (!el) return b;
      return { ...b, text: syncBlockTextFromRef(el, b.text) };
    });
  }, []);

  const patchBlockText = useCallback((id: string, text: string) => {
    blocksRef.current = blocksRef.current.map((b) =>
      b.id === id ? { ...b, text } : b,
    );
  }, []);

  const markdownFromRefs = useCallback(
    () => blocksToMarkdown(syncBlocksFromRefs(blocksRef.current)),
    [syncBlocksFromRefs],
  );

  // Difunde el markdown al padre ya mismo, cancelando cualquier debounce pendiente.
  const emitNow = useCallback((markdown: string) => {
    if (emitTimer.current !== undefined) {
      window.clearTimeout(emitTimer.current);
      emitTimer.current = undefined;
    }
    emitPending.current = false;
    onChangeRef.current(markdown);
  }, []);

  // Programa una difusión diferida; reinicia el temporizador en cada tecla.
  const scheduleEmit = useCallback(() => {
    emitPending.current = true;
    if (emitTimer.current !== undefined) window.clearTimeout(emitTimer.current);
    emitTimer.current = window.setTimeout(() => {
      emitTimer.current = undefined;
      if (!emitPending.current) return;
      emitPending.current = false;
      onChangeRef.current(markdownFromRefs());
    }, 180);
  }, [markdownFromRefs]);

  // Vacía cualquier cambio pendiente (al perder foco / desmontar).
  const flushEmit = useCallback(() => {
    if (emitTimer.current !== undefined) {
      window.clearTimeout(emitTimer.current);
      emitTimer.current = undefined;
    }
    if (!emitPending.current && !isTypingRef.current) return;
    emitPending.current = false;
    isTypingRef.current = false;
    const synced = syncBlocksFromRefs(blocksRef.current);
    blocksRef.current = synced;
    onChangeRef.current(blocksToMarkdown(synced));
    setBlocks(synced);
    typingHistoryPushed.current = false;
  }, [syncBlocksFromRefs]);

  const getSnapshot = useCallback(
    () => cloneBlocks(syncBlocksFromRefs(blocksRef.current)),
    [syncBlocksFromRefs],
  );

  const snapshotsEqual = useCallback((a: Block[], b: Block[]) => {
    return blocksToMarkdown(a) === blocksToMarkdown(b);
  }, []);

  const pushHistory = useCallback((override?: Block[]) => {
    if (historyPaused.current) return;
    const snap = override ? cloneBlocks(override) : getSnapshot();
    const stack = undoStack.current;
    const last = stack[stack.length - 1];
    if (last && snapshotsEqual(last, snap)) return;
    stack.push(snap);
    if (stack.length > MAX_UNDO) stack.shift();
    redoStack.current = [];
  }, [getSnapshot, snapshotsEqual]);

  const restoreSnapshot = useCallback(
    (snap: Block[]) => {
      historyPaused.current = true;
      isTypingRef.current = false;
      emitPending.current = false;
      if (emitTimer.current !== undefined) {
        window.clearTimeout(emitTimer.current);
        emitTimer.current = undefined;
      }
      setEditingBlockId(null);
      setSlash(null);
      setMetaSuggest(null);
      setWikiSuggest(null);
      setBlockMenu(null);
      const cloned = cloneBlocks(snap);
      blocksRef.current = cloned;
      setBlocks(cloned);
      emitNow(blocksToMarkdown(cloned));
      typingHistoryPushed.current = false;
      historyPaused.current = false;
      requestAnimationFrame(() => {
        refreshEditingRef.current();
        // Tras desmontar el textarea/CodeMirror el foco cae en body; sin esto
        // el siguiente Ctrl+Z no entra al handler que exige foco en el editor.
        editorRef.current?.focus({ preventScroll: true });
      });
    },
    [emitNow],
  );

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return false;
    const current = getSnapshot();
    redoStack.current.push(current);
    const prev = undoStack.current.pop()!;
    restoreSnapshot(prev);
    return true;
  }, [getSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return false;
    const current = getSnapshot();
    undoStack.current.push(current);
    const next = redoStack.current.pop()!;
    restoreSnapshot(next);
    return true;
  }, [getSnapshot, restoreSnapshot]);

  const commitBlockDomText = useCallback((id: string) => {
    const b = blocksRef.current.find((x) => x.id === id);
    if (!b || b.type === "image" || b.type === "divider" || b.type === "table") return;
    const el = refs.current.get(id);
    const text = el ? syncBlockTextFromRef(el, b.text) : b.text;
    patchBlockText(id, text);
    let changed = false;
    setBlocks((prev) => {
      if (prev.find((x) => x.id === id)?.text === text) return prev;
      changed = true;
      return prev.map((x) => (x.id === id ? { ...x, text } : x));
    });
    if (changed) scheduleEmit();
  }, [patchBlockText, scheduleEmit]);

  const activateBlock = useCallback(
    (id: string, pos: "start" | "end" = "end") => {
      if (editingBlockId && editingBlockId !== id) {
        commitBlockDomText(editingBlockId);
      }
      focusReq.current = { id, pos };
      setEditingBlockId(id);
    },
    [editingBlockId, commitBlockDomText],
  );

  // Distingue clic de arrastre en bloques estáticos: el mousedown solo registra
  // un candidato; si el mouseup llega cerca del punto inicial se activa el
  // bloque (edición), si no, se deja que la selección nativa de texto ocurra.
  const activateCandidateRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const beginActivateCandidate = useCallback((id: string, e: React.MouseEvent) => {
    activateCandidateRef.current = { id, x: e.clientX, y: e.clientY };
  }, []);

  useEffect(() => {
    if (!active) return;
    const onMouseUp = (e: MouseEvent) => {
      const candidate = activateCandidateRef.current;
      activateCandidateRef.current = null;
      if (!candidate) return;
      const dx = e.clientX - candidate.x;
      const dy = e.clientY - candidate.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) return;
      activateBlock(candidate.id);
    };
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [active, activateBlock]);

  // Detecta una selección de texto nativa (no colapsada) dentro del editor para
  // ocultar el botón "Añadir bloque" mientras se selecciona. La selección dentro
  // de un textarea no aparece en window.getSelection(), pero ese caso ya está
  // cubierto por `editing` (el bloque enfocado oculta el botón igualmente).
  useEffect(() => {
    if (!active) {
      setSelecting(false);
      return;
    }
    const onSelChange = () => {
      const sel = window.getSelection();
      const editor = editorRef.current;
      const has =
        !!sel &&
        !sel.isCollapsed &&
        !!editor &&
        (editor.contains(sel.anchorNode) || editor.contains(sel.focusNode));
      setSelecting(has);
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      setSelecting(false);
    };
  }, [active]);

  // Un <textarea> nunca expone su selección interna a la Selection del
  // documento, así que un arrastre que empieza dentro del bloque activo no
  // puede extenderse por sí solo a otros bloques. Si el mousedown en el
  // textarea deriva en arrastre (supera el umbral), lo convertimos a estático
  // sobre la marcha y seguimos construyendo la selección nosotros mismos con
  // `setBaseAndExtent`, igual que si el arrastre hubiese empezado en un bloque
  // ya estático.
  const manualDragRef = useRef<{
    blockId: string;
    downX: number;
    downY: number;
    anchorNode: Node;
    anchorOffset: number;
    converted: boolean;
  } | null>(null);

  const onTextareaMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>, block: Block) => {
      const el = e.currentTarget;
      manualDragRef.current = {
        blockId: block.id,
        downX: e.clientX,
        downY: e.clientY,
        anchorNode: el,
        anchorOffset: el.selectionStart ?? 0,
        converted: false,
      };

      const onMove = (ev: MouseEvent) => {
        const drag = manualDragRef.current;
        if (!drag) return;
        if (!drag.converted) {
          const dx = ev.clientX - drag.downX;
          const dy = ev.clientY - drag.downY;
          if (Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
          const offset = el.selectionStart ?? 0;
          flushSync(() => {
            commitBlockDomText(drag.blockId);
            setEditingBlockId((cur) => (cur === drag.blockId ? null : cur));
          });
          const displayRoot = editorRef.current?.querySelector<HTMLElement>(
            `.block-row[data-block-id="${drag.blockId}"] .block-display`,
          );
          if (!displayRoot) {
            manualDragRef.current = null;
            return;
          }
          const anchor = rangeBoundaryAtOffset(displayRoot, offset);
          drag.anchorNode = anchor.node;
          drag.anchorOffset = anchor.offset;
          drag.converted = true;
        }
        const point = document.caretRangeFromPoint?.(ev.clientX, ev.clientY);
        if (!point) return;
        window.getSelection()?.setBaseAndExtent(
          drag.anchorNode,
          drag.anchorOffset,
          point.startContainer,
          point.startOffset,
        );
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        manualDragRef.current = null;
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [commitBlockDomText],
  );

  useEffect(() => () => flushEmit(), [flushEmit]);

  const wasActiveRef = useRef(active);
  useEffect(() => {
    if (!active) {
      flushEmit();
      setEditingBlockId(null);
      setSlash(null);
      setMetaSuggest(null);
      setWikiSuggest(null);
      setBlockMenu(null);
      closeAllCodeLangPickers();
      if (editorRef.current?.contains(document.activeElement)) {
        (document.activeElement as HTMLElement)?.blur?.();
      }
      wasActiveRef.current = false;
      return;
    }
    const justActivated = !wasActiveRef.current;
    wasActiveRef.current = true;
    if (!justActivated || emitPending.current) return;
    const frame = window.requestAnimationFrame(() => {
      const currentMd = blocksToMarkdown(syncBlocksFromRefs(blocksRef.current));
      if (currentMd !== content) {
        setBlocks(cloneBlocks(getOrParseBlocks(content)));
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, content, flushEmit, syncBlocksFromRefs]);

  // useLayoutEffect (no useEffect): ajusta la altura ANTES de pintar. Si se
  // hiciera después del pintado, el textarea nace con la altura por defecto
  // del navegador y luego "salta" a la altura real, empujando visiblemente
  // los bloques de abajo — justo el temblor sutil al entrar en edición.
  // useLayoutEffect (no useEffect): ajusta la altura ANTES de pintar. `field-sizing:
  // content` cubre esto en navegadores recientes, pero si el WebView2 instalado
  // no lo soporta, el textarea nacería con la altura de una sola línea y
  // "saltaría" a la altura real tras el pintado — el temblor sutil al entrar
  // en edición que desplaza los bloques de abajo.
  useLayoutEffect(() => {
    if (!active || !editingBlockId) return;
    const el = refs.current.get(editingBlockId);
    if (el instanceof HTMLTextAreaElement) autoResizeTextarea(el);
  }, [active, editingBlockId, blocks]);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (editorRef.current?.contains(t)) return;
      if (
        t.closest(".block-picker") ||
        t.closest(".code-lang-menu-portal") ||
        t.closest(".task-meta-suggest-anchor")
      ) {
        return;
      }
      const id = editingBlockIdRef.current;
      if (!id) return;
      commitBlockDomText(id);
      setEditingBlockId(null);
      flushEmit();
      // El blur nativo del textarea desmontado puede no disparar el `onBlur`
      // del contenedor a tiempo: reevalúa `editing` explícitamente para que
      // el botón "Añadir bloque" vuelva a mostrarse.
      requestAnimationFrame(refreshEditingRef.current);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active, commitBlockDomText, flushEmit]);

  // Cierra popovers del editor (menú bloque, /, sugerencias). NO cierra los
  // selectores de lenguaje: su único invocador es el propio botón del selector,
  // que al abrirse ya cierra los *otros* con `closeAllCodeLangPickers(blockId)`.
  // Si aquí cerrásemos todos (sin excluir), cerraríamos el que se acaba de abrir
  // en el mismo click y el dropdown quedaría inservible tras la primera vez.
  const dismissBlockEditorMenus = useCallback(() => {
    setBlockMenu(null);
    setSlash(null);
    setMetaSuggest(null);
    setWikiSuggest(null);
  }, []);

  // Cierra el menú contextual del bloque al hacer clic fuera, pulsar Escape o scroll.
  useEffect(() => {
    if (!blockMenu) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".block-turn-menu")) return;
      if (t.closest(".code-lang-menu-portal")) return;
      setBlockMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBlockMenu(null);
    };
    // Cierra al hacer scroll fuera del menú (el menú tiene su propio scroll interno).
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.(".block-turn-menu")) return;
      setBlockMenu(null);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { capture: true });
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [blockMenu]);

  const commit = useCallback(
    (next: Block[]) => {
      pushHistory();
      typingHistoryPushed.current = false;
      isTypingRef.current = false;
      emitPending.current = false;
      if (emitTimer.current !== undefined) {
        window.clearTimeout(emitTimer.current);
        emitTimer.current = undefined;
      }
      blocksRef.current = next;
      setBlocks(next);
      emitNow(blocksToMarkdown(next));
      // Reevalúa el estado de edición tras el re-render/foco. Necesario porque
      // al eliminar un bloque enfocado el `blur` no llega al contenedor (el nodo
      // ya está desconectado), y `editing` se quedaría atascado en `true`.
      requestAnimationFrame(refreshEditingRef.current);
    },
    [emitNow, pushHistory],
  );

  const indexFromPointer = (clientY: number): number => {
    const editor = editorRef.current;
    if (!editor) return blocks.length - 1;
    const rows = editor.querySelectorAll<HTMLElement>(".block-row");
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) return i;
    }
    return blocks.length - 1;
  };

  const onHandlePointerDown = (index: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragSession.current = { index, startX: e.clientX, startY: e.clientY, dragging: false };
    setDropIndex(index);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    const session = dragSession.current;
    if (!session) return;

    if (!session.dragging) {
      const dx = Math.abs(e.clientX - session.startX);
      const dy = Math.abs(e.clientY - session.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      session.dragging = true;
      setDragIndex(session.index);
    }

    setDropIndex(indexFromPointer(e.clientY));
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    const session = dragSession.current;
    if (!session) return;

    if (session.dragging) {
      const target = indexFromPointer(e.clientY);
      if (target !== session.index) {
        const synced = syncBlocksFromRefs(blocksRef.current);
        const next = [...synced];
        const [moved] = next.splice(session.index, 1);
        next.splice(target, 0, moved);
        commit(next);
      }
    } else {
      const block = blocksRef.current[session.index];
      if (block) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openBlockMenuAt(block.id, rect.left, rect.bottom + 4);
      }
    }

    dragSession.current = null;
    setDragIndex(null);
    setDropIndex(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const filteredSlashEntries: SlashEntry[] = slash
    ? (() => {
        const q = slash.query.toLowerCase();
        const matchBlock = (label: string, hint: string, type: string) =>
          label.toLowerCase().includes(q) ||
          hint.toLowerCase().includes(q) ||
          type.toLowerCase().includes(q);
        const entries: SlashEntry[] = [];
        if (slashWikilinkMatches(slash.query)) {
          entries.push({ kind: "wikilink", ...SLASH_WIKILINK_COMMAND });
        }
        for (const t of BLOCK_TYPES) {
          if (matchBlock(t.label, t.hint, t.type)) {
            entries.push({ kind: "block", type: t.type, label: t.label, icon: t.icon, hint: t.hint });
          }
        }
        return entries;
      })()
    : [];

  // Reemplaza el comando "/consulta" (desde `slash.start` hasta el cursor) por el
  // texto dado, dentro del mismo bloque, y devuelve el nuevo texto + el offset
  // donde debe quedar el cursor. Es la base de las inserciones "en línea".
  const spliceSlashCommand = (
    el: BlockInputEl,
    replacement: string,
  ): { before: string; after: string; text: string; caret: number } => {
    const text = readBlockText(el);
    const cursor = getBlockCaret(el);
    const start = slash?.blockId ? slash.start : 0;
    // Quita el espacio que separa `palabra /` para no dejarlo colgando.
    const before = text.slice(0, start).replace(/[ \t]+$/, "");
    const after = text.slice(cursor);
    return {
      before,
      after,
      text: before + replacement + after,
      caret: before.length + replacement.length,
    };
  };

  const applyWikilinkSlash = (blockId: string) => {
    const el = refs.current.get(blockId);
    if (!el) return;
    // Wikilink: inserción en línea, se queda en el mismo bloque.
    const { text, caret } = spliceSlashCommand(el, "[[");
    setBlockText(el, text);
    setBlockCaret(el, caret);
    setSlash(null);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const next = synced.map((b) => (b.id === blockId ? { ...b, text } : b));
    commit(next);
    updateWikiSuggest(blockId, el);
  };

  const applySlashEntry = (blockId: string, entry: SlashEntry) => {
    if (entry.kind === "wikilink") applyWikilinkSlash(blockId);
    else applyType(blockId, entry.type);
  };

  const applyWikilinkValue = (blockId: string, noteName: string) => {
    const el = refs.current.get(blockId);
    if (!el || !wikiSuggest || wikiSuggest.blockId !== blockId) return;
    const text = readBlockText(el);
    const newText = applyWikilinkSelection(text, wikiSuggest, noteName);
    setBlockText(el, newText);
    const caret = wikiSuggest.valueStart + noteName.length + 2;
    setBlockCaret(el, caret);
    setWikiSuggest(null);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const next = synced.map((b) => (b.id === blockId ? { ...b, text: newText } : b));
    commit(next);
  };

  const updateWikiSuggest = (id: string, el: BlockInputEl) => {
    const text = readBlockText(el);
    const cursor = getBlockCaret(el);
    const trigger = detectWikilinkSuggest(text, cursor);
    if (!trigger) {
      setWikiSuggest((prev) => (prev?.blockId === id ? null : prev));
      return;
    }
    const caret = getBlockCaretClientRect(el);
    setWikiSuggest((prev) => {
      const matches = filterNotesForWikilink(notes, trigger.partial, excludeRelPath);
      return {
        blockId: id,
        left: caret.left,
        top: caret.bottom + 4,
        index:
          prev?.blockId === id && prev.partial === trigger.partial
            ? Math.min(prev.index, Math.max(0, matches.length - 1))
            : 0,
        ...trigger,
      };
    });
    if (slash?.blockId === id) setSlash(null);
  };

  /**
   * Aplica un tipo de bloque desde el menú "/". A diferencia del comportamiento
   * antiguo (que vaciaba el bloque), respeta el texto alrededor del comando:
   *   - `before`  = texto antes del "/"  ·  `after` = texto tras el cursor.
   *   - Si el comando ocupaba todo el bloque → se reutiliza el bloque actual.
   *   - Si había texto antes → el bloque actual conserva `before` y se crea un
   *     bloque nuevo del tipo elegido con `after` (estilo Notion).
   */
  const applyType = (blockId: string, type: BlockType) => {
    const el = refs.current.get(blockId);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const idx = synced.findIndex((b) => b.id === blockId);
    const current = synced[idx];
    const fullText = el ? readBlockText(el) : current?.text ?? "";
    const cursor = el ? getBlockCaret(el) : fullText.length;
    const start = slash?.blockId === blockId ? slash.start : 0;
    // Quita el espacio que separa `palabra /` para no dejarlo colgando.
    const before = fullText.slice(0, start).replace(/[ \t]+$/, "");
    const after = fullText.slice(cursor);
    const indent = isIndentableBlockType(type) ? (current?.indent ?? 0) : undefined;
    setSlash(null);

    // Tabla y divisor no llevan texto: si el bloque tenía contenido, se conserva
    // alrededor y el bloque nuevo se inserta en medio.
    if (type === "table" || type === "divider") {
      const standalone: Block =
        type === "table"
          ? emptyTable()
          : { id: newBlockId(), type: "divider", text: "" };
      const trailing = emptyBlock("paragraph");
      trailing.text = after;
      if (before === "") {
        // Reutiliza el bloque actual como bloque autónomo.
        const reused = { ...standalone, id: blockId };
        const next = synced.map((b) => (b.id === blockId ? reused : b));
        const withTrailing = [...next.slice(0, idx + 1), trailing, ...next.slice(idx + 1)];
        focusReq.current = { id: trailing.id, pos: "start", setText: after };
        commit(withTrailing);
      } else {
        if (el) setBlockText(el, before);
        const kept = synced.map((b) => (b.id === blockId ? { ...b, text: before } : b));
        const withNew = [
          ...kept.slice(0, idx + 1),
          standalone,
          trailing,
          ...kept.slice(idx + 1),
        ];
        focusReq.current = { id: trailing.id, pos: "start", setText: after };
        commit(withNew);
      }
      return;
    }

    // Tipos con texto (párrafo, encabezados, listas, tarea, cita, código).
    if (before === "") {
      // Reutiliza el bloque actual conservando lo que hubiera tras el cursor.
      if (el) setBlockText(el, after);
      const next = synced.map((b) => {
        if (b.id !== blockId) return b;
        return {
          ...b,
          type,
          text: after,
          checked: type === "taskItem" ? false : undefined,
          doing: undefined,
          indent,
          table: undefined,
          language: undefined,
        };
      });
      focusReq.current = { id: blockId, pos: "start", setText: after };
      commit(next);
    } else {
      // Conserva el bloque actual con `before` y crea uno nuevo con `after`.
      if (el) setBlockText(el, before);
      const nb: Block = {
        id: newBlockId(),
        type,
        text: after,
        checked: type === "taskItem" ? false : undefined,
        indent: isIndentableBlockType(type) ? (current?.indent ?? 0) : undefined,
      };
      const kept = synced.map((b) => (b.id === blockId ? { ...b, text: before } : b));
      const withNew = [...kept.slice(0, idx + 1), nb, ...kept.slice(idx + 1)];
      focusReq.current = { id: nb.id, pos: "start", setText: after };
      commit(withNew);
    }
  };

  /**
   * "Convertir en" (turn into): cambia el tipo de un bloque existente
   * conservando su texto. A diferencia de `applyType` (que parte el bloque en
   * el comando "/" y puede crear uno nuevo), aquí el contenido completo se
   * preserva. Excluye imagen/tabla/divisor como destino porque no tienen texto
   * que mantener.
   */
  const convertType = (blockId: string, type: BlockType) => {
    setBlockMenu(null);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const current = synced.find((b) => b.id === blockId);
    if (!current || current.type === type) return;
    const indent = isIndentableBlockType(type) ? (current.indent ?? 0) : undefined;
    const next = synced.map((b) => {
      if (b.id !== blockId) return b;
      return {
        ...b,
        type,
        checked: type === "taskItem" ? (b.checked ?? false) : undefined,
        doing: type === "taskItem" ? b.doing : undefined,
        indent,
        language: type === "code" ? b.language : undefined,
        table: undefined,
      };
    });
    focusReq.current = { id: blockId, pos: "end" };
    commit(next);
  };

  const insertBlockBelow = (blockId: string) => {
    setBlockMenu(null);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const idx = synced.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    const current = synced[idx];
    const indent = isIndentableBlockType(current.type) ? (current.indent ?? 0) : 0;
    const nb = emptyBlock("paragraph", indent);
    const next = [...synced.slice(0, idx + 1), nb, ...synced.slice(idx + 1)];
    focusReq.current = { id: nb.id, pos: "start" };
    commit(next);
  };

  const deleteBlockFromMenu = (blockId: string) => {
    setBlockMenu(null);
    removeBlock(blockId);
  };

  // Abre el menú contextual del bloque (convertir, insertar debajo, eliminar).
  const openBlockMenuAt = (blockId: string, left: number, top: number) => {
    closeAllCodeLangPickers();
    setSlash(null);
    setMetaSuggest(null);
    setWikiSuggest(null);
    const pos = clampBlockMenuPosition(left, top);
    setBlockMenu((prev) =>
      prev?.blockId === blockId ? null : { blockId, ...pos },
    );
  };

  const onBlockContextMenu = (blockId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openBlockMenuAt(blockId, e.clientX, e.clientY);
  };

  const applyMetaValue = (blockId: string, trigger: MetaSuggestTrigger, value: string) => {
    const el = refs.current.get(blockId);
    if (!el) return;
    const text = readBlockText(el);
    const newText =
      text.slice(0, trigger.valueStart) + value + text.slice(trigger.replaceEnd);
    setBlockText(el, newText);
    setBlockCaret(el, trigger.valueStart + value.length);
    setMetaSuggest(null);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const next = synced.map((b) => (b.id === blockId ? { ...b, text: newText } : b));
    commit(next);
  };

  const updateMetaSuggest = (id: string, el: BlockInputEl) => {
    const text = readBlockText(el);
    const cursor = getBlockCaret(el);
    if (detectWikilinkSuggest(text, cursor)) {
      setMetaSuggest((prev) => (prev?.blockId === id ? null : prev));
      return;
    }
    const trigger = detectMetaSuggest(text, cursor);
    if (!trigger) {
      setMetaSuggest((prev) => (prev?.blockId === id ? null : prev));
      return;
    }
    const caret = getBlockCaretClientRect(el);
    setMetaSuggest({
      blockId: id,
      left: caret.left,
      top: caret.bottom + 4,
      ...trigger,
    });
    if (slash?.blockId === id) setSlash(null);
  };

  /** Transforma un párrafo cuando se escribe un atajo Markdown "en caliente". */
  const applyMarkdownShortcut = (id: string, sc: MarkdownShortcut) => {
    setSlash(null);
    setMetaSuggest(null);
    setWikiSuggest(null);
    const current = syncBlocksFromRefs(blocksRef.current);

    if (sc.type === "divider") {
      const idx = current.findIndex((b) => b.id === id);
      const el = refs.current.get(id);
      if (el) setBlockText(el, "");
      const trailing = emptyBlock("paragraph");
      const next = current.map((b) =>
        b.id === id
          ? { ...b, type: "divider" as BlockType, text: "", checked: undefined, indent: undefined }
          : b,
      );
      const withTrailing = [...next.slice(0, idx + 1), trailing, ...next.slice(idx + 1)];
      focusReq.current = { id: trailing.id, pos: "start" };
      commit(withTrailing);
      return;
    }

    const el = refs.current.get(id);
    if (el) setBlockText(el, sc.rest);
    const next = current.map((b) =>
      b.id === id
        ? {
            ...b,
            type: sc.type,
            text: sc.rest,
            checked: sc.type === "taskItem" ? (sc.checked ?? false) : undefined,
            doing: sc.type === "taskItem" ? sc.doing : undefined,
            indent: isIndentableBlockType(sc.type) ? (b.indent ?? 0) : undefined,
          }
        : b,
    );
    focusReq.current = { id, pos: "end" };
    commit(next);
  };

  /** Abre/cierra/actualiza el menú "/" según el cursor. Devuelve si está activo. */
  const updateSlash = (id: string, el: BlockInputEl): boolean => {
    const text = readBlockText(el);
    const cmd = detectSlashCommand(text, getBlockCaret(el));
    if (!cmd) {
      setSlash((prev) => (prev?.blockId === id ? null : prev));
      return false;
    }
    const caret = getBlockCaretClientRect(el);
    setBlockMenu(null);
    closeAllCodeLangPickers();
    setSlash((prev) => ({
      blockId: id,
      query: cmd.query,
      start: cmd.start,
      index: prev?.blockId === id && prev.query === cmd.query ? prev.index : 0,
      // Fija el ancla al abrir; no la movemos mientras se escribe la consulta.
      left: prev?.blockId === id ? prev.left : caret.left,
      top: prev?.blockId === id ? prev.top : caret.bottom + 4,
    }));
    return true;
  };

  const onInput = (id: string, el: BlockInputEl) => {
    if (!typingHistoryPushed.current) {
      // onInput llega después de que el DOM ya refleja la tecla: el snapshot
      // debe usar el texto previo en blocksRef, no el valor actual del campo.
      const priorText = blocksRef.current.find((b) => b.id === id)?.text;
      if (priorText !== undefined) {
        const snap = getSnapshot().map((b) =>
          b.id === id ? { ...b, text: priorText } : b,
        );
        pushHistory(snap);
      } else {
        pushHistory();
      }
      typingHistoryPushed.current = true;
    }
    isTypingRef.current = true;
    const text = readBlockText(el);
    const current = blocksRef.current;
    const slashActive = detectSlashCommand(text, getBlockCaret(el)) !== null;

    // Detección "en caliente" de Markdown: solo en párrafos y sin menú "/".
    if (!slashActive) {
      const block = current.find((b) => b.id === id);
      if (block?.type === "paragraph") {
        const sc = detectMarkdownShortcut(text);
        if (sc) {
          applyMarkdownShortcut(id, sc);
          return;
        }
      }
    }

    if (updateSlash(id, el)) {
      // El menú "/" es exclusivo: silencia wikilink/meta mientras esté abierto.
      setMetaSuggest(null);
      setWikiSuggest(null);
    } else {
      updateWikiSuggest(id, el);
      updateMetaSuggest(id, el);
    }
    patchBlockText(id, text);
    // No setBlocks: el textarea es la fuente de verdad mientras se escribe.
    scheduleEmit();
  };

  const insertSoftNewline = (id: string, el: BlockInputEl) => {
    const text = readBlockText(el);
    const cursor = getBlockCaret(el);
    const newText = text.slice(0, cursor) + "\n" + text.slice(cursor);
    setBlockText(el, newText);
    setBlockCaret(el, cursor + 1);
    onInput(id, el);
  };

  // Divide el bloque por el cursor: lo anterior se queda en el bloque actual
  // y lo posterior pasa a uno nuevo (del mismo tipo si hay resto; párrafo si
  // el cursor estaba al final).
  const splitBlock = (id: string, el: BlockInputEl) => {
    const text = readBlockText(el);
    const cursor = getBlockCaret(el);
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    setBlockText(el, before);
    const synced = syncBlocksFromRefs(blocksRef.current);
    const idx = synced.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const current = synced[idx];
    const type: BlockType = after === "" ? "paragraph" : current.type;
    const nb: Block = {
      id: newBlockId(),
      type,
      text: after,
      indent: isIndentableBlockType(type) ? (current.indent ?? 0) : undefined,
    };
    const kept = synced.map((b) => (b.id === id ? { ...b, text: before } : b));
    const next = [...kept.slice(0, idx + 1), nb, ...kept.slice(idx + 1)];
    focusReq.current = { id: nb.id, pos: "start", setText: after };
    commit(next);
  };

  const insertAfter = (id: string, type: BlockType) => {
    const synced = syncBlocksFromRefs(blocksRef.current);
    const idx = synced.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const current = synced[idx];
    const indent = isIndentableBlockType(type) ? (current?.indent ?? 0) : 0;
    const nb = emptyBlock(type, indent);
    const next = [...synced.slice(0, idx + 1), nb, ...synced.slice(idx + 1)];
    focusReq.current = { id: nb.id, pos: "start" };
    commit(next);
  };

  // Estamos "editando" si el foco está dentro de un bloque del editor. Se
  // evalúa consultando `document.activeElement` (no `relatedTarget`, que no es
  // fiable cuando un bloque se elimina y el foco cae en `body` o en un bloque
  // no enfocable como la tabla).
  const refreshEditing = useCallback(() => {
    const active = document.activeElement;
    setEditing(
      !!active &&
        active !== editorRef.current &&
        !!editorRef.current?.contains(active),
    );
  }, []);
  refreshEditingRef.current = refreshEditing;

  // Añade un párrafo vacío al final de la nota y lo enfoca. Lo usa la zona
  // "añadir bloque" que se muestra tras el último bloque.
  const appendBlock = () => {
    const synced = syncBlocksFromRefs(blocksRef.current);
    const nb = emptyBlock("paragraph");
    const next = [...synced, nb];
    focusReq.current = { id: nb.id, pos: "start" };
    commit(next);
  };

  const adjustIndent = (id: string, delta: number) => {
    const synced = syncBlocksFromRefs(blocksRef.current);
    const next = synced.map((b) => {
      if (b.id !== id || !isIndentableBlockType(b.type)) return b;
      const level = Math.max(
        0,
        Math.min(MAX_BLOCK_INDENT, (b.indent ?? 0) + delta),
      );
      return { ...b, indent: level };
    });
    commit(next);
  };

  const removeBlock = (id: string) => {
    const synced = syncBlocksFromRefs(blocksRef.current);
    const idx = synced.findIndex((b) => b.id === id);
    if (synced.length === 1) return;
    const prev = synced[idx - 1];
    const nextBlock = synced[idx + 1];
    const next = synced.filter((b) => b.id !== id);
    if (prev) focusReq.current = { id: prev.id, pos: "end" };
    else if (nextBlock) focusReq.current = { id: nextBlock.id, pos: "start" };
    commit(next);
  };

  // Borra una selección nativa (arrastre/teclado) que cruza uno o más bloques
  // estáticos, al estilo Notion: bloques totalmente cubiertos desaparecen, los
  // bloques de los extremos se recortan y, si ambos son de texto, se fusionan.
  const deleteNativeSelection = useCallback((): boolean => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const root = editorRef.current;
    if (!root) return false;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;
    // Evita actuar sobre una selección obsoleta si el foco saltó a otro control
    // (p. ej. título de la nota) sin llegar a limpiar la Selection del documento.
    const activeEl = document.activeElement;
    if (activeEl && activeEl !== document.body && !root.contains(activeEl)) return false;

    const rows = Array.from(root.querySelectorAll<HTMLElement>(".block-row[data-block-id]"));
    const touchedRows = rows.filter((el) => range.intersectsNode(el));
    if (touchedRows.length === 0) return false;

    const synced = blocksRef.current;
    const byId = new Map(synced.map((b) => [b.id, b]));
    const touchedIds = touchedRows.map((el) => el.getAttribute("data-block-id")!);
    const firstId = touchedIds[0];
    const lastId = touchedIds[touchedIds.length - 1];
    const firstBlock = byId.get(firstId);
    const lastBlock = byId.get(lastId);
    if (!firstBlock || !lastBlock) return false;

    const firstRoot = touchedRows[0].querySelector(".block-display") ?? touchedRows[0];
    const lastRoot =
      touchedRows[touchedRows.length - 1].querySelector(".block-display") ??
      touchedRows[touchedRows.length - 1];

    const firstIsText = TEXT_LIKE_BLOCK_TYPES.has(firstBlock.type);
    const lastIsText = TEXT_LIKE_BLOCK_TYPES.has(lastBlock.type);
    const firstPrefix = firstIsText
      ? firstBlock.text.slice(0, plainTextOffsetWithin(firstRoot, range.startContainer, range.startOffset))
      : "";
    const lastSuffix = lastIsText
      ? lastBlock.text.slice(plainTextOffsetWithin(lastRoot, range.endContainer, range.endOffset))
      : "";

    const middleIds = new Set(touchedIds.slice(1, -1));
    // Solo un bloque tocado, o ambos extremos son de texto: se fusionan en uno.
    const merge = touchedIds.length === 1 || (firstIsText && lastIsText);

    const next: Block[] = [];
    for (const b of synced) {
      if (b.id === firstId) {
        if (merge) {
          if (firstIsText) next.push({ ...b, text: firstPrefix + lastSuffix });
          // si el primero no es de texto (p. ej. imagen) no hay nada que fusionar: se elimina
        } else if (firstIsText) {
          next.push({ ...b, text: firstPrefix });
        }
        continue;
      }
      if (middleIds.has(b.id)) continue;
      if (b.id === lastId) {
        if (touchedIds.length === 1 || merge) continue; // ya fusionado en el primero (o es el mismo bloque)
        if (lastIsText) next.push({ ...b, text: lastSuffix });
        continue;
      }
      next.push(b);
    }
    if (next.length === 0) next.push(emptyBlock("paragraph"));

    // El cursor va al final del texto conservado del primer bloque si sobrevivió;
    // si no, al inicio de lo conservado del último; si ninguno sobrevivió, al
    // bloque anterior al primero tocado (o al primero restante, a falta de otro).
    if (firstIsText) {
      focusReq.current = { id: firstId, pos: firstPrefix.length };
    } else if (lastIsText && lastId !== firstId) {
      focusReq.current = { id: lastId, pos: 0 };
    } else {
      const firstTouchedIdx = synced.findIndex((b) => b.id === firstId);
      const prevSurvivor = synced[firstTouchedIdx - 1];
      if (prevSurvivor && next.some((b) => b.id === prevSurvivor.id)) {
        focusReq.current = { id: prevSurvivor.id, pos: "end" };
      } else if (next[0]) {
        focusReq.current = { id: next[0].id, pos: "start" };
      }
    }

    commit(next);
    return true;
  }, [commit]);

  useEffect(() => {
    if (!active) return;
    const onKeyDownGlobal = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (deleteNativeSelection()) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDownGlobal);
    return () => document.removeEventListener("keydown", onKeyDownGlobal);
  }, [active, deleteNativeSelection]);

  useEffect(() => {
    if (!active) return;

    const canHandleUndoRedo = () => {
      const root = editorRef.current;
      if (!root) return false;
      const activeEl = document.activeElement;
      if (!activeEl) return true;
      if (root.contains(activeEl)) return true;
      // Tras deshacer, el foco suele quedar en body/html: seguir permitiendo la cadena.
      if (activeEl === document.body || activeEl === document.documentElement) {
        return undoStack.current.length > 0 || redoStack.current.length > 0;
      }
      const el = activeEl as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable
      ) {
        return false;
      }
      return undoStack.current.length > 0 || redoStack.current.length > 0;
    };

    const onUndoRedo = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      if (!canHandleUndoRedo()) return;

      if (e.key === "z" && !e.shiftKey) {
        if (undo()) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        if (redo()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    document.addEventListener("keydown", onUndoRedo, true);
    return () => document.removeEventListener("keydown", onUndoRedo, true);
  }, [active, undo, redo]);

  const onToggleCheck = (id: string) => {
    // Clic = completar: tanto pendiente como "en progreso" pasan a hecho.
    const next = blocks.map((b) =>
      b.id === id
        ? { ...b, checked: b.doing ? true : !b.checked, doing: undefined }
        : b,
    );
    commit(next);
  };

  const setTaskStatus = useCallback(
    (id: string, status: TaskBlockStatus) => {
      setBlockMenu(null);
      const next = blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              checked: status === "done",
              doing: status === "doing" ? true : undefined,
            }
          : b,
      );
      commit(next);
    },
    [blocks, commit],
  );

  const onLanguageChange = useCallback(
    (id: string, language: string) => {
      const normalized = normalizeCodeLanguageId(language) || undefined;
      const next = blocks.map((b) =>
        b.id === id ? { ...b, language: normalized } : b,
      );
      commit(next);
    },
    [blocks, commit],
  );

  const onTableChange = useCallback(
    (id: string, table: TableData) => {
      const next = blocks.map((b) => (b.id === id ? { ...b, table } : b));
      commit(next);
    },
    [blocks, commit],
  );

  const onCaretChange = (id: string, el: BlockInputEl) => {
    // Solo mantenemos/cerramos un menú "/" ya abierto; nunca lo abrimos aquí (si
    // no, tras Escape el keyup volvería a abrirlo porque el "/" sigue en el texto).
    // Abrirlo es responsabilidad exclusiva de `onInput` (al teclear).
    if (slash?.blockId === id) {
      if (updateSlash(id, el)) return; // sigue activo bajo el cursor (exclusivo)
    }
    updateWikiSuggest(id, el);
    updateMetaSuggest(id, el);
  };

  const onKeyDown = (e: React.KeyboardEvent, block: Block) => {
    if (wikiSuggest && wikiSuggest.blockId === block.id) {
      const matches = filterNotesForWikilink(
        notes,
        wikiSuggest.partial,
        excludeRelPath,
      );
      if (e.key === "Escape") {
        e.preventDefault();
        setWikiSuggest(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setWikiSuggest({
          ...wikiSuggest,
          index: Math.min(wikiSuggest.index + 1, Math.max(0, matches.length - 1)),
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setWikiSuggest({
          ...wikiSuggest,
          index: Math.max(wikiSuggest.index - 1, 0),
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = matches[wikiSuggest.index];
        if (chosen) applyWikilinkValue(block.id, chosen.name);
        return;
      }
    }

    if (metaSuggest && metaSuggest.blockId === block.id) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMetaSuggest(null);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }
    }

    // Solo capturamos teclas del menú "/" cuando hay entradas visibles: si el
    // comando no coincide con nada, Enter/flechas deben comportarse con normalidad.
    if (slash && slash.blockId === block.id && filteredSlashEntries.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlash({
          ...slash,
          index: Math.min(slash.index + 1, filteredSlashEntries.length - 1),
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlash({ ...slash, index: Math.max(slash.index - 1, 0) });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = filteredSlashEntries[slash.index];
        if (chosen) applySlashEntry(block.id, chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
        return;
      }
    }

    // Escape sin ningún popover abierto: salir de la edición del bloque (perder
    // el foco), dejándolo como vista estática. Los `return` de arriba ya cierran
    // los menús /, wikilink y meta antes de llegar aquí.
    if (e.key === "Escape") {
      e.preventDefault();
      commitBlockDomText(block.id);
      setEditingBlockId(null);
      (document.activeElement as HTMLElement | null)?.blur?.();
      flushEmit();
      requestAnimationFrame(refreshEditingRef.current);
      return;
    }

    if (e.key === "Tab") {
      if (isIndentableBlockType(block.type)) {
        e.preventDefault();
        adjustIndent(block.id, e.shiftKey ? -1 : 1);
      }
      return;
    }

    if (e.key === "Enter" && e.shiftKey) {
      // image/table no son campos de texto: `insertSoftNewline` haría
      // `el.textContent = ...` sobre un nodo que React gestiona (la imagen o
      // la tabla), corrompiéndolo fuera del reconciler.
      if (
        block.type === "code" ||
        block.type === "divider" ||
        block.type === "image" ||
        block.type === "table"
      ) {
        return;
      }
      e.preventDefault();
      const el = refs.current.get(block.id);
      if (!el) return;
      insertSoftNewline(block.id, el);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      if (block.type === "code") return;
      if (splitsOnEnter(block.type)) {
        e.preventDefault();
        const el = refs.current.get(block.id);
        if (!el) return;
        splitBlock(block.id, el);
        return;
      }
      e.preventDefault();
      const el = refs.current.get(block.id);
      const text = el ? readBlockText(el) : block.text;
      if (
        (block.type === "bulletList" ||
          block.type === "numberedList" ||
          block.type === "taskItem") &&
        text.trim() === ""
      ) {
        const synced = syncBlocksFromRefs(blocksRef.current);
        const next = synced.map((b) =>
          b.id === block.id
            ? {
                ...b,
                type: "paragraph" as BlockType,
                text: "",
                checked: undefined,
                indent: undefined,
              }
            : b,
        );
        focusReq.current = { id: block.id, pos: "start" };
        commit(next);
        return;
      }
      const continues =
        block.type === "bulletList" ||
        block.type === "numberedList" ||
        block.type === "taskItem";
      insertAfter(block.id, continues ? block.type : "paragraph");
      return;
    }

    if ((e.key === "Backspace" || e.key === "Delete") && (block.type === "image" || block.type === "table")) {
      e.preventDefault();
      if ((block.indent ?? 0) > 0) {
        adjustIndent(block.id, -1);
      } else {
        removeBlock(block.id);
      }
      return;
    }

    if (e.key === "Backspace") {
      const el = refs.current.get(block.id);
      const text = el ? readBlockText(el) : block.text;
      const atStart = el ? getBlockCaret(el) === 0 : false;
      if (block.type === "divider") {
        e.preventDefault();
        removeBlock(block.id);
        return;
      }
      if (text === "" || (atStart && block.type !== "paragraph")) {
        if (
          isIndentableBlockType(block.type) &&
          (block.indent ?? 0) > 0 &&
          (text === "" || atStart)
        ) {
          e.preventDefault();
          adjustIndent(block.id, -1);
          return;
        }
        if (text === "") {
          e.preventDefault();
          removeBlock(block.id);
        } else if (atStart) {
          e.preventDefault();
          const synced = syncBlocksFromRefs(blocksRef.current);
          const next = synced.map((b) =>
            b.id === block.id
              ? {
                  ...b,
                  type: "paragraph" as BlockType,
                  checked: undefined,
                  indent: undefined,
                }
              : b,
          );
          focusReq.current = { id: block.id, pos: "start" };
          commit(next);
        }
      }
    }
  };

  // Inserta un bloque-párrafo con el markdown de imagen tras el bloque enfocado
  // (o al final si no hay ninguno enfocado).
  const insertImageBlock = useCallback(
    (src: string, alt: string) => {
      const active = document.activeElement as HTMLElement | null;
      let targetId: string | null = null;
      for (const [id, el] of refs.current.entries()) {
        if (el === active) {
          targetId = id;
          break;
        }
      }
      const synced = syncBlocksFromRefs(blocksRef.current);
      const imageBlock: Block = { id: newBlockId(), type: "image", text: src, alt };
      // Un párrafo vacío tras la imagen para poder seguir escribiendo.
      const trailing = emptyBlock("paragraph");
      let next: Block[];
      if (targetId) {
        const idx = synced.findIndex((b) => b.id === targetId);
        next = [
          ...synced.slice(0, idx + 1),
          imageBlock,
          trailing,
          ...synced.slice(idx + 1),
        ];
      } else {
        next = [...synced, imageBlock, trailing];
      }
      focusReq.current = { id: trailing.id, pos: "start" };
      commit(next);
    },
    [commit, syncBlocksFromRefs],
  );

  const onPaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!vaultPath) return;
      const dt = e.clipboardData;
      const hasText = (dt?.getData("text/plain") ?? "") !== "";
      const items = Array.from(dt?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      // Pegado de texto normal sin imagen: comportamiento por defecto.
      if (hasText && !file) return;
      e.preventDefault();
      try {
        let name: string;
        if (file) {
          const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
          const ext = mimeToExt(file.type);
          name = await savePastedImage(vaultPath, ext, bytes);
        } else {
          name = await saveClipboardImage(vaultPath);
        }
        insertImageBlock(name, name);
        await refreshImages();
        useSyncStore.getState().scheduleSyncOnSave();
      } catch {
        /* no había imagen en el portapapeles */
      }
    },
    [vaultPath, insertImageBlock, refreshImages],
  );

  const placeholderBlockId = slashPlaceholderBlockId(blocks);
  const canDelete = blocks.length > 1;

  const isBlockEditing = useCallback(
    (blockId: string) => {
      if (blockId === editingBlockId) return true;
      return editingBlockId === null && active && blockId === placeholderBlockId;
    },
    [editingBlockId, active, placeholderBlockId],
  );

  // Numeración de listas ordenadas: misma fuente que la serialización, para que
  // los números mostrados y los del markdown coincidan.
  const numberOrdinals = useMemo(() => computeOrderedOrdinals(blocks), [blocks]);

  const renderBlockRow = (b: Block, index: number) => {
    const isDragging = dragIndex === index;
    const isDropBefore =
      dropIndex === index && dragIndex !== null && dragIndex !== index;
    const isEmptyParagraph =
      b.type === "paragraph" && b.text === "" && b.id !== placeholderBlockId;
    return (
      <div
        key={b.id}
        data-block-id={b.id}
        data-indent={Math.min(b.indent ?? 0, 3)}
        className={`block-row block-row-${b.type} ${isDragging ? "dragging" : ""} ${isDropBefore ? "drag-over" : ""} ${isEmptyParagraph ? "block-row-empty" : ""}`}
        style={{ paddingLeft: (b.indent ?? 0) * INDENT_PX_PER_LEVEL }}
        onContextMenuCapture={(e) => onBlockContextMenu(b.id, e)}
      >
        <div className="block-controls" contentEditable={false}>
          <button
            type="button"
            className="block-ctl block-add-btn"
            aria-label="Añadir bloque debajo"
            title="Añadir bloque debajo"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertBlockBelow(b.id)}
          >
            <PlusIcon />
          </button>
          <span
            className="block-ctl block-drag-handle"
            aria-label="Mover bloque o clic para menú del bloque"
            title="Arrastra para mover · clic para menú"
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => onHandlePointerDown(index, e)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
          >
            <DragDotsIcon />
          </span>
        </div>
        <BlockRow
          block={b}
          showSlashPlaceholder={b.id === placeholderBlockId}
          registerRef={registerRef}
          onInput={onInput}
          onCaretChange={onCaretChange}
          onKeyDown={onKeyDown}
          onToggleCheck={onToggleCheck}
          onLanguageChange={onLanguageChange}
          onTableChange={onTableChange}
          onDismissBlockMenus={dismissBlockEditorMenus}
          onWikilinkOpen={openWikilink}
          resolveWikiRel={resolveWikiRel}
          ordinal={numberOrdinals.get(b.id)}
          editorActive={active}
          isEditing={isBlockEditing(b.id)}
          onActivate={beginActivateCandidate}
          onTextareaMouseDown={onTextareaMouseDown}
        />
      </div>
    );
  };

  return (
    <div
      className={`block-editor${active ? "" : " block-editor-dormant"}`}
      ref={editorRef}
      tabIndex={-1}
      hidden={!active}
      onPaste={onPaste}
      onFocus={refreshEditing}
      onBlur={() => {
        requestAnimationFrame(() => {
          const activeEl = document.activeElement;
          const leftEditor = !editorRef.current?.contains(activeEl);
          if (leftEditor && editingBlockIdRef.current) {
            commitBlockDomText(editingBlockIdRef.current);
            setEditingBlockId(null);
          }
          flushEmit();
          refreshEditing();
        });
      }}
      onMouseOver={linkHover.onMouseOver}
      onMouseMove={linkHover.onMouseMove}
      onMouseOut={linkHover.onMouseOut}
    >
      {blocks.map((b, index) => renderBlockRow(b, index))}

      {/* Se oculta con `visibility` (no se desmonta) al editar: quitarlo del DOM
          encogía el contenedor y desplazaba visiblemente el resto de bloques. */}
      <button
        type="button"
        className="block-add-trailing"
        aria-label="Añadir bloque"
        aria-hidden={editing || selecting}
        tabIndex={editing || selecting ? -1 : 0}
        style={editing || selecting ? { visibility: "hidden" } : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={appendBlock}
      >
        <span className="block-add-trailing-plus">+</span>
        Añadir bloque
      </button>

      {slash && filteredSlashEntries.length > 0 && (
        <div
          className="block-picker"
          style={{
            position: "fixed",
            left: slash.left,
            top: slash.top,
          }}
        >
          {filteredSlashEntries.some((e) => e.kind === "wikilink") && (
            <div className="pl-section">Enlaces</div>
          )}
          {filteredSlashEntries.map((t, i) => {
            const showBlockHeader =
              t.kind === "block" &&
              (i === 0 || filteredSlashEntries[i - 1]?.kind === "wikilink");
            return (
              <div key={t.kind === "wikilink" ? "wikilink" : t.type}>
                {showBlockHeader && <div className="pl-section">Bloques</div>}
                <div
                  className={`block-picker-item ${i === slash.index ? "sel" : ""}`}
                  onMouseEnter={() => setSlash({ ...slash, index: i })}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySlashEntry(slash.blockId, t);
                  }}
                >
                  <span className="bp-ico">
                    {t.kind === "wikilink" ? (
                      <Link2 style={{ width: 16, height: 16 }} />
                    ) : (
                      blockTypeIcon(t.type)
                    )}
                  </span>
                  <span className="bp-label">{t.label}</span>
                  <span className="bp-hint">{t.hint}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {blockMenu && (() => {
        const menuBlock = blocks.find((b) => b.id === blockMenu.blockId);
        const showTurnInto = menuBlock ? canTurnInto(menuBlock.type) : false;
        const currentTaskStatus =
          menuBlock?.type === "taskItem" ? taskBlockStatus(menuBlock) : null;
        return (
          <div
            className="block-picker block-turn-menu"
            style={{ position: "fixed", left: blockMenu.left, top: blockMenu.top }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="block-picker-item"
              onMouseDown={(e) => {
                e.preventDefault();
                insertBlockBelow(blockMenu.blockId);
              }}
            >
              <span className="bp-ico"><Plus style={{ width: 16, height: 16 }} /></span>
              <span className="bp-label">Insertar bloque debajo</span>
            </div>
            {menuBlock?.type === "taskItem" && (
              <>
                <div className="block-picker-divider" />
                <div className="pl-section">Estado</div>
                {TASK_STATUS_OPTIONS.map((opt) => {
                  const isCurrent = currentTaskStatus === opt.value;
                  return (
                    <div
                      key={opt.value}
                      className={`block-picker-item ${isCurrent ? "current" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setTaskStatus(blockMenu.blockId, opt.value);
                      }}
                    >
                      <span className="bp-ico">
                        <span
                          className={`cb sm bp-task-status-cb${
                            opt.value === "done"
                              ? " checked"
                              : opt.value === "doing"
                                ? " doing"
                                : ""
                          }`}
                          aria-hidden
                        />
                      </span>
                      <span className="bp-label">{opt.label}</span>
                      {isCurrent && (
                        <span className="bp-hint">Actual</span>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {canDelete && (
              <div
                className="block-picker-item danger"
                onMouseDown={(e) => {
                  e.preventDefault();
                  deleteBlockFromMenu(blockMenu.blockId);
                }}
              >
                <span className="bp-ico"><Trash2 style={{ width: 16, height: 16 }} /></span>
                <span className="bp-label">Eliminar bloque</span>
              </div>
            )}
            {showTurnInto && (
              <>
                <div className="block-picker-divider" />
                <div className="pl-section">Convertir en</div>
                {TURN_INTO_TYPES.map((t) => {
                  const isCurrent = menuBlock?.type === t.type;
                  return (
                    <div
                      key={t.type}
                      className={`block-picker-item ${isCurrent ? "current" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        convertType(blockMenu.blockId, t.type);
                      }}
                    >
                      <span className="bp-ico">{blockTypeIcon(t.type)}</span>
                      <span className="bp-label">{t.label}</span>
                      <span className="bp-hint">{isCurrent ? "Actual" : t.hint}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })()}

      {wikiSuggest && (
        <WikilinkSuggestPopover
          left={wikiSuggest.left}
          top={wikiSuggest.top}
          notes={notes}
          query={wikiSuggest.partial}
          selectedIndex={wikiSuggest.index}
          excludeRelPath={excludeRelPath}
          onSelect={(note) => applyWikilinkValue(wikiSuggest.blockId, note.name)}
          onHoverIndex={(index) => setWikiSuggest({ ...wikiSuggest, index })}
          onClose={() => setWikiSuggest(null)}
        />
      )}

      {metaSuggest && (
        <TaskMetaSuggestPopover
          kind={metaSuggest.kind}
          left={metaSuggest.left}
          top={metaSuggest.top}
          partial={metaSuggest.partial}
          onSelect={(value) =>
            applyMetaValue(metaSuggest.blockId, metaSuggest, value)
          }
          onClose={() => setMetaSuggest(null)}
        />
      )}
    </div>
  );
}

function blockEditorPropsEqual(prev: Props, next: Props): boolean {
  if (prev.noteKey !== next.noteKey) return false;
  if (prev.contentEpoch !== next.contentEpoch) return false;
  if (prev.active !== next.active) return false;
  // Con Bloques activo ignoramos content del padre (emit debounced) para no re-renderizar.
  if (next.active) return true;
  return prev.content === next.content;
}

export default memo(BlockEditor, blockEditorPropsEqual);
