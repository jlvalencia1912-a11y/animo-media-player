use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagExt, TagItem};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

const AUDIO_EXTENSIONS: [&str; 5] = ["mp3", "flac", "wav", "aac", "m4a"];

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

fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
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
            if !p.is_file() || !is_audio(p) {
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
