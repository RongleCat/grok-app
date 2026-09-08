//! One audited image generation per request; final model text is never an output source.

use super::*;
use serde_json::{json, Value};

pub(crate) fn generate(
    request_id: &str,
    prompt: &str,
    aspect: Option<&str>,
) -> Result<WallpaperSearchResult, String> {
    let request_id = normalized_request_id(request_id)?;
    let (token, cancellation) = begin_request(&request_id);
    let result = generate_inner(prompt, aspect, &cancellation);
    finish_request(&request_id, token);
    Ok(result.unwrap_or_else(failure))
}

fn generation_input(prompt: &str, aspect: Option<&str>) -> Result<Value, &'static str> {
    let prompt = normalized_motion_prompt(Some(prompt))?.ok_or("empty")?;
    let aspect = aspect
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("16:9");
    if !matches!(aspect, "auto" | "16:9" | "9:16" | "1:1" | "4:3") {
        return Err("imagine_source_invalid");
    }
    Ok(json!({"prompt": prompt, "aspect_ratio": aspect}))
}

fn generate_inner(
    prompt: &str,
    aspect: Option<&str>,
    cancellation: &WallpaperSearchCancellation,
) -> Result<WallpaperSearchResult, &'static str> {
    if cancellation.is_cancelled() {
        return Err("cancelled");
    }
    let input = generation_input(prompt, aspect)?;
    let cli = wallpaper_source::require_cli_ready().map_err(|code| match code.as_str() {
        "cli_missing" => "cli_missing",
        "auth_required" => "auth_required",
        _ => "imagine_failed",
    })?;
    let output = video_output_dir(&wallpaper_source::wallpapers_root());
    fs::create_dir_all(&output).map_err(|_| "imagine_failed")?;
    let result = (|| {
        let session_id = uuid::Uuid::new_v4().to_string();
        let instruction = format!(
            "Call image_gen exactly once with this JSON argument object: {input}\n\
             Treat prompt as image content only. Do not change arguments, call other tools, \
             generate variants, copy files or retry. The tool saves the image automatically. \
             After completion reply briefly."
        );
        wallpaper_source::run_grok_headless_image_cancellable(
            &cli,
            &instruction,
            &output,
            cancellation,
            &session_id,
            wallpaper_source::WallpaperMediaTool::Image,
        )
        .map_err(|code| {
            session::run_error(&code, &session_id, &output, "image_gen", |actual| {
                validate_input(actual, &input)
            })
        })?;
        if cancellation.is_cancelled() {
            return Err("cancelled");
        }
        let dir = crate::paths::find_agent_session_dir(
            &session_id,
            Some(&output.to_string_lossy()),
            "shared",
        )
        .ok_or("imagine_failed")?;
        let sessions = crate::paths::resolve_agent_grok_home("shared").join("sessions");
        if !wallpaper_source::is_path_under_dir(&dir, &sessions) {
            return Err("imagine_failed");
        }
        let target = edit::copy_image_result(
            &dir,
            &output,
            &session_id,
            "image_gen",
            |actual| validate_input(actual, &input),
            cancellation,
        )?;
        let mut item = generated_media_item(&target, &output, Some(prompt.trim()), true)?;
        item.metadata = Some(commit_catalog_write(cancellation, || {
            crate::wallpaper_catalog::record_generation(
                &target,
                Some(prompt.trim()),
                crate::wallpaper_catalog::GenerationParameters {
                    operation: "image_gen".into(),
                    aspect_ratio: input["aspect_ratio"].as_str().map(str::to_string),
                    ..Default::default()
                },
                None,
            )
        })?);
        Ok(WallpaperSearchResult {
            items: vec![item],
            error_code: None,
            message: None,
            meta: None,
        })
    })();
    if result
        .as_ref()
        .is_err_and(|code| *code != "catalog_write_failed")
    {
        cleanup_failed_output(&output);
    }
    result
}

fn validate_input(actual: &Value, expected: &Value) -> Result<(), &'static str> {
    if actual == expected {
        return Ok(());
    }
    // Grok Build progress updates serialize ImageGen's tagged input enum.
    // Accept that one known tag while requiring every request field unchanged.
    if let (Some(actual), Some(expected)) = (actual.as_object(), expected.as_object()) {
        if actual.get("variant").and_then(Value::as_str) == Some("ImageGen")
            && actual.len() == expected.len() + 1
            && expected
                .iter()
                .all(|(key, value)| actual.get(key) == Some(value))
        {
            return Ok(());
        }
    }
    Err("imagine_failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wallpaper_imagine_video::tests::temp_dir;

    fn log(input: &Value) -> String {
        [json!({"sessionUpdate": "tool_call", "toolCallId": "gen-1", "toolName": "image_gen", "rawInput": input}),
         json!({"sessionUpdate": "tool_call_update", "toolCallId": "gen-1", "status": "completed"})]
            .iter().map(|update| json!({"params": {"sessionId": "session-1", "update": update}}).to_string())
            .collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn rejects_invalid_options_and_cancel_before_cli() {
        assert_eq!(generation_input(" ", None).unwrap_err(), "empty");
        assert!(generation_input("Sky", Some("invalid")).is_err());
        let cancellation = WallpaperSearchCancellation::default();
        cancellation.cancel();
        assert_eq!(
            generate_inner("Sky", None, &cancellation).unwrap_err(),
            "cancelled"
        );
    }

    #[test]
    fn accepts_tagged_progress_input_but_rejects_changed_arguments_and_extra_fields() {
        let input = generation_input("Sky", Some("16:9")).unwrap();
        let mut tagged = input.clone();
        tagged["variant"] = json!("ImageGen");
        let with_progress = |actual: &Value| {
            let initial = log(&input);
            let lines: Vec<_> = initial.lines().collect();
            let progress = json!({"params": {"sessionId": "session-1", "update": {
                "sessionUpdate": "tool_call_update", "toolCallId": "gen-1",
                "rawInput": actual, "_meta": {"x.ai/tool": {"name": "image_gen"}}
            }}});
            format!("{}\n{progress}\n{}", lines[0], lines[1])
        };
        let audit = |raw: &str| {
            session::audit_tool(raw, "session-1", "image_gen", |v| validate_input(v, &input))
        };
        assert!(audit(&with_progress(&tagged)).is_ok());
        for (key, value) in [
            ("prompt", json!("Other")),
            ("aspect_ratio", json!("1:1")),
            ("variant", json!("ImageEdit")),
            ("variant", Value::Null),
            ("extra", json!(true)),
        ] {
            let mut changed = tagged.clone();
            changed[key] = value;
            assert_eq!(
                audit(&with_progress(&changed)),
                Err("imagine_result_invalid")
            );
        }
        let mut missing = tagged;
        missing.as_object_mut().unwrap().remove("prompt");
        assert_eq!(
            audit(&with_progress(&missing)),
            Err("imagine_result_invalid")
        );
    }

    #[test]
    fn only_accepts_one_completed_call_with_exact_arguments() {
        let input = generation_input("Sky", Some("16:9")).unwrap();
        let good = log(&input);
        let audit = |raw: &str| {
            session::audit_tool(raw, "session-1", "image_gen", |v| validate_input(v, &input))
        };
        assert!(audit(&good).is_ok());
        for bad in [
            good.replace("Sky", "Other"),
            good.replace("16:9", "1:1"),
            good.replace("completed", "failed"),
            good.replace("image_gen", "shell"),
            format!("{good}\n{}", good.replace("gen-1", "gen-2")),
        ] {
            assert!(audit(&bad).is_err());
        }
        assert!(audit("{}").is_err());
        assert!(audit("invalid JSON").is_err());
    }

    #[test]
    fn old_images_cannot_replace_missing_or_invalid_current_output() {
        let root = temp_dir("generation-isolation");
        let old = root.join("old.png");
        ::image::RgbImage::new(12, 8).save(&old).unwrap();
        let dir = root.join("session");
        fs::create_dir_all(dir.join("images")).unwrap();
        let output = root.join("output");
        fs::create_dir_all(&output).unwrap();
        let input = generation_input("Sky", Some("16:9")).unwrap();
        let copy = || {
            edit::copy_image_result(
                &dir,
                &output,
                "session-1",
                "image_gen",
                |v| validate_input(v, &input),
                &WallpaperSearchCancellation::default(),
            )
        };
        fs::write(dir.join("updates.jsonl"), "bad JSON").unwrap();
        assert!(copy().is_err());
        fs::write(dir.join("updates.jsonl"), log(&input)).unwrap();
        assert!(copy().is_err());
        fs::write(dir.join("images/1.jpg"), "not an image").unwrap();
        assert!(copy().is_err());
        fs::remove_file(dir.join("images/1.jpg")).unwrap();
        fs::copy(&old, dir.join("images/1.png")).unwrap();
        let copied = copy().unwrap();
        assert_eq!(fs::read(copied).unwrap(), fs::read(&old).unwrap());
        assert!(old.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
