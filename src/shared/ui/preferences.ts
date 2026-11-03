/**
 * Per-viewer UI conveniences (dismissed guides). Browser storage can be unavailable
 * (private mode, blocked storage), so every access is guarded and the app works without it.
 */
const KEY = 'infra-manager:dismissed-guides';

const read = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

export const isGuideDismissed = (id: string): boolean => read().has(id);

export const dismissGuide = (id: string): void => {
  try {
    const set = read();
    set.add(id);
    window.localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Storage unavailable: the guide simply shows again next time.
  }
};

export const resetGuides = (): void => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
};
