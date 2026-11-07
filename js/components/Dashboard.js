/* ============================================================
   Dashboard.js — tablero de la UAT
   Tarjetas (% aprobados, % ejecutado, planificado a hoy, brecha contra
   el plan, incidentes abiertos, días hábiles restantes), status de avance
   en cantidad de casos, avance por módulo con su responsable, su previsto
   a la fecha, su semáforo, su última actualización y la alerta de "sin
   actualizar", y la curva real vs. planificado en cantidad de casos
   (fotos de daily_snapshots + el día de hoy en vivo).
   Depende de: React (hooks), Icon, I, BRAND, ESTADOS, stats, moduleStatus,
   plannedByModule, planFn, semaforo, curvePoints, dayIn, addDays,
   businessDaysLeft, fmtDia, fmtDate, fmtDateTime, fmtNum
   Publica en window.UAT: Dashboard, ProgressChart (el estatus por correo
   la dibuja como imagen)
   ============================================================ */
(function () {
  const { useState, useMemo } = React;
  const {
    Icon, I, BRAND, ESTADOS, stats, moduleStatus, plannedByModule, planFn, semaforo, curvePoints, businessDaysLeft,
    dayIn, addDays, fmtDia, fmtDate, fmtDateTime, fmtNum,
  } = window.UAT;

  /* Series de la curva. Ejecutados y aprobados usan el par de colores
     validado para daltonismo; el planificado es la línea de referencia
     (gris, punteada). El texto nunca va en el color de la serie. */
  const SERIES = [
    { id: "planificado", label: "Planificado", color: BRAND.muted, dash: "5 5" },
    { id: "ejecutados",  label: "Ejecutados",  color: BRAND.chart2 },
    { id: "aprobado",    label: "Aprobados",   color: BRAND.cta },
  ];
  const GRID = BRAND.line;

  function Tile({ label, value, note, onClick, tone }) {
    const Tag = onClick ? "button" : "div";
    return (
      <Tag onClick={onClick} className={"text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 " + (onClick ? "hover:border-gray-300" : "")}>
        <p className="volanta">{label}</p>
        <p className="font-title text-3xl mt-1" style={tone ? { color: tone } : {}}>{value}</p>
        {note && <p className="text-xs text-gray-500 mt-0.5">{note}</p>}
      </Tag>
    );
  }

  /* Barra apilada de un módulo: aprobado / con incidente / en curso, con
     una marca fina en el previsto a la fecha. */
  function StackBar({ st, previsto }) {
    const base = Math.max(st.base, 1);
    return (
      <div className="relative">
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex gap-[2px]">
          {["Aprobado", "Con incidente", "En curso"].map((e) => st.by[e] > 0 && (
            <div key={e} title={`${e}: ${st.by[e]}`} style={{ width: `${(st.by[e] / base) * 100}%`, minWidth: 2, background: ESTADOS[e].bar }} />
          ))}
        </div>
        {previsto > 0 && (
          <div title={`Previsto a hoy: ${previsto}`} className="absolute -top-1 -bottom-1 w-[2px] rounded"
            style={{ left: `calc(${Math.min(previsto / base, 1) * 100}% - 1px)`, background: BRAND.ink }} />
        )}
      </div>
    );
  }

  /* Semáforo con texto (nunca solo color). */
  function Semaforo({ s }) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
        style={{ background: s.bg, color: s.ink }}>
        <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}
      </span>
    );
  }

  /* Status de avance en cantidad de casos (porcentajes sobre el total sin «No aplica»). */
  function StatusRow({ g }) {
    const cols = [
      { label: "Total de casos", n: g.base, nota: g.by["No aplica"] ? `${g.by["No aplica"]} no aplican` : "" },
      { label: "Ejecutados", n: g.ejecutados, pct: g.ejecutado, nota: "OK + NO OK" },
      { label: "Pendientes de ejecución", n: g.porEjecutar, pct: g.pct(g.porEjecutar) },
      { label: "OK (aprobados)", n: g.by["Aprobado"], pct: g.avance, dot: ESTADOS["Aprobado"].dot },
      { label: "NO OK (con incidente)", n: g.by["Con incidente"], pct: g.pct(g.by["Con incidente"]), dot: ESTADOS["Con incidente"].dot },
      { label: "En proceso", n: g.by["En curso"], pct: g.pct(g.by["En curso"]), dot: ESTADOS["En curso"].dot },
    ];
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-title text-base">Status de avance</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {cols.map((c) => (
            <div key={c.label} className="px-4 py-3 border-b lg:border-b-0 border-r border-gray-100 last:border-r-0">
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                {c.dot && <span className={"w-2.5 h-2.5 rounded-full " + c.dot} />}{c.label}
              </p>
              <p className="mt-0.5">
                <strong className="font-title text-2xl" style={{ color: BRAND.ink }}>{c.n}</strong>
                {c.pct !== undefined && <span className="text-sm text-gray-500"> · {c.pct}%</span>}
              </p>
              {c.nota && <p className="text-xs text-gray-400">{c.nota}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* Escala del eje Y en cantidad de casos: un tope "redondo" y 4 divisiones. */
  function niceMax(v) {
    if (v <= 4) return 4;
    // Cuatro divisiones con un paso «redondo» (sin decimales: son casos).
    const paso = Math.pow(10, Math.floor(Math.log10(v / 4)));
    const pasos = (paso >= 10 ? [1, 2, 2.5, 3, 5, 10] : [1, 2, 3, 5, 10]).map((k) => k * paso);
    return (pasos.find((p) => p * 4 >= v) || Math.ceil(v / 4)) * 4;
  }

  /* ---------- Curva: real vs. planificado (cantidad de casos) ----------
     forImage: versión fija para el correo (sin interacción ni tabla, con
     leyenda dentro del dibujo); el estatus la convierte en PNG. */
  function ProgressChart({ points, plan, start, end, today, maxCasos, forImage }) {
    const [hover, setHover] = useState(null);
    const W = 720, H = 260, L = 44, R = 96, T = 14, B = 30;

    // Eje X: toda la ventana de la UAT, ampliada si hay datos fuera de ella.
    const first = [start, points[0] && points[0].fecha].filter(Boolean).sort()[0];
    const last = [end, points.length && points[points.length - 1].fecha].filter(Boolean).sort().pop();
    const days = [];
    for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
    const top = niceMax(maxCasos);
    const x = (d) => L + (days.length > 1 ? (days.indexOf(d) / (days.length - 1)) * (W - L - R) : 0);
    const y = (v) => T + (1 - v / top) * (H - T - B);
    // Marcas del eje: cada lunes, más el primer día si no queda pegado a un lunes.
    const lunes = days.filter((d) => new Date(d + "T00:00:00Z").getUTCDay() === 1);
    const ticks = !lunes.length || days.indexOf(lunes[0]) > 3 ? [days[0]].concat(lunes) : lunes;
    const lastPt = points[points.length - 1];
    const planDias = days.map((d) => ({ fecha: d, planificado: plan(d) }));
    const planFin = planDias[planDias.length - 1];

    function onMove(ev) {
      const box = ev.currentTarget.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      let best = null, bd = Infinity;
      points.forEach((p) => { const d = Math.abs(x(p.fecha) - px); if (d < bd) { bd = d; best = p; } });
      setHover(best);
    }

    // Etiquetas en el punto actual: ejecutados, aprobados y previstos a la
    // fecha; se separan si se enciman.
    const labels = [];
    if (lastPt) {
      labels.push({ id: "ejecutados", x: x(lastPt.fecha), ly: y(lastPt.ejecutados), text: `${fmtNum(lastPt.ejecutados)} ejecutados` });
      labels.push({ id: "aprobado", x: x(lastPt.fecha), ly: y(lastPt.aprobado), text: `${fmtNum(lastPt.aprobado)} aprobados` });
      labels.push({ id: "planificado", x: x(lastPt.fecha), ly: y(lastPt.planificado), text: `${fmtNum(lastPt.planificado)} previstos` });
      labels.sort((a, b) => a.ly - b.ly);
      for (let k = 1; k < labels.length; k++) if (labels[k].ly - labels[k - 1].ly < 14) labels[k].ly = labels[k - 1].ly + 14;
      const sobra = labels[labels.length - 1].ly - (H - B);
      if (sobra > 0) labels.forEach((l) => { l.ly -= sobra; });
    }
    const svgSize = forImage ? { width: W, height: H + 22 } : {};

    return (
      <div>
        {!forImage && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-2">
            {SERIES.map((s) => (
              <span key={s.id} className="flex items-center gap-1.5">
                {s.dash ? <span className="w-4 border-t-2 border-dashed border-gray-400" />
                  : <span className="w-4 h-0.5 rounded" style={{ background: s.color }} />}
                {s.label}
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H + (forImage ? 22 : 0)}`} {...svgSize}
            className="w-full h-auto" role="img" fontFamily="Arial, Helvetica, sans-serif"
            aria-label="Curva de casos aprobados y ejecutados frente al planificado"
            onMouseMove={forImage ? undefined : onMove} onMouseLeave={forImage ? undefined : () => setHover(null)}>
            {forImage && <rect x="0" y="0" width={W} height={H + 22} fill="#FFFFFF" />}
            {forImage && (
              <g transform={`translate(${L}, ${H + 14})`} fontSize="11" fill={BRAND.body}>
                {SERIES.map((s, i) => (
                  <g key={s.id} transform={`translate(${i * 110}, 0)`}>
                    <line x1="0" x2="16" y1="-4" y2="-4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash || undefined} />
                    <text x="21" y="0">{s.label}</text>
                  </g>
                ))}
                <g transform="translate(330, 0)">
                  <line x1="0" x2="0" y1="-10" y2="2" stroke={BRAND.body} strokeWidth="1" strokeDasharray="2 2" />
                  <text x="6" y="0">Hoy ({fmtDia(today)})</text>
                </g>
              </g>
            )}
            {[0, 0.25, 0.5, 0.75, 1].map((k) => (
              <g key={k}>
                <line x1={L} x2={W - R} y1={y(top * k)} y2={y(top * k)} stroke={GRID} strokeWidth="1" />
                <text x={L - 6} y={y(top * k) + 4} textAnchor="end" fontSize="11" fill={BRAND.body}>{fmtNum(top * k)}</text>
              </g>
            ))}
            {ticks.map((d) => (
              <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="11" fill={BRAND.body}>{fmtDia(d)}</text>
            ))}
            {today >= first && today <= last && (
              <line x1={x(today)} x2={x(today)} y1={T} y2={H - B} stroke={BRAND.body} strokeWidth="1" strokeDasharray="2 3" />
            )}
            {/* Planificado: toda la ventana de la UAT */}
            <polyline fill="none" stroke={BRAND.muted} strokeWidth="1.5" strokeDasharray="5 5"
              points={planDias.map((p) => `${x(p.fecha)},${y(p.planificado)}`).join(" ")} />
            {planFin && (
              <text x={x(planFin.fecha) + 6} y={y(planFin.planificado) + 4} fontSize="11" fill={BRAND.body}>{fmtNum(planFin.planificado)} al cierre</text>
            )}
            {/* Real: ejecutados y aprobados */}
            {SERIES.filter((s) => !s.dash).map((s) => (
              <g key={s.id}>
                {points.length > 1 && (
                  <polyline fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                    points={points.map((p) => `${x(p.fecha)},${y(p[s.id])}`).join(" ")} />
                )}
                {lastPt && <circle cx={x(lastPt.fecha)} cy={y(lastPt[s.id])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />}
              </g>
            ))}
            {lastPt && <circle cx={x(lastPt.fecha)} cy={y(lastPt.planificado)} r="3.5" fill="#fff" stroke={BRAND.muted} strokeWidth="2" />}
            {labels.map((l) => (
              <text key={l.id} x={l.x + 9} y={l.ly + 4} fontSize="11" fill={BRAND.ink}>{l.text}</text>
            ))}
            {!forImage && hover && (
              <g>
                <line x1={x(hover.fecha)} x2={x(hover.fecha)} y1={T} y2={H - B} stroke={BRAND.body} strokeWidth="1" />
                {SERIES.map((s) => <circle key={s.id} cx={x(hover.fecha)} cy={y(hover[s.id])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />)}
              </g>
            )}
          </svg>
          {!forImage && hover && (
            <div className="absolute top-0 pointer-events-none bg-white border border-gray-200 rounded-lg shadow px-2.5 py-1.5 text-xs"
              style={{ left: `${Math.min(Math.max((x(hover.fecha) / W) * 100, 12), 78)}%`, transform: "translateX(-50%)" }}>
              <p className="font-semibold" style={{ color: BRAND.ink }}>{fmtDate(hover.fecha)}{hover.fecha === today ? " (hoy)" : ""}</p>
              {SERIES.map((s) => (
                <p key={s.id} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.label}: <strong style={{ color: BRAND.ink }}>{hover[s.id]}</strong>
                </p>
              ))}
              <p className="text-gray-400">
                {hover.aprobado >= hover.planificado ? "Al día con el plan" : `Atraso: ${hover.planificado - hover.aprobado} casos`}
              </p>
            </div>
          )}
        </div>
        {!forImage && <details className="mt-2 text-xs">
          <summary className="cursor-pointer" style={{ color: BRAND.cta }}>Ver los datos en tabla</summary>
          <table className="mt-2 w-full max-w-lg">
            <thead><tr className="text-left volanta"><th className="py-1">Fecha</th><th>Planificado</th><th>Ejecutados</th><th>Aprobados</th><th>Atraso</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.fecha} className="border-t border-gray-100">
                  <td className="py-1">{fmtDate(p.fecha)}</td><td>{p.planificado}</td><td>{p.ejecutados}</td><td>{p.aprobado}</td>
                  <td>{Math.max(p.planificado - p.aprobado, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>}
      </div>
    );
  }

  /* ============================================================ */
  function Dashboard({ project, modules, cases, byModule, snapshots, ciclo, isWitbor, onOpenModule, onOpenIncidents }) {
    const today = dayIn(project.zona_horaria);
    const general = useMemo(() => stats(cases), [cases]);
    const start = project.fecha_inicio_uat, end = project.fecha_fin_uat;

    const restantes = businessDaysLeft(project, today);
    const fase = !start || !end ? "" : today < start ? `Empieza el ${fmtDate(start)}` : today > end ? `Terminó el ${fmtDate(end)}` : `Cierra el ${fmtDate(end)}`;

    /* Planificado: casos que deberían estar aprobados a cada fecha (total y por módulo). */
    const plan = useMemo(() => planFn(project, modules, byModule), [project, modules, byModule]);
    const planHoy = plan(today);
    const planMod = useMemo(() => plannedByModule(project, modules, byModule, today), [project, modules, byModule, today]);
    const atraso = planHoy - general.by["Aprobado"];
    const brecha = general.by["Aprobado"] - planHoy;

    /* Por módulo: avance, última actualización y alerta de inactividad. */
    const rows = useMemo(() => moduleStatus(project, modules, byModule, today), [project, modules, byModule, today]);

    const alertas = rows.filter((r) => r.alerta);

    /* Curva: una foto por día (suma de módulos) y el día de hoy en vivo, en cantidad de casos. */
    const points = useMemo(() => curvePoints({ project, snapshots, general, today, plan }), [project, snapshots, general, today, plan]);

    return (
      <section className="space-y-5">
        <div>
          <p className="volanta">{ciclo} · {start && end ? `${fmtDate(start)} al ${fmtDate(end)}` : "sin fechas"}</p>
          <h2 className="font-title text-2xl">Avance de la UAT</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Tile label="Casos aprobados" value={general.avance + "%"} note={`${fmtNum(general.by["Aprobado"])} de ${fmtNum(general.base)} casos`} />
          <Tile label="Ejecutado" value={general.ejecutado + "%"} note={`${fmtNum(general.ejecutados)} casos terminados (OK + NO OK)`} />
          <Tile label="Planificado a hoy" value={fmtNum(planHoy)}
            note={today < (start || today) ? "La UAT todavía no empieza"
              : `Casos que deberían estar aprobados · hay ${fmtNum(general.by["Aprobado"])}`} />
          <Tile label="Brecha contra el plan" value={brecha > 0 ? "+" + fmtNum(brecha) : fmtNum(brecha)}
            note={atraso > 0 ? `${fmtNum(atraso)} casos aprobados por debajo de lo previsto` : "Al día con el plan"}
            tone={atraso > 0 ? BRAND.danger : undefined} />
          <Tile label="Incidentes abiertos" value={fmtNum(general.by["Con incidente"])} note="Ver el detalle"
            onClick={onOpenIncidents} tone={general.by["Con incidente"] > 0 ? BRAND.danger : undefined} />
          <Tile label="Días hábiles restantes" value={restantes === null ? "—" : restantes} note={fase} />
        </div>

        <StatusRow g={general} />

        {alertas.length > 0 && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded-xl px-4 py-3">
            <Icon path={I.Warn} className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Sin actualizar en los últimos {project.dias_alerta} días hábiles:</strong>{" "}
              {alertas.map((r) => `${r.m.nombre} (${r.m.responsable_nombre || "sin responsable"})`).join(" · ")}
            </span>
          </div>
        )}

        {/* Avance por módulo */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-title text-base">Avance por módulo</h3>
            <span className="flex flex-wrap gap-3 text-xs">
              {["Aprobado", "Con incidente", "En curso"].map((e) => (
                <span key={e} className="flex items-center gap-1.5"><span className={"w-2.5 h-2.5 rounded-sm " + ESTADOS[e].dot} />{e === "En curso" ? "En curso (en proceso)" : e}</span>
              ))}
              <span className="flex items-center gap-1.5"><span className="w-[2px] h-3 rounded" style={{ background: BRAND.ink }} />Previsto a hoy</span>
            </span>
          </div>
          {rows.map(({ m, st, last, inicio, empezo, sinActualizar, alerta, completo }) => (
            <button key={m.id} type="button" onClick={() => onOpenModule(m.id)}
              className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 grid gap-x-4 gap-y-1.5 md:grid-cols-[14rem_minmax(0,1fr)_15rem] md:items-center">
              <span className="min-w-0">
                <span className="block font-medium truncate" style={{ color: BRAND.ink }}>{m.nombre}</span>
                <span className="block text-xs text-gray-500 truncate">{m.responsable_nombre || "Sin responsable"}</span>
              </span>
              <span>
                <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs mb-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span><strong className="text-sm" style={{ color: BRAND.ink }}>{st.avance}%</strong> aprobados · {st.ejecutado}% ejecutado</span>
                    {st.base > 0 && <Semaforo s={semaforo(st.by["Aprobado"], planMod[m.id] || 0)} />}
                  </span>
                  <span className="text-gray-400">{fmtNum(st.by["Aprobado"])}/{fmtNum(st.base)} · previsto {fmtNum(planMod[m.id] || 0)}</span>
                </span>
                <StackBar st={st} previsto={planMod[m.id] || 0} />
              </span>
              <span className="text-xs md:text-right">
                {st.total === 0 ? <span className="text-gray-400">Sin casos cargados</span>
                  : completo ? <span className="text-emerald-700 font-medium">Completo</span>
                  : !empezo ? <span className="text-gray-400">{inicio ? `Empieza el ${fmtDate(inicio)}` : "Sin fecha de inicio"}</span>
                  : (
                    <>
                      <span className="block text-gray-500">{last ? `${last.updated_by} · ${fmtDateTime(last.updated_at)}` : inicio ? `Empezó el ${fmtDate(inicio)} · nadie actualizó todavía` : "Nadie actualizó todavía"}</span>
                      {alerta && (
                        <span className="inline-flex items-center gap-1 mt-0.5 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-medium">
                          <Icon path={I.Warn} className="w-3 h-3" /> {sinActualizar} días hábiles sin actualizar
                        </span>
                      )}
                    </>
                  )}
              </span>
            </button>
          ))}
        </div>

        {/* Curva real vs. planificado */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <h3 className="font-title text-base">Avance real vs. planificado</h3>
          <p className="text-xs text-gray-500 mb-2">
            En cantidad de casos. El planificado reparte los casos de cada módulo en partes iguales entre los días hábiles desde su inicio hasta el cierre.
          </p>
          {points.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              La curva empieza el {fmtDate(start)}, con el inicio de la UAT. Se guarda una foto del avance al cierre de cada día.
            </p>
          ) : (
            <ProgressChart points={points} plan={plan} start={start} end={end} today={today}
              maxCasos={Math.max(general.base, plan(end || today), 1)} />
          )}
        </div>

        {isWitbor && (
          <p className="text-xs text-gray-400">
            Último estatus por correo: {project.ultimo_estatus_at
              ? `${fmtDateTime(project.ultimo_estatus_at)} (${project.ultimo_estatus_por || "sin nombre"})`
              : "todavía no se generó ninguno"}.
          </p>
        )}
      </section>
    );
  }

  window.UAT = Object.assign(window.UAT || {}, { Dashboard, ProgressChart });
})();
