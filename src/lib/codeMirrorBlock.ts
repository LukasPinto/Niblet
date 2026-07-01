import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { BlockInputEl } from "./blockInput";
import { resolveCodeLanguageDescription } from "./codeLanguages";

export type CmHostElement = HTMLDivElement & { __cmView?: EditorView };

export function getCmView(el: BlockInputEl | null | undefined): EditorView | null {
  if (!el || !(el instanceof HTMLDivElement)) return null;
  return (el as CmHostElement).__cmView ?? null;
}

export function attachCmView(host: HTMLDivElement, view: EditorView): void {
  (host as CmHostElement).__cmView = view;
}

export function detachCmView(host: HTMLDivElement): void {
  delete (host as CmHostElement).__cmView;
}

export async function loadCodeLanguageExtension(
  language: string | undefined,
): Promise<Extension[]> {
  const desc = resolveCodeLanguageDescription(language);
  if (!desc) return [];
  try {
    const support = await desc.load();
    const ext = support.extension;
    return Array.isArray(ext) ? ext : [ext];
  } catch {
    return [];
  }
}

/** Colores vía clases CSS (variables del tema); más fiable que var() en StyleMod. */
export const nibletCodeHighlightStyle = HighlightStyle.define([
  { tag: t.comment, class: "cm-hl-comment" },
  { tag: [t.string, t.special(t.string)], class: "cm-hl-string" },
  { tag: t.number, class: "cm-hl-number" },
  { tag: t.bool, class: "cm-hl-number" },
  { tag: t.null, class: "cm-hl-comment" },
  { tag: t.keyword, class: "cm-hl-keyword" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "cm-hl-fn" },
  { tag: [t.typeName, t.className], class: "cm-hl-type" },
  { tag: t.variableName, class: "cm-hl-name" },
  { tag: t.propertyName, class: "cm-hl-name" },
  { tag: t.operator, class: "cm-hl-punct" },
  { tag: t.punctuation, class: "cm-hl-punct" },
  { tag: t.tagName, class: "cm-hl-keyword" },
  { tag: t.attributeName, class: "cm-hl-type" },
  { tag: t.meta, class: "cm-hl-comment" },
]);

/** Altura automática según contenido (bloques embebidos, no editor completo). */
const autoHeight = EditorView.updateListener.of((update) => {
  if (update.geometryChanged) {
    update.view.dom.style.height = `${update.view.contentHeight}px`;
  }
});

export function createCodeLanguageCompartment(): Compartment {
  return new Compartment();
}

export function buildCodeBlockExtensions(
  languageCompartment: Compartment,
  languageExts: Extension[],
  handlers: {
    onDocChange: (view: EditorView) => void;
    onCaretChange: (view: EditorView) => void;
    onKeyDown: (event: KeyboardEvent) => void;
  },
): Extension[] {
  return [
    EditorView.lineWrapping,
    history(),
    languageCompartment.of(languageExts),
    syntaxHighlighting(nibletCodeHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.theme({
      "&": { backgroundColor: "transparent" },
      ".cm-content": { caretColor: "var(--text)" },
      "&.cm-focused": { outline: "none" },
    }),
    autoHeight,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.onDocChange(update.view);
      if (update.selectionSet) handlers.onCaretChange(update.view);
    }),
    EditorView.domEventHandlers({
      keydown: (event) => {
        handlers.onKeyDown(event);
        return event.defaultPrevented;
      },
      click: (_event, view) => {
        handlers.onCaretChange(view);
        return false;
      },
    }),
  ];
}
