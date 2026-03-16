use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, LazyLock};

use tokio::sync::{Mutex, Notify, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::spider_response_contract::NormalizedSpiderMethodResponse;
use crate::spider_runtime_contract::current_spider_feature_flags;

const GLOBAL_SPIDER_CONCURRENCY: usize = 8;
const PER_SITE_SPIDER_CONCURRENCY: usize = 2;

#[derive(Clone)]
struct InFlightTask {
    notify: Arc<Notify>,
    result: Arc<Mutex<Option<Result<NormalizedSpiderMethodResponse, String>>>>,
    site_key: String,
    cancel_token: CancellationToken,
}

#[derive(Clone)]
struct CachedTaskValue {
    value: NormalizedSpiderMethodResponse,
    expires_at_ms: u64,
}

#[derive(Default)]
struct SpiderTaskManagerState {
    in_flight: HashMap<String, InFlightTask>,
    cache: HashMap<String, CachedTaskValue>,
    site_limits: HashMap<String, Arc<Semaphore>>,
}

static SPIDER_TASK_MANAGER: LazyLock<Mutex<SpiderTaskManagerState>> =
    LazyLock::new(|| Mutex::new(SpiderTaskManagerState::default()));
static GLOBAL_SPIDER_SEMAPHORE: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(GLOBAL_SPIDER_CONCURRENCY));

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn spider_cache_ttl_ms(method: &str) -> u64 {
    match method {
        "homeContent" => 2_500,
        "categoryContent" => 2_000,
        "searchContent" => 1_500,
        "detailContent" => 2_500,
        "playerContent" => 1_000,
        _ => 0,
    }
}

pub fn build_task_key(
    site_key: &str,
    method: &str,
    ext: &str,
    args: &[(&str, String)],
    policy_generation: u64,
) -> String {
    let args_text = args
        .iter()
        .map(|(kind, value)| format!("{kind}:{value}"))
        .collect::<Vec<_>>()
        .join("|");
    let ext_hash = format!("{:x}", md5::compute(ext.as_bytes()));
    let args_hash = format!("{:x}", md5::compute(args_text.as_bytes()));
    format!(
        "{}::{}::{}::{}::{}",
        site_key.trim(),
        method.trim(),
        ext_hash,
        args_hash,
        policy_generation
    )
}

pub async fn run_spider_task<F, Fut>(
    site_key: &str,
    method: &str,
    task_key: String,
    runner: F,
) -> Result<NormalizedSpiderMethodResponse, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<NormalizedSpiderMethodResponse, String>>,
{
    if !current_spider_feature_flags().spider_task_manager_v1 {
        return runner().await;
    }

    let now = now_unix_ms();
    let existing_task = {
        let mut state = SPIDER_TASK_MANAGER.lock().await;
        state.cache.retain(|_, entry| entry.expires_at_ms > now);
        if let Some(entry) = state.cache.get(&task_key) {
            return Ok(entry.value.clone());
        }
        if let Some(task) = state.in_flight.get(&task_key) {
            Some(task.clone())
        } else {
            let task = InFlightTask {
                notify: Arc::new(Notify::new()),
                result: Arc::new(Mutex::new(None)),
                site_key: site_key.trim().to_string(),
                cancel_token: CancellationToken::new(),
            };
            state.in_flight.insert(task_key.clone(), task);
            None
        }
    };
    if let Some(task) = existing_task {
        task.notify.notified().await;
        let guard = task.result.lock().await;
        return guard
            .clone()
            .unwrap_or_else(|| Err("shared spider task completed without a result".to_string()));
    }

    let task = {
        let state = SPIDER_TASK_MANAGER.lock().await;
        state
            .in_flight
            .get(&task_key)
            .cloned()
            .ok_or_else(|| "spider task missing after registration".to_string())?
    };

    let site_limit = {
        let mut state = SPIDER_TASK_MANAGER.lock().await;
        state
            .site_limits
            .entry(site_key.trim().to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(PER_SITE_SPIDER_CONCURRENCY)))
            .clone()
    };

    let cancel_token = task.cancel_token.clone();
    let _global_permit = tokio::select! {
        _ = cancel_token.cancelled() => {
            return finalize_cancelled_task(task_key, task).await;
        }
        permit = GLOBAL_SPIDER_SEMAPHORE.acquire() => {
            permit.map_err(|_| "global spider task semaphore closed".to_string())?
        }
    };
    let _site_permit = tokio::select! {
        _ = cancel_token.cancelled() => {
            return finalize_cancelled_task(task_key, task).await;
        }
        permit = site_limit.acquire() => {
            permit.map_err(|_| "site spider task semaphore closed".to_string())?
        }
    };

    let result = tokio::select! {
        _ = cancel_token.cancelled() => {
            Err("spider task cancelled".to_string())
        }
        result = runner() => result,
    };
    if let Ok(value) = &result {
        let ttl = spider_cache_ttl_ms(method);
        if ttl > 0
            && value.report.source_health_impact
                != crate::spider_runtime_contract::SpiderSourceHealthImpact::Hard
        {
            let mut state = SPIDER_TASK_MANAGER.lock().await;
            state.cache.insert(
                task_key.clone(),
                CachedTaskValue {
                    value: value.clone(),
                    expires_at_ms: now_unix_ms().saturating_add(ttl),
                },
            );
        }
    }

    {
        let mut guard = task.result.lock().await;
        *guard = Some(result.clone());
    }
    task.notify.notify_waiters();

    let mut state = SPIDER_TASK_MANAGER.lock().await;
    state.in_flight.remove(&task_key);
    result
}

async fn finalize_cancelled_task(
    task_key: String,
    task: InFlightTask,
) -> Result<NormalizedSpiderMethodResponse, String> {
    let result = Err("spider task cancelled".to_string());
    {
        let mut guard = task.result.lock().await;
        *guard = Some(result.clone());
    }
    task.notify.notify_waiters();

    let mut state = SPIDER_TASK_MANAGER.lock().await;
    state.in_flight.remove(&task_key);
    result
}

pub async fn cancel_spider_tasks(site_key: Option<&str>) -> usize {
    let normalized_site_key = site_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let tasks = {
        let state = SPIDER_TASK_MANAGER.lock().await;
        state
            .in_flight
            .values()
            .filter(|task| {
                normalized_site_key
                    .as_ref()
                    .map(|site_key| task.site_key == *site_key)
                    .unwrap_or(true)
            })
            .cloned()
            .collect::<Vec<_>>()
    };

    for task in &tasks {
        task.cancel_token.cancel();
    }

    tasks.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    async fn reset_task_manager_state() {
        let mut state = SPIDER_TASK_MANAGER.lock().await;
        state.in_flight.clear();
        state.cache.clear();
        state.site_limits.clear();
    }

    fn sample_response(site_key: &str, method: &str) -> NormalizedSpiderMethodResponse {
        crate::spider_response_contract::build_normalized_method_response(
            site_key,
            method,
            serde_json::json!({
                "class": [{"type_id": "1", "type_name": "电影"}],
                "list": [{"vod_id": "v1", "vod_name": "片名"}]
            })
            .to_string(),
            crate::spider_cmds_runtime::success_report(
                site_key,
                method,
                Some(site_key.to_string()),
                None,
                None,
            ),
        )
        .expect("sample response should build")
    }

    #[tokio::test]
    async fn deduplicates_concurrent_tasks_by_key() {
        reset_task_manager_state().await;

        let site_key = "csp_Test_Dedup";
        let counter = Arc::new(AtomicUsize::new(0));
        let task_key = build_task_key(site_key, "homeContent", "ext", &[], 1);

        let counter_a = counter.clone();
        let future_a = run_spider_task(site_key, "homeContent", task_key.clone(), move || {
            let counter = counter_a.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(40)).await;
                Ok(sample_response(site_key, "homeContent"))
            }
        });

        let counter_b = counter.clone();
        let future_b = run_spider_task(site_key, "homeContent", task_key.clone(), move || {
            let counter = counter_b.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(sample_response(site_key, "homeContent"))
            }
        });

        let (result_a, result_b) = tokio::join!(future_a, future_b);

        assert!(result_a.is_ok());
        assert!(result_b.is_ok());
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn reuses_cached_successful_task_results() {
        reset_task_manager_state().await;

        let site_key = "csp_Test_Cache";
        let counter = Arc::new(AtomicUsize::new(0));
        let task_key = build_task_key(site_key, "homeContent", "ext", &[], 1);

        let counter_first = counter.clone();
        let first = run_spider_task(site_key, "homeContent", task_key.clone(), move || {
            let counter = counter_first.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(sample_response(site_key, "homeContent"))
            }
        })
        .await;

        let counter_second = counter.clone();
        let second = run_spider_task(site_key, "homeContent", task_key.clone(), move || {
            let counter = counter_second.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(sample_response(site_key, "homeContent"))
            }
        })
        .await;

        assert!(first.is_ok());
        assert!(second.is_ok());
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancels_in_flight_tasks_by_site_key() {
        reset_task_manager_state().await;

        let site_key = "csp_Test_Cancel";
        let task_key = build_task_key(site_key, "detailContent", "ext", &[], 1);
        let task = tokio::spawn(async move {
            run_spider_task(site_key, "detailContent", task_key, move || async move {
                tokio::time::sleep(Duration::from_secs(5)).await;
                Ok(sample_response(site_key, "detailContent"))
            })
            .await
        });

        tokio::time::sleep(Duration::from_millis(50)).await;
        let cancelled = cancel_spider_tasks(Some(site_key)).await;
        let result = task.await.expect("task join should succeed");

        assert_eq!(cancelled, 1);
        assert!(result.is_err());
        assert!(
            result
                .err()
                .unwrap_or_default()
                .contains("spider task cancelled")
        );
    }
}
