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

// ── MAIN APP ───────────────────────────────────────────
function App() {
  const [activeId, setActiveId]     = useState(1);
  const [isRunning, setIsRunning]   = useState(true);
  const [now, setNow]               = useState(new Date());
  const [showToast, setShowToast]   = useState(false);
  const [logFilter, setLogFilter]   = useState('All');
  const [waveData, setWaveData]     = useState(Array(80).fill(0));
  const phaseRef = useRef(0);

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

    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
