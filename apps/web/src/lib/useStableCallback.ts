import { useCallback, useLayoutEffect, useRef } from 'react';

/** Fungsi dengan identitas tetap yang selalu memanggil versi terbaru: aman diteruskan ke komponen `memo`. */
export function useStableCallback<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => { ref.current = fn; });
  return useCallback((...args: Args) => ref.current(...args), []);
}
