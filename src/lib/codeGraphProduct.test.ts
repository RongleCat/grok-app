import { describe, expect, it } from "vitest";
import {
  CODEBASE_INDEXING_MIN_CLI,
  CODE_GRAPH_INDEXING_ANCHOR,
  CODE_GRAPH_SEARCH_ANCHOR,
  HOST_CODE_GRAPH_REBUILD_AVAILABLE,
  HOST_CODE_GRAPH_SEARCH_AVAILABLE,
  annotateSearchHits,
  buildCodeGraphStatusChips,
  codeGraphAppSearchRemainsKeywordKey,
  codeGraphModeStatusKey,
  codeGraphStatusChipLabelKey,
  planCodeGraphRebuild,
  resolveCodeGraphEmptyState,
  resolveCodeGraphMode,
} from "./codeGraphProduct";

describe("HOST_CODE_GRAPH_*_AVAILABLE", () => {
  it("is false until real host APIs land (no invented graph/rebuild)", () => {
    expect(HOST_CODE_GRAPH_SEARCH_AVAILABLE).toBe(false);
    expect(HOST_CODE_GRAPH_REBUILD_AVAILABLE).toBe(false);
  });
});

describe("resolveCodeGraphMode", () => {
  it("returns cli_old when CLI is known older", () => {
    expect(resolveCodeGraphMode({ cliOld: true })).toBe("cli_old");
    expect(
      resolveCodeGraphMode({
        cliOld: true,
        indexingEnabled: true,
        indexingKind: "bool",
      }),
    ).toBe("cli_old");
  });

  it("returns unset_default_on when key is missing", () => {
    expect(resolveCodeGraphMode({})).toBe("unset_default_on");
    expect(
      resolveCodeGraphMode({ indexingEnabled: null, indexingKind: "unset" }),
    ).toBe("unset_default_on");
    expect(resolveCodeGraphMode({ indexingKind: "unset" })).toBe(
      "unset_default_on",
    );
  });

  it("returns keyword_only when indexing is set off", () => {
    expect(
      resolveCodeGraphMode({
        indexingEnabled: false,
        indexingKind: "bool",
      }),
    ).toBe("keyword_only");
  });

  it("returns graph_unavailable when indexing on but App has no graph search", () => {
    expect(
      resolveCodeGraphMode({
        indexingEnabled: true,
        indexingKind: "bool",
      }),
    ).toBe("graph_unavailable");
    expect(
      resolveCodeGraphMode({
        indexingEnabled: null,
        indexingKind: "custom",
        searchKind: "keyword",
      }),
    ).toBe("graph_unavailable");
    // Even if searchKind claims graph, without host API never invent graph mode as ready
    expect(
      resolveCodeGraphMode({
        indexingEnabled: true,
        indexingKind: "bool",
        searchKind: "graph",
      }),
    ).toBe("graph_unavailable");
  });

  it("returns graph_enabled_unknown only when host graph search exists", () => {
    expect(
      resolveCodeGraphMode({
        indexingEnabled: true,
        indexingKind: "bool",
        hostGraphSearchAvailable: true,
        searchKind: "graph",
      }),
    ).toBe("graph_enabled_unknown");
    expect(
      resolveCodeGraphMode({
        indexingEnabled: true,
        indexingKind: "bool",
        hostGraphSearchAvailable: true,
        searchKind: "keyword",
      }),
    ).toBe("graph_enabled_unknown");
  });

  it("never treats App search as graph-ready without host flag", () => {
    const mode = resolveCodeGraphMode({
      indexingEnabled: true,
      searchKind: "embedding",
    });
    expect(mode).not.toBe("graph_enabled_unknown");
    expect(["graph_unavailable", "keyword_only", "unset_default_on"]).toContain(
      mode,
    );
  });
});

describe("buildCodeGraphStatusChips", () => {
  it("always includes app_keyword and no_embeddings", () => {
    for (const mode of [
      "keyword_only",
      "graph_enabled_unknown",
      "graph_unavailable",
      "cli_old",
      "unset_default_on",
    ] as const) {
      const chips = buildCodeGraphStatusChips(mode);
      expect(chips[0]).toBe("app_keyword");
      expect(chips[chips.length - 1]).toBe("no_embeddings");
    }
  });

  it("adds mode-specific chips", () => {
    expect(buildCodeGraphStatusChips("cli_old")).toEqual([
      "app_keyword",
      "cli_old",
      "no_embeddings",
    ]);
    expect(buildCodeGraphStatusChips("unset_default_on")).toEqual([
      "app_keyword",
      "cli_graph_default_on",
      "no_embeddings",
    ]);
    expect(buildCodeGraphStatusChips("keyword_only")).toEqual([
      "app_keyword",
      "keyword_only",
      "no_embeddings",
    ]);
    expect(buildCodeGraphStatusChips("graph_enabled_unknown")).toEqual([
      "app_keyword",
      "cli_graph",
      "no_embeddings",
    ]);
    expect(buildCodeGraphStatusChips("graph_unavailable")).toEqual([
      "app_keyword",
      "cli_graph",
      "graph_unavailable",
      "no_embeddings",
    ]);
  });
});

describe("annotateSearchHits", () => {
  const baseHits = [
    {
      path: "/p/a.ts",
      name: "a.ts",
      relativePath: "a.ts",
      size: 1,
      mtimeMs: 0,
      snippet: "foo",
      contentMatch: true,
    },
    {
      path: "/p/b.ts",
      name: "b.ts",
      relativePath: "b.ts",
      size: 2,
      mtimeMs: 0,
      snippet: "",
      contentMatch: false,
    },
  ];

  it("labels every hit as keyword (never invents graph)", () => {
    for (const mode of [
      "keyword_only",
      "graph_enabled_unknown",
      "graph_unavailable",
      "cli_old",
      "unset_default_on",
    ] as const) {
      const out = annotateSearchHits(baseHits, mode);
      expect(out).toHaveLength(2);
      for (const h of out) {
        expect(h.source).toBe("keyword");
        expect(h.source).not.toBe("graph");
      }
    }
  });

  it("strips invented graph/embedding source labels", () => {
    const poisoned = [
      { ...baseHits[0], source: "graph" as string },
      { ...baseHits[1], source: "embedding" as string },
    ];
    const out = annotateSearchHits(poisoned, "graph_enabled_unknown");
    expect(out.every((h) => h.source === "keyword")).toBe(true);
  });

  it("preserves honest keyword/unknown when already set", () => {
    const mixed = [
      { ...baseHits[0], source: "keyword" as const },
      { ...baseHits[1], source: "unknown" as const },
    ];
    const out = annotateSearchHits(mixed, "graph_unavailable");
    expect(out[0].source).toBe("keyword");
    expect(out[1].source).toBe("unknown");
  });

  it("handles null/empty hits", () => {
    expect(annotateSearchHits(null, "keyword_only")).toEqual([]);
    expect(annotateSearchHits(undefined, "keyword_only")).toEqual([]);
    expect(annotateSearchHits([], "keyword_only")).toEqual([]);
  });
});

describe("resolveCodeGraphEmptyState", () => {
  it("maps mode honesty for indexing surface", () => {
    expect(resolveCodeGraphEmptyState({ mode: "cli_old" }).kind).toBe(
      "cli_old",
    );
    expect(resolveCodeGraphEmptyState({ mode: "unset_default_on" }).kind).toBe(
      "unset_default_on",
    );
    expect(resolveCodeGraphEmptyState({ mode: "keyword_only" }).kind).toBe(
      "keyword_only",
    );
    expect(
      resolveCodeGraphEmptyState({ mode: "graph_unavailable" }).kind,
    ).toBe("graph_unavailable");
    expect(
      resolveCodeGraphEmptyState({ mode: "graph_enabled_unknown" }).kind,
    ).toBe("graph_enabled_unknown");
  });

  it("search panel never invents graph empty when only keyword ran", () => {
    const idle = resolveCodeGraphEmptyState({
      mode: "graph_unavailable",
      forSearchPanel: true,
      query: "",
      hitCount: 0,
    });
    expect(idle.kind).toBe("search_keyword_idle");
    expect(idle.titleKey).toContain("searchKeywordIdle");

    const noMatch = resolveCodeGraphEmptyState({
      mode: "graph_enabled_unknown",
      forSearchPanel: true,
      query: "zzz",
      hitCount: 0,
      searching: false,
    });
    expect(noMatch.kind).toBe("search_no_matches");
    expect(noMatch.hintKey).toBe(
      "settings.codeGraph.empty.searchNoMatchesHint",
    );
  });
});

describe("planCodeGraphRebuild", () => {
  it("returns unavailable when host rebuild does not exist", () => {
    const plan = planCodeGraphRebuild();
    expect(plan.status).toBe("unavailable");
    if (plan.status === "unavailable") {
      expect(plan.noteKey).toBe("settings.codeGraph.rebuild.unavailableNote");
      expect(plan.cliHintKey).toBe("settings.codeGraph.rebuild.cliHint");
    }
  });

  it("returns available only when host flag + command provided", () => {
    const plan = planCodeGraphRebuild({
      hostRebuildAvailable: true,
      hostCommand: "codebase_graph_rebuild",
    });
    expect(plan.status).toBe("available");
    if (plan.status === "available") {
      expect(plan.hostCommand).toBe("codebase_graph_rebuild");
    }

    // Host flag without command still unavailable (no invented path)
    expect(
      planCodeGraphRebuild({ hostRebuildAvailable: true }).status,
    ).toBe("unavailable");
  });
});

describe("label / status keys + anchors", () => {
  it("maps chip and mode keys", () => {
    expect(codeGraphStatusChipLabelKey("app_keyword")).toBe(
      "settings.codeGraph.chip.appKeyword",
    );
    expect(codeGraphStatusChipLabelKey("cli_graph")).toBe(
      "settings.codeGraph.chip.cliGraph",
    );
    expect(codeGraphStatusChipLabelKey("cli_graph_default_on")).toBe(
      "settings.codeGraph.chip.cliGraphDefaultOn",
    );
    expect(codeGraphStatusChipLabelKey("graph_unavailable")).toBe(
      "settings.codeGraph.chip.graphUnavailable",
    );
    expect(codeGraphStatusChipLabelKey("keyword_only")).toBe(
      "settings.codeGraph.chip.keywordOnly",
    );
    expect(codeGraphStatusChipLabelKey("cli_old")).toBe(
      "settings.codeGraph.chip.cliOld",
    );
    expect(codeGraphStatusChipLabelKey("no_embeddings")).toBe(
      "settings.codeGraph.chip.noEmbeddings",
    );
    expect(codeGraphModeStatusKey("keyword_only")).toBe(
      "settings.codeGraph.mode.keywordOnly",
    );
    expect(codeGraphModeStatusKey("graph_unavailable")).toBe(
      "settings.codeGraph.mode.graphUnavailable",
    );
    expect(codeGraphModeStatusKey("cli_old")).toBe(
      "settings.codeGraph.mode.cliOld",
    );
    expect(codeGraphModeStatusKey("unset_default_on")).toBe(
      "settings.codeGraph.mode.unsetDefaultOn",
    );
    expect(codeGraphModeStatusKey("graph_enabled_unknown")).toBe(
      "settings.codeGraph.mode.graphEnabledUnknown",
    );
    expect(codeGraphAppSearchRemainsKeywordKey()).toBe(
      "settings.codeGraph.appSearchRemainsKeyword",
    );
  });

  it("exports stable deep-link anchors + min CLI", () => {
    expect(CODE_GRAPH_INDEXING_ANCHOR).toBe("settings-anchor-codebaseIndexing");
    expect(CODE_GRAPH_SEARCH_ANCHOR).toBe("settings-anchor-codebaseSearch");
    expect(CODEBASE_INDEXING_MIN_CLI).toBe("0.2.117");
  });
});
