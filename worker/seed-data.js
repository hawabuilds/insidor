/** Mock NARRATIVES seed — mirrors site/index.html (source of truth for first seed). */
'use strict';

const NARR = [
  { txt: "A retiring ferry captain blew the horn one last time and the whole harbor blew theirs back. $FERRY i'm not okay" },
  { txt: "grandma found out the plant she'd been watering for 3 years was plastic. her face. $PLANT" },
  { txt: "TIL a town in Norway pays people to move there and nobody talks about it $NORWAY" },
  { txt: "he named the office stapler and now HR has to refer to it by name in the memo $STAPLR" },
  { txt: "the frog that shows up on my porch every rainstorm has a name now. it's Gerald. $FROG" },
  { txt: "a chess grandmaster lost to a pigeon and wrote a 4-page essay about it $PIGEON" },
  { txt: "barista wrote the wrong name so consistently the guy legally considered changing it" },
  { txt: "the vending machine at my gym only accepts compliments now. i don't make the rules $VEND" },
  { txt: "my dad has been feuding with a specific cloud for two summers. i have proof." },
  { txt: "someone built a tiny door in the subway wall and mice are actually using it $MOUSE" },
];

const NOW = Date.now();
const NH = 3600000;

function pseed(str) {
  let x = 0;
  str = '' + str;
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
  return x;
}

function mkSeries(seed, trend) {
  const n = 18;
  const pts = [];
  let v = 18 + seed % 22;
  for (let i = 0; i < n; i++) {
    if (trend === 'heat') v += 2.2 + Math.sin(i * 0.55) * 1.4 + (seed % 4) * 0.3;
    else if (trend === 'peak') v += i < n / 2 ? 2.8 : -2.1 + (seed % 3) * 0.2;
    else v += i < n * 0.55 ? 1.1 : -1.6;
    v = Math.max(6, Math.min(94, v));
    pts.push(Math.round(v * 12000 * (1 + i * 0.07)));
  }
  return pts;
}

function mkSafety(seed, risk) {
  return {
    mintRevoked: seed % 5 !== 0,
    lpBurned: seed % 3 !== 0,
    topHolderPct: 8 + seed % 22,
    devHoldingPct: seed % 8,
    sniperPct: 4 + seed % 14,
    bundledPct: seed % 11,
    devSelling: seed % 13 === 0,
    riskLabel: risk || ['low', 'med', 'high'][seed % 3],
  };
}

function mkSmartMoney(seed) {
  return {
    smartWalletsIn: 10 + seed * 4,
    holderGrowth1h: (seed % 18) - 4,
    topTraders: [
      { handle: '@alpha' + seed, pnl: '+' + seed * 1100 + ' SOL' },
      { handle: '@whale' + (seed + 2), pnl: '+' + (seed + 2) * 740 + ' SOL' },
    ],
  };
}

function seedPost(plat, handle, text, views, o = {}) {
  return {
    platform: plat,
    handle,
    followers: o.followers || Math.round(40000 + views / 80),
    text,
    image: o.image !== false,
    views: Math.round(views),
    replies: o.replies || Math.round(views * 0.0045),
    quotes: o.quotes || Math.round(views * 0.0022),
    notable: !!o.notable,
    sampleReplies: o.sampleReplies || [],
    postedAt: o.postedAt || null,
  };
}

function seedTok(ticker, name, o = {}) {
  const seed = pseed(ticker) % 1000;
  return {
    ticker,
    name,
    mcap: o.mcap || 0,
    liquidity: o.liq || 22000 + seed * 900,
    vol24h: o.vol24h || 70000 + seed * 4200,
    holders: o.holders || 180 + seed * 11,
    ageMin: o.ageMin || 38 + seed * 6,
    firstDeployed: !!o.firstDeployed,
    endorsedBy: o.endorsedBy || null,
    canonical: !!o.canonical,
    safety: o.safety || mkSafety(seed, o.risk),
    smartMoney: o.smartMoney || mkSmartMoney(seed),
  };
}

function mkNar(o) {
  return {
    id: o.id,
    title: o.title,
    blurb: o.blurb,
    image: o.imgSeed,
    createdAt: o.createdAt,
    narrIdx: o.narrIdx ?? -1,
    imgSeed: o.imgSeed,
    searchSeries: o.viewsSeries || o.searchSeries,
    viewsSeries: o.viewsSeries || o.searchSeries,
    leadTimeMin: o.leadTimeMin,
    organicScore: o.organicScore,
    posts: o.posts,
    tokens: o.tokens || [],
  };
}

function getSeedNarratives() {
  return [
    mkNar({
      id: 'ferry-horn', title: 'Harbor Last Horn', blurb: 'Retiring captain, whole harbor responds',
      narrIdx: 0, imgSeed: 0, createdAt: NOW - 4 * NH, leadTimeMin: 31, organicScore: 88,
      viewsSeries: mkSeries(7, 'heat'),
      posts: [seedPost('x', '@nordkyst_ferge', NARR[0].txt, 2400000, {
        notable: true, replies: 9800, quotes: 4200,
        sampleReplies: ['i am not okay 😭', 'harbor ASMR', '$FERRY is the ticker'],
      })],
      tokens: [
        seedTok('FERRY', 'Last Horn', { canonical: true, firstDeployed: true, endorsedBy: '@nordkyst_ferge', risk: 'low' }),
        seedTok('HORN', 'Harbor Horn', { mcap: 42000, firstDeployed: false, risk: 'high' }),
      ],
    }),
    mkNar({
      id: 'plastic-plant', title: 'Plastic Plant Grandma', blurb: 'Three years watering a fake fern',
      narrIdx: 1, imgSeed: 1, createdAt: NOW - 6 * NH, leadTimeMin: 27, organicScore: 91,
      viewsSeries: mkSeries(12, 'peak'),
      posts: [seedPost('tt', '@plantmum', NARR[1].txt, 1900000, {
        notable: true, replies: 7200, quotes: 3100,
        sampleReplies: ['the WATER sound 😭', 'grandma core', 'fake plant meta'],
      })],
      tokens: [
        seedTok('PLANT', 'Plastic Fern', { canonical: true, firstDeployed: true, endorsedBy: '@plantmum', risk: 'low' }),
        seedTok('FERN', 'Fake Fern', { mcap: 18000, risk: 'med' }),
      ],
    }),
    mkNar({
      id: 'norway-move', title: 'Paid to Move to Norway', blurb: 'Town pays newcomers — nobody talks about it',
      narrIdx: 2, imgSeed: 2, createdAt: NOW - 2 * NH, leadTimeMin: 44, organicScore: 79,
      viewsSeries: mkSeries(3, 'heat'),
      posts: [
        seedPost('x', '@nordic_notes', NARR[2].txt, 720000, {
          notable: true, replies: 4100, quotes: 1900,
          sampleReplies: ['wait this is real?', 'moving tomorrow', '$NORWAY when'],
        }),
        seedPost('tt', '@nordic_notes', NARR[2].txt, 390000, {
          replies: 2800, quotes: 900, sampleReplies: ['Nordic arc', 'visa arc incoming'],
        }),
      ],
      tokens: [],
    }),
    mkNar({
      id: 'stapler-hr', title: 'Named Office Stapler', blurb: "HR memo must use the stapler's name",
      narrIdx: 3, imgSeed: 3, createdAt: NOW - 9 * NH, leadTimeMin: 19, organicScore: 72,
      viewsSeries: mkSeries(4, 'cool'),
      posts: [seedPost('x', '@desklife', NARR[3].txt, 980000, {
        replies: 5200, quotes: 2100, sampleReplies: ['meet Stapler Steve', 'corporate dystopia'],
      })],
      tokens: [
        seedTok('STAPLR', 'Named Stapler', { canonical: true, firstDeployed: true, endorsedBy: '@desklife', risk: 'med' }),
        seedTok('STEVE', 'Stapler Steve', { mcap: 9500, risk: 'high' }),
      ],
    }),
    mkNar({
      id: 'pigeon-chess', title: 'Grandmaster vs Pigeon', blurb: 'Four-page essay after a loss to a bird',
      narrIdx: 5, imgSeed: 5, createdAt: NOW - 11 * NH, leadTimeMin: 23, organicScore: 84,
      viewsSeries: mkSeries(9, 'heat'),
      posts: [
        seedPost('x', '@boardstate', NARR[5].txt, 690000, {
          notable: true, replies: 6100, quotes: 2800,
          sampleReplies: ['the essay link', 'bird ELO?'],
        }),
        seedPost('tt', '@boardstate', NARR[5].txt, 420000, {
          replies: 3400, quotes: 1200, sampleReplies: ['pigeon meta', '$PIGEON lfg'],
        }),
      ],
      tokens: [seedTok('PIGEON', 'Grandmaster', { canonical: true, firstDeployed: true, endorsedBy: '@boardstate', risk: 'low' })],
    }),
    mkNar({
      id: 'gym-vend', title: 'Compliments-Only Vending', blurb: 'Gym machine changed the rules',
      narrIdx: 7, imgSeed: 7, createdAt: NOW - 14 * NH, leadTimeMin: 15, organicScore: 76,
      viewsSeries: mkSeries(6, 'peak'),
      posts: [seedPost('x', '@gymvend', NARR[7].txt, 520000, {
        replies: 3900, quotes: 1500, sampleReplies: ['you look strong today', 'vending machine PvP'],
      })],
      tokens: [seedTok('VEND', 'Compliments Only', { canonical: true, firstDeployed: true, endorsedBy: '@gymvend', risk: 'med' })],
    }),
    mkNar({
      id: 'subway-mouse', title: 'Subway Mouse Door', blurb: 'Tiny door in the wall — mice use it',
      narrIdx: 9, imgSeed: 9, createdAt: NOW - 18 * NH, leadTimeMin: 29, organicScore: 93,
      viewsSeries: mkSeries(10, 'cool'),
      posts: [seedPost('tt', '@subwaymouse', NARR[9].txt, 380000, {
        notable: true, replies: 2900, quotes: 800,
        sampleReplies: ['tiny door tour', 'mouse gentrification'],
      })],
      tokens: [seedTok('MOUSE', 'Subway Door', { canonical: true, firstDeployed: true, endorsedBy: '@subwaymouse', risk: 'low' })],
    }),
    mkNar({
      id: 'wrong-name', title: 'Barista Name Lock-In', blurb: 'Wrong cup name so long he considered legal change',
      narrIdx: 6, imgSeed: 6, createdAt: NOW - 7 * NH, leadTimeMin: 38, organicScore: 86,
      viewsSeries: mkSeries(6, 'heat'),
      posts: [seedPost('tt', '@cupnames', NARR[6].txt, 610000, {
        replies: 4400, quotes: 1700, sampleReplies: ['name change arc', 'barista villain'],
      })],
      tokens: [],
    }),
    mkNar({
      id: 'dad-cloud', title: 'Dad vs One Cloud', blurb: 'Two summers feuding with a specific cloud',
      narrIdx: 8, imgSeed: 8, createdAt: NOW - 20 * NH, leadTimeMin: 41, organicScore: 68,
      viewsSeries: mkSeries(8, 'cool'),
      posts: [
        seedPost('x', '@skybeef', NARR[8].txt, 430000, {
          replies: 2100, quotes: 900, sampleReplies: ['cloud beef lore'],
        }),
        seedPost('tt', '@skybeefclips', NARR[8].txt, 280000, {
          replies: 1800, quotes: 600, sampleReplies: ['dad vs cloud pt 2'],
        }),
      ],
      tokens: [],
    }),
    mkNar({
      id: 'porch-frog', title: 'Porch Frog Gerald', blurb: 'Rainstorm visitor now has a name',
      narrIdx: 4, imgSeed: 4, createdAt: NOW - 5 * NH, leadTimeMin: 52, organicScore: 90,
      viewsSeries: mkSeries(5, 'heat'),
      posts: [
        seedPost('tt', '@geraldwatch', NARR[4].txt, 510000, {
          notable: true, replies: 3800, quotes: 1400,
          sampleReplies: ['gerald updates', 'rain frog'],
        }),
        seedPost('x', '@geraldwatch', NARR[4].txt, 230000, {
          replies: 1200, quotes: 500, sampleReplies: ['$FROG when'],
        }),
      ],
      tokens: [],
    }),
    mkNar({
      id: 'ferry-duet', title: 'Ferry Horn Duet', blurb: 'TikTok stitch of the harbor moment',
      narrIdx: 0, imgSeed: 10, createdAt: NOW - 3 * NH, leadTimeMin: 18, organicScore: 74,
      viewsSeries: mkSeries(11, 'peak'),
      posts: [seedPost('tt', '@harborclips', 'every boat answered the horn. i cried. $FERRY', 890000, {
        replies: 8100, quotes: 3600, sampleReplies: ['full harbor clip', 'goosebumps'],
      })],
      tokens: [seedTok('FERRY', 'Last Horn', { canonical: true, endorsedBy: '@nordkyst_ferge', risk: 'low' })],
    }),
    mkNar({
      id: 'plant-stitch', title: 'Plant TikTok Stitch', blurb: 'Reaction videos to the plastic plant reveal',
      narrIdx: 1, imgSeed: 11, createdAt: NOW - 8 * NH, leadTimeMin: 22, organicScore: 82,
      viewsSeries: mkSeries(11, 'heat'),
      posts: [
        seedPost('tt', '@plantmum', 'stitch: grandma still watering it. $PLANT', 640000, {
          replies: 5500, quotes: 2200, sampleReplies: ['stitch chain'],
        }),
        seedPost('x', '@plantmum', 'the plastic plant saga continues', 210000, { replies: 900, quotes: 400 }),
      ],
      tokens: [seedTok('PLANT', 'Plastic Fern', { canonical: true, endorsedBy: '@plantmum', risk: 'low' })],
    }),
    mkNar({
      id: 'office-meme', title: 'Office Meme Hour', blurb: 'Stapler lore crosses into TikTok',
      narrIdx: 3, imgSeed: 12, createdAt: NOW - 22 * NH, leadTimeMin: 14, organicScore: 65,
      viewsSeries: mkSeries(12, 'cool'),
      posts: [seedPost('tt', '@desklife', 'POV: HR calls the stapler by name in the memo', 340000, {
        replies: 1600, quotes: 700, sampleReplies: ['office tok'],
      })],
      tokens: [],
    }),
    mkNar({
      id: 'vending-tt', title: 'Vending Machine Lore', blurb: 'Compliment-only machine hits TikTok FYP',
      narrIdx: 7, imgSeed: 13, createdAt: NOW - 12 * NH, leadTimeMin: 16, organicScore: 77,
      viewsSeries: mkSeries(6, 'peak'),
      posts: [seedPost('tt', '@gymvend', 'you must compliment the machine to get a snack $VEND', 470000, {
        replies: 3200, quotes: 1100, sampleReplies: ['compliment meta'],
      })],
      tokens: [seedTok('VEND', 'Compliments Only', { canonical: true, endorsedBy: '@gymvend', risk: 'med' })],
    }),
  ];
}

function initNarrPostTimes(narratives) {
  narratives.forEach(n => {
    n.posts.forEach((p, i) => {
      if (p.postedAt == null) p.postedAt = n.createdAt + i * NH * 2;
    });
  });
}

module.exports = { getSeedNarratives, initNarrPostTimes, NH };
