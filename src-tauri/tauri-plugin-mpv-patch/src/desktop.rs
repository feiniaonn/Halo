use log::info;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::{ipc, models::*, process, MpvExt};
use crate::{MpvInstance, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Mpv<R>> {
    info!("Plugin registered.");
    let mpv = Mpv {
        app: app.clone(),
        instances: Mutex::new(HashMap::new()),
    };
    Ok(mpv)
}

pub struct Mpv<R: Runtime> {
    app: AppHandle<R>,
    pub instances: Mutex<HashMap<String, MpvInstance>>,
}

impl<R: Runtime> Mpv<R> {
    pub fn init(&self, mpv_config: MpvConfig, window_label: &str) -> Result<String> {
        let app = self.app.clone();

        process::init_mpv_process(&app, mpv_config, window_label)?;

        Ok(window_label.to_string())
    }

    pub fn destroy(&self, window_label: &str) -> Result<()> {
        process::kill_mpv_process(&self.app, window_label)
    }

    pub fn command(
        &self,
        mpv_command: MpvCommand,
        window_label: &str,
    ) -> Result<MpvCommandResponse> {
        let (ipc_timeout, ipc_pipe) = {
            let instances_lock = match self.app.mpv().instances.lock() {
                Ok(guard) => guard,
                Err(poisoned) => {
                    log::warn!("mpv instances mutex was poisoned during command, recovering");
                    poisoned.into_inner()
                }
            };
            let instance = instances_lock
                .get(window_label)
                .ok_or(crate::Error::MpvProcessError(format!(
                    "No mpv instance for window '{}'",
                    window_label
                )))?;
            (instance.ipc_timeout, instance.ipc_pipe.clone())
        };
        ipc::send_command(mpv_command, window_label, &ipc_pipe, ipc_timeout)
    }

    pub fn set_video_margin_ratio(
        &self,
        ratio: VideoMarginRatio,
        window_label: &str,
    ) -> Result<()> {
        let (ipc_timeout, ipc_pipe) = {
            let instances_lock = match self.app.mpv().instances.lock() {
                Ok(guard) => guard,
                Err(poisoned) => {
                    log::warn!("mpv instances mutex was poisoned during set_video_margin_ratio, recovering");
                    poisoned.into_inner()
                }
            };
            let instance = instances_lock
                .get(window_label)
                .ok_or(crate::Error::MpvProcessError(format!(
                    "No mpv instance for window '{}'",
                    window_label
                )))?;
            (instance.ipc_timeout, instance.ipc_pipe.clone())
        };

        let margins = [
            ("video-margin-ratio-left", ratio.left),
            ("video-margin-ratio-right", ratio.right),
            ("video-margin-ratio-top", ratio.top),
            ("video-margin-ratio-bottom", ratio.bottom),
        ];

        for (property, value_option) in margins {
            if let Some(value) = value_option {
                let mpv_command = MpvCommand {
                    command: vec!["set_property".into(), property.into(), value.into()],
                    request_id: None,
                };
                ipc::send_command(mpv_command, window_label, &ipc_pipe, ipc_timeout)?;
            }
        }

        Ok(())
    }
}
