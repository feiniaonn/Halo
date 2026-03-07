use crate::music_lyrics::types::ProviderLyricsCandidate;

pub async fn fetch(_artist: &str, _title: &str) -> Vec<ProviderLyricsCandidate> {
    Vec::new()
}
