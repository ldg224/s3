// Held-out test set for the press-statement reader (js/press-effect.js, readStatement).
// Written independently of the reader and of tools/press-effect-cases.js, from docs/PRESS_EFFECT.md only.
// Facts deliberately differ from the tuning set: LAU is NOT on a losing run, DOES concede late,
// nobody is suspended, our pressing is LOW (0.3), our directness is HIGH (0.85), we WON last time.
// So: "they can't handle our press" = empty; "they fade late" = credible; "we'll go long / in behind" =
// credible; "their losing run" = empty; "X is suspended" = empty.

export const CONTEXT = {
  team: 'TUR', opponent: 'LAU',
  teams: [
    { code: 'TUR', name: 'FC Turtle', manager: 'Luke Grogan' },
    { code: 'SKS', name: 'SKS FC', manager: 'Sreehari Kottarathil Sandeep' },
    { code: 'CFC', name: 'Cranbourne United FC', manager: 'Luke Sheppard' },
    { code: 'LFC', name: 'Lucky FC', manager: 'Lakshman Devendran' },
    { code: 'NGR', name: 'Tyrone FC', manager: 'Aarav Ganesan' },
    { code: 'LAU', name: 'Lads United', manager: 'Oliver Jamieson' },
    { code: 'RT1', name: 'Reserved Team #1', manager: 'Contact Admin For Details' },
    { code: 'RT2', name: 'Reserved Team #2', manager: 'Contact Admin For Details' },
  ],
  ownPlayers: [
    'Jace Callister', 'Malakai Vance', 'Flynn Broadbent', 'Nestory Irankunda', 'Nate Sterling',
    'Hayden Cross', 'Gideon Boyd', 'Lincoln Heaney', 'Harrison Delbridge', 'Cameron Devlin',
    'Samuel Silvera',
  ],
  oppPlayers: [
    'Declan Rowe', 'Braxton Holt', 'Harrison Knox', 'Cooper Whelan', 'Brodie Giannopoulos',
    'Baxter Lowes', 'Angus Milburn', 'Toby Henderson', 'Liam Rose', 'Marco Tilio', 'Joe Gauci',
  ],
  facts: { oppLosingRun: false, oppConcedesLate: true, oppSuspended: [], ownPressing: 0.3, ownDirectness: 0.85, ownWidth: 0.5, lastResult: 'win' },
};

export const CASES = [
  // ---------- credible jabs at LAU (true under these facts) ----------
  { text: 'Lads United have leaked goals late all season, so if we keep going for the full ninety our chance will come.', kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'late goals conceded: true here' },
  { text: "Jamieson's mob fade badly in the last fifteen, everyone's seen it. We'll be the fitter side at the death.", kind: 'answer', expect: { jab: '+', credible: '+', confidence: '+' }, note: 'manager surname + fade late' },
  { text: "their back line is slow on the turn so we're gonna go long and get in behind Knox all arvo", kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'direct play fits high directness; player surname' },
  { text: 'LAU always switch off in the closing stages of games. Stats dont lie mate.', kind: 'statement', expect: { jab: '+', credible: '+' }, note: 'code + late lapses' },
  { text: "Lads Utd concede in the 80s more than anyone, reckon that's where we nick it", kind: 'answer', expect: { jab: '+', credible: '+', confidence: '+' }, note: 'short name Lads Utd' },
  { text: "lads utd consede late evry week lol we'll get em in the last 15", kind: 'answer', expect: { jab: '+', credible: '+' }, note: 'typos, lowercase' },
  { text: "Is anyone really surprised Jamieson's side fall apart in the last ten minutes?", kind: 'answer', expect: { jab: '+', credible: '+' }, note: 'rhetorical, credible' },
  { text: "Our plan is clear. We're direct, we go long early, and we'll turn their centre-backs round all day. Lads Utd have shipped late goals in almost every game, so if it's tight at 70 minutes we'll back our legs. Nothing more to it.", kind: 'statement', expect: { jab: '+', credible: '+', confidence: '+' }, note: 'multi-sentence, tactical + late goals' },
  { text: "Milburn hates it when you hit the channels early. We'll be playing it long into the space behind him from minute one.", kind: 'answer', expect: { jab: '+', credible: '+' }, note: 'direct tactic vs named LAU player' },

  // ---------- empty jabs at LAU (insults, or claims the data contradicts) ----------
  { text: 'Lads United are a pub side with a fancy kit, honestly embarrassing.', kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'pure insult' },
  { text: "they can't handle our press, simple as. we'll hunt them down all over the park", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'pressing is LOW here: empty' },
  { text: "Lads Utd are on a shocking losing run and they know it, the wheels are falling off over there", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'LAU NOT on losing run: empty' },
  { text: "Oliver Jamieson couldn't coach a chook across the road", kind: 'answer', expect: { jab: '+', empty: '+' }, note: 'manager insult, Aussie slang' },
  { text: "Holt is a bottle job, always has been, he'll go missing again Saturday", kind: 'answer', expect: { jab: '+', empty: '+' }, note: 'player insult' },
  { text: "With Giannopoulos suspended they've got absolutely nothing up top.", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'nobody suspended: empty' },
  { text: 'LAU are rubbish 😂😂 easiest 3 points of the year', kind: 'answer', expect: { jab: '+', empty: '+', arrogance: '+' }, note: 'emoji insult + arrogance' },
  { text: 'oliver jamieson talks a big game but his team is a joke', kind: 'answer', expect: { jab: '+', empty: '+' }, note: 'lowercase full manager name' },
  { text: "Declan Rowe won't cope with our high press, he panics every time someone's near him", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'player named, pressing claim false' },
  { text: "Mate, I've watched a lot of football, and Lads United are the worst side I've seen in years. Their keeper can't catch, their midfield can't pass, and Jamieson hasn't got a clue. We'll smash them.", kind: 'answer', expect: { jab: '+', empty: '+', arrogance: '+' }, note: 'multi-sentence tirade' },

  // ---------- friendly / respectful toward LAU ----------
  { text: "Lads United are a quality side and Oliver's done a cracking job with them this year.", kind: 'answer', expect: { jab: '-', humility: '+', empty: '0' }, note: 'respect, first name' },
  { text: "Massive respect to Jamieson, he's built something really good over there.", kind: 'answer', expect: { jab: '-', humility: '+' }, note: 'respect, surname' },
  { text: "Tilio is a top player, we'll have to be switched on for ninety minutes to keep him quiet.", kind: 'answer', expect: { jab: '-', humility: '+' }, note: 'credit to opposition player' },
  { text: "no disrespect to lads utd at all, good bunch of blokes and it'll be a tough game", kind: 'answer', expect: { jab: '-', humility: '+' }, note: 'negated disrespect' },
  { text: 'Always enjoy playing LAU. Fair, hard game, good handshake after. Should be a beauty.', kind: 'statement', expect: { jab: '-' }, note: 'friendly, code' },
  { text: 'Gauci has been brilliant in goal for them, genuinely one of the best keepers in the comp.', kind: 'answer', expect: { jab: '-', humility: '+', praise: '0' }, note: 'praise of OPP player is not own-player praise' },
  { text: 'Wish Oliver Jamieson and his lads all the best, bar Saturday arvo obviously 😉', kind: 'statement', expect: { jab: '-' }, note: 'friendly, emoji' },
  { text: "It's not like we don't rate Lads United, we absolutely do.", kind: 'answer', expect: { jab: '-', humility: '+' }, note: 'double negative' },

  // ---------- jabs at OTHER teams (not the next opponent) ----------
  { text: "Tyrone FC were a proper bottle job last week, but they're not our problem now.", kind: 'answer', expect: { jab: '0', empty: '0' }, note: 'other team' },
  { text: 'Lucky FC got lucky again, as per usual, the name says it all really', kind: 'answer', expect: { jab: '0', empty: '0' }, note: 'other team, contains "lucky"' },
  { text: "SKS FC are the most boring side I've ever watched, parking the bus every single week.", kind: 'answer', expect: { jab: '0', empty: '0' }, note: 'other team' },
  { text: 'Luke Sheppard can moan all he wants about referees, his side are soft as butter.', kind: 'statement', expect: { jab: '0', empty: '0' }, note: 'other manager' },
  { text: "Aarav Ganesan reckons his lot are title contenders. Yeah right. Anyway, we've got Lads United to worry about and they're a good side.", kind: 'answer', expect: { jab: '-' }, note: 'jab at other manager, respectful to LAU' },

  // ---------- neutral mention of LAU ----------
  { text: "We play Lads United on Saturday at 2pm at the usual ground, and we'll name the side on Friday.", kind: 'statement', expect: { jab: '0', credible: '0', empty: '0' }, note: 'neutral logistics' },

  // ---------- confidence + ----------
  { text: "We're ready. The boys are fit, sharp and hungry, and we're going there to win.", kind: 'answer', expect: { confidence: '+', arrogance: '0' }, note: 'plain confidence' },
  { text: "honestly stoked with where we're at, reckon we'll get the job done this weekend", kind: 'answer', expect: { confidence: '+' }, note: 'slang' },
  { text: "I wouldn't say we're not confident. We're very confident, actually.", kind: 'answer', expect: { confidence: '+' }, note: 'double negative' },
  { text: "We're not scared of anyone in this league, not one team.", kind: 'answer', expect: { confidence: '+' }, note: 'negated fear' },
  { text: "Coming off a win, momentum's with us and the lads are absolutely flying at training", kind: 'answer', expect: { confidence: '+', unity: '+' }, note: 'momentum' },
  { text: "Do we fear Lads United? Why would we? We've got everything we need in that dressing room.", kind: 'answer', expect: { confidence: '+', empty: '0' }, note: 'rhetorical questions' },
  { text: "We're confident, but nothing's guaranteed in this game and we'll have to earn every bit of it.", kind: 'answer', expect: { confidence: '+', humility: '+', arrogance: '0' }, note: 'confident not arrogant' },

  // ---------- confidence - ----------
  { text: "Truth be told we're struggling for bodies and form, it's going to be really hard to get anything.", kind: 'answer', expect: { confidence: '-' }, note: 'struggling' },
  { text: "I don't think we've got much chance this week if I'm honest", kind: 'answer', expect: { confidence: '-' }, note: 'no chance' },
  { text: "we're a bit all over the place at the moment, not sure where the next goal is coming from", kind: 'answer', expect: { confidence: '-' }, note: 'uncertainty' },
  { text: "Can't see us winning this one, the squad's knackered and half of them are crook", kind: 'answer', expect: { confidence: '-' }, note: 'Aussie crook = sick' },
  { text: "we're not ready. simple as that. the prep has been awful all week", kind: 'answer', expect: { confidence: '-' }, note: 'negated ready' },
  { text: 'Am I confident going in? Not really, no.', kind: 'answer', expect: { confidence: '-' }, note: 'short rhetorical' },
  { text: 'Yeah right, we are definitely winning the league this year 🙄', kind: 'answer', expect: { confidence: '0', arrogance: '0' }, note: 'sarcasm guard should damp' },
  { text: "Look, it's been a rough patch and I won't pretend otherwise. We're low on belief and missing a few key blokes. Scared? A little, if I'm honest.", kind: 'answer', expect: { confidence: '-' }, note: 'multi-sentence low confidence' },

  // ---------- arrogance ----------
  { text: "We'll win 5-0. Guaranteed. Write it down.", kind: 'answer', expect: { arrogance: '+' }, note: 'scoreline guarantee' },
  { text: 'NOBODY IN THIS LEAGUE CAN STOP US!!!', kind: 'statement', expect: { arrogance: '+' }, note: 'all caps, !!!' },
  { text: "This one'll be a walk in the park for us, easy win, don't even need to train", kind: 'answer', expect: { arrogance: '+' }, note: 'easy' },
  { text: "we're levels above everyone else, the title's basically ours already", kind: 'answer', expect: { arrogance: '+' }, note: 'title already won' },
  { text: 'Honestly we could play with ten men and still win this one comfortably.', kind: 'answer', expect: { arrogance: '+' }, note: 'boast' },
  { text: '4-0 minimum. The rest of the comp should just hand us the trophy now 🏆', kind: 'statement', expect: { arrogance: '+' }, note: 'scoreline + trophy' },
  { text: "We'll walk over whoever turns up, doesn't matter one bit who they are.", kind: 'answer', expect: { arrogance: '+' }, note: 'walk over' },
  { text: "We're not getting carried away. Lads United will be tough and we'll prepare properly like any other week.", kind: 'answer', expect: { arrogance: '0', humility: '+', jab: '-' }, note: 'not arrogant' },

  // ---------- humility ----------
  { text: 'Any side in this comp can beat you on the day, so we respect everyone and just do the work.', kind: 'answer', expect: { humility: '+', arrogance: '0' }, note: 'respect all' },

  // ---------- accountability ----------
  { text: "That's on me. I got the selection wrong and I take full responsibility for it.", kind: 'answer', expect: { accountability: '+' }, note: 'my responsibility' },
  { text: "We weren't good enough in patches last week even in a win, and we've got to learn from that.", kind: 'answer', expect: { accountability: '+' }, note: 'not good enough, learn' },
  { text: 'i picked the wrong formation, my fault, will sort it', kind: 'answer', expect: { accountability: '+' }, note: 'lowercase my fault' },
  { text: 'We didnt do the basics well enough. Passing was sloppy, and as a group we have to own that.', kind: 'answer', expect: { accountability: '+', unity: '+' }, note: 'own it as group' },
  { text: 'Hands up, I got it wrong at half time. The subs were mine and they did not work.', kind: 'answer', expect: { accountability: '+', blame: '0' }, note: 'hands up' },
  { text: 'The buck stops with me as manager, not with the players.', kind: 'statement', expect: { accountability: '+', blame: '-' }, note: 'shields players' },
  { text: 'Not good enough from us in the second half, and I include myself in that.', kind: 'answer', expect: { accountability: '+' }, note: 'include myself' },
  { text: "I won't hide behind the ref or the pitch. We should have been a lot better, full stop.", kind: 'answer', expect: { excuses: '-', accountability: '+' }, note: 'negated excuses' },

  // ---------- excuses ----------
  { text: 'The ref was an absolute shocker, we got stitched up with that penalty.', kind: 'answer', expect: { excuses: '+', accountability: '0' }, note: 'ref' },
  { text: 'pitch was a bog, impossible to play proper football on it', kind: 'answer', expect: { excuses: '+' }, note: 'pitch' },
  { text: "We were robbed. Two offsides that weren't offside. Unbelievable.", kind: 'answer', expect: { excuses: '+' }, note: 'robbed' },
  { text: 'The wind was howling, the ball was doing all sorts, just bad luck really', kind: 'answer', expect: { excuses: '+' }, note: 'weather, luck' },
  { text: 'Three games in eight days is ridiculous. The schedule is killing us and nobody cares.', kind: 'statement', expect: { excuses: '+' }, note: 'schedule' },
  { text: "Unlucky again, hit the post twice, it's just not falling for us at the moment", kind: 'answer', expect: { excuses: '+' }, note: 'luck' },
  { text: 'No excuses from us this week.', kind: 'answer', expect: { excuses: '-' }, note: 'stock negation, used once' },
  { text: "I'm filthy. The referee gave them everything and the surface was a joke. We were done over from start to finish and I've got nothing more to say.", kind: 'answer', expect: { excuses: '+' }, note: 'multi-sentence excuses' },
  { text: "Oh sure, the ref was brilliant today... /s", kind: 'answer', expect: { excuses: '+' }, note: 'sarcastic praise of ref' },

  // ---------- fans + ----------
  { text: 'Massive thanks to everyone who came down on Sunday, the support was unreal.', kind: 'answer', expect: { fans: '+' }, note: 'thanks' },
  { text: "This one's for the supporters, they've stuck with us through thick and thin.", kind: 'answer', expect: { fans: '+' }, note: 'for the supporters' },
  { text: 'our fans were rapt with the win and so am I, cheers to everyone who turned up ❤️', kind: 'statement', expect: { fans: '+' }, note: 'rapt, emoji' },
  { text: 'Get down to the ground Saturday, we need all the noise you lot can make!', kind: 'statement', expect: { fans: '+' }, note: 'call to fans' },
  { text: 'Shoutout to the families and mates on the sideline, you make a huge difference to the boys', kind: 'answer', expect: { fans: '+' }, note: 'sideline' },
  { text: "To everyone who stood in the rain on Sunday: you're legends. We heard every chant. This win belongs to you as much as us.", kind: 'statement', expect: { fans: '+' }, note: 'multi-sentence fans' },

  // ---------- fans - ----------
  { text: 'Some of our so-called fans need a hard look at themselves, booing the lads is a disgrace.', kind: 'answer', expect: { fans: '-' }, note: 'criticise fans' },
  { text: "Honestly I don't care what the fans think, they don't know football.", kind: 'answer', expect: { fans: '-' }, note: 'dismiss fans' },
  { text: 'the crowd were dead quiet, pathetic support tbh', kind: 'answer', expect: { fans: '-' }, note: 'crowd criticised' },
  { text: 'If the supporters want to whinge they can come pull the boots on themselves.', kind: 'answer', expect: { fans: '-' }, note: 'supporters' },
  { text: 'the keyboard warriors in our fanbase are clueless, stop sooking and back the team or stay home', kind: 'statement', expect: { fans: '-' }, note: 'fanbase' },

  // ---------- praise of own players ----------
  { text: 'Callister was unreal up top, two goals and never stopped running.', kind: 'answer', expect: { praise: '+', blame: '0' }, note: 'surname' },
  { text: 'Massive shoutout to Malakai Vance, a rock at the back, best game he has had for us.', kind: 'answer', expect: { praise: '+' }, note: 'full name' },
  { text: 'Irankunda was sensational, the kid is an absolute gun', kind: 'answer', expect: { praise: '+' }, note: 'slang' },
  { text: 'Hayden Cross ran the midfield, class performance from him start to finish', kind: 'answer', expect: { praise: '+' }, note: 'full name' },
  { text: "Really happy for Gideon Boyd, he's worked his backside off and deserved that goal.", kind: 'answer', expect: { praise: '+' }, note: 'deserved' },
  { text: "I can't say I'm not happy with how Vance played, he was excellent.", kind: 'answer', expect: { praise: '+' }, note: 'double negative' },
  { text: "Look, it was a good win and I'm chuffed with how the boys dug in. Jace Callister was everywhere. But Lads United are a different beast and Oliver will have them well drilled, so we'll need our best. Thanks again to the fans who made the trip, it meant a lot.", kind: 'statement', expect: { praise: '+', jab: '-', fans: '+', humility: '+' }, note: 'multi-sentence mix' },
  { text: "didnt play well, my fault, ill sort it. lads were good tho, cross and boyd especially. see yous saturday", kind: 'answer', expect: { accountability: '+', praise: '+' }, note: 'lowercase surnames, multi-sentence' },
  { text: "Great, another 'brilliant' afternoon from our back four, love conceding four goals.", kind: 'answer', expect: { praise: '0' }, note: 'sarcasm: scare quotes' },

  // ---------- blame of own players ----------
  { text: 'Heaney had a howler for the second goal, he knows it and he has to be better.', kind: 'answer', expect: { blame: '+', praise: '0' }, note: 'named blame' },
  { text: "Broadbent's decision making was poor all game and it cost us.", kind: 'answer', expect: { blame: '+' }, note: 'named blame' },
  { text: "Some players didn't turn up and they won't be picked if that carries on.", kind: 'answer', expect: { blame: '+', unity: '-' }, note: 'some players' },
  { text: 'Honestly Samuel Silvera was a passenger out there, not acceptable at this level', kind: 'answer', expect: { blame: '+' }, note: 'full name' },
  { text: "Cameron Devlin's mistake gifted them the goal, schoolboy stuff.", kind: 'answer', expect: { blame: '+' }, note: 'named mistake' },
  { text: 'a couple of the lads had a shocker and they know who they are', kind: 'answer', expect: { blame: '+' }, note: 'unnamed blame' },
  { text: "Nate Sterling's attitude this week hasn't been up to scratch, simple as", kind: 'statement', expect: { blame: '+', unity: '-' }, note: 'attitude' },
  { text: "Honestly, a few of the lads let themselves down. Heaney and Broadbent in particular were off the pace and I've told them. But I pick the team, so it's on me too.", kind: 'answer', expect: { blame: '+', accountability: '+' }, note: 'multi-sentence blame + accountability' },
  { text: "I'm not pointing the finger at anyone individually, we win and lose together.", kind: 'answer', expect: { blame: '-', unity: '+' }, note: 'negated blame' },

  // ---------- unity ----------
  { text: 'This group is a family. We stick together no matter what gets thrown at us.', kind: 'statement', expect: { unity: '+' }, note: 'family' },
  { text: "There's a few blokes here clearly not committed, and they'll be on the transfer list come January.", kind: 'answer', expect: { unity: '-', blame: '+' }, note: 'division' },

  // ---------- noise ----------
  { text: 'asdfghjkl', kind: 'statement', expect: { noise: '+' }, note: 'keyboard mash' },
  { text: 'lol', kind: 'answer', expect: { noise: '+' }, note: 'one word' },
  { text: 'gg ez', kind: 'answer', expect: { noise: '+', arrogance: '0' }, note: 'under 6 words' },
  { text: 'we win', kind: 'answer', expect: { noise: '+', confidence: '0' }, note: 'under 6 words' },
  { text: '!!!!!!!! ??? !!!! 😂😂😂', kind: 'statement', expect: { noise: '+' }, note: 'symbols' },];
