# Manager Hub setup (about 5 minutes, once)

Managers sign in at **manager.html** with an email and PIN you choose. They read **League news**
(the first tab: announcements, polls and forms from edit mode), set their lineup, formation,
tactics and set pieces, see their players' season ratings, and answer questions from the media
(published in the **Press room**).

The website is public and has no server, so managers' saves go through a small free
Google Apps Script on your Google account. It checks the manager's email and PIN, and can only
save that manager's own team file (`data/teams/<code>.json`) and images they upload in a news
form (`data/uploads/<code>/`). Your GitHub key is kept inside the script, never on the website.

## 1. Make a GitHub key for the script

1. Open <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
2. Name: `HCL manager relay`. Expiration: the end of the season (or longer).
3. Repository access: **Only select repositories** → `ldg224/s3`.
4. Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
5. Generate, and copy the token (it starts with `github_pat_`).

## 2. Create the script

1. Open <https://script.google.com> and click **New project**. Name it `HCL manager relay`.
2. Delete the sample code, and paste in everything from
   [`tools/manager-relay.gs`](../tools/manager-relay.gs).
3. Click the save icon.
4. Click **Project Settings** (the gear icon) → **Script properties** → **Add script property**:
   - Property: `GITHUB_TOKEN`, Value: the token from step 1.
   - Save.

## 3. Publish it as a web app

1. Click **Deploy** → **New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Execute as: **Me**. Who has access: **Anyone**.
4. Click **Deploy**, then **Authorize access** and allow it. (Google warns that the app
   isn't verified: click **Advanced** → **Go to HCL manager relay**. It's your own script.)
5. Copy the **Web app URL** (it ends in `/exec`).

## 4. Connect it to the site

1. On the site, open edit mode → **Settings** → **Manager Hub**, paste the URL, and click
   **Test the link**. It should say "✓ The relay is working".
2. Go to **Teams**, open each team, and under **Manager login** enter the manager's email
   and a PIN (4+ digits), then click **Set login**. Send each manager their email, their PIN,
   and the link to `manager.html`.

That's it. Each manager save appears in the site's GitHub history as
"Manager: <team> …" and goes live within about a minute.

## Updating the script for League news (September 2026)

The League news feature needs the new version of the script: it adds "Got it" read receipts,
poll votes, form answers and image uploads. Until you update it, managers can still read news,
but those buttons show an error.

1. Open <https://script.google.com> → **HCL manager relay**.
2. Select all the code in `Code.gs` and delete it. Paste in everything from
   [`tools/manager-relay.gs`](../tools/manager-relay.gs), then click the save icon.
3. **Deploy** → **Manage deployments** → click the pencil (edit) on the existing deployment →
   Version: **New version** → **Deploy**. Don't create a new deployment: the URL must stay the same.
4. On the site, edit mode → **Settings** → **Manager Hub** → **Test the link**. It should still say
   "✓ The relay is working".

No new permissions or script properties are needed. The GitHub key only needs **Contents: Read
and write** on `ldg224/s3`, as before.

## Notes

- **Changing the script later:** if `tools/manager-relay.gs` is updated, paste the new version in,
  then **Deploy** → **Manage deployments** → edit (pencil) → Version: **New version** → Deploy.
  The URL stays the same.
- **Forgotten PINs:** set a new login for that team in edit mode. The old PIN stops working
  straight away.
- **Wrong guesses:** after 8 wrong PINs for a team, that team's saves are locked for 15 minutes.
- **What managers can't do:** change results, fixtures, other teams or anything else. The script
  only writes their own team file, and only with valid players from their own squad.
- **League news:** managers can only answer posts that are live and sent to their team. The script
  checks every answer against its question, allows one poll vote per team, and only accepts PNG,
  JPG or WebP images up to 400 KB (the portal shrinks them to 512 px first). A lineup save never
  changes a team's news answers. Answers to a registration form change nothing until you approve
  them in edit mode (News tab).
