import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { useHoverPreviewStore } from "../../stores/hoverPreviewStore";
import { buildNotePreview, type NotePreviewModel } from "../../lib/notePreview";
import { useNotesStore } from "../../stores/notesStore";
import { HOVER_CARD_WIDTH, useHoverCardPosition, estimateHoverCardPosition } from "../../hooks/useHoverCardPosition";

function fullPathLabel(relPath: string): string {
  return relPath
    .replace(/\.md$/i, "")
    .split("/")
    .filter(Boolean)
    .join(" / ");
}

/** Tarjeta flotante de vista previa al pasar el ratón sobre un enlace interno. */
export default function LinkHoverPreview() {
  const relPath = useHoverPreviewStore((s) => s.relPath);
  const anchorEl = useHoverPreviewStore((s) => s.anchorEl);
  const setOverCard = useHoverPreviewStore((s) => s.setOverCard);
  const dismiss = useHoverPreviewStore((s) => s.dismiss);
  const openByRelPath = useNotesStore((s) => s.openByRelPath);
  const registerCardEl = useHoverPreviewStore((s) => s.registerCardEl);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const bindCardRef = (el: HTMLDivElement | null) => {
    cardRef.current = el;
    registerCardEl(el);
  };

  const [preview, setPreview] = useState<NotePreviewModel | null>(null);
  const [loading, setLoading] = useState(false);

  const position =
    useHoverCardPosition(anchorEl, !!relPath, cardRef) ??
    (anchorEl ? estimateHoverCardPosition(anchorEl) : null);

  useEffect(() => {
    if (!relPath) {
      setPreview(null);
      return;
    }
    let alive = true;
    setLoading(true);
    void buildNotePreview(relPath).then((model) => {
      if (!alive) return;
      setPreview(model);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [relPath]);

  if (!relPath || !anchorEl || !position) return null;

  const title =
    preview?.name ??
    relPath.split("/").pop()?.replace(/\.md$/i, "") ??
    "…";
  const pathLabel = fullPathLabel(relPath);

  return createPortal(
    <div
      ref={bindCardRef}
      className="note-hover-preview"
      style={{
        left: position.left,
        top: position.top,
        width: HOVER_CARD_WIDTH,
        maxHeight: position.maxHeight,
        visibility: position ? "visible" : "hidden",
      }}
      onMouseEnter={() => setOverCard(true)}
      onMouseLeave={() => setOverCard(false)}
    >
      <div className="note-hover-preview-top">
        <div className="note-hover-preview-headrow">
          <span className="note-hover-preview-ico" aria-hidden="true">
            <FileText style={{ width: 16, height: 16 }} />
          </span>
          <div className="note-hover-preview-headtext">
            <div className="note-hover-preview-title">{title}</div>
            <div className="note-hover-preview-path">{pathLabel}</div>
          </div>
          <button
            type="button"
            className="note-hover-preview-open"
            title="Abrir nota"
            onClick={() => {
              dismiss();
              void openByRelPath(relPath);
            }}
          >
            ↗
          </button>
        </div>
      </div>

      <div className="note-hover-preview-body md-preview">
        {loading && !preview && <p className="note-hover-preview-loading">Cargando…</p>}
        {preview && (
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        )}
      </div>

      <div className="note-hover-preview-foot">
        <span className="note-hover-preview-foot-pill">
          <span className="note-hover-preview-foot-ico" aria-hidden="true">
            ↗
          </span>
          {title}
        </span>
      </div>
    </div>,
    document.body,
  );
}
