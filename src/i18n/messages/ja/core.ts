/** Japanese overrides — high-traffic product surfaces. */
import type { MessageKey } from "../en";

export const jaCore: Partial<Record<MessageKey, string>> = {
  // Window chrome / account menu.
  "window.minimize": "最小化",
  "window.maximize": "最大化",
  "window.restore": "元のサイズに戻す",
  "window.close": "閉じる",
  "user.menu": "アカウントメニュー",
  "user.theme": "テーマ",
  "user.themeLight": "ライトに切り替え",
  "user.themeDark": "ダークに切り替え",

  // Common actions.
  "common.cancel": "キャンセル",
  "common.confirm": "確定",
  "common.save": "保存",
  "common.dismiss": "閉じる",
  "common.close": "閉じる",
  "common.local": "ローカル",
  "common.comingSoon": "近日公開",

  // Reasoning effort / agent mode.
  "effort.high": "高",
  "effort.medium": "中",
  "effort.low": "低",
  "effort.xhigh": "最高",
  "effort.max": "最高",
  "mode.agent": "エージェント",
  "mode.plan": "プラン",
  "mode.ask": "質問",
  "mode.agentDesc": "全ツール利用可 — コマンドを実行できます",
  "mode.planDesc": "先に計画 — 編集前に提案します",
  "mode.askDesc": "回答のみ — ファイルもシェルも触りません",

  // Connection state.
  "conn.idle": "待機中",
  "conn.connecting": "接続中",
  "conn.ready": "準備完了",
  "conn.streaming": "実行中",
  "conn.permission": "許可が必要",
  "conn.disconnected": "切断",
  "conn.retryHint": "クリックすると接続を中止して再試行します",

  // Empty states.
  "empty.noProjectTitle": "プロジェクトが開かれていません",
  "empty.noProjectHint":
    "サイドバーからフォルダーを追加すると、コンテキスト付きで作業を始められます。",
  "empty.noChatsTitle": "チャットがありません",
  "empty.noChatsHint": "会話を始めると、サイドバーに表示されます。",
  "empty.disconnectedTitle": "エージェントが切断されました",
  "empty.disconnectedHint":
    "再接続してこのチャットを続けるか、新しいチャットを始めてください。",

  // Desktop notifications.
  "notify.turnDoneTitle": "Grok がターンを完了しました",
  "notify.turnDoneBody": "次のメッセージを送信できます。",
  "notify.permissionTitle": "許可が必要です",
  "notify.permissionBody": "エージェントが承認を待っています。",
  "notify.askUserTitle": "エージェントからの質問",
  "notify.askUserBody": "エージェントが回答を待っています。",

  // Permission prompt.
  "perm.title": "許可",
  "perm.allowOnce": "今回だけ許可",
  "perm.allowSession": "このセッション中は許可",
  "perm.deny": "拒否",
  "perm.hintOnce": "今回だけ実行し、次回はまた確認します。",
  "perm.hintSession": "このチャットの間、同種の操作を許可します。",
  "perm.hintDeny": "この操作をブロックし、エージェントに伝えます。",
  "perm.autoDenyCountdown": "{seconds} 秒後に自動で拒否",

  // Agent question modal.
  "askUser.title": "エージェントからの質問",
  "askUser.submit": "送信",
  "askUser.cancel": "閉じる",
  "askUser.otherPlaceholder": "回答を入力…",
  "askUser.freeTextHint": "自由に回答を入力することもできます",
  "askUser.multiHint": "1 つ以上選択してください",
  "askUser.autoCancelCountdown": "{seconds} 秒後に自動で閉じます",

  // Tray / menu bar.
  "tray.recent": "最近",
  "tray.noRecent": "最近のチャットはありません",
  "tray.untitled": "無題",
  "tray.more": "その他",
  "tray.settings": "設定…",
  "tray.doctor": "ドクター",
  "tray.account": "アカウント",
  "tray.newChat": "新しいチャット",
  "tray.openApp": "Grok を開く",
  "tray.quit": "Grok を終了",
  "tray.usageWithReset": "使用量  ·  残り {pct}%  ·  {time}",
  "tray.usagePct": "使用量  ·  残り {pct}%",
  "tray.usageUnknown": "使用量  ·  —",

  // Turn activity.
  "activity.running": "実行中",
  "activity.done": "完了",
  "activity.failed": "失敗",
  "activity.cancelled": "実行中にターンが中止されました",
  "activity.cancelledByUser": "ユーザーが停止しました",
  "activity.cancelledAgentExit": "エージェントプロセスが終了しました",
  "activity.cancelledToast": "ターンを停止しました",
  "activity.tool": "ツール",
  "activity.working": "処理中…",
  "activity.inProgress": "処理中",

  // Keyboard shortcuts overlay.
  "shortcuts.title": "キーボードショートカット",
  "shortcuts.close": "閉じる",
  "shortcuts.search": "チャット / プロジェクトを検索",
  "shortcuts.findInChat": "会話内を検索",
  "shortcuts.newChat": "新しいチャット",
  "shortcuts.copyLastReply": "直前の応答をコピー",
  "shortcuts.settings": "設定",
  "shortcuts.toggleSidebar": "サイドバーの表示切替",
  "shortcuts.toggleRightPane": "サイドバーの表示 / 非表示",
  "shortcuts.sideTerminal": "ターミナル",
  "shortcuts.doctor": "ドクター",
  "shortcuts.off": "オフ",
  "shortcuts.stop": "生成を停止 / オーバーレイを閉じる",
  "shortcuts.send": "メッセージを送信",
  "shortcuts.help": "ショートカットを表示",
  "shortcuts.voice": "音声入力の切替",

  // Media viewers.
  "media.loading": "メディアを読み込み中…",
  "media.openExternal": "システムのプレーヤーで開く",
  "media.loadError": "アプリのプレビューでこのメディアを読み込めませんでした。",
  "image.view": "画像を表示",
  "image.copy": "画像をコピー",
  "image.next": "次の画像",
  "image.prev": "前の画像",
  "image.close": "閉じる",
  "image.zoomIn": "拡大",
  "image.zoomOut": "縮小",
  "video.loadError": "動画を読み込めませんでした",
  "video.open": "動画を開く",
  "video.play": "動画を再生",
  "office.loading": "ドキュメントを描画中…",
  "office.openExternal": "外部アプリで開く",
  "office.prevPage": "前へ",
  "office.nextPage": "次へ",

  // Onboarding.
  "onboarding.welcome": "Grok へようこそ",
  "onboarding.body":
    "MIT · 非公式。アカウントの接続方法を選ぶか、そのまま始めてください。",
  "onboarding.skip": "スキップ",
  "onboarding.continue": "続ける",

  // Error boundary.
  "ui.errorBoundary.title": "この画面で表示エラーが発生しました",
  "ui.errorBoundary.body":
    "チャット画面の描画に失敗しました。ディスク上のセッションは保持されています — 再試行するか、別のチャットに切り替えてください。",
  "ui.errorBoundary.retry": "再試行",

  // Phone layout.
  "phone.menu": "セッション",
  "phone.account": "アカウント",
  "phone.toolsTitle": "ツール",
  "phone.toolsAttach": "添付ファイル",
  "phone.toolsProject": "プロジェクト",
  "phone.toolsModel": "モデル",
  "phone.toolsAccess": "アクセス",
  "phone.toolsContext": "コンテキスト使用量",
  "phone.toolsBack": "戻る",
  "phone.accountTitle": "アカウントと状態",
  "phone.openFiles": "ファイル",
  "phone.drawerClose": "セッション一覧を閉じる",
  "phone.contextUnknown": "不明",

  // Session status modal.
  "statusModal.title": "セッションの状態",
  "statusModal.sessionId": "セッション ID",
  "statusModal.agentSessionId": "エージェントセッション",
  "statusModal.model": "モデル",
  "statusModal.effort": "推論",
  "statusModal.mode": "モード",
  "statusModal.policy": "権限",
  "statusModal.project": "プロジェクト",
  "statusModal.messages": "メッセージ",

  // Context compaction.
  "compact.bannerAuto": "コンテキストを自動圧縮しました",
  "compact.bannerManual": "コンテキストを圧縮しました",
  "compact.tokensRange": "{before} → {after} トークン",
  "compact.summaryToggle": "要約",
  "compact.toastAuto": "空きを確保するためコンテキストを自動圧縮しました",
  "compact.toastManual": "コンテキストを圧縮しました",

  // Prompt history.
  "promptHistory.title": "このチャット",
  "promptHistory.tabSession": "このチャット",
  "promptHistory.tabRecent": "最近（全チャット）",
  "promptHistory.placeholder": "プロンプトを絞り込み…",
  "promptHistory.aria": "プロンプト履歴",
  "promptHistory.clearFilter": "絞り込みを解除",

  // Quit confirmation.
  "app.quitBusy.title": "エージェント実行中に終了しますか？",
  "app.quitBusy.message":
    "{n} 件のセッションが実行中です。終了すると進行中の処理が中断されます。",
  "app.quitBusy.confirm": "終了",

  // Inline file cards in chat.
  "fileCard.file": "ファイル",
  "fileCard.docMd": "ドキュメント · MD",
  "fileCard.docWord": "ドキュメント · Word",
  "fileCard.sheetExcel": "表計算 · Excel",
  "fileCard.codePython": "コード · Python",
  "fileCard.code": "コード · {ext}",
  "fileCard.fileExt": "ファイル · {ext}",

  // Written to disk as the session title on first send, so it must be
  // translated before a user creates chats in this language — and must
  // match `new_chat` / `untitled` in src-tauri/src/tray_i18n.rs.
  "session.new": "新しいチャット",
  "session.placeholderTitle": "新しいチャット",
  "session.untitled": "無題",
};
