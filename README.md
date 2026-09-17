# Rare Friends · Rewards Card

Paste a wallet, get a shareable card of what its Rare Friends earn.

```bash
npm start
```

Then <http://localhost:5173>. No dependencies, no build: HTML + CSS + ES modules.
`?wallet=0x…` opens a card directly — that is the link you share.

---

## Where the numbers come from

Everything is read live from the chain. No backend, no API key, no signature,
no transaction. The contract addresses are published by
`rarefriends.com/api/postlaunch/config` and frozen into
[`src/pnl.js`](src/pnl.js) so the page stays purely static.

The card carries four numbers:

| | source |
|---|---|
| **To claim** | `earned(asset, collection, tokenId)`, in WETH and RF |
| **Pending** | everything not yet paid out × the weight share: the funded pot `streams(asset).pending`, plus the tail of the running stream, `rate` × (`finish` − now) |
| **% of weight** | the sum of its `positions()` ÷ `totalWeight()` |
| **APY** | (what the current cycle has paid out + the whole queue) ÷ what was paid to activate, annualised over one `DURATION` |

The readout below the card restates the same figures in words, plus the ones
that have no place on the image: what was staked, the daily rate, what has
already been claimed.

Dollar amounts come from two public sources: the RF price from `slot0` of the
Uniswap v4 pool, read out of the `PoolManager`; the ETH price from CoinGecko.
If either is missing the card falls back to RF amounts — it never guesses a
price.

### Four things to keep in mind

- **The APY is the generous reading.** It treats the entire undistributed queue
  as if it landed in one seven-day cycle, then annualises that. It is the figure
  rare-friends-cards.vercel.app shows and the one the community compares
  against, which is why the card carries it. The sober reading — the current
  drip rate annualised, several times smaller — sits in the readout under the
  card.
- Either way the stake is converted at *today's* RF price. It is a snapshot,
  not a forecast and not accounting.
- **Pending is not yours yet.** It is what has been funded and not paid out, pro
  rata of weight — and the total weight moves.
- The readout counts the whole history of the Friends held **today**, including
  what a previous owner may have claimed. That is the protocol's own model:
  rewards belong to the Friend, not to the address.

### On the weight denominator

`rare-friends-cards.vercel.app` divides by a total weight of about 860M, taken
from `rarefriends.com`'s own metrics. The contract divides by `totalWeight()`,
about 956M. Sampling `streams(RF).rewardPerWeight` 31 seconds apart and solving
`rate × dt ÷ Δ(rewardPerWeight)` gives **956,451,489** — the contract's figure.
This card uses that one, so its pending and APY read roughly 11% below the
reference site's.

### The public node is not generous

Past a certain rate it answers with an error whose CORS headers are malformed,
which the browser turns into a silent `Failed to fetch`. Reads are therefore
batched, sequential and spaced out — a wallet with sixty Friends takes about
twenty seconds.

---

## The card

Painted on a 1080 × 1350 canvas by [`src/sticker.js`](src/sticker.js) (the
primitives) and [`src/pnlcard.js`](src/pnlcard.js) (the layout). The PNG comes
straight out of the canvas: no screenshot, no image server. The draw is
deterministic — the same address always gets the same sheet, only the figures
move.

**Three inks, no more**: black, white, fluo green. Green points at one thing
only — what there is to take. Everything else is ranked by inversion (white
plate with black text against black plate with a white outline) and by size.

**The ground is pixel graph paper**: one dot per intersection, a brighter one
every four, plus a few hand-drawn pixel dollar signs in the gutters. Nothing
sits behind a figure.

**Three tight blocks**, separated by air rather than by rules: the Friend at
full size, what there is to claim, at what rate. The "to claim" label and its
two amounts share **a single die-cut** (`stack()`) — they do not have to look
for each other.

**The full address never appears on the card**, only the short `0X5F08…2C74`
chip in the header. The image is made to be shared; printing the whole address
would only tie it to the wallet forever. The card's footer carries the block,
the date and the non-affiliation notice.

### Two typographic voices

Both are the ones rarefriends.com uses itself, bundled in [`fonts/`](fonts)
under the OFL:

- **Silkscreen** shouts — the Friend's number and the amounts. It dictates the
  rest of the drawing: sticker corners stepped rather than rounded, square
  miter joins, sizes snapped to a grid of 8 pixels (off that multiple, the
  letters' own pixels stop being equal widths).
- **Sometype Mono** states — title, labels, queue, weight share, APY, footer.
  Round joins, any size.

Each weight is declared under its own family name (`Silkscreen Bold`,
`Sometype Mono Bold`): otherwise the canvas fabricates a fake bold from the
regular, which on a pixel font gives mush.

The card's dollar sign is hand-drawn in pixels (`GLYPHS.dollar`) rather than
taken from the font — Sometype Mono's would clash with the sprites.

The portrait is painted offscreen at its native 8 × 8 and then scaled up
nearest-neighbour. Drawing sixty-four squares under rotation would leave a
seam at every join: the antialiasing of two shared edges never quite overlaps.

---

## Files

| | |
|---|---|
| [`src/chain.js`](src/chain.js) | the RPC layer, and decoding the on-chain artwork |
| [`src/pnl.js`](src/pnl.js) | reading the balance sheet on-chain, the RF price |
| [`src/sticker.js`](src/sticker.js) | stickers, pixel grid, glyphs, grain |
| [`src/pnlcard.js`](src/pnlcard.js) | the layout, from figures to sheet |
| [`src/card.js`](src/card.js) · [`index.html`](index.html) | the page, PNG export |
| [`fonts/`](fonts) | Silkscreen and Sometype Mono, bundled (OFL) |
| [`server.mjs`](server.mjs) | static server for local dev, zero dependencies |

The site is purely static: any file host will do. `server.mjs` only exists
because ES modules will not load over `file://`.

---

## Not affiliated

An independent project, with no connection to the creators of Rare Friends. It
reads public data on the chain and never asks for a signature or a transaction.
