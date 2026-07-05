import { useMemo, useState } from "react";
import { useNotesStore } from "../../stores/notesStore";
import { useTabsStore } from "../../stores/tabsStore";
import { selectActiveTabHighlight, activeTabHighlightEqual } from "../../stores/tabSelectors";
import { useVaultStore } from "../../stores/vaultStore";
import {
  openDailyNote,
  dailyNoteRelPath,
  isDailyNoteRel,
  sameRelPath,
} from "../../lib/dailyNotes";
import { normalizePath } from "../../lib/tauri";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

function startOffset(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export default function MiniCalendar() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const notes = useNotesStore((s) => s.notes);
  const activeTab = useTabsStore(
    (s) => selectActiveTabHighlight(s.tabs, s.activeTabId),
    activeTabHighlightEqual,
  );
  const dailyNotesFolder = useVaultStore((s) => s.config.dailyNotesFolder);
  const dailyNotesDateFormat = useVaultStore(
    (s) => s.config.dailyNotesDateFormat,
  );

  const openDailyRelPath = useMemo(() => {
    if (activeTab?.kind !== "note" || !activeTab.path) return null;
    const path = normalizePath(activeTab.path);
    const entry = notes.find((n) => n.path === path);
    if (!entry || !isDailyNoteRel(entry.rel_path, dailyNotesFolder)) return null;
    return entry.rel_path;
  }, [activeTab, notes, dailyNotesFolder]);

  // Conjunto de rel_paths que existen dentro de la carpeta de notas diarias.
  const dailyRelPaths = useMemo(() => {
    const prefix = `${dailyNotesFolder}/`;
    return new Set(
      notes
        .filter(
          (n) => n.folder === dailyNotesFolder || n.rel_path.startsWith(prefix),
        )
        .map((n) => n.rel_path),
    );
  }, [notes, dailyNotesFolder]);

  const relForDay = (day: number): string =>
    dailyNoteRelPath(
      dailyNotesFolder,
      dailyNotesDateFormat,
      new Date(viewYear, viewMonth, day),
    );

  const hasDailyNote = (day: number): boolean => dailyRelPaths.has(relForDay(day));

  const isOpenDailyDay = (day: number): boolean =>
    !!openDailyRelPath && sameRelPath(relForDay(day), openDailyRelPath);

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const goToday = () => {
    setViewMonth(today.getMonth());
    setViewYear(today.getFullYear());
  };

  const isToday = (day: number) =>
    day === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  const offset = startOffset(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array<number | null>(offset).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="mini-cal">
      <div className="mini-cal-nav">
        <button
          type="button"
          className="dp-nav-btn"
          onClick={() => shiftMonth(-1)}
          aria-label="Mes anterior"
        >
          ‹
        </button>
        <button
          type="button"
          className="mini-cal-title"
          onClick={goToday}
          title="Ir a hoy"
        >
          {MONTHS[viewMonth]} {viewYear}
        </button>
        <button
          type="button"
          className="dp-nav-btn"
          onClick={() => shiftMonth(1)}
          aria-label="Mes siguiente"
        >
          ›
        </button>
      </div>

      <div className="mini-cal-grid">
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
              className={[
                "date-picker-day",
                "mini-cal-day",
                isToday(day) ? "today" : "",
                hasDailyNote(day) ? "has-note" : "",
                isOpenDailyDay(day) ? "open-daily" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() =>
                void openDailyNote(new Date(viewYear, viewMonth, day))
              }
              title={relForDay(day)}
            >
              {day}
              {(hasDailyNote(day) || isToday(day)) && (
                <span className={`day-dot${isToday(day) ? " day-dot-today" : ""}`} />
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
