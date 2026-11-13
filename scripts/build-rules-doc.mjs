// Writes docs/training-rules.md from js/domain/rules.js, so the document people
// read and the rules the app runs on are always the same thing.
import { writeFileSync, mkdirSync } from 'node:fs';
import * as R from '../js/domain/rules.js';

const L = [];
L.push(`# Seria training rules, version ${R.RULES_VERSION}`, '');
L.push(`Last updated ${R.RULES_UPDATED}. Generated from \`js/domain/rules.js\` with \`npm run rules-doc\`. Do not edit by hand: change the rules file, bump \`RULES_VERSION\`, and run the script again.`, '');
L.push('This is the one set of rules behind the app. Three things read it:', '');
L.push('- the plan generator (`js/domain/planner.js`),');
L.push('- the suggestions during and after a workout (`js/domain/progression.js`),');
L.push('- the prompt sent to Claude (`js/ai/prompts.js`), which includes the full text below.', '');
L.push('Every plan and every stored workout records the rules version it was made with.', '');
L.push('Seria is not medical advice. Stop if something hurts and see a professional.', '');

let area = '';
for (const r of R.RULES) {
  if (r.area !== area) { area = r.area; L.push(`## ${area}`, ''); }
  L.push(`**${r.id}.** ${r.text}`, '');
  L.push(`- Source: ${r.sources.map((s) => R.SOURCES[s].short).join('; ')}`);
  L.push(`- In the code: ${r.uses.map((u) => `\`${u}\``).join(', ')}`, '');
}

L.push('## Numbers', '');
L.push('### Sets, reps and rest by goal', '');
L.push('| Goal | Role in the session | Sets | Reps | Rest between sets |', '|---|---|---|---|---|');
for (const [goal, tiers] of Object.entries(R.PRESCRIPTION)) {
  for (const [tier, p] of Object.entries(tiers)) L.push(`| ${R.GOALS[goal].label} | ${tier} | ${p.sets} | ${p.repLo}-${p.repHi} | ${p.rest} s |`);
}
L.push('', 'Main means the first heavy compound lifts of the day, secondary the compound lifts after them, accessory the single-joint and core work.', '');
L.push(`Dumbbell, machine and bodyweight exercises use at least ${R.NON_BARBELL_MIN_RANGE.repLo}-${R.NON_BARBELL_MIN_RANGE.repHi} reps. Novices do at most ${R.NOVICE.maxSetsPerExercise} sets per exercise and no fewer than ${R.NOVICE.minRepLo} reps.`, '');

L.push('### Experience levels', '', '| Level | Months of regular training | Reps left in reserve | Weekly sets per muscle group |', '|---|---|---|---|');
let from = 0;
for (const l of R.LEVELS) {
  const to = Number.isFinite(l.maxMonths) ? `${from} to under ${l.maxMonths}` : `${from} and more`;
  L.push(`| ${l.label} | ${to} | ${R.TARGET_RIR[l.id].join('-')} | ${R.WEEKLY_SETS[l.id].join('-')} |`);
  from = l.maxMonths;
}

L.push('', '### Week layout', '', '| Training days a week | Days |', '|---|---|');
for (const [n, split] of Object.entries(R.SPLITS)) L.push(`| ${n} | ${split.map((k) => R.DAY_TITLES[k]).join(', ')} |`);
L.push('', `At most ${R.MAX_DAYS} training days are planned.`, '');

L.push('### Order of movements on each kind of day', '', 'Slots are filled in this order. When time is short they are dropped from the end.', '');
for (const [kind, slots] of Object.entries(R.TEMPLATES)) L.push(`- **${R.DAY_TITLES[kind]}${kind === 'fullB' ? ' (second day)' : ''}:** ${slots.map(([p, t]) => `${p.replace('_', ' ')} (${t})`).join(', ')}`);

L.push('', '### Session time', '');
L.push(`- General warm-up: ${R.TIME.warmupGeneralSec / 60} min. Ramp-up sets before the first lift: ${R.TIME.warmupRampSec / 60} min.`);
L.push(`- One set: ${R.TIME.setBaseSec} s to get into position plus ${R.TIME.secPerRep} s per rep.`);
L.push(`- Moving to the next station and setting up: ${R.TIME.transitionSec / 60} min.`);
L.push(`- A day is never trimmed below ${R.TIME.minExercises} exercises or ${R.TIME.minSets} sets per exercise.`, '');

L.push('### Progression and result reading', '');
const P = R.PROGRESSION;
L.push(`- Load goes up by one step when every set reaches the top of the rep range (a step is roughly ${P.increasePctMin}-${P.increasePctMax}% of the load).`);
L.push(`- Default steps: ${Object.entries(P.defaultStep).map(([k, v]) => `${R.LOAD_TYPES[k].label} ${v}`).join(', ')}. The user can set the step per exercise.`);
L.push(`- During a session, a set that ends 1 rep short with no reps in reserve suggests about ${P.smallDropPct}% less load for the sets to come; ${P.bigMissReps} or more reps short suggests about ${P.bigDropPct}%. Never less than one step.`);
L.push(`- During a session, hitting the target with ${P.lightRir} or more reps in reserve suggests one step more.`);
L.push(`- After a session, a shortfall counts from ${P.shortfallReps} missed reps in total, or a load lowered mid-session. Two sessions running with a shortfall at the same load suggest ${P.deloadPct}% less.`, '');

L.push('### How loads are recorded', '');
for (const [k, t] of Object.entries(R.LOAD_TYPES)) L.push(`- **${t.label}** (\`${k}\`): ${t.pick.toLowerCase()}.`);

L.push('', '## Sources', '');
for (const s of Object.values(R.SOURCES)) L.push(`- **${s.short}.** ${s.cite}${s.url ? ` <${s.url}>` : ''}`);
L.push('', 'The journal references were checked against their DOI records on 2026-11-13. Rules marked "App convention" are practical choices made for this app, not findings from a study.', '');

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/training-rules.md', import.meta.url), L.join('\n'));
console.log(`docs/training-rules.md  ${L.length} lines`);
