import { describe, expect, it } from "vitest";
import {
  isImportableAgentSessionId,
  planCallLogImport,
  runCallLogImport,
  shouldAutoAddProjectPath,
  shouldShowSidebarCliImportCta,
} from "./cliSessionCallLogImport";

describe("isImportableAgentSessionId", () => {
  it("accepts a CLI agent folder id", () => {
    expect(
      isImportableAgentSessionId("01a00c5e-99ad-7a61-9705-a91342da1a03"),
    ).toBe(true);
  });

  it("rejects empty, traversal, and path-shaped ids", () => {
    expect(isImportableAgentSessionId("")).toBe(false);
    expect(isImportableAgentSessionId("   ")).toBe(false);
    expect(isImportableAgentSessionId(null)).toBe(false);
    expect(isImportableAgentSessionId(".")).toBe(false);
    expect(isImportableAgentSessionId("..")).toBe(false);
    expect(isImportableAgentSessionId("../secret")).toBe(false);
    expect(isImportableAgentSessionId("a/b")).toBe(false);
    expect(isImportableAgentSessionId("a\\b")).toBe(false);
  });
});

describe("planCallLogImport", () => {
  const rows = [
    { id: "aaa-1", title: "prax-daily" },
    { id: "bbb-2", title: "money-manager" },
    { id: "aaa-1", title: "dup" },
    { id: "../nope", title: "bad" },
    { id: "ccc-3", title: "already" },
  ];

  it("dedupes, skips invalid, skips linked, keeps first-seen order", () => {
    const plan = planCallLogImport(rows, ["ccc-3"]);
    expect(plan.ids).toEqual(["aaa-1", "bbb-2"]);
    expect(plan.importable).toBe(2);
    expect(plan.skippedDuplicate).toBe(1);
    expect(plan.skippedInvalid).toBe(1);
    expect(plan.skippedLinked).toBe(1);
    expect(plan.selected).toBe(5);
    expect(plan.hasImportable).toBe(true);
  });

  it("does not invent ids from an empty or null list", () => {
    expect(planCallLogImport(null).ids).toEqual([]);
    expect(planCallLogImport([]).hasImportable).toBe(false);
  });

  it("runCallLogImport keeps going after one failure", async () => {
    const plan = planCallLogImport([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const result = await runCallLogImport(plan, async (id) => {
      if (id === "b") throw new Error("nope");
      return { id: `app-${id}` };
    });
    expect(result.imported.map((r) => r.id)).toEqual(["app-a", "app-c"]);
    expect(result.failed).toBe(1);
  });
});

describe("shouldShowSidebarCliImportCta", () => {
  it("shows when CLI logs exist and the sidebar is empty or has one chat", () => {
    expect(
      shouldShowSidebarCliImportCta({
        unarchivedAppSessionCount: 0,
        callLogCount: 6,
      }),
    ).toBe(true);
    expect(
      shouldShowSidebarCliImportCta({
        unarchivedAppSessionCount: 1,
        callLogCount: 6,
      }),
    ).toBe(true);
  });

  it("hides when there are no call logs (never invents CLI sessions)", () => {
    expect(
      shouldShowSidebarCliImportCta({
        unarchivedAppSessionCount: 0,
        callLogCount: 0,
      }),
    ).toBe(false);
  });

  it("hides once the sidebar already has several App chats", () => {
    expect(
      shouldShowSidebarCliImportCta({
        unarchivedAppSessionCount: 4,
        callLogCount: 6,
      }),
    ).toBe(false);
  });
});

describe("shouldAutoAddProjectPath", () => {
  const home = "/Users/prax";

  it("adds real project folders", () => {
    expect(
      shouldAutoAddProjectPath(
        "/Users/prax/Developer/money-manager-reverse-engineering",
        home,
      ),
    ).toBe(true);
    expect(
      shouldAutoAddProjectPath(
        "/Users/prax/Developer/PraxAutomations/prax-daily",
        home,
      ),
    ).toBe(true);
  });

  it("skips home, roots, and shallow paths", () => {
    expect(shouldAutoAddProjectPath("/", home)).toBe(false);
    expect(shouldAutoAddProjectPath("/Users/prax", home)).toBe(false);
    expect(shouldAutoAddProjectPath("/Users/prax/Developer", home)).toBe(false);
    expect(shouldAutoAddProjectPath("C:\\", "C:\\Users\\prax")).toBe(false);
    expect(shouldAutoAddProjectPath("", home)).toBe(false);
    expect(shouldAutoAddProjectPath(null, home)).toBe(false);
  });
});
