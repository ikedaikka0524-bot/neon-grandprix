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
  thunderbolt: { name: 'サンダーボルト', desc: '1位の車（自分が1位なら2位）に雷を落としてスピン！自分は加速', fill: 26, duration: 1.5, power: 1.4 }, // duration = own boost s, power = target spin s
  magnet:   { name: 'マグネット',   desc: '前の車に吸い寄せられて急加速！一気に追いつく', fill: 18, duration: 3, power: 0.45 }, // power = own speed/accel bonus until ~8 m behind the car ahead
  domain:   { name: '結界展開',     desc: '自分を中心に巨大な結界を展開。中の相手は大きく減速し能力を封印される。自分は加速', fill: 28, duration: 6, power: 0.45 }, // power = speed reduction inside (max 0.6)
  downforce: { name: 'ダウンフォース', desc: '7秒間 路面に吸いつき全開で加速。コーナーで減速せず、抜けるたびにさらに加速。スピン・体当たり・減速を受けない。後ろの車は乱気流でグリップを失う', fill: 17, duration: 7, power: 1 },   // power = x steering at speed (game.js DF_STEER), speed / accel and the corner-exit slingshot (abilities.js DF)
  robotdash: { name: 'ロボット・ダッシュ', desc: 'ロボットに変形！5秒間ぶつかった車を弾き飛ばし、状態異常を受けない。車に戻る瞬間に大加速', fill: 22, duration: 5, power: 0.5 }, // duration = robot time, power = speed/accel bonus for 1.5 s after
  hellchain: { name: 'ヘルチェーン', desc: '150m先まで届く炎の鎖で前の車を捕まえ、5秒間引き寄せる。外れる瞬間に相手を振り回してスピンさせ、一気に追い抜く', fill: 18, duration: 5, power: 0.5 }, // duration = chain s, power = target slow (max 0.6) / tow up to target speed +25% x power
  facewall: { name: 'フェイス・ウォール', desc: '左右に顔がどんどん増えて横一列に並び、回転しながら道をふさぐ。後ろの車は前に出られない', fill: 24, duration: 5, power: 1 }, // duration = wall time; power unused
  tokyodive: { name: 'トーキョー・ダイブ', desc: 'ネオンのゲートから夜の東京の異空間へ6秒間ダイブ。戻ると大きく前方へ飛び出し、異空間で走った距離の分だけさらに前へ。着地後2秒間はネオン・ブーストで加速し、最初の1.5秒は無敵', fill: 20, duration: 6, power: 1 }, // power = multiplier on the jump's pocket part (and on the landing boost, up to 1) (abilities.js DIVE)
  reflect: { name: 'リフレクト', desc: 'ボディの鏡が光り、4秒間 自分を狙った攻撃をぜんぶ撃った相手にはね返す（ぶつかられても減速しない）', fill: 22, duration: 4, power: 1 }, // power = strength of what bounces back (x the attack's own; abilities.js REFLECT)
  family: { name: 'ファミリー', desc: '「ファミリー」の車が2台かけつけて一緒に走る。前の仲間の後ろで強力なスリップストリーム、後ろの仲間は追ってくる車をブロック', fill: 22, duration: 7, power: 1 }, // duration = formation s, power = drafting strength (abilities.js FAM)
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
  { id: 'sr_magnet', name: 'マグネ・ビートル', rarity: 'SR', body: 'wedge', color: '#1fa7a0', ability: 'magnet', passive: null, base: { top: 65, accel: 20, grip: 0.87, steer: 2.2, mass: 1.1 } },
  { id: 'sr_shield',name: 'アイアン・ブルワーク', rarity: 'SR', body: 'tank',  color: '#6c757d', ability: 'shield',passive: null,     base: { top: 62, accel: 18, grip: 0.84, steer: 2.0, mass: 1.8 } },
  // len / w: a box truck 6 m long, 2.3 m wide (carmodel.js fit + trimWidth, game.js collision circles + chase camera); the rest are 4.2 m
  { id: 'sr_mirror', name: 'リフレクト号', rarity: 'SR', body: 'truck', color: '#ffffff', ability: 'reflect', passive: null, len: 6, w: 2.3, base: { top: 64, accel: 17, grip: 0.84, steer: 2.0, mass: 2.0 } },
  { id: 'ur_warp',  name: 'ディメンション・シャーク', rarity: 'UR', body: 'shark', color: '#4cc9f0', ability: 'warp', passive: null, base: { top: 70, accel: 21, grip: 0.90, steer: 2.3, mass: 1.1 } },
  { id: 'ur_time',  name: 'クロノ・ドラゴン',  rarity: 'UR', body: 'dragon',  color: '#7b2cbf', ability: 'timeslow', passive: null, base: { top: 69, accel: 21, grip: 0.90, steer: 2.3, mass: 1.2 } },
  { id: 'ur_phase', name: 'スシ・ファントム',  rarity: 'UR', body: 'sushi',   color: '#ff8fa3', ability: 'phase', passive: null,    base: { top: 71, accel: 20, grip: 0.89, steer: 2.4, mass: 1.0 } },
  { id: 'ur_thunder', name: 'サンダー・ドラゴンX', rarity: 'UR', body: 'dragon', color: '#ffd23f', ability: 'thunderbolt', passive: null, base: { top: 74, accel: 22, grip: 0.90, steer: 2.4, mass: 1.3 } },
  { id: 'ur_domain', name: 'アビス・サンクチュアリ', rarity: 'UR', body: 'tank', color: '#3b1466', ability: 'domain', passive: null, base: { top: 71, accel: 21, grip: 0.90, steer: 2.3, mass: 1.3 } },
  { id: 'ur_graphite', name: 'グラファイト・GT', rarity: 'UR', body: 'sports', color: '#3a3d42', ability: 'downforce', passive: null, base: { top: 72, accel: 21, grip: 0.90, steer: 2.3, mass: 1.1 } },
  { id: 'ur_changer', name: 'レトロ・チェンジャー', rarity: 'UR', body: 'kei', color: '#efe6cf', ability: 'robotdash', passive: null, base: { top: 67, accel: 20, grip: 0.88, steer: 2.3, mass: 1.6 } },
  { id: 'ur_inferno', name: 'インフェルノ・キャット', rarity: 'UR', body: 'muscle', color: '#d9151b', ability: 'hellchain', passive: null, base: { top: 73, accel: 23, grip: 0.84, steer: 2.0, mass: 1.6 } },
  { id: 'ur_megaface', name: 'メガフェイス', rarity: 'UR', body: 'kei', color: '#b9744f', ability: 'facewall', passive: null, base: { top: 68, accel: 20, grip: 0.86, steer: 2.1, mass: 1.5 } },
  { id: 'ur_fortune', name: 'フォーチュン・ドリフター', rarity: 'UR', body: 'sports', color: '#ff8a00', ability: 'tokyodive', passive: 'drift', base: { top: 73, accel: 22, grip: 0.90, steer: 2.5, mass: 1.1 } },
  { id: 'ur_streak', name: 'ブルー・ストリークR', rarity: 'UR', body: 'sports', color: '#a9aeb5', ability: 'family', passive: null, base: { top: 73, accel: 22, grip: 0.90, steer: 2.3, mass: 1.2 } },
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
    if (!Object.hasOwn(NODE_BY_ID, id)) continue;   // a newer build's node (kept in the save) or a crafted transfer code
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

// Solo CPU difficulty (startRace opts.cpuLevel, save.lastCpuLevel). All CPU tuning lives here. 'normal' = the original
// CPUs: any car, random skill nodes, pace 0.95-1.0, the old line / braking, rubber band, abilities 0-4 s after the gauge fills.
//  coinMul: place prize x (on top of the course multiplier); above 1 only for the share of CPUs beaten (ui.js applyRewards:
//    last place pays like 'normal'), so the picker shows it as the most; desc: one line for the picker
//  cars: rarity weights for a CPU's car (null = any car, uniform); nodes: [min, max] skill nodes (12 = the whole tree incl.
//    the limit-break tier); edge: extra top speed & accel (legend +8%); pace: [min, max] top-speed factor
//  corner: share of the car's real cornering limit (steering at speed x grip x course grip, game.js aiInput) it takes
//    corners at (1 = the limit; above ~1 it runs wide); brake: m/s^2 it plans its braking with (full brakes give 34);
//    line: 0 = centre .. 1 = the racing line (game.js racingLine); wander: lane weaving (1 = old);
//    draft: tucks in behind cars on straights for the slipstream; drift: drifts through hairpins (game.js PIN)
//  err: small driving mistakes per minute; recover: s stopped / facing backwards before it resets onto the road
//  ahead / behind: rubber band vs the leading human: top speed x [0] eased in over gap [1]..[2] m (behindSec: s)
//  tactics: 'late' = random 4-12 s after the gauge fills, 'smart' = per-ability situations (abilities.js cpuAbility),
//    hold = s full before it takes any straight; none = random 0-4 s
// Measured (own cars, 3 CPUs, no abilities, median lap vs 'normal' on circuit / city / snow / monaco / suzuka): easy +20-30%,
// hard -6 to -16%, oni -12 to -22%, legend -19 to -29%; each level >= 6% faster than the one below (>= 3.5% with abilities:
// the CPUs' attacks on each other add noise).
export const DIFFICULTY = [
  { id: 'easy', name: 'やさしい', coinMul: 0.8, desc: 'N・Rの車でのんびり。ときどきミスも', cars: { N: 1, R: 1 }, nodes: [0, 0], pace: [0.9, 0.95],
    corner: 0.78, brake: 14, line: 0.3, wander: 1, err: 3, recover: 2.5,
    ahead: [0.93, 40, 220], behind: [1.06, 60, 300], tactics: 'late' },
  { id: 'normal', name: 'ふつう', coinMul: 1, desc: 'いろんな車のいつものCPU', cars: null, pace: [0.95, 1],
    ahead: [0.93, 40, 220], behind: [1.06, 60, 300] },
  { id: 'hard', name: 'つよい', coinMul: 1.3, desc: '強化したSR中心の車。いいラインで走り、能力を狙って使う', cars: { R: 0.25, SR: 0.5, UR: 0.25 }, nodes: [6, 9], pace: [0.98, 1],
    corner: 0.92, brake: 27, line: 1, wander: 0.5, recover: 1.5,
    ahead: [0.96, 60, 260], behind: [1.04, 60, 300], tactics: 'smart', hold: 20 },
  { id: 'oni', name: '鬼', coinMul: 1.7, desc: 'フル強化のSR・UR。限界走行、ドリフト、スリップストリーム', cars: { SR: 0.4, UR: 0.6 }, nodes: [12, 12], pace: [1, 1],
    corner: 0.93, brake: 27, line: 1, wander: 0.15, draft: true, drift: true, recover: 0.8,
    ahead: [1, 60, 260], behind: [1.08, 60, 250], tactics: 'smart', hold: 15 },
  { id: 'legend', name: '伝説', coinMul: 2.5, desc: '限界突破URが性能+8%。離されても執念で追ってくる', cars: { UR: 1 }, nodes: [12, 12], edge: 0.08, pace: [1, 1],
    corner: 0.96, brake: 30, line: 1, wander: 0.1, draft: true, drift: true, recover: 0.8,
    ahead: [1, 60, 260], behind: [1.12, 3, 8], behindSec: true, tactics: 'smart', hold: 25 },
];
export const DIFFICULTY_BY_ID = Object.fromEntries(DIFFICULTY.map(d => [d.id, d]));

export const ECONOMY = {
  startCoins: 500, startTickets: 3,
  placeCoins: [300, 200, 120, 80],   // by finishing place (1st..4th), splitscreen/online too
  bestLapBonus: 50,                  // new personal best lap on this car
  beatGhostBonus: 150,
  winTickets: 1,                     // 1st place
  firstClearTickets: 3,              // first race ever finished
};

