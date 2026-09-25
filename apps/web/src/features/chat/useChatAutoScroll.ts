import { useLayoutEffect, useRef } from 'react';

/** Follow the latest message until the reader deliberately scrolls into history. */
export function useChatAutoScroll(identity: string, messages: unknown) {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const initialized = useRef(false);

  useLayoutEffect(() => {
    following.current = true;
    initialized.current = false;
    const timeline = timelineRef.current;
    const content = contentRef.current;
    if (!timeline || !content) return;

    const scrollToEnd = () => {
      if (following.current) timeline.scrollTop = timeline.scrollHeight;
    };
    const onScroll = () => {
      // Loading placeholders must not consume the first real-message positioning.
      if (initialized.current) following.current = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 180;
    };
    timeline.addEventListener('scroll', onScroll, { passive: true });
    // Images, history sync, and responsive panels can change height after messages render.
    const observer = new ResizeObserver(scrollToEnd);
    observer.observe(content);
    observer.observe(timeline);
    return () => {
      timeline.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [identity]);

  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline || messages === undefined) return;
    if (!initialized.current || following.current) timeline.scrollTop = timeline.scrollHeight;
    initialized.current = true;
  }, [identity, messages]);

  return { timelineRef, contentRef };
}
