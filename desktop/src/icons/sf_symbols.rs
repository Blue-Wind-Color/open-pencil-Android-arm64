//! The Swift library in `swift/sf-symbols`, which reads the symbols macOS has and draws them with
//! SwiftUI. Requests and answers are JSON in C strings.

use std::ffi::{c_char, CStr, CString};

extern "C" {
    fn op_sf_symbols_catalogue() -> *mut c_char;
    fn op_sf_symbols_render(request: *const c_char) -> *mut c_char;
    fn op_sf_symbols_free(answer: *mut c_char);
}

fn take(answer: *mut c_char) -> Option<String> {
    if answer.is_null() {
        return None;
    }
    // SAFETY: the library answers with a NUL-terminated string it allocated, freed once here.
    let text = unsafe { CStr::from_ptr(answer) }
        .to_string_lossy()
        .into_owned();
    unsafe { op_sf_symbols_free(answer) };
    Some(text)
}

pub fn catalogue() -> Option<String> {
    // SAFETY: the catalogue takes no arguments and may run on any thread.
    take(unsafe { op_sf_symbols_catalogue() })
}

/// Must run on the main thread.
pub fn render(request: &str) -> Option<String> {
    let request = CString::new(request).ok()?;
    // SAFETY: the request is a NUL-terminated string that outlives the call.
    take(unsafe { op_sf_symbols_render(request.as_ptr()) })
}
