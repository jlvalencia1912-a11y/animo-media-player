use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagExt, TagItem};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: [&str; 5] = ["mp3", "flac", "wav", "aac", "m4a"];
const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mov", "m4v", "webm"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScannedFile {
    path: String,
    file_name: String,
    title: String,
    artist: String,
    album: String,
    track_number: Option<u32>,
    duration_seconds: f64,
    format: String,
    file_size: u64,
    mtime_ms: u64,
    read_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    files: Vec<ScannedFile>,
    errors: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    scanned: usize,
    total: usize,
    current: String,
}

fn is_media(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            AUDIO_EXTENSIONS.contains(&e.as_str()) || VIDEO_EXTENSIONS.contains(&e.as_str())
        })
        .unwrap_or(false)
}

fn read_metadata(path: &Path, file_size: u64, mtime_ms: u64) -> ScannedFile {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let fallback_title = path
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.clone());
    let format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_uppercase())
        .unwrap_or_default();

    let mut out = ScannedFile {
        path: path.to_string_lossy().to_string(),
        file_name,
        title: fallback_title,
        artist: String::new(),
        album: String::new(),
        track_number: None,
        duration_seconds: 0.0,
        format,
        file_size,
        mtime_ms,
        read_error: None,
    };

    match Probe::open(path).and_then(|p| p.read()) {
        Ok(tagged) => {
            out.duration_seconds = tagged.properties().duration().as_secs_f64();
            if let Some(tag) = tagged
                .primary_tag()
                .or_else(|| tagged.first_tag())
            {
                if let Some(v) = tag.get_string(&ItemKey::TrackTitle) {
                    if !v.trim().is_empty() {
                        out.title = v.trim().to_string();
                    }
                }
                out.artist = tag
                    .get_string(&ItemKey::TrackArtist)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                out.album = tag
                    .get_string(&ItemKey::AlbumTitle)
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default();
                out.track_number = tag
                    .get_string(&ItemKey::TrackNumber)
                    .and_then(|s| {
                        // values may look like "3" or "3/12"
                        s.split('/').next()?.trim().parse::<u32>().ok()
                    });
            }
        }
        Err(e) => {
            out.read_error = Some(e.to_string());
        }
    }
    out
}

#[tauri::command]
fn scan_folders(app: tauri::AppHandle, folders: Vec<String>) -> ScanResult {
    let mut seen: HashSet<String> = HashSet::new();
    let mut paths: Vec<(std::path::PathBuf, u64, u64)> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for folder in &folders {
        let root = Path::new(folder);
        if !root.is_dir() {
            errors.push(format!("Folder not found: {folder}"));
            continue;
        }
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let p = entry.path();
            if !p.is_file() || !is_media(p) {
                continue;
            }
            let key = p.to_string_lossy().to_lowercase();
            if !seen.insert(key) {
                continue;
            }
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            paths.push((p.to_path_buf(), size, mtime));
        }
    }

    let total = paths.len();
    let mut files = Vec::with_capacity(total);
    for (i, (p, size, mtime)) in paths.into_iter().enumerate() {
        let f = read_metadata(&p, size, mtime);
        if let Some(e) = &f.read_error {
            errors.push(format!("{}: {e}", f.path));
        }
        files.push(f);
        if i % 25 == 0 || i + 1 == total {
            let _ = app.emit(
                "amp:scan-progress",
                ScanProgress {
                    scanned: i + 1,
                    total,
                    current: files
                        .last()
                        .map(|f| f.file_name.clone())
                        .unwrap_or_default(),
                },
            );
        }
    }

    ScanResult { files, errors }
}

#[tauri::command]
fn scan_files(paths: Vec<String>) -> ScanResult {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    for p in &paths {
        let path = Path::new(p);
        if !path.is_file() {
            errors.push(format!("File not found: {p}"));
            continue;
        }
        let meta = std::fs::metadata(path).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let f = read_metadata(path, size, mtime);
        if let Some(e) = &f.read_error {
            errors.push(format!("{}: {e}", f.path));
        }
        files.push(f);
    }
    ScanResult { files, errors }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoverArt {
    mime: String,
    base64: String,
}

#[tauri::command]
fn read_cover(path: String) -> Option<CoverArt> {
    let tagged = Probe::open(Path::new(&path)).ok()?.read().ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let pic = tag.pictures().first()?;
    let mime = match pic.mime_type() {
        Some(lofty::picture::MimeType::Png) => "image/png",
        Some(lofty::picture::MimeType::Gif) => "image/gif",
        Some(lofty::picture::MimeType::Bmp) => "image/bmp",
        Some(lofty::picture::MimeType::Tiff) => "image/tiff",
        _ => "image/jpeg",
    };
    Some(CoverArt {
        mime: mime.to_string(),
        base64: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            pic.data(),
        ),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TagEdits {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    track_number: Option<String>,
    genre: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagWriteResult {
    path: String,
    ok: bool,
    error: Option<String>,
}

fn apply_edits(path: &str, edits: &TagEdits) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err("File not found".to_string());
    }
    let mut tagged = Probe::open(p)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let tag = if tagged.primary_tag().is_some() {
        tagged.primary_tag_mut()
    } else {
        tagged.first_tag_mut()
    }
    .ok_or_else(|| "No supported tag found in file".to_string())?;

    let set_field = |tag: &mut lofty::tag::Tag, key: ItemKey, value: &Option<String>| {
        match value {
            Some(v) if v.trim().is_empty() => {
                tag.remove_key(&key);
            }
            Some(v) => {
                tag.insert(TagItem::new(key, ItemValue::Text(v.trim().to_string())));
            }
            None => {}
        }
    };

    set_field(tag, ItemKey::TrackTitle, &edits.title);
    set_field(tag, ItemKey::TrackArtist, &edits.artist);
    set_field(tag, ItemKey::AlbumTitle, &edits.album);
    set_field(tag, ItemKey::TrackNumber, &edits.track_number);
    set_field(tag, ItemKey::Genre, &edits.genre);

    tag.save_to_path(p, WriteOptions::default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_tags(paths: Vec<String>, edits: TagEdits) -> Vec<TagWriteResult> {
    paths
        .into_iter()
        .map(|path| match apply_edits(&path, &edits) {
            Ok(()) => TagWriteResult {
                path,
                ok: true,
                error: None,
            },
            Err(e) => TagWriteResult {
                path,
                ok: false,
                error: Some(e),
            },
        })
        .collect()
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}



/// Save a mic recording (raw bytes from the webview's MediaRecorder) into
/// the chosen folder — or ~/Desktop/Animo Recordings/ when none is set.
/// Returns the absolute path so the frontend can scan it into the library.
#[tauri::command]
fn save_recording(
    app: tauri::AppHandle,
    data: Vec<u8>,
    file_name: String,
    dir: Option<String>,
) -> Result<String, String> {
    let dir = match dir {
        Some(d) if !d.trim().is_empty() => std::path::PathBuf::from(d),
        _ => app
            .path()
            .desktop_dir()
            .map_err(|e| e.to_string())?
            .join("Animo Recordings"),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe = file_name.replace(['/', '\\'], "-");
    let path = dir.join(safe);
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Extract a percentage token ("45.2%") from a yt-dlp progress line.
fn parse_progress_percent(line: &str) -> Option<f64> {
    if !line.starts_with("[download]") {
        return None;
    }
    for tok in line.split_whitespace() {
        if let Some(num) = tok.strip_suffix('%') {
            if let Ok(p) = num.parse::<f64>() {
                return Some(p);
            }
        }
    }
    None
}

/// Download a YouTube video via the bundled yt-dlp binary into
/// ~/Desktop/Animo Downloads/. `format` is a yt-dlp format selector chosen
/// by the UI (single muxed files only — no ffmpeg merge needed). Streams
/// progress to the frontend over `amp:dl-progress`. Returns the file path.
#[tauri::command]
fn download_youtube(
    app: tauri::AppHandle,
    url: String,
    format: String,
) -> Result<String, String> {
    // Resolve the yt-dlp binary: dev (source tree) -> bundled resource -> PATH
    let exe = std::env::consts::EXE_SUFFIX;
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("binaries/yt-dlp{exe}"));
    let res_path = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join(format!("binaries/yt-dlp{exe}")));
    let bin = if dev_path.is_file() {
        dev_path
    } else if let Some(p) = res_path.filter(|p| p.is_file()) {
        p
    } else {
        PathBuf::from(format!("yt-dlp{exe}"))
    };

    let out_dir = app
        .path()
        .desktop_dir()
        .map_err(|e| e.to_string())?
        .join("Animo Downloads");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    // GUI apps get a minimal PATH — append common locations so yt-dlp can
    // find node (its JS runtime for YouTube extraction) in the bundled app too.
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    for extra in ["/usr/local/bin", "/opt/homebrew/bin"] {
        if !path_env.split(':').any(|p| p == extra) {
            path_env.push(':');
            path_env.push_str(extra);
        }
    }

    // ffmpeg sits next to yt-dlp in binaries/ — needed to merge separate
    // video+audio streams into a single mp4.
    let ffmpeg_dir = bin.parent().unwrap_or(Path::new(".")).to_path_buf();

    let mut child = std::process::Command::new(&bin)
        .env("PATH", path_env)
        .arg("--no-playlist")
        .arg("--js-runtimes")
        .arg("node")
        .arg("--newline")
        .arg("--ffmpeg-location")
        .arg(&ffmpeg_dir)
        .arg("--merge-output-format")
        .arg("mp4")
        .arg("-f")
        .arg(&format)
        .arg("-o")
        .arg(out_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string())
        .arg("--print")
        .arg("after_move:filepath")
        .arg(&url)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run yt-dlp: {e}"))?;

    // Drain stderr on a thread so a full pipe never deadlocks the download.
    // yt-dlp also writes its progress bar to stderr — emit percent events.
    let stderr = child.stderr.take().unwrap();
    let app2 = app.clone();
    let err_handle = std::thread::spawn(move || {
        let mut s = String::new();
        for line in BufReader::new(stderr).lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            if let Some(p) = parse_progress_percent(&line) {
                let _ = app2.emit("amp:dl-progress", p);
            }
            s.push_str(&line);
            s.push('\n');
        }
        s
    });

    // stdout: progress lines during download, final filepath last.
    let stdout = child.stdout.take().unwrap();
    let mut lines: Vec<String> = Vec::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.unwrap_or_default();
        if let Some(p) = parse_progress_percent(&line) {
            let _ = app.emit("amp:dl-progress", p);
        }
        lines.push(line);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr_str = err_handle.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("yt-dlp failed: {}", stderr_str.trim()));
    }
    lines
        .iter()
        .rev()
        .map(|l| l.trim().to_string())
        .find(|l| Path::new(l).is_file())
        .ok_or_else(|| "yt-dlp finished but no file path was returned".to_string())
}

struct CloseToTray(std::sync::Mutex<bool>);

#[tauri::command]
fn set_close_to_tray(state: tauri::State<CloseToTray>, enabled: bool) {
    if let Ok(mut v) = state.0.lock() {
        *v = enabled;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CloseToTray(std::sync::Mutex::new(true)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            scan_folders,
            scan_files,
            read_cover,
            write_tags,
            file_exists,
            save_recording,
            download_youtube,
            set_close_to_tray
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Animo", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
            let next = MenuItem::with_id(app, "next", "Next track", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &toggle, &next, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("Animo Media Player")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "toggle" => {
                        let _ = app.emit_to("main", "amp:tray-cmd", "toggle");
                    }
                    "next" => {
                        let _ = app.emit_to("main", "amp:tray-cmd", "next");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let enabled = window
                        .state::<CloseToTray>()
                        .0
                        .lock()
                        .map(|v| *v)
                        .unwrap_or(true);
                    if enabled {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Animo Media Player");
}
