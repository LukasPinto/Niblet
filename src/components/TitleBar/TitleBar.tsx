import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

export default function TitleBar() {
  return (
    <>
      <div className="drag-region" data-tauri-drag-region />
      <div className="win-controls">
        <button
          className="wc-btn"
          onClick={() => void win.minimize()}
          aria-label="Minimizar"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
            <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="wc-btn"
          onClick={() => void win.toggleMaximize()}
          aria-label="Maximizar"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.6" y="0.6" width="8.8" height="8.8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="wc-btn wc-btn--close"
          onClick={() => void win.close()}
          aria-label="Cerrar"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </>
  );
}
