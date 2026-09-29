"""Loads the league from the site's own data (command line only; the browser builds the same
format in js/simulate.js, toLeague): data/season.json plus the manager files in data/teams/."""

import json
import os

# js/sim/hcl_sim -> the site root
SITE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FORMATIONS = ('4-3-3', '4-4-2', '4-2-3-1', '3-5-2')
TACTICS = ('tempo', 'pressing', 'width', 'line_height', 'directness')


def _number(v, default=5):
    """Same as the browser's `Number(v) || 5`, so both give identical matches for a seed."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    if not n or n != n:
        return default
    return int(n) if n.is_integer() else n


def manager_tactics(file, squad_ids):
    """The engine's tactics input from a manager file, keeping only players still in the squad."""
    ok = lambda pid: pid is not None and str(pid) in squad_ids
    t = {}
    if file.get('formation') in FORMATIONS:
        t['formation'] = file['formation']
    for k in TACTICS:
        v = (file.get('tactics') or {}).get(k)
        if isinstance(v, (int, float)):
            t[k] = min(1.0, max(0.0, float(v)))
    if t.get('formation') and isinstance(file.get('lineup'), dict):
        t['lineup'] = {slot: str(pid) for slot, pid in file['lineup'].items() if ok(pid)}
    for k in ('captain', 'penalties', 'freekicks', 'corners'):
        if ok(file.get(k)):
            t[k] = str(file[k])
    return t


def load_season(path=None):
    """Returns {'teams': {code: {...}}, 'players': {id: {...}}, 'attributes': {}, 'tactics': {...}, 'schedule': [...]}"""
    path = path or os.path.join(SITE, 'data', 'season.json')
    with open(path, encoding='utf-8') as f:
        s = json.load(f)
    teams, players, tactics = {}, {}, {}
    for t in s.get('teams', []):
        code = t['code']
        teams[code] = {'code': code, 'name': t.get('name') or code, 'manager': t.get('manager') or '',
                       'colour': t.get('colour') or '#888888'}
    for p in s.get('players', []):
        if p.get('team') in teams:
            players[str(p['id'])] = {'id': str(p['id']), 'name': p.get('name', ''), 'team': p['team'],
                                     'position': (p.get('position') or 'MID').upper(),
                                     'offense': _number(p.get('offense')), 'defense': _number(p.get('defense'))}
    for code in teams:
        mf = os.path.join(os.path.dirname(path), 'teams', f'{code.lower()}.json')
        if os.path.exists(mf):
            with open(mf, encoding='utf-8') as f:
                squad = {pid for pid, p in players.items() if p['team'] == code}
                tactics[code] = manager_tactics(json.load(f), squad)
    schedule = [fx for fx in s.get('fixtures', []) if fx.get('home') and fx.get('away')]
    return {'teams': teams, 'players': players, 'attributes': {}, 'tactics': tactics, 'schedule': schedule}


def playable(league, min_players=7):
    """Codes of teams with enough players to play a match."""
    return sorted(c for c in league['teams'] if sum(p['team'] == c for p in league['players'].values()) >= min_players)
