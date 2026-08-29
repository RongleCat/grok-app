/**
 * Node 26+ exposes experimental Web Storage that is `undefined` unless
 * `--localstorage-file` is set. That shadows jsdom's Storage and makes
 * `localStorage.clear()` throw in component tests. CI stays on Node 22.
 * Install an in-memory Storage when the real one is missing or unusable.
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }

  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.#map.set(String(key), String(value));
  }
}

function storageWorks(holder: object): boolean {
  try {
    const ls = (holder as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.clear !== "function") return false;
    ls.setItem("__grok_ls_probe", "1");
    ls.removeItem("__grok_ls_probe");
    return true;
  } catch {
    return false;
  }
}

export function ensureLocalStorage(): void {
  const holders: object[] = [globalThis];
  if (typeof window !== "undefined") holders.push(window);
  if (holders.every((h) => storageWorks(h))) return;

  const storage = new MemoryStorage();
  for (const holder of holders) {
    try {
      Object.defineProperty(holder, "localStorage", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: storage,
      });
    } catch {
      (holder as { localStorage: Storage }).localStorage = storage;
    }
  }
}
