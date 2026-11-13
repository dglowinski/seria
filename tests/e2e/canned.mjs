// Canned Claude answers for the smoke test. The same function backs the fake
// Anthropic API and the fake claude.ai runtime, so both paths see one "Claude".
// It must be self-contained: it is also injected into the page as text.
export function canned(payload) {
  const empty = { message: '', questions: [], profile: null, ready_for_plan: false, plan: null, changes: [] };
  const mode = payload.mode;
  if (mode === 'interview') {
    const msg = String(payload.user_message || '');
    if (/connection test/i.test(msg)) return { ...empty, message: 'Hello from Claude' };
    if (payload.current_plan && /shorter|fewer sets/i.test(msg)) {
      const ex = payload.current_plan.days[0].exercises[0];
      return { ...empty, message: 'I can trim the first lift on day one.', changes: [{ exercise_key: ex.exercise_key, field: 'sets', new_value: ex.sets - 1, new_exercise_id: null, reason: `You asked for a shorter session, so ${ex.name} drops from ${ex.sets} to ${ex.sets - 1} sets.` }] };
    }
    return {
      ...empty,
      message: 'Strength, three days, fifty minutes. I have what I need.',
      profile: {
        goal: 'strength', months_training: 12, days_per_week: 3, weekdays: ['mon', 'wed', 'fri'], minutes_per_session: 50,
        preferences: null, limitations: null, avoid_exercise_ids: ['bb_deadlift', 'not_a_real_lift'], include_exercise_ids: ['pull_up'],
      },
      ready_for_plan: true,
    };
  }
  if (mode === 'new_plan') {
    const have = new Set(payload.available_exercises.map((x) => x.id));
    const day = (weekday, title, ids) => ({
      weekday, title,
      exercises: ids.filter((id) => id === 'ghost_lift' || have.has(id)).map((id, i) => ({ exercise_id: id, role: i < 2 ? 'main' : 'accessory', sets: 3, rep_low: 8, rep_high: 10, rest_seconds: 90 })),
    });
    return {
      ...empty,
      message: 'Your week is set.',
      plan: {
        days: [
          day('mon', 'Upper body', ['db_bench_press', 'db_row', 'ghost_lift', 'db_shoulder_press', 'pull_up']),
          day('wed', 'Lower body', ['goblet_squat', 'bb_rdl', 'db_split_squat', 'db_calf_raise']),
          day('fri', 'Full body', ['incline_db_press', 'chin_up', 'db_reverse_lunge', 'db_curl']),
        ],
        notes: ['Built by the test double.'],
      },
    };
  }
  if (mode === 'in_session') {
    const ex = payload.session.exercises.find((x) => x.sets.some((s) => s.status === 'done') && x.sets.some((s) => s.status === 'pending'))
      || payload.session.exercises.find((x) => x.sets.some((s) => s.status === 'done'));
    if (!ex) return empty;
    const last = [...ex.sets].reverse().find((s) => s.status === 'done');
    return { ...empty, message: 'One tweak.', changes: [{ exercise_key: ex.exercise_key, field: 'load', new_value: Math.max(0, (last.load || 0) - 4), new_exercise_id: null, reason: `Claude double: ${last.reps} reps against a target of ${last.target_reps} at ${last.load}.` }] };
  }
  if (mode === 'after_session') {
    const ex = payload.current_plan.days[0].exercises[0];
    return { ...empty, message: 'Solid session.', changes: [{ exercise_key: ex.exercise_key, field: 'load', new_value: (ex.load || 20) + 2, new_exercise_id: null, reason: `Claude double: every set of ${ex.name} was done, so add a step.` }] };
  }
  return empty;
}
