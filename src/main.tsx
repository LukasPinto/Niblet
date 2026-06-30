import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/layout.css";
import "highlight.js/styles/github-dark.css";

// Errores no capturados → mostrarlos en pantalla en vez de dejar todo en negro.
function showFatal(msg: string) {
  const root = document.getElementById("root");
  if (root && !root.dataset.fatal) {
    root.dataset.fatal = "1";
    root.innerHTML = `<div style="padding:24px;font-family:monospace;color:#e8e8e8;background:#191919;height:100vh;overflow:auto;white-space:pre-wrap"><h2 style="color:#e05c5c">Error al arrancar Niblet</h2><p>${msg}</p></div>`;
  }
}
window.addEventListener("error", (e) => showFatal(e.message));
window.addEventListener("unhandledrejection", (e) =>
  showFatal(String((e as PromiseRejectionEvent).reason)),
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
