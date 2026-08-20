/**
 * Browser APIs jsdom does not implement, stubbed just enough for component
 * tests. Import for side effects from any `@vitest-environment jsdom` file:
 *
 *     import "@/test/jsdomStubs";
 *
 * Kept as an explicit import rather than a vitest `setupFiles` entry so the
 * several hundred node-environment tests never load DOM code.
 */

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
}

if (typeof Element.prototype.scrollTo === "undefined") {
  Element.prototype.scrollTo = function scrollTo() {};
}

export {};
