// Test corpus for js/press-effect.js (readStatement + anti-spam). Spec: docs/PRESS_EFFECT.md.
// Pure data, no imports. Every case is read as if said by the manager of CONTEXT.team, whose
// next opponent is CONTEXT.opponent.
//
// Case shape: { text, kind: 'answer' | 'statement', expect, note }
//   expect maps a signal name to:
//     '+'  the signal should come out clearly positive
//     '-'  the signal should come out clearly negative (used for bipolar signals such as
//          confidence, fans, unity, and for a cue that the text explicitly negates, e.g.
//          "no excuses" -> excuses '-', a warm word about the opponent -> jab '-')
//     '0'  the signal must stay near zero (the cue is absent, sarcastic, or aimed elsewhere)
//   Only the listed signals are checked. Signal names:
//     confidence, arrogance, humility, accountability, excuses, fans, praise, blame, unity,
//     jab (hostility at the next opponent), credible (the jab names something checkable and
//     true per CONTEXT.facts), empty (a jab with no substance or contradicted by the facts),
//     noise (gibberish / too short: the quality gate should drop it).

// A small fixed league context, taken from data/season.json on 2026-09-30.
export const CONTEXT = {
  // Code of the speaking team (FC Turtle, manager Luke Grogan).
  team: 'TUR',
  // Code of the speaking team's next opponent (Lads United, manager Oliver Jamieson).
  opponent: 'LAU',
  // Every team in the league, so a jab at a team that isn't the next opponent can be recognised.
  teams: [
    { code: 'TUR', name: 'FC Turtle', manager: 'Luke Grogan' },
    { code: 'SKS', name: 'SKS FC', manager: 'Sreehari Kottarathil Sandeep' },
    { code: 'CFC', name: 'Cranbourne United FC', manager: 'Luke Sheppard' },
    { code: 'LFC', name: 'Lucky FC', manager: 'Lakshman Devendran' },
    { code: 'NGR', name: 'Tyrone FC', manager: 'Aarav Ganesan' },
    { code: 'LAU', name: 'Lads United', manager: 'Oliver Jamieson' },
  ],
  // Names of the speaking team's players (praise / blame of own players).
  ownPlayers: [
    'Jace Callister', 'Malakai Vance', 'Flynn Broadbent', 'Nestory Irankunda', 'Nate Sterling',
    'Hayden Cross', 'Gideon Boyd', 'Lincoln Heaney', 'Harrison Delbridge', 'Cameron Devlin',
    'Samuel Silvera',
  ],
  // Names of the opponent's players (naming one counts as naming the opponent).
  // Note: 'Harrison' is a first name in both squads (Harrison Delbridge / Harrison Knox).
  oppPlayers: [
    'Declan Rowe', 'Braxton Holt', 'Harrison Knox', 'Cooper Whelan', 'Brodie Giannopoulos',
    'Baxter Lowes', 'Angus Milburn', 'Toby Henderson', 'Liam Rose', 'Marco Tilio', 'Joe Gauci',
  ],
  // Checkable facts that decide whether a jab is credible or empty.
  facts: {
    // true: the opponent is on a losing run ("they've lost three on the trot" is credible).
    oppLosingRun: true,
    // false: the opponent does NOT concede late ("they always concede late" is contradicted).
    oppConcedesLate: false,
    // Opponent players currently suspended ("without Whelan they've got nothing" is credible).
    oppSuspended: ['Cooper Whelan'],
    // Speaking team's pressing setting 0..1; 0.9 is high, so "they can't handle our press" fits.
    ownPressing: 0.9,
    // Speaking team's directness 0..1; 0.3 is low (patient build-up), so "we'll go long and
    // bully them in the air" does not fit our own tactics.
    ownDirectness: 0.3,
    // Speaking team's previous result: 'win' | 'draw' | 'loss'.
    lastResult: 'loss',
  },
};

const A = (text, expect, note) => ({ text, kind: 'answer', expect, note });
const S = (text, expect, note) => ({ text, kind: 'statement', expect, note });

export const CASES = [
  // ---------------------------------------------------------------- confidence
  A("We're ready for this one. The boys have trained well all week and we'll go out there and win it.", { confidence: '+', arrogance: '0', noise: '0' }, 'plain confidence'),
  A("honestly we're confident, no fear going into saturday", { confidence: '+', noise: '0' }, 'no fear = confidence'),
  A("We're not scared of anyone in this league, we'll back ourselves every week.", { confidence: '+', noise: '0' }, 'negation: not scared -> confidence'),
  A("Feeling really good about where we are, we believe we can beat anyone on our day.", { confidence: '+', noise: '0' }, 'intensified belief'),
  S("Big week ahead. We're ready, we're fit and we're going to win this.", { confidence: '+', noise: '0' }, 'statement confidence'),
  A("I think maybe we've got a bit of a chance this week if things go our way.", { confidence: '+', noise: '0' }, 'softened confidence (weak +)'),
  A("We're struggling at the moment, no point hiding it, the confidence just isn't there.", { confidence: '-', noise: '0' }, 'struggling = low confidence'),
  A("to be honest i dont think we've got a chance this week, they're miles better than us", { confidence: '-', noise: '0' }, 'no chance'),
  A("We're low on belief, low on numbers and low on ideas right now.", { confidence: '-', noise: '0' }, 'low belief'),
  A("Not feeling great about this one if I'm honest. We're nervous and it shows.", { confidence: '-', noise: '0' }, 'nervous'),
  A("I can't see us winning this week, the squad is really down.", { confidence: '-', noise: '0' }, 'negated winning'),
  S("tough times at the club, we're scared of another hiding tbh", { confidence: '-', noise: '0' }, 'scared (not negated)'),

  // ---------------------------------------------------------------- arrogance
  A("We'll win 5-0, easy. Nobody in this league can stop us.", { arrogance: '+', confidence: '+' }, 'scoreline + nobody can stop us'),
  A("GUARANTEED WIN THIS WEEK!!! WE ARE THE BEST TEAM IN THE COMP!!!", { arrogance: '+' }, 'all caps + !!! + guarantee'),
  S("Honestly this league is too easy for us, we'll walk over whoever turns up.", { arrogance: '+' }, 'too easy / walk over'),
  A("I guarantee we'll be top of the table by Christmas, write it down.", { arrogance: '+' }, 'guarantee'),
  A("Absolutely nobody can live with us when we play like that, we're unstoppable.", { arrogance: '+' }, 'intensified unstoppable'),
  A("3-0 minimum. Book it. Easiest three points of the season.", { arrogance: '+' }, 'scoreline + easiest'),
  A("We're not getting ahead of ourselves, it's one game at a time and nothing is easy in this league.", { arrogance: '0', humility: '+' }, 'humble, negated easy'),
  A("There's no such thing as an easy game in this comp, every side can hurt you.", { arrogance: '0', humility: '+' }, 'negated easy'),
  A("We'll give it a crack and see what happens, no promises.", { arrogance: '0' }, 'no guarantees'),
  A("I'm not going to predict a score, that's asking for trouble.", { arrogance: '0' }, 'refuses scoreline'),
  A("It won't be easy, I'm not stupid enough to guarantee anything.", { arrogance: '0' }, 'negated guarantee'),
  A("Yeah we'll win 10-0 obviously /s. Nah seriously, it'll be tight.", { arrogance: '0' }, 'sarcastic scoreline /s'),

  // ---------------------------------------------------------------- humility
  A("Full respect to Lads United, they're a tough opponent and we'll need to be at our best.", { humility: '+', jab: '-', arrogance: '0' }, 'respect to opponent'),
  A("One game at a time for us. Nothing's won in September.", { humility: '+' }, 'one game at a time'),
  A("Credit to the other lot last week, they deserved it on the day.", { humility: '+', excuses: '0' }, 'credit to opponent after loss'),
  S("We've got a lot of respect for every side in this league, we're just focused on ourselves.", { humility: '+' }, 'general respect'),
  A("Oliver's done a great job with that group, it'll be a proper test for us.", { humility: '+', jab: '-' }, 'praise opposing manager by name'),
  A("Marco Tilio is a quality player, you have to respect what he does, we'll need to watch him closely.", { humility: '+', jab: '-', praise: '0', blame: '0' }, 'praising OPPONENT player = respect, not own praise'),
  A("We respect nobody. We'll go out and smash whoever is in front of us.", { humility: '0', arrogance: '+' }, 'respect negated'),
  A("Tough opponent? Nah, they're nothing special mate.", { humility: '0' }, 'rhetorical tough opponent dismissed'),
  A("Respect? They'll get respect when they beat us.", { humility: '0' }, 'respect withheld'),
  A("We'll smash them, simple as that.", { humility: '0', arrogance: '+' }, 'no humility'),
  A("Yeah \"tough opponent\" my backside, we'll be fine.", { humility: '0' }, 'scare quotes on tough opponent'),
  A("Could be a tricky one I suppose, they've got some decent players.", { humility: '+' }, 'softened respect'),

  // ---------------------------------------------------------------- accountability
  A("That's on me. I got the tactics wrong and I take full responsibility.", { accountability: '+', excuses: '0' }, 'my fault / responsibility'),
  A("We weren't good enough last week, simple as that. We'll learn from it.", { accountability: '+' }, 'not good enough + learn'),
  A("No excuses from us, we were second best and we know it.", { accountability: '+', excuses: '-' }, 'no excuses (negation)'),
  A("My fault, I picked the wrong team. We'll be better.", { accountability: '+' }, 'my fault'),
  S("We let ourselves down and we let the fans down. That's on all of us.", { accountability: '+', fans: '+' }, 'collective accountability + fans'),
  A("Not good enough. Not even close. We have to be way better than that.", { accountability: '+', confidence: '0' }, 'negated good'),
  A("I'm not going to stand here and say it was my fault, it wasn't.", { accountability: '-' }, 'negated my fault'),
  A("Nothing we could've done differently, it just wasn't our day.", { accountability: '0' }, 'denies responsibility, no cue'),
  A("I don't take responsibility for that, the players know what they did.", { accountability: '-', blame: '+' }, 'refuses responsibility, blames players'),
  A("We played fine, I wouldn't change a thing.", { accountability: '0' }, 'no accountability'),
  A("Not my fault mate, ask the ref.", { accountability: '-', excuses: '+' }, 'negated fault + ref excuse'),
  A("Can't complain really, we got what we deserved.", { accountability: '+', excuses: '0' }, "can't complain (negated complain)"),

  // ---------------------------------------------------------------- excuses
  A("The referee cost us the game, simple as that. Robbed.", { excuses: '+', accountability: '0' }, 'ref + robbed'),
  A("pitch was a bog, couldnt pass it 2 metres. no chance of playing football on that", { excuses: '+' }, 'pitch excuse, lowercase'),
  A("Unlucky again. Hit the post twice, their keeper had the game of his life.", { excuses: '+' }, 'luck excuse'),
  A("The schedule is a joke, three games in a week and nobody else has to do it. Unfair.", { excuses: '+' }, 'schedule / unfair'),
  A("Wind was ridiculous, 40k gusts, impossible to play in.", { excuses: '+' }, 'weather excuse'),
  A("Yeah great refereeing again 🙄 absolutely spot on as always", { excuses: '+', confidence: '0', praise: '0' }, 'sarcastic ref praise = excuse'),
  A("Nothing to do with the ref, we were just poor.", { excuses: '-', accountability: '+' }, 'negated ref excuse'),
  A("I won't blame the pitch or the weather, both teams played on it.", { excuses: '-', accountability: '+' }, 'refuses excuses'),
  A("Luck had nothing to do with it, they were better.", { excuses: '-', humility: '+' }, 'negated luck'),
  A("No complaints about the officials, the ref had a decent game.", { excuses: '-' }, 'no complaints about ref'),
  A("We don't do excuses at this club.", { excuses: '-' }, "don't do excuses"),
  A("I thought the ref was a bit harsh maybe, but whatever, move on.", { excuses: '+' }, 'softened ref excuse (weak +)'),

  // ---------------------------------------------------------------- fans
  A("Massive thanks to the fans who came out in the rain, you were unreal.", { fans: '+' }, 'thanks fans'),
  S("This one's for the supporters. You deserve so much better than what we've given you.", { fans: '+' }, 'for the supporters'),
  A("Sorry to the fans, that wasn't acceptable. We owe you one.", { fans: '+', accountability: '+' }, 'apology to fans'),
  A("shoutout to everyone who travelled, absolute legends 🙌", { fans: '+' }, 'shoutout travelling fans with emoji'),
  A("The support has been incredible all year, we never take it for granted.", { fans: '+' }, 'support incredible'),
  A("Never been prouder of this club and the people who turn up every week.", { fans: '+' }, 'negation: never been prouder = +'),
  A("Some of our so-called fans need to have a look at themselves. Booing your own team is pathetic.", { fans: '-' }, 'criticising fans'),
  A("If the fans don't like it they can stay home.", { fans: '-' }, 'dismissing fans'),
  A("The crowd was dead, honestly embarrassing support, we got nothing from them.", { fans: '-' }, 'crowd blamed'),
  A("I don't care what the supporters think, I pick the team.", { fans: '-' }, "don't care about supporters"),
  A("Fans on socials are clueless, they've never kicked a ball.", { fans: '-' }, 'fans clueless'),
  A("Yeah thanks to the 'fans' who left at half time 🙄", { fans: '-' }, 'sarcastic thanks, scare quotes'),

  // ---------------------------------------------------------------- praise of own players
  A("Jace Callister was brilliant, two goals and ran himself into the ground.", { praise: '+', blame: '0' }, 'named praise'),
  A("Nate Sterling kept us in it, some of those saves were world class.", { praise: '+' }, 'named GK praise'),
  A("Really proud of Lincoln Heaney today, outstanding in the middle of the park.", { praise: '+' }, 'intensified named praise'),
  A("Big shout to Flynn and Cameron, they were everywhere.", { praise: '+' }, 'first names only'),
  A("The boys were outstanding, every single one of them.", { praise: '+', unity: '+' }, 'unnamed praise'),
  A("Irankunda is a different class, best player on the pitch by a mile.", { praise: '+' }, 'surname praise'),
  A("Hayden Cross wasn't great, I'll be honest.", { praise: '0', blame: '+' }, 'negated great on named player'),
  A("Silvera was 'brilliant' again, missed three sitters.", { praise: '0', blame: '+' }, 'scare-quoted praise'),
  A("Declan Rowe is a brilliant player, we'll have to keep him quiet.", { praise: '0', humility: '+', jab: '-' }, 'praise of OPPONENT player is not own praise'),
  A("We need more from everyone, nobody stood out.", { praise: '0' }, 'no one praised'),

  // ---------------------------------------------------------------- blame of own players
  A("Malakai Vance cost us today, that red card was stupid and he knows it.", { blame: '+', praise: '0' }, 'named blame'),
  A("Gideon Boyd was a disaster at the back, gave away both goals.", { blame: '+' }, 'named blame, disaster'),
  A("Some players just didn't turn up. They know who they are.", { blame: '+', unity: '-' }, 'unnamed blame + division'),
  A("Delbridge was asleep for the second, can't defend like that.", { blame: '+' }, 'surname blame'),
  A("A couple of the lads were lazy, not good enough from them.", { blame: '+' }, 'unnamed blame'),
  A("I'm not going to single anyone out, we lose together.", { blame: '-', unity: '+' }, 'refuses to blame'),
  A("Not blaming Harrison Delbridge for that at all, he was left exposed.", { blame: '-' }, 'negated named blame'),
  A("Nobody is to blame except me.", { blame: '-', accountability: '+' }, 'shields players'),
  A("Braxton Holt was terrible for them, we should have exploited it more.", { blame: '0', jab: '+' }, 'criticising OPPONENT player is not own blame'),

  // ---------------------------------------------------------------- unity
  A("We're a family at this club, we stick together no matter what.", { unity: '+' }, 'family / together'),
  A("The lads are all pulling in the same direction, the group is tight.", { unity: '+' }, 'the lads'),
  S("Together we're stronger. Win, lose or draw, we do it as a team.", { unity: '+' }, 'together'),
  A("The dressing room is buzzing, everyone's backing each other.", { unity: '+' }, 'dressing room good'),
  A("Great spirit in the squad, the new boys have fitted in really well.", { unity: '+' }, 'spirit'),
  A("We've got an attitude problem in this squad and I'm sick of it.", { unity: '-' }, 'attitude problem'),
  A("A few of them aren't committed. If they don't want to be here, the door's open. Transfer list.", { unity: '-' }, 'not committed / transfer list'),
  A("There's a split in the dressing room, no point pretending otherwise.", { unity: '-' }, 'split'),
  A("Some players care more about their stats than the team.", { unity: '-' }, 'some players'),
  A("We're not together at the moment, it's every man for himself out there.", { unity: '-' }, 'negated together'),
  A("Yeah we're a 'family' alright, half of them didn't show up to training.", { unity: '-' }, 'scare-quoted family'),

  // ---------------------------------------------------------------- jabs at LAU: credible
  A("Lads United have lost three on the bounce, they'll be feeling it. We'll be all over them.", { jab: '+', credible: '+', empty: '0' }, 'credible: losing run (fact true)'),
  A("Without Cooper Whelan they've got nobody to link it up, and he's suspended. Big miss for them.", { jab: '+', credible: '+', empty: '0' }, 'credible: suspended player named'),
  A("Lads United can't handle our press. We'll squeeze them high and they'll crack.", { jab: '+', credible: '+', empty: '0' }, 'credible: pressing claim, ownPressing 0.9'),
  A("i know that lads united dont play well under our attacking pressure", { jab: '+', credible: '+', empty: '0', noise: '0' }, "USER'S SPAM EXAMPLE: credible-ish tactical jab (pressing 0.9); lowercase, no apostrophes"),
  A("Jamieson's lot are on a shocker of a run, the confidence must be through the floor.", { jab: '+', credible: '+' }, 'credible: losing run via manager name'),
  A("LAU without Whelan in midfield? Can't wait. Our high press will eat them alive.", { jab: '+', credible: '+' }, 'credible: code + suspension + press'),
  A("Their keeper Joe Gauci hates being pressed, we'll be on him all day.", { jab: '+', credible: '+' }, 'credible: press claim via opponent player'),
  A("Lads United are in freefall, lost their last few and they know it.", { jab: '+', credible: '+' }, 'credible: losing run paraphrased'),

  // ---------------------------------------------------------------- jabs at LAU: empty / contradicted
  A("Lads United are rubbish. Pub team. Always have been.", { jab: '+', empty: '+', credible: '0' }, 'empty insult'),
  A("lads united are a joke lol 😂😂", { jab: '+', empty: '+', credible: '0' }, 'empty insult with emoji'),
  A("Lads United always concede late, they'll fold in the last ten minutes like always.", { jab: '+', empty: '+', credible: '0' }, 'contradicted: oppConcedesLate false'),
  A("Oliver Jamieson couldn't manage a bath. Clueless.", { jab: '+', empty: '+' }, 'empty insult at manager'),
  A("Their best player is Cooper Whelan and we'll have him in our pocket.", { jab: '+', empty: '+', credible: '0' }, 'contradicted: Whelan is suspended, won\'t play'),
  A("We'll go long and bully Lads United in the air all day.", { jab: '+', empty: '+', credible: '0' }, 'contradicted: ownDirectness 0.3 (not a long-ball side)'),
  A("Lads United are flying at the moment, they'll be full of it.", { jab: '0' }, 'contradicted fact but not a jab (compliment of form)'),
  S("LADS UNITED ARE SOFT!!! WE'LL EMBARRASS THEM!!!", { jab: '+', empty: '+', arrogance: '+' }, 'empty + arrogant caps'),

  // ---------------------------------------------------------------- jabs at teams that AREN'T the opponent
  A("SKS FC are a pub team, no idea how they're above us.", { jab: '0' }, 'insult at SKS, not next opponent'),
  A("Cranbourne United always concede late, everyone knows that.", { jab: '0', credible: '0', empty: '0' }, 'late-goals claim about CFC, not LAU'),
  A("Lucky FC are called lucky for a reason, jammy lot.", { jab: '0' }, 'jab at Lucky FC'),
  A("Tyrone FC can't handle a high press, we showed that last month.", { jab: '0', credible: '0' }, 'tactical jab at wrong team'),
  A("Luke Sheppard's side are all talk, nothing else.", { jab: '0' }, 'jab at CFC manager, not LAU'),
  A("Harrison was poor for us today, needs to lift.", { jab: '0', blame: '+' }, 'Harrison = own Delbridge? ambiguous first name, must not count as a LAU jab'),

  // ---------------------------------------------------------------- warmth toward the opponent
  A("Good luck to Oliver and the Lads United boys, should be a great game.", { jab: '-', humility: '+' }, 'friendly toward opponent'),
  A("Lads United have been a bit unlucky lately, I'm sure they'll turn it around.", { jab: '-', humility: '+' }, 'sympathy for losing run (true fact, not a jab)'),
  A("Hope Cooper Whelan is back soon, great player and a good bloke.", { jab: '-', credible: '0' }, 'suspended player mentioned kindly'),

  // ---------------------------------------------------------------- sarcasm
  A("Sure, we'll definitely win 10-0 /s", { confidence: '0', arrogance: '0' }, '/s flips scoreline'),
  A("Yeah right, we're definitely title contenders after that performance.", { confidence: '0' }, 'yeah right'),
  A("Oh brilliant, another \"great\" defensive display. Love conceding four.", { praise: '0', confidence: '0' }, 'sarcastic brilliant + scare quotes'),
  A("Loved every second of that, what a treat to lose at home again 🙄", { confidence: '0' }, 'sarcasm with eye-roll'),
  A("Sure... we'll be fine. Totally fine.", { confidence: '-' }, 'sure... sarcasm: sarcastic reassurance reads as low confidence'),
  A("\"Tough opponent\", \"one game at a time\", blah blah, you know the script.", { humility: '0' }, 'mocking cliches in quotes'),

  // ---------------------------------------------------------------- intensifiers / softeners (paired)
  A("We were absolutely, really outstanding today, very proud of every player.", { praise: '+', unity: '+' }, 'intensified praise'),
  A("We were maybe a bit ok today I suppose.", { praise: '0' }, 'softened to nothing'),
  A("I'm absolutely devastated for the fans, they deserved so much more.", { fans: '+' }, 'intensified fans'),
  A("Really, really not good enough from me. Totally my responsibility.", { accountability: '+' }, 'intensified accountability'),

  // ---------------------------------------------------------------- mixed
  A("Full respect to Lads United, they're a good side, but we're ready and we believe we'll win.", { humility: '+', confidence: '+', jab: '-' }, 'humble + confident'),
  A("The ref had a shocker, but honestly we weren't good enough either, that's on me.", { excuses: '+', accountability: '+' }, 'excuse + accountability'),
  A("Proud of the lads, gutted for the fans, and the ref was a joke. Mixed day.", { unity: '+', fans: '+', excuses: '+' }, 'three signals'),
  A("Jace Callister was brilliant but Gideon Boyd needs to wake up.", { praise: '+', blame: '+' }, 'praise one player, blame another'),
  A("We'll beat Lads United, their losing run won't stop now, but credit to Oliver, he's a good manager.", { confidence: '+', jab: '+', credible: '+', humility: '+' }, 'credible jab + respect'),
  A("Unlucky today, no doubt, but no excuses, we have to finish our chances.", { excuses: '0', accountability: '+' }, 'luck mention then no excuses'),
  A("Thanks to the fans, sorry we let you down, we'll learn and come back stronger together.", { fans: '+', accountability: '+', unity: '+' }, 'fans + accountability + unity'),

  // ---------------------------------------------------------------- long rambling but fine
  A("Look, it's been a funny old week. We came off the loss last Saturday and I told the boys on Tuesday night that we can't dwell on it, you look at the video, you see where it went wrong, you fix it and you move on. We've had a few knocks, Hayden's been carrying a hamstring, but the lads have been brilliant at training, the energy's been good, and I think if we keep the ball like we did in the first half last week we'll be right. Lads United are a decent side, Oliver's got them organised, so it's going to be a proper game. We'll respect them but we're not going there to make up the numbers.", { humility: '+', confidence: '+', unity: '+', noise: '0' }, 'long ramble, coherent'),
  S("Bit of an update from the club. First up, thanks heaps to everyone who helped out at the sausage sizzle on Sunday, we raised enough for new training bibs which the boys are pretty chuffed about. Training's moved to Thursday this week because of the ground works. On the footy side, we're disappointed with last week, that one's on me, I set us up wrong and we paid for it. We'll be better. Lincoln Heaney has been our best player for a month now and deserves a mention. Come down Saturday, bring a chair, it'll be a cracker.", { fans: '+', accountability: '+', praise: '+', noise: '0' }, 'long club update'),
  A("Yeah so obviously it's disappointing, we wanted to win, everyone wants to win, but at the end of the day it's football and sometimes the ball doesn't bounce your way and you've just got to take it on the chin and go again next week, that's all you can do really, go again, work hard, and hopefully the results will come if we keep doing the right things.", { accountability: '+', noise: '0' }, 'cliche-heavy but fine'),

  // ---------------------------------------------------------------- noise
  A("asdfgh", { noise: '+' }, 'keyboard mash'),
  A("ok", { noise: '+' }, 'one word'),
  A("lol lol lol lol", { noise: '+' }, 'one word repeated'),
  A("yeah good game", { noise: '+' }, 'three words'),
  A("we'll see mate", { noise: '+' }, 'three words'),
  A("no comment.", { noise: '+' }, 'two words'),
  A("1 2 3 4 5 6 7 8 9 10 11 12 13 14", { noise: '+' }, 'pasted numbers'),
  A("3-1 2-2 0-0 4-1 1-0 5-2 2-1 3-3", { noise: '+' }, 'pasted scorelines'),
  A("qwerty qwerty uiop asdf jkl", { noise: '+' }, 'mash with spaces'),
  A("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!", { noise: '+' }, 'punctuation only'),
  A("😂😂😂😂😂😂😂😂😂😂", { noise: '+' }, 'emoji only'),
  A("aaaaaaaaaaaaaaaaaaaaaaa", { noise: '+' }, 'one letter repeated'),
  A("test test test test test test test", { noise: '+' }, 'one word repeated 7x (>=6 words but not real)'),
  A("Good win, proud of the boys today.", { noise: '0', praise: '+' }, 'short but real (7 words)'),
  A("We go again next week, the lads will be ready.", { noise: '0', confidence: '+' }, 'short but real'),
];

// Anti-spam groups. expect 'dedupe': the items are near-duplicates and should count once
// (the rest become spam). expect 'distinct': different statements that share words; each counts.
const base = 'i know that lads united dont play well under our attacking pressure';

export const SPAM_SETS = [
  {
    items: [
      base,
      'I know that Lads United dont play well under our attacking pressure.',
      "i know lads united don't play well under our attacking pressure",
      'i know that lads utd dont play well under our attacking pressure!!',
      'I KNOW THAT LADS UNITED DONT PLAY WELL UNDER OUR ATTACKING PRESSURE',
      'i know that lads united dont play well under our attacking pressure lol',
      'we know that lads united dont play well under our attacking pressure',
      'i know that lads united dont play good under our attacking pressure',
      'i know that lads united really dont play well under our attacking pressure',
      'i know that lads united dont play well under our high attacking pressure',
      'i know lads united dont play well under attacking pressure',
      'honestly i know that lads united dont play well under our attacking pressure',
      'i know that lads united dont play well under our attacking pressure 😂',
      'i know that the lads united dont play well under our attacking pressure',
      'i know that lads united dont play very well under our attacking pressure',
      'i just know that lads united dont play well under our attacking pressure',
      'i know that lads united dont play well under our pressure',
      'i know that lads united dont play well under all our attacking pressure',
      'i know for sure that lads united dont play well under our attacking pressure',
      'i know that lads united dont play well under our attacking pressure. again.',
    ],
    expect: 'dedupe',
    note: "the user's spam example x20 with small variations: should count once, 19 spam",
  },
  {
    items: [
      'Thanks to all the fans who came out today, you were amazing.',
      'Thanks to all the fans who came out today you were amazing!!',
      'thanks to all the fans that came out today, you were amazing',
      'Big thanks to all the fans who came out today, amazing.',
    ],
    expect: 'dedupe',
    note: 'fan thanks repeated with punctuation/wording tweaks',
  },
  {
    items: [
      "We'll win 5-0 easy, nobody can stop us.",
      "We'll win 5-0, easy. Nobody can stop us!",
      'we will win 5-0 easy nobody can stop us',
      "We'll win 6-0 easy, nobody can stop us.",
    ],
    expect: 'dedupe',
    note: 'arrogant claim repeated, scoreline tweaked',
  },
  {
    items: [
      'The referee cost us the game, robbed again.',
      'Referee cost us the game. Robbed again!',
      'the ref cost us the game, robbed again',
    ],
    expect: 'dedupe',
    note: 'excuse repeated (ref / referee)',
  },
  {
    items: [
      'Thanks to the fans for coming out, you were brilliant today.',
      'Jace Callister was brilliant today, two goals and a man of the match display.',
      'Lads United have lost three on the bounce and will be low on confidence.',
      'That loss was on me today, I got the team selection wrong.',
    ],
    expect: 'distinct',
    note: 'different statements sharing words (today, brilliant, loss)',
  },
  {
    items: [
      'Lads United cannot handle our press, we will squeeze them high.',
      'Lads United are on a losing run and it shows in their play.',
      'Lads United will be without Cooper Whelan, who is suspended.',
    ],
    expect: 'distinct',
    note: 'three different credible jabs at the same team: distinct (the mind-games budget caps them, not dedupe)',
  },
  {
    items: [
      'We were not good enough today and I take responsibility for that.',
      'We were good enough today to win, and the lads deserve credit for that.',
    ],
    expect: 'distinct',
    note: 'high word overlap but opposite meaning via negation (cue sets differ)',
  },
  {
    items: [
      'Proud of the boys, great effort from everyone, together we go again.',
      'Proud of the fans, great support from everyone, thanks for coming.',
    ],
    expect: 'distinct',
    note: 'same frame, different target (players vs fans)',
  },
];
