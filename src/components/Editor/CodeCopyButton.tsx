import { useEffect, useRef, useState } from "react";

/** Botón "Copiar" para bloques de código (editando o en vista estática). */
export default function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const onCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Portapapeles no disponible: no hacemos nada.
    }
  };

  return (
    <button
      type="button"
      className="code-copy-btn"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={onCopy}
      aria-label="Copiar código"
    >
      {copied ? "✓ Copiado" : "Copiar"}
    </button>
  );
}
