# Niblet

App de notas Markdown de escritorio (estilo Notion/Capacities) construida con
**Tauri 2.0** (Rust) + **React + TypeScript + Vite**. Tus notas son archivos
`.md` en una carpeta de tu elección (el *Vault*), y la configuración vive dentro
del propio Vault (`.niblet/config.json`) para que viaje con OneDrive entre PCs.

## Funcionalidades

- **Editor Markdown** con CodeMirror 6 (modo edición) y vista previa renderizada
  (unified + remark-gfm + highlight.js). Autoguardado y `Ctrl+S`.
- **Tareas inline detectadas automáticamente** desde todas las notas
  (`- [ ]`, `- [x]`, `- [/]` en progreso), con fechas `📅`, programadas `⏳` y
  prioridad `⏫`. Vista **Lista** (agrupada por vencimiento) y **Kanban**
  (arrastrar y soltar entre Pendiente / En progreso / Hecho).
- **Vista de base de datos**: cada nota es una fila; columnas dinámicas a partir
  del frontmatter, **editables en línea** (se reescribe el `.md`).
- **Tema** oscuro/claro neutro (estilo Notion) + color de acento, guardados en el Vault.
- **Paleta de comandos** (`Ctrl/Cmd + K`).
- **Sync por carpeta (OneDrive)** con **detección de conflictos** vía hash
  SHA-256 (`.niblet/hashes.json`) + snapshots, y **modal de resolución** con diff
  lado a lado (quedarme con el mío / usar el de OneDrive / fusionar).

## Requisitos

- **Windows**: Git, Node 20+, Rust (rustup) + toolchain MSVC, WebView2 (incluido en Windows 11).
- **macOS**: Git, Node 20+, Rust (rustup), Xcode Command Line Tools.

## Desarrollo

```bash
npm install
npm run tauri:dev    # Vite + ventana nativa de Tauri
```

Compilar instaladores locales:

```bash
npm run tauri:build
```

En Windows genera `.msi`/`.exe` (NSIS). En macOS genera `.app` y `.dmg`.

### OneDrive (Client ID)

El sync con OneDrive usa OAuth **Device Code Flow** (sin redirect URI). Necesitas
registrar una app en Azure (Mobile and desktop, public client flows = Sí) y
configurar el Client ID:

```bash
cp .env.example .env
# Edita .env y pon tu ONEDRIVE_CLIENT_ID
```

El build de Tauri lo empotra en el binario (`src-tauri/build.rs`). También puedes
guardarlo en Ajustes dentro de la app o exportarlo como variable de entorno.

## Instaladores (GitHub Actions)

El workflow [`.github/workflows/release.yml`](.github/workflows/release.yml) compila:

| Plataforma | Artefactos |
|------------|------------|
| Windows | `.msi`, `.exe` (NSIS) |
| macOS (Apple Silicon) | `.dmg`, `.app` |
| macOS (Intel) | `.dmg`, `.app` |

**Disparadores:**

| Evento | Qué hace |
|--------|----------|
| Push a `main` | Compila y sube artefactos (sin Release) |
| Push de tag `v*` (p. ej. `v0.1.0`) | Compila + **GitHub Release** en borrador |
| Manual | Actions › *Build release* › *Run workflow* |

**Publicar versión:** `git tag v0.1.0 && git push origin v0.1.0`

**Secret obligatorio para CI:** en el repo, Settings › Secrets › Actions, crea
`ONEDRIVE_CLIENT_ID` con tu Client ID de Azure. El workflow **falla al inicio** si
falta, tiene el valor de ejemplo o no es un UUID válido. El ID se empotra en los
instaladores durante la compilación (`src-tauri/build.rs`).

### Instalar en macOS (builds de CI)

Los instaladores generados en GitHub Actions **no están firmados ni notarizados** con
certificado Apple. macOS puede mostrar *«está dañado y no puede abrirse»* aunque el
archivo esté bien; es Gatekeeper bloqueando apps no verificadas.

1. Descarga el artefacto (`niblet-macos-arm64` o `niblet-macos-x64`) y descomprímelo.
2. Arrastra `Niblet.app` (carpeta `macos/` dentro del artefacto) a **Aplicaciones**.
3. En Terminal, quita la cuarentena de descarga:

   ```bash
   xattr -cr /Applications/Niblet.app
   ```

4. Abre la app con **clic derecho → Abrir** (no doble clic) y confirma **Abrir**.
   Solo hace falta la primera vez.

Si montaste el `.dmg` y falla, usa el `.app` del artefacto directamente; suele ser
más fiable. Para distribución pública sin estos pasos haría falta Apple Developer
Program y firmar/notarizar en CI.

## Estructura

```
src/                 Frontend React
  components/         Sidebar, TopBar, Editor, TasksPanel, DatabaseView, Settings, CommandPalette
  stores/            Zustand: vault, notes, tasks, ui
  lib/               markdown, taskParser, conflictResolver, tauri (wrappers)
  styles/            tokens / components / layout (port del prototipo)
src-tauri/           Backend Rust
  src/commands/      vault.rs, tasks.rs, sync.rs, onedrive.rs
test-vault/          Vault de ejemplo para probar (gitignored)
prototype/           Maqueta HTML/CSS/JS original (referencia)
```

## Probar rápido

1. `npm run tauri:dev`
2. Pulsa **Abrir carpeta del Vault…** y elige la carpeta `test-vault/` de este repo.
3. Verás las notas, las tareas detectadas y la base de datos con su frontmatter.

## Licencia

Niblet se distribuye bajo **GNU General Public License v3.0 o posterior** (GPL-3.0-or-later).
Ver [LICENSE](LICENSE).

Si distribuyes binarios compilados, debes ofrecer el código fuente correspondiente
(por ejemplo enlazando a este repositorio).

### Compatibilidad de la GPL con las dependencias

Las bibliotecas que usa Niblet (Tauri, React, CodeMirror, crates de Rust, etc.)
están licenciadas principalmente bajo **MIT** o **Apache-2.0**. Esas licencias
permissivas son **compatibles** con licenciar el proyecto propio como GPL-3.0:
puedes combinar código GPL con ellas y distribuir el resultado bajo GPL.

Niblet **no incluye** código de terceros con licencias incompatibles con la GPL
(p. ej. AGPL con linking restrictivo, o SDKs propietarios).

## Agradecimientos

- **[RemotelySave](https://github.com/remotelysave/remotelysave)** — el flujo de
  autenticación OneDrive con **Device Code Flow** (mostrar un código en
  `microsoft.com/devicelogin` en lugar de un redirect local) está inspirado en el
  enfoque que popularizaron plugins como RemotelySave para Obsidian. Gracias por
  el modelo de referencia.
