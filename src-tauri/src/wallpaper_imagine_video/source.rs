//! Bounded source normalization. Never ask the agent to run image converters.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use base64::Engine;
use image::{ImageDecoder, ImageFormat, ImageReader, Limits};

const MAX_SOURCE_BYTES: u64 = 40 * 1024 * 1024;
const MAX_PNG_BYTES: usize = 20 * 1024 * 1024;
const MAX_EDGE: u32 = 2048;

pub(super) fn materialize(
    encoded: Option<&str>,
    original: &Path,
    output_dir: &Path,
) -> Result<PathBuf, &'static str> {
    let bytes = if let Some(encoded) = encoded {
        // Bound the text before base64 allocates its output buffer.
        if encoded.is_empty() || encoded.len() > MAX_PNG_BYTES.div_ceil(3) * 4 {
            return Err("imagine_source_invalid");
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| "imagine_source_invalid")?;
        if bytes.len() > MAX_PNG_BYTES || image::guess_format(&bytes).ok() != Some(ImageFormat::Png)
        {
            return Err("imagine_source_invalid");
        }
        bytes
    } else {
        let mut file = fs::File::open(original).map_err(|_| "imagine_source_invalid")?;
        if file.metadata().map_err(|_| "imagine_source_invalid")?.len() > MAX_SOURCE_BYTES {
            return Err("imagine_source_invalid");
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(MAX_SOURCE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "imagine_source_invalid")?;
        if bytes.len() as u64 > MAX_SOURCE_BYTES {
            return Err("imagine_source_invalid");
        }
        bytes
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(256 * 1024 * 1024);
    let make_reader = || -> Result<_, &'static str> {
        let mut reader = ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(|_| "imagine_source_invalid")?;
        reader.limits(limits.clone());
        Ok(reader)
    };
    let mut decoder = make_reader()?
        .into_decoder()
        .map_err(|_| "imagine_source_invalid")?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 50_000_000 {
        return Err("imagine_source_invalid");
    }
    let orientation = decoder
        .orientation()
        .map_err(|_| "imagine_source_invalid")?;
    drop(decoder);
    let mut image = make_reader()?
        .decode()
        .map_err(|_| "imagine_source_invalid")?;
    if width > MAX_EDGE || height > MAX_EDGE {
        image = image.thumbnail(MAX_EDGE, MAX_EDGE);
    }
    // Resize first so orientation transforms only allocate bounded buffers.
    image.apply_orientation(orientation);
    // Re-encode even PNG/JPEG: strip metadata and snapshot the selected pixels
    // so later edits to the original cannot change this generation's source.
    let path = output_dir.join(".video-source.png");
    image
        .save_with_format(&path, ImageFormat::Png)
        .map_err(|_| "imagine_failed")?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wallpaper_imagine_video::tests::temp_dir;
    use image::ImageEncoder;

    fn jpeg_with_orientation(width: u32, height: u32, orientation: u8) -> Vec<u8> {
        let pixels = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8])
        });
        // Little-endian TIFF header with one SHORT Orientation tag (0x0112).
        let exif = vec![
            b'I',
            b'I',
            42,
            0,
            8,
            0,
            0,
            0,
            1,
            0,
            0x12,
            1,
            3,
            0,
            1,
            0,
            0,
            0,
            orientation,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
        ];
        let mut bytes = Vec::new();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 100);
        encoder.set_exif_metadata(exif).unwrap();
        encoder.encode_image(&pixels).unwrap();
        bytes
    }

    #[test]
    fn applies_jpeg_exif_orientation_once_and_strips_metadata() {
        let root = temp_dir("source-orientation");
        let original = root.join("input.jpg");
        let (width, height) = (48, 32);
        for orientation in 1..=8 {
            let bytes = jpeg_with_orientation(width, height, orientation);
            let raw = image::load_from_memory(&bytes).unwrap().to_rgb8();
            fs::write(&original, &bytes).unwrap();
            let result = materialize(None, &original, &root).unwrap();
            let normalized = image::open(&result).unwrap().to_rgb8();
            let expected_dimensions = if orientation >= 5 {
                (height, width)
            } else {
                (width, height)
            };
            assert_eq!(normalized.dimensions(), expected_dimensions);
            for (x, y, pixel) in raw.enumerate_pixels() {
                let (output_x, output_y) = match orientation {
                    1 => (x, y),
                    2 => (width - 1 - x, y),
                    3 => (width - 1 - x, height - 1 - y),
                    4 => (x, height - 1 - y),
                    5 => (y, x),
                    6 => (height - 1 - y, x),
                    7 => (height - 1 - y, width - 1 - x),
                    8 => (y, width - 1 - x),
                    _ => unreachable!(),
                };
                assert_eq!(
                    normalized.get_pixel(output_x, output_y),
                    pixel,
                    "EXIF orientation {orientation} at ({x}, {y})"
                );
            }
            assert_eq!(fs::read(&original).unwrap(), bytes);
            let mut decoder = ImageReader::open(&result).unwrap().into_decoder().unwrap();
            assert!(decoder.exif_metadata().unwrap().is_none());
            drop(decoder);

            let encoded =
                base64::engine::general_purpose::STANDARD.encode(fs::read(&result).unwrap());
            let repeated = materialize(Some(&encoded), &root.join("input.avif"), &root).unwrap();
            assert_eq!(image::open(repeated).unwrap().to_rgb8(), normalized);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounds_rotated_jpeg_snapshot() {
        let root = temp_dir("bounded-source-orientation");
        let original = root.join("input.jpg");
        fs::write(&original, jpeg_with_orientation(2400, 24, 6)).unwrap();
        let result = materialize(None, &original, &root).unwrap();
        let normalized = image::open(result).unwrap();
        assert_eq!((normalized.width(), normalized.height()), (20, MAX_EDGE));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn converts_supported_formats_to_valid_bounded_png() {
        let root = temp_dir("source-conversion");
        for format in [
            ImageFormat::Jpeg,
            ImageFormat::Png,
            ImageFormat::WebP,
            ImageFormat::Gif,
        ] {
            let path = root.join(format!("input.{}", format.extensions_str()[0]));
            image::DynamicImage::new_rgb8(2400, 24)
                .save_with_format(&path, format)
                .unwrap();
            let result = materialize(None, &path, &root).unwrap();
            let image = image::open(&result).unwrap();
            assert_eq!(image.width(), MAX_EDGE);
            assert_eq!(image.height(), 20);
            assert!(path.exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_fake_png_and_accepts_browser_encoded_pixels() {
        let root = temp_dir("browser-source");
        let original = root.join("input.avif");
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(32, 24)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes.into_inner());
        assert!(materialize(Some(&encoded), &original, &root).is_ok());
        let fake =
            base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nnot an image");
        assert_eq!(
            materialize(Some(&fake), &original, &root),
            Err("imagine_source_invalid")
        );
        assert_eq!(
            materialize(Some("not base64"), &original, &root),
            Err("imagine_source_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
