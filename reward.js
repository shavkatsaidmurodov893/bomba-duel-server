// Tanga va XP hisobi — faqat serverda
const TIERS = [
  ['Bronza', 0],
  ['Kumush', 600],
  ['Oltin', 1800],
  ['Diamond', 4000],
];

const tierIdx = (x) => TIERS.filter((t) => x >= t[1]).length - 1;
const league = (x) => TIERS[tierIdx(x)][0];

function xpParts(score, c) {
  const P = [];
  if (score === 1) {
    P.push(['win', 40]);
    if (c.lives === 3) P.push(['flawless', 30]);
    else if (c.lives === 2) P.push(['clean', 15]);
    if (c.oppMoves <= 3) P.push(['blitz', 30]);
    else if (c.oppMoves <= 5) P.push(['fast', 15]);
    else if (c.oppMoves <= 7) P.push(['quick', 8]);
    if (c.oppTier > c.myTier) P.push(['upset', 10]);
    if (c.streak >= 2) P.push(['streak', Math.min(15, 5 * (c.streak - 1))]);
  } else if (score === 0.5) P.push(['draw', 20]);
  else {
    P.push(['loss', 10]);
    if (c.myMoves >= 12) P.push(['fought', 10]);
    else if (c.myMoves >= 8) P.push(['held', 5]);
  }
  return P;
}

function reward(u, oid, score, rated, today, c, mul) {
  if (u.pday !== today) {
    u.pday = today;
    u.pairs = {};
    u.dn = 0;
  }
  const n = u.pairs[oid] || 0;
  u.pairs[oid] = n + 1;
  u.dn++;
  const lim = oid === 'bot' ? 5 : 3;
  if (n >= lim) return { none: (oid === 'bot' ? 'bot bilan' : "bir raqib bilan") + ' kuniga ' + lim + " o'yindan keyin mukofot berilmaydi" };
  if (u.dn > 20) return { none: "kunlik 20 o'yin chegarasi tugadi" };

  const base = score === 1 ? 20 + 10 * Math.max(0, Math.min(2, (c.lives || 1) - 1)) : score === 0.5 ? 12 : 8;
  let bonus = 0,
    first = false;
  if (score === 1) {
    if (u.wday !== today) {
      bonus += 40;
      u.wday = today;
      first = true;
    }
    u.streak = (u.streak || 0) + 1;
    if (u.streak % 3 === 0) bonus += 20;
    u.best = Math.max(u.best || 0, u.streak);
  } else if (score === 0) u.streak = 0;

  let coins = base + bonus;
  if (!rated) coins = Math.round(coins / 2);

  const parts = xpParts(score, { ...c, streak: u.streak })
    .map((p) => [p[0], Math.round(p[1] * mul)])
    .filter((p) => p[1] > 0);
  const xp = parts.reduce((s, p) => s + p[1], 0);
  const before = tierIdx(u.rating || 0);
  u.rating = (u.rating || 0) + xp;
  const up = tierIdx(u.rating) > before ? league(u.rating) : null;
  u.coins += coins;
  u.games++;
  if (score === 1) u.w++;
  else if (score === 0.5) u.d++;
  else u.l++;

  return { coins, xp, parts, total: u.rating, rated, up, first };
}

module.exports = { reward, league, tierIdx, TIERS };
