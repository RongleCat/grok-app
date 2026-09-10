import { describe, expect, it } from "vitest";
import {
  ERROR_BANNER_SETTINGS_ROUTE,
  isErrorBannerDismissOnly,
} from "./errorBannerActions";
import type { ErrorDeckActionId } from "@/lib/errorDeck";

describe("ERROR_BANNER_SETTINGS_ROUTE", () => {
  it("routes every settings-type action to a section", () => {
    expect(ERROR_BANNER_SETTINGS_ROUTE.open_runtime).toEqual({
      section: "runtime",
    });
    expect(ERROR_BANNER_SETTINGS_ROUTE.open_network).toEqual({
      section: "runtime",
      tab: "network",
    });
    expect(ERROR_BANNER_SETTINGS_ROUTE.open_permissions).toEqual({
      section: "general",
      tab: "permissions",
    });
    expect(ERROR_BANNER_SETTINGS_ROUTE.open_providers?.section).toBe(
      "account",
    );
    expect(ERROR_BANNER_SETTINGS_ROUTE.open_extensions?.section).toBe(
      "extensions",
    );
    expect(ERROR_BANNER_SETTINGS_ROUTE.upgrade_cli?.section).toBe("runtime");
  });

  it("does not route verb-type actions (host handles those)", () => {
    const verbs: ErrorDeckActionId[] = [
      "reconnect",
      "open_doctor",
      "open_mcp",
      "trust_project",
      "relocate_project",
      "add_project",
      "cancel_turn",
      "dismiss",
      "keep_waiting",
    ];
    for (const id of verbs) {
      expect(ERROR_BANNER_SETTINGS_ROUTE[id]).toBeUndefined();
    }
  });
});

describe("isErrorBannerDismissOnly", () => {
  it("covers dismiss and the stream-stall keep-waiting prompt", () => {
    expect(isErrorBannerDismissOnly("dismiss")).toBe(true);
    expect(isErrorBannerDismissOnly("keep_waiting")).toBe(true);
    expect(isErrorBannerDismissOnly("reconnect")).toBe(false);
    expect(isErrorBannerDismissOnly("cancel_turn")).toBe(false);
  });
});
