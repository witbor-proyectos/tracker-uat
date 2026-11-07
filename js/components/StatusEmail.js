/* ============================================================
   StatusEmail.js — estatus por correo (solo Witbor)
   Una página estática no envía correos: el envío es semiautomático.
   "Generar estatus" arma el resumen y lo muestra; "Copiar y abrir
   Gmail" copia el cuerpo con formato y abre la redacción de Gmail
   con destinatarios y asunto cargados: el PM pega y envía.
   Alternativas: cliente de correo (mailto, texto plano), descarga
   del cuerpo en .html y descarga de la curva en PNG.

   El cuerpo es HTML de correo: tablas, estilos en línea, Arial y
   600 px de ancho, que es lo que respetan Gmail (web y celular) y
   Outlook. Las barras son celdas de tabla con su número escrito.
   La curva va como imagen PNG incrustada: se dibuja con el mismo
   componente del tablero (ProgressChart) y se pasa a un canvas.
   Prueba del 06-nov-2026: Gmail web conserva la imagen pegada y la
   envía dentro del cuerpo (ver docs/COMO-MANTENER.txt).

   Depende de: React (hooks), ReactDOM, Icon, I, BRAND, ESTADOS, INPUT_CLS,
   ticketParts, APP_URL, stats, moduleStatus, plannedByModule, planFn,
   semaforo, curvePoints, incidentRows, businessDaysLeft, dayIn, fmtDate,
   fmtDateTime, fmtFechaAsunto, fmtNum, ProgressChart, updateProject
   Publica en window.UAT: StatusEmail, buildStatus, curvaPng, mensajePorDefecto
   ============================================================ */
(function () {
  const { useState } = React;
  const {
    Icon, I, BRAND, ESTADOS, INPUT_CLS, APP_URL, ticketParts, stats, moduleStatus, plannedByModule, planFn,
    semaforo, curvePoints, incidentRows, businessDaysLeft, dayIn, fmtDate, fmtDateTime, fmtFechaAsunto, fmtNum,
    ProgressChart, updateProject,
  } = window.UAT;

  /* Colores del correo: los de marca vienen de BRAND; los de estado, de ESTADOS
     (los mismos del tablero); el resto son neutros propios del correo. */
  const C = {
    ink: BRAND.ink, body: BRAND.body, cta: BRAND.cta, dark: BRAND.dark, soft: BRAND.soft, lightBody: BRAND.lightBody, line: BRAND.line,
    danger: BRAND.danger, border: "#E5E7EB", rowLine: "#EEEFF2", warnBorder: "#F3D9A4", warnBg: "#FFFBEB",
    track: "#F3F4F6", previsto: "#E5E7EB", previstoBorde: "#9CA3AF",
    aprobado: ESTADOS["Aprobado"].bar, incidente: ESTADOS["Con incidente"].bar, enCurso: "#BFDBFE",
  };
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const parseDest = (s) => String(s || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const appUrl = (project) => (APP_URL || (window.location.origin + window.location.pathname)) + "?p=" + project.slug;
  const signo = (n) => (n > 0 ? "+" + fmtNum(n) : fmtNum(n));
  const diaCorto = (s) => fmtDate(s).slice(0, 6); // 27-oct

  /* Texto por defecto del «Mensaje del PM». La contraseña sale del proyecto
     (Administración → Estatus por correo), nunca del código. */
  function mensajePorDefecto(project) {
    return "Hola a todos,\n\nLes comparto el avance registrado al momento.\n\nAcceso al Tracker\n\n" +
      "Enlace: " + appUrl(project) + (project.clave_estatus ? "\nContraseña: " + project.clave_estatus : "");
  }

  /* ---------- Curva en PNG ----------
     Dibuja la curva del tablero (ProgressChart en su versión fija) fuera de
     pantalla, pasa el SVG a un canvas al doble de resolución y devuelve el
     PNG como data URL. null si todavía no hay curva. */
  async function curvaPng({ project, modules, cases, byModule, snapshots }) {
    const today = dayIn(project.zona_horaria);
    const general = stats(cases);
    const plan = planFn(project, modules, byModule);
    const points = curvePoints({ project, snapshots, general, today, plan });
    if (!points.length) return null;
    const end = project.fecha_fin_uat;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:720px;";
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    try {
      ReactDOM.flushSync(() => root.render(
        <ProgressChart points={points} plan={plan} start={project.fecha_inicio_uat} end={end} today={today}
          maxCasos={Math.max(general.base, plan(end || today), 1)} forImage />,
      ));
      const svg = host.querySelector("svg");
      const w = Number(svg.getAttribute("width")), h = Number(svg.getAttribute("height"));
      const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      const img = await new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
      const k = 2; // retina
      const canvas = document.createElement("canvas");
      canvas.width = w * k; canvas.height = h * k;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return { src: canvas.toDataURL("image/png"), w, h };
    } finally {
      root.unmount(); host.remove();
    }
  }

  /* ---------- Arma el estatus: asunto, cuerpo HTML y texto plano ----------
     Todo dato que viene de la base pasa por esc(). */
  function buildStatus({ project, modules, cases, byModule, incidentDates, ciclo, mensaje, curva }) {
    const today = dayIn(project.zona_horaria);
    const g = stats(cases);
    const rows = moduleStatus(project, modules, byModule, today);
    const alertas = rows.filter((r) => r.alerta);
    const start = project.fecha_inicio_uat, end = project.fecha_fin_uat;
    const restantes = businessDaysLeft(project, today);
    const incidentes = incidentRows({ project, modules, cases, incidentDates, today });
    const url = appUrl(project);
    const subject = `UAT ${project.cliente} — Estatus al ${fmtFechaAsunto(today)}`;
    const n = project.dias_alerta;

    // Previsto a la fecha (casos que deberían estar aprobados), total y por módulo.
    const planMod = plannedByModule(project, modules, byModule, today);
    const plan = Object.keys(planMod).reduce((t, k) => t + planMod[k], 0);
    const aprob = g.by["Aprobado"];
    const brecha = aprob - plan;
    const pendientes = g.base - aprob;
    const pctPlan = plan > 0 ? Math.round((aprob / plan) * 100) : null;

    // Línea de lectura (regla fija, sin IA).
    let lectura = !start || today < start ? `La UAT empieza el ${fmtDate(start)}.`
      : brecha < 0 ? `La UAT va ${fmtNum(-brecha)} casos aprobados por debajo de lo previsto a la fecha.`
      : "La UAT está al día con lo previsto a la fecha.";
    if (pendientes > 0 && restantes > 0) {
      lectura += ` Para cerrar a tiempo hacen falta unos ${fmtNum(Math.ceil(pendientes / restantes))} casos aprobados por día hábil.`;
    } else if (pendientes > 0 && restantes === 0) {
      lectura += ` El plazo previsto terminó el ${fmtDate(end)}; quedan ${fmtNum(pendientes)} casos por aprobar.`;
    }

    // Módulos con casos, del más atrasado al menos atrasado (brecha absoluta).
    const porModulo = rows.filter((r) => r.st.total > 0).map((r) => {
      const prev = planMod[r.m.id] || 0;
      return { ...r, prev, falta: prev - r.st.by["Aprobado"], sem: semaforo(r.st.by["Aprobado"], prev) };
    }).sort((a, b) => b.falta - a.falta || (a.m.orden || 0) - (b.m.orden || 0));

    const ultima = (r) => (r.last ? `${r.last.updated_by} · ${fmtDateTime(r.last.updated_at)}`
      : !r.empezo ? (r.inicio ? `Empieza el ${fmtDate(r.inicio)}` : "—")
      : r.inicio ? `Sin actualizaciones desde el inicio (${diaCorto(r.inicio)})` : "Sin actualizaciones");

    /* ----- HTML ----- */
    const F = "font-family:Arial,Helvetica,sans-serif;";
    const th = `${F}font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:${C.ink};background:${C.soft};padding:7px 5px;text-align:left;border-bottom:1px solid ${C.line};`;
    const td = `${F}font-size:13px;color:${C.body};padding:7px 5px;border-bottom:1px solid ${C.rowLine};vertical-align:top;`;
    const num = "text-align:right;white-space:nowrap;";
    const h3 = `${F}font-size:15px;color:${C.ink};margin:24px 0 8px;font-weight:bold;`;
    const tabla = (extra) => `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;${extra || ""}">`;
    const kpi = (label, value, note, color) =>
      `<td width="25%" style="${F}padding:10px 10px;border:1px solid ${C.border};vertical-align:top;">` +
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:${C.body};line-height:1.3;">${esc(label)}</div>` +
      `<div style="font-size:22px;font-weight:bold;color:${color || C.ink};line-height:1.3;margin-top:4px;">${esc(value)}</div>` +
      `<div style="font-size:11px;color:${C.body};line-height:1.35;">${esc(note)}</div></td>`;
    // Barra horizontal: segmentos [{ n, color }] sobre la escala `base`.
    // Un valor mayor que 0 nunca queda invisible (mínimo 2 px).
    const barra = (segs, base, borde) => {
      const cells = segs.filter((s) => s.n > 0).map((s) => {
        const pct = (s.n / Math.max(base, 1)) * 100;
        const w = pct < 1 ? `width="2" style="width:2px;` : `width="${pct.toFixed(1)}%" style="`;
        return `<td ${w}background:${s.color};height:12px;font-size:0;line-height:0;">&nbsp;</td>`;
      }).join("");
      return tabla(`border:1px solid ${borde || C.track};`) + `<tr>${cells}<td style="background:${C.track};height:12px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
    };
    const pill = (s) => `<span style="${F}display:inline-block;white-space:nowrap;font-size:11px;font-weight:bold;color:${s.ink};background:${s.bg};border-radius:10px;padding:2px 8px;">` +
      `<span style="color:${s.color};">&#9679;</span> ${esc(s.label)}</span>`;
    const muestra = (color, borde) => `<span style="display:inline-block;width:10px;height:10px;background:${color};${borde ? `border:1px solid ${borde};` : ""}vertical-align:middle;"></span>`;

    let html = `<div style="${F}font-size:14px;line-height:1.5;color:${C.body};max-width:600px;">`;

    // 0. Mensaje del PM (los enlaces quedan clicables).
    if (mensaje.trim()) {
      html += mensaje.trim().split(/\n{2,}/).map((p) => `<p style="${F}font-size:14px;color:${C.ink};margin:0 0 12px;">` +
        esc(p).replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${C.cta};">$1</a>`).replace(/\n/g, "<br>") + `</p>`).join("");
    }

    // Encabezado con la paleta Witbor.
    html += tabla("margin-top:6px;") +
      `<tr><td style="background:${C.dark};padding:16px 20px;">` +
      `<div style="${F}font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:${C.lightBody};">UAT · ${esc(project.cliente)} · ${esc(ciclo)}</div>` +
      `<div style="${F}font-size:20px;color:${C.soft};">Estatus al ${fmtFechaAsunto(today)}</div></td></tr>` +
      `<tr><td style="padding:0;">` + tabla() + `<tr>` +
      BRAND.stops.map((c) => `<td width="25%" height="4" style="background:${c};font-size:0;line-height:0;">&nbsp;</td>`).join("") +
      `</tr></table></td></tr></table>`;

    // 1. Tarjetas KPI y línea de lectura.
    html += tabla("margin-top:14px;") + `<tr>` +
      kpi("Aprobados vs. previstos a la fecha", `${fmtNum(aprob)} de ${fmtNum(plan)}`,
        pctPlan === null ? "Todavía no hay casos previstos" : `${pctPlan}% de lo previsto`) +
      kpi("Avance total", `${fmtNum(aprob)} de ${fmtNum(g.base)}`,
        `${g.avance}% aprobados · ${fmtNum(g.ejecutados)} ejecutados (OK + NO OK)`) +
      kpi("Brecha contra el plan", `${signo(brecha)} casos`, "Aprobados menos previstos a la fecha", brecha < 0 ? C.danger : null) +
      kpi("Días hábiles para el cierre", restantes === null ? "—" : fmtNum(restantes), end ? `Cierre: ${fmtDate(end)}` : "") +
      `</tr></table>` +
      `<p style="${F}font-size:14px;color:${C.ink};margin:10px 0 0;">${esc(lectura)}</p>`;

    // 2. Gráfico 1: previsto vs. real por módulo.
    html += `<p style="${h3}">Previsto vs. real por módulo</p>` +
      `<p style="${F}font-size:11px;color:${C.body};margin:0 0 8px;">` +
      `${muestra(C.previsto, C.previstoBorde)} Previsto a la fecha &nbsp; ${muestra(C.aprobado)} Aprobado &nbsp; ${muestra(C.incidente)} Con incidente &nbsp; ` +
      `${muestra(C.enCurso)} En curso (no cuenta como ejecutado) · Ordenado de mayor a menor brecha.</p>` +
      tabla(`border:1px solid ${C.border};`) +
      porModulo.map((r) => {
        const st = r.st, ap = st.by["Aprobado"], inc = st.by["Con incidente"], cur = st.by["En curso"];
        const real = `Ejecutado ${fmtNum(ap + inc)}` + (ap + inc ? ` · ${fmtNum(ap)} aprob.` + (inc ? ` · ${fmtNum(inc)} inc.` : "") : "") +
          (cur ? ` <span style="color:${C.body};">· ${fmtNum(cur)} en curso</span>` : "");
        const lbl = `${F}font-size:12px;color:${C.ink};padding:2px 0 2px 8px;`;
        return `<tr><td style="${F}padding:10px 10px 0;border-top:1px solid ${C.rowLine};">` + tabla() +
          `<tr><td style="${F}font-size:13px;color:${C.ink};font-weight:bold;">${esc(r.m.nombre)} <span style="font-weight:normal;color:${C.body};font-size:12px;">· ${fmtNum(st.base)} casos</span></td>` +
          `<td align="right" style="text-align:right;">${pill(r.sem)}</td></tr></table>` +
          tabla("margin:6px 0 10px;") +
          `<tr><td width="68%" style="padding:2px 0;">${barra([{ n: r.prev, color: C.previsto }], st.base, C.previstoBorde)}</td>` +
          `<td style="${lbl}">Previsto ${fmtNum(r.prev)}</td></tr>` +
          `<tr><td width="68%" style="padding:2px 0;">${barra([{ n: ap, color: C.aprobado }, { n: inc, color: C.incidente }, { n: cur, color: C.enCurso }], st.base)}</td>` +
          `<td style="${lbl}">${real}</td></tr></table></td></tr>`;
      }).join("") + `</table>`;

    // 3. Gráfico 2: la curva del tablero, como imagen.
    if (curva) {
      html += `<p style="${h3}">Avance real vs. planificado</p>` +
        `<img src="${curva.src}" width="600" alt="Curva de avance: ${fmtNum(plan)} previstos, ${fmtNum(g.ejecutados)} ejecutados, ${fmtNum(aprob)} aprobados" ` +
        `style="display:block;width:100%;max-width:600px;height:auto;border:1px solid ${C.border};">` +
        `<p style="${F}font-size:11px;color:${C.body};margin:6px 0 0;">En cantidad de casos. Al ${fmtDate(today)}: ${fmtNum(plan)} previstos · ` +
        `${fmtNum(g.ejecutados)} ejecutados · ${fmtNum(aprob)} aprobados. El planificado reparte los casos de cada módulo en partes iguales entre los días hábiles desde su inicio hasta el cierre.</p>`;
    }

    // Status de avance en cantidad de casos (pedido de Matías, 23-oct).
    const stCols = [
      ["Total", g.base, ""], ["Ejecutados", g.ejecutados, g.ejecutado + "%"], ["Pendientes", g.porEjecutar, g.pct(g.porEjecutar) + "%"],
      ["OK", aprob, g.avance + "%"], ["NO OK", g.by["Con incidente"], g.pct(g.by["Con incidente"]) + "%"], ["En proceso", g.by["En curso"], g.pct(g.by["En curso"]) + "%"],
    ];
    html += `<p style="${h3}">Status de avance</p>` + tabla(`border:1px solid ${C.border};`) + `<tr>` +
      stCols.map(([l]) => `<th style="${th}text-align:center;">${esc(l)}</th>`).join("") + `</tr><tr>` +
      stCols.map(([, v, p]) => `<td style="${td}text-align:center;"><span style="font-size:17px;color:${C.ink};font-weight:bold;">${fmtNum(v)}</span>` +
        (p ? `<br><span style="font-size:11px;">${p}</span>` : "") + `</td>`).join("") + `</tr></table>`;

    // 4. Tabla por módulo (referencia en números).
    // El nombre del módulo va en su propia fila: así la tabla entra en el celular.
    const td2 = `${td}border-bottom:none;padding-bottom:0;`;
    html += `<p style="${h3}">Detalle por módulo</p>` + tabla(`border:1px solid ${C.border};`) +
      `<tr><th style="${th}text-align:right;">Total</th><th style="${th}text-align:right;">Aprob.</th>` +
      `<th style="${th}text-align:right;">Inc.</th><th style="${th}text-align:right;">En curso</th><th style="${th}text-align:right;">No inic.</th>` +
      `<th style="${th}text-align:right;">Previsto</th><th style="${th}text-align:right;">Brecha</th><th style="${th}text-align:right;">% aprob.</th></tr>` +
      rows.map((r) => {
        const prev = planMod[r.m.id] || 0, br = r.st.by["Aprobado"] - prev;
        return `<tr><td colspan="8" style="${td2}"><span style="color:${C.ink};font-weight:bold;">${esc(r.m.nombre)}</span>` +
          ` <span style="font-size:11px;">· ${esc(r.m.responsable_nombre || "Sin responsable")} · ${esc(r.st.total === 0 ? "Sin casos cargados" : ultima(r))}</span></td></tr>` +
          `<tr><td style="${td}${num}">${fmtNum(r.st.base)}</td><td style="${td}${num}">${fmtNum(r.st.by["Aprobado"])}</td>` +
          `<td style="${td}${num}">${fmtNum(r.st.by["Con incidente"])}</td><td style="${td}${num}">${fmtNum(r.st.by["En curso"])}</td>` +
          `<td style="${td}${num}">${fmtNum(r.st.by["No iniciado"])}</td><td style="${td}${num}">${fmtNum(prev)}</td>` +
          `<td style="${td}${num}${br < 0 ? `color:${C.danger};` : ""}">${signo(br)}</td>` +
          `<td style="${td}${num}color:${C.ink};font-weight:bold;">${r.st.avance}%</td></tr>`;
      }).join("") + `</table>`;

    // 5. Sin actualizar (el único lugar donde va el nombre de una persona).
    html += `<p style="${h3}">Sin actualizar en los últimos ${n} días hábiles</p>`;
    html += alertas.length
      ? tabla(`border:1px solid ${C.warnBorder};background:${C.warnBg};`) +
        alertas.map((r) => `<tr><td style="${td}border-bottom:1px solid ${C.warnBorder};">` +
          `<span style="color:${C.ink};font-weight:bold;">${esc(r.m.responsable_nombre || "Sin responsable")}</span> — ${esc(r.m.nombre)} — ${fmtNum(r.sinActualizar)} días hábiles` +
          `<br><span style="font-size:12px;">${esc(r.last ? "Última actualización: " + fmtDateTime(r.last.updated_at) : `Sin actualizaciones desde el inicio (${diaCorto(r.inicio)})`)}</span></td></tr>`).join("") +
        `</table>`
      : `<p style="${F}font-size:13px;color:${C.body};margin:0;">Todos los módulos en pruebas se actualizaron en los últimos ${n} días hábiles.</p>`;

    // 6. Incidentes abiertos.
    html += `<p style="${h3}">Incidentes abiertos</p>`;
    html += incidentes.length
      ? tabla(`border:1px solid ${C.border};`) +
        `<tr><th style="${th}">Módulo</th><th style="${th}">Caso</th><th style="${th}">Ticket</th><th style="${th}text-align:right;">Días abierto</th></tr>` +
        incidentes.map(({ c, mod, dias }) => `<tr><td style="${td}">${esc(mod ? mod.nombre : "")}</td>` +
          `<td style="${td}"><span style="color:${C.ink};font-weight:bold;">${esc(c.codigo)}</span> ${esc(c.caso)}</td>` +
          `<td style="${td}">${ticketParts(c.ticket_incidente).map((p) => (p.href
            ? `<a href="${esc(p.href)}" style="color:${C.cta};">#${esc(p.label)}</a>` : esc(p.label))).join(", ") || "Sin ticket"}</td>` +
          `<td style="${td}${num}">${fmtNum(dias)}</td></tr>`).join("") + `</table>`
      : `<p style="${F}font-size:13px;color:${C.body};margin:0;">No hay incidentes abiertos.</p>`;

    // 7. Enlace a la app y pie con la paleta Witbor.
    html += tabla("margin:24px 0 0;") + `<tr><td>` +
      `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr><td style="background:${C.cta};border-radius:6px;padding:10px 18px;">` +
      `<a href="${esc(url)}" style="${F}font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;">Ver el detalle en el tracker</a>` +
      `</td></tr></table></td></tr></table>` +
      tabla("margin-top:24px;") + `<tr>` +
      BRAND.stops.map((c) => `<td width="25%" height="3" style="background:${c};font-size:0;line-height:0;">&nbsp;</td>`).join("") + `</tr></table>` +
      `<p style="${F}font-size:11px;color:${C.body};margin:6px 0 0;">Witbor · Tracker de UAT</p></div>`;

    /* ----- Texto plano (mailto y respaldo del portapapeles) ----- */
    const barraTxt = (ap, prev, base) => {
      const k = 20 / Math.max(base, 1);
      const a = ap > 0 ? Math.max(Math.round(ap * k), 1) : 0;
      const p = Math.max((prev > 0 ? Math.max(Math.round(prev * k), 1) : 0) - a, 0);
      return "█".repeat(a) + "▒".repeat(p) + "░".repeat(Math.max(20 - a - p, 0));
    };
    const ancho = Math.max(...porModulo.map((r) => (r.m.codigo || "").length), 2);
    const L = [];
    if (mensaje.trim()) L.push(mensaje.trim(), "");
    L.push(`UAT ${project.cliente} · ${ciclo} — Estatus al ${fmtFechaAsunto(today)}`, "");
    L.push(`Aprobados vs. previstos a la fecha: ${fmtNum(aprob)} de ${fmtNum(plan)}` + (pctPlan === null ? "" : ` (${pctPlan}%)`),
      `Avance total: ${fmtNum(aprob)} de ${fmtNum(g.base)} aprobados (${g.avance}%) · ${fmtNum(g.ejecutados)} ejecutados (OK + NO OK)`,
      `Brecha contra el plan: ${signo(brecha)} casos`,
      `Días hábiles para el cierre: ${restantes === null ? "—" : fmtNum(restantes)}` + (end ? ` (cierre ${fmtDate(end)})` : ""),
      "", lectura, "");
    L.push("PREVISTO VS. REAL POR MÓDULO  (█ aprobados · ▒ previsto a la fecha · ░ resto)");
    porModulo.forEach((r) => L.push(`${(r.m.codigo || "").padEnd(ancho)}  ${barraTxt(r.st.by["Aprobado"], r.prev, r.st.base)}  ` +
      `Previsto ${fmtNum(r.prev)} · Aprobados ${fmtNum(r.st.by["Aprobado"])} · Ejecutado ${fmtNum(r.st.by["Aprobado"] + r.st.by["Con incidente"])}  ${r.sem.emoji} ${r.sem.label}`));
    L.push("", "STATUS DE AVANCE", `Total ${fmtNum(g.base)} · Ejecutados ${fmtNum(g.ejecutados)} · Pendientes ${fmtNum(g.porEjecutar)} · OK ${fmtNum(aprob)} · NO OK ${fmtNum(g.by["Con incidente"])} · En proceso ${fmtNum(g.by["En curso"])}`, "");
    L.push("DETALLE POR MÓDULO");
    rows.forEach((r) => L.push(`- ${r.m.nombre} (${r.m.responsable_nombre || "sin responsable"}): ${r.st.avance}% aprobados · ` +
      `${fmtNum(r.st.by["Aprobado"])} aprobados, ${fmtNum(r.st.by["Con incidente"])} con incidente, ${fmtNum(r.st.by["En curso"])} en curso, ` +
      `${fmtNum(r.st.by["No iniciado"])} no iniciados de ${fmtNum(r.st.base)} · previsto ${fmtNum(planMod[r.m.id] || 0)} · ${r.st.total === 0 ? "Sin casos cargados" : ultima(r)}`));
    L.push("", `SIN ACTUALIZAR EN LOS ÚLTIMOS ${n} DÍAS HÁBILES`);
    if (alertas.length) alertas.forEach((r) => L.push(`- ${r.m.responsable_nombre || "Sin responsable"} — ${r.m.nombre} — ${r.sinActualizar} días hábiles` +
      (r.last ? "" : ` (sin actualizaciones desde el inicio, ${diaCorto(r.inicio)})`)));
    else L.push("Todos los módulos en pruebas están al día.");
    L.push("", "INCIDENTES ABIERTOS");
    if (incidentes.length) incidentes.forEach(({ c, mod, dias }) => L.push(`- ${c.codigo} ${c.caso} (${mod ? mod.nombre : ""}) · ticket ${c.ticket_incidente || "sin número"} · ${dias} días`));
    else L.push("No hay incidentes abiertos.");
    L.push("", "Ver el detalle en el tracker: " + url);

    return { subject, html, text: L.join("\n") };
  }

  /* ============================================================ */
  function StatusEmail({ project, modules, cases, byModule, incidentDates, snapshots, ciclo, me, isAdmin, participants, onProjectSaved }) {
    const [dest, setDest] = useState(project.destinatarios_estatus || "");
    const [mensaje, setMensaje] = useState(() => mensajePorDefecto(project));
    const [clave, setClave] = useState(project.clave_estatus || "");
    const [status, setStatus] = useState(null);
    const [curva, setCurva] = useState(null);
    const [note, setNote] = useState(null); // { ok, text }
    const [busy, setBusy] = useState(false);
    const destinatarios = parseDest(dest);
    // El equipo Witbor va en copia: son los correos de los participantes de Witbor
    // y cualquier otro del mismo dominio que quien envía. El resto va en «Para».
    const dominio = (me.correo || "").split("@")[1] || "";
    const deWitbor = new Set((participants || []).filter((p) => p.organizacion === "Witbor" && p.correo).map((p) => p.correo.toLowerCase()));
    const esWitbor = (c) => deWitbor.has(c.toLowerCase()) || (dominio && c.toLowerCase().endsWith("@" + dominio.toLowerCase()));
    const para = destinatarios.filter((c) => !esWitbor(c));
    const copia = destinatarios.filter(esWitbor);
    const dirty = dest.trim() !== (project.destinatarios_estatus || "").trim();
    const claveDirty = clave.trim() !== (project.clave_estatus || "");

    async function saveDest() {
      setBusy(true); setNote(null);
      try { onProjectSaved(await updateProject(project.id, { destinatarios_estatus: destinatarios.join(", ") })); setNote({ ok: true, text: "Destinatarios guardados." }); }
      catch (e) { setNote({ ok: false, text: "No se pudieron guardar los destinatarios." }); }
      setBusy(false);
    }

    /* La contraseña que va en el mensaje se guarda en el proyecto (no en el código).
       Si el mensaje seguía con el texto por defecto, se actualiza solo. */
    async function saveClave() {
      setBusy(true); setNote(null);
      try {
        const saved = await updateProject(project.id, { clave_estatus: clave.trim() || null });
        if (mensaje === mensajePorDefecto(project)) setMensaje(mensajePorDefecto(saved));
        onProjectSaved(saved); setStatus(null);
        setNote({ ok: true, text: "Contraseña del mensaje guardada." });
      } catch (e) { setNote({ ok: false, text: "No se pudo guardar la contraseña del mensaje." }); }
      setBusy(false);
    }

    async function generar() {
      setNote(null); setBusy(true);
      let img = null;
      try { img = await curvaPng({ project, modules, cases, byModule, snapshots }); } catch (e) { img = null; }
      setCurva(img);
      setStatus(buildStatus({ project, modules, cases, byModule, incidentDates, ciclo, mensaje, curva: img }));
      setBusy(false);
    }

    /* Deja registrado cuándo salió el último estatus (recordatorio del tablero). */
    async function registrar() {
      try { onProjectSaved(await updateProject(project.id, { ultimo_estatus_at: new Date().toISOString(), ultimo_estatus_por: me.nombre })); } catch (e) {}
    }

    function bajar(href, nombre) {
      const a = document.createElement("a");
      a.href = href; a.download = nombre; a.click();
    }
    const nombreArchivo = () => status.subject.replace(/[^\wáéíóúñÁÉÍÓÚÑ -]+/g, "").trim();

    function descargar() {
      const doc = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${esc(status.subject)}</title></head><body>${status.html}</body></html>`;
      const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
      bajar(url, nombreArchivo() + ".html");
      URL.revokeObjectURL(url);
      registrar();
    }

    function descargarPng() {
      if (curva) bajar(curva.src, nombreArchivo() + " - curva.png");
    }

    async function copiarYGmail() {
      setNote(null);
      try {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([status.html], { type: "text/html" }),
          "text/plain": new Blob([status.text], { type: "text/plain" }),
        })]);
      } catch (e) {
        setNote({ ok: false, text: "Este navegador no permitió copiar el estatus con formato. Usa «Descargar correo (.html)», ábrelo, selecciona todo, copia y pega en el correo." });
        return;
      }
      // authuser: abre la redacción en la cuenta de quien usa la app (no en otra que esté abierta).
      const cuenta = me.correo ? "authuser=" + encodeURIComponent(me.correo) + "&" : "";
      window.open("https://mail.google.com/mail/?" + cuenta + "view=cm&fs=1&to=" + encodeURIComponent(para.join(",")) +
        (copia.length ? "&cc=" + encodeURIComponent(copia.join(",")) : "") +
        "&su=" + encodeURIComponent(status.subject), "_blank", "noopener");
      setNote({ ok: true, text: "Estatus copiado. En la ventana de Gmail, haz clic en el cuerpo del mensaje y pega (Ctrl+V)." });
      registrar();
    }

    function abrirMailto() {
      window.location.href = "mailto:" + encodeURIComponent(para.join(",")) +
        "?subject=" + encodeURIComponent(status.subject) + (copia.length ? "&cc=" + encodeURIComponent(copia.join(",")) : "") +
        "&body=" + encodeURIComponent(status.text);
      registrar();
    }

    const inputCls = INPUT_CLS;
    const btn2 = "flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50";

    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: BRAND.ink }}>Estatus por correo</h2>
          <p className="text-xs text-gray-500 mt-1">
            Arma el resumen con los datos de este momento. La app no envía el correo: lo copia y abre la redacción para que lo pegues y lo envíes.
            {" "}Último estatus: {project.ultimo_estatus_at ? `${fmtDateTime(project.ultimo_estatus_at)} (${project.ultimo_estatus_por || "sin nombre"})` : "todavía ninguno"}.
          </p>
        </div>

        <label className="block">
          <span className="volanta">Destinatarios ({destinatarios.length})</span>
          <textarea value={dest} onChange={(e) => setDest(e.target.value)} rows={2} readOnly={!isAdmin}
            placeholder="correo@empresa.com, otro@empresa.com" className={inputCls + " mt-1 resize-none " + (isAdmin ? "" : "bg-gray-50")} />
          <span className="flex items-center gap-3 mt-1 text-xs text-gray-400">
            Separados por coma. Los del equipo Witbor van en copia (CC). {isAdmin ? "" : "Los edita el administrador del proyecto."}
            {isAdmin && dirty && (
              <button type="button" onClick={saveDest} disabled={busy} className="font-semibold underline" style={{ color: BRAND.cta }}>
                Guardar destinatarios
              </button>
            )}
          </span>
        </label>

        {isAdmin && (
          <label className="block">
            <span className="volanta">Contraseña de acceso que va en el mensaje</span>
            <span className="flex flex-wrap items-center gap-2 mt-1">
              <input type="text" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off"
                placeholder="La que usan los usuarios del cliente" className={inputCls + " max-w-xs"} />
              {claveDirty && (
                <button type="button" onClick={saveClave} disabled={busy} className="text-xs font-semibold underline" style={{ color: BRAND.cta }}>
                  Guardar contraseña
                </button>
              )}
            </span>
            <span className="block mt-1 text-xs text-gray-400">
              Se guarda en el proyecto y se agrega al mensaje por defecto. Quien reciba el correo podrá entrar con ella. Vacía = el mensaje no la incluye.
            </span>
          </label>
        )}

        <label className="block">
          <span className="flex items-center justify-between gap-2">
            <span className="volanta">Mensaje del PM (va al inicio del correo)</span>
            {mensaje !== mensajePorDefecto(project) && (
              <button type="button" onClick={() => { setMensaje(mensajePorDefecto(project)); setStatus(null); }}
                className="text-xs font-semibold underline" style={{ color: BRAND.cta }}>Restablecer texto por defecto</button>
            )}
          </span>
          <textarea value={mensaje} onChange={(e) => { setMensaje(e.target.value); setStatus(null); }} rows={8}
            className={inputCls + " mt-1"} />
        </label>

        <button type="button" onClick={generar} disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-60" style={{ background: BRAND.cta }}>
          <Icon path={I.Msg} className="w-4 h-4" /> {busy ? "Generando…" : status ? "Volver a generar" : "Generar estatus"}
        </button>

        {status && (
          <div className="space-y-3">
            <div>
              <span className="volanta">Vista previa (así queda en Gmail)</span>
              <p className="text-sm mt-1"><strong style={{ color: BRAND.ink }}>Asunto:</strong> {status.subject}</p>
              <p className="text-sm"><strong style={{ color: BRAND.ink }}>Para ({para.length}):</strong> {para.join(", ") || "(sin destinatarios)"}</p>
              {copia.length > 0 && (
                <p className="text-sm"><strong style={{ color: BRAND.ink }}>CC ({copia.length}):</strong> {copia.join(", ")}</p>
              )}
              <div className="mt-2 border border-gray-200 rounded-lg p-4 overflow-auto max-h-[40rem] bg-white">
                <div style={{ width: 600, maxWidth: "100%" }} dangerouslySetInnerHTML={{ __html: status.html }} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copiarYGmail}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white rounded-lg" style={{ background: BRAND.cta }}>
                <Icon path={I.Link} className="w-4 h-4" /> Copiar y abrir Gmail
              </button>
              <button type="button" onClick={abrirMailto} className={btn2}>Abrir en cliente de correo</button>
              <button type="button" onClick={descargar} className={btn2}><Icon path={I.Down} className="w-4 h-4" /> Descargar correo (.html)</button>
              {curva && (
                <button type="button" onClick={descargarPng} className={btn2}><Icon path={I.Down} className="w-4 h-4" /> Descargar gráfico (PNG)</button>
              )}
            </div>
            {destinatarios.length === 0 && (
              <p className="text-xs text-amber-700">No hay destinatarios cargados: la redacción se abrirá sin el campo «Para».</p>
            )}
          </div>
        )}

        {note && (
          <p className={"flex items-start gap-1.5 text-sm rounded-lg px-3 py-2 border " +
            (note.ok ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-rose-700 bg-rose-50 border-rose-200")}>
            <Icon path={note.ok ? I.Check : I.Warn} className="w-4 h-4 mt-0.5 shrink-0" /> {note.text}
          </p>
        )}
      </div>
    );
  }

  window.UAT = Object.assign(window.UAT || {}, { StatusEmail, buildStatus, curvaPng, mensajePorDefecto });
})();
