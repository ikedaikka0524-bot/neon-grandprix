// Game data. Tweak balance here only.
// Units: meters, seconds, m/s. Car forward = +Z in local space, heading 0 = facing +Z.

export const RARITY = {
  N:  { name: 'N',  color: '#9aa4b2', rate: 0.60, costMul: 1.0, dupeCoins: 100 },
  R:  { name: 'R',  color: '#3b9cff', rate: 0.28, costMul: 1.3, dupeCoins: 250 },
  SR: { name: 'SR', color: '#c04dff', rate: 0.10, costMul: 1.7, dupeCoins: 600 },
  UR: { name: 'UR', color: '#ffb300', rate: 0.02, costMul: 2.2, dupeCoins: 1500 },
};
export const RARITY_ORDER = ['N', 'R', 'SR', 'UR'];

// Active abilities (Space / Shift). gauge fills in `fill` seconds (before gaugeRate).
// duration & power are multiplied by stats.abilityDuration / stats.abilityPower.
export const ABILITIES = {
  boost:    { name: 'ミニターボ',   desc: '少しの間スピードアップ',                 fill: 18, duration: 1.5, power: 0.25 },
  nitro:    { name: 'ニトロ',       desc: '短時間の大加速',                           fill: 20, duration: 2.5, power: 0.55 },
  oil:      { name: 'オイル',       desc: '後ろにオイルを撒く。踏んだ車はスピン',     fill: 16, duration: 15,  power: 1.2 },  // duration = slick lifetime, power = spin seconds
  shield:   { name: 'シールド',     desc: '衝突・罠・スローを無効化',                 fill: 18, duration: 5,   power: 1 },
  warp:     { name: 'ワープ',       desc: 'コースの前方へテレポート',                 fill: 24, duration: 0,   power: 60 },   // power = meters along track
  timeslow: { name: 'タイムスロー', desc: '自分以外の全員を数秒スローに',             fill: 26, duration: 3,   power: 0.4 },  // power = speed reduction (0.4 -> x0.6)
  phase:    { name: 'ファントム',   desc: 'すり抜け＆コース外でも減速しない',         fill: 22, duration: 5,   power: 0.10 }, // power = extra speed
};

// Passive traits (R cars).
export const PASSIVES = {
  draft:   { name: 'ドラフト名人',   desc: 'スリップストリームの効果2倍' },
  offroad: { name: 'オフロード',     desc: 'コース外の減速が半分' },
  launch:  { name: 'ロケットスタート', desc: 'スタート直後3秒間 加速+30%' },
  drift:   { name: 'ドリフト職人',   desc: 'ドリフト中ゲージが溜まる' },
};

// base: top (m/s), accel (m/s^2), grip (0..1, lateral), steer (rad/s at low speed), mass (collision weight)
// body: procedural mesh style when models/<id>.glb is missing. modelRot: yaw fix (rad) for GLB.
export const CARS = [
  { id: 'n_kei',    name: 'ポケット軽',        rarity: 'N',  body: 'kei',     color: '#f4d35e', ability: 'boost', passive: null,     base: { top: 50, accel: 15, grip: 0.80, steer: 2.3, mass: 0.8 } },
  { id: 'n_sedan',  name: 'シティセダン',      rarity: 'N',  body: 'sedan',   color: '#d9d9d9', ability: 'boost', passive: null,     base: { top: 54, accel: 14, grip: 0.78, steer: 2.0, mass: 1.0 } },
  { id: 'n_hatch',  name: 'ホットハッチ',      rarity: 'N',  body: 'hatch',   color: '#e63946', ability: 'boost', passive: null,     base: { top: 53, accel: 16, grip: 0.82, steer: 2.2, mass: 0.9 } },
  { id: 'n_van',    name: 'デリバリーバン',    rarity: 'N',  body: 'van',     color: '#ffffff', ability: 'boost', passive: null,     base: { top: 49, accel: 13, grip: 0.74, steer: 1.8, mass: 1.4 } },
  { id: 'r_sports', name: 'ブレイズGT',        rarity: 'R',  body: 'sports',  color: '#ff6b1a', ability: 'boost', passive: 'draft',  base: { top: 60, accel: 17, grip: 0.84, steer: 2.1, mass: 1.0 } },
  { id: 'r_suv',    name: 'テラSUV',           rarity: 'R',  body: 'suv',     color: '#2a9d8f', ability: 'boost', passive: 'offroad',base: { top: 56, accel: 17, grip: 0.80, steer: 1.9, mass: 1.5 } },
  { id: 'r_muscle', name: 'サンダーマッスル',  rarity: 'R',  body: 'muscle',  color: '#1d3557', ability: 'boost', passive: 'launch', base: { top: 62, accel: 18, grip: 0.76, steer: 1.9, mass: 1.3 } },
  { id: 'r_rally',  name: 'ダストラリー',      rarity: 'R',  body: 'rally',   color: '#3a86ff', ability: 'boost', passive: 'drift',  base: { top: 57, accel: 17, grip: 0.86, steer: 2.3, mass: 1.0 } },
  { id: 'sr_nitro', name: 'ニトロ・ファルコン', rarity: 'SR', body: 'formula', color: '#e5383b', ability: 'nitro', passive: null,     base: { top: 66, accel: 19, grip: 0.88, steer: 2.2, mass: 0.9 } },
  { id: 'sr_oil',   name: 'スリック・ヴァイパー', rarity: 'SR', body: 'wedge', color: '#38b000', ability: 'oil',   passive: null,     base: { top: 64, accel: 19, grip: 0.86, steer: 2.2, mass: 1.0 } },
  { id: 'sr_shield',name: 'アイアン・ブルワーク', rarity: 'SR', body: 'tank',  color: '#6c757d', ability: 'shield',passive: null,     base: { top: 62, accel: 18, grip: 0.84, steer: 2.0, mass: 1.8 } },
  { id: 'ur_warp',  name: 'ディメンション・シャーク', rarity: 'UR', body: 'shark', color: '#4cc9f0', ability: 'warp', passive: null, base: { top: 70, accel: 21, grip: 0.90, steer: 2.3, mass: 1.1 } },
  { id: 'ur_time',  name: 'クロノ・ドラゴン',  rarity: 'UR', body: 'dragon',  color: '#7b2cbf', ability: 'timeslow', passive: null, base: { top: 69, accel: 21, grip: 0.90, steer: 2.3, mass: 1.2 } },
  { id: 'ur_phase', name: 'スシ・ファントム',  rarity: 'UR', body: 'sushi',   color: '#ff8fa3', ability: 'phase', passive: null,    base: { top: 71, accel: 20, grip: 0.89, steer: 2.4, mass: 1.0 } },
];
for (const c of CARS) c.modelRot ??= Math.PI / 2;   // models/*.glb are authored nose toward -X
export const CAR_BY_ID = Object.fromEntries(CARS.map(c => [c.id, c]));
export const STARTER_CAR = 'n_hatch';

// Skill tree: 3 branches x 4 tiers. Node requires previous tier in same branch.
// Tier 4 requires limit break (dupes >= 1). cost = TIER_COST[tier-1] * RARITY.costMul.
export const TIER_COST = [100, 250, 500, 1000];
export const SKILL_TREE = [
  { branch: 'speed', name: 'スピード', color: '#ff5d5d', nodes: [
    { id: 's1', name: '最高速+4%',          mod: { top: 0.04 } },
    { id: 's2', name: '加速+8%',            mod: { accel: 0.08 } },
    { id: 's3', name: 'スリップストリーム', mod: { slipstream: true }, desc: '他の車の真後ろで加速' },
    { id: 's4', name: '最高速+8%',          mod: { top: 0.08 } },
  ]},
  { branch: 'handling', name: 'ハンドリング', color: '#4dd4ff', nodes: [
    { id: 'h1', name: 'グリップ+6%',        mod: { grip: 0.06 } },
    { id: 'h2', name: 'ドリフト',           mod: { steer: 0.10 }, desc: 'ハンドル+10%、曲がりやすく' },
    { id: 'h3', name: 'ドリフトチャージ',   mod: { driftCharge: true }, desc: 'ドリフト中に能力ゲージが溜まる' },
    { id: 'h4', name: 'グリップ+10%',       mod: { grip: 0.10 } },
  ]},
  { branch: 'ability', name: '能力', color: '#ffd23f', nodes: [
    { id: 'a1', name: 'ゲージ速度+15%',     mod: { gaugeRate: 0.15 } },
    { id: 'a2', name: '効果時間+20%',       mod: { abilityDuration: 0.20 } },
    { id: 'a3', name: '能力強化+25%',       mod: { abilityPower: 0.25 } },
    { id: 'a4', name: 'ゲージ速度+25%',     mod: { gaugeRate: 0.25 } },
  ]},
];
export const NODE_BY_ID = Object.fromEntries(SKILL_TREE.flatMap(b => b.nodes.map((n, i) => [n.id, { ...n, branch: b.branch, tier: i + 1 }])));

export function nodeCost(carId, nodeId) {
  return Math.round(TIER_COST[NODE_BY_ID[nodeId].tier - 1] * RARITY[CAR_BY_ID[carId].rarity].costMul);
}

// Can this node be unlocked given owned-car record { dupes, nodes: [] }? Returns null if ok, else reason string.
export function nodeBlockReason(carRec, nodeId) {
  const n = NODE_BY_ID[nodeId];
  if (carRec.nodes.includes(nodeId)) return '解放済み';
  if (n.tier === 4 && carRec.dupes < 1) return '限界突破が必要（同じ車をガチャで引く）';
  if (n.tier > 1 && !carRec.nodes.includes(n.branch[0] + (n.tier - 1))) return '前のスキルが必要';
  return null;
}

// Final stats used by the game. unlocked = array of node ids.
export function computeStats(carId, unlocked = []) {
  const car = CAR_BY_ID[carId];
  const s = { ...car.base, gaugeRate: 1, abilityDuration: 1, abilityPower: 1, slipstream: false, driftCharge: false };
  const mul = { top: 1, accel: 1, grip: 1, steer: 1 };
  for (const id of unlocked) {
    for (const [k, v] of Object.entries(NODE_BY_ID[id].mod)) {
      if (typeof v === 'boolean') s[k] = v;
      else if (k in mul) mul[k] += v;
      else s[k] += v;
    }
  }
  for (const k in mul) s[k] *= mul[k];
  s.grip = Math.min(s.grip, 0.99);
  if (car.passive === 'drift') s.driftCharge = true;
  s.ability = car.ability;
  s.passive = car.passive;
  return s;
}

export const GACHA = {
  singleTickets: 1, singleCoins: 300,
  tenTickets: 10, tenCoins: 2700,
  tenGuarantee: 'SR', // 10-pull guarantees at least one SR or better
};

export const ECONOMY = {
  startCoins: 500, startTickets: 3,
  placeCoins: [300, 200, 120, 80],   // by finishing place (1st..4th), splitscreen/online too
  bestLapBonus: 50,                  // new personal best lap on this car
  beatGhostBonus: 150,
  winTickets: 1,                     // 1st place
  firstClearTickets: 3,              // first race ever finished
};

