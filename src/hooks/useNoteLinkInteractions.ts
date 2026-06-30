import { useCallback, useRef } from "react";
import { useNotesStore } from "../stores/notesStore";
import { useHoverPreviewStore } from "../stores/hoverPreviewStore";
import { relPathFromLinkEl, isNoteLinkEl, NOTE_LINK_SELECTOR } from "../lib/noteLinkDom";

export function useNoteLinkInteractions(sourceRelPath = "") {
  const notes = useNotesStore((s) => s.notes);
  const requestShow = useHoverPreviewStore((s) => s.requestShow);
  const requestHide = useHoverPreviewStore((s) => s.requestHide);
  const refreshAnchor = useHoverPreviewStore((s) => s.refreshAnchor);
  const hoverLinkRef = useRef<HTMLElement | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });

  const onMouseOver = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const target = e.target as HTMLElement;
      const link = target.closest<HTMLElement>(NOTE_LINK_SELECTOR);
      if (!link) return;

      const showing = useHoverPreviewStore.getState().relPath;
      if (link !== hoverLinkRef.current || !showing) {
        hoverLinkRef.current = link;
        const rel = relPathFromLinkEl(link, notes, sourceRelPath);
        if (rel) requestShow(rel, link, pointerRef.current);
        return;
      }

      refreshAnchor(pointerRef.current);
    },
    [notes, sourceRelPath, requestShow, refreshAnchor],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      if (!hoverLinkRef.current) return;
      refreshAnchor(pointerRef.current);
    },
    [refreshAnchor],
  );

  const onMouseOut = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      const related = e.relatedTarget as Node | null;
      const link = hoverLinkRef.current;
      if (!link) return;
      if (related && link.contains(related)) return;
      if (related instanceof HTMLElement && related.closest(".note-hover-preview")) {
        return;
      }
      hoverLinkRef.current = null;
      requestHide();
    },
    [requestHide],
  );

  const onMouseLeave = useCallback(() => {
    hoverLinkRef.current = null;
    requestHide();
  }, [requestHide]);

  return { onMouseOver, onMouseMove, onMouseOut, onMouseLeave };
}

export function interceptPreviewLinkMouseDown(
  e: React.MouseEvent<HTMLElement>,
  notes: ReturnType<typeof useNotesStore.getState>["notes"],
  sourceRelPath: string,
  openByRelPath: (rel: string) => void,
): void {
  const anchor = (e.target as HTMLElement).closest("a");
  if (!anchor || !isNoteLinkEl(anchor)) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const rel = relPathFromLinkEl(anchor, notes, sourceRelPath);
  if (!rel) return;
  e.preventDefault();
  e.stopPropagation();
  void openByRelPath(rel);
}
