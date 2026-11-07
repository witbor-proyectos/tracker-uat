/* ============================================================
   utils.js — utilidades puras
   Depende de window.UAT: ESTADO_ORDER, IMPORT_FIELDS, SEMAFORO
   Publica en window.UAT: fmtDateTime, fmtDate, fmtNum, csvEscape, norm,
   dayIn, addDays, isBusinessDay, businessDays, daysBetween, fmtDia,
   fmtFechaAsunto, moduleStatus, plannedAt, plannedByModule, planFn, semaforo,
   curvePoints, openIncidents, incidentRows, businessDaysLeft,
   store, stats, loadSheetJS, readWorkbook, detectHeaderRow, detectSheet,
   autoMap, buildImportRows
   ============================================================ */
(function () {
  const { ESTADO_ORDER, IMPORT_FIELDS, SEMAFORO } = window.UAT;

  /* Fechas en DD-mmm-AAAA (06-nov-2026), en la app y en el correo. */
  function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const dia = `${String(d.getDate()).padStart(2, "0")}-${MESES[d.getMonth()]}-${d.getFullYear()}`;
    return dia + " · " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDate(s) {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return `${d}-${MESES[Number(m) - 1]}-${y}`;
  }
  /* Números con punto como separador de miles (1.234). */
  function fmtNum(n) {
    const s = String(Math.abs(Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return (n < 0 ? "−" : "") + s;
  }
  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ---------- Fechas del proyecto (texto AAAA-MM-DD) ---------- */
  /* Día calendario en la zona horaria del proyecto. */
  function dayIn(tz, date) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(date ? new Date(date) : new Date());
  }
  function addDays(s, n) {
    const d = new Date(s + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function isBusinessDay(s, feriados) {
    const wd = new Date(s + "T00:00:00Z").getUTCDay();
    return wd !== 0 && wd !== 6 && !(feriados || []).includes(s);
  }
  /* Días hábiles entre dos fechas, ambas incluidas. */
  function businessDays(from, to, feriados) {
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (isBusinessDay(d, feriados)) n++;
    return n;
  }
  function daysBetween(from, to) {
    return Math.round((new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000);
  }
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  /* Fecha para el asunto del correo: 12-oct-2026 (mismo formato que fmtDate). */
  function fmtFechaAsunto(s) { return fmtDate(s); }
  function fmtDia(s) {
    if (!s) return "";
    const [, m, d] = s.split("-");
    return Number(d) + " " + MESES[Number(m) - 1];
  }

  /* Texto comparable: sin acentos, en minúsculas, sin signos. */
  function norm(v) {
    return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9#]+/g, " ").trim();
  }

  /* Preferencias de este navegador (proyecto, nombre elegido). El
     navegador puede bloquear el almacenamiento: la app sigue sin él. */
  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  /* ---------- Avance ----------
     Solo cuentan los casos validados y no rechazados; «No aplica» sale del total.
     % aprobados = Aprobados / (Total − No aplica)            (clave: avance)
     % ejecutado = (Aprobado + Con incidente) / (Total − No aplica)
       Ejecutado = caso terminado: OK (aprobado) o NO OK (con incidente).
       «En curso» es «en proceso»: todavía no cuenta como ejecutado. */
  function stats(cases) {
    const by = {};
    ESTADO_ORDER.forEach((e) => { by[e] = 0; });
    let total = 0, pendientes = 0;
    cases.forEach((c) => {
      if (c.rechazado) return;
      if (!c.validado) { pendientes++; return; }
      total++; by[c.estado] = (by[c.estado] || 0) + 1;
    });
    const base = total - by["No aplica"];
    const pct = (n) => (base > 0 ? Math.round((n / base) * 100) : 0);
    const ejecutados = by["Aprobado"] + by["Con incidente"];
    return {
      total, base, by, pendientes,
      ejecutados, porEjecutar: base - ejecutados, pct,
      avance: pct(by["Aprobado"]),
      ejecutado: pct(ejecutados),
    };
  }

  /* ---------- Planificado ----------
     Casos que deberían estar aprobados a una fecha. Por módulo: su total
     (sin «No aplica») repartido en partes iguales entre los días hábiles
     que van desde el inicio de sus pruebas hasta el cierre de la UAT,
     contando el día de inicio. Antes del inicio del módulo, 0. Se suman
     los módulos. Ej.: 10 casos en 10 días hábiles → el día 2, 2 casos.
     Cada módulo se redondea por su lado y el total es la suma de lo que
     se muestra por módulo, para que los números siempre cuadren. */
  function plannedByModule(project, modules, byModule, fecha) {
    const fin = project.fecha_fin_uat, feriados = project.feriados || [];
    const out = {};
    modules.forEach((m) => {
      out[m.id] = 0;
      const inicio = m.fecha_inicio_pruebas || project.fecha_inicio_uat;
      if (!fin || !inicio || fecha < inicio) return;
      const base = stats(byModule[m.id] || []).base;
      const dias = businessDays(inicio, fin, feriados);
      if (!base || !dias) return;
      const hechos = businessDays(inicio, fecha < fin ? fecha : fin, feriados);
      out[m.id] = Math.round((base * hechos) / dias);
    });
    return out;
  }
  function plannedAt(project, modules, byModule, fecha) {
    const p = plannedByModule(project, modules, byModule, fecha);
    return Object.keys(p).reduce((t, k) => t + p[k], 0);
  }
  /* Planificado por fecha con memoria (la curva lo pide para cada día). */
  function planFn(project, modules, byModule) {
    const memo = {};
    return (fecha) => (memo[fecha] !== undefined ? memo[fecha] : (memo[fecha] = plannedAt(project, modules, byModule, fecha)));
  }

  /* Semáforo de un módulo: aprobados frente a previstos a la fecha.
     Los umbrales están en config.js (SEMAFORO). Siempre lleva texto:
     nunca se informa solo con color. */
  function semaforo(aprobados, previstos) {
    if (!previstos) return { id: "gris", label: "Sin iniciar", color: "#9CA3AF", bg: "#F3F4F6", ink: "#4B5563", emoji: "⚪" };
    const r = aprobados / previstos;
    const label = Math.round(r * 100) + "% del previsto";
    if (r >= SEMAFORO.verde) return { id: "verde", label, color: "#16A34A", bg: "#DCFCE7", ink: "#166534", emoji: "🟢" };
    if (r >= SEMAFORO.ambar) return { id: "ambar", label, color: "#D97706", bg: "#FEF3C7", ink: "#92400E", emoji: "🟡" };
    return { id: "rojo", label, color: "#DC2626", bg: "#FEE2E2", ink: "#991B1B", emoji: "🔴" };
  }

  /* Puntos de la curva real vs. planificado: una foto por día (suma de
     módulos, de daily_snapshots) y el día de hoy en vivo. Los usan el
     tablero y el estatus por correo, así ambos muestran lo mismo. */
  function curvePoints({ project, snapshots, general, today, plan }) {
    const start = project.fecha_inicio_uat;
    const byDay = {};
    (snapshots || []).forEach((s) => {
      const d = byDay[s.fecha] || (byDay[s.fecha] = { aprobado: 0, inc: 0 });
      d.aprobado += s.aprobado; d.inc += s.con_incidente;
    });
    const pts = Object.keys(byDay).sort().filter((f) => f < today && (!start || f >= start)).map((fecha) => ({
      fecha, aprobado: byDay[fecha].aprobado, ejecutados: byDay[fecha].aprobado + byDay[fecha].inc, planificado: plan(fecha),
    }));
    if (!start || today >= start) {
      pts.push({ fecha: today, aprobado: general.by["Aprobado"], ejecutados: general.ejecutados, planificado: plan(today) });
    }
    return pts;
  }

  /* ---------- Estado de cada módulo (tablero y estatus por correo) ----------
     Avance, última actualización y alerta de inactividad. La alerta cuenta
     días hábiles desde la última actualización (o desde el inicio de las
     pruebas del módulo, si nadie actualizó nada). No alerta módulos que
     todavía no empiezan, que están completos o que no tienen casos. */
  function moduleStatus(project, modules, byModule, today) {
    const tz = project.zona_horaria, feriados = project.feriados || [];
    return modules.map((m) => {
      const list = byModule[m.id] || [];
      const st = stats(list);
      const last = list.filter((c) => c.updated_at).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] || null;
      const inicio = m.fecha_inicio_pruebas || project.fecha_inicio_uat || "";
      const completo = st.base > 0 && st.by["Aprobado"] === st.base;
      const empezo = !!inicio && inicio <= today;
      const lastDay = last ? dayIn(tz, last.updated_at) : "";
      const desde = lastDay && lastDay > inicio ? lastDay : inicio;
      // Días hábiles transcurridos sin contar el día de referencia.
      const sinActualizar = empezo && desde ? Math.max(businessDays(desde, today, feriados) - 1, 0) : 0;
      const alerta = st.base > 0 && empezo && !completo && sinActualizar >= project.dias_alerta;
      return { m, st, last, inicio, empezo, completo, sinActualizar, alerta };
    });
  }

  /* ---------- Reglas compartidas por el tablero, los incidentes y el correo ---------- */
  /* Incidentes abiertos: casos «Con incidente» que cuentan en el avance. */
  const openIncidents = (cases) => cases.filter((c) => c.estado === "Con incidente" && c.validado && !c.rechazado);

  /* Cada incidente abierto con su módulo y los días corridos que lleva abierto
     (desde que el caso pasó a «Con incidente»), del más viejo al más nuevo. */
  function incidentRows({ project, modules, cases, incidentDates, today }) {
    return openIncidents(cases).map((c) => {
      const desde = dayIn(project.zona_horaria, incidentDates[c.id] || c.updated_at || undefined);
      return { c, mod: modules.find((m) => m.id === c.module_id), desde, dias: Math.max(daysBetween(desde, today), 0) };
    }).sort((a, b) => b.dias - a.dias);
  }

  /* Días hábiles que quedan hasta el cierre de la UAT (null si no hay fecha). */
  function businessDaysLeft(project, today) {
    const start = project.fecha_inicio_uat, end = project.fecha_fin_uat;
    return !end ? null : today > end ? 0 : businessDays(start && start > today ? start : today, end, project.feriados || []);
  }

  /* ---------- Tickets de Redmine ---------- */
  /* Separa el campo de ticket en partes: cada número es un enlace a Redmine;
     el texto que no es un número se muestra tal cual. Admite «4587, 4590». */
  function ticketParts(text) {
    return String(text || "").split(/[\s,;/]+/).map((t) => t.trim()).filter(Boolean).map((t) => {
      const n = t.replace(/^#/, "");
      return /^\d+$/.test(n) ? { label: n, href: window.UAT.REDMINE_URL + n } : { label: t, href: null };
    });
  }

  /* Formulario de alta de un ticket en el proyecto de Redmine del cliente
     (projects.redmine_nuevo_url). Con un caso, el asunto y la descripción
     van precargados. Sin URL configurada devuelve "". */
  function redmineNewUrl(project, mod, c) {
    const base = (project && project.redmine_nuevo_url) || "";
    if (!base || !c) return base;
    const asunto = "[" + (mod ? mod.codigo : "") + "] " + c.codigo + " — " + c.caso;
    const desc = ["Caso de prueba: " + c.codigo + " — " + c.caso, "Módulo: " + (mod ? mod.nombre : "")];
    if (c.flujo) desc.push("Flujo: " + c.flujo);
    if (c.resultado_esperado) desc.push("Resultado esperado: " + c.resultado_esperado);
    desc.push("", "Qué pasó: ");
    return base + (base.includes("?") ? "&" : "?") +
      "issue[subject]=" + encodeURIComponent(asunto) + "&issue[description]=" + encodeURIComponent(desc.join("\n"));
  }

  /* ---------- Importación: lectura del archivo ---------- */
  let sheetJS = null;
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!sheetJS) {
      sheetJS = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { sheetJS = null; reject(new Error("No se pudo cargar el lector de Excel (cdn.sheetjs.com). Revisa tu conexión.")); };
        document.head.appendChild(s);
      });
    }
    return sheetJS;
  }

  /* Devuelve las hojas del archivo como matrices de texto. */
  async function readWorkbook(file) {
    const XLSX = await loadSheetJS();
    const wb = /\.csv$/i.test(file.name)
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
    // range: 0 y blankrows: la posición en la matriz coincide con la fila del Excel
    // (así los errores de la vista previa dicen la fila real).
    return wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false, blankrows: true, range: 0 })
        .map((r) => r.map((c) => String(c ?? "").trim())),
    })).filter((s) => s.rows.some((r) => r.some((c) => c)));
  }

  /* ---------- Importación: mapeo de columnas ---------- */
  const fieldOf = (header) => {
    const h = norm(header);
    return h ? IMPORT_FIELDS.find((f) => f.syn.includes(h)) : null;
  };

  /* La fila de encabezados es la que más nombres de columna conocidos
     tiene entre las primeras 30 (los Excels suelen traer títulos arriba). */
  function detectHeaderRow(rows) {
    let best = 0, bestScore = -1;
    rows.slice(0, 30).forEach((r, i) => {
      const score = r.filter((c) => fieldOf(c)).length;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    if (bestScore > 0) return best;
    const i = rows.findIndex((r) => r.filter((c) => c).length >= 2);
    return i < 0 ? 0 : i;
  }

  /* La hoja de los casos es la que tiene la mejor fila de encabezados
     (los Excels suelen traer antes una carátula e instrucciones). */
  function detectSheet(sheets) {
    let best = 0, bestScore = -1;
    sheets.forEach((s, i) => {
      const score = (s.rows[detectHeaderRow(s.rows)] || []).filter((c) => fieldOf(c)).length;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    return best;
  }

  /* Propone columna del archivo → campo del tracker. Primero el mapeo
     recordado (por texto de encabezado), luego coincidencia exacta con
     los nombres habituales y al final coincidencia parcial.
     Devuelve { campo: índice de columna }. */
  function autoMap(headers, saved, general) {
    const fields = IMPORT_FIELDS.filter((f) => general || !f.general);
    const map = {}, used = new Set();
    const take = (f, i) => { if (i >= 0 && !used.has(i) && map[f.id] === undefined) { map[f.id] = i; used.add(i); } };
    const hs = headers.map(norm);
    if (saved) fields.forEach((f) => { if (saved[f.id]) take(f, hs.indexOf(norm(saved[f.id]))); });
    fields.forEach((f) => take(f, hs.findIndex((h, i) => !used.has(i) && f.syn.includes(h))));
    fields.forEach((f) => take(f, hs.findIndex((h, i) => !used.has(i) && h &&
      f.syn.some((s) => s.length > 3 && (" " + h + " ").includes(" " + s + " ")))));
    return map;
  }

  function normCriticidad(v) {
    const n = norm(v);
    if (!n) return "";
    if (/^(urg|crit)/.test(n)) return "Urgente";
    if (/^(alt|high|1$|a$)/.test(n)) return "Alta";
    if (/^(med|2$|m$)/.test(n)) return "Media";
    if (/^(baj|low|3$|b$)/.test(n)) return "Baja";
    return null;
  }

  /* ---------- Importación: filas válidas y errores ----------
     rows     : filas de datos (sin la de encabezados)
     firstRow : número de fila en el Excel de la primera fila de datos
     mapping  : { campo: índice de columna }
     modules  : módulos del proyecto
     target   : módulo destino, o null si el archivo trae la columna Módulo
     Devuelve { valid, errors, warnings, moduleIds }. */
  function buildImportRows({ rows, firstRow, mapping, modules, target }) {
    const valid = [], errors = [], warnings = [];
    const has = (f) => mapping[f] !== undefined && mapping[f] !== "";
    const cell = (r, f) => (has(f) ? String(r[mapping[f]] ?? "").trim() : "");
    const seq = {}, seen = {}, moduleIds = new Set();
    const findModule = (v) => {
      const n = norm(v);
      return modules.find((m) => norm(m.codigo) === n || norm(m.nombre) === n) || null;
    };

    if (!has("caso")) errors.push({ fila: "—", msg: "Falta indicar la columna de «Caso de prueba»." });
    if (!target && !has("modulo")) errors.push({ fila: "—", msg: "Falta indicar la columna de «Módulo»." });
    if (errors.length) return { valid, errors, warnings, moduleIds: [] };

    if (!has("numero") && !has("codigo")) {
      warnings.push("El archivo no trae número ni código: los casos se numeran por orden de aparición. Si luego reimportas con las filas en otro orden, se crearán como casos nuevos.");
    }

    rows.forEach((r, i) => {
      const fila = firstRow + i;
      if (IMPORT_FIELDS.every((f) => !cell(r, f.id))) return; // fila vacía
      const caso = cell(r, "caso");
      // Filas de subtítulo o totales: sin caso, se saltan con aviso.
      if (!caso) { warnings.push(`Fila ${fila}: sin caso de prueba, se omite.`); return; }

      // Si el archivo trae columna de código, una fila sin código no es un caso
      // (p. ej. los renglones «Variante propia del cliente (completar)»).
      if (has("codigo") && !cell(r, "codigo")) { warnings.push(`Fila ${fila}: sin código, se omite («${caso.slice(0, 50)}»).`); return; }

      const mod = target || findModule(cell(r, "modulo"));
      if (!mod) { errors.push({ fila, msg: `Módulo no reconocido: «${cell(r, "modulo") || "vacío"}».` }); return; }
      seq[mod.id] = (seq[mod.id] || 0) + 1;

      const numTxt = cell(r, "numero").match(/\d+/);
      const numero = numTxt ? parseInt(numTxt[0], 10) : seq[mod.id];
      const codigo = cell(r, "codigo") || `${mod.codigo}-${String(numero).padStart(3, "0")}`;

      const key = mod.id + "||" + codigo.toLowerCase();
      if (seen[key]) { errors.push({ fila, msg: `Código repetido «${codigo}» (ya está en la fila ${seen[key]}).` }); return; }
      seen[key] = fila;

      let criticidad = normCriticidad(cell(r, "criticidad"));
      if (criticidad === null) {
        warnings.push(`Fila ${fila}: criticidad «${cell(r, "criticidad")}» no reconocida, queda vacía.`);
        criticidad = "";
      }

      moduleIds.add(mod.id);
      valid.push({
        fila, modulo: mod.codigo,
        module_id: mod.id, numero, codigo, flujo: cell(r, "flujo"), caso,
        descripcion: cell(r, "descripcion"), resultado_esperado: cell(r, "resultado_esperado"),
        criticidad, compania: cell(r, "compania"), responsable: cell(r, "responsable"),
      });
    });

    if (target) moduleIds.add(target.id);
    return { valid, errors, warnings, moduleIds: [...moduleIds] };
  }

  window.UAT = Object.assign(window.UAT || {}, {
    fmtDateTime, fmtDate, fmtNum, csvEscape, norm, store, stats,
    dayIn, addDays, isBusinessDay, businessDays, daysBetween, fmtDia, fmtFechaAsunto, moduleStatus,
    plannedAt, plannedByModule, planFn, semaforo, curvePoints,
    openIncidents, incidentRows, businessDaysLeft, ticketParts, redmineNewUrl,
    loadSheetJS, readWorkbook, detectHeaderRow, detectSheet, autoMap, buildImportRows,
  });
})();
