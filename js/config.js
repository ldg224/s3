// Season settings. This is the only file that needs editing to point the site
// at a different Google Sheet or to reuse the site for a future season.

export const SEASON = {
  number: 3,
  league: 'Heineken C League',
  shortName: 'HCL',
  year: 2026, // used when a fixture date is written without a year, e.g. "7/11"
  // Banner shown across the top of the page. Set to '' to hide it.
  notice: 'Preview: showing Season 2 data from the league spreadsheet until the Season 3 sheet is ready.',
};

export const POINTS = { win: 3, draw: 1, loss: 0 };

// 'calculated': ladder is worked out from the scores on the Schedule & Results tab.
// 'sheet': ladder is copied from the Standings tab (use this if you apply manual
//          adjustments such as point deductions or bonus points in the sheet).
export const LADDER = 'calculated';

// How long after kick-off a match with no result is shown as live.
export const LIVE_WINDOW_MINUTES = 15;

// The league Google Sheet, one published CSV link per tab.
// To get a link: File > Share > Publish to web > pick the tab > "Comma-separated values (.csv)".
// For a new season's sheet, only these links need changing.
const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRWLzMxExK_CHV8x6uGcYFuDTKIaIfQIFMMrDz89AbrbBtgt4E22U8lmMyr-p3F-_cZcGPmm1qJSSYN/pub?single=true&output=csv&gid=';

export const SOURCES = {
  teams: SHEET + '0',               // Teams
  fixtures: SHEET + '242746494',    // Schedule & Results
  standings: SHEET + '492816603',   // Standings (only used when LADDER is 'sheet')
  players: SHEET + '1346726150',    // Roster
};
