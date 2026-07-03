#!/usr/bin/env python3
"""Process downloaded Wayback Machine snapshots into a unified rankings dataset."""

import json
import os
import re
from datetime import datetime

SNAPSHOTS_DIR = os.path.join(os.path.dirname(__file__), 'data', 'snapshots')
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), 'data', 'rankings.json')

def extract_next_data(html):
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

def determine_season(timestamp_str):
    if timestamp_str == 'live':
        now = datetime.now()
        year, month = now.year, now.month
    else:
        year = int(timestamp_str[:4])
        month = int(timestamp_str[4:6])
    if month >= 10:
        return f"{year}-{str(year + 1)[-2:]}"
    else:
        return f"{year - 1}-{str(year)[-2:]}"

def format_date(timestamp_str):
    if timestamp_str == 'live':
        return datetime.now().strftime('%Y-%m-%d')
    return f"{timestamp_str[:4]}-{timestamp_str[4:6]}-{timestamp_str[6:8]}"

def extract_rankings_from_snapshot(data, timestamp_str):
    try:
        content = data['props']['pageProps']['content']
        settings = data['props']['pageProps']['settings']
    except (KeyError, TypeError):
        return None

    pp = content.get('processedPlayers', {})
    rankings_list = pp.get('rankings', [])
    player_data = pp.get('playerData', {})
    weekly_labels = settings.get('weekly_rankings_labels', {})
    current_week = settings.get('current_week', 'weekly_rankings_0')

    players = []
    for i, pid in enumerate(rankings_list):
        p = player_data.get(pid)
        if not p:
            continue

        team = p.get('meta', {}).get('team', '') if isinstance(p.get('meta'), dict) else ''
        age = p.get('meta', {}).get('age') if isinstance(p.get('meta'), dict) else None

        players.append({
            'rank': i + 1,
            'id': pid,
            'name': p.get('title', ''),
            'first_name': p.get('first_name', ''),
            'last_name': p.get('last_name', ''),
            'position': p.get('position', ''),
            'position_label': p.get('position_label', ''),
            'team': team,
            'age': age,
            'weekly_rankings': p.get('weekly_rankings', {}),
        })

    return {
        'timestamp': timestamp_str,
        'date': format_date(timestamp_str),
        'season': determine_season(timestamp_str),
        'current_week': current_week,
        'weekly_labels': weekly_labels,
        'players': players,
    }

def main():
    files = sorted(os.listdir(SNAPSHOTS_DIR))
    print(f"Found {len(files)} snapshot files")

    all_snapshots = []

    for fname in files:
        if not fname.endswith('.html'):
            continue
        timestamp = fname.replace('.html', '')
        filepath = os.path.join(SNAPSHOTS_DIR, fname)

        with open(filepath, 'r', errors='replace') as f:
            html = f.read()

        data = extract_next_data(html)
        if not data:
            print(f"  {timestamp}: No __NEXT_DATA__ found, skipping")
            continue

        result = extract_rankings_from_snapshot(data, timestamp)
        if not result or not result['players']:
            print(f"  {timestamp}: No players found, skipping")
            continue

        all_snapshots.append(result)
        top3 = ', '.join(p['name'] for p in result['players'][:3])
        print(f"  {timestamp} ({result['date']}): Season {result['season']} | {len(result['players'])} players | Top 3: {top3}")

    # Group by season
    by_season = {}
    for snap in all_snapshots:
        season = snap['season']
        if season not in by_season:
            by_season[season] = []
        by_season[season].append(snap)

    print(f"\n=== SEASONS ===")
    for season in sorted(by_season.keys()):
        snaps = by_season[season]
        print(f"  {season}: {len(snaps)} snapshots ({snaps[0]['date']} to {snaps[-1]['date']})")

    # Build the final dataset
    # For each snapshot, record the ranking at that point in time
    # Also expand weekly_rankings within each snapshot for finer granularity

    # Flat timeline entries: each is a (date, player_name, rank) tuple
    timeline_entries = []

    # For each snapshot, use the weekly_rankings to get intra-snapshot data
    for snap in all_snapshots:
        season = snap['season']
        labels = snap['weekly_labels']
        snap_date = snap['date']
        snap_year = int(snap_date[:4])

        # Map weekly_rankings keys to dates
        week_dates = {}
        for key, label in labels.items():
            # label is like "1/29", "2/24", etc.
            idx = key.replace('weekly_rankings_label_', '')
            week_key = f"weekly_rankings_{idx}"
            parts = label.split('/')
            if len(parts) == 2:
                m, d = int(parts[0]), int(parts[1])
                # Determine year from context
                if m >= 10:
                    y = snap_year if int(snap_date[5:7]) >= 10 else snap_year - 1
                else:
                    y = snap_year if int(snap_date[5:7]) < 10 else snap_year + 1
                week_dates[week_key] = f"{y}-{m:02d}-{d:02d}"

        for player in snap['players']:
            # Record the snapshot rank
            timeline_entries.append({
                'date': snap_date,
                'season': season,
                'source': 'snapshot',
                'name': player['name'],
                'first_name': player['first_name'],
                'last_name': player['last_name'],
                'rank': player['rank'],
                'position': player['position'],
                'position_label': player['position_label'],
                'team': player['team'],
                'age': player['age'],
            })

            # Also record weekly rankings
            for week_key, week_rank in player.get('weekly_rankings', {}).items():
                if week_rank is not None and week_key in week_dates:
                    timeline_entries.append({
                        'date': week_dates[week_key],
                        'season': season,
                        'source': 'weekly',
                        'name': player['name'],
                        'first_name': player['first_name'],
                        'last_name': player['last_name'],
                        'rank': week_rank,
                        'position': player['position'],
                        'position_label': player['position_label'],
                        'team': player['team'],
                        'age': player['age'],
                    })

    # Deduplicate: for each (date, name), keep one entry (prefer weekly over snapshot)
    seen = {}
    for entry in timeline_entries:
        key = (entry['date'], entry['name'])
        if key not in seen or (entry['source'] == 'weekly' and seen[key]['source'] == 'snapshot'):
            seen[key] = entry

    deduped = sorted(seen.values(), key=lambda x: (x['date'], x['rank']))
    print(f"\nTotal timeline entries (deduped): {len(deduped)}")

    # Build player master list
    player_index = {}
    for entry in deduped:
        name = entry['name']
        if name not in player_index:
            player_index[name] = {
                'name': name,
                'first_name': entry['first_name'],
                'last_name': entry['last_name'],
                'positions': set(),
                'teams': set(),
            }
        if entry['position_label']:
            player_index[name]['positions'].add(entry['position_label'])
        if entry['team']:
            player_index[name]['teams'].add(entry['team'])

    # Convert sets to sorted lists
    for p in player_index.values():
        p['positions'] = sorted(p['positions'])
        p['teams'] = sorted(p['teams'])

    # Find Jalens
    jalens = [p for p in player_index.values() if (p.get('first_name') or '').lower() == 'jalen']
    print(f"\n=== JALENS ({len(jalens)}) ===")
    for j in jalens:
        jalen_entries = [e for e in deduped if e['name'] == j['name']]
        seasons = sorted(set(e['season'] for e in jalen_entries))
        ranks = [(e['date'], e['rank']) for e in jalen_entries]
        print(f"  {j['name']}: Seasons {seasons}")
        for date, rank in sorted(ranks):
            print(f"    {date}: #{rank}")

    # Get all unique teams and positions
    all_teams = sorted(set(e['team'] for e in deduped if e['team']))
    all_positions = sorted(set(e['position_label'] for e in deduped if e['position_label']))
    all_dates = sorted(set(e['date'] for e in deduped))
    all_seasons = sorted(set(e['season'] for e in deduped))

    print(f"\nTeams: {all_teams}")
    print(f"Positions: {all_positions}")
    print(f"Dates: {all_dates}")
    print(f"Seasons: {all_seasons}")

    dataset = {
        'generated': datetime.now().isoformat(),
        'seasons': all_seasons,
        'dates': all_dates,
        'teams': all_teams,
        'positions': all_positions,
        'players': list(player_index.values()),
        'timeline': deduped,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(dataset, f)

    # Also write a pretty-printed summary
    size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    print(f"\nDataset written to {OUTPUT_FILE} ({size_mb:.1f} MB)")
    print(f"  Seasons: {len(all_seasons)}")
    print(f"  Dates: {len(all_dates)}")
    print(f"  Players: {len(player_index)}")
    print(f"  Timeline entries: {len(deduped)}")

if __name__ == '__main__':
    main()
