// Builds report/report.html from the real smoke-test results, so the numbers
// in the report are the numbers the tests produced. Run after npm run smoke:shots.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, SOURCES, RULES_VERSION } from '../js/domain/rules.js';
import { EXERCISES, EQUIPMENT } from '../js/domain/catalog.js';
import { MOVES } from '../js/domain/moves.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const smoke = JSON.parse(readFileSync(`${root}report/smoke-results.json`, 'utf8'));
const APP_URL = 'https://claude.ai/artifact/BGZFQ5nHaNbfV9Qvgw13Ui';
const LIVE_URL = 'https://dglowinski.github.io/seria/';
const REPO_URL = 'https://github.com/dglowinski/seria';
const livePath = `${root}report/live-check.json`;
const live = existsSync(livePath) ? JSON.parse(readFileSync(livePath, 'utf8')) : null;

// Unit tests: run them here and count, rather than typing a number.
let unit = { pass: 0, fail: 0 };
try {
  const out = execFileSync('node', ['--test', ...['domain', 'coach'].map((n) => `${root}tests/${n}.test.js`)], { encoding: 'utf8' });
  unit = { pass: Number(out.match(/pass (\d+)/)[1]), fail: Number(out.match(/fail (\d+)/)[1]) };
} catch (e) {
  const out = String(e.stdout || '');
  unit = { pass: Number((out.match(/pass (\d+)/) || [0, 0])[1]), fail: Number((out.match(/fail (\d+)/) || [0, 1])[1]) };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The sheets of exercise drawings made by scripts/moves-gallery.mjs.
const moveSheets = readdirSync(fileURLToPath(new URL('../report/shots/', import.meta.url))).filter((f) => /^moves-\d+\.png$/.test(f)).sort();
const parts = [...new Set(smoke.results.map((r) => r.part))];
const PART_TEXT = {
  'A built-in': ['No Claude', 'The built-in coach, the rule-based plan, a full workout with a reload in the middle, history, backup and restore.'],
  'B Claude API': ['Claude through the API', 'The real Anthropic SDK in the browser, talking to a local stand-in for api.anthropic.com. Checks the request the app sends, late and failed answers, and a wrong key.'],
  'C in claude.ai': ['Inside claude.ai', 'A stand-in for the runtime claude.ai gives the page: cloud records, Claude, dictation. Includes moving to a fresh browser and getting everything back.'],
  'D install and offline': ['Home screen and offline', 'The install files, the icons, and starting the app with the network switched off.'],
  'E single file': ['The published file', 'The one-file build that is published on claude.ai, run end to end.'],
  'J own way': ['A workout that goes its own way', 'A station that is taken, a machine the app did not know, a set and an exercise added by hand. Then the review: what it is sent, how it reaches other sessions, and a plan it asks to have rebuilt.'],
  'J level': ['Nothing a workout earned is lost', 'With no model: the abdominal machine and a named maker read from plain words, and a plan that lost a step being brought level with the workouts on record.'],
  'F OpenAI API': ['OpenAI through the API', 'The real OpenAI SDK in the browser, talking to a local stand-in for api.openai.com. The request the app sends, plans, mid-workout and after-workout reviews, model choice, the machine lookup, and a wrong key.'],
};
const shots = [
  ['02-coach', 'Coach', 'You type or speak. The coach asks only for what is missing.'],
  ['03-assumptions', 'Assumptions', 'Before any plan is built you see what it will be based on.'],
  ['04-plan', 'Plan', 'A running list: train this, rest, train that. No fixed weekdays.'],
  ['30-train-now', 'Train now', 'On a day the plan did not have, you see what makes sense today and how the rest follows.'],
  ['32-train-now-claude', 'Train now, reviewed', 'With a model connected it reviews the pick against your history.'],
  ['33-next-run', 'The next run', 'When the list is done, the coach plans what comes next from your results.'],
  ['50-rebuild-chat', 'Ask for a new plan', 'It is built at once, from your workouts too. It starts after the last one, and the old plan can be put back.'],
  ['51-rebuild-plan', 'A rebuild, on the plan', 'The plan says it was rebuilt, by whom, and which session is next.'],
  ['52-chat-short', 'A short chat', 'The coach screen shows the conversation in progress. Earlier messages are a tap away.'],
  ['53-past-day', 'How an exercise has progressed', 'Each exercise box lists its last three steps in small print: when reps were added or the weight went up. "Show all" opens the rest.'],
  ['54-past-workout', 'The same, mid-workout', 'Under the sets of the exercise in hand, out of the way.'],
  ['06-day', 'Session preview', 'Order, equipment, sets, reps, rest, and how the time adds up. Each exercise has a drawing of how it is done; a tap plays it.'],
  ['59-day-motion', 'Drawings for machines too', 'The start of the move, with the end of it faint behind. It stands still until tapped.'],
  ['56-busy-own-machine', 'A machine the app did not know', 'Named from "Machine busy?", it is used at once and saved with the equipment.'],
  ['57-add-by-hand', 'Add a set or an exercise', 'Extra work on top of the plan: on record, never held against it.'],
  ['58-caught-up', 'Caught up with the records', 'A plan that missed what a workout earned takes that step when the app starts, and says so.'],
  ['40-day-optional', 'Optional extras', 'Each session lists up to two extras for the end, with the reason each one fits.'],
  ['44-pairs-switch', 'Supersets: one switch', 'On the Plan tab. It says what supersets save, and what they cost: harder sets, two stations.'],
  ['55-supersets-mode', 'Supersets as a mode', 'The summary before a plan is built has the switch. With it on, the plan is laid out for supersets.'],
  ['45-day-pairs', 'A session with supersets', 'Which exercises are done in turns, why they fit, and the rest between them.'],
  ['05-equipment', 'Equipment', 'Machines you add. Free weights, bench and bar are on by default.'],
  ['05-gym-text', 'Describe your gym', 'Name the machines or paste any text. It is read and saved, and you see what was added.'],
  ['17c-machines-identified', 'Machines by maker', 'Name the maker and the exact machines are identified. Each says whether it was found on the web or comes from memory.'],
  ['27-workout-machine', 'The machine, mid-workout', 'A drawing of the move on it, how it works and what it isolates.'],
  ['46-weights-first', 'Weights before the workout', 'Exercises with no weight yet are offered one by one. Fill in or skip.'],
  ['07-starting-weight', 'Starting an exercise', 'A drawing of the move, which plays three times by itself, and, with no history yet, your first weight.'],
  ['08-set-active', 'Set in progress', 'One button: Finish set. It saves the planned reps; −1 and +1 nudge them first.'],
  ['47-train', 'The band at the top', 'It does not scroll. While a set runs it says "Train", with the target and the set clock.'],
  ['49-push', '"Push"', 'On the last set of an exercise, which goes past its target, the band says "Push".'],
  ['48-pair-rest', 'A superset, mid-workout', 'After a set of one, a short rest counts down in the band, then the other one is up.'],
  ['37-overview', 'The whole workout', 'Tap the header to see every exercise and jump to any of them.'],
  ['10-rest', 'Rest', 'The set just saved stays in reach: nudge, change weight, undo. The next set starts by itself when the rest runs out.'],
  ['11-swap', 'Machine busy? Not now', 'Come back to it later, do another exercise instead, or drop it for today.'],
  ['41-optional-step', 'Feel like a bit more?', 'When the planned sets are done, the extras are offered. One tap takes one; "Finish workout" leaves them.'],
  ['43-thinking', 'The model reviews the workout', 'At the end it says the model is thinking. The plan changes when it answers; the rules step in only if it cannot be reached.'],
  ['12-summary', 'Summary', 'How it went, in words, and what it changed in the plan. Nothing to accept.'],
  ['42-optional-saved', 'An extra, saved', 'The summary names the extra that was done, and it moves on in the plan like any other exercise.'],
  ['13-proposals', 'Undo or edit', 'Each change can be undone, made again, or corrected by hand.'],
  ['29-plan-after-workout', 'A full cycle, always', 'The finished session moves to the end of the list, with its numbers updated.'],
  ['34-activity', 'Another activity', 'A run, a ride, a game: what, how long, how hard. The sheet says what it means for the plan.'],
  ['34b-plan-after-run', 'After a hard run', 'The legs wait: the plan puts another session first and says why.'],
  ['35-weights', 'Weights', 'What you lift on every exercise, entered up front, each with its own step.'],
  ['39-offline', 'No connection', 'The rules update the plan; the model reviews the workout when the phone is back online.'],
  ['38-settings-workout', 'Workout settings', 'Auto-start, sound, vibration, and the signal with the screen off, with a test button.'],
  ['15-session-detail', 'History, one workout', 'Every set: plan and result. Tap a set to correct it.'],
  ['18-claude-hint', 'Claude mid-workout', 'The rules change the sets to come at once; Claude\'s change takes their place if it arrives in time.'],
  ['25-openai-connected', 'OpenAI', 'Choose Claude or OpenAI in Settings and paste that provider\'s key.'],
  ['21-viewer-settings', 'Inside claude.ai', 'Claude connected with no key.'],
  ['16-rules', 'Training rules', 'The rules and their sources, readable in the app.'],
].filter(([f]) => existsSync(`${root}report/shots/${f}.png`));

const spec = [
  ['Navigation: Plan, Coach, History, Equipment. The workout has its own screen with one main action in thumb reach.', 'done', 'Four tabs at the bottom. The workout screen hides them and keeps one big button at the bottom whose label follows the step.'],
  ['Say or type your goal, experience, days and time per session. Voice goes into a text field you can edit.', 'done', 'Coach chat with a microphone button. Speech lands in the text box; you fix it, then send.'],
  ['The coach asks for missing details and shows its assumptions before building the plan.', 'done', 'Works with Claude and without. No plan is created until you tap "Build my plan" under the assumptions.'],
  ['Preferences and movement limitations.', 'done', 'Reads things like "no deadlifts", "I love pull-ups", "my knee hurts". Limitations are handled on the careful side and the app says what it left out.'],
  ['You enter machines. Free weights, benches and the pull-up bar are available by default.', 'done', `${EQUIPMENT.filter((x) => x.kind === 'machine').length} machines to pick from, plus your own machine with what it trains. Or describe the gym in your own words, typed, pasted or spoken: it is read (by the connected model, or by a built-in reader) and the list is saved in one go. Name the maker ("these are from Technogym: ...") and the exact machines are identified, with how each works and what it isolates saved for the coach. Each item has an Available switch.`],
  ['The plan shows days, body parts, time, exercise order, equipment, sets, reps, weight or how to choose it, and rests. Day time includes warm-up, rests and moving between stations.', 'done', `Plan list and session preview. ${EXERCISES.length} exercises in the catalog. The preview splits the time into warm-up, sets, rests and moving. Changed at your request: the plan is no longer a fixed week but a running list of sessions with rest days between, on any days you like.`],
  ['"Start set" shows the active set. "Finish set" opens the result, starting from the planned value. Correct reps by 1 or 2 or type them. Change weight, add reps in reserve.', 'changed', 'Changed at your request: "Finish set" now saves the planned reps in one tap and starts the rest. −1 and +1 work while the set runs and during the rest after it, where you can also change the weight, add reps in reserve, or undo the finish. Any number can still be typed by tapping the set in the list.'],
  ['Saving starts the countdown. After the last set the screen shows the next exercise.', 'done', 'Saving takes effect at once and never waits for a model. When the rest runs out, the next set of the same exercise starts by itself; "Start now" resets its clock.'],
  ['For a busy machine, pick a substitute from available equipment.', 'done', '"Machine busy? Not now" offers three things: come back to it later, another exercise (same movement first, then same muscles) on equipment you marked available, or drop it for today. A swap is for that workout only.'],
  ['Coming back to the tab restores the saved sets and the rest time left, from the time the rest ends.', 'done', 'Every tap is saved. The rest is stored as an end time. Tested by reloading in the middle of a rest.'],
  ['With no history, the screen asks for a starting weight. Loads are kept as weight per dumbbell, total weight, machine setting, or bodyweight.', 'done', 'Four load types, each with its own label and step size.'],
  ['A session keeps plan and result for every set, also after the plan changes. The summary shows done and skipped sets, time and the biggest differences. A wrong entry can be corrected.', 'done', 'Each workout stores its own copy of the plan. Sets can be corrected during the workout and later from History.'],
  ['During a session, AI may propose a change to a set or exercise not done yet. After it, AI compares with earlier results and proposes updates. Each proposal shows the change, a short reason, and Apply or Keep plan.', 'changed', 'Changed at your request: changes are now made at once, during and after a workout, and shown with the old value, the new value and the reason. Each one has Undo, and after a workout also Edit. The training rules answer first; a connected model\'s review takes their place when it arrives.'],
  ['AI stays off the main path. With no answer, carry on with the last approved plan. A late suggestion shows only if it is about a part not done yet.', 'done', 'Tested with a slow answer, a late answer, a failing server and no connection at all. With no connection the rules update the plan and the model\'s review is asked for when the phone is back online.'],
  ['A versioned library of training rules with sources, used by the plan generator and by the updates. A source document plus a rule set the app uses.', 'done', `Version ${RULES_VERSION}: ${RULES.length} rules, ${Object.values(SOURCES).filter((s) => s.url).length} published sources. One file drives the generator, the suggestions, the Claude prompt and the generated document.`],
  ['The AI prompt: modes for a new plan, during a session and after a session; asks when information is missing; uses only recorded data; returns questions, a plan or a list of changes with reasons; returns an empty list when nothing is justified.', 'done', 'One prompt and one answer format for all modes, plus an interview mode for the chat. The app fills in the "previous value" itself and drops anything that does not match its records.'],
];

// Version 1.1: the list of seventeen notes from the first real workouts.
const v11 = [
  ['Baseline weights for everything.', 'A Weights screen lists every exercise your equipment allows. Type what you lift now, before the first workout or any time later.'],
  ['What to aim for on each set.', 'Every set says whether to stop at the target or push on. The last set of an exercise may go past the target; the extra reps are recorded.'],
  ['A summary after every workout.', 'In words: how it went against the plan, what changed and why. Written by the connected model, or by the training rules until it answers or when there is none.'],
  ['One tap to finish a set.', '"Finish set" saves the planned reps and starts the rest. −1 and +1 work before the tap and during the rest after it, and the finish can be undone.'],
  ['The next set starts by itself.', 'When the rest runs out, the next set of the same exercise begins from that moment. "Start now" resets its clock. Can be switched off.'],
  ['Everything is logged.', 'When each set started and ended, how long rests really took, every nudge, undo, skip, swap and correction, and when the screen went off. The summary compares rests with the plan, the model gets the timing, and History shows the log.'],
  ['Any step size, and weights set by hand.', 'Each exercise has its own smallest step: the usual sizes or any number. A weight in the plan can be changed by hand from the session preview.'],
  ['Better substitutes.', 'Alternatives are grouped: same movement first, then same muscles by another movement. Leg curls now have real stand-ins, with new exercises added for it.'],
  ['The plan is worked out again after corrections.', 'Correct a set of your latest workout in History and its update is taken back and redone from the new numbers. Deleting that workout takes its changes back too.'],
  ['Other activity.', 'Log a run, a ride, a game by time and effort. Enough of it counts as work for the muscles it uses, so leg sessions wait 48 hours after a hard run. A new rule with a source covers this.'],
  ['Machine busy: later, something else, or drop.', '"Come back to it later" moves the exercise to the end of the workout. The header opens the whole workout, where you can jump to any exercise.'],
  ['A full cycle always on show.', 'A finished session moves to the end of the list with its numbers already updated, instead of vanishing.'],
  ['"The plan will be updated when you are online."', 'With no connection the rules update the plan at once, the plan says a review is waiting, and the model is asked as soon as the phone is back online.'],
  ['Changes are made, not proposed.', 'After a workout, from the chat and when equipment changes, the plan is updated without asking. "What changed" lists every change with its reason, an Undo and an Edit.'],
  ['A signal with the screen off.', 'A web page cannot vibrate behind a dark screen, so the app sends a notification when the rest ends (stand-alone app). The beep is scheduled ahead on the audio clock. Settings has a test button. Not tried on a real phone.'],
  ['The long view.', 'A plain-words outlook on the Plan tab: what this round holds, how it gets harder, what changes round to round, what happens when it stalls, and what would be added with more time. A connected model adds its own.'],
];

// Version 1.10: nothing earned is lost, the whole plan after every workout, a workout that goes its own way, and every exercise in motion.
const v110 = [
  ['Nothing a workout earned is lost.', 'A rebuilt plan could come back without the step your last workout had earned: the review of that workout is the model\'s, it takes a while, and when the plan was replaced before the answer came, the answer was dropped. An exercise that came back into a plan after a break started at the bottom of its range again. Now every new plan is brought level with the workouts on record: for each exercise, its last workout says where it stands, by the same rules a review uses. The same check runs when the app starts, so a plan that already lost a step gets it back, and says so on the Plan tab.'],
  ['After every workout, the whole plan is thought through.', 'Before, the model was sent the plan and the workout and told to compare them. It could change any session, but nothing told it to look beyond the exercises just done. Now it is told to go through every session after every workout: does each exercise still earn its place, are the sets a week in range, do the sessions fit the time you really take, do the order and the rest days still fit. It gets the workouts on record, the sets a week per muscle group and the conversation to do it. It can change any session, add an exercise to one, or have the plan built anew, which lands in the chat with "Put the old plan back". It is told just as plainly that changing only weights and reps is right when the plan is working. With no model connected, the training rules still move weights and reps only.'],
  ['"Machine busy?" does more.', 'It now offers the session\'s optional extras to do in the meantime; the exercise you put aside is next after it, also when it is the last one left. "Another exercise or machine" lists everything your equipment allows, the same muscles first, with a search box. A machine that is not on your list can be named there: it is used at once and saved with your equipment.'],
  ['Sets and exercises can be added by hand.', '"Add a set or an exercise" is in the workout, in its overview, and on the last step. Extra work goes on record and counts toward your week, but it is never held against the plan: a short extra set does not cost you a step, and what was added and not done leaves no trace. The model is told which work was added by hand, and what it keeps seeing it can put into the plan.'],
  ['The abdominal machine, makers, variants.', 'The catalog has an abdominal machine. "Abdominal from Life Fitness" is read as that machine with its maker, with no model connected too. A variant named in full, such as an iso-lateral leg extension, is kept as a machine of its own next to the plain one, with its own weights, so "Machine busy?" can offer it.'],
  ['Every exercise has a drawing that moves.', `A stick figure does one rep with the equipment, in the same line style as the equipment sketches: ${Object.keys(MOVES).length} moves for the ${EXERCISES.length} exercises of the catalog and for machines of your own, by the movement they train.` + ' They are drawn by the app, not downloaded, so they work offline and in the single-file build. In a workout the drawing plays three times when an exercise comes up, then rests. In a session\'s preview it stands still, the start of the move with the end faint behind, until tapped. A phone set to reduce motion gets the still picture.'],
];

// Version 1.9: progress as steps, and a button to rebuild.
const v19 = [
  ['Progress means steps.', 'The small list in each exercise box no longer shows every past workout. It shows the steps: each time reps were added or the weight went up (or came down), with what it moved from and to, dated by the workout that earned it. The step made after your last workout is there too. An exercise whose target has not moved shows nothing.'],
  ['A "Rebuild plan" button.', 'On the Plan tab and on the Coach tab. One tap builds a new plan at once from your settings, your workouts and the conversation, and lands in the chat, where "Put the old plan back" is. The chat can still do the same in words.'],
];

// Version 1.8: the settings are preferences, the model decides, and the chat alone updates the plan.
const v18 = [
  ['Settings are preferences, and the model decides.', 'Goal, sessions a week, minutes, supersets and exercises to skip go to the model as what you would like, with the conversation and your workouts. It is told that it is the coach: it weighs them, draws its own conclusions from what you say and from your records, builds the training, and says so when it departs from a setting.'],
  ['The app takes the model\'s plan as it comes.', 'Its sessions a week (read from its own rest days), the supersets it marks itself (before, the app paired by rule), and a session up to a tenth over your minutes all stand. Two things stay fixed: only exercises your gym allows, and none you asked to avoid. The check that a new plan does not open with the session you just trained stays as a safety net.'],
  ['The chat alone updates the plan.', 'Say what you want and it happens, with no button: single changes are made at once with an Undo, and anything the plan is built on (days, minutes, goal, supersets) or a request for a new plan rebuilds it at once. The old plan is kept and can be put back. Only the very first plan waits for a tap.'],
  ['Without a model.', 'The built-in coach does the same from the chat for the things it understands, and the training rules follow the settings to the letter.'],
];

// Version 1.7: supersets as a mode the plan is built for.
const v17 = [
  ['Supersets are a mode now, and are called that.', 'What the app called pairs is now "Supersets": two exercises that use different muscles, done in turns. It is for people who would rather do a set of something else than sit through a rest, and it also makes sessions shorter.'],
  ['The plan is built for them.', 'With supersets on, the week is split into sessions that hold opposite muscle groups (upper and lower days, not push-only and pull-only ones, where hardly anything has a partner), and each exercise is put next to a partner where the training allows. In the rule-based plans for five and six days a week, the share of exercises with a partner goes from about four in ten to about seven in ten, for about the same weekly sets. The model gets the same instruction (rule PAR-3).'],
  ['The training still comes first.', 'Compound lifts stay before single-joint work. Squats, hip hinges and the main lifts of a strength plan keep their full rest and are never part of a superset, and two exercises that share a muscle are never put together.'],
  ['Where to turn it on.', 'On the Plan tab, in Settings, and on the summary the coach shows before it builds a plan. Or say it: "I like supersets", "I hate sitting around between sets". A plan made before the mode was on only gets supersets where two fitting exercises happen to meet; the Plan tab says so and offers to build one made for them.'],
];

// Version 1.6: how each exercise has gone, and the pairs switch where it is looked for.
const v16 = [
  ['Earlier results in the exercise box (replaced in 1.9 by progress steps).', 'In a session\'s preview and in the workout, each exercise lists the last three times it was done: the day, the load and reps of each set, and how it moved on from the time before ("+2 kg", "+1 rep", "same"). It is small print under the rest of the box. "Show all" opens the whole list; an exercise never done shows nothing.'],
  ['The pairs switch is always there.', '"Pair exercises to save time" used to be hidden on the Plan tab when the plan had nothing to pair. It now always shows there, and it is in Settings too, under "Your plan". For a plan built around pairs, switch it on and ask the coach for a new plan.'],
];

// Version 1.5: a new plan that starts in the right place, with its weights; a short chat; updates that arrive.
const v15 = [
  ['Why 1.4 seemed to change nothing.', 'The app starts from its offline copy and fetches a new release in the background, so one refresh after a release still ran the old code. The app now reloads once by itself when the new version is ready (never under a workout, an answer or typed text), fetches releases past the browser\'s own cache, and shows the version it is running at the bottom of the Plan tab.'],
  ['A new plan starts where the cycle stands.', 'The app works out which session comes next from the workouts on record: the one after the session trained last, skipping any that would repeat it. The model is told this outright (what was trained last, what follows it, which muscle groups have waited longest) and instructed to open with that. The app then checks the answer and turns the list if it still opens with a repeat.'],
  ['Weights are not lost in a new plan.', 'Weights are gathered from the saved list, the plan and the last load lifted in any recorded workout, and all of them go into a new plan. Holes in saved data are repaired when the app loads. The model is told to keep the exercises you are doing and not to swap one for variety, since a new exercise starts with no weight. One that really is new is named in the coach\'s message.'],
  ['The coach screen stays short.', 'It shows the conversation in progress: the last four messages at most, back to the last long pause, with one "Open my plan" button and one summary card. "Show earlier messages" brings back the rest above them; "Clear chat" empties it and leaves the plan and the workouts alone.'],
];

// Version 1.4: the coach and the workouts on record.
const v14 = [
  ['What went wrong.', 'Asking the coach to regenerate the plan sent it the profile and the gym, but none of the workouts. So it built the same plan again from the top, and its first session was the one just trained. And when the model answered such a request in words only, nothing was built at all, whatever the chat said.'],
  ['The coach now gets the records.', 'Every chat message and every request for a plan goes out with today\'s date, the last workouts exercise by exercise (planned and done), the hours since each muscle group was trained, other activities, the plan as it stands and what is next on it.'],
  ['Asking for a new plan builds one.', 'Said in words, it is built at once. The coach first says what it will take into account, then the plan appears, in the chat and on the Plan tab. If the model sends a whole plan in a chat answer, that plan is used, so the chat and the plan cannot disagree.'],
  ['A new plan carries on.', 'It starts with a session whose muscles the last workout left alone, the next one in the cycle, and keeps the weights and the reps already reached. A model is told to do this; if its plan still opens with a repeat of the last workout, the app turns the list. Without a model the training rules do the same.'],
  ['The Plan tab shows it.', 'After a rebuild it says when the plan was rebuilt, by whom, and which session is next and why.'],
  ['A way back.', '"Put the old plan back", in the chat and on the Plan tab, undoes a rebuild with its list of changes, until a workout is done on the new plan.'],
];

// Version 1.3: notes from the gym.
const v13 = [
  ['Weights before the workout.', 'When the session you start has exercises with no weight yet, the app offers to go through them one by one first. Each can be filled in, with its step, or skipped; skipped ones are asked for when they come up, as before.'],
  ['Two muscle groups in turns: is it a good idea?', 'Yes, for saving time, with limits. A 2025 review of 19 studies found that pairing exercises shortens the session without cutting the work done, and that strength and muscle gains over weeks were no different from doing one exercise at a time. The price: the sets feel harder. Pairs of opposite muscles even allowed more reps; pairs that share a muscle cost reps.'],
  ['Pairs, as a switch on the Plan tab.', 'Off unless you turn it on. Two neighbouring exercises that use different muscles are done in turns, with a short rest after each set (45% of the longer planned rest, at least 30 s), so each muscle still gets its planned rest. Squats, hip hinges and the main lifts of a strength plan are never paired. The switch says how many minutes it saves; a plan built with pairs on uses that time for work that would otherwise be left out. "Machine busy?" splits a pair for the day.'],
  ['"Train" or "Push" when the time comes.', 'The rest countdown no longer just disappears. When the rest is over, and while a set runs, its place shows what to do: "Train", or "Push" on the last set of an exercise, the one that goes past its target.'],
  ['The timer does not scroll away.', 'The countdown and that word sit in the top bar of the workout, which stays put while the page scrolls.'],
  ['The step field takes a 1.', 'Typing a step size under "Other" used to wipe a 1 (and a 2, 5 or 10) as it was typed, because those are also the preset sizes. So 1, 1.25, 12.5 or 15 could not be entered. Fixed, and the field is ready to type in as soon as "Other" is tapped.'],
  ['The model reviews the workout, and you see it.', 'With a model connected and the phone online, the end of a workout shows "Claude is thinking" and the plan changes when it answers. The training rules step in only when it cannot be reached. With no connection they update the plan and the plan says it will be updated when online; that review is then asked for by itself. If the model fails for another reason the screen now says why, and "Ask again" tries once more.'],
];

// Version 1.2: optional extras.
const v12 = [
  ['Extras listed with every session.', 'Each session has up to two optional exercises for the end, 2 sets each, outside the session time. Open a session to see them; the next session on the plan names them too.'],
  ['Picked to make sense for the plan.', 'A new rule (OPT-1) picks them: first what was left out of that session for time, then a muscle group short of its weekly sets, then a small muscle group with no direct work, then more single-joint work. Always in the part of the body the session already trains, so the next session finds its muscles fresh. Each one shows its reason.'],
  ['Offered when the planned sets are done.', 'The workout stays open on one more step: "Do it" brings an extra up as the next exercise, "Finish workout" ends without them. An extra can also be added earlier from the workout overview; it waits at the end.'],
  ['Done or left, both are fine.', 'An extra that is done is saved, named in the summary, and moves on in the plan like any other exercise. One that is left, or added and not started, leaves no trace and is never counted as a miss.'],
  ['Nothing to rebuild.', 'A plan saved before this version gets its extras the next time the app starts. When equipment goes, an extra that needed it gives way to another. A connected model picks the extras itself when it builds a plan, and the app checks them.'],
];

const changes = [
  ['A plan that moves, not a weekly calendar.', 'The plan is a running list: train this, rest so many days, train that. The coach proposes it, you can discuss it, and it is updated after every workout. When the list runs out the next run is planned, by the connected model from your results or by repeating the run with its exercises taking turns.'],
  ['One "Train now" button.', 'On the planned day it starts the next session. On any other day it shows what makes sense today, why, and how the rest of the plan follows; the model reviews the pick when connected. You can pick or skip any session.'],
  ['A sketch of the equipment.', 'Each kind of equipment has a line sketch of its general look, shown when an exercise comes up, in the session preview and on the equipment list. It follows what is saved about your machine, such as plates instead of a weight stack. Makers\' photos are not used: the app has no way to fetch the right one, and they are the makers\' own.'],
  ['Describe your gym in your own words.', 'Type, paste or dictate what the gym has; it is read and saved in one go.'],
  ['Machines by maker.', 'Name the maker and the exact machines are identified, with how each works and what it isolates saved for the coach, and a label saying whether that was found on the web or comes from memory.'],
  ['OpenAI as well as Claude.', 'Choose either in Settings on the stand-alone app. Same prompt, rules and checks.'],
  ['Clearer limit messages.', 'When a provider turns a request down, the app shows the provider\'s own words and what to check.'],
];

const bugs = [
  ['Finishing a workout opened the plan, not the summary.', 'Two redirects ran at once and the wrong one won. Now only one place decides.'],
  ['The rest timer could show one second too many right after saving.', 'The screen used a slightly old clock reading. It now reads the time fresh.'],
  ['The page could stay on "Loading" inside claude.ai.', 'If the cloud answered before the screen was listening, the signal was missed. The screen now checks again right after it starts listening.'],
  ['A new phone could overwrite the cloud copy with an empty plan.', 'Found while reading the sync code, not by a test. The app now waits for the cloud copy before letting you change anything, and an empty device never replaces a cloud copy that has a plan. Tests added.'],
  ['The newest chat message hid behind the text box.', 'The chat now scrolls the whole page so the last message clears the box.'],
];

const limits = [
  ['No real call to Claude or OpenAI was made.', 'There is no API key for either on this machine. Both paths were run with the official SDKs against local stand-ins, and each request was checked field by field. The first real call could still be turned down by an API for a reason a stand-in cannot show.'],
  ['The model\'s planning has only met stand-ins.', 'Reviewing what to train today, reordering the plan after a workout and planning the next run were all tested with canned answers. The app checks whatever a model sends against its own list, but how sensible a real model\'s choices are is untested.'],
  ['The web lookup of machines has only met stand-ins.', 'The search tools, the paused-search case and the source check all ran against fake search results. With a real key the lookup also depends on web search being allowed for that key, and on what the search finds. How good the descriptions of real machines are is untested.'],
  ['The live claude.ai page was not opened by me.', 'It is published, and I wrote, read back and deleted a test record in its cloud storage. But I could not open it in a signed-in browser from here, so the real permission prompts for Claude and for dictation are untested. The page logic was tested against a stand-in written from the runtime\'s published type definitions.'],
  ['No real Android phone.', 'Everything, the live site included, ran in desktop Chrome with a Pixel 7 screen profile. Chrome reports nothing that blocks installing, but the actual "Add to Home screen" tap, vibration, the screen staying on, and Chrome\'s own speech recognition can only be tried on a phone.'],
  ['The signal with the screen off is untested.', 'It relies on a notification sent by a page the phone may have put to sleep. The app does what a web page can to stay awake during a rest and schedules the beep ahead, but whether your phone buzzes depends on Chrome and on the phone\'s notification settings. Inside claude.ai there is no such signal at all.'],
];

const page = `<title>Seria build report</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: one reading column; screenshots in a scrolling strip of phones. */
:root {
  --bg: #f5f6f1; --panel: #ffffff; --ink: #171b16; --muted: #586355; --line: #d6dccf;
  --accent: #3f5e00; --accent-bg: #d0fa77; --on-accent: #18200e; --warn: #8a5a00; --warn-bg: #fff2cf;
  --font: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111411; --panel: #1a1f1a; --ink: #f3f6ed; --muted: #b0bbab; --line: #343d33;
  --accent: #d0fa77; --accent-bg: #d0fa77; --on-accent: #18200e; --warn: #f2c66d; --warn-bg: #2b2616; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #111411; --panel: #1a1f1a; --ink: #f3f6ed; --muted: #b0bbab; --line: #343d33;
  --accent: #d0fa77; --accent-bg: #d0fa77; --on-accent: #18200e; --warn: #f2c66d; --warn-bg: #2b2616; color-scheme: dark }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.55 var(--font); }
.wrap { max-width: 860px; margin: 0 auto; padding-block: 44px 72px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 44px; }
h1, h2, h3, p, ul, ol, figure { margin: 0; }
h1 { font-size: clamp(38px, 8vw, 64px); line-height: 1; letter-spacing: -.06em; text-wrap: balance; }
h1 i { color: var(--accent); font-style: normal; }
h2 { font-size: 26px; line-height: 1.15; letter-spacing: -.035em; text-wrap: balance; }
h3 { font-size: 17px; letter-spacing: -.01em; }
.eyebrow { color: var(--accent); font-size: 12px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.lead { font-size: 19px; max-width: 62ch; }
p, li { max-width: 68ch; }
.muted { color: var(--muted); }
section { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
a { color: var(--accent); font-weight: 650; overflow-wrap: anywhere; }
code { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }
.nums { display: flex; flex-wrap: wrap; gap: 14px 34px; }
.nums div { min-width: 0; }
.nums strong { display: block; font-size: 40px; line-height: 1.1; letter-spacing: -.05em; font-variant-numeric: tabular-nums; }
.nums span { color: var(--muted); font-size: 14px; }
.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.card ul { padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.pill { display: inline-block; font-size: 12px; font-weight: 750; letter-spacing: .04em; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.pill.done { background: var(--accent-bg); color: var(--on-accent); }
.pill.mostly { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn); }
.rows { display: flex; flex-direction: column; }
.rowx { display: grid; grid-template-columns: minmax(0, 5fr) 74px minmax(0, 6fr); gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
.rowx.head { border-top: 0; color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; padding-bottom: 6px; }
.strip { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 10px; scroll-snap-type: x proximity; }
.strip figure { flex: 0 0 232px; scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; }
.strip img { width: 232px; height: auto; display: block; border-radius: 18px; border: 1px solid var(--line); background: #111411; }
.strip figcaption { font-size: 13px; color: var(--muted); }
.moves { display: grid; gap: 10px; }
.moves img { width: 100%; height: auto; display: block; border-radius: 12px; border: 1px solid var(--line); }
.strip figcaption b { display: block; color: var(--ink); font-size: 14px; }
.pair { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px; }
.pair b { font-weight: 650; }
details { border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; background: var(--panel); }
summary { cursor: pointer; font-weight: 650; }
details ul { padding-left: 18px; margin-top: 8px; font-size: 14px; color: var(--muted); display: flex; flex-direction: column; gap: 2px; }
.tick { color: var(--accent); font-weight: 800; }
.bar { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--accent); }
ol.steps { padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
@media (max-width: 640px) {
  .two { grid-template-columns: 1fr; }
  .rowx { grid-template-columns: 1fr; gap: 6px; } .rowx.head { display: none; }
  .pair { grid-template-columns: 1fr; gap: 4px; }
}
</style>
<div class="wrap">
  <header style="display:flex;flex-direction:column;gap:14px">
    <p class="eyebrow">Build report · ${new Date(smoke.ranAt).toISOString().slice(0, 10)}</p>
    <h1>Seria<i>.</i> is built and tested</h1>
    <p class="lead">The design file is now a working app in English. It builds a training plan from a conversation, guides each set with a rest timer, keeps a history, and keeps the plan up to date as you train. It runs in the phone's browser and goes on the home screen. No developer mode, no app to install by hand. Both ways of running it are live.</p>
    <div class="nums">
      <div><strong>${smoke.passed} / ${smoke.total}</strong><span>end-to-end checks passed</span></div>
      <div><strong>${unit.pass} / ${unit.pass + unit.fail}</strong><span>unit tests passed</span></div>
      ${live ? `<div><strong>${live.passed} / ${live.total}</strong><span>checks passed on the live site</span></div>` : ''}
      <div><strong>${spec.filter((s) => s[1] === 'done').length} / ${spec.length}</strong><span>spec items done as designed; ${spec.filter((s) => s[1] === 'changed').length} changed at your request</span></div>
    </div>
  </header>

  <section>
    <p class="eyebrow">Start here</p>
    <h2>Two ways to put it on your Android phone</h2>
    <div class="two">
      <div class="card">
        <h3>1. The claude.ai page. Works now.</h3>
        <p>Open <a href="${APP_URL}">${APP_URL.replace('https://', '')}</a> in Chrome on the phone, signed in to claude.ai. Then the ⋮ menu, "Add to Home screen".</p>
        <ul>
          <li>Plan and history are saved to your private cloud space.</li>
          <li>Claude is built in. No API key. It asks your permission once and uses your Claude plan.</li>
          <li>Voice input through claude.ai dictation.</li>
          <li>Needs a connection to open. Only you can open the link.</li>
        </ul>
      </div>
      <div class="card">
        <h3>2. The stand-alone app. Live.</h3>
        <p>Open <a href="${LIVE_URL}">${LIVE_URL.replace('https://', '')}</a> in Chrome on the phone. Then the ⋮ menu, "Add to Home screen" or "Install app".</p>
        <ul>
          <li>Opens full screen and starts with no signal.</li>
          <li>Data stays in the phone's browser. Backup file in Settings.</li>
          <li>Use Claude or OpenAI with your own API key, pasted in Settings. Without one, the built-in coach and the rules do the job.</li>
          <li>Served by GitHub Pages from <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>. The repository is public, because the free plan only hosts Pages from public repositories.</li>
        </ul>
      </div>
    </div>
  </section>

  <section>
    <p class="eyebrow">Screens</p>
    <h2>What it looks like</h2>
    <p class="muted">Taken by the smoke test in headless Chrome with a Pixel 7 screen profile. Colours and type come from the design file. Scroll sideways.</p>
    <div class="strip">
      ${shots.map(([f, t, c]) => `<figure><img src="shots/${f}.png" alt="${esc(t)} screen" loading="lazy" width="412" height="839"><figcaption><b>${esc(t)}</b>${esc(c)}</figcaption></figure>`).join('\n      ')}
    </div>
  </section>

  <section>
    <p class="eyebrow">Against the spec</p>
    <h2>What the design asked for and what the app does</h2>
    <div class="rows">
      <div class="rowx head"><span>The design says</span><span>Status</span><span>The app does</span></div>
      ${spec.map(([a, s, b]) => `<div class="rowx"><span>${esc(a)}</span><span><span class="pill ${s === 'changed' ? 'mostly' : s}">${s === 'done' ? 'Done' : s === 'changed' ? 'Changed' : 'Mostly'}</span></span><span class="muted">${esc(b)}</span></div>`).join('\n      ')}
    </div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.10</p>
    <h2>Nothing earned is lost, the whole plan after every workout, and every exercise in motion</h2>
    <div>${v110.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
    <p class="muted" style="margin-top:14px">Every move, at the start and at the end of a rep. In the app they move.</p>
    <div class="moves">${moveSheets.map((f) => `<img src="shots/${f}" alt="Drawings of exercise moves, start and end of each" loading="lazy">`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.9</p>
    <h2>Progress as steps, and a button to rebuild</h2>
    <div>${v19.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.8</p>
    <h2>Your settings are preferences, the model decides, and the chat alone updates the plan</h2>
    <div>${v18.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.7</p>
    <h2>Supersets: a mode the plan is built for</h2>
    <div>${v17.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.6</p>
    <h2>How each exercise has gone, and the pairs switch where you look for it</h2>
    <div>${v16.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.5</p>
    <h2>A new plan that starts in the right place, a short chat, updates that arrive</h2>
    <div>${v15.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.4</p>
    <h2>The coach knows your workouts, and a new plan carries on from them</h2>
    <div>${v14.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.3</p>
    <h2>Your notes from the gym, built</h2>
    <div>${v13.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.2</p>
    <h2>Optional extras for the end of a session</h2>
    <div>${v12.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">New in version 1.1</p>
    <h2>Your notes from the first workouts, built</h2>
    <div>${v11.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">Changed before that</p>
    <h2>What you asked for along the way</h2>
    <div>${changes.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">AI coach</p>
    <h2>How Claude and OpenAI are hooked up</h2>
    <p>A model reads what you tell the coach, builds the week, and reviews results during and after a workout. Claude and OpenAI get the same prompt, the same rules and the same answer format, and their answers go through the same checks.</p>
    <div class="two">
      <div class="card"><h3>Inside claude.ai</h3><p class="muted">The page asks the viewer's own Claude. Nothing to set up. OpenAI cannot be reached from there.</p></div>
      <div class="card"><h3>Stand-alone app, Claude</h3><p class="muted">The official Anthropic SDK, called from the browser with your key. Default <code>claude-opus-5-5</code>; Sonnet 5.5, Haiku 5.5 and Fable 5.2 can be picked.</p></div>
      <div class="card"><h3>Stand-alone app, OpenAI</h3><p class="muted">The official OpenAI SDK and its Responses API, with your key. Default <code>gpt-6.1-sol</code>; Astra, Terra and Luna are listed and any model id can be typed in.</p></div>
      <div class="card"><h3>No model at all</h3><p class="muted">A built-in coach asks the same questions, the plan comes from the training rules, and a built-in reader handles gym descriptions.</p></div>
    </div>
    <ul style="padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li>One prompt for every job. It carries the whole rules library, so the model and the built-in generator work from the same rules.</li>
      <li>Answers come back in a fixed JSON shape. The app then checks them against its own records: unknown exercises are dropped, numbers are clamped, and the "previous value" shown to you always comes from the app.</li>
      <li>Naming a maker makes the model identify the exact machines. With an API key it then looks each one up with the provider's own web search, and a result is only marked "found" when its source address is one the search really returned. Otherwise it is marked "from the model's memory, not checked".</li>
      <li>On Claude, refusal fallback is switched on: if its safety filters decline a request, the API retries on another model by itself. On OpenAI, conversations are not stored on their side.</li>
      <li>The model is never in the way. Saving a set does not wait for it. If it is off, slow or failing, the training rules carry on: they update the plan after the workout and change the sets to come during it.</li>
      <li>Each key stays in that browser, goes only to its own provider, and is left out of backups. Set a spend limit on it.</li>
    </ul>
  </section>

  <section>
    <p class="eyebrow">Smoke test</p>
    <h2>${smoke.passed} of ${smoke.total} end-to-end checks pass</h2>
    <p class="muted">Run with <code>npm run smoke</code>. Real app, real Chrome (headless), phone-sized screen, no network and no real API key. Last run ${new Date(smoke.ranAt).toISOString().replace('T', ' ').slice(0, 16)} UTC.</p>
    <div class="bar" role="img" aria-label="${smoke.passed} of ${smoke.total} checks passed"><i style="width:${(smoke.passed / smoke.total) * 100}%"></i></div>
    ${parts.map((p) => {
    const rs = smoke.results.filter((r) => r.part === p);
    const ok = rs.filter((r) => r.ok).length;
    const [title, text] = PART_TEXT[p] || [p, ''];
    return `<details><summary>${esc(title)}: ${ok} of ${rs.length}</summary><p class="muted" style="margin-top:8px;font-size:14px">${esc(text)}</p><ul>${rs.map((r) => `<li><span class="tick">${r.ok ? '✓' : '✗'}</span> ${esc(r.name)}${r.ok ? '' : ` <b>(${esc(r.detail)})</b>`}</li>`).join('')}</ul></details>`;
  }).join('\n    ')}
    ${live ? `<details><summary>The live site: ${live.passed} of ${live.total}</summary><p class="muted" style="margin-top:8px;font-size:14px">Run against ${esc(live.url)} with <code>npm run check:live</code>, ${new Date(live.ranAt).toISOString().replace('T', ' ').slice(0, 16)} UTC. Real network, then the network switched off.</p><ul>${live.results.map((r) => `<li><span class="tick">${r.ok ? '✓' : '✗'}</span> ${esc(r.name)}${r.ok ? '' : ` <b>(${esc(r.detail)})</b>`}</li>`).join('')}</ul></details>` : ''}
    <p class="muted">Plus ${unit.pass} unit tests (<code>npm test</code>) for the rules, the plan generator, the workout steps, the suggestions, the text reader, the request format and the cloud merge.</p>
  </section>

  <section>
    <p class="eyebrow">Found and fixed</p>
    <h2>Bugs caught along the way</h2>
    <div>${bugs.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">Read this part</p>
    <h2>What I could not test</h2>
    <div>${limits.map(([a, b]) => `<div class="pair"><b>${esc(a)}</b><span class="muted">${esc(b)}</span></div>`).join('')}</div>
  </section>

  <section>
    <p class="eyebrow">Choices</p>
    <h2>Decisions I made where the design was silent</h2>
    <ul style="padding-left:18px;display:flex;flex-direction:column;gap:6px">
      <li><b>The plan updates itself, and every change can be taken back.</b> Weights, reps, order and rest days change without asking, as you asked. Undo puts back exactly what a change replaced, and only where the value has not been changed again since.</li>
      <li><b>The rules answer first, the model second.</b> After a workout the training rules update the plan at once. The model's review then replaces theirs, unless you have already undone or corrected something; then your choices stand and only its summary is added.</li>
      <li><b>Only the latest workout is worked out again.</b> Correcting an older workout fixes the record but leaves the plan, which has moved on since.</li>
      <li><b>An activity is not a workout.</b> A run counts toward recovery for the muscles it uses, but it does not move the day your next session is due.</li>
      <li><b>Equipment swaps happen when you leave the Equipment tab,</b> not on every toggle, so trying a switch on and off does not reshuffle the plan. A swap you undo is not forced back in.</li>
      <li><b>"Train now" only stops to ask on an unplanned day.</b> On the day the next session is due it starts at once. Earlier or later, it shows what makes sense and why first.</li>
      <li><b>It works without a model.</b> A built-in coach asks the same questions and the plan comes from the rules. Claude or OpenAI makes it better; neither is required.</li>
      <li><b>Machine facts must show where they come from.</b> Every identified machine is labelled: found on a named site, from the model's memory, or maker noted only. A web address the search did not return is thrown away.</li>
      <li><b>OpenAI default is <code>gpt-6.1-sol</code>,</b> the near-top model at about a fifth of the top price. OpenAI's own "start here" pick is GPT-6 Astra; it is one tap away in Settings.</li>
      <li><b>The phone's copy is the working copy.</b> The cloud copy inside claude.ai is a mirror that is written a moment later, so the gym's bad signal never blocks a tap.</li>
      <li><b>Kilograms only.</b></li>
      <li><b>Limitations are handled carefully.</b> "My knee hurts" leaves out squats, lunges, leg press and leg extensions, and the app tells you so you can add things back. It is not medical advice and says so.</li>
      <li><b>Research and app choices are labelled apart.</b> All ${Object.values(SOURCES).filter((s) => s.url).length} journal references were checked against their DOI records. Numbers that are my own practical choices, such as the 5% and 10% load drops, are marked "App convention" in the rules.</li>
      <li><b>One day off is not a trend.</b> A single short session changes nothing. Two in a row at the same weight proposes a 10% step back.</li>
    </ul>
  </section>

  <section>
    <p class="eyebrow">Next</p>
    <h2>What to do now</h2>
    <ol class="steps">
      <li>Open the claude.ai page on your phone and add it to the home screen. Tell the coach how you want to train.</li>
      <li>Do one real workout. That is the test I could not run: a real phone, real Claude, a real gym.</li>
      <li>In Settings, turn on "Signal with the screen off" (stand-alone app), tap "Test the signal" and lock the phone. Tell me whether it buzzed: that part is untested.</li>
      <li>Or use the stand-alone app at <a href="${LIVE_URL}">${LIVE_URL.replace('https://', '')}</a> if you want it to work with no signal. The two copies do not share data; a backup file moves it across.</li>
      <li>For a model on the stand-alone app, create an Anthropic or OpenAI API key with a spend limit, choose the provider in Settings, paste the key and tap "Test the connection". That will be the first real call.</li>
      <li>Then describe your gym with the maker named and check a few "found on the web" machines against the real ones. That is the first real test of the lookup.</li>
    </ol>
    <p class="muted">Code: <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>, also in <code>~/seria</code>. Start with <code>README.md</code>. The rules are in <code>docs/training-rules.md</code>. A push to <code>main</code> runs the unit tests and republishes the app.</p>
  </section>
</div>
`;

writeFileSync(`${root}report/report.html`, page);
console.log(`report/report.html  ${Math.round(page.length / 1024)} KB, ${shots.length} screenshots, unit ${unit.pass}/${unit.pass + unit.fail}, smoke ${smoke.passed}/${smoke.total}`);
