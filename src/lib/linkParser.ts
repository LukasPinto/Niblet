import { parseFrontmatter } from "./markdown";
import type { NoteEntry } from "./tauri";
import { sourceLabel } from "./taskParser";

export type LinkKind = "wikilink" | "markdown";

export interface ExtractedLink {
  label: string;
  rawTarget: string;
  kind: LinkKind;
  line: number;
}

export interface ResolvedLink extends ExtractedLink {
  sourcePath: string;
  sourceRelPath: string;
  resolvedRelPath: string | null;
}

const WIKI_LINK_RE = /\[\[([^\]|#]+?)(?:\|([^\]]+?))?\]\]/g;
const MD_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function stripMdExt(p: string): string {
  return p.replace(/\.md$/i, "");
}

function stripCodeOnLine(line: string): string {
  return line.replace(/`[^`]+`/g, (m) => " ".repeat(m.length));
}

export function normalizeVaultPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

export interface NoteLinkIndex {
  byName: Map<string, string>;
  byStem: Map<string, string>;
}

export function buildNoteIndex(notes: NoteEntry[]): NoteLinkIndex {
  const byName = new Map<string, string>();
  const byStem = new Map<string, string>();
  for (const n of notes) {
    byName.set(norm(n.name), n.rel_path);
    byStem.set(norm(stripMdExt(n.rel_path)), n.rel_path);
    byStem.set(norm(n.rel_path), n.rel_path);
  }
  return { byName, byStem };
}

function isExternal(target: string): boolean {
  return /^(https?:|mailto:|tel:|#|data:)/i.test(target);
}

function isNoteLinkTarget(target: string): boolean {
  const t = target.trim();
  if (!t || isExternal(t)) return false;
  if (t.startsWith("note:") || t.startsWith("note-unresolved:")) return true;
  const lower = t.toLowerCase();
  if (lower.endsWith(".md")) return true;
  if (!lower.includes("/") && !lower.includes(".")) return true;
  return false;
}

export function resolveNoteTarget(
  raw: string,
  sourceRelPath: string,
  index: NoteLinkIndex,
): string | null {
  let t = raw.trim();
  if (!t || isExternal(t)) return null;

  if (t.startsWith("note:")) {
    const rel = decodeURIComponent(t.slice(5));
    return index.byStem.get(norm(stripMdExt(rel))) ?? null;
  }

  t = decodeURIComponent(t.split("#")[0].trim());
  if (!t) return null;

  const byName = index.byName.get(norm(t));
  if (byName) return byName;

  let candidate = t;
  if (!candidate.toLowerCase().endsWith(".md")) {
    const stemHit = index.byStem.get(norm(stripMdExt(candidate)));
    if (stemHit) return stemHit;
    candidate = `${candidate}.md`;
  }

  if (!candidate.includes(":")) {
    const sourceDir = sourceRelPath.includes("/")
      ? sourceRelPath.slice(0, sourceRelPath.lastIndexOf("/"))
      : "";
    const joined = sourceDir ? `${sourceDir}/${candidate}` : candidate;
    const rel = normalizeVaultPath(joined);
    const hit = index.byStem.get(norm(stripMdExt(rel)));
    if (hit) return hit;
  }

  const vaultRel = normalizeVaultPath(candidate);
  return (
    index.byStem.get(norm(stripMdExt(vaultRel))) ??
    index.byStem.get(norm(vaultRel)) ??
    null
  );
}

export function extractLinksFromBody(body: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const lines = body.split(/\r?\n/);
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (/^```/.test(rawLine.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const line = stripCodeOnLine(rawLine);
    for (const m of line.matchAll(WIKI_LINK_RE)) {
      const title = m[1].trim();
      links.push({
        label: (m[2]?.trim() || title).trim(),
        rawTarget: title,
        kind: "wikilink",
        line: i + 1,
      });
    }
    for (const m of line.matchAll(MD_LINK_RE)) {
      const target = m[2].trim();
      if (!isNoteLinkTarget(target)) continue;
      links.push({
        label: m[1],
        rawTarget: target,
        kind: "markdown",
        line: i + 1,
      });
    }
  }
  return links;
}

export function scanNoteLinks(
  sourcePath: string,
  sourceRelPath: string,
  content: string,
  index: NoteLinkIndex,
): ResolvedLink[] {
  const { content: body } = parseFrontmatter(content);
  return extractLinksFromBody(body).map((link) => ({
    ...link,
    sourcePath,
    sourceRelPath,
    resolvedRelPath: resolveNoteTarget(
      link.kind === "wikilink" ? link.rawTarget : link.rawTarget,
      sourceRelPath,
      index,
    ),
  }));
}

export function preprocessWikilinks(content: string, notes: NoteEntry[]): string {
  const index = buildNoteIndex(notes);
  return content.replace(WIKI_LINK_RE, (_match, title: string, alias?: string) => {
    const target = title.trim();
    const label = (alias?.trim() || target).trim();
    const resolved = resolveNoteTarget(target, "", index);
    if (resolved) {
      return `[${label}](note:${encodeURIComponent(resolved)})`;
    }
    return `[${label}](note-unresolved:${encodeURIComponent(target)})`;
  });
}

export function decorateInternalLinks(html: string): string {
  return html
    .replace(
      /<a href="note:([^"]+)">([^<]*)<\/a>/g,
      '<a href="note:$1" class="wikilink wikilink-pill" data-note-rel="$1"><span class="wikilink-pill-ico" aria-hidden="true">↗</span><span class="wikilink-pill-label">$2</span></a>',
    )
    .replace(
      /<a href="note-unresolved:([^"]+)">([^<]*)<\/a>/g,
      '<a href="#" class="wikilink wikilink--unresolved wikilink-pill" data-unresolved="$1"><span class="wikilink-pill-ico" aria-hidden="true">↗</span><span class="wikilink-pill-label">$2</span></a>',
    );
}

export function linkDisplayLabel(link: ResolvedLink): string {
  if (link.label.trim()) return link.label.trim();
  if (link.resolvedRelPath) return sourceLabel(link.resolvedRelPath);
  return link.rawTarget;
}
