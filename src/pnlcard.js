// Du bilan à l'image : mise en planche des chiffres.
//
// Trois encres — noir, blanc, vert fluo. Le vert ne désigne qu'une chose : ce
// qu'il y a à prendre. Tout le reste tient en noir et blanc.
//
// La carte se lit en trois blocs serrés, séparés par de l'air plutôt que par
// des traits : qui (le Friend, en grand), quoi (à réclamer), et à quel régime
// (file d'attente, part de poids, APY). L'étiquette et ses chiffres partagent
// une seule découpe — ils ne se cherchent pas.
//
// Deux voix typographiques : Silkscreen pour l'identité et les montants,
// Sometype Mono pour tout ce qui mesure. Le texte est en anglais : c'est
// l'image qui circule, et la communauté Rare Friends l'est.

import {
  DATA, DATA_LIGHT, DISPLAY, INK,
  grain, pixelGlyph, pixelGrid, pixelSticker, seedFrom, snap, stack, sticker,
} from './sticker.js';

export const CARD_W = 1080;
export const CARD_H = 1350;
const MARGIN = 76;

/* ------------------------------------------------------------------ */
/* nombres                                                             */
/* ------------------------------------------------------------------ */

const nf = (digits) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});

const round = (n, digits = 0) => nf(digits).format(n);

/** 100 000 → 100K, 1 240 000 → 1.24M. Les gros nombres tiennent sur un sticker. */
function compact(n) {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${round(n / 1e6, abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${round(n / 1e3, 0)}K`;
  return round(n, abs >= 100 ? 0 : 1);
}

/* Le montant sans son signe : sur la carte le dollar est dessiné en pixels à
   côté, celui de la police jurerait avec les sprites. */
const money = (n) => compact(Math.abs(n));

/* ------------------------------------------------------------------ */
/* réduction à la largeur                                              */
/* ------------------------------------------------------------------ */

/** Descend la taille, de cran en cran, jusqu'à ce que le texte tienne. */
function fit(ctx, text, size, max, font = DISPLAY) {
  let s = snap(size, font);
  const grip = font === DISPLAY ? 0.9 : 0.7;      // Sometype Mono a moins de chasse
  ctx.font = `${s}px ${font}`;
  while (s > 16 && ctx.measureText(text).width + s * grip > max) {
    s = snap(s - 8, font);
    ctx.font = `${s}px ${font}`;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* planche                                                             */
/* ------------------------------------------------------------------ */

/**
 * Peint la carte de `report` dans `canvas` (1080 × 1350).
 * `friend` est facultatif : les métadonnées du Genesis mis en avant, pour le
 * portrait. Sans lui la planche reste complète, sans vignette.
 */
export function paintCard(canvas, report, friend = null) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const rnd = seedFrom(report.address);
  const jitter = (amount) => (rnd() - 0.5) * 2 * amount;

  const earning = report.claimable.rf > 0 || report.perDay.rf > 0;

  ctx.fillStyle = INK.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  pixelGrid(ctx, CARD_W, CARD_H);
  backdropGlyphs(ctx, rnd);

  header(ctx, report, jitter);
  portrait(ctx, report, friend, jitter);

  if (earning) claim(ctx, report, jitter);
  else idle(ctx, report, jitter);

  footer(ctx, report);
  grain(ctx, CARD_W, CARD_H);
  return canvas;
}

/* --- fond : quelques dollars en pixels, presque éteints -------------- */

function backdropGlyphs(ctx, rnd) {
  // Dans les gouttières seulement, et calés sur le pas de la grille : ils
  // bordent la carte sans jamais passer derrière un chiffre.
  const spots = [[1, 9], [39, 13], [1, 21], [39, 25], [1, 33], [39, 37], [1, 45]];
  for (const [col, row] of spots) {
    pixelGlyph(ctx, 'dollar', {
      x: col * 27, y: row * 27, cell: 8 + Math.round(rnd() * 3), color: INK.ash,
    });
  }
}

/* --- en-tête : ce que c'est, et pour qui ---------------------------- */

function header(ctx, report, jitter) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.bone;
  ctx.font = `26px ${DATA}`;
  ctx.fillText('REWARDS CARD', MARGIN, 104);
  // Un filet plein sous l'en-tête : la carte commence là.
  ctx.fillStyle = INK.bone;
  ctx.fillRect(MARGIN, 136, CARD_W - MARGIN * 2, 5);
  ctx.restore();

  sticker(ctx, {
    text: report.short.toUpperCase(), x: CARD_W - MARGIN - 116 + jitter(10), y: 104,
    size: 24, angle: 6 + jitter(2), style: 'band', fill: INK.bone, ink: INK.black,
    font: DATA,
  });
}

/* --- le Friend, en grand -------------------------------------------- */

function portrait(ctx, report, friend, jitter) {
  const hero = report.friends.filter((f) => f.active).sort((a, b) => b.weight - a.weight)[0]
    || report.friends[0];

  if (friend?.pixels) {
    pixelSticker(ctx, {
      pixels: friend.pixels, x: 452 + jitter(12), y: 420, size: 424,
      angle: -4 + jitter(2), fill: INK.bone, back: INK.black,
    });
  }
  if (hero) {
    const tag = `${hero.collection === 'Genesis' ? 'GENESIS' : 'GEN'} #${hero.id}`;
    // Posé sur le coin du portrait : les deux ne font qu'un seul objet.
    sticker(ctx, {
      text: tag, x: 800 + jitter(12), y: 568,
      size: fit(ctx, tag, 52, 400), angle: 8 + jitter(2),
      style: 'band', fill: INK.bone, ink: INK.black,
    });
  }
  const others = report.friends.length - 1;
  if (others > 0) {
    sticker(ctx, {
      text: `+${others} MORE`, x: 196 + jitter(10), y: 628,
      size: 22, angle: -7 + jitter(2), style: 'band', fill: INK.ash, ink: INK.bone,
      font: DATA,
    });
  }
}

/* --- ce qu'il y a à prendre, et à quel régime ------------------------ */

function claim(ctx, report, jitter) {
  // Étiquette et chiffres sur une seule découpe : c'est le cœur de la carte,
  // et la seule tache de vert. Le WETH passe devant et prend la grande taille :
  // c'est lui qui pèse le plus lourd dans ce qu'il y a à prendre.
  const weth = `+${round(report.claimable.weth, 4)} WETH`;
  const rf = `+${compact(report.claimable.rf)} RF`;
  stack(ctx, {
    lines: [
      { text: 'TO CLAIM', size: 26, font: DATA },
      { text: weth, size: fit(ctx, weth, 88, 840), font: DISPLAY, gap: 28 },
      { text: rf, size: fit(ctx, rf, 48, 840), font: DISPLAY, gap: 22 },
    ],
    x: CARD_W / 2 + jitter(10), y: 830, angle: -3 + jitter(1),
    fill: INK.lime, ink: INK.black, padX: 64, padY: 42,
  });

  // Les deux mesures se serrent sous le bloc, en noir et blanc.
  const pending = report.usd ? money(report.usd.pending) : `${compact(report.pending.rf)} RF`;
  const label = `${pending} PENDING`;
  const box = sticker(ctx, {
    text: label, x: 404 + jitter(10), y: 1030,
    size: fit(ctx, label, 38, 430, DATA), angle: 4 + jitter(2),
    style: 'band', fill: INK.black, ink: INK.bone, edge: INK.bone, font: DATA,
  });
  if (report.usd) {
    pixelGlyph(ctx, 'dollar', {
      x: 404 - box.w / 2 - 20, y: 1024, cell: 6, color: INK.lime, angle: 4,
    });
  }

  sticker(ctx, {
    text: `${round(report.share * 100, 2)}% OF WEIGHT`, x: 788 + jitter(10), y: 1038,
    size: 22, angle: -5 + jitter(2), style: 'band', fill: INK.ash, ink: INK.bone,
    font: DATA,
  });

  if (report.apy) {
    const apy = `${compact(report.apy)}% APY`;
    sticker(ctx, {
      text: apy, x: CARD_W / 2 + 20 + jitter(10), y: 1136,
      size: fit(ctx, apy, 72, 740, DATA), angle: 3 + jitter(1), font: DATA,
      style: 'band', fill: INK.bone, ink: INK.black,
    });
  }
}

/* --- rien d'activé : on dit ce qu'il y a, pas une pile de zéros ------ */

function idle(ctx, report, jitter) {
  stack(ctx, {
    lines: [
      { text: 'HOLDING', size: 26, font: DATA },
      {
        text: `${report.friends.length} FRIEND${report.friends.length > 1 ? 'S' : ''}`,
        size: 96, font: DISPLAY, gap: 28,
      },
      { text: 'NOT ACTIVATED', size: 32, font: DATA, gap: 24 },
    ],
    x: CARD_W / 2 + jitter(10), y: 860, angle: -3 + jitter(1),
    fill: INK.bone, ink: INK.black, padX: 64, padY: 42,
  });

  if (report.bag.rf > 1) {
    const bag = `${compact(report.bag.rf)} RF IN WALLET`;
    sticker(ctx, {
      text: bag, x: CARD_W / 2 + jitter(10), y: 1088,
      size: fit(ctx, bag, 38, 680, DATA), angle: 4 + jitter(2), font: DATA,
      style: 'band', fill: INK.black, ink: INK.bone, edge: INK.bone,
    });
  }
}

/* --- bas de page : d'où sortent les chiffres ------------------------ */

function footer(ctx, report) {
  // L'adresse complète n'a rien à faire ici : la carte est faite pour être
  // partagée, et la puce de l'en-tête en dit déjà assez pour reconnaître le
  // wallet sans le publier.
  ctx.save();
  ctx.fillStyle = INK.bone;
  ctx.fillRect(MARGIN, CARD_H - 128, CARD_W - MARGIN * 2, 4);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.smoke;
  ctx.font = `17px ${DATA_LIGHT}`;
  // en-US plutôt qu'en-GB : « sept » de l'anglais britannique se lit comme du
  // français sur une carte par ailleurs anglophone.
  const stamp = report.at.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  ctx.fillText(`block ${report.block} · ${stamp.toLowerCase()}`, MARGIN, CARD_H - 80);
  ctx.textAlign = 'right';
  ctx.fillText('read on-chain · not affiliated', CARD_W - MARGIN, CARD_H - 80);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* texte                                                               */
/* ------------------------------------------------------------------ */

/** Les chiffres de la carte, en texte : partage, accessibilité, vérification. */
export function cardSummary(report) {
  const owned = report.friends.length;
  const lines = [
    `${report.short} · ${owned} Friend${owned > 1 ? 's' : ''}, ${report.activeCount} earning`,
  ];

  if (report.claimable.rf <= 0 && report.perDay.rf <= 0) {
    lines.push('Not activated — these Friends earn nothing yet.');
    return lines.join('\n');
  }

  lines.push(
    `To claim ${round(report.claimable.rf)} RF + ${round(report.claimable.weth, 4)} WETH`,
    `Pending ${round(report.pending.rf)} RF + ${round(report.pending.weth, 4)} WETH`,
    `${round(report.share * 100, 2)}% of total weight · ${round(report.perDay.rf)} RF/day`,
  );
  if (report.usd) {
    lines.push(`≈ $${money(report.usd.earned)} to claim, $${money(report.usd.pending)} pending`);
  }
  if (report.apy) lines.push(`${round(report.apy)}% APY on ${round(report.paid.rf)} RF staked`);
  if (report.claimed.rf > 0.5) lines.push(`Already claimed ${round(report.claimed.rf)} RF`);
  if (!report.claimsKnown) lines.push('Claim history unavailable from the public node.');
  return lines.join('\n');
}
