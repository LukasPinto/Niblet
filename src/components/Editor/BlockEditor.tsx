import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type Block,
  type BlockType,
  type MarkdownShortcut,
  type TableData,
  BLOCK_TYPES,
  markdownToBlocks,
  blocksToMarkdown,
  computeOrderedOrdinals,
  detectMarkdownShortcut,
  emptyBlock,
  emptyTable,
  newBlockId,
  isIndentableBlockType,
  MAX_BLOCK_INDENT,
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
import TableBlockView from "./TableBlockView";
import { useVaultStore } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useSyncStore } from "../../stores/syncStore";
import { savePastedImage, saveClipboardImage } from "../../lib/tauri";
import { loadImageDataUri } from "../../lib/imageCache";
import { buildNoteIndex, resolveNoteTarget } from "../../lib/linkParser";
import { useNoteLinkInteractions } from "../../hooks/useNoteLinkInteractions";
import { mimeToExt } from "../../lib/imageNames";
import { normalizeCodeLanguageId } from "../../lib/codeLanguages";
import { closeAllCodeLangPickers } from "../../lib/blockEditorMenus";
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
  pos: "start" | "end";
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

function clampBlockMenuPosition(left: number, top: number): { left: number; top: number } {
  const width = 280;
  const margin = 8;
  return {
    left: Math.min(Math.max(margin, left), window.innerWidth - width - margin),
    top: Math.min(Math.max(margin, top), window.innerHeight - margin - 320),
  };
}

const DRAG_THRESHOLD = 5;
const SLASH_PLACEHOLDER = "Escribe o pulsa '/' para comandos…";

/** Bloques donde Enter inserta `\n` y Shift+Enter crea un bloque nuevo. */
function supportsSoftNewline(type: BlockType): boolean {
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
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
function ImageBlockView({ src, alt }: { src: string; alt: string }) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const [data, setData] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const placeholderRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (visible) return;
    const el = placeholderRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!vaultPath || !visible) return;
    let alive = true;
    setFailed(false);
    loadImageDataUri(`${vaultPath}/${decodeURI(src)}`)
      .then((uri) => {
        if (alive) setData(uri);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [vaultPath, src, visible]);

  if (failed) return <span className="block-image-missing">⚠ No se encontró: {src}</span>;
  if (!data)
    return (
      <span ref={placeholderRef} className="block-image-loading muted">
        Cargando imagen…
      </span>
    );
  return <img className="block-image-img" src={data} alt={alt} draggable={false} />;
}

/** Una fila editable. Texto plano usa `<textarea>` para evitar bugs de cursor en Chrome. */
function BlockRow({
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
  ordinal,
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
}) {
  const ref = useRef<BlockInputEl | null>(null);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (block.type === "image" || block.type === "divider" || block.type === "table") return;
    const el = ref.current;
    if (!(el instanceof HTMLTextAreaElement) || focusedRef.current) return;
    if (el.value !== block.text) {
      el.value = block.text;
      autoResizeTextarea(el);
    }
  }, [block.text, block.type]);

  useEffect(() => {
    if (block.type === "image" || block.type === "divider" || block.type === "table") return;
    const el = ref.current;
    if (el instanceof HTMLTextAreaElement) {
      el.value = block.text;
      autoResizeTextarea(el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

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
        <ImageBlockView src={block.text} alt={block.alt ?? ""} />
      </div>
    );
  }

  const editable = (
    <textarea
      className={`block-edit be-${block.type}${showSlashPlaceholder ? "" : " no-ph"}`}
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
    />
  );

  if (block.type === "taskItem") {
    return (
      <div className={`block block-task ${block.checked ? "checked" : ""}`}>
        <span
          className={`cb ${block.checked ? "checked" : ""}`}
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
        registerRef={registerRef}
        onInput={onInput}
        onCaretChange={onCaretChange}
        onKeyDown={onKeyDown}
        onLanguageChange={onLanguageChange}
        onDismissBlockMenus={onDismissBlockMenus}
      />
    );
  }

  if (block.type === "table") {
    return <TableBlockView block={block} onChange={onTableChange} />;
  }

  return (
    <div
      className={`block block-${block.type}`}
      data-indent={Math.min(block.indent ?? 0, 3)}
      data-ord={block.type === "numberedList" ? ordinal ?? 1 : undefined}
    >
      {editable}
    </div>
  );
}

export default function BlockEditor({ content, noteKey, contentEpoch = 0, onChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => markdownToBlocks(content));
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
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  // Puntero a la última `refreshEditing`; `commit` la usa aunque se defina antes.
  const refreshEditingRef = useRef<() => void>(() => {});

  // El padre guarda el markdown en el store global de pestañas, lo que re-renderiza
  // media app (barra lateral, paneles…) en cada cambio. Escribir caracter a caracter
  // no debe pagar ese coste: difundimos el cambio con debounce y lo vaciamos de
  // inmediato ante cambios estructurales, al perder foco y al desmontar.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const emitTimer = useRef<number | undefined>(undefined);
  const emitPending = useRef(false);

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
    setBlocks(markdownToBlocks(content));
    setSlash(null);
    setMetaSuggest(null);
    setWikiSuggest(null);
    setBlockMenu(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey, contentEpoch]);

  useLayoutEffect(() => {
    if (focusReq.current) {
      const { id, pos, setText } = focusReq.current;
      const el = refs.current.get(id);
      if (el) {
        if (setText !== undefined) setBlockText(el, setText);
        placeBlockCaret(el, pos);
      }
      focusReq.current = null;
    }
  });

  const registerRef = useCallback((id: string, el: BlockInputEl | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);

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
      onChangeRef.current(blocksToMarkdown(blocksRef.current));
    }, 180);
  }, []);

  // Vacía cualquier cambio pendiente (al perder foco / desmontar).
  const flushEmit = useCallback(() => {
    if (emitTimer.current !== undefined) {
      window.clearTimeout(emitTimer.current);
      emitTimer.current = undefined;
    }
    if (!emitPending.current) return;
    emitPending.current = false;
    onChangeRef.current(blocksToMarkdown(blocksRef.current));
  }, []);

  useEffect(() => () => flushEmit(), [flushEmit]);

  // Cierra popovers del editor (menú bloque, /, sugerencias, selectores de lenguaje).
  const dismissBlockEditorMenus = useCallback(() => {
    setBlockMenu(null);
    setSlash(null);
    setMetaSuggest(null);
    setWikiSuggest(null);
    closeAllCodeLangPickers();
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
      setBlocks(next);
      emitNow(blocksToMarkdown(next));
      // Reevalúa el estado de edición tras el re-render/foco. Necesario porque
      // al eliminar un bloque enfocado el `blur` no llega al contenedor (el nodo
      // ya está desconectado), y `editing` se quedaría atascado en `true`.
      requestAnimationFrame(refreshEditingRef.current);
    },
    [emitNow],
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
    const next = blocks.map((b) => (b.id === blockId ? { ...b, text } : b));
    setBlocks(next);
    emitNow(blocksToMarkdown(next));
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
    const next = blocks.map((b) => (b.id === blockId ? { ...b, text: newText } : b));
    setBlocks(next);
    emitNow(blocksToMarkdown(next));
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
    const next = blocks.map((b) => (b.id === blockId ? { ...b, text: newText } : b));
    setBlocks(next);
    emitNow(blocksToMarkdown(next));
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

    if (sc.type === "divider") {
      const idx = blocks.findIndex((b) => b.id === id);
      const el = refs.current.get(id);
      if (el) setBlockText(el, "");
      const trailing = emptyBlock("paragraph");
      const next = blocks.map((b) =>
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
    const next = blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            type: sc.type,
            text: sc.rest,
            checked: sc.type === "taskItem" ? (sc.checked ?? false) : undefined,
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
    const text = readBlockText(el);
    const slashActive = detectSlashCommand(text, getBlockCaret(el)) !== null;

    // Detección "en caliente" de Markdown: solo en párrafos y sin menú "/".
    if (!slashActive) {
      const block = blocks.find((b) => b.id === id);
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
    const next = blocks.map((b) => (b.id === id ? { ...b, text } : b));
    setBlocks(next);
    // Tecleo normal: difundimos con debounce para no re-renderizar toda la app.
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

  const insertAfter = (id: string, type: BlockType) => {
    const idx = blocks.findIndex((b) => b.id === id);
    const current = blocks[idx];
    const indent = isIndentableBlockType(type) ? (current?.indent ?? 0) : 0;
    const nb = emptyBlock(type, indent);
    const next = [...blocks.slice(0, idx + 1), nb, ...blocks.slice(idx + 1)];
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
    const next = blocks.map((b) => {
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
    const idx = blocks.findIndex((b) => b.id === id);
    if (blocks.length === 1) return;
    const prev = blocks[idx - 1];
    const nextBlock = blocks[idx + 1];
    const next = blocks.filter((b) => b.id !== id);
    if (prev) focusReq.current = { id: prev.id, pos: "end" };
    else if (nextBlock) focusReq.current = { id: nextBlock.id, pos: "start" };
    commit(next);
  };

  const onToggleCheck = (id: string) => {
    const next = blocks.map((b) =>
      b.id === id ? { ...b, checked: !b.checked } : b,
    );
    commit(next);
  };

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

    if (e.key === "Tab") {
      if (isIndentableBlockType(block.type)) {
        e.preventDefault();
        adjustIndent(block.id, e.shiftKey ? -1 : 1);
      }
      return;
    }

    if (e.key === "Enter" && e.shiftKey) {
      if (block.type === "code" || block.type === "divider") return;
      if (supportsSoftNewline(block.type)) {
        e.preventDefault();
        insertAfter(block.id, "paragraph");
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
      if (supportsSoftNewline(block.type)) {
        e.preventDefault();
        const el = refs.current.get(block.id);
        if (!el) return;
        insertSoftNewline(block.id, el);
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
        const next = blocks.map((b) =>
          b.id === block.id
            ? { ...b, type: "paragraph" as BlockType, checked: undefined, indent: undefined }
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

    if ((e.key === "Backspace" || e.key === "Delete") && block.type === "image") {
      e.preventDefault();
      removeBlock(block.id);
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
          const next = blocks.map((b) =>
            b.id === block.id
              ? { ...b, type: "paragraph" as BlockType, checked: undefined, indent: undefined }
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

  // Numeración de listas ordenadas: misma fuente que la serialización, para que
  // los números mostrados y los del markdown coincidan.
  const numberOrdinals = useMemo(() => computeOrderedOrdinals(blocks), [blocks]);

  return (
    <div
      className="block-editor"
      ref={editorRef}
      onPaste={onPaste}
      onFocus={refreshEditing}
      onBlur={() => {
        flushEmit();
        // El foco aún no se ha movido durante el blur: reevalúa en el próximo frame.
        requestAnimationFrame(refreshEditing);
      }}
      onMouseOver={linkHover.onMouseOver}
      onMouseMove={linkHover.onMouseMove}
      onMouseOut={linkHover.onMouseOut}
    >
      {blocks.map((b, index) => {
        const isDragging = dragIndex === index;
        const isDropBefore =
          dropIndex === index && dragIndex !== null && dragIndex !== index;
        const isEmptyParagraph =
          b.type === "paragraph" && b.text === "" && b.id !== placeholderBlockId;
        return (
          <div
            key={b.id}
            className={`block-row block-row-${b.type} ${isDragging ? "dragging" : ""} ${isDropBefore ? "drag-over" : ""} ${isEmptyParagraph ? "block-row-empty" : ""}`}
            style={{ paddingLeft: (b.indent ?? 0) * 22 }}
            onContextMenuCapture={(e) => onBlockContextMenu(b.id, e)}
          >
            <span
              className="block-drag-handle"
              aria-label="Mover bloque o clic para menú del bloque"
              title="Arrastra para mover · clic para menú · clic derecho en el bloque"
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => onHandlePointerDown(index, e)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
            >
              ⠿
            </span>
            {canDelete && (
              <button
                type="button"
                className="block-delete-btn"
                aria-label="Eliminar bloque"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => removeBlock(b.id)}
              >
                <TrashIcon />
              </button>
            )}
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
            />
          </div>
        );
      })}

      {!editing && (
        <button
          type="button"
          className="block-add-trailing"
          aria-label="Añadir bloque"
          onMouseDown={(e) => e.preventDefault()}
          onClick={appendBlock}
        >
          <span className="block-add-trailing-plus">+</span>
          Añadir bloque
        </button>
      )}

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
                  <span className="bp-ico">{t.icon}</span>
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
              <span className="bp-ico">+</span>
              <span className="bp-label">Insertar bloque debajo</span>
            </div>
            {canDelete && (
              <div
                className="block-picker-item danger"
                onMouseDown={(e) => {
                  e.preventDefault();
                  deleteBlockFromMenu(blockMenu.blockId);
                }}
              >
                <span className="bp-ico">🗑</span>
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
                      <span className="bp-ico">{t.icon}</span>
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
