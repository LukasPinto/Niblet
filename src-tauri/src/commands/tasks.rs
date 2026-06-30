use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::commands::vault::is_markdown;

/// Marcadores de metadatos inline (estilo Obsidian Tasks).
const MARKERS: &[&str] = &["📅", "⏳", "⏫"];
const KEY_DUE: &str = "due-date:";
const KEY_PRIOR: &str = "prior:";

/// Una tarea detectada dentro de una nota (`- [ ]`, `- [x]`, `- [/]`).
#[derive(Serialize, Deserialize, Clone)]
pub struct Task {
    pub text: String,
    pub done: bool,
    pub status: String,
    pub due_date: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<String>,
    pub high_priority: bool,
    pub source_path: String,
    pub rel_path: String,
    pub source_line: usize,
    /// Nivel de indentación (0 = raíz). 2 espacios = 1 nivel.
    pub indent_level: u32,
}

struct ParsedTaskLine {
    indent: String,
    checkbox: String,
    text: String,
    due_date: Option<String>,
    scheduled: Option<String>,
    priority: Option<String>,
}

fn extract_after_emoji(text: &str, marker: &str) -> Option<String> {
    let idx = text.find(marker)?;
    let after = &text[idx + marker.len()..];
    let mut end = after.len();
    for m in MARKERS {
        if let Some(p) = after.find(m) {
            if p < end {
                end = p;
            }
        }
    }
    if let Some(p) = after.find(KEY_DUE) {
        if p < end {
            end = p;
        }
    }
    if let Some(p) = after.find(KEY_PRIOR) {
        if p < end {
            end = p;
        }
    }
    let val = after[..end].trim().to_string();
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

fn extract_key_value(text: &str, key: &str) -> Option<String> {
    let idx = text.find(key)?;
    let after = &text[idx + key.len()..];
    let end = after
        .find(|c: char| c.is_whitespace())
        .unwrap_or(after.len());
    let val = after[..end].trim();
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

fn first_meta_index(rest: &str) -> usize {
    let mut cut = rest.len();
    for m in MARKERS {
        if let Some(p) = rest.find(m) {
            if p < cut {
                cut = p;
            }
        }
    }
    if let Some(p) = rest.find(KEY_DUE) {
        if p < cut {
            cut = p;
        }
    }
    if let Some(p) = rest.find(KEY_PRIOR) {
        if p < cut {
            cut = p;
        }
    }
    cut
}

fn indent_level_from_line(line: &str) -> u32 {
    let trimmed = line.trim_start();
    let leading = line.len().saturating_sub(trimmed.len());
    let mut spaces = 0usize;
    for ch in line.chars().take(leading) {
        if ch == ' ' {
            spaces += 1;
        } else if ch == '\t' {
            spaces += 2;
        }
    }
    (spaces / 2) as u32
}

fn parse_checkbox(trimmed: &str) -> Option<(&'static str, bool, &str)> {
    if let Some(r) = trimmed.strip_prefix("- [ ]") {
        Some(("todo", false, r))
    } else if let Some(r) = trimmed
        .strip_prefix("- [x]")
        .or_else(|| trimmed.strip_prefix("- [X]"))
    {
        Some(("done", true, r))
    } else if let Some(r) = trimmed.strip_prefix("- [/]") {
        Some(("doing", false, r))
    } else {
        None
    }
}

fn parse_task_line(line: &str) -> Option<ParsedTaskLine> {
    let trimmed = line.trim_start();
    let indent: String = line.chars().take(line.len().saturating_sub(trimmed.len())).collect();
    let (status, _done, rest) = parse_checkbox(trimmed)?;
    let checkbox = match status {
        "todo" => "- [ ]",
        "doing" => "- [/]",
        _ => "- [x]",
    };

    let mut due_date = extract_key_value(rest, KEY_DUE);
    if due_date.is_none() {
        due_date = extract_after_emoji(rest, "📅");
    }

    let scheduled = extract_after_emoji(rest, "⏳");

    let mut priority = extract_key_value(rest, KEY_PRIOR);
    if priority.is_none() && rest.contains("⏫") {
        priority = Some("high".to_string());
    }

    let cut = first_meta_index(rest);
    let text = rest[..cut].trim().to_string();

    Some(ParsedTaskLine {
        indent,
        checkbox: checkbox.to_string(),
        text,
        due_date,
        scheduled,
        priority,
    })
}

fn format_task_line(parsed: &ParsedTaskLine) -> String {
    let mut line = format!("{}{} {}", parsed.indent, parsed.checkbox, parsed.text);
    if let Some(d) = &parsed.due_date {
        line.push_str(&format!(" due-date:{d}"));
    }
    if let Some(p) = &parsed.priority {
        line.push_str(&format!(" prior:{p}"));
    }
    if let Some(s) = &parsed.scheduled {
        line.push_str(&format!(" ⏳{s}"));
    }
    line
}

fn rewrite_task_line(file_path: &str, line: usize, mutator: impl FnOnce(&mut ParsedTaskLine)) -> Result<(), String> {
    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let ends_with_newline = content.ends_with('\n');
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    if line >= lines.len() {
        return Err("Línea fuera de rango".into());
    }

    let parsed = parse_task_line(&lines[line]).ok_or("No es una línea de tarea")?;
    let mut updated = parsed;
    mutator(&mut updated);
    lines[line] = format_task_line(&updated);

    let mut out = lines.join("\n");
    if ends_with_newline {
        out.push('\n');
    }
    fs::write(file_path, out).map_err(|e| e.to_string())
}

fn parse_tasks_in_file(path: &Path, root: &Path) -> Vec<Task> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let rel_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let path_str = path.to_string_lossy().to_string();

    let mut tasks = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        let Some((status, done, rest)) = parse_checkbox(trimmed) else {
            continue;
        };

        let mut due_date = extract_key_value(rest, KEY_DUE);
        if due_date.is_none() {
            due_date = extract_after_emoji(rest, "📅");
        }
        let scheduled = extract_after_emoji(rest, "⏳");

        let mut priority = extract_key_value(rest, KEY_PRIOR);
        let emoji_high = rest.contains("⏫");
        if priority.is_none() && emoji_high {
            priority = Some("high".to_string());
        }

        let cut = first_meta_index(rest);
        let text = rest[..cut].trim().to_string();

        let high_priority = emoji_high || priority.as_deref() == Some("high");

        tasks.push(Task {
            text,
            done,
            status: status.to_string(),
            due_date,
            scheduled,
            priority,
            high_priority,
            source_path: path_str.clone(),
            rel_path: rel_path.clone(),
            source_line: i,
            indent_level: indent_level_from_line(line),
        });
    }
    tasks
}

// Lee todos los `.md` del vault. Async + spawn_blocking para no bloquear el
// hilo principal en el primer escaneo (especialmente con OneDrive bajo demanda).
#[tauri::command]
pub async fn scan_all_tasks(vault_path: String) -> Result<Vec<Task>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&vault_path);
        if !root.is_dir() {
            return Err(format!("El vault no existe: {vault_path}"));
        }
        let mut all = Vec::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if is_markdown(p) {
                all.extend(parse_tasks_in_file(p, &root));
            }
        }
        Ok(all)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn rewrite_marker(file_path: &str, line: usize, new_marker: &str) -> Result<(), String> {
    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let ends_with_newline = content.ends_with('\n');
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    if line >= lines.len() {
        return Err("Línea fuera de rango".into());
    }

    let current = &lines[line];
    let mut updated = current.clone();
    for m in ["- [ ]", "- [x]", "- [X]", "- [/]"] {
        if updated.contains(m) {
            updated = updated.replacen(m, new_marker, 1);
            break;
        }
    }
    lines[line] = updated;

    let mut out = lines.join("\n");
    if ends_with_newline {
        out.push('\n');
    }
    fs::write(file_path, out).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_task(file_path: String, line: usize, done: bool) -> Result<(), String> {
    let marker = if done { "- [x]" } else { "- [ ]" };
    rewrite_marker(&file_path, line, marker)
}

#[tauri::command]
pub fn set_task_status(file_path: String, line: usize, status: String) -> Result<(), String> {
    let marker = match status.as_str() {
        "todo" => "- [ ]",
        "doing" => "- [/]",
        "done" => "- [x]",
        _ => return Err("Estado inválido".into()),
    };
    rewrite_marker(&file_path, line, marker)
}

#[tauri::command]
pub fn set_task_due_date(
    file_path: String,
    line: usize,
    due_date: Option<String>,
) -> Result<(), String> {
    rewrite_task_line(&file_path, line, |parsed| {
        parsed.due_date = due_date.filter(|s| !s.trim().is_empty());
    })
}

#[tauri::command]
pub fn set_task_priority(
    file_path: String,
    line: usize,
    priority: Option<String>,
) -> Result<(), String> {
    rewrite_task_line(&file_path, line, |parsed| {
        parsed.priority = priority.filter(|s| !s.trim().is_empty());
    })
}
