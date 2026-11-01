type TourStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Resolve the browser property inside try/catch too: accessing localStorage or
 * sessionStorage itself can throw SecurityError before a method is called.
 * After a denial, keep this document's state in memory without retrying a
 * storage implementation that may still contain stale values.
 */
export function createTourStorage(resolve: () => TourStorage): TourStorage {
  const memory = new Map<string, string>();
  let unavailable = false;
  return {
    getItem(key) {
      if (!unavailable) {
        try {
          const value = resolve().getItem(key);
          if (value === null) memory.delete(key);
          else memory.set(key, value);
          return value;
        } catch { unavailable = true; }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (!unavailable) {
        try { resolve().setItem(key, value); }
        catch { unavailable = true; }
      }
    },
    removeItem(key) {
      memory.delete(key);
      if (!unavailable) {
        try { resolve().removeItem(key); }
        catch { unavailable = true; }
      }
    },
  };
}

export const narrationStorage = createTourStorage(() => window.localStorage);
export const tourStateStorage = createTourStorage(() => window.sessionStorage);
