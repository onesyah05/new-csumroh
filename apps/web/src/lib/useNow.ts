import { useEffect, useState } from 'react';

/** Waktu sekarang (ms) yang diperbarui berkala, untuk tampilan yang bergantung pada batas waktu. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
