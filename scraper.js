const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function fetch(url) {
  const result = execSync(
    `curl -sL --cacert /root/.ccr/ca-bundle.crt '${url.replace(/'/g, "'\\''")}'`,
    { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
  );
  return result.toString();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function extractRankings(data) {
  const content = data.props.pageProps.content;
  const settings = data.props.pageProps.settings;
  const pp = content.processedPlayers;
  const rankings = pp.rankings;
  const playerData = pp.playerData;

  const weeklyLabels = settings.weekly_rankings_labels || {};
  const currentWeek = settings.current_week || 'weekly_rankings_0';

  const players = [];
  for (let i = 0; i < rankings.length; i++) {
    const pid = rankings[i];
    const p = playerData[pid];
    if (!p) continue;

    const weeklyRankings = p.weekly_rankings || {};
    const rWeeklyRankings = p.r_weekly_rankings || {};

    players.push({
      rank: i + 1,
      id: pid,
      name: p.title,
      first_name: p.first_name,
      last_name: p.last_name,
      position: p.position,
      position_label: p.position_label,
      team: p.meta?.team || null,
      age: p.meta?.age || null,
      weekly_rankings: weeklyRankings,
      current_week_rank: weeklyRankings[currentWeek] ?? (i + 1),
    });
  }

  return {
    currentWeek,
    weeklyLabels,
    playerCount: players.length,
    players,
  };
}

async function main() {
  // Get all Wayback snapshots
  console.log('Fetching Wayback Machine CDX index...');
  const cdxUrl = 'https://web.archive.org/cdx/search/cdx?url=nbarankings.theringer.com/rankings&output=json&limit=100';
  const cdxRaw = await fetch(cdxUrl);
  const cdxData = JSON.parse(cdxRaw);
  const rows = cdxData.slice(1);

  // Filter to status=200, deduplicate by picking one per month
  const goodSnapshots = rows.filter(r => r[4] === '200');
  console.log(`Found ${goodSnapshots.length} valid snapshots`);

  // Also fetch current live page
  const allSources = [];

  // Group snapshots: pick distinct ones spread across time
  // Use all of them since they're not that many
  for (const row of goodSnapshots) {
    const ts = row[1];
    allSources.push({
      timestamp: ts,
      url: `https://web.archive.org/web/${ts}id_/https://nbarankings.theringer.com/rankings`,
      label: `wayback_${ts}`,
    });
  }

  // Add current live page
  allSources.push({
    timestamp: 'live',
    url: 'https://nbarankings.theringer.com/rankings',
    label: 'live',
  });

  const allResults = [];

  for (const source of allSources) {
    console.log(`\nFetching ${source.label}...`);
    try {
      const html = await fetch(source.url);
      const data = extractNextData(html);
      if (!data) {
        console.log(`  No __NEXT_DATA__ found, skipping`);
        continue;
      }
      const result = extractRankings(data);
      result.source = source.label;
      result.timestamp = source.timestamp;

      // Determine season from timestamp or labels
      const ts = source.timestamp;
      let year, month;
      if (ts === 'live') {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
      } else {
        year = parseInt(ts.substring(0, 4));
        month = parseInt(ts.substring(4, 6));
      }
      // NBA season: if month >= 10, it's the start of year-(year+1) season
      // if month < 10, it's (year-1)-year season
      if (month >= 10) {
        result.season = `${year}-${(year + 1).toString().slice(-2)}`;
      } else {
        result.season = `${year - 1}-${year.toString().slice(-2)}`;
      }

      allResults.push(result);
      console.log(`  Season: ${result.season} | Players: ${result.playerCount} | Top 3: ${result.players.slice(0, 3).map(p => p.name).join(', ')}`);

      await sleep(1500); // Be nice to Wayback
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Deduplicate: group by season, keep the latest snapshot per season
  // But also keep weekly ranking history within each snapshot
  const bySeason = {};
  for (const result of allResults) {
    const season = result.season;
    if (!bySeason[season]) {
      bySeason[season] = [];
    }
    bySeason[season].push(result);
  }

  console.log(`\n=== SEASONS FOUND ===`);
  for (const [season, results] of Object.entries(bySeason).sort()) {
    console.log(`${season}: ${results.length} snapshots`);
    for (const r of results) {
      console.log(`  ${r.timestamp} - Top: ${r.players[0]?.name}`);
    }
  }

  // Build final dataset: for each season, use all snapshots to track movement
  const dataset = {
    seasons: {},
    players: {},  // master player index
    generated: new Date().toISOString(),
  };

  for (const [season, results] of Object.entries(bySeason).sort()) {
    // Sort snapshots by timestamp
    const sorted = results.sort((a, b) => {
      if (a.timestamp === 'live') return 1;
      if (b.timestamp === 'live') return -1;
      return a.timestamp.localeCompare(b.timestamp);
    });

    // Use the latest snapshot for the "final" rankings
    // But combine weekly_rankings from all snapshots
    const latest = sorted[sorted.length - 1];

    const seasonData = {
      season,
      snapshotCount: sorted.length,
      snapshots: sorted.map(s => ({
        timestamp: s.timestamp,
        date: s.timestamp === 'live' ? new Date().toISOString().split('T')[0] :
          `${s.timestamp.substring(0, 4)}-${s.timestamp.substring(4, 6)}-${s.timestamp.substring(6, 8)}`,
      })),
      weeklyLabels: latest.weeklyLabels,
      rankings: latest.players.map(p => ({
        rank: p.rank,
        name: p.name,
        first_name: p.first_name,
        last_name: p.last_name,
        position: p.position,
        position_label: p.position_label,
        team: p.team,
        age: p.age,
        weekly_rankings: p.weekly_rankings,
      })),
    };

    // Also store snapshot-specific rankings for tracking movement across snapshots
    seasonData.snapshotRankings = {};
    for (const snap of sorted) {
      const snapDate = snap.timestamp === 'live' ? 'live' :
        `${snap.timestamp.substring(0, 4)}-${snap.timestamp.substring(4, 6)}-${snap.timestamp.substring(6, 8)}`;
      seasonData.snapshotRankings[snapDate] = snap.players.map(p => ({
        rank: p.rank,
        name: p.name,
        position: p.position,
        position_label: p.position_label,
        team: p.team,
      }));
    }

    dataset.seasons[season] = seasonData;

    // Add to master player index
    for (const p of latest.players) {
      const key = p.name;
      if (!dataset.players[key]) {
        dataset.players[key] = {
          name: p.name,
          first_name: p.first_name,
          last_name: p.last_name,
          positions: new Set(),
          teams: new Set(),
          seasons: {},
        };
      }
      dataset.players[key].positions.add(p.position_label);
      if (p.team) dataset.players[key].teams.add(typeof p.team === 'string' ? p.team : p.team);
      dataset.players[key].seasons[season] = {
        rank: p.rank,
        position: p.position_label,
        team: p.team,
        weekly_rankings: p.weekly_rankings,
      };
    }
  }

  // Convert Sets to arrays for JSON serialization
  for (const player of Object.values(dataset.players)) {
    player.positions = [...player.positions];
    player.teams = [...player.teams];
  }

  // Write the dataset
  const outPath = path.join(__dirname, 'data', 'rankings.json');
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2));
  console.log(`\nDataset written to ${outPath}`);
  console.log(`Seasons: ${Object.keys(dataset.seasons).length}`);
  console.log(`Unique players: ${Object.keys(dataset.players).length}`);

  // Also find Jalens
  const jalens = Object.values(dataset.players).filter(p =>
    p.first_name?.toLowerCase() === 'jalen'
  );
  console.log(`\n=== JALENS ===`);
  for (const j of jalens) {
    console.log(`${j.name}: ${JSON.stringify(j.seasons)}`);
  }
}

main().catch(console.error);
