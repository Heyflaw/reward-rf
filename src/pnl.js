// Ce que ton wallet a mis dans l'économie Rare Friends, et ce qu'il en a sorti.
//
// Tout se lit sur la chaîne, en public : positions d'activation, récompenses
// acquises, débit du stream, prix du pool. Aucune clé d'API, aucune signature,
// aucun backend — comme le reste du projet.

import { callBatch, getLogs, blockNumber, pad32, shortAddress } from './chain.js';

/* Adresses publiées par rarefriends.com/api/postlaunch/config. */
export const CONTRACTS = {
  RF: '0x0779369854d3ecdea927206718ffd7730c67b71f',
  WETH: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  Genesis: '0x116eaa62241751e0c98da43d458600c6c17cd361',
  Generations: '0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d',
  ActivationManager: '0xd4a35e11318e3679168d409184b788bcf9f283ac',
  PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
};

/* Bloc de déploiement : inutile de remonter plus haut pour les logs du manager. */
const DEPLOY_BLOCK = 62624268;

/* Sélecteurs — 4 premiers octets de keccak256 de la signature. */
const SEL = {
  balanceOf: '0x70a08231',            // balanceOf(address)
  ownerOf: '0x6352211e',              // ownerOf(uint256)
  positions: '0xc1be6677',            // positions(address,uint256)
  earned: '0x14bc8237',               // earned(address,address,uint256)
  totalWeight: '0x96c82e57',          // totalWeight()
  streams: '0x83699275',              // streams(address)
  extsload: '0x1e2eaeaf',             // extsload(bytes32)
};

/* Signatures d'événements — keccak256 complet. */
const TOPIC = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  activated: '0x73d8960dbd97b5072f21b10dfc0cc90eddfd2e339f97ff3949c84aa5c3efa861',
  promoted: '0xf9f5edd116a4231169d7148c628c7b20dbac59d5d20766ac3ee7c08fb8e5f3f3',
  claimed: '0x240ce5314564d91727709af90e37c14263bd65a1657bf6504f39bc491a4bd9fc',
};

// Emplacement de `slot0` pour la pool RF/WETH dans le PoolManager Uniswap v4 :
// keccak256(poolId ++ uint256(6)), avec poolId = Hook.poolId() et 6 = slot de
// la mapping `_pools`. La pool est fixe, la valeur aussi — on la fige plutôt que
// d'embarquer un keccak256 pour un seul hachage.
const POOL_SLOT0 = '0x7acf8d4579fa2a5f35bedf50045a1b61b44a70a1ff8937f3a2b0e7ae3df72ff3';
// wethIsCurrency0() renvoie false : WETH est currency1, donc sqrtPrice² = WETH par RF.
const WETH_IS_CURRENCY0 = false;

const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

/* ------------------------------------------------------------------ */
/* décodage                                                            */
/* ------------------------------------------------------------------ */

const arg = (value) => pad32(typeof value === 'bigint' ? value.toString(16) : String(value));
const words = (hex) => (hex || '0x').slice(2).match(/.{64}/g)?.map((w) => BigInt('0x' + w)) ?? [];
const big = (hex) => (hex && hex !== '0x' ? BigInt(hex) : 0n);

/** wei → nombre flottant. La précision d'un double suffit largement à l'affichage. */
const units = (wei, decimals = 18) => Number(wei) / 10 ** decimals;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `callBatch` par paquets, avec une respiration entre deux envois.
 *
 * Le nœud public ne se contente pas de répondre 429 quand on le presse : sa
 * réponse d'erreur porte deux en-têtes `Access-Control-Allow-Origin`, que le
 * navigateur refuse. Le code ne voit donc qu'un « Failed to fetch » opaque —
 * d'où les paquets modestes et l'attente entre chacun.
 */
async function chunkedCalls(calls, onProgress = () => {}, chunk = 40) {
  const out = [];
  for (let i = 0; i < calls.length; i += chunk) {
    out.push(...await callBatch(calls.slice(i, i + chunk)));
    onProgress(Math.min(i + chunk, calls.length), calls.length);
    if (i + chunk < calls.length) await sleep(250);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* possession                                                          */
/* ------------------------------------------------------------------ */

/**
 * Aucune des deux collections n'implémente ERC721Enumerable : on relit les
 * `Transfer` reçus par l'adresse, puis on revérifie chaque `ownerOf`.
 */
async function ownedIn(collection, address) {
  const logs = await getLogs({
    address: collection,
    fromBlock: '0x0',
    toBlock: 'latest',
    topics: [TOPIC.transfer, null, '0x' + pad32(address)],
  });
  const seen = [...new Set(logs.map((l) => BigInt(l.topics[3])))];
  if (!seen.length) return [];

  const out = await chunkedCalls(seen.map((id) => ({ to: collection, data: SEL.ownerOf + arg(id) })));
  const owned = seen.filter((_, k) => out[k]
    && '0x' + out[k].slice(26).toLowerCase() === address.toLowerCase());
  return owned.sort((a, b) => Number(a - b));
}

/* ------------------------------------------------------------------ */
/* prix                                                                */
/* ------------------------------------------------------------------ */

/**
 * Prix du RF en WETH, lu directement dans la pool Uniswap v4 (slot0), puis
 * converti en dollars via CoinGecko. Les deux sources peuvent manquer : la
 * carte sait se passer des montants en dollars.
 */
async function readPrices(slot0Raw) {
  const prices = { wethPerRf: null, ethUsd: null, rfUsd: null };

  if (slot0Raw && slot0Raw !== '0x') {
    const sqrtPriceX96 = big(slot0Raw) & ((1n << 160n) - 1n);
    if (sqrtPriceX96 > 0n) {
      const ratio = Number(sqrtPriceX96) ** 2 / 2 ** 192;   // currency1 par currency0
      prices.wethPerRf = WETH_IS_CURRENCY0 ? 1 / ratio : ratio;
    }
  }

  try {
    const res = await fetch(COINGECKO);
    if (res.ok) prices.ethUsd = (await res.json())?.ethereum?.usd ?? null;
  } catch { /* hors ligne, ou CoinGecko qui rationne : on restera en RF */ }

  if (prices.wethPerRf && prices.ethUsd) prices.rfUsd = prices.wethPerRf * prices.ethUsd;
  return prices;
}

/* ------------------------------------------------------------------ */
/* scan                                                                */
/* ------------------------------------------------------------------ */

/**
 * Lit tout ce qui concerne une adresse et en tire un bilan.
 * Une demi-douzaine d'allers-retours pour un wallet ordinaire ; les appels
 * par Friend sont groupés, donc un gros collectionneur en coûte quelques-uns
 * de plus, pas un par token.
 */
export async function scanWallet(address, { onProgress = () => {} } = {}) {
  const addr = address.trim();
  const topicAddr = '0x' + pad32(addr);
  const AM = CONTRACTS.ActivationManager;
  const fromBlock = '0x' + DEPLOY_BLOCK.toString(16);

  onProgress('Recherche des Friends…');
  // En série, pas en parallèle : deux rafales simultanées suffisent à faire
  // basculer le nœud public en mode refus.
  const genesisIds = await ownedIn(CONTRACTS.Genesis, addr);
  const generationsIds = await ownedIn(CONTRACTS.Generations, addr);

  const friends = [
    ...genesisIds.map((id) => ({ id, collection: 'Genesis', address: CONTRACTS.Genesis })),
    ...generationsIds.map((id) => ({ id, collection: 'Generations', address: CONTRACTS.Generations })),
  ];

  onProgress(`${friends.length} Friend${friends.length > 1 ? 's' : ''} — lecture des positions…`);

  // Positions + récompenses de chaque Friend, puis l'état global (poids total,
  // streams, soldes, prix). Groupé, mais par paquets : un collectionneur à
  // soixante Friends ferait sinon une requête de deux cents appels, que le
  // nœud public refuse.
  const calls = [];
  for (const f of friends) {
    calls.push({ to: AM, data: SEL.positions + arg(f.address) + arg(f.id) });
    calls.push({ to: AM, data: SEL.earned + arg(CONTRACTS.RF) + arg(f.address) + arg(f.id) });
    calls.push({ to: AM, data: SEL.earned + arg(CONTRACTS.WETH) + arg(f.address) + arg(f.id) });
  }
  const tail = [
    { to: AM, data: SEL.totalWeight },
    { to: AM, data: SEL.streams + arg(CONTRACTS.RF) },
    { to: AM, data: SEL.streams + arg(CONTRACTS.WETH) },
    { to: CONTRACTS.RF, data: SEL.balanceOf + arg(addr) },
    { to: CONTRACTS.WETH, data: SEL.balanceOf + arg(addr) },
    { to: CONTRACTS.PoolManager, data: SEL.extsload + POOL_SLOT0.slice(2) },
  ];
  const results = await chunkedCalls([...calls, ...tail], (done, total) => {
    onProgress(`Lecture des positions ${done}/${total}…`);
  });

  let cursor = 0;
  let weight = 0n;
  let earnedRf = 0n;
  let earnedWeth = 0n;
  for (const f of friends) {
    const pos = results[cursor++];
    f.tier = pos ? Number(BigInt('0x' + pos.slice(2, 66))) : 0;
    f.weight = pos ? BigInt('0x' + pos.slice(66, 130)) : 0n;
    f.earnedRf = big(results[cursor++]);
    f.earnedWeth = big(results[cursor++]);
    f.active = f.weight > 0n;
    weight += f.weight;
    earnedRf += f.earnedRf;
    earnedWeth += f.earnedWeth;
  }
  const totalWeight = big(results[cursor++]);
  const streamRf = words(results[cursor++]);     // pending, rate, finish, lastUpdate, …
  const streamWeth = words(results[cursor++]);
  const bagRf = big(results[cursor++]);
  const bagWeth = big(results[cursor++]);
  const slot0 = results[cursor++];

  onProgress('Historique des paiements…');

  // Ce qui a été payé pour activer : l'adresse est le 3ᵉ sujet indexé.
  const activations = await getLogs({
    address: AM, fromBlock, toBlock: 'latest',
    topics: [TOPIC.activated, null, null, topicAddr],
  });

  let paidRf = 0n;
  for (const log of activations) paidRf += words(log.data)[2];   // tier, weight, payment

  // Ce qui a déjà été réclamé. Claimed(asset, collection, tokenId, …) : les
  // trois premiers champs sont indexés, on interroge donc collection par
  // collection en passant la liste des tokens — balayer tous les Claimed de la
  // chaîne ferait expirer la requête.
  //
  // On compte tout l'historique des Friends détenus aujourd'hui, y compris ce
  // qu'un propriétaire précédent aurait réclamé. C'est le modèle du protocole :
  // les récompenses appartiennent au Friend, pas à l'adresse.
  const byCollection = [
    [CONTRACTS.Genesis, genesisIds],
    [CONTRACTS.Generations, generationsIds],
  ].filter(([, ids]) => ids.length);

  let claimedRf = 0n;
  let claimedWeth = 0n;
  let claimsKnown = true;
  try {
    for (const [asset, isRf] of [[CONTRACTS.RF, true], [CONTRACTS.WETH, false]]) {
      for (const [collection, ids] of byCollection) {
        // Le filtre par sujet accepte une liste de valeurs ; on la coupe pour
        // ne pas envoyer soixante tokens d'un coup.
        for (let i = 0; i < ids.length; i += 25) {
          const logs = await getLogs({
            address: AM, fromBlock, toBlock: 'latest',
            topics: [
              TOPIC.claimed,
              '0x' + pad32(asset),
              '0x' + pad32(collection),
              ids.slice(i, i + 25).map((id) => '0x' + arg(id)),
            ],
          });
          const sum = logs.reduce((t, log) => t + words(log.data)[1], 0n);   // account, amount
          if (isRf) claimedRf += sum; else claimedWeth += sum;
        }
      }
    }
  } catch {
    // Le nœud public a refusé l'historique : on le dit plutôt que d'afficher
    // un « rien encaissé » qui serait peut-être faux.
    claimsKnown = false;
  }

  onProgress('Prix du RF…');
  const prices = await readPrices(slot0);
  const block = await blockNumber();

  return assemble({
    address: addr, block, friends, weight, totalWeight,
    streamRf, streamWeth, bagRf, bagWeth, prices,
    earnedRf, earnedWeth, claimedRf, claimedWeth, claimsKnown, paidRf,
  });
}

/* ------------------------------------------------------------------ */
/* bilan                                                               */
/* ------------------------------------------------------------------ */

function assemble(raw) {
  const share = raw.totalWeight > 0n ? Number(raw.weight) / Number(raw.totalWeight) : 0;
  const now = Math.floor(Date.now() / 1000);

  // Le stream verse `rate` par seconde tant que `finish` n'est pas passé ;
  // la part d'un Friend est proportionnelle à son poids.
  const flow = (stream) => {
    const [, rate, finish] = stream;
    if (!rate || Number(finish) <= now) return 0;
    return units(rate) * 86400 * share;
  };
  const perDay = { rf: flow(raw.streamRf), weth: flow(raw.streamWeth) };

  // `streams(asset).pending` : ce qui est déjà financé mais pas encore versé.
  // Ce n'est pas acquis — c'est la file d'attente, au prorata du poids.
  const queued = (stream) => units(stream[0]) * share;
  const pending = { rf: queued(raw.streamRf), weth: queued(raw.streamWeth) };

  const paid = { rf: units(raw.paidRf) };
  const earned = {
    rf: units(raw.earnedRf) + units(raw.claimedRf),
    weth: units(raw.earnedWeth) + units(raw.claimedWeth),
  };
  const claimable = { rf: units(raw.earnedRf), weth: units(raw.earnedWeth) };
  const claimed = { rf: units(raw.claimedRf), weth: units(raw.claimedWeth) };

  const { rfUsd, ethUsd } = raw.prices;
  const usd = rfUsd && ethUsd ? {
    paid: paid.rf * rfUsd,
    earned: earned.rf * rfUsd + earned.weth * ethUsd,
    pending: pending.rf * rfUsd + pending.weth * ethUsd,
    perDay: perDay.rf * rfUsd + perDay.weth * ethUsd,
    bag: units(raw.bagRf) * rfUsd + units(raw.bagWeth) * ethUsd,
  } : null;
  if (usd) {
    usd.pnl = usd.earned - usd.paid;
    usd.ratio = usd.paid > 0 ? usd.earned / usd.paid : null;
  }

  // Rentabilité : jours restants pour récupérer la mise, au débit actuel.
  // En dollars quand on a les prix, en RF sinon — ce ne sont pas les mêmes
  // chiffres, le WETH pesant beaucoup plus lourd que le RF dans les gains.
  const dailyUsd = usd?.perDay ?? 0;
  const paybackDays = usd && dailyUsd > 0 ? Math.max(0, (usd.paid - usd.earned) / dailyUsd) : null;
  const paybackDaysRf = perDay.rf > 0 ? Math.max(0, (paid.rf - earned.rf) / perDay.rf) : null;
  const apy = usd && usd.paid > 0 ? (dailyUsd * 365) / usd.paid * 100 : null;

  return {
    address: raw.address,
    short: shortAddress(raw.address),
    block: raw.block,
    at: new Date(),
    friends: raw.friends.map((f) => ({
      id: Number(f.id),
      collection: f.collection,
      tier: f.tier,
      active: f.active,
      weight: units(f.weight),
      earnedRf: units(f.earnedRf),
      earnedWeth: units(f.earnedWeth),
    })),
    activeCount: raw.friends.filter((f) => f.active).length,
    weight: units(raw.weight),
    share,
    paid, earned, claimable, claimed, pending,
    claimsKnown: raw.claimsKnown, perDay, usd, prices: raw.prices,
    bag: { rf: units(raw.bagRf), weth: units(raw.bagWeth) },
    paybackDays, paybackDaysRf, apy,
  };
}
