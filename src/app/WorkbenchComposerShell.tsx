/**
 * Composer input shell: queue strip, attachments, slash/at/attach/history
 * portals, draft editor, send cluster.
 *
 * Permission bar + wrap/portal live in WorkbenchComposerColumn. Host still
 * owns send/queue/compact verbs.
 */
import * as api from "@/lib/api";
import { AttachChatPanel } from "@/components/AttachChatPanel";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ChatRefChip } from "@/components/ChatRefChip";
import { ComposerAtPanel } from "@/components/ComposerAtPanel";
import { ComposerClearDraftButton, ComposerDraftStats, ComposerSendCluster } from "@/components/ComposerDraftChrome";
import { ComposerDraftEditor } from "@/components/ComposerDraftEditor";
import { ComposerAccessMenu } from "@/components/ComposerModelMenu";
import { ComposerPlusPanel } from "@/components/ComposerPlusPanel";
import { ComposerQuoteCards } from "@/components/ComposerQuoteCards";
import { ContextUsageChip } from "@/components/ContextUsageChip";
import { PromptHistoryPanel } from "@/components/PromptHistoryPanel";
import { IconChevronDown, IconChevronUp, IconClock, IconClose, IconCode, IconImagine, IconMic, IconPlus, IconSkills } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { isImagePath, mergeAttachments } from "@/lib/attachments";
import { chatHasUpdate, loadRecentAttachIds, lookupChatStatus, lookupChatTitle } from "@/lib/chatAttach";
import { type PermissionPolicyId } from "@/lib/grokCatalog";
import { removeRecentPrompt } from "@/lib/recentPromptHistory";
import { queuePreviewText, shouldEnqueueSend } from "@/lib/sendQueue";
import { canType } from "@/lib/session";
import { resolveVoiceMicChrome, voiceMicLabelMessageKey } from "@/lib/voiceDictation";
import { createPortal } from "react-dom";

export type WorkbenchComposerShellProps = {
  [key: string]: any;
};

export function WorkbenchComposerShell(p: WorkbenchComposerShellProps) {
  const {
    activeProject,
    applyAtFile,
    applyAttachedChat,
    applyCreateVideo,
    applyPermissionPolicy,
    applyPromptHistoryEntry,
    applySlashItem,
    atActiveIndex,
    atEntries,
    atLoading,
    atMenuOpen,
    atPanelRef,
    atSoftFail,
    attachChatActive,
    attachChatFilter,
    attachChatOpen,
    attachChatPanelRef,
    attachChatPos,
    attachLabels,
    attachScopeLabel,
    attachableSessions,
    attachments,

    canGuideQueuedMessage,
    chatAttachments,
    clearSlashFilters,
    closeAttachChat,
    closeComposerMenu,
    closePromptHistory,
    composerAtPos,
    composerInputRef,
    composerMenuEntries,
    composerMenuOpen,
    composerPlusPanelRef,
    composerPlusPos,
    composerPlusStyle,
    composerAtStyle,
    attachChatStyle,
    promptHistoryStyle,
    promptHistoryIndexRef,
    slashFilterQuery,
    composerPlusTriggerRef,
    composerShellRef,
    composerSpellcheck,
    connecting,
    contextUsageDisplay,
    cycleAttachedChatScope,
    dragZone,
    effectiveCanSend,
    effectiveCanStop,
    goalMode,
    guideQueuedMessage,
    guidingQueueItemId,
    layout,
    liveAt,
    liveSlash,
    liveVoiceOpen,
    locale,
    mode,
    onComposerContextMenu,
    onComposerDraftChange,
    onComposerKeyDown,
    onComposerPasteFiles,
    onComposerPasteMediaFallback,
    onSlashQueryChange,
    openQueueEdit,
    openSession,
    openSideSkillsPanel,
    phoneLayout,
    phoneToolsOpen,
    pickComposerFiles,
    policy,
    promptHistoryActive,
    promptHistoryEntries,
    promptHistoryEntryMeta,
    promptHistoryFilter,
    promptHistoryFocusFilter,
    promptHistoryOpen,
    promptHistoryPanelRef,
    promptHistoryPos,
    promptHistoryScope,
    promptHistoryUnfilteredCount,
    queueEditItemId,
    queuePreviewLabels,
    quotes,
    removeAttachedChat,
    requestClearComposerDraft,
    requestClearSendQueue,
    resolveSlashDescription,
    resolveSlashTitle,
    send,
    sendQueue,
    sendQueueStrip,
    session,
    sessionJsonSchema,
    sessions,
    setAtActiveIndex,
    setAttachChatActive,
    setAttachChatFilter,
    setAttachments,
    setCompactNote,
    setGoalMode,
    setJsonSchemaDraft,
    setMode,
    setPhoneToolsOpen,
    setPromptHistoryActive,
    setPromptHistoryClearOpen,
    setPromptHistoryFilter,
    setPromptHistoryIndex,
    setPromptHistoryScope,
    setQuotes,
    setRecentPromptHistory,
    setShowCompactModal,
    setShowComposerPlus,
    setShowJsonSchemaModal,
    setShowUsageLimitModal,
    setSlashActiveIndex,
    setSlashKindFilter,
    showComposerDraftStats,
    showToast,
    sideWorkbench,
    skillsLoadError,
    skillsLoading,
    slashActiveIndex,
    slashCatalog,
    slashCatalogCount,
    slashKindCounts,
    slashKindFilter,
    stop,
    toggleVoice,
    tr,
    voice,
    voiceDictationAutoSend,
    voiceGate,
  } = p;
  return (
            <div
              ref={composerShellRef}
              className={
                "composer" +
                (dragZone === "main" ? " composer--drop-ready" : "")
              }
              data-session-attach=""
            >
              {sendQueueStrip.visible && (
                <div
                  className="composer__queue"
                  aria-label={tr("composer.queueCount", {
                    n: String(sendQueueStrip.count),
                  })}
                >
                  <div className="composer__queue-head">
                    <IconClock size={14} aria-hidden />
                    <span className="composer__queue-title">
                      {tr("composer.queueCount", {
                        n: String(sendQueueStrip.count),
                      })}
                    </span>
                    <button
                      type="button"
                      className="composer__queue-clear"
                      data-testid="queue-clear"
                      disabled={!sendQueueStrip.canClear}
                      onClick={requestClearSendQueue}
                    >
                      {tr("composer.queueClear")}
                    </button>
                  </div>
                  {sendQueueStrip.showHold ? (
                    <div className="composer__queue-hold" role="status">
                      <span className="composer__queue-hold-text">
                        {tr("composer.queueHold")}
                      </span>
                      <button
                        type="button"
                        className="composer__queue-hold-retry"
                        onClick={() => sendQueue.resumeFlush()}
                      >
                        {tr("composer.queueHoldRetry")}
                      </button>
                    </div>
                  ) : null}
                  <ul className="composer__queue-list">
                    {sendQueue.activeQueue.map((item: any, idx: any) => {
                      const queueLen = sendQueue.activeQueue.length;
                      const rowBusy =
                        guidingQueueItemId === item.id ||
                        queueEditItemId !== null;
                      return (
                      <li key={item.id} className="composer__queue-item">
                        <span className="composer__queue-idx" aria-hidden>
                          {idx + 1}
                        </span>
                        {item.source === "external" ? (
                          <span className="composer__queue-src">
                            {tr("composer.queueSourceExternal")}
                          </span>
                        ) : null}
                        <span
                          className="composer__queue-text"
                          title={queuePreviewText(
                            item.storedDisplay,
                            item.attachments,
                            200,
                            queuePreviewLabels,
                          )}
                        >
                          {queuePreviewText(
                            item.storedDisplay,
                            item.attachments,
                            72,
                            queuePreviewLabels,
                          )}
                        </span>
                        <div className="composer__queue-move">
                          <button
                            type="button"
                            className="composer__queue-move-btn"
                            data-testid="queue-move-up"
                            aria-label={tr("composer.queueMoveUp")}
                            title={tr("composer.queueMoveUp")}
                            disabled={rowBusy || idx === 0}
                            onClick={() =>
                              sendQueue.moveItem(item.id, "up")
                            }
                          >
                            <IconChevronUp size={12} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="composer__queue-move-btn"
                            data-testid="queue-move-down"
                            aria-label={tr("composer.queueMoveDown")}
                            title={tr("composer.queueMoveDown")}
                            disabled={rowBusy || idx >= queueLen - 1}
                            onClick={() =>
                              sendQueue.moveItem(item.id, "down")
                            }
                          >
                            <IconChevronDown size={12} aria-hidden />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="composer__queue-edit"
                          data-testid="queue-edit"
                          aria-label={tr("composer.queueEdit")}
                          title={tr("composer.queueEdit")}
                          disabled={rowBusy}
                          onClick={() => openQueueEdit(item)}
                        >
                          {tr("composer.queueEdit")}
                        </button>
                        <button
                          type="button"
                          className="composer__queue-guide"
                          data-testid="queue-guide"
                          aria-label={
                            guidingQueueItemId === item.id ||
                            guidingQueueItemId !== null
                              ? tr("composer.queueGuiding")
                              : canGuideQueuedMessage
                                ? tr("composer.queueGuide")
                                : tr("composer.queueSendNow")
                          }
                          title={
                            guidingQueueItemId === item.id ||
                            guidingQueueItemId !== null
                              ? tr("composer.queueGuiding")
                              : canGuideQueuedMessage
                                ? tr("composer.queueGuide")
                                : tr("composer.queueSendNow")
                          }
                          disabled={guidingQueueItemId !== null}
                          onClick={() => void guideQueuedMessage(item)}
                        >
                          {guidingQueueItemId === item.id
                            ? tr("composer.queueGuiding")
                            : canGuideQueuedMessage
                              ? tr("composer.queueGuide")
                              : tr("composer.queueSendNow")}
                        </button>
                        <button
                          type="button"
                          className="composer__queue-remove"
                          aria-label={tr("composer.queueRemove")}
                          disabled={guidingQueueItemId === item.id}
                          onClick={() => sendQueue.removeItem(item.id)}
                        >
                          <IconClose size={12} />
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {quotes.length > 0 && (
                <ComposerQuoteCards
                  quotes={quotes}
                  onCommentChange={(id, comment) =>
                    setQuotes((prev: any) =>
                      prev.map((q: any) => (q.id === id ? { ...q, comment } : q)),
                    )
                  }
                  onRemove={(id) =>
                    setQuotes((prev: any) => prev.filter((q: any) => q.id !== id))
                  }
                  labels={{
                    list: tr("composer.quotes"),
                    count: tr("composer.quoteCount", {
                      n: String(quotes.length),
                    }),
                    remove: tr("composer.quoteRemove"),
                    commentPlaceholder: tr("composer.quoteCommentPlaceholder"),
                  }}
                />
              )}
              {(attachments.length > 0 || chatAttachments.length > 0) && (
                <div
                  className="composer__attachments"
                  aria-label={tr("composer.attachCount", {
                    n: String(attachments.length + chatAttachments.length),
                  })}
                >
                  {chatAttachments.map((c: any) => (
                    <ChatRefChip
                      key={c.sessionId}
                      title={
                        c.title.trim() ||
                        lookupChatTitle(
                          c.sessionId,
                          sessions,
                          tr("attachChat.missing"),
                        )
                      }
                      status={lookupChatStatus(c.sessionId, sessions)}
                      meta={attachScopeLabel(c.scope)}
                      metaTitle={tr("attachChat.scopeHint")}
                      stale={chatHasUpdate(c, sessions)}
                      onOpen={() => {
                        const row = sessions.find((s: any) => s.id === c.sessionId);
                        if (!row) {
                          showToast(tr("attachChat.missing"), 2400);
                          return;
                        }
                        void openSession(row);
                      }}
                      onCycleScope={() => cycleAttachedChatScope(c.sessionId)}
                      onRemove={() => removeAttachedChat(c.sessionId)}
                      removeLabel={tr("attachChat.chipRemove")}
                      staleLabel={tr("attachChat.staleAria")}
                      archivedLabel={tr("attachChat.archived")}
                    />
                  ))}
                  {attachments.map((a: any) => (
                    <AttachmentCard
                      key={a.path}
                      attachment={a}
                      variant="chip"
                      labels={attachLabels}
                      galleryPaths={attachments
                        .filter((x: any) => !x.isDir && isImagePath(x.path))
                        .map((x: any) => x.path)}
                      onRemove={(att: any) =>
                        setAttachments((prev: any) =>
                          prev.filter((x: any) => x.path !== att.path),
                        )
                      }
                      onAddToComposer={(att: any) =>
                        setAttachments((prev: any) => mergeAttachments(prev, [att]))
                      }
                    />
                  ))}
                </div>
              )}
              {composerMenuOpen &&
                composerPlusPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerPlusPanel
                    open
                    panelRef={composerPlusPanelRef}
                    locale={locale}
                    entries={composerMenuEntries}
                    filterQuery={
                      liveSlash.present ? slashFilterQuery : undefined
                    }
                    kindFilter={slashKindFilter}
                    onKindFilterChange={(k: any) => {
                      setSlashKindFilter(k);
                      setSlashActiveIndex(0);
                    }}
                    catalogCount={slashCatalogCount}
                    kindCounts={slashKindCounts}
                    skillsLoading={skillsLoading}
                    skillsError={skillsLoadError}
                    skillCount={slashCatalog.skills.length}
                    activeIndex={slashActiveIndex}
                    onActiveIndexChange={setSlashActiveIndex}
                    onSelectUpload={() => {
                      void pickComposerFiles();
                    }}
                    onSelectJsonSchema={() => {
                      closeComposerMenu();
                      setJsonSchemaDraft(sessionJsonSchema ?? "");
                      setShowJsonSchemaModal(true);
                    }}
                    onSelectCreateVideo={applyCreateVideo}
                    onSelectSlash={applySlashItem}
                    onClearFilters={clearSlashFilters}
                    resolveTitle={resolveSlashTitle}
                    resolveDescription={resolveSlashDescription}
                    style={{
                      ...composerPlusStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              {atMenuOpen &&
                composerAtPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerAtPanel
                    open
                    panelRef={atPanelRef}
                    locale={locale}
                    entries={atEntries}
                    filterQuery={liveAt.query}
                    loading={atLoading}
                    softFail={atSoftFail}
                    activeIndex={atActiveIndex}
                    onActiveIndexChange={setAtActiveIndex}
                    onSelect={applyAtFile}
                    style={{
                      ...composerAtStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              {attachChatOpen &&
                attachChatPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <AttachChatPanel
                    open
                    panelRef={attachChatPanelRef}
                    sessions={attachableSessions}
                    query={attachChatFilter}
                    activeIndex={attachChatActive}
                    focusFilter
                    labels={{
                      title: tr("attachChat.title"),
                      placeholder: tr("attachChat.placeholder"),
                      empty: tr("attachChat.empty"),
                      emptyFilter: tr("attachChat.emptyFilter"),
                      aria: tr("attachChat.aria"),
                      recentBadge: tr("attachChat.pickerRecent"),
                      projectBadge: tr("attachChat.pickerProject"),
                    }}
                    recentIds={loadRecentAttachIds()}
                    currentProjectId={activeProject?.id ?? null}
                    onQueryChange={setAttachChatFilter}
                    onActiveIndexChange={setAttachChatActive}
                    onSelect={(s) => {
                      applyAttachedChat(s.id, s.title, s.updatedAt);
                    }}
                    onClose={closeAttachChat}
                    style={{
                      ...attachChatStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              {promptHistoryOpen &&
                promptHistoryPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <PromptHistoryPanel
                    open
                    panelRef={promptHistoryPanelRef}
                    scope={promptHistoryScope}
                    onScopeChange={(next) => {
                      setPromptHistoryScope(next);
                      setPromptHistoryActive(0);
                      // Leaving session browse when switching to recent.
                      if (next === "recent") {
                        promptHistoryIndexRef.current = null;
                        setPromptHistoryIndex(null);
                      }
                    }}
                    entries={promptHistoryEntries}
                    unfilteredCount={promptHistoryUnfilteredCount}
                    query={promptHistoryFilter}
                    activeIndex={promptHistoryActive}
                    focusFilter={promptHistoryFocusFilter}
                    entryMeta={promptHistoryEntryMeta}
                    labels={{
                      tabSession: tr("promptHistory.tabSession"),
                      tabRecent: tr("promptHistory.tabRecent"),
                      placeholder: tr("promptHistory.placeholder"),
                      empty: tr("promptHistory.empty"),
                      emptyFilter: tr("promptHistory.emptyFilter"),
                      emptyRecent: tr("promptHistory.emptyRecent"),
                      emptyRecentFilter: tr("promptHistory.emptyRecentFilter"),
                      aria: tr("promptHistory.aria"),
                      clearFilter: tr("promptHistory.clearFilter"),
                      clearRecent: tr("promptHistory.clearRecent"),
                      removeRecent: tr("promptHistory.removeRecent"),
                    }}
                    onQueryChange={setPromptHistoryFilter}
                    onActiveIndexChange={(i) => {
                      setPromptHistoryActive(i);
                      const entry = promptHistoryEntries[i];
                      if (
                        entry &&
                        !promptHistoryFocusFilter &&
                        promptHistoryScope === "session"
                      ) {
                        // Empty-↑ browse: mirror Build — each step lands in the input.
                        applyPromptHistoryEntry(entry, {
                          close: false,
                          listIndex: i,
                          scope: "session",
                        });
                      }
                    }}
                    onSelect={(entry: any) =>
                      applyPromptHistoryEntry(entry, {
                        scope: promptHistoryScope,
                      })
                    }
                    onRequestClearRecent={() => setPromptHistoryClearOpen(true)}
                    onRemoveRecent={(historyIndex: any) => {
                      setRecentPromptHistory(removeRecentPrompt(historyIndex));
                      setPromptHistoryActive((i: any) => Math.max(0, i));
                    }}
                    onClose={closePromptHistory}
                    style={{
                      ...promptHistoryStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              <ComposerDraftEditor
                editorRef={composerInputRef}
                className="composer__input"
                disabled={!canType(session.state)}
                spellCheck={composerSpellcheck}
                aria-label={tr("a11y.composerInput")}
                placeholder={
                  goalMode
                    ? tr("composer.goalPlaceholder")
                    : tr("composer.placeholder")
                }
                onDraftChange={onComposerDraftChange}
                onPasteFiles={onComposerPasteFiles}
                onPasteMediaFallback={onComposerPasteMediaFallback}
                onSlashQueryChange={onSlashQueryChange}
                onKeyDown={onComposerKeyDown}
                onContextMenu={onComposerContextMenu}
              />
              <div
                className={
                  "composer__row" + (phoneLayout ? " composer__row--phone" : "")
                }
              >
                <Tip label={tr("composer.add")} disabled={phoneLayout}>
                  <button
                    ref={composerPlusTriggerRef}
                    type="button"
                    className={
                      "icon-btn icon-btn--plus" +
                      (composerMenuOpen || phoneToolsOpen ? " is-open" : "")
                    }
                    aria-label={tr("composer.add")}
                    onClick={() => {
                      if (phoneLayout) {
                        setPhoneToolsOpen((v: any) => !v);
                        closeComposerMenu();
                        return;
                      }
                      if (composerMenuOpen) {
                        closeComposerMenu();
                      } else {
                        setShowComposerPlus(true);
                      }
                    }}
                  >
                    <IconPlus size={18} />
                  </button>
                </Tip>
                {!phoneLayout ? (
                  <Tip label={tr("composer.skillsPicker")}>
                    <button
                      type="button"
                      className={
                        "icon-btn" +
                        (sideWorkbench.tabs.some((t: any) => t.kind === "skills") &&
                        !layout.asideCollapsed
                          ? " is-open"
                          : "")
                      }
                      aria-label={tr("composer.skillsPicker")}
                      aria-pressed={
                        sideWorkbench.tabs.some((t: any) => t.kind === "skills") &&
                        !layout.asideCollapsed
                      }
                      onClick={() => openSideSkillsPanel()}
                    >
                      <IconSkills size={18} />
                    </button>
                  </Tip>
                ) : null}
                {!phoneLayout ? (
                  <>
                    <ComposerAccessMenu
                      mode={mode}
                      policy={policy}
                      labels={{
                        access: tr("composer.access"),
                        accessHint: tr("composer.accessHint"),
                        mode: tr("composer.mode"),
                        modeAgent: tr("mode.agent"),
                        modePlan: tr("mode.plan"),
                        modeAsk: tr("mode.ask"),
                        modeAgentDesc: tr("mode.agentDesc"),
                        modePlanDesc: tr("mode.planDesc"),
                        modeAskDesc: tr("mode.askDesc"),
                        permission: tr("composer.permission"),
                        policyAsk: tr("policy.ask"),
                        policyAcceptEdits: tr("policy.accept_edits"),
                        policySession: tr("policy.allow_for_session"),
                        policyAuto: tr("policy.auto"),
                        policyDontAsk: tr("policy.dont_ask"),
                        policyYolo: tr("policy.always_approve"),
                        policyAskDesc: tr("policy.askDesc"),
                        policyAcceptEditsDesc: tr("policy.accept_editsDesc"),
                        policySessionDesc: tr(
                          "policy.allow_for_sessionDesc",
                        ),
                        policyAutoDesc: tr("policy.autoDesc"),
                        policyDontAskDesc: tr("policy.dont_askDesc"),
                        policyYoloDesc: tr("policy.always_approveDesc"),
                        policyShortAsk: tr("policy.short.ask"),
                        policyShortAccept: tr("policy.short.accept_edits"),
                        policyShortSession: tr(
                          "policy.short.allow_for_session",
                        ),
                        policyShortAuto: tr("policy.short.auto"),
                        policyShortDontAsk: tr("policy.short.dont_ask"),
                        policyShortYolo: tr("policy.short.always_approve"),
                      }}
                      onMode={(v) => {
                        setMode(v);
                        if (v === "plan") setGoalMode(false);
                        void api
                          .composerPrefsSet({
                            projectId: activeProject?.id ?? null,
                            sessionId: session.sessionId ?? null,
                            mode: v,
                          })
                          .catch((e) => showToast(String(e), 4000));
                      }}
                      onPolicy={(v: PermissionPolicyId) => {
                        applyPermissionPolicy(v);
                      }}
                    />
                    {goalMode ? (
                      <Tip label={tr("composer.goalHint")}>
                        <button
                          type="button"
                          className="chip chip--goal"
                          onClick={() => setGoalMode(false)}
                          aria-label={tr("composer.goalClear")}
                        >
                          <IconImagine size={14} />
                          <span className="chip__label">
                            {tr("composer.goal")}
                          </span>
                          <IconClose size={12} />
                        </button>
                      </Tip>
                    ) : null}
                    {sessionJsonSchema ? (
                      <Tip
                        label={sessionJsonSchema}
                        className="ui-tip--wrap ui-tip--mono"
                      >
                        <button
                          type="button"
                          className="icon-btn chip--json-schema is-active"
                          onClick={() => {
                            setJsonSchemaDraft(sessionJsonSchema);
                            setShowJsonSchemaModal(true);
                          }}
                          aria-label={tr("composer.jsonSchemaActive")}
                        >
                          <IconCode size={16} />
                        </button>
                      </Tip>
                    ) : null}
                    <ContextUsageChip
                      display={contextUsageDisplay}
                      locale={locale}
                      labels={{
                        aria: tr("context.chipAria"),
                        tipUnknown: tr("context.chipTipUnknown"),
                        tipEstimated: tr("context.chipTipEstimated"),
                        tipKnown: tr("context.chipTipKnown"),
                        menuTitle: tr("context.menuTitle"),
                        current: tr("context.current"),
                        sourceKnown: tr("context.sourceKnown"),
                        sourceEstimated: tr("context.sourceEstimated"),
                        sourceUnknown: tr("context.sourceUnknown"),
                        lastCompact: tr("context.lastCompact"),
                        lastCompactNone: tr("context.lastCompactNone"),
                        tokensRange: tr("compact.tokensRange"),
                        compactAction: tr("context.compactAction"),
                        heuristicNote: tr("context.heuristicNote"),
                        auto: tr("context.triggerAuto"),
                        manual: tr("context.triggerManual"),
                        breakdownUser: tr("context.breakdownUser"),
                        breakdownAssistant: tr("context.breakdownAssistant"),
                        breakdownThought: tr("context.breakdownThought"),
                        breakdownEstimatedNote: tr(
                          "context.breakdownEstimatedNote",
                        ),
                        window: tr("context.window"),
                        percentUsed: tr("context.percentLabel"),
                        cacheHit: tr("context.cacheHit"),
                      }}
                      onCompact={() => {
                        setCompactNote("");
                        setShowCompactModal(true);
                      }}
                      onUsage={() => setShowUsageLimitModal(true)}
                      usageAction={tr("usageModal.openFromChip")}
                    />
                  </>
                ) : null}
                <ComposerDraftStats show={showComposerDraftStats} tr={tr} />
                <ComposerClearDraftButton
                  attachmentsLength={attachments.length + quotes.length}
                  onClear={() => requestClearComposerDraft()}
                  label={tr("composer.clearDraft")}
                />
                <span className="composer__spacer" />
                {/* Dictation (mic): always visible for auth soft-fail; Live Voice entry separate. */}
                {(() => {
                  const micChrome = resolveVoiceMicChrome({
                    phase: voice.phase,
                    gateAvailable: voiceGate.available,
                    autoSend: voiceDictationAutoSend,
                    liveVoiceOpen,
                    canType: canType(session.state),
                  });
                  const micLabel = tr(
                    voiceMicLabelMessageKey(micChrome.labelKind),
                  );
                  return (
                    <Tip label={micLabel}>
                      <button
                        type="button"
                        className={
                          "icon-btn composer__voice" +
                          (micChrome.liveClass
                            ? " composer__voice--live"
                            : "") +
                          (micChrome.busyClass
                            ? " composer__voice--busy"
                            : "") +
                          (micChrome.unavailableClass
                            ? " composer__voice--unavailable"
                            : "")
                        }
                        disabled={!micChrome.interactive}
                        aria-pressed={micChrome.ariaPressed}
                        aria-label={micLabel}
                        onClick={() => toggleVoice()}
                      >
                        <IconMic size={16} />
                      </button>
                    </Tip>
                  );
                })()}
                <ComposerSendCluster
                  attachmentsLength={attachments.length + quotes.length}
                  effectiveCanStop={effectiveCanStop}
                  connecting={connecting}
                  sessionState={session.state}
                  effectiveCanSend={effectiveCanSend}
                  shouldEnqueue={shouldEnqueueSend(session.state, connecting)}
                  canShowQueueButton={(state, conn, hasBody) =>
                    sendQueue.canShowQueueButton(state, conn, hasBody)
                  }
                  onSend={() => void send()}
                  onStop={() => void stop()}
                  tr={tr}
                />
              </div>
            </div>
  );
}
