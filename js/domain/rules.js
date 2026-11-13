// Training rules library.
//
// One versioned set of rules, with sources. The plan generator, the in-session
// and after-session adjustments, and the prompt sent to Claude all read from
// this file, so they cannot drift apart. docs/training-rules.md is generated
// from it (npm run rules-doc).
//
// Bump RULES_VERSION when a number or a rule changes. Plans and sessions store
// the version they were made with.

export const RULES_VERSION = '1.1.0';
export const RULES_UPDATED = '2026-11-13';

export const SOURCES = {
  acsm2009: {
    short: 'ACSM 2009',
    cite: 'American College of Sports Medicine. Progression models in resistance training for healthy adults. Med Sci Sports Exerc. 2009;41(3):687-708.',
    url: 'https://doi.org/10.1249/MSS.0b013e3181915670',
  },
  schoenfeld2017volume: {
    short: 'Schoenfeld 2017 (volume)',
    cite: 'Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. J Sports Sci. 2017;35(11):1073-1082.',
    url: 'https://doi.org/10.1080/02640414.2016.1210197',
  },
  ralston2017: {
    short: 'Ralston 2017',
    cite: 'Ralston GW, Kilgore L, Wyatt FB, Baker JS. The effect of weekly set volume on strength gain: a meta-analysis. Sports Med. 2017;47(12):2585-2601.',
    url: 'https://doi.org/10.1007/s40279-017-0762-7',
  },
  schoenfeld2016frequency: {
    short: 'Schoenfeld 2016 (frequency)',
    cite: 'Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis. Sports Med. 2016;46(11):1689-1697.',
    url: 'https://doi.org/10.1007/s40279-016-0543-8',
  },
  grgic2018frequency: {
    short: 'Grgic 2018 (frequency)',
    cite: 'Grgic J, Schoenfeld BJ, Davies TB, Lazinica B, Krieger JW, Pedisic Z. Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis. Sports Med. 2018;48(5):1207-1220.',
    url: 'https://doi.org/10.1007/s40279-018-0872-x',
  },
  schoenfeld2017load: {
    short: 'Schoenfeld 2017 (load)',
    cite: 'Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis. J Strength Cond Res. 2017;31(12):3508-3523.',
    url: 'https://doi.org/10.1519/JSC.0000000000002200',
  },
  schoenfeld2016rest: {
    short: 'Schoenfeld 2016 (rest)',
    cite: 'Schoenfeld BJ, Pope ZK, Benik FM, et al. Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men. J Strength Cond Res. 2016;30(7):1805-1812.',
    url: 'https://doi.org/10.1519/JSC.0000000000001272',
  },
  grgic2018rest: {
    short: 'Grgic 2018 (rest)',
    cite: 'Grgic J, Schoenfeld BJ, Skrepnik M, Davies TB, Mikulic P. Effects of rest interval duration in resistance training on measures of muscular strength: a systematic review. Sports Med. 2018;48(1):137-151.',
    url: 'https://doi.org/10.1007/s40279-017-0788-x',
  },
  zourdos2016: {
    short: 'Zourdos 2016',
    cite: 'Zourdos MC, Klemp A, Dolan C, et al. Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. J Strength Cond Res. 2016;30(1):267-275.',
    url: 'https://doi.org/10.1519/JSC.0000000000001049',
  },
  helms2016: {
    short: 'Helms 2016',
    cite: 'Helms ER, Cronin J, Storey A, Zourdos MC. Application of the repetitions in reserve-based rating of perceived exertion scale for resistance training. Strength Cond J. 2016;38(4):42-49.',
    url: 'https://doi.org/10.1519/SSC.0000000000000218',
  },
  garber2011: {
    short: 'ACSM 2011',
    cite: 'Garber CE, Blissmer B, Deschenes MR, et al. Quantity and quality of exercise for developing and maintaining cardiorespiratory, musculoskeletal, and neuromotor fitness in apparently healthy adults: guidance for prescribing exercise. Med Sci Sports Exerc. 2011;43(7):1334-1359.',
    url: 'https://doi.org/10.1249/MSS.0b013e318213fefb',
  },
  simao2012: {
    short: 'Simão 2012',
    cite: 'Simão R, de Salles BF, Figueiredo T, Dias I, Willardson JM. Exercise order in resistance training. Sports Med. 2012;42(3):251-265.',
    url: 'https://doi.org/10.2165/11597240-000000000-00000',
  },
  practice: {
    short: 'App convention',
    cite: 'Practical convention chosen for this app. Not taken from a study; change it if it does not suit you.',
  },
};

// ---------------------------------------------------------------- parameters

export const GOALS = {
  strength: { label: 'Strength', blurb: 'Lift heavier over time' },
  muscle: { label: 'Muscle', blurb: 'Build muscle size' },
  general: { label: 'General fitness', blurb: 'Stay strong and healthy' },
  endurance: { label: 'Muscular endurance', blurb: 'More reps, shorter rests' },
};

// Experience is stored in months of regular training.
export const LEVELS = [
  { id: 'novice', label: 'Novice', maxMonths: 6 },
  { id: 'intermediate', label: 'Intermediate', maxMonths: 24 },
  { id: 'advanced', label: 'Advanced', maxMonths: Infinity },
];

export function levelFor(months) {
  const m = Number.isFinite(months) ? months : 0;
  return LEVELS.find((l) => m < l.maxMonths).id;
}

// Sets, rep range and rest (seconds) by goal and by the role an exercise plays
// in the session: main = first heavy compound lifts, secondary = further
// compound lifts, accessory = single-joint and core work.
export const PRESCRIPTION = {
  strength: {
    main: { sets: 4, repLo: 4, repHi: 6, rest: 180 },
    secondary: { sets: 3, repLo: 6, repHi: 8, rest: 150 },
    accessory: { sets: 3, repLo: 8, repHi: 12, rest: 90 },
  },
  muscle: {
    main: { sets: 3, repLo: 6, repHi: 10, rest: 150 },
    secondary: { sets: 3, repLo: 8, repHi: 12, rest: 120 },
    accessory: { sets: 3, repLo: 10, repHi: 15, rest: 75 },
  },
  general: {
    main: { sets: 3, repLo: 8, repHi: 12, rest: 120 },
    secondary: { sets: 2, repLo: 8, repHi: 12, rest: 90 },
    accessory: { sets: 2, repLo: 10, repHi: 15, rest: 60 },
  },
  endurance: {
    main: { sets: 3, repLo: 12, repHi: 15, rest: 75 },
    secondary: { sets: 2, repLo: 12, repHi: 20, rest: 60 },
    accessory: { sets: 2, repLo: 15, repHi: 20, rest: 45 },
  },
};

// Low reps (5 and under) are kept for barbell lifts. Dumbbell, machine and
// bodyweight work uses at least this rep range.
export const NON_BARBELL_MIN_RANGE = { repLo: 6, repHi: 8 };

// Novices start with fewer hard sets and a little more left in the tank.
export const NOVICE = { maxSetsPerExercise: 3, minRepLo: 6 };

// How close to failure a working set should end (reps in reserve).
export const TARGET_RIR = { novice: [2, 3], intermediate: [1, 3], advanced: [1, 2] };

// Weekly hard sets per muscle group that the plan aims for, when time allows.
export const WEEKLY_SETS = { novice: [6, 10], intermediate: [10, 16], advanced: [12, 20] };

// How the week is split, by training days per week.
export const SPLITS = {
  1: ['full'],
  2: ['full', 'fullB'],
  3: ['upper', 'lower', 'full'],
  4: ['upper', 'lower', 'upper', 'lower'],
  5: ['upper', 'lower', 'push', 'pull', 'legs'],
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
};
export const MAX_DAYS = 6; // keep at least one full rest day a week

// The plan is a running list of sessions with rests between them, laid out this
// many weeks ahead. More weeks ahead fit in more exercises: the main lifts come
// back every week, the rest take turns.
export const RUN = { minWeeks: 1, maxWeeks: 4 };
export const CYCLE = RUN; // older name, still used by saved data
export const defaultRunWeeks = (perWeek) => (perWeek >= 5 ? 1 : 2);
export const defaultCycleWeeks = defaultRunWeeks;

// Deciding what to train today when the user turns up on any day.
export const SCHEDULE = {
  recoverHours: 48, // before the same muscle group is trained hard again
  breakDays: 10, // after this long away, ease back in
  easePct: 10,
};

export const DAY_TITLES = {
  full: 'Full body', fullB: 'Full body', upper: 'Upper body', lower: 'Lower body',
  push: 'Push', pull: 'Pull', legs: 'Legs',
};

// Slots for each kind of day, in the order they are done and, from the end,
// the order they are dropped when time is short. Multi-joint lifts come first.
export const TEMPLATES = {
  upper: [['push_h', 'main'], ['pull_h', 'main'], ['push_v', 'secondary'], ['pull_v', 'secondary'], ['biceps', 'accessory'], ['triceps', 'accessory'], ['delt_side', 'accessory']],
  lower: [['squat', 'main'], ['hinge', 'main'], ['lunge', 'secondary'], ['knee_flex', 'accessory'], ['calf', 'accessory'], ['core', 'accessory']],
  full: [['squat', 'main'], ['push_h', 'main'], ['pull_v', 'secondary'], ['hinge', 'secondary'], ['push_v', 'accessory'], ['core', 'accessory']],
  fullB: [['hinge', 'main'], ['push_v', 'main'], ['pull_h', 'secondary'], ['lunge', 'secondary'], ['push_h', 'accessory'], ['biceps', 'accessory']],
  push: [['push_h', 'main'], ['push_v', 'main'], ['chest_fly', 'accessory'], ['delt_side', 'accessory'], ['triceps', 'accessory']],
  pull: [['pull_v', 'main'], ['pull_h', 'main'], ['delt_rear', 'accessory'], ['biceps', 'accessory'], ['core', 'accessory']],
  legs: [['squat', 'main'], ['hinge', 'main'], ['lunge', 'secondary'], ['knee_ext', 'accessory'], ['knee_flex', 'accessory'], ['calf', 'accessory']],
};

// When a slot has nothing available, try these patterns instead.
export const PATTERN_FALLBACK = {
  pull_v: ['pull_h'], pull_h: ['pull_v'], push_v: ['push_h', 'delt_side'], push_h: ['push_v', 'chest_fly'],
  squat: ['lunge', 'knee_ext'], lunge: ['squat', 'knee_ext'], hinge: ['glute', 'knee_flex'], knee_flex: ['glute', 'hinge'],
  knee_ext: ['lunge', 'squat'], chest_fly: ['push_h'], delt_rear: ['pull_h'], delt_side: ['push_v'],
  biceps: ['pull_v'], triceps: ['push_h'], calf: [], core: [], glute: ['hinge'],
};

// Time model for a session, in seconds. The day estimate covers the warm-up,
// every set, the rests between sets and the walk to the next station.
export const TIME = {
  warmupGeneralSec: 300, // easy cardio and mobility
  warmupRampSec: 180, // two lighter ramp-up sets before the first lift
  setBaseSec: 10, // getting into position
  secPerRep: 3.5,
  transitionSec: 120, // change station, set up, includes the rest
  minExercises: 3, // never trim a day below this
  minSets: 2,
};

// Progression and result reading.
export const PROGRESSION = {
  // Raise the load when every set reaches the top of the rep range.
  increasePctMin: 2,
  increasePctMax: 10,
  // In a session: a set this many reps short asks for a bigger drop.
  bigMissReps: 2,
  smallDropPct: 5,
  bigDropPct: 10,
  // In a session: this much in reserve at full reps means the load is light.
  lightRir: 4,
  // After a session: a shortfall counts when the total reps missed reach this.
  shortfallReps: 2,
  // The same shortfall at the same load two sessions running means back off.
  deloadPct: 10,
  // Smallest change the plates allow, by load type (kg).
  defaultStep: { per_dumbbell: 2, total: 2.5, machine: 5, bodyweight: 2.5 },
};

export const LOAD_TYPES = {
  per_dumbbell: { label: 'per dumbbell', unit: 'kg', pick: 'Weight of one dumbbell' },
  total: { label: 'total', unit: 'kg', pick: 'Total weight, bar included' },
  machine: { label: 'machine setting', unit: '', pick: 'Number on the weight stack or pin' },
  bodyweight: { label: 'bodyweight', unit: 'kg', pick: 'Extra weight added (0 for none)' },
};

// ---------------------------------------------------------------- the rules
// Each rule says what the app does and where the idea comes from. "uses" names
// the parameters above that carry the rule into the code.

export const RULES = [
  {
    id: 'SEL-1', area: 'Exercise selection',
    text: 'Pick exercises only from equipment marked available. Free weights, benches and a pull-up bar count as available unless the user turns them off.',
    sources: ['practice'], uses: ['equipment list'],
  },
  {
    id: 'SEL-2', area: 'Exercise selection',
    text: 'Cover the big movement patterns across the week: squat, hip hinge, horizontal and vertical push, horizontal and vertical pull. Single-joint work fills the time that is left.',
    sources: ['acsm2009', 'practice'], uses: ['TEMPLATES'],
  },
  {
    id: 'SEL-3', area: 'Exercise selection',
    text: 'Within a session, do multi-joint lifts before single-joint lifts, and the lifts that matter most for the goal first, while the lifter is fresh.',
    sources: ['acsm2009', 'simao2012'], uses: ['TEMPLATES order'],
  },
  {
    id: 'SEL-4', area: 'Exercise selection',
    text: 'Leave out movements the user wants to skip or that clash with a stated limitation, and include the exercises the user asks for when the equipment allows. This is not medical advice; pain is a reason to stop and see a professional.',
    sources: ['practice'], uses: ['profile.avoid', 'profile.include', 'profile.avoidTags'],
  },
  {
    id: 'FRQ-1', area: 'Weekly layout',
    text: 'Train each major muscle group at least twice a week when the number of days allows. With 3 days this means upper, lower, full body; with 4, upper and lower twice.',
    sources: ['schoenfeld2016frequency', 'grgic2018frequency'], uses: ['SPLITS'],
  },
  {
    id: 'FRQ-2', area: 'Weekly layout',
    text: 'Plan at most 6 training days so one full rest day stays in the week.',
    sources: ['practice'], uses: ['MAX_DAYS'],
  },
  {
    id: 'RUN-1', area: 'A plan that moves',
    text: 'The plan is a running list, not a calendar: train this, rest so many days, train that. It is laid out a couple of weeks ahead. The main lifts come back every week so they can progress, while secondary and accessory exercises take turns, so what did not fit one week is trained the next.',
    sources: ['acsm2009', 'practice'], uses: ['RUN', 'restPattern()'],
  },
  {
    id: 'RUN-2', area: 'A plan that moves',
    text: 'The list is updated after every workout from what was recorded. When the last session on it is done, the next run is planned: by the connected model from the results so far, or by repeating the run with its exercises taking turns.',
    sources: ['practice'], uses: ['schedule.js', 'coach.js'],
  },
  {
    id: 'REC-1', area: 'Training on any day',
    text: 'Leave about 48 hours before training the same muscle group hard again. Any session can be done on any day: when the next one on the list would repeat a muscle group trained in the last 48 hours, a session that lets it recover goes first.',
    sources: ['garber2011'], uses: ['SCHEDULE.recoverHours'],
  },
  {
    id: 'REC-2', area: 'Training on any day',
    text: 'Training on the planned day just starts the next session. On any other day, or when a session is picked by hand or skipped, the rest of the list is put in the order that spaces the muscle groups best, and the user sees it before starting. A skipped session comes back in the next run.',
    sources: ['practice'], uses: ['recommend()'],
  },
  {
    id: 'REC-3', area: 'Training on any day',
    text: 'After 10 or more days without training, the first session back uses about 10% less load. The plan keeps its numbers.',
    sources: ['practice'], uses: ['SCHEDULE.breakDays', 'SCHEDULE.easePct'],
  },
  {
    id: 'VOL-1', area: 'Volume',
    text: 'More weekly sets per muscle group bring more muscle growth, with 10 or more sets a week doing better than fewer. Strength also gains more from medium and high weekly set counts than from low ones. The app\'s own targets, built on that: 6-10 weekly sets per muscle group for novices, 10-16 for intermediates and 12-20 for advanced lifters. The time budget comes first; the plan screen shows where a week falls short of the target.',
    sources: ['schoenfeld2017volume', 'ralston2017', 'practice'], uses: ['WEEKLY_SETS', 'PRESCRIPTION.sets', 'weeklySets()'],
  },
  {
    id: 'VOL-2', area: 'Volume',
    text: 'Novices do at most 3 working sets per exercise. Add volume later, not on day one.',
    sources: ['acsm2009'], uses: ['NOVICE'],
  },
  {
    id: 'INT-1', area: 'Intensity',
    text: 'Strength: heavy loads, 4-6 reps on the main barbell lifts. Muscle: 6-12 reps on compound lifts, 10-15 on single-joint lifts. General fitness: 8-12. Muscular endurance: 12-20 with lighter loads.',
    sources: ['acsm2009', 'schoenfeld2017load'], uses: ['PRESCRIPTION.repLo/repHi'],
  },
  {
    id: 'INT-2', area: 'Intensity',
    text: 'Muscle grows across a wide range of loads as long as sets are hard, while maximal strength gains favour heavier loads. So the rep range follows the goal, and effort is kept high in every range.',
    sources: ['schoenfeld2017load'], uses: ['PRESCRIPTION'],
  },
  {
    id: 'INT-3', area: 'Intensity',
    text: 'End working sets with about 1-3 reps in reserve (novices 2-3). Reps in reserve is the number of extra reps the lifter could still have done with good form.',
    sources: ['zourdos2016', 'helms2016'], uses: ['TARGET_RIR'],
  },
  {
    id: 'INT-4', area: 'Intensity',
    text: 'Keep sets of 5 reps and under for barbell lifts. Dumbbell, machine and bodyweight exercises use at least 6-8 reps, and novices do not go below 6 reps on any lift.',
    sources: ['practice'], uses: ['NON_BARBELL_MIN_RANGE', 'NOVICE'],
  },
  {
    id: 'RST-1', area: 'Rest',
    text: 'Rest longer between heavy compound sets: 2-3 minutes or more for strength work. Longer rests (about 3 minutes against 1) also gave more strength and muscle in trained men. Single-joint and endurance work can use 45-90 seconds.',
    sources: ['acsm2009', 'schoenfeld2016rest', 'grgic2018rest'], uses: ['PRESCRIPTION.rest'],
  },
  {
    id: 'TIM-1', area: 'Session time',
    text: 'The time shown for a day counts a 5 minute general warm-up, 3 minutes of lighter ramp-up sets, every working set, the rests, and 2 minutes to move between stations. When a day runs over the budget, drop the last single-joint exercises first, then cut sets, and never go below 3 exercises or 2 sets.',
    sources: ['practice'], uses: ['TIME'],
  },
  {
    id: 'LOD-1', area: 'Starting weight',
    text: 'With no history for an exercise, the user picks a starting weight: one they could lift for about 2 reps more than the target with good form. Loads are recorded as weight per dumbbell, total weight (bar included), machine setting, or bodyweight plus added weight.',
    sources: ['helms2016', 'practice'], uses: ['LOAD_TYPES'],
  },
  {
    id: 'PRG-1', area: 'Progression',
    text: 'Double progression. Keep the load and add reps until every set reaches the top of the rep range, then raise the load by the smallest step the equipment allows (roughly 2-10%) and go back to the bottom of the range.',
    sources: ['acsm2009'], uses: ['PROGRESSION.increasePct*', 'PROGRESSION.defaultStep'],
  },
  {
    id: 'PRG-2', area: 'Progression',
    text: 'When every set hits its target but not yet the top of the range, add one rep to the target next time and keep the load.',
    sources: ['practice'], uses: ['repLo/repHi'],
  },
  {
    id: 'ADJ-1', area: 'Reading results',
    text: 'During a session: if a set ends short of its target with no reps in reserve, lower the load for the sets still to come, by about 5% for a miss of one rep and about 10% for two or more. If a set hits its target with 4 or more reps in reserve, raise the load one step for the remaining sets.',
    sources: ['helms2016', 'zourdos2016', 'practice'], uses: ['PROGRESSION.bigMissReps', 'smallDropPct', 'bigDropPct', 'lightRir'],
  },
  {
    id: 'ADJ-2', area: 'Reading results',
    text: 'After a session: one off day changes nothing. If the same exercise falls short of its target at the same load in two sessions running, lower the load by about 10% and build back up.',
    sources: ['acsm2009', 'practice'], uses: ['PROGRESSION.shortfallReps', 'deloadPct'],
  },
  {
    id: 'ADJ-3', area: 'Reading results',
    text: 'Judge only what was recorded: planned against done reps and load, reps in reserve when given, skipped sets, and earlier sessions of the same exercise. If the records do not justify a change, propose none.',
    sources: ['practice'], uses: ['history'],
  },
  {
    id: 'SUB-1', area: 'Substitutes',
    text: 'When a machine is busy or missing, swap to an exercise with the same movement pattern on available equipment, and keep the sets, reps and rest. The swap applies to that session only unless the user changes the plan.',
    sources: ['practice'], uses: ['exercise patterns'],
  },
];

export function setSeconds(reps) {
  return TIME.setBaseSec + reps * TIME.secPerRep;
}

/** Sets, reps and rest for one exercise, after the goal, level and load-type rules. */
export function prescribe(goal, tier, level, loadType) {
  const base = (PRESCRIPTION[goal] || PRESCRIPTION.general)[tier] || PRESCRIPTION.general.accessory;
  let { sets, repLo, repHi, rest } = base;
  if (loadType !== 'total') {
    repLo = Math.max(repLo, NON_BARBELL_MIN_RANGE.repLo);
    repHi = Math.max(repHi, NON_BARBELL_MIN_RANGE.repHi);
  }
  if (level === 'novice') {
    sets = Math.min(sets, NOVICE.maxSetsPerExercise);
    if (repLo < NOVICE.minRepLo) {
      repHi = Math.max(repHi, NOVICE.minRepLo + 2);
      repLo = NOVICE.minRepLo;
    }
  }
  return { sets, repLo, repHi, rest };
}

/** The whole library as plain text, for the prompt sent to Claude. */
export function rulesAsText() {
  const lines = [`Training rules library, version ${RULES_VERSION} (${RULES_UPDATED}).`, ''];
  let area = '';
  for (const r of RULES) {
    if (r.area !== area) {
      area = r.area;
      lines.push(`## ${area}`);
    }
    lines.push(`- [${r.id}] ${r.text} (Source: ${r.sources.map((s) => SOURCES[s].short).join('; ')})`);
  }
  lines.push('', '## Numbers the app uses');
  lines.push('Sets x reps, rest between sets, by goal and role (main / secondary / accessory):');
  for (const [goal, tiers] of Object.entries(PRESCRIPTION)) {
    const parts = Object.entries(tiers).map(([t, p]) => `${t} ${p.sets} x ${p.repLo}-${p.repHi}, rest ${p.rest}s`);
    lines.push(`- ${goal}: ${parts.join(' | ')}`);
  }
  lines.push(`Sessions in one week, by sessions per week: ${Object.entries(SPLITS).map(([d, s]) => `${d}: ${s.map((k) => DAY_TITLES[k]).join(', ')}`).join(' | ')}.`);
  lines.push(`Planned ahead: ${RUN.minWeeks}-${RUN.maxWeeks} weeks of sessions. Recovery: ${SCHEDULE.recoverHours} h per muscle group. Coming back after ${SCHEDULE.breakDays}+ days: ${SCHEDULE.easePct}% lighter.`);
  lines.push(`Time model: warm-up ${(TIME.warmupGeneralSec + TIME.warmupRampSec) / 60} min, each set ${TIME.setBaseSec}s + ${TIME.secPerRep}s per rep, ${TIME.transitionSec}s between exercises.`);
  lines.push(`Default load steps (kg): ${Object.entries(PROGRESSION.defaultStep).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
  return lines.join('\n');
}
