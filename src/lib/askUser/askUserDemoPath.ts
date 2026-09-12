/**
 * Ask-user / permission demo path — pure helpers for a recordable
 * Settings checklist that prepares Ask vs YOLO comparison.
 *
 * Honesty boundary:
 * - App only prepares settings + a sample prompt suggestion.
 * - Never claims a live agent/CLI will emit `ask_user_question`.
 * - Sample questionnaire is preview-only UI (not from an agent turn).
 */

import type { MessageKey } from "@/i18n";
import type { PermissionPolicyId } from "../grokCatalog";
import type { AskUserQuestionItem } from "../session";

/** Stable checklist step ids (order is product demo path). */
export type DemoAskChecklistStepId =
  | "policy_ask"
  | "not_yolo"
  | "ask_user_enabled"
  | "sample_prompt";

export type DemoAskChecklistStep = {
  id: DemoAskChecklistStepId;
  /** i18n label for the checklist row. */
  labelKey: MessageKey;
  /** Optional one-line hint under the label. */
  hintKey: MessageKey;
};

/**
 * Suggested path to exercise Ask-user questionnaires vs YOLO.
 * Steps 1–3 are settings gates; step 4 is a soft prompt suggestion only.
 */
export const DEMO_ASK_CHECKLIST: readonly DemoAskChecklistStep[] = [
  {
    id: "policy_ask",
    labelKey: "settings.askDemo.step.policyAsk",
    hintKey: "settings.askDemo.step.policyAskHint",
  },
  {
    id: "not_yolo",
    labelKey: "settings.askDemo.step.notYolo",
    hintKey: "settings.askDemo.step.notYoloHint",
  },
  {
    id: "ask_user_enabled",
    labelKey: "settings.askDemo.step.askUserEnabled",
    hintKey: "settings.askDemo.step.askUserEnabledHint",
  },
  {
    id: "sample_prompt",
    labelKey: "settings.askDemo.step.samplePrompt",
    hintKey: "settings.askDemo.step.samplePromptHint",
  },
] as const;

/** Docs for ask_user_question Host UI (SPIKE-ACP). */
export const DEMO_ASK_DOCS_URL =
  "https://github.com/RongleCat/grok-app/blob/main/docs/SPIKE-ACP.md#_xaiask_user_question-host-ui";

/** Settings snapshot used by checklist / blockers. */
export type DemoPathState = {
  /** App permission policy id (ask / always_approve / …). */
  policy?: string | null;
  /** Global `--no-ask-user` setting (true = questionnaires disabled). */
  noAskUser?: boolean | null;
  /**
   * Explicit YOLO / always-approve override.
   * When omitted, derived from `policy === "always_approve"`.
   */
  yolo?: boolean | null;
};

export type DemoPathBlockerId =
  | "policy_not_ask"
  | "yolo_on"
  | "no_ask_user";

export type DemoPathBlocker = {
  id: DemoPathBlockerId;
  messageKey: MessageKey;
};

export type DemoChecklistEval = DemoAskChecklistStep & {
  /** True when this step is currently satisfied (or ready for sample prompt). */
  pass: boolean;
};

/** Recommended policy for the demo path (product Ask mode). */
export function planDemoPermissionPolicy(): PermissionPolicyId {
  return "ask";
}

/**
 * Short English sample user prompt that tends to invite clarification.
 * Honest suggestion text only — paste yourself; App never auto-sends.
 */
export function buildDemoAskPrompt(): string {
  return (
    "I need to change something in this project but I'm unsure of the best approach. " +
    "Before proposing a plan or editing files, please ask me clarifying questions " +
    "(goal, constraints, preferred stack, and risk tolerance)."
  );
}

/**
 * Whether YOLO / always-approve is effectively on for the demo path.
 * Explicit `yolo: true` wins; otherwise policy `always_approve` (or alias `yolo`).
 */
export function isDemoYoloActive(input: DemoPathState): boolean {
  if (input.yolo === true) return true;
  if (input.yolo === false) {
    // Explicit off still loses to stored always_approve policy.
    const p = (input.policy ?? "").trim();
    return p === "always_approve" || /^yolo$/i.test(p);
  }
  const p = (input.policy ?? "").trim();
  return p === "always_approve" || /^yolo$/i.test(p);
}

function normalizePolicy(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/**
 * Settings blockers that prevent a clean Ask-user demo path.
 * Empty list ⇒ settings gates look ready (still not a guarantee of live ask).
 */
export function resolveDemoPathBlockers(
  input: DemoPathState,
): DemoPathBlocker[] {
  const blockers: DemoPathBlocker[] = [];
  const policy = normalizePolicy(input.policy);
  const yolo = isDemoYoloActive(input);

  if (policy !== "ask") {
    blockers.push({
      id: "policy_not_ask",
      messageKey: "settings.askDemo.blocker.policy",
    });
  }
  if (yolo) {
    blockers.push({
      id: "yolo_on",
      messageKey: "settings.askDemo.blocker.yolo",
    });
  }
  if (input.noAskUser === true) {
    blockers.push({
      id: "no_ask_user",
      messageKey: "settings.askDemo.blocker.noAskUser",
    });
  }
  return blockers;
}

/** True when settings gates (policy Ask, not YOLO, ask-user enabled) pass. */
export function isDemoPathSettingsReady(input: DemoPathState): boolean {
  return resolveDemoPathBlockers(input).length === 0;
}

/**
 * Evaluate each checklist step against current settings.
 * `sample_prompt` is "ready" only when settings gates pass — still a suggestion,
 * never proof that an agent will ask.
 */
export function evaluateDemoAskChecklist(
  input: DemoPathState,
): DemoChecklistEval[] {
  const policy = normalizePolicy(input.policy);
  const yolo = isDemoYoloActive(input);
  const askUserOn = input.noAskUser !== true;
  const settingsReady = isDemoPathSettingsReady(input);

  return DEMO_ASK_CHECKLIST.map((step): DemoChecklistEval => {
    switch (step.id) {
      case "policy_ask":
        return { ...step, pass: policy === "ask" };
      case "not_yolo":
        return { ...step, pass: !yolo };
      case "ask_user_enabled":
        return { ...step, pass: askUserOn };
      case "sample_prompt":
        return { ...step, pass: settingsReady };
      default: {
        const _exhaustive: never = step.id;
        void _exhaustive;
        return { ...step, pass: false };
      }
    }
  });
}

/**
 * Static sample questionnaire for **preview-only** UI.
 * Clearly demo content — not produced by a live agent turn.
 */
export function buildSampleAskUserQuestions(): AskUserQuestionItem[] {
  return [
    {
      id: "demo_goal",
      question:
        "[Demo preview] What is the primary goal for this change? (Not from the agent.)",
      multiSelect: false,
      options: [
        {
          id: "ship_fix",
          label: "Ship a fix",
          description: "Small, low-risk change to production behavior.",
        },
        {
          id: "explore",
          label: "Explore options",
          description: "Compare approaches before deciding.",
        },
        {
          id: "refactor",
          label: "Refactor structure",
          description: "Improve maintainability without new features.",
        },
      ],
    },
    {
      id: "demo_constraints",
      question:
        "[Demo preview] Which constraints matter most? (Select any that apply — demo only.)",
      multiSelect: true,
      options: [
        {
          id: "no_breaking",
          label: "No breaking API changes",
          description: "Keep public surfaces stable.",
        },
        {
          id: "tests",
          label: "Keep / add tests",
          description: "Prefer changes covered by unit tests.",
        },
        {
          id: "minimal_diff",
          label: "Minimal diff",
          description: "Smallest change that works.",
        },
      ],
    },
  ];
}

/** Build a preview-only AskUserPayload-shaped object for the modal. */
export function buildSampleAskUserPayload(sessionId = "demo-preview"): {
  rpcId: number;
  sessionId: string;
  toolCallId: null;
  questions: AskUserQuestionItem[];
} {
  return {
    rpcId: -1,
    sessionId,
    toolCallId: null,
    questions: buildSampleAskUserQuestions(),
  };
}
