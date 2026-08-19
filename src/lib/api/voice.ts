/** API domain: voice */

import {
  invoke,
} from "./host";

export interface VoiceSessionState {
  active: boolean;
  mode?: string;
  phase?: string | null;
  sessionId?: string | null;
  projectPath?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  error?: string | null;
  delegatedSessionIds?: string[];
  mock?: boolean;
  listening?: boolean;
  speaking?: boolean;
  /** Host: model / tool turn in progress (from voice://state). */
  thinking?: boolean;
  /** Host: in-flight Build tool name while voice → agent loop runs. */
  activeTool?: string | null;
  /**
   * Host tool-loop status token:
   * tool_running | permission_pending | completed | soft_fail | error.
   */
  toolStatus?: string | null;
  /** When true (default), ending voice does not stop delegated Build agents. */
  keepAgentsOnEnd?: boolean;
}

export async function voiceState(): Promise<VoiceSessionState> {
  return invoke<VoiceSessionState>("voice_state");
}

export async function voiceStart(opts?: {
  voiceId?: string | null;
  projectPath?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  keepAgentsOnEnd?: boolean;
}): Promise<VoiceSessionState> {
  return invoke<VoiceSessionState>("voice_start", {
    voiceId: opts?.voiceId ?? null,
    projectPath: opts?.projectPath ?? null,
    projectId: opts?.projectId ?? null,
    projectName: opts?.projectName ?? null,
    keepAgentsOnEnd: opts?.keepAgentsOnEnd ?? true,
  });
}

export async function voiceStop(): Promise<VoiceSessionState> {
  return invoke<VoiceSessionState>("voice_stop");
}

export async function voicePushPcm(pcmBase64: string): Promise<void> {
  return invoke<void>("voice_push_pcm", { pcmBase64 });
}

/**
 * Invoke a Live Voice host tool (mock / debug / demo delegate).
 * Host expects `argsJson` string; objects are serialized.
 */
export async function voiceInvokeTool(
  name: string,
  args?: string | Record<string, unknown> | null,
): Promise<unknown> {
  const argsJson =
    typeof args === "string"
      ? args
      : JSON.stringify(args ?? {});
  return invoke<unknown>("voice_invoke_tool", { name, argsJson });
}


/** Headless `--output-format streaming-messages-json` probe (CLI 0.2.117+). */
export type StreamingMessagesJsonProbeResult = {
  ok: boolean;
  reason: string;
  cliPath?: string | null;
  cliVersion?: string | null;
  versionSupported?: boolean | null;
  minVersion: string;
  outputPath?: string | null;
  rawNdjson?: string | null;
  lineCount: number;
  durationMs: number;
  includePartial: boolean;
  truncated: boolean;
};

/**
 * Spawn a short headless probe with `--output-format streaming-messages-json`.
 * Soft-fails when CLI is missing or older than 0.2.117 (no crash).
 */
export async function streamingMessagesJsonProbe(opts?: {
  includePartial?: boolean;
}): Promise<StreamingMessagesJsonProbeResult> {
  return invoke<StreamingMessagesJsonProbeResult>(
    "streaming_messages_json_probe",
    { includePartial: opts?.includePartial ?? false },
  );
}

/** One-shot headless batch turn result (Host soft-fail DTO). */
export type BatchAgentsHeadlessResult = {
  ok: boolean;
  reason?: string | null;
  text?: string | null;
  durationMs?: number | null;
  cliPath?: string | null;
  cliVersion?: string | null;
};

/**
 * Run one headless `grok -p` turn in a project cwd for multi-project batch.
 * Soft-fails (ok=false + reason) on CLI missing / path / timeout — never throws
 * for those cases. Invoke errors still reject.
 */
export async function batchAgentsHeadless(opts: {
  projectPath: string;
  prompt: string;
  timeoutMs?: number | null;
}): Promise<BatchAgentsHeadlessResult> {
  return invoke<BatchAgentsHeadlessResult>("batch_agents_headless", {
    projectPath: opts.projectPath,
    prompt: opts.prompt,
    timeoutMs: opts.timeoutMs ?? null,
  });
}

export type VoiceStatusDto = {
  available: boolean;
  reason?: string | null;
  authSource?: string | null;
};

export type VoiceTranscribeResult = {
  ok: boolean;
  text?: string | null;
  error?: string | null;
  errorClass?: string | null;
};

export async function voiceStatus() {
  return invoke<VoiceStatusDto>("voice_status");
}

export async function voiceTranscribe(opts: {
  audioBase64: string;
  filename?: string | null;
  mime?: string | null;
  /** Resolved UI locale (en/zh/zh-TW) steering the Chinese language hint. */
  locale?: string | null;
}) {
  return invoke<VoiceTranscribeResult>("voice_transcribe", {
    audioBase64: opts.audioBase64,
    filename: opts.filename ?? null,
    mime: opts.mime ?? null,
    locale: opts.locale ?? null,
  });
}


