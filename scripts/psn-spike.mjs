/**
 * PSN feasibility spike — throwaway, not part of the app.
 *
 * Answers ONE question that decides how PlayStation linking has to work:
 *
 *   Can a single authenticated PSN session read ANOTHER user's played
 *   games and their playtime?
 *
 * If yes  -> users just type their PSN online ID. We hold one service
 *            token, they hand over no credentials at all. Good product.
 * If no   -> every user would have to paste their own NPSSO out of
 *            browser devtools, and we'd be storing a credential that is
 *            close to full account access. I'd argue against shipping
 *            that.
 *
 * Your NPSSO never leaves your machine: it is read from the environment,
 * never printed, and this file is git-ignored output-free.
 *
 * HOW TO RUN (from the repo root):
 *
 *   1. Get your NPSSO:
 *        - log in at https://www.playstation.com
 *        - then open https://ca.account.sony.com/api/v1/ssocookie
 *        - copy the 64-character value of "npsso"
 *
 *   2. npm install psn-api
 *
 *   3. Windows PowerShell:
 *        $env:NPSSO="paste_it_here"; node scripts/psn-spike.mjs SomeOtherPsnId
 *      macOS/Linux/Git Bash:
 *        NPSSO="paste_it_here" node scripts/psn-spike.mjs SomeOtherPsnId
 *
 *   Pass a friend's (or any public) PSN online ID as the argument. Use
 *   an account that is NOT yours — that is the entire point of the test.
 */

import {
  exchangeNpssoForCode,
  exchangeCodeForAccessToken,
  makeUniversalSearch,
  getUserPlayedGames,
} from 'psn-api';

const npsso = process.env.NPSSO;
const targetId = process.argv[2];

if (!npsso) {
  console.error('\nNo NPSSO found. Set it as an environment variable — see the header of this file.\n');
  process.exit(1);
}
if (!targetId) {
  console.error('\nPass someone else\'s PSN online ID as an argument:\n  node scripts/psn-spike.mjs TheirPsnId\n');
  process.exit(1);
}

function hours(ms) {
  if (!ms) return '—';
  return (ms / 3_600_000).toFixed(1) + 'h';
}

// The API returns ISO-8601 durations like "PT84H30M" on some fields and
// milliseconds on others, so normalise before judging whether playtime
// is actually present.
function readDuration(v) {
  if (v == null) return null;
  if (typeof v === 'number') return hours(v);
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(v));
  if (!m) return String(v);
  const d = Number(m[1] || 0), h = Number(m[2] || 0), mi = Number(m[3] || 0);
  return (d * 24 + h + mi / 60).toFixed(1) + 'h';
}

function report(label, games) {
  console.log(`\n--- ${label} ---`);
  if (!Array.isArray(games) || !games.length) {
    console.log('  no games returned');
    return false;
  }
  console.log(`  ${games.length} titles returned`);
  const sample = games.slice(0, 5);
  let sawPlaytime = false;
  for (const g of sample) {
    const dur = readDuration(g.playDuration ?? g.playTime ?? g.playtime);
    if (dur && dur !== '—') sawPlaytime = true;
    console.log(
      `    ${(g.name || g.titleName || g.concept?.name || 'untitled').slice(0, 42).padEnd(44)}` +
      `${String(dur ?? '—').padStart(8)}   ${g.category || g.platform || ''}`
    );
  }
  console.log(`  playtime present: ${sawPlaytime ? 'YES' : 'NO'}`);
  return sawPlaytime;
}

(async () => {
  console.log('\nAuthenticating…');
  const accessCode = await exchangeNpssoForCode(npsso);
  const auth = await exchangeCodeForAccessToken(accessCode);
  console.log('  ok (token acquired, not printed)');

  // 1. Baseline: your own account. Proves the endpoint and the shape.
  let mine = [];
  try {
    const res = await getUserPlayedGames(auth, 'me');
    mine = res.titles || res.games || [];
  } catch (err) {
    console.log('\n  own-account call failed:', err.message);
  }
  const mineOk = report('YOUR account (baseline)', mine);

  // 2. The actual question: somebody else, by account id.
  console.log(`\nResolving "${targetId}"…`);
  let accountId = null;
  try {
    const search = await makeUniversalSearch(auth, targetId, 'SocialAllAccounts');
    const results = search?.domainResponses?.[0]?.results || [];
    accountId = results[0]?.socialMetadata?.accountId || null;
    console.log(accountId ? `  found accountId ${accountId}` : '  could not resolve that online ID');
    if (!accountId) {
      // Distinguishes "PSN genuinely found nobody" from "the response
      // shape wasn't what this script expected" — the two look
      // identical from the one-line message above but mean opposite
      // things for whether cross-user reads are even possible.
      console.log('  raw response (for diagnosis):');
      console.log('  ' + JSON.stringify(search).slice(0, 500));
    }
  } catch (err) {
    console.log('  search failed:', err.message);
  }

  let theirs = [];
  let theirError = null;
  if (accountId) {
    try {
      const res = await getUserPlayedGames(auth, accountId);
      theirs = res.titles || res.games || [];
    } catch (err) {
      theirError = err.message;
    }
  }
  if (theirError) console.log(`\n--- THEIR account ---\n  refused: ${theirError}`);
  const theirsOk = accountId && !theirError ? report('THEIR account (the real test)', theirs) : false;

  console.log('\n============================================');
  console.log(' VERDICT');
  console.log('============================================');
  console.log(` own library + playtime readable : ${mineOk ? 'YES' : 'NO'}`);
  console.log(` OTHER user readable             : ${accountId && !theirError && theirs.length ? 'YES' : 'NO'}`);
  console.log(` OTHER user playtime readable    : ${theirsOk ? 'YES' : 'NO'}`);
  console.log('');
  if (theirsOk) {
    console.log(' => Users just type their PSN ID. We hold one service token.');
    console.log('    No user credentials stored. This is the good outcome.');
  } else if (mineOk) {
    console.log(' => Only self-reads work. Each user would have to paste their');
    console.log('    own NPSSO from devtools, refreshed every 60 days, and we');
    console.log('    would be storing near-account-access credentials.');
    console.log('    Tell me this result before we build anything on it.');
  } else {
    console.log(' => Endpoint did not return playtime at all. PSN import cannot');
    console.log('    deliver hours-played; Steam would be the only source.');
  }
  console.log('');
})().catch((err) => {
  console.error('\nSpike failed:', err.message);
  console.error('If this says the NPSSO is invalid, it has expired — grab a fresh one.\n');
  process.exit(1);
});
