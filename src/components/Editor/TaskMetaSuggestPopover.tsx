import { useLayoutEffect, useRef } from "react";
import TaskDatePicker from "../TasksPanel/TaskDatePicker";
import TaskPriorityPicker from "../TasksPanel/TaskPriorityPicker";
import type { MetaSuggestKind } from "../../lib/taskMetaSuggest";

interface Props {
  kind: MetaSuggestKind;
  left: number;
  top: number;
  partial: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export default function TaskMetaSuggestPopover({
  kind,
  left,
  top,
  partial,
  onSelect,
  onClose,
}: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const popover = anchor.querySelector(".task-popover") as HTMLElement | null;
    if (!popover) return;

    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { width, height } = popover.getBoundingClientRect();

    let x = left;
    let y = top;

    if (x + width > vw - margin) x = Math.max(margin, vw - width - margin);
    if (x < margin) x = margin;

    if (y + height > vh - margin) {
      y = Math.max(margin, top - height - margin);
    }
    if (y < margin) y = margin;

    anchor.style.left = `${x}px`;
    anchor.style.top = `${y}px`;
  }, [left, top, kind, partial]);

  return (
    <div
      ref={anchorRef}
      className="task-meta-suggest-anchor"
      style={{ left, top }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {kind === "due-date" ? (
        <TaskDatePicker
          embedded
          initialDate={partial || null}
          onSelect={(d) => {
            if (d) onSelect(d);
            else onClose();
          }}
          onClose={onClose}
        />
      ) : (
        <TaskPriorityPicker
          embedded
          initialPriority={partial || null}
          onSelect={(p) => {
            if (p) onSelect(p);
            else onClose();
          }}
          onClose={onClose}
        />
      )}
    </div>
  );
}
