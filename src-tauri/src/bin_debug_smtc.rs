use windows::Win32::Foundation::{HWND, LPARAM, HANDLE, CloseHandle, MAX_PATH};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, GetWindowThreadProcessId};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW, PROCESS_NAME_WIN32};

fn main() {
    unsafe extern "system" fn enum_window_callback(hwnd: HWND, _: LPARAM) -> windows::core::BOOL {
        let mut text: [u16; 512] = [0; 512];
        let len = GetWindowTextW(hwnd, &mut text);
        if len > 0 {
            let title = String::from_utf16_lossy(&text[..len as usize]);
            if title.contains("-") && title.len() < 100 {
                let mut pid = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                
                if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    let mut path_buf = [0u16; 1024];
                    let mut path_len = path_buf.len() as u32;
                    let _ = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR::from_raw(path_buf.as_mut_ptr()), &mut path_len);
                    let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                    if path.to_lowercase().ends_with("qqmusic.exe") {
                        println!("Found QQMusic! PID: {} Title: '{}', Path: {}", pid, title, path);
                    }
                    let _ = CloseHandle(handle);
                }
            }
        }
        windows::core::BOOL::from(true)
    }
    unsafe { let _ = EnumWindows(Some(enum_window_callback), LPARAM(0)); }
}
