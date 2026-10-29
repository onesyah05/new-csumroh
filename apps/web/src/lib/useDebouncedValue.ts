import { useEffect, useState } from 'react';

/** Nilai yang baru berubah setelah `delayMs` tanpa perubahan lagi (mis. kata pencarian yang memanggil API). */
export function useDebouncedValue<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
