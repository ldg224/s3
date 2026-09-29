/**
 * HCL manager relay (Google Apps Script web app).
 *
 * The public website can't hold a GitHub key safely, so managers' saves come here instead.
 * This script checks the manager's email + PIN against the hash the league admin published
 * in data/season.json, cleans the data, and commits ONLY that team's file:
 * data/teams/<code>.json. The GitHub key lives in this script's properties, never on the site.
 *
 * Setup: see docs/MANAGER_SETUP.md. Script property required: GITHUB_TOKEN
 * (optional: REPO, default ldg224/s3; BRANCH, default main).
 */

var ROUNDS = 3000;              // must match HASH_ROUNDS in js/managers.js
var MAX_FAILS = 8;              // wrong logins per team before a 15-minute lockout
var STEPS = [0, 0.25, 0.5, 0.75, 1];
var TACTIC_KEYS = ['tempo', 'pressing', 'width', 'line_height', 'directness'];
var FORMATIONS = {
  '4-3-3': ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LCM', 'CDM', 'RCM', 'LW', 'ST', 'RW'],
  '4-4-2': ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LST', 'RST'],
  '4-2-3-1': ['GK', 'LB', 'LCB', 'RCB', 'RB', 'LDM', 'RDM', 'LW', 'CAM', 'RW', 'ST'],
  '3-5-2': ['GK', 'LCB', 'CB', 'RCB', 'LWB', 'LCM', 'CDM', 'RCM', 'RWB', 'LST', 'RST'],
};

function doGet() {
  return reply({ ok: true, service: 'HCL manager relay' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    return reply(handle(req));
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function cfg() {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('The relay has no GitHub key yet (script property GITHUB_TOKEN).');
  return { token: token, repo: p.getProperty('REPO') || 'ldg224/s3', branch: p.getProperty('BRANCH') || 'main' };
}

function gh(c, path, method, body) {
  var res = UrlFetchApp.fetch('https://api.github.com' + path, {
    method: method || 'get',
    headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    contentType: 'application/json',
    payload: body ? JSON.stringify(body) : null,
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code === 404) return null;
  if (code >= 300) {
    var msg = text;
    try { msg = JSON.parse(text).message; } catch (x) { /* raw text */ }
    var err = new Error('GitHub: ' + msg + ' (' + code + ')');
    err.status = code;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

function readJson(c, path) {
  var r = gh(c, '/repos/' + c.repo + '/contents/' + path + '?ref=' + c.branch);
  if (!r) return null;
  var text = Utilities.newBlob(Utilities.base64Decode(r.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return { data: JSON.parse(text), sha: r.sha };
}

function sha(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

// Must match loginHash() in js/managers.js exactly.
function hashLogin(salt, email, pin) {
  var h = sha(salt + '|' + String(email || '').trim().toLowerCase() + '|' + String(pin || '').trim());
  for (var i = 0; i < ROUNDS; i++) h = sha(h + salt);
  return h;
}

function checkLogin(season, team, email, pin) {
  var cache = CacheService.getScriptCache(), key = 'fails:' + team;
  var fails = Number(cache.get(key) || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong attempts. Try again in 15 minutes.');
  var m = (season.managers || {})[team];
  var teamExists = (season.teams || []).some(function (t) { return t.code === team; });
  if (!teamExists || !m || !m.salt || !m.hash || hashLogin(m.salt, email, pin) !== m.hash) {
    cache.put(key, String(fails + 1), 900);
    throw new Error('That email and PIN don’t match this team.');
  }
  cache.remove(key);
}

function text(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
}

// Keep only known fields, with valid values, for players who are actually in this team.
function clean(season, team, f) {
  f = f || {};
  var ids = {};
  (season.players || []).forEach(function (p) { if (p.team === team) ids[String(p.id)] = true; });
  var formation = FORMATIONS[f.formation] ? f.formation : '4-3-3';
  var tactics = {};
  TACTIC_KEYS.forEach(function (k) { var v = f.tactics && f.tactics[k]; tactics[k] = STEPS.indexOf(v) >= 0 ? v : 0.5; });
  var lineup = {}, used = {};
  FORMATIONS[formation].forEach(function (s) {
    var id = f.lineup && String(f.lineup[s] || '');
    if (id && ids[id] && !used[id]) { lineup[s] = id; used[id] = true; }
  });
  var bench = [];
  (Array.isArray(f.bench) ? f.bench : []).forEach(function (id) {
    id = String(id);
    if (ids[id] && !used[id] && bench.length < 12) { bench.push(id); used[id] = true; }
  });
  var pick = function (id) { id = String(id || ''); return ids[id] ? id : null; };
  var press = (Array.isArray(f.press) ? f.press : []).slice(-100).map(function (x) {
    return { id: text(x.id, 80), q: text(x.q, 300), a: text(x.a, 1500), date: text(x.date, 30), from: text(x.from, 40) };
  }).filter(function (x) { return x.a.trim(); });
  return {
    team: team, updated: new Date().toISOString().slice(0, 19), formation: formation, tactics: tactics, lineup: lineup, bench: bench,
    captain: pick(f.captain), penalties: pick(f.penalties), freekicks: pick(f.freekicks), corners: pick(f.corners),
    message: text(f.message, 500), press: press,
  };
}

function handle(req) {
  var c = cfg();
  var team = text(req.team, 6).toUpperCase();
  var seasonFile = readJson(c, 'data/season.json');
  if (!seasonFile) throw new Error('Couldn’t read the league data.');
  var season = seasonFile.data;
  checkLogin(season, team, req.email, req.pin);
  if (req.action === 'check') return { ok: true, team: team };
  if (req.action !== 'save') throw new Error('Unknown request.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var path = 'data/teams/' + team.toLowerCase() + '.json';
    var file = clean(season, team, req.file);
    var name = ((season.teams || []).filter(function (t) { return t.code === team; })[0] || {}).name || team;
    for (var attempt = 0; attempt < 2; attempt++) {
      var current = readJson(c, path);
      try {
        gh(c, '/repos/' + c.repo + '/contents/' + path, 'put', {
          message: 'Manager: ' + name + ' ' + text(req.what || 'updated their team', 80),
          content: Utilities.base64Encode(JSON.stringify(file), Utilities.Charset.UTF_8),
          branch: c.branch,
          sha: current ? current.sha : undefined,
        });
        return { ok: true, file: file };
      } catch (err) {
        if (err.status !== 409 && err.status !== 422) throw err;   // someone else saved first: re-read and retry
      }
    }
    throw new Error('Couldn’t save just now. Try again in a moment.');
  } finally {
    lock.releaseLock();
  }
}
