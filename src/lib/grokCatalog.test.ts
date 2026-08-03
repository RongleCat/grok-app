import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFORT,
  GROK_BUILD_EFFORTS,
  effortDisplayLabel,
  effortUiOptionsForCatalog,
  effortsForModel,
  isValidEffort,
  mapEffortToTargetCatalog,
  pickDefaultEffort,
  spawnIdToEffortUiSlot,
  type EffortOption,
  type ModelOption,
} from "./grokCatalog";

const modelWithEfforts: ModelOption = {
  id: "grok-4.5",
  label: "Grok 4.5",
  reasoningEfforts: [
    {
      id: "high",
      value: "high",
      label: "High Effort",
      description: "Deep",
      isDefault: true,
    },
    {
      id: "medium",
      value: "medium",
      label: "Medium Effort",
      isDefault: false,
    },
    {
      id: "low",
      value: "low",
      label: "Low Effort",
      isDefault: false,
    },
  ],
};

const modelCustomOnly: ModelOption = {
  id: "custom-model",
  label: "Custom",
  reasoningEfforts: [
    { id: "max", value: "max", label: "Max", isDefault: true },
    { id: "min", value: "min", label: "Min" },
  ],
};

describe("effortsForModel", () => {
  it("returns static fallback when model has no efforts", () => {
    expect(effortsForModel({ id: "x", label: "X" })).toEqual(
      GROK_BUILD_EFFORTS,
    );
    expect(effortsForModel(null)).toEqual(GROK_BUILD_EFFORTS);
    expect(effortsForModel(undefined)).toEqual(GROK_BUILD_EFFORTS);
  });

  it("returns model efforts when non-empty", () => {
    const list = effortsForModel(modelWithEfforts);
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("high");
    expect(list[0].label).toBe("High Effort");
  });

  it("prefers explicit catalogEfforts arg over model", () => {
    const override = [{ id: "only" }];
    expect(effortsForModel(modelWithEfforts, override)).toEqual(override);
  });
});

describe("isValidEffort", () => {
  it("accepts static low/medium/high without model", () => {
    expect(isValidEffort("low")).toBe(true);
    expect(isValidEffort("medium")).toBe(true);
    expect(isValidEffort("high")).toBe(true);
    expect(isValidEffort("max")).toBe(false);
    expect(isValidEffort("")).toBe(false);
  });

  it("accepts efforts for the selected model when known", () => {
    expect(isValidEffort("high", modelWithEfforts)).toBe(true);
    expect(isValidEffort("max", modelCustomOnly)).toBe(true);
    expect(isValidEffort("min", modelCustomOnly)).toBe(true);
    expect(isValidEffort("medium", modelCustomOnly)).toBe(false);
  });

  it("accepts an efforts array directly", () => {
    expect(isValidEffort("max", modelCustomOnly.reasoningEfforts)).toBe(true);
    expect(isValidEffort("high", modelCustomOnly.reasoningEfforts)).toBe(
      false,
    );
  });
});

describe("pickDefaultEffort", () => {
  it("uses model default flag when present", () => {
    expect(pickDefaultEffort(modelWithEfforts)).toBe("high");
    expect(pickDefaultEffort(modelCustomOnly)).toBe("max");
  });

  it("falls back to medium static default", () => {
    expect(pickDefaultEffort(null)).toBe(DEFAULT_EFFORT);
    expect(pickDefaultEffort({ id: "x", label: "X" })).toBe("medium");
  });
});

describe("effort UI ladder", () => {
  const deepseek: EffortOption[] = [
    { id: "low" },
    { id: "high" },
    { id: "xhigh" },
    { id: "max" },
  ];

  it("orders Grok as 低/中/高 without 极高", () => {
    expect(effortUiOptionsForCatalog(GROK_BUILD_EFFORTS).map((o) => o.uiId)).toEqual(
      ["low", "medium", "high"],
    );
    expect(
      effortUiOptionsForCatalog(GROK_BUILD_EFFORTS).map((o) => o.spawnId),
    ).toEqual(["low", "medium", "high"]);
  });

  it("orders DeepSeek as 低/中/高/极高 with real spawn ids", () => {
    const opts = effortUiOptionsForCatalog(deepseek);
    expect(opts.map((o) => o.uiId)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(opts.map((o) => o.spawnId)).toEqual([
      "low",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("maps spawn ids onto UI slots", () => {
    expect(spawnIdToEffortUiSlot("high", deepseek)).toBe("medium");
    expect(spawnIdToEffortUiSlot("xhigh", deepseek)).toBe("high");
    expect(spawnIdToEffortUiSlot("max", deepseek)).toBe("xhigh");
    expect(spawnIdToEffortUiSlot("medium", GROK_BUILD_EFFORTS)).toBe("medium");
  });

  it("maps DeepSeek 4-tier onto Grok 3-tier via ladder", () => {
    expect(
      mapEffortToTargetCatalog("low", GROK_BUILD_EFFORTS, deepseek),
    ).toBe("low");
    expect(
      mapEffortToTargetCatalog("high", GROK_BUILD_EFFORTS, deepseek),
    ).toBe("medium");
    expect(
      mapEffortToTargetCatalog("xhigh", GROK_BUILD_EFFORTS, deepseek),
    ).toBe("high");
    // 极高 clamps to 高 on 3-tier
    expect(
      mapEffortToTargetCatalog("max", GROK_BUILD_EFFORTS, deepseek),
    ).toBe("high");
  });

  it("maps Grok 3-tier onto DeepSeek 4-tier via ladder", () => {
    expect(mapEffortToTargetCatalog("low", deepseek, GROK_BUILD_EFFORTS)).toBe(
      "low",
    );
    expect(
      mapEffortToTargetCatalog("medium", deepseek, GROK_BUILD_EFFORTS),
    ).toBe("high");
    expect(
      mapEffortToTargetCatalog("high", deepseek, GROK_BUILD_EFFORTS),
    ).toBe("xhigh");
  });

  it("orders custom 4-tier (low/medium/high/max) onto all 4 UI slots", () => {
    const tier4: EffortOption[] = [
      { id: "low" },
      { id: "medium" },
      { id: "high" },
      { id: "max" },
    ];
    expect(effortUiOptionsForCatalog(tier4).map((o) => o.uiId)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(effortUiOptionsForCatalog(tier4).map((o) => o.spawnId)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(spawnIdToEffortUiSlot("max", tier4)).toBe("xhigh");
    expect(spawnIdToEffortUiSlot("medium", tier4)).toBe("medium");
  });
});

describe("effortDisplayLabel", () => {
  it("prefers i18n for known ids over English catalog labels", () => {
    expect(
      effortDisplayLabel(
        { id: "high", label: "High Effort" },
        { high: "高" },
      ),
    ).toBe("高");
    expect(
      effortDisplayLabel(
        { id: "medium", label: "Medium Effort" },
        { medium: "中" },
      ),
    ).toBe("中");
    expect(
      effortDisplayLabel(
        { id: "low", label: "Low Effort" },
        { high: "High", medium: "Medium", low: "Low" },
      ),
    ).toBe("Low");
  });

  it("uses i18n for known ids without catalog label", () => {
    expect(
      effortDisplayLabel("high", {
        high: "High",
        medium: "Medium",
        low: "Low",
      }),
    ).toBe("High");
    expect(effortDisplayLabel({ id: "medium" }, { medium: "中" })).toBe(
      "中",
    );
  });

  it("localizes DeepSeek-style xhigh/max over stored English names", () => {
    expect(
      effortDisplayLabel(
        { id: "xhigh", label: "xhigh" },
        { xhigh: "极高", max: "极高" },
      ),
    ).toBe("极高");
    expect(
      effortDisplayLabel(
        { id: "max", label: "Max" },
        { xhigh: "极高" },
      ),
    ).toBe("极高");
  });

  it("strips shared Effort suffix on non-standard catalog labels", () => {
    expect(
      effortDisplayLabel({ id: "custom-tier", label: "Max Effort" }),
    ).toBe("Max");
  });

  it("falls back to raw id", () => {
    expect(effortDisplayLabel("custom-tier")).toBe("custom-tier");
  });
});
