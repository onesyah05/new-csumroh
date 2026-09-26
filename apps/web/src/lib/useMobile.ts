import { useEffect, useState } from 'react';

export function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 767px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}

/** Keyboard and browser chrome may resize the visual viewport independently of layout. */
export function useAppViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      // Preserve pinch zoom: do not reflow the application while the user zooms.
      if (viewport && viewport.scale !== 1) return;
      document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);
}
