/* eslint-disable @typescript-eslint/restrict-template-expressions -- SVG coordinates are numbers */
// The corpus images (D-028), drawn in code so they are licence-clean and reproducible. Each scene
// is built to match the reference alt of its <img> in fixtures/corpus/clean.
const W = 640;
const H = 480;

const svg = (body: string, bg = '#f4efe6') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${String(W)}" height="${String(H)}" viewBox="0 0 ${String(W)} ${String(H)}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`;

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const speckles = (x: number, y: number, w: number, h: number, n = 40) =>
  Array.from(
    { length: n },
    () =>
      `<circle cx="${(x + rnd() * w).toFixed(1)}" cy="${(y + rnd() * h).toFixed(1)}" r="${(1 + rnd() * 1.6).toFixed(1)}" fill="#6b4f3a" opacity="0.7"/>`,
  ).join('');

function mug(x: number, y: number, s = 1, body = '#efe6d2', rim = '#7a4a2a', speck = true) {
  const w = 110 * s,
    h = 130 * s;
  return `<g><path d="M${x + w},${y + 30 * s} q${45 * s},${5 * s} ${40 * s},${45 * s} q${-5 * s},${35 * s} ${-40 * s},${35 * s}" fill="none" stroke="${body}" stroke-width="${14 * s}"/>
<path d="M${x + w},${y + 30 * s} q${45 * s},${5 * s} ${40 * s},${45 * s} q${-5 * s},${35 * s} ${-40 * s},${35 * s}" fill="none" stroke="#00000022" stroke-width="${2 * s}"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${12 * s}" fill="${body}" stroke="#00000033"/>
<rect x="${x}" y="${y}" width="${w}" height="${10 * s}" rx="${4 * s}" fill="${rim}"/>${speck ? speckles(x + 6, y + 14 * s, w - 12, h - 20 * s, Math.round(45 * s)) : ''}</g>`;
}
const bowl = (cx: number, cy: number, r: number, fill: string, rim?: string) =>
  `<path d="M${cx - r},${cy} a${r},${r * 0.75} 0 0 0 ${2 * r},0 z" fill="${fill}" stroke="#00000033"/>
<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.18}" fill="${rim ?? fill}" stroke="#00000033"/><ellipse cx="${cx}" cy="${cy + 2}" rx="${r * 0.88}" ry="${r * 0.13}" fill="#00000022"/>`;
function person(
  x: number,
  y: number,
  shirt: string,
  opts: { hair?: string; armsTo?: [number, number] } = {},
) {
  const [ax, ay] = opts.armsTo ?? [x, y + 120];
  return `<g><path d="M${x - 45},${y + 200} q0,-130 45,-130 q45,0 45,130 z" fill="${shirt}"/>
<circle cx="${x}" cy="${y + 40}" r="34" fill="#d9a77f"/><path d="M${x - 35},${y + 38} q5,-45 35,-42 q32,-2 35,42 q-12,-22 -35,-22 q-22,0 -35,22z" fill="${opts.hair ?? '#3b2a20'}"/>
<path d="M${x - 38},${y + 100} Q${(x + ax) / 2 - 30},${y + 150} ${ax - 18},${ay}" stroke="${shirt}" stroke-width="22" fill="none" stroke-linecap="round"/>
<path d="M${x + 38},${y + 100} Q${(x + ax) / 2 + 30},${y + 150} ${ax + 18},${ay}" stroke="${shirt}" stroke-width="22" fill="none" stroke-linecap="round"/>
<circle cx="${ax - 18}" cy="${ay}" r="12" fill="#d9a77f"/><circle cx="${ax + 18}" cy="${ay}" r="12" fill="#d9a77f"/></g>`;
}
const wheel = (cx: number, cy: number) =>
  `<rect x="${cx - 70}" y="${cy + 10}" width="140" height="70" rx="10" fill="#8c8f94"/><ellipse cx="${cx}" cy="${cy + 10}" rx="85" ry="16" fill="#5f6368"/><ellipse cx="${cx}" cy="${cy + 6}" rx="62" ry="10" fill="#9aa0a6"/>`;
const table = (y: number) =>
  `<rect x="0" y="${y}" width="${W}" height="${H - y}" fill="#a87b52"/><rect x="0" y="${y}" width="${W}" height="8" fill="#8a6240"/>`;

/** `hard`: drawn for the hard-case pages (fixtures/corpus/hard), listed in hard-manifest.json. */
export type Scene = { src: string; file: string; svg: string; subject: string[]; hard?: true };

const text = (x: number, y: number, size: number, body: string, fill = '#2f2a24', weight = 400) =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${body}</text>`;

let qrSeed = 11;
const qrBit = () => ((qrSeed = (qrSeed * 48271) % 2147483647) & 4) === 0;
const finder = (x: number, y: number, m: number) =>
  `<rect x="${x}" y="${y}" width="${7 * m}" height="${7 * m}" fill="#000"/><rect x="${x + m}" y="${y + m}" width="${5 * m}" height="${5 * m}" fill="#fff"/><rect x="${x + 2 * m}" y="${y + 2 * m}" width="${3 * m}" height="${3 * m}" fill="#000"/>`;
function qr() {
  const n = 25,
    m = 14,
    x0 = (W - n * m) / 2,
    y0 = (H - n * m) / 2;
  const inFinder = (i: number, j: number) =>
    (i < 8 && j < 8) || (i < 8 && j >= n - 8) || (i >= n - 8 && j < 8);
  let cells = '';
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (!inFinder(i, j) && qrBit())
        cells += `<rect x="${x0 + j * m}" y="${y0 + i * m}" width="${m}" height="${m}" fill="#000"/>`;
  return svg(
    `<rect x="${x0 - 28}" y="${y0 - 28}" width="${n * m + 56}" height="${n * m + 56}" fill="#fff"/>` +
      cells +
      finder(x0, y0, m) +
      finder(x0 + (n - 7) * m, y0, m) +
      finder(x0, y0 + (n - 7) * m, m),
    '#ffffff',
  );
}

export const SCENES: Scene[] = [
  {
    src: '/img/ana.jpg',
    file: 'ana.jpg',
    subject: ['bowl'],
    svg: svg(
      person(320, 90, '#4a6fa5', { armsTo: [320, 300] }) +
        bowl(320, 300, 120, '#e8dcc4', '#6d8b74') +
        table(400),
    ),
  },
  {
    src: '/img/tom.jpg',
    file: 'tom.jpg',
    subject: ['kiln'],
    svg: svg(
      `<rect x="300" y="120" width="280" height="300" rx="14" fill="#6e6259"/><rect x="330" y="160" width="220" height="200" fill="#e8742c"/><rect x="345" y="210" width="190" height="8" fill="#5a4a3f"/><rect x="345" y="290" width="190" height="8" fill="#5a4a3f"/>${bowl(390, 205, 30, '#d7c7a8')}${bowl(470, 205, 30, '#9fb7a0')}${bowl(430, 285, 34, '#c9b48d')}` +
        person(170, 120, '#7a5c3e', { armsTo: [330, 260] }),
      '#ece6dc',
    ),
  },
  {
    src: '/img/divider.png',
    file: 'divider.png',
    subject: [],
    svg: svg(
      `<path d="M80,240 C200,180 260,300 320,240 S440,180 560,240" stroke="#b7a68c" stroke-width="4" fill="none"/><circle cx="320" cy="240" r="9" fill="#b7a68c"/>`,
      '#ffffff',
    ),
  },
  ...['#a9bfa4', '#d9d2c3', '#efe6d2', '#e8dcc4', '#c9b48d', '#8a6240'].map((_, i): Scene => {
    const scenes = [
      [
        'g1.jpg',
        ['plate'],
        [0, 1, 2, 3, 4, 5]
          .map(
            (k) =>
              `<ellipse cx="320" cy="${340 - k * 22}" rx="150" ry="34" fill="#9fb59a" stroke="#6f8a6b" stroke-width="3"/>`,
          )
          .join('') + table(360),
      ],
      [
        'g2.jpg',
        ['vase'],
        `<path d="M280,420 C230,300 300,240 285,140 L355,140 C340,240 410,300 360,420 Z" fill="#e3ddd0" stroke="#7d7466" stroke-width="3"/>${Array.from({ length: 30 }, () => `<path d="M${(270 + rnd() * 100).toFixed(0)},${(160 + rnd() * 240).toFixed(0)} l${(rnd() * 30 - 15).toFixed(0)},${(rnd() * 30 - 15).toFixed(0)} l${(rnd() * 20 - 10).toFixed(0)},${(rnd() * 25).toFixed(0)}" stroke="#7d7466" fill="none"/>`).join('')}` +
          table(420),
      ],
      [
        'g3.jpg',
        ['cup', 'espresso'],
        `<ellipse cx="220" cy="350" rx="110" ry="22" fill="#e8e1d5" stroke="#9b8f80"/><ellipse cx="420" cy="350" rx="110" ry="22" fill="#e8e1d5" stroke="#9b8f80"/>` +
          mug(175, 255, 0.7, '#3d3a37', '#2a2826', false) +
          mug(375, 255, 0.7, '#3d3a37', '#2a2826', false) +
          table(380),
      ],
      [
        'g4.jpg',
        ['bowl'],
        bowl(320, 250, 210, '#efe6d2', '#1f3d7a') +
          `<circle cx="260" cy="235" r="34" fill="#d9442b"/><circle cx="330" cy="225" r="36" fill="#f2b632"/><circle cx="390" cy="238" r="32" fill="#7fae3c"/>` +
          table(420),
      ],
      [
        'g5.jpg',
        ['jug', 'milk'],
        `<path d="M250,170 L370,170 L400,140 L395,180 C410,260 400,330 390,380 L240,380 C230,300 230,230 250,170Z" fill="#c9d6e3" stroke="#6d7f91" stroke-width="3" transform="rotate(25 320 270)"/><path d="M470,230 C480,300 470,360 465,430" stroke="#ffffff" stroke-width="16" fill="none"/>` +
          bowl(470, 430, 70, '#f4f1ea'),
      ],
      [
        'g6.jpg',
        ['teapot'],
        `<ellipse cx="320" cy="320" rx="150" ry="110" fill="#5f7d6a"/><path d="M180,300 C110,280 100,230 120,210" stroke="#5f7d6a" stroke-width="26" fill="none"/><path d="M220,220 C230,90 410,90 420,220" stroke="#c9a66b" stroke-width="16" fill="none"/><rect x="290" y="200" width="60" height="18" rx="9" fill="#4a6352"/>` +
          table(420),
      ],
    ] as const;
    const [file, subject, body] = scenes[i] ?? scenes[0];
    return { src: `/img/${file}`, file, subject: [...subject], svg: svg(body) };
  }),
  {
    src: '/img/glaze-test.jpg',
    file: 'glaze-test.jpg',
    subject: ['tile'],
    svg: svg(
      [
        '#cfe3ef',
        '#b5d4e6',
        '#9cc4dc',
        '#84b5cf',
        '#79b0b0',
        '#6aa597',
        '#5c9a80',
        '#4f8f6c',
        '#43845b',
        '#38784c',
        '#2d6c3f',
        '#235f33',
      ]
        .map(
          (c, i) =>
            `<rect x="${String(60 + (i % 4) * 135)}" y="${String(60 + Math.floor(i / 4) * 125)}" width="115" height="105" rx="8" fill="${c}" stroke="#00000033"/>`,
        )
        .join(''),
      '#e9e4da',
    ),
  },
  {
    src: '/img/hero-mugs.jpg',
    file: 'hero-mugs.jpg',
    subject: ['mug'],
    svg: svg(
      `<rect x="40" y="330" width="560" height="26" fill="#8a6240"/><rect x="60" y="356" width="18" height="80" fill="#6f4e33"/><rect x="562" y="356" width="18" height="80" fill="#6f4e33"/>` +
        mug(90, 200) +
        mug(250, 200) +
        mug(410, 200),
      '#e6e0d6',
    ),
  },
  {
    src: '/img/logo.svg',
    file: 'logo.png',
    subject: ['fern', 'clay'],
    svg: svg(
      `<path d="M200,330 C230,250 230,170 200,110" stroke="#4f7a4a" stroke-width="6" fill="none"/>${[0, 1, 2, 3, 4].map((k) => `<path d="M${String(205 + k)},${String(300 - k * 40)} q-50,-10 -60,-40 M${String(208 + k)},${String(300 - k * 40)} q45,-15 55,-45" stroke="#4f7a4a" stroke-width="5" fill="none"/>`).join('')}<text x="290" y="255" font-family="Georgia, serif" font-size="64" fill="#3e3a33">Fern &amp; Clay</text>`,
      '#ffffff',
    ),
  },
  {
    src: '/img/map.png',
    file: 'map.png',
    subject: ['station', 'map'],
    svg: svg(
      `<rect x="0" y="300" width="640" height="34" fill="#ffffff"/><rect x="0" y="150" width="640" height="30" fill="#ffffff"/><rect x="0" y="50" width="640" height="28" fill="#ffffff"/><rect x="300" y="0" width="34" height="480" fill="#ffffff"/>
<rect x="250" y="360" width="140" height="70" fill="#4a6fa5"/><text x="320" y="403" text-anchor="middle" font-family="Arial" font-size="22" fill="#fff">Station</text>
<circle cx="317" cy="110" r="20" fill="#d93025"/><text x="345" y="118" font-family="Arial" font-size="24" fill="#202124">Studio</text>
<text x="20" y="173" font-family="Arial" font-size="16" fill="#5f6368">Mill Street</text><text x="20" y="72" font-family="Arial" font-size="16" fill="#5f6368">Kiln Lane</text>`,
      '#e8eee3',
    ),
  },
  {
    src: '/img/mug-front.jpg',
    file: 'mug-front.jpg',
    subject: ['mug'],
    svg: svg(mug(220, 140, 1.6) + table(400), '#ece7de'),
  },
  {
    src: '/img/mug-handle.jpg',
    file: 'mug-handle.jpg',
    subject: ['handle'],
    svg: svg(
      `<rect x="-80" y="60" width="300" height="420" rx="20" fill="#efe6d2"/>${speckles(0, 80, 200, 380, 60)}<path d="M220,140 C420,120 470,330 220,360" stroke="#efe6d2" stroke-width="70" fill="none"/><ellipse cx="300" cy="140" rx="34" ry="20" fill="#d8ccb3"/>`,
      '#e2dbcf',
    ),
  },
  {
    src: '/img/packing.jpg',
    file: 'packing.jpg',
    subject: ['box', 'mug', 'wrapped'],
    svg: svg(
      `<path d="M100,200 L540,200 L540,440 L100,440 Z" fill="#c69c6d"/><path d="M100,200 L60,130 L300,130 L320,200 Z" fill="#b48a5c"/><path d="M540,200 L580,130 L340,130 L320,200 Z" fill="#b48a5c"/>${[150, 270, 390].map((x) => `<ellipse cx="${String(x + 50)}" cy="230" rx="62" ry="58" fill="#e7e1d4" stroke="#bdb5a4"/><path d="M${String(x + 10)},210 q40,25 80,0 M${String(x + 15)},240 q35,-20 75,5" stroke="#bdb5a4" fill="none"/>`).join('')}`,
      '#ede8df',
    ),
  },
  {
    src: '/img/studio.jpg',
    file: 'studio.jpg',
    subject: ['wheel', 'bowl', 'potter'],
    svg: svg(
      wheel(320, 300) +
        bowl(320, 300, 60, '#b58a62') +
        person(320, 60, '#556b2f', { armsTo: [320, 270] }),
      '#e4ddd2',
    ),
  },
  {
    src: '/img/welcome.jpg',
    file: 'welcome.jpg',
    subject: ['cup', 'hands', 'hand'],
    svg: svg(
      `<path d="M120,480 C140,380 200,330 250,320" stroke="#d9a77f" stroke-width="70" fill="none" stroke-linecap="round"/><path d="M520,480 C500,380 440,330 390,320" stroke="#d9a77f" stroke-width="70" fill="none" stroke-linecap="round"/>` +
        mug(255, 200, 1.1, '#3f7f8c', '#2c5d67', false) +
        `<rect x="263" y="230" width="105" height="40" fill="#ffffff44"/>`,
      '#efe9df',
    ),
  },
  {
    src: '/img/workshop.jpg',
    file: 'workshop.jpg',
    subject: ['wheel', 'class', 'people'],
    svg: svg(
      [80, 240, 400, 560]
        .map(
          (x, i) =>
            wheel(x, 360) +
            person(x, 170, ['#4a6fa5', '#a5544a', '#5f7d6a', '#8a6fa5'][i] ?? '#444', {
              armsTo: [x, 340],
            }),
        )
        .join(''),
      '#2f3440',
    ),
  },
  {
    src: '/img/hours.png',
    file: 'hours.png',
    subject: ['saturday'],
    hard: true,
    svg: svg(
      `<rect x="120" y="50" width="400" height="380" rx="12" fill="#2f4a3a"/>` +
        text(320, 170, 84, 'OPEN', '#f4efe6', 700) +
        text(320, 260, 40, 'Saturdays', '#f4efe6') +
        text(320, 330, 48, '10am – 4pm', '#f4efe6', 700),
    ),
  },
  {
    src: '/img/icon-basket.svg',
    file: 'icon-basket.png',
    subject: ['basket'],
    hard: true,
    svg: svg(
      `<path d="M190 200 L320 110 L450 200" fill="none" stroke="#2f2a24" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M150 200 H490 L450 380 H190 Z" fill="#2f2a24"/>
<path d="M240 240 V340 M320 240 V340 M400 240 V340" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/>`,
      '#ffffff',
    ),
  },
  { src: '/img/qr.png', file: 'qr.png', subject: [], hard: true, svg: qr() },
  {
    src: '/img/chart.png',
    file: 'chart.png',
    subject: [],
    hard: true,
    svg: svg(
      `<path d="M80 60 V420 H580" fill="none" stroke="#2f2a24" stroke-width="4"/>` +
        [220, 160, 250, 300, 120, 340]
          .map(
            (h, i) =>
              `<rect x="${110 + i * 78}" y="${420 - h}" width="52" height="${h}" fill="#6d8b74"/>`,
          )
          .join(''),
      '#ffffff',
    ),
  },
];
