pub fn open_with_shell(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("open_with_shell is only implemented on Windows in recovery build".to_string())
    }
}

pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("reveal_in_file_manager is only implemented on Windows in recovery build".to_string())
    }
}
