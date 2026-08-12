import { describe, expect, it } from "vitest";
import {
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MAX,
  TREE_WIDTH_MIN,
  clampTreeWidth,
  expandKeysForResourceTreeFilter,
  filterResourceTreeNodes,
  loadTreeExpanded,
  loadTreeWidth,
  mergeTreeExpandedForFilter,
  persistTreeWidth,
  saveTreeExpanded,
  type ResourceTreeNodeLike,
} from "./resourceTree";

function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  } as Storage;
}

const sample: ResourceTreeNodeLike[] = [
  {
    name: "src",
    relativePath: "src",
    isDir: true,
    children: [
      {
        name: "App.tsx",
        relativePath: "src/App.tsx",
        isDir: false,
      },
      {
        name: "lib",
        relativePath: "src/lib",
        isDir: true,
        children: [
          {
            name: "resourceTabs.ts",
            relativePath: "src/lib/resourceTabs.ts",
            isDir: false,
          },
        ],
      },
    ],
  },
  {
    name: "README.md",
    relativePath: "README.md",
    isDir: false,
  },
];

describe("clampTreeWidth / persistTreeWidth / loadTreeWidth", () => {
  it("clamps to min/max and container fraction", () => {
    expect(clampTreeWidth(50, 800)).toBe(TREE_WIDTH_MIN);
    expect(clampTreeWidth(9999, 800)).toBe(
      Math.min(TREE_WIDTH_MAX, Math.floor(800 * 0.55)),
    );
    expect(clampTreeWidth(200, 800)).toBe(200);
    expect(clampTreeWidth(Number.NaN, 800)).toBe(TREE_WIDTH_DEFAULT);
  });

  it("persists rounded clamped width", () => {
    const s = memStorage();
    const w = persistTreeWidth(199.6, 800, s);
    expect(w).toBe(200);
    expect(loadTreeWidth(s)).toBe(200);
  });

  it("loadTreeWidth falls back on garbage", () => {
    const s = memStorage({ "grok-app.resourceTreeWidth": "nope" });
    expect(loadTreeWidth(s)).toBe(TREE_WIDTH_DEFAULT);
  });
});

describe("tree expand persist", () => {
  it("round-trips expanded keys", () => {
    const s = memStorage();
    saveTreeExpanded("/proj", { "": true, src: true, "src/lib": true }, s);
    expect(loadTreeExpanded("/proj", s)).toEqual({
      "": true,
      src: true,
      "src/lib": true,
    });
  });

  it("always keeps root open on empty storage", () => {
    expect(loadTreeExpanded("/x", memStorage())).toEqual({ "": true });
  });
});

describe("filterResourceTreeNodes", () => {
  it("returns all when query empty", () => {
    expect(filterResourceTreeNodes(sample, "")).toBe(sample);
  });

  it("keeps ancestors of matching files", () => {
    const filtered = filterResourceTreeNodes(sample, "resourceTabs");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe("src");
    expect(filtered[0]!.children).toHaveLength(1);
    expect(filtered[0]!.children![0]!.name).toBe("lib");
    expect(filtered[0]!.children![0]!.children![0]!.name).toBe(
      "resourceTabs.ts",
    );
  });

  it("matches by basename", () => {
    const filtered = filterResourceTreeNodes(sample, "readme");
    expect(filtered.map((n) => n.name)).toEqual(["README.md"]);
  });
});

describe("expandKeysForResourceTreeFilter / mergeTreeExpandedForFilter", () => {
  it("forces ancestor dirs open for hits", () => {
    const keys = expandKeysForResourceTreeFilter(sample, "resourceTabs");
    expect(keys).toEqual(expect.arrayContaining(["src", "src/lib"]));
  });

  it("merge does not collapse existing expands", () => {
    const merged = mergeTreeExpandedForFilter(
      { "": true, other: true },
      ["src", "src/lib"],
    );
    expect(merged).toEqual({
      "": true,
      other: true,
      src: true,
      "src/lib": true,
    });
  });
});
