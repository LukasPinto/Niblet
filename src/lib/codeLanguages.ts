import { languages } from "@codemirror/language-data";
import { LanguageDescription } from "@codemirror/language";

export interface CodeLanguageOption {
  /** Etiqueta del fence Markdown (p. ej. `javascript`, `python`). */
  value: string;
  label: string;
}

function buildCodeLanguageOptions(): CodeLanguageOption[] {
  const seen = new Set<string>();
  const options: CodeLanguageOption[] = [{ value: "", label: "Texto plano" }];

  for (const desc of languages) {
    const value =
      desc.extensions[0] ??
      desc.alias.find((a) => a !== desc.name.toLowerCase()) ??
      desc.name.toLowerCase();
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

export function codeLanguageLabel(value: string | undefined): string {
  if (!value) return "Texto plano";
  const exact = CODE_LANGUAGE_OPTIONS.find((o) => o.value === value.toLowerCase());
  if (exact) return exact.label;
  const match = LanguageDescription.matchLanguageName(languages, value, true);
  return match?.name ?? value;
}
