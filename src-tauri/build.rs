use std::fs;
use std::path::Path;

fn main() {
    // Empotra `ONEDRIVE_CLIENT_ID` en el binario desde el entorno o un `.env`,
    // para que `option_env!` lo pueda leer en compilación (incluido el build
    // empaquetado, donde no hay variables de entorno en tiempo de ejecución).
    embed_env_var("ONEDRIVE_CLIENT_ID");
    tauri_build::build()
}

/// Si la variable está en el entorno del build o en un `.env` (en `src-tauri/`
/// o en la raíz del proyecto), la reexporta como variable de compilación.
fn embed_env_var(key: &str) {
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-env-changed={key}");

    // 1. Ya presente en el entorno del proceso de build.
    if let Ok(val) = std::env::var(key) {
        let val = val.trim();
        if !val.is_empty() {
            println!("cargo:rustc-env={key}={val}");
            return;
        }
    }

    // 2. Buscar en un archivo `.env` (primero src-tauri/, luego la raíz).
    for path in [".env", "../.env"] {
        if let Some(val) = read_env_file(Path::new(path), key) {
            let val = val.trim();
            if !val.is_empty() {
                println!("cargo:rustc-env={key}={val}");
                return;
            }
        }
    }
    // Si no se encuentra, `option_env!` devolverá `None` y se usará el fallback
    // de configuración en tiempo de ejecución.
}

/// Lee `KEY=valor` de un archivo estilo dotenv (admite comillas y `export`).
fn read_env_file(path: &Path, key: &str) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                let v = v.trim().trim_matches('"').trim_matches('\'');
                return Some(v.to_string());
            }
        }
    }
    None
}
