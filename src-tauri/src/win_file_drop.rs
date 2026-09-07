//! Late Windows OLE file-drop registration for the main workbench window.
//!
//! ## Why this exists (#1017 / tauri#14643 / wry#1639)
//!
//! The main window is created with `visible: false` + `create: false`, then shown
//! after Host setup. wry's `DragDropController` runs during webview create and
//! calls `EnumChildWindows` too early — WebView2 chrome HWNDs are often missing —
//! so no `IDropTarget` sticks. wry still calls `SetAllowExternalDrop(false)`,
//! which blocks HTML5 file drops. Explorer then shows the forbidden cursor and
//! `onDragDropEvent` never fires.
//!
//! Upstream fix (wry#1638) is not released yet. Until then we re-register OLE
//! drop targets **after** `show()`, emit the same `tauri://drag-*` events the
//! frontend already listens to, and keep `dragDropEnabled` on (never disable).

#![cfg(windows)]

use std::{
    cell::{RefCell, UnsafeCell},
    ffi::OsString,
    os::{raw::c_void, windows::ffi::OsStringExt},
    path::{Path, PathBuf},
    ptr,
    rc::Rc,
    time::Duration,
};

use serde::Serialize;
use tauri::{Emitter, WebviewWindow};
use windows::{
    core::{implement, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, POINT, POINTL},
        Graphics::Gdi::ScreenToClient,
        System::{
            Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, TYMED_HGLOBAL},
            Ole::{
                IDropTarget, IDropTarget_Impl, OleInitialize, RegisterDragDrop, ReleaseStgMedium,
                RevokeDragDrop, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::{
            Shell::{DragQueryFileW, HDROP},
            WindowsAndMessaging::{EnumChildWindows, GetWindow, GW_CHILD, GW_HWNDNEXT},
        },
    },
};

const DRAG_ENTER: &str = "tauri://drag-enter";
const DRAG_OVER: &str = "tauri://drag-over";
const DRAG_DROP: &str = "tauri://drag-drop";
const DRAG_LEAVE: &str = "tauri://drag-leave";

// Keep `IDropTarget` COM refs alive on the UI thread (STA).
thread_local! {
    static TARGETS: RefCell<Vec<(HWND, IDropTarget)>> = const { RefCell::new(Vec::new()) };
}

#[derive(Clone, Serialize)]
struct PosPayload {
    x: f64,
    y: f64,
}

#[derive(Clone, Serialize)]
struct DragPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    paths: Option<Vec<String>>,
    position: PosPayload,
}

/// Install (or refresh) OLE drop targets after the main window is shown.
///
/// Safe to call more than once; retries are scheduled because WebView2 child
/// HWNDs can appear a tick after `show()`.
pub fn install_after_show(window: &WebviewWindow) {
    let _ = unsafe { OleInitialize(None) };

    register_on_window(window);

    // WebView2 chrome may not exist on the first paint after a hidden create.
    for delay_ms in [250u64, 800, 2000] {
        let w = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(delay_ms));
            let w2 = w.clone();
            let _ = w.run_on_main_thread(move || {
                register_on_window(&w2);
            });
        });
    }
}

fn register_on_window(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        tracing::warn!("win_file_drop: main hwnd unavailable");
        return;
    };

    let win = window.clone();
    let listener: Rc<dyn Fn(DropKind)> = Rc::new(move |kind: DropKind| {
        emit_drag_event(&win, kind);
    });

    let mut registered = 0usize;
    // Parent first (frameless client ≈ webview), then every child HWND.
    if inject_hwnd(hwnd, hwnd, listener.clone()) {
        registered += 1;
    }
    for child in enum_child_hwnds(hwnd) {
        if inject_hwnd(child, hwnd, listener.clone()) {
            registered += 1;
        }
    }

    if registered > 0 {
        tracing::info!(registered, "win_file_drop: OLE drop targets registered");
    } else {
        tracing::debug!("win_file_drop: no HWND accepted RegisterDragDrop yet");
    }
}

fn emit_drag_event(window: &WebviewWindow, kind: DropKind) {
    match kind {
        DropKind::Enter { paths, x, y } => {
            for p in &paths {
                crate::path_scope::grant_path(Path::new(p));
            }
            let payload = DragPayload {
                paths: Some(paths),
                position: PosPayload {
                    x: x as f64,
                    y: y as f64,
                },
            };
            let _ = window.emit(DRAG_ENTER, payload);
        }
        DropKind::Over { x, y } => {
            let payload = DragPayload {
                paths: None,
                position: PosPayload {
                    x: x as f64,
                    y: y as f64,
                },
            };
            let _ = window.emit(DRAG_OVER, payload);
        }
        DropKind::Drop { paths, x, y } => {
            for p in &paths {
                crate::path_scope::grant_path(Path::new(p));
            }
            let payload = DragPayload {
                paths: Some(paths),
                position: PosPayload {
                    x: x as f64,
                    y: y as f64,
                },
            };
            let _ = window.emit(DRAG_DROP, payload);
        }
        DropKind::Leave => {
            let _ = window.emit(DRAG_LEAVE, ());
        }
    }
}

enum DropKind {
    Enter { paths: Vec<String>, x: i32, y: i32 },
    Over { x: i32, y: i32 },
    Drop { paths: Vec<String>, x: i32, y: i32 },
    Leave,
}

struct DropMedium(STGMEDIUM);

impl Drop for DropMedium {
    fn drop(&mut self) {
        // IDataObject can delegate ownership through pUnkForRelease.
        unsafe { ReleaseStgMedium(&mut self.0) };
    }
}

fn inject_hwnd(hwnd: HWND, coordinate_hwnd: HWND, listener: Rc<dyn Fn(DropKind)>) -> bool {
    if hwnd.0.is_null() {
        return false;
    }
    let target: IDropTarget = FileDropTarget::new(coordinate_hwnd, listener).into();
    // Best-effort revoke (hwnd may never have been a drop target — that is OK).
    let _ = unsafe { RevokeDragDrop(hwnd) };
    match unsafe { RegisterDragDrop(hwnd, &target) } {
        Ok(()) => {
            TARGETS.with(|slot| {
                let mut targets = slot.borrow_mut();
                targets.retain(|(registered, _)| registered.0 != hwnd.0);
                targets.push((hwnd, target));
            });
            true
        }
        Err(e) => {
            tracing::debug!(?e, "win_file_drop: RegisterDragDrop failed");
            false
        }
    }
}

fn enum_child_hwnds(parent: HWND) -> Vec<HWND> {
    let mut out = Vec::new();
    {
        let mut callback = |child: HWND| {
            if !child.0.is_null() {
                out.push(child);
            }
            true
        };
        let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
        let closure_ptr: *mut c_void = &mut trait_obj as *mut _ as *mut c_void;
        let lparam = LPARAM(closure_ptr as isize);
        unsafe extern "system" fn enumerate_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let closure = &mut *(lparam.0 as *mut c_void as *mut &mut dyn FnMut(HWND) -> bool);
            closure(hwnd).into()
        }
        let _ = unsafe { EnumChildWindows(Some(parent), Some(enumerate_callback), lparam) };
    }
    // Also walk the immediate GW_CHILD linked list (covers some WebView2 trees
    // EnumChildWindows can miss when a child is still initializing).
    unsafe {
        if let Ok(mut child) = GetWindow(parent, GW_CHILD) {
            while !child.0.is_null() {
                if !out.iter().any(|h| h.0 == child.0) {
                    out.push(child);
                }
                child = GetWindow(child, GW_HWNDNEXT).unwrap_or(HWND(std::ptr::null_mut()));
            }
        }
    }
    out
}

#[implement(IDropTarget)]
struct FileDropTarget {
    coordinate_hwnd: HWND,
    listener: Rc<dyn Fn(DropKind)>,
    cursor_effect: UnsafeCell<DROPEFFECT>,
    enter_is_valid: UnsafeCell<bool>,
}

impl FileDropTarget {
    fn new(coordinate_hwnd: HWND, listener: Rc<dyn Fn(DropKind)>) -> Self {
        Self {
            coordinate_hwnd,
            listener,
            cursor_effect: UnsafeCell::new(DROPEFFECT_NONE),
            enter_is_valid: UnsafeCell::new(false),
        }
    }

    unsafe fn read_paths(data_obj: windows_core::Ref<'_, IDataObject>) -> Option<Vec<String>> {
        let drop_format = FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };

        let obj = data_obj.as_ref()?;
        let medium = obj.GetData(&drop_format).ok()?;
        Self::paths_from_medium(medium)
    }

    unsafe fn paths_from_medium(medium: STGMEDIUM) -> Option<Vec<String>> {
        let medium = DropMedium(medium);
        if medium.0.tymed != TYMED_HGLOBAL.0 as u32 || medium.0.u.hGlobal.0.is_null() {
            return None;
        }
        let hdrop = HDROP(medium.0.u.hGlobal.0);
        let item_count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
        let mut paths = Vec::new();
        for i in 0..item_count {
            let character_count = DragQueryFileW(hdrop, i, None) as usize;
            let mut path_buf = vec![0u16; character_count + 1];
            let copied = DragQueryFileW(hdrop, i, Some(&mut path_buf)) as usize;
            if copied == 0 || copied != character_count {
                return None;
            }
            paths.push(OsString::from_wide(&path_buf[..copied]).into());
        }
        Some(Self::paths_as_strings(paths))
    }

    fn client_point(hwnd: HWND, pt: &POINTL) -> (i32, i32) {
        let mut pt = POINT { x: pt.x, y: pt.y };
        let _ = unsafe { ScreenToClient(hwnd, &mut pt) };
        (pt.x, pt.y)
    }

    fn paths_as_strings(paths: Vec<PathBuf>) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for p in paths {
            let s = p.to_string_lossy().replace('/', "\\");
            if s.is_empty() || !seen.insert(s.clone()) {
                continue;
            }
            out.push(s);
        }
        out
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for FileDropTarget_Impl {
    fn DragEnter(
        &self,
        pDataObj: windows_core::Ref<'_, IDataObject>,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let (x, y) = FileDropTarget::client_point(self.coordinate_hwnd, pt);
        let paths = unsafe { FileDropTarget::read_paths(pDataObj) }.unwrap_or_default();
        let enter_is_valid = !paths.is_empty();
        unsafe {
            *self.enter_is_valid.get() = enter_is_valid;
        }
        let effect = if enter_is_valid {
            (self.listener)(DropKind::Enter { paths, x, y });
            DROPEFFECT_COPY
        } else {
            DROPEFFECT_NONE
        };
        unsafe {
            *pdwEffect = effect;
            *self.cursor_effect.get() = effect;
        }
        Ok(())
    }

    fn DragOver(
        &self,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        if unsafe { *self.enter_is_valid.get() } {
            let (x, y) = FileDropTarget::client_point(self.coordinate_hwnd, pt);
            (self.listener)(DropKind::Over { x, y });
        }
        unsafe {
            *pdwEffect = *self.cursor_effect.get();
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        if unsafe { *self.enter_is_valid.get() } {
            (self.listener)(DropKind::Leave);
        }
        unsafe {
            *self.enter_is_valid.get() = false;
            *self.cursor_effect.get() = DROPEFFECT_NONE;
        }
        Ok(())
    }

    fn Drop(
        &self,
        pDataObj: windows_core::Ref<'_, IDataObject>,
        _grfKeyState: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        pdwEffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let mut effect = DROPEFFECT_NONE;
        if unsafe { *self.enter_is_valid.get() } {
            let (x, y) = FileDropTarget::client_point(self.coordinate_hwnd, pt);
            let paths = unsafe { FileDropTarget::read_paths(pDataObj) }.unwrap_or_default();
            if !paths.is_empty() {
                (self.listener)(DropKind::Drop { paths, x, y });
                effect = DROPEFFECT_COPY;
            } else {
                (self.listener)(DropKind::Leave);
            }
        }
        unsafe {
            *self.enter_is_valid.get() = false;
            *self.cursor_effect.get() = DROPEFFECT_NONE;
            *pdwEffect = effect;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, mem::ManuallyDrop};
    use windows::{
        core::Interface,
        Win32::{
            Foundation::{GlobalFree, HGLOBAL},
            System::{
                Com::STGMEDIUM_0,
                Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT},
            },
            UI::Shell::DROPFILES,
        },
    };

    struct MediumOwner {
        handle: HGLOBAL,
        releases: Rc<Cell<usize>>,
    }

    impl Drop for MediumOwner {
        fn drop(&mut self) {
            // GlobalFree returns a null handle on success, which the generated
            // windows Result wrapper represents as an HRESULT-shaped error.
            let _ = unsafe { GlobalFree(Some(self.handle)) };
            self.releases.set(self.releases.get() + 1);
        }
    }

    fn file_medium(paths: &[&str], releases: Rc<Cell<usize>>) -> STGMEDIUM {
        let file_list: Vec<u16> = paths
            .iter()
            .flat_map(|path| path.encode_utf16().chain([0]))
            .chain([0])
            .collect();
        let header_size = size_of::<DROPFILES>();
        let handle = unsafe {
            GlobalAlloc(
                GMEM_MOVEABLE | GMEM_ZEROINIT,
                header_size + file_list.len() * size_of::<u16>(),
            )
            .unwrap()
        };
        let owner = MediumOwner { handle, releases };
        unsafe {
            let buffer = GlobalLock(handle).cast::<u8>();
            assert!(!buffer.is_null());
            buffer.cast::<DROPFILES>().write_unaligned(DROPFILES {
                pFiles: header_size as u32,
                fWide: true.into(),
                ..Default::default()
            });
            ptr::copy_nonoverlapping(
                file_list.as_ptr().cast::<u8>(),
                buffer.add(header_size),
                file_list.len() * size_of::<u16>(),
            );
            let _ = GlobalUnlock(handle);
        }
        // Reuse a COM object whose last release also frees the test's HGLOBAL.
        let release_target: IDropTarget = FileDropTarget::new(
            HWND(ptr::null_mut()),
            Rc::new(move |_| {
                let _ = &owner;
            }),
        )
        .into();
        STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 { hGlobal: handle },
            pUnkForRelease: ManuallyDrop::new(Some(release_target.cast().unwrap())),
        }
    }

    #[test]
    fn copied_paths_release_delegated_medium_exactly_once() {
        let releases = Rc::new(Cell::new(0));
        let medium = file_medium(&[r"C:\Work\one.jpg", r"C:\Work\two.png"], releases.clone());
        let paths = unsafe { FileDropTarget::paths_from_medium(medium) }.unwrap();
        assert_eq!(paths, vec![r"C:\Work\one.jpg", r"C:\Work\two.png"]);
        assert_eq!(releases.get(), 1);
    }

    #[test]
    fn invalid_medium_still_releases_delegated_owner() {
        let releases = Rc::new(Cell::new(0));
        let mut medium = file_medium(&[r"C:\Work\one.jpg"], releases.clone());
        medium.u.hGlobal = HGLOBAL(ptr::null_mut());
        assert!(unsafe { FileDropTarget::paths_from_medium(medium) }.is_none());
        assert_eq!(releases.get(), 1);
    }

    #[test]
    fn missing_drop_data_clears_hover_and_rejects_copy() {
        let events = Rc::new(RefCell::new(Vec::new()));
        let listener_events = events.clone();
        let target = FileDropTarget::new(
            HWND(ptr::null_mut()),
            Rc::new(move |event| listener_events.borrow_mut().push(event)),
        );
        // The data source disappears after a valid DragEnter.
        unsafe {
            *target.enter_is_valid.get() = true;
            *target.cursor_effect.get() = DROPEFFECT_COPY;
        }
        let target: IDropTarget = target.into();
        let mut effect = DROPEFFECT_COPY;
        unsafe {
            target
                .Drop(None, MODIFIERKEYS_FLAGS(0), POINTL::default(), &mut effect)
                .unwrap();
            assert_eq!(effect, DROPEFFECT_NONE);
            target
                .DragOver(MODIFIERKEYS_FLAGS(0), POINTL::default(), &mut effect)
                .unwrap();
        }
        assert_eq!(effect, DROPEFFECT_NONE);
        assert!(matches!(&events.borrow()[..], [DropKind::Leave]));
    }

    #[test]
    fn paths_as_strings_normalizes_and_dedupes() {
        let paths = vec![
            PathBuf::from(r"C:\Work\demo"),
            PathBuf::from(r"C:/Work/demo"),
            PathBuf::from(r"D:\Repos\app"),
            PathBuf::from(""),
        ];
        assert_eq!(
            FileDropTarget::paths_as_strings(paths),
            vec![r"C:\Work\demo".to_string(), r"D:\Repos\app".to_string()]
        );
    }
}
