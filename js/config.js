/* ============================================================
   config.js — configuración global y conexión a la base de datos
   SUPABASE_URL y SUPABASE_KEY son PÚBLICOS por diseño (van en la
   app); la seguridad la dan el login y las reglas de la base (RLS).
   Aquí NO va nada de ningún cliente: un proyecto nuevo se crea por
   configuración en la base (sql/nuevo_proyecto.sql), sin tocar código.
   Publica en window.UAT: BRAND, SUPABASE_URL, SUPABASE_KEY,
   ACCOUNT_DOMAIN, REDMINE_URL, APP_URL, SEMAFORO
   ============================================================ */
(function () {
  /* ---------- Paleta de marca (Manual de marca Witbor 2026) ----------
     Cada color se usa por su rol. Los cuatro colores del gradiente
     son solo acentos; el único que va en botones y links es el azul. */
  const STOPS = ["#6ED2FF", "#3C72F8", "#9E37E6", "#F5649B"];
  const BRAND = {
    cta:    "#3C72F8",  // Azul Witbor — botón principal, links, resaltados
    dark:   "#0A1266",  // azul oscuro — encabezado y pantalla de acceso
    violet: "#672496",  // violeta — banner del modo TEST
    ink:    "#121228",  // títulos sobre fondo claro
    body:   "#5C5F66",  // texto sobre fondo claro
    soft:   "#F5F5F5",  // fondo claro
    light:  "#F5F5F5",  // títulos y texto corto sobre fondo oscuro
    lightBody: "#CCCCCC", // texto largo sobre fondo oscuro
    line:   "#D8DAE0",  // líneas de base y de grilla
    muted:  "#9CA3AF",  // líneas de referencia
    danger: "#BE123C",  // cifra de incidentes abiertos
    chart2: "#E0508A",  // segunda serie de la curva (validada junto al azul)
    testBorder: "#F0ABFC", // borde del aviso del modo TEST
    // Colores del gradiente del logo (cian → azul → violeta → rosa), en orden.
    stops: STOPS,
    // Logo de color (se usa sobre fondo claro y oscuro).
    logoColor: "img/logo-witbor-color.png",
  };

  /* ---------- Conexión a Supabase ----------
     Para cambiar de proyecto de Supabase: reemplaza estos dos valores
     (Supabase → Project Settings → API). La clave 'anon/publishable'
     es pública (no es secreta). */
  const SUPABASE_URL = "https://zsxjiltjfxinmsyrcecs.supabase.co";
  const SUPABASE_KEY = "sb_publishable_CVdyCR9qFOZ0t8FA7MFIRQ_OKslSQ0Q";

  /* Cada proyecto tiene dos cuentas fijas en Supabase Auth:
       uat-<proyecto>-witbor@<dominio>   y   uat-<proyecto>-cliente@<dominio>
     El usuario solo teclea la contraseña; por detrás se inicia sesión
     con el correo que corresponda. Los correos no son secretos. */
  const ACCOUNT_DOMAIN = "tracker.witbor.com";

  /* Los incidentes se cargan a mano y se muestran como enlace a Redmine. */
  const REDMINE_URL = "https://support.witbor.com/issues/";

  /* Dirección pública de la app (la que va en el estatus por correo).
     Vacía = la dirección desde la que se está usando. */
  const APP_URL = "";

  /* ---------- Semáforo por módulo (tablero y estatus por correo) ----------
     Compara los casos aprobados con los previstos a la fecha:
       aprobados / previstos >= verde  → verde
       aprobados / previstos >= ambar  → ámbar
       menos                           → rojo
     Si el módulo todavía no tiene casos previstos, va en gris («sin iniciar»).
     Valen para todos los proyectos. Para cambiarlos, editar estos dos números
     (0.8 = 80%) y volver a publicar. */
  const SEMAFORO = { verde: 0.8, ambar: 0.5 };

  window.UAT = Object.assign(window.UAT || {}, { BRAND, SUPABASE_URL, SUPABASE_KEY, ACCOUNT_DOMAIN, REDMINE_URL, APP_URL, SEMAFORO });
})();
