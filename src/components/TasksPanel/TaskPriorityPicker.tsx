import { useEffect, useRef, useState } from "react";
import { Flag } from "lucide-react";

const PRESETS = [
  { value: "high", label: "Alta", className: "prio-high" },
  { value: "medium", label: "Media", className: "prio-medium" },
  { value: "low", label: "Baja", className: "prio-low" },
] as const;

interface Props {
  initialPriority: string | null;
  onSelect: (priority: string | null) => void;
  onClose: () => void;
  embedded?: boolean;
}

export default function TaskPriorityPicker({ initialPriority, onSelect, onClose, embedded }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [manual, setManual] = useState(initialPriority ?? "");

  const pick = (value: string) => {
    onSelect(value);
    onClose();
  };

  useEffect(() => {
    const confirmCurrent = () => {
      const value = manual.trim() || initialPriority || "high";
      pick(value);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        if (target?.closest(".priority-manual input")) return;
        e.preventDefault();
        e.stopPropagation();
        confirmCurrent();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onClick);
    };
  }, [manual, initialPriority, onClose, onSelect]);

  return (
    <div
      className={`task-popover priority-picker${embedded ? " embedded" : ""}`}
      ref={ref}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="priority-options">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`priority-option ${p.className}${initialPriority === p.value ? " active" : ""}`}
            onClick={() => pick(p.value)}
          >
            <span className="priority-option-icon"><Flag style={{ width: 14, height: 14 }} /></span>
            {p.label}
          </button>
        ))}
      </div>

      <div className="priority-manual">
        <input
          type="text"
          placeholder="Valor personalizado…"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manual.trim()) {
              pick(manual.trim());
            }
          }}
        />
        <button
          type="button"
          className="priority-manual-btn"
          disabled={!manual.trim()}
          onClick={() => pick(manual.trim())}
        >
          Aplicar
        </button>
      </div>

      <div className="picker-footer">
        <button
          type="button"
          className="picker-remove"
          onClick={() => {
            onSelect(null);
            onClose();
          }}
        >
          Quitar prioridad
        </button>
      </div>
    </div>
  );
}
