#[cfg(target_os = "windows")]
pub fn extract_exe_icon_png(path: &str) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, ReleaseDC, BITMAP,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
    };
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    fn icon_to_png(icon: HICON) -> Result<Vec<u8>, String> {
        let mut icon_info = ICONINFO::default();
        unsafe { GetIconInfo(icon, &mut icon_info) }.map_err(|e| e.to_string())?;

        let mut cleanup_handles: Vec<HGDIOBJ> = Vec::new();
        if !icon_info.hbmColor.is_invalid() {
            cleanup_handles.push(HGDIOBJ(icon_info.hbmColor.0));
        }
        if !icon_info.hbmMask.is_invalid() {
            cleanup_handles.push(HGDIOBJ(icon_info.hbmMask.0));
        }

        let color_bmp: HBITMAP = if !icon_info.hbmColor.is_invalid() {
            icon_info.hbmColor
        } else {
            icon_info.hbmMask
        };
        if color_bmp.is_invalid() {
            return Err("icon bitmap unavailable".to_string());
        }

        let mut bmp = BITMAP::default();
        let got = unsafe {
            GetObjectW(
                HGDIOBJ(color_bmp.0),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bmp as *mut _ as *mut _),
            )
        };
        if got == 0 {
            for h in cleanup_handles {
                let _ = unsafe { DeleteObject(h) };
            }
            return Err("GetObjectW failed for icon bitmap".to_string());
        }

        let width = bmp.bmWidth.max(1);
        let height = bmp.bmHeight.max(1);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };

        let mut bgra = vec![0u8; (width as usize) * (height as usize) * 4];
        let screen_dc: HDC =
            unsafe { windows::Win32::Graphics::Gdi::GetDC(Some(HWND(std::ptr::null_mut()))) };
        let mem_dc: HDC = unsafe { CreateCompatibleDC(Some(screen_dc)) };
        if mem_dc.is_invalid() {
            let _ = unsafe { ReleaseDC(Some(HWND(std::ptr::null_mut())), screen_dc) };
            for h in cleanup_handles {
                let _ = unsafe { DeleteObject(h) };
            }
            return Err("CreateCompatibleDC failed".to_string());
        }

        let copied = unsafe {
            GetDIBits(
                mem_dc,
                color_bmp,
                0,
                height as u32,
                Some(bgra.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            )
        };
        let _ = unsafe { DeleteDC(mem_dc) };
        let _ = unsafe { ReleaseDC(Some(HWND(std::ptr::null_mut())), screen_dc) };

        for h in cleanup_handles {
            let _ = unsafe { DeleteObject(h) };
        }

        if copied == 0 {
            return Err("GetDIBits failed".to_string());
        }

        // BGRA -> RGBA
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }

        let image = image::RgbaImage::from_raw(width as u32, height as u32, bgra)
            .ok_or_else(|| "invalid icon rgba buffer".to_string())?;
        let mut encoded = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut encoded),
                image::ImageFormat::Png,
            )
            .map_err(|e| e.to_string())?;
        Ok(encoded)
    }

    fn to_wide_null(input: &str) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(input)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let wide = to_wide_null(path);
    let mut large = [HICON::default(); 1];
    let mut small = [HICON::default(); 1];
    let count = unsafe {
        ExtractIconExW(
            PCWSTR(wide.as_ptr()),
            0,
            Some(large.as_mut_ptr()),
            Some(small.as_mut_ptr()),
            1,
        )
    };
    if count == 0 {
        return Err("no icon found in target file".to_string());
    }

    let icon = if !large[0].is_invalid() {
        large[0]
    } else {
        small[0]
    };
    if icon.is_invalid() {
        return Err("extracted icon handle is null".to_string());
    }

    let png = icon_to_png(icon);
    if !large[0].is_invalid() {
        let _ = unsafe { DestroyIcon(large[0]) };
    }
    if !small[0].is_invalid() && small[0].0 != large[0].0 {
        let _ = unsafe { DestroyIcon(small[0]) };
    }
    png
}

#[cfg(not(target_os = "windows"))]
pub fn extract_exe_icon_png(_path: &str) -> Result<Vec<u8>, String> {
    Err("icon extraction is only supported on Windows".to_string())
}
