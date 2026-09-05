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
            Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
            Ole::{
                IDropTarget, IDropTarget_Impl, OleInitialize, RegisterDragDrop, RevokeDragDrop,
                CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::{
            Shell::{DragFinish, DragQueryFileW, HDROP},
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
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
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
    if inject_hwnd(hwnd, listener.clone()) {
        registered += 1;
    }
    for child in enum_child_hwnds(hwnd) {
        if inject_hwnd(child, listener.clone()) {
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

fn inject_hwnd(hwnd: HWND, listener: Rc<dyn Fn(DropKind)>) -> bool {
    if hwnd.0.is_null() {
        return false;
    }
    let target: IDropTarget = FileDropTarget::new(hwnd, listener).into();
    // Best-effort revoke (hwnd may never have been a drop target — that is OK).
    let _ = unsafe { RevokeDragDrop(hwnd) };
    match unsafe { RegisterDragDrop(hwnd, &target) } {
        Ok(()) => {
            TARGETS.with(|slot| slot.borrow_mut().push(target));
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
    hwnd: HWND,
    listener: Rc<dyn Fn(DropKind)>,
    cursor_effect: UnsafeCell<DROPEFFECT>,
    enter_is_valid: UnsafeCell<bool>,
}

impl FileDropTarget {
    fn new(hwnd: HWND, listener: Rc<dyn Fn(DropKind)>) -> Self {
        Self {
            hwnd,
            listener,
            cursor_effect: UnsafeCell::new(DROPEFFECT_NONE),
            enter_is_valid: UnsafeCell::new(false),
        }
    }

    unsafe fn iterate_filenames<F>(
        data_obj: windows_core::Ref<'_, IDataObject>,
        mut callback: F,
    ) -> Option<HDROP>
    where
        F: FnMut(PathBuf),
    {
        let drop_format = FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        };

        let obj = data_obj.as_ref()?;
        let medium = obj.GetData(&drop_format).ok()?;
        let hdrop = HDROP(medium.u.hGlobal.0 as _);
        let item_count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
        for i in 0..item_count {
            let character_count = DragQueryFileW(hdrop, i, None) as usize;
            let mut path_buf = vec![0u16; character_count + 1];
            DragQueryFileW(hdrop, i, Some(&mut path_buf));
            callback(OsString::from_wide(&path_buf[..character_count]).into());
        }
        Some(hdrop)
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
        let (x, y) = FileDropTarget::client_point(self.hwnd, pt);
        let mut paths = Vec::new();
        let hdrop = unsafe { FileDropTarget::iterate_filenames(pDataObj, |path| paths.push(path)) };
        let enter_is_valid = hdrop.is_some() && !paths.is_empty();
        unsafe {
            *self.enter_is_valid.get() = enter_is_valid;
        }
        let effect = if enter_is_valid {
            (self.listener)(DropKind::Enter {
                paths: FileDropTarget::paths_as_strings(paths),
                x,
                y,
            });
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
            let (x, y) = FileDropTarget::client_point(self.hwnd, pt);
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
            unsafe {
                *self.enter_is_valid.get() = false;
            }
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
        if unsafe { *self.enter_is_valid.get() } {
            let (x, y) = FileDropTarget::client_point(self.hwnd, pt);
            let mut paths = Vec::new();
            let hdrop =
                unsafe { FileDropTarget::iterate_filenames(pDataObj, |path| paths.push(path)) };
            (self.listener)(DropKind::Drop {
                paths: FileDropTarget::paths_as_strings(paths),
                x,
                y,
            });
            if let Some(hdrop) = hdrop {
                unsafe { DragFinish(hdrop) };
            }
            unsafe {
                *self.enter_is_valid.get() = false;
            }
        }
        unsafe {
            *pdwEffect = *self.cursor_effect.get();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::FileDropTarget;
    use std::path::PathBuf;

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
