// Courses. Centerline control points [x, y, z] form a closed centripetal CatmullRom loop, first point = start line.
// Checked by tools/check-tracks: no self-overlap (walls included), min corner radius, max grade.
// grip: surface multiplier applied to every car's grip. theme drives sky, light, terrain and scenery in game.js.

export const TRACKS = [
  {
    id: 'circuit', name: 'ネオン・サーキット', desc: '緑の丘をめぐる王道のグランプリコース。まずはここから。',
    theme: 'forest', time: 'day', difficulty: 1, width: 16, laps: 3, grip: 1,
    points: [
      [0, 0, 0], [0, 0, 120], [20, 2, 200], [80, 6, 240], [160, 8, 230], [210, 6, 180],
      [200, 3, 110], [150, 0, 70], [140, 0, 10], [190, 2, -50], [180, 5, -130],
      [110, 7, -170], [40, 4, -150], [0, 1, -80],
    ],
  },
  {
    id: 'city', name: 'ミッドナイト・シティ', desc: 'ネオン輝く夜の市街地。直角コーナーと高架の連続。',
    theme: 'city', time: 'night', difficulty: 2, width: 14, laps: 3, grip: 1,
    points: [
      [0, 0, 0], [0, 0, 140], [8, 0, 168], [34, 0, 176], [140, 0, 176], [166, 0, 184], [174, 0, 210],
      [174, 2, 280], [166, 4, 306], [140, 6, 314], [40, 9, 314], [-60, 6, 314], [-86, 4, 306], [-94, 2, 280],
      [-94, 0, 235], [-82, 0, 185], [-94, 0, 135], [-94, 0, -40], [-86, 0, -66], [-60, 0, -74],
      [-26, 0, -74], [-8, 0, -66], [0, 0, -40],
    ],
  },
  {
    id: 'canyon', name: 'サンセット・キャニオン', desc: '夕焼けの砂漠。長いストレートと大きなアップダウン。',
    theme: 'desert', time: 'sunset', difficulty: 2, width: 18, laps: 2, grip: 0.96,
    points: [
      [0, 0, 0], [0, 4, 180], [30, 12, 300], [110, 22, 350], [220, 30, 330], [300, 26, 260],
      [320, 16, 160], [280, 8, 80], [300, 14, 0], [350, 24, -80], [320, 30, -180],
      [220, 24, -230], [120, 14, -200], [60, 6, -120],
    ],
  },
  {
    id: 'snow', name: 'フロスト・ピーク', desc: '雪山のヘアピン峠。路面は滑りやすく、登って下る。',
    theme: 'snow', time: 'day', difficulty: 3, width: 14, laps: 2, grip: 0.88,
    points: [
      [0, 0, 0], [0, 8, 110], [10, 10, 140], [40, 10, 153], [70, 10, 140], [80, 11, 110],
      [80, 18, 40], [90, 20, 10], [120, 20, -3], [150, 20, 10], [160, 21, 40],
      [160, 34, 200], [140, 37, 250], [90, 38, 270], [30, 37, 262], [-30, 34, 240], [-80, 30, 200],
      [-100, 20, 120], [-90, 12, 40], [-80, 6, -20], [-50, 3, -50], [-15, 1, -40],
    ],
  },
  {
    id: 'coast', name: 'コーラル・コースト', desc: '南国の海沿いを流れるハイスピードコース。',
    theme: 'beach', time: 'day', difficulty: 1, width: 16, laps: 3, grip: 1,
    points: [
      [0, 0, 0], [20, 2, 140], [70, 5, 230], [160, 8, 270], [260, 6, 250], [330, 3, 190],
      [350, 2, 90], [330, 1, -20], [360, 2, -110], [330, 3, -190], [250, 4, -230],
      [160, 2, -200], [100, 0, -120], [40, 0, -110], [0, 0, -60],
    ],
  },
];
export const TRACK_BY_ID = Object.fromEntries(TRACKS.map(t => [t.id, t]));
export const DEFAULT_TRACK = 'circuit';
