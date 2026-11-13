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
  e('leg_curl', 'Leg curl', 'knee_flex', ['leg_curl'], 'machine', 1),

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

  e('hanging_knee_raise', 'Hanging knee raise', 'core', ['pullup_bar'], 'bodyweight', 1),
  e('cable_crunch', 'Cable crunch', 'core', ['cable'], 'machine', 2),
  e('crunch', 'Crunch', 'core', [], 'bodyweight', 3),
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
  [['crunches', 'crunch', 'abs'], ['hanging_knee_raise', 'cable_crunch', 'crunch']],
];

// ---------------------------------------------------------------- helpers

export const emptyEquipment = () => ({ items: {}, custom: [] });

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
 * Other ways to do the same movement right now, best first.
 * @param {object} eq equipment state
 * @param {string} exerciseId the lift to replace
 * @param {object} [opts] exclude: ids already in the session; busy: equipment ids in use by someone else
 */
export function substitutesFor(eq, exerciseId, opts = {}) {
  const all = allExercises(eq);
  const cur = all.find((x) => x.id === exerciseId);
  if (!cur) return [];
  const exclude = new Set([exerciseId, ...(opts.exclude || [])]);
  const busy = new Set(opts.busy || []);
  const avoidTags = new Set(opts.avoidTags || []);
  const avoid = new Set(opts.avoid || []);
  const ok = (x) => !exclude.has(x.id) && !avoid.has(x.id) && canDo(eq, x) && !x.equip.some((id) => busy.has(id)) && !x.tags.some((t) => avoidTags.has(t));
  const same = all.filter((x) => x.pattern === cur.pattern && ok(x)).sort((a, b) => a.rank - b.rank);
  return same;
}
