// Flores Repetidas v2: partida libre (2-4), torneo eliminatorio (2-10), reconexión, chat, temporizador
const express = require("express"), http = require("http"), crypto = require("crypto");
const { Server } = require("socket.io");
const app = express(), server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static("public", { dotfiles: "allow" })); // permite /.well-known/assetlinks.json

const F = ["🌹","🌻","🌷","🌸","🌼","🌺","💐","🪻","🪷","🏵️","🌿","🍀","🌵","🌴","🌱","🍁","🍄","🌾"];
const COL = ["#e0457b","#3a8fe0","#3aa76d","#e0a030","#8f5ae0","#e05a2a","#20b2aa","#a0522d","#d63fd6","#607d8b"];
const TURNO_MS = 20000, FALLO_MS = 1200, salas = {};
const mez = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cod = () => { let c; do c = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.random() * 24 | 0]).join(""); while (salas[c]); return c; };
const J = (s, id) => s.jugadores.find(j => j.id === id);
let cola = []; // jugadores buscando partida rápida
// ---- estadísticas por jugador (copas, torneos...) ----
// Se guardan en datos.json. En Render gratis el disco se borra al reiniciar, pero cada jugador
// guarda su copia en su navegador y la reenvía al conectarse, así el ranking se reconstruye.
const fs = require("fs"), ARCH = process.env.DATOS || "datos.json";
let stats = {}, cuentas = {}, tokens = {}, sucio = false, pool = null;
// Si defines DATABASE_URL (PostgreSQL gratis en Neon/Supabase) los datos viven en la base y no se borran nunca.
if (process.env.DATABASE_URL) { try { const { Pool } = require("pg"); pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); } catch (e) { console.log("Falta instalar pg: npm install pg"); } }
async function cargar() {
  try {
    let d;
    if (pool) { await pool.query("create table if not exists kv(k text primary key, v jsonb)"); const q = await pool.query("select v from kv where k='datos'"); d = q.rows[0] && q.rows[0].v; }
    else d = JSON.parse(fs.readFileSync(ARCH, "utf8"));
    if (d) { if (d.stats || d.cuentas) { stats = d.stats || {}; cuentas = d.cuentas || {}; tokens = d.tokens || {}; } else stats = d; }
  } catch (e) {}
}
setInterval(async () => {
  if (!sucio) return; sucio = false; const d = { stats, cuentas, tokens };
  try { if (pool) await pool.query("insert into kv(k,v) values('datos',$1) on conflict(k) do update set v=$1", [JSON.stringify(d)]); else fs.writeFileSync(ARCH, JSON.stringify(d)); } catch (e) { sucio = true; }
}, 8000);
const AVS = new Set(["🌸","🐝","🐞","🦋","🦊","🐢","🧚","🦉","🦚","🐉","🦄","🧙","🔥"]);
// personajes que solo salen en cofres (mismo orden y rareza que en el cliente)
const CF = ["🐱","🐶","🐸","🐼","🐵","🥷","🤖","🦅","🐺","👽","🐲","🦖","🧞","🧜","🦁","🐯","🦈","🧛","🦂","🐙","🌞","💀","🛸"], RARCF = [0,0,0,0,0,1,1,1,1,2,2,2,3,3,3,3,3,3,3,4,4,4,4], CFS = new Set(CF), COFRE = 50;
CF.forEach(c => AVS.add(c));
function st(k, n) {
  const x = stats[k] = stats[k] || { nombre: n || "Jugador", copas: 0, torneos: 0, partidas: 0, parejas: 0 };
  x.gastado = x.gastado || 0; x.bonus = x.bonus || 0; x.items = x.items || [];
  return x;
}
// monedas = 10 por copa + 25 por torneo + 2 por partida + 1 por pareja + bonus - gastado
const saldo = x => x.copas * 10 + x.torneos * 25 + x.partidas * 2 + x.parejas + x.bonus - x.gastado;
function reg(j, d) {
  if (!j || !j.pid) return;
  const x = st(j.pid, j.nombre); x.nombre = j.nombre;
  for (const k in d) x[k] += d[k];
  sucio = true; if (j.sid) io.to(j.sid).emit("perfil", x);
}
const hash = (c, sal) => crypto.scryptSync(c, sal, 32).toString("hex");
const limpiarU = u => String(u || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16);
const difundir = () => io.emit("online", { n: io.sockets.sockets.size, b: cola.length });
const ESPERA_BOT = 6 * 60 * 1000; // 6 minutos
setInterval(() => {
  const ya = cola.filter(x => x.socket.connected && Date.now() - x.t >= ESPERA_BOT);
  if (!ya.length) return;
  cola = cola.filter(x => !ya.includes(x));
  ya.forEach(x => {
    const c = cod(), s = salas[c] = { codigo: c, host: null, modo: "libre", tam: 4, fase: "espera", auto: true, conBot: true, jugadores: [] };
    const id = crypto.randomUUID(), j = x.nuevo(s, id, x.nombre); j.conectado = false; j.pid = x.socket.data.pid; j.av = x.socket.data.av || "🌸"; s.host = id;
    s.jugadores.push({ id: "bot_" + c, av: "🤖", nombre: "Bot Difícil", color: COL.find(k => !s.jugadores.some(y => y.color === k)) || COL[1], victorias: 0, puntos: 0, conectado: true, bot: true });
    x.socket.emit("emparejado", { codigo: c, token: id, bot: true });
  });
  difundir();
}, 5000);

function pub(s) {
  const p = s.partida;
  return {
    codigo: s.codigo, host: s.host, modo: s.modo, tam: s.tam, fase: s.fase, ronda: s.ronda ? s.ronda.num : 0,
    campeon: s.campeon || null, aviso: s.aviso || "",
    jugadores: s.jugadores.map(j => ({ id: j.id, av: j.av, nombre: j.nombre, color: j.color, victorias: j.victorias, puntos: j.puntos, conectado: j.conectado, elim: !!j.elim, pw: j.pw || 0 })),
    juegan: p ? p.ids : [], turno: p ? p.ids[p.turno] : null, rest: p ? Math.max(0, p.limite - Date.now()) : 0,
    cartas: p ? p.cartas.map(c => ({ e: c.e, f: c.e === "oculta" ? null : c.f })) : []
  };
}
const emit = s => io.to(s.codigo).emit("estado", pub(s));

function avanzar(p) { p.turno = (p.turno + 1) % p.ids.length; if (p.cong && p.ids[p.turno] === p.cong) { p.cong = null; p.turno = (p.turno + 1) % p.ids.length; } }
function reloj(s) {
  const p = s.partida; clearTimeout(p.t); p.limite = Date.now() + TURNO_MS;
  { const tj = J(s, p.ids[p.turno]); if (tj && tj.bot) setTimeout(() => botMueve(s, p), 900); }
  p.t = setTimeout(() => {
    p.vol.forEach(i => p.cartas[i].e = "oculta"); p.vol = []; p.bloq = false;
    avanzar(p); reloj(s); emit(s);
  }, TURNO_MS);
}
function empezar(s, ids) {
  const fl = mez([...F]).slice(0, s.tam * s.tam / 2);
  s.partida = { ids, cartas: mez([...fl, ...fl]).map(f => ({ f, e: "oculta" })), turno: 0, vol: [], bloq: false, limite: 0 };
  ids.forEach(i => { const j = J(s, i); j.puntos = 0; j.pw = 1; j.racha = 0; }); s.fase = "jugando"; s.aviso = ""; reloj(s);
}
function siguiente(s) {
  const r = s.ronda;
  for (;;) {
    if (r.pend.length >= 2) { empezar(s, [r.pend.shift(), r.pend.shift()]); return emit(s); }
    if (r.pend.length === 1) r.gan.push(r.pend.shift());
    if (r.gan.length === 1) { s.fase = "fin"; s.campeon = r.gan[0]; reg(J(s, r.gan[0]), { torneos: 1 }); s.aviso = "🏆 Campeón: " + J(s, r.gan[0]).nombre; return emit(s); }
    r.pend = r.gan; r.gan = []; r.num++;
  }
}
function voltear(s, id, i) {
  const p = s && s.partida;
  if (!p || s.fase !== "jugando" || p.bloq || p.ids[p.turno] !== id) return;
  const c = p.cartas[i]; if (!c || c.e !== "oculta") return;
  const mem = p.mem = p.mem || {};
  c.e = "volteada"; p.vol.push(i); mem[i] = c.f; emit(s);
  if (p.vol.length < 2) return;
  clearTimeout(p.t);
  const [a, b] = p.vol; p.vol = []; const A = p.cartas[a], B = p.cartas[b];
  if (A.f === B.f) {
    A.e = B.e = "emparejada"; delete mem[a]; delete mem[b];
    const jj = J(s, id); jj.puntos++; jj.racha = (jj.racha || 0) + 1; if (jj.racha % 2 === 0) jj.pw = (jj.pw || 0) + 1;
    io.to(s.codigo).emit("sonido", "ok"); emit(s);
    p.cartas.every(x => x.e === "emparejada") ? finPartida(s) : reloj(s);
  } else {
    p.bloq = true; J(s, id).racha = 0; io.to(s.codigo).emit("sonido", "no");
    setTimeout(() => { if (s.partida !== p || !p.bloq) return; A.e = B.e = "oculta"; p.bloq = false; avanzar(p); reloj(s); emit(s); }, FALLO_MS);
  }
}
// Bot difícil del servidor: recuerda el 95 % de las cartas que se han visto
function botMueve(s, p) {
  const ok = () => salas[s.codigo] === s && s.partida === p && s.fase === "jugando" && !p.bloq;
  if (!ok()) return;
  const bot = J(s, p.ids[p.turno]); if (!bot || !bot.bot) return;
  const lib = () => p.cartas.map((c, i) => c.e === "oculta" ? i : -1).filter(i => i >= 0), mem = p.mem = p.mem || {}, K = 0.95;
  const par = (() => { const m = {}; for (const k in mem) { if (p.cartas[k].e !== "oculta") continue; const f = mem[k]; if (m[f] !== undefined) return [m[f], +k]; m[f] = +k; } })();
  const l = lib(); if (!l.length) return;
  const a = par && Math.random() < K ? par[0] : l[Math.random() * l.length | 0];
  voltear(s, bot.id, a);
  setTimeout(() => {
    if (!ok() || p.ids[p.turno] !== bot.id) return;
    const rs = lib(), k2 = Object.keys(mem).map(Number).find(x => x !== a && p.cartas[x].e === "oculta" && mem[x] === p.cartas[a].f);
    voltear(s, bot.id, k2 !== undefined && Math.random() < K ? k2 : rs[Math.random() * rs.length | 0]);
  }, 800);
}
function finPartida(s) {
  const p = s.partida; clearTimeout(p.t);
  const js = p.ids.map(i => J(s, i)), max = Math.max(...js.map(j => j.puntos)), gan = js.filter(j => j.puntos === max);
  io.to(s.codigo).emit("sonido", "fin");
  if (gan.length > 1) {
    s.aviso = "Empate: se repite la partida"; s.fase = "pausa"; emit(s);
    return setTimeout(() => { if (s.fase === "pausa" && !p.decidida) { empezar(s, p.ids); emit(s); } }, 3000);
  }
  gan[0].victorias++; p.decidida = true;
  js.forEach(j => reg(j, { partidas: 1, parejas: j.puntos, copas: s.conBot ? 0 : (j === gan[0] ? 1 : 0) }));
  if (s.modo === "libre") { s.fase = "fin"; s.campeon = gan[0].id; s.aviso = "🏆 Ganó " + gan[0].nombre; return emit(s); }
  p.ids.forEach(i => { if (i !== gan[0].id) J(s, i).elim = true; });
  s.ronda.gan.push(gan[0].id); s.aviso = gan[0].nombre + " avanza"; s.fase = "pausa"; emit(s);
  setTimeout(() => { if (s.fase === "pausa") siguiente(s); }, 3500);
}

io.on("connection", socket => {
  let cs = null, yo = null;
  difundir();
  const sala = () => salas[cs];
  const entrar = (s, j) => { cs = s.codigo; yo = j.id; j.sid = socket.id; j.conectado = true; socket.join(s.codigo); clearTimeout(s.lim); };
  const nuevo = (s, id, nombre) => {
    const j = { id, pid: socket.data.pid, av: socket.data.av || "🌸", nombre: String(nombre || "").trim().slice(0, 16) || "Jugador", victorias: 0, puntos: 0, conectado: true,
      color: COL.find(c => !s.jugadores.some(x => x.color === c)) || COL[0] };
    s.jugadores.push(j); return j;
  };

  socket.on("crearSala", ({ nombre, modo, tam } = {}, cb = () => {}) => {
    const c = cod(), id = crypto.randomUUID();
    const s = salas[c] = { codigo: c, host: id, modo: modo === "torneo" ? "torneo" : "libre", tam: tam === 6 ? 6 : 4, fase: "espera", jugadores: [] };
    entrar(s, nuevo(s, id, nombre)); cb({ ok: true, codigo: c, token: id }); emit(s);
  });
  socket.on("unirseSala", ({ codigo, nombre } = {}, cb = () => {}) => {
    const s = salas[String(codigo || "").toUpperCase().trim()];
    if (!s) return cb({ ok: false, error: "La sala no existe" });
    if (s.fase !== "espera") return cb({ ok: false, error: "La partida ya empezó" });
    if (s.jugadores.length >= (s.modo === "torneo" ? 10 : 4)) return cb({ ok: false, error: "Sala llena" });
    const id = crypto.randomUUID(); entrar(s, nuevo(s, id, nombre)); cb({ ok: true, codigo: s.codigo, token: id }); emit(s);
  });
  socket.on("reconectar", ({ codigo, token } = {}, cb = () => {}) => {
    const s = salas[codigo], j = s && J(s, token);
    if (!j) return cb({ ok: false });
    entrar(s, j); cb({ ok: true });
    if (s.auto && s.fase === "espera" && s.jugadores.every(x => x.conectado)) { s.auto = false; empezar(s, mez(s.jugadores.map(x => x.id))); }
    emit(s);
  });
  socket.on("config", ({ modo, tam } = {}) => {
    const s = sala(); if (!s || s.host !== yo || s.fase !== "espera") return;
    if (modo) s.modo = modo === "torneo" ? "torneo" : "libre";
    if (tam) s.tam = tam === 6 ? 6 : 4;
    emit(s);
  });
  socket.on("iniciar", (_, cb = () => {}) => {
    const s = sala(); if (!s || (s.host !== yo && s.fase !== "fin") || !["espera", "fin"].includes(s.fase)) return cb({ ok: false });
    const act = s.jugadores.filter(j => j.conectado);
    if (act.length < 2) return cb({ ok: false, error: "Se necesitan al menos 2 jugadores" });
    if (s.modo === "libre" && act.length > 4) return cb({ ok: false, error: "Máximo 4 en partida libre" });
    s.jugadores = act; s.jugadores.forEach(j => { j.elim = false; j.puntos = 0; }); s.campeon = null;
    if (s.modo === "libre") { empezar(s, mez(act.map(j => j.id))); emit(s); }
    else { s.ronda = { num: 1, pend: mez(act.map(j => j.id)), gan: [] }; siguiente(s); }
    cb({ ok: true });
  });
  socket.on("voltear", ({ i } = {}) => voltear(sala(), yo, i));
  socket.on("chat", t => {
    const s = sala(), j = s && J(s, yo);
    if (j) io.to(s.codigo).emit("chat", { n: j.nombre, c: j.color, t: String(t).slice(0, 120) });
  });
  socket.on("perfil", ({ pid, nombre, stats: c, av } = {}) => {
    const k = socket.data.cuenta ? socket.data.pid : "p_" + String(pid || "").replace(/[^\w-]/g, "").slice(0, 48);
    if (k === "p_") return;
    socket.data.pid = k; const cta = !!socket.data.cuenta;
    const x = st(k, nombre); if (nombre) x.nombre = String(nombre).slice(0, 16);
    for (const f of ["copas", "torneos", "partidas", "parejas", "gastado", "bonus"]) {
      const v = cta ? 0 : Number(c && c[f]);
      if (v >= 0 && v < 1e5 && v > x[f]) { x[f] = Math.floor(v); sucio = true; }
    }
    if (!cta && c && Array.isArray(c.items)) c.items.forEach(i => { if (CFS.has(i) && !x.items.includes(i)) { x.items.push(i); sucio = true; } });
    if (AVS.has(av) && (!CFS.has(av) || x.items.includes(av))) {
      socket.data.av = av; x.av = av; sucio = true;
      const s = sala(), j = s && J(s, yo);
      if (j) { j.av = av; emit(s); }
    }
    socket.emit("perfil", x);
  });
  socket.on("cofre", (_, cb = () => {}) => {
    const k = socket.data.pid; if (!k) return cb({ ok: false, error: "Sin perfil" });
    const x = st(k);
    if (saldo(x) < COFRE) return cb({ ok: false, error: "Te faltan monedas" });
    x.gastado += COFRE;
    // probabilidades: común 54 %, raro 28 %, épico 13 %, legendario 4 %, mítico 1 %. Garantía: legendario o mejor cada 30 cofres.
    const u = Math.random() * 100; let rar = u < 54 ? 0 : u < 82 ? 1 : u < 95 ? 2 : u < 99 ? 3 : 4;
    x.sinLeg = (x.sinLeg || 0) + 1; if (x.sinLeg >= 30 && rar < 3) rar = 3; if (rar >= 3) x.sinLeg = 0;
    const pool = CF.filter((_, i) => RARCF[i] === rar), a = pool[Math.random() * pool.length | 0];
    const dup = x.items.includes(a), dv = [10, 20, 30, 60, 150][rar];
    if (dup) x.bonus += dv; else x.items.push(a);
    sucio = true; socket.emit("perfil", x); cb({ ok: true, a, dup: dup ? dv : 0 });
  });
  socket.on("poder", tipo => {
    const s = sala(), p = s && s.partida, j = s && J(s, yo);
    if (!p || s.fase !== "jugando" || p.bloq || p.vol.length || p.ids[p.turno] !== yo || !(j.pw > 0)) return;
    if (tipo === "espiar") {
      const h = p.cartas.map((c, i) => c.e === "oculta" ? i : -1).filter(i => i >= 0);
      if (!h.length) return;
      const i = h[Math.random() * h.length | 0]; j.pw--; socket.emit("espia", { i, f: p.cartas[i].f });
    } else if (tipo === "congelar") {
      if (p.cong) return;
      j.pw--; p.cong = p.ids[(p.turno + 1) % p.ids.length];
      io.to(s.codigo).emit("aviso", "🧊 " + j.nombre + " congeló a " + J(s, p.cong).nombre);
    } else return;
    emit(s);
  });
  let intentos = 0;
  const entrarCuenta = u => {
    socket.data.cuenta = u; socket.data.pid = "u_" + u;
    const x = st(socket.data.pid, cuentas[u].nombre); x.nombre = cuentas[u].nombre; sucio = true;
    if (x.av && AVS.has(x.av)) socket.data.av = x.av;
    socket.emit("perfil", x);
  };
  const nuevoToken = u => { const t = crypto.randomBytes(24).toString("hex"); tokens[t] = u; sucio = true; return t; };
  socket.on("registro", ({ usuario, clave, nombre } = {}, cb = () => {}) => {
    const u = limpiarU(usuario);
    if (u.length < 3) return cb({ ok: false, error: "Usuario: mínimo 3 letras o números" });
    if (String(clave || "").length < 6) return cb({ ok: false, error: "Contraseña: mínimo 6 caracteres" });
    if (cuentas[u]) return cb({ ok: false, error: "Ese usuario ya existe" });
    const sal = crypto.randomBytes(16).toString("hex");
    cuentas[u] = { sal, hash: hash(String(clave), sal), nombre: String(nombre || u).slice(0, 16) || u };
    entrarCuenta(u); cb({ ok: true, token: nuevoToken(u), usuario: u });
  });
  socket.on("login", ({ usuario, clave } = {}, cb = () => {}) => {
    const u = limpiarU(usuario), c = cuentas[u];
    if (++intentos > 8) return cb({ ok: false, error: "Demasiados intentos, recarga la página" });
    if (!c || !crypto.timingSafeEqual(Buffer.from(hash(String(clave || ""), c.sal)), Buffer.from(c.hash))) return cb({ ok: false, error: "Usuario o contraseña incorrectos" });
    entrarCuenta(u); cb({ ok: true, token: nuevoToken(u), usuario: u });
  });
  socket.on("sesion", ({ token } = {}, cb = () => {}) => {
    const u = tokens[token]; if (!u || !cuentas[u]) return cb({ ok: false });
    entrarCuenta(u); cb({ ok: true, usuario: u });
  });
  socket.on("logout", ({ token } = {}, cb = () => {}) => {
    delete tokens[token]; socket.data.cuenta = null; socket.data.pid = null; sucio = true; cb({ ok: true });
  });
  socket.on("reaccion", e => {
    const s = sala(), j = s && J(s, yo);
    if (j && ["😂", "👏", "😱", "🔥"].includes(e)) io.to(s.codigo).emit("reaccion", { e, n: j.nombre });
  });
  socket.on("ranking", (_, cb = () => {}) => {
    const l = Object.entries(stats).filter(([k, v]) => k.startsWith("u_") && v.partidas > 0).map(([k, v]) => ({ k, ...v }))
      .sort((a, b) => b.copas - a.copas || b.torneos - a.torneos || a.partidas - b.partidas);
    const i = l.findIndex(x => x.k === socket.data.pid);
    cb({ top: l.slice(0, 20).map(x => ({ a: x.av, n: x.nombre, c: x.copas, t: x.torneos, p: x.partidas, yo: x.k === socket.data.pid })), pos: i + 1, total: l.length, cuenta: !!socket.data.cuenta });
  });
  socket.on("salir", () => {
    const s = sala(), j = s && J(s, yo);
    if (!s || !j) return;
    const id = yo; socket.leave(s.codigo); cs = null; yo = null;
    j.salio = true; j.conectado = false; j.elim = true;
    if (s.fase === "espera" || s.fase === "fin") s.jugadores = s.jugadores.filter(x => x !== j);
    else {
      if (s.ronda) { s.ronda.pend = s.ronda.pend.filter(i => i !== id); s.ronda.gan = s.ronda.gan.filter(i => i !== id); }
      const p = s.partida;
      if (p && !p.decidida && p.ids.includes(id)) {
        clearTimeout(p.t); p.bloq = false; p.vol = [];
        p.cartas.forEach(c => { if (c.e === "volteada") c.e = "oculta"; });
        const rest = p.ids.filter(i => i !== id);
        if (s.modo === "libre" && rest.length >= 2) {
          let t = p.turno; if (p.ids.indexOf(id) < t) t--;
          p.ids = rest; p.turno = t >= rest.length ? 0 : t; reloj(s);
        } else {
          const g = J(s, rest[0]); g.victorias++; p.decidida = true; reg(g, { partidas: 1, copas: 1 }); reg(j, { partidas: 1 });
          if (s.modo === "libre") { s.fase = "fin"; s.campeon = g.id; s.aviso = "🏆 Ganó " + g.nombre + " (el rival salió)"; }
          else { s.ronda.gan.push(g.id); s.aviso = g.nombre + " avanza (el rival salió)"; s.fase = "pausa"; setTimeout(() => { if (s.fase === "pausa") siguiente(s); }, 3000); }
        }
      }
      const act = s.jugadores.filter(x => !x.salio);
      if (act.length < 2 && s.fase !== "fin" && act.length === 1) {
        if (p) clearTimeout(p.t); s.fase = "fin"; s.campeon = act[0].id; s.aviso = "🏆 Ganó " + act[0].nombre + " (los demás salieron)";
      }
    }
    if (!s.jugadores.some(x => !x.salio && !x.bot)) { if (s.partida) clearTimeout(s.partida.t); delete salas[s.codigo]; return; }
    if (s.host === id) s.host = s.jugadores.find(x => !x.salio).id;
    emit(s);
  });
  const PREMIO = { facil: 2, medio: 30, dificil: 90 };
  socket.on("botIni", ({ n } = {}) => { socket.data.botIni = PREMIO[n] ? { n, t: Date.now() } : null; });
  socket.on("botGane", ({ n } = {}, cb = () => {}) => {
    const b = socket.data.botIni; socket.data.botIni = null;
    if (!b || b.n !== n || !socket.data.pid) return cb({ ok: false });
    if (Date.now() - b.t < 15000) return cb({ ok: false, error: "Partida demasiado rápida: sin premio" });
    const x = st(socket.data.pid); x.bonus += PREMIO[n]; sucio = true;
    socket.emit("perfil", x); cb({ ok: true, monedas: PREMIO[n] });
  });
  socket.on("buscar", ({ nombre } = {}) => {
    cola = cola.filter(x => x.socket !== socket && x.socket.connected);
    cola.push({ socket, nombre, t: Date.now(), nuevo });
    if (cola.length < 2) return difundir();
    const [a, b] = cola.splice(0, 2), c = cod();
    const s = salas[c] = { codigo: c, host: null, modo: "libre", tam: 4, fase: "espera", auto: true, jugadores: [] };
    [a, b].forEach(x => {
      const id = crypto.randomUUID(), j = nuevo(s, id, x.nombre); j.conectado = false; j.pid = x.socket.data.pid; j.av = x.socket.data.av || "🌸";
      if (!s.host) s.host = id;
      x.socket.emit("emparejado", { codigo: c, token: id });
    });
    difundir();
  });
  socket.on("cancelar", () => { cola = cola.filter(x => x.socket !== socket); difundir(); });
  socket.on("disconnect", () => {
    cola = cola.filter(x => x.socket !== socket); difundir();
    const s = sala(); if (!s) return;
    const j = J(s, yo); if (!j || j.sid !== socket.id) return;
    if (s.fase === "espera") {
      s.jugadores = s.jugadores.filter(x => x !== j);
      if (s.host === yo && s.jugadores[0]) s.host = s.jugadores[0].id;
    } else j.conectado = false;
    if (!s.jugadores.some(x => x.conectado && !x.bot)) s.lim = setTimeout(() => { if (s.partida) clearTimeout(s.partida.t); delete salas[s.codigo]; }, 600000);
    else emit(s);
  });
});

const PORT = process.env.PORT || 3000;
cargar().then(() => server.listen(PORT, () => console.log("🌸 Flores Repetidas v2 en http://localhost:" + PORT + (pool ? " (base de datos PostgreSQL)" : " (datos en archivo)"))));
