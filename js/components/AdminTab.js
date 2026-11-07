/* ============================================================
   AdminTab.js — pestaña Administración (solo equipo Witbor)
   Avisos de lo que hay que revisar (casos agregados por aprobar y
   «No aplica» marcados por el cliente), exportar CSV, estatus por
   correo e importación de casos. La importación la hace el
   administrador del proyecto (PM).
   Depende de: React, Icon, I, BRAND, csvEscape, fmtDateTime, StatusEmail,
   ImportWizard
   Publica en window.UAT: AdminTab
   ============================================================ */
(function () {
  const { Icon, I, BRAND, csvEscape, fmtDateTime, StatusEmail, ImportWizard } = window.UAT;

  function AdminTab({
    project, modules, cases, byModule, incidentDates, snapshots, ciclo, me, isAdmin, testMode, participants,
    onProjectSaved, onImported, onOpenModule,
  }) {
    /* ---------- Avisos: lo que Witbor tiene que revisar ---------- */
    // Casos agregados por usuarios que esperan aprobación, por módulo.
    const porAprobar = modules.map((m) => ({ m, n: (byModule[m.id] || []).filter((c) => !c.validado && !c.rechazado).length })).filter((x) => x.n > 0);
    const totalPorAprobar = porAprobar.reduce((a, x) => a + x.n, 0);
    // «No aplica» marcados por el cliente: salen del cálculo del avance, conviene revisarlos.
    const delCliente = new Set((participants || []).filter((p) => p.organizacion === "Cliente").map((p) => p.nombre));
    const noAplica = cases.filter((c) => c.estado === "No aplica" && !c.rechazado && delCliente.has(c.updated_by))
      .map((c) => ({ c, m: modules.find((x) => x.id === c.module_id) }));

    /* ---------- Exportar CSV (respaldo del ciclo en pantalla) ---------- */
    function exportCSV() {
      const header = ["Módulo", "N.º", "Código", "Flujo", "Caso de prueba", "Descripción", "Resultado esperado", "Criticidad", "Compañía",
        "Responsable", "Estado", "Comentario", "Incidente", "Origen", "Validado", "Rechazado", "A revisar", "Actualizado por", "Última actualización"];
      const rows = [header.join(",")];
      modules.forEach((m) => (byModule[m.id] || []).forEach((c) => {
        rows.push([m.codigo, c.numero, c.codigo, c.flujo, c.caso, c.descripcion, c.resultado_esperado, c.criticidad, c.compania,
          c.responsable, c.estado, c.comentario, c.ticket_incidente, c.origen, c.validado ? "Sí" : "No", c.rechazado ? "Sí" : "No",
          c.a_revisar ? "Sí" : "No", c.updated_by, c.updated_at ? fmtDateTime(c.updated_at) : ""].map(csvEscape).join(","));
      }));
      // El primer carácter (BOM) hace que Excel abra el archivo con los acentos correctos.
      const url = URL.createObjectURL(new Blob([String.fromCharCode(0xFEFF) + rows.join(String.fromCharCode(10))], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = `UAT_${project.slug}_${ciclo.split(" ").join("_")}${testMode ? "_TEST" : ""}.csv`; a.click();
      URL.revokeObjectURL(url);
    }

    return (
      <section className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="volanta">Solo equipo Witbor</p>
            <h2 className="font-title text-2xl">Administración</h2>
          </div>
          <button onClick={exportCSV} title="Descargar todos los casos del ciclo con su estado"
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
            <Icon path={I.Down} className="w-4 h-4" /> Exportar CSV
          </button>
        </div>
        {(totalPorAprobar > 0 || noAplica.length > 0) && (
          <div className="bg-white rounded-xl shadow-sm p-5 space-y-4" style={{ border: "2px solid " + BRAND.violet }}>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide" style={{ color: BRAND.violet }}>
              <Icon path={I.Warn} className="w-4 h-4" /> Para revisar
            </h2>
            {totalPorAprobar > 0 && (
              <div>
                <p className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: BRAND.violet }} />
                  <strong style={{ color: BRAND.ink }}>
                    {totalPorAprobar === 1 ? "Hay 1 caso agregado por aprobar" : `Hay ${totalPorAprobar} casos agregados por aprobar`}
                  </strong>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {porAprobar.map(({ m, n }) => (
                    <button key={m.id} type="button" onClick={() => onOpenModule(m.id)}
                      className="rounded-lg text-white text-sm font-semibold px-3 py-1.5 hover:opacity-90" style={{ background: BRAND.violet }}>
                      {m.nombre} · {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {noAplica.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-400 shrink-0" />
                  <strong style={{ color: BRAND.ink }}>
                    {noAplica.length === 1 ? "1 caso marcado «No aplica» por el cliente" : `${noAplica.length} casos marcados «No aplica» por el cliente`}
                  </strong>
                  <span className="text-xs text-gray-500">— no cuentan en el avance</span>
                </p>
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  {noAplica.map(({ c, m }) => (
                    <button key={c.id} type="button" onClick={() => m && onOpenModule(m.id)}
                      className="w-full text-left px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 text-sm">
                      <span className="font-semibold" style={{ color: BRAND.ink }}>{c.codigo}</span>{" "}
                      <span style={{ color: BRAND.ink }}>{c.caso}</span>
                      <span className="block text-xs text-gray-500">
                        {m ? m.nombre : ""} · {c.updated_by} · {fmtDateTime(c.updated_at)}{c.comentario ? " · «" + c.comentario + "»" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <StatusEmail project={project} modules={modules} cases={cases} byModule={byModule} incidentDates={incidentDates} snapshots={snapshots}
          ciclo={ciclo} me={me} isAdmin={isAdmin} participants={participants} onProjectSaved={onProjectSaved} />
        {isAdmin ? (
          modules.length > 0 ? (
            <ImportWizard project={project} modules={modules} ciclo={ciclo} me={me} onDone={onImported} />
          ) : (
            <p className="bg-white rounded-xl border border-gray-200 p-5 text-sm">
              El proyecto todavía no tiene módulos. Se crean con <code>sql/nuevo_proyecto.sql</code>.
            </p>
          )
        ) : (
          <p className="bg-white rounded-xl border border-gray-200 p-5 text-sm">
            La importación de casos la hace el administrador del proyecto (PM de Witbor).
          </p>
        )}
      </section>
    );
  }

  window.UAT = Object.assign(window.UAT || {}, { AdminTab });
})();
