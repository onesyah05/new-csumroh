import { useState, type SetStateAction } from 'react';

/** Optional per-tab persistence, scoped by the caller to staff and brand. */
export function useSessionState<T>(key: string, initial: T) {
  const [values, setValues] = useState<Record<string, T>>({});
  function read(): T {
    try { const saved = sessionStorage.getItem(key); return saved === null ? initial : JSON.parse(saved); } catch { return initial; }
  }
  function update(action: SetStateAction<T>) {
    setValues(previous => {
      const value = typeof action === 'function' ? (action as (value: T) => T)(previous[key] ?? read()) : action;
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* State remains usable without persistence. */ }
      return { ...previous, [key]: value };
    });
  }
  return [values[key] ?? read(), update] as const;
}
