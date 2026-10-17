//! Localized copy the host writes into a session when it wakes it for a pull
//! request change: the follow-up turn's header, its per-change lines and its
//! task line.
//!
//! The host delivers that turn itself, so this copy cannot come from
//! `src/i18n/`. Catalogs follow `docs/llm-wiki/i18n.md`: one entry per id in
//! `tray_i18n::Locale`, English as the authority, values carry `{placeholder}`
//! names that live in `src/i18n/messages/en/composer.ts` under `prMonitor.*`.

use crate::tray_i18n::Locale;

/// One piece of the follow-up turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageKey {
    /// `[PR update] #1316 Title` — first line of the turn.
    PromptHeader,
    /// The same header with the pull request URL appended.
    PromptHeaderUrl,
    /// `What changed:` — lead-in of the change list.
    PromptUpdates,
    /// Closing instruction: what the agent should do with the change.
    PromptTask,
    /// One change line, by kind.
    UpdateComment,
    UpdateReview,
    UpdateReviewState,
    UpdateChecksFailed,
    UpdateChecksPassed,
    UpdateState,
    UpdateMergeable,
    UpdateTitle,
}

/// Template for `key` in `lang`; English when the locale has no entry.
pub fn t(lang: &str, key: MessageKey) -> &'static str {
    match (Locale::parse(lang), key) {
        // de
        (Locale::De, MessageKey::PromptHeader) => "[PR-Update] #{number} {title}",
        (Locale::De, MessageKey::PromptHeaderUrl) => "[PR-Update] #{number} {title} — {url}",
        (Locale::De, MessageKey::PromptUpdates) => "Was sich geändert hat:",
        (Locale::De, MessageKey::PromptTask) => "Fasse dieses PR-Update jetzt nach: sieh dir den Branch im Projekt-Arbeitsbereich an, lies den genannten Kommentar bzw. den CI-Fehler und setze die gezielte Änderung um (oder beantworte die Frage). Berichte, was du getan hast, und erfinde keine PR-, Kommentar- oder CI-Daten, die du nicht gesehen hast.",
        (Locale::De, MessageKey::UpdateComment) => "Neuer Kommentar von {author}: {excerpt}",
        (Locale::De, MessageKey::UpdateReview) => "Neues Review von {author}: {excerpt}",
        (Locale::De, MessageKey::UpdateReviewState) => "Neues Review ({state}) von {author}: {excerpt}",
        (Locale::De, MessageKey::UpdateChecksFailed) => "CI schlägt fehl ({count} Checks)",
        (Locale::De, MessageKey::UpdateChecksPassed) => "CI ist grün ({passed}/{total} bestanden)",
        (Locale::De, MessageKey::UpdateState) => "PR-Status: {from} → {to}",
        (Locale::De, MessageKey::UpdateMergeable) => "Merge-Status: {from} → {to}",
        (Locale::De, MessageKey::UpdateTitle) => "Titel geändert: {from} → {to}",

        // es
        (Locale::Es, MessageKey::PromptHeader) => "[Actualización de PR] #{number} {title}",
        (Locale::Es, MessageKey::PromptHeaderUrl) => "[Actualización de PR] #{number} {title} — {url}",
        (Locale::Es, MessageKey::PromptUpdates) => "Qué cambió:",
        (Locale::Es, MessageKey::PromptTask) => "Responde ahora a esta actualización del PR: revisa la rama en el espacio de trabajo del proyecto, lee el comentario o el fallo de CI indicado y aplica el cambio concreto (o responde la pregunta). Informa lo que hiciste y no inventes datos de PR, comentarios o CI que no hayas observado.",
        (Locale::Es, MessageKey::UpdateComment) => "Nuevo comentario de {author}: {excerpt}",
        (Locale::Es, MessageKey::UpdateReview) => "Nueva revisión de {author}: {excerpt}",
        (Locale::Es, MessageKey::UpdateReviewState) => "Nueva revisión ({state}) de {author}: {excerpt}",
        (Locale::Es, MessageKey::UpdateChecksFailed) => "La CI está fallando ({count} comprobaciones)",
        (Locale::Es, MessageKey::UpdateChecksPassed) => "La CI está en verde ({passed}/{total} correctas)",
        (Locale::Es, MessageKey::UpdateState) => "Estado del PR: {from} → {to}",
        (Locale::Es, MessageKey::UpdateMergeable) => "Estado de fusión: {from} → {to}",
        (Locale::Es, MessageKey::UpdateTitle) => "Título cambiado: {from} → {to}",

        // fil
        (Locale::Fil, MessageKey::PromptHeader) => "[Update ng PR] #{number} {title}",
        (Locale::Fil, MessageKey::PromptHeaderUrl) => "[Update ng PR] #{number} {title} — {url}",
        (Locale::Fil, MessageKey::PromptUpdates) => "Ano ang nagbago:",
        (Locale::Fil, MessageKey::PromptTask) => "Sundan na ang update na ito ng PR: tingnan ang branch sa project workspace, basahin ang tinutukoy na komento o CI failure, at gawin ang tiyak na pagbabago (o sagutin ang tanong). Iulat ang ginawa mo at huwag mag-imbento ng datos ng PR, komento o CI na hindi mo nakita.",
        (Locale::Fil, MessageKey::UpdateComment) => "Bagong komento mula kay {author}: {excerpt}",
        (Locale::Fil, MessageKey::UpdateReview) => "Bagong review mula kay {author}: {excerpt}",
        (Locale::Fil, MessageKey::UpdateReviewState) => "Bagong review ({state}) mula kay {author}: {excerpt}",
        (Locale::Fil, MessageKey::UpdateChecksFailed) => "Bumabagsak ang CI ({count} check)",
        (Locale::Fil, MessageKey::UpdateChecksPassed) => "Berde ang CI ({passed}/{total} pass)",
        (Locale::Fil, MessageKey::UpdateState) => "Estado ng PR: {from} → {to}",
        (Locale::Fil, MessageKey::UpdateMergeable) => "Estado ng merge: {from} → {to}",
        (Locale::Fil, MessageKey::UpdateTitle) => "Nagbago ang pamagat: {from} → {to}",

        // fr
        (Locale::Fr, MessageKey::PromptHeader) => "[Mise à jour PR] #{number} {title}",
        (Locale::Fr, MessageKey::PromptHeaderUrl) => "[Mise à jour PR] #{number} {title} — {url}",
        (Locale::Fr, MessageKey::PromptUpdates) => "Ce qui a changé :",
        (Locale::Fr, MessageKey::PromptTask) => "Traite maintenant cette mise à jour de PR : examine la branche dans l’espace de travail du projet, lis le commentaire ou l’échec CI cité, et applique la modification ciblée (ou réponds à la question). Indique ce que tu as fait et n’invente aucune donnée de PR, de commentaire ou de CI que tu n’as pas observée.",
        (Locale::Fr, MessageKey::UpdateComment) => "Nouveau commentaire de {author} : {excerpt}",
        (Locale::Fr, MessageKey::UpdateReview) => "Nouvelle revue de {author} : {excerpt}",
        (Locale::Fr, MessageKey::UpdateReviewState) => "Nouvelle revue ({state}) de {author} : {excerpt}",
        (Locale::Fr, MessageKey::UpdateChecksFailed) => "La CI échoue ({count} vérifications)",
        (Locale::Fr, MessageKey::UpdateChecksPassed) => "La CI est verte ({passed}/{total} réussis)",
        (Locale::Fr, MessageKey::UpdateState) => "État de la PR : {from} → {to}",
        (Locale::Fr, MessageKey::UpdateMergeable) => "État de fusion : {from} → {to}",
        (Locale::Fr, MessageKey::UpdateTitle) => "Titre modifié : {from} → {to}",

        // id
        (Locale::Id, MessageKey::PromptHeader) => "[Pembaruan PR] #{number} {title}",
        (Locale::Id, MessageKey::PromptHeaderUrl) => "[Pembaruan PR] #{number} {title} — {url}",
        (Locale::Id, MessageKey::PromptUpdates) => "Apa yang berubah:",
        (Locale::Id, MessageKey::PromptTask) => "Tindak lanjuti pembaruan PR ini sekarang: periksa branch di workspace proyek, baca komentar atau kegagalan CI yang disebut, lalu lakukan perubahan yang tepat (atau jawab pertanyaannya). Laporkan apa yang kamu lakukan dan jangan mengarang data PR, komentar, atau CI yang belum kamu amati.",
        (Locale::Id, MessageKey::UpdateComment) => "Komentar baru dari {author}: {excerpt}",
        (Locale::Id, MessageKey::UpdateReview) => "Review baru dari {author}: {excerpt}",
        (Locale::Id, MessageKey::UpdateReviewState) => "Review baru ({state}) dari {author}: {excerpt}",
        (Locale::Id, MessageKey::UpdateChecksFailed) => "CI gagal ({count} pemeriksaan)",
        (Locale::Id, MessageKey::UpdateChecksPassed) => "CI hijau ({passed}/{total} lulus)",
        (Locale::Id, MessageKey::UpdateState) => "Status PR: {from} → {to}",
        (Locale::Id, MessageKey::UpdateMergeable) => "Status merge: {from} → {to}",
        (Locale::Id, MessageKey::UpdateTitle) => "Judul berubah: {from} → {to}",

        // it
        (Locale::It, MessageKey::PromptHeader) => "[Aggiornamento PR] #{number} {title}",
        (Locale::It, MessageKey::PromptHeaderUrl) => "[Aggiornamento PR] #{number} {title} — {url}",
        (Locale::It, MessageKey::PromptUpdates) => "Cosa è cambiato:",
        (Locale::It, MessageKey::PromptTask) => "Prosegui ora questo aggiornamento della PR: esamina il branch nel workspace del progetto, leggi il commento o il fallimento di CI indicato e applica la modifica mirata (o rispondi alla domanda). Riferisci cosa hai fatto e non inventare dati di PR, commenti o CI che non hai osservato.",
        (Locale::It, MessageKey::UpdateComment) => "Nuovo commento da {author}: {excerpt}",
        (Locale::It, MessageKey::UpdateReview) => "Nuova review da {author}: {excerpt}",
        (Locale::It, MessageKey::UpdateReviewState) => "Nuova review ({state}) da {author}: {excerpt}",
        (Locale::It, MessageKey::UpdateChecksFailed) => "La CI sta fallendo ({count} controlli)",
        (Locale::It, MessageKey::UpdateChecksPassed) => "La CI è verde ({passed}/{total} superati)",
        (Locale::It, MessageKey::UpdateState) => "Stato PR: {from} → {to}",
        (Locale::It, MessageKey::UpdateMergeable) => "Stato merge: {from} → {to}",
        (Locale::It, MessageKey::UpdateTitle) => "Titolo modificato: {from} → {to}",

        // ja
        (Locale::Ja, MessageKey::PromptHeader) => "[PR 更新] #{number} {title}",
        (Locale::Ja, MessageKey::PromptHeaderUrl) => "[PR 更新] #{number} {title} — {url}",
        (Locale::Ja, MessageKey::PromptUpdates) => "変更内容:",
        (Locale::Ja, MessageKey::PromptTask) => "この PR 更新に今すぐ対応してください。プロジェクトのワークスペースでブランチを確認し、示されたコメントや CI 失敗を読み、必要な最小限の変更を行ってください（質問なら回答してください）。実施内容を報告し、観測していない PR・コメント・CI の情報を捏造しないでください。",
        (Locale::Ja, MessageKey::UpdateComment) => "{author} の新しいコメント: {excerpt}",
        (Locale::Ja, MessageKey::UpdateReview) => "{author} の新しいレビュー: {excerpt}",
        (Locale::Ja, MessageKey::UpdateReviewState) => "{author} の新しいレビュー（{state}）: {excerpt}",
        (Locale::Ja, MessageKey::UpdateChecksFailed) => "CI が失敗しています（{count} 件）",
        (Locale::Ja, MessageKey::UpdateChecksPassed) => "CI はグリーンです（{passed}/{total} 成功）",
        (Locale::Ja, MessageKey::UpdateState) => "PR の状態: {from} → {to}",
        (Locale::Ja, MessageKey::UpdateMergeable) => "マージ状態: {from} → {to}",
        (Locale::Ja, MessageKey::UpdateTitle) => "タイトル変更: {from} → {to}",

        // ko
        (Locale::Ko, MessageKey::PromptHeader) => "[PR 업데이트] #{number} {title}",
        (Locale::Ko, MessageKey::PromptHeaderUrl) => "[PR 업데이트] #{number} {title} — {url}",
        (Locale::Ko, MessageKey::PromptUpdates) => "변경 사항:",
        (Locale::Ko, MessageKey::PromptTask) => "이 PR 업데이트를 지금 처리하세요. 프로젝트 워크스페이스에서 브랜치를 확인하고, 언급된 댓글이나 CI 실패를 읽고, 필요한 최소 변경을 적용하세요(질문이면 답하세요). 한 일을 보고하고, 관찰하지 않은 PR·댓글·CI 정보를 만들어내지 마세요.",
        (Locale::Ko, MessageKey::UpdateComment) => "{author}의 새 댓글: {excerpt}",
        (Locale::Ko, MessageKey::UpdateReview) => "{author}의 새 리뷰: {excerpt}",
        (Locale::Ko, MessageKey::UpdateReviewState) => "{author}의 새 리뷰({state}): {excerpt}",
        (Locale::Ko, MessageKey::UpdateChecksFailed) => "CI가 실패했습니다(검사 {count}개)",
        (Locale::Ko, MessageKey::UpdateChecksPassed) => "CI가 통과했습니다({passed}/{total} 통과)",
        (Locale::Ko, MessageKey::UpdateState) => "PR 상태: {from} → {to}",
        (Locale::Ko, MessageKey::UpdateMergeable) => "병합 상태: {from} → {to}",
        (Locale::Ko, MessageKey::UpdateTitle) => "제목 변경: {from} → {to}",

        // pt-BR
        (Locale::PtBr, MessageKey::PromptHeader) => "[Atualização do PR] #{number} {title}",
        (Locale::PtBr, MessageKey::PromptHeaderUrl) => "[Atualização do PR] #{number} {title} — {url}",
        (Locale::PtBr, MessageKey::PromptUpdates) => "O que mudou:",
        (Locale::PtBr, MessageKey::PromptTask) => "Dê seguimento agora a esta atualização do PR: veja o branch no workspace do projeto, leia o comentário ou a falha de CI citada e faça a alteração focada (ou responda à pergunta). Relate o que fez e não invente dados de PR, comentários ou CI que não observou.",
        (Locale::PtBr, MessageKey::UpdateComment) => "Novo comentário de {author}: {excerpt}",
        (Locale::PtBr, MessageKey::UpdateReview) => "Nova revisão de {author}: {excerpt}",
        (Locale::PtBr, MessageKey::UpdateReviewState) => "Nova revisão ({state}) de {author}: {excerpt}",
        (Locale::PtBr, MessageKey::UpdateChecksFailed) => "A CI está falhando ({count} verificações)",
        (Locale::PtBr, MessageKey::UpdateChecksPassed) => "A CI está verde ({passed}/{total} aprovadas)",
        (Locale::PtBr, MessageKey::UpdateState) => "Estado do PR: {from} → {to}",
        (Locale::PtBr, MessageKey::UpdateMergeable) => "Estado do merge: {from} → {to}",
        (Locale::PtBr, MessageKey::UpdateTitle) => "Título alterado: {from} → {to}",

        // ru
        (Locale::Ru, MessageKey::PromptHeader) => "[Обновление PR] #{number} {title}",
        (Locale::Ru, MessageKey::PromptHeaderUrl) => "[Обновление PR] #{number} {title} — {url}",
        (Locale::Ru, MessageKey::PromptUpdates) => "Что изменилось:",
        (Locale::Ru, MessageKey::PromptTask) => "Сейчас разберись с этим обновлением PR: посмотри ветку в рабочей области проекта, прочитай указанный комментарий или падение CI и внеси точечное изменение (или ответь на вопрос). Отчитайся о сделанном и не выдумывай данные PR, комментариев или CI, которых не наблюдал.",
        (Locale::Ru, MessageKey::UpdateComment) => "Новый комментарий от {author}: {excerpt}",
        (Locale::Ru, MessageKey::UpdateReview) => "Новый отзыв от {author}: {excerpt}",
        (Locale::Ru, MessageKey::UpdateReviewState) => "Новый отзыв ({state}) от {author}: {excerpt}",
        (Locale::Ru, MessageKey::UpdateChecksFailed) => "CI падает ({count} проверок)",
        (Locale::Ru, MessageKey::UpdateChecksPassed) => "CI зелёный ({passed}/{total} успешно)",
        (Locale::Ru, MessageKey::UpdateState) => "Состояние PR: {from} → {to}",
        (Locale::Ru, MessageKey::UpdateMergeable) => "Состояние слияния: {from} → {to}",
        (Locale::Ru, MessageKey::UpdateTitle) => "Заголовок изменён: {from} → {to}",

        // ta
        (Locale::Ta, MessageKey::PromptHeader) => "[PR புதுப்பிப்பு] #{number} {title}",
        (Locale::Ta, MessageKey::PromptHeaderUrl) => "[PR புதுப்பிப்பு] #{number} {title} — {url}",
        (Locale::Ta, MessageKey::PromptUpdates) => "என்ன மாறியது:",
        (Locale::Ta, MessageKey::PromptTask) => "இந்த PR புதுப்பிப்பை இப்போது தொடரவும்: திட்ட பணியிடத்தில் கிளையைப் பார்த்து, குறிப்பிட்ட கருத்தையோ CI தோல்வியையோ படித்து, தேவையான சிறிய மாற்றத்தைச் செய்யவும் (கேள்வியென்றால் பதிலளிக்கவும்). செய்ததைத் தெரிவிக்கவும்; நீங்கள் காணாத PR, கருத்து, CI தரவை கற்பனை செய்ய வேண்டாம்.",
        (Locale::Ta, MessageKey::UpdateComment) => "{author}-இன் புதிய கருத்து: {excerpt}",
        (Locale::Ta, MessageKey::UpdateReview) => "{author}-இன் புதிய மதிப்பாய்வு: {excerpt}",
        (Locale::Ta, MessageKey::UpdateReviewState) => "{author}-இன் புதிய மதிப்பாய்வு ({state}): {excerpt}",
        (Locale::Ta, MessageKey::UpdateChecksFailed) => "CI தோல்வியடைகிறது ({count} சோதனைகள்)",
        (Locale::Ta, MessageKey::UpdateChecksPassed) => "CI பச்சை ({passed}/{total} வெற்றி)",
        (Locale::Ta, MessageKey::UpdateState) => "PR நிலை: {from} → {to}",
        (Locale::Ta, MessageKey::UpdateMergeable) => "இணைப்பு நிலை: {from} → {to}",
        (Locale::Ta, MessageKey::UpdateTitle) => "தலைப்பு மாறியது: {from} → {to}",

        // uk
        (Locale::Tr, MessageKey::PromptHeader) => "[PR güncellemesi] #{number} {title}",
        (Locale::Tr, MessageKey::PromptHeaderUrl) => "[PR güncellemesi] #{number} {title} — {url}",
        (Locale::Tr, MessageKey::PromptUpdates) => "Neler değişti:",
        (Locale::Tr, MessageKey::PromptTask) => "Bu PR güncellemesini şimdi takip et: proje çalışma alanında dalı incele, belirtilen yorumu ya da CI hatasını oku ve odaklı değişikliği yap (ya da soruyu yanıtla). Ne yaptığını bildir; gözlemlemediğin PR, yorum ya da CI verisi uydurma.",
        (Locale::Tr, MessageKey::UpdateComment) => "{author} kullanıcısından yeni yorum: {excerpt}",
        (Locale::Tr, MessageKey::UpdateReview) => "{author} kullanıcısından yeni inceleme: {excerpt}",
        (Locale::Tr, MessageKey::UpdateReviewState) => "{author} kullanıcısından yeni inceleme ({state}): {excerpt}",
        (Locale::Tr, MessageKey::UpdateChecksFailed) => "CI başarısız ({count} denetim)",
        (Locale::Tr, MessageKey::UpdateChecksPassed) => "CI yeşil ({passed}/{total} geçti)",
        (Locale::Tr, MessageKey::UpdateState) => "PR durumu: {from} → {to}",
        (Locale::Tr, MessageKey::UpdateMergeable) => "Birleştirme durumu: {from} → {to}",
        (Locale::Tr, MessageKey::UpdateTitle) => "Başlık değişti: {from} → {to}",
        (Locale::Uk, MessageKey::PromptHeader) => "[Оновлення PR] #{number} {title}",
        (Locale::Uk, MessageKey::PromptHeaderUrl) => "[Оновлення PR] #{number} {title} — {url}",
        (Locale::Uk, MessageKey::PromptUpdates) => "Що змінилося:",
        (Locale::Uk, MessageKey::PromptTask) => "Зараз опрацюй це оновлення PR: подивись гілку в робочому просторі проєкту, прочитай зазначений коментар або збій CI і зроби точкову зміну (або дай відповідь на питання). Повідом, що зробив, і не вигадуй даних PR, коментарів чи CI, яких не спостерігав.",
        (Locale::Uk, MessageKey::UpdateComment) => "Новий коментар від {author}: {excerpt}",
        (Locale::Uk, MessageKey::UpdateReview) => "Новий відгук від {author}: {excerpt}",
        (Locale::Uk, MessageKey::UpdateReviewState) => "Новий відгук ({state}) від {author}: {excerpt}",
        (Locale::Uk, MessageKey::UpdateChecksFailed) => "CI падає ({count} перевірок)",
        (Locale::Uk, MessageKey::UpdateChecksPassed) => "CI зелений ({passed}/{total} успішно)",
        (Locale::Uk, MessageKey::UpdateState) => "Стан PR: {from} → {to}",
        (Locale::Uk, MessageKey::UpdateMergeable) => "Стан злиття: {from} → {to}",
        (Locale::Uk, MessageKey::UpdateTitle) => "Заголовок змінено: {from} → {to}",

        // zh
        (Locale::Zh, MessageKey::PromptHeader) => "[PR 更新] #{number} {title}",
        (Locale::Zh, MessageKey::PromptHeaderUrl) => "[PR 更新] #{number} {title} — {url}",
        (Locale::Zh, MessageKey::PromptUpdates) => "变更内容：",
        (Locale::Zh, MessageKey::PromptTask) => "现在跟进这次 PR 更新：在项目工作区查看该分支，阅读上面的评论或 CI 失败信息，做出必要的针对性改动（如果是提问就直接回答）。说明你做了什么，不要编造你没有观察到的 PR、评论或 CI 信息。",
        (Locale::Zh, MessageKey::UpdateComment) => "{author} 的新评论：{excerpt}",
        (Locale::Zh, MessageKey::UpdateReview) => "{author} 的新评审：{excerpt}",
        (Locale::Zh, MessageKey::UpdateReviewState) => "{author} 的新评审（{state}）：{excerpt}",
        (Locale::Zh, MessageKey::UpdateChecksFailed) => "CI 失败（{count} 项检查）",
        (Locale::Zh, MessageKey::UpdateChecksPassed) => "CI 已通过（{passed}/{total} 通过）",
        (Locale::Zh, MessageKey::UpdateState) => "PR 状态：{from} → {to}",
        (Locale::Zh, MessageKey::UpdateMergeable) => "合并状态：{from} → {to}",
        (Locale::Zh, MessageKey::UpdateTitle) => "标题变更：{from} → {to}",

        // zh-TW
        (Locale::ZhTw, MessageKey::PromptHeader) => "[PR 更新] #{number} {title}",
        (Locale::ZhTw, MessageKey::PromptHeaderUrl) => "[PR 更新] #{number} {title} — {url}",
        (Locale::ZhTw, MessageKey::PromptUpdates) => "變更內容：",
        (Locale::ZhTw, MessageKey::PromptTask) => "現在追蹤這次 PR 更新：在專案工作區查看該分支，閱讀上面的留言或 CI 失敗資訊，做出必要的針對性修改（如果是提問就直接回答）。說明你做了什麼，不要編造你沒有觀察到的 PR、留言或 CI 資訊。",
        (Locale::ZhTw, MessageKey::UpdateComment) => "{author} 的新留言：{excerpt}",
        (Locale::ZhTw, MessageKey::UpdateReview) => "{author} 的新審查：{excerpt}",
        (Locale::ZhTw, MessageKey::UpdateReviewState) => "{author} 的新審查（{state}）：{excerpt}",
        (Locale::ZhTw, MessageKey::UpdateChecksFailed) => "CI 失敗（{count} 項檢查）",
        (Locale::ZhTw, MessageKey::UpdateChecksPassed) => "CI 已通過（{passed}/{total} 通過）",
        (Locale::ZhTw, MessageKey::UpdateState) => "PR 狀態：{from} → {to}",
        (Locale::ZhTw, MessageKey::UpdateMergeable) => "合併狀態：{from} → {to}",
        (Locale::ZhTw, MessageKey::UpdateTitle) => "標題變更：{from} → {to}",


        (_, MessageKey::PromptHeader) => "[PR update] #{number} {title}",
        (_, MessageKey::PromptHeaderUrl) => "[PR update] #{number} {title} — {url}",
        (_, MessageKey::PromptUpdates) => "What changed:",
        (_, MessageKey::PromptTask) => "Follow up on this PR update now: inspect the branch in the project workspace, read the referenced comment or CI failure, and make the focused change (or answer the question). Report what you did, and do not invent PR, comment or CI data you have not observed.",
        (_, MessageKey::UpdateComment) => "New comment from {author}: {excerpt}",
        (_, MessageKey::UpdateReview) => "New review from {author}: {excerpt}",
        (_, MessageKey::UpdateReviewState) => "New review ({state}) from {author}: {excerpt}",
        (_, MessageKey::UpdateChecksFailed) => "CI is failing ({count} checks)",
        (_, MessageKey::UpdateChecksPassed) => "CI is green ({passed}/{total} passed)",
        (_, MessageKey::UpdateState) => "PR state: {from} → {to}",
        (_, MessageKey::UpdateMergeable) => "Merge state: {from} → {to}",
        (_, MessageKey::UpdateTitle) => "Title changed: {from} → {to}",
    }
}

/// Render `key` for `lang`, replacing every `{name}` with its argument.
///
/// An argument the template does not mention is ignored, and a placeholder
/// without an argument is left as written — a missing value stays visible
/// instead of turning into an empty line.
pub fn render(lang: &str, key: MessageKey, args: &[(&str, &str)]) -> String {
    let mut out = t(lang, key).to_string();
    for (name, value) in args {
        out = out.replace(&format!("{{{name}}}"), value);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_KEYS: [MessageKey; 12] = [
        MessageKey::PromptHeader,
        MessageKey::PromptHeaderUrl,
        MessageKey::PromptUpdates,
        MessageKey::PromptTask,
        MessageKey::UpdateComment,
        MessageKey::UpdateReview,
        MessageKey::UpdateReviewState,
        MessageKey::UpdateChecksFailed,
        MessageKey::UpdateChecksPassed,
        MessageKey::UpdateState,
        MessageKey::UpdateMergeable,
        MessageKey::UpdateTitle,
    ];

    /// `{placeholder}` names a template mentions, sorted.
    fn placeholders(template: &str) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut rest = template;
        while let Some(start) = rest.find('{') {
            let after = &rest[start + 1..];
            let Some(end) = after.find('}') else { break };
            out.push(after[..end].to_string());
            rest = &after[end + 1..];
        }
        out.sort();
        out
    }

    #[test]
    fn every_product_locale_answers_every_key() {
        for locale in crate::tray_i18n::ALL {
            for key in ALL_KEYS {
                let copy = t(locale.as_tag(), key);
                assert!(
                    !copy.trim().is_empty(),
                    "{} {key:?} is empty",
                    locale.as_tag()
                );
            }
        }
    }

    #[test]
    fn every_locale_keeps_the_english_placeholders() {
        for locale in crate::tray_i18n::ALL {
            if locale == Locale::En {
                continue;
            }
            for key in ALL_KEYS {
                assert_eq!(
                    placeholders(t(locale.as_tag(), key)),
                    placeholders(t("en", key)),
                    "{} {key:?} changed the placeholders",
                    locale.as_tag()
                );
            }
        }
    }

    #[test]
    fn locales_are_translated() {
        assert_eq!(
            t("de", MessageKey::PromptHeader),
            "[PR-Update] #{number} {title}"
        );
        assert_eq!(t("zh", MessageKey::PromptUpdates), "变更内容：");
        assert_eq!(
            t("ja", MessageKey::UpdateChecksFailed),
            "CI が失敗しています（{count} 件）"
        );
        assert_eq!(
            t("pt-BR", MessageKey::UpdateChecksPassed),
            "A CI está verde ({passed}/{total} aprovadas)"
        );
        assert_ne!(
            t("zh", MessageKey::PromptTask),
            t("en", MessageKey::PromptTask)
        );
    }

    #[test]
    fn unknown_locale_falls_back_to_english() {
        assert_eq!(t("he", MessageKey::PromptUpdates), "What changed:");
        assert_eq!(t("", MessageKey::UpdateState), "PR state: {from} → {to}");
        assert_eq!(t("zh_CN", MessageKey::PromptUpdates), "变更内容：");
        assert_eq!(
            t("ja-JP", MessageKey::UpdateChecksFailed),
            "CI が失敗しています（{count} 件）"
        );
        // `system` follows the App setting, never a hardcoded language.
        assert_eq!(
            Locale::parse("system").as_tag(),
            crate::tray_i18n::app_locale().as_tag()
        );
    }

    #[test]
    fn render_fills_every_argument_and_leaves_the_rest() {
        assert_eq!(
            render(
                "en",
                MessageKey::PromptHeader,
                &[("number", "1316"), ("title", "T")]
            ),
            "[PR update] #1316 T"
        );
        assert_eq!(
            render(
                "en",
                MessageKey::UpdateState,
                &[("from", "OPEN"), ("to", "MERGED")]
            ),
            "PR state: OPEN → MERGED"
        );
        // A value the template never mentions changes nothing.
        assert_eq!(
            render("en", MessageKey::PromptUpdates, &[("author", "X")]),
            "What changed:"
        );
        // A placeholder without a value stays visible.
        assert_eq!(
            render("en", MessageKey::PromptHeader, &[("number", "7")]),
            "[PR update] #7 {title}"
        );
    }
}
