// Canned model answers for the smoke test. The same function backs the fake
// Anthropic API, the fake OpenAI API and the fake claude.ai runtime, so every
// path sees the same "model".
// It must be self-contained: it is also injected into the page as text.
export function canned(payload) {
  const empty = { message: '', questions: [], profile: null, ready_for_plan: false, plan: null, changes: [], equipment: null, schedule: null };
  const mode = payload.mode;
  if (mode === 'interview') {
    const msg = String(payload.user_message || '');
    if (/connection test/i.test(msg)) return { ...empty, message: 'Hello from the model' };
    if (payload.current_plan && /shorter|fewer sets/i.test(msg)) {
      const ex = payload.current_plan.sessions[0].exercises[0];
      return { ...empty, message: 'I can trim the first lift of the first session.', changes: [{ exercise_key: ex.exercise_key, field: 'sets', new_value: ex.sets - 1, new_exercise_id: null, reason: `You asked for a shorter session, so ${ex.name} drops from ${ex.sets} to ${ex.sets - 1} sets.` }] };
    }
    return {
      ...empty,
      message: 'Strength, three days, fifty minutes. I have what I need.',
      profile: {
        goal: 'strength', months_training: 12, days_per_week: 3, weekdays: [], minutes_per_session: 50,
        preferences: null, limitations: null, avoid_exercise_ids: ['bb_deadlift', 'not_a_real_lift'], include_exercise_ids: ['pull_up'],
      },
      ready_for_plan: true,
    };
  }
  if (mode === 'equipment') {
    const t = String(payload.user_text).toLowerCase();
    const plain = (x) => x.name.toLowerCase().replace(/ machine$/, '');
    const named = (x) => t.includes(plain(x));
    const lacking = (x) => t.includes(`no ${plain(x)}`);
    const add = payload.equipment_catalog.filter((x) => named(x) && !lacking(x)).map((x) => x.id);
    if (/cables|functional trainer/.test(t)) add.push('cable');
    const branded = /technogym/.test(t);
    const custom = /belt squat/.test(t) ? [{ name: 'Belt squat', movement_id: 'squat' }, { name: 'Mystery box', movement_id: 'not_a_movement' }] : [];
    const facts = {
      leg_press: ['Selection 900 Leg Press', 'From memory: you sit upright and push a footplate away along a fixed track.', 'Quadriceps and glutes; hamstrings help.'],
      chest_press: ['Selection 900 Chest Press', 'From memory: seated press with two handles that move together.', 'Chest, front shoulders and triceps.'],
    };
    return {
      ...empty,
      message: 'Saved.',
      equipment: {
        add_ids: [...add, 'made_up_machine'],
        unavailable_ids: payload.equipment_catalog.filter(lacking).map((x) => x.id),
        custom,
        unrecognized: /treadmill/.test(t) ? ['treadmills'] : [],
        machines: !branded ? [] : [
          ...add.filter((id) => facts[id]).map((id) => ({ ref: id, vendor: 'Technogym', model: facts[id][0], how_it_works: facts[id][1], isolates: facts[id][2], loading: 'selectorized', notes: null, sure: true })),
          { ref: 'nothing_like_this', vendor: 'Technogym', model: 'Ghost 3000', how_it_works: 'x', isolates: 'y', loading: 'laser', notes: null, sure: false },
        ],
      },
    };
  }
  if (mode === 'new_plan' || mode === 'next_run') {
    const have = new Set(payload.available_exercises.map((x) => x.id));
    const day = (title, rest, ids) => ({
      week: 1, title, rest_days_after: rest,
      exercises: ids.filter((id) => id === 'ghost_lift' || have.has(id)).map((id, i) => ({ exercise_id: id, role: i < 2 ? 'main' : 'accessory', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 90 })),
    });
    if (mode === 'next_run') {
      return {
        ...empty,
        message: 'Next run: pressing and rowing stay, legs get a new main lift.',
        plan: {
          days: [
            day('Push', 1, ['db_bench_press', 'db_shoulder_press', 'db_lateral_raise']),
            day('Pull', 1, ['db_row', 'chin_up', 'db_curl']),
            day('Legs', 2, ['goblet_squat', 'db_rdl', 'db_calf_raise']),
          ],
          notes: [],
        },
      };
    }
    return {
      ...empty,
      message: 'Your plan is set.',
      plan: {
        days: [
          day('Upper body', 1, ['db_bench_press', 'db_row', 'ghost_lift', 'db_shoulder_press', 'pull_up']),
          day('Lower body', 1, ['leg_press', 'goblet_squat', 'bb_rdl', 'db_split_squat', 'db_calf_raise']),
          day('Full body', 2, ['incline_db_press', 'chin_up', 'db_reverse_lunge', 'db_curl']),
        ],
        notes: ['Built by the test double.'],
      },
    };
  }
  if (mode === 'train_now') {
    // Disagree with the app on purpose where there is a choice: take a session it did
    // not pick, turn the rest around, and slip in a session that does not exist.
    const left = payload.current_plan.list.still_to_do_in_order.length ? payload.current_plan.list.still_to_do_in_order : payload.current_plan.sessions.map((x) => x.session_id);
    const first = left.find((id) => id !== payload.app_pick.session_id) || left[0];
    const ex = payload.current_plan.sessions.find((x) => x.session_id === first).exercises[0];
    return {
      ...empty,
      message: 'Different order today.',
      schedule: {
        first_session_id: first,
        reason: `Test double: ${payload.days_off_plan} days off plan, so the last session goes first.`,
        order: ['no_such_session', ...left.filter((id) => id !== first).reverse()],
        rest_days: [3, 0],
        ease_percent: 5,
      },
      changes: [{ exercise_key: ex.exercise_key, field: 'rest', new_value: ex.rest_seconds + 30, new_exercise_id: null, reason: 'Test double: a little more rest on the first lift.' }],
    };
  }
  if (mode === 'in_session') {
    const ex = payload.session.exercises.find((x) => x.sets.some((s) => s.status === 'done') && x.sets.some((s) => s.status === 'pending'))
      || payload.session.exercises.find((x) => x.sets.some((s) => s.status === 'done'));
    if (!ex) return empty;
    const last = [...ex.sets].reverse().find((s) => s.status === 'done');
    return { ...empty, message: 'One tweak.', changes: [{ exercise_key: ex.exercise_key, field: 'load', new_value: Math.max(0, (last.load || 0) - 4), new_exercise_id: null, reason: `Test double: ${last.reps} reps against a target of ${last.target_reps} at ${last.load}.` }] };
  }
  if (mode === 'after_session') {
    const ex = payload.current_plan.sessions[0].exercises[0];
    const left = payload.current_plan.list.still_to_do_in_order;
    return {
      ...empty,
      message: 'Solid session.',
      changes: [{ exercise_key: ex.exercise_key, field: 'load', new_value: (ex.load || 20) + 2, new_exercise_id: null, reason: `Test double: every set of ${ex.name} was done, so add a step.` }],
      // With two or more sessions left, swap the next two and give the new first one three days of rest after it.
      schedule: left.length >= 2 ? { first_session_id: left[1], reason: 'Test double: the second session moves up after this workout.', order: [left[0], ...left.slice(2)], rest_days: [3], ease_percent: null } : null,
    };
  }
  return empty;
}

/**
 * The web-lookup double. Finds a page for the leg press only: the chest press
 * comes back with an address the search never returned, which the app must not
 * accept, and one entry points at a machine nobody asked about.
 */
export function cannedLookup(payload) {
  const page = (ref) => `https://maker.example/products/${ref}`;
  const urls = payload.machines.filter((m) => m.ref === 'leg_press').map((m) => page(m.ref));
  const found = payload.machines.map((m) => ({
    ref: m.ref, vendor: m.vendor, model: m.ref === 'leg_press' ? 'Selection 900 Leg Press' : `${m.model || m.kind}`,
    how_it_works: `From the maker's page: ${m.kind} with a weight stack. You sit, set the backrest, and push the platform away.`,
    isolates: 'Quadriceps first, then glutes.', loading: 'selectorized', notes: 'Backrest has five positions.',
    source_url: m.ref === 'leg_press' ? page(m.ref) : 'https://made-up.example/not-searched',
  }));
  found.push({ ref: 'smith', vendor: 'Nobody', model: 'Unasked', how_it_works: 'x', isolates: 'y', loading: 'other', notes: '', source_url: urls[0] || '' });
  return { urls, text: `Here is what I found.\n${JSON.stringify(found)}\nDone.` };
}
