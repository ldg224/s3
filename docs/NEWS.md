# League news, forms and polls

League news is written in edit mode (`admin.html`, News tab), shown prominently in every manager
portal (`manager.html`), and on the public site. Posts look like Discord embeds (Discohook
style) and can carry live blocks (mini table, fixtures, team card, poll) and a form.

## Where things are stored

| What | Where | Written by |
|---|---|---|
| Posts, templates, admin reviews | `data/season.json` → `news`, `news_templates` | edit mode (GitHub token) |
| A team's read receipts, votes, form answers | `data/teams/<code>.json` → `news` | manager portal via the relay |
| Images uploaded in a form (e.g. a new logo) | `data/uploads/<code>/<post id>-<question id>.<png\|jpg\|webp>` | relay (`upload` action) |
| Images in posts | any `https://` URL, or `assets/news/<file>` uploaded in edit mode | edit mode |

Timestamps (`sent`, `updated`, `read`, `submitted`, `reviews[].at`) are UTC without a zone,
`new Date().toISOString().slice(0, 19)`, read with `parseStamp()` from `js/ui.js`, like
`season.updated`. The deadline `due` is local `{date, time}`, read with `kickoff()` from `js/data.js`.

## Post (`season.news[]`)

```json
{
  "id": "n-lx3k9a",
  "status": "draft",
  "sent": null,
  "updated": "2026-09-30T10:15:00",
  "pinned": false,
  "visibility": "managers",
  "audience": "all",
  "due": { "date": "2026-10-05", "time": "18:00" },
  "ack": true,
  "blocks": [],
  "form": null,
  "reviews": {}
}
```

- `status`: `draft` (edit mode only), `live` (sent: visible, form and polls open),
  `closed` (still visible, form and polls closed). Enable/disable = `live` ⇄ `closed`.
- `sent`: when it first went live. Sort newest first; `pinned` posts come before all others.
- `visibility`: `public` shows the whole post on the public site. `managers` shows only a teaser
  there: the first embed's colour, author, title and "View more information in your manager
  portal" linking to `manager.html#news/<id>`. Forms and poll voting only ever work in the portal;
  the public site shows neither the form nor who voted.
- `audience`: `"all"` or a list of team codes. Portals outside the audience don't show the post.
  The public site ignores the audience.
- `due`: optional deadline. The portal shows "Due in 2 days", which turns red when overdue. Late
  answers are still accepted and marked late.
- `ack`: ask for a "Got it" read receipt. `read` is only written by that tap, so edit mode shows
  who has read a post only when `ack` is on. For other posts the portal tracks "seen" in the
  browser (localStorage), just for its unread badge.
- `reviews`: `{ "TUR": { "status": "applied" | "rejected", "at": "<time>", "note": "" } }`, set in
  edit mode. `rejected` with a note asks the team to change and resubmit.

### Blocks (`post.blocks[]`, rendered in order)

```json
{ "type": "embed", "colour": "#5865f2",
  "author": { "name": "vLeague", "icon": "", "url": "" },
  "title": "", "url": "", "description": "markdown",
  "fields": [ { "name": "", "value": "markdown", "inline": true } ],
  "thumbnail": "", "image": "",
  "footer": { "text": "", "icon": "" }, "timestamp": true,
  "buttons": [ { "label": "", "url": "", "style": "primary" } ] }
{ "type": "table", "title": "", "rows": 0 }
{ "type": "fixtures", "week": 3, "title": "" }
{ "type": "team", "team": "TUR", "title": "" }
{ "type": "poll", "id": "p1", "question": "", "options": ["", ""], "results": "after_vote" }
```

- `timestamp: true` shows `sent` in the footer. `buttons[].style`: `primary` | `secondary` | `link`.
- `table`: live simplified ladder (Pos, Team, P, GD, Pts) from `ladder()`. `rows: 0` shows every team.
- `fixtures.week`: a number, or `"next"` (the first week with a match that hasn't kicked off).
- `poll.results`: `after_vote` | `after_close` | `never`. Only managers vote, one vote per team.
  Totals are shown to managers per this setting, and on the public site only after close.

**Markdown** (descriptions, field values, form intro and help): `**bold**`, `*italic*`,
`__underline__`, `~~strike~~`, `` `code` ``, `||spoiler||`, `[text](https://…)`, `> quote`,
`- list`, `# / ## / ###` headings, line breaks. Always escaped, and links are http(s) only.
Placeholders are replaced for the viewing team: `{team}`, `{manager}`, `{due}`. On the public
site `{team}` and `{manager}` become "your team" and "manager".

## Form (`post.form`)

```json
{
  "kind": "registration",
  "intro": "markdown",
  "submit": "Submit registration",
  "edit_after_submit": true,
  "review": true,
  "questions": [
    { "id": "q1", "type": "short", "label": "Team name", "help": "", "required": true,
      "options": [], "min": null, "max": null, "maxlen": 40, "map": "team.name" }
  ]
}
```

- `kind`: `registration` | `custom`. Registration always has `review: true`.
- Question `type`: `short`, `long`, `number` (min/max), `choice` (radio), `multi` (checkboxes,
  value is an array), `dropdown`, `checkbox` (a single yes/no, value is a boolean), `colour`
  (`#rrggbb`), `image` (value is the uploaded repo path), `date` (`YYYY-MM-DD`), `player`
  (a player id from that team's squad).
- `map` (optional) links a question to a team field. The portal prefills it with the team's
  current value, and approving in edit mode writes it to the team:
  `team.name`, `team.manager`, `team.colour`, `team.colour2`, `team.logo` (image →
  `assets/teams/<code>.png`), `team.logo_alt` (image → `assets/teams/<code>-alt.png`).
- `edit_after_submit`: the manager can change their answers while the post is `live`. A new
  submission clears any earlier `rejected` review.

## Team file (`data/teams/<code>.json` → `news`)

```json
"news": {
  "n-lx3k9a": {
    "read": "2026-09-30T11:02:00",
    "votes": { "p1": 1 },
    "answers": { "q1": "Turtle FC", "q4": "data/uploads/tur/n-lx3k9a-q4.png" },
    "submitted": "2026-09-30T11:05:00"
  }
}
```

The relay's `save` action ignores `news` from the client and keeps what is stored, so a lineup
save can never undo a submission. News changes go through their own action, which reads the
current team file, merges only that post's entry and commits:

`{ action: "news", team, email, pin, post, op, ... }` with `op`:
- `read`: sets `read`.
- `vote` (`poll`, `option`): one vote per team per poll. Votes are final, and a closed poll takes none.
- `submit` (`answers`): checks every answer against its question (type, options, lengths, player
  in squad) and sets `submitted`. It also works while the post is `live` and
  `edit_after_submit` is on.

It returns `{ ok, file }`. The relay also drops entries for posts that no longer exist or no
longer target the team.

**Outstanding** (portal banner, badge): only `live` posts, for a team:
- `form`: not submitted yet.
- `ack`: "Got it" not tapped.
- `resubmit`: a `rejected` review newer than `submitted`.
- `poll`: a poll the team hasn't voted in.

"Late" is computed as `submitted` after `dueAt(post)`. Nothing extra is stored.

### Relay `upload` action

Request: `{ action: "upload", team, email, pin, post, question, type, data }`. `data` is base64.
The client resizes to at most 512×512 first. Accepted when the post is live for this team, the
question is an `image`, the type is PNG, JPEG or WebP (checked by magic bytes), and the file is
at most 400 KB. The relay writes `data/uploads/<code>/<post>-<question>.<ext>` and returns
`{ ok, path }`. The upload happens when the manager picks the file; the answer holds the path
once they submit. Re-uploads overwrite the same path.

## Shared module `js/news.js` (no DOM access at import time)

```js
renderPost(post, season, { mode, team, teamFile, now })  // HTML string
  // mode 'preview' (edit mode: portal look, inputs disabled) | 'portal' | 'public'
  // opts.src(path) -> url for every image (edit mode previews uncommitted uploads); default identity
markdown(text, vars)                  // safe HTML
postsFor(season, team)                // live + closed posts for a portal: pinned first, then newest sent
publicPosts(season)                   // live + closed posts for the public site, same order
outstanding(season, team, teamFile, now)
  // [{ post, reasons: ['form'|'ack'|'resubmit'|'poll'], due: Date|null, overdue }]
dueAt(post)                           // Date | null
teamValue(season, code, map)          // current value of a map field (team.logo -> 'assets/teams/<code>.png')
QUESTION_TYPES, BLOCK_TYPES, TEAM_FIELDS   // labels for the editors
```

Styles for posts live in `css/news.css`, which admin, manager and the public pages all load.
