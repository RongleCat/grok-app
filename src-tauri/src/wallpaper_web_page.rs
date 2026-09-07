//! Structured image discovery from safely fetched public HTML pages.

use std::collections::HashSet;

use scraper::{Html, Selector};
use serde_json::Value;
use url::Url;

const MAX_IMAGE_CANDIDATES: usize = 12;
const MAX_TEXT_CHARS: usize = 240;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WebPageMetadata {
    pub(crate) source_url: String,
    pub(crate) source_name: String,
    pub(crate) title: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) author_name: Option<String>,
    pub(crate) image_urls: Vec<String>,
}

fn clean_text(value: &str) -> Option<String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.chars().take(MAX_TEXT_CHARS).collect())
    }
}

fn normalized_content_type(value: Option<&str>) -> &str {
    value.unwrap_or("").split(';').next().unwrap_or("").trim()
}

fn safe_image_url(base: &Url, raw: &str) -> Option<String> {
    let url = base.join(raw.trim()).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    url.host_str()?;
    Some(url.to_string())
}

fn parse_dimension(value: Option<&str>) -> Option<u32> {
    value?.trim().trim_end_matches("px").parse::<u32>().ok()
}

fn largest_srcset_url(value: &str) -> Option<String> {
    value
        .split(',')
        .filter_map(|candidate| {
            let mut parts = candidate.split_whitespace();
            let url = parts.next()?.trim();
            if url.is_empty() {
                return None;
            }
            let descriptor = parts.next().unwrap_or("1x");
            let score = descriptor
                .strip_suffix('w')
                .and_then(|raw| raw.parse::<u64>().ok())
                .map(|width| width.saturating_mul(1_000))
                .or_else(|| {
                    descriptor
                        .strip_suffix('x')
                        .and_then(|raw| raw.parse::<f64>().ok())
                        .map(|density| (density * 1_000_000.0) as u64)
                })
                .unwrap_or_default();
            Some((score, url.to_string()))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, url)| url)
}

fn collect_json_images(value: &Value, out: &mut Vec<String>, depth: usize) {
    if depth > 8 || out.len() >= MAX_IMAGE_CANDIDATES * 2 {
        return;
    }
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if matches!(
                    key.to_ascii_lowercase().as_str(),
                    "image" | "thumbnailurl" | "contenturl"
                ) {
                    collect_json_image_value(value, out, depth + 1);
                } else if matches!(key.as_str(), "@graph" | "mainEntity" | "subjectOf") {
                    collect_json_images(value, out, depth + 1);
                }
            }
        }
        Value::Array(values) => {
            for value in values.iter().take(24) {
                collect_json_images(value, out, depth + 1);
            }
        }
        _ => {}
    }
}

fn collect_json_image_value(value: &Value, out: &mut Vec<String>, depth: usize) {
    match value {
        Value::String(url) => out.push(url.clone()),
        Value::Array(values) => {
            for value in values.iter().take(16) {
                collect_json_image_value(value, out, depth + 1);
            }
        }
        Value::Object(object) => {
            for key in ["url", "contentUrl", "thumbnailUrl"] {
                if let Some(Value::String(url)) = object.get(key) {
                    out.push(url.clone());
                }
            }
            if depth <= 8 {
                collect_json_images(value, out, depth + 1);
            }
        }
        _ => {}
    }
}

pub(crate) fn parse_web_page(
    final_url: &Url,
    content_type: Option<&str>,
    body: &[u8],
) -> Result<WebPageMetadata, String> {
    let mime = normalized_content_type(content_type).to_ascii_lowercase();
    if !matches!(mime.as_str(), "text/html" | "application/xhtml+xml") {
        return Err("web_page_not_html".into());
    }
    let html = std::str::from_utf8(body).map_err(|_| "web_page_invalid_text".to_string())?;
    let document = Html::parse_document(html);
    let meta_selector = Selector::parse("meta").expect("static meta selector");
    let title_selector = Selector::parse("title").expect("static title selector");
    let script_selector =
        Selector::parse("script[type='application/ld+json']").expect("static JSON-LD selector");
    let link_selector = Selector::parse("link[href]").expect("static link selector");
    let image_selector = Selector::parse("img").expect("static image selector");

    let mut title = None;
    let mut description = None;
    let mut author_name = None;
    let mut raw_images = Vec::new();
    for element in document.select(&meta_selector) {
        let attrs = element.value();
        let key = attrs
            .attr("property")
            .or_else(|| attrs.attr("name"))
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let Some(content) = attrs.attr("content").and_then(clean_text) else {
            continue;
        };
        match key.as_str() {
            "og:image"
            | "og:image:url"
            | "og:image:secure_url"
            | "twitter:image"
            | "twitter:image:src" => raw_images.push(content),
            "og:title" | "twitter:title" if title.is_none() => title = Some(content),
            "og:description" | "twitter:description" | "description" if description.is_none() => {
                description = Some(content)
            }
            "author" | "article:author" if author_name.is_none() => author_name = Some(content),
            _ => {}
        }
    }
    if title.is_none() {
        title = document
            .select(&title_selector)
            .next()
            .and_then(|element| clean_text(&element.text().collect::<Vec<_>>().join(" ")));
    }
    for script in document.select(&script_selector).take(12) {
        let raw = script.text().collect::<String>();
        if raw.len() > 256 * 1024 {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            collect_json_images(&value, &mut raw_images, 0);
        }
    }
    for element in document.select(&link_selector).take(24) {
        let attrs = element.value();
        let rel = attrs.attr("rel").unwrap_or("").to_ascii_lowercase();
        let is_image_source = rel.split_whitespace().any(|value| value == "image_src");
        let is_image_preload = rel.split_whitespace().any(|value| value == "preload")
            && attrs
                .attr("as")
                .is_some_and(|value| value.eq_ignore_ascii_case("image"));
        if is_image_source || is_image_preload {
            if let Some(url) = attrs.attr("href") {
                raw_images.push(url.to_string());
            }
        }
    }
    for element in document.select(&image_selector).take(80) {
        let attrs = element.value();
        let width = parse_dimension(attrs.attr("width"));
        let height = parse_dimension(attrs.attr("height"));
        if width.is_some_and(|value| value < 320) || height.is_some_and(|value| value < 240) {
            continue;
        }
        if let Some(srcset) = attrs
            .attr("data-srcset")
            .or_else(|| attrs.attr("srcset"))
            .and_then(largest_srcset_url)
        {
            raw_images.push(srcset);
        }
        if let Some(url) = ["data-original", "data-lazy-src", "data-src", "src"]
            .iter()
            .find_map(|name| attrs.attr(name))
        {
            raw_images.push(url.to_string());
        }
    }

    let mut seen = HashSet::new();
    let mut image_urls = Vec::new();
    for raw in raw_images {
        let Some(url) = safe_image_url(final_url, &raw) else {
            continue;
        };
        if seen.insert(url.clone()) {
            image_urls.push(url);
            if image_urls.len() == MAX_IMAGE_CANDIDATES {
                break;
            }
        }
    }
    let source_name = final_url
        .host_str()
        .ok_or_else(|| "web_page_missing_host".to_string())?
        .trim_start_matches("www.")
        .to_string();
    Ok(WebPageMetadata {
        source_url: final_url.to_string(),
        source_name,
        title,
        description,
        author_name,
        image_urls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_open_graph_relative_and_json_ld_images() {
        let page = Url::parse("https://photos.example/articles/mountains").unwrap();
        let html = br#"
          <html><head>
            <title>Fallback title</title>
            <meta property="og:title" content="Misty Mountains">
            <meta name="description" content="A wide mountain scene">
            <meta name="author" content="A. Photographer">
            <meta property="og:image" content="/media/hero.jpg">
            <meta name="twitter:image" content="https://cdn.example/thumb.webp">
            <script type="application/ld+json">
              {"@type":"ImageObject","contentUrl":"https://cdn.example/original.jpg"}
            </script>
          </head></html>
        "#;
        let metadata = parse_web_page(&page, Some("text/html; charset=utf-8"), html).unwrap();
        assert_eq!(metadata.title.as_deref(), Some("Misty Mountains"));
        assert_eq!(metadata.author_name.as_deref(), Some("A. Photographer"));
        assert_eq!(metadata.source_name, "photos.example");
        assert_eq!(
            metadata.image_urls,
            vec![
                "https://photos.example/media/hero.jpg",
                "https://cdn.example/thumb.webp",
                "https://cdn.example/original.jpg",
            ]
        );
    }

    #[test]
    fn rejects_non_html_and_filters_unsafe_image_schemes() {
        let page = Url::parse("https://photos.example/page").unwrap();
        assert_eq!(
            parse_web_page(&page, Some("application/json"), b"{}").unwrap_err(),
            "web_page_not_html"
        );
        let html = br#"
          <meta property="og:image" content="http://cdn.example/insecure.jpg">
          <meta property="og:image" content="https://user:pass@cdn.example/secret.jpg">
          <meta property="og:image" content="javascript:alert(1)">
          <meta property="og:image" content="https://cdn.example/good.jpg">
        "#;
        let metadata = parse_web_page(&page, Some("text/html"), html).unwrap();
        assert_eq!(metadata.image_urls, vec!["https://cdn.example/good.jpg"]);
    }

    #[test]
    fn extracts_preloaded_lazy_and_largest_responsive_images() {
        let page = Url::parse("https://photos.example/gallery").unwrap();
        let html = br#"
          <link rel="image_src" href="/media/lead.jpg">
          <img width="120" height="80" src="/media/icon.png">
          <img width="1600" height="900"
               src="/media/fallback.jpg"
               srcset="/media/small.jpg 640w, /media/large.jpg 1920w">
          <img data-src="https://cdn.example/lazy.webp">
        "#;
        let metadata = parse_web_page(&page, Some("text/html"), html).unwrap();
        assert_eq!(
            metadata.image_urls,
            vec![
                "https://photos.example/media/lead.jpg",
                "https://photos.example/media/large.jpg",
                "https://photos.example/media/fallback.jpg",
                "https://cdn.example/lazy.webp",
            ]
        );
    }
}
