import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTasksStore } from "../../stores/tasksStore";
import type { Task } from "../../lib/tauri";

const STATUS_OPTIONS: {
  value: Task["status"];
  label: string;
  dot: string;
}[] = [
  { value: "todo", label: "Pendiente", dot: "soon" },
  { value: "doing", label: "En progreso", dot: "today" },
  { value: "done", label: "Hecho", dot: "done" },
];

interface Props {
  task: Task;
  round?: boolean;
}

export default function TaskStatusControl({ task, round = false }: Props) {
  const moveTo = useTasksStore((s) => s.moveTo);
  const toggle = useTasksStore((s) => s.toggle);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const statusClass =
    task.done || task.status === "done"
      ? "checked"
      : task.status === "doing"
        ? "doing"
        : "";

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (round) {
      if (task.status === "done") await moveTo(task, "todo");
      else await moveTo(task, "done");
    } else {
      await toggle(task);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const pickStatus = async (status: Task["status"]) => {
    setMenu(null);
    if (task.status !== status) await moveTo(task, status);
  };

  const menuPos = menu
    ? {
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 160),
      }
    : null;

  return (
    <>
      <span
        className={`cb task-status${round ? " round" : ""} ${statusClass}`}
        role="button"
        tabIndex={0}
        title="Clic: completar · Clic derecho: cambiar estado"
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void onClick(e as unknown as React.MouseEvent);
          }
        }}
      />

      {menu &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="ctx-menu task-status-menu"
            style={menuPos}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div className="ctx-header">Estado</div>
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`ctx-item${task.status === opt.value ? " active" : ""}`}
                onClick={() => pickStatus(opt.value)}
              >
                <span className={`tg-dot ${opt.dot}`} />
                {opt.label}
                {task.status === opt.value && <span className="ctx-check">✓</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
