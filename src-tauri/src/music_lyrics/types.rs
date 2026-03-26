#[derive(Debug, Clone, Default)]
pub struct ProviderTimedWord {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderTimedLine {
    pub start_ms: u64,
    pub words: Vec<ProviderTimedWord>,
}

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
    pub word_timed_primary: Option<Vec<ProviderTimedLine>>,
}
