// Second independent holdout set for the press-statement reader (js/press-effect.js, readStatement).
// Written without looking at the reader, its tuning corpus or the first holdout set.
// Speaker: SKS FC. Next opponent: FC Turtle (TUR, manager Luke Grogan).
// Facts: TUR are on a losing run, concede late, and Jace Callister is suspended.
// Our pressing and directness are neutral (0.5), so jabs relying on them are empty;
// our width is high (0.9), so "we'll stretch them wide" is credible.
// expect: '+' should fire, '-' should fire negatively, '0' must stay near zero.

export const CONTEXT = {
  team: 'SKS',
  opponent: 'TUR',
  teams: [
    { code: 'TUR', name: 'FC Turtle', manager: 'Luke Grogan' },
    { code: 'SKS', name: 'SKS FC', manager: 'Sreehari Kottarathil Sandeep' },
    { code: 'CFC', name: 'Cranbourne United FC', manager: 'Luke Sheppard' },
    { code: 'LFC', name: 'Lucky FC', manager: 'Lakshman Devendran' },
    { code: 'NGR', name: 'Tyrone FC', manager: 'Aarav Ganesan' },
    { code: 'LAU', name: 'Lads United', manager: 'Oliver Jamieson' },
  ],
  ownPlayers: [
    'Kaelen Prahaladh', 'Darcy Macgregor', 'Sreehari Doe', "Finnigan O'Brien", 'Zander Mckenzie',
    'Cody Redpath', 'Louis Claringbold', 'Jude Mclachlan', 'Patrick Driscoll', 'Ryan Strain', 'Lewis Miller',
  ],
  oppPlayers: [
    'Jace Callister', 'Malakai Vance', 'Flynn Broadbent', 'Nestory Irankunda', 'Nate Sterling', 'Hayden Cross',
    'Gideon Boyd', 'Lincoln Heaney', 'Harrison Delbridge', 'Cameron Devlin', 'Samuel Silvera',
  ],
  facts: {
    oppLosingRun: true,
    oppConcedesLate: true,
    oppSuspended: ['Jace Callister'],
    ownPressing: 0.5,
    ownDirectness: 0.5,
    ownWidth: 0.9,
    lastResult: 'draw',
  },
};

export const CASES = [
  // ---- confidence ----
  { text: "Honestly I reckon we've got the legs and the belief to go and get three points on Saturday.", kind: 'answer', expect: { confidence: '+', arrogance: '0' }, note: 'belief, quiet confidence, no guarantee' },
  { text: 'training this week has been sharp as, the boys are buzzing and ready to go', kind: 'statement', expect: { confidence: '+', unity: '0', noise: '0' }, note: 'lowercase Aussie, readiness' },
  { text: "We're not heading over there to make up the numbers, we fancy ourselves in this one.", kind: 'answer', expect: { confidence: '+' }, note: 'negated "make up the numbers" = confidence' },
  { text: "Look, we're flat, we're short of ideas and I can't see where the next goal is coming from right now.", kind: 'answer', expect: { confidence: '-', arrogance: '0' }, note: 'low confidence' },
  { text: "Bit of a rough patch. Hard to see us getting much out of the next few, if I'm being honest with you.", kind: 'answer', expect: { confidence: '-' }, note: 'pessimistic' },
  { text: 'Nobody in this dressing room is frightened of anyone, we go in expecting to win every week.', kind: 'statement', expect: { confidence: '+', unity: '0' }, note: 'negated fear' },
  { text: "Yeah we're definitely gonna win it... said nobody who watched us last week 🙃", kind: 'statement', expect: { confidence: '0', arrogance: '0' }, note: 'sarcastic self-deprecation, no real confidence' },
  { text: "we're just not at the races at the moment tbh, the confidence is shot", kind: 'statement', expect: { confidence: '-' }, note: 'confidence shot' },

  // ---- arrogance ----
  { text: 'Write it down now: 4-0 to us, and that is me being generous.', kind: 'statement', expect: { arrogance: '+', confidence: '+' }, note: 'scoreline guarantee' },
  { text: "Mate we could put out the under 12s and still win this one, it's a formality", kind: 'statement', expect: { arrogance: '+', humility: '0' }, note: 'formality boast' },
  { text: 'BEST TEAM IN THE LEAGUE AND ITS NOT EVEN CLOSE!!!', kind: 'statement', expect: { arrogance: '+', humility: '0' }, note: 'all caps and !!!' },
  { text: "Put it this way, I'm already planning what to do with the trophy. The rest of the league is playing for second.", kind: 'answer', expect: { arrogance: '+' }, note: 'trophy talk' },
  { text: "Nobody's laying a glove on us this season, we're levels above the lot of them.", kind: 'statement', expect: { arrogance: '+', humility: '0' }, note: 'untouchable' },
  { text: "Honestly we don't even need to turn up, just post us the three points and save everyone the petrol 😂", kind: 'statement', expect: { arrogance: '+' }, note: 'mock contempt for the fixture' },
  { text: "I'm not going to sit here and promise anything. We'll prepare properly and see where we are after ninety minutes.", kind: 'answer', expect: { arrogance: '0', humility: '+' }, note: 'negated promise = no arrogance' },

  // ---- humility / respect for TUR ----
  { text: "Turtle are a well drilled side and Luke Grogan has them organised, we'll have to be at our very best.", kind: 'answer', expect: { humility: '+', jab: '-', arrogance: '0' }, note: 'respect by name and manager' },
  { text: 'Malakai Vance has been one of the best defenders in the comp this year, genuinely a quality player.', kind: 'answer', expect: { humility: '+', praise: '0', jab: '-' }, note: 'praise of a TUR player is humility, not own-player praise' },
  { text: "Heaps of respect for FC Turtle. Whatever the table says, they'll make it hard for us.", kind: 'answer', expect: { humility: '+', jab: '-' }, note: 'respect' },
  { text: 'We just take each week as it comes, no point looking any further ahead than Saturday.', kind: 'answer', expect: { humility: '+', arrogance: '0' }, note: 'one game at a time, reworded' },
  { text: 'Samuel Silvera up front is a real handful, we need to keep him quiet or he will punish us', kind: 'answer', expect: { humility: '+', praise: '0', jab: '-' }, note: 'credit to TUR striker' },
  { text: "Credit to Grogan's lot, the way they moved the ball about last month was a pleasure to watch, honestly.", kind: 'answer', expect: { humility: '+', jab: '-' }, note: 'credit via manager surname' },
  { text: "We've got plenty to improve on ourselves before we start worrying about anyone else. Nothing is won yet.", kind: 'answer', expect: { humility: '+', arrogance: '0' }, note: 'modest' },

  // ---- accountability ----
  { text: "That draw is on me. I got the subs wrong and I'll own that.", kind: 'answer', expect: { accountability: '+', excuses: '0', blame: '0' }, note: 'owning subs' },
  { text: "We weren't anywhere near the level we need to be, simple as. We go back to the drawing board.", kind: 'answer', expect: { accountability: '+', excuses: '0' }, note: 'not the level' },
  { text: "No excuses from us. We had the chances and didn't take them, so we'll have to learn from it.", kind: 'answer', expect: { accountability: '+', excuses: '-' }, note: 'negated excuses' },
  { text: "i've told the boys the performance was below par and that starts with the gaffer, me.", kind: 'statement', expect: { accountability: '+', blame: '0' }, note: 'lowercase, self-blame' },
  { text: "We dropped two points there, plain and simple. That's a lesson and we have to be better for it.", kind: 'answer', expect: { accountability: '+' }, note: 'lesson' },
  { text: "Not going to blame the ref or the conditions, we just didn't do our jobs well enough.", kind: 'answer', expect: { accountability: '+', excuses: '-' }, note: 'negated ref blame' },
  { text: "The responsibility sits with me as manager and I'm not hiding from it.", kind: 'statement', expect: { accountability: '+', excuses: '0' }, note: 'responsibility' },

  // ---- excuses ----
  { text: 'That referee had an absolute shocker, every fifty-fifty went against us. Robbed, mate.', kind: 'answer', expect: { excuses: '+', accountability: '0' }, note: 'ref + robbed' },
  { text: "The ground was like a paddock, ankle-deep mud in the middle, you can't play football on that.", kind: 'answer', expect: { excuses: '+' }, note: 'pitch, Aussie wording' },
  { text: 'Three games in eight days with half the squad at work, the fixture list has done us no favours', kind: 'answer', expect: { excuses: '+' }, note: 'schedule' },
  { text: 'hit the post twice and their keeper had the game of his life, some days the bounce just goes against you', kind: 'answer', expect: { excuses: '+', accountability: '0' }, note: 'luck' },
  { text: 'Wind was blowing a gale second half, no chance of keeping the ball on the deck in that.', kind: 'answer', expect: { excuses: '+' }, note: 'weather' },
  { text: "Linesman's flag went up for a goal that was a mile onside. Shocking decision, and it cost us the game.", kind: 'answer', expect: { excuses: '+' }, note: 'officials' },
  { text: "the whole thing was a bit of a stitch-up honestly, the ref, the timing, the lot. unfair on the lads", kind: 'statement', expect: { excuses: '+', unity: '0' }, note: 'unfair' },

  // ---- fans ----
  { text: 'Massive shout out to everyone who made the trip, the noise from our end was unreal.', kind: 'statement', expect: { fans: '+' }, note: 'thanking travelling fans' },
  { text: "This one's for the supporters who stood out in the rain last week, they deserve a win more than anyone.", kind: 'answer', expect: { fans: '+' }, note: 'for the supporters' },
  { text: "Some of our so-called fans need to have a look at themselves, booing your own team at half time is a disgrace.", kind: 'answer', expect: { fans: '-' }, note: 'criticising fans' },
  { text: 'honestly the crowd were dead flat, might as well have played behind closed doors', kind: 'statement', expect: { fans: '-' }, note: 'criticising crowd' },
  { text: 'Cheers to the faithful who keep turning up week in week out ❤️💙 you lot are the heartbeat of this club', kind: 'statement', expect: { fans: '+', unity: '0' }, note: 'emoji thanks' },
  { text: "If the keyboard warriors on the group chat want to pick the team they can come and do my job.", kind: 'answer', expect: { fans: '-' }, note: 'swipe at supporters online' },
  { text: 'Please get down early Saturday and bring your voices, we need you behind us for this one.', kind: 'statement', expect: { fans: '+' }, note: 'addressing fans' },

  // ---- praise of own players ----
  { text: 'Darcy Macgregor was on another planet, two goals and he ran himself into the ground. Brilliant.', kind: 'answer', expect: { praise: '+', blame: '0' }, note: 'named praise' },
  { text: "Kaelen Prahaladh made three saves that frankly no keeper in this league makes. Kept us in it.", kind: 'answer', expect: { praise: '+' }, note: 'keeper praise' },
  { text: 'redpath and mckenzie ran the midfield all day, class from both of them', kind: 'statement', expect: { praise: '+' }, note: 'lowercase surnames' },
  { text: "Big wrap for young Jude Mclachlan at the back, composed beyond his years and didn't put a foot wrong.", kind: 'answer', expect: { praise: '+', blame: '0' }, note: 'Aussie "big wrap"' },
  { text: "Strain was immense. Every header, every block, that's a captain's performance.", kind: 'answer', expect: { praise: '+' }, note: 'surname only' },
  { text: "Claringbold's finish was pure quality, he's been waiting for that and he deserved it 👏", kind: 'statement', expect: { praise: '+' }, note: 'possessive surname + emoji' },
  { text: 'Driscoll? Brilliant? Yeah, brilliant at giving the ball away maybe.', kind: 'statement', expect: { praise: '0', blame: '+' }, note: 'sarcastic praise is really blame' },

  // ---- blame of own players ----
  { text: "Lewis Miller switched off for both goals. He knows it, I know it, and it's not acceptable.", kind: 'answer', expect: { blame: '+', praise: '0' }, note: 'named blame' },
  { text: "Some of our defenders were a shambles today. Sreehari Doe in particular, he was nowhere.", kind: 'answer', expect: { blame: '+', unity: '-' }, note: 'named + some players' },
  { text: "O'Brien missed a sitter from two yards, you just can't do that at this level.", kind: 'answer', expect: { blame: '+' }, note: 'apostrophe surname' },
  { text: 'certain individuals were more interested in their hair than tracking back, and they know who they are', kind: 'statement', expect: { blame: '+', unity: '-' }, note: 'general blame, division' },
  { text: "Honestly Patrick Driscoll's decision making cost us the game, poor from him.", kind: 'answer', expect: { blame: '+' }, note: 'named blame' },
  { text: "Zander Mckenzie was lazy out of possession. He'll be having a word with me on Monday.", kind: 'answer', expect: { blame: '+', praise: '0' }, note: 'named, lazy' },

  // ---- unity / division ----
  { text: "We stick together through this. Win, lose or draw, this group has each other's backs.", kind: 'statement', expect: { unity: '+' }, note: 'together, backs' },
  { text: 'This squad is a proper family, the spirit in the sheds is the best I have seen in years.', kind: 'answer', expect: { unity: '+' }, note: 'family, sheds' },
  { text: "There's a couple of players here who don't want to be here, and if that's the case the door's open.", kind: 'answer', expect: { unity: '-' }, note: 'division, door open' },
  { text: 'Not everyone is pulling in the same direction right now and it shows on the park', kind: 'answer', expect: { unity: '-' }, note: 'negated unity' },
  { text: 'love this bunch of blokes, all mates on and off the pitch 🍻', kind: 'statement', expect: { unity: '+', noise: '0' }, note: 'mates, emoji' },
  { text: 'Commitment levels from a few of them have been poor and they will find themselves out of the side.', kind: 'answer', expect: { unity: '-', blame: '+' }, note: 'not committed' },
  { text: 'Everyone chipped in today, the lads on the bench were as loud as the lads on the pitch.', kind: 'statement', expect: { unity: '+' }, note: 'whole squad' },

  // ---- credible jabs at TUR ----
  { text: "Turtle haven't won in weeks. Confidence must be at rock bottom over there and we intend to keep it that way.", kind: 'statement', expect: { jab: '+', credible: '+', empty: '0' }, note: 'losing run' },
  { text: "They leak goals in the last ten minutes every single week. We'll keep going right until the whistle.", kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'late goals, opponent unnamed' },
  { text: "Without Callister they've got nobody who can hurt us up top, simple as.", kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'suspended player by surname' },
  { text: "We'll stretch FC Turtle from touchline to touchline, their full backs are going to have a long afternoon.", kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'width, which is set high' },
  { text: 'TUR fall apart late in games, everyone knows it. Stay in it for 80 mins and they fold 😂', kind: 'statement', expect: { jab: '+', credible: '+', empty: '0' }, note: 'code + late collapse' },
  { text: "Luke Grogan will be feeling the heat after that losing streak. I'd be nervous if I were him.", kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'manager name + losing run' },
  { text: "Jace Callister's suspended and honestly they look lost without him. That's their problem, not ours.", kind: 'answer', expect: { jab: '+', credible: '+' }, note: 'suspension, full name' },
  { text: "We play wide, we get it out to the flanks early and Turtle's back four just can't cope with that width.", kind: 'answer', expect: { jab: '+', credible: '+', empty: '0' }, note: 'width claim' },

  // ---- empty jabs at TUR ----
  { text: "Turtle are a pub side with a pub manager. They're a joke.", kind: 'statement', expect: { jab: '+', empty: '+', credible: '0' }, note: 'pure insult' },
  { text: "Our press will eat FC Turtle alive, they won't get out of their own half.", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'press claim, pressing neutral' },
  { text: "Grogan's lot are rubbish mate. Absolutely rubbish. Always have been.", kind: 'statement', expect: { jab: '+', empty: '+', credible: '0' }, note: 'insult via manager' },
  { text: "We'll go long and direct and bully TUR straight through the middle, they've got no answer to that.", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'directness claim, directness neutral' },
  { text: 'Nate Sterling is the worst keeper I have ever seen, my nan could stop more shots lol', kind: 'statement', expect: { jab: '+', empty: '+', credible: '0' }, note: 'insult of TUR player' },
  { text: 'Hayden Cross and Gideon Boyd? Clowns. Pair of clowns. 🤡', kind: 'statement', expect: { jab: '+', empty: '+' }, note: 'insult by player names, emoji' },
  { text: "They can't live with our high pressing game, we'll be on them from the first whistle, Turtle won't know what hit them", kind: 'answer', expect: { jab: '+', empty: '+', credible: '0' }, note: 'high pressing claim, pressing neutral' },

  // ---- friendly toward TUR ----
  { text: 'Good luck to Luke and the Turtle boys this week, always a good game between us and a beer after.', kind: 'statement', expect: { jab: '-', humility: '+' }, note: 'friendly' },
  { text: "Nothing but respect for Grogan, he's done wonders with that group on a shoestring.", kind: 'answer', expect: { jab: '-', humility: '+', empty: '0' }, note: 'respect for manager' },

  // ---- jabs at OTHER teams (not the next opponent) ----
  { text: 'Lucky FC are well named, they would be bottom without the ref helping them every week.', kind: 'statement', expect: { jab: '0', credible: '0', empty: '0' }, note: 'jab at LFC, not TUR' },
  { text: "Cranbourne United are all mouth. We'll sort them out when we see them later in the season.", kind: 'statement', expect: { jab: '0', empty: '0' }, note: 'jab at CFC' },
  { text: "Honestly Lads United are the dirtiest side I've seen, Oliver Jamieson should be embarrassed.", kind: 'answer', expect: { jab: '0', empty: '0' }, note: 'jab at LAU manager' },
  { text: 'Tyrone FC were rubbish when we played them, no idea how they are above anyone.', kind: 'statement', expect: { jab: '0', credible: '0' }, note: 'jab at NGR' },
  { text: "Lakshman Devendran can talk all he wants, his side couldn't score in a brewery", kind: 'statement', expect: { jab: '0', empty: '0' }, note: 'jab at LFC manager' },
  { text: "Cranbourne concede late every week, but that's a problem for another day. Our focus is Saturday.", kind: 'answer', expect: { jab: '0', credible: '0' }, note: 'true-sounding claim about the wrong team' },

  // ---- noise ----
  { text: 'yeah nah', kind: 'statement', expect: { noise: '+' }, note: 'two words' },
  { text: 'asdfghjkl qwerty zxcvb', kind: 'statement', expect: { noise: '+' }, note: 'keyboard mash' },
  { text: 'win win win win win win win win', kind: 'statement', expect: { noise: '+' }, note: 'single word repeated' },
  { text: '🔥🔥🔥 💯💯 ⚽⚽⚽ !!! ??? 🐢🐢', kind: 'statement', expect: { noise: '+' }, note: 'emoji only' },
  { text: 'Good game. Moving on.', kind: 'answer', expect: { noise: '+' }, note: 'four words' },
  { text: 'hhhhhhhhhhhh jjjjjjjj kkkkkkkkk llll', kind: 'statement', expect: { noise: '+' }, note: 'letter mashing' },
  { text: 'We go again next week and we will be ready for whatever comes.', kind: 'answer', expect: { noise: '0' }, note: 'short but real sentence' },

  // ---- mixed, multi-sentence ----
  { text: "Look the ref was poor, but that's not why we drew. I picked the wrong shape and that's on me. Macgregor was the one bright spark. Thanks to everyone who came down, sorry we couldn't give you the win.", kind: 'answer', expect: { accountability: '+', praise: '+', fans: '+', blame: '0' }, note: 'mixed, mentions ref but rejects it' },
  { text: "We respect Turtle, Luke's a good bloke. But they've lost a few on the bounce and they fade late, so if we're patient the chances will come.", kind: 'answer', expect: { humility: '+', credible: '+', empty: '0', arrogance: '0' }, note: 'respectful but factual jab' },
  { text: 'Proud of the boys, proud of the fans, proud of this club. We go into Saturday together and confident.', kind: 'statement', expect: { unity: '+', fans: '+', confidence: '+', arrogance: '0' }, note: 'triple positive' },
  { text: "Yeah great, another 'brilliant' display from our back line, really top stuff 🙄 some of them need to look in the mirror", kind: 'statement', expect: { praise: '0', blame: '+', unity: '-' }, note: 'scare quotes sarcasm' },
  { text: "Our lot are better than theirs in every position. Easy win, 3-0, and Grogan knows it.", kind: 'statement', expect: { arrogance: '+', jab: '+', empty: '+', humility: '0' }, note: 'arrogant insult of TUR, no facts' },
  { text: "Tough week. Two injuries, a dodgy pitch, and a ref who didn't want to be there. Still, Finnigan O'Brien was outstanding and the lads never stopped running.", kind: 'answer', expect: { excuses: '+', praise: '+', unity: '+' }, note: 'excuses plus praise and unity' },
  { text: "gotta be honest we weren't great. but the spirit is there, the group is tight and we'll bounce back against turtle", kind: 'statement', expect: { accountability: '+', unity: '+', confidence: '+', jab: '0' }, note: 'mentions TUR without hostility' },
];
