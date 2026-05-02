const { useState, useEffect, useRef } = React;

/* ─────────────────────────────────────────────────────── */
/*  HydroSense Dashboard — Fully Self-Contained Simulation  */
/* ─────────────────────────────────────────────────────── */

function useInterval(callback, delay) {
  const savedCallback = useRef();
  useEffect(() => { savedCallback.current = callback; }, [callback]);
  useEffect(() => {
    if (delay !== null) {
      const id = setInterval(() => savedCallback.current(), delay);
      return () => clearInterval(id);
    }
  }, [delay]);
}

// ── Tiny sparkline (SVG polyline) ──────────────────────
function Sparkline({ data, color }) {
  const w = 120, h = 30;
  const max = Math.max(...data.map(Math.abs), 1);
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h / 2 - (v / max) * (h / 2 - 2)}`
  ).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── Channel Card ───────────────────────────────────────
function ChannelCard({ ch, isActive }) {
  const isLeak       = ch.status === 'Leak Detected';
  const isMonitoring = ch.status === 'Monitoring';

  const borderCls = isLeak
    ? 'border-red-500/60 shadow-red-500/10 shadow-lg'
    : isMonitoring
    ? 'border-blue-500/50 shadow-blue-500/10 shadow-lg'
    : 'border-slate-800';

  const ringCls   = isActive ? ' ring-2 ring-cyan-500/50' : '';

  const badgeCls  = isLeak
    ? 'bg-red-500/15 text-red-400 animate-pulse'
    : isMonitoring
    ? 'bg-blue-500/15 text-blue-400'
    : 'bg-green-500/15 text-green-400';

  const barColor  = isLeak ? 'bg-red-500' : isMonitoring ? 'bg-blue-500' : 'bg-green-500';
  const waveColor = isLeak ? '#ef4444' : isMonitoring ? '#3b82f6' : '#22c55e';

  return (
    <div className={`bg-slate-900 rounded-xl p-4 border transition-all duration-300 ${borderCls}${ringCls}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">CH{ch.id}</p>
          <h3 className="font-bold text-white text-sm leading-tight">{ch.pipeLabel}</h3>
          <p className="text-[11px] text-slate-500">{ch.type}</p>
        </div>
        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${badgeCls}`}>
          {ch.status}
        </span>
      </div>

      <Sparkline data={ch.history} color={waveColor} />

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <p className="text-[10px] text-slate-500">AI Confidence</p>
          <p className="text-lg font-bold text-white">{ch.confidence}%</p>
          <div className="w-full bg-slate-800 rounded-full h-1 mt-1">
            <div className={`h-1 rounded-full transition-all duration-500 ${barColor}`}
                 style={{ width: `${ch.confidence}%` }} />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-500">RMS Vibration</p>
          <p className="text-lg font-bold text-white">{ch.rms.toFixed(3)} g</p>
          <p className="text-[10px] text-slate-500 mt-1">
            {isActive ? '⟳ Scanning now…' : 'Last: a few sec ago'}
          </p>
        </div>
      </div>

      {isActive && (
        <div className="mt-3 flex items-center justify-center gap-2 h-6 rounded bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-medium text-cyan-400">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping inline-block"></span>
          Active Multiplexer Channel
        </div>
      )}
    </div>
  );
}

// ── Live Waveform (SVG) ────────────────────────────────
function WaveformChart({ data, channelId }) {
  const color = channelId === 2 ? '#ef4444' : channelId === 4 ? '#3b82f6' : '#22c55e';
  const max = Math.max(...data.map(Math.abs), 1);
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * 1000},${50 - (v / max) * 46}`
  ).join(' ');
  return (
    <svg viewBox="0 0 1000 100" className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="wGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <line x1="0" y1="50" x2="1000" y2="50" stroke="#1e293b" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// ── Spectrogram Bars ───────────────────────────────────
function Spectrogram({ channelId }) {
  const bars = Array.from({ length: 64 }, (_, i) => {
    const base = channelId === 2
      ? 30 + Math.random() * 70
      : channelId === 4
      ? 10 + Math.random() * 45
      : 5 + Math.random() * 18;
    return base;
  });
  const hue = channelId === 2 ? 0 : channelId === 4 ? 220 : 140;
  return (
    <div className="flex items-end h-full gap-[2px]">
      {bars.map((h, i) => (
        <div key={i} className="flex-1 rounded-t-[1px]"
             style={{ height: `${h}%`, backgroundColor: `hsl(${hue},65%,${Math.min(62, h / 2 + 18)}%)`, opacity: 0.85 }} />
      ))}
    </div>
  );
}

// ── AI Inference Panel ─────────────────────────────────
function AIPanel({ channelId }) {
  const classes = channelId === 2
    ? [{ l: 'Normal Flow', v: 4, c: 'bg-green-500' }, { l: 'Background Noise', v: 2, c: 'bg-slate-500' }, { l: 'Leak Signature', v: 94, c: 'bg-red-500' }]
    : channelId === 4
    ? [{ l: 'Normal Flow', v: 11, c: 'bg-green-500' }, { l: 'Background Noise', v: 82, c: 'bg-slate-500' }, { l: 'Leak Signature', v: 7, c: 'bg-red-500' }]
    : [{ l: 'Normal Flow', v: 92, c: 'bg-green-500' }, { l: 'Background Noise', v: 7, c: 'bg-slate-500' }, { l: 'Leak Signature', v: 1, c: 'bg-red-500' }];

  const inference = channelId === 2
    ? 'Leak pattern detected based on abnormal vibration energy and high-frequency signal behavior.'
    : 'Normal pipe flow detected. No anomalous vibration signatures present.';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-white flex items-center gap-2 text-sm">
          <i className="fa-solid fa-microchip text-indigo-400"></i> AI Inference Engine
        </h2>
        <span className="text-[10px] bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded font-semibold">Edge AI · ESP32</span>
      </div>

      <div className="flex justify-between text-[11px] pb-3 border-b border-slate-800">
        <span className="text-slate-500">Model: <span className="text-green-400 font-mono">TFLite v2.3</span></span>
        <span className="text-slate-500">Scanning: <span className="text-white font-mono">CH{channelId}</span></span>
      </div>

      <div className="space-y-3">
        {classes.map(cls => (
          <div key={cls.l}>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-300">{cls.l}</span>
              <span className="font-mono text-white">{cls.v}%</span>
            </div>
            <div className="w-full bg-slate-950 rounded-full h-2">
              <div className={`h-2 rounded-full ${cls.c} transition-all duration-700`} style={{ width: `${cls.v}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="bg-slate-950 rounded-lg border border-slate-800 p-3 text-[11px] text-slate-400 leading-relaxed">
        <i className="fa-solid fa-circle-info text-blue-400 mr-2"></i>{inference}
      </div>
    </div>
  );
}

// ── Hub Status Panel ───────────────────────────────────
function HubPanel({ channelId }) {
  const items = [
    { label: 'ESP32',              val: 'Online',            color: 'text-green-400' },
    { label: 'Multiplexer',        val: `Active (CH${channelId})`, color: 'text-blue-400' },
    { label: 'Channels Scanned',   val: '4 / 4',             color: 'text-white' },
    { label: 'USB Serial',         val: 'ttyUSB0 · 9600bd',  color: 'text-slate-300' },
    { label: 'Power Supply',       val: 'Stable (3.3 V)',    color: 'text-slate-300' },
    { label: 'Data Stream',        val: 'Live',              color: 'text-green-400' },
    { label: 'Inference Engine',   val: 'Enabled',           color: 'text-indigo-400' },
  ];

  const steps = [
    { icon: 'fa-wave-square',  label: 'Sensors',     active: false },
    { icon: 'fa-retweet',      label: 'Multiplexer', active: true  },
    { icon: 'fa-microchip',    label: 'ESP32',       active: true  },
    { icon: 'fa-display',      label: 'Dashboard',   active: true  },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
      <h2 className="font-bold text-white flex items-center gap-2 text-sm">
        <i className="fa-solid fa-network-wired text-cyan-400"></i> Shared Hub Status
      </h2>

      {/* Pipeline stepper */}
      <div className="flex items-center justify-between px-1">
        {steps.map((s, idx) => (
          <React.Fragment key={s.label}>
            <div className="flex flex-col items-center gap-1">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm border transition-colors ${s.active ? 'bg-blue-600 border-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.5)]' : 'bg-slate-800 border-slate-700 opacity-50'}`}>
                <i className={`fa-solid ${s.icon}`}></i>
              </div>
              <span className={`text-[9px] font-medium ${s.active ? 'text-blue-300' : 'text-slate-500'}`}>{s.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex-1 h-px mx-1 bg-slate-800 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600/0 via-blue-500/70 to-blue-600/0 animate-pulse"></div>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Status grid */}
      <div className="grid grid-cols-2 gap-y-2 text-[11px] border-t border-slate-800 pt-3">
        {items.map(item => (
          <React.Fragment key={item.label}>
            <span className="text-slate-500">{item.label}</span>
            <span className={`text-right font-medium ${item.color} truncate`}>{item.val}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Event Log Row ──────────────────────────────────────
function EventRow({ ev }) {
  const isLeak = ev.action === 'Alert generated';
  return (
    <tr className={`border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors ${isLeak ? 'bg-red-500/5' : ''}`}>
      <td className="py-2 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">{ev.time.toLocaleTimeString()}</td>
      <td className="py-2 px-4 whitespace-nowrap">
        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${ev.channel === 'CH2' ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-300'}`}>
          {ev.channel}
        </span>
      </td>
      <td className={`py-2 px-4 text-[11px] whitespace-nowrap ${isLeak ? 'text-red-400' : 'text-slate-300'}`}>{ev.event}</td>
      <td className="py-2 px-4 text-[11px] font-mono border-l border-slate-800 whitespace-nowrap">{ev.confidence}</td>
      <td className="py-2 px-4 text-right text-[11px] whitespace-nowrap">
        {isLeak
          ? <span className="text-red-400 flex items-center justify-end gap-1"><i className="fa-solid fa-circle-exclamation"></i> Alert generated</span>
          : <span className="text-slate-500">{ev.action}</span>
        }
      </td>
    </tr>
  );
}

// ── Live Monitor Components (Wake-based ESP32 v2) ──────

// Connection status badge
function StatusBadge({ status }) {
  const cfg = {
    'Disconnected': { cls: 'bg-slate-700/80 text-slate-300 border border-slate-600',        icon: 'fa-circle-xmark' },
    'Connecting':   { cls: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',  icon: 'fa-spinner fa-spin' },
    'Connected':    { cls: 'bg-green-500/20  text-green-400  border border-green-500/30',   icon: 'fa-circle' },
    'Error':        { cls: 'bg-red-500/20    text-red-400    border border-red-500/30',     icon: 'fa-triangle-exclamation' },
  }[status] || { cls: 'bg-slate-700 text-slate-300', icon: 'fa-circle-xmark' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold ${cfg.cls}`}>
      <i className={`fa-solid ${cfg.icon} text-[9px]`}></i>
      {status}
    </span>
  );
}

// ── Location / Channel card (Building M or Building C) ─
function LocationCard({ chNum, location, building, status, active, sw, mag, x, y, z, lastTime }) {
  // Visual theme per state
  const isSleep    = status === 'SLEEP'             || !status;
  const isMonitor  = status === 'MONITORING';
  const isActivity = status === 'ACTIVITY_DETECTED';

  const cardCls = isActivity
    ? 'border-red-500/60 shadow-red-500/10 shadow-xl bg-slate-900'
    : isMonitor
    ? 'border-cyan-500/50 shadow-cyan-500/10 shadow-lg bg-slate-900'
    : 'border-slate-800 bg-slate-900/70';

  const headerGlow = isActivity
    ? 'from-red-900/30 to-transparent'
    : isMonitor
    ? 'from-cyan-900/20 to-transparent'
    : 'from-slate-800/40 to-transparent';

  const statusBadge = isActivity
    ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
    : isMonitor
    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
    : 'bg-slate-700/60 text-slate-400 border border-slate-600/40';

  const statusIcon = isActivity ? 'fa-triangle-exclamation' : isMonitor ? 'fa-satellite-dish' : 'fa-moon';

  const statusLabel = isActivity
    ? 'ACTIVITY DETECTED'
    : isMonitor
    ? 'MONITORING'
    : 'SLEEP';

  const statusDesc = isActivity
    ? 'Possible leak activity detected'
    : isMonitor
    ? 'Wake trigger received — collecting 10 seconds of accelerometer data'
    : 'Sleeping — still reading background sensor values';

  const accentColor = isActivity ? 'text-red-400' : isMonitor ? 'text-cyan-400' : 'text-slate-500';
  const magColor    = isActivity ? 'text-red-300' : isMonitor ? 'text-cyan-300' : 'text-slate-400';

  return (
    <div className={`rounded-2xl border transition-all duration-500 overflow-hidden ${cardCls}`}>
      {/* Header strip */}
      <div className={`bg-gradient-to-r ${headerGlow} px-5 pt-4 pb-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Building icon */}
            <div className={`p-3 rounded-xl border transition-colors ${
              isActivity ? 'bg-red-500/15 border-red-500/30'
              : isMonitor ? 'bg-cyan-500/15 border-cyan-500/30'
              : 'bg-slate-800 border-slate-700'}`}>
              <i className={`fa-solid fa-building ${accentColor} text-lg`}></i>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Location · Channel {chNum}</p>
              <h3 className="font-extrabold text-white text-base leading-tight">{building}</h3>
              <p className="text-[11px] text-slate-400">{location}</p>
            </div>
          </div>
          {/* Status badge */}
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${statusBadge}`}>
            <i className={`fa-solid ${statusIcon} text-[9px]`}></i>
            {statusLabel}
          </span>
        </div>

        {/* Status description line */}
        <p className={`mt-2 text-[11px] ${isActivity ? 'text-red-300/80' : isMonitor ? 'text-cyan-300/80' : 'text-slate-500'} leading-relaxed`}>
          {statusDesc}
        </p>
      </div>

      {/* Body */}
      <div className="px-5 pb-5 pt-3 flex flex-col gap-4">

        {/* Active window + SW trigger row */}
        <div className="flex items-center gap-3">
          <div className={`flex-1 flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors ${
            active ? 'bg-cyan-500/10 border-cyan-500/25' : 'bg-slate-800/50 border-slate-700/40'}`}>
            <i className={`fa-solid fa-clock-rotate-left text-[11px] ${active ? 'text-cyan-400' : 'text-slate-500'}`}></i>
            <span className={`text-[11px] font-semibold ${active ? 'text-cyan-300' : 'text-slate-500'}`}>
              {active ? '~10s Detection Window Active' : 'Detection Window: OFF'}
            </span>
            {active && <span className="ml-auto w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block"></span>}
          </div>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-colors ${
            sw ? 'bg-orange-500/15 border-orange-500/30' : 'bg-slate-800/50 border-slate-700/40'}`}>
            <i className={`fa-solid fa-bolt text-[11px] ${sw ? 'text-orange-400' : 'text-slate-500'}`}></i>
            <span className={`text-[11px] font-bold ${sw ? 'text-orange-300' : 'text-slate-500'}`}>
              SW-420: {sw ? '1 · TRIGGERED' : '0 · Idle'}
            </span>
          </div>
        </div>

        {/* Accelerometer readings */}
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 font-semibold">
            ADXL345 · Pipe Vibration
            <span className="ml-2 text-[9px] text-slate-600 normal-case font-normal">
              {isSleep ? '(background readings)' : ''}
            </span>
          </p>
          <div className="grid grid-cols-4 gap-2">
            <div className={`rounded-lg px-3 py-2.5 border text-center ${isActivity ? 'bg-red-500/10 border-red-500/20' : isMonitor ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-slate-800/50 border-slate-700/30'}`}>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">Magnitude</p>
              <p className={`text-xl font-extrabold font-mono mt-0.5 ${magColor}`}>{mag !== null ? mag.toFixed(3) : '—'}</p>
              <p className="text-[9px] text-slate-500 mt-0.5">g</p>
            </div>
            {[['X', x], ['Y', y], ['Z', z]].map(([axis, val]) => (
              <div key={axis} className="bg-slate-800/40 border border-slate-700/30 rounded-lg px-3 py-2.5 text-center">
                <p className="text-[9px] text-slate-500 uppercase tracking-wider">{axis}-axis</p>
                <p className="text-base font-bold font-mono text-slate-300 mt-0.5">{val !== null ? val.toFixed(3) : '—'}</p>
                <p className="text-[9px] text-slate-500 mt-0.5">g</p>
              </div>
            ))}
          </div>
        </div>

        {/* Last update */}
        {lastTime && (
          <p className="text-[10px] text-slate-600 text-right font-mono">Last update: {lastTime}</p>
        )}
      </div>
    </div>
  );
}

// Wrapper card for a live Recharts chart
function LiveChartCard({ title, badge, children }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-white text-sm">{title}</h3>
        {badge && (
          <span className="text-[10px] bg-cyan-500/15 text-cyan-300 px-2 py-0.5 rounded font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block"></span>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// Latest samples table for new 15-field format
function LatestSamplesTable({ data }) {
  const rows = [...data].reverse().slice(0, 10);
  const statusCls = (s) =>
    s === 'ACTIVITY_DETECTED' ? 'bg-red-500/20 text-red-400'
    : s === 'MONITORING'      ? 'bg-cyan-500/15 text-cyan-300'
    :                           'bg-slate-700/60 text-slate-400';
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      <table className="w-full text-left">
        <thead className="bg-slate-950 text-[10px] text-slate-500 uppercase tracking-widest sticky top-0">
          <tr>
            <th className="py-2 px-3 font-semibold">TIME ms</th>
            <th className="py-2 px-3 font-semibold">A1 Mag</th>
            <th className="py-2 px-3 font-semibold">A2 Mag</th>
            <th className="py-2 px-3 font-semibold">SW1</th>
            <th className="py-2 px-3 font-semibold">SW2</th>
            <th className="py-2 px-3 font-semibold">CH1 Active</th>
            <th className="py-2 px-3 font-semibold">CH2 Active</th>
            <th className="py-2 px-3 font-semibold">CH1 Status</th>
            <th className="py-2 px-3 font-semibold">CH2 Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-8 text-center text-slate-500 text-[11px]">
                No data yet — connect ESP32 to start streaming.
              </td>
            </tr>
          ) : rows.map(r => (
            <tr key={r.id} className="border-t border-slate-800/60 hover:bg-slate-800/40 transition-colors">
              <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500">{r.timeMs}</td>
              <td className="py-1.5 px-3 font-mono text-[11px] text-cyan-300">{r.a1mag.toFixed(3)}</td>
              <td className="py-1.5 px-3 font-mono text-[11px] text-purple-300">{r.a2mag.toFixed(3)}</td>
              <td className={`py-1.5 px-3 text-[11px] font-semibold ${r.sw1 ? 'text-orange-400' : 'text-slate-600'}`}>{r.sw1}</td>
              <td className={`py-1.5 px-3 text-[11px] font-semibold ${r.sw2 ? 'text-orange-400' : 'text-slate-600'}`}>{r.sw2}</td>
              <td className={`py-1.5 px-3 text-[11px] font-bold ${r.ch1Active ? 'text-cyan-400' : 'text-slate-600'}`}>{r.ch1Active ? 'ON' : 'OFF'}</td>
              <td className={`py-1.5 px-3 text-[11px] font-bold ${r.ch2Active ? 'text-purple-400' : 'text-slate-600'}`}>{r.ch2Active ? 'ON' : 'OFF'}</td>
              <td className="py-1.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusCls(r.ch1Status)}`}>{r.ch1Status}</span></td>
              <td className="py-1.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusCls(r.ch2Status)}`}>{r.ch2Status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Live Monitor Page (Wake-based v2) ─────────────
function LiveMonitor() {
  const [connStatus,  setConnStatus]  = useState('Disconnected');
  const [errorMsg,    setErrorMsg]    = useState('');
  const [sensorData,  setSensorData]  = useState([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [lastTime,    setLastTime]    = useState(null);

  const portRef         = useRef(null);
  const readerRef       = useRef(null);
  const streamClosedRef = useRef(null);
  const abortRef        = useRef(false);
  const idCounterRef    = useRef(0);

  const latest      = sensorData[sensorData.length - 1] || null;
  const isConnected = connStatus === 'Connected';

  // Parse new 15-field CSV: TIME,A1_X,A1_Y,A1_Z,A1_MAG,A2_X,A2_Y,A2_Z,A2_MAG,SW1,SW2,CH1_ACTIVE,CH2_ACTIVE,CH1_STATUS,CH2_STATUS
  function parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(',');
    if (parts.length !== 15) return null;
    // First 13 fields must be numeric
    const nums = parts.slice(0, 13).map(Number);
    if (nums.some(isNaN)) return null; // drops header row and any startup log
    const [timeMs, a1x, a1y, a1z, a1mag, a2x, a2y, a2z, a2mag, sw1, sw2, ch1Active, ch2Active] = nums;
    const ch1Status = parts[13].trim().toUpperCase();
    const ch2Status = parts[14].trim().toUpperCase();
    // Validate status tokens
    const validStatuses = ['SLEEP', 'MONITORING', 'ACTIVITY_DETECTED'];
    if (!validStatuses.includes(ch1Status) || !validStatuses.includes(ch2Status)) return null;
    const now = new Date();
    return {
      id: ++idCounterRef.current,
      timeMs,
      timeLabel: now.toLocaleTimeString(),
      a1x, a1y, a1z, a1mag,
      a2x, a2y, a2z, a2mag,
      sw1, sw2,
      ch1Active, ch2Active,
      ch1Status, ch2Status,
    };
  }

  async function connect() {
    if (!('serial' in navigator)) {
      setConnStatus('Error');
      setErrorMsg('Web Serial API is not supported. Please use Chrome or Edge.');
      return;
    }
    try {
      setConnStatus('Connecting');
      setErrorMsg('');
      const port = await navigator.serial.requestPort();
      portRef.current = port;
      await port.open({ baudRate: 115200 });
      setConnStatus('Connected');
      abortRef.current = false;

      const textDecoder = new TextDecoderStream();
      streamClosedRef.current = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      let buffer = '';
      while (!abortRef.current) {
        const { value, done } = await reader.read();
        if (done || abortRef.current) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          try {
            const parsed = parseLine(line);
            if (!parsed) continue;
            setSensorData(prev => {
              const next = [...prev, parsed];
              return next.length > 200 ? next.slice(next.length - 200) : next;
            });
            setSampleCount(c => c + 1);
            setLastTime(parsed.timeLabel);
          } catch (_) {}
        }
      }
    } catch (err) {
      if (err.name === 'NotFoundError') {
        setConnStatus('Disconnected');
      } else if (err.message && err.message.toLowerCase().includes('busy')) {
        setConnStatus('Error');
        setErrorMsg('Close Arduino Serial Monitor and try again.');
      } else {
        setConnStatus('Error');
        setErrorMsg(`Connection failed: ${err.message}`);
      }
    }
  }

  async function disconnect() {
    abortRef.current = true;
    try { if (readerRef.current) await readerRef.current.cancel(); } catch (_) {}
    readerRef.current = null;
    try { if (streamClosedRef.current) await streamClosedRef.current; } catch (_) {}
    streamClosedRef.current = null;
    try { if (portRef.current) await portRef.current.close(); } catch (_) {}
    portRef.current = null;
    setConnStatus('Disconnected');
  }

  useEffect(() => () => { abortRef.current = true; }, []);

  const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } = Recharts;
  const chartData = sensorData.slice(-100);

  // Tooltip styling shared
  const ttStyle = { background:'#0f172a', border:'1px solid #1e293b', borderRadius:'8px', fontSize:'11px', color:'#94a3b8' };

  return (
    <div className="flex flex-col gap-5">

      {/* ── Connection Panel ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-cyan-600/15 p-3 rounded-xl border border-cyan-600/20">
              <i className="fa-solid fa-usb text-cyan-400 text-xl"></i>
            </div>
            <div>
              <h2 className="font-bold text-white text-base flex flex-wrap items-center gap-2">
                HydroSense Live Monitor
                <span className="text-[10px] bg-blue-500/15 text-blue-300 px-2 py-0.5 rounded font-semibold">USB Serial</span>
                <span className="text-[10px] bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded font-semibold">115200 baud</span>
                <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-semibold">Building M</span>
                <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded font-semibold">Building C</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                2 × ADXL345 Accelerometers + 2 × SW-420 Wake Sensors · Wake-triggered 10 s monitoring windows
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <StatusBadge status={connStatus} />
            {lastTime && <span className="text-[11px] text-slate-500 font-mono">Last: {lastTime}</span>}
            {sampleCount > 0 && (
              <span className="text-[11px] text-slate-500">
                Samples: <span className="text-white font-mono">{sampleCount}</span>
              </span>
            )}
            {!isConnected ? (
              <button onClick={connect} disabled={connStatus === 'Connecting'}
                className="flex items-center gap-2 px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-cyan-600/20">
                <i className="fa-solid fa-plug"></i>
                {connStatus === 'Connecting' ? 'Connecting…' : 'Connect ESP32'}
              </button>
            ) : (
              <button onClick={disconnect}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors">
                <i className="fa-solid fa-plug-circle-xmark"></i> Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 text-[11px] text-amber-300/90">
          <i className="fa-solid fa-triangle-exclamation text-amber-400 mt-0.5 shrink-0"></i>
          <span>Close Arduino Serial Monitor before connecting. Web Serial works best in Chrome or Edge.</span>
        </div>

        {connStatus === 'Error' && errorMsg && (
          <div className="mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
            <i className="fa-solid fa-circle-xmark text-red-400 shrink-0"></i>
            {errorMsg}
          </div>
        )}
        {!('serial' in navigator) && (
          <div className="mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
            <i className="fa-solid fa-circle-xmark text-red-400 shrink-0"></i>
            Web Serial API is not supported in this browser. Please use Chrome or Edge.
          </div>
        )}
      </section>

      {/* ── Location Cards: Building M + Building C ── */}
      <section>
        <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <i className="fa-solid fa-location-dot text-cyan-400"></i>
          Sensor Locations
          {isConnected && (
            <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span>
              Live
            </span>
          )}
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <LocationCard
            chNum={1}
            building="Building M"
            location="Main water supply line · ADXL345 #1"
            status={latest ? latest.ch1Status : 'SLEEP'}
            active={latest ? !!latest.ch1Active : false}
            sw={latest ? latest.sw1 : 0}
            mag={latest ? latest.a1mag : null}
            x={latest ? latest.a1x : null}
            y={latest ? latest.a1y : null}
            z={latest ? latest.a1z : null}
            lastTime={lastTime}
          />
          <LocationCard
            chNum={2}
            building="Building C"
            location="Secondary distribution line · ADXL345 #2"
            status={latest ? latest.ch2Status : 'SLEEP'}
            active={latest ? !!latest.ch2Active : false}
            sw={latest ? latest.sw2 : 0}
            mag={latest ? latest.a2mag : null}
            x={latest ? latest.a2x : null}
            y={latest ? latest.a2y : null}
            z={latest ? latest.a2z : null}
            lastTime={lastTime}
          />
        </div>
      </section>

      {/* ── Live Charts 2×2 ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Magnitude: both locations over time */}
        <LiveChartCard title="Pipe Vibration Magnitude" badge="Live">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top:4, right:8, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="timeLabel" tick={{ fill:'#475569', fontSize:9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill:'#475569', fontSize:9 }} domain={['auto','auto']} />
                <Tooltip contentStyle={ttStyle} />
                <Legend wrapperStyle={{ fontSize:'11px', paddingTop:'4px' }} />
                <Line type="monotone" dataKey="a1mag" name="Building M (g)" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="a2mag" name="Building C (g)" stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </LiveChartCard>

        {/* SW wake triggers + active windows */}
        <LiveChartCard title="SW-420 Wake Triggers &amp; Detection Windows" badge="Live">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top:4, right:8, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="timeLabel" tick={{ fill:'#475569', fontSize:9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill:'#475569', fontSize:9 }} domain={[0, 1]} ticks={[0, 1]} />
                <Tooltip contentStyle={ttStyle} />
                <Legend wrapperStyle={{ fontSize:'11px', paddingTop:'4px' }} />
                <Line type="stepAfter" dataKey="sw1"       name="SW1 Wake"        stroke="#f97316" strokeWidth={2}   dot={false} isAnimationActive={false} />
                <Line type="stepAfter" dataKey="sw2"       name="SW2 Wake"        stroke="#fb923c" strokeWidth={2}   dot={false} isAnimationActive={false} strokeDasharray="5 3" />
                <Line type="stepAfter" dataKey="ch1Active" name="CH1 Window"      stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
                <Line type="stepAfter" dataKey="ch2Active" name="CH2 Window"      stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </LiveChartCard>

        {/* Building M — X/Y/Z axes */}
        <LiveChartCard title="Building M — ADXL345 Axes" badge="CH1">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top:4, right:8, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="timeLabel" tick={{ fill:'#475569', fontSize:9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill:'#475569', fontSize:9 }} domain={['auto','auto']} />
                <Tooltip contentStyle={ttStyle} />
                <Legend wrapperStyle={{ fontSize:'11px', paddingTop:'4px' }} />
                <Line type="monotone" dataKey="a1x" name="X (g)" stroke="#f87171" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="a1y" name="Y (g)" stroke="#4ade80" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="a1z" name="Z (g)" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </LiveChartCard>

        {/* Building C — X/Y/Z axes */}
        <LiveChartCard title="Building C — ADXL345 Axes" badge="CH2">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top:4, right:8, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="timeLabel" tick={{ fill:'#475569', fontSize:9 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill:'#475569', fontSize:9 }} domain={['auto','auto']} />
                <Tooltip contentStyle={ttStyle} />
                <Legend wrapperStyle={{ fontSize:'11px', paddingTop:'4px' }} />
                <Line type="monotone" dataKey="a2x" name="X (g)" stroke="#f87171" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="a2y" name="Y (g)" stroke="#4ade80" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="a2z" name="Z (g)" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </LiveChartCard>

      </div>

      {/* ── Latest Samples Table ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
        <h3 className="font-bold text-white text-sm flex items-center gap-2">
          <i className="fa-solid fa-table text-slate-400"></i>
          Latest Samples
          <span className="text-[10px] text-slate-500 font-normal ml-1">· last 10 rows</span>
        </h3>
        <LatestSamplesTable data={sensorData} />
      </section>

    </div>
  );
}

// ── Risk & Analysis Page ───────────────────────────────
function AnalysisPage() {
  const [status,  setStatus]  = useState(null);
  const [zones,   setZones]   = useState({});
  const [alerts,  setAlerts]  = useState([]);
  const [history, setHistory] = useState([]);

  async function fetchAll() {
    try {
      const [s, z, a, h] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/zones').then(r => r.json()),
        fetch('/api/alerts?limit=50').then(r => r.json()),
        fetch('/api/signal-history').then(r => r.json()),
      ]);
      setStatus(s);
      setZones(z);
      setAlerts(a.alerts || []);
      setHistory((h.history || []).slice(-60));
    } catch (_) {}
  }

  useEffect(() => { fetchAll(); }, []);
  useInterval(fetchAll, 3000);

  const { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
          Tooltip, ResponsiveContainer, Cell, Legend } = Recharts;

  // ── risk score 0–100 per zone ─────────────────────────
  function riskScore(z) {
    const leakFrac = (z.sensors_total || 0) > 0 ? z.sensors_leaking / z.sensors_total : 0;
    const base = leakFrac * 70;
    const bonus = z.status === 'leak' ? 20 : z.status === 'warning' ? 10 : 0;
    return Math.min(100, Math.round(base + bonus));
  }

  function riskColor(r) {
    return r >= 60 ? '#ef4444' : r >= 25 ? '#f97316' : '#22c55e';
  }

  function riskLabel(r) {
    return r >= 60 ? 'HIGH' : r >= 25 ? 'MEDIUM' : 'LOW';
  }

  const zoneList = Object.entries(zones).map(([id, z]) => ({
    id, ...z, risk: riskScore(z),
  }));

  function zoneBadgeCls(s) {
    if (s === 'leak')    return 'bg-red-500/15 text-red-400 border border-red-500/30';
    if (s === 'warning') return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30';
    return 'bg-green-500/15 text-green-400 border border-green-500/30';
  }
  function zoneStatusIcon(s) {
    if (s === 'leak')    return 'fa-triangle-exclamation';
    if (s === 'warning') return 'fa-circle-exclamation';
    return 'fa-circle-check';
  }

  const activeAlerts  = alerts.filter(a => a.status === 'active');
  const resolvedCount = alerts.filter(a => a.status === 'resolved').length;

  const sevCls = { CRITICAL:'bg-red-500/20 text-red-400', HIGH:'bg-orange-500/20 text-orange-400', MEDIUM:'bg-yellow-500/20 text-yellow-400', LOW:'bg-slate-700/60 text-slate-400' };

  const statCards = status ? [
    { label:'Online Sensors',     value: status.sensors_online,
      icon:'fa-tower-broadcast',  color:'text-green-400',   bg:'bg-green-500/10  border-green-500/20'  },
    { label:'Leaks Detected',     value: status.sensors_leaking,
      icon:'fa-droplet',          color:'text-red-400',     bg:'bg-red-500/10    border-red-500/20'    },
    { label:'No-Leak Confirmed',  value: Math.max(0, (status.sensors_online || 0) - (status.sensors_leaking || 0)),
      icon:'fa-shield-check',     color:'text-emerald-400', bg:'bg-emerald-500/10 border-emerald-500/20'},
    { label:'Offline Sensors',    value: status.sensors_offline,
      icon:'fa-circle-xmark',     color:'text-slate-400',   bg:'bg-slate-800     border-slate-700'     },
    { label:'Active Alerts',      value: status.active_alerts,
      icon:'fa-bell',             color:'text-yellow-400',  bg:'bg-yellow-500/10 border-yellow-500/20' },
    { label:'Critical / High',    value: `${status.critical_alerts ?? 0} / ${status.high_alerts ?? 0}`,
      icon:'fa-siren-on',         color:'text-orange-400',  bg:'bg-orange-500/10 border-orange-500/20' },
  ] : [];

  const ttStyle = { background:'#0f172a', border:'1px solid #1e293b', borderRadius:'8px', fontSize:'11px', color:'#94a3b8' };

  return (
    <div className="flex flex-col gap-5">

      {/* ── Detection Summary ── */}
      <section>
        <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <i className="fa-solid fa-chart-pie text-indigo-400"></i> Detection Summary
          <span className="text-[10px] text-slate-500 font-normal">· live — refreshes every 3 s</span>
          {!status && <span className="text-[10px] text-slate-500 animate-pulse">Loading…</span>}
        </h2>
        <div className="grid grid-cols-6 gap-3">
          {statCards.map((c, i) => (
            <div key={i} className={`border rounded-xl p-4 flex flex-col gap-2 ${c.bg}`}>
              <div className="flex justify-between items-start">
                <i className={`fa-solid ${c.icon} ${c.color} text-sm`}></i>
                <span className="text-2xl font-extrabold text-white">{c.value ?? '—'}</span>
              </div>
              <p className="text-[11px] font-medium text-slate-400 leading-tight">{c.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Confidence History + Zone Risk Chart ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Peak confidence over time */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-chart-line text-cyan-400"></i> Peak Confidence Over Time
            <span className="text-[10px] bg-cyan-500/15 text-cyan-300 px-2 py-0.5 rounded font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block"></span>Live
            </span>
          </h3>
          <div style={{ height:'200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top:4, right:8, left:-15, bottom:0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="t" tickFormatter={v => new Date(v).toLocaleTimeString()} tick={{ fill:'#475569', fontSize:9 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 1]} tickFormatter={v => `${(v*100).toFixed(0)}%`} tick={{ fill:'#475569', fontSize:9 }} />
                <Tooltip contentStyle={ttStyle} formatter={(v) => [`${(v*100).toFixed(1)}%`, 'Confidence']} labelFormatter={l => new Date(l).toLocaleTimeString()} />
                <Line type="monotone" dataKey="conf" name="Peak Confidence" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Zone risk bar chart */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-chart-bar text-orange-400"></i> Risk Score by Zone
          </h3>
          <div style={{ height:'200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={zoneList} layout="vertical" margin={{ top:4, right:16, left:4, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill:'#475569', fontSize:9 }} />
                <YAxis type="category" dataKey="id" tick={{ fill:'#94a3b8', fontSize:10 }} width={28} />
                <Tooltip contentStyle={ttStyle} formatter={(v, n, p) => [`${v}%`, 'Risk Score']} labelFormatter={l => zones[l]?.name || l} />
                <Bar dataKey="risk" radius={[0,4,4,0]} maxBarSize={18}>
                  {zoneList.map((z, i) => <Cell key={i} fill={riskColor(z.risk)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Zone Status Grid ── */}
      <section>
        <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <i className="fa-solid fa-map-location-dot text-cyan-400"></i> Zone Status
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {zoneList.map(z => (
            <div key={z.id} className={`bg-slate-900 rounded-xl border p-4 transition-all duration-300 ${
              z.status === 'leak' ? 'border-red-500/40 shadow-red-500/10 shadow-lg'
              : z.status === 'warning' ? 'border-yellow-500/30' : 'border-slate-800'}`}>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{z.id} · Jordan</p>
                  <h3 className="font-bold text-white text-[13px] leading-tight">{z.name}</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">{(z.pipes || []).join('  ·  ')}</p>
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${zoneBadgeCls(z.status)}`}>
                  <i className={`fa-solid ${zoneStatusIcon(z.status)} text-[9px]`}></i>
                  {z.status === 'leak' ? 'LEAK' : z.status === 'warning' ? 'WARNING' : 'NORMAL'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] mb-3">
                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                  <p className="text-slate-500">Total</p>
                  <p className="text-white font-bold font-mono text-sm">{z.sensors_total}</p>
                </div>
                <div className={`rounded-lg p-2 text-center ${z.sensors_leaking > 0 ? 'bg-red-500/10' : 'bg-slate-800/50'}`}>
                  <p className="text-slate-500">Leaking</p>
                  <p className={`font-bold font-mono text-sm ${z.sensors_leaking > 0 ? 'text-red-400' : 'text-green-400'}`}>{z.sensors_leaking}</p>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-2 text-center">
                  <p className="text-slate-500">Offline</p>
                  <p className="text-slate-400 font-bold font-mono text-sm">{z.sensors_offline}</p>
                </div>
              </div>
              {/* Risk bar */}
              <div>
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Risk Score</span>
                  <span className="font-bold" style={{ color: riskColor(z.risk) }}>
                    {riskLabel(z.risk)} · {z.risk}%
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div className="h-1.5 rounded-full transition-all duration-700"
                       style={{ width: `${z.risk}%`, backgroundColor: riskColor(z.risk) }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Active Leak Locations ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-location-crosshairs text-red-400"></i> Active Leak Locations
            {activeAlerts.length > 0 && (
              <span className="bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">
                {activeAlerts.length} ACTIVE
              </span>
            )}
            {resolvedCount > 0 && (
              <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded text-[10px] font-semibold">
                {resolvedCount} resolved
              </span>
            )}
          </h2>
          <span className="text-[11px] text-slate-500 font-mono">Auto-refreshes every 3 s</span>
        </div>

        {activeAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
              <i className="fa-solid fa-shield-check text-green-400 text-xl"></i>
            </div>
            <p className="text-sm font-semibold text-green-400">No Active Leaks Detected</p>
            <p className="text-[11px] text-slate-500">All monitored pipes are operating within normal parameters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left">
              <thead className="bg-slate-950 text-[10px] text-slate-500 uppercase tracking-widest sticky top-0">
                <tr>
                  <th className="py-2 px-3 font-semibold">Alert ID</th>
                  <th className="py-2 px-3 font-semibold">Sensor</th>
                  <th className="py-2 px-3 font-semibold">Zone / Location</th>
                  <th className="py-2 px-3 font-semibold">Pipe</th>
                  <th className="py-2 px-3 font-semibold">Material</th>
                  <th className="py-2 px-3 font-semibold">Depth</th>
                  <th className="py-2 px-3 font-semibold">AI Confidence</th>
                  <th className="py-2 px-3 font-semibold">Severity</th>
                  <th className="py-2 px-3 font-semibold">Flow</th>
                  <th className="py-2 px-3 font-semibold">Pressure</th>
                  <th className="py-2 px-3 font-semibold">GPS Coords</th>
                  <th className="py-2 px-3 font-semibold">Detected</th>
                </tr>
              </thead>
              <tbody>
                {activeAlerts.map(a => {
                  const conf = Math.round((a.confidence || 0) * 100);
                  const confColor = conf >= 90 ? 'text-red-400' : conf >= 75 ? 'text-orange-400' : 'text-yellow-400';
                  const ts = new Date(a.timestamp);
                  return (
                    <tr key={a.id} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 px-3 font-mono text-[11px] text-cyan-400">{a.id}</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-300">{a.sensor_id}</td>
                      <td className="py-2 px-3 text-[11px]">
                        <span className="text-white font-semibold">{a.zone_name}</span>
                        <span className="block text-slate-500 text-[10px]">{a.zone}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-300">{a.pipe}</td>
                      <td className="py-2 px-3 text-[11px] text-slate-400">{a.material}</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-300">{a.depth_m} m</td>
                      <td className={`py-2 px-3 font-mono text-[13px] font-extrabold ${confColor}`}>{conf}%</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sevCls[a.severity] || sevCls.LOW}`}>{a.severity}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-300">{a.flow_lps} L/s</td>
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-300">{a.pressure_bar} bar</td>
                      <td className="py-2 px-3 font-mono text-[10px] text-slate-500">
                        {a.lat?.toFixed(4)}°N<br/>{a.lon?.toFixed(4)}°E
                      </td>
                      <td className="py-2 px-3 text-[10px] text-slate-500 font-mono">{ts.toLocaleTimeString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── ML Pipeline & Model Info ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <i className="fa-solid fa-brain text-indigo-400"></i> Signal Processing Pipeline & ML Model
        </h2>
        <div className="grid grid-cols-2 gap-8">

          {/* DSP pipeline steps */}
          <div>
            <p className="text-[11px] font-semibold text-slate-400 mb-3 uppercase tracking-wider">DSP Pipeline — Accelerometer</p>
            <div className="flex flex-col gap-0">
              {[
                { step:'1', label:'Load Signal',      desc:'PCB 333B50 CSV → Value [m/s²] · cap at 240 000 samples', icon:'fa-file-csv',    color:'text-slate-300'   },
                { step:'2', label:'Detrend',           desc:'scipy.signal.detrend — removes DC offset & linear trend', icon:'fa-sliders',     color:'text-blue-400'    },
                { step:'3', label:'Bandpass Filter',   desc:'4th-order Butterworth · 10–5 000 Hz · filtfilt',         icon:'fa-wave-square', color:'text-cyan-400'    },
                { step:'4', label:'Hann-windowed FFT', desc:'1-second windows, 50% overlap → magnitude spectrum',     icon:'fa-chart-area',  color:'text-purple-400'  },
                { step:'5', label:'Feature Extraction',desc:'20 features: time-domain + frequency + band energy',     icon:'fa-microchip',   color:'text-green-400'   },
                { step:'6', label:'Classify',          desc:'ExtraTreesClassifier → Leak (1) or No-Leak (0)',         icon:'fa-circle-nodes','color':'text-indigo-400' },
              ].map((s, i, arr) => (
                <div key={s.step} className="flex items-start gap-3">
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-300 shrink-0">{s.step}</div>
                    {i < arr.length - 1 && <div className="w-px bg-slate-800" style={{ height:'20px' }}></div>}
                  </div>
                  <div className="pb-3">
                    <p className={`text-[12px] font-semibold ${s.color} flex items-center gap-1.5`}>
                      <i className={`fa-solid ${s.icon} text-[10px]`}></i>{s.label}
                    </p>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Model metrics */}
          <div>
            <p className="text-[11px] font-semibold text-slate-400 mb-3 uppercase tracking-wider">Model Metrics — Held-out Test Set</p>
            <div className="flex flex-col gap-2">
              {[
                { label:'Model',                 value:'ExtraTreesClassifier',    color:'text-indigo-300' },
                { label:'Estimators',            value:'600 trees',               color:'text-slate-300'  },
                { label:'Features',              value:'20 (time + freq + bands)', color:'text-slate-300'  },
                { label:'Train / Test Split',    value:'File-level · 80 / 20',    color:'text-cyan-300'   },
                { label:'Test Accuracy',         value:'80.51 %',                 color:'text-green-400'  },
                { label:'Leak Recall',           value:'94 %',                    color:'text-green-400'  },
                { label:'No-Leak Precision',     value:'85 %',                    color:'text-green-400'  },
                { label:'Weighted F1',           value:'79.58 %',                 color:'text-yellow-400' },
                { label:'ROC-AUC',               value:'80.27 %',                 color:'text-blue-400'   },
                { label:'Average Precision',     value:'81.85 %',                 color:'text-blue-400'   },
                { label:'Top Feature',           value:'zero_cross',              color:'text-purple-300' },
                { label:'#2 Feature',            value:'band_low_rms',            color:'text-purple-300' },
                { label:'#3 Feature',            value:'band_low',               color:'text-purple-300' },
                { label:'Sensor Type',           value:'PCB 333B50 · 25.6 kHz',  color:'text-slate-400'  },
              ].map(r => (
                <div key={r.label} className="flex justify-between text-[11px] border-b border-slate-800/50 pb-1.5">
                  <span className="text-slate-500">{r.label}</span>
                  <span className={`font-semibold font-mono ${r.color}`}>{r.value}</span>
                </div>
              ))}
            </div>

            {/* Feature importance mini-bars */}
            <div className="mt-4">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Feature Importance (Top 5)</p>
              {[
                { name:'zero_cross',    pct:10.2 },
                { name:'band_low_rms',  pct: 7.5 },
                { name:'band_low',      pct: 7.4 },
                { name:'spec_rolloff',  pct: 6.5 },
                { name:'spec_centroid', pct: 6.4 },
              ].map(f => (
                <div key={f.name} className="mb-1.5">
                  <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                    <span className="font-mono">{f.name}</span>
                    <span>{f.pct}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1">
                    <div className="h-1 rounded-full bg-indigo-500 transition-all duration-700" style={{ width:`${f.pct * 5}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}

// ── AI Inference Page ──────────────────────────────────
function InferencePage() {
  const [ports,        setPorts]        = useState([]);
  const [selPort,      setSelPort]      = useState('COM4');
  const [serialStatus, setSerialStatus] = useState({
    connected: false, port: null, error: null, sample_count: 0, last_ts: null,
  });
  const [ch1Data, setCh1Data] = useState(null);
  const [ch2Data, setCh2Data] = useState(null);
  const esRef = useRef(null);

  // Load available ports on mount
  useEffect(() => {
    fetch('/api/serial/ports')
      .then(r => r.json())
      .then(d => {
        const list = d.ports || [];
        setPorts(list);
        if (list.length > 0) setSelPort(list[0].port);
      })
      .catch(() => {});
  }, []);

  // Poll serial status every 5 s (drives progress bar only; SSE handles connection/error updates)
  useInterval(() => {
    fetch('/api/serial/status')
      .then(r => r.json())
      .then(d => setSerialStatus(prev =>
        // only update if something actually changed to avoid spurious re-renders
        (prev.sample_count === d.sample_count && prev.connected === d.connected && prev.error === d.error)
          ? prev
          : d
      ))
      .catch(() => {});
  }, 5000);

  // Subscribe to inference SSE
  useEffect(() => {
    const es = new EventSource('/stream/inference');
    esRef.current = es;
    es.addEventListener('inference', (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.serial) setSerialStatus(prev => ({ ...prev, ...d.serial }));
        if (d.ch1)    setCh1Data(d.ch1);
        if (d.ch2)    setCh2Data(d.ch2);
      } catch (_) {}
    });
    es.onerror = () => {};
    return () => { es.close(); };
  }, []);

  async function connect() {
    const r = await fetch(`/api/serial/connect?port=${encodeURIComponent(selPort)}`, { method: 'POST' });
    const d = await r.json();
    if (!d.ok) alert(d.message || 'Connection failed');
  }
  async function disconnect() {
    await fetch('/api/serial/disconnect', { method: 'POST' });
    setCh1Data(null);
    setCh2Data(null);
  }

  const isConn = serialStatus.connected;
  const ttStyle = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '11px', color: '#94a3b8' };

  function PredictionBadge({ prediction, confidence, p_leak, p_no_leak, model_loaded }) {
    if (!model_loaded) {
      return (
        <div className="flex flex-col items-center justify-center gap-1 py-2">
          <i className="fa-solid fa-circle-xmark text-slate-600 text-2xl"></i>
          <p className="text-[10px] text-slate-500 text-center">Model not loaded</p>
        </div>
      );
    }
    if (prediction === null || prediction === undefined) {
      return (
        <div className="flex flex-col items-center justify-center gap-1 py-2">
          <i className="fa-solid fa-hourglass-half text-slate-600 text-2xl animate-spin"></i>
          <p className="text-[10px] text-slate-500">Collecting samples…</p>
        </div>
      );
    }
    const isLeak = prediction === 1;
    const pct    = Math.round((confidence || 0) * 100);
    return (
      <div className={`rounded-xl border p-3 flex flex-col items-center gap-2 min-w-[130px] ${
        isLeak ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/25'}`}>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl border-2 ${
          isLeak ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-green-500/15 border-green-500 text-green-400'}`}>
          <i className={`fa-solid ${isLeak ? 'fa-triangle-exclamation' : 'fa-shield-check'}`}></i>
        </div>
        <p className={`text-xl font-extrabold ${isLeak ? 'text-red-400' : 'text-green-400'}`}>
          {isLeak ? 'LEAK' : 'NO LEAK'}
        </p>
        <p className={`text-2xl font-mono font-extrabold -mt-1 ${isLeak ? 'text-red-300' : 'text-green-300'}`}>{pct}%</p>
        <div className="w-full space-y-1">
          {[
            { label: 'P(No Leak)', val: p_no_leak, color: 'bg-green-500', textColor: 'text-green-400' },
            { label: 'P(Leak)',    val: p_leak,    color: 'bg-red-500',   textColor: 'text-red-400'   },
          ].map(row => (
            <div key={row.label}>
              <div className="flex justify-between text-[9px] mb-0.5">
                <span className={row.textColor}>{row.label}</span>
                <span className={`${row.textColor} font-mono`}>{Math.round((row.val || 0) * 100)}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1">
                <div className={`h-1 rounded-full ${row.color} transition-all duration-500`}
                     style={{ width: `${Math.round((row.val || 0) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function ChannelPanel({ chNum, data, accentColor }) {
    const { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
            Tooltip, ResponsiveContainer, Cell } = Recharts;

    if (!data) {
      const collected = serialStatus.sample_count % 500 || (serialStatus.sample_count > 0 ? 500 : 0);
      const pct       = Math.min(Math.round((collected / 500) * 100), 100);
      const secsLeft  = Math.ceil((500 - collected) / 50);
      return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col items-center justify-center gap-4 min-h-96">
          <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
            <i className="fa-solid fa-satellite-dish text-slate-600 text-xl animate-pulse"></i>
          </div>
          <div className="text-center">
            <p className="text-[12px] text-slate-400 font-semibold">
              CH{chNum} — {chNum === 1 ? 'Building M · ADXL345 #1' : 'Building C · ADXL345 #2'}
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              {isConn ? `Collecting 10 s window… result in ~${secsLeft}s` : 'Connect ESP32 to start inference'}
            </p>
          </div>
          {isConn && (
            <div className="w-48 flex flex-col gap-1">
              <div className="w-full bg-slate-800 rounded-full h-2">
                <div className="h-2 rounded-full bg-indigo-500 transition-all duration-1000"
                     style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-[9px] text-slate-600 font-mono">
                <span>{collected} / 500 samples</span>
                <span>{pct}%</span>
              </div>
            </div>
          )}
        </div>
      );
    }

    const isLeak   = data.prediction === 1;
    const statusCls = data.ch_status === 'ACTIVITY_DETECTED' ? 'text-red-400 animate-pulse'
                    : data.ch_status === 'MONITORING'        ? 'text-cyan-400'
                    : 'text-slate-500';

    // Waveform data
    const waveData = (data.raw || []).map((v, i) => ({
      i, raw: v, filtered: data.filtered ? data.filtered[i] : undefined,
    }));

    // Feature data for bar chart — absolute value, sorted by magnitude
    const featData = data.features
      ? Object.entries(data.features)
          .filter(([k]) => k !== 'sensor_type')
          .map(([k, v]) => ({ name: k, absVal: Math.abs(Number(v)), rawVal: Number(v) }))
      : [];

    const maxAbsVal = Math.max(...featData.map(f => f.absVal), 1e-10);
    const normalizedFeat = featData.map(f => ({
      ...f,
      normPct: (f.absVal / maxAbsVal) * 100,
    }));

    const TOP5 = ['zero_cross', 'band_low_rms', 'band_low', 'spec_rolloff', 'spec_centroid'];

    return (
      <div className="flex flex-col gap-3">

        {/* Header */}
        <div className={`bg-slate-900 border rounded-xl px-5 pt-4 pb-4 flex justify-between items-start gap-4 ${
          isLeak ? 'border-red-500/40 shadow-red-500/10 shadow-lg' : 'border-slate-800'}`}>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              Channel {chNum} · {chNum === 1 ? 'Building M — ADXL345 #1' : 'Building C — ADXL345 #2'}
            </p>
            <p className={`text-[11px] font-semibold mt-0.5 ${statusCls}`}>
              {data.ch_status}
              {data.ts && <span className="text-slate-600 font-normal ml-2">{new Date(data.ts).toLocaleTimeString()}</span>}
            </p>
          </div>
          <PredictionBadge
            prediction={data.prediction}
            confidence={data.confidence}
            p_leak={data.p_leak}
            p_no_leak={data.p_no_leak}
            model_loaded={data.model_loaded}
          />
        </div>

        {/* Raw + Filtered Waveform */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <p className="text-xs font-bold text-white flex items-center gap-2">
              <i className="fa-solid fa-wave-square text-cyan-400"></i>
              Signal Waveform · CH{chNum}
              <span className="text-[9px] text-slate-500 font-normal">{(data.raw || []).length} samples @ ~50 Hz</span>
            </p>
            <div className="flex gap-3 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>Raw</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block"></span>Filtered</span>
            </div>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={waveData} margin={{ top: 2, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="i" tick={{ fill: '#475569', fontSize: 8 }} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#475569', fontSize: 8 }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={ttStyle} formatter={(v) => [v !== undefined ? v.toFixed(5) : '—', '']} />
                <Line type="monotone" dataKey="raw"      name="Raw (g)"     stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="filtered" name="Filtered (g)" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Feature Bar Chart */}
        {normalizedFeat.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <p className="text-xs font-bold text-white flex items-center gap-2">
                <i className="fa-solid fa-chart-bar text-indigo-400"></i>
                Extracted Features · CH{chNum}
              </p>
              <span className="text-[9px] bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded font-semibold">
                19 features · normalised height
              </span>
            </div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={normalizedFeat} margin={{ top: 2, right: 4, left: -20, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 7 }}
                         angle={-45} textAnchor="end" interval={0} />
                  <YAxis tick={{ fill: '#475569', fontSize: 8 }} domain={[0, 100]}
                         tickFormatter={v => `${v}%`} />
                  <Tooltip
                    contentStyle={ttStyle}
                    formatter={(_, __, props) => [props.payload.rawVal.toExponential(3), props.payload.name]} />
                  <Bar dataKey="normPct" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                    {normalizedFeat.map((f, i) => (
                      <Cell key={i}
                        fill={TOP5.includes(f.name) ? '#818cf8'
                              : f.normPct > 50     ? '#22d3ee'
                              :                      '#334155'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Feature value grid */}
            <div className="grid grid-cols-5 gap-1">
              {normalizedFeat.map(f => (
                <div key={f.name} className={`rounded px-1.5 py-1 text-center border ${
                  TOP5.includes(f.name)
                    ? 'bg-indigo-500/10 border-indigo-500/20'
                    : 'bg-slate-800/40 border-slate-700/20'}`}>
                  <p className="text-[8px] text-slate-500 font-mono truncate">{f.name}</p>
                  <p className={`text-[10px] font-mono font-bold ${
                    TOP5.includes(f.name) ? 'text-indigo-300' : 'text-slate-300'}`}>
                    {Math.abs(f.rawVal) >= 1000
                      ? f.rawVal.toExponential(1)
                      : f.rawVal.toFixed(3)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">

      {/* ── Connection panel ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-indigo-600/15 p-3 rounded-xl border border-indigo-600/20">
              <i className="fa-solid fa-brain text-indigo-400 text-xl"></i>
            </div>
            <div>
              <h2 className="font-bold text-white text-base flex flex-wrap items-center gap-2">
                Real-Time AI Inference
                <span className="text-[10px] bg-indigo-500/15 text-indigo-300 px-2 py-0.5 rounded font-semibold">ExtraTreesClassifier</span>
                <span className="text-[10px] bg-purple-500/15 text-purple-300 px-2 py-0.5 rounded font-semibold">20 DSP features</span>
                <span className="text-[10px] bg-cyan-500/15 text-cyan-300 px-2 py-0.5 rounded font-semibold">10 s window · result every 10 s</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Python backend reads ESP32 serial · collects 500 samples (10 s) · bandpass + FFT · classify · result pushed via SSE
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <select
              title="Serial port"
              value={selPort}
              onChange={e => setSelPort(e.target.value)}
              disabled={isConn}
              className="bg-slate-800 border border-slate-700 text-slate-300 text-[12px] font-mono px-3 py-2 rounded-lg focus:outline-none focus:border-indigo-500 disabled:opacity-50">
              {ports.length > 0
                ? ports.map(p => <option key={p.port} value={p.port}>{p.port} — {p.description}</option>)
                : <option value={selPort}>{selPort}</option>}
            </select>

            {!isConn ? (
              <button onClick={connect}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-indigo-600/20">
                <i className="fa-solid fa-plug"></i> Connect &amp; Infer
              </button>
            ) : (
              <button onClick={disconnect}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors">
                <i className="fa-solid fa-plug-circle-xmark"></i> Disconnect
              </button>
            )}

            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold ${
              isConn
                ? 'bg-green-500/15 border-green-500/30 text-green-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              <span className={`w-2 h-2 rounded-full inline-block ${isConn ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`}></span>
              {isConn
                ? `${serialStatus.port} · ${serialStatus.sample_count} samples`
                : 'Disconnected'}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 text-[11px] text-amber-300/90">
          <i className="fa-solid fa-triangle-exclamation text-amber-400 mt-0.5 shrink-0"></i>
          <span>
            Close Arduino Serial Monitor and the <strong>Live Monitor</strong> WebSerial connection before using this page.
            The Python backend holds exclusive access to the serial port.
          </span>
        </div>

        {serialStatus.error && (
          <div className="mt-2 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-300">
            <i className="fa-solid fa-circle-xmark text-red-400 shrink-0"></i>
            {serialStatus.error}
          </div>
        )}
      </section>

      {/* ── Channel panels ── */}
      <div className="grid grid-cols-2 gap-4">
        <ChannelPanel chNum={1} data={ch1Data} accentColor="#22d3ee" />
        <ChannelPanel chNum={2} data={ch2Data} accentColor="#a855f7" />
      </div>

      {/* ── Info footer ── */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-500 leading-relaxed">
        <i className="fa-solid fa-circle-info text-blue-400 mr-2"></i>
        <strong className="text-slate-400">Note:</strong>{' '}
        Model was trained on 25 641 Hz accelerometer data. The ESP32 streams at ~50 Hz;
        500 samples (10 s) are buffered then resampled (scipy.signal.resample) to 25 641 samples before feature extraction.
        Prediction updates every ~10 s (no overlap). Spectral features above 25 Hz (the Nyquist of the stream) will be near zero —
        time-domain features and low-frequency bands remain meaningful.
        For highest accuracy, retrain the model on data streamed at 400 Hz ODR (burst mode).
      </div>
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────
function App() {
  const [activeId, setActiveId]     = useState(1);
  const [isRunning, setIsRunning]   = useState(true);
  const [now, setNow]               = useState(new Date());
  const [showToast, setShowToast]   = useState(false);
  const [logFilter, setLogFilter]   = useState('All');
  const [waveData, setWaveData]     = useState(Array(80).fill(0));
  const phaseRef = useRef(0);
  const [page, setPage] = useState('dashboard');

  const [channels, setChannels] = useState([
    { id:1, pipeLabel:'Pipe Line A', type:'Accelerometer',   status:'Normal',        confidence:96, rms:0.12, history: Array(20).fill(0) },
    { id:2, pipeLabel:'Pipe Line B', type:'Vibration Sensor',status:'Leak Detected',  confidence:94, rms:0.85, history: Array(20).fill(0) },
    { id:3, pipeLabel:'Pipe Line C', type:'Accelerometer',   status:'Normal',        confidence:91, rms:0.14, history: Array(20).fill(0) },
    { id:4, pipeLabel:'Pipe Line D', type:'Vibration Sensor',status:'Monitoring',    confidence:87, rms:0.35, history: Array(20).fill(0) },
  ]);

  const [eventLog, setEventLog] = useState([
    { id:1, time: new Date(Date.now()-12000), channel:'CH2', event:'Leak signature detected',  confidence:'94%', action:'Alert generated' },
    { id:2, time: new Date(Date.now()-21000), channel:'CH4', event:'Monitoring cycle started', confidence:'87%', action:'Scanning' },
    { id:3, time: new Date(Date.now()-35000), channel:'CH1', event:'Normal vibration pattern', confidence:'96%', action:'No action' },
    { id:4, time: new Date(Date.now()-48000), channel:'CH3', event:'Normal vibration pattern', confidence:'91%', action:'No action' },
  ]);

  // Clock
  useInterval(() => setNow(new Date()), 1000);

  // Channel scanner (every 3 s)
  useInterval(() => {
    if (!isRunning) return;
    setActiveId(prev => {
      const next = prev === 4 ? 1 : prev + 1;

      setChannels(chs => chs.map(ch => {
        const jitter = Math.random() > 0.5 ? 1 : -1;
        const newConf = ch.id === 2
          ? 92 + Math.floor(Math.random() * 6)
          : Math.max(80, Math.min(99, ch.confidence + jitter));

        const newRms = ch.id === 2
          ? 0.7 + Math.random() * 0.3
          : ch.id === 4
          ? 0.25 + Math.random() * 0.2
          : 0.08 + Math.random() * 0.1;

        const newStatus =
          ch.id === 2 ? 'Leak Detected'
          : ch.id === next ? 'Monitoring'
          : 'Normal';

        return { ...ch, confidence: newConf, rms: newRms, status: newStatus };
      }));

      const evConf = 90 + Math.floor(Math.random() * 9);
      const newEv = {
        id: Date.now(),
        time: new Date(),
        channel: `CH${next}`,
        event: next === 2 ? 'Leak signature detected' : next === 4 ? 'Monitoring cycle started' : 'Normal vibration pattern',
        confidence: `${evConf}%`,
        action: next === 2 ? 'Alert generated' : next === 4 ? 'Scanning' : 'No action',
      };

      setEventLog(lg => [newEv, ...lg].slice(0, 30));
      if (next === 2) { setShowToast(true); setTimeout(() => setShowToast(false), 3500); }

      return next;
    });
  }, 3000);

  // Waveform animation
  useInterval(() => {
    if (!isRunning) return;
    phaseRef.current += 0.18;
    const p = phaseRef.current;
    setWaveData(prev => {
      const next = [...prev.slice(1)];
      let v = 0;
      if (activeId === 2) v = Math.sin(p) * 55 + (Math.random() - 0.5) * 45;
      else if (activeId === 4) v = Math.sin(p * 0.6) * 22 + (Math.random() - 0.5) * 14;
      else v = Math.sin(p * 0.25) * 6 + (Math.random() - 0.5) * 5;
      next.push(v);
      return next;
    });

    // Update sparklines
    setChannels(chs => chs.map(ch => {
      let v = 0;
      if (ch.id === 2) v = Math.sin(p * 1.1) * 55 + (Math.random()-0.5)*40;
      else if (ch.id === 4) v = Math.sin(p * 0.6) * 20 + (Math.random()-0.5)*12;
      else v = Math.sin(p * 0.25) * 5 + (Math.random()-0.5)*4;
      return { ...ch, history: [...ch.history.slice(1), v] };
    }));
  }, 60);

  const filteredLog = eventLog.filter(ev => {
    if (logFilter === 'Leaks')    return ev.action === 'Alert generated';
    if (logFilter === 'Warnings') return ev.action === 'Scanning';
    if (logFilter === 'Normal')   return ev.action === 'No action';
    return true;
  });

  const overviewCards = [
    { label:'Total Channels',      value:'4',       icon:'fa-layer-group',       color:'text-blue-400' },
    { label:'Active Sensors',      value:'4',       icon:'fa-tower-broadcast',   color:'text-cyan-400' },
    { label:'Current Alerts',      value:'1',       icon:'fa-triangle-exclamation', color:'text-red-400' },
    { label:'Hub Status',          value:'Online',  icon:'fa-server',            color:'text-green-400' },
    { label:'MUX Scan Rate',       value:'1ch/3s',  icon:'fa-retweet',           color:'text-purple-400' },
    { label:'AI Confidence (Avg)', value:'~93%',    icon:'fa-brain',             color:'text-indigo-400' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 flex flex-col gap-4">

      {/* ── NAV BAR ── */}
      <header className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-5 py-3 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-2.5 rounded-xl shadow-blue-600/30 shadow-lg">
            <i className="fa-solid fa-water text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white leading-none">HydroSense Dashboard</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">4-Channel AI-IoT Leak Detection Simulation</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-green-500/10 px-3 py-1.5 rounded-full border border-green-500/30">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block"></span>
            <span className="text-[11px] font-semibold text-green-400">ESP32 Connected</span>
          </div>
          <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1.5 rounded-full border border-blue-500/30">
            <i className="fa-solid fa-microchip text-blue-400 text-[11px]"></i>
            <span className="text-[11px] font-bold text-blue-400 tracking-wide">SIMULATION MODE</span>
          </div>
          <div className="text-right">
            <div className="text-sm font-mono text-slate-300 leading-none">{now.toLocaleTimeString()}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{now.toLocaleDateString()}</div>
          </div>
        </div>
      </header>

      {/* ── PAGE NAVIGATION TABS ── */}
      <div className="flex gap-2">
        <button onClick={() => setPage('dashboard')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            page === 'dashboard'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
          }`}>
          <i className="fa-solid fa-gauge-high"></i> Dashboard
        </button>
        <button onClick={() => setPage('live')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            page === 'live'
              ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
          }`}>
          <i className="fa-solid fa-satellite-dish"></i> Live Monitor
          {page === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse inline-block"></span>}
        </button>
        <button onClick={() => setPage('analysis')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            page === 'analysis'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
          }`}>
          <i className="fa-solid fa-shield-halved"></i> Risk &amp; Analysis
          {page === 'analysis' && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse inline-block"></span>}
        </button>
        <button onClick={() => setPage('inference')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            page === 'inference'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800 border border-slate-800'
          }`}>
          <i className="fa-solid fa-brain"></i> AI Inference
          {page === 'inference' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse inline-block"></span>}
        </button>
      </div>

      {/* ── LIVE MONITOR PAGE ── */}
      {page === 'live' && <LiveMonitor />}

      {/* ── RISK & ANALYSIS PAGE ── */}
      {page === 'analysis' && <AnalysisPage />}

      {/* ── AI INFERENCE PAGE ── */}
      {page === 'inference' && <InferencePage />}

      {page === 'dashboard' && <>
      {/* ── OVERVIEW ── */}
      <section className="grid grid-cols-6 gap-3">
        {overviewCards.map((m, i) => (
          <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex justify-between items-start">
              <div className="p-1.5 bg-slate-800 rounded-lg">
                <i className={`fa-solid ${m.icon} ${m.color} text-sm`}></i>
              </div>
              <span className="text-xl font-extrabold text-white">{m.value}</span>
            </div>
            <p className="text-[11px] font-medium text-slate-400 leading-tight">{m.label}</p>
          </div>
        ))}
      </section>

      {/* ── CHANNEL CARDS ── */}
      <section className="grid grid-cols-4 gap-4">
        {channels.map(ch => (
          <ChannelCard key={ch.id} ch={ch} isActive={activeId === ch.id} />
        ))}
      </section>

      {/* ── CHART + PANELS ── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Signal + Spectrogram */}
        <section className="col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="font-bold text-white text-sm">Live Acoustic / Vibration Signal</h2>
              <p className="text-[11px] text-slate-500">Real-time multiplexer telemetry · CH{activeId} active</p>
            </div>
            <div className="flex gap-1.5">
              {[1,2,3,4].map(n => (
                <button key={n} onClick={() => setActiveId(n)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${activeId === n ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                  CH{n}
                </button>
              ))}
            </div>
          </div>

          <div className="h-48 bg-slate-950 rounded-lg border border-slate-800 p-2 relative overflow-hidden">
            <WaveformChart data={waveData} channelId={activeId} />
            <span className="absolute bottom-1 right-2 text-[10px] font-mono text-slate-600">X: Time · Y: Amplitude</span>
          </div>

          <div className="h-16 bg-slate-950 rounded-lg border border-slate-800 p-2 overflow-hidden relative">
            <p className="absolute top-1 left-2 z-10 text-[10px] font-bold text-white drop-shadow">Frequency Energy / Spectrogram Preview</p>
            <Spectrogram channelId={activeId} />
            <span className="absolute bottom-1 right-2 text-[10px] text-slate-500 bg-slate-900/70 px-1 rounded z-10">
              {activeId === 2 ? '⚠ Leak signature detected (high-freq)' : 'Low-frequency background hum'}
            </span>
          </div>
        </section>

        {/* AI + Hub */}
        <div className="flex flex-col gap-4">
          <AIPanel channelId={activeId} />
          <HubPanel channelId={activeId} />
        </div>
      </div>

      {/* ── EVENT LOG ── */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-white text-sm flex items-center gap-2">
            <i className="fa-solid fa-list-ul text-slate-500"></i> Event Log & Alerts
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setIsRunning(r => !r)}
              className={`px-3 py-1.5 text-[11px] rounded font-semibold transition-colors ${isRunning ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-green-600 text-white hover:bg-green-500'}`}>
              <i className={`fa-solid fa-${isRunning ? 'pause' : 'play'} mr-1`}></i>
              {isRunning ? 'Pause Sim' : 'Start Sim'}
            </button>
            <button onClick={() => setEventLog([])}
              className="px-3 py-1.5 text-[11px] rounded bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors">
              <i className="fa-solid fa-trash-can mr-1"></i> Reset
            </button>
            <button className="px-3 py-1.5 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-500 shadow-blue-600/20 shadow transition-colors">
              <i className="fa-solid fa-file-arrow-down mr-1"></i> Export Report
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          {['All','Normal','Warnings','Leaks'].map(f => (
            <button key={f} onClick={() => setLogFilter(f)}
              className={`px-3 py-1 text-[11px] rounded-full border transition-colors ${logFilter === f ? 'bg-slate-700 border-slate-600 text-white' : 'border-slate-800 text-slate-500 hover:bg-slate-800'}`}>
              {f}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto max-h-60 border border-slate-800 rounded-lg">
          <table className="w-full text-left">
            <thead className="bg-slate-950 text-[10px] text-slate-500 uppercase tracking-widest sticky top-0">
              <tr>
                <th className="py-2 px-4 font-semibold">Time</th>
                <th className="py-2 px-4 font-semibold">Channel</th>
                <th className="py-2 px-4 font-semibold">Event</th>
                <th className="py-2 px-4 font-semibold border-l border-slate-800">Confidence</th>
                <th className="py-2 px-4 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredLog.map(ev => <EventRow key={ev.id} ev={ev} />)}
              {filteredLog.length === 0 && (
                <tr><td colSpan="5" className="py-6 text-center text-slate-500 text-[11px]">No events match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── TOAST ALERT ── */}
      <div className={`fixed bottom-5 right-5 z-50 bg-red-950 border border-red-500/60 rounded-xl p-4 shadow-2xl shadow-red-900/30 transition-all duration-500 ${showToast ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-3">
          <div className="bg-red-500/15 p-2 rounded-lg">
            <i className="fa-solid fa-triangle-exclamation text-red-400 text-lg"></i>
          </div>
          <div>
            <p className="font-bold text-red-400 text-sm leading-none">Leak Alert — CH2</p>
            <p className="text-[11px] text-red-200/60 mt-1">High-confidence leak signature detected on Pipe Line B.</p>
          </div>
        </div>
      </div>

      </>}

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
