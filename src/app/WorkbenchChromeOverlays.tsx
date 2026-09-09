/**
 * App-chrome overlays: doctor, project rules, prompt-history / archive
 * confirms, worktrees, shortcuts, tutorial, live voice.
 *
 * Compact / queue / ask-user / rewind stay with composer or session-turn
 * owners. Host still owns openSession / send / dialog verbs.
 */
import { lazy, Suspense } from "react";
import { ArchiveAgeConfirmModal } from "@/components/workbench-modals/ArchiveAgeConfirmModal";
import { PromptHistoryClearModal } from "@/components/workbench-modals/PromptHistoryClearModal";
import { SessionMruSwitcher } from "@/components/SessionMruSwitcher";
import { ShortcutsHelpModal } from "@/components/workbench-modals/ShortcutsHelpModal";
import { WorktreeCreateModal } from "@/components/workbench-modals/WorktreeCreateModal";
import { WorktreeGcModal } from "@/components/workbench-modals/WorktreeGcModal";
import { WorktreeShipModal } from "@/components/workbench-modals/WorktreeShipModal";
import type { Locale } from "@/i18n";
import type { AppPlatform } from "@/lib/appPlatform";
import type { ComposerSendKeyPref } from "@/lib/composerSendKey";
import type { GitWorktreeChromeOverlay } from "@/hooks/useGitWorktreeChrome";
import type { ArchiveAgePlan } from "@/lib/sessionArchiveAge";
import type { ShortcutRemapMap } from "@/lib/shortcutRemap";
import type { VoiceSessionChipInput } from "@/lib/voiceCommandCenter";
import { useWhatsNew } from "@/hooks/useWhatsNew";

const DoctorModal = lazy(async () => {
  const m = await import("@/components/DoctorModal");
  return { default: m.DoctorModal };
});
const ProjectRulesModal = lazy(async () => {
  const m = await import("@/components/ProjectRulesModal");
  return { default: m.ProjectRulesModal };
});
const ProductTutorial = lazy(async () => {
  const m = await import("@/components/ProductTutorial");
  return { default: m.ProductTutorial };
});
const WhatsNewModal = lazy(async () => {
  const m = await import("@/components/WhatsNewModal");
  return { default: m.WhatsNewModal };
});
const VoiceOverlay = lazy(async () => {
  const m = await import("@/components/VoiceOverlay");
  return { default: m.VoiceOverlay };
});

export type WorkbenchChromeOverlaysProps = {
  locale: Locale;
  platform: AppPlatform;
  showDoctor: boolean;
  closeDoctor: () => void;
  onDoctorConfirm: (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) => void;
  onDoctorResetDone: () => void;
  onOpenReliability: () => void;
  projectRulesTarget: { path: string; name: string } | null;
  closeProjectRules: () => void;
  promptHistoryClearOpen: boolean;
  closePromptHistoryClear: () => void;
  onConfirmPromptHistoryClear: () => void;
  archiveAgePlan: ArchiveAgePlan | null;
  archiveAgeBusy: boolean;
  closeArchiveAge: () => void;
  onConfirmArchiveAge: () => void;
  worktreeChrome: GitWorktreeChromeOverlay;
  showToast: (message: string, ms: number) => void;
  showShortcuts: boolean;
  composerSendKeyPref: ComposerSendKeyPref;
  shortcutRemaps: ShortcutRemapMap;
  voiceHotkeyEnabled: boolean;
  closeShortcuts: () => void;
  showProductTutorial: boolean;
  closeProductTutorial: () => void;
  /** Workbench gate is ready (not setup / loading). */
  gateReady: boolean;
  setupOpen?: boolean;
  liveVoiceOpen: boolean;
  voiceLocale: Locale;
  voiceProjectPath: string | null | undefined;
  voiceProjectId: string | null;
  voiceProjectName: string;
  voiceId: string | null | undefined;
  voiceKeepAgentsOnEnd: boolean;
  voiceHasActiveSession: boolean;
  voiceHasAuth: boolean;
  voiceSessions: VoiceSessionChipInput[];
  closeLiveVoice: () => void;
  onLiveVoiceClassifiedNotice: (message: string) => void;
  onSendVoiceTranscriptAsPrompt:
    | ((prompt: string) => Promise<void>)
    | undefined;
  onVoiceFocusSession: (id: string) => void;
};

export function WorkbenchChromeOverlays(p: WorkbenchChromeOverlaysProps) {
  const whatsNew = useWhatsNew({
    locale: p.locale,
    gateReady: p.gateReady,
    setupOpen: p.setupOpen,
    tutorialOpen: p.showProductTutorial,
  });
  const wt = p.worktreeChrome;
  return (
    <>
      <SessionMruSwitcher locale={p.locale} />
      {p.showDoctor ? (
        <Suspense fallback={null}>
          <DoctorModal
            open={p.showDoctor}
            onClose={p.closeDoctor}
            locale={p.locale}
            onConfirm={p.onDoctorConfirm}
            onResetDone={p.onDoctorResetDone}
            onOpenReliability={p.onOpenReliability}
          />
        </Suspense>
      ) : null}
      {p.projectRulesTarget ? (
        <Suspense fallback={null}>
          <ProjectRulesModal
            open
            onClose={p.closeProjectRules}
            projectPath={p.projectRulesTarget.path}
            projectName={p.projectRulesTarget.name}
            locale={p.locale}
          />
        </Suspense>
      ) : null}
      <PromptHistoryClearModal
        locale={p.locale}
        open={p.promptHistoryClearOpen}
        onClose={p.closePromptHistoryClear}
        onConfirm={p.onConfirmPromptHistoryClear}
      />
      <ArchiveAgeConfirmModal
        locale={p.locale}
        plan={p.archiveAgePlan}
        busy={p.archiveAgeBusy}
        onClose={p.closeArchiveAge}
        onConfirm={p.onConfirmArchiveAge}
      />
      <WorktreeCreateModal
        locale={p.locale}
        open={wt.create.open}
        busy={wt.create.busy}
        startChat={wt.create.startChat}
        name={wt.create.name}
        layout={wt.create.layout}
        startRef={wt.create.startRef}
        previewPath={wt.create.previewPath}
        error={wt.create.error}
        onClose={wt.create.close}
        onSubmit={wt.create.submit}
        onNameChange={wt.create.setName}
        onLayoutChange={wt.create.setLayout}
        onRefChange={wt.create.setRef}
      />
      <WorktreeGcModal
        locale={p.locale}
        open={wt.gc.open}
        busy={wt.gc.busy}
        previewBusy={wt.gc.previewBusy}
        force={wt.gc.force}
        preview={wt.gc.preview}
        error={wt.gc.error}
        onClose={wt.gc.close}
        onSubmit={wt.gc.submit}
        onForceChange={wt.gc.setForce}
      />
      <WorktreeShipModal
        locale={p.locale}
        open={wt.ship.open}
        busy={wt.ship.busy}
        success={wt.ship.success}
        title={wt.ship.title}
        body={wt.ship.body}
        createPr={wt.ship.createPr}
        draft={wt.ship.draft}
        branch={wt.ship.branch}
        status={wt.ship.status}
        error={wt.ship.error}
        onClose={wt.ship.close}
        onSubmit={wt.ship.submit}
        onTitleChange={wt.ship.setTitle}
        onBodyChange={wt.ship.setBody}
        onCreatePrChange={wt.ship.setCreatePr}
        onDraftChange={wt.ship.setDraft}
        onOpenPrHub={wt.ship.openPrHub}
        onToast={p.showToast}
      />
      <ShortcutsHelpModal
        locale={p.locale}
        open={p.showShortcuts}
        platform={p.platform}
        composerSendKeyPref={p.composerSendKeyPref}
        shortcutRemaps={p.shortcutRemaps}
        voiceHotkeyEnabled={p.voiceHotkeyEnabled}
        onClose={p.closeShortcuts}
      />
      {p.showProductTutorial ? (
        <Suspense fallback={null}>
          <ProductTutorial
            open={p.showProductTutorial}
            locale={p.locale}
            onClose={p.closeProductTutorial}
            onSkip={p.closeProductTutorial}
            onDone={p.closeProductTutorial}
          />
        </Suspense>
      ) : null}
      {whatsNew.open ? (
        <Suspense fallback={null}>
          <WhatsNewModal
            open={whatsNew.open}
            locale={p.locale}
            version={whatsNew.version}
            notes={whatsNew.notes}
            onClose={whatsNew.close}
          />
        </Suspense>
      ) : null}
      {p.liveVoiceOpen ? (
        <Suspense fallback={null}>
          <VoiceOverlay
            locale={p.voiceLocale}
            open={p.liveVoiceOpen}
            projectPath={p.voiceProjectPath}
            projectId={p.voiceProjectId}
            projectName={p.voiceProjectName}
            voiceId={p.voiceId}
            keepAgentsOnEnd={p.voiceKeepAgentsOnEnd}
            hasActiveSession={p.voiceHasActiveSession}
            hasVoiceAuth={p.voiceHasAuth}
            sessions={p.voiceSessions}
            onClose={p.closeLiveVoice}
            onClassifiedNotice={p.onLiveVoiceClassifiedNotice}
            onSendTranscriptAsPrompt={p.onSendVoiceTranscriptAsPrompt}
            onFocusSession={p.onVoiceFocusSession}
          />
        </Suspense>
      ) : null}
    </>
  );
}
