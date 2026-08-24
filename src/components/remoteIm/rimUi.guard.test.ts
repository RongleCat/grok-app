/**
 * Structural guard: Remote IM UI must not use native checkbox/radio/select.
 * Project chrome only: Select, ui-check, ext-switch, settings-seg.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

const FILES = [
  "RemoteImChannelPanel.tsx",
  "RemoteImLayout.tsx",
  "RemoteImOverview.tsx",
  "remoteIm/RimControls.tsx",
];

describe("Remote IM UI chrome guard", () => {
  for (const rel of FILES) {
    it(`${rel} avoids native checkbox/radio/select`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).not.toMatch(/type=["']checkbox["']/);
      expect(src).not.toMatch(/type=["']radio["']/);
      expect(src).not.toMatch(/<select[\s>]/);
      // Must not use our earlier ad-hoc rim-switch/rim-radio labels for native
      expect(src).not.toMatch(/rim-switch/);
      expect(src).not.toMatch(/rim-radio/);
    });
  }

  it("RimControls reuses shared ui-check + ext-switch controls", () => {
    const src = readFileSync(join(ROOT, "remoteIm/RimControls.tsx"), "utf8");
    expect(src).toContain("UiSwitch as RimSwitch");
    expect(src).toContain("UiCheck as RimCheck");
    expect(src).toContain('from "@/components/settings/shared"');
  });

  it("ChannelPanel uses settings chrome and shared Select/SegmentedControl", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("settings-card");
    expect(src).toContain("settings-row");
    expect(src).toContain("settings-input");
    expect(src).toContain("RimCheck");
    expect(src).toContain("RimSwitch");
    expect(src).toContain("<Select");
    expect(src).toContain("<SegmentedControl");
    expect(src).toContain("showsPublicUrlCallout");
  });

  it("ChannelPanel secrets use RimSecretField (masked by default)", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("RimSecretField");
    expect(src).toContain("classifyChannelHealth");
    expect(src).toContain("channelHasDeepHealth");
  });

  it("ChannelPanel Feishu/Lark guide + draft health without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-feishu-guide");
    expect(src).toContain("draftOptions");
    expect(src).toContain("validateFeishuConfig");
    expect(src).not.toMatch(/window\.confirm/);
    expect(src).not.toMatch(/window\.alert/);
    expect(src).not.toMatch(/window\.prompt/);
  });

  it("Overview has local event timeline without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImOverview.tsx"), "utf8");
    expect(src).toContain("loadRimEventTimeline");
    expect(src).toContain("clearRimEventTimeline");
    expect(src).toContain("GlassModal");
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("Overview resilience honesty: reconnect + soft-fail empties + rate notes", () => {
    const src = readFileSync(join(ROOT, "RemoteImOverview.tsx"), "utf8");
    expect(src).toContain("classifyRecoveryStatus");
    expect(src).toContain("planBridgeReconnectAction");
    expect(src).toContain("classifyChannelsEmptyState");
    expect(src).toContain("classifyTimelineEmptyState");
    expect(src).toContain("displayBridgeLastError");
    expect(src).toContain("shouldShowResilienceHonestyNotes");
    expect(src).toContain("rateLimitPolicyFacts");
    expect(src).toContain('data-rim-reconnect="1"');
    expect(src).toContain('data-rim-resilience-notes="1"');
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("Overview security ops checklist without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImOverview.tsx"), "utf8");
    expect(src).toContain("buildRemoteSecurityChecklist");
    expect(src).toContain("formatRemoteSecuritySummaryText");
    expect(src).toContain("data-rim-security-risk");
    expect(src).toContain("yoloConfirm");
    expect(src).not.toMatch(/window\.confirm/);
    expect(src).not.toMatch(/window\.alert/);
    expect(src).not.toMatch(/window\.prompt/);
  });

  it("RimControls exports RimSecretField", () => {
    const src = readFileSync(join(ROOT, "remoteIm/RimControls.tsx"), "utf8");
    expect(src).toContain("export function RimSecretField");
    expect(src).toContain('type={revealed ? "text" : "password"}');
  });

  it("ChannelPanel Discord guide + intent callout without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-discord-guide");
    expect(src).toContain("data-discord-intent");
    expect(src).toContain('channelId === "discord"');
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("ChannelPanel QQ OneBot guide + risk callout without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-qq-guide");
    expect(src).toContain("data-qq-risk");
    expect(src).toContain('channelId === "qq"');
    // Schema-driven bind validation (channel packs live under lib/remoteIm/*Config)
    expect(src).toContain("validateBindFields");
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("ChannelPanel Matrix guide without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-matrix-guide");
    expect(src).toContain('channelId === "matrix"');
    // Matrix secrets go through RimSecretField + schema secret keys (not a local accessTokenValue)
    expect(src).toContain("RimSecretField");
    expect(src).toContain("secretFormValue");
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("ChannelPanel Weibo guide + paste-first bind without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-weibo-guide");
    expect(src).toContain("validateWeiboConfig");
    expect(src).toContain('channelId === "weibo"');
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("ChannelPanel QQ official bot guide + intents callout without window.confirm", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-qqbot-guide");
    expect(src).toContain("data-qqbot-intents");
    expect(src).toContain('channelId === "qqbot"');
    expect(src).not.toMatch(/window\.confirm/);
  });

  it("ChannelPanel CN channels: guides + weixin presenter lock + no native chrome", () => {
    const src = readFileSync(join(ROOT, "RemoteImChannelPanel.tsx"), "utf8");
    expect(src).toContain("data-dingtalk-guide");
    expect(src).toContain("data-wecom-guide");
    expect(src).toContain("data-weixin-guide");
    expect(src).toContain("data-weixin-presenter-locked");
    expect(src).toContain("resolvePresenterForChannel");
    expect(src).toContain("isPresenterLocked");
    expect(src).not.toMatch(/window\.confirm/);
  });
});
