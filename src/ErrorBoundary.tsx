import React from "react";

interface State {
  error: Error | null;
  componentStack: string;
}

/**
 * Captura errores de render para que un fallo no deje la ventana en negro.
 * Muestra el mensaje y el stack en pantalla en lugar de un `#root` vacío.
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Deja rastro en la consola de la webview para depurar.
    console.error("Error de render:", error, info);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        style={{
          padding: 24,
          fontFamily: "monospace",
          color: "#e8e8e8",
          background: "#191919",
          height: "100vh",
          overflow: "auto",
          whiteSpace: "pre-wrap",
        }}
      >
        <h2 style={{ color: "#e05c5c" }}>Algo falló al renderizar Niblet</h2>
        <p>{error.message}</p>
        {componentStack && (
          <>
            <h3 style={{ color: "#d4845a", marginTop: 16 }}>Componente:</h3>
            <pre style={{ fontSize: 12, color: "#57a86a" }}>{componentStack}</pre>
          </>
        )}
        <h3 style={{ color: "#717171", marginTop: 16 }}>Stack:</h3>
        <pre style={{ fontSize: 12, color: "#b0b0b0" }}>{error.stack}</pre>
        <button
          style={{
            marginTop: 16,
            padding: "8px 14px",
            background: "#2383e2",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            cursor: "pointer",
          }}
          onClick={() => {
            try {
              localStorage.removeItem("niblet-vault-path");
            } catch {
              /* ignore */
            }
            location.reload();
          }}
        >
          Olvidar vault y recargar
        </button>
      </div>
    );
  }
}
