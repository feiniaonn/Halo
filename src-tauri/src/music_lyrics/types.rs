#[derive(Debug, Clone, Default)]
pub struct ProviderLyricsCandidate {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub artist: String,
    pub duration_ms: Option<u64>,
    pub primary_lrc: String,
    pub translation_lrc: Option<String>,
    pub romanized_lrc: Option<String>,
    pub plain_text: Option<String>,
}
