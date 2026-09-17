// Moteur de composition « sticker bomb ».
//
// Des stickers découpés posés de travers sur du papier millimétré à pixels.
// Chaque sticker porte un chiffre ou le mot qui l'annonce ; les stickers à
// plusieurs lignes gardent l'étiquette et ses chiffres sur une seule découpe.
// Tout est peint sur un canvas, donc exportable en PNG sans dépendance ni
// capture d'écran.
//
// Deux voix typographiques, celles du site Rare Friends lui-même :
//
//   Silkscreen    — la police à pixels. Elle crie : l'identité et les gros
//                   montants. Elle impose le reste du dessin : coins en
//                   escalier plutôt qu'arrondis, jointures d'angle carrées,
//                   tailles calées sur une grille de 8 pixels.
//   Sometype Mono — la voix technique. Elle constate : étiquettes, mesures,
//                   pourcentages, adresse. Pas de grille à respecter, donc pas
//                   de calage de taille.

/* ------------------------------------------------------------------ */
/* palette                                                             */
/* ------------------------------------------------------------------ */

// Trois encres, pas une de plus. Le noir et le blanc portent toute la carte ;
// le vert ne sert qu'à désigner ce qu'on est venu chercher.
export const INK = {
  paper: '#0b0b0b',
  black: '#101010',
  bone: '#f0ede5',
  lime: '#c6f53a',
  grid: '#191919',
  gridMajor: '#242424',
  ash: '#2b2b2b',
  smoke: '#7a7a7a',
};

// Chaque graisse est déclarée sous son propre nom de famille : le canvas ne doit
// jamais être tenté de fabriquer un faux gras à partir de la régulière.
export const DISPLAY = '"Silkscreen Bold", monospace';
export const PIXEL = '"Silkscreen", monospace';
export const DATA = '"Sometype Mono Bold", ui-monospace, monospace';
export const DATA_LIGHT = '"Sometype Mono", ui-monospace, monospace';

/** Silkscreen est dessinée sur une grille de 8 : hors multiple, les pixels
 *  des lettres n'ont plus tous la même largeur. Sometype Mono, elle, est une
 *  police à contours : n'importe quelle taille lui va. */
export const GRID = 8;
const isPixelFont = (font) => font.includes('Silkscreen');
export const snap = (size, font = DISPLAY) => (isPixelFont(font)
  ? Math.max(GRID, Math.round(size / GRID) * GRID)
  : Math.max(8, Math.round(size)));

/* ------------------------------------------------------------------ */
/* aléa reproductible                                                  */
/* ------------------------------------------------------------------ */

/**
 * Un wallet donne toujours la même planche : deux scans du même compte
 * produisent la même image, seuls les chiffres bougent.
 */
export function seedFrom(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 0x100000000;
  };
}

/* ------------------------------------------------------------------ */
/* dessin                                                              */
/* ------------------------------------------------------------------ */

/**
 * Le rectangle du sticker : coins coupés en escalier de deux marches. De loin
 * ça lit comme un arrondi, de près c'est un arrondi dessiné sur une grille —
 * la seule façon d'arrondir un coin qui ne trahisse pas la police à pixels.
 */
function pixelRect(ctx, x, y, w, h, step) {
  const s = Math.max(1, Math.round(step));
  const r = x + w;
  const b = y + h;
  ctx.beginPath();
  ctx.moveTo(x + 2 * s, y);
  ctx.lineTo(r - 2 * s, y);
  ctx.lineTo(r - 2 * s, y + s); ctx.lineTo(r - s, y + s);
  ctx.lineTo(r - s, y + 2 * s); ctx.lineTo(r, y + 2 * s);
  ctx.lineTo(r, b - 2 * s);
  ctx.lineTo(r - s, b - 2 * s); ctx.lineTo(r - s, b - s);
  ctx.lineTo(r - 2 * s, b - s); ctx.lineTo(r - 2 * s, b);
  ctx.lineTo(x + 2 * s, b);
  ctx.lineTo(x + 2 * s, b - s); ctx.lineTo(x + s, b - s);
  ctx.lineTo(x + s, b - 2 * s); ctx.lineTo(x, b - 2 * s);
  ctx.lineTo(x, y + 2 * s);
  ctx.lineTo(x + s, y + 2 * s); ctx.lineTo(x + s, y + s);
  ctx.lineTo(x + 2 * s, y + s); ctx.lineTo(x + 2 * s, y);
  ctx.closePath();
}

/** Largeur et hauteur de capitale d'un texte, à une taille donnée. */
export function measure(ctx, text, size, font = DISPLAY) {
  ctx.font = `${size}px ${font}`;
  const m = ctx.measureText(text);
  return {
    width: m.width,
    cap: (m.actualBoundingBoxAscent || size * 0.70) + (m.actualBoundingBoxDescent || 0),
    ascent: m.actualBoundingBoxAscent || size * 0.70,
    font,
  };
}

/**
 * Pose un sticker.
 *
 * `style` :
 *   band  — plaque de couleur pleine, mot en négatif dedans
 *   cut   — lettres découpées : gros contour, pas de plaque
 *   ghost — les mêmes lettres, en gris sombre, pour remplir le fond
 *
 * Retourne la boîte occupée (non tournée), utile pour empiler.
 */
export function sticker(ctx, opts) {
  const {
    text, x, y, angle = 0, style = 'band',
    fill = INK.lime, ink = INK.black, edge = null,
    font = DISPLAY, lift = true,
  } = opts;

  const size = snap(opts.size, font);
  const padX = opts.padX ?? size * 0.45;
  const padY = opts.padY ?? size * 0.35;

  const m = measure(ctx, text, size, font);
  const w = m.width + padX * 2;
  const h = m.cap + padY * 2;
  // Trois mesures distinctes, toutes en pixels entiers : la coupe des coins
  // doit rester discrète là où l'ombre et le contour doivent porter. Sometype
  // Mono étant plus fine que Silkscreen, son contour est un cran plus épais.
  const corner = Math.max(3, Math.round(size / 14));
  const drop = Math.max(3, Math.round(size / 9));
  const edge_w = Math.max(3, Math.round(size * (isPixelFont(font) ? 0.22 : 0.26)));

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate((angle * Math.PI) / 180);
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Jointures carrées pour les lettres à pixels, dont un contour arrondi
  // raboterait les angles droits ; arrondies pour Sometype Mono, qui a des
  // pointes que le miter ferait fuser.
  ctx.lineJoin = isPixelFont(font) ? 'miter' : 'round';
  ctx.miterLimit = 8;

  if (style === 'band') {
    // Ombre portée franche, décalée d'un multiple de la grille.
    if (lift) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      pixelRect(ctx, -w / 2 + drop, -h / 2 + drop, w, h, corner);
      ctx.fill();
    }
    ctx.fillStyle = fill;
    pixelRect(ctx, -w / 2, -h / 2, w, h, corner);
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(2, Math.round(corner / 2));
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    ctx.fillText(text, 0, 0);
  } else {
    // Lettres découpées : un gros contour tient lieu de bord de vinyle.
    const border = style === 'ghost' ? INK.ash : (edge || INK.bone);
    const body = style === 'ghost' ? INK.paper : fill;
    if (lift && style !== 'ghost') {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = edge_w * 1.2;
      ctx.strokeText(text, drop, drop);
    }
    ctx.strokeStyle = border;
    ctx.lineWidth = edge_w;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = body;
    ctx.fillText(text, 0, 0);
  }

  ctx.restore();
  return { w, h };
}

/**
 * Un sticker qui porte plusieurs lignes sur une seule découpe — l'étiquette et
 * les chiffres qu'elle annonce ne sont plus deux objets posés l'un près de
 * l'autre, mais un seul.
 *
 * `lines` : [{ text, size, font, ink, gap }]. `gap` est l'air au-dessus de la
 * ligne, en pixels.
 */
export function stack(ctx, opts) {
  const {
    lines, x, y, angle = 0, fill = INK.bone, ink = INK.black,
    edge = null, lift = true, align = 'center',
  } = opts;

  // Mesure d'abord, dessine ensuite : la plaque doit contenir la plus large.
  const laid = lines.map((line) => {
    const font = line.font ?? DISPLAY;
    const size = snap(line.size, font);
    return { ...line, font, size, m: measure(ctx, line.text, size, font) };
  });

  const padX = opts.padX ?? 48;
  const padY = opts.padY ?? 40;
  const lead = opts.lead ?? 20;
  const inner = Math.max(...laid.map((l) => l.m.width));
  const tall = laid.reduce((t, l, i) => t + l.m.cap + (i ? (l.gap ?? lead) : 0), 0);
  const w = inner + padX * 2;
  const h = tall + padY * 2;
  const corner = 10;
  const drop = 14;

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate((angle * Math.PI) / 180);

  if (lift) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    pixelRect(ctx, -w / 2 + drop, -h / 2 + drop, w, h, corner);
    ctx.fill();
  }
  ctx.fillStyle = fill;
  pixelRect(ctx, -w / 2, -h / 2, w, h, corner);
  ctx.fill();
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }

  ctx.textBaseline = 'alphabetic';
  let cursor = -h / 2 + padY;
  for (const [i, line] of laid.entries()) {
    if (i) cursor += line.gap ?? lead;
    ctx.font = `${line.size}px ${line.font}`;
    ctx.fillStyle = line.ink ?? ink;
    ctx.textAlign = align === 'left' ? 'left' : 'center';
    const at = align === 'left' ? -inner / 2 : 0;
    ctx.fillText(line.text, at, cursor + line.m.ascent);
    cursor += line.m.cap;
  }
  ctx.restore();
  return { w, h };
}

/**
 * Le portrait 8×8 du Friend, posé comme un sticker carré : marge blanche,
 * pixels nets, rotation. `pixels` est le masque 64 bits du contrat.
 */
export function pixelSticker(ctx, { pixels, x, y, size, angle = 0, fill = INK.bone, back = INK.black }) {
  const cell = Math.round(size / 8);          // un pixel de l'œuvre, entier
  const side = cell * 8;
  const pad = cell;
  const box = side + pad * 2;
  const step = Math.max(2, Math.round(cell / 2));   // coupe < marge : rien ne déborde

  // L'œuvre est peinte à sa taille native — 8 × 8 — puis agrandie au plus
  // proche voisin. Soixante-quatre `fillRect` sous rotation laisseraient un
  // liseré à chaque jointure : l'anticrénelage des bords partagés ne se
  // recouvre jamais tout à fait. Une seule image, aucune jointure.
  const art = document.createElement('canvas');
  art.width = art.height = 8;
  const actx = art.getContext('2d');
  actx.fillStyle = back;
  actx.fillRect(0, 0, 8, 8);
  actx.fillStyle = fill;
  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 8; px++) {
      if ((pixels >> BigInt(py * 8 + px)) & 1n) actx.fillRect(px, py, 1, 1);
    }
  }

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate((angle * Math.PI) / 180);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  pixelRect(ctx, -box / 2 + cell, -box / 2 + cell, box, box, step);
  ctx.fill();

  ctx.fillStyle = fill;                        // le bord de découpe
  pixelRect(ctx, -box / 2, -box / 2, box, box, step);
  ctx.fill();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art, -side / 2, -side / 2, side, side);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* fond                                                                */
/* ------------------------------------------------------------------ */

/**
 * Le fond : du papier millimétré à pixels. Un point par intersection, un point
 * plus clair toutes les quatre — assez pour donner une matière et rappeler la
 * grille des sprites, assez discret pour ne rien disputer aux chiffres.
 */
export function pixelGrid(ctx, width, height, { pitch = 27, dot = 3 } = {}) {
  ctx.save();
  for (let gy = 0, row = 0; gy < height + pitch; gy += pitch, row++) {
    for (let gx = 0, col = 0; gx < width + pitch; gx += pitch, col++) {
      const major = row % 4 === 0 && col % 4 === 0;
      ctx.fillStyle = major ? INK.gridMajor : INK.grid;
      const d = major ? dot + 2 : dot;
      ctx.fillRect(gx - d / 2, gy - d / 2, d, d);
    }
  }
  ctx.restore();
}

/* Des glyphes dessinés à la main, en pixels — la police ne donnerait pas le
   même dollar carré que les sprites de la collection. */
export const GLYPHS = {
  dollar: [
    '..#..',
    '.###.',
    '#.#.#',
    '#.#..',
    '.###.',
    '..#.#',
    '#.#.#',
    '.###.',
    '..#..',
  ],
};

/** Pose un glyphe pixel. `cell` est la taille d'un pixel du dessin. */
export function pixelGlyph(ctx, name, { x, y, cell, color = INK.bone, angle = 0 }) {
  const rows = GLYPHS[name];
  if (!rows) return;
  const w = rows[0].length * cell;
  const h = rows.length * cell;
  const c = Math.round(cell);

  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate((angle * Math.PI) / 180);
  ctx.fillStyle = color;
  rows.forEach((row, ry) => {
    [...row].forEach((px, rx) => {
      if (px === '#') ctx.fillRect(-w / 2 + rx * c, -h / 2 + ry * c, c, c);
    });
  });
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* matière                                                             */
/* ------------------------------------------------------------------ */

/** Grain de papier : casse le plat du noir et du canvas. */
export function grain(ctx, width, height, amount = 0.055) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 160;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
