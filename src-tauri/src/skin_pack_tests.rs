use super::*;
use std::io::Write;
use zip::write::SimpleFileOptions;

fn tmp() -> (std::sync::MutexGuard<'static, ()>, PathBuf) {
    let g = crate::paths::APP_HOME_ENV_LOCK.lock().unwrap();
    let dir = std::env::temp_dir().join(format!(
        "grok-skin-pack-{}-{}",
        std::process::id(),
        Uuid::new_v4()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    std::env::set_var("GROK_APP_HOME", &dir);
    let _ = crate::paths::ensure_app_dirs();
    (g, dir)
}

fn tiny_png() -> Vec<u8> {
    let img = image::RgbImage::from_pixel(8, 8, image::Rgb([20, 80, 160]));
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

fn write_zip(path: &Path, files: &[(&str, &[u8], CompressionMethod)]) {
    let f = File::create(path).unwrap();
    let mut z = ZipWriter::new(f);
    for (name, bytes, method) in files {
        let opts = SimpleFileOptions::default().compression_method(*method);
        z.start_file(*name, opts).unwrap();
        z.write_all(bytes).unwrap();
    }
    z.set_comment(ZIP_COMMENT);
    z.finish().unwrap();
}

fn ocean_manifest(sha: &str, file: &str) -> String {
    format!(
        r#"{{
          "schemaVersion": 1,
          "name": "Harbor dusk",
          "skin": "ocean",
          "scrim": 42,
          "wallpaper": {{
            "file": "{file}",
            "kind": "image",
            "mime": "image/png",
            "name": "harbor.png",
            "width": 8,
            "height": 8,
            "sha256": "{sha}",
            "focus": {{ "cx": 0.46, "cy": 0.38, "zoom": 1.25 }}
          }}
        }}"#
    )
}

#[test]
fn reject_zip_slip() {
    let (_g, dir) = tmp();
    let zip = dir.join("slip.grokskin");
    write_zip(&zip, &[("../evil.txt", b"{}", CompressionMethod::Stored)]);
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("invalid_pack"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_entry_count_bomb() {
    let (_g, dir) = tmp();
    let zip = dir.join("bomb.grokskin");
    let f = File::create(&zip).unwrap();
    let mut z = ZipWriter::new(f);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    z.start_file("manifest.json", opts).unwrap();
    z.write_all(br#"{"schemaVersion":1,"name":"x","skin":"default"}"#)
        .unwrap();
    for i in 0..16 {
        z.start_file(format!("extra{i}.txt"), opts).unwrap();
        z.write_all(b"x").unwrap();
    }
    z.finish().unwrap();
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(
        e.starts_with("too_large") || e.starts_with("invalid_pack"),
        "{e}"
    );
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_uncompressed_cap() {
    let (_g, dir) = tmp();
    let zip = dir.join("huge.grokskin");
    write_zip(
        &zip,
        &[(
            "manifest.json",
            br#"{"schemaVersion":1,"name":"x","skin":"default"}"#,
            CompressionMethod::Stored,
        )],
    );
    // Patch uncompressed size in local + central headers to 300 MiB.
    let mut bytes = fs::read(&zip).unwrap();
    // local header uncompressed size at offset 22
    let huge: u32 = 300 * 1024 * 1024;
    bytes[22..26].copy_from_slice(&huge.to_le_bytes());
    // find EOCD, then central directory
    let eocd = bytes
        .windows(4)
        .rposition(|w| w == [0x50, 0x4b, 0x05, 0x06]);
    if let Some(e) = eocd {
        let cd_off = u32::from_le_bytes(bytes[e + 16..e + 20].try_into().unwrap()) as usize;
        // central header uncompressed size at +24
        if cd_off + 28 < bytes.len() && bytes[cd_off..cd_off + 4] == [0x50, 0x4b, 0x01, 0x02] {
            bytes[cd_off + 24..cd_off + 28].copy_from_slice(&huge.to_le_bytes());
        }
    }
    fs::write(&zip, bytes).unwrap();
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("too_large"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_unknown_top_level() {
    let (_g, dir) = tmp();
    let zip = dir.join("extra.grokskin");
    write_zip(
        &zip,
        &[
            (
                "manifest.json",
                br#"{"schemaVersion":1,"name":"x","skin":"default"}"#,
                CompressionMethod::Deflated,
            ),
            ("theme.css", b"body{}", CompressionMethod::Stored),
        ],
    );
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("invalid_pack"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_missing_manifest() {
    let (_g, dir) = tmp();
    let zip = dir.join("nom.grokskin");
    write_zip(
        &zip,
        &[(
            "preview.jpg",
            &[0xff, 0xd8, 0xff, 0xd9],
            CompressionMethod::Stored,
        )],
    );
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.contains("manifest"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn accepts_case_aliases() {
    let (_g, dir) = tmp();
    let png = tiny_png();
    let sha = sha256_hex(&png);
    let man = ocean_manifest(&sha, "assets/wallpaper.png");
    let zip = dir.join("case.grokskin");
    write_zip(
        &zip,
        &[
            ("Manifest.json", man.as_bytes(), CompressionMethod::Deflated),
            ("ASSETS/WALLPAPER.PNG", &png, CompressionMethod::Stored),
        ],
    );
    let p = inspect_pack(&zip, "file").expect("case alias");
    assert_eq!(p.skin, "ocean");
    assert!(p.wallpaper.is_some());
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_duplicate_normalized_names() {
    let (_g, dir) = tmp();
    let zip = dir.join("dup.grokskin");
    write_zip(
        &zip,
        &[
            (
                "manifest.json",
                br#"{"schemaVersion":1,"name":"a","skin":"default"}"#,
                CompressionMethod::Stored,
            ),
            (
                "MANIFEST.JSON",
                br#"{"schemaVersion":1,"name":"b","skin":"ocean"}"#,
                CompressionMethod::Stored,
            ),
        ],
    );
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("invalid_pack"), "{e}");
    assert!(e.to_lowercase().contains("duplicate"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_unknown_compression() {
    let (_g, dir) = tmp();
    let zip = dir.join("meth.grokskin");
    write_zip(
        &zip,
        &[(
            "manifest.json",
            br#"{"schemaVersion":1,"name":"x","skin":"default"}"#,
            CompressionMethod::Stored,
        )],
    );
    let mut bytes = fs::read(&zip).unwrap();
    // local header compression method at offset 8
    bytes[8..10].copy_from_slice(&99u16.to_le_bytes());
    let eocd = bytes
        .windows(4)
        .rposition(|w| w == [0x50, 0x4b, 0x05, 0x06]);
    if let Some(e) = eocd {
        let cd_off = u32::from_le_bytes(bytes[e + 16..e + 20].try_into().unwrap()) as usize;
        if cd_off + 12 < bytes.len() {
            bytes[cd_off + 10..cd_off + 12].copy_from_slice(&99u16.to_le_bytes());
        }
    }
    fs::write(&zip, bytes).unwrap();
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("invalid_pack"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_tokens_style_css() {
    let (_g, dir) = tmp();
    for key in ["tokens", "style", "css"] {
        let zip = dir.join(format!("{key}.grokskin"));
        let man = format!(r#"{{"schemaVersion":1,"name":"x","skin":"default","{key}":{{}}}}"#);
        write_zip(
            &zip,
            &[("manifest.json", man.as_bytes(), CompressionMethod::Deflated)],
        );
        let e = inspect_pack(&zip, "file").unwrap_err();
        assert!(e.starts_with("unsupported_schema"), "{key}: {e}");
    }
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_schema_not_one() {
    let (_g, dir) = tmp();
    let zip = dir.join("v2.grokskin");
    write_zip(
        &zip,
        &[(
            "manifest.json",
            br#"{"schemaVersion":2,"name":"x","skin":"default"}"#,
            CompressionMethod::Deflated,
        )],
    );
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("unsupported_schema"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn reject_hash_mismatch() {
    let (_g, dir) = tmp();
    let png = tiny_png();
    let man = ocean_manifest(&"ab".repeat(32), "assets/wallpaper.png");
    let zip = dir.join("hash.grokskin");
    write_zip(
        &zip,
        &[
            ("manifest.json", man.as_bytes(), CompressionMethod::Deflated),
            ("assets/wallpaper.png", &png, CompressionMethod::Stored),
        ],
    );
    let e = inspect_pack(&zip, "file").unwrap_err();
    assert!(e.starts_with("hash_mismatch"), "{e}");
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn round_trip_export_inspect() {
    let (_g, dir) = tmp();
    let png = tiny_png();
    let wall = dir.join("src.png");
    fs::write(&wall, &png).unwrap();
    let dest = dir.join("out.grokskin");
    let man = serde_json::json!({
        "schemaVersion": 1,
        "name": "Harbor dusk",
        "skin": "ocean",
        "scrim": 42,
        "themePreference": "dark",
        "wallpaper": {
            "focus": { "cx": 0.46, "cy": 0.38, "zoom": 1.25 }
        }
    });
    export_pack(&dest, &man, Some(&wall)).expect("export");
    let p = inspect_pack(&dest, "file").expect("inspect");
    assert_eq!(p.skin, "ocean");
    assert_eq!(p.scrim, 42);
    assert_eq!(p.name, "Harbor dusk");
    assert!(p.theme_preference.is_none());
    let w = p.wallpaper.as_ref().expect("wallpaper");
    assert_eq!(w.kind, "image");
    assert!(w.bytes > 0);
    assert_eq!(w.focus.as_ref().unwrap()["cx"], 0.46);
    assert!(!p.warnings.iter().any(|x| x == "unknown_skin"));

    let p2 = inspect_pack(&dest, "file").expect("inspect 2");
    assert_eq!(p2.skin, p.skin);
    assert_eq!(p2.scrim, p.scrim);
    assert_eq!(p2.wallpaper.is_some(), p.wallpaper.is_some());
    assert_eq!(p2.warnings, p.warnings);
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}

#[test]
fn inspect_fixture_twice_stable() {
    let (_g, dir) = tmp();
    let png = tiny_png();
    let sha = sha256_hex(&png);
    let man = ocean_manifest(&sha, "assets/wallpaper.png");
    let zip = dir.join("stable.grokskin");
    write_zip(
        &zip,
        &[
            ("manifest.json", man.as_bytes(), CompressionMethod::Deflated),
            ("assets/wallpaper.png", &png, CompressionMethod::Stored),
        ],
    );
    let a = inspect_pack(&zip, "file").expect("run 1");
    let b = inspect_pack(&zip, "file").expect("run 2");
    assert_eq!(a.skin, b.skin);
    assert_eq!(a.scrim, b.scrim);
    assert_eq!(a.wallpaper.is_some(), b.wallpaper.is_some());
    assert_eq!(a.warnings, b.warnings);
    println!(
        "INSPECT_STABLE skin={} scrim={} wallpaper={} warnings={:?}",
        a.skin,
        a.scrim,
        a.wallpaper.is_some(),
        a.warnings
    );
    let _ = fs::remove_dir_all(&dir);
    std::env::remove_var("GROK_APP_HOME");
}
