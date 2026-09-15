import { describe, expect, it } from "vitest";
import {
  buildMemoryEmbedPatch,
  describeSearchModes,
  hasMemoryEmbedChanges,
  isEmbeddingConfigured,
  isMemoryEmbedWritable,
  memoryEmbedKeyPresence,
  memoryEmbedToggleChecked,
  parseOptionalNumber,
  toggleMemoryEmbedTri,
  validateMemoryEmbedDraft,
  valuesFromMemoryEmbedSnapshot,
  type MemoryEmbedValues,
} from "./memoryEmbedConfig";

const base: MemoryEmbedValues = {
  embeddingModel: "text-embedding-3-small",
  embeddingDimensions: 1024,
  embeddingProvider: "api",
  embeddingBaseUrl: null,
  embeddingApiKey: null,
  clearEmbeddingApiKey: false,
  hasEmbeddingApiKey: false,
  searchMaxResults: 6,
  searchMinScore: 0.35,
  searchVectorWeight: 0.7,
  searchTextWeight: 0.3,
  mmrEnabled: false,
  mmrLambda: 0.7,
  temporalDecayEnabled: true,
  temporalDecayHalfLifeDays: 7,
  dreamEnabled: true,
  dreamMinHours: 4,
  dreamMinSessions: 3,
  dreamCheckIntervalSecs: null,
  watcherEnabled: true,
  initialInjectionEnabled: true,
  initialInjectionMinScore: 0,
};

describe("valuesFromMemoryEmbedSnapshot", () => {
  it("maps missing keys to null (soft-fail, never invents defaults)", () => {
    expect(valuesFromMemoryEmbedSnapshot({})).toEqual({
      embeddingModel: null,
      embeddingDimensions: null,
      embeddingProvider: null,
      embeddingBaseUrl: null,
      embeddingApiKey: null,
      clearEmbeddingApiKey: false,
      hasEmbeddingApiKey: false,
      searchMaxResults: null,
      searchMinScore: null,
      searchVectorWeight: null,
      searchTextWeight: null,
      mmrEnabled: null,
      mmrLambda: null,
      temporalDecayEnabled: null,
      temporalDecayHalfLifeDays: null,
      dreamEnabled: null,
      dreamMinHours: null,
      dreamMinSessions: null,
      dreamCheckIntervalSecs: null,
      watcherEnabled: null,
      initialInjectionEnabled: null,
      initialInjectionMinScore: null,
    });
    expect(valuesFromMemoryEmbedSnapshot(null).embeddingModel).toBeNull();
  });

  it("maps present values", () => {
    expect(
      valuesFromMemoryEmbedSnapshot({
        embeddingModel: " m ",
        embeddingDimensions: 1024,
        mmrEnabled: false,
        dreamEnabled: true,
      }),
    ).toMatchObject({
      embeddingModel: "m",
      embeddingDimensions: 1024,
      mmrEnabled: false,
      dreamEnabled: true,
    });
  });
});

describe("buildMemoryEmbedPatch", () => {
  it("emits only changed concrete fields", () => {
    const draft: MemoryEmbedValues = {
      ...base,
      mmrEnabled: true,
      searchMinScore: 0.4,
    };
    const patch = buildMemoryEmbedPatch(draft, base);
    expect(patch).toEqual({
      mmrEnabled: true,
      searchMinScore: 0.4,
    });
    expect(hasMemoryEmbedChanges(patch)).toBe(true);
    expect(hasMemoryEmbedChanges(buildMemoryEmbedPatch(base, base))).toBe(
      false,
    );
  });

  it("clears embedding model when draft empties a set baseline", () => {
    const draft: MemoryEmbedValues = { ...base, embeddingModel: null };
    expect(buildMemoryEmbedPatch(draft, base)).toEqual({
      clearEmbeddingModel: true,
    });
  });

  it("sets model when changing from unset", () => {
    const baseline: MemoryEmbedValues = {
      ...valuesFromMemoryEmbedSnapshot({}),
    };
    const draft: MemoryEmbedValues = {
      ...baseline,
      embeddingModel: "text-embedding-3-small",
    };
    expect(buildMemoryEmbedPatch(draft, baseline)).toEqual({
      embeddingModel: "text-embedding-3-small",
    });
  });
});

describe("toggle / presence", () => {
  it("cycles unset → true → false → true", () => {
    expect(toggleMemoryEmbedTri(null)).toBe(true);
    expect(toggleMemoryEmbedTri(true)).toBe(false);
    expect(toggleMemoryEmbedTri(false)).toBe(true);
  });

  it("presence and checked honesty", () => {
    expect(memoryEmbedKeyPresence(null)).toBe("unset");
    expect(memoryEmbedKeyPresence(true)).toBe("set_on");
    expect(memoryEmbedKeyPresence(false)).toBe("set_off");
    expect(memoryEmbedToggleChecked(null)).toBe(false);
    expect(memoryEmbedToggleChecked(true)).toBe(true);
  });
});

describe("embedding status helpers", () => {
  it("isEmbeddingConfigured requires non-empty model", () => {
    expect(isEmbeddingConfigured({})).toBe(false);
    expect(isEmbeddingConfigured({ embeddingModel: "" })).toBe(false);
    expect(isEmbeddingConfigured({ embeddingModel: "m" })).toBe(true);
    expect(isEmbeddingConfigured({ embeddingConfigured: true })).toBe(true);
  });

  it("describeSearchModes is honest about App vs CLI", () => {
    expect(describeSearchModes({})).toEqual({
      app: "keyword",
      cli: "keyword",
    });
    expect(describeSearchModes({ embeddingModel: "m" })).toEqual({
      app: "keyword",
      cli: "hybrid",
    });
    expect(
      describeSearchModes({
        appSearchMode: "keyword",
        cliSearchMode: "hybrid",
        embeddingConfigured: true,
      }),
    ).toEqual({ app: "keyword", cli: "hybrid" });
  });

  it("isMemoryEmbedWritable requires writable flag", () => {
    expect(isMemoryEmbedWritable(undefined)).toBe(false);
    expect(isMemoryEmbedWritable({ writable: false })).toBe(false);
    expect(isMemoryEmbedWritable({ writable: true })).toBe(true);
  });
});

describe("validateMemoryEmbedDraft", () => {
  it("accepts base draft", () => {
    expect(validateMemoryEmbedDraft(base)).toBeNull();
  });

  it("rejects out-of-range numbers", () => {
    expect(
      validateMemoryEmbedDraft({ ...base, embeddingDimensions: 0 }),
    ).toMatch(/dimensions/);
    expect(
      validateMemoryEmbedDraft({ ...base, searchMaxResults: 999 }),
    ).toMatch(/max_results/);
    expect(validateMemoryEmbedDraft({ ...base, mmrLambda: 1.5 })).toMatch(
      /lambda/,
    );
  });
});

describe("parseOptionalNumber", () => {
  it("parses empty as null", () => {
    expect(parseOptionalNumber("")).toBeNull();
    expect(parseOptionalNumber("  ")).toBeNull();
    expect(parseOptionalNumber("0.35")).toBe(0.35);
    expect(parseOptionalNumber("abc")).toBeNull();
  });
});
