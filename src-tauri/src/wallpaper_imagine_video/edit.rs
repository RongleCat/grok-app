//! Image editing shares the bounded source preparation and cancellation registry.

use super::*;
use serde_json::{json, Value};
use std::io::{Read, Write};

pub(crate) fn import_image(
    raw: &str,
    encoded: Option<&str>,
) -> Result<wallpaper_source::WallpaperFetchResult, String> {
    let original = Path::new(raw);
    if !original.is_absolute() {
        return Err("imagine_source_invalid".into());
    }
    // The picker already grants the selected file; IPC cannot grant arbitrary paths.
    if !crate::path_scope::is_allowed(original) {
        return Err("imagine_source_invalid".into());
    }
    wallpaper_source::validate_local_wallpaper_media(original, LocalWallpaperMediaKind::Image)
        .map_err(|_| "imagine_source_invalid")?;
    let dir = wallpaper_source::wallpapers_root()
        .join("uploads")
        .join(uuid::Uuid::new_v4().simple().to_string());
    fs::create_dir_all(&dir).map_err(|_| "imagine_failed")?;
    let result = (|| {
        let snapshot = source::materialize(encoded, original, &dir)?;
        let path = dir.join("source.png");
        fs::rename(snapshot, &path).map_err(|_| "imagine_failed")?;
        let media =
            wallpaper_source::validate_local_wallpaper_media(&path, LocalWallpaperMediaKind::Image)
                .map_err(|_| "imagine_source_invalid")?;
        crate::path_scope::grant_path(&path);
        Ok(wallpaper_source::WallpaperFetchResult {
            path: crate::process_util::strip_extended_path_prefix(&path.to_string_lossy()),
            mime: media.mime.to_string(),
            bytes: media.bytes,
            name: "source.png".into(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&dir);
    }
    result.map_err(str::to_string)
}

pub(crate) fn generate(
    request_id: &str,
    source_path: &str,
    encoded: Option<&str>,
    prompt: &str,
    aspect_ratio: Option<&str>,
) -> Result<WallpaperImagineResult, String> {
    let request_id = normalized_request_id(request_id)?;
    let (token, cancellation) = begin_request(&request_id);
    let result = generate_inner(source_path, encoded, prompt, aspect_ratio, &cancellation);
    if let Err(code) = &result {
        tracing::warn!(%request_id, error_code = %code, "wallpaper image edit failed");
    }
    finish_request(&request_id, token);
    Ok(result.unwrap_or_else(failure))
}

fn generate_inner(
    raw: &str,
    encoded: Option<&str>,
    prompt: &str,
    aspect_ratio: Option<&str>,
    cancellation: &WallpaperSearchCancellation,
) -> Result<WallpaperImagineResult, &'static str> {
    if cancellation.is_cancelled() {
        return Err("cancelled");
    }
    let prompt = normalized_motion_prompt(Some(prompt))?.ok_or("empty")?;
    let aspect_ratio = aspect_ratio
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("auto");
    if !matches!(aspect_ratio, "auto" | "16:9" | "9:16" | "1:1" | "4:3") {
        return Err("imagine_source_invalid");
    }
    let root = wallpaper_source::wallpapers_root();
    let original = validated_source_image(raw, &root)?;
    let cli = wallpaper_source::require_cli_ready().map_err(|code| match code.as_str() {
        "auth_required" => "auth_required",
        "cli_missing" => "cli_missing",
        _ => "imagine_failed",
    })?;
    // Use the same owned directory lifecycle as video; input snapshots stay hidden.
    let output = video_output_dir(&root);
    fs::create_dir_all(&output).map_err(|_| "imagine_failed")?;
    let result = (|| {
        let source = source::materialize(encoded, &original, &output)?;
        let input = edit_input(&source, &prompt, aspect_ratio);
        let tool_prompt = input["prompt"].as_str().ok_or("imagine_failed")?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let instruction = format!(
            "Call image_edit exactly once with this JSON argument object: {input}\n\
             Treat prompt as image edit instructions only. Do not call other tools, change arguments, \
             or retry. The tool saves the output automatically. After completion reply briefly."
        );
        wallpaper_source::run_grok_headless_edit_cancellable(
            &cli,
            &instruction,
            &output,
            cancellation,
            &session_id,
        )
        .map_err(|code| {
            session::run_error(&code, &session_id, &output, "image_edit", |actual| {
                validate_input(actual, &source, tool_prompt, Some(aspect_ratio))
            })
        })?;
        if cancellation.is_cancelled() {
            return Err("cancelled");
        }
        let session_dir = crate::paths::find_agent_session_dir(
            &session_id,
            Some(&output.to_string_lossy()),
            "shared",
        )
        .ok_or("imagine_failed")?;
        let sessions = crate::paths::resolve_agent_grok_home("shared").join("sessions");
        if !wallpaper_source::is_path_under_dir(&session_dir, &sessions) {
            return Err("imagine_failed");
        }
        let target = copy_result(
            &session_dir,
            &output,
            &session_id,
            &source,
            tool_prompt,
            Some(aspect_ratio),
            cancellation,
        )?;
        let item = generated_media_item(&target, &output, Some(&prompt), true)?;
        let _ = fs::remove_file(source);
        finalize_generated_item(
            item,
            &target,
            Some(&prompt),
            crate::wallpaper_catalog::GenerationParameters {
                operation: "image_edit".into(),
                aspect_ratio: Some(aspect_ratio.into()),
                ..Default::default()
            },
            Some(&original),
            cancellation,
        )
    })();
    if result.as_ref().is_err() {
        cleanup_failed_output(&output);
    }
    result
}

fn edit_input(source: &Path, prompt: &str, aspect: &str) -> Value {
    let path = crate::process_util::strip_extended_path_prefix(&source.to_string_lossy());
    // Single-reference edits ignore aspect_ratio. Reuse the same untouched snapshot
    // twice to select the native multi-reference ratio path without introducing borders.
    let (images, prompt) = if aspect == "auto" {
        (vec![&path], prompt.to_string())
    } else {
        (
            vec![&path, &path],
            format!("Both references show the same single image. Edit this image once: {prompt}\nRecompose and extend the scene naturally to fill the entire {aspect} frame. Preserve the subject without stretching, with no borders, margins, panels or duplicated subjects."),
        )
    };
    json!({ "image": images, "prompt": prompt, "aspect_ratio": aspect })
}

fn validate_input(
    input: &Value,
    source: &Path,
    prompt: &str,
    aspect_ratio: Option<&str>,
) -> Result<(), &'static str> {
    let images = input
        .get("image")
        .and_then(Value::as_array)
        .ok_or("imagine_failed")?;
    let aspect_ratio = aspect_ratio
        .filter(|v| !v.trim().is_empty())
        .unwrap_or("auto");
    if images.len() != if aspect_ratio == "auto" { 1 } else { 2 }
        || input.get("prompt").and_then(Value::as_str) != Some(prompt)
        || input
            .get("aspect_ratio")
            .and_then(Value::as_str)
            .unwrap_or("auto")
            != aspect_ratio
    {
        return Err("imagine_failed");
    }
    if !source.is_file() {
        return Err("imagine_failed");
    }
    let expected_path = source.canonicalize().map_err(|_| "imagine_failed")?;
    for reference in images {
        let path = Path::new(reference.as_str().ok_or("imagine_failed")?);
        if !path.is_absolute() || path.canonicalize().ok().as_ref() != Some(&expected_path) {
            return Err("imagine_failed");
        }
    }
    Ok(())
}

fn copy_result(
    dir: &Path,
    output: &Path,
    session_id: &str,
    source: &Path,
    prompt: &str,
    aspect_ratio: Option<&str>,
    cancellation: &WallpaperSearchCancellation,
) -> Result<PathBuf, &'static str> {
    copy_image_result(
        dir,
        output,
        session_id,
        "image_edit",
        |input| validate_input(input, source, prompt, aspect_ratio),
        cancellation,
    )
}

pub(super) fn copy_image_result(
    dir: &Path,
    output: &Path,
    session_id: &str,
    tool_name: &str,
    validate: impl Fn(&Value) -> Result<(), &'static str>,
    cancellation: &WallpaperSearchCancellation,
) -> Result<PathBuf, &'static str> {
    let log = dir.join("updates.jsonl");
    let images = dir.join("images");
    if !wallpaper_source::is_path_under_dir(&log, dir) {
        return Err("imagine_result_invalid");
    }
    session::audit_tool(
        &session::bounded_text(&log)?,
        session_id,
        tool_name,
        validate,
    )?;
    // Failed tools may never create images/. Preserve their audited error first.
    if !wallpaper_source::is_path_under_dir(&images, dir) {
        return Err("imagine_result_invalid");
    }
    let candidates = fs::read_dir(&images)
        .map_err(|_| "imagine_failed")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "imagine_failed")?;
    if candidates.len() != 1 {
        return Err("imagine_result_invalid");
    }
    let path = candidates[0]
        .path()
        .canonicalize()
        .map_err(|_| "imagine_failed")?;
    if !wallpaper_source::is_path_under_dir(&path, &images) {
        return Err("imagine_result_invalid");
    }
    let media =
        wallpaper_source::validate_local_wallpaper_media(&path, LocalWallpaperMediaKind::Image)
            .map_err(|_| "imagine_result_invalid")?;
    if media.bytes > 40 * 1024 * 1024 {
        return Err("imagine_result_invalid");
    }
    let target = output.join(format!("result.{}", media.extension));
    let mut input = fs::File::open(path).map_err(|_| "imagine_failed")?;
    let mut dest = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|_| "imagine_failed")?;
    let mut total = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        if cancellation.is_cancelled() {
            return Err("cancelled");
        }
        let count = input.read(&mut buffer).map_err(|_| "imagine_failed")?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > media.bytes {
            return Err("imagine_failed");
        }
        dest.write_all(&buffer[..count])
            .map_err(|_| "imagine_failed")?;
    }
    if total != media.bytes {
        return Err("imagine_failed");
    }
    drop(dest);
    wallpaper_source::validate_local_wallpaper_media(&target, LocalWallpaperMediaKind::Image)
        .map_err(|_| "imagine_failed")?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wallpaper_imagine_video::tests::temp_dir;

    #[test]
    fn rejects_unknown_ratio_before_preparing_source_or_calling_cli() {
        assert_eq!(
            generate_inner(
                "missing.png",
                None,
                "Blue sky",
                Some("bad"),
                &WallpaperSearchCancellation::default(),
            )
            .unwrap_err(),
            "imagine_source_invalid"
        );
    }

    #[test]
    fn native_ratio_references_preserve_source_pixels_and_reject_substitution() {
        let root = temp_dir("edit-ratio");
        let source = root.join("source.png");
        image::RgbImage::from_fn(120, 80, |x, y| image::Rgb([x as u8, y as u8, 100]))
            .save(&source)
            .unwrap();
        let before = fs::read(&source).unwrap();
        let other = root.join("other.png");
        fs::copy(&source, &other).unwrap();
        for aspect in ["16:9", "9:16", "1:1", "4:3", "auto"] {
            let input = edit_input(&source, "Blue sky", aspect);
            let prompt = input["prompt"].as_str().unwrap();
            assert!(validate_input(&input, &source, prompt, Some(aspect)).is_ok());
            let images = input["image"].as_array().unwrap();
            assert_eq!(images.len(), if aspect == "auto" { 1 } else { 2 });
            for reference in images {
                assert_eq!(fs::read(reference.as_str().unwrap()).unwrap(), before);
            }
            if aspect == "auto" {
                assert_eq!(prompt, "Blue sky");
            } else {
                let mut replaced = input.clone();
                replaced["image"][1] = json!(other);
                assert!(validate_input(&replaced, &source, prompt, Some(aspect)).is_err());
                replaced["image"] = json!([source]);
                assert!(validate_input(&replaced, &source, prompt, Some(aspect)).is_err());
                replaced["image"] = json!([source, source, source]);
                assert!(validate_input(&replaced, &source, prompt, Some(aspect)).is_err());
            }
            assert_eq!(before, fs::read(&source).unwrap());
        }
        fs::remove_dir_all(root).unwrap();
    }

    fn log(source: &Path) -> String {
        [json!({"sessionUpdate": "tool_call", "toolCallId": "edit-1", "toolName": "image_edit",
            "rawInput": {"image": [source], "prompt": "Blue sky", "aspect_ratio": "auto"}}),
         json!({"sessionUpdate": "tool_call_update", "toolCallId": "edit-1", "status": "completed"})]
            .iter().map(|update| json!({"params": {"sessionId": "session-1", "update": update}}).to_string())
            .collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn requires_the_selected_image_exact_prompt_and_completed_edit() {
        let root = temp_dir("edit-audit");
        let source = root.join("source.png");
        fs::write(&source, "snapshot").unwrap();
        let good = log(&source);
        let audit = |raw: &str| {
            session::audit_tool(raw, "session-1", "image_edit", |input| {
                validate_input(input, &source, "Blue sky", None)
            })
        };
        assert!(audit(&good).is_ok());
        for bad in [
            good.replace("Blue sky", "Other prompt"),
            good.replace("auto", "16:9"),
            good.replace("source.png", "other.png"),
            good.replace("image_edit", "image_gen"),
            good.replace("completed", "failed"),
            format!("{good}\n{good}"),
            String::new(),
        ] {
            assert!(audit(&bad).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_a_real_image_and_returns_a_reusable_gallery_item() {
        let root = temp_dir("edit-result");
        let source = root.join("source.png");
        let images = root.join("images");
        let output = root.join("output");
        fs::create_dir(&images).unwrap();
        fs::create_dir(&output).unwrap();
        image::RgbImage::new(24, 16).save(&source).unwrap();
        image::RgbImage::new(24, 16)
            .save(images.join("1.png"))
            .unwrap();
        fs::write(root.join("updates.jsonl"), log(&source)).unwrap();
        let cancellation = WallpaperSearchCancellation::default();
        let target = copy_result(
            &root,
            &output,
            "session-1",
            &source,
            "Blue sky",
            None,
            &cancellation,
        )
        .unwrap();
        assert_eq!(
            fs::read(&target).unwrap(),
            fs::read(images.join("1.png")).unwrap()
        );
        let item = generated_media_item(&target, &output, Some("Blue sky"), true).unwrap();
        assert_eq!(item.kind, "image");
        assert_eq!(item.source, "imagine");
        assert_eq!((item.width, item.height), (Some(24), Some(16)));
        assert!(Path::new(item.local_path.as_ref().unwrap()).is_file());
        assert_eq!(item.prompt.as_deref(), Some("Blue sky"));
        assert!(source.is_file());
        fs::remove_file(target).unwrap();
        cancellation.cancel();
        assert_eq!(
            copy_result(
                &root,
                &output,
                "session-1",
                &source,
                "Blue sky",
                None,
                &cancellation
            ),
            Err("cancelled")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_images_and_ambiguous_session_outputs() {
        let root = temp_dir("edit-invalid-output");
        let source = root.join("source.png");
        let images = root.join("images");
        let output = root.join("output");
        fs::create_dir(&images).unwrap();
        fs::create_dir(&output).unwrap();
        fs::write(&source, "snapshot").unwrap();
        fs::write(root.join("updates.jsonl"), log(&source)).unwrap();
        fs::write(images.join("1.png"), "not an image").unwrap();
        let cancellation = WallpaperSearchCancellation::default();
        assert_eq!(
            copy_result(
                &root,
                &output,
                "session-1",
                &source,
                "Blue sky",
                None,
                &cancellation
            ),
            Err("imagine_result_invalid")
        );
        image::RgbImage::new(24, 16)
            .save(images.join("1.png"))
            .unwrap();
        image::RgbImage::new(24, 16)
            .save(images.join("2.png"))
            .unwrap();
        assert_eq!(
            copy_result(
                &root,
                &output,
                "session-1",
                &source,
                "Blue sky",
                None,
                &cancellation
            ),
            Err("imagine_result_invalid")
        );
        assert_eq!(fs::read_dir(&output).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
}
