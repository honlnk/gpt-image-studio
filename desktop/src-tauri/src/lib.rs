// Desktop shell for GPT Image Studio.
//
// Boots a window with the existing Vue web app and manages the embedded
// Companion sidecar (evolution roadmap 阶段四 · 方案 B 首期):
//
// 1. On startup (background thread): probe 127.0.0.1:19750 — if our companion
//    is already running there (CLI `gpt-image-studio start` / a previous
//    desktop instance), reuse it; the shared `~/.gpt-image-studio` data dir
//    means the access key on disk is valid for it too.
// 2. Otherwise spawn the bundled sidecar binary (`serve`, foreground) and wait
//    for the `COMPANION_READY {"port":N}` stdout handshake. If the child exits
//    early (port taken by a foreign process), retry once with `--port 0`
//    (ephemeral port reported via the handshake).
// 3. The webview fetches connection info via the `desktop_companion_info`
//    command; if the sidecar never becomes ready it returns available=false
//    and the frontend falls back to standalone behavior.
// 4. On app exit the spawned child is killed. A reused (external) process is
//    never killed by us.
//
// All sidecar spawning happens Rust-side; no shell permissions are granted to
// the webview (capabilities stay at core:default).

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// 与 companion CLI 默认端口一致（src/cli.ts DEFAULT_PORT）。
const DEFAULT_COMPANION_PORT: u16 = 19750;

/// serve stdout 上的就绪握手行前缀（companion/src/server.ts）。
const READY_MARKER: &str = "COMPANION_READY ";

/// 显式放行的 webview origin：macOS（tauri://）、Windows/Linux（http(s)://tauri.localhost）、
/// tauri dev 的 devUrl。companion 侧 CORS/loopbackGuard 据此放行桌面 webview 的 fetch。
const ALLOW_ORIGINS: [&str; 5] = [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://127.0.0.1:8888",
    "http://localhost:8888",
];

/// 等待 sidecar 完成握手的上限（含首次建库/迁移的余量）。
const SIDECAR_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);

/// `desktop_companion_info` 命令等待启动线程就绪的上限；超时返回 available=false，
/// 前端回落 standalone 模式（可手动配对外部 Companion 或用 direct）。
const INFO_WAIT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCompanionInfo {
    available: bool,
    companion_url: String,
    access_key: String,
}

impl DesktopCompanionInfo {
    fn unavailable() -> Self {
        Self {
            available: false,
            companion_url: String::new(),
            access_key: String::new(),
        }
    }
}

struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    info: Mutex<DesktopCompanionInfo>,
}

/// Companion 数据目录。与 companion 侧解析逻辑保持一致（src/storage/db.ts CONFIG_DIR）：
/// 显式 GPT_IMAGE_STUDIO_CONFIG_DIR 优先，默认 ~/.gpt-image-studio（与 npm CLI 版共享
/// 凭据与数据集——桌面内置与 CLI 是同一服务的两种运行方式）。
fn companion_data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("GPT_IMAGE_STUDIO_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".gpt-image-studio")
}

/// 读取连接密钥。embedded/复用两种路径共用：companion 启动时 loadOrCreateAccessKey
/// 会确保该文件存在（0600）。
fn read_access_key() -> Option<String> {
    let content = std::fs::read_to_string(companion_data_dir().join("access-key.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    parsed["key"].as_str().map(str::to_owned)
}

/// loopback HTTP GET /health，探测端口上是否跑着本项目的 companion。
/// 用裸 TcpStream 避免 HTTP 客户端依赖；无 Origin 头的请求被 loopbackGuard 放行。
fn probe_companion(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect(&addr) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    if stream
        .write_all(format!("GET /health HTTP/1.0\r\nHost: {addr}\r\n\r\n").as_bytes())
        .is_err()
    {
        return false;
    }
    let mut buf = String::new();
    if stream.read_to_string(&mut buf).is_err() {
        return false;
    }
    buf.contains("\"app\":\"gpt-image-studio-companion\"")
}

fn publish_info(state: &SidecarState, port: u16) {
    let Some(key) = read_access_key() else {
        eprintln!("[desktop] companion 已就绪但读不到 access-key.json，放弃内置连接");
        return;
    };
    *state.info.lock().unwrap() = DesktopCompanionInfo {
        available: true,
        companion_url: format!("http://127.0.0.1:{port}"),
        access_key: key,
    };
}

/// 启动内置 Companion：先复用，再 spawn（默认端口 → 临时端口重试一次）。
fn start_embedded_companion(app: tauri::AppHandle) {
    let state = app.state::<SidecarState>();

    // 1) 复用：19750 上已有本产品 companion（CLI 后台服务 / 先前的桌面实例）。
    //    共享数据目录 ⇒ 磁盘上的 access key 对它同样有效。
    if probe_companion(DEFAULT_COMPANION_PORT) {
        publish_info(&state, DEFAULT_COMPANION_PORT);
        return;
    }

    // 2) spawn。19750 被非本产品进程占用（握手前早退）时，用 --port 0 换临时端口重试。
    let admin_dir: Option<PathBuf> = app
        .path()
        .resolve("resources/companion-admin", tauri::path::BaseDirectory::Resource)
        .ok();
    if let Some(dir) = &admin_dir {
        if !dir.is_dir() {
            eprintln!("[desktop] admin 资源目录缺失（{dir:?}），管理页将不可用");
        }
    }

    for port in [DEFAULT_COMPANION_PORT, 0] {
        match spawn_and_wait_ready(&app, port, admin_dir.as_deref()) {
            Ok(actual_port) => {
                publish_info(&state, actual_port);
                return;
            }
            Err(err) => eprintln!("[desktop] companion sidecar (port {port}) 启动失败: {err}"),
        }
    }
    eprintln!("[desktop] companion sidecar 两次启动均失败，webview 将回落 standalone 模式");
}

/// spawn sidecar 并等待 COMPANION_READY 握手，返回实际监听端口。
fn spawn_and_wait_ready(
    app: &tauri::AppHandle,
    port: u16,
    admin_dir: Option<&Path>,
) -> Result<u16, String> {
    let mut command = app
        .shell()
        .sidecar("companion")
        .map_err(|e| format!("解析 sidecar 二进制失败: {e}"))?;
    command = command
        .args([
            "serve",
            "--port",
            &port.to_string(),
            "--allow-origin",
            ALLOW_ORIGINS[0],
            ALLOW_ORIGINS[1],
            ALLOW_ORIGINS[2],
            ALLOW_ORIGINS[3],
            ALLOW_ORIGINS[4],
        ])
        .env("GPT_IMAGE_STUDIO_CONFIG_DIR", companion_data_dir());
    if let Some(dir) = admin_dir {
        command = command.env("COMPANION_ADMIN_DIR", dir);
    }

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("spawn 失败: {e}"))?;
    app.state::<SidecarState>()
        .child
        .lock()
        .unwrap()
        .replace(child);

    // 插件的 receiver 是 async（tauri::async_runtime::Receiver，无 recv_timeout），
    // 转发到 std mpsc 后在本线程带超时等待。
    let (event_tx, event_rx) = std::sync::mpsc::channel::<CommandEvent>();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if event_tx.send(event).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + SIDECAR_STARTUP_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("等待 COMPANION_READY 握手超时".into());
        }
        match event_rx.recv_timeout(remaining) {
            Ok(CommandEvent::Stdout(bytes)) => {
                let line = String::from_utf8_lossy(&bytes);
                let trimmed = line.trim_start();
                let Some(rest) = trimmed.strip_prefix(READY_MARKER) else {
                    continue;
                };
                let Ok(value) = serde_json::from_str::<serde_json::Value>(rest.trim_end()) else {
                    continue;
                };
                if let Some(actual) = value["port"].as_u64() {
                    return Ok(actual as u16);
                }
            }
            Ok(CommandEvent::Terminated(payload)) => {
                return Err(format!("进程提前退出: {payload:?}"));
            }
            Ok(_) => {}
            Err(_) => return Err("等待 COMPANION_READY 握手超时".into()),
        }
    }
}

/// webview 启动时拉取内置 Companion 连接信息。等待启动线程完成握手（有界），
/// 超时返回 available=false——前端据此回落 standalone 模式，桌面端不因 sidecar
/// 故障卡死。
///
/// async + 阻塞等待：Tauri v2 的 async command 在 runtime 工作线程执行，
/// 不会冻结主线程/UI；该命令仅在应用启动时被调用一次。
#[tauri::command]
async fn desktop_companion_info(
    state: tauri::State<'_, SidecarState>,
) -> Result<DesktopCompanionInfo, String> {
    let deadline = Instant::now() + INFO_WAIT_TIMEOUT;
    loop {
        let ready = state.info.lock().unwrap().available;
        if ready || Instant::now() >= deadline {
            return Ok(state.info.lock().unwrap().clone());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// 在系统浏览器打开 URL（管理页等）。webview 内 window.open 不可靠，统一走 opener。
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(SidecarState {
            child: Mutex::new(None),
            info: Mutex::new(DesktopCompanionInfo::unavailable()),
        })
        .invoke_handler(tauri::generate_handler![
            desktop_companion_info,
            open_external_url
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // 后台线程启动 sidecar，不阻塞窗口显示；握手结果写入 SidecarState。
            std::thread::spawn(move || start_embedded_companion(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(child) = app_handle.state::<SidecarState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
