import { useCallback, useEffect, useRef, useState } from 'react';

/** Mobile = max-width 767px (single md: breakpoint, per template). */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** One-shot staggered scroll reveal (fires once per section). */
export function useStaggeredReveal(count: number, threshold = 0.15) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  const getAnimStyle = useCallback(
    (index: number): React.CSSProperties => ({
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0) scale(1)' : 'translateY(56px) scale(0.975)',
      transition:
        `opacity 0.9s cubic-bezier(0.16,1,0.3,1) ${index * 160}ms, ` +
        `transform 0.9s cubic-bezier(0.16,1,0.3,1) ${index * 160}ms`,
      willChange: visible ? 'auto' : 'opacity, transform',
    }),
    [visible, count],
  );

  return { containerRef, getAnimStyle, visible };
}
