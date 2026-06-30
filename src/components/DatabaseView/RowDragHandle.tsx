import { useRef } from "react";

interface Props {
  onDragStart: () => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: () => void;
}

export function RowDragHandle({ onDragStart, onDragMove, onDragEnd }: Props) {
  const dragging = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    onDragStart();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onDragMove(e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    onDragEnd();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <span
      className="db-row-drag"
      title="Arrastrar para reordenar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      ⠿
    </span>
  );
}
