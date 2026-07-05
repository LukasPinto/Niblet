import { useCallback, useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { detectMetaSuggest } from "../../lib/taskMetaSuggest";
import {
  detectWikilinkSuggest,
  filterNotesForWikilink,
} from "../../lib/wikilinkSuggest";
import {
  findMarkdownLinkTargetAt,
  findWikilinkTargetAt,
} from "../../lib/wikilinkDisplay";
import { buildNoteIndex, resolveNoteTarget } from "../../lib/linkParser";
import { wikilinkHighlightPlugin } from "../../lib/wikilinkCm";
import TaskMetaSuggestPopover from "./TaskMetaSuggestPopover";
import WikilinkSuggestPopover from "./WikilinkSuggestPopover";
import { useVaultStore } from "../../stores/vaultStore";
import { useNotesStore } from "../../stores/notesStore";
import { useSyncStore } from "../../stores/syncStore";
import { saveImage, savePastedImage, saveClipboardImage } from "../../lib/tauri";
import { filenameForDroppedImage, mimeToExt } from "../../lib/imageNames";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  noteRelPath?: string;
  /** false cuando la vista Markdown está oculta (modo Bloques/Vista). */
  visible?: boolean;
}

/** Inserta texto en la posición actual del cursor. */
function insertAtCursor(view: EditorView, text: string) {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
  view.focus();
}

interface SuggestState {
  kind: "due-date" | "prior";
  left: number;
  top: number;
  valueStart: number;
  replaceEnd: number;
  partial: string;
}

interface WikiSuggestState {
  left: number;
  top: number;
  valueStart: number;
  replaceEnd: number;
  partial: string;
  index: number;
}

export default function MarkdownEditor({
  value,
  onChange,
  onSave,
  noteRelPath = "",
  visible = true,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  // Emit con debounce: publicar cada tecla al store re-renderiza sidebar,
  // paneles y pestañas en cadena. Se acumula aquí y se difunde tras una pausa
  // (o al perder foco / guardar / desmontar), igual que hace BlockEditor.
  const emitTimerRef = useRef<number | undefined>(undefined);
  const emitPendingRef = useRef(false);
  /** Último contenido intercambiado con el padre (en cualquier dirección). */
  const lastSyncedRef = useRef(value);

  const flushPendingEmit = useCallback(() => {
    if (emitTimerRef.current !== undefined) {
      window.clearTimeout(emitTimerRef.current);
      emitTimerRef.current = undefined;
    }
    if (!emitPendingRef.current) return;
    emitPendingRef.current = false;
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    lastSyncedRef.current = doc;
    onChangeRef.current(doc);
  }, []);

  const scheduleEmit = useCallback(() => {
    emitPendingRef.current = true;
    if (emitTimerRef.current !== undefined) window.clearTimeout(emitTimerRef.current);
    emitTimerRef.current = window.setTimeout(flushPendingEmit, 160);
  }, [flushPendingEmit]);

  const vaultPath = useVaultStore((s) => s.vaultPath);
  const notes = useNotesStore((s) => s.notes);
  const openByRelPath = useNotesStore((s) => s.openByRelPath);
  const refreshImages = useNotesStore((s) => s.refreshImages);
  const notesRef = useRef(notes);
  const openByRelPathRef = useRef(openByRelPath);
  const noteRelPathRef = useRef(noteRelPath);
  notesRef.current = notes;
  openByRelPathRef.current = openByRelPath;
  noteRelPathRef.current = noteRelPath;
  const vaultRef = useRef(vaultPath);
  vaultRef.current = vaultPath;
  const refreshImagesRef = useRef(refreshImages);
  refreshImagesRef.current = refreshImages;

  const [suggest, setSuggest] = useState<SuggestState | null>(null);
  const [wikiSuggest, setWikiSuggest] = useState<WikiSuggestState | null>(null);
  const suggestRef = useRef<SuggestState | null>(null);
  const wikiSuggestRef = useRef<WikiSuggestState | null>(null);
  suggestRef.current = suggest;
  wikiSuggestRef.current = wikiSuggest;

  const handleImageBlob = async (
    view: EditorView,
    file: File,
    source: "paste" | "drop" = "paste",
  ) => {
    const vault = vaultRef.current;
    if (!vault) return;
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const ext = mimeToExt(file.type);
    const savedName =
      source === "paste"
        ? await savePastedImage(vault, ext, bytes)
        : await saveImage(vault, filenameForDroppedImage(file), bytes);
    insertAtCursor(view, `![${savedName}](${savedName})\n`);
    await refreshImagesRef.current();
    useSyncStore.getState().scheduleSyncOnSave();
  };

  // Pega una imagen desde el portapapeles del SO (vía Rust). En Windows el
  // evento `paste` del DOM no entrega los bytes de capturas, así que esta es la
  // ruta fiable. Devuelve true si había una imagen y se insertó.
  const handleClipboardImage = async (view: EditorView): Promise<boolean> => {
    const vault = vaultRef.current;
    if (!vault) return false;
    try {
      const savedName = await saveClipboardImage(vault);
      insertAtCursor(view, `![${savedName}](${savedName})\n`);
      await refreshImagesRef.current();
      useSyncStore.getState().scheduleSyncOnSave();
      return true;
    } catch {
      return false;
    }
  };

  const updateSuggest = (view: EditorView) => {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const textBefore = line.text.slice(0, pos - line.from);

    const wikiTrigger = detectWikilinkSuggest(textBefore, textBefore.length);
    if (wikiTrigger) {
      const coords = view.coordsAtPos(pos);
      if (coords) {
        setWikiSuggest((prev) => ({
          left: coords.left,
          top: coords.bottom + 4,
          valueStart: line.from + wikiTrigger.valueStart,
          replaceEnd: pos,
          partial: wikiTrigger.partial,
          index:
            prev && prev.partial === wikiTrigger.partial
              ? prev.index
              : 0,
        }));
      }
      if (suggestRef.current) setSuggest(null);
      return;
    }
    if (wikiSuggestRef.current) setWikiSuggest(null);

    const trigger = detectMetaSuggest(textBefore, textBefore.length);

    if (!trigger) {
      if (suggestRef.current) setSuggest(null);
      return;
    }

    const coords = view.coordsAtPos(pos);
    if (!coords) return;

    setSuggest({
      kind: trigger.kind,
      left: coords.left,
      top: coords.bottom + 4,
      valueStart: line.from + trigger.valueStart,
      replaceEnd: line.from + trigger.replaceEnd,
      partial: trigger.partial,
    });
  };

  const applyWikiLink = (noteName: string) => {
    const view = viewRef.current;
    const w = wikiSuggestRef.current;
    if (!view || !w) return;

    view.dispatch({
      changes: {
        from: w.valueStart,
        to: w.replaceEnd,
        insert: `${noteName}]]`,
      },
      selection: { anchor: w.valueStart + noteName.length + 2 },
    });
    view.focus();
    setWikiSuggest(null);
  };

  const navigateAtPos = (view: EditorView, pos: number) => {
    const doc = view.state.doc.toString();
    const index = buildNoteIndex(notesRef.current);
    const wikiTarget = findWikilinkTargetAt(doc, pos);
    if (wikiTarget) {
      const rel = resolveNoteTarget(wikiTarget, "", index);
      if (rel) void openByRelPathRef.current(rel);
      return true;
    }
    const mdTarget = findMarkdownLinkTargetAt(doc, pos);
    if (mdTarget) {
      const rel = resolveNoteTarget(mdTarget, noteRelPathRef.current, index);
      if (rel) void openByRelPathRef.current(rel);
      return true;
    }
    return false;
  };

  const applySuggest = (insertValue: string) => {
    const view = viewRef.current;
    const s = suggestRef.current;
    if (!view || !s) return;

    view.dispatch({
      changes: { from: s.valueStart, to: s.replaceEnd, insert: insertValue },
      selection: { anchor: s.valueStart + insertValue.length },
    });
    view.focus();
    setSuggest(null);
  };

  useEffect(() => {
    if (!hostRef.current) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          flushPendingEmit();
          onSaveRef.current();
          return true;
        },
      },
    ]);

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          EditorView.lineWrapping,
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          wikilinkHighlightPlugin(),
          EditorView.theme({
            "&": { backgroundColor: "transparent" },
            ".cm-content": { caretColor: "var(--text)" },
            ".cm-cursor, .cm-dropCursor": {
              borderLeftColor: "var(--text)",
              borderLeftWidth: "2px",
            },
            "&.cm-focused": { outline: "none" },
          }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          saveKeymap,
          EditorView.domEventHandlers({
            focusout: (event, view) => {
              const related = event.relatedTarget as Node | null;
              if (related && view.dom.contains(related)) return false;
              flushPendingEmit();
              return false;
            },
            mousedown: (event, view) => {
              if (!(event.ctrlKey || event.metaKey)) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              if (!navigateAtPos(view, pos)) return false;
              event.preventDefault();
              return true;
            },
            paste: (event, view) => {
              const dt = event.clipboardData;
              const hasText = (dt?.getData("text/plain") ?? "") !== "";
              // Pegado de texto normal: comportamiento por defecto.
              if (hasText) return false;

              // 1) Intenta usar los bytes del propio evento (navegadores).
              const items = Array.from(dt?.items ?? []);
              const imageItem = items.find((i) => i.type.startsWith("image/"));
              const file = imageItem?.getAsFile();
              if (file) {
                event.preventDefault();
                void handleImageBlob(view, file, "paste");
                return true;
              }

              // 2) Fallback: lee la imagen del portapapeles del SO vía Rust
              //    (necesario en Windows/WebView2).
              event.preventDefault();
              void handleClipboardImage(view);
              return true;
            },
            drop: (event, view) => {
              const files = Array.from(event.dataTransfer?.files ?? []).filter(
                (f) => f.type.startsWith("image/"),
              );
              if (files.length === 0) return false;
              event.preventDefault();
              void (async () => {
                for (const file of files) await handleImageBlob(view, file, "drop");
              })();
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) scheduleEmit();
            if (u.docChanged || u.selectionSet) {
              updateSuggest(u.view);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    lastSyncedRef.current = value;
    return () => {
      flushPendingEmit();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al ocultar la vista Markdown, vaciar el emit pendiente (no sincronizar doc).
  useEffect(() => {
    if (visible) return;
    flushPendingEmit();
  }, [visible, flushPendingEmit]);

  // Sincronizar doc externo solo cuando el editor está visible.
  useEffect(() => {
    if (!visible) return;
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value || value === lastSyncedRef.current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
    lastSyncedRef.current = value;
  }, [value, visible]);

  useEffect(() => {
    if (!wikiSuggest) return;
    const onKey = (e: KeyboardEvent) => {
      const w = wikiSuggestRef.current;
      if (!w) return;
      const matches = filterNotesForWikilink(notes, w.partial);
      if (e.key === "Escape") {
        e.preventDefault();
        setWikiSuggest(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setWikiSuggest({
          ...w,
          index: Math.min(w.index + 1, Math.max(0, matches.length - 1)),
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setWikiSuggest({ ...w, index: Math.max(w.index - 1, 0) });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const chosen = matches[w.index];
        if (chosen) applyWikiLink(chosen.name);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [wikiSuggest, notes]);

  return (
    <div className="editor-wrap-host">
      <div className="editor-wrap" ref={hostRef} />
      {wikiSuggest && (
        <WikilinkSuggestPopover
          left={wikiSuggest.left}
          top={wikiSuggest.top}
          notes={notes}
          query={wikiSuggest.partial}
          selectedIndex={wikiSuggest.index}
          onSelect={(note) => applyWikiLink(note.name)}
          onHoverIndex={(index) =>
            setWikiSuggest((w) => (w ? { ...w, index } : w))
          }
          onClose={() => setWikiSuggest(null)}
        />
      )}
      {suggest && (
        <TaskMetaSuggestPopover
          kind={suggest.kind}
          left={suggest.left}
          top={suggest.top}
          partial={suggest.partial}
          onSelect={applySuggest}
          onClose={() => setSuggest(null)}
        />
      )}
    </div>
  );
}
