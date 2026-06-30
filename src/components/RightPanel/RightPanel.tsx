import { useUiStore } from "../../stores/uiStore";
import MiniCalendar from "./MiniCalendar";
import NoteTasksPanel from "./NoteTasksPanel";
import NoteBacklinksPanel from "./NoteBacklinksPanel";

export default function RightPanel() {
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUiStore((s) => s.toggleRightPanel);

  return (
    <aside className={`right-panel${rightPanelOpen ? " open" : ""}`}>
      <button
        type="button"
        className="right-panel-toggle"
        onClick={() => toggleRightPanel()}
        title={rightPanelOpen ? "Ocultar panel" : "Mostrar panel"}
        aria-label={rightPanelOpen ? "Ocultar panel derecho" : "Mostrar panel derecho"}
        aria-expanded={rightPanelOpen}
      >
        {rightPanelOpen ? "›" : "‹"}
      </button>
      {rightPanelOpen && (
        <div className="right-panel-content">
          <div className="right-panel-block">
            <div className="right-panel-section-title">Calendario</div>
            <MiniCalendar />
          </div>
          <NoteTasksPanel />
          <NoteBacklinksPanel />
        </div>
      )}
    </aside>
  );
}
