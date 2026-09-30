// Press effect: what managers say in the press room nudges their team's next match.
// Pure functions, no DOM. Spec, rules and limits: docs/PRESS_EFFECT.md.
//
//   readStatement(text, ctx)                  one statement -> bounded signals and the reasons
//   pressEffect(season, files, fixture, opts) -> { home, away } meters for that match
//
// Everything is built-in rules: a phrase lexicon with negation, intensity, sarcasm and target
// detection, checks of jabs against the league's real data, and hard anti-spam limits.

import { kickoff } from './data.js';
import { suspensions } from './league.js';

export const SIGNALS = ['confidence', 'arrogance', 'humility', 'accountability', 'excuses', 'fans', 'praise', 'blame', 'unity', 'jab', 'credible', 'empty', 'noise'];

// Limits (docs/PRESS_EFFECT.md "Anti-spam limits").
export const LIMITS = {
  perf: 0.04, oppPerf: 0.03, final: 0.05,     // fractions
  meter: 100, carry: 0.6,                     // fans / happiness range, share kept per match
  counted: 6, decay: 0.6,                     // items that count, and their weights 1, .6, .36 …
  jabs: 2, similar: 0.55, minWords: 6, volume: 8,
};
const KIND_WEIGHT = { answer: 1, statement: 0.8, message: 0.5 };

// ---------------------------------------------------------------- text basics

const CONTRACTIONS = [
  [/\b(ca)n'?t\b/g, 'can not'], [/\bwon'?t\b/g, 'will not'], [/\bshan'?t\b/g, 'shall not'],
  [/\b(do|does|did|is|are|was|were|has|have|had|could|should|would|must|need|ai)n'?t\b/g, '$1 not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\b(we|they|you|i)'re\b/g, '$1 are'], [/\b(we|they|you|i)'ve\b/g, '$1 have'], [/\b(we|they|you|i|he|she|it)'ll\b/g, '$1 will'],
  [/\b(we|they|you|i|he|she|it)'d\b/g, '$1 would'], [/\bi'm\b/g, 'i am'], [/\b(it|that|there|he|she|what)'s\b/g, '$1 is'],
  [/\bim\b/g, 'i am'], [/\bwere gonna\b/g, 'we are going to'], [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'],
  [/\bur\b/g, 'your'], [/\bu\b/g, 'you'], [/\bthx\b|\bty\b/g, 'thanks'], [/\bpls\b|\bplz\b/g, 'please'],
];
// Common spellings without the apostrophe ("dont", "cant", "theyre").
const TYPOS = { consede: 'concede', consedes: 'concedes', evry: 'every', becuase: 'because', becasue: 'because', thier: 'their', definately: 'definitely', defintely: 'definitely', alot: 'a lot', wierd: 'weird', recieve: 'receive', agianst: 'against', againts: 'against', loosing: 'losing', loose: 'lose', em: 'them', ya: 'you', yer: 'your', cos: 'because', coz: 'because', tho: 'though', prob: 'probably', rly: 'really', v: 'very' };
const BARE = { dont: 'do not', doesnt: 'does not', didnt: 'did not', cant: 'can not', wont: 'will not', isnt: 'is not', arent: 'are not', wasnt: 'was not', werent: 'were not', havent: 'have not', hasnt: 'has not', couldnt: 'could not', shouldnt: 'should not', wouldnt: 'would not', theyre: 'they are', youre: 'you are', weve: 'we have', theyve: 'they have', ive: 'i have', aint: 'is not' };

const NEGATORS = new Set(['not', 'no', 'never', 'nobody', 'none', 'nothing', 'neither', 'nor', 'without', 'hardly', 'barely']);
const INTENSIFIERS = { very: 1.3, really: 1.3, so: 1.2, absolutely: 1.4, extremely: 1.4, totally: 1.3, massively: 1.4, bloody: 1.3, fully: 1.2, incredibly: 1.4, genuinely: 1.2, super: 1.3, hugely: 1.3, completely: 1.3, truly: 1.2, damn: 1.2, fucking: 1.4 };
const SOFTENERS = { maybe: 0.7, perhaps: 0.7, bit: 0.7, slightly: 0.6, might: 0.75, somewhat: 0.7, fairly: 0.8, hopefully: 0.8, probably: 0.85, kinda: 0.7, sorta: 0.7 };

// Cyrillic and Greek letters that look Latin, so "fаns" (Cyrillic а) still reads as fans.
const LOOKALIKE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ӏ': 'l', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'α': 'a', 'ο': 'o', 'ρ': 'p', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'τ': 't', 'υ': 'u', 'χ': 'x' };
function normalise(text) {
  let t = String(text || '').normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase().replace(/[\u0370-\u04ff]/g, c => LOOKALIKE[c] || c)
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  t = t.replace(/\b[a-z]+\b/g, w => BARE[w] || TYPOS[w] || w);
  return t;
}

// Words with their positions; numbers kept (scorelines), apostrophes dropped.
const tokens = s => (s.match(/[a-z]+|\d+/g) || []);

// Crude stemmer for comparing statements and matching word families.
export function stem(w) {
  if (w.length <= 3) return w;
  return w.replace(/(ingly|edly|ness|ment|ings|ing|ers|ies|ied|ed|es|ly|er|s)$/, m => (m === 'ies' || m === 'ied' ? 'y' : ''));
}

// ---------------------------------------------------------------- lexicon
// Each cue: words (space separated; `*` = any ending), the signals it gives, and optional
// conditions: `subj` who it must be about ('we' | 'opp' | 'player' | 'fans' | 'ref'), `neg` the
// signals when negated (default: every signal flipped and damped), `noNeg` for cues that already
// contain their negation.

const C = (p, s, o = {}) => ({ p: p.split(' '), s, ...o });
const LEXICON = [
  // --- accountability (and "no excuses", which must beat the excuse cues)
  C('no excuse*', { accountability: 0.9, excuses: -0.6 }, { noNeg: true }),
  C('not make excuse*', { accountability: 0.8 }, { noNeg: true }),
  C('my fault', { accountability: 1 }), C('on me', { accountability: 0.7 }), C('i take responsibility', { accountability: 1 }),
  C('take* responsibility', { accountability: 0.9 }), C('take* the blame', { accountability: 0.9 }), C('hold* my hand* up', { accountability: 0.9 }),
  C('hands up', { accountability: 0.6 }), C('we were poor', { accountability: 0.8 }), C('we were bad', { accountability: 0.7 }),
  C('we did not play well', { accountability: 0.8 }), C('we played poor*', { accountability: 0.8 }), C('we let ourselves down', { accountability: 0.9 }),
  C('we let the fans down', { accountability: 0.9, fans: 0.5 }), C('we need to improve', { accountability: 0.6 }), C('we will learn', { accountability: 0.6 }),
  C('learn from', { accountability: 0.5 }), C('lesson*', { accountability: 0.4 }), C('we deserved to lose', { accountability: 0.9, humility: 0.4 }),
  C('deserved nothing', { accountability: 0.8 }), C('fair result', { accountability: 0.4, humility: 0.4 }), C('we will bounce back', { accountability: 0.4, confidence: 0.5 }),
  C('bounce back', { confidence: 0.4, accountability: 0.3 }), C('work harder', { accountability: 0.5, unity: 0.2 }), C('back to the drawing board', { accountability: 0.6 }),
  C('own goal* of our own making', { accountability: 0.6 }), C('we only have ourselves to blame', { accountability: 1 }), C('ourselves to blame', { accountability: 0.9 }),

  // --- excuses
  C('ref*', { excuses: 0.35 }, { subj: 'ref', ctx: true }), C('referee*', { excuses: 0.35 }, { subj: 'ref', ctx: true }), C('official*', { excuses: 0.25 }, { subj: 'ref', ctx: true }),
  C('var', { excuses: 0.3 }, { subj: 'ref', ctx: true }), C('robbed', { excuses: 0.9 }), C('daylight robbery', { excuses: 1 }), C('stitched up', { excuses: 0.9 }),
  C('unlucky', { excuses: 0.6 }), C('luck', { excuses: 0.3 }), C('bad luck', { excuses: 0.7 }), C('luck was not', { excuses: 0.7 }), C('no luck', { excuses: 0.6 }), C('lucky', { excuses: 0.3 }, { subj: 'opp' }),
  C('the pitch', { excuses: 0.5 }, { ctx: true }), C('the weather', { excuses: 0.5 }), C('the wind', { excuses: 0.4 }), C('the rain', { excuses: 0.3 }),
  C('the schedule', { excuses: 0.6 }), C('fixture congestion', { excuses: 0.7 }), C('too many games', { excuses: 0.6 }), C('unfair', { excuses: 0.7 }),
  C('bias*', { excuses: 0.8 }), C('cheat*', { excuses: 0.8, jab: 0.4 }), C('rigged', { excuses: 1 }), C('shocking decision*', { excuses: 0.9 }),
  C('terrible decision*', { excuses: 0.9 }), C('should have been a penalty', { excuses: 0.8 }), C('never a penalty', { excuses: 0.8 }), C('never a red', { excuses: 0.8 }),
  C('injur*', { excuses: 0.3 }, { ctx: true }), C('tired legs', { excuses: 0.4 }), C('if only', { excuses: 0.4 }), C('on another day', { excuses: 0.4 }),
  C('hard done by', { excuses: 0.8 }), C('against us', { excuses: 0.4 }), C('decisions went', { excuses: 0.6 }),

  // --- confidence
  C('we will win', { confidence: 0.9 }), C('we are going to win', { confidence: 0.9 }), C('we can win', { confidence: 0.6 }), C('we can beat', { confidence: 0.6 }),
  C('confident', { confidence: 0.8 }), C('confidence', { confidence: 0.5 }), C('believe', { confidence: 0.6 }), C('belief', { confidence: 0.6 }),
  C('ready', { confidence: 0.6 }), C('up for it', { confidence: 0.8 }), C('bring it on', { confidence: 0.8 }), C('can not wait', { confidence: 0.6 }),
  C('fear', { confidence: -0.6 }, { neg: { confidence: 0.8 } }), C('scared', { confidence: -0.8 }, { neg: { confidence: 0.8 } }), C('afraid', { confidence: -0.7 }, { neg: { confidence: 0.8 } }),
  C('worried', { confidence: -0.6 }, { neg: { confidence: 0.6 } }), C('nervous', { confidence: -0.6 }, { neg: { confidence: 0.6 } }), C('concerned', { confidence: -0.4 }),
  C('fear nobody', { confidence: 0.9 }, { noNeg: true }), C('fear no one', { confidence: 0.9 }, { noNeg: true }), C('fear no one', { confidence: 0.9 }, { noNeg: true }),
  C('no fear', { confidence: 0.8 }, { noNeg: true }), C('no chance', { confidence: -0.8 }, { noNeg: true, subj: 'we' }), C('no hope', { confidence: -0.9 }, { noNeg: true }),
  C('struggl*', { confidence: -0.6 }, { subj: 'we' }), C('in a bad place', { confidence: -0.7 }), C('tough times', { confidence: -0.4 }), C('doubt*', { confidence: -0.5 }),
  C('in good form', { confidence: 0.6 }), C('on fire', { confidence: 0.7 }), C('flying', { confidence: 0.5 }), C('momentum', { confidence: 0.5 }),
  C('three points', { confidence: 0.3 }), C('3 points', { confidence: 0.3 }), C('get the win', { confidence: 0.5 }), C('get a result', { confidence: 0.4 }),
  C('can beat anyone', { confidence: 0.8, arrogance: 0.2 }), C('capable', { confidence: 0.4 }), C('prepared', { confidence: 0.5 }), C('focused', { confidence: 0.5 }),
  C('hungry', { confidence: 0.5 }), C('motivated', { confidence: 0.5 }), C('determined', { confidence: 0.5 }), C('we have got this', { confidence: 0.7 }),
  C('lost confidence', { confidence: -0.8 }), C('low on confidence', { confidence: -0.8 }), C('give up', { confidence: -0.8 }, { neg: { confidence: 0.6 } }),

  // --- arrogance
  C('easy', { arrogance: 0.6 }, { ctx: true }), C('easily', { arrogance: 0.6 }), C('walk in the park', { arrogance: 1 }), C('cake walk', { arrogance: 1 }), C('cakewalk', { arrogance: 1 }),
  C('guarantee*', { arrogance: 0.9 }), C('no doubt', { arrogance: 0.5, confidence: 0.4 }, { noNeg: true }), C('nobody can stop us', { arrogance: 1 }, { noNeg: true }),
  C('no one can stop us', { arrogance: 1 }, { noNeg: true }), C('unstoppable', { arrogance: 0.9 }), C('unbeatable', { arrogance: 0.9 }), C('invincible', { arrogance: 0.9 }),
  C('best team in the league', { arrogance: 0.8 }), C('best team', { arrogance: 0.5 }), C('too good for', { arrogance: 0.8 }), C('out of their league', { arrogance: 0.9 }),
  C('destroy*', { arrogance: 0.7, jab: 0.5 }), C('thrash*', { arrogance: 0.7, jab: 0.4 }), C('hammer*', { arrogance: 0.6, jab: 0.4 }), C('smash*', { arrogance: 0.6, jab: 0.4 }),
  C('annihilat*', { arrogance: 0.9, jab: 0.5 }), C('humiliat*', { arrogance: 0.8, jab: 0.6 }), C('crush*', { arrogance: 0.7, jab: 0.4 }), C('embarrass*', { arrogance: 0.5, jab: 0.5 }, { subj: 'opp' }),
  C('title is ours', { arrogance: 0.9 }), C('already won', { arrogance: 0.8 }), C('mark my words', { arrogance: 0.6 }), C('trust me', { arrogance: 0.3 }),
  C('we are the best', { arrogance: 0.7 }), C('champions', { arrogance: 0.4 }, { ctx: true }), C('goat', { arrogance: 0.5 }), C('ez', { arrogance: 0.7 }),

  // --- humility / respect
  C('get respect when', { arrogance: 0.4, jab: 0.3 }, { noNeg: true }), C('respect', { humility: 0.8 }, { neg: { arrogance: 0.3 } }), C('respect*', { humility: 0.7 }, { neg: { arrogance: 0.3 } }), C('one game at a time', { humility: 0.8 }), C('one match at a time', { humility: 0.8 }),
  C('tough game', { humility: 0.6 }), C('tough match', { humility: 0.6 }), C('tough opponent*', { humility: 0.7 }), C('tough side', { humility: 0.7 }),
  C('good side', { humility: 0.6 }), C('good team', { humility: 0.5 }), C('quality side', { humility: 0.6 }), C('dangerous', { humility: 0.4 }, { subj: 'opp' }),
  C('underestimate', { humility: -0.5, arrogance: 0.4 }, { neg: { humility: 0.8 } }), C('take them lightly', { arrogance: 0.5 }, { neg: { humility: 0.8 } }),
  C('credit to', { humility: 0.7 }), C('fair play to', { humility: 0.7 }), C('hats off', { humility: 0.8 }), C('they deserved', { humility: 0.8 }),
  C('well played', { humility: 0.6 }), C('congratulat*', { humility: 0.7 }), C('humble', { humility: 0.7 }), C('grateful', { humility: 0.5 }),
  C('we will see', { humility: 0.4 }), C('anything can happen', { humility: 0.5 }), C('no easy games', { humility: 0.8 }, { noNeg: true }), C('every team', { humility: 0.3 }),
  C('feet on the ground', { humility: 0.8 }), C('long way to go', { humility: 0.6 }), C('nothing won yet', { humility: 0.8 }, { noNeg: true }), C('stay grounded', { humility: 0.8 }),

  // --- fans
  C('fans', { fans: 0.35 }, { subj: 'fans', ctx: true }), C('supporters', { fans: 0.35 }, { subj: 'fans', ctx: true }), C('crowd', { fans: 0.25 }, { subj: 'fans', ctx: true }),
  C('thank*', { fans: 0.3 }, { ctx: true }), C('for you', { fans: 0.3 }, { ctx: true }), C('means a lot', { fans: 0.4 }), C('amazing support', { fans: 0.9 }),
  C('incredible support', { fans: 0.9 }), C('twelfth man', { fans: 0.8 }), C('12th man', { fans: 0.8 }), C('everyone who came', { fans: 0.7 }),
  C('sorry to the fans', { fans: 0.6, accountability: 0.6 }), C('apologi*', { accountability: 0.5, fans: 0.3 }), C('we owe', { fans: 0.4, accountability: 0.4 }),
  C('fair weather', { fans: -0.8 }), C('fairweather', { fans: -0.8 }), C('keyboard warrior*', { fans: -0.7 }), C('moan*', { fans: -0.4 }, { ctx: true }),
  C('boo*', { fans: -0.3 }, { ctx: true }), C('critics', { fans: -0.3 }), C('do not deserve', { fans: -0.4 }, { noNeg: true, ctx: true }), C('shut up', { fans: -0.5, arrogance: 0.3 }),

  // --- praise and blame (who it's about decides whether it counts)
  C('brilliant', { praise: 0.8 }, { ctx: true }), C('outstanding', { praise: 0.9 }, { ctx: true }), C('superb', { praise: 0.8 }, { ctx: true }), C('excellent', { praise: 0.7 }, { ctx: true }),
  C('proud', { praise: 0.8, unity: 0.3 }), C('proud of', { praise: 0.9, unity: 0.3 }), C('great game', { praise: 0.7 }, { ctx: true }), C('class', { praise: 0.5 }, { ctx: true }),
  C('quality', { praise: 0.3 }, { ctx: true }), C('magnificent', { praise: 0.9 }, { ctx: true }), C('immense', { praise: 0.8 }, { ctx: true }), C('fantastic', { praise: 0.8 }, { ctx: true }),
  C('man of the match', { praise: 0.9 }), C('top performance', { praise: 0.8 }), C('worked hard', { praise: 0.6, unity: 0.2 }), C('gave everything', { praise: 0.8, unity: 0.3 }),
  C('great', { praise: 0.4 }, { ctx: true }), C('good', { praise: 0.3 }, { ctx: true }), C('star', { praise: 0.5 }, { ctx: true }), C('legend', { praise: 0.6 }, { ctx: true }),
  C('let us down', { blame: 0.9, unity: -0.3 }), C('let the team down', { blame: 1, unity: -0.4 }), C('blame*', { blame: 0.6 }, { ctx: true }), C('his fault', { blame: 1 }),
  C('their fault', { blame: 0.8 }, { subj: 'player' }), C('lazy', { blame: 0.8 }, { ctx: true }), C('useless', { blame: 0.9 }, { ctx: true }), C('awful', { blame: 0.6 }, { ctx: true }),
  C('terrible', { blame: 0.6 }, { ctx: true }), C('disgrace*', { blame: 1 }, { ctx: true }), C('embarrassing', { blame: 0.7 }, { ctx: true }), C('switched off', { blame: 0.7 }),
  C('sloppy', { blame: 0.5 }, { ctx: true }), C('poor', { blame: 0.5 }, { ctx: true }), C('rubbish', { blame: 0.7 }, { ctx: true }), C('shocking', { blame: 0.6 }, { ctx: true }),
  C('not committed', { blame: 0.8, unity: -0.7 }, { noNeg: true }), C('should be ashamed', { blame: 1, unity: -0.4 }), C('cost us', { blame: 0.8 }), C('mistake*', { blame: 0.4 }, { ctx: true }),

  // --- unity and division
  C('together', { unity: 0.7 }), C('family', { unity: 0.8 }), C('brotherhood', { unity: 0.9 }), C('as a team', { unity: 0.6 }), C('as one', { unity: 0.6 }),
  C('united', { unity: 0.5 }, { ctx: true }), C('team spirit', { unity: 0.8 }), C('the lads', { unity: 0.3 }), C('the boys', { unity: 0.3 }), C('the group', { unity: 0.3 }),
  C('dressing room is', { unity: 0.3 }), C('behind each other', { unity: 0.8 }), C('fight for each other', { unity: 0.9 }), C('for each other', { unity: 0.7 }), C('squad effort', { unity: 0.7 }),
  C('some players', { unity: -0.6, blame: 0.5 }), C('certain players', { unity: -0.7, blame: 0.6 }), C('attitude', { unity: -0.4 }, { ctx: true }), C('bust up', { unity: -0.9 }),
  C('transfer list*', { unity: -0.8, blame: 0.4 }), C('want* out', { unity: -0.6 }), C('do not care', { unity: -0.6, blame: 0.4 }, { noNeg: true }), C('divided', { unity: -0.8 }),
  C('dropped', { unity: -0.3, blame: 0.3 }, { ctx: true }), C('selfish', { unity: -0.7, blame: 0.6 }), C('not good enough for this club', { blame: 1, unity: -0.6 }, { noNeg: true }),

  // --- toward the opponent (only counts as a jab/respect when the opponent is the subject)
  C('weak', { jab: 0.6 }, { subj: 'opp' }), C('soft', { jab: 0.6 }, { subj: 'opp' }), C('pushover*', { jab: 0.8 }, { subj: 'opp' }), C('bottle*', { jab: 0.7 }, { subj: 'opp' }),
  C('choke*', { jab: 0.6 }, { subj: 'opp' }), C('overrated', { jab: 0.7 }, { subj: 'opp' }), C('clown*', { jab: 0.9 }, { subj: 'opp' }), C('joke', { jab: 0.8 }, { subj: 'opp' }),
  C('pub team', { jab: 0.9 }, { subj: 'opp' }), C('joke', { blame: 0.6 }, { ctx: true }), C('sunday league', { jab: 0.8 }, { subj: 'opp' }), C('rubbish', { jab: 0.7 }, { subj: 'opp' }), C('trash', { jab: 0.8 }, { subj: 'opp' }),
  C('poor', { jab: 0.5 }, { subj: 'opp' }), C('bad', { jab: 0.5 }, { subj: 'opp', neg: { humility: 0.4 } }), C('useless', { jab: 0.8 }, { subj: 'opp' }), C('scared', { jab: 0.6 }, { subj: 'opp', neg: {} }),
  C('can not handle', { jab: 0.7 }, { subj: 'opp', noNeg: true }), C('can not cope', { jab: 0.7 }, { subj: 'opp', noNeg: true }), C('can not defend', { jab: 0.7 }, { subj: 'opp', noNeg: true }),
  C('can not score', { jab: 0.6 }, { subj: 'opp', noNeg: true }), C('will crumble', { jab: 0.7 }, { subj: 'opp' }), C('fall apart', { jab: 0.7 }, { subj: 'opp' }), C('struggl*', { jab: 0.5 }, { subj: 'opp' }),
  C('play well', { humility: 0.5 }, { subj: 'opp', neg: { jab: 0.6 } }), C('good', { humility: 0.4 }, { subj: 'opp', neg: { jab: 0.5 } }), C('strong', { humility: 0.4 }, { subj: 'opp', neg: { jab: 0.5 } }),
  C('decent', { humility: 0.4 }, { subj: 'opp', neg: { jab: 0.4 } }), C('quality', { humility: 0.4 }, { subj: 'opp', neg: { jab: 0.5 } }), C('threat', { humility: 0.4 }, { subj: 'opp', neg: { jab: 0.5 } }),
  C('in trouble', { jab: 0.6 }, { subj: 'opp' }), C('in for a', { jab: 0.5, arrogance: 0.4 }, { subj: 'opp' }), C('see you', { jab: 0.3 }, { subj: 'opp' }), C('coming for', { jab: 0.5, confidence: 0.3 }),
  C('eat them alive', { jab: 0.8, confidence: 0.4 }), C('in our pocket', { jab: 0.6 }), C('bully', { jab: 0.6 }, { subj: 'opp' }), C('clueless', { jab: 0.8 }, { subj: 'opp' }),
  C('could not manage', { jab: 0.7 }, { subj: 'opp', noNeg: true }), C('fold', { jab: 0.6 }, { subj: 'opp' }), C('hates being', { jab: 0.5 }, { subj: 'opp' }), C('nothing special', { jab: 0.7 }, { subj: 'opp', noNeg: true }),
  C('shocker', { jab: 0.5 }, { subj: 'opp' }), C('freefall', { jab: 0.6 }, { subj: 'opp' }), C('through the floor', { jab: 0.6 }, { subj: 'opp' }), C('on the bounce', { jab: 0.3 }, { subj: 'opp' }),
  C('were better', { humility: 0.6 }, { subj: 'opp' }), C('better side', { humility: 0.6 }, { subj: 'opp' }), C('miles better', { humility: 0.6, confidence: -0.5 }, { subj: 'opp' }),
  C('turn it around', { humility: 0.5 }, { subj: 'opp' }), C('good luck', { humility: 0.6 }), C('back soon', { humility: 0.4 }), C('great job', { humility: 0.6 }, { subj: 'opp' }),
  C('proper test', { humility: 0.6 }), C('tricky', { humility: 0.5 }), C('can hurt', { humility: 0.5 }), C('no such thing as an easy', { humility: 0.8 }, { noNeg: true }),

  // --- more everyday football language (from the test corpus)
  C('we will beat', { confidence: 0.8 }), C('a chance', { confidence: 0.4 }, { subj: 'we' }), C('got a chance', { confidence: 0.5 }), C('low on belief', { confidence: -0.8 }, { noNeg: true }),
  C('low on confidence', { confidence: -0.8 }, { noNeg: true }), C('confidence just is not there', { confidence: -0.8 }, { noNeg: true }), C('confidence is not there', { confidence: -0.8 }, { noNeg: true }),
  C('can not see us', { confidence: -0.7 }, { noNeg: true }), C('really down', { confidence: -0.6 }), C('is down', { confidence: -0.4 }, { ctx: true }), C('squad is down', { confidence: -0.6 }),
  C('walk over', { arrogance: 0.8, jab: 0.3 }), C('too easy', { arrogance: 0.8 }, { noNeg: true }), C('easi*', { arrogance: 0.6 }, { neg: { humility: 0.4 } }), C('book it', { arrogance: 0.6 }),
  C('minimum', { arrogance: 0.2 }, { ctx: true }), C('stupid enough to guarantee', { humility: 0.6 }, { noNeg: true }),
  C('not good enough', { accountability: 0.8 }, { noNeg: true }), C('can not complain', { accountability: 0.5, humility: 0.3 }, { noNeg: true }), C('got what we deserved', { accountability: 0.6, humility: 0.3 }),
  C('know what they did', { blame: 0.7 }), C('except me', { accountability: 0.8 }, { noNeg: true }), C('apart from me', { accountability: 0.8 }, { noNeg: true }), C('nobody is to blame', { blame: -0.6 }, { noNeg: true }),
  C('no one is to blame', { blame: -0.6 }, { noNeg: true }), C('not blam*', { blame: -0.6, accountability: 0.5, excuses: -0.3 }, { noNeg: true }), C('single * out', { blame: 0.6 }, { neg: { blame: -0.6, unity: 0.4 } }),
  C('single out', { blame: 0.6 }, { neg: { blame: -0.6, unity: 0.4 } }), C('excuse*', { excuses: 0.5 }, { neg: { excuses: -0.6, accountability: 0.6 } }), C('not do excuses', { excuses: -0.6, accountability: 0.7 }, { noNeg: true }),
  C('pitch', { excuses: 0.4 }, { ctx: true }), C('bog', { excuses: 0.6 }), C('no chance of playing', { excuses: 0.6 }, { noNeg: true }), C('impossible to play', { excuses: 0.7 }),
  C('wind', { excuses: 0.4 }), C('gusts', { excuses: 0.4 }), C('weather', { excuses: 0.4 }), C('no complaints', { excuses: -0.5, humility: 0.3 }, { noNeg: true }),
  C('shout out', { fans: 0.5 }, { ctx: true }), C('shoutout', { fans: 0.5 }, { ctx: true }), C('travelled', { fans: 0.5 }, { ctx: true }), C('away support', { fans: 0.7 }),
  C('the support', { fans: 0.4 }, { ctx: true }), C('never been prouder', { praise: 0.8, fans: 0.3 }, { noNeg: true }), C('can stay home', { fans: -0.8 }, { noNeg: true }), C('stay at home', { fans: -0.6 }, { ctx: true }),
  C('pathetic', { blame: 0.8 }, { ctx: true }), C('dead', { blame: 0.4 }, { ctx: true }), C('so called', { blame: 0.5 }, { ctx: true }), C('never kicked a ball', { blame: 0.7 }),
  C('disaster', { blame: 0.8 }, { ctx: true }), C('gave away', { blame: 0.6 }), C('asleep', { blame: 0.6 }, { ctx: true }), C('missed', { blame: 0.3 }, { ctx: true }), C('sitters', { blame: 0.5 }),
  C('needs to lift', { blame: 0.5 }), C('needs to wake up', { blame: 0.7 }), C('wake up', { blame: 0.4 }, { ctx: true }), C('big shout', { praise: 0.7 }, { ctx: true }), C('everywhere', { praise: 0.4 }, { ctx: true }),
  C('we will be right', { confidence: 0.6 }), C('we will be fine', { confidence: 0.5 }), C('we will be better', { confidence: 0.5, accountability: 0.3 }),
  C('make up the numbers', { confidence: -0.4 }, { neg: { confidence: 0.7 } }), C('take it on the chin', { accountability: 0.6 }), C('go again', { accountability: 0.4, confidence: 0.3 }),
  C('work hard', { accountability: 0.3, unity: 0.2 }), C('right things', { accountability: 0.3 }), C('best player', { praise: 0.7 }, { ctx: true }), C('deserves a mention', { praise: 0.6 }),
  C('deserves credit', { praise: 0.7 }), C('chuffed', { praise: 0.3 }, { ctx: true }), C('been brilliant', { praise: 0.8 }, { ctx: true }), C('a cracker', { confidence: 0.3 }),
  // slang and everyday phrasing (held-out review)
  C('unreal', { praise: 0.8 }, { ctx: true }), C('sensational', { praise: 0.9 }, { ctx: true }), C('a gun', { praise: 0.8 }, { ctx: true }), C('absolute gun', { praise: 0.9 }, { ctx: true }),
  C('a rock', { praise: 0.8 }, { ctx: true }), C('worked his backside off', { praise: 0.8 }), C('worked their backsides off', { praise: 0.8, unity: 0.3 }), C('deserved that', { praise: 0.6 }, { ctx: true }),
  C('best game', { praise: 0.7 }, { ctx: true }), C('never stopped running', { praise: 0.7 }), C('dug in', { praise: 0.6, unity: 0.3 }), C('happy for', { praise: 0.6 }, { ctx: true }),
  C('howler', { blame: 0.8 }, { ctx: true }), C('a passenger', { blame: 0.9 }, { ctx: true }), C('not acceptable', { blame: 0.7 }, { noNeg: true, ctx: true }), C('up to scratch', { blame: -0.3 }, { neg: { blame: 0.7 }, ctx: true }),
  C('off the pace', { blame: 0.6 }, { ctx: true }), C('let themselves down', { blame: 0.8 }), C('had a shocker', { blame: 0.8 }, { ctx: true }), C('know who they are', { blame: 0.6, unity: -0.3 }),
  C('pointing the finger', { blame: 0.6 }, { neg: { blame: -0.6, unity: 0.4 } }), C('point the finger', { blame: 0.6 }, { neg: { blame: -0.6, unity: 0.4 } }),
  C('stoked', { confidence: 0.6 }), C('rapt', { confidence: 0.5 }), C('get the job done', { confidence: 0.6 }), C('all over the place', { confidence: -0.6 }),
  C('not sure where', { confidence: -0.5 }, { noNeg: true }), C('much chance', { confidence: 0.4 }), C('chance', { confidence: 0.3 }, { subj: 'we' }), C('fitter side', { confidence: 0.5 }),
  C('we will nick it', { confidence: 0.5 }), C('nick it', { confidence: 0.4 }), C('our chance will come', { confidence: 0.5 }), C('everything we need', { confidence: 0.6 }),
  C('levels above', { arrogance: 0.8 }), C('basically ours', { arrogance: 0.9 }), C('title is basically', { arrogance: 0.9 }), C('with ten men and still win', { arrogance: 0.9 }),
  C('comfortably', { arrogance: 0.5 }, { ctx: true }), C('in our sleep', { arrogance: 0.9 }), C('not even break a sweat', { arrogance: 0.9 }, { noNeg: true }),
  C('carried away', { arrogance: 0.4 }, { neg: { humility: 0.8 } }), C('ahead of ourselves', { arrogance: 0.4 }, { neg: { humility: 0.8 } }), C('prepare properly', { humility: 0.5 }),
  C('like any other week', { humility: 0.4 }), C('rate them', { humility: 0.6 }), C('rate', { humility: 0.5 }, { subj: 'opp' }), C('no disrespect', { humility: 0.6 }, { noNeg: true }),
  C('all the best', { humility: 0.6 }), C('enjoy playing', { humility: 0.6 }), C('good handshake', { humility: 0.6 }), C('should be a beauty', { humility: 0.4 }),
  C('good bunch', { humility: 0.6 }, { subj: 'opp' }), C('fair hard game', { humility: 0.5 }), C('good blokes', { humility: 0.6 }),
  C('own that', { accountability: 0.8 }), C('have to own', { accountability: 0.8 }), C('buck stops with me', { accountability: 1 }), C('not with the players', { accountability: 0.4, blame: -0.5 }, { noNeg: true }),
  C('should have been a lot better', { accountability: 0.8 }), C('should have been better', { accountability: 0.7 }), C('did not do the basics', { accountability: 0.8 }, { noNeg: true }),
  C('hide behind', { excuses: 0.6 }, { neg: { excuses: -0.7, accountability: 0.7 } }), C('as a group', { unity: 0.6 }),
  C('gave them everything', { excuses: 0.8 }, { ctx: true }), C('the surface', { excuses: 0.4 }), C('done over', { excuses: 0.8 }), C('was a joke', { excuses: 0.4 }, { ctx: true }),
  C('noise', { fans: 0.4 }, { ctx: true }), C('you lot', { fans: 0.4 }), C('chant*', { fans: 0.5 }), C('belongs to you', { fans: 0.8 }), C('get down to the ground', { fans: 0.7 }),
  C('come down', { fans: 0.3 }, { ctx: true }), C('stood in the rain', { fans: 0.6 }), C('could not coach', { jab: 0.8 }, { subj: 'opp', noNeg: true }),
  C('spirit', { unity: 0.6 }), C('fitted in', { unity: 0.5 }), C('split', { unity: -0.8 }, { ctx: true }), C('did not show up', { unity: -0.5, blame: 0.4 }, { noNeg: true }),
];
LEXICON.sort((a, b) => b.p.length - a.p.length);   // longest phrases first

// Claims that can be checked against the league's data (for jabs at the opponent).
const CLAIMS = [
  { key: 'losing', re: /\b(losing (run|streak)|losing|lost (\w+ )?(in a row|straight|games|matches|on the bounce)|lost their last|on the bounce|can not win|not won|have not won|winless|out of form|bad form|bad run|poor form|no wins?|freefall|shocker of a run|confidence must be)\b/, fact: f => f.oppLosingRun },
  { key: 'late', re: /\b(late goals?|concede late|conceded? late|concedes? in the 80s|in the 80s|late on|at the death|closing stages|switch off (late|at the end|in the closing)|leaked goals late|leak late|fade|fold|run out of (steam|legs|gas)|last (ten|10|15|fifteen|20)( minutes)?|fitness|stamina|second half)\b/, fact: f => f.oppConcedesLate },
  { key: 'suspended', re: /\b(suspen\w*|banned|ban|without (him|their|his)|missing (their|his))\b/, fact: f => (f.oppSuspended || []).length > 0, names: f => f.oppSuspended || [] },
  { key: 'pressing', tactic: true, re: /\b(press\w*|pressure|high line|in their faces|close them down|hound\w*|on him all day)\b/, fact: f => (f.ownPressing ?? 0.5) >= 0.65 },
  { key: 'direct', tactic: true, re: /\b(long ball|go long|play(ing)? it long|direct|over the top|in behind|balls? in behind|pace in behind|in the air|hit the channels|channels|space behind|turn their centre ?backs?)\b/, fact: f => (f.ownDirectness ?? 0.5) >= 0.65 },
  { key: 'width', tactic: true, re: /\b(wide|width|wings?|flanks?|out wide|stretch them)\b/, fact: f => (f.ownWidth ?? 0.5) >= 0.65 },
];

const SARCASM = [/\/s\b/, /\byeah right\b/, /\bas if\b/, /\boh (great|wonderful|brilliant|lovely)\b/, /^(sure|right|yeah)\b[,.]/, /\bwow,? (thanks|great)\b/, /\bwhat a (surprise|shock)\b/, /🙄|😒|🙃/, /\bclassic\b.*\bagain\b/, /\bagain\b.*🙄/, /"(great|brilliant|fair|good|amazing|excellent)"/, /\bthanks? (a lot|for nothing)\b.*\b(ref|referee)\b/, /\bgreat (refereeing|decision|reffing)\b/];
const EMOJI = { confidence: /💪|🔥|🚀|⚡|😤/g, arrogance: /😂|🤣|🥱|😴|🤡|💤/g, fans: /❤️|❤|💙|💚|💛|🙏|🫶/g, unity: /🤝|👊/g };

// ---------------------------------------------------------------- targets

// Names a team is known by: full name, name without FC/United-style words, code, manager.
const FILLER = new Set(['fc', 'afc', 'united', 'city', 'town', 'rovers', 'athletic', 'the', 'club', 'sc', 'cf', 'team']);
const GENERIC = new Set(['lads', 'boys', 'men', 'stars', 'rangers', 'wanderers', 'warriors', 'legends', 'kings', 'giants', 'tigers', 'lions', 'eagles', 'wolves', 'bulls', 'sharks']);
function teamAliases(t) {
  const out = new Set();
  const name = normalise(t.name || '').replace(/[^a-z0-9 ]/g, ' ').trim();
  if (name) { out.add(name); out.add(name.replace(/\bunited\b/, 'utd')); out.add(name.replace(/\b(fc|afc|sc)\b/g, '').replace(/\s+/g, ' ').trim()); }
  const core = name.split(' ').filter(w => !FILLER.has(w)).join(' ').trim();
  if (core.length >= 3 && !GENERIC.has(core)) out.add(core);
  const mgr = normalise(t.manager || '').replace(/[^a-z ]/g, ' ').trim();
  if (mgr) { out.add(mgr); const parts = mgr.split(' '); for (const w of [parts[0], parts[parts.length - 1]]) if (w.length >= 4 && !COMMON.has(w)) out.add(w); }
  return [...out];
}
// Player names: full name, and surname if it's distinctive (4+ letters, not a common word).
const COMMON = new Set(['will', 'may', 'mark', 'hope', 'young', 'king', 'gold', 'rich', 'best', 'hill', 'wood', 'little', 'long', 'short', 'strong', 'good', 'great', 'star', 'first', 'rose', 'ward', 'sharp', 'fair', 'bell', 'lane', 'park', 'hall', 'field', 'price', 'moss', 'grant']);
function playerAliases(names) {
  const out = [];
  for (const n of names || []) {
    const full = normalise(n).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!full) continue;
    out.push({ alias: full, name: n });
    const parts = full.split(' ');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.length >= 4 && !COMMON.has(last)) out.push({ alias: last, name: n });
  }
  return out;
}
// Both squads' aliases, adding first names (4+ letters) when they're unique in the squad.
// A first name in both squads is `shared`: it only counts as ours when the sentence says "our"/"for us".
function playerAliasSets(ownNames, oppNames) {
  const own = playerAliases(ownNames), opp = playerAliases(oppNames);
  const first = list => {
    const m = new Map();
    for (const n of list || []) {
      const f = normalise(n).split(' ')[0].replace(/[^a-z]/g, '');
      if (f.length >= 4 && !COMMON.has(f)) m.set(f, m.has(f) ? null : n);
    }
    return m;
  };
  const fo = first(ownNames), fp = first(oppNames), shared = [];
  for (const [f, n] of fo) { if (!n) continue; if (fp.has(f)) shared.push({ alias: f, own: n }); else own.push({ alias: f, name: n }); }
  for (const [f, n] of fp) if (n && !fo.has(f)) opp.push({ alias: f, name: n });
  return { own, opp, shared };
}
// Punctuation doesn't matter when matching names ("Reserved Team #2", "St. Kilda").
const hasPhrase = (s, phrase) => new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(String(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' '));

// ---------------------------------------------------------------- one statement

// ctx: { team, opponent, teams: [{code, name, manager}], ownPlayers: [names], oppPlayers: [names],
//        facts: { oppLosingRun, oppConcedesLate, oppSuspended: [names], ownPressing, ownDirectness, ownWidth, lastResult } }
const POSITIVE = ['confidence', 'praise', 'fans', 'humility', 'unity'];
const SAY_VERBS = /\b(not|never) (going to |gonna )?(say|call|think|believe|reckon|accept|admit|see|expect|pretend|claim|stand here)\b/;
// "I'm not going to say they're a pub team, but everyone knows …" is still the insult.
const PARALIPSIS = /\b(but|though|although|everyone knows|let us just say|put it this way)\b/;
const SYMPATHY = /\b(sorry|hope|feel for|good luck|turn it around|back soon|get well|best wishes|all the best)\b/;
const OWN_REF = /\b(the lads|the boys|our boys|our lads|of the lads|of the boys|players|squad|my team|the team|dressing room|camp|blokes|a few of|some of them|he|him|his)\b/;

export function readStatement(text, ctx = {}) {
  const raw = String(text || '').normalize('NFKC').replace(/\p{Cf}/gu, '');
  const signals = Object.fromEntries(SIGNALS.map(k => [k, 0]));
  const reasons = [];
  const why = (signal, v, quote, note) => reasons.push({ signal, v: Math.round(v * 100) / 100, quote: String(quote).slice(0, 80), note });
  const norm = normalise(raw);
  const words = tokens(norm).filter(w => /[a-z]/.test(w));

  // Quality gate.
  const letters = (raw.match(/\p{L}/gu) || []).length, nonSpace = raw.replace(/\s/g, '').length || 1;
  const uniq = new Set(words).size;
  const mash = words.filter(w => w.length >= 5 && (!/[aeiouy]/.test(w) || /[^aeiouy]{5,}/.test(w) || /(asdf|qwer|zxcv|hjkl|sdfg|jkl)/.test(w))).length;
  const noiseWhy = words.length < LIMITS.minWords ? 'too short'
    : letters / nonSpace < 0.6 ? 'mostly symbols or numbers'
    : uniq / words.length < 0.35 && words.length >= 5 ? 'the same words over and over'
    : mash / words.length > 0.25 ? 'keyboard mashing' : '';
  if (noiseWhy) {
    signals.noise = 1;
    why('noise', 1, raw, noiseWhy);
    return { signals, reasons, noise: true, words: words.map(stem), strength: 0 };
  }

  const teams = ctx.teams || [];
  const opp = teams.find(t => t.code === ctx.opponent);
  const oppAliases = opp ? [...teamAliases(opp), ...(ctx.opponent ? [ctx.opponent.toLowerCase()] : [])].filter(a => a.length >= 3) : [];
  const otherTeams = teams.filter(t => t.code !== ctx.opponent && t.code !== ctx.team).map(t => ({ code: t.code, aliases: teamAliases(t).filter(a => a.length >= 3) }));
  const { own: ownAliases, opp: oppPlayerAliases, shared } = playerAliasSets(ctx.ownPlayers, ctx.oppPlayers);
  const facts = ctx.facts || {};

  // Sentences (split after . ! ? and new lines). With no other team named, "they/them"
  // means the next opponent unless the sentence is about our own players.
  const sentences = norm.split(/(?<=[.!?])\s+|\n+|(?<=[.!?])(?=[a-z])/).map(s => s.trim()).filter(Boolean);
  const namedAnywhere = oppAliases.some(a => hasPhrase(norm, a)) || oppPlayerAliases.some(a => hasPhrase(norm, a.alias));
  // "They" defaults to the next opponent, but a jab without naming them counts for less.
  let focus = 'opp', sarcasmCarry = false;
  const claimKeys = [];   // which checkable claims the statement makes
  let jabHits = 0;
  for (const s of sentences) {
    const toks = tokens(s);
    // Clause number of each token.
    const clauseOf = [];
    { let c = 0, k = 0; for (const m of s.matchAll(/[a-z]+|\d+|[,;:]/g)) { if (/[,;:]/.test(m[0]) || m[0] === 'but') c++; if (/[,;:]/.test(m[0])) continue; clauseOf[k++] = c; } }
    const clauseText = i => toks.filter((_, j) => clauseOf[j] === clauseOf[i]).join(' ');
    let lastNeg = -1;   // index of the last negated cue, so "not the pitch or the weather" carries on
    const ours = /\b(for us|our|we)\b/.test(s);
    let ownNamed = ownAliases.filter(a => hasPhrase(s, a.alias));
    // A first name both squads share counts as ours only when the sentence says so.
    const sharedHit = shared.filter(a => hasPhrase(s, a.alias));
    if (sharedHit.length && ours) ownNamed = ownNamed.concat(sharedHit.map(a => ({ alias: a.alias, name: a.own })));
    const oppNamedPlayer = oppPlayerAliases.some(a => hasPhrase(s, a.alias));
    const namesOpp = oppAliases.some(a => hasPhrase(s, a)) || oppNamedPlayer;
    const namesOther = otherTeams.some(t => t.aliases.some(a => hasPhrase(s, a)));
    if (namesOpp) focus = 'opp'; else if (namesOther) focus = 'other';
    const theyWords = /\b(they|them|their|theirs)\b/.test(s);
    const aboutOwnPlayers = ownNamed.length > 0 || OWN_REF.test(s);
    const aboutOpp = namesOpp || (focus === 'opp' && theyWords && !namesOther && !aboutOwnPlayers);
    const aboutOther = !aboutOpp && (namesOther || (focus === 'other' && theyWords));
    const aboutWe = /\b(we|us|our|ours|i|my|me)\b/.test(s), weAct = /\b(we|i)\b/.test(s);
    const aboutFans = /\b(fans|supporters|crowd|everyone who|you all|you lot|yous|the support|our support|the ground|people who (turn|come|came|travel)|chant)\w*/.test(s) && !ownNamed.length;
    const aboutRef = /\b(ref|refs|referee\w*|reff\w*|officials?|officiating|var|linesm[ae]n|decisions?|surface)\b/.test(s);
    const aboutPlayers = aboutOwnPlayers || /\b(they)\b/.test(s);
    const sarcastic = sarcasmCarry || SARCASM.some(re => re.test(s)) || (/\blol\b|😂|🤣/.test(s) && /\b(great|good|brilliant|fair|lovely)\b/.test(s));
    // A bare "Sure..." or "Yeah right." makes what follows sarcastic too.
    if (toks.length <= 2 && /^(sure|right|yeah right|as if|oh yeah|yeah sure)\b/.test(s)) sarcasmCarry = true;
    const rhetorical = /\?$/.test(s) && toks.length <= 3;
    const denies = /\b(nothing to do with|not about the|no complaints)\b/.test(s);
    const sayNeg = s.match(SAY_VERBS);
    // Words inside quotes ('brilliant', "tough opponent") are being mocked.
    const quoted = new Array(toks.length).fill(false);
    for (const m of s.matchAll(/(^|[\s(])['"]([^'"]{2,60})['"](?=[\s,.!?;:)]|$)/g)) {
      const inner = tokens(m[2]), at = tokens(s.slice(0, m.index + m[1].length)).length;
      for (let j = 0; j < inner.length; j++) quoted[at + j] = true;
    }

    const used = new Array(toks.length).fill(false);
    const local = Object.fromEntries(SIGNALS.map(k => [k, 0]));
    const mentions = [];   // neutral "fans"/"thanks" mentions, kept only if the sentence isn't negative
    for (const cue of LEXICON) {
      for (let i = 0; i + cue.p.length <= toks.length; i++) {
        let ok = true;
        for (let j = 0; j < cue.p.length && ok; j++) {
          const want = cue.p[j], got = toks[i + j];
          ok = !used[i + j] && (want.endsWith('*') ? got.startsWith(want.slice(0, -1)) : got === want);
        }
        if (!ok) continue;
        if (cue.subj === 'opp' && !aboutOpp) continue;
        if (cue.subj === 'we' && !aboutWe) continue;
        if (cue.subj === 'fans' && !aboutFans) continue;
        if (cue.subj === 'ref' && !aboutRef) continue;
        if (cue.subj === 'player' && !aboutPlayers) continue;
        for (let j = 0; j < cue.p.length; j++) used[i + j] = true;
        const quote = cue.p.join(' ').replace(/\*/g, '…');
        const isQuoted = quoted[i];

        // Negation: four words before, "not going to say …" earlier in the sentence, or
        // "nobody / no one / nothing" straight after ("we respect nobody").
        const before = toks.slice(Math.max(0, i - 4), i).filter((_, j) => clauseOf[Math.max(0, i - 4) + j] === clauseOf[i]);
        const chained = lastNeg >= 0 && clauseOf[lastNeg] === clauseOf[i] && toks.slice(lastNeg, i).some(w => w === 'or' || w === 'nor' || w === 'and');
        const after = toks.slice(i + cue.p.length, i + cue.p.length + 2).join(' ');
        const sayAt = sayNeg ? tokens(s.slice(0, s.indexOf(sayNeg[0]))).length : -1;
        const sayBefore = sayAt >= 0 && sayAt < i && clauseOf[sayAt] === clauseOf[i] && !PARALIPSIS.test(s);
        const negCount = before.filter(w => NEGATORS.has(w)).length;
        const negated = !cue.noNeg && ((negCount % 2 === 1) || sayBefore || chained || /^(nobody|no one|nothing|none)\b/.test(after));
        if (negated) lastNeg = i;
        const cl = clauseText(i), clWe = /\b(we|i)\b/.test(cl), clRef = /\b(ref|refs|referee\w*|reff\w*|officials?|officiating|var|linesm[ae]n|decisions?)\b/.test(cl);
        let mult = 1;
        for (const w of toks.slice(Math.max(0, i - 2), i)) mult *= INTENSIFIERS[w] || SOFTENERS[w] || 1;
        let sig = cue.s;
        if (negated) {
          if (cue.neg) sig = cue.neg;
          else if (Object.keys(cue.s).every(k => k === 'arrogance' || k === 'jab')) sig = { humility: 0.4 * Math.max(...Object.values(cue.s)) };
          else sig = Object.fromEntries(Object.entries(cue.s).map(([k, v]) => [k, -v * 0.6]));
        }

        for (let [k, v] of Object.entries(sig)) {
          v *= mult;
          if (rhetorical && v > 0 && POSITIVE.includes(k)) continue;
          // Mocked in quotes: praise turns to blame, "family" to division, respect to nothing.
          if (isQuoted && v > 0 && POSITIVE.includes(k)) {
            if (k === 'praise') { k = 'blame'; v *= 0.7; } else if (k === 'unity') v = -v * 0.7; else continue;
          }
          // Negated praise of a player is criticism.
          if (negated && k === 'praise' && v < 0 && (ownNamed.length || aboutOwnPlayers)) { k = 'blame'; v = Math.abs(v); }
          // Context-dependent words only count about the right people.
          if (k === 'praise' || k === 'blame') {
            const wasBlame = k === 'blame';
            if (aboutOpp && !ownNamed.length) { if (!wasBlame) { k = 'humility'; v *= 0.8; } else if (v > 0) { k = 'jab'; v *= 0.7; } else continue; }
            else if (aboutFans) { k = 'fans'; v = wasBlame ? -Math.abs(v) : v; }
            else if (clRef && wasBlame && !ownNamed.length) { k = 'excuses'; v = Math.abs(v) * 0.8; }
            else if (!ownNamed.length && clWe && wasBlame && v > 0 && !/\b(some|certain|few|couple|he|him|his)\b/.test(s)) { k = 'accountability'; v *= 0.8; }
            else if (!aboutPlayers && cue.ctx) continue;
            else if (ownNamed.length) v *= 1.3;   // naming a player counts more
          }
          if (k === 'excuses') {
            if (cue.ctx && !aboutRef && !/\b(pitch|injur\w*|weather|bog)\b/.test(s)) continue;
            if (aboutRef && /\b(good|fair|great|fine|decent) (game|job|decisions?)\b/.test(s) && !sarcastic) v = -Math.abs(v);
            if (denies && v > 0) v = -v;
            if (aboutOpp && v > 0 && !aboutWe) { k = 'humility'; v *= 0.8; }   // "they've been unlucky" is sympathy
          }
          if (k === 'fans' && v > 0 && cue.ctx) { mentions.push({ v, quote }); continue; }
          if (k === 'arrogance' && cue.ctx && !aboutOpp && !/\b(win|game|match|points|them|league|for us|season)\b/.test(s)) continue;
          if (k === 'jab' && aboutOpp && /\b(we|us|our|ours)\b/.test(cl) && !/\b(they|them|their)\b/.test(cl) && !oppAliases.some(a => hasPhrase(cl, a)) && !oppPlayerAliases.some(a => hasPhrase(cl, a.alias))) continue;   // self-criticism
          if (k === 'jab' && !aboutOpp) {
            if (aboutOther) why('jab', 0, quote, 'aimed at another team, not the next opponent');
            continue;
          }
          if (k === 'unity' && cue.ctx && !aboutPlayers && !aboutWe) continue;
          if (sarcastic && v > 0 && POSITIVE.includes(k)) {
            if (aboutRef) { k = 'excuses'; v = Math.abs(v); } else v = -v * 0.7;
          }
          if (sarcastic && k === 'arrogance') continue;
          local[k] += v;
          why(k, v, quote, negated ? 'negated' : isQuoted ? 'in mocking quotes' : sarcastic && v < 0 ? 'sarcastic' : ownNamed.length && (k === 'praise' || k === 'blame') ? `about ${ownNamed[0].name}` : '');
        }
      }
    }
    // Neutral mentions of the fans only count if the sentence isn't having a go at them.
    const hostileToFans = aboutFans && (local.fans < 0 || local.blame > 0 || sarcastic || quoted.some(Boolean) || /\b(clueless|pathetic|dead|stay home|do not care|so called|left at)\b/.test(s));
    if (hostileToFans && local.fans >= 0) { local.fans -= 0.6; why('fans', -0.6, s, 'having a go at the fans'); }
    else if (!hostileToFans) for (const m of mentions) { local.fans += m.v; why('fans', m.v, m.quote, ''); }

    if (sarcastic && aboutRef && local.excuses <= 0) { local.excuses += 0.7; why('excuses', 0.7, s, 'sarcasm about the officials'); }

    // Praising an opponent's player is respect, not a jab.
    if (oppNamedPlayer && /\b(great|good|quality|class|brilliant|dangerous|respect|talent\w*|top|back soon)\b/.test(s) && !toks.some(w => NEGATORS.has(w)) && local.jab <= 0) {
      local.humility += 0.4; why('humility', 0.4, s, 'credit to an opposition player');
    }
    // Scoreline predictions ("we'll win 5-0") are arrogant, unless it's sarcasm.
    const score = s.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
    if (score && !sarcastic && /\b(will|going to|predict|easy|win|nil|minimum|book it|mark it)\b/.test(s) && Math.abs(score[1] - score[2]) >= 3) { local.arrogance += 0.7; why('arrogance', 0.7, score[0], 'predicting a hammering'); }

    // Jabs at the next opponent: a checkable claim about their weakness is a jab in itself;
    // it's credible if the league's data backs it, empty if not.
    if (aboutOpp) {
      const sympathy = SYMPATHY.test(s);
      const claims = [];
      for (const cl of CLAIMS) {
        const byWords = cl.re.test(s), byName = !!cl.names && cl.names(facts).some(n => hasPhrase(s, normalise(n).replace(/[^a-z ]/g, ' ').trim()) || hasPhrase(s, normalise(n).split(' ').pop()));
        if (byWords || byName) { claims.push({ cl, byWords }); claimKeys.push(cl.key); }
      }
      if (claims.length && !sympathy && local.jab <= 0.2) { local.jab += 0.5; why('jab', 0.5, s.slice(0, 60), 'pointing at a weakness'); }
      if (local.jab > 0) {
        for (const { cl, byWords } of claims) {
          const q = s.match(cl.re)?.[0] || cl.key;
          if (cl.key === 'suspended' && !byWords) { local.empty += 0.7; why('empty', 0.7, q, 'talks as if a suspended player will play'); continue; }
          if (cl.fact(facts)) {
            const c = cl.tactic ? 0.45 : 0.8;   // our own tactics: half as convincing as a fact from the results
            if (c > local.credible) { local.credible = c; why('credible', c, q, cl.tactic ? `fits our tactics: ${cl.key}` : `true: ${cl.key}`); }
          }
          else if (local.empty < 0.7) { local.empty = 0.7; why('empty', 0.7, q, `not true: ${cl.key}`); }
        }
      }
      // Respect with no dig in it counts against any jab.
      if (local.jab <= 0 && local.humility > 0.2) { local.jab -= 0.6 * Math.min(1, local.humility); why('jab', -0.6 * Math.min(1, local.humility), s.slice(0, 60), 'respect for the opponent'); }
    }
    if (local.jab > 0) jabHits++;
    for (const k of SIGNALS) signals[k] += local[k];
  }
  if (signals.jab > 0 && signals.credible <= 0 && signals.empty <= 0) { signals.empty += 0.6 * Math.min(1, signals.jab); why('empty', 0.6, raw, 'a jab with nothing to back it up'); }

  // Shouting and emoji.
  const caps = (raw.match(/[A-Z]/g) || []).length / Math.max(1, (raw.match(/[a-zA-Z]/g) || []).length);
  if (caps > 0.6 && words.length >= 4) { signals.arrogance += 0.3; why('arrogance', 0.3, raw, 'shouting'); }
  if (/!{3,}/.test(raw)) { signals.arrogance += 0.2; why('arrogance', 0.2, '!!!', 'shouting'); }
  for (const [k, re] of Object.entries(EMOJI)) {
    const n = (raw.match(re) || []).length;
    if (n) { const v = Math.min(0.5, 0.25 * n) * (k === 'arrogance' && !jabHits ? 0.5 : 1); signals[k] += v; why(k, v, (raw.match(re) || [])[0], 'emoji'); }
  }

  if (!namedAnywhere && signals.jab > 0) { signals.jab *= 0.6; why('jab', 0, raw.slice(0, 40), 'the opponent is never named, so it counts for less'); }
  for (const k of SIGNALS) signals[k] = Math.max(-1, Math.min(1, Math.round(Math.tanh(signals[k]) * 100) / 100));
  // Kitchen-sink statements: the signals of one statement add up to at most 2.5.
  const total = SIGNALS.filter(k => k !== 'noise').reduce((a, k) => a + Math.abs(signals[k]), 0);
  if (total > 2.5) for (const k of SIGNALS) signals[k] = Math.round(signals[k] * 2.5 / total * 100) / 100;
  const strength = SIGNALS.filter(k => k !== 'noise').reduce((a, k) => a + Math.abs(signals[k]), 0);
  return { signals, reasons, noise: false, words: [...new Set(words.map(stem))], strength, claims: [...new Set(claimKeys)] };
}

// ---------------------------------------------------------------- similarity

const STOP = new Set('the a an and or but to of in on at for with is are was were be been it this that we they i you he she our their my your us them me so just very really will would can could not no do did does have has had as by from up out about than then there here what when how all'.split(' '));
export function similarity(a, b) {
  const A = new Set(a.words.filter(w => !STOP.has(w))), B = new Set(b.words.filter(w => !STOP.has(w)));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jac = inter / (A.size + B.size - inter);
  // Same kind of message (same strongest signals) makes a small word overlap enough.
  const top = r => SIGNALS.filter(k => Math.abs(r.signals[k]) >= 0.3).sort().join();
  return top(a) && top(a) === top(b) ? Math.max(jac, Math.min(1, jac * 1.6)) : jac;
}

// ---------------------------------------------------------------- one team, one match

const dateOf = x => (x && x.date ? new Date(`${String(x.date).slice(0, 19)}Z`) : null);
const side = (f, code) => (f.home === code ? 'home' : 'away');
const gfga = (f, code) => (f.home === code ? [f.result.home, f.result.away] : [f.result.away, f.result.home]);
const played = (season, code, before) => season.fixtures
  .filter(f => (f.home === code || f.away === code) && f.result && kickoff(f) && kickoff(f) < before && !f.postponed)
  .sort((a, b) => kickoff(a) - kickoff(b));

// Checkable facts about the opponent before this match, and the speaker's own tactics.
function factsFor(season, files, fixture, code, opp) {
  const ko = kickoff(fixture) || new Date(8.64e15);
  const oppPlayed = played(season, opp, ko);
  const last = oppPlayed.slice(-3).map(f => { const [a, b] = gfga(f, opp); return a > b ? 'W' : a < b ? 'L' : 'D'; });
  const lateConceded = oppPlayed.slice(-4).filter(f => (f.result.goals || []).some(g => g.team !== opp && g.minute >= 75 && !(g.own_goal && g.team === opp))).length;
  const oppNames = new Set((season.players || []).filter(p => p.team === opp).map(p => String(p.id)));
  let banned = [];
  try { banned = (suspensions(season).get(fixture.id) || []).filter(b => oppNames.has(String(b.player))).map(b => b.name).filter(Boolean); } catch { /* no rules */ }
  const tac = files[code]?.tactics || {};
  const mine = played(season, code, ko), prev = mine[mine.length - 1];
  let lastResult = null;
  if (prev) { const [a, b] = gfga(prev, code); lastResult = a > b ? 'win' : a < b ? 'loss' : 'draw'; }
  return {
    oppLosingRun: last.length >= 2 && !last.includes('W') && last.filter(r => r === 'L').length >= 2,
    oppConcedesLate: lateConceded >= 2,
    oppSuspended: banned,
    ownPressing: tac.pressing, ownDirectness: tac.directness, ownWidth: tac.width,
    lastResult,
  };
}

function contextFor(season, files, fixture, code) {
  const opp = fixture.home === code ? fixture.away : fixture.home;
  const names = c => (season.players || []).filter(p => p.team === c).map(p => p.name);
  return {
    team: code, opponent: opp,
    teams: season.teams.map(t => ({ code: t.code, name: t.name, manager: t.manager })),
    ownPlayers: names(code), oppPlayers: names(opp),
    facts: factsFor(season, files, fixture, code, opp),
  };
}

// The press items that count for this match: after the previous match kicked off, before `until`.
function windowItems(season, files, fixture, code, until) {
  const ko = kickoff(fixture) || new Date(8.64e15);
  const prev = played(season, code, ko).pop();
  const from = prev ? kickoff(prev) : new Date(0);
  const end = new Date(Math.min(+until, +ko));
  const file = files[code] || {};
  const inWin = d => d && d > from && d <= end;
  // Only the newest 60 are read (the relay keeps 100); the rest still count toward the volume penalty.
  const all = (file.press || []).filter(p => p.a && inWin(dateOf(p)));
  const real = realQuestionIds(season, code);
  const items = all.slice(-60)
    .map(p => ({ id: p.id, text: String(p.a).slice(0, 1500), q: p.q, kind: real.has(p.id) ? 'answer' : 'statement', date: p.date, tac: p.tac, edited: !!p.edited }));
  items.total = all.length;
  // The team-news message counts only with the relay's own date for it (message_date).
  const md = file.message_date;
  if (file.message && md && inWin(dateOf({ date: md }))) items.push({ id: 'message', text: file.message, kind: 'message', date: md });
  return { items, from, end, prev };
}

// Ids of the questions this team was really asked: the league office's, and the automatic
// match / preview / table / scorer ones (js/managers.js pressQuestions). Anything else is a statement.
function realQuestionIds(season, code) {
  const ids = new Set();
  for (const q of season.press_questions || []) if (q.team === code || q.team === 'all') ids.add(`admin-${q.id}`);
  for (const f of season.fixtures || []) if (f.home === code || f.away === code) for (const k of ['res', 'red', 'pre']) ids.add(`${k}-${f.id}`);
  for (let w = 0; w <= 60; w++) ids.add(`table-w${w}`);
  for (const p of season.players || []) if (p.team === code) for (let g = 2; g <= 60; g++) ids.add(`scorer-${p.id}-${g}`);
  return ids;
}

// Read, dedupe and weigh one team's window.
function scoreWindow(items, ctx) {
  // Tactical claims are checked against the tactics saved when the statement was made.
  const factsAt = it => (it.tac ? { ...ctx.facts, ownPressing: it.tac.pressing, ownDirectness: it.tac.directness, ownWidth: it.tac.width } : ctx.facts);
  const read = items.map(it => ({ ...it, r: readStatement(it.text, { ...ctx, facts: factsAt(it) }) }));
  const noise = read.filter(x => x.r.noise);
  const real = read.filter(x => !x.r.noise).sort((a, b) => b.r.strength * KIND_WEIGHT[b.kind] - a.r.strength * KIND_WEIGHT[a.kind]);
  const kept = [], dupes = [];
  for (const x of real) {
    const twin = kept.find(k => similarity(k.r, x.r) >= LIMITS.similar);
    if (twin) { dupes.push({ ...x, twinOf: twin.id }); continue; }
    kept.push(x);
  }
  const counted = kept.slice(0, LIMITS.counted);
  const sums = Object.fromEntries(SIGNALS.map(k => [k, 0]));
  counted.forEach((x, i) => {
    x.weight = Math.round(Math.pow(LIMITS.decay, i) * KIND_WEIGHT[x.kind] * (x.edited ? 0.5 : 1) * 100) / 100;   // edited answers count half
    for (const k of SIGNALS) sums[k] += x.r.signals[k] * x.weight;
  });
  const s = Object.fromEntries(SIGNALS.map(k => [k, Math.tanh(sums[k])]));
  return { read, counted, dupes, noise, ignored: kept.slice(LIMITS.counted), s };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r1 = v => Math.round(v * 10) / 10;
const pct = v => Math.round(v * 10000) / 10000;   // fraction, 4 dp (0.0123 = 1.23%)

// ---------------------------------------------------------------- both teams

// files: { CODE: team file }. opts.now: when the match is simulated (default now).
// opts.memo: internal cache for the carried-over meters.
export function pressEffect(season, files, fixture, opts = {}) {
  const now = opts.now || new Date();
  const memo = opts.memo || new Map();
  const H = fixture.home, A = fixture.away;
  if (!H || !A) return null;

  // Meters carried over from each team's previous match (its frozen snapshot, or recomputed).
  const carried = code => {
    const ko = kickoff(fixture) || new Date(8.64e15);
    const prev = played(season, code, ko).pop();
    if (!prev) return { fans: 0, happiness: 0, prev: null };
    const snap = prev.result?.press?.[side(prev, code)];
    if (snap && Number.isFinite(snap.fans)) return { fans: snap.fans, happiness: snap.happiness, prev };
    const key = `${prev.id}:${code}`;
    if (!memo.has(key)) {
      memo.set(key, { fans: 0, happiness: 0 });   // guards against loops
      const e = pressEffect(season, files, prev, { now: kickoff(prev), memo });
      memo.set(key, e ? { fans: e[side(prev, code)].fans, happiness: e[side(prev, code)].happiness } : { fans: 0, happiness: 0 });
    }
    return { ...memo.get(key), prev };
  };

  const team = code => {
    const ctx = contextFor(season, files, fixture, code);
    const win = windowItems(season, files, fixture, code, now);
    const w = scoreWindow(win.items, ctx);
    const c = carried(code);
    const lines = [];   // why the meters moved: [meter, amount, reason]
    const add = (meter, v, reason) => { if (Math.abs(v) >= 0.05) lines.push({ meter, v: r1(v), reason }); return v; };

    // Result of the previous match.
    let fans = 0, happy = 0;
    const lr = ctx.facts.lastResult;
    if (c.prev) {
      const [gf, ga] = gfga(c.prev, code), margin = Math.min(4, Math.abs(gf - ga));
      const res = { win: [8 + margin, 8 + margin], draw: [1, 0], loss: [-7 - margin, -6 - margin] }[lr];
      fans += add('fans', res[0], `${gf}-${ga} ${lr} last time out`);
      happy += add('happiness', res[1], `${gf}-${ga} ${lr} last time out`);
    }
    const s = w.s, after = lr === 'loss' ? 1.5 : 1;
    fans += add('fans', 16 * s.fans, s.fans >= 0 ? 'spoke well of the fans' : 'had a go at the fans');
    fans += add('fans', 10 * s.accountability * after, s.accountability >= 0 ? 'took responsibility' : 'dodged responsibility');
    fans += add('fans', 6 * s.humility, s.humility >= 0 ? 'showed respect' : 'dismissive of others');
    fans += add('fans', -12 * Math.max(0, s.arrogance) * after, 'arrogance');
    fans += add('fans', -10 * Math.max(0, s.excuses) * after, 'making excuses');
    fans += add('fans', -8 * Math.max(0, s.empty), 'empty trash talk');
    fans += add('fans', 5 * Math.max(0, s.credible), 'a sharp, well-aimed jab');
    fans += add('fans', -Math.min(25, 4 * w.dupes.length), `${w.dupes.length} repeated statement${w.dupes.length === 1 ? '' : 's'}`);
    fans += add('fans', -2 * w.noise.length, `${w.noise.length} throwaway answer${w.noise.length === 1 ? '' : 's'}`);
    const total = (win.items.total ?? win.items.length) + (win.items.some(i => i.kind === 'message') ? 1 : 0);
    const volume = total - LIMITS.volume;
    if (volume > 0) fans += add('fans', -Math.min(20, volume * 3), `${total} statements in one week`);
    const answered = win.items.filter(i => i.kind === 'answer').length;
    if (c.prev && !answered) fans += add('fans', -3, 'no media questions answered');
    else if (answered) fans += add('fans', Math.min(6, 2 * answered), 'fronted up to the media');

    happy += add('happiness', 16 * s.praise, s.praise >= 0 ? 'praised the players' : 'played the players down');
    happy += add('happiness', -20 * Math.max(0, s.blame), 'blamed players in public');
    happy += add('happiness', 12 * s.unity, s.unity >= 0 ? 'talked up the group' : 'hinted at a split');
    happy += add('happiness', 6 * s.confidence, s.confidence >= 0 ? 'backed the team' : 'sounded beaten');
    happy += add('happiness', 4 * s.accountability, 'shielded the players');
    happy += add('happiness', -4 * Math.max(0, s.excuses), 'excuses');

    const L = LIMITS.meter;
    const fansNow = clamp(c.fans * LIMITS.carry + fans, -L, L), happyNow = clamp(c.happiness * LIMITS.carry + happy, -L, L);
    const home = code === H;
    let perf = 0.022 * (happyNow / L) + (home ? 0.012 : 0.005) * (fansNow / L) + 0.006 * s.confidence - 0.008 * Math.max(0, s.arrogance);
    perf = clamp(perf, -LIMITS.perf, LIMITS.perf);

    // Mind games: the strongest two jabs at the next opponent.
    // The same claim said two ways is one jab; a jab with no claim is compared by wording.
    const jabs = [];
    for (const x of w.counted.filter(x => x.r.signals.jab > 0.1).sort((a, b) => b.r.signals.jab - a.r.signals.jab)) {
      const same = jabs.some(j => (x.r.claims.length && x.r.claims.some(c => j.r.claims.includes(c))) || similarity(j.r, x.r) >= 0.35);
      if (!same && jabs.length < LIMITS.jabs) jabs.push(x);
    }
    return { code, ctx, win, w, c, lines, fansNow, happyNow, perf, jabs, answered };
  };

  const h = team(H), a = team(A);
  // Jabs land on the other team: credible ones rattle it, empty ones fire it up.
  const mind = (from, to) => {
    let eff = 0;
    const calm = to.w.counted.some(x => (x.kind === 'answer' || x.r.signals.jab < -0.1) && (x.r.signals.humility > 0.25 || x.r.signals.confidence > 0.25) && x.r.signals.jab <= 0.1 && x.r.signals.arrogance <= 0.3);
    const notes = [];
    from.jabs.forEach((x, i) => {
      const k = i ? 0.6 : 1, jab = x.r.signals.jab;
      if (x.r.signals.credible > x.r.signals.empty) {
        let v = -0.02 * jab * (0.5 + 0.5 * x.r.signals.credible) * k;
        v *= 1 - Math.max(0, to.happyNow) / 200;
        if (calm) v *= 0.5;
        eff += v;
        notes.push({ v: pct(v), quote: x.text.slice(0, 120), why: `hit a nerve${calm ? ', but they stayed calm' : ''}` });
      } else {
        const v = 0.012 * jab * k;
        eff += v;
        notes.push({ v: pct(v), quote: x.text.slice(0, 120), why: 'nothing behind it: fired them up' });
      }
    });
    return { eff: clamp(eff, -LIMITS.oppPerf, LIMITS.oppPerf), notes, calm };
  };
  const onA = mind(h, a), onH = mind(a, h);

  const out = (me, done, got) => ({
    fans: r1(me.fansNow), happiness: r1(me.happyNow),
    perf: pct(me.perf), oppPerf: pct(done.eff),
    final: pct(clamp(me.perf + got.eff, -LIMITS.final, LIMITS.final)),
    received: pct(got.eff),
    carried: { fans: r1(me.c.fans), happiness: r1(me.c.happiness) },
    reasons: me.lines,
    jabs: done.notes, jabsReceived: got.notes,
    counted: me.w.counted.map(x => ({ id: x.id, kind: x.kind, weight: x.weight, text: x.text.slice(0, 160), signals: pickSignals(x.r.signals) })),
    repeats: me.w.dupes.map(x => ({ id: x.id, text: x.text.slice(0, 120) })),
    ignored: [...me.w.noise.map(x => ({ id: x.id, text: x.text.slice(0, 60), why: x.r.reasons[0]?.note || 'noise' })), ...me.w.ignored.map(x => ({ id: x.id, text: x.text.slice(0, 60), why: 'over the limit' }))],
    window: { from: me.win.from.toISOString().slice(0, 19), to: me.win.end.toISOString().slice(0, 19), items: (me.win.items.total ?? me.win.items.length) },
  });
  return { home: out(h, onA, onH), away: out(a, onH, onA), at: new Date(now).toISOString().slice(0, 19), v: 1 };
}
const pickSignals = s => Object.fromEntries(Object.entries(s).filter(([, v]) => Math.abs(v) >= 0.1));

// For the engine: the final performance change for each team (fractions).
export const formFor = effect => (effect ? { home: effect.home.final, away: effect.away.final } : { home: 0, away: 0 });

// ---------------------------------------------------------------- display helpers

// Colour tone for a value: 'up' | 'down' | 'flat' (meters: ±100; fractions: ±0.05).
export function tone(v, scale = 100) {
  const x = v / scale;
  return x >= 0.05 ? 'up' : x <= -0.05 ? 'down' : 'flat';
}
export const fmtPct = v => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toFixed(1)}%`;
export const fmtMeter = v => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v))}`;
export function moodLabel(kind, v) {
  const x = kind === 'perf' ? v / 0.04 : v / 100;
  const bands = {
    fans: ['Furious', 'Unhappy', 'Steady', 'Behind the team', 'Buzzing'],
    happiness: ['Broken', 'Fractured', 'Settled', 'Happy', 'Fired up'],
    perf: ['Rattled', 'Off the pace', 'Normal', 'Sharp', 'Flying'],
  }[kind] || ['', '', '', '', ''];
  return bands[x <= -0.5 ? 0 : x <= -0.1 ? 1 : x < 0.1 ? 2 : x < 0.5 ? 3 : 4];   // neutral only within ±10%
}
