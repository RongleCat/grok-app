//! Bounded library snapshots keep paging stable while files change on disk.

use crate::wallpaper_source::{self, WallpaperLibraryEntry};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

const SNAPSHOT_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SNAPSHOTS: usize = 8;
const MAX_ENTRIES: usize = 100_000;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LibraryQuery {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub purpose: String,
}

impl LibraryQuery {
    fn normalize(mut self) -> Result<Self, String> {
        self.query = self.query.trim().to_lowercase();
        if self.query.chars().count() > 500 {
            return Err("invalid_query".into());
        }
        if self.kind.is_empty() {
            self.kind = "all".into();
        }
        if !matches!(self.kind.as_str(), "all" | "image" | "video") {
            return Err("invalid_query".into());
        }
        if self.purpose.is_empty() {
            self.purpose = "all".into();
        }
        if !matches!(
            self.purpose.as_str(),
            "all" | "favorites" | "generated" | "cache"
        ) {
            return Err("invalid_query".into());
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub(crate) struct KindCounts {
    pub all: usize,
    pub image: usize,
    pub video: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LibraryPage {
    pub items: Vec<WallpaperLibraryEntry>,
    pub next_cursor: Option<String>,
    pub total: usize,
    pub kind_counts: KindCounts,
}

struct Snapshot {
    id: uuid::Uuid,
    root: PathBuf,
    query: LibraryQuery,
    rows: Vec<WallpaperLibraryEntry>,
    counts: KindCounts,
    created: Instant,
    page_size: usize,
}

#[derive(Default)]
struct LibrarySnapshots {
    snapshots: VecDeque<Arc<Snapshot>>,
}

impl LibrarySnapshots {
    fn insert(&mut self, snapshot: Snapshot) -> Arc<Snapshot> {
        self.snapshots
            .retain(|s| s.created.elapsed() < SNAPSHOT_TTL);
        while self.snapshots.len() >= MAX_SNAPSHOTS {
            self.snapshots.pop_front();
        }
        let snapshot = Arc::new(snapshot);
        self.snapshots.push_back(snapshot.clone());
        snapshot
    }

    fn resume(
        &self,
        cursor: &str,
        root: &Path,
        query: &LibraryQuery,
        size: usize,
    ) -> Result<(Arc<Snapshot>, usize), String> {
        let (id, offset) = cursor.split_once(':').ok_or("invalid_cursor")?;
        let id = uuid::Uuid::parse_str(id).map_err(|_| "invalid_cursor")?;
        let offset: usize = offset.parse().map_err(|_| "invalid_cursor")?;
        let snapshot = self
            .snapshots
            .iter()
            .find(|s| s.id == id)
            .ok_or("cursor_expired")?;
        if snapshot.created.elapsed() >= SNAPSHOT_TTL {
            return Err("cursor_expired".into());
        }
        if snapshot.root != root
            || snapshot.query != *query
            || snapshot.page_size != size
            || offset == 0
            || offset >= snapshot.rows.len()
            || !offset.is_multiple_of(size)
        {
            return Err("invalid_cursor".into());
        }
        Ok((snapshot.clone(), offset))
    }
}

static SNAPSHOTS: OnceLock<Mutex<LibrarySnapshots>> = OnceLock::new();

fn snapshot(root: &Path, query: LibraryQuery, page_size: usize) -> Result<Snapshot, String> {
    let query = query.normalize()?;
    let mut rows = Vec::new();
    wallpaper_source::collect_library(root, root, &mut rows);
    if rows.len() > MAX_ENTRIES {
        return Err("library_too_large".into());
    }
    crate::wallpaper_catalog::hydrate(root, &mut rows)?;
    rows.retain(|e| {
        query.purpose == "all"
            || e.metadata.as_ref().is_some_and(|r| {
                if query.purpose == "favorites" {
                    r.favorite
                } else {
                    r.purpose == query.purpose
                }
            })
    });
    rows.retain(|e| {
        query.query.is_empty()
            || format!(
                "{} {} {} {}",
                e.name,
                e.source,
                e.metadata
                    .as_ref()
                    .and_then(|r| r.prompt.as_deref())
                    .unwrap_or(""),
                e.metadata
                    .as_ref()
                    .and_then(|r| r.title.as_deref())
                    .unwrap_or("")
            )
            .to_lowercase()
            .contains(&query.query)
    });
    let counts = KindCounts {
        all: rows.len(),
        image: rows.iter().filter(|e| e.kind == "image").count(),
        video: rows.iter().filter(|e| e.kind == "video").count(),
    };
    rows.retain(|e| query.kind == "all" || e.kind == query.kind);
    rows.sort_by(|a, b| {
        (a.kind != "image", std::cmp::Reverse(a.modified_ms), &a.path).cmp(&(
            b.kind != "image",
            std::cmp::Reverse(b.modified_ms),
            &b.path,
        ))
    });
    Ok(Snapshot {
        id: uuid::Uuid::new_v4(),
        root: root.to_path_buf(),
        query,
        rows,
        counts,
        created: Instant::now(),
        page_size,
    })
}

fn page(snapshot: &Snapshot, offset: usize) -> LibraryPage {
    let end = (offset + snapshot.page_size).min(snapshot.rows.len());
    LibraryPage {
        items: snapshot.rows[offset..end]
            .iter()
            .filter(|row| {
                Path::new(&row.path).is_file()
                    && wallpaper_source::is_path_under_dir(Path::new(&row.path), &snapshot.root)
            })
            .cloned()
            .collect(),
        next_cursor: (end < snapshot.rows.len()).then(|| format!("{}:{end}", snapshot.id)),
        total: snapshot.rows.len(),
        kind_counts: snapshot.counts.clone(),
    }
}

pub(crate) fn list(
    query: LibraryQuery,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> Result<LibraryPage, String> {
    let root = wallpaper_source::wallpapers_root();
    let query = query.normalize()?;
    let limit = limit.unwrap_or(48);
    if !(1..=96).contains(&limit) {
        return Err("invalid_query".into());
    }
    let limit = limit as usize;
    let snapshots = SNAPSHOTS.get_or_init(|| Mutex::new(LibrarySnapshots::default()));
    let (snapshot, offset) = if let Some(cursor) = cursor {
        snapshots.lock().resume(cursor, &root, &query, limit)?
    } else {
        let current = snapshot(&root, query, limit)?;
        (snapshots.lock().insert(current), 0)
    };
    let result = page(&snapshot, offset);
    for row in &result.items {
        crate::path_scope::grant_path(Path::new(&row.path));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("grok-library-page-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for i in 0..251 {
            fs::write(
                root.join(format!(
                    "item-{i:03}.{}",
                    if i % 3 == 0 { "mp4" } else { "png" }
                )),
                b"fixture",
            )
            .unwrap();
        }
        fs::write(root.join(".catalog-preview.png"), b"internal").unwrap();
        root
    }

    #[test]
    fn full_snapshot_pages_without_repeats_and_filters_beyond_first_page() {
        let root = fixture();
        let query = LibraryQuery::default().normalize().unwrap();
        let mut store = LibrarySnapshots::default();
        let snapshot = store.insert(snapshot(&root, query.clone(), 48).unwrap());
        let mut current = page(&snapshot, 0);
        let mut paths = Vec::new();
        loop {
            paths.extend(current.items.into_iter().map(|e| e.path));
            let Some(cursor) = current.next_cursor else {
                break;
            };
            let (snapshot, offset) = store.resume(&cursor, &root, &query, 48).unwrap();
            current = page(&snapshot, offset);
        }
        assert_eq!(paths.len(), 251);
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), 251);
        let filtered = super::snapshot(
            &root,
            LibraryQuery {
                query: "item-250".into(),
                kind: "image".into(),
                ..Default::default()
            },
            48,
        )
        .unwrap();
        assert_eq!(page(&filtered, 0).items.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn filters_saved_favorites_and_prompts_across_the_whole_library() {
        let root = fixture();
        let path = root.join("item-250.png");
        image::RgbImage::new(40, 20).save(&path).unwrap();
        let mut rows = vec![];
        wallpaper_source::collect_library(&root, &root, &mut rows);
        crate::wallpaper_catalog::hydrate(&root, &mut rows).unwrap();
        let file = root.join(".catalog.json");
        let mut catalog: serde_json::Value =
            serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        catalog["records"]["item-250.png"]["favorite"] = true.into();
        catalog["records"]["item-250.png"]["prompt"] = "Secret mountain dawn".into();
        fs::write(&file, serde_json::to_vec(&catalog).unwrap()).unwrap();
        let found = snapshot(
            &root,
            LibraryQuery {
                query: "mountain".into(),
                purpose: "favorites".into(),
                ..Default::default()
            },
            48,
        )
        .unwrap();
        assert_eq!(found.rows.len(), 1);
        assert_eq!(found.rows[0].name, "item-250.png");
        assert_eq!(found.rows[0].metadata.as_ref().unwrap().width, Some(40));
        let empty = snapshot(
            &root,
            LibraryQuery {
                purpose: "generated".into(),
                ..Default::default()
            },
            48,
        )
        .unwrap();
        assert!(empty.rows.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn snapshot_keeps_order_across_changes_and_rejects_mismatched_cursor() {
        let root = fixture();
        let query = LibraryQuery::default().normalize().unwrap();
        let mut store = LibrarySnapshots::default();
        let mut initial = snapshot(&root, query.clone(), 48).unwrap();
        for row in &mut initial.rows {
            row.modified_ms = 123;
        }
        initial.rows.sort_by(|a, b| a.path.cmp(&b.path));
        let snapshot = store.insert(initial);
        let first = page(&snapshot, 0);
        let cursor = first.next_cursor.unwrap();
        let removed = snapshot.rows[48].path.clone();
        fs::remove_file(removed).unwrap();
        fs::write(root.join("new.png"), b"new").unwrap();
        let (same, offset) = store.resume(&cursor, &root, &query, 48).unwrap();
        let next = page(&same, offset);
        assert_eq!(next.items.len(), 47);
        assert!(!next.items.iter().any(|row| row.name == "new.png"));
        assert!(store.resume("bad", &root, &query, 48).is_err());
        assert!(store.resume(&cursor, &root, &query, 24).is_err());
        assert!(store
            .resume(
                &cursor,
                &root,
                &LibraryQuery {
                    query: "new".into(),
                    kind: "all".into(),
                    ..Default::default()
                },
                48
            )
            .is_err());
        assert_eq!(super::snapshot(&root, query, 48).unwrap().rows.len(), 251);
        fs::remove_dir_all(root).unwrap();
    }
}
