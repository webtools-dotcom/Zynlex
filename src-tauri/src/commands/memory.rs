//! System memory, read for the hidden-tab timer (src/lib/memoryPolicy.ts): when
//! RAM is short, hidden tabs are suspended and discarded sooner; when there is
//! plenty, they are kept longer.

use serde::Serialize;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    /// Physical memory the OS can hand out right now without paging.
    pub available_mb: u64,
    pub total_mb: u64,
}

#[tauri::command]
pub fn system_memory() -> Result<SystemMemory, String> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    unsafe { GlobalMemoryStatusEx(&mut status) }.map_err(|e| e.to_string())?;
    Ok(SystemMemory {
        available_mb: status.ullAvailPhys / (1024 * 1024),
        total_mb: status.ullTotalPhys / (1024 * 1024),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_plausible_numbers() {
        let m = super::system_memory().unwrap();
        assert!(m.total_mb > 512, "{m:?}");
        assert!(m.available_mb > 0 && m.available_mb <= m.total_mb, "{m:?}");
    }
}
