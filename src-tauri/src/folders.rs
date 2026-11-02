//! What this computer shares, folder by folder.
//!
//! The library used to be one folder. It is a list of sources now: a music share
//! and an audiobooks folder are two roots with their own state, their own
//! exclusions, and their own rows in the index. Two things follow from that, and
//! they are the reason this lives on its own rather than inside the walk:
//!
//! * A folder key is `<source>/<path within it>`. One folder string therefore
//!   names one place on disk even when two sources both contain a `Muse`, which
//!   is what lets the pickers, the audiobook groupings and the exclusions keep
//!   using one key space.
//! * A folder or a single file can be taken out of the catalogue without being
//!   moved or deleted, and the page that does it has to be able to say *why* a
//!   file is not being shared rather than leaving the row out.
//!
//! Nothing here walks a library: the walk in `lib.rs` asks this module which
//! roots to visit and which paths to skip, and the page asks it what one folder
//! on disk contains right now.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::Serialize;

/// A source whose folders are published.
pub(crate) const ACTIVE: &str = "active";
/// A source that is listed - and can be switched back on - but publishes nothing.
pub(crate) const PARKED: &str = "parked";

/// The formats this computer offers to the network. Both the walk and the
/// folder listing ask here, so a file can never be listed as shared and then
/// skipped by the index, or the other way about.
pub(crate) const SHARED_AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "opus"];

/// Audio that is real, understood by a person, and deliberately not offered.
/// Kept apart from "not audio" so the page can say what is wrong with it.
pub(crate) const UNSUPPORTED_AUDIO_EXTENSIONS: &[&str] = &[
    "m4a", "m4b", "mp4", "aac", "alac", "wma", "aiff", "aif", "wv", "ape", "dsf", "dff", "caf", "mpc",
    "mka", "webm",
];

/// How many characters a source name may have. Long enough for a share's real
/// name, short enough to stay a folder key rather than a paragraph.
const MAX_SOURCE_NAME: usize = 64;
/// How many characters a reason may have. It is a note to oneself, not a field.
pub(crate) const MAX_REASON: usize = 200;

/// One folder this computer publishes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Source {
    pub id: i64,
    pub name: String,
    pub path: PathBuf,
    pub state: String,
}

impl Source {
    pub(crate) fn is_active(&self) -> bool {
        self.state == ACTIVE
    }

    /// Where a path relative to this source sits on disk.
    ///
    /// Joined one segment at a time: a folder key is '/'-separated and belongs to
    /// the page, while `Path::join` would leave those separators in place and
    /// produce a path no walk ever wrote - which is exactly how a listing stops
    /// matching the rows it is supposed to explain.
    pub(crate) fn resolve(&self, relative: &str) -> PathBuf {
        let mut path = self.path.clone();
        for segment in relative
            .split(['/', '\\'])
            .filter(|segment| !segment.is_empty())
        {
            path.push(segment);
        }
        path
    }

    /// The folder string a relative path is filed under.
    pub(crate) fn key(&self, relative: &str) -> String {
        let relative = relative.trim_matches('/');
        if relative.is_empty() {
            self.name.clone()
        } else {
            format!("{}/{}", self.name, relative)
        }
    }
}

pub(crate) fn initialise_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS library_sources (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL UNIQUE,
               path TEXT NOT NULL UNIQUE,
               state TEXT NOT NULL DEFAULT 'active',
               created_at TEXT NOT NULL
             );
             -- A folder or a file taken out of the catalogue, with the reason the
             -- person gave. The key is relative to its source and '/'-separated.
             CREATE TABLE IF NOT EXISTS share_exclusions (
               source_id INTEGER NOT NULL,
               kind TEXT NOT NULL,
               key TEXT NOT NULL,
               reason TEXT NOT NULL DEFAULT '',
               created_at TEXT NOT NULL,
               PRIMARY KEY (source_id, kind, key)
             );",
        )
        .map_err(|error| error.to_string())
}

/// Make the folder the settings call `shared_folder` a source of its own.
///
/// Called once at startup. A database from before this page existed has exactly
/// one folder, so the first run adopts it and rewrites the folder keys that were
/// written without a source in front of them. Doing that here rather than in the
/// walk matters: the walk's fast path leaves an unchanged file's row alone, so a
/// key written the old way would survive every rescan.
pub(crate) fn adopt_shared_folder(
    connection: &Connection,
    shared_folder: &str,
) -> Result<(), String> {
    let existing = sources(connection)?;
    if existing.is_empty() {
        if shared_folder.trim().is_empty() {
            return Ok(());
        }
        let name = derive_name(Path::new(shared_folder), &[]);
        connection
            .execute(
                "INSERT INTO library_sources (name, path, state, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![name, shared_folder, ACTIVE, chrono::Utc::now().to_rfc3339()],
            )
            .map_err(|error| error.to_string())?;
        let prefix = format!("{name}/");
        for table in ["files", "local_audiobooks"] {
            connection
                .execute(
                    &format!(
                        "UPDATE {table} SET folder = ?1 || folder WHERE folder NOT LIKE ?2 || '%'"
                    ),
                    params![prefix, prefix],
                )
                .map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    // The first source is the one the settings drive. Its path follows the
    // setting; its name does not, because a name is what the person called it
    // and moving a music folder to another share does not rename the music.
    let first = &existing[0];
    if !shared_folder.trim().is_empty() && first.path != Path::new(shared_folder) {
        connection
            .execute(
                "UPDATE library_sources SET path = ?1 WHERE id = ?2",
                params![shared_folder, first.id],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn sources(connection: &Connection) -> Result<Vec<Source>, String> {
    let mut statement = connection
        .prepare("SELECT id, name, path, state FROM library_sources ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Source {
                id: row.get(0)?,
                name: row.get(1)?,
                path: PathBuf::from(row.get::<_, String>(2)?),
                state: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub(crate) fn active_sources(connection: &Connection) -> Result<Vec<Source>, String> {
    let mut sources = sources(connection)?;
    sources.sort_by_key(|source| source.id);
    Ok(sources.into_iter().filter(Source::is_active).collect())
}

pub(crate) fn source(connection: &Connection, id: i64) -> Result<Source, String> {
    sources(connection)?
        .into_iter()
        .find(|source| source.id == id)
        .ok_or_else(|| "that source is not on this computer".to_string())
}

/// The source a finished download belongs to.
///
/// A download is written into the folder the settings call the Deadwax folder, so
/// normally this is the first source. The lookup by path is what keeps that true
/// when the destination is a share somebody has added as its own source, and the
/// fallback is for a destination that no walk will ever visit - the row is still
/// written, and the next walk withdraws it as it always did.
pub(crate) fn source_for_download(
    connection: &Connection,
    path: &Path,
) -> Result<Source, String> {
    let sources = sources(connection)?;
    sources
        .iter()
        .filter(|source| path.starts_with(&source.path))
        .max_by_key(|source| source.path.as_os_str().len())
        .or_else(|| sources.first())
        .cloned()
        .ok_or_else(|| "no folder is being shared".to_string())
}

/// Turn a path into the short name a source is filed under.
///
/// The last component is nearly always what the person calls the folder, and it
/// is the only part of a path that belongs on screen. `taken` keeps two shares
/// with the same leaf apart, because the name is half of a folder key.
pub(crate) fn derive_name(path: &Path, taken: &[String]) -> String {
    let leaf = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .or_else(|| {
            // A drive root or a share root has no leaf of its own; its drive
            // letter, or the first component of a share's path, is at least
            // recognisable where "Library" would not be.
            path.components()
                .find_map(|component| match component {
                    std::path::Component::Prefix(value) => Some(
                        value
                            .as_os_str()
                            .to_string_lossy()
                            .trim_end_matches(':')
                            .to_string(),
                    ),
                    std::path::Component::Normal(value) => {
                        Some(value.to_string_lossy().into_owned())
                    }
                    _ => None,
                })
        })
        .unwrap_or_else(|| "Library".into());
    let cleaned: String = leaf
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let base = if cleaned.is_empty() {
        "Library".to_string()
    } else {
        cleaned.chars().take(MAX_SOURCE_NAME).collect()
    };
    if !taken.iter().any(|name| name.eq_ignore_ascii_case(&base)) {
        return base;
    }
    for suffix in 2..1000 {
        let candidate = format!("{base} {suffix}");
        if !taken.iter().any(|name| name.eq_ignore_ascii_case(&candidate)) {
            return candidate;
        }
    }
    base
}

/// A path relative to a source root, '/'-separated, with no leading separator.
///
/// This is what the tree, the contents pane and drop-downs all understand, so it
/// is one function rather than a rule repeated at every call site.
pub(crate) fn relative_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let components = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    Some(components.join("/"))
}

pub(crate) fn is_shared_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            SHARED_AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
}

fn is_unsupported_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            UNSUPPORTED_AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
}

/// What an exclusion is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Excluded {
    Folder,
    File,
}

impl Excluded {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Excluded::Folder => "folder",
            Excluded::File => "file",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "folder" => Some(Excluded::Folder),
            "file" => Some(Excluded::File),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exclusion {
    pub kind: Excluded,
    pub key: String,
    pub reason: String,
}

/// Every exclusion, grouped by source.
///
/// Read once per walk rather than once per file: a library of 20,000 files would
/// otherwise ask the database 20,000 questions to answer a question about a
/// handful of exclusions.
pub(crate) fn exclusions(connection: &Connection) -> Result<Vec<(i64, Exclusion)>, String> {
    let mut statement = connection
        .prepare("SELECT source_id, kind, key, reason FROM share_exclusions")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut list = Vec::new();
    for row in rows {
        let (source_id, kind, key, reason) = row.map_err(|error| error.to_string())?;
        if let Some(kind) = Excluded::parse(&kind) {
            list.push((
                source_id,
                Exclusion {
                    kind,
                    key,
                    reason,
                },
            ));
        }
    }
    Ok(list)
}

/// The exclusion that hides this path, if any.
///
/// A folder exclusion covers everything beneath it, which is the whole point of
/// excluding a folder: one row stops a subtree being walked.
pub(crate) fn excluded_by<'a>(list: &'a [Exclusion], relative: &str) -> Option<&'a Exclusion> {
    list.iter().find(|exclusion| match exclusion.kind {
        Excluded::File => exclusion.key == relative,
        Excluded::Folder => {
            relative == exclusion.key
                || relative.starts_with(&format!("{}/", exclusion.key.trim_end_matches('/')))
        }
    })
}

/// One source as the page's card draws it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceRow {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub state: String,
    /// Whether the folder is there right now. A share that is not mounted is the
    /// ordinary reason a source has nothing to offer, and it is not an error.
    pub reachable: bool,
    pub files: u64,
    pub bytes: u64,
    pub folders: u64,
}

/// One row of the folder tree. The page asks for one level at a time, so a
/// library of a hundred thousand files draws a screenful and nothing else.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TreeRow {
    pub source_id: i64,
    pub key: String,
    pub name: String,
    pub path: String,
    pub depth: u32,
    pub files: u64,
    pub shared: bool,
    pub reason: String,
    pub expandable: bool,
}

/// One file inside the chosen folder, and why it is or is not shared.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentRow {
    pub name: String,
    pub size: u64,
    /// `shared`, `excluded`, `notShared` or `ignored`.
    pub status: String,
    /// A code the window turns into words: `excluded`, `unsupportedFormat`,
    /// `notIndexed`, `parked` or `notAudio`. Empty for a shared row.
    pub reason: String,
    /// The format for `unsupportedFormat`, and the person's own words for
    /// `excluded` - which is not translated because somebody typed it.
    pub detail: String,
    pub file_id: String,
    /// The path within its source, which is what an exclusion names. A person
    /// excludes the row they are looking at, and this is that row.
    pub key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FolderContents {
    pub source_id: i64,
    pub key: String,
    pub name: String,
    pub path: String,
    pub rows: Vec<ContentRow>,
    /// Supported audio files in this folder: what *could* be shared.
    pub audio: usize,
    /// How many of those are.
    pub shared: usize,
    /// Files in an audio format this computer will not offer.
    pub unsupported: usize,
    pub folders: usize,
    pub parked: bool,
}

fn count_shared_under(connection: &Connection, source_id: i64, key: &str) -> Result<u64, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM files
             WHERE source_id = ?1
               AND (folder = ?2 OR substr(folder, 1, length(?2) + 1) = ?2 || '/')",
            params![source_id, key],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count.max(0) as u64)
        .map_err(|error| error.to_string())
}

pub(crate) fn source_rows(connection: &Connection) -> Result<Vec<SourceRow>, String> {
    let mut rows = Vec::new();
    for source in sources(connection)? {
        let (files, bytes) = connection
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(size), 0) FROM files WHERE source_id = ?1",
                [source.id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|error| error.to_string())?;
        let folders = connection
            .query_row(
                "SELECT COUNT(DISTINCT folder) FROM files WHERE source_id = ?1",
                [source.id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        rows.push(SourceRow {
            id: source.id,
            name: source.name.clone(),
            path: source.path.to_string_lossy().into_owned(),
            reachable: source.path.is_dir(),
            state: source.state.clone(),
            files: files.max(0) as u64,
            bytes: bytes.max(0) as u64,
            folders: folders.max(0) as u64,
        });
    }
    Ok(rows)
}

/// The tree, one level at a time.
///
/// With no folder chosen the level is the sources themselves; with one, it is the
/// subdirectories of that folder. Only directories are tree rows - a file belongs
/// to the contents pane, which is the only place that can say why it is not
/// shared.
pub(crate) fn tree(
    connection: &Connection,
    source_id: Option<i64>,
    folder: Option<&str>,
) -> Result<Vec<TreeRow>, String> {
    let mut rows = Vec::new();
    match (source_id, folder) {
        (Some(source_id), Some(folder)) => {
            let source = source(connection, source_id)?;
            let list = exclusions_for(connection, source.id)?;
            let relative = strip_source_name(&source.name, folder);
            let directory = source.resolve(&relative);
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                // A folder that has gone is not an error to draw: the rows that
                // were under it are in the contents pane's answer instead.
                Err(_) => return Ok(rows),
            };
            let mut directories = entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .map(|entry| entry.path())
                .collect::<Vec<_>>();
            directories.sort_by_cached_key(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
            });
            for path in directories {
                let Some(child) = relative_path(&directory, &path) else {
                    continue;
                };
                let child_relative = if relative.is_empty() {
                    child
                } else {
                    format!("{relative}/{child}")
                };
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let key = source.key(&child_relative);
                let exclusion = excluded_by(&list, &child_relative);
                rows.push(TreeRow {
                    source_id: source.id,
                    files: count_shared_under(connection, source.id, &key)?,
                    key,
                    depth: child_relative.matches('/').count() as u32 + 1,
                    name,
                    path: path.to_string_lossy().into_owned(),
                    shared: exclusion.is_none(),
                    reason: exclusion.map(|row| row.reason.clone()).unwrap_or_default(),
                    expandable: has_subdirectory(&path),
                });
            }
        }
        _ => {
            for source in active_sources(connection)? {
                if !source.path.is_dir() {
                    continue;
                }
                rows.push(TreeRow {
                    source_id: source.id,
                    files: count_shared_under(connection, source.id, &source.name)?,
                    key: source.name.clone(),
                    name: source.name.clone(),
                    path: source.path.to_string_lossy().into_owned(),
                    depth: 0,
                    shared: true,
                    reason: String::new(),
                    expandable: has_subdirectory(&source.path),
                });
            }
        }
    }
    Ok(rows)
}

fn has_subdirectory(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                    && !entry.file_name().to_string_lossy().starts_with('.')
            })
        })
        .unwrap_or(false)
}

fn exclusions_for(connection: &Connection, source_id: i64) -> Result<Vec<Exclusion>, String> {
    Ok(exclusions(connection)?
        .into_iter()
        .filter(|(id, _)| *id == source_id)
        .map(|(_, exclusion)| exclusion)
        .collect())
}

/// A folder key back to the path within its source.
///
/// The page hands back the key it was given, so the name in front of it is the
/// source's own; a key that does not start with it is treated as already
/// relative, which keeps a hand-written key working.
pub(crate) fn strip_source_name<'a>(name: &str, key: &'a str) -> String {
    key.strip_prefix(name)
        .map(|rest| rest.trim_start_matches('/').to_string())
        .filter(|rest| rest.is_empty() || !key.starts_with(name) || !rest.starts_with(name))
        .unwrap_or_else(|| key.trim_matches('/').to_string())
}

/// What one folder holds, file by file, with the reason each row is or is not
/// being shared.
pub(crate) fn contents(
    connection: &Connection,
    source_id: i64,
    folder: &str,
) -> Result<FolderContents, String> {
    let source = source(connection, source_id)?;
    let relative = strip_source_name(&source.name, folder);
    let key = source.key(&relative);
    let directory = source.resolve(&relative);
    let name = if relative.is_empty() {
        source.name.clone()
    } else {
        relative.rsplit('/').next().unwrap_or(&relative).to_string()
    };
    let list = exclusions_for(connection, source.id)?;
    let mut result = FolderContents {
        source_id: source.id,
        key,
        name,
        path: directory.to_string_lossy().into_owned(),
        rows: Vec::new(),
        audio: 0,
        shared: 0,
        unsupported: 0,
        folders: 0,
        parked: !source.is_active(),
    };
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(result),
    };
    let mut files = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .collect::<Vec<_>>();
    files.sort_by_cached_key(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .to_lowercase()
    });
    for entry in files {
        let path = entry.path();
        let relative_file = if relative.is_empty() {
            relative_path(&directory, &path).unwrap_or_default()
        } else {
            format!(
                "{relative}/{}",
                relative_path(&directory, &path).unwrap_or_default()
            )
        };
        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if is_shared_audio_path(&path) {
            result.audio += 1;
            let indexed: Option<(String, i64)> = connection
                .query_row(
                    "SELECT file_id, size FROM files WHERE path = ?1",
                    [path.to_string_lossy()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();
            let exclusion = excluded_by(&list, &relative_file);
            let row = match (exclusion, indexed) {
                (Some(exclusion), _) => {
                    result.rows.push(ContentRow {
                        name: file_name,
                        size,
                        status: "excluded".into(),
                        reason: "excluded".into(),
                        detail: exclusion.reason.clone(),
                        file_id: String::new(),
                        key: relative_file,
                    });
                    continue;
                }
                (None, Some((file_id, _))) => {
                    result.shared += 1;
                    ContentRow {
                        name: file_name,
                        size,
                        status: "shared".into(),
                        reason: String::new(),
                        detail: String::new(),
                        file_id,
                        key: relative_file,
                    }
                }
                // Audio this computer can share, and is not sharing: either the
                // source is switched off, or the file is new and the walk has not
                // reached it yet.
                (None, None) => ContentRow {
                    name: file_name,
                    size,
                    status: "notShared".into(),
                    reason: if result.parked { "parked" } else { "notIndexed" }.into(),
                    detail: String::new(),
                    file_id: String::new(),
                    key: relative_file,
                },
            };
            result.rows.push(row);
        } else if is_unsupported_audio_path(&path) {
            result.unsupported += 1;
            result.rows.push(ContentRow {
                name: file_name,
                size,
                status: "notShared".into(),
                reason: "unsupportedFormat".into(),
                detail: path
                    .extension()
                    .map(|extension| extension.to_string_lossy().to_uppercase())
                    .unwrap_or_default(),
                file_id: String::new(),
                key: relative_file,
            });
        } else {
            result.rows.push(ContentRow {
                name: file_name,
                size,
                status: "ignored".into(),
                reason: "notAudio".into(),
                detail: String::new(),
                file_id: String::new(),
                key: relative_file,
            });
        }
    }
    result.folders = fs::read_dir(&directory)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    Ok(result)
}

/// Add a folder as a source. Returns the row as the page's card draws it.
pub(crate) fn add_source(connection: &Connection, path: &Path) -> Result<Source, String> {
    if !path.is_dir() {
        return Err("that folder is not on this computer".into());
    }
    let taken = sources(connection)?
        .into_iter()
        .map(|source| source.name)
        .collect::<Vec<_>>();
    let existing_path = sources(connection)?;
    if let Some(found) = existing_path
        .iter()
        .find(|source| source.path == path && source.is_active())
    {
        return Err(format!("{} is already a source", found.name));
    }
    let name = derive_name(path, &taken);
    connection
        .execute(
            "INSERT INTO library_sources (name, path, state, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                name,
                path.to_string_lossy(),
                ACTIVE,
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    source(
        connection,
        connection.last_insert_rowid(),
    )
}

/// Take a source off the network, or put it back. Nothing is deleted: the folder
/// stays where it is, and switching it back on walks it again.
pub(crate) fn set_state(connection: &Connection, id: i64, state: &str) -> Result<Source, String> {
    let entry = source(connection, id)?;
    if state != ACTIVE && state != PARKED {
        return Err("a source is either shared or parked".into());
    }
    connection
        .execute(
            "UPDATE library_sources SET state = ?1 WHERE id = ?2",
            params![state, id],
        )
        .map_err(|error| error.to_string())?;
    if state == PARKED {
        connection
            .execute("DELETE FROM files WHERE source_id = ?1", [id])
            .map_err(|error| error.to_string())?;
        // Audiobooks grouped out of a folder that is no longer shared would be
        // published with no chapters, so the grouping goes with the rows.
        connection
            .execute(
                "DELETE FROM local_audiobooks WHERE folder = ?1 OR folder LIKE ?1 || '/%'",
                [&entry.name],
            )
            .map_err(|error| error.to_string())?;
    }
    source(connection, id)
}

/// The first source is the folder the settings call the Deadwax folder, and it is
/// the one a download is written to; the rest can go, the first cannot.
pub(crate) fn remove_source(connection: &Connection, id: i64) -> Result<Source, String> {
    let sources = sources(connection)?;
    let Some(source) = sources.iter().find(|source| source.id == id).cloned() else {
        return Err("that source is not on this computer".into());
    };
    if sources.len() == 1 {
        return Err("this is the only source; park it instead of removing it".into());
    }
    if sources[0].id == source.id {
        return Err("the Deadwax folder cannot be removed; park it instead".into());
    }
    connection
        .execute("DELETE FROM library_sources WHERE id = ?1", [id])
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM share_exclusions WHERE source_id = ?1",
            [id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM files WHERE source_id = ?1", [id])
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM local_audiobooks WHERE folder = ?1 OR folder LIKE ?1 || '/%'",
            [&source.name],
        )
        .map_err(|error| error.to_string())?;
    Ok(source)
}

/// Stop sharing one folder or one file, and say why.
///
/// The rows that were in the index go immediately rather than at the next walk:
/// a person who just took a folder off the network expects the next published
/// catalogue to say so.
pub(crate) fn exclude(
    connection: &Connection,
    source_id: i64,
    kind: Excluded,
    key: &str,
    reason: &str,
) -> Result<usize, String> {
    let source = source(connection, source_id)?;
    let relative = strip_source_name(&source.name, key);
    if relative.is_empty() {
        return Err("a source is parked rather than excluded".into());
    }
    if relative.starts_with("..") || relative.contains("..\\") {
        return Err("that path leaves its source".into());
    }
    let reason = reason.trim().chars().take(MAX_REASON).collect::<String>();
    connection
        .execute(
            "INSERT OR REPLACE INTO share_exclusions (source_id, kind, key, reason, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                source_id,
                kind.as_str(),
                relative,
                reason,
                chrono::Utc::now().to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    let removed = match kind {
        Excluded::Folder => {
            let folder_key = source.key(&relative);
            connection
                .execute(
                    "DELETE FROM files WHERE source_id = ?1
                       AND (folder = ?2 OR substr(folder, 1, length(?2) + 1) = ?2 || '/')",
                    params![source_id, folder_key],
                )
                .map_err(|error| error.to_string())?
        }
        Excluded::File => connection
            .execute(
                "DELETE FROM files WHERE path = ?1",
                [source.resolve(&relative).to_string_lossy()],
            )
            .map_err(|error| error.to_string())?,
    };
    Ok(removed)
}

/// Share it again. The rows come back on the next walk, which the caller starts.
pub(crate) fn include(
    connection: &Connection,
    source_id: i64,
    kind: Excluded,
    key: &str,
) -> Result<usize, String> {
    let source = source(connection, source_id)?;
    let relative = strip_source_name(&source.name, key);
    connection
        .execute(
            "DELETE FROM share_exclusions WHERE source_id = ?1 AND kind = ?2 AND key = ?3",
            params![source_id, kind.as_str(), relative],
        )
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection
            .execute_batch(
                "CREATE TABLE files (
                   file_id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL,
                   size INTEGER NOT NULL, format TEXT NOT NULL, indexed_at TEXT NOT NULL,
                   folder TEXT NOT NULL DEFAULT '', source_id INTEGER NOT NULL DEFAULT 1
                 );
                 CREATE TABLE local_audiobooks (folder TEXT PRIMARY KEY, title TEXT NOT NULL,
                   author TEXT NOT NULL DEFAULT '', narrator TEXT NOT NULL DEFAULT '',
                   updated_at TEXT NOT NULL);",
            )
            .expect("library schema");
        initialise_schema(&connection).expect("folder schema");
        connection
    }

    fn temporary_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("napstr-folders-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Muse/Absolution (2003)")).expect("album folder");
        fs::create_dir_all(root.join("Podcasts")).expect("podcast folder");
        fs::write(root.join("Muse/Absolution (2003)/01 - Intro.mp3"), b"one").expect("track");
        fs::write(root.join("Muse/Absolution (2003)/cover.jpg"), b"jpg").expect("cover");
        fs::write(root.join("Muse/Absolution (2003)/07 - Hysteria.m4a"), b"m4a").expect("m4a");
        fs::write(root.join("Podcasts/episode.flac"), b"two").expect("podcast");
        root
    }

    /// One indexed row, written the way `upsert_verified_file` writes it: the
    /// absolute path, and the folder key with the source's name in front.
    fn index_row(connection: &Connection, root: &Path, folder_key: &str, name: &str, size: u64) {
        let relative = folder_key.split_once('/').map(|(_, rest)| rest).unwrap_or("");
        // Joined one segment at a time, because `join` with a '/'-separated string
        // leaves those separators alone and no filesystem ever answers with them.
        let mut path = root.to_path_buf();
        for segment in relative.split('/').filter(|segment| !segment.is_empty()) {
            path.push(segment);
        }
        path.push(name);
        connection
            .execute(
                "INSERT INTO files (file_id, filename, path, size, format, indexed_at, folder, source_id)
                 VALUES (?1, ?2, ?3, ?4, 'MP3', 'now', ?5, 1)",
                params![
                    format!("id-{relative}/{name}"),
                    name,
                    path.to_string_lossy(),
                    size as i64,
                    folder_key
                ],
            )
            .expect("index row");
    }

    #[test]
    fn a_name_is_taken_from_the_leaf_and_kept_apart_from_its_twins() {
        assert_eq!(
            derive_name(Path::new("/srv/music/Aristotle"), &[]),
            "Aristotle"
        );
        assert_eq!(
            derive_name(Path::new("/srv/music/Aristotle"), &["aristotle".into()]),
            "Aristotle 2"
        );
        // A share root has no leaf, and still needs a name that fits a key.
        assert_eq!(derive_name(Path::new("/"), &[]), "Library");
        // A drive root is named after the drive rather than "Library", which
        // would be the same word for every drive on the machine.
        assert_eq!(derive_name(Path::new("D:\\"), &[]), "D");
    }

    #[test]
    fn adopting_the_shared_folder_names_the_keys_it_already_wrote() {
        let connection = connection();
        connection
            .execute(
                "INSERT INTO files (file_id, filename, path, size, format, indexed_at, folder)
                 VALUES ('a', 'one.mp3', '/music/Muse/one.mp3', 10, 'MP3', 'now', 'Muse')",
                [],
            )
            .expect("row");
        connection
            .execute(
                "INSERT INTO local_audiobooks (folder, title, updated_at) VALUES ('Books', 'A', 'now')",
                [],
            )
            .expect("audiobook");
        adopt_shared_folder(&connection, "/srv/music").expect("adopt");
        let folder: String = connection
            .query_row("SELECT folder FROM files WHERE file_id='a'", [], |row| row.get(0))
            .expect("folder");
        assert_eq!(folder, "music/Muse");
        let book: String = connection
            .query_row("SELECT folder FROM local_audiobooks", [], |row| row.get(0))
            .expect("book");
        assert_eq!(book, "music/Books");
        // A second run must not put the name in front twice.
        adopt_shared_folder(&connection, "/srv/music").expect("adopt again");
        let folder: String = connection
            .query_row("SELECT folder FROM files WHERE file_id='a'", [], |row| row.get(0))
            .expect("folder");
        assert_eq!(folder, "music/Muse");
    }

    #[test]
    fn a_folder_exclusion_covers_everything_under_it() {
        let list = vec![Exclusion {
            kind: Excluded::Folder,
            key: "Podcasts".into(),
            reason: "not music".into(),
        }];
        assert!(excluded_by(&list, "Podcasts/episode.flac").is_some());
        assert!(excluded_by(&list, "Podcasts").is_some());
        // A sibling whose name merely starts the same way is a different folder.
        assert!(excluded_by(&list, "Podcasts Old/episode.flac").is_none());
        assert!(excluded_by(&list, "Muse/one.mp3").is_none());
    }

    #[test]
    fn a_file_exclusion_hides_one_file_and_nothing_beside_it() {
        let list = vec![Exclusion {
            kind: Excluded::File,
            key: "Muse/interlude.mp3".into(),
            reason: "the rip is silent".into(),
        }];
        assert!(excluded_by(&list, "Muse/interlude.mp3").is_some());
        assert!(excluded_by(&list, "Muse/one.mp3").is_none());
    }

    #[test]
    fn contents_say_what_each_row_is_and_why() {
        let root = temporary_root("contents");
        let connection = connection();
        adopt_shared_folder(&connection, &root.to_string_lossy()).expect("adopt");
        let source = source(&connection, 1).expect("source");
        index_row(
            &connection,
            &root,
            &source.key("Muse/Absolution (2003)"),
            "01 - Intro.mp3",
            3,
        );
        exclude(
            &connection,
            1,
            Excluded::Folder,
            "Podcasts",
            "not music",
        )
        .expect("exclude");

        let album = contents(
            &connection,
            1,
            &source.key("Muse/Absolution (2003)"),
        )
        .expect("contents");
        assert_eq!(album.audio, 1);
        assert_eq!(album.shared, 1);
        assert_eq!(album.unsupported, 1);
        assert_eq!(album.folders, 0);
        let shared = album
            .rows
            .iter()
            .find(|row| row.name == "01 - Intro.mp3")
            .expect("track row");
        assert_eq!(shared.status, "shared");
        assert_eq!(shared.file_id, "id-Muse/Absolution (2003)/01 - Intro.mp3");
        let unsupported = album
            .rows
            .iter()
            .find(|row| row.name == "07 - Hysteria.m4a")
            .expect("m4a row");
        assert_eq!(unsupported.status, "notShared");
        assert_eq!(unsupported.reason, "unsupportedFormat");
        assert_eq!(unsupported.detail, "M4A");
        let ignored = album
            .rows
            .iter()
            .find(|row| row.name == "cover.jpg")
            .expect("cover row");
        assert_eq!(ignored.status, "ignored");

        // An excluded folder keeps its file on disk and loses its rows.
        assert!(root.join("Podcasts/episode.flac").is_file());
        let podcasts = contents(&connection, 1, &source.key("Podcasts")).expect("podcasts");
        assert_eq!(podcasts.audio, 1);
        assert_eq!(podcasts.shared, 0);
        assert_eq!(podcasts.rows[0].status, "excluded");
        assert_eq!(podcasts.rows[0].reason, "excluded");
        assert_eq!(podcasts.rows[0].detail, "not music");

        let children = tree(&connection, Some(1), Some(&source.key("Muse"))).expect("tree");
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "Absolution (2003)");
        assert_eq!(children[0].key, source.key("Muse/Absolution (2003)"));
        assert_eq!(children[0].files, 1);
        assert!(children[0].shared);

        let roots = tree(&connection, Some(1), Some(&source.name)).expect("root level");
        let podcasts_row = roots
            .iter()
            .find(|row| row.name == "Podcasts")
            .expect("podcasts row");
        assert!(!podcasts_row.shared);
        assert_eq!(podcasts_row.reason, "not music");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_parked_source_keeps_its_rows_out_and_says_so() {
        let root = temporary_root("parked");
        let connection = connection();
        adopt_shared_folder(&connection, &root.to_string_lossy()).expect("adopt");
        let album_key = source(&connection, 1)
            .expect("source")
            .key("Muse/Absolution (2003)");
        index_row(&connection, &root, &album_key, "01 - Intro.mp3", 3);
        set_state(&connection, 1, PARKED).expect("park");
        assert!(active_sources(&connection).expect("active").is_empty());
        // Parking withdraws the rows rather than leaving them published.
        let files: i64 = connection
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .expect("count");
        assert_eq!(files, 0);
        let listed = contents(
            &connection,
            1,
            &source(&connection, 1).expect("source").key("Muse/Absolution (2003)"),
        )
        .expect("contents");
        assert!(listed.parked);
        assert_eq!(listed.rows[0].status, "notShared");
        assert_eq!(listed.rows[0].reason, "parked");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_only_source_cannot_be_removed() {
        let root = temporary_root("only");
        let connection = connection();
        adopt_shared_folder(&connection, &root.to_string_lossy()).expect("adopt");
        let error = remove_source(&connection, 1).expect_err("refused");
        assert!(error.contains("only source"));
        let second = add_source(&connection, &root).expect_err("duplicate");
        assert!(second.contains("already a source"));
        let _ = fs::remove_dir_all(&root);
    }
}
