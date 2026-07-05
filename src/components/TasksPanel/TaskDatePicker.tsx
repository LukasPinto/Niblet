import { useEffect, useRef, useState } from "react";
import { parseDue, toIsoDate } from "../../lib/taskParser";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

function startOffset(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  return (day + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

interface Props {
  initialDate: string | null;
  onSelect: (date: string | null) => void;
  onClose: () => void;
  /** Sincroniza el texto del campo mientras se escribe (p. ej. editor de BD). */
  onInputChange?: (value: string) => void;
  /** En editor inline: sin posición absoluta; el padre fija coords. */
  embedded?: boolean;
}

export default function TaskDatePicker({
  initialDate,
  onSelect,
  onClose,
  onInputChange,
  embedded,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const parsed = parseDue(initialDate) ?? today;
  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());
  const [inputVal, setInputVal] = useState(initialDate ?? toIsoDate(today));

  useEffect(() => {
    const confirmCurrent = () => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const d = parseDue(inputVal) ?? now;
      onSelect(toIsoDate(d));
      onClose();
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
        if (target?.classList.contains("date-picker-input")) return;
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
  }, [inputVal, onClose, onSelect]);

  const selectDate = (d: Date) => {
    const iso = toIsoDate(d);
    setInputVal(iso);
    onSelect(iso);
    onClose();
  };

  const applyInput = () => {
    const d = parseDue(inputVal) ?? today;
    onSelect(toIsoDate(d));
    onClose();
  };

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const shortcut = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    selectDate(d);
  };

  const nextMonth = () => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 1);
    selectDate(d);
  };

  const offset = startOffset(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array<number | null>(offset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = (day: number) =>
    day === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  const isSelected = (day: number) => {
    const d = parseDue(inputVal);
    if (!d) return false;
    return (
      day === d.getDate() &&
      viewMonth === d.getMonth() &&
      viewYear === d.getFullYear()
    );
  };

  return (
    <div
      className={`task-popover date-picker${embedded ? " embedded" : ""}`}
      ref={ref}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        className="date-picker-input"
        type="text"
        value={inputVal}
        placeholder="YYYY-MM-DD"
        onChange={(e) => {
          setInputVal(e.target.value);
          onInputChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            applyInput();
          }
        }}
      />

      <div className="date-picker-nav">
        <button type="button" className="dp-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
          ‹
        </button>
        <span className="date-picker-title">
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button type="button" className="dp-nav-btn" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">
          ›
        </button>
      </div>

      <div className="date-picker-cal">
        {WEEKDAYS.map((d) => (
          <span key={d} className="date-picker-wd">{d}</span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`e-${i}`} className="date-picker-day empty" />
          ) : (
            <button
              key={day}
              type="button"
              className={`date-picker-day${isToday(day) ? " today" : ""}${isSelected(day) ? " selected" : ""}`}
              onClick={() => selectDate(new Date(viewYear, viewMonth, day))}
            >
              {day}
            </button>
          ),
        )}
      </div>

      <div className="date-picker-shortcuts">
        <button type="button" onClick={() => shortcut(0)}>Hoy</button>
        <button type="button" onClick={() => shortcut(1)}>Mañana</button>
        <button type="button" onClick={() => shortcut(7)}>Próxima semana</button>
        <button type="button" onClick={nextMonth}>Próximo mes</button>
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
          Quitar
        </button>
      </div>
    </div>
  );
}
