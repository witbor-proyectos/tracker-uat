/* ============================================================
   app.js — componente raíz TrackerUAT y arranque de React.
   Puerta de acceso (contraseña → nombre) y orquestación: carga de
   datos, tiempo real, modo TEST y qué pestaña se muestra. Cada
   pantalla es un componente aparte (Header, Dashboard, ModuleTab,
   Incidents, AdminTab).
   Debe cargarse DESPUÉS de config, db, data, utils, icons y componentes.
   Depende de window.UAT: BRAND, store, openIncidents, Icon, I,
   LockScreen, NameSelect, Header, TestBanner, Dashboard, ModuleTab,
   Incidents, AdminTab, getSession, sessionInfo, signOut, loadProject,
   loadModules, loadParticipants, loadCases, loadSnapshots,
   loadIncidentDates, subscribeProject, setTestBackend, buildTestStore,
   makeTestBackend
   ============================================================ */
(function () {
  const { useState, useEffect, useMemo, useCallback, useRef } = React;
  const {
    BRAND, store, openIncidents,
    Icon, I, LockScreen, NameSelect, Header, TestBanner, Dashboard, ModuleTab, Incidents, AdminTab,
    getSession, sessionInfo, signOut,
    loadProject, loadModules, loadParticipants, loadCases, loadSnapshots, loadIncidentDates, subscribeProject,
    setTestBackend, buildTestStore, makeTestBackend,
  } = window.UAT;

  /* Pantalla de carga reutilizable */
  function Splash({ label }) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.soft }}>
        <div className="text-center">
          <Icon path={I.Reload} className="w-8 h-8 mx-auto animate-spin" style={{ color: BRAND.cta }} />
          <p className="mt-3 text-sm text-gray-600">{label}</p>
        </div>
      </div>
    );
  }

  /* ---------- Puerta de acceso: login + proyecto + nombre ----------
     Si ya hay sesión iniciada (login recordado), entra directo. Si no,
     muestra LockScreen. Tras iniciar sesión carga el proyecto de la
     cuenta y pide el nombre (se recuerda en este navegador). */
  function TrackerUAT() {
    const [phase, setPhase] = useState("checking"); // checking | locked | loading | name | ready
    const [ctx, setCtx] = useState(null);           // { role, project, people, participants }
    const [me, setMe] = useState(null);

    const enter = useCallback(async () => {
      setPhase("loading");
      try {
        const info = sessionInfo(await getSession());
        if (!info.projectId) throw new Error("sin proyecto");
        const [project, participants] = await Promise.all([loadProject(info.projectId), loadParticipants()]);
        const org = info.role === "witbor" ? "Witbor" : "Cliente";
        const people = participants.filter((p) => p.organizacion === org);
        const saved = people.find((p) => p.id === store.get("uat.yo." + project.id));
        setCtx({ role: info.role, project, people, participants });
        setMe(saved || null);
        setPhase(saved ? "ready" : "name");
      } catch (e) {
        setPhase("locked");
      }
    }, []);

    useEffect(() => {
      getSession()
        .then((s) => { if (s) enter(); else setPhase("locked"); })
        .catch(() => setPhase("locked"));
    }, [enter]);

    async function leave() {
      await signOut();
      setCtx(null); setMe(null); setPhase("locked");
    }
    function pick(p) {
      store.set("uat.yo." + ctx.project.id, p.id);
      setMe(p); setPhase("ready");
    }

    if (phase === "checking") return <Splash label="Conectando…" />;
    if (phase === "loading") return <Splash label="Cargando el proyecto…" />;
    if (phase === "locked") return <LockScreen onUnlock={enter} />;
    if (phase === "name") return <NameSelect project={ctx.project} people={ctx.people} onPick={pick} onSignOut={leave} />;
    return <TrackerApp role={ctx.role} project={ctx.project} participants={ctx.participants} me={me}
      onChangeName={() => setPhase("name")} onSignOut={leave} />;
  }

  /* ============================================================ */
  function TrackerApp({ role, project: initialProject, participants, me, onChangeName, onSignOut }) {
    const isWitbor = role === "witbor";
    const isAdmin = isWitbor && me.es_admin;

    const [project, setProject] = useState(initialProject);
    const [modules, setModules] = useState([]);
    const [cases, setCases] = useState([]);
    const [snapshots, setSnapshots] = useState([]);
    const [incidentDates, setIncidentDates] = useState({});
    const [ciclo, setCiclo] = useState(initialProject.ciclo_actual);
    const [tab, setTab] = useState("tablero");
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [loadError, setLoadError] = useState("");
    const cicloRef = useRef(ciclo);
    cicloRef.current = ciclo;
    const [testMode, setTestMode] = useState(false);
    const testRef = useRef(null); // datos del modo TEST (en memoria); null = datos reales
    const realRef = useRef(null); // datos reales con los que se armó la práctica

    /* ---------- Carga desde la base ---------- */
    const loadAll = useCallback(async (silent) => {
      // En modo TEST no se lee la base: se muestra lo que hay en memoria.
      if (testRef.current) {
        const t = testRef.current;
        setProject({ ...t.project }); setModules(t.modules); setCases(t.cases.map((x) => ({ ...x })));
        setSnapshots(t.snapshots); setIncidentDates({ ...t.incidentDates });
        return;
      }
      if (!silent) setLoading(true); else setSyncing(true);
      try {
        const c = cicloRef.current;
        const [p, m, cs] = await Promise.all([loadProject(initialProject.id), loadModules(), loadCases(c)]);
        if (c !== cicloRef.current) return; // cambió el ciclo mientras cargaba
        setProject(p); setModules(m); setCases(cs); setLoadError("");
        // Datos del tablero: si fallan, el resto de la app sigue funcionando.
        Promise.all([loadSnapshots(c, p.fecha_inicio_uat), loadIncidentDates()])
          .then(([sn, inc]) => { if (c === cicloRef.current) { setSnapshots(sn); setIncidentDates(inc); } })
          .catch(() => {});
      } catch (e) {
        setLoadError("No se pudieron cargar los datos. Revisa tu conexión.");
      }
      setLoading(false); setSyncing(false);
    }, [initialProject.id]);

    // Carga inicial y al cambiar de ciclo.
    useEffect(() => { loadAll(false); }, [loadAll, ciclo]);

    // "Tiempo real": si alguien cambia algo, recargamos (agrupando ráfagas).
    useEffect(() => {
      let timer = null;
      const unsub = subscribeProject(() => {
        clearTimeout(timer);
        timer = setTimeout(() => loadAll(true), 400);
      });
      return () => { clearTimeout(timer); unsub(); };
    }, [loadAll]);

    /* ---------- Modo TEST (práctica en memoria, no toca la base) ---------- */
    function enterTestMode() {
      if (!testRef.current) realRef.current = { project, modules, cases, ciclo };
      testRef.current = buildTestStore(realRef.current);
      setTestBackend(makeTestBackend(testRef.current, role));
      setTestMode(true); setLoadError(""); setTab("tablero");
      loadAll(true);
    }
    function exitTestMode() {
      testRef.current = null; realRef.current = null;
      setTestBackend(null);
      setTestMode(false); setTab("tablero");
      loadAll(false);
    }
    // Al salir de la pantalla (cambiar de persona, cerrar sesión) se apaga la práctica.
    useEffect(() => () => { setTestBackend(null); }, []);

    /* Aplica en pantalla un caso guardado o agregado, sin esperar la recarga. */
    const applyLocal = useCallback((c) => {
      setCases((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]));
    }, []);

    /* ---------- Derivados ---------- */
    const byModule = useMemo(() => {
      const map = {};
      modules.forEach((m) => { map[m.id] = []; });
      cases.forEach((c) => { if (map[c.module_id]) map[c.module_id].push(c); });
      return map;
    }, [modules, cases]);

    if (loading) return <Splash label="Cargando casos de prueba…" />;

    const incidentes = openIncidents(cases).length;
    const TABS = [{ id: "tablero", label: "Tablero", icon: I.Bar }]
      .concat(modules.map((m) => ({
        id: m.id, label: m.codigo.replace(/_/g, " / "), badge: (byModule[m.id] || []).length,
        // Marca para Witbor: el módulo tiene casos agregados por aprobar.
        alert: isWitbor ? (byModule[m.id] || []).filter((c) => !c.validado && !c.rechazado).length : 0,
      })))
      .concat([{ id: "incidentes", label: "Incidentes", icon: I.Ticket, badge: incidentes }]);
    if (isWitbor) TABS.push({ id: "admin", label: "Administración", icon: I.Gear });
    const openModule = (id) => { setTab(id); window.scrollTo(0, 0); };
    const mod = modules.find((m) => m.id === tab);
    const modCases = mod ? byModule[mod.id] || [] : [];

    return (
      <div className="min-h-screen" style={{ background: BRAND.soft }}>

        <Header project={project} me={me} ciclo={ciclo} onCiclo={setCiclo} tabs={TABS} tab={tab} onTab={setTab}
          testMode={testMode} syncing={syncing}
          onToggleTest={() => (testMode ? exitTestMode() : enterTestMode())}
          onReload={() => (testMode ? enterTestMode() : loadAll(true))}
          onChangeName={onChangeName} onSignOut={onSignOut} />

        {testMode && <TestBanner onExit={exitTestMode} />}

        {/* Avisos */}
        {loadError && (
          <div className="max-w-7xl mx-auto px-4">
            <div className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-300 text-rose-800 text-sm rounded-lg px-3 py-2">
              <Icon path={I.Warn} className="w-4 h-4 mt-0.5 shrink-0" />{loadError}
            </div>
          </div>
        )}

        <main className="max-w-7xl mx-auto px-4 py-5">

          {/* TABLERO */}
          {tab === "tablero" && (
            <Dashboard project={project} modules={modules} cases={cases} byModule={byModule} snapshots={snapshots}
              ciclo={ciclo} isWitbor={isWitbor} onOpenModule={openModule} onOpenIncidents={() => openModule("incidentes")} />
          )}

          {/* INCIDENTES */}
          {tab === "incidentes" && (
            <Incidents project={project} modules={modules} cases={cases} incidentDates={incidentDates} onOpenModule={openModule} />
          )}

          {/* PESTAÑA DE MÓDULO */}
          {mod && (
            <ModuleTab key={mod.id} mod={mod} project={project} cases={modCases} ciclo={ciclo} isWitbor={isWitbor} me={me} onLocal={applyLocal} />
          )}

          {/* ADMINISTRACIÓN (solo Witbor) */}
          {tab === "admin" && isWitbor && (
            <AdminTab project={project} modules={modules} cases={cases} byModule={byModule} incidentDates={incidentDates} snapshots={snapshots}
              ciclo={ciclo} me={me} isAdmin={isAdmin} testMode={testMode} participants={participants}
              onProjectSaved={setProject} onImported={() => loadAll(true)} onOpenModule={openModule} />
          )}
        </main>

        <footer className="max-w-7xl mx-auto px-4 pb-6 text-xs text-gray-400">
          <span>Datos compartidos en vivo con el equipo del proyecto. Comparte el enlace y la contraseña solo con el equipo.</span>{" "}
          <a href="ayuda.html" target="_blank" rel="noopener" className="underline" style={{ color: BRAND.cta }}>¿Cómo se usa?</a>
        </footer>
      </div>
    );
  }

  /* ---------- Arranque de React ---------- */
  try {
    ReactDOM.createRoot(document.getElementById("root")).render(<TrackerUAT />);
    window.__booted = true;
    clearTimeout(window.__bootTimeout);
    var __l = document.getElementById("boot-loader"); if (__l) __l.style.display = "none";
  } catch (e) {
    window.__bootFail((e && e.message) ? e.message : "Error inesperado al renderizar la aplicación.");
    throw e;
  }
})();
