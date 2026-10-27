// O‘yin qoidalari — FAQAT serverda. Bomba joylari mijozga yuborilmaydi.
const N = 25, B = 5, LIVES = 3, MOVE = 15000, PLACE = 25000, HELP = 2;
const PRICE = { 3: 5, 2: 6, 1: 9 }, SURCHARGE = 3;

const rnd = () => {
  const s = new Set();
  while (s.size < B) s.add((Math.random() * N) | 0);
  return s;
};

class Game {
  constructor(now = Date.now()) {
    this.ph = 'place';
    this.bombs = [new Set(), new Set()];
    this.placed = [false, false];
    this.open = [new Set(), new Set()];
    this.lives = [LIVES, LIVES];
    this.dead = [false, false];
    this.help = [0, 0];
    this.lampUsed = [0, 0];
    this.lampCell = null;
    this.miss = [0, 0];
    this.first = Math.random() < 0.5 ? 0 : 1;
    this.cur = this.first;
    this.zone = null;
    this.last = null;
    this.pending = false;
    this.res = null;
    this.why = '';
    this.deadline = now + PLACE;
  }

  sc(p) {
    return [...this.open[p]].filter((i) => !this.bombs[p].has(i)).length;
  }

  canAct(p) {
    return this.ph === 'play' && !this.pending && p === this.cur;
  }

  place(p, cells, now = Date.now()) {
    if (this.ph !== 'place' || this.placed[p] || !Array.isArray(cells)) return false;
    const s = new Set(cells.filter((c) => Number.isInteger(c) && c >= 0 && c < N));
    if (s.size !== B) return false;
    this.bombs[1 - p] = s;
    this.placed[p] = true;
    if (this.placed[0] && this.placed[1]) this.start(now);
    return true;
  }

  start(now) {
    this.ph = 'play';
    this.cur = this.first;
    this.deadline = now + MOVE;
  }

  openCell(p, i) {
    if (!this.canAct(p) || !Number.isInteger(i) || i < 0 || i >= N || this.open[p].has(i)) return false;
    this.open[p].add(i);
    if (this.bombs[p].has(i)) {
      this.lives[p]--;
      if (this.lives[p] <= 0) this.dead[p] = true;
    }
    this.miss[p] = 0;
    this.last = [p, i];
    this.pending = true;
    return true;
  }

  zoneCheck(p, i) {
    if (!this.canAct(p) || this.help[p] >= HELP || !Number.isInteger(i) || i < 0 || i >= N) return false;
    const r = Math.min((i / 5) | 0, 3),
      c = Math.min(i % 5, 3);
    const z = [r * 5 + c, r * 5 + c + 1, (r + 1) * 5 + c, (r + 1) * 5 + c + 1];
    this.zone = {
      b: p,
      z,
      has: z.some((j) => this.bombs[p].has(j) && !this.open[p].has(j)),
    };
    this.help[p]++;
    return true;
  }

  addTime(p) {
    if (!this.canAct(p) || this.help[p] >= HELP) return false;
    this.help[p]++;
    this.deadline += 5000;
    return true;
  }

  lampPrice(p) {
    return PRICE[Math.max(1, Math.min(3, this.lives[p]))] + SURCHARGE * this.lampUsed[p];
  }

  lamp(p) {
    if (!this.canAct(p) || this.lampCell) return null;
    const free = [];
    for (let i = 0; i < N; i++) {
      if (!this.open[p].has(i) && !this.bombs[p].has(i)) free.push(i);
    }
    if (!free.length) return null;
    const i = free[(Math.random() * free.length) | 0];
    this.lampCell = { b: p, i };
    this.lampUsed[p]++;
    return i;
  }

  tick(now = Date.now()) {
    if (this.ph === 'place' && now > this.deadline) {
      for (let p = 0; p < 2; p++) {
        if (!this.placed[p]) {
          this.bombs[1 - p] = rnd();
          this.placed[p] = true;
        }
      }
      this.start(now);
      return true;
    }
    if (this.ph === 'play' && !this.pending && now > this.deadline) {
      const p = this.cur;
      this.miss[p]++;
      if (this.miss[p] >= 2) this.finish(1 - p, "Ketma-ket 2 marta vaqtni o'tkazgan yutqazdi");
      else this.pending = true;
      return true;
    }
    return false;
  }

  advance(now = Date.now()) {
    if (!this.pending || this.ph !== 'play') return false;
    this.pending = false;
    const p = this.cur,
      o = 1 - p;
    if (this.sc(p) >= N - B) {
      this.finish(p, "Barcha xavfsiz kataklarni ochdi");
      return true;
    }
    if (this.dead[p] && p === this.first && this.lives[o] > 1) {
      this.finish(o, '3 bombaga duch kelgan yutqazdi');
      return true;
    }
    if (p === 1 - this.first && (this.dead[0] || this.dead[1])) {
      const d = this.dead;
      if (d[0] && d[1]) {
        const a = this.sc(0),
          b = this.sc(1);
        if (a !== b) this.finish(a > b ? 0 : 1, "Ikkalasi ham 3 bombaga duch keldi, ko'p xavfsiz katak ochgan yutdi");
        else this.finish(-1, 'Ikkalasi bir vaqtda 3 bombaga duch keldi');
      } else this.finish(d[0] ? 1 : 0, '3 bombaga duch kelgan yutqazdi');
      return true;
    }
    this.cur = 1 - p;
    this.zone = null;
    this.lampCell = null;
    this.deadline = now + MOVE;
    return true;
  }

  finish(w, why) {
    this.ph = 'end';
    this.res = w;
    this.why = why;
  }

  // p = mijoz indeksi (0 yoki 1). Bombalar faqat o'yin tugaganda yuboriladi.
  view(p, now = Date.now()) {
    const o = (b) => [...this.open[b]].map((i) => [i, this.bombs[b].has(i) ? 1 : 0]);
    return {
      ph: this.ph,
      me: p,
      cur: this.cur,
      lives: this.lives,
      open: [o(0), o(1)],
      help: HELP - this.help[p],
      ms: Math.max(0, this.deadline - now),
      zone: this.zone,
      last: this.last,
      pending: this.pending,
      placed: this.placed[p],
      lamp: this.lampCell && this.lampCell.b === p ? this.lampCell.i : null,
      lampPrice: this.lampPrice(p),
      res: this.res,
      why: this.why,
      bombs: this.ph === 'end' ? this.bombs.map((s) => [...s]) : null,
    };
  }
}

module.exports = { Game, rnd, B, N, LIVES, MOVE, PLACE, HELP };
