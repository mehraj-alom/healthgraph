import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * Minimal staggered-reveal hook matching the API used by
 * Capabilities / Compare / Day / How / Faq:
 *
 *   const reveal = useStaggeredReveal(5);
 *   <section ref={reveal.containerRef}>
 *   <div style={reveal.getAnimStyle(0)} />
 */
export function useStaggeredReveal(count: number) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      setVisible(true);
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    // Safety: never leave content stuck at opacity 0 (e.g. tall sections
    // where threshold never hits, or observer quirks on mobile).
    const fallback = setTimeout(() => setVisible(true), 900);
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          clearTimeout(fallback);
          obs.disconnect();
        }
      },
      { threshold: 0.02, rootMargin: '0px 0px -5% 0px' }
    );
    obs.observe(el);
    return () => {
      clearTimeout(fallback);
      obs.disconnect();
    };
  }, []);

  const getAnimStyle = (i: number): CSSProperties => {
    void count;
    return {
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(16px)',
      transition: `opacity 600ms ease ${Math.min(i, 8) * 70}ms, transform 600ms cubic-bezier(0.16,1,0.3,1) ${Math.min(i, 8) * 70}ms`,
    };
  };

  return { containerRef, getAnimStyle };
}
