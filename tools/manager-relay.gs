/**
 * HCL manager relay (Google Apps Script web app).
 *
 * The public website can't hold a GitHub key safely, so managers' saves come here instead.
 * This script checks the manager's email + PIN against the hash the league admin published
 * in data/season.json, cleans the data, and commits ONLY that team's file:
 * data/teams/<code>.json, plus images uploaded in league news forms (data/uploads/<code>/). The GitHub key lives in this script's properties, never on the site.
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

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'ping') return reply(presence(e.parameter));
  return reply({ ok: true, service: 'HCL manager relay' });
}

function doPost(e) {
  // A tab closing sends its "leave" ping as a beacon (a POST with the details in the URL).
  if (e && e.parameter && e.parameter.action === 'ping') return reply(presence(e.parameter));
  try {
    var req = JSON.parse(e.postData.contents);
    return reply(handle(req));
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------- live viewer counts
// Public pages ping every 30 s while open (js/viewers.js): ?action=ping&id=<tab id>&m=<fixture id or ''>
// (&leave=1 when the tab closes). Who's here lives only in the script cache (no GitHub, no login):
// { id: [last seen ms, fixture id] }, and anyone not seen for 75 s has gone.
var PRESENCE_TTL = 75 * 1000, PRESENCE_MAX = 2000;

function presence(q) {
  var cache = CacheService.getScriptCache(), now = Date.now(), seen = {};
  try { seen = JSON.parse(cache.get('presence') || '{}'); } catch (x) { seen = {}; }
  var id = String(q.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 16), m = String(q.m || '').replace(/[^\w-]/g, '').slice(0, 60);
  var fresh = {}, site = 0, matches = {};
  for (var k in seen) {
    if (now - seen[k][0] > PRESENCE_TTL || k === id) continue;
    fresh[k] = seen[k];
  }
  if (id && !q.leave && Object.keys(fresh).length < PRESENCE_MAX) fresh[id] = [now, m];
  // Only write when the lock is free straight away: a manager save can hold it for a while, and a
  // missed write just means this tab is counted from its next ping.
  var lock = LockService.getScriptLock();
  if (id && lock.tryLock(1500)) {
    try {
      var latest = {};
      try { latest = JSON.parse(cache.get('presence') || '{}'); } catch (x) { latest = {}; }
      for (var k3 in latest) if (!(k3 in fresh) && k3 !== id && now - latest[k3][0] <= PRESENCE_TTL) fresh[k3] = latest[k3];
      cache.put('presence', JSON.stringify(fresh), 21600);
    } finally { lock.releaseLock(); }
  }
  for (var k2 in fresh) { site++; if (fresh[k2][1]) matches[fresh[k2][1]] = (matches[fresh[k2][1]] || 0) + 1; }
  return { ok: true, site: site, matches: matches };
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

// Press answers are dated by this script, not by the manager's browser, because the press
// effect (docs/PRESS_EFFECT.md) counts what was said before each match:
// - a new answer is dated now, with the tactics the team had at that moment (`tac`), so a
//   tactical claim can't be made true later by moving a slider;
// - an edited answer keeps its original date and tactics and gets `edited` (it counts half,
//   and editing can't move an old answer into this week);
// - the team-news message gets its own date (message_date) the same way.
function stampPress(file, stored) {
  var now = new Date().toISOString().slice(0, 19), old = {};
  (Array.isArray(stored.press) ? stored.press : []).forEach(function (p) { if (p && p.id) old[p.id] = p; });
  var tac = { pressing: file.tactics.pressing, directness: file.tactics.directness, width: file.tactics.width };
  file.press.forEach(function (p) {
    var was = old[p.id];
    if (!was) { p.date = now; p.tac = tac; delete p.edited; return; }
    p.date = was.date || now;
    if (was.tac) p.tac = was.tac; else delete p.tac;
    if (was.a !== p.a) p.edited = now; else if (was.edited) p.edited = was.edited; else delete p.edited;
  });
  file.message_date = file.message && file.message === stored.message && stored.message_date ? stored.message_date : (file.message ? now : '');
}

function text(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
}

// Keep only known fields, with valid values, for players who are actually in this team.
// `news` is the team's already-cleaned news block (see cleanNews).
function clean(season, team, f, news) {
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
    var item = { id: text(x.id, 80), q: text(x.q, 300), a: text(x.a, 1500), date: text(x.date, 30), from: text(x.from, 40) };
    // Set by stampPress on save; anything the browser sends is replaced there.
    if (x.edited) item.edited = text(x.edited, 30);
    if (x.tac && typeof x.tac === 'object') item.tac = { pressing: Number(x.tac.pressing) || 0.5, directness: Number(x.tac.directness) || 0.5, width: Number(x.tac.width) || 0.5 };
    return item;
  }).filter(function (x) { return x.a.trim(); });
  return {
    team: team, updated: new Date().toISOString().slice(0, 19), formation: formation, tactics: tactics, lineup: lineup, bench: bench,
    captain: pick(f.captain), penalties: pick(f.penalties), freekicks: pick(f.freekicks), corners: pick(f.corners),
    message: text(f.message, 500), message_date: text(f.message_date, 30), press: press, news: news || {},
  };
}

// ---------------------------------------------------------------- league news
// Posts live in season.news (written in edit mode). A team's read receipts, poll votes and
// form answers live in its team file under `news` (docs/NEWS.md). Managers change them only
// through the 'news' action, one post at a time; 'save' keeps whatever is already stored.

var UPLOAD_MAX = 400 * 1024;
var MAPPED_LOGO = { 'team.logo': '', 'team.logo_alt': '-alt' };

function stamp() { return new Date().toISOString().slice(0, 19); }
function isStamp(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v); }

function forTeam(post, team) {
  var a = post.audience;
  return !a || a === 'all' || (Array.isArray(a) && a.indexOf(team) >= 0);
}
function findPost(season, id) {
  return (season.news || []).filter(function (p) { return p && p.id === id; })[0] || null;
}
function pollsOf(post) {
  return (post.blocks || []).filter(function (b) { return b && b.type === 'poll' && b.id; });
}
function optionsOf(q) {
  return (q.options || []).map(String).filter(function (o) { return o.trim(); });
}
function uploadPath(team, post, q, ext) {
  return 'data/uploads/' + team.toLowerCase() + '/' + post.id + '-' + q.id + '.' + ext;
}

// The cleaned value of one answer, or throws a readable error.
function checkAnswer(season, team, post, q, v) {
  var empty = v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
  if (empty) {
    if (q.required) throw new Error('“' + text(q.label, 80) + '” needs an answer.');
    return q.type === 'multi' ? [] : q.type === 'checkbox' ? false : null;
  }
  var label = '“' + text(q.label, 80) + '”', opts = optionsOf(q);
  switch (q.type) {
    case 'short': case 'long': {
      var max = q.maxlen || (q.type === 'long' ? 2000 : 200), s = text(v, 5000).trim();
      if (s.length > max) throw new Error(label + ' is too long (' + max + ' characters at most).');
      return s;
    }
    case 'number': {
      var n = Number(v);
      if (typeof v === 'boolean' || !isFinite(n)) throw new Error(label + ' must be a number.');
      if (q.min != null && n < q.min) throw new Error(label + ' must be at least ' + q.min + '.');
      if (q.max != null && n > q.max) throw new Error(label + ' must be at most ' + q.max + '.');
      return n;
    }
    case 'choice': case 'dropdown':
      if (opts.indexOf(String(v)) < 0) throw new Error(label + ': pick one of the options.');
      return String(v);
    case 'multi': {
      if (!Array.isArray(v)) throw new Error(label + ': pick from the options.');
      var out = [];
      v.forEach(function (x) { x = String(x); if (opts.indexOf(x) < 0) throw new Error(label + ': pick from the options.'); if (out.indexOf(x) < 0) out.push(x); });
      return out;
    }
    case 'checkbox': return v === true;
    case 'colour':
      if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw new Error(label + ': pick a colour.');
      return String(v).toLowerCase();
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error(label + ': pick a date.');
      return String(v);
    case 'player': {
      var ok = (season.players || []).some(function (p) { return String(p.id) === String(v) && p.team === team; });
      if (!ok) throw new Error(label + ': pick a player from your squad.');
      return String(v);
    }
    case 'image': {
      v = String(v);
      var mine = ['png', 'jpg', 'webp'].some(function (ext) { return v === uploadPath(team, post, q, ext); });
      var current = q.map in MAPPED_LOGO && v === 'assets/teams/' + team.toLowerCase() + MAPPED_LOGO[q.map] + '.png';
      if (!mine && !current) throw new Error(label + ': upload the image again.');
      return v;
    }
  }
  throw new Error(label + ' has an unknown question type.');
}

// Every question answered and valid: { qid: value } for known questions only.
function checkAnswers(season, team, post, answers) {
  answers = answers || {};
  var out = {};
  (post.form.questions || []).forEach(function (q) { if (q && q.id) out[q.id] = checkAnswer(season, team, post, q, answers[q.id]); });
  return out;
}

// A team file's news block with only valid entries, for posts that exist and target this team.
function cleanNews(season, team, news) {
  var out = {};
  if (!news || typeof news !== 'object') return out;
  Object.keys(news).forEach(function (id) {
    var post = findPost(season, id), e = news[id];
    if (!post || !forTeam(post, team) || !e || typeof e !== 'object') return;
    var clean = {};
    if (isStamp(e.read)) clean.read = e.read;
    var votes = {};
    pollsOf(post).forEach(function (poll) {
      var v = e.votes && e.votes[poll.id];
      if (typeof v === 'number' && v % 1 === 0 && v >= 0 && v < (poll.options || []).length) votes[poll.id] = v;
    });
    if (Object.keys(votes).length) clean.votes = votes;
    if (post.form && e.answers && typeof e.answers === 'object') {
      var answers = {};
      (post.form.questions || []).forEach(function (q) {
        if (!q || !q.id || !(q.id in e.answers)) return;
        try { answers[q.id] = checkAnswer(season, team, post, q, e.answers[q.id]); } catch (err) { /* drop an answer that no longer fits its question */ }
      });
      clean.answers = answers;
      if (isStamp(e.submitted)) clean.submitted = e.submitted;
    }
    if (Object.keys(clean).length) out[id] = clean;
  });
  return out;
}

// Apply one manager action to the stored news block. Returns a short description for the commit.
function applyNews(season, team, news, req) {
  var post = findPost(season, text(req.post, 80));
  if (!post || !forTeam(post, team) || (post.status !== 'live' && post.status !== 'closed')) throw new Error('That post isn’t available.');
  if (post.status !== 'live') throw new Error('This post is closed, so it can’t be changed any more.');
  var e = news[post.id] || (news[post.id] = {});
  var title = text(((post.blocks || []).filter(function (b) { return b && b.type === 'embed' && b.title; })[0] || {}).title || 'a league post', 60);
  if (req.op === 'read') {
    if (!post.ack) throw new Error('This post doesn’t ask for a read receipt.');
    if (!e.read) e.read = stamp();
    return 'read “' + title + '”';
  }
  if (req.op === 'vote') {
    var poll = pollsOf(post).filter(function (p) { return p.id === req.poll; })[0];
    if (!poll) throw new Error('That poll isn’t available.');
    var opt = Number(req.option);
    if (!(opt % 1 === 0 && opt >= 0 && opt < (poll.options || []).length)) throw new Error('Pick one of the options.');
    e.votes = e.votes || {};
    if (e.votes[poll.id] != null) throw new Error('Your team has already voted in this poll.');
    e.votes[poll.id] = opt;
    return 'voted in “' + title + '”';
  }
  if (req.op === 'submit') {
    if (!post.form || !(post.form.questions || []).length) throw new Error('This post has no form.');
    var review = (post.reviews || {})[team];
    var rejected = review && review.status === 'rejected' && (!e.submitted || !isStamp(review.at) || review.at > e.submitted);
    if (e.submitted && !post.form.edit_after_submit && !rejected) throw new Error('This form has already been submitted and can’t be changed.');
    e.answers = checkAnswers(season, team, post, req.answers);
    e.submitted = stamp();
    return 'answered “' + title + '”';
  }
  throw new Error('Unknown news request.');
}

// Checked image upload for an `image` question. Returns the repo path it was written to.
function saveUpload(c, season, team, req, name) {
  var post = findPost(season, text(req.post, 80));
  if (!post || !forTeam(post, team) || post.status !== 'live') throw new Error('That form isn’t open.');
  if (!/^[\w-]+$/.test(post.id)) throw new Error('That post can’t take uploads.');
  var q = ((post.form || {}).questions || []).filter(function (x) { return x && x.id === req.question && x.type === 'image'; })[0];
  if (!q || !/^[\w-]+$/.test(q.id)) throw new Error('That question doesn’t take an image.');
  var bytes;
  try { bytes = Utilities.base64Decode(String(req.data || '')); } catch (err) { throw new Error('The image couldn’t be read.'); }
  if (!bytes.length) throw new Error('The image is empty.');
  if (bytes.length > UPLOAD_MAX) throw new Error('The image is too big (400 KB at most).');
  var b = function (i) { return (bytes[i] + 256) % 256; }, ext = null;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) ext = 'png';
  else if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ext = 'jpg';
  else if (bytes.length > 12 && String.fromCharCode(b(0), b(1), b(2), b(3)) === 'RIFF' && String.fromCharCode(b(8), b(9), b(10), b(11)) === 'WEBP') ext = 'webp';
  if (!ext) throw new Error('Only PNG, JPG or WebP images can be uploaded.');
  var path = uploadPath(team, post, q, ext);
  putFile(c, path, Utilities.base64Encode(bytes), 'Manager: ' + name + ' uploaded an image');
  return path;
}

// Create or replace a file (content already base64). Retries once if someone else wrote first.
function putFile(c, path, content, message) {
  for (var attempt = 0; attempt < 2; attempt++) {
    var current = gh(c, '/repos/' + c.repo + '/contents/' + path + '?ref=' + c.branch);
    try {
      gh(c, '/repos/' + c.repo + '/contents/' + path, 'put', { message: message, content: content, branch: c.branch, sha: current ? current.sha : undefined });
      return;
    } catch (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
    }
  }
  throw new Error('Couldn’t save just now. Try again in a moment.');
}

function handle(req) {
  var c = cfg();
  var team = text(req.team, 6).toUpperCase();
  var seasonFile = readJson(c, 'data/season.json');
  if (!seasonFile) throw new Error('Couldn’t read the league data.');
  var season = seasonFile.data;
  checkLogin(season, team, req.email, req.pin);
  if (req.action === 'check') return { ok: true, team: team };
  if (['save', 'news', 'upload'].indexOf(req.action) < 0) throw new Error('Unknown request.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var name = ((season.teams || []).filter(function (t) { return t.code === team; })[0] || {}).name || team;
    if (req.action === 'upload') return { ok: true, path: saveUpload(c, season, team, req, name) };
    var path = 'data/teams/' + team.toLowerCase() + '.json';
    for (var attempt = 0; attempt < 2; attempt++) {
      var current = readJson(c, path), stored = current ? current.data : {};
      var file, what;
      if (req.action === 'save') {
        // Lineup, tactics and press come from the manager; news stays as stored.
        file = clean(season, team, req.file, cleanNews(season, team, stored.news));
        stampPress(file, stored);
        what = text(req.what || 'updated their team', 80);
      } else {
        var news = cleanNews(season, team, stored.news);
        what = applyNews(season, team, news, req);
        file = clean(season, team, stored, news);
      }
      try {
        gh(c, '/repos/' + c.repo + '/contents/' + path, 'put', {
          message: 'Manager: ' + name + ' ' + what,
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
