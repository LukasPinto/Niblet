// Autenticación con OneDrive mediante OAuth 2.0 Device Code Flow.
//
// A diferencia del flujo de redirect (que necesita un redirect_uri fijo tipo
// http://localhost:PUERTO, frágil ante cambios de IP/puerto), el device code
// flow NO usa redirect alguno: la app muestra un código corto, el usuario lo
// introduce en https://microsoft.com/devicelogin e inicia sesión con su
// cuenta. Es el mismo modelo que usan las CLIs y plugins como RemotelySave.
//
// El Client ID se registra UNA sola vez por el desarrollador de la app
// (Azure › App registrations › "Mobile and desktop", con "Allow public client
// flows" = Sí). No requiere secreto ni redirect. Se provee mediante la variable
// de entorno `ONEDRIVE_CLIENT_ID` (ver `resolve_client_id`).
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// Nombre de la variable de entorno que provee el Client ID de la app de Azure.
const CLIENT_ID_ENV: &str = "ONEDRIVE_CLIENT_ID";

const SCOPE: &str = "Files.ReadWrite offline_access User.Read";
const DEVICECODE_URL: &str =
    "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ME_URL: &str = "https://graph.microsoft.com/v1.0/me";

#[derive(Serialize)]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub interval: u64,
    pub expires_in: u64,
    pub message: String,
}

#[derive(Deserialize)]
struct DeviceCodeRaw {
    user_code: String,
    verification_uri: String,
    device_code: String,
    interval: u64,
    expires_in: u64,
    message: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Stored {
    refresh_token: String,
    access_token: String,
    expires_at: u64,
    account: String,
}

#[derive(Deserialize)]
struct TokenResp {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("onedrive.json"))
}

fn client_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("onedrive_client.txt"))
}

fn load(app: &AppHandle) -> Stored {
    store_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, s: &Stored) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(store_path(app)?, json).map_err(|e| e.to_string())
}

fn resolve_client_id(app: &AppHandle) -> Result<String, String> {
    // 1. Variable de entorno en tiempo de ejecución (útil en desarrollo).
    if let Ok(id) = std::env::var(CLIENT_ID_ENV) {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }
    // 2. Valor empotrado en compilación desde la misma variable (build.rs lo lee
    //    del `.env`), necesario para el binario empaquetado donde no hay entorno.
    if let Some(id) = option_env!("ONEDRIVE_CLIENT_ID") {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }
    // 3. Configurado una vez en tiempo de ejecución (onedrive_set_client_id).
    let id = client_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if id.is_empty() {
        Err("OneDrive aún no está configurado (falta el Client ID de la app).".into())
    } else {
        Ok(id)
    }
}

#[tauri::command]
pub fn onedrive_get_client_id(app: AppHandle) -> String {
    resolve_client_id(&app).unwrap_or_default()
}

#[tauri::command]
pub fn onedrive_set_client_id(app: AppHandle, client_id: String) -> Result<(), String> {
    fs::write(client_path(&app)?, client_id.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn onedrive_configured(app: AppHandle) -> bool {
    resolve_client_id(&app).is_ok()
}

#[tauri::command]
pub fn onedrive_account(app: AppHandle) -> Option<String> {
    let s = load(&app);
    if s.refresh_token.is_empty() && s.access_token.is_empty() {
        None
    } else {
        Some(s.account)
    }
}

#[tauri::command]
pub fn onedrive_logout(app: AppHandle) -> Result<(), String> {
    if let Ok(p) = store_path(&app) {
        let _ = fs::remove_file(p);
    }
    Ok(())
}

#[tauri::command]
pub async fn onedrive_device_start(app: AppHandle) -> Result<DeviceCode, String> {
    let cid = resolve_client_id(&app)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(DEVICECODE_URL)
        .form(&[("client_id", cid.as_str()), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("No se pudo iniciar el login: {body}"));
    }
    let raw: DeviceCodeRaw = resp.json().await.map_err(|e| e.to_string())?;
    Ok(DeviceCode {
        user_code: raw.user_code,
        verification_uri: raw.verification_uri,
        device_code: raw.device_code,
        interval: raw.interval,
        expires_in: raw.expires_in,
        message: raw.message,
    })
}

async fn fetch_account(access: &str) -> String {
    let client = reqwest::Client::new();
    if let Ok(resp) = client.get(ME_URL).bearer_auth(access).send().await {
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            if let Some(name) = v
                .get("userPrincipalName")
                .or_else(|| v.get("mail"))
                .or_else(|| v.get("displayName"))
                .and_then(|x| x.as_str())
            {
                return name.to_string();
            }
        }
    }
    "cuenta Microsoft".to_string()
}

/// Hace UNA petición de polling. Devuelve:
/// - `"pending"` si el usuario todavía no autorizó,
/// - `"authorized:<cuenta>"` al completarse,
/// - `Err(...)` si el login falló o caducó.
#[tauri::command]
pub async fn onedrive_device_poll(app: AppHandle, device_code: String) -> Result<String, String> {
    let cid = resolve_client_id(&app)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", cid.as_str()),
            ("device_code", device_code.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let tok: TokenResp = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(err) = tok.error {
        return match err.as_str() {
            "authorization_pending" | "slow_down" => Ok("pending".into()),
            _ => Err(tok.error_description.unwrap_or(err)),
        };
    }

    let access = tok.access_token.ok_or("Respuesta sin access_token")?;
    let account = fetch_account(&access).await;
    let stored = Stored {
        refresh_token: tok.refresh_token.unwrap_or_default(),
        access_token: access,
        expires_at: now() + tok.expires_in.unwrap_or(3600).saturating_sub(60),
        account: account.clone(),
    };
    save(&app, &stored)?;
    Ok(format!("authorized:{account}"))
}

/// Devuelve un access token válido, refrescándolo con el refresh_token si caducó.
#[tauri::command]
pub async fn onedrive_token(app: AppHandle) -> Result<String, String> {
    let mut s = load(&app);
    if s.refresh_token.is_empty() && s.access_token.is_empty() {
        return Err("No hay sesión de OneDrive".into());
    }
    if now() < s.expires_at && !s.access_token.is_empty() {
        return Ok(s.access_token);
    }
    if s.refresh_token.is_empty() {
        return Err("Sesión caducada: vuelve a conectar OneDrive".into());
    }

    let cid = resolve_client_id(&app)?;
    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", cid.as_str()),
            ("refresh_token", s.refresh_token.as_str()),
            ("scope", SCOPE),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let tok: TokenResp = resp.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = tok.error {
        return Err(tok.error_description.unwrap_or(err));
    }
    let access = tok.access_token.ok_or("Refresh sin access_token")?;
    s.access_token = access.clone();
    s.expires_at = now() + tok.expires_in.unwrap_or(3600).saturating_sub(60);
    if let Some(r) = tok.refresh_token {
        s.refresh_token = r;
    }
    save(&app, &s)?;
    Ok(access)
}
