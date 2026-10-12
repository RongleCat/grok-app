//! Text shaping for the follow-up turn: bounding a field to a budget, and
//! scrubbing the credential shapes a comment can paste into it.

pub(super) fn clamp_text(raw: &str, max: usize) -> String {
    let s = raw.replace("\r\n", "\n");
    let s = s.trim();
    if max == 0 {
        return String::new();
    }
    if s.chars().count() <= max {
        return s.to_string();
    }
    let keep = max.saturating_sub(1).max(1);
    let head: String = s.chars().take(keep).collect();
    format!("{}…", head.trim_end())
}

/// Scrub the credential shapes a comment can paste into a prompt.
///
/// Mirrors `src/lib/redact.ts`: `sk-…`, `xai-…` and `Bearer …` values.
pub(super) fn redact(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        let secret_end = secret_span_end(bytes, i);
        if let Some(end) = secret_end {
            out.push_str("[REDACTED]");
            i = end;
            continue;
        }
        let len = utf8_len(bytes[i]);
        let end = (i + len).min(text.len());
        out.push_str(&text[i..end]);
        i = end;
    }
    out
}

/// End of a credential starting at `start`, when one starts there.
fn secret_span_end(bytes: &[u8], start: usize) -> Option<usize> {
    let alnum_rest = |from: usize| {
        let mut j = from;
        while j < bytes.len() && bytes[j].is_ascii_alphanumeric() {
            j += 1;
        }
        j
    };
    for prefix in [b"sk-".as_slice(), b"xai-".as_slice()] {
        if bytes[start..].starts_with(prefix) {
            let end = alnum_rest(start + prefix.len());
            if end - (start + prefix.len()) >= 10 && boundary_after(bytes, end) {
                return Some(end);
            }
        }
    }
    if bytes[start..].starts_with(b"Bearer ") || bytes[start..].starts_with(b"bearer ") {
        let mut j = start + 7;
        while j < bytes.len()
            && (bytes[j].is_ascii_alphanumeric() || b"-._~+/=".contains(&bytes[j]))
        {
            j += 1;
        }
        if j > start + 7 {
            return Some(j);
        }
    }
    None
}

/// True when a credential ends at a word boundary (not mid-token).
fn boundary_after(bytes: &[u8], end: usize) -> bool {
    match bytes.get(end) {
        None => true,
        Some(b) => !b.is_ascii_alphanumeric() && *b != b'-' && *b != b'_',
    }
}

fn utf8_len(first: u8) -> usize {
    if first < 0x80 {
        1
    } else if first >> 5 == 0b110 {
        2
    } else if first >> 4 == 0b1110 {
        3
    } else if first >> 3 == 0b11110 {
        4
    } else {
        1
    }
}
