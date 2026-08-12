use std::{future::Future, time::Duration};

// The CLI normally flushes chat_history before the prompt RPC resolves, but
// filesystem scheduling can make the final rows visible slightly later. Keep
// this window short and bounded while covering both a late first write and an
// incrementally flushed turn.
const POST_TURN_RECONCILE_DELAYS: [Duration; 4] = [
    Duration::ZERO,
    Duration::from_millis(125),
    Duration::from_millis(375),
    Duration::from_millis(750),
];

async fn retry_reconcile_with<F, Fut>(delays: &[Duration], mut reconcile: F) -> u32
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<u32>>,
{
    let mut total_changed = 0_u32;
    for delay in delays {
        if !delay.is_zero() {
            tokio::time::sleep(*delay).await;
        }
        // Reconciliation is idempotent. Run every bounded attempt instead of
        // stopping at the first change so a partially visible history file can
        // contribute its remaining rows on a later pass.
        let Some(changed) = reconcile().await else {
            break;
        };
        total_changed = total_changed.saturating_add(changed);
    }
    total_changed
}

pub(super) async fn reconcile_linked_session(
    manager: &super::SessionManager,
    app_session_id: &str,
    completed_turn_id: &str,
) -> u32 {
    let app_session_id = app_session_id.to_string();
    let completed_turn_id = completed_turn_id.to_string();
    let journal_lock = manager.post_turn_journal_lock(&app_session_id);
    retry_reconcile_with(&POST_TURN_RECONCILE_DELAYS, || {
        let app_session_id = app_session_id.clone();
        let completed_turn_id = completed_turn_id.clone();
        let journal_lock = journal_lock.clone();
        async move {
            // A new turn can begin while this bounded retry is sleeping. Lock
            // against its user-message append, then stop before importing any
            // partial rows that belong to that newer turn.
            let _journal_guard = journal_lock.lock().await;
            let superseded = manager
                .with_session_mut(&app_session_id, |session| {
                    session.prompt_in_flight
                        && session.active_turn_id.as_deref() != Some(completed_turn_id.as_str())
                })
                .unwrap_or(false);
            if superseded {
                return None;
            }

            let session_for_log = app_session_id.clone();
            match tokio::task::spawn_blocking(move || {
                crate::cli_sessions::try_reconcile_linked_session(&app_session_id)
            })
            .await
            {
                Ok(changed) => Some(changed),
                Err(error) => {
                    tracing::warn!(
                        target: "session",
                        session = %session_for_log,
                        error = %error,
                        "post-turn journal reconcile task failed"
                    );
                    Some(0)
                }
            }
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{retry_reconcile_with, POST_TURN_RECONCILE_DELAYS};
    use std::{
        future::ready,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
        time::Duration,
    };

    const NO_DELAYS: [Duration; 4] = [Duration::ZERO; 4];

    #[test]
    fn retry_window_starts_immediately_and_stays_bounded() {
        assert_eq!(POST_TURN_RECONCILE_DELAYS[0], Duration::ZERO);
        assert!(POST_TURN_RECONCILE_DELAYS.len() <= 4);
        assert!(POST_TURN_RECONCILE_DELAYS.iter().sum::<Duration>() <= Duration::from_secs(2));
    }

    #[tokio::test]
    async fn retries_after_no_change_and_aggregates_incremental_flushes() {
        let outcomes = Arc::new([0_u32, 2, 0, 3]);
        let attempts = Arc::new(AtomicUsize::new(0));

        let changed = retry_reconcile_with(&NO_DELAYS, {
            let outcomes = Arc::clone(&outcomes);
            let attempts = Arc::clone(&attempts);
            move || {
                let index = attempts.fetch_add(1, Ordering::SeqCst);
                ready(Some(outcomes[index]))
            }
        })
        .await;

        assert_eq!(changed, 5);
        assert_eq!(attempts.load(Ordering::SeqCst), NO_DELAYS.len());
    }

    #[tokio::test]
    async fn exhausts_the_bounded_window_when_history_never_changes() {
        let attempts = Arc::new(AtomicUsize::new(0));

        let changed = retry_reconcile_with(&NO_DELAYS, {
            let attempts = Arc::clone(&attempts);
            move || {
                attempts.fetch_add(1, Ordering::SeqCst);
                ready(Some(0))
            }
        })
        .await;

        assert_eq!(changed, 0);
        assert_eq!(attempts.load(Ordering::SeqCst), NO_DELAYS.len());
    }

    #[tokio::test]
    async fn saturates_the_aggregated_change_count() {
        let outcomes = Arc::new([u32::MAX, 1]);
        let attempts = Arc::new(AtomicUsize::new(0));

        let changed = retry_reconcile_with(&NO_DELAYS[..2], {
            let outcomes = Arc::clone(&outcomes);
            let attempts = Arc::clone(&attempts);
            move || {
                let index = attempts.fetch_add(1, Ordering::SeqCst);
                ready(Some(outcomes[index]))
            }
        })
        .await;

        assert_eq!(changed, u32::MAX);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn stops_retrying_when_a_new_turn_supersedes_the_completed_one() {
        let outcomes = Arc::new([Some(2_u32), None, Some(99)]);
        let attempts = Arc::new(AtomicUsize::new(0));

        let changed = retry_reconcile_with(&NO_DELAYS[..3], {
            let outcomes = Arc::clone(&outcomes);
            let attempts = Arc::clone(&attempts);
            move || {
                let index = attempts.fetch_add(1, Ordering::SeqCst);
                ready(outcomes[index])
            }
        })
        .await;

        assert_eq!(changed, 2);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }
}
