import { createLowlight, common } from "lowlight";
import type { RootContent } from "hast";

const lowlight = createLowlight(common);

const HIGHLIGHT_ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  sh: "bash",
  zsh: "bash",
  ksh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  hpp: "cpp",
  cs: "csharp",
  ps1: "powershell",
  pwsh: "powershell",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hastToHtml(node: RootContent | { type: "root"; children: RootContent[] }): string {
  if (node.type === "text") return escapeHtml(node.value);
  if (node.type === "root") return node.children.map(hastToHtml).join("");
  if (node.type === "element") {
    const cls = node.properties?.className;
    const className = Array.isArray(cls)
      ? cls.join(" ")
      : typeof cls === "string"
        ? cls
        : "";
    const inner = node.children.map(hastToHtml).join("");
    if (!className) return `<${node.tagName}>${inner}</${node.tagName}>`;
    return `<${node.tagName} class="${className}">${inner}</${node.tagName}>`;
  }
  return "";
}

export function resolveHighlightLanguage(language: string | undefined): string | undefined {
  if (!language?.trim()) return undefined;
  const key = language.trim().toLowerCase();
  const mapped = HIGHLIGHT_ALIASES[key] ?? key;
  if (lowlight.registered(mapped)) return mapped;
  return undefined;
}

export function highlightCode(code: string, language?: string): string {
  if (!code) return "";
  const lang = resolveHighlightLanguage(language);
  try {
    if (lang) {
      return hastToHtml(lowlight.highlight(lang, code));
    }
    const auto = lowlight.highlightAuto(code);
    if (auto.data?.language) {
      return hastToHtml(auto);
    }
  } catch {
    /* lenguaje inválido o código parcial mientras se escribe */
  }
  return escapeHtml(code);
}
