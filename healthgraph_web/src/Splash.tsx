import { useEffect, useState } from 'react';

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [count, setCount] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // 0 → 100 over exactly 900ms (9ms per step, 100 steps) — quick, not a gate.
    const id = setInterval(() => {
      setCount((c) => {
        if (c >= 100) {
          clearInterval(id);
          return 100;
        }
        return c + 1;
      });
    }, 9);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (count < 100) return;
    const t1 = setTimeout(() => setExiting(true), 150);
    const t2 = setTimeout(onComplete, 750);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [count, onComplete]);

  return (
    <div
      className={`fixed inset-0 z-[100] bg-stage flex items-end justify-start transition-opacity duration-700 ${exiting ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="text-7xl md:text-9xl font-semibold tabular-nums tracking-[-0.03em] p-6 md:p-10 leading-none text-ink">
        {count}
      </div>
    </div>
  );
}
