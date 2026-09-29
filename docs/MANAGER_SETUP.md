# Manager Hub setup (about 5 minutes, once)

Managers sign in at **manager.html** with an email and PIN you choose. They can set their
lineup, formation, tactics and set pieces, see their players' season ratings, and answer
questions from the media (published in the **Press room**).

The website is public and has no server, so managers' saves go through a small free
Google Apps Script on your Google account. It checks the manager's email and PIN, and can only
save that manager's own team file (`data/teams/<code>.json`). Your GitHub key is kept inside
the script, never on the website.

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

## Notes

- **Changing the script later:** if `tools/manager-relay.gs` is updated, paste the new version in,
  then **Deploy** → **Manage deployments** → edit (pencil) → Version: **New version** → Deploy.
  The URL stays the same.
- **Forgotten PINs:** set a new login for that team in edit mode. The old PIN stops working
  straight away.
- **Wrong guesses:** after 8 wrong PINs for a team, that team's saves are locked for 15 minutes.
- **What managers can't do:** change results, fixtures, other teams or anything else. The script
  only writes their own team file, and only with valid players from their own squad.
