// Equipment and exercise catalog.
//
// Free weights, benches and the pull-up bar are available unless the user turns
// them off. Machines are added by the user on the Equipment screen.

export const ZONES = { free: 'Free weights area', machines: 'Machines area', cable: 'Cable area', floor: 'Open floor' };

export const EQUIPMENT = [
  { id: 'dumbbells', name: 'Dumbbells', kind: 'basic', zone: ZONES.free },
  { id: 'barbell', name: 'Barbell and plates', kind: 'basic', zone: ZONES.free },
  { id: 'bench', name: 'Bench', kind: 'basic', zone: ZONES.free },
  { id: 'pullup_bar', name: 'Pull-up bar', kind: 'basic', zone: ZONES.free },
  { id: 'rack', name: 'Squat rack', kind: 'machine', zone: ZONES.free },
  { id: 'cable', name: 'Cable station', kind: 'machine', zone: ZONES.cable },
  { id: 'lat_pulldown', name: 'Lat pulldown', kind: 'machine', zone: ZONES.machines },
  { id: 'seated_row', name: 'Seated row', kind: 'machine', zone: ZONES.machines },
  { id: 'leg_press', name: 'Leg press', kind: 'machine', zone: ZONES.machines },
  { id: 'leg_extension', name: 'Leg extension', kind: 'machine', zone: ZONES.machines },
  { id: 'leg_curl', name: 'Leg curl', kind: 'machine', zone: ZONES.machines },
  { id: 'chest_press', name: 'Chest press machine', kind: 'machine', zone: ZONES.machines },
  { id: 'shoulder_press', name: 'Shoulder press machine', kind: 'machine', zone: ZONES.machines },
  { id: 'pec_deck', name: 'Pec deck', kind: 'machine', zone: ZONES.machines },
  { id: 'smith', name: 'Smith machine', kind: 'machine', zone: ZONES.machines },
  { id: 'hack_squat', name: 'Hack squat', kind: 'machine', zone: ZONES.machines },
  { id: 'dip_station', name: 'Dip bars', kind: 'machine', zone: ZONES.free },
  { id: 'calf_machine', name: 'Calf raise machine', kind: 'machine', zone: ZONES.machines },
  { id: 'back_extension', name: 'Back extension bench', kind: 'machine', zone: ZONES.free },
  { id: 'ab_machine', name: 'Abdominal machine', kind: 'machine', zone: ZONES.machines },
];

export const PATTERNS = {
  push_h: 'Chest press', push_v: 'Overhead press', pull_h: 'Row', pull_v: 'Pull-down or pull-up',
  squat: 'Squat', hinge: 'Hip hinge', lunge: 'Single-leg', glute: 'Glutes', knee_ext: 'Leg extension',
  knee_flex: 'Leg curl', calf: 'Calves', biceps: 'Biceps', triceps: 'Triceps', delt_side: 'Side delts',
  delt_rear: 'Rear delts', chest_fly: 'Chest fly', core: 'Core',
};

// Which muscle group a movement counts toward when adding up weekly sets.
export const GROUP_OF = {
  push_h: 'Chest', chest_fly: 'Chest', push_v: 'Shoulders', delt_side: 'Shoulders', delt_rear: 'Shoulders',
  pull_h: 'Back', pull_v: 'Back', squat: 'Quads', lunge: 'Quads', knee_ext: 'Quads',
  hinge: 'Hamstrings and glutes', glute: 'Hamstrings and glutes', knee_flex: 'Hamstrings and glutes',
  calf: 'Calves', biceps: 'Biceps', triceps: 'Triceps', core: 'Core',
};
export const MAIN_GROUPS = ['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings and glutes'];

// When the movement itself cannot be done, these train the same muscles.
const SUB_PATTERNS = {
  knee_flex: ['hinge', 'glute'], knee_ext: ['squat', 'lunge'], squat: ['lunge', 'knee_ext'], lunge: ['squat', 'knee_ext'],
  hinge: ['glute', 'knee_flex'], glute: ['hinge', 'lunge'], calf: [], push_h: ['chest_fly', 'push_v'], chest_fly: ['push_h'],
  push_v: ['delt_side', 'push_h'], delt_side: ['push_v'], delt_rear: ['pull_h'], pull_h: ['pull_v', 'delt_rear'], pull_v: ['pull_h'],
  biceps: ['pull_v', 'pull_h'], triceps: ['push_h', 'push_v'], core: [],
};

const LOWER = new Set(['squat', 'hinge', 'lunge', 'glute', 'knee_ext', 'knee_flex', 'calf']);
export const isLowerPattern = (p) => LOWER.has(p);

// e(id, name, pattern, equipment, loadType, rank, tags?, hard?)
// rank: lower is preferred within a pattern. tags: joints the lift loads most,
// matched against stated limitations. hard: bodyweight lifts novices often
// cannot do for the planned reps.
const e = (id, name, pattern, equip, load, rank, tags = [], hard = false) => ({ id, name, pattern, equip, load, rank, tags, hard });

export const EXERCISES = [
  e('bb_bench_press', 'Barbell bench press', 'push_h', ['barbell', 'bench', 'rack'], 'total', 1),
  e('db_bench_press', 'Dumbbell bench press', 'push_h', ['dumbbells', 'bench'], 'per_dumbbell', 2),
  e('chest_press_machine', 'Chest press machine', 'push_h', ['chest_press'], 'machine', 3),
  e('incline_db_press', 'Incline dumbbell press', 'push_h', ['dumbbells', 'bench'], 'per_dumbbell', 4),
  e('smith_bench_press', 'Smith machine bench press', 'push_h', ['smith', 'bench'], 'total', 5),
  e('dips', 'Dips', 'push_h', ['dip_station'], 'bodyweight', 6, ['shoulder'], true),
  e('push_up', 'Push-up', 'push_h', [], 'bodyweight', 7),

  e('bb_overhead_press', 'Barbell overhead press', 'push_v', ['barbell', 'rack'], 'total', 1, ['shoulder', 'spine']),
  e('db_shoulder_press', 'Seated dumbbell shoulder press', 'push_v', ['dumbbells', 'bench'], 'per_dumbbell', 2, ['shoulder']),
  e('shoulder_press_machine', 'Shoulder press machine', 'push_v', ['shoulder_press'], 'machine', 3, ['shoulder']),

  e('bb_row', 'Barbell bent-over row', 'pull_h', ['barbell'], 'total', 1, ['spine']),
  e('db_row', 'One-arm dumbbell row', 'pull_h', ['dumbbells', 'bench'], 'per_dumbbell', 2),
  e('seated_cable_row', 'Seated row', 'pull_h', ['seated_row'], 'machine', 3),
  e('chest_supported_row', 'Chest-supported dumbbell row', 'pull_h', ['dumbbells', 'bench'], 'per_dumbbell', 4),

  e('pull_up', 'Pull-up', 'pull_v', ['pullup_bar'], 'bodyweight', 1, [], true),
  e('lat_pulldown', 'Lat pulldown', 'pull_v', ['lat_pulldown'], 'machine', 2),
  e('chin_up', 'Chin-up', 'pull_v', ['pullup_bar'], 'bodyweight', 3, [], true),

  e('bb_back_squat', 'Barbell back squat', 'squat', ['barbell', 'rack'], 'total', 1, ['knee', 'spine']),
  e('leg_press', 'Leg press', 'squat', ['leg_press'], 'machine', 2, ['knee']),
  e('goblet_squat', 'Goblet squat', 'squat', ['dumbbells'], 'per_dumbbell', 3, ['knee']),
  e('hack_squat', 'Hack squat', 'squat', ['hack_squat'], 'machine', 4, ['knee']),
  e('smith_squat', 'Smith machine squat', 'squat', ['smith'], 'total', 5, ['knee']),

  e('bb_deadlift', 'Barbell deadlift', 'hinge', ['barbell'], 'total', 1, ['spine']),
  e('bb_rdl', 'Barbell Romanian deadlift', 'hinge', ['barbell'], 'total', 2, ['spine']),
  e('db_rdl', 'Dumbbell Romanian deadlift', 'hinge', ['dumbbells'], 'per_dumbbell', 3, ['spine']),
  e('back_extension', 'Back extension', 'hinge', ['back_extension'], 'bodyweight', 4, ['spine']),

  e('hip_thrust', 'Barbell hip thrust', 'glute', ['barbell', 'bench'], 'total', 1),
  e('db_glute_bridge', 'Dumbbell glute bridge', 'glute', ['dumbbells'], 'per_dumbbell', 2),

  e('db_split_squat', 'Bulgarian split squat', 'lunge', ['dumbbells', 'bench'], 'per_dumbbell', 1, ['knee']),
  e('db_reverse_lunge', 'Dumbbell reverse lunge', 'lunge', ['dumbbells'], 'per_dumbbell', 2, ['knee']),
  e('db_step_up', 'Dumbbell step-up', 'lunge', ['dumbbells', 'bench'], 'per_dumbbell', 3, ['knee']),

  e('leg_extension', 'Leg extension', 'knee_ext', ['leg_extension'], 'machine', 1, ['knee']),
  e('db_leg_extension', 'Seated dumbbell leg extension', 'knee_ext', ['dumbbells', 'bench'], 'per_dumbbell', 2, ['knee']),
  e('leg_curl', 'Leg curl', 'knee_flex', ['leg_curl'], 'machine', 1),
  e('db_leg_curl', 'Lying dumbbell leg curl', 'knee_flex', ['dumbbells', 'bench'], 'per_dumbbell', 2),
  e('cable_leg_curl', 'Standing cable leg curl', 'knee_flex', ['cable'], 'machine', 3),
  e('nordic_curl', 'Nordic hamstring curl', 'knee_flex', [], 'bodyweight', 4, [], true),

  e('calf_raise_machine', 'Calf raise machine', 'calf', ['calf_machine'], 'machine', 1),
  e('db_calf_raise', 'Standing dumbbell calf raise', 'calf', ['dumbbells'], 'per_dumbbell', 2),

  e('db_curl', 'Dumbbell curl', 'biceps', ['dumbbells'], 'per_dumbbell', 1),
  e('bb_curl', 'Barbell curl', 'biceps', ['barbell'], 'total', 2),
  e('cable_curl', 'Cable curl', 'biceps', ['cable'], 'machine', 3),
  e('hammer_curl', 'Hammer curl', 'biceps', ['dumbbells'], 'per_dumbbell', 4),

  e('cable_pushdown', 'Cable triceps pushdown', 'triceps', ['cable'], 'machine', 1),
  e('db_overhead_triceps', 'Overhead dumbbell triceps extension', 'triceps', ['dumbbells'], 'per_dumbbell', 2, ['shoulder']),
  e('lying_triceps_ext', 'Lying barbell triceps extension', 'triceps', ['barbell', 'bench'], 'total', 3),
  e('close_grip_push_up', 'Close-grip push-up', 'triceps', [], 'bodyweight', 4),

  e('db_lateral_raise', 'Dumbbell lateral raise', 'delt_side', ['dumbbells'], 'per_dumbbell', 1),
  e('cable_lateral_raise', 'Cable lateral raise', 'delt_side', ['cable'], 'machine', 2),

  e('face_pull', 'Cable face pull', 'delt_rear', ['cable'], 'machine', 1),
  e('db_reverse_fly', 'Dumbbell reverse fly', 'delt_rear', ['dumbbells'], 'per_dumbbell', 2),
  e('reverse_pec_deck', 'Reverse pec deck', 'delt_rear', ['pec_deck'], 'machine', 3),

  e('pec_deck_fly', 'Pec deck fly', 'chest_fly', ['pec_deck'], 'machine', 1),
  e('cable_fly', 'Cable fly', 'chest_fly', ['cable'], 'machine', 2),
  e('db_fly', 'Dumbbell fly', 'chest_fly', ['dumbbells', 'bench'], 'per_dumbbell', 3),

  e('ab_machine_crunch', 'Abdominal machine crunch', 'core', ['ab_machine'], 'machine', 1),
  e('hanging_knee_raise', 'Hanging knee raise', 'core', ['pullup_bar'], 'bodyweight', 2),
  e('cable_crunch', 'Cable crunch', 'core', ['cable'], 'machine', 3),
  e('crunch', 'Crunch', 'core', [], 'bodyweight', 4),
];

// Words people use for lifts, longest first, mapped to catalog ids. Used to
// read "no deadlifts" or "I care about pull-ups" without Claude.
export const KEYWORDS = [
  [['bulgarian split squat', 'split squat', 'lunges', 'lunge'], ['db_split_squat', 'db_reverse_lunge', 'db_step_up']],
  [['romanian deadlift', 'rdl'], ['bb_rdl', 'db_rdl']],
  [['overhead press', 'shoulder press', 'military press', 'ohp'], ['bb_overhead_press', 'db_shoulder_press', 'shoulder_press_machine']],
  [['bench press', 'benching', 'bench'], ['bb_bench_press', 'db_bench_press', 'smith_bench_press', 'incline_db_press']],
  [['leg press'], ['leg_press']],
  [['leg extension', 'leg extensions'], ['leg_extension']],
  [['leg curl', 'leg curls'], ['leg_curl']],
  [['hip thrust', 'hip thrusts'], ['hip_thrust']],
  [['lat pulldown', 'pulldown', 'pull-down'], ['lat_pulldown']],
  [['pull-ups', 'pull-up', 'pull ups', 'pull up', 'pullups', 'pullup'], ['pull_up']],
  [['chin-ups', 'chin-up', 'chin ups', 'chin up', 'chinups', 'chinup'], ['chin_up']],
  [['push-ups', 'push-up', 'push ups', 'push up', 'pushups', 'pushup'], ['push_up', 'close_grip_push_up']],
  [['deadlifts', 'deadlift'], ['bb_deadlift', 'bb_rdl', 'db_rdl']],
  [['squats', 'squat'], ['bb_back_squat', 'goblet_squat', 'hack_squat', 'smith_squat']],
  [['rows', 'row'], ['bb_row', 'db_row', 'seated_cable_row', 'chest_supported_row']],
  [['dips', 'dip'], ['dips']],
  [['curls', 'curl'], ['db_curl', 'bb_curl', 'cable_curl', 'hammer_curl']],
  [['lateral raises', 'lateral raise'], ['db_lateral_raise', 'cable_lateral_raise']],
  [['calf raises', 'calf raise', 'calves'], ['calf_raise_machine', 'db_calf_raise']],
  [['crunches', 'crunch', 'abs'], ['ab_machine_crunch', 'hanging_knee_raise', 'cable_crunch', 'crunch']],
];

// ---------------------------------------------------------------- helpers

// `details` holds what is known about the exact machine behind an entry, by
// equipment id: maker, model, how it works, what it isolates.
export const emptyEquipment = () => ({ items: {}, custom: [], details: {} });

export const LOADING = { selectorized: 'weight stack with a pin', plate_loaded: 'plates you load', cable: 'cable and weight stack', bodyweight: 'bodyweight', other: 'other' };

// Drawings the app has (see ui/sketch.js): one per kind of equipment, plus a few
// for machines of the gym's own that are not in the catalog.
export const SKETCH_IDS = [
  'dumbbells', 'barbell', 'bench', 'pullup_bar', 'rack', 'cable', 'lat_pulldown', 'seated_row', 'leg_press', 'leg_extension',
  'leg_curl', 'chest_press', 'shoulder_press', 'pec_deck', 'smith', 'hack_squat', 'dip_station', 'calf_machine', 'back_extension',
  'glute', 'curl', 'ab', 'machine',
];
// The closest drawing for a machine known only by the movement it trains.
const PATTERN_SKETCH = {
  push_h: 'chest_press', push_v: 'shoulder_press', pull_h: 'seated_row', pull_v: 'lat_pulldown', squat: 'leg_press', hinge: 'back_extension',
  lunge: 'machine', glute: 'glute', knee_ext: 'leg_extension', knee_flex: 'leg_curl', calf: 'calf_machine', biceps: 'curl', triceps: 'cable',
  delt_side: 'machine', delt_rear: 'pec_deck', chest_fly: 'pec_deck', core: 'ab',
};
// For free-weight lifts, the piece that says most about where to go.
const BASIC_ORDER = ['rack', 'barbell', 'dumbbells', 'pullup_bar', 'bench'];

// Catalog equipment whose drawing goes by another name.
const SKETCH_OF = { ab_machine: 'ab' };

/** The drawing for a piece of equipment: { id, loading } or null. */
export function sketchForEquipment(eq, id) {
  const item = equipmentList(eq).find((x) => x.id === id);
  if (!item) return null;
  const d = machineDetail(eq, id);
  const loading = d?.loading || undefined;
  if (item.kind === 'custom') return { id: SKETCH_IDS.includes(d?.sketch) ? d.sketch : (PATTERN_SKETCH[item.pattern] || 'machine'), loading };
  const sk = SKETCH_OF[id] || id;
  return SKETCH_IDS.includes(sk) ? { id: sk, loading } : null;
}

/** The drawing for the equipment an exercise is done on, or null for bodyweight work on the floor. */
export function sketchForExercise(eq, exercise) {
  if (!exercise || !exercise.equip?.length) return null;
  const list = equipmentList(eq);
  const machine = exercise.equip.find((id) => { const k = list.find((x) => x.id === id)?.kind; return (k === 'machine' || k === 'custom') && id !== 'rack'; });
  const id = machine || BASIC_ORDER.find((b) => exercise.equip.includes(b)) || exercise.equip[0];
  return sketchForEquipment(eq, id);
}

/** What is known about the exact machine, or null. */
export const machineDetail = (eq, id) => (eq?.details || {})[id] || null;

/** The machine an exercise is done on, with its details, when any are saved. */
export function machineForExercise(eq, exercise) {
  if (!exercise) return null;
  const id = (exercise.equip || []).find((x) => machineDetail(eq, x));
  if (!id) return null;
  const item = equipmentList(eq).find((x) => x.id === id);
  return { id, name: item?.name || id, ...machineDetail(eq, id) };
}

export const machineLabel = (d) => [d?.vendor, d?.model].filter(Boolean).join(' ');

export function equipmentList(eq) {
  const custom = (eq?.custom || []).map((c) => ({ id: c.id, name: c.name, kind: 'custom', zone: c.zone || ZONES.machines, pattern: c.pattern }));
  return [...EQUIPMENT, ...custom];
}

/** Is this piece of equipment on the user's list at all? Basics always are. */
export function isListed(eq, id) {
  const item = equipmentList(eq).find((x) => x.id === id);
  if (!item) return false;
  return item.kind === 'basic' || item.kind === 'custom' || id in (eq?.items || {});
}

export function isAvailable(eq, id) {
  const item = equipmentList(eq).find((x) => x.id === id);
  if (!item) return false;
  const v = (eq?.items || {})[id];
  if (item.kind === 'basic' || item.kind === 'custom') return v !== false;
  return v === true;
}

export function availableIds(eq) {
  return equipmentList(eq).filter((x) => isAvailable(eq, x.id)).map((x) => x.id);
}

/** Catalog exercises plus one exercise for each custom machine the user added. */
export function allExercises(eq) {
  const custom = (eq?.custom || []).map((c) => e(`ex_${c.id}`, c.name, c.pattern, [c.id], c.load || 'machine', 0.5));
  return [...EXERCISES, ...custom];
}

export function exerciseById(eq, id) {
  return allExercises(eq).find((x) => x.id === id) || null;
}

export function canDo(eq, exercise) {
  return exercise.equip.every((id) => isAvailable(eq, id));
}

export function zoneOf(eq, exercise) {
  if (!exercise.equip.length) return ZONES.floor;
  const list = equipmentList(eq);
  const machine = exercise.equip.map((id) => list.find((x) => x.id === id)).find((x) => x && x.kind !== 'basic');
  return (machine || list.find((x) => x.id === exercise.equip[0]) || { zone: ZONES.free }).zone;
}

export function equipmentNames(eq, exercise) {
  if (!exercise.equip.length) return 'No equipment';
  const list = equipmentList(eq);
  return exercise.equip.map((id) => list.find((x) => x.id === id)?.name || id).join(', ');
}

/**
 * Other ways to train the same thing right now, best first: the same movement
 * on other equipment, then other movements for the same muscles. Each result
 * carries `close`: true for the same movement.
 * @param {object} eq equipment state
 * @param {string} exerciseId the lift to replace
 * @param {object} [opts] exclude: ids already in the session; busy: equipment ids in use by someone else
 */
export function substitutesFor(eq, exerciseId, opts = {}) {
  const all = allExercises(eq);
  const cur = all.find((x) => x.id === exerciseId);
  if (!cur) return [];
  const exclude = new Set([exerciseId, ...(opts.exclude || [])]);
  const busy = new Set([...(opts.busy || [])]);
  const avoidTags = new Set(opts.avoidTags || []);
  const avoid = new Set(opts.avoid || []);
  const ok = (x) => !exclude.has(x.id) && !avoid.has(x.id) && canDo(eq, x) && !x.equip.some((id) => busy.has(id)) && !x.tags.some((t) => avoidTags.has(t));
  const same = all.filter((x) => x.pattern === cur.pattern && ok(x)).sort((a, b) => a.rank - b.rank).map((x) => ({ ...x, close: true }));
  // Same muscles by another movement: first the movements the rules name as stand-ins, then the rest of the group.
  const group = GROUP_OF[cur.pattern];
  const standIns = SUB_PATTERNS[cur.pattern] || [];
  const order = (p) => { const i = standIns.indexOf(p); return i < 0 ? 99 : i; };
  const near = all.filter((x) => x.pattern !== cur.pattern && ok(x) && (standIns.includes(x.pattern) || (group && GROUP_OF[x.pattern] === group)))
    .sort((a, b) => order(a.pattern) - order(b.pattern) || a.rank - b.rank).map((x) => ({ ...x, close: false }));
  return [...same, ...near];
}

// ---------------------------------------------------------------- reading a gym from free text
// "We have a lat pulldown, leg press and cables. No barbell." -> a list to save.
// Used when Claude is not connected, and as the fallback when it fails.

const ALIASES = [
  [['dumbbell rack', 'dumbbells', 'dumbbell'], ['dumbbells']],
  [['free weights'], ['dumbbells', 'barbell']],
  [['barbells', 'barbell', 'olympic bar', 'weight plates', 'bumper plates', 'plates'], ['barbell']],
  [['bench press rack', 'bench press station', 'bench press', 'squat rack', 'power rack', 'half rack', 'squat cage', 'power cage', 'rack'], ['rack']],
  [['benches', 'bench'], ['bench']],
  [['pull-up bar', 'pull up bar', 'pullup bar', 'chin-up bar', 'chin up bar', 'chinup bar'], ['pullup_bar']],
  [['seated cable row', 'seated row', 'row machine', 'low row'], ['seated_row']],
  [['cable station', 'cable machine', 'cable crossover', 'cable tower', 'functional trainer', 'crossover', 'cables', 'cable'], ['cable']],
  [['lat pulldown', 'lat pull-down', 'lat pull down', 'pulldown machine', 'pull-down machine', 'pulldown', 'lat machine'], ['lat_pulldown']],
  [['leg press'], ['leg_press']],
  [['leg extensions', 'leg extension', 'quad extension'], ['leg_extension']],
  [['leg curls', 'leg curl', 'hamstring curl'], ['leg_curl']],
  [['chest press machine', 'machine chest press', 'chest press'], ['chest_press']],
  [['shoulder press machine', 'overhead press machine', 'shoulder press'], ['shoulder_press']],
  [['pec deck', 'pec-deck', 'pec fly', 'chest fly machine', 'fly machine', 'butterfly'], ['pec_deck']],
  [['smith machine', 'smith'], ['smith']],
  [['hack squat'], ['hack_squat']],
  [['dip station', 'dip bars', 'dip bar', 'dip stand', 'parallel bars'], ['dip_station']],
  [['calf raise machine', 'calf machine', 'calf raise', 'standing calf', 'seated calf'], ['calf_machine']],
  [['back extension bench', 'back extension', 'hyperextension', 'roman chair'], ['back_extension']],
  [['abdominal crunch machine', 'abdominal crunch', 'abdominal machine', 'ab crunch machine', 'abs machine', 'ab machine', 'ab crunch', 'abdominals', 'abdominal'], ['ab_machine']],
];
const ALIAS_LIST = ALIASES.flatMap(([words, ids]) => words.map((w) => ({ w, ids }))).sort((a, b) => b.w.length - a.w.length);
const byEquipId = Object.fromEntries(EQUIPMENT.map((x) => [x.id, x]));
/** Where a phrase stands in a text as whole words, or -1. */
function wordAt(text, w) {
  for (let from = 0; ;) {
    const at = text.indexOf(w, from);
    if (at < 0) return -1;
    if (!/[a-z]/.test(text[at - 1] || ' ') && !/[a-z]/.test(text[at + w.length] || ' ')) return at;
    from = at + w.length;
  }
}

// What an unknown machine most likely trains, judged from its name. First match wins.
const PATTERN_HINTS = [
  [/abduct|adduct|glute|hip thrust|kickback/, 'glute'],
  [/leg curl|hamstring|ham curl|glute.?ham|nordic/, 'knee_flex'],
  [/leg ext|quad/, 'knee_ext'],
  [/calf|calves/, 'calf'],
  [/squat|leg press|sled|pendulum/, 'squat'],
  [/deadlift|hinge|good morning|hyper|back ext/, 'hinge'],
  [/lunge|step.?up/, 'lunge'],
  [/pull.?down|pull.?up|chin|\blats?\b|pullover/, 'pull_v'],
  [/\brow|t.?bar/, 'pull_h'],
  [/rear delt|reverse fly|reverse pec|face pull/, 'delt_rear'],
  [/lateral|side raise/, 'delt_side'],
  [/shoulder|overhead|delt|military/, 'push_v'],
  [/\bfly|flye|\bpec/, 'chest_fly'],
  [/tricep|push.?down|\bdip/, 'triceps'],
  [/bicep|curl|preacher/, 'biceps'],
  [/chest|incline|decline|press/, 'push_h'],
  [/\babs?\b|abdom|crunch|core|torso|rotary|oblique|leg raise/, 'core'],
];
const NOT_STRENGTH = /treadmill|bike|bicycle|cycle|elliptical|cross.?trainer|rower|rowing|\berg\b|stair|stepper|sauna|pool|shower|locker|\bmats?\b|ski.?erg|spin|cardio|kettlebell|band|ball|rope|box\b/;
const NEGATIVE = /(\b(no|not|without|missing|lacks?|broken|removed|except|dont|doesnt)\b|n't)/;
const FILLER = /\b(we|i|my|our|the|a|an|some|have|has|got|there|is|are|gym|one|two|three|four|few|couple|of|with|it|its|they|them|that|this|those|these|new|old|also|too|lots|many|several|plus|and|or|in|at|for|to|as|well|both|just|only|then|a lot)\b/g;

// Makers of gym machines, as people write them. A name found in a clause is noted as the maker of the machine named with it,
// so "abdominal from Life Fitness" and "Hammer Strength leg press" need no colon.
const MAKERS = [
  'Life Fitness', 'Hammer Strength', 'Technogym', 'Matrix', 'Precor', 'Cybex', 'Nautilus', 'Panatta', 'Gym80', 'Eleiko', 'Hoist', 'Star Trac',
  'Atlantis', 'Arsenal Strength', 'Watson', 'Pulse Fitness', 'BH Fitness', 'Body-Solid', 'Keiser', 'Gymleco', 'Freemotion', 'Rogue', 'Icarian',
  'Paramount', 'Prime Fitness', 'Newtech', 'Impulse', 'DHZ',
];
const MAKER_RE = new RegExp(`(?:\\b(?:from|by|made by)\\s+)?\\b(${MAKERS.map((m) => m.toLowerCase().replace(/[-\s]+/g, '[-\\s]?')).join('|')})\\b`);
const makerName = (hit) => MAKERS.find((m) => m.toLowerCase().replace(/[-\s]/g, '') === hit.replace(/[-\s]/g, '')) || hit;

// Words that make a machine a different one from the plain kind in the catalog. A gym can have both, side by side,
// and each has its own weights: "iso-lateral leg extension" is saved under its own name, not folded into "Leg extension".
const VARIANT = /\b(iso[-\s]?lateral|unilateral|single[-\s](?:arm|leg)|incline|decline|converging|diverging)\b/;

/** The one movement a catalog machine is for, or null when it serves several (a cable station, a rack). */
function onlyPattern(id) {
  const patterns = [...new Set(EXERCISES.filter((x) => x.equip.includes(id)).map((x) => x.pattern))];
  return patterns.length === 1 ? patterns[0] : null;
}

export function guessPattern(name) {
  const n = String(name).toLowerCase();
  const hit = PATTERN_HINTS.find(([re]) => re.test(n));
  return hit ? hit[1] : null;
}

/**
 * Read a free-text description of a gym.
 * @returns {{add: string[], off: string[], custom: {name: string, pattern: string}[], unknown: string[], machines: {ref: string, vendor: string}[]}}
 */
export function parseEquipmentText(text) {
  const add = new Set(); const off = new Set(); const custom = []; const unknown = []; const machines = [];
  const clean = String(text || '').replace(/[’`]/g, "'");
  // A maker named for a group, as in "these are from Technogym: a, b, c", holds until the sentence ends.
  const sentences = clean.split(/[.;\n]/);
  const clauses = [];
  for (const sentence of sentences) {
    const m = sentence.match(/\b(?:from|by|made by|brand|vendor|maker)\s+([A-Za-z0-9][A-Za-z0-9&' -]{1,38}?)\s*:/i);
    // "by the bus" or "from my old gym" is not a maker: a name does not start with an article, and is short.
    const named = m && !/^(the|my|our|a|an|this|that|these|those|your)\b/i.test(m[1].trim()) && m[1].trim().split(/\s+/).length <= 4;
    const vendor = named ? m[1].trim().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null;
    const body = m ? sentence.slice(m.index + m[0].length) : sentence;
    for (const c of body.toLowerCase().split(/,|\band\b|\bplus\b|\balso\b|\bbut\b|\bas well as\b/)) clauses.push({ clause: c, vendor });
  }
  const note = (ref, vendor) => { if (vendor && !machines.some((x) => x.ref === ref)) machines.push({ ref, vendor }); };
  for (const item of clauses) {
    let { clause, vendor } = item;
    // A maker named inside the clause belongs to the machine named with it.
    const mk = clause.match(MAKER_RE);
    if (mk) { vendor = makerName(mk[1]); clause = `${clause.slice(0, mk.index)} ${clause.slice(mk.index + mk[0].length)}`; }
    let rest = ` ${clause} `;
    if (!rest.trim()) continue;
    // A named variant of a catalog machine is a machine of its own.
    const variant = !NEGATIVE.test(rest) && VARIANT.test(rest) ? ALIAS_LIST.find(({ w, ids }) => ids.length === 1 && wordAt(rest, w) >= 0 && byEquipId[ids[0]]?.kind === 'machine' && onlyPattern(ids[0])) : null;
    if (variant) {
      const name = clause.replace(FILLER, ' ').replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
      const shown = name[0].toUpperCase() + name.slice(1);
      custom.push({ name: shown, pattern: onlyPattern(variant.ids[0]) });
      note(shown, vendor);
      continue;
    }
    let matched = false;
    for (const { w, ids } of ALIAS_LIST) {
      let from = 0;
      for (;;) {
        const at = rest.indexOf(w, from);
        if (at < 0) break;
        from = at + w.length;
        if (/[a-z]/.test(rest[at - 1] || ' ') || /[a-z]/.test(rest[at + w.length] || ' ')) continue;
        const negative = NEGATIVE.test(rest.slice(0, at));
        ids.forEach((id) => { (negative ? off : add).add(id); if (!negative) note(id, vendor); });
        rest = `${rest.slice(0, at)}${'_'.repeat(w.length)}${rest.slice(at + w.length)}`;
        matched = true;
      }
    }
    if (matched) continue;
    // Nothing from the catalog: maybe a machine of the gym's own.
    if (NEGATIVE.test(rest)) continue;
    const name = clause.replace(FILLER, ' ').replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*\b(machines?|stations?)$/, '').trim();
    if (name.replace(/[^a-z]/g, '').length < 3) continue;
    // Assisted machines are left out: a higher setting makes them easier, which the load logic would read backwards.
    const pattern = NOT_STRENGTH.test(name) || /assist/.test(name) ? null : guessPattern(name);
    const full = /\s/.test(name) ? name : `${name} machine`; // "the glute machine" stays a name, not just "Glute"
    const shown = full[0].toUpperCase() + full.slice(1);
    if (pattern) { custom.push({ name: shown, pattern }); note(shown, vendor); } else unknown.push(name);
  }
  for (const id of add) off.delete(id); // "we have X" beats "no X" said elsewhere
  return { add: [...add], off: [...off], custom, unknown, machines };
}

/**
 * Save what was read. Returns the new equipment state and a summary of what
 * changed, in display names. `newId` makes ids for the gym's own machines.
 */
export function applyEquipmentRead(eq, read, newId) {
  const items = { ...(eq?.items || {}) };
  const custom = [...(eq?.custom || [])];
  const details = { ...(eq?.details || {}) };
  const byId = Object.fromEntries(EQUIPMENT.map((x) => [x.id, x]));
  const sum = { added: [], already: [], off: [], custom: [], described: [], unknown: [...new Set((read.unknown || []).map((u) => String(u).trim()).filter(Boolean))].slice(0, 12) };
  const addIds = [...new Set(read.add || [])].filter((id) => byId[id]);
  for (const id of addIds) {
    const x = byId[id];
    const was = isAvailable({ items, custom }, id);
    if (x.kind === 'basic') delete items[id]; else items[id] = true;
    (was ? sum.already : sum.added).push(x.name);
  }
  for (const id of new Set(read.off || [])) {
    const x = byId[id];
    if (!x || addIds.includes(id)) continue;
    const listed = x.kind === 'basic' || id in items;
    if (listed && items[id] !== false) { items[id] = false; sum.off.push(x.name); }
  }
  for (const c of read.custom || []) {
    const name = String(c?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) continue;
    const lower = name.toLowerCase();
    const inCatalog = EQUIPMENT.find((x) => x.name.toLowerCase() === lower);
    if (inCatalog) {
      if (!isAvailable({ items, custom }, inCatalog.id)) { if (inCatalog.kind === 'basic') delete items[inCatalog.id]; else items[inCatalog.id] = true; sum.added.push(inCatalog.name); }
      continue;
    }
    if (custom.some((k) => k.name.toLowerCase() === lower)) { sum.already.push(name); continue; }
    if (!PATTERNS[c.pattern]) { sum.unknown.push(name); continue; }
    custom.push({ id: newId(), name, pattern: c.pattern, zone: ZONES.machines });
    sum.custom.push(`${name} (${PATTERNS[c.pattern].toLowerCase()})`);
  }
  // What the reader knows about the exact machines, attached to the entries just saved.
  let detailChanges = 0;
  for (const m of read.machines || []) {
    const id = resolveMachineRef({ items, custom }, m?.ref);
    const d = cleanDetail(m, m?.basis || (m?.how || m?.isolates ? 'memory' : 'stated'));
    if (!id || !d) continue;
    const before = JSON.stringify(details[id] || null);
    // A checked web result is not downgraded by a later read from memory.
    details[id] = details[id]?.basis === 'web' ? { ...d, ...details[id] } : { ...(details[id] || {}), ...d };
    if (JSON.stringify(details[id]) !== before) detailChanges++;
    // Every machine the text named is listed, changed or not, so a repeat read can still be looked up.
    sum.described = sum.described.filter((x) => x.id !== id);
    sum.described.push({ id, name: nameOf({ items, custom }, id), label: machineLabel(details[id]), basis: details[id].basis, ...(details[id].source ? { host: hostOf(details[id].source) } : {}) });
  }
  const changed = sum.added.length + sum.off.length + sum.custom.length + detailChanges > 0;
  return { equipment: { items, custom, details }, summary: sum, changed };
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const nameOf = (eq, id) => equipmentList(eq).find((x) => x.id === id)?.name || id;
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A machine is pointed at by its catalog id or by the name it was saved under. */
export function resolveMachineRef(eq, ref) {
  const r = String(ref || '').trim().toLowerCase();
  if (!r) return null;
  const list = equipmentList(eq);
  const hit = list.find((x) => x.id.toLowerCase() === r) || list.find((x) => x.name.toLowerCase() === r);
  return hit && isListed(eq, hit.id) ? hit.id : null;
}

/** Keep only well-formed facts about a machine. Returns null when nothing is left. */
export function cleanDetail(m, basis) {
  const d = {
    vendor: text(m?.vendor, 40), model: text(m?.model, 80),
    how: text(m?.how ?? m?.how_it_works, 420), isolates: text(m?.isolates, 220), notes: text(m?.notes, 300),
    loading: LOADING[m?.loading] ? m.loading : '',
    sketch: SKETCH_IDS.includes(m?.sketch ?? m?.looks_like) ? (m.sketch ?? m.looks_like) : '',
    source: basis === 'web' ? text(m?.source, 300) : '',
    basis,
  };
  if (!d.vendor && !d.model && !d.how && !d.isolates) return null;
  for (const k of Object.keys(d)) if (d[k] === '') delete d[k];
  return d;
}

const sameUrl = (u) => String(u || '').trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

/**
 * Fold web lookup results into the saved details. A result only counts as
 * "found on the web" when its source address is one the search really returned.
 */
export function applyMachineLookup(eq, found, urls) {
  const allowed = new Set((urls || []).map(sameUrl));
  const details = { ...(eq?.details || {}) };
  const described = [];
  for (const f of Array.isArray(found) ? found : []) {
    const id = resolveMachineRef(eq, f?.ref);
    if (!id) continue;
    const src = typeof f?.source_url === 'string' && /^https:\/\//.test(f.source_url) && allowed.has(sameUrl(f.source_url)) ? f.source_url.trim() : '';
    if (!src) continue; // nothing checkable: keep what we had
    const d = cleanDetail({ ...f, source: src }, 'web');
    if (!d || !(d.how || d.isolates)) continue;
    details[id] = { ...(details[id] || {}), ...d };
    described.push({ id, name: nameOf(eq, id), label: machineLabel(details[id]), basis: 'web', host: hostOf(src) });
  }
  return { equipment: { ...eq, details }, described };
}
