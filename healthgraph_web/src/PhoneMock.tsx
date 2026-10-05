/** Miniature, faithful previews of real HealthGraph screens (app tokens). */

const TONES = ['#57507A', '#96684A', '#5C6E7C', '#6E7F4E'];

function Wave({ className = '' }: { className?: string }) {
  // Deterministic PPG-like beat trace.
  const pts: string[] = [];
  let x = 0;
  while (x <= 300) {
    const b = (x / 34) % 1;
    let y: number;
    if (b < 0.12) y = 30 - Math.sin((b / 0.12) * Math.PI) * 22;
    else if (b < 0.2) y = 30 + Math.sin(((b - 0.12) / 0.08) * Math.PI) * 6;
    else if (b < 0.34) y = 30 - Math.sin(((b - 0.2) / 0.14) * Math.PI) * 11;
    else y = 30;
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`);
    x += 3;
  }
  return (
    <svg viewBox="0 0 300 60" className={className} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke="#4FD1C5" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Dashboard() {
  return (
    <div className="flex flex-col h-full gap-2">
      <p className="text-ink text-sm font-semibold text-center">Good evening.</p>
      <div className="relative mx-auto w-24 h-24">
        <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
          <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
          <circle cx="48" cy="48" r="40" fill="none" stroke="#4FD1C5" strokeWidth="8" strokeLinecap="round" strokeDasharray="251" strokeDashoffset="70" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-ink text-lg font-semibold tabular-nums">72</span>
      </div>
      <div className="grid grid-cols-2 gap-2 flex-1">
        {['Sleep 7h12', 'Meds 2/3', 'Pulse 64', 'Docs 14'].map((label, i) => (
          <div key={label} className="rounded-lg flex items-center justify-center" style={{ background: TONES[i] }}>
            <span className="text-ink text-[11px] font-medium tabular-nums">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chat() {
  return (
    <div className="flex flex-col h-full gap-2">
      <p className="text-ink text-sm font-semibold text-center">Sanotts</p>
      <div className="rounded-xl bg-white/10 p-2">
        <p className="text-ink text-[11px] leading-4">Your resting pulse dropped 4 bpm this week. Sleep looks steady.</p>
      </div>
      <div className="rounded-xl bg-teal/20 border border-teal/40 p-2 self-end max-w-[85%]">
        <p className="text-ink text-[11px] leading-4">Why am I so tired lately?</p>
      </div>
      <div className="rounded-xl bg-white/10 p-2">
        <p className="text-ink text-[11px] leading-4">Two short nights in a row. Want a 20-minute recovery plan?</p>
      </div>
      <div className="mt-auto rounded-full bg-white px-3 py-2">
        <p className="text-black/40 text-[11px]">Ask anything…</p>
      </div>
    </div>
  );
}

function Pulse() {
  return (
    <div className="flex flex-col h-full gap-2 items-center">
      <p className="text-ink text-sm font-semibold">Pulse.</p>
      <p className="text-ink text-4xl font-semibold tabular-nums leading-none">64</p>
      <p className="text-teal text-[10px] font-semibold tracking-widest">BPM · LIVE</p>
      <Wave className="w-full h-14" />
      <div className="rounded-full bg-white px-4 py-2 mt-auto">
        <p className="text-black text-[11px] font-semibold">Hold still…</p>
      </div>
    </div>
  );
}

export default function PhoneMock({ screen, caption }: { screen: 'dashboard' | 'chat' | 'pulse'; caption: string }) {
  return (
    <div className="rounded-card bg-panel border border-white/10 p-3 md:p-4 flex flex-col min-h-[380px] md:min-h-[440px]">
      <div className="mx-auto w-16 h-1.5 rounded-full bg-white/20 mb-3" />
      <div className="rounded-xl bg-stage border border-white/10 p-3 flex-1 overflow-hidden">
        {screen === 'dashboard' && <Dashboard />}
        {screen === 'chat' && <Chat />}
        {screen === 'pulse' && <Pulse />}
      </div>
      <p className="text-fog text-xs font-medium mt-3 text-center">{caption}</p>
    </div>
  );
}
