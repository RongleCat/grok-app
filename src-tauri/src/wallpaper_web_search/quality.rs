use std::collections::{HashMap, HashSet};

use url::Url;

use super::{MAX_IMAGES_PER_SOURCE_PAGE, SAME_SHAPE_ASPECT_TOLERANCE};
use crate::wallpaper_source::WallpaperGalleryItem;

fn is_transform_query_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "w" | "width"
            | "h"
            | "height"
            | "q"
            | "quality"
            | "fit"
            | "crop"
            | "rect"
            | "auto"
            | "format"
            | "fm"
            | "dpr"
            | "resize"
            | "scale"
            | "sharp"
            | "usm"
            | "ixlib"
            | "ixid"
            | "download"
    )
}

fn is_transform_path_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "large_2x" | "non_2x" | "large" | "medium" | "small" | "thumbnail"
    ) {
        return true;
    }
    lower.contains(',')
        && lower.split(',').all(|part| {
            ["w_", "h_", "c_", "q_", "f_", "dpr_", "ar_", "g_", "e_"]
                .iter()
                .any(|prefix| part.starts_with(prefix))
        })
}

fn strip_dimension_suffix(stem: &str) -> &str {
    let Some(separator) = stem.rfind(['-', '_']) else {
        return stem;
    };
    let dimensions = &stem[separator + 1..];
    let Some((width, height)) = dimensions.split_once(['x', 'X']) else {
        return stem;
    };
    if width.len() < 3
        || height.len() < 3
        || !width.chars().all(|value| value.is_ascii_digit())
        || !height.chars().all(|value| value.is_ascii_digit())
    {
        return stem;
    }
    &stem[..separator]
}

fn normalized_variant_path(path: &str) -> String {
    let segments = path
        .split('/')
        .filter(|segment| !segment.is_empty() && !is_transform_path_segment(segment))
        .collect::<Vec<_>>();
    let mut normalized = Vec::with_capacity(segments.len());
    for (index, segment) in segments.iter().enumerate() {
        if index + 1 != segments.len() {
            normalized.push((*segment).to_ascii_lowercase());
            continue;
        }
        let (stem, extension) = segment
            .rsplit_once('.')
            .map(|(stem, extension)| (stem, Some(extension)))
            .unwrap_or((segment, None));
        let stem = strip_dimension_suffix(stem)
            .strip_suffix("@2x")
            .unwrap_or(strip_dimension_suffix(stem));
        normalized.push(match extension {
            Some(extension) => format!(
                "{}.{}",
                stem.to_ascii_lowercase(),
                extension.to_ascii_lowercase()
            ),
            None => stem.to_ascii_lowercase(),
        });
    }
    format!("/{}", normalized.join("/"))
}

fn alphacoders_media_id(host: &str, path: &str) -> Option<String> {
    if host != "alphacoders.com" && !host.ends_with(".alphacoders.com") {
        return None;
    }
    let filename = path.rsplit('/').next()?.split('.').next()?;
    filename
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| part.len() >= 4)
        .max_by_key(|part| part.len())
        .map(|id| format!("alphacoders:{id}"))
}

pub(super) fn media_variant_identity(item: &WallpaperGalleryItem) -> String {
    let Ok(url) = Url::parse(item.full_url.trim()) else {
        return item.full_url.trim().to_ascii_lowercase();
    };
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return item.full_url.trim().to_ascii_lowercase();
    };
    if let Some(identity) = alphacoders_media_id(&host, url.path()) {
        return identity;
    }
    let path = normalized_variant_path(url.path());
    let mut query = url
        .query_pairs()
        .filter(|(key, _)| !is_transform_query_key(key))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    query.sort_unstable();
    let query = if query.is_empty() {
        String::new()
    } else {
        let encoded = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs(query)
            .finish();
        format!("?{encoded}")
    };
    format!("{host}{path}{query}")
}

fn item_identity(item: &WallpaperGalleryItem) -> String {
    let raw = item
        .provenance
        .source_url
        .as_deref()
        .unwrap_or(&item.full_url)
        .trim();
    let Ok(mut url) = Url::parse(raw) else {
        return raw.to_ascii_lowercase();
    };
    url.set_fragment(None);
    url.to_string().to_ascii_lowercase()
}

fn media_identity(item: &WallpaperGalleryItem) -> String {
    item.media_fingerprint
        .as_deref()
        .unwrap_or(&item.full_url)
        .trim()
        .to_ascii_lowercase()
}

fn same_host_title_identity(item: &WallpaperGalleryItem) -> Option<String> {
    let source_url = item.provenance.source_url.as_deref()?;
    let url = Url::parse(source_url).ok()?;
    let host = url
        .host_str()?
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    let title = item
        .text_preview
        .as_deref()?
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    if title
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count()
        < 12
    {
        return None;
    }
    Some(format!("{host}\n{title}"))
}

fn same_source_title_identity(item: &WallpaperGalleryItem, source_key: &str) -> Option<String> {
    let title = same_host_title_identity(item)?;
    let (_, title) = title.split_once('\n')?;
    Some(format!("{source_key}\n{title}"))
}

fn image_aspect_ratio(item: &WallpaperGalleryItem) -> Option<f64> {
    let width = item.width?;
    let height = item.height?;
    if width == 0 || height == 0 {
        return None;
    }
    Some(width as f64 / height as f64)
}

fn same_source_title_shape_seen(
    seen_shapes: &HashMap<String, Vec<f64>>,
    shape_key: Option<&str>,
    aspect_ratio: Option<f64>,
) -> bool {
    let (Some(key), Some(aspect_ratio)) = (shape_key, aspect_ratio) else {
        return false;
    };
    seen_shapes.get(key).is_some_and(|ratios| {
        ratios.iter().any(|seen| {
            (seen - aspect_ratio).abs() / seen.max(aspect_ratio) <= SAME_SHAPE_ASPECT_TOLERANCE
        })
    })
}

fn remember_source_title_shape(
    seen_shapes: &mut HashMap<String, Vec<f64>>,
    shape_key: Option<String>,
    aspect_ratio: Option<f64>,
) {
    if let (Some(key), Some(aspect_ratio)) = (shape_key, aspect_ratio) {
        seen_shapes.entry(key).or_default().push(aspect_ratio);
    }
}

fn title_seen_on_other_source(
    seen_titles: &HashMap<String, HashSet<String>>,
    title_key: Option<&str>,
    source_key: &str,
) -> bool {
    title_key.is_some_and(|key| {
        seen_titles
            .get(key)
            .is_some_and(|sources| sources.iter().any(|source| source != source_key))
    })
}

pub(super) fn merge_items(
    existing: Vec<WallpaperGalleryItem>,
    mut incoming: Vec<WallpaperGalleryItem>,
    limit: usize,
) -> Vec<WallpaperGalleryItem> {
    incoming.sort_by_key(|item| {
        std::cmp::Reverse(
            item.width.unwrap_or_default() as u64 * item.height.unwrap_or_default() as u64,
        )
    });
    let mut source_counts = HashMap::new();
    let mut seen_media = HashSet::new();
    let mut seen_variants = HashSet::new();
    let mut seen_titles: HashMap<String, HashSet<String>> = HashMap::new();
    let mut seen_source_title_shapes = HashMap::new();
    let mut items = Vec::new();
    for item in existing.into_iter().chain(incoming) {
        let source_key = item_identity(&item);
        let media_key = media_identity(&item);
        let variant_key = media_variant_identity(&item);
        let title_key = same_host_title_identity(&item);
        let shape_key = same_source_title_identity(&item, &source_key);
        let aspect_ratio = image_aspect_ratio(&item);
        if source_key.is_empty() || media_key.is_empty() {
            continue;
        }
        if seen_media.contains(&media_key)
            || (!variant_key.is_empty() && seen_variants.contains(&variant_key))
            || title_seen_on_other_source(&seen_titles, title_key.as_deref(), &source_key)
            || same_source_title_shape_seen(
                &seen_source_title_shapes,
                shape_key.as_deref(),
                aspect_ratio,
            )
            || source_counts.get(&source_key).copied().unwrap_or_default()
                >= MAX_IMAGES_PER_SOURCE_PAGE
        {
            continue;
        }
        seen_media.insert(media_key);
        if !variant_key.is_empty() {
            seen_variants.insert(variant_key);
        }
        if let Some(title_key) = title_key {
            seen_titles
                .entry(title_key)
                .or_default()
                .insert(source_key.clone());
        }
        remember_source_title_shape(&mut seen_source_title_shapes, shape_key, aspect_ratio);
        *source_counts.entry(source_key).or_insert(0usize) += 1;
        items.push(item);
    }
    items.truncate(limit);
    items
}

pub(super) fn new_items(
    existing: &[WallpaperGalleryItem],
    candidates: Vec<WallpaperGalleryItem>,
) -> Vec<WallpaperGalleryItem> {
    let mut source_counts = HashMap::new();
    let mut seen_titles: HashMap<String, HashSet<String>> = HashMap::new();
    let mut seen_source_title_shapes = HashMap::new();
    for item in existing {
        let source_key = item_identity(item);
        *source_counts.entry(source_key.clone()).or_insert(0usize) += 1;
        remember_source_title_shape(
            &mut seen_source_title_shapes,
            same_source_title_identity(item, &source_key),
            image_aspect_ratio(item),
        );
        if let Some(title_key) = same_host_title_identity(item) {
            seen_titles.entry(title_key).or_default().insert(source_key);
        }
    }
    let mut seen_media = existing.iter().map(media_identity).collect::<HashSet<_>>();
    let mut seen_variants = existing
        .iter()
        .map(media_variant_identity)
        .filter(|identity| !identity.is_empty())
        .collect::<HashSet<_>>();
    candidates
        .into_iter()
        .filter(|item| {
            let source_key = item_identity(item);
            let media_key = media_identity(item);
            let variant_key = media_variant_identity(item);
            let title_key = same_host_title_identity(item);
            let shape_key = same_source_title_identity(item, &source_key);
            let aspect_ratio = image_aspect_ratio(item);
            if source_key.is_empty()
                || media_key.is_empty()
                || seen_media.contains(&media_key)
                || (!variant_key.is_empty() && seen_variants.contains(&variant_key))
                || title_seen_on_other_source(&seen_titles, title_key.as_deref(), &source_key)
                || same_source_title_shape_seen(
                    &seen_source_title_shapes,
                    shape_key.as_deref(),
                    aspect_ratio,
                )
                || source_counts.get(&source_key).copied().unwrap_or_default()
                    >= MAX_IMAGES_PER_SOURCE_PAGE
            {
                return false;
            }
            seen_media.insert(media_key);
            if !variant_key.is_empty() {
                seen_variants.insert(variant_key);
            }
            if let Some(title_key) = title_key {
                seen_titles
                    .entry(title_key)
                    .or_default()
                    .insert(source_key.clone());
            }
            remember_source_title_shape(&mut seen_source_title_shapes, shape_key, aspect_ratio);
            *source_counts.entry(source_key).or_insert(0usize) += 1;
            true
        })
        .collect()
}
