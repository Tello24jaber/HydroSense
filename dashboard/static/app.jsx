const { useState, useEffect, useRef, useMemo } = React;

const API = "";

function App() {
  const [sensors, setSensors] = useState([]);
  const [status, setStatus] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [history, setHistory] = useState([]);

  // Filters
  const [zoneFilter, setZoneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const loadData = async () => {
    try {
      const [stReq, snReq, alReq, hiReq] = await Promise.all([
        fetch(`${API}/api/status`),
        fetch(`${API}/api/sensors`),
        fetch(`${API}/api/alerts?limit=100`),
        fetch(`${API}/api/signal-history`)
      ]);
      setStatus(await stReq.json());
      const snData = await snReq.json();
      setSensors(snData.sensors);
      const alData = await alReq.json();
      setAlerts(alData.alerts);
      const hiData = await hiReq.json();
      setHistory(hiData.history);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 5000);
    
    const es = new EventSource(`${API}/stream`);
    es.addEventListener("update", (e) => {
      const data = JSON.parse(e.data);
      if (data.sensors) {
        setSensors(prev => {
          let np = [...prev];
          data.sensors.forEach(patch => {
            const idx = np.findIndex(x => x.id === patch.id);
            if (idx >= 0) np[idx] = { ...np[idx], ...patch };
          });
          return np;
        });
      }
      if (data.alerts && data.alerts.length) {
         setAlerts(data.alerts); // Simple overwrite if alerts are updated
      }
      if (data.recent_history) {
         setHistory(prev => {
            const updated = [...prev, ...data.recent_history];
            return updated.slice(-120); 
         });
      }
    });

    return () => {
      clearInterval(iv);
      es.close();
    };
  }, []);

  const filteredSensors = useMemo(() => {
    return sensors.filter(s => {
      if (zoneFilter && s.zone !== zoneFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      return true;
    });
  }, [sensors, zoneFilter, statusFilter]);

  return (
    <div className="flex flex-col h-full bg-gray-950 text-gray-300 font-sans">
      <TopBar status={status} />
      <KPIStrip status={status} />
      
      <div className="flex flex-1 overflow-hidden p-2 gap-2 text-sm">
        <aside className="w-1/4 flex flex-col bg-gray-900 border border-gray-800 rounded-md">
          <div className="flex justify-between items-center bg-gray-800 px-3 py-2 border-b border-gray-700">
            <span className="font-semibold text-gray-100 flex items-center gap-2">
              <i className="fa-solid fa-tower-broadcast text-blue-500"></i> Sensors <span className="bg-gray-700 text-xs px-2 py-0.5 rounded-full">{filteredSensors.length}</span>
            </span>
            <div className="flex gap-1">
              <select title="Filter by Zone" aria-label="Zone Filter" className="bg-gray-700 text-gray-100 border border-gray-600 rounded px-1 py-0.5 text-xs" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                <option value="">All Zones</option>
                <option value="Z1">Z1 - Downtown</option>
                <option value="Z2">Z2 - Shmeisani</option>
                <option value="Z3">Z3 - Abdali</option>
                <option value="Z4">Z4 - Zarqa</option>
                <option value="Z5">Z5 - Irbid</option>
                <option value="Z6">Z6 - Aqaba</option>
              </select>
              <select title="Filter by Status" aria-label="Status Filter" className="bg-gray-700 text-gray-100 border border-gray-600 rounded px-1 py-0.5 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Status</option>
                <option value="online">Online</option>
                <option value="leak">Leak</option>
                <option value="offline">Offline</option>
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {filteredSensors.map(s => (
              <SensorItem key={s.id} sensor={s} />
            ))}
          </div>
        </aside>

        <section className="w-2/4 flex flex-col gap-2">
          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-md flex flex-col relative overflow-hidden">
             <div className="absolute top-2 left-2 z-20 bg-gray-800 border border-gray-700 text-gray-100 text-xs px-2 py-1 rounded shadow-md pointer-events-none">
                 <i className="fa-solid fa-map-location-dot"></i> Network Map
             </div>
             <MapComponent sensors={sensors} />
          </div>
          <div className="h-48 bg-gray-900 border border-gray-800 rounded-md p-2 flex flex-col">
             <div className="text-xs text-gray-400 mb-1 flex justify-between">
                <span><i className="fa-solid fa-wave-square text-blue-500"></i> Signal Confidence</span>
                <span className="flex gap-2">
                   <span className="text-green-400">Safe</span>
                   <span className="text-amber-400">Medium</span>
                   <span className="text-red-400">High</span>
                </span>
             </div>
             <div className="flex-1 relative">
                <SignalChart history={history} />
             </div>
          </div>
        </section>

        <aside className="w-1/4 flex flex-col bg-gray-900 border border-gray-800 rounded-md overflow-hidden">
          <div className="flex justify-between items-center bg-gray-800 px-3 py-2 border-b border-gray-700">
            <span className="font-semibold text-gray-100 flex items-center gap-2">
              <i className="fa-solid fa-bell-ring text-red-500"></i> Alerts 
              {status.active_alerts > 0 && <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{status.active_alerts}</span>}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
            {alerts.filter(a => a.status === "active").map(a => (
              <AlertItem key={a.id} alert={a} />
            ))}
            {alerts.filter(a => a.status === "active").length === 0 && (
               <div className="text-center text-gray-500 py-4"><i className="fa-solid fa-check-circle text-green-500 mb-1 block text-lg"></i>All clear</div>
            )}
           </div>
        </aside>
      </div>
    </div>
  );
}

function TopBar({ status }) {
  const [time, setTime] = useState("");
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB", { hour12: false })), 1000);
    return () => clearInterval(iv);
  }, []);

  const hasCrit = status.critical_alerts > 0;
  const hasLeak = status.sensors_leaking > 0;

  return (
    <header className="h-12 bg-gray-900 border-b border-gray-800 flex justify-between items-center px-4">
      <div className="flex items-center gap-2 text-blue-500 font-bold text-lg">
        <i className="fa-solid fa-droplet"></i>
        <span className="text-gray-100 tracking-wider">HydroSense</span>
      </div>
      <div className="flex items-center gap-2">
        {hasCrit ? (
          <span className="bg-red-500/20 text-red-400 border border-red-500/50 px-3 py-1 rounded-full text-xs font-semibold animate-pulse flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-red-400"></span>
             {status.critical_alerts} CRITICAL LEAKS
          </span>
        ) : hasLeak ? (
          <span className="bg-amber-500/20 text-amber-400 border border-amber-500/50 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-amber-400"></span>
             {status.sensors_leaking} LEAK DETECTED
          </span>
        ) : (
          <span className="bg-green-500/20 text-green-400 border border-green-500/50 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-green-400"></span>
             ALL SYSTEMS NOMINAL
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
        <span><i className="fa-regular fa-clock mr-1"></i> {time}</span>
        <span className={status.model_loaded !== undefined ? "text-blue-400" : ""}><i className="fa-solid fa-satellite-dish mr-1"></i> {status.model_loaded !== undefined ? "Connected" : "Connecting..."}</span>
      </div>
    </header>
  );
}

function KPIStrip({ status }) {
  return (
    <div className="flex bg-gray-950 p-2 gap-2 shrink-0">
      <KPICard title="Sensors Online" val={status.sensors_online ?? '--'} icon="wifi" color="text-green-500" />
      <KPICard title="Active Leaks" val={status.sensors_leaking ?? '--'} icon="burst" color="text-amber-500" />
      <KPICard title="Open Alerts" val={status.active_alerts ?? '--'} icon="bell" color="text-red-400" />
      <KPICard title="Critical Alerts" val={status.critical_alerts ?? '--'} icon="skull-crossbones" color="text-red-500" />
      <KPICard title="Offline Sensors" val={status.sensors_offline ?? '--'} icon="plug-circle-xmark" color="text-gray-500" />
      <KPICard title="Network Uptime" val={(status.uptime_pct ?? '--') + '%'} icon="chart-line" color="text-blue-500" />
    </div>
  );
}

function KPICard({ title, val, icon, color }) {
  return (
    <div className="flex-1 bg-gray-900 border border-gray-800 rounded-md p-2 flex items-center gap-3 shadow-sm">
      <div className={`text-2xl ${color} bg-gray-800 w-10 h-10 flex items-center justify-center rounded`}><i className={`fa-solid fa-${icon}`}></i></div>
      <div className="flex flex-col">
        <span className="text-xl font-mono text-gray-100 leading-tight">{val}</span>
        <span className="text-xs text-gray-400 uppercase tracking-widest">{title}</span>
      </div>
    </div>
  );
}

function SensorItem({ sensor }) {
  const isLeak = sensor.status === "leak";
  const confPct = (sensor.confidence * 100).toFixed(1);
  return (
    <div className={`p-2 rounded border ${isLeak ? 'bg-red-500/10 border-red-500/30' : sensor.status === 'offline' ? 'bg-gray-800 border-gray-700 opacity-60' : 'bg-gray-800 hover:bg-gray-700 border-gray-700'} flex flex-col gap-1 transition-colors cursor-pointer`}>
      <div className="flex justify-between items-center">
        <span className="font-mono text-gray-200 font-semibold">{sensor.id}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${isLeak ? 'bg-red-500 text-white animate-pulse' : sensor.status === 'offline' ? 'bg-gray-700 text-gray-400' : 'bg-green-500/20 text-green-400'}`}>
          {sensor.status}
        </span>
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{sensor.zone_name}</span>
        <span className="font-mono">{sensor.flow_lps} lps</span>
      </div>
      {isLeak && (
        <div className="mt-1 w-full bg-gray-900 rounded-full h-1 relative overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-red-500 transition-all duration-300" style={{ width: `${sensor.confidence * 100}%` }}></div>
        </div>
      )}
    </div>
  );
}

function AlertItem({ alert }) {
   const clr = alert.severity === "CRITICAL" ? "border-red-500 bg-red-500/10" : "border-amber-500 bg-amber-500/10";
   const textClr = alert.severity === "CRITICAL" ? "text-red-500" : "text-amber-500";
   
   return (
      <div className={`p-2 border rounded-md shadow-sm flex flex-col gap-1 ${clr}`}>
         <div className="flex justify-between items-center">
            <span className={`text-xs font-bold ${textClr}`}><i className="fa-solid fa-triangle-exclamation mr-1"></i> {alert.severity} ALERT</span>
            <span className="text-[10px] text-gray-400">{new Date(alert.timestamp).toLocaleTimeString()}</span>
         </div>
         <div className="font-mono text-sm text-gray-100">{alert.sensor_id} Flow Anomaly</div>
         <div className="text-xs text-gray-300 bg-gray-900 p-1.5 rounded border border-gray-800 flex justify-between items-center mt-1">
             <span>Conf: {(alert.confidence * 100).toFixed(1)}%</span>
             <button className="text-[10px] bg-gray-700 hover:bg-gray-600 px-2 py-0.5 rounded text-gray-200 transition-colors" onClick={() => fetch(`${API}/api/alert/${alert.id}/ack`, {method:'POST'})}>ACK</button>
         </div>
      </div>
   );
}

function MapComponent({ sensors }) {
  const mapRef = useRef(null);
  const markersRef = useRef({});

  useEffect(() => {
    const m = L.map("leaflet-map-div", { center: [31.963158, 35.930359], zoom: 8, zoomControl: false });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }).addTo(m);
    L.control.zoom({ position: "topright" }).addTo(m);
    mapRef.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const m = mapRef.current;
    
    // add/update markers
    sensors.forEach(s => {
      const confClass = s.status === "leak" ? "text-red-400 font-bold" : "text-green-400";
      const html = `
        <div class="text-xs p-1 min-w-[150px]">
          <strong class="text-sm block mb-1 border-b border-gray-700 pb-1 text-gray-200">${s.id}</strong>
          <div class="flex justify-between mb-0.5"><span class="text-gray-400">Zone</span> <span class="text-gray-200">${s.zone_name}</span></div>
          <div class="flex justify-between mb-0.5"><span class="text-gray-400">Status</span> <span class="${confClass} uppercase">${s.status}</span></div>
          <div class="flex justify-between mb-0.5"><span class="text-gray-400">Flow</span> <span class="font-mono text-gray-300">${s.flow_lps} LPS</span></div>
        </div>`;

      if (markersRef.current[s.id]) {
         const icon = L.divIcon({ className: "", html: `<div class="map-marker ${s.status}" title="${s.id}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
         markersRef.current[s.id].setIcon(icon);
         markersRef.current[s.id].setLatLng([s.lat, s.lon]);
         markersRef.current[s.id].setPopupContent(html);
      } else {
         const icon = L.divIcon({ className: "", html: `<div class="map-marker ${s.status}" title="${s.id}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
         const marker = L.marker([s.lat, s.lon], { icon }).addTo(m);
         marker.bindPopup(html);
         markersRef.current[s.id] = marker;
      }
    });
  }, [sensors]);

  return <div id="leaflet-map-div" className="w-full h-full z-0"></div>;
}

function ChartWrapper({ history }) {
   const canvasRef = useRef(null);
   const chartRef = useRef(null);

   useEffect(() => {
      const ctx = canvasRef.current.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 120);
      grad.addColorStop(0, "rgba(47,129,247,0.35)");
      grad.addColorStop(1, "rgba(47,129,247,0.00)");

      chartRef.current = new Chart(ctx, {
         type: "line",
         data: { labels: [], datasets: [{ label: "Confidence", data: [], borderColor: "#2f81f7", backgroundColor: grad, borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4 }] },
         options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
            plugins: { legend: { display: false } },
            scales: {
               x: { display: false },
               y: { min: 0, max: 1, ticks: { callback: v => (v*100).toFixed(0)+'%' }, grid: { color: "#21262d" } }
            }
         }
      });
      return () => chartRef.current.destroy();
   }, []);

   useEffect(() => {
      if (!chartRef.current || !history.length) return;
      const c = chartRef.current;
      c.data.labels = history.map(h => h.t);
      c.data.datasets[0].data = history.map(h => h.conf);
      const last = history[history.length - 1].conf;
      c.data.datasets[0].borderColor = last > 0.75 ? "#f85149" : last >= 0.55 ? "#d29922" : "#2f81f7";
      c.update("none");
   }, [history]);

   return <canvas ref={canvasRef}></canvas>;
}

function SignalChart({ history }) {
   return <ChartWrapper history={history} />;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);