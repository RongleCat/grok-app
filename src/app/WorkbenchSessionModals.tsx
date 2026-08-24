/**
 * Session / agent action modals (ask-user, status, dashboards, rewind/fork,
 * plan history, json schema, session note/rules/turns/prompt).
 *
 * Compact / queue / chrome overlays stay elsewhere. Host owns send/open
 * verbs; this file is the view cluster so those dialogs can move without
 * opening the workbench return.
 */
import { lazy, Suspense, useRef } from "react";
import * as api from "@/lib/api";
import { AskUserModal } from "@/components/AskUserModal";
import { StatusModal } from "@/components/StatusModal";
import { UsageLimitModal } from "@/components/UsageLimitModal";
import { ConfirmCopyModal } from "@/components/workbench-modals/ConfirmCopyModal";
import { ForkConfirmModal } from "@/components/workbench-modals/ForkConfirmModal";
import { JsonSchemaModal } from "@/components/workbench-modals/JsonSchemaModal";
import { PlanHistoryModal } from "@/components/workbench-modals/PlanHistoryModal";
import { PlanHistoryPreviewModal } from "@/components/workbench-modals/PlanHistoryPreviewModal";
import { PlanReviseModal } from "@/components/workbench-modals/PlanReviseModal";
import { ResumeRestoreConfirmModal } from "@/components/workbench-modals/ResumeRestoreConfirmModal";
import { RewindConfirmModal } from "@/components/workbench-modals/RewindConfirmModal";
import { RewindTimelineModal } from "@/components/workbench-modals/RewindTimelineModal";
import { SessionMaxTurnsModal } from "@/components/workbench-modals/SessionMaxTurnsModal";
import { SessionNoteModal } from "@/components/workbench-modals/SessionNoteModal";
import { SessionRulesModal } from "@/components/workbench-modals/SessionRulesModal";
import { SessionSysPromptModal } from "@/components/workbench-modals/SessionSysPromptModal";
import { TracesHistoryModal } from "@/components/workbench-modals/TracesHistoryModal";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import type { BatchProjectInput } from "@/lib/batchAgents";
import { parseJsonSchemaText } from "@/lib/jsonSchema";
import { sanitizeExtraRules } from "@/lib/sessionExtraRules";
import { normalizeMaxAgentTurns } from "@/lib/sessionMaxAgentTurns";
import { sanitizeSystemPromptOverride } from "@/lib/sessionSystemPrompt";
import { resolveForkCliOnConfirm } from "@/lib/sessionFork";
import {
  canClaimAskUserSettle,
  settleAskUserDecision,
} from "@/lib/askUserSettle";

const AgentDashboardModal = lazy(async () => {
  const m = await import("@/components/AgentDashboardModal");
  return { default: m.AgentDashboardModal };
});
const SessionTaskBoardModal = lazy(async () => {
  const m = await import("@/components/SessionTaskBoardModal");
  return { default: m.SessionTaskBoardModal };
});
const BatchAgentsModal = lazy(async () => {
  const m = await import("@/components/BatchAgentsModal");
  return { default: m.BatchAgentsModal };
});
const OpsEntryModal = lazy(async () => {
  const m = await import("@/components/OpsEntryModal");
  return { default: m.OpsEntryModal };
});
const McpStatusModal = lazy(async () => {
  const m = await import("@/components/McpStatusModal");
  return { default: m.McpStatusModal };
});

export type WorkbenchSessionModalsProps = {
  // Bindings are the workbench composition-root names. Typed loosely so the
  // view can move without re-stating every dialog payload here.
  [K: string]: unknown;
};

export function WorkbenchSessionModals(p: WorkbenchSessionModalsProps) {
  const {
    account,
    agentDashboardOpen,
    agentDashboardRows,
    askUser,
    askUserTimeoutSec,
    batchAgentsOpen,
    clearPendingGates,
    clearSessionMaxTurnsModal,
    clearSessionRulesModal,
    clearSessionSysPromptModal,
    closeSessionMaxTurnsModal,
    closeSessionNoteModal,
    closeSessionRulesModal,
    closeSessionSysPromptModal,
    confirmClearPlanHistory,
    confirmClearSessionNoteModal,
    confirmRewindToPrompt,
    customRouteActive,
    effectiveProjectPath,
    effort,
    forceCloseSessionNoteModal,
    forceCloseSessionRulesModal,
    forceCloseSessionSysPromptModal,
    forkAgentCheckbox,
    forkBusy,
    forkConfirm,
    forkRestoreCode,
    jsonSchemaDraft,
    locale,
    maxAgentTurns,
    mcpDoctorError,
    mcpDoctorFocus,
    mcpDoctorLoading,
    mcpDoctorReport,
    mcpError,
    mcpLoading,
    mcpServers,
    messages,
    mode,
    modelId,
    navigateSettings,
    openBatchAgents,
    openOpsDestination,
    openPlanHistorySession,
    openSession,
    opsEntryCounts,
    opsEntryOpen,
    planHistoryPreview,
    planReviseNote,
    planReviseOpen,
    policy,
    projects,
    refreshMcpModal,
    requestClearSessionNoteModal,
    requestPlanChanges,
    resumeAgentCheckbox,
    resumeRestoreBusy,
    resumeRestoreConfirm,
    rewindBusy,
    rewindConfirm,
    rewindError,
    setRewindError,
    rewindModalRef,
    rewindRestoreFiles,
    rewindTimeline,
    runBatchAgentsDispatch,
    runForkSession,
    runMcpDoctor,
    runResumeWithCodeRestore,
    runRewindToPrompt,
    saveSessionMaxTurnsModal,
    saveSessionNoteModal,
    saveSessionRulesModal,
    saveSessionSysPromptModal,
    session,
    sessionJsonSchema,
    sessionMaxTurnsDraft,
    sessionMaxTurnsTarget,
    sessionNoteBaseline,
    sessionNoteClearOpen,
    sessionNoteDiscardOpen,
    sessionNoteDraft,
    sessionNoteTarget,
    sessionNotesMap,
    sessionRulesBaseline,
    sessionRulesBusy,
    sessionRulesDiscardOpen,
    sessionRulesDraft,
    sessionRulesError,
    sessionRulesTarget,
    sessionSpend,
    sessionSysPromptBaseline,
    sessionSysPromptBusy,
    sessionSysPromptDiscardOpen,
    sessionSysPromptDraft,
    sessionSysPromptError,
    sessionSysPromptTarget,
    sessionTaskBoard,
    sessions,
    setAgentDashboardOpen,
    setAskUser,
    setBatchAgentsOpen,
    setForkCliSession,
    setForkConfirm,
    setForkRestoreCode,
    setJsonSchemaDraft,
    setOpsEntryOpen,
    setPlanHistoryPreview,
    setPlanReviseNote,
    setPlanReviseOpen,
    setResumeForkCliSession,
    setResumeRestoreConfirm,
    setRewindConfirm,
    setRewindRestoreFiles,
    setRewindTimeline,
    setSessionJsonSchema,
    setSessionMaxTurnsDraft,
    setSessionNoteClearOpen,
    setSessionNoteDiscardOpen,
    setSessionNoteDraft,
    setSessionRulesDiscardOpen,
    setSessionRulesDraft,
    setSessionRulesError,
    setSessionSysPromptDiscardOpen,
    setSessionSysPromptDraft,
    setSessionSysPromptError,
    setSessions,
    setShowJsonSchemaModal,
    setShowMcpModal,
    setShowPlanHistory,
    setShowStatusModal,
    setShowTraces,
    setShowUsageLimitModal,
    setTaskBoardIncludeArchived,
    setTaskBoardOpen,
    showJsonSchemaModal,
    showMcpModal,
    showPlanHistory,
    showStatusModal,
    showToast,
    showTraces,
    showUsageLimitModal,
    stopAllBusySessions,
    stopBusySessionsByIds,
    taskBoardIncludeArchived,
    taskBoardOpen,
    tr
  } = p as Record<string, any>;
  const askUserSettlingRpcRef = useRef<number | null>(null);

  return (
    <>
      <AskUserModal
        payload={askUser}
        timeoutSec={askUserTimeoutSec}
        labels={{
          title: tr("askUser.title"),
          submit: tr("askUser.submit"),
          cancel: tr("askUser.cancel"),
          otherPlaceholder: tr("askUser.otherPlaceholder"),
          freeTextHint: tr("askUser.freeTextHint"),
          multiHint: tr("askUser.multiHint"),
          close: tr("common.close"),
          autoCancelCountdown: tr("askUser.autoCancelCountdown"),
        }}
        onSubmit={async (answers) => {
          if (!askUser) return;
          if (!canClaimAskUserSettle(askUserSettlingRpcRef.current, askUser.rpcId)) {
            return;
          }
          const payload = askUser;
          askUserSettlingRpcRef.current = payload.rpcId;
          setAskUser(null);
          const settled = await settleAskUserDecision({
            payload,
            decision: "accepted",
            answers,
            viewingSessionId: () => session.sessionId,
            currentRpcId: () => askUser?.rpcId ?? null,
            resolve: (args) => api.sessionResolveAskUser(args),
          });
          if (settled.kind === "restore") {
            setAskUser(payload);
            showToast(String(settled.error), 4500);
          } else {
            clearPendingGates(payload.sessionId);
          }
          if (askUserSettlingRpcRef.current === payload.rpcId) {
            askUserSettlingRpcRef.current = null;
          }
        }}
        onCancel={async () => {
          if (!askUser) return;
          if (!canClaimAskUserSettle(askUserSettlingRpcRef.current, askUser.rpcId)) {
            return;
          }
          const payload = askUser;
          askUserSettlingRpcRef.current = payload.rpcId;
          setAskUser(null);
          await settleAskUserDecision({
            payload,
            decision: "cancelled",
            viewingSessionId: () => session.sessionId,
            currentRpcId: () => askUser?.rpcId ?? null,
            resolve: (args) => api.sessionResolveAskUser(args),
          });
          clearPendingGates(payload.sessionId);
          if (askUserSettlingRpcRef.current === payload.rpcId) {
            askUserSettlingRpcRef.current = null;
          }
        }}
      />
      <StatusModal
        open={showStatusModal}
        locale={locale}
        sessionId={session.sessionId}
        agentSessionId={session.agentSessionId}
        modelId={modelId}
        effort={effort}
        mode={mode}
        policy={policy}
        projectPath={effectiveProjectPath}
        messageCount={messages.length}
        onClose={() => setShowStatusModal(false)}
      />
      <UsageLimitModal
        open={showUsageLimitModal}
        locale={locale}
        sessionId={session.sessionId}
        spend={sessionSpend}
        account={account}
        customRoute={customRouteActive}
        turnActive={
          session.state === "streaming" ||
          session.state === "awaiting_permission"
        }
        onClose={() => setShowUsageLimitModal(false)}
      />
      {(agentDashboardOpen) ? (
      <Suspense fallback={null}>
      <AgentDashboardModal
        open={agentDashboardOpen}
        locale={locale}
        rows={agentDashboardRows}
        onClose={() => setAgentDashboardOpen(false)}
        onSelectSession={(id) => {
          const row = sessions.find((s: SessionRow) => s.id === id);
          if (!row) return;
          const proj = projects.find((p: Project) => p.id === row.projectId) || null;
          void openSession(row, proj);
        }}
        onStopAllBusy={() => stopAllBusySessions("dashboard")}
        onStopSessions={(ids) => {
          const n = ids.length;
          stopBusySessionsByIds(ids, {
            title: tr("dashboard.stopSelectedTitle", { n }),
            message: tr("dashboard.stopSelectedConfirm", { n: String(n) }),
            confirmLabel: tr("dashboard.stopSelected", { n }),
          });
        }}
        onOpenBatchAgents={() => {
          setAgentDashboardOpen(false);
          openBatchAgents();
        }}
        onOpenTaskBoard={() => {
          setAgentDashboardOpen(false);
          setTaskBoardOpen(true);
        }}
      />
      </Suspense>
      ) : null}
      {(opsEntryOpen) ? (
      <Suspense fallback={null}>
      <OpsEntryModal
        open={opsEntryOpen}
        locale={locale}
        counts={opsEntryCounts}
        onClose={() => setOpsEntryOpen(false)}
        onSelect={openOpsDestination}
      />
      </Suspense>
      ) : null}
      {(taskBoardOpen) ? (
      <Suspense fallback={null}>
      <SessionTaskBoardModal
        open={taskBoardOpen}
        locale={locale}
        board={sessionTaskBoard}
        includeArchived={taskBoardIncludeArchived}
        onIncludeArchivedChange={setTaskBoardIncludeArchived}
        onClose={() => setTaskBoardOpen(false)}
        onSelectSession={(id) => {
          setTaskBoardOpen(false);
          const row = sessions.find((s: SessionRow) => s.id === id);
          if (!row) return;
          const proj = projects.find((p: Project) => p.id === row.projectId) || null;
          void openSession(row, proj);
        }}
      />
      </Suspense>
      ) : null}
      {(batchAgentsOpen) ? (
      <Suspense fallback={null}>
      <BatchAgentsModal
        open={batchAgentsOpen}
        locale={locale}
        projects={projects.map(
          (p: Project): BatchProjectInput => ({
            id: p.id,
            name: p.name,
            path: p.path,
            trusted: p.trusted,
            pathOk: p.pathOk,
            system: p.system,
          }),
        )}
        onClose={() => setBatchAgentsOpen(false)}
        onDispatch={runBatchAgentsDispatch}
      />
      </Suspense>
      ) : null}
      {(showMcpModal) ? (
      <Suspense fallback={null}>
      <McpStatusModal
        open={showMcpModal}
        locale={locale}
        servers={mcpServers}
        error={mcpError}
        loading={mcpLoading}
        onClose={() => setShowMcpModal(false)}
        onManage={() => navigateSettings("extensions")}
        onRefresh={() => void refreshMcpModal()}
        doctorReport={mcpDoctorReport}
        doctorError={mcpDoctorError}
        doctorLoading={mcpDoctorLoading}
        doctorFocus={mcpDoctorFocus}
        onRunDoctor={(name) => void runMcpDoctor(name)}
        onRefreshDoctor={(name) => runMcpDoctor(name)}
      />
      </Suspense>
      ) : null}
      <RewindTimelineModal
        locale={locale}
        timeline={rewindTimeline}
        busy={rewindBusy}
        panelRef={rewindModalRef}
        onClose={() => setRewindTimeline(null)}
        onPick={(promptIndex, preview) => {
          if (!rewindTimeline) return;
          confirmRewindToPrompt(
            rewindTimeline.sessionId,
            promptIndex,
            preview,
          );
        }}
      />

      <RewindConfirmModal
        locale={locale}
        confirm={rewindConfirm}
        busy={rewindBusy}
        error={typeof rewindError === "string" ? rewindError : null}
        restoreFiles={rewindRestoreFiles}
        onRestoreFilesChange={setRewindRestoreFiles}
        onClose={() => {
          setRewindConfirm(null);
          setRewindRestoreFiles(false);
          (setRewindError as (v: string | null) => void)(null);
        }}
        onConfirm={() => {
          if (!rewindConfirm) return;
          void runRewindToPrompt(
            rewindConfirm.sessionId,
            rewindConfirm.targetPromptIndex,
            rewindRestoreFiles,
          );
        }}
      />

      <ForkConfirmModal
        locale={locale}
        confirm={forkConfirm}
        busy={forkBusy}
        restoreCode={forkRestoreCode}
        agentCheckbox={forkAgentCheckbox}
        onRestoreCodeChange={setForkRestoreCode}
        onForkCliSessionChange={setForkCliSession}
        onClose={() => {
          setForkConfirm(null);
          setForkRestoreCode(false);
          setForkCliSession(false);
        }}
        onConfirm={() => {
          if (!forkConfirm) return;
          void runForkSession(forkConfirm.source, {
            throughUserPromptIndex:
              forkConfirm.throughUserPromptIndex ?? null,
            restoreCode: forkRestoreCode,
            forkCliSession: resolveForkCliOnConfirm({
              throughUserPromptIndex:
                forkConfirm.throughUserPromptIndex ?? null,
              checkboxChecked: forkAgentCheckbox.checked,
              agentSessionId: forkConfirm.source.agentSessionId,
            }),
          });
        }}
      />

      <ResumeRestoreConfirmModal
        locale={locale}
        open={!!resumeRestoreConfirm}
        busy={resumeRestoreBusy}
        agentCheckbox={resumeAgentCheckbox}
        onForkCliSessionChange={setResumeForkCliSession}
        onClose={() => {
          setResumeRestoreConfirm(null);
          setResumeForkCliSession(false);
        }}
        onConfirm={() => {
          if (!resumeRestoreConfirm) return;
          void runResumeWithCodeRestore(resumeRestoreConfirm, {
            forkCliSession: resumeAgentCheckbox.checked,
          });
        }}
      />

      <TracesHistoryModal
        locale={locale}
        open={showTraces}
        onClose={() => setShowTraces(false)}
        onError={(msg) => showToast(msg, 4000)}
      />

      <PlanHistoryModal
        locale={locale}
        open={showPlanHistory}
        existingSessionIds={sessions.map((s: SessionRow) => s.id)}
        onClose={() => setShowPlanHistory(false)}
        onOpen={(entry) => setPlanHistoryPreview(entry)}
        onOpenSession={(entry) => openPlanHistorySession(entry)}
        onRequestClearAll={confirmClearPlanHistory}
      />

      <PlanHistoryPreviewModal
        locale={locale}
        entry={planHistoryPreview}
        canOpenSession={
          !!planHistoryPreview &&
          sessions.some((s: SessionRow) => s.id === planHistoryPreview.sessionId)
        }
        onClose={() => setPlanHistoryPreview(null)}
        onOpenSession={() => {
          if (planHistoryPreview) openPlanHistorySession(planHistoryPreview);
        }}
      />

      <PlanReviseModal
        locale={locale}
        open={planReviseOpen}
        note={planReviseNote}
        onNoteChange={setPlanReviseNote}
        onClose={() => {
          setPlanReviseOpen(false);
          setPlanReviseNote("");
        }}
        onSubmit={() => void requestPlanChanges(planReviseNote)}
      />

      <JsonSchemaModal
        locale={locale}
        open={showJsonSchemaModal}
        draft={jsonSchemaDraft}
        hasStoredSchema={!!sessionJsonSchema}
        onDraftChange={setJsonSchemaDraft}
        onClose={() => setShowJsonSchemaModal(false)}
        onClear={() => {
          void (async () => {
            const sid = session.sessionId;
            setSessionJsonSchema(null);
            setJsonSchemaDraft("");
            setShowJsonSchemaModal(false);
            if (sid && api.isTauri()) {
              try {
                await api.sessionSetJsonSchema(sid, null);
              } catch {
                /* ignore */
              }
            }
            if (sid) {
              setSessions((list: SessionRow[]) =>
                list.map((row: SessionRow) =>
                  row.id === sid ? { ...row, jsonSchema: null } : row,
                ),
              );
            }
          })();
        }}
        onApply={() => {
          void (async () => {
            const parsed = parseJsonSchemaText(jsonSchemaDraft);
            if (!parsed.ok) {
              showToast(tr("composer.jsonSchemaInvalid"), 4000);
              return;
            }
            const sid = session.sessionId;
            setSessionJsonSchema(parsed.normalized);
            if (sid && api.isTauri()) {
              try {
                const saved = await api.sessionSetJsonSchema(
                  sid,
                  parsed.normalized,
                );
                const next =
                  typeof saved.jsonSchema === "string" &&
                  saved.jsonSchema.trim()
                    ? saved.jsonSchema
                    : parsed.normalized;
                setSessionJsonSchema(next);
                setSessions((list: SessionRow[]) =>
                  list.map((row: SessionRow) =>
                    row.id === sid ? { ...row, jsonSchema: next } : row,
                  ),
                );
              } catch (e) {
                showToast(String(e), 4000);
                return;
              }
            } else if (!sid) {
              showToast(tr("composer.jsonSchemaEmptySession"), 3200);
            }
            setShowJsonSchemaModal(false);
          })();
        }}
      />

      <SessionNoteModal
        locale={locale}
        open={!!sessionNoteTarget}
        sessionTitle={sessionNoteTarget?.title ?? null}
        draft={sessionNoteDraft}
        baseline={sessionNoteBaseline}
        hadStored={Boolean(
          sessionNoteTarget && sessionNotesMap[sessionNoteTarget.id]?.trim(),
        )}
        showClear={Boolean(
          sessionNoteTarget &&
            (sessionNotesMap[sessionNoteTarget.id]?.trim() ||
              sessionNoteDraft.trim()),
        )}
        onClose={closeSessionNoteModal}
        onSave={saveSessionNoteModal}
        onClear={requestClearSessionNoteModal}
        onDraftChange={setSessionNoteDraft}
      />

      <ConfirmCopyModal
        open={sessionNoteDiscardOpen}
        title={tr("resources.discardTitle")}
        body={tr("session.noteDiscardBody")}
        closeLabel={tr("common.close")}
        cancelLabel={tr("common.cancel")}
        confirmLabel={tr("resources.discardConfirm")}
        onClose={() => setSessionNoteDiscardOpen(false)}
        onConfirm={() => {
          setSessionNoteDiscardOpen(false);
          forceCloseSessionNoteModal();
        }}
      />

      <ConfirmCopyModal
        open={sessionNoteClearOpen}
        title={tr("session.noteClearTitle")}
        body={tr("session.noteClearBody")}
        closeLabel={tr("common.close")}
        cancelLabel={tr("common.cancel")}
        confirmLabel={tr("session.noteClearConfirm")}
        danger
        onClose={() => setSessionNoteClearOpen(false)}
        onConfirm={() => {
          setSessionNoteClearOpen(false);
          confirmClearSessionNoteModal();
        }}
      />

      <SessionRulesModal
        locale={locale}
        open={!!sessionRulesTarget}
        sessionTitle={sessionRulesTarget?.title ?? null}
        draft={sessionRulesDraft}
        baseline={sessionRulesBaseline}
        hadStored={sessions.some(
          (row: SessionRow) =>
            sessionRulesTarget &&
            row.id === sessionRulesTarget.id &&
            !!sanitizeExtraRules(row.extraRules),
        )}
        showClear={Boolean(
          sessionRulesTarget &&
            (sessionRulesDraft.trim() ||
              sessions.some(
                (row: SessionRow) =>
                  row.id === sessionRulesTarget.id &&
                  !!sanitizeExtraRules(row.extraRules),
              )),
        )}
        busy={sessionRulesBusy}
        error={sessionRulesError}
        onClose={closeSessionRulesModal}
        onSave={() => {
          void saveSessionRulesModal();
        }}
        onClear={() => {
          void clearSessionRulesModal();
        }}
        onDraftChange={(value) => {
          setSessionRulesDraft(value);
          setSessionRulesError(null);
        }}
      />

      <ConfirmCopyModal
        open={sessionRulesDiscardOpen}
        title={tr("resources.discardTitle")}
        body={tr("session.promptDiscardBody")}
        closeLabel={tr("common.close")}
        cancelLabel={tr("common.cancel")}
        confirmLabel={tr("resources.discardConfirm")}
        onClose={() => setSessionRulesDiscardOpen(false)}
        onConfirm={() => {
          setSessionRulesDiscardOpen(false);
          forceCloseSessionRulesModal();
        }}
      />

      <SessionMaxTurnsModal
        locale={locale}
        open={!!sessionMaxTurnsTarget}
        sessionTitle={sessionMaxTurnsTarget?.title ?? null}
        draft={sessionMaxTurnsDraft}
        globalTurns={maxAgentTurns}
        showClear={Boolean(
          sessionMaxTurnsTarget &&
            (sessionMaxTurnsDraft.trim() ||
              sessions.some(
                (row: SessionRow) =>
                  row.id === sessionMaxTurnsTarget.id &&
                  normalizeMaxAgentTurns(row.maxAgentTurns) != null,
              )),
        )}
        onClose={closeSessionMaxTurnsModal}
        onSave={() => {
          void saveSessionMaxTurnsModal();
        }}
        onClear={() => {
          void clearSessionMaxTurnsModal();
        }}
        onDraftChange={setSessionMaxTurnsDraft}
      />

      <SessionSysPromptModal
        locale={locale}
        open={!!sessionSysPromptTarget}
        sessionTitle={sessionSysPromptTarget?.title ?? null}
        draft={sessionSysPromptDraft}
        baseline={sessionSysPromptBaseline}
        hadStored={sessions.some(
          (row: SessionRow) =>
            sessionSysPromptTarget &&
            row.id === sessionSysPromptTarget.id &&
            !!sanitizeSystemPromptOverride(row.systemPromptOverride),
        )}
        showClear={Boolean(
          sessionSysPromptTarget &&
            (sessionSysPromptDraft.trim() ||
              sessions.some(
                (row: SessionRow) =>
                  row.id === sessionSysPromptTarget.id &&
                  !!sanitizeSystemPromptOverride(row.systemPromptOverride),
              )),
        )}
        busy={sessionSysPromptBusy}
        error={sessionSysPromptError}
        onClose={closeSessionSysPromptModal}
        onSave={() => {
          void saveSessionSysPromptModal();
        }}
        onClear={() => {
          void clearSessionSysPromptModal();
        }}
        onDraftChange={(value) => {
          setSessionSysPromptDraft(value);
          setSessionSysPromptError(null);
        }}
      />

      <ConfirmCopyModal
        open={sessionSysPromptDiscardOpen}
        title={tr("resources.discardTitle")}
        body={tr("session.promptDiscardBody")}
        closeLabel={tr("common.close")}
        cancelLabel={tr("common.cancel")}
        confirmLabel={tr("resources.discardConfirm")}
        onClose={() => setSessionSysPromptDiscardOpen(false)}
        onConfirm={() => {
          setSessionSysPromptDiscardOpen(false);
          forceCloseSessionSysPromptModal();
        }}
      />
    </>
  );
}
