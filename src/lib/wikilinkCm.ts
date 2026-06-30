import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";

const wikilinkMark = Decoration.mark({ class: "cm-wikilink" });
const wikilinkOpenMark = Decoration.mark({ class: "cm-wikilink-open" });

const COMPLETE_RE = /\[\[([^\]|#]+?)(?:\|([^\]]+?))?\]\]/g;

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const slice = view.state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    const complete = new RegExp(COMPLETE_RE.source, "g");
    while ((match = complete.exec(slice)) !== null) {
      const start = from + match.index;
      ranges.push(wikilinkMark.range(start, start + match[0].length));
    }
    let lineStart = from;
    while (lineStart <= to) {
      const line = view.state.doc.lineAt(lineStart);
      if (line.from > to) break;
      const open = line.text.match(/\[\[[^\]]*$/);
      if (open && open.index != null) {
        const start = line.from + open.index;
        const end = line.from + line.text.length;
        if (end > from && start < to) {
          ranges.push(wikilinkOpenMark.range(start, Math.min(end, to)));
        }
      }
      lineStart = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

export function wikilinkHighlightPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
