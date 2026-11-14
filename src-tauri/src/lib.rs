use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{ItemKey, ItemValue, TagExt, TagItem};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufReader, Read, Seek, SeekFrom};
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

/// Read a whole media file into memory and return raw bytes over the fast
/// IPC channel — the frontend plays it via a Blob URL. This is the fallback
/// when the embedded HTTP server can't be reached (e.g. a firewall blocks
/// the loopback listener).
#[tauri::command]
fn read_media_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
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

/// Feed each completed output fragment to `on_line`, splitting on both
/// \n and \r — yt-dlp's progress bar uses carriage returns on Windows.
fn read_fragments<R: Read>(reader: R, mut on_line: impl FnMut(&str)) {
    let mut br = BufReader::new(reader);
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    while br.read(&mut byte).unwrap_or(0) == 1 {
        if byte[0] == b'\n' || byte[0] == b'\r' {
            if !buf.is_empty() {
                on_line(&String::from_utf8_lossy(&buf));
                buf.clear();
            }
        } else {
            buf.push(byte[0]);
        }
    }
    if !buf.is_empty() {
        on_line(&String::from_utf8_lossy(&buf));
    }
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

    // Snapshot the download dir so the new file can be found afterward even
    // if yt-dlp's printed path can't be parsed (Windows output varies).
    let before: HashSet<PathBuf> = std::fs::read_dir(&out_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).collect())
        .unwrap_or_default();

    let mut cmd = std::process::Command::new(&bin);
    cmd.env("PATH", path_env)
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
        .stderr(std::process::Stdio::piped());
    // On Windows, spawning a console app from a GUI app pops a console
    // window — suppress it.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Could not run yt-dlp: {e}"))?;

    // Drain stderr on a thread so a full pipe never deadlocks the download.
    // yt-dlp also writes its progress bar to stderr — emit percent events.
    let stderr = child.stderr.take().unwrap();
    let app2 = app.clone();
    let err_handle = std::thread::spawn(move || {
        let mut s = String::new();
        read_fragments(stderr, |line| {
            if let Some(p) = parse_progress_percent(line) {
                let _ = app2.emit("amp:dl-progress", p);
            }
            s.push_str(line);
            s.push('\n');
        });
        s
    });

    // stdout: progress lines during download, final filepath last.
    let stdout = child.stdout.take().unwrap();
    let mut lines: Vec<String> = Vec::new();
    read_fragments(stdout, |line| {
        if let Some(p) = parse_progress_percent(line) {
            let _ = app.emit("amp:dl-progress", p);
        }
        lines.push(line.to_string());
    });
    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr_str = err_handle.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("yt-dlp failed: {}", stderr_str.trim()));
    }
    // Prefer the printed filepath; fall back to the newest new file in the
    // download dir.
    let path = lines
        .iter()
        .rev()
        .map(|l| l.trim().to_string())
        .find(|l| Path::new(l).is_file())
        .or_else(|| {
            std::fs::read_dir(&out_dir)
                .ok()?
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file() && !before.contains(p))
                .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok())
                .map(|p| p.to_string_lossy().to_string())
        })
        .ok_or_else(|| "yt-dlp finished but no file path was returned".to_string())?;
    Ok(path)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn media_mime(path: &str) -> &'static str {
    match path
        .rsplit('.')
        .next()
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("wav") => "audio/wav",
        Some("aac") => "audio/aac",
        Some("m4a") => "audio/mp4",
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Read a media file for the localhost media server, honoring an optional
/// "start-end" byte range (already stripped of the "bytes=" prefix).
/// Returns (is_partial, start, end, total_len, bytes).
fn media_parts(
    path: &str,
    range: Option<&str>,
) -> Result<(bool, u64, u64, u64, Vec<u8>), ()> {
    let len = std::fs::metadata(path).map_err(|_| ())?.len();
    let (start, end, partial) = if let Some(r) = range {
        let mut it = r.split('-');
        let s: u64 = it
            .next()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(0)
            .min(len.saturating_sub(1));
        let e: u64 = it
            .next()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(len.saturating_sub(1))
            .min(len.saturating_sub(1));
        (s, e.max(s), true)
    } else {
        (0u64, len.saturating_sub(1), false)
    };

    let mut file = std::fs::File::open(path).map_err(|_| ())?;
    let mut buf = vec![0u8; end.saturating_sub(start).saturating_add(1) as usize];
    file.seek(SeekFrom::Start(start)).map_err(|_| ())?;
    file.read_exact(&mut buf).map_err(|_| ())?;
    Ok((partial, start, end, len, buf))
}

static MEDIA_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();

#[tauri::command]
fn media_port() -> u16 {
    MEDIA_PORT.get().copied().unwrap_or(0)
}

/// CORS + Private Network Access headers — Chromium requires the
/// Allow-Private-Network header (and the OPTIONS preflight below) for
/// public-origin pages to reach a loopback server.
fn add_cors_headers<R: std::io::Read>(resp: &mut tiny_http::Response<R>) {
    for (k, v) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Private-Network", "true"),
        ("Access-Control-Allow-Methods", "GET, OPTIONS"),
        ("Access-Control-Allow-Headers", "*"),
    ] {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            resp.add_header(h);
        }
    }
}

fn handle_media_req(req: tiny_http::Request) {
    // PNA/CORS preflight — WebView2 sends this before media fetches.
    if *req.method() == tiny_http::Method::Options {
        let mut resp = tiny_http::Response::empty(200);
        add_cors_headers(&mut resp);
        let _ = req.respond(resp);
        return;
    }

    let path = percent_decode(req.url().trim_start_matches('/'));
    let range = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("range"))
        .and_then(|h| h.value.as_str().strip_prefix("bytes=").map(|s| s.to_string()));

    match media_parts(&path, range.as_deref()) {
        Ok((partial, start, end, len, buf)) => {
            let mut resp = tiny_http::Response::from_data(buf)
                .with_status_code(tiny_http::StatusCode(if partial { 206 } else { 200 }));
            let headers: Vec<(&str, String)> = [
                ("Content-Type", media_mime(&path).to_string()),
                ("Accept-Ranges", "bytes".to_string()),
            ]
            .into_iter()
            .chain(if partial {
                vec![(
                    "Content-Range",
                    format!("bytes {start}-{end}/{len}"),
                )]
            } else {
                vec![]
            })
            .collect();
            for (k, v) in headers {
                if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
                    resp.add_header(h);
                }
            }
            add_cors_headers(&mut resp);
            let _ = req.respond(resp);
        }
        Err(_) => {
            let mut resp = tiny_http::Response::empty(404);
            add_cors_headers(&mut resp);
            let _ = req.respond(resp);
        }
    }
}

/// Embedded HTTP server so media elements can stream files by URL —
/// local, mapped-drive, and UNC network paths alike, on every platform.
fn start_media_server() {
    std::thread::spawn(|| {
        for port in 48760u16..48780 {
            if let Ok(server) = tiny_http::Server::http(("127.0.0.1", port)) {
                let _ = MEDIA_PORT.set(port);
                for req in server.incoming_requests() {
                    std::thread::spawn(move || handle_media_req(req));
                }
                return;
            }
        }
    });
}

/// Resolve a bundled binary: dev source tree -> bundled resource -> PATH.
fn resolve_binary(app: &tauri::AppHandle, name: &str) -> PathBuf {
    let exe = std::env::consts::EXE_SUFFIX;
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("binaries/{name}{exe}"));
    if dev.is_file() {
        return dev;
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join(format!("binaries/{name}{exe}"));
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from(format!("{name}{exe}"))
}

/// Transcode a media file to MP3 via the bundled ffmpeg — used as a
/// fallback when the webview can't decode a file (e.g. ALAC-in-m4a on
/// Windows). Output goes to app-data/converted/<name>.mp3.
#[tauri::command]
fn convert_to_mp3(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let ffmpeg = resolve_binary(&app, "ffmpeg");
    let out_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("converted");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let stem = Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "converted".into());
    let out = out_dir.join(format!("{stem}.mp3"));

    let mut cmd = std::process::Command::new(&ffmpeg);
    cmd.arg("-y")
        .arg("-i")
        .arg(&path)
        .arg("-vn")
        .arg("-b:a")
        .arg("192k")
        .arg(&out)
        .stdout(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out2 = out.clone();
    let status = cmd
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("Could not run ffmpeg: {e}"))?;
    if !status.success() || !out2.is_file() {
        return Err("ffmpeg could not convert this file".into());
    }
    Ok(out2.to_string_lossy().to_string())
}

/// Grab a thumbnail frame from a video via the bundled ffmpeg — the webview
/// can't decode every container, so ffmpeg renders a small JPEG for the
/// track list instead. Tries 1s in first (skips all-black intros), then 0.
#[tauri::command]
fn video_thumbnail(app: tauri::AppHandle, path: String) -> Option<CoverArt> {
    let ffmpeg = resolve_binary(&app, "ffmpeg");
    for ss in ["1", "0"] {
        let mut cmd = std::process::Command::new(&ffmpeg);
        cmd.arg("-ss")
            .arg(ss)
            .arg("-i")
            .arg(&path)
            .arg("-frames:v")
            .arg("1")
            .arg("-vf")
            .arg("scale=480:-2")
            .arg("-f")
            .arg("image2pipe")
            .arg("-vcodec")
            .arg("mjpeg")
            .arg("-")
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        if let Ok(out) = cmd.output() {
            if out.status.success() && !out.stdout.is_empty() {
                return Some(CoverArt {
                    mime: "image/jpeg".into(),
                    base64: base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        &out.stdout,
                    ),
                });
            }
        }
    }
    None
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
        .setup(|app| {
            start_media_server();

            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            let menu = Menu::with_items(app, &[
                &Submenu::with_items(app, "File", true, &[
                    &MenuItem::with_id(app, "add-files", "Add local files…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "add-link", "Add from link…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some("Quit"))?,
                ])?,
                &Submenu::with_items(app, "Playback", true, &[
                    &MenuItem::with_id(app, "toggle-play", "Play / Pause", true, None::<&str>)?,
                    &MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?,
                    &MenuItem::with_id(app, "next", "Next", true, None::<&str>)?,
                ])?,
            ])?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, ev| {
                let _ = app.emit("amp:menu", ev.id().0.clone());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folders,
            scan_files,
            read_cover,
            video_thumbnail,
            write_tags,
            file_exists,
            read_media_file,
            convert_to_mp3,
            media_port,
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
