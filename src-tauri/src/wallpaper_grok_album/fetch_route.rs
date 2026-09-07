use std::future::Future;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AlbumFetchRoute {
    Webview,
    Host,
}

impl AlbumFetchRoute {
    pub(super) const fn as_str(self) -> &'static str {
        match self {
            Self::Webview => "webview",
            Self::Host => "host",
        }
    }
}

pub(super) async fn first_success<T, W, H>(
    webview: W,
    host: H,
) -> Result<(T, AlbumFetchRoute), String>
where
    W: Future<Output = Result<T, String>>,
    H: Future<Output = Result<T, String>>,
{
    tokio::pin!(webview);
    tokio::pin!(host);
    tokio::select! {
        webview_result = &mut webview => match webview_result {
            Ok(value) => Ok((value, AlbumFetchRoute::Webview)),
            Err(_) => host.await.map(|value| (value, AlbumFetchRoute::Host)),
        },
        host_result = &mut host => match host_result {
            Ok(value) => Ok((value, AlbumFetchRoute::Host)),
            Err(_) => webview.await.map(|value| (value, AlbumFetchRoute::Webview)),
        },
    }
}
