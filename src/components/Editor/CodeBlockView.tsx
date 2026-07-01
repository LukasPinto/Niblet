import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Block } from "../../lib/blockParser";
import type { BlockInputEl } from "../../lib/blockInput";
import {
  attachCmView,
  buildCodeBlockExtensions,
  createCodeLanguageCompartment,
  detachCmView,
  loadCodeLanguageExtension,
} from "../../lib/codeMirrorBlock";
import { normalizeCodeLanguageId } from "../../lib/codeLanguages";
import CodeLanguagePicker from "./CodeLanguagePicker";

interface Props {
  block: Block;
  registerRef: (id: string, el: BlockInputEl | null) => void;
  onInput: (id: string, el: BlockInputEl) => void;
  onCaretChange: (id: string, el: BlockInputEl) => void;
  onKeyDown: (e: React.KeyboardEvent, block: Block) => void;
  onLanguageChange: (id: string, language: string) => void;
  onDismissBlockMenus: () => void;
}

/**
 * Bloque de código con CodeMirror 6: cursor y resaltado comparten el mismo
 * motor (evita el bug de capas superpuestas). Misma stack que MarkdownEditor.
 */
export default function CodeBlockView({
  block,
  registerRef,
  onInput,
  onCaretChange,
  onKeyDown,
  onLanguageChange,
  onDismissBlockMenus,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(createCodeLanguageCompartment());
  const focusedRef = useRef(false);
  const blockRef = useRef(block);
  blockRef.current = block;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let alive = true;
    const languageCompartment = languageCompartmentRef.current;

    void (async () => {
      const langExt = await loadCodeLanguageExtension(blockRef.current.language);
      if (!alive || !hostRef.current) return;

      const notifyInput = (view: EditorView) => {
        if (hostRef.current) onInput(blockRef.current.id, hostRef.current);
        void view;
      };
      const notifyCaret = (view: EditorView) => {
        if (hostRef.current) onCaretChange(blockRef.current.id, hostRef.current);
        void view;
      };

      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: blockRef.current.text,
          extensions: buildCodeBlockExtensions(
            languageCompartment,
            langExt,
            {
              onDocChange: notifyInput,
              onCaretChange: notifyCaret,
              onKeyDown: (event) => {
                onKeyDown(
                  event as unknown as React.KeyboardEvent,
                  blockRef.current,
                );
              },
            },
          ),
        }),
      });

      viewRef.current = view;
      attachCmView(host, view);
      registerRef(blockRef.current.id, host);
      view.dom.style.height = `${view.contentHeight}px`;
    })();

    return () => {
      alive = false;
      registerRef(blockRef.current.id, null);
      viewRef.current?.destroy();
      viewRef.current = null;
      if (hostRef.current) detachCmView(hostRef.current);
    };
    // Solo recrear al cambiar de bloque (id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || focusedRef.current) return;
    const cur = view.state.doc.toString();
    if (cur !== block.text) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: block.text },
      });
    }
  }, [block.text]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let cancelled = false;
    void loadCodeLanguageExtension(block.language).then((ext) => {
      if (cancelled || !viewRef.current) return;
      viewRef.current.dispatch({
        effects: languageCompartmentRef.current.reconfigure(ext),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [block.language]);

  return (
    <div className="block block-code">
      <CodeLanguagePicker
        blockId={block.id}
        value={normalizeCodeLanguageId(block.language ?? "")}
        onChange={(language) => onLanguageChange(block.id, language)}
        onDismissBlockMenus={onDismissBlockMenus}
      />
      <div
        className="code-cm-host"
        ref={hostRef}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
        }}
      />
    </div>
  );
}
