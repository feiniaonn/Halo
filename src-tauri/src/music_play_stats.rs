use crate::CurrentPlayingInfo;

const PLAY_COUNT_THRESHOLD_RATIO: f64 = 0.70;
const PLAY_COUNT_FINISH_GRACE_SECS: u64 = 5;
const SEEK_FORWARD_GRACE_SECS: u64 = 4;
const SEEK_BACKWARD_THRESHOLD_SECS: u64 = 5;
const LOOP_RESET_POSITION_SECS: u64 = 3;

#[derive(Debug, Clone, Default)]
pub struct PlayEventRecorder {
    tracker: Option<TrackPlaybackProgress>,
}

#[derive(Debug, Clone)]
struct TrackPlaybackProgress {
    track_key: String,
    artist: String,
    title: String,
    cover_path: Option<String>,
    source_app_id: Option<String>,
    source_platform: Option<String>,
    duration_secs: Option<u64>,
    last_position_secs: Option<u64>,
    last_seen_at_ms: i64,
    max_natural_position_secs: u64,
    observed_playback_secs: u64,
    seek_detected: bool,
    counted: bool,
}

#[derive(Debug, Clone)]
struct RecordedPlay {
    artist: String,
    title: String,
    cover_path: Option<String>,
    source_app_id: Option<String>,
    source_platform: Option<String>,
    played_secs: i64,
}

impl PlayEventRecorder {
    pub fn observe(&mut self, current: &CurrentPlayingInfo, now_ms: i64) -> Result<bool, String> {
        if let Some(event) = self.observe_inner(current, now_ms) {
            crate::db::record_play_event(
                &event.artist,
                &event.title,
                event.cover_path.as_deref(),
                event.source_app_id.as_deref(),
                event.source_platform.as_deref(),
                now_ms,
                event.played_secs,
            )?;
            return Ok(true);
        }
        Ok(false)
    }

    fn observe_inner(&mut self, current: &CurrentPlayingInfo, now_ms: i64) -> Option<RecordedPlay> {
        let Some(track_key) = runtime_track_key(current) else {
            self.tracker = None;
            return None;
        };

        let should_restart_cycle = self
            .tracker
            .as_ref()
            .map(|tracker| {
                tracker.track_key == track_key && track_cycle_restarted(tracker, current)
            })
            .unwrap_or(false);

        let same_track = self
            .tracker
            .as_ref()
            .map(|tracker| tracker.track_key == track_key)
            .unwrap_or(false);

        let mut event = None;
        if should_restart_cycle || !same_track {
            if let Some(previous) = self.tracker.take() {
                event = finalize_tracker(previous);
            }
        }

        let tracker = self
            .tracker
            .get_or_insert_with(|| TrackPlaybackProgress::new(track_key, current, now_ms));
        tracker.observe(current, now_ms);

        if !tracker.counted {
            if let Some(next_event) = tracker.maybe_record_now() {
                tracker.counted = true;
                event = Some(next_event);
            }
        }

        event
    }
}

impl TrackPlaybackProgress {
    fn new(track_key: String, current: &CurrentPlayingInfo, now_ms: i64) -> Self {
        Self {
            track_key,
            artist: current.artist.trim().to_string(),
            title: current.title.trim().to_string(),
            cover_path: current.cover_path.clone(),
            source_app_id: current.source_app_id.clone(),
            source_platform: current.source_platform.clone(),
            duration_secs: current.duration_secs,
            last_position_secs: current.position_secs,
            last_seen_at_ms: now_ms,
            max_natural_position_secs: current.position_secs.unwrap_or(0),
            observed_playback_secs: 0,
            seek_detected: false,
            counted: false,
        }
    }

    fn observe(&mut self, current: &CurrentPlayingInfo, now_ms: i64) {
        if self.cover_path.is_none() {
            self.cover_path = current.cover_path.clone();
        }
        if self.duration_secs.is_none() {
            self.duration_secs = current.duration_secs;
        }
        if self.source_app_id.is_none() {
            self.source_app_id = current.source_app_id.clone();
        }
        if self.source_platform.is_none() {
            self.source_platform = current.source_platform.clone();
        }

        let is_playing = is_playing_snapshot(current);
        let next_position = current.position_secs;

        if is_playing {
            match (self.last_position_secs, next_position) {
                (Some(previous), Some(current_position)) if current_position >= previous => {
                    let elapsed_secs =
                        now_ms.saturating_sub(self.last_seen_at_ms).max(0) as u64 / 1000;
                    let allowed_delta = elapsed_secs.saturating_add(SEEK_FORWARD_GRACE_SECS).max(1);
                    let delta = current_position.saturating_sub(previous);
                    if delta <= allowed_delta {
                        self.observed_playback_secs =
                            self.observed_playback_secs.saturating_add(delta);
                        self.max_natural_position_secs =
                            self.max_natural_position_secs.max(current_position);
                    } else if delta > 0 {
                        self.seek_detected = true;
                    }
                }
                (Some(previous), Some(current_position))
                    if previous.saturating_sub(current_position) > SEEK_BACKWARD_THRESHOLD_SECS =>
                {
                    self.seek_detected = true;
                }
                (None, Some(current_position)) => {
                    self.max_natural_position_secs =
                        self.max_natural_position_secs.max(current_position);
                }
                _ => {}
            }
        }

        self.last_position_secs = next_position;
        self.last_seen_at_ms = now_ms;
    }

    fn maybe_record_now(&self) -> Option<RecordedPlay> {
        if self.counted || self.seek_detected || self.observed_playback_secs == 0 {
            return None;
        }
        let duration_secs = self.duration_secs?;
        let threshold_secs = ((duration_secs as f64) * PLAY_COUNT_THRESHOLD_RATIO).ceil() as u64;
        let natural_position = self.max_natural_position_secs;
        let completed = natural_position.saturating_add(PLAY_COUNT_FINISH_GRACE_SECS) >= duration_secs;
        let crossed_threshold = natural_position >= threshold_secs;
        if completed || crossed_threshold {
            Some(self.to_recorded_play())
        } else {
            None
        }
    }

    fn to_recorded_play(&self) -> RecordedPlay {
        RecordedPlay {
            artist: self.artist.clone(),
            title: self.title.clone(),
            cover_path: self.cover_path.clone(),
            source_app_id: self.source_app_id.clone(),
            source_platform: self.source_platform.clone(),
            played_secs: self.observed_playback_secs.min(i64::MAX as u64) as i64,
        }
    }
}

fn finalize_tracker(tracker: TrackPlaybackProgress) -> Option<RecordedPlay> {
    if tracker.counted {
        return None;
    }
    tracker.maybe_record_now()
}

fn runtime_track_key(current: &CurrentPlayingInfo) -> Option<String> {
    let artist = current.artist.trim();
    let title = current.title.trim();
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    let source = current
        .source_app_id
        .as_deref()
        .or(current.source_platform.as_deref())
        .unwrap_or("");
    Some(format!(
        "{}|{}|{}",
        source.trim().to_ascii_lowercase(),
        artist.to_ascii_lowercase(),
        title.to_ascii_lowercase()
    ))
}

fn is_playing_snapshot(current: &CurrentPlayingInfo) -> bool {
    current
        .playback_status
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("playing"))
        .unwrap_or(false)
}

fn track_cycle_restarted(tracker: &TrackPlaybackProgress, current: &CurrentPlayingInfo) -> bool {
    let duration_secs = tracker.duration_secs.or(current.duration_secs);
    let previous_position = tracker.last_position_secs;
    let current_position = current.position_secs;
    let Some(duration_secs) = duration_secs else {
        return false;
    };
    let Some(previous_position) = previous_position else {
        return false;
    };
    let Some(current_position) = current_position else {
        return false;
    };

    let was_near_end = tracker
        .max_natural_position_secs
        .max(previous_position)
        .saturating_add(PLAY_COUNT_FINISH_GRACE_SECS)
        >= duration_secs;
    was_near_end && current_position <= LOOP_RESET_POSITION_SECS
}

#[cfg(test)]
mod tests {
    use super::PlayEventRecorder;
    use crate::CurrentPlayingInfo;

    fn build_current(
        title: &str,
        status: &str,
        position_secs: u64,
        duration_secs: u64,
    ) -> CurrentPlayingInfo {
        CurrentPlayingInfo {
            artist: "Test Artist".to_string(),
            title: title.to_string(),
            cover_path: None,
            cover_data_url: None,
            duration_secs: Some(duration_secs),
            position_secs: Some(position_secs),
            position_sampled_at_ms: Some(0),
            timeline_updated_at_ms: Some(0),
            playback_status: Some(status.to_string()),
            source_app_id: Some("QQMusic".to_string()),
            source_platform: Some("qqmusic".to_string()),
        }
    }

    #[test]
    fn counts_when_track_crosses_threshold_naturally() {
        let mut recorder = PlayEventRecorder::default();

        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 60, 100), 0)
            .is_none());
        let event = recorder.observe_inner(&build_current("Song", "Playing", 71, 100), 11_000);

        assert!(event.is_some());
        assert_eq!(event.unwrap().title, "Song");
    }

    #[test]
    fn does_not_count_when_progress_jumps_forward_like_seek() {
        let mut recorder = PlayEventRecorder::default();

        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 10, 100), 0)
            .is_none());
        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 80, 100), 5_000)
            .is_none());
        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 90, 100), 15_000)
            .is_none());
    }

    #[test]
    fn loop_reset_does_not_immediately_double_count() {
        let mut recorder = PlayEventRecorder::default();

        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 69, 100), 0)
            .is_none());
        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 71, 100), 2_000)
            .is_some());
        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 99, 100), 4_000)
            .is_none());

        assert!(recorder
            .observe_inner(&build_current("Song", "Playing", 1, 100), 5_000)
            .is_none());
    }
}
