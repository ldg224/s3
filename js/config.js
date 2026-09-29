// Season settings. This is the only file that needs editing to point the site
// at the live Google Sheet or to reuse the site for a future season.

export const SEASON = {
  number: 3,
  league: 'Heineken C League',
  shortName: 'HCL',
  year: 2026,        // used when a fixture date is written without a year, e.g. "7/11"
  sampleData: true,  // shows a "preview" banner; set to false once real data is in
};

export const POINTS = { win: 3, draw: 1, loss: 0 };

// How long after kick-off a match with no result is shown as live.
export const LIVE_WINDOW_MINUTES = 15;

// One entry per sheet tab. While the Google Sheet is being set up these point at the
// sample files in data/. Once the Sheet exists, replace each with its published CSV link:
// File > Share > Publish to web > pick the tab > "Comma-separated values (.csv)".
export const SOURCES = {
  teams: 'data/teams.csv',
  fixtures: 'data/fixtures.csv',
  players: 'data/players.csv',
  events: 'data/events.csv',
};
