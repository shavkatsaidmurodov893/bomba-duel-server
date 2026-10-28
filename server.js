const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Game, rnd } = require('./game');
const R = require('./reward');
const U = require('./users');

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => res.json({ ok: true, name: 'Bomba Duel Server', v: '1.0' }));
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 8000,
});

// --- State ---
const rooms = new Map(); // code -> room
const queue = []; // { socketId, userId, rating }
const socketUser = new Map(); // socketId -> userId
const userSocket = new Map(); // userId -> socketId

const day = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);

function genCode() {
  let c;
  do {
    c = String((Math.random() * 10000) | 0).padStart(4, '0');
  } while (rooms.has(c));
  return c;
}

function makeRoom(kind, rated, players) {
  // players: [{ userId, socketId, idx }]
  const code = kind === 'bot' ? 'BOT' + Date.now() : genCode();
  const room = {
    code,
    kind, // 'queue' | 'friend' | 'bot'
    rated,
    players, // length 1 or 2
    g: null,
    rew: null, // [rw0, rw1] or null
    sch: false,
    bt: null,
    created: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function playerIdx(room, userId) {
  return room.players.findIndex((p) => p.userId === userId);
}

function getOpp(room, userId) {
  const i = playerIdx(room, userId);
  if (i < 0) return null;
  const o = room.players[1 - i];
  if (!o) return null;
  if (o.userId === 'bot') return { id: 'bot', name: 'Bot', av: '🤖', rating: 0 };
  return U.pub(U.byId(o.userId)); // byId is now async — call sites need await
}

function pushState(room) {
  if (!room || !room.g) return;
  const now = Date.now();
  for (const p of room.players) {
    if (p.userId === 'bot') continue;
    const sid = userSocket.get(p.userId);
    if (!sid) continue;
    const sock = io.sockets.sockets.get(sid);
    if (!sock) continue;
    const idx = playerIdx(room, p.userId);
    const view = room.g.view(idx, now);
    sock.emit('state', {
      code: room.code,
      rated: room.rated,
      noLamp: false,
      opp: getOpp(room, p.userId),
      reward: room.rew ? room.rew[idx] : null,
      ...view,
    });
  }
}

async function settle(room) {
  const g = room.g;
  if (!g || g.ph !== 'end') return;
  if (Math.min(g.open[0].size, g.open[1].size) < 3) {
    room.rew = [{ none: "o'yin juda qisqa tugadi" }, { none: "o'yin juda qisqa tugadi" }];
    return;
  }
  room.rew = [null, null];
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.userId === 'bot') continue;
    const u = await U.byId(p.userId);
    if (!u) continue;
    const score = g.res === -1 ? 0.5 : g.res === i ? 1 : 0;
    const mul = room.kind === 'bot' ? 0.1 : room.rated ? 1 : 0.25;
    const opp = room.players[1 - i];
    const oid = opp ? opp.userId : 'bot';
    const oppU = oid !== 'bot' ? await U.byId(oid) : null;
    const c = {
      lives: g.lives[i],
      oppMoves: g.open[1 - i].size,
      myMoves: g.open[i].size,
      oppTier: oppU ? U.tierIdx(oppU.rating) : 0,
      myTier: U.tierIdx(u.rating),
    };
    const rw = R.reward(u, oid, score, room.rated, day(), c, mul);
    if (room.kind === 'queue' && !rw.none) {
      let o = 0;
      if (g.res === i && g.lives[i] === 3) o += 2;
      if (g.res === i && rw.first) o += 1;
      if (g.sc(i) >= 20) o += 10;
      if (o) {
        u.olmos = (u.olmos || 0) + o;
        rw.olmos = o;
      }
    }
    room.rew[i] = rw;
    if (U.usePg) await U.saveUser(u); else U.users[u.id] = u;
    const sid = userSocket.get(p.userId);
    if (sid) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.emit('me', await U.mine(u));
    }
  }
}

async function after(room) {
  if (!room || !room.g) return;
  if (room.g.ph === 'end' && !room.rew) await settle(room);
  pushState(room);

  if (room.kind === 'bot' && room.g.ph === 'play' && !room.g.pending && room.g.cur === 1 && !room.bt) {
    room.bt = setTimeout(() => {
      room.bt = null;
      botMove(room);
    }, 700 + Math.random() * 600);
  }

  if (room.g.pending && !room.sch) {
    room.sch = true;
    setTimeout(async () => {
      room.sch = false;
      if (room.g && room.g.advance()) await after(room);
    }, 1000);
  }
}

function botMove(room) {
  const g = room && room.g;
  if (!g || g.ph !== 'play' || g.pending || g.cur !== 1) return;
  const f = [];
  for (let i = 0; i < 25; i++) if (!g.open[1].has(i)) f.push(i);
  if (!f.length) return;
  // Oddiy aqlli bot: ba'zan zona, asosan tasodifiy
  if (g.help[1] < 2 && Math.random() < 0.15 && f.length > 8) {
    g.zoneCheck(1, f[(Math.random() * f.length) | 0]);
  }
  g.openCell(1, f[(Math.random() * f.length) | 0]);
  after(room);
}

function startGame(room) {
  room.g = new Game();
  room.rew = null;
  if (room.kind === 'bot') {
    // Bot always places randomly as player 1
    room.g.place(1, [...rnd()]);
  }
  after(room);
}

function joinRoom(socket, code, user) {
  const room = rooms.get(code);
  if (!room) return { err: 'Xona topilmadi' };
  if (room.kind === 'bot') return { err: 'Xona topilmadi' };
  if (room.players.length >= 2) return { err: "Xona to'la" };
  // Already in room?
  if (room.players.some((p) => p.userId === user.id)) {
    return { ok: true, code, token: user.token, idx: playerIdx(room, user.id) };
  }
  room.players.push({ userId: user.id, socketId: socket.id, idx: 1 });
  socket.join(code);
  // Notify both
  const matched = { code, token: user.token, idx: 1 };
  socket.emit('matched', matched);
  // First player
  const p0 = room.players[0];
  const sid0 = userSocket.get(p0.userId);
  if (sid0) {
    const s0 = io.sockets.sockets.get(sid0);
    if (s0) s0.emit('matched', { code, token: U.byId(p0.userId).token, idx: 0 });
  }
  startGame(room);
  return { ok: true, code, token: user.token, idx: 1 };
}

function leaveQueue(socketId) {
  const i = queue.findIndex((q) => q.socketId === socketId);
  if (i >= 0) queue.splice(i, 1);
}

async function tryMatch() {
  if (queue.length < 2) return;
  queue.sort((a, b) => a.rating - b.rating);
  const a = queue.shift();
  const b = queue.shift();
  const ua = await U.byId(a.userId);
  const ub = await U.byId(b.userId);
  if (!ua || !ub) return;
  const room = makeRoom('queue', true, [
    { userId: a.userId, socketId: a.socketId, idx: 0 },
    { userId: b.userId, socketId: b.socketId, idx: 1 },
  ]);
  const sa = io.sockets.sockets.get(a.socketId);
  const sb = io.sockets.sockets.get(b.socketId);
  if (sa) {
    sa.join(room.code);
    sa.emit('matched', { code: room.code, token: ua.token, idx: 0 });
  }
  if (sb) {
    sb.join(room.code);
    sb.emit('matched', { code: room.code, token: ub.token, idx: 1 });
  }
  startGame(room);
}

// Tick all rooms
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.g && room.g.tick(now)) after(room);
  }
  // Clean old empty/ended rooms (30 min)
  for (const [code, room] of rooms) {
    if (now - room.created > 30 * 60 * 1000 && (!room.g || room.g.ph === 'end')) {
      rooms.delete(code);
    }
  }
}, 500);

// --- Socket handlers ---
io.on('connection', (socket) => {
  console.log('connect', socket.id);

  socket.on('hello', async (data, ack) => {
    const u = await U.getOrCreate(data && data.token);
    const oldSid = userSocket.get(u.id);

    if (oldSid && oldSid !== socket.id) {
      const oldSock = io.sockets.sockets.get(oldSid);
      if (oldSock) {
        oldSock.emit('msg', 'Boshqa qurilmadan kirildi');
        oldSock.disconnect(true);
      }
      socketUser.delete(oldSid);
    }

    socketUser.set(socket.id, u.id);
    userSocket.set(u.id, socket.id);

    for (const room of rooms.values()) {
      const idx = playerIdx(room, u.id);
      if (idx >= 0 && room._dc && room._dc[idx]) {
        clearTimeout(room._dc[idx]);
        delete room._dc[idx];
        if (room.g && room.g.ph !== 'end') {
          setTimeout(() => pushState(room), 100);
        }
      }
    }

    if (typeof ack === 'function') ack({ token: u.token, me: await U.mine(u) });
  });

  socket.on('profile', async (data, ack) => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    const r = await U.updateProfile(u, data && data.name, data && data.av);
    if (typeof ack === 'function') ack(r);
  });

  socket.on('top', async (data, ack) => {
    if (typeof data === 'function') {
      ack = data;
      data = {};
    }
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    const ti = data && Number.isInteger(data.tier) ? data.tier : u ? U.tierIdx(u.rating) : 0;
    const r = await U.top(ti);
    if (u) {
      const list = r.list;
      const meIdx = list.findIndex((x) => x.id === u.id);
      r.rank = meIdx >= 0 ? meIdx + 1 : 0;
    }
    if (typeof ack === 'function') ack(r);
  });

  socket.on('bot', async () => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return;
    leaveQueue(socket.id);
    const room = makeRoom('bot', false, [
      { userId: u.id, socketId: socket.id, idx: 0 },
      { userId: 'bot', socketId: null, idx: 1 },
    ]);
    socket.join(room.code);
    socket.emit('matched', { code: room.code, token: u.token, idx: 0 });
    startGame(room);
  });

  socket.on('queue', async () => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return;
    leaveQueue(socket.id);
    for (const room of rooms.values()) {
      if (room.g && room.g.ph !== 'end' && room.players.some((p) => p.userId === uid)) {
        return;
      }
    }
    queue.push({ socketId: socket.id, userId: uid, rating: u.rating || 0 });
    tryMatch();
  });

  socket.on('create', async (ack) => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    leaveQueue(socket.id);
    const room = makeRoom('friend', false, [{ userId: u.id, socketId: socket.id, idx: 0 }]);
    socket.join(room.code);
    if (typeof ack === 'function') ack({ code: room.code });
  });

  socket.on('join', async (data, ack) => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    const code = String((data && data.code) || '').replace(/\s/g, '').toUpperCase();
    const room = rooms.get(code) || rooms.get(code.padStart(4, '0'));
    if (!room) return typeof ack === 'function' && ack({ err: 'Xona topilmadi' });
    leaveQueue(socket.id);
    const r = joinRoom(socket, room.code, u);
    if (typeof ack === 'function') ack(r.err ? { err: r.err } : { token: r.token, code: r.code });
  });

  // Game actions — faqat faol socketdan
  function withRoom(fn) {
    const uid = socketUser.get(socket.id);
    if (!uid) return;
    if (userSocket.get(uid) !== socket.id) return;

    for (const room of rooms.values()) {
      const idx = playerIdx(room, uid);
      if (idx >= 0 && room.g && room.g.ph !== 'end') {
        U.byId(uid).then(u => {
          if (u) fn(room, idx, u);
        });
        return;
      }
    }
  }

  socket.on('place', (cells) => {
    withRoom((room, idx) => {
      if (room.g.place(idx, cells)) after(room);
    });
  });

  socket.on('open', (i) => {
    withRoom((room, idx) => {
      if (room.g.openCell(idx, i)) after(room);
    });
  });

  socket.on('zone', (i) => {
    withRoom((room, idx, u) => {
      if ((u.olmos || 0) < 2) {
        socket.emit('msg', "Olmos yetmaydi: zona yordamchisi 2 💎 turadi");
        return;
      }
      if (room.g.help[idx] >= 2) {
        socket.emit('msg', "Zona yordamchisi bu o'yinda 2 marta ishlatiladi");
        return;
      }
      if (room.g.zoneCheck(idx, i)) {
        u.olmos -= 2;
        U.save();
        socket.emit('me', U.mine(u));
        after(room);
      }
    });
  });

  socket.on('time', () => {
    withRoom((room, idx) => {
      if (room.g.addTime(idx)) after(room);
    });
  });

  socket.on('lamp', (ack) => {
    withRoom((room, idx, u) => {
      if (room.g.ph !== 'play') return typeof ack === 'function' && ack({ err: 'Hozir mumkin emas' });
      const pr = room.g.lampPrice(idx);
      if ((u.olmos || 0) < pr) return typeof ack === 'function' && ack({ err: 'Olmos yetmaydi' });
      if (room.g.lamp(idx) === null) return typeof ack === 'function' && ack({ err: "Hozir ishlatib bo'lmaydi" });
      u.olmos -= pr;
      U.save();
      socket.emit('me', U.mine(u));
      if (typeof ack === 'function') ack({ ok: 1 });
      after(room);
    });
  });

  socket.on('again', () => {
    withRoom((room, idx) => {
      // Both must agree — simple: restart if both still connected and game ended
      if (!room.g || room.g.ph !== 'end') return;
      room._again = room._again || new Set();
      room._again.add(idx);
      if (room._again.size >= (room.kind === 'bot' ? 1 : 2)) {
        room._again.clear();
        startGame(room);
      } else {
        pushState(room);
      }
    });
  });

  // Economy
  const adTimers = new Map();
  // TEST_MODE=true bo'lsa, 4.5s soxta reklama ishlaydi (kuniga 20 ta). Aks holda rad etiladi.
  const TEST_MODE = process.env.TEST_MODE === 'true';

  socket.on('adstart', () => {
    if (!TEST_MODE) return;
    adTimers.set(socket.id, Date.now());
  });

  socket.on('adclaim', async (ack) => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    if (userSocket.get(uid) !== socket.id) return typeof ack === 'function' && ack({ err: 'Noto‘g‘ri ulanish' });

    if (!TEST_MODE) {
      return typeof ack === 'function' && ack({ err: 'Reklama mukofoti hozircha mavjud emas' });
    }

    const t0 = adTimers.get(socket.id) || 0;
    if (Date.now() - t0 < 4500) return typeof ack === 'function' && ack({ err: "Reklamani oxirigacha ko'ring" });
    adTimers.delete(socket.id);

    const t = day();
    if (u.adDay !== t) {
      u.adDay = t;
      u.adN = 0;
    }
    if (u.adN >= 20) return typeof ack === 'function' && ack({ err: 'Bugungi reklama limiti tugadi' });

    u.adN++;
    u.olmos = (u.olmos || 0) + 1;
    if (U.usePg) await U.saveUser(u); else U.users[u.id] = u;
    if (typeof ack === 'function') ack({ me: await U.mine(u) });
  });

  socket.on('exchange', async (data, ack) => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    const can = Math.floor(u.coins / 70);
    if (can < 1) return typeof ack === 'function' && ack({ err: '70 tanga kerak' });
    const n = Math.max(1, Math.min(Math.floor(+(data && data.n) || 1), can));
    u.coins -= n * 70;
    u.olmos = (u.olmos || 0) + n;
    if (U.usePg) {
      await U.saveUser(u);
    } else {
      // JSON: byId dan kelgan obyekt allaqachon users ichida
      // o'zgarishlar saqlanadi
    }
    console.log('exchange', uid, 'coins:', u.coins, 'olmos:', u.olmos);
    if (typeof ack === 'function') ack({ me: await U.mine(u) });
  });

  socket.on('double', (ack) => {
    const uid = socketUser.get(socket.id);
    const u = U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    if (!TEST_MODE) return typeof ack === 'function' && ack({ err: 'Reklama mukofoti hozircha mavjud emas' });

    for (const room of rooms.values()) {
      const idx = playerIdx(room, uid);
      if (idx < 0 || !room.rew || !room.rew[idx]) continue;
      const rw = room.rew[idx];
      if (rw.none || !rw.coins || rw.doubled) return typeof ack === 'function' && ack({ err: 'Hozir mumkin emas' });
      const t0 = adTimers.get(socket.id) || 0;
      if (Date.now() - t0 < 4500) return typeof ack === 'function' && ack({ err: "Reklamani oxirigacha ko'ring" });
      adTimers.delete(socket.id);
      u.coins += rw.coins;
      rw.coins *= 2;
      rw.doubled = true;
      U.save();
      if (typeof ack === 'function') ack({ me: U.mine(u) });
      pushState(room);
      return;
    }
    if (typeof ack === 'function') ack({ err: 'Hozir mumkin emas' });
  });

  // Google Play Billing — xaridni tasdiqlash
  // Android ilova purchaseToken va productId yuboradi
  socket.on('purchase', async (data, ack) => {
    const uid = socketUser.get(socket.id);
    const u = await U.byId(uid);
    if (!u) return typeof ack === 'function' && ack({ err: 'Avval kirish kerak' });
    if (userSocket.get(uid) !== socket.id) return typeof ack === 'function' && ack({ err: 'Noto‘g‘ri ulanish' });

    const { productId, purchaseToken } = data || {};
    if (!productId || !purchaseToken) {
      return typeof ack === 'function' && ack({ err: 'Ma’lumot yetarli emas' });
    }

    // Tanga paketlari (do'kon rasmidagi)
    const PACKS = {
      'coins_3000': 3000,
      'coins_7000': 7000,
      'coins_15000': 15000,
      'coins_40000': 40000,
    };
    const amount = PACKS[productId];
    if (!amount) return typeof ack === 'function' && ack({ err: 'Noto‘g‘ri mahsulot' });

    // Haqiqiy tasdiqlashdan keyin:
    // u.coins = (u.coins || 0) + amount;
    // if (U.usePg) await U.saveUser(u);
    // ack({ me: await U.mine(u) });

    if (typeof ack === 'function') ack({ err: 'Xarid tasdiqlash hali ulanmagan' });
  });

  // AdMob Server-Side Verification (SSV) — keyinroq
  // AdMob rewarded ad tugagach, Google serverdan so‘rov yuboradi.
  // Hozircha faqat endpoint.
  app.get('/admob/ssv', (req, res) => {
    // TODO: AdMob SSV signature tekshirish
    // Hozircha rad etamiz
    res.status(403).json({ err: 'AdMob SSV hali sozlanmagan' });
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    leaveQueue(socket.id);
    const uid = socketUser.get(socket.id);
    socketUser.delete(socket.id);

    // Faqat hozirgi faol socket disconnect bo'lsa, timeoutni o'rnat
    if (uid && userSocket.get(uid) === socket.id) {
      userSocket.delete(uid);

      for (const room of rooms.values()) {
        const idx = playerIdx(room, uid);
        if (idx < 0 || !room.g || room.g.ph === 'end') continue;

        room._dc = room._dc || {};
        // Eski timeoutni tozalash
        if (room._dc[idx]) clearTimeout(room._dc[idx]);

        room._dc[idx] = setTimeout(() => {
          // Qayta ulangan bo'lsa, hech narsa qilma
          if (userSocket.get(uid)) return;
          if (room.g && room.g.ph !== 'end') {
            room.g.finish(1 - idx, "Aloqa uzilgan o'yinchi yutqazdi");
            after(room);
          }
        }, 12000); // 12 soniya grace
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Bomba Duel server → http://localhost:${PORT}`);
});
