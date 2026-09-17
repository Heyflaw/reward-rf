// Accès à la chaîne : la couche RPC, et le décodage de l'œuvre on-chain.
// Tout est public : aucune clé d'API, aucune signature, aucune transaction.

export const CONTRACT = '0x116eaa62241751e0c98da43d458600c6c17cd361';
export const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';

const SEL_TOKEN_URI = '0xc87b56dd';

const uriCache = new Map();

/* ------------------------------------------------------------------ */
/* RPC                                                                 */
/* ------------------------------------------------------------------ */

let reqId = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RateLimited extends Error {
  constructor(retryAfter) {
    super('The public RPC is busy right now. Try again in a few seconds.');
    this.retryAfter = retryAfter;
  }
}

/**
 * Le RPC public est limité en débit : on réessaie en doublant l'attente,
 * en respectant l'en-tête Retry-After quand il est fourni.
 */
async function post(body, attempts = 6) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        throw new RateLimited(Number(res.headers.get('retry-after')) * 1000 || 0);
      }
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const json = await res.json();
      // Une requête groupée doit répondre par un tableau ; sinon c'est un refus global.
      if (Array.isArray(body) && !Array.isArray(json)) {
        throw new Error(json?.error?.message || 'unexpected RPC response');
      }
      return json;
    } catch (err) {
      lastError = err;
      if (i === attempts - 1) break;
      const backoff = Math.min(6000, 500 * 2 ** i);
      await sleep(Math.max(backoff, err.retryAfter || 0));
    }
  }
  throw lastError;
}

async function rpc(method, params) {
  const out = await post({ jsonrpc: '2.0', id: ++reqId, method, params });
  if (out.error) throw new Error(out.error.message || 'RPC error');
  return out.result;
}

// Un seul aller-retour HTTP pour N eth_call. L'id vaut l'index : le serveur peut
// renvoyer les réponses dans le désordre, ou en oublier, sans décaler la liste.
async function ethCallBatch(datas) {
  if (!datas.length) return [];
  const out = await post(
    datas.map((data, index) => ({
      jsonrpc: '2.0',
      id: index,
      method: 'eth_call',
      params: [{ to: CONTRACT, data }, 'latest'],
    })),
  );
  const byIndex = new Map(out.map((r) => [r.id, r]));
  return datas.map((_, index) => {
    const r = byIndex.get(index);
    return r && !r.error ? r.result : null;
  });
}

/**
 * Même chose, mais pour des contrats quelconques : `calls` est une liste de
 * `{ to, data }`. Utilisé par la carte de PNL, qui interroge cinq contrats.
 */
export async function callBatch(calls) {
  if (!calls.length) return [];
  const out = await post(
    calls.map((c, index) => ({
      jsonrpc: '2.0',
      id: index,
      method: 'eth_call',
      params: [{ to: c.to, data: c.data }, 'latest'],
    })),
  );
  const byIndex = new Map(out.map((r) => [r.id, r]));
  return calls.map((_, index) => {
    const r = byIndex.get(index);
    return r && !r.error ? r.result : null;
  });
}

/** `eth_getLogs` brut, avec la même politique de réessai. */
export const getLogs = (filter) => rpc('eth_getLogs', [filter]);

/** Numéro du bloc courant (affiché sur la carte : la donnée est datée). */
export const blockNumber = async () => parseInt(await rpc('eth_blockNumber', []), 16);

/* ------------------------------------------------------------------ */
/* helpers ABI                                                         */
/* ------------------------------------------------------------------ */

export const pad32 = (hex) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const tokenArg = (id) => pad32(Number(id).toString(16));

function decodeAbiString(hex) {
  if (!hex || hex === '0x') return null;
  const body = hex.slice(2);
  const offset = parseInt(body.slice(0, 64), 16) * 2;
  const len = parseInt(body.slice(offset, offset + 64), 16);
  const chars = body.slice(offset + 64, offset + 64 + len * 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(chars.substr(i * 2, 2), 16);
  return new TextDecoder().decode(bytes);
}

export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test((value || '').trim());
}

export const shortAddress = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/* ------------------------------------------------------------------ */
/* l'œuvre                                                             */
/* ------------------------------------------------------------------ */

/**
 * La collection Genesis est entièrement on-chain : le `tokenURI` est un JSON
 * en base64 qui porte l'art sous forme de masque 64 bits, un bit par pixel
 * d'une grille 8 × 8. La carte dessine ce masque tel quel.
 */
function parseTokenUri(id, uri) {
  const payload = uri.slice(uri.indexOf(',') + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const json = JSON.parse(new TextDecoder().decode(bytes));
  const props = json.properties || {};
  const attributes = {};
  for (const a of json.attributes || []) attributes[a.trait_type] = a.value;
  return {
    id: Number(id),
    name: json.name || `Genesis #${id}`,
    attributes,
    pixels: BigInt(props.pixels ?? '0x0'),
  };
}

/** Charge les métadonnées d'une liste d'ids (batché + mis en cache). */
export async function loadFriends(ids, { chunk = 20, onProgress } = {}) {
  const wanted = ids.map(Number);
  const missing = wanted.filter((id) => !uriCache.has(id));
  let done = wanted.length - missing.length;

  for (let i = 0; i < missing.length; i += chunk) {
    const slice = missing.slice(i, i + chunk);
    const results = await ethCallBatch(slice.map((id) => SEL_TOKEN_URI + tokenArg(id)));
    slice.forEach((id, k) => {
      const uri = decodeAbiString(results[k]);
      if (uri) {
        try { uriCache.set(id, parseTokenUri(id, uri)); } catch { /* token illisible */ }
      }
    });
    done += slice.length;
    onProgress?.(done, wanted.length);
    if (i + chunk < missing.length) await sleep(120);   // on ménage le RPC public
  }
  return wanted.map((id) => uriCache.get(id)).filter(Boolean);
}
