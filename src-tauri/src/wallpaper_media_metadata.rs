//! Bounded, dependency-free metadata probes for local wallpaper media.
//!
//! Wallpaper files can originate from remote providers, so metadata parsing is
//! deliberately read-only and bounded. Unknown or malformed metadata is a soft
//! failure: callers still retain the already signature-validated media file.

use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

const MAX_BOXES_PER_LEVEL: usize = 4_096;
const MAX_EBML_ID_BYTES: usize = 4;
const MAX_EBML_SIZE_BYTES: usize = 8;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct WallpaperMediaMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
}

pub(crate) fn probe(path: &Path) -> WallpaperMediaMetadata {
    let mut signature = [0_u8; 12];
    let Ok(mut file) = File::open(path) else {
        return WallpaperMediaMetadata::default();
    };
    let Ok(file_len) = file.metadata().map(|metadata| metadata.len()) else {
        return WallpaperMediaMetadata::default();
    };
    let read = file.read(&mut signature).unwrap_or(0);
    if file.seek(SeekFrom::Start(0)).is_err() {
        return WallpaperMediaMetadata::default();
    }

    if read >= 8 && &signature[4..8] == b"ftyp" {
        return probe_mp4(&mut file, file_len).unwrap_or_default();
    }
    if read >= 4 && signature[..4] == [0x1a, 0x45, 0xdf, 0xa3] {
        return probe_webm(&mut file, file_len).unwrap_or_default();
    }

    let dimensions = image::ImageReader::open(path)
        .ok()
        .and_then(|reader| reader.with_guessed_format().ok())
        .and_then(|reader| reader.into_dimensions().ok());
    WallpaperMediaMetadata {
        width: dimensions.map(|value| value.0),
        height: dimensions.map(|value| value.1),
        duration_ms: None,
    }
}

#[derive(Clone, Copy, Debug)]
struct Mp4Box {
    kind: [u8; 4],
    data_start: u64,
    end: u64,
}

fn read_mp4_box(file: &mut File, parent_end: u64) -> io::Result<Option<Mp4Box>> {
    let start = file.stream_position()?;
    if start >= parent_end {
        return Ok(None);
    }
    if parent_end - start < 8 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "truncated MP4 box header",
        ));
    }

    let size32 = read_u32(file)? as u64;
    let mut kind = [0_u8; 4];
    file.read_exact(&mut kind)?;
    let (size, header_len) = if size32 == 1 {
        (read_u64(file)?, 16_u64)
    } else if size32 == 0 {
        (parent_end - start, 8_u64)
    } else {
        (size32, 8_u64)
    };
    let end = start
        .checked_add(size)
        .filter(|end| size >= header_len && *end <= parent_end)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid MP4 box size"))?;
    Ok(Some(Mp4Box {
        kind,
        data_start: start + header_len,
        end,
    }))
}

fn probe_mp4(file: &mut File, file_len: u64) -> io::Result<WallpaperMediaMetadata> {
    let mut boxes = 0;
    while boxes < MAX_BOXES_PER_LEVEL {
        boxes += 1;
        let Some(atom) = read_mp4_box(file, file_len)? else {
            break;
        };
        if atom.kind == *b"moov" {
            return probe_mp4_moov(file, atom.data_start, atom.end);
        }
        file.seek(SeekFrom::Start(atom.end))?;
    }
    Ok(WallpaperMediaMetadata::default())
}

fn probe_mp4_moov(file: &mut File, start: u64, end: u64) -> io::Result<WallpaperMediaMetadata> {
    file.seek(SeekFrom::Start(start))?;
    let mut result = WallpaperMediaMetadata::default();
    let mut boxes = 0;
    while boxes < MAX_BOXES_PER_LEVEL {
        boxes += 1;
        let Some(atom) = read_mp4_box(file, end)? else {
            break;
        };
        match &atom.kind {
            b"mvhd" => result.duration_ms = read_mp4_duration(file, atom)?,
            b"trak" => {
                if let Some((width, height)) = read_mp4_track_dimensions(file, atom)? {
                    let previous_area = u64::from(result.width.unwrap_or(0))
                        * u64::from(result.height.unwrap_or(0));
                    let area = u64::from(width) * u64::from(height);
                    if area > previous_area {
                        result.width = Some(width);
                        result.height = Some(height);
                    }
                }
            }
            _ => {}
        }
        file.seek(SeekFrom::Start(atom.end))?;
    }
    Ok(result)
}

fn read_mp4_duration(file: &mut File, atom: Mp4Box) -> io::Result<Option<u64>> {
    let len = usize::try_from((atom.end - atom.data_start).min(32)).unwrap_or(0);
    if len < 20 {
        return Ok(None);
    }
    file.seek(SeekFrom::Start(atom.data_start))?;
    let mut data = vec![0_u8; len];
    file.read_exact(&mut data)?;
    let (timescale, duration) = if data[0] == 1 {
        if data.len() < 32 {
            return Ok(None);
        }
        (be_u32(&data[20..24]) as u64, be_u64(&data[24..32]))
    } else {
        (be_u32(&data[12..16]) as u64, be_u32(&data[16..20]) as u64)
    };
    Ok(duration_ms(duration, timescale))
}

fn read_mp4_track_dimensions(file: &mut File, track: Mp4Box) -> io::Result<Option<(u32, u32)>> {
    file.seek(SeekFrom::Start(track.data_start))?;
    let mut boxes = 0;
    while boxes < MAX_BOXES_PER_LEVEL {
        boxes += 1;
        let Some(atom) = read_mp4_box(file, track.end)? else {
            break;
        };
        if atom.kind == *b"tkhd" {
            return read_mp4_tkhd_dimensions(file, atom);
        }
        file.seek(SeekFrom::Start(atom.end))?;
    }
    Ok(None)
}

fn read_mp4_tkhd_dimensions(file: &mut File, atom: Mp4Box) -> io::Result<Option<(u32, u32)>> {
    let len = usize::try_from((atom.end - atom.data_start).min(96)).unwrap_or(0);
    if len < 84 {
        return Ok(None);
    }
    file.seek(SeekFrom::Start(atom.data_start))?;
    let mut data = vec![0_u8; len];
    file.read_exact(&mut data)?;
    let (matrix_offset, width_offset) = if data[0] == 1 {
        if data.len() < 96 {
            return Ok(None);
        }
        (52, 88)
    } else {
        (40, 76)
    };
    let width = be_u32(&data[width_offset..width_offset + 4]) >> 16;
    let height = be_u32(&data[width_offset + 4..width_offset + 8]) >> 16;
    if width == 0 || height == 0 {
        return Ok(None);
    }

    let a = be_i32(&data[matrix_offset..matrix_offset + 4]) as i64;
    let b = be_i32(&data[matrix_offset + 4..matrix_offset + 8]) as i64;
    let c = be_i32(&data[matrix_offset + 12..matrix_offset + 16]) as i64;
    let d = be_i32(&data[matrix_offset + 16..matrix_offset + 20]) as i64;
    let quarter_turn = a == 0 && d == 0 && b.unsigned_abs() == 65_536 && c.unsigned_abs() == 65_536;
    Ok(Some(if quarter_turn {
        (height, width)
    } else {
        (width, height)
    }))
}

#[derive(Clone, Copy, Debug)]
struct EbmlElement {
    id: u64,
    data_start: u64,
    end: u64,
}

fn read_ebml_vint(file: &mut File, max_bytes: usize, keep_marker: bool) -> io::Result<(u64, bool)> {
    let mut first = [0_u8; 1];
    file.read_exact(&mut first)?;
    let leading = first[0].leading_zeros() as usize;
    let len = leading + 1;
    if len > max_bytes || len > 8 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid EBML vint",
        ));
    }
    let marker = 0x80_u8 >> leading;
    let mut value = if keep_marker {
        first[0] as u64
    } else {
        (first[0] & (marker - 1)) as u64
    };
    for _ in 1..len {
        let mut byte = [0_u8; 1];
        file.read_exact(&mut byte)?;
        value = (value << 8) | u64::from(byte[0]);
    }
    let unknown = !keep_marker && value == ((1_u64 << (7 * len)) - 1);
    Ok((value, unknown))
}

fn read_ebml_element(file: &mut File, parent_end: u64) -> io::Result<Option<EbmlElement>> {
    let start = file.stream_position()?;
    if start >= parent_end {
        return Ok(None);
    }
    let (id, _) = read_ebml_vint(file, MAX_EBML_ID_BYTES, true)?;
    let (size, unknown) = read_ebml_vint(file, MAX_EBML_SIZE_BYTES, false)?;
    let data_start = file.stream_position()?;
    let end = if unknown {
        parent_end
    } else {
        data_start
            .checked_add(size)
            .filter(|end| *end <= parent_end)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid EBML size"))?
    };
    if end <= start {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "empty EBML element",
        ));
    }
    Ok(Some(EbmlElement {
        id,
        data_start,
        end,
    }))
}

fn probe_webm(file: &mut File, file_len: u64) -> io::Result<WallpaperMediaMetadata> {
    const SEGMENT: u64 = 0x1853_8067;
    let mut elements = 0;
    while elements < MAX_BOXES_PER_LEVEL {
        elements += 1;
        let Some(element) = read_ebml_element(file, file_len)? else {
            break;
        };
        if element.id == SEGMENT {
            return probe_webm_segment(file, element.data_start, element.end);
        }
        file.seek(SeekFrom::Start(element.end))?;
    }
    Ok(WallpaperMediaMetadata::default())
}

fn probe_webm_segment(file: &mut File, start: u64, end: u64) -> io::Result<WallpaperMediaMetadata> {
    const INFO: u64 = 0x1549_a966;
    const TRACKS: u64 = 0x1654_ae6b;
    file.seek(SeekFrom::Start(start))?;
    let mut result = WallpaperMediaMetadata::default();
    let mut elements = 0;
    while elements < MAX_BOXES_PER_LEVEL {
        elements += 1;
        let Some(element) = read_ebml_element(file, end)? else {
            break;
        };
        match element.id {
            INFO => result.duration_ms = read_webm_duration(file, element)?,
            TRACKS => {
                if let Some((width, height)) = read_webm_dimensions(file, element)? {
                    result.width = Some(width);
                    result.height = Some(height);
                }
            }
            _ => {}
        }
        if result.width.is_some() && result.height.is_some() && result.duration_ms.is_some() {
            break;
        }
        file.seek(SeekFrom::Start(element.end))?;
    }
    Ok(result)
}

fn read_webm_duration(file: &mut File, info: EbmlElement) -> io::Result<Option<u64>> {
    const TIMECODE_SCALE: u64 = 0x2a_d7b1;
    const DURATION: u64 = 0x4489;
    file.seek(SeekFrom::Start(info.data_start))?;
    let mut scale = 1_000_000_u64;
    let mut duration = None;
    let mut elements = 0;
    while elements < MAX_BOXES_PER_LEVEL {
        elements += 1;
        let Some(element) = read_ebml_element(file, info.end)? else {
            break;
        };
        match element.id {
            TIMECODE_SCALE => {
                if let Some(value) = read_ebml_uint(file, element)? {
                    scale = value;
                }
            }
            DURATION => duration = read_ebml_float(file, element)?,
            _ => {}
        }
        file.seek(SeekFrom::Start(element.end))?;
    }
    let Some(duration) = duration.filter(|value| value.is_finite() && *value > 0.0) else {
        return Ok(None);
    };
    let millis = duration * scale as f64 / 1_000_000.0;
    Ok(
        (millis.is_finite() && millis > 0.0 && millis <= u64::MAX as f64)
            .then(|| millis.round() as u64),
    )
}

fn read_webm_dimensions(file: &mut File, tracks: EbmlElement) -> io::Result<Option<(u32, u32)>> {
    const TRACK_ENTRY: u64 = 0xae;
    file.seek(SeekFrom::Start(tracks.data_start))?;
    let mut best = None;
    let mut elements = 0;
    while elements < MAX_BOXES_PER_LEVEL {
        elements += 1;
        let Some(element) = read_ebml_element(file, tracks.end)? else {
            break;
        };
        if element.id == TRACK_ENTRY {
            if let Some(dimensions) = read_webm_track(file, element)? {
                let area = u64::from(dimensions.0) * u64::from(dimensions.1);
                let best_area = best
                    .map(|value: (u32, u32)| u64::from(value.0) * u64::from(value.1))
                    .unwrap_or(0);
                if area > best_area {
                    best = Some(dimensions);
                }
            }
        }
        file.seek(SeekFrom::Start(element.end))?;
    }
    Ok(best)
}

fn read_webm_track(file: &mut File, track: EbmlElement) -> io::Result<Option<(u32, u32)>> {
    const TRACK_TYPE: u64 = 0x83;
    const VIDEO: u64 = 0xe0;
    file.seek(SeekFrom::Start(track.data_start))?;
    let mut track_type = None;
    let mut dimensions = None;
    let mut elements = 0;
    while elements < MAX_BOXES_PER_LEVEL {
        elements += 1;
        let Some(element) = read_ebml_element(file, track.end)? else {
            break;
        };
        match element.id {
            TRACK_TYPE => track_type = read_ebml_uint(file, element)?,
            VIDEO => dimensions = read_webm_video(file, element)?,
            _ => {}
        }
        file.seek(SeekFrom::Start(element.end))?;
    }
    Ok((track_type == Some(1)).then_some(dimensions).flatten())
}

fn read_webm_video(file: &mut File, video: EbmlElement) -> io::Result<Option<(u32, u32)>> {
    const PIXEL_WIDTH: u64 = 0xb0;
    const PIXEL_HEIGHT: u64 = 0xba;
    file.seek(SeekFrom::Start(video.data_start))?;
    let mut width = None;
    let mut height = None;
    let mut elements = 0;
    while elements < MAX_BOXES_PER_LEVEL {
        elements += 1;
        let Some(element) = read_ebml_element(file, video.end)? else {
            break;
        };
        match element.id {
            PIXEL_WIDTH => width = read_ebml_uint(file, element)?.and_then(valid_u32),
            PIXEL_HEIGHT => height = read_ebml_uint(file, element)?.and_then(valid_u32),
            _ => {}
        }
        file.seek(SeekFrom::Start(element.end))?;
    }
    Ok(width.zip(height))
}

fn read_ebml_uint(file: &mut File, element: EbmlElement) -> io::Result<Option<u64>> {
    let len = element.end - element.data_start;
    if len == 0 || len > 8 {
        return Ok(None);
    }
    file.seek(SeekFrom::Start(element.data_start))?;
    let mut value = 0_u64;
    for _ in 0..len {
        let mut byte = [0_u8; 1];
        file.read_exact(&mut byte)?;
        value = (value << 8) | u64::from(byte[0]);
    }
    Ok(Some(value))
}

fn read_ebml_float(file: &mut File, element: EbmlElement) -> io::Result<Option<f64>> {
    let len = element.end - element.data_start;
    file.seek(SeekFrom::Start(element.data_start))?;
    Ok(match len {
        4 => Some(f32::from_bits(read_u32(file)?) as f64),
        8 => Some(f64::from_bits(read_u64(file)?)),
        _ => None,
    })
}

fn duration_ms(duration: u64, timescale: u64) -> Option<u64> {
    if duration == 0 || timescale == 0 {
        return None;
    }
    let millis = u128::from(duration)
        .checked_mul(1_000)?
        .checked_add(u128::from(timescale / 2))?
        / u128::from(timescale);
    (millis > 0).then(|| u64::try_from(millis).ok()).flatten()
}

fn valid_u32(value: u64) -> Option<u32> {
    u32::try_from(value).ok().filter(|value| *value > 0)
}

fn read_u32(file: &mut File) -> io::Result<u32> {
    let mut bytes = [0_u8; 4];
    file.read_exact(&mut bytes)?;
    Ok(u32::from_be_bytes(bytes))
}

fn read_u64(file: &mut File) -> io::Result<u64> {
    let mut bytes = [0_u8; 8];
    file.read_exact(&mut bytes)?;
    Ok(u64::from_be_bytes(bytes))
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes(bytes.try_into().unwrap_or_default())
}

fn be_u64(bytes: &[u8]) -> u64 {
    u64::from_be_bytes(bytes.try_into().unwrap_or_default())
}

fn be_i32(bytes: &[u8]) -> i32 {
    i32::from_be_bytes(bytes.try_into().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn temp_file(extension: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "grok-wallpaper-metadata-{}.{}",
            uuid::Uuid::new_v4(),
            extension
        ))
    }

    fn mp4_box(kind: &[u8; 4], payload: Vec<u8>) -> Vec<u8> {
        let mut data = Vec::with_capacity(payload.len() + 8);
        data.extend_from_slice(&u32::try_from(payload.len() + 8).unwrap().to_be_bytes());
        data.extend_from_slice(kind);
        data.extend_from_slice(&payload);
        data
    }

    fn mp4_fixture(width: u32, height: u32, duration_ms: u32) -> Vec<u8> {
        let mut ftyp = Vec::new();
        ftyp.extend_from_slice(b"isom");
        ftyp.extend_from_slice(&0_u32.to_be_bytes());
        ftyp.extend_from_slice(b"isom");

        let mut mvhd = vec![0_u8; 20];
        mvhd[12..16].copy_from_slice(&1_000_u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&duration_ms.to_be_bytes());

        let mut tkhd = vec![0_u8; 84];
        tkhd[40..44].copy_from_slice(&65_536_i32.to_be_bytes());
        tkhd[56..60].copy_from_slice(&65_536_i32.to_be_bytes());
        tkhd[76..80].copy_from_slice(&(width << 16).to_be_bytes());
        tkhd[80..84].copy_from_slice(&(height << 16).to_be_bytes());

        let mut moov = mp4_box(b"mvhd", mvhd);
        moov.extend_from_slice(&mp4_box(b"trak", mp4_box(b"tkhd", tkhd)));
        [mp4_box(b"ftyp", ftyp), mp4_box(b"moov", moov)].concat()
    }

    fn ebml_size(size: usize) -> Vec<u8> {
        assert!(size < 127);
        vec![0x80 | size as u8]
    }

    fn ebml_element(id: &[u8], payload: Vec<u8>) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(id);
        data.extend_from_slice(&ebml_size(payload.len()));
        data.extend_from_slice(&payload);
        data
    }

    fn uint_payload(value: u64) -> Vec<u8> {
        let bytes = value.to_be_bytes();
        let first = bytes.iter().position(|value| *value != 0).unwrap_or(7);
        bytes[first..].to_vec()
    }

    fn webm_fixture(width: u32, height: u32, duration: f64) -> Vec<u8> {
        let mut info = ebml_element(&[0x2a, 0xd7, 0xb1], uint_payload(1_000_000));
        info.extend_from_slice(&ebml_element(
            &[0x44, 0x89],
            duration.to_bits().to_be_bytes().to_vec(),
        ));
        let info = ebml_element(&[0x15, 0x49, 0xa9, 0x66], info);

        let mut video = ebml_element(&[0xb0], uint_payload(u64::from(width)));
        video.extend_from_slice(&ebml_element(&[0xba], uint_payload(u64::from(height))));
        let video = ebml_element(&[0xe0], video);
        let mut track = ebml_element(&[0x83], vec![1]);
        track.extend_from_slice(&video);
        let tracks = ebml_element(&[0x16, 0x54, 0xae, 0x6b], ebml_element(&[0xae], track));
        let segment = ebml_element(&[0x18, 0x53, 0x80, 0x67], [info, tracks].concat());
        [ebml_element(&[0x1a, 0x45, 0xdf, 0xa3], Vec::new()), segment].concat()
    }

    #[test]
    fn probes_mp4_dimensions_and_duration() {
        let path = temp_file("mp4");
        fs::write(&path, mp4_fixture(1_920, 1_080, 6_750)).unwrap();
        assert_eq!(
            probe(&path),
            WallpaperMediaMetadata {
                width: Some(1_920),
                height: Some(1_080),
                duration_ms: Some(6_750),
            }
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn probes_webm_dimensions_and_duration() {
        let path = temp_file("webm");
        fs::write(&path, webm_fixture(1_280, 720, 10_250.0)).unwrap();
        assert_eq!(
            probe(&path),
            WallpaperMediaMetadata {
                width: Some(1_280),
                height: Some(720),
                duration_ms: Some(10_250),
            }
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn malformed_container_is_a_soft_failure() {
        let path = temp_file("mp4");
        fs::write(&path, [0, 0, 0, 255, b'f', b't', b'y', b'p']).unwrap();
        assert_eq!(probe(&path), WallpaperMediaMetadata::default());
        fs::remove_file(path).unwrap();
    }
}
