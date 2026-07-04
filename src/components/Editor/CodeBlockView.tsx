import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
import { peekHighlightedCode } from "../../lib/codeStaticHighlight";
import CodeLanguagePicker from "./CodeLanguagePicker";

interface Props {
  block: Block;
  editorActive: boolean;
  registerRef: (id: string, el: BlockInputEl | null) => void;
  onInput: (id: string, el: BlockInputEl) => void;
  onCaretChange: (id: string, el: BlockInputEl) => void;
  onKeyDown: (e: React.KeyboardEvent, block: Block) => void;
  onLanguageChange: (id: string, language: string) => void;
  onDismissBlockMenus: () => void;
}

/**
 * Bloque de código con CodeMirror 6. CodeMirror solo se monta cuando el bloque
 * entra en viewport (o al hacer foco), con un `<pre>` estático mientras tanto.
 */
export default function CodeBlockView({
  block,
  editorActive,
  registerRef,
  onInput,
  onCaretChange,
  onKeyDown,
  onLanguageChange,
  onDismissBlockMenus,
}: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartmentRef = useRef(createCodeLanguageCompartment());
  const focusedRef = useRef(false);
  const blockRef = useRef(block);
  blockRef.current = block;

  const [shouldInit, setShouldInit] = useState(false);
  const [cmReady, setCmReady] = useState(false);

  useEffect(() => {
    if (!editorActive) return;
    const el = shellRef.current;
    if (!el) return;

    if (shouldInit) return;

    const rect = el.getBoundingClientRect();
    const inView = rect.bottom >= -200 && rect.top <= window.innerHeight + 200;
    if (inView) {
      setShouldInit(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldInit(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [editorActive, shouldInit, block.id]);

  useEffect(() => {
    if (!editorActive || !shouldInit) return;
    const host = hostRef.current;
    if (!host) return;

    let alive = true;
    const languageCompartment = languageCompartmentRef.current;

    const init = () => {
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
        // Altura inicial: la del <pre> estático aún montado (la altura real).
        // `view.contentHeight` antes de la primera medición es una estimación
        // con métricas por defecto y descuadraba el layout durante un frame.
        const preH = preRef.current?.offsetHeight ?? 0;
        view.dom.style.height = `${preH > 0 ? preH : view.contentHeight}px`;
        // Intercambio atómico pre→editor: flushSync desmonta el respaldo y
        // muestra el host en el mismo commit (sin frame con ambos visibles, que
        // duplicaba la altura y hacía saltar el resto de la nota). Debe ocurrir
        // ANTES de registrar la ref: registerRef cumple el focusReq pendiente y
        // focus() dentro de un subárbol hidden es un no-op (el doble click).
        flushSync(() => setCmReady(true));
        registerRef(blockRef.current.id, host);
      })();
    };

    // Monta CodeMirror ya: este componente solo se renderiza cuando el bloque
    // está en edición (el estático usa <CodeBlockStatic>), así que diferirlo con
    // requestIdleCallback solo retrasaba el foco y hacía falta un segundo click.
    init();

    return () => {
      alive = false;
      setCmReady(false);
      registerRef(blockRef.current.id, null);
      viewRef.current?.destroy();
      viewRef.current = null;
      if (hostRef.current) detachCmView(hostRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, editorActive, shouldInit]);

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

  const requestInit = () => {
    if (!shouldInit) setShouldInit(true);
  };

  // Mientras CodeMirror monta, el <pre> de respaldo usa el mismo resaltado
  // cacheado que la vista estática (caliente: se calculó al mostrar el bloque).
  // Sin esto, el bloque parpadeaba a texto plano un frame al entrar en edición.
  const staticHtml = !cmReady ? peekHighlightedCode(block.text, block.language) : null;

  return (
    <div className="block block-code" ref={shellRef}>
      <CodeLanguagePicker
        blockId={block.id}
        value={normalizeCodeLanguageId(block.language ?? "")}
        text={block.text}
        onChange={(language) => onLanguageChange(block.id, language)}
        onDismissBlockMenus={onDismissBlockMenus}
      />
      {!cmReady && (
        <pre
          ref={preRef}
          className="code-block-static"
          tabIndex={0}
          onFocus={requestInit}
          onMouseDown={requestInit}
        >
          {staticHtml ? (
            <code dangerouslySetInnerHTML={{ __html: staticHtml }} />
          ) : (
            block.text || " "
          )}
        </pre>
      )}
      <div
        className="code-cm-host"
        ref={hostRef}
        hidden={!cmReady}
        onFocus={() => {
          focusedRef.current = true;
          requestInit();
        }}
        onBlur={() => {
          focusedRef.current = false;
        }}
      />
    </div>
  );
}
