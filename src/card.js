// Page de la carte : wallet → lecture on-chain → planche → PNG.

import { isAddress, loadFriends } from './chain.js';
import { scanWallet } from './pnl.js';
import { CARD_H, CARD_W, cardSummary, paintCard } from './pnlcard.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#card');

let current = null;      // { report, friend }

function say(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('err', isError);
}

/* Le canvas ne sait pas attendre une webfont : il dessinerait en Arial.
   On force le chargement des deux familles avant la première peinture. */
const fontsReady = Promise.all([
  document.fonts.load('400 160px "Silkscreen Bold"'),
  document.fonts.load('400 16px "Silkscreen"'),
  document.fonts.load('400 80px "Sometype Mono Bold"'),
  document.fonts.load('400 16px "Sometype Mono"'),
]).catch(() => { /* police indisponible : les mesures s'adapteront */ });

/* Le nœud public répond par catégories ; on reformule les refus qu'on
   rencontre vraiment plutôt que d'afficher le message brut. */
function explain(err) {
  const raw = String(err?.message || err);
  if (/exceeds limit|too many results/i.test(raw)) {
    return 'This address has too much history for the public node — it refuses to return its transfers.';
  }
  if (/timed out|timeout|deadline exceeded/i.test(raw)) {
    return 'The public node took too long to answer. Try again in a few seconds.';
  }
  if (/busy|429|rate/i.test(raw)) {
    return 'The public node is saturated. Try again in a minute.';
  }
  return `Read failed: ${raw}`;
}

/* ------------------------------------------------------------------ */
/* scan                                                                */
/* ------------------------------------------------------------------ */

async function run(address) {
  const addr = address.trim();
  if (!isAddress(addr)) {
    say('Invalid address — it takes 0x followed by 40 characters.', true);
    return;
  }

  $('#go').disabled = true;
  say('Reading the chain…');

  try {
    const report = await scanWallet(addr, { onProgress: say });

    if (!report.friends.length) {
      say('No Rare Friend on this address — nothing to put on a card.', true);
      return;
    }

    // Le portrait vient du tokenURI du Genesis le plus lourd : l'œuvre est
    // sur la chaîne, la carte la reprend telle quelle.
    const hero = report.friends
      .filter((f) => f.collection === 'Genesis')
      .sort((a, b) => b.weight - a.weight)[0];
    let friend = null;
    if (hero) {
      say('Decoding the portrait…');
      [friend] = await loadFriends([hero.id]);
    }

    await fontsReady;
    paintCard(canvas, report, friend);
    current = { report, friend };

    $('#readout').textContent = cardSummary(report);
    $('#stage').hidden = false;
    $('#share').hidden = !canShareFiles();
    say(`${report.friends.length} Friend${report.friends.length > 1 ? 's' : ''} · block ${report.block}`);

    const url = new URL(location.href);
    url.searchParams.set('wallet', addr);
    history.replaceState(null, '', url);
  } catch (err) {
    console.error(err);
    say(explain(err), true);
  } finally {
    $('#go').disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

const toBlob = () => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

const fileName = () => `rare-friends-pnl-${current?.report.short.replace('…', '') || 'card'}.png`;

function canShareFiles() {
  return typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File([], 'x.png', { type: 'image/png' })] });
}

$('#dl').addEventListener('click', async () => {
  const blob = await toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  a.click();
  URL.revokeObjectURL(url);
});

$('#share').addEventListener('click', async () => {
  try {
    const blob = await toBlob();
    await navigator.share({
      files: [new File([blob], fileName(), { type: 'image/png' })],
      text: current ? cardSummary(current.report) : undefined,
    });
  } catch { /* partage annulé */ }
});

$('#link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    say('Link copied — it reopens this wallet’s card.');
  } catch {
    say('The browser refused the copy.', true);
  }
});

/* ------------------------------------------------------------------ */
/* câblage                                                             */
/* ------------------------------------------------------------------ */

$('#scan').addEventListener('submit', (e) => {
  e.preventDefault();
  run($('#addr').value);
});

// ?wallet=0x… rouvre directement la carte : c'est le lien qu'on partage.
const wallet = new URLSearchParams(location.search).get('wallet');
if (wallet && isAddress(wallet)) {
  $('#addr').value = wallet;
  run(wallet);
}

console.info(`Rare Friends rewards card — ${CARD_W}×${CARD_H}, read-only.`);
