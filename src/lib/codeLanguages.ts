import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";

export interface CodeLanguageOption {
  /** Etiqueta del fence Markdown (p. ej. `javascript`, `python`). */
  value: string;
  label: string;
}

/** IDs erróneos guardados antes del fix de Python (`extensions[0]` → `build`). */
const LEGACY_LANGUAGE_IDS: Record<string, string> = {
  build: "python",
};

/** Atajos habituales en fences Markdown → id canónico del listado. */
const FENCE_ALIASES: Record<string, string> = {
  py: "python",
  pyw: "python",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  yml: "yaml",
  md: "markdown",
  cpp: "c++",
  hpp: "c++",
  cs: "csharp",
  ps1: "powershell",
};

/**
 * Id estable para fences ```lang y para CodeMirror.
 * Prioriza `python`/`javascript` sobre extensiones raras (p. ej. BUILD en Python).
 */
function fenceLanguageValue(desc: LanguageDescription): string {
  const nameLower = desc.name.toLowerCase();
  if (desc.alias.some((a) => a.toLowerCase() === nameLower)) return nameLower;
  const alias = desc.alias.find((a) => /^[a-z][\w-]*$/.test(a));
  if (alias) return alias.toLowerCase();
  const ext = desc.extensions.find((e) => /^[a-z][a-z0-9]{0,5}$/.test(e));
  if (ext) return ext.toLowerCase();
  return nameLower;
}

function buildCodeLanguageOptions(): CodeLanguageOption[] {
  const seen = new Set<string>();
  const options: CodeLanguageOption[] = [{ value: "", label: "Texto plano" }];

  for (const desc of languages) {
    const value = fenceLanguageValue(desc);
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ value: key, label: desc.name });
  }

  options.sort((a, b) => {
    if (!a.value) return -1;
    if (!b.value) return 1;
    return a.label.localeCompare(b.label, "es");
  });
  return options;
}

export const CODE_LANGUAGE_OPTIONS = buildCodeLanguageOptions();

/** Normaliza un id de lenguaje (legacy, alias, etiqueta) al valor del listado. */
export function normalizeCodeLanguageId(language: string | undefined): string {
  if (!language?.trim()) return "";
  const raw = language.trim().toLowerCase();
  const legacy = LEGACY_LANGUAGE_IDS[raw];
  if (legacy) return legacy;
  const aliased = FENCE_ALIASES[raw];
  if (aliased) return aliased;
  if (CODE_LANGUAGE_OPTIONS.some((o) => o.value === raw)) return raw;
  const byLabel = CODE_LANGUAGE_OPTIONS.find(
    (o) => o.label.toLowerCase() === raw,
  );
  if (byLabel) return byLabel.value;
  return raw;
}

export function codeLanguageLabel(value: string | undefined): string {
  if (!value) return "Texto plano";
  const id = normalizeCodeLanguageId(value);
  const exact = CODE_LANGUAGE_OPTIONS.find((o) => o.value === id);
  if (exact) return exact.label;
  const match = LanguageDescription.matchLanguageName(languages, id, true);
  return match?.name ?? value;
}

/** Resuelve la LanguageDescription de CodeMirror para un id guardado en el bloque. */
export function resolveCodeLanguageDescription(
  language: string | undefined,
): LanguageDescription | null {
  if (!language?.trim()) return null;
  const id = normalizeCodeLanguageId(language);
  return LanguageDescription.matchLanguageName(languages, id, true);
}
