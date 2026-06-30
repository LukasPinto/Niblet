import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type Block,
  type BlockType,
  type MarkdownShortcut,
  type TableData,
  BLOCK_TYPES,
  markdownToBlocks,
  blocksToMarkdown,
  detectMarkdownShortcut,
  emptyBlock,
  emptyTable,
  newBlockId,
  isIndentableBlockType,
  MAX_BLOCK_INDENT,
} from "../../lib/blockParser";
import {
  detectMetaSuggest,
  getCaretOffset,
  getCaretClientRect,
  placeCaretAtOffset,
  type MetaSuggestTrigger,
} from "../../lib/taskMetaSuggest";
import TaskMetaSuggestPopover from "./TaskMetaSuggestPopover";
import WikilinkSuggestPopover from "./WikilinkSuggestPopover";
import CodeBlockView from "./CodeBlockView";
import TableBlockView from "./TableBlockView";
import { useVaultStore } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useSyncStore } from "../../stores/syncStore";
import { savePastedImage, saveClipboardImage, readImageBase64 } from "../../lib/tauri";
import {
  decorateWikilinksInPlainText,
  serializeEditableWithWikilinks,
  shouldDecorateWikilinks,
} from "../../lib/wikilinkDisplay";
import { buildNoteIndex, resolveNoteTarget } from "../../lib/linkParser";
import { useNoteLinkInteractions } from "../../hooks/useNoteLinkInteractions";
import { mimeToExt } from "../../lib/imageNames";
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
}

const DRAG_THRESHOLD = 5;
const SLASH_PLACEHOLDER = "Escribe o pulsa '/' para comandos…";

/** Solo el último párrafo vacío al final del documento muestra el placeholder "/". */
function slashPlaceholderBlockId(blocks: Block[]): string | null {
  if (blocks.length === 0) return null;
  const last = blocks[blocks.length - 1];
  if (last.type === "paragraph" && last.text === "") return last.id;
  return null;
}

function placeCaret(el: HTMLElement, pos: "start" | "end") {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(pos === "start");
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function mimeForExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "svg") return "image/svg+xml";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return `image/${e}`;
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

/** Render de una imagen dentro del editor de bloques (carga base64 vía Rust). */
function ImageBlockView({ src, alt }: { src: string; alt: string }) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const [data, setData] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    setData("");
    setFailed(false);
    const rel = decodeURI(src);
    readImageBase64(`${vaultPath}/${rel}`)
      .then((b64) => {
        if (alive) setData(`data:${mimeForExt(rel.split(".").pop() ?? "png")};base64,${b64}`);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [vaultPath, src]);

  if (failed) return <span className="block-image-missing">⚠ No se encontró: {src}</span>;
  if (!data) return <span className="block-image-loading muted">Cargando imagen…</span>;
  return <img className="block-image-img" src={data} alt={alt} draggable={false} />;
}

/** Una fila editable. Gestiona su propio texto en el DOM para no perder el cursor. */
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
  onWikilinkOpen,
  resolveWikiRel,
}: {
  block: Block;
  showSlashPlaceholder: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onInput: (id: string, el: HTMLDivElement) => void;
  onCaretChange: (id: string, el: HTMLDivElement) => void;
  onKeyDown: (e: React.KeyboardEvent, block: Block) => void;
  onToggleCheck: (id: string) => void;
  onLanguageChange: (id: string, language: string) => void;
  onTableChange: (id: string, table: TableData) => void;
  onWikilinkOpen: (title: string) => void;
  resolveWikiRel: (title: string) => string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef(false);

  const applyDecoration = (text: string) => {
    if (!ref.current || focusedRef.current) return;
    if (!shouldDecorateWikilinks(text, text.length)) return;
    ref.current.innerHTML = decorateWikilinksInPlainText(text, resolveWikiRel);
  };

  useEffect(() => {
    if (block.type === "image" || block.type === "divider" || block.type === "table") return;
    if (ref.current && !focusedRef.current) {
      applyDecoration(block.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.text, block.type]);

  useEffect(() => {
    if (block.type === "image" || block.type === "divider" || block.type === "table") return;
    if (ref.current && !focusedRef.current) {
      applyDecoration(block.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEditableMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>(".block-wikilink");
    if (!pill?.dataset.wiki) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 0) onWikilinkOpen(pill.dataset.wiki);
  };

  const handleEditableClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>(".block-wikilink");
    if (pill?.dataset.wiki) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onCaretChange(block.id, e.currentTarget);
  };

  const handleFocus = (el: HTMLDivElement) => {
    focusedRef.current = true;
    const text = serializeEditableWithWikilinks(el);
    if (el.textContent !== text) el.textContent = text;
    onCaretChange(block.id, el);
  };

  const handleBlur = (el: HTMLDivElement) => {
    focusedRef.current = false;
    const text = serializeEditableWithWikilinks(el);
    applyDecoration(text);
  };

  const setRef = (el: HTMLDivElement | null) => {
    ref.current = el;
    registerRef(block.id, el);
  };

  if (block.type === "divider") {
    return (
      <div
        className="block block-divider"
        tabIndex={0}
        ref={setRef}
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
        ref={setRef}
        onKeyDown={(e) => onKeyDown(e, block)}
      >
        <ImageBlockView src={block.text} alt={block.alt ?? ""} />
      </div>
    );
  }

  const editable = (
    <div
      className={`block-edit be-${block.type}${showSlashPlaceholder ? "" : " no-ph"}`}
      contentEditable
      suppressContentEditableWarning
      ref={setRef}
      data-placeholder={showSlashPlaceholder ? SLASH_PLACEHOLDER : ""}
      onInput={(e) => onInput(block.id, e.currentTarget)}
      onKeyUp={(e) => onCaretChange(block.id, e.currentTarget)}
      onClick={handleEditableClick}
      onMouseDown={handleEditableMouseDown}
      onFocus={(e) => handleFocus(e.currentTarget)}
      onBlur={(e) => handleBlur(e.currentTarget)}
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
        onKeyDown={onKeyDown}
        onLanguageChange={onLanguageChange}
      />
    );
  }

  if (block.type === "table") {
    return <TableBlockView block={block} onChange={onTableChange} />;
  }

  return <div className={`block block-${block.type}`}>{editable}</div>;
}

export default function BlockEditor({ content, noteKey, contentEpoch = 0, onChange }: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => markdownToBlocks(content));
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [metaSuggest, setMetaSuggest] = useState<MetaSuggestState | null>(null);
  const [wikiSuggest, setWikiSuggest] = useState<WikiSuggestState | null>(null);
  const refs = useRef<Map<string, HTMLDivElement>>(new Map());
  const focusReq = useRef<FocusReq | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const dragSession = useRef<{ index: number; startX: number; startY: number; dragging: boolean } | null>(null);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey, contentEpoch]);

  useLayoutEffect(() => {
    if (focusReq.current) {
      const { id, pos } = focusReq.current;
      const el = refs.current.get(id);
      if (el) placeCaret(el, pos);
      focusReq.current = null;
    }
  });

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
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
      return { ...b, text: serializeEditableWithWikilinks(el) };
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

  const commit = useCallback(
    (next: Block[]) => {
      setBlocks(next);
      emitNow(blocksToMarkdown(next));
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

  const applyWikilinkSlash = (blockId: string) => {
    const el = refs.current.get(blockId);
    if (!el) return;
    el.textContent = "[[";
    placeCaretAtOffset(el, 2);
    setSlash(null);
    const next = blocks.map((b) => (b.id === blockId ? { ...b, text: "[[" } : b));
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
    const text = serializeEditableWithWikilinks(el);
    const newText = applyWikilinkSelection(text, wikiSuggest, noteName);
    el.textContent = newText;
    const caret = wikiSuggest.valueStart + noteName.length + 2;
    placeCaretAtOffset(el, caret);
    setWikiSuggest(null);
    const next = blocks.map((b) => (b.id === blockId ? { ...b, text: newText } : b));
    setBlocks(next);
    emitNow(blocksToMarkdown(next));
  };

  const updateWikiSuggest = (id: string, el: HTMLDivElement) => {
    const text = serializeEditableWithWikilinks(el);
    const cursor = getCaretOffset(el);
    const trigger = detectWikilinkSuggest(text, cursor);
    if (!trigger) {
      setWikiSuggest((prev) => (prev?.blockId === id ? null : prev));
      return;
    }
    const caret = getCaretClientRect(el);
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

  const applyType = (blockId: string, type: BlockType) => {
    const el = refs.current.get(blockId);
    if (el) el.textContent = "";
    const current = blocks.find((b) => b.id === blockId);
    const indent = isIndentableBlockType(type) ? (current?.indent ?? 0) : undefined;
    const next = blocks.map((b) => {
      if (b.id !== blockId) return b;
      if (type === "table") {
        return { ...emptyTable(), id: blockId };
      }
      return {
        ...b,
        type,
        text: "",
        checked: type === "taskItem" ? false : undefined,
        indent,
        table: undefined,
        language: undefined,
      };
    });
    setSlash(null);
    focusReq.current = { id: blockId, pos: "start" };
    commit(next);
  };

  const applyMetaValue = (blockId: string, trigger: MetaSuggestTrigger, value: string) => {
    const el = refs.current.get(blockId);
    if (!el) return;
    const text = serializeEditableWithWikilinks(el);
    const newText =
      text.slice(0, trigger.valueStart) + value + text.slice(trigger.replaceEnd);
    el.textContent = newText;
    placeCaretAtOffset(el, trigger.valueStart + value.length);
    setMetaSuggest(null);
    const next = blocks.map((b) => (b.id === blockId ? { ...b, text: newText } : b));
    setBlocks(next);
    emitNow(blocksToMarkdown(next));
  };

  const updateMetaSuggest = (id: string, el: HTMLDivElement) => {
    const text = serializeEditableWithWikilinks(el);
    const cursor = getCaretOffset(el);
    if (detectWikilinkSuggest(text, cursor)) {
      setMetaSuggest((prev) => (prev?.blockId === id ? null : prev));
      return;
    }
    const trigger = detectMetaSuggest(text, cursor);
    if (!trigger) {
      setMetaSuggest((prev) => (prev?.blockId === id ? null : prev));
      return;
    }
    const caret = getCaretClientRect(el);
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
      if (el) el.textContent = "";
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
    if (el) el.textContent = sc.rest;
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

  const onInput = (id: string, el: HTMLDivElement) => {
    const text = serializeEditableWithWikilinks(el);

    // Detección "en caliente" de Markdown: solo en párrafos y sin menú "/".
    if (!text.startsWith("/")) {
      const block = blocks.find((b) => b.id === id);
      if (block?.type === "paragraph") {
        const sc = detectMarkdownShortcut(text);
        if (sc) {
          applyMarkdownShortcut(id, sc);
          return;
        }
      }
    }

    if (text.startsWith("/")) {
      setSlash({ blockId: id, query: text.slice(1), index: 0 });
      setMetaSuggest(null);
      setWikiSuggest(null);
    } else if (slash && slash.blockId === id) {
      setSlash(null);
    }
    updateWikiSuggest(id, el);
    updateMetaSuggest(id, el);
    const next = blocks.map((b) => (b.id === id ? { ...b, text } : b));
    setBlocks(next);
    // Tecleo normal: difundimos con debounce para no re-renderizar toda la app.
    scheduleEmit();
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
      const next = blocks.map((b) =>
        b.id === id
          ? { ...b, language: language || undefined }
          : b,
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

  const onCaretChange = (id: string, el: HTMLDivElement) => {
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

    if (slash && slash.blockId === block.id) {
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

    if (e.key === "Enter" && !e.shiftKey) {
      if (block.type === "code") return;
      e.preventDefault();
      const el = refs.current.get(block.id);
      const text = el?.textContent ?? block.text;
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
      const text = el?.textContent ?? block.text;
      const sel = window.getSelection();
      const atStart = sel?.anchorOffset === 0 && sel?.focusOffset === 0;
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

  const slashEl = slash ? refs.current.get(slash.blockId) : null;
  const slashRect = slashEl?.getBoundingClientRect();
  const placeholderBlockId = slashPlaceholderBlockId(blocks);
  const canDelete = blocks.length > 1;

  return (
    <div
      className="block-editor"
      ref={editorRef}
      onPaste={onPaste}
      onBlur={flushEmit}
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
            className={`block-row ${isDragging ? "dragging" : ""} ${isDropBefore ? "drag-over" : ""} ${isEmptyParagraph ? "block-row-empty" : ""}`}
            style={{ paddingLeft: (b.indent ?? 0) * 16 }}
          >
            <div className="block-row-controls">
              <span
                className="block-drag-handle"
                aria-label="Mover bloque"
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
              onWikilinkOpen={openWikilink}
              resolveWikiRel={resolveWikiRel}
            />
          </div>
        );
      })}

      {slash && slashRect && filteredSlashEntries.length > 0 && (
        <div
          className="block-picker"
          style={{
            position: "fixed",
            left: slashRect.left,
            top: slashRect.bottom + 4,
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
