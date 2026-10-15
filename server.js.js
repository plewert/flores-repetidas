// ============================================================
//  Servidor del juego "Flores repetidas" (memoria multijugador)
//  Gana quien consiga más parejas de flores iguales.
//
//  Instalación:
//    npm init -y
//    npm install express socket.io
//    node server.js
//
//  Abre http://localhost:3000  (sirve los archivos de /public)
// ============================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const MAX_JUGADORES = 4;
const PAREJAS = 8; // 16 cartas (tablero 4x4)
const RETRASO_FALLO_MS = 1200; // tiempo que se ven las cartas si no coinciden

const FLORES = ["🌹", "🌻", "🌷", "🌸", "🌼", "🌺", "💐", "🪻", "🪷", "🏵️"];

app.use(express.static("public"));

// salas[codigo] = { codigo, host, jugadores[], cartas[], turno, volteadas[], fase, bloqueada }
const salas = {};

// ---------- utilidades ----------
function generarCodigo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let codigo;
  do {
    codigo = Array.from({ length: 4 }, () => letras[Math.floor(Math.random() * letras.length)]).join("");
  } while (salas[codigo]);
  return codigo;
}

function mezclar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function crearTablero() {
  const elegidas = mezclar([...FLORES]).slice(0, PAREJAS);
  const cartas = mezclar([...elegidas, ...elegidas]).map((flor) => ({
    flor,
    estado: "oculta", // oculta | volteada | emparejada
  }));
  return cartas;
}

// Vista pública: NO revela la flor de las cartas ocultas (anti-trampas)
function estadoPublico(sala) {
  return {
    codigo: sala.codigo,
    fase: sala.fase, // espera | jugando | terminado
    host: sala.host,
    turno: sala.jugadores[sala.turno]?.id ?? null,
    jugadores: sala.jugadores.map((j) => ({
      id: j.id,
      nombre: j.nombre,
      puntos: j.puntos,
    })),
    cartas: sala.cartas.map((c) => ({
      estado: c.estado,
      flor: c.estado === "oculta" ? null : c.flor,
    })),
    ganadores: sala.ganadores || [],
  };
}

function emitirEstado(sala) {
  io.to(sala.codigo).emit("estado", estadoPublico(sala));
}

function siguienteTurno(sala) {
  sala.turno = (sala.turno + 1) % sala.jugadores.length;
}

function terminarSiCorresponde(sala) {
  const quedan = sala.cartas.some((c) => c.estado !== "emparejada");
  if (quedan) return false;

  sala.fase = "terminado";
  const max = Math.max(...sala.jugadores.map((j) => j.puntos));
  sala.ganadores = sala.jugadores.filter((j) => j.puntos === max).map((j) => j.id);
  emitirEstado(sala);
  io.to(sala.codigo).emit("finJuego", {
    ganadores: sala.jugadores.filter((j) => j.puntos === max).map((j) => j.nombre),
    empate: sala.ganadores.length > 1,
    puntos: max,
  });
  return true;
}

function limpiarNombre(nombre) {
  return String(nombre || "Jugador").trim().slice(0, 16) || "Jugador";
}

// ---------- sockets ----------
io.on("connection", (socket) => {
  let codigoSala = null;

  const salaActual = () => salas[codigoSala];

  // Crear sala
  socket.on("crearSala", ({ nombre } = {}, cb = () => {}) => {
    const codigo = generarCodigo();
    salas[codigo] = {
      codigo,
      host: socket.id,
      jugadores: [{ id: socket.id, nombre: limpiarNombre(nombre), puntos: 0 }],
      cartas: [],
      turno: 0,
      volteadas: [],
      fase: "espera",
      bloqueada: false,
      ganadores: [],
    };
    codigoSala = codigo;
    socket.join(codigo);
    cb({ ok: true, codigo, id: socket.id });
    emitirEstado(salas[codigo]);
  });

  // Unirse a sala
  socket.on("unirseSala", ({ codigo, nombre } = {}, cb = () => {}) => {
    codigo = String(codigo || "").toUpperCase().trim();
    const sala = salas[codigo];
    if (!sala) return cb({ ok: false, error: "La sala no existe" });
    if (sala.fase !== "espera") return cb({ ok: false, error: "La partida ya empezó" });
    if (sala.jugadores.length >= MAX_JUGADORES) return cb({ ok: false, error: "Sala llena" });

    sala.jugadores.push({ id: socket.id, nombre: limpiarNombre(nombre), puntos: 0 });
    codigoSala = codigo;
    socket.join(codigo);
    cb({ ok: true, codigo, id: socket.id });
    emitirEstado(sala);
  });

  // Iniciar partida (solo el host)
  socket.on("iniciar", (_, cb = () => {}) => {
    const sala = salaActual();
    if (!sala) return cb({ ok: false, error: "No estás en una sala" });
    if (sala.host !== socket.id) return cb({ ok: false, error: "Solo el anfitrión puede iniciar" });
    if (sala.jugadores.length < 2) return cb({ ok: false, error: "Se necesitan al menos 2 jugadores" });
    if (sala.fase === "jugando") return cb({ ok: false, error: "Ya está en juego" });

    sala.cartas = crearTablero();
    sala.jugadores.forEach((j) => (j.puntos = 0));
    sala.turno = 0;
    sala.volteadas = [];
    sala.ganadores = [];
    sala.bloqueada = false;
    sala.fase = "jugando";
    cb({ ok: true });
    emitirEstado(sala);
  });

  // Voltear una carta
  socket.on("voltear", ({ indice } = {}, cb = () => {}) => {
    const sala = salaActual();
    if (!sala || sala.fase !== "jugando") return cb({ ok: false });
    if (sala.bloqueada) return cb({ ok: false, error: "Espera..." });

    const jugador = sala.jugadores[sala.turno];
    if (jugador.id !== socket.id) return cb({ ok: false, error: "No es tu turno" });

    const carta = sala.cartas[indice];
    if (!Number.isInteger(indice) || !carta || carta.estado !== "oculta") {
      return cb({ ok: false, error: "Carta no válida" });
    }

    carta.estado = "volteada";
    sala.volteadas.push(indice);
    cb({ ok: true });
    emitirEstado(sala);

    if (sala.volteadas.length < 2) return;

    // Ya hay dos cartas volteadas: comprobar
    const [a, b] = sala.volteadas;
    sala.volteadas = [];

    if (sala.cartas[a].flor === sala.cartas[b].flor) {
      // ¡Pareja! Suma punto y repite turno
      sala.cartas[a].estado = "emparejada";
      sala.cartas[b].estado = "emparejada";
      jugador.puntos += 1;
      io.to(sala.codigo).emit("pareja", { jugador: jugador.nombre, flor: sala.cartas[a].flor });
      emitirEstado(sala);
      terminarSiCorresponde(sala);
    } else {
      // Fallo: se muestran un momento y luego se ocultan
      sala.bloqueada = true;
      setTimeout(() => {
        if (!salas[sala.codigo]) return;
        sala.cartas[a].estado = "oculta";
        sala.cartas[b].estado = "oculta";
        siguienteTurno(sala);
        sala.bloqueada = false;
        emitirEstado(sala);
      }, RETRASO_FALLO_MS);
    }
  });

  // Nueva partida (solo el host, cuando terminó)
  socket.on("reiniciar", (_, cb = () => {}) => {
    const sala = salaActual();
    if (!sala || sala.host !== socket.id) return cb({ ok: false });
    sala.fase = "espera";
    sala.cartas = [];
    sala.ganadores = [];
    sala.jugadores.forEach((j) => (j.puntos = 0));
    cb({ ok: true });
    emitirEstado(sala);
  });

  // Desconexión
  socket.on("disconnect", () => {
    const sala = salaActual();
    if (!sala) return;

    const idx = sala.jugadores.findIndex((j) => j.id === socket.id);
    if (idx === -1) return;
    sala.jugadores.splice(idx, 1);

    if (sala.jugadores.length === 0) {
      delete salas[sala.codigo];
      return;
    }

    if (sala.host === socket.id) sala.host = sala.jugadores[0].id;

    if (sala.fase === "jugando") {
      if (sala.jugadores.length < 2) {
        // Se quedó solo: termina la partida
        sala.fase = "terminado";
        sala.ganadores = [sala.jugadores[0].id];
        io.to(sala.codigo).emit("finJuego", {
          ganadores: [sala.jugadores[0].nombre],
          empate: false,
          puntos: sala.jugadores[0].puntos,
          motivo: "Los demás jugadores se fueron",
        });
      } else {
        // Ajustar el turno
        if (idx < sala.turno) sala.turno -= 1;
        if (sala.turno >= sala.jugadores.length) sala.turno = 0;
        // Si se iba con cartas volteadas, ocultarlas
        sala.volteadas.forEach((i) => {
          if (sala.cartas[i].estado === "volteada") sala.cartas[i].estado = "oculta";
        });
        sala.volteadas = [];
      }
    }
    emitirEstado(sala);
  });
});

server.listen(PORT, () => {
  console.log(`🌸 Servidor de Flores Repetidas en http://localhost:${PORT}`);
});
