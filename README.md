# Seria

A gym training app that runs in the phone's browser. You tell the coach how you want to train. Seria builds a plan around your goal, your time and your gym's equipment, walks you through every set with a rest timer, keeps a history, and keeps the plan up to date as you go.

Built from the design in `seria-design.html`. The app is in English.

## Run it on an Android phone

No developer mode and no app to install by hand. Pick one:

**1. The claude.ai page (works now).**
Open <https://claude.ai/artifact/BGZFQ5nHaNbfV9Qvgw13Ui> in Chrome on the phone while signed in to claude.ai. Then ⋮ menu, "Add to Home screen". On this page:

- your plan and history are saved to your private cloud space for the page, so they follow you to another device,
- Claude is built in, with no API key. It asks your permission the first time and uses your own Claude plan,
- voice input uses claude.ai dictation.

The page is private to its owner. It needs a connection to open.

**2. The stand-alone app (installable, works offline).**
Open <https://dglowinski.github.io/seria/> in Chrome on the phone. Then ⋮ menu, "Add to Home screen" or "Install app". This copy:

- opens full screen like an app and starts with no signal,
- keeps data in the phone's browser. Use Settings, "Save a backup file" now and then,
- uses Claude or OpenAI with your own API key, pasted in Settings. Without a key the built-in coach and the training rules do the job.

**New versions load by themselves.** The app starts from its offline copy, fetches a new release in the background, and then reloads once to run it, unless a workout is on, the coach is answering or you are typing; then it waits for the next quiet moment. The version that is running is shown at the bottom of the Plan tab and in Settings.

It is served by GitHub Pages from this repository. Every push to `main` runs the unit tests and then publishes the app files (`.github/workflows/pages.yml`). Tests, scripts and the report are not published. The folder has no build step, so any other static HTTPS host works too.

## How the plan works

The plan is a running list, not a calendar: train this, rest a day, train that, rest two days, and so on. There are no fixed weekdays and nothing to manage.

- **The coach proposes it and you can discuss it.** It is laid out a couple of weeks ahead. The main lifts come back every week so they can progress; the smaller exercises take turns, so what did not fit one week is trained the next.
- **One button: "Train now".** On the day the next session is planned for, it just starts. On any other day it first shows what makes sense today and why (for example a session that lets yesterday's muscles rest), and how the rest of the plan follows. Starting accepts that update. You can also pick any session yourself, or skip one.
- **It moves as you train.** After each workout the plan is updated for you: weights, reps, the order of what is left and the rest days. Nothing waits to be accepted. You get a summary in words and a list of what changed and why, and you can undo any change or correct its number ("What changed" on the Plan tab).
- **A full cycle is always on show.** A session you finish moves to the end of the list, with its numbers already updated, so you see when it comes round again.
- **Your settings are preferences; the coach decides.** Goal, sessions a week, minutes, supersets, exercises to skip: with a model connected these go to it as what you would like, together with the conversation and your workouts. The model weighs them, draws its own conclusions and builds the training, and says so when it departs from a setting. The app takes its plan as it comes: its number of sessions a week, the supersets it chose, a session a few minutes over your time. Only two things are fixed: it can use only the exercises your gym allows, and never one you asked to avoid. Without a model the training rules follow the settings to the letter.
- **The chat alone updates the plan.** Tell the coach what you want ("make it four days", "I like supersets", "regenerate my plan", "swap the lunges") and the plan changes at once, with no button to press. Single changes show with an Undo; a rebuilt plan keeps the old one, and "Put the old plan back" returns it. Only the very first plan waits for a tap, on the summary of what it is built on.
- **A button for it, too.** "Rebuild plan" on the Plan tab and on the Coach tab builds a new plan at once from your settings, your workouts and what you told the coach, and lands in the chat, where the way back is.
- **The coach knows what you have done.** With a model connected, every message in the chat goes out with today's date, your last workouts set by set, how long each muscle group has rested, and what the plan has next. So you can ask about your training, and what it changes is judged against your records.
- **A new plan carries on, it does not start over.** Ask the coach for a new plan and it is built at once, from your workouts as well as your profile. It starts where the cycle stands: with the session that follows the one you trained last, never with that one again and never with one that trains the same muscles. The model is told this outright, and the app checks its answer and turns the list if needed. The new plan keeps the exercises you are doing, every weight on record and the reps you have reached; an exercise that really is new is named, so a missing weight is never a surprise. The plan screen says that it was rebuilt and what is next. "Put the old plan back" undoes the rebuild until you train on the new plan.
- **The coach screen stays short.** It shows the conversation in progress: the last few messages, back to the last long pause. "Show earlier messages" brings back the rest, and "Clear chat" empties it without touching the plan or the workouts.
- **When the list runs out, the next run is planned.** The connected model plans it from your results so far. Without a model the same run starts again, with its exercises taking turns.
- **After ten days away,** the first session back is 10% lighter. The plan keeps its numbers.

- **Other activity counts.** "Did something else?" on the Plan tab logs a run, a ride, a game: what it was, how long, how hard. About 30 minutes at a moderate effort counts as work for the muscles it uses, so leg sessions wait 48 hours after a hard run. Short, easy activity changes nothing. It shows in History next to the workouts.
- **Optional extras.** Each session lists up to two extra exercises for a day when you have more in you. They are picked to fit the session and the plan: first what was left out of that session for time, then a muscle group that is short of its weekly sets, then a small muscle group with no direct work, always in the part of the body the session already trains. They are not counted in the session time. Open a session to see them, each with its reason.
- **The long view.** The Plan tab has a part called "The long view": how the training is meant to develop, in words. What this round holds, how it gets harder, what changes from one round to the next, what happens when it stalls, and what would be added with more time. A connected model adds its own reading when it builds the plan.

- **How each exercise has progressed.** Every exercise box, in a session's preview and in the workout, lists its last three steps in small print: the day, and what moved ("+1 rep, 8 → 9 reps", "+2 kg, 20 → 22 kg, reps 10 → 8"). A step is any time the target changed from one workout to the next, up or down, and each is dated by the workout that earned it. "Show all" opens the rest. An exercise whose target has not moved shows nothing.

- **Supersets, for less sitting around.** Off unless you switch them on: "Supersets" on the Plan tab, in Settings, or on the summary the coach shows before it builds a plan. You can also just tell the coach ("I like supersets", "I hate sitting around between sets"). A superset here is two neighbouring exercises that use different muscles, done in turns: a set of one, a short rest, a set of the other. One rests while the other works, so there is little waiting and the session is shorter for the same sets. It is a mode the plan is built for, not just a switch: with it on, the week is split into sessions that hold opposite muscle groups (upper and lower days, not push-only and pull-only ones), and each exercise is put next to a partner where the training allows: a press with a row, biceps with triceps, leg extension with leg curl. The training still comes first: squats, hip hinges and the main lifts of a strength plan keep their full rest and are never paired. A plan made before the mode was on only gets supersets where two fitting exercises happen to meet, and the Plan tab then offers to build one made for them. The research behind it (same strength and muscle gains in less time, but the sets feel harder) is cited in rules PAR-1 to PAR-3. You need both stations free; in the workout, "Machine busy?" splits a superset for the day.

The rules behind this are in `js/domain/schedule.js` and in the "A plan that moves" and "Training on any day" parts of `docs/training-rules.md`. Where a rebuilt plan starts is decided by `cycleNext()` and `continueFrom()` in `js/domain/schedule.js`. Weights are gathered by `knownWeights()` in `js/domain/planner.js`: the saved list first, then the plan, then the last load lifted in a recorded workout. Supersets are called pairs in the code: `weekSplit()` picks the week, `arrangeForPairs()` lays out a session and `pairUp()` marks the pairs, all in `js/domain/planner.js`. The optional extras are picked by `fillOptional()` in `js/domain/planner.js` (rule OPT-1); a plan saved before they existed gets them the next time the app starts.

## A workout, tap by tap

- **Weights first, if you like.** When the session you start has exercises with no weight yet, the app offers to go through them one by one before the workout. Each can be filled in or skipped; skipped ones are asked for when they come up.
- **The top of the screen does not scroll.** It holds the rest countdown. When the time is up, and while a set runs, it says what to do in its place: "Train", or "Push" on a set that goes past its target.
- **One tap per set.** "Start set", then "Finish set". The set is saved with the planned reps and the rest starts. While the set runs, or during the rest after it, −1 and +1 nudge the reps; you can also change the weight, say how many reps were left in the tank, or undo the finish.
- **The next set starts by itself** when the rest runs out, from that moment. If you were not ready, "Start now" resets its clock and "Not doing it yet" puts it down. You can turn this off in Settings.
- **What to aim for.** Each set says whether to stop at the target or push on: sets before the last stop with reps in reserve, the last set of an exercise may go past the target.
- **Machine busy? Not now.** Come back to the exercise later (it moves to the end of the workout), do another one instead (same movement first, then same muscles), or drop it for today.
- **The whole workout at a glance.** Tap "Exercise 2 of 5" at the top to see every exercise and jump to any that still has sets to do.
- **A missed set changes the sets to come at once,** with the reason and an Undo on screen.
- **Feel like a bit more?** When the planned sets are done, the workout offers the session's optional extras. "Do it" brings one up as the next exercise; "Finish workout" ends without them. You can also add one earlier from the workout overview, and it waits at the end. An extra you do is saved and moves on like any other exercise; one you leave is not a miss.
- **Everything is logged with its time:** when each set started and ended, how long rests really were, every nudge, undo, skip and swap, and when the screen went off. The summary compares your rests with the plan, and "Every step, with times" in History shows the log.
- **After the workout** you get a summary in words and the plan is updated. With a model connected and the phone online, the model does this: the summary shows "Claude is thinking" until it answers, and nothing changes before that. The training rules step in only when the model cannot be reached. With no connection they update the plan at once, the plan says "will be updated when you are online", and the model's review is asked for as soon as the phone is back online. If the model fails for another reason, the screen says why, the rules update the plan, and "Ask again" tries once more.
- **Correcting a workout later.** Fix a set in History and, if it is your latest workout, the plan is worked out again from the corrected numbers. Deleting the latest workout takes its changes back and puts its session on the list again.

### Signals when the rest ends

With the screen on, the phone beeps and buzzes. With the screen off a web page is not allowed to vibrate. The only way is a notification, and the phone decides how that buzzes. Turn on "Signal with the screen off" in Settings (stand-alone app only, best when added to the home screen), then use "Test the signal" with the phone locked. The beep is put on the audio clock when the rest starts, and a tone too quiet to hear keeps the page running during the rest, so the signal has the best chance of coming on time. This part could not be tried on a real phone while building.

## The weights you lift

"Weights" on the Plan tab (also on the Equipment tab) lists every exercise your equipment allows. Type what you lift now and the plan uses it from the first workout; anything left blank is asked for when the exercise first comes up. Each exercise has its own step, the smallest change the equipment allows: pick 1, 2, 2.5, 5 or 10, or type any number. In a session preview, "Change" next to a weight sets it by hand.

## Telling it what your gym has

On the Equipment tab, "Add to list" opens a box where you can name the machines or paste any text: a list, a sentence, notes from the gym's website. You can also dictate it. The text is read and the list is saved in one go, and you see what was added, what was marked as missing ("no barbell"), and what could not be placed. The connected model (Claude or OpenAI) does the reading; a built-in reader does it otherwise. You can still pick machines from the list or add your own by hand.

### Naming the maker

Say who makes the machines, as in "these are from Technogym: leg press, chest press", and the exact machines are identified. For each one the app saves the maker, the model, how the machine works, what it isolates and how it is loaded. The coach gets this with every request, on the equipment list and on each exercise done on that machine, and you see it on the Equipment tab, in the day preview and on the workout screen.

### What the equipment looks like

Every piece of equipment has a small line sketch of its general look: a leg press, a lat pulldown, a cable station and so on. You see it when an exercise comes up in a workout, next to each exercise in the session preview, on the equipment list and when swapping. The sketch follows what is saved about your machine: a plate-loaded one is drawn with plates instead of a weight stack, and a machine of your gym's own gets the drawing closest to it (the model picks it when it identifies the machine; otherwise it goes by what the machine trains).

These are sketches, not photos of your exact model. Makers' photos are not shown: without a server the app cannot fetch a maker's page to find the right picture, the claude.ai page blocks outside images, and the photos belong to the makers. For a machine found on the web, "Open the page" takes you to the maker's own picture. The drawings are in `js/ui/sketch.js`.

How sure the details are depends on the connection, and every machine is labelled:

| Connection | What happens | Label |
|---|---|---|
| Claude or OpenAI with your API key | The model names the product, then looks each one up with the provider's own web search. A result counts only if its source address is one the search really returned. | "Found on <site>", with a link |
| the same, when the search finds nothing or is not allowed for the key | The model's own description is kept. | "From the model's memory, not checked" |
| inside claude.ai | The model cannot search the web there, so it describes the machine from what it remembers. | "From the model's memory, not checked" |
| no model connected | The built-in reader notes the maker on each machine. Read the text again once a model is connected. | "Maker noted" |

Web search on the Claude API has to be switched on for your organisation in the Claude Console. If it is off, the lookup fails quietly and you get the "from memory" result.

## Run it on this computer

```
npm install          # only needed for tests and rebuilding vendor files
npm run serve        # http://127.0.0.1:4173
```

## Connecting an AI model

The coach can run on Claude or on OpenAI. Both get the same prompt, the same rules library and the same answer format, and the app checks their answers the same way.

| Where it runs | Model | How it is reached | What you do |
|---|---|---|---|
| claude.ai page | Claude | the viewer's own Claude | nothing, allow it when asked |
| stand-alone app | Claude | Anthropic API, official SDK, called from the browser | Settings, choose Claude, paste an Anthropic key, "Test the connection" |
| stand-alone app | OpenAI | OpenAI Responses API, official SDK, called from the browser | Settings, choose OpenAI, paste an OpenAI key, "Test the connection" |

Inside claude.ai the page can only reach Claude, so OpenAI is offered in the stand-alone app only.

Claude (`js/ai/claude.js`):

- Model: `claude-opus-5-5` by default. Sonnet 5.5, Haiku 5.5 and Fable 5.2 can be picked in Settings.
- Refusal fallback is on for the models that support it (`fallbacks: "default"`). If Claude's safety filters decline a request, the API retries it on another model by itself.

OpenAI (`js/ai/openai.js`):

- Model: `gpt-6.1-sol` by default. GPT-6 Astra, GPT-6.1 Terra and GPT-6 Luna are in the list, and any other model id can be typed in.
- Requests ask for low reasoning effort on quick mid-workout checks and medium otherwise. Older models that take no reasoning setting are sent none, and a model that turns the setting down is asked once more without it.
- `store: false`, so the conversation is not kept on OpenAI's side.

Both:

- One request shape for every job: the same system prompt (it contains the whole rules library), a JSON request, and a JSON answer forced by a strict schema.
- Each key lives only in this browser's storage, is sent only to its own provider, and is never part of a backup. Set a spend limit on it.
- Settings, Advanced lets you point the app at your own relay instead of the provider's address.

The model is never on the critical path. Saving a set and the rest timer work at once. If the model is off, slow or failing, the app carries on with the training rules: they update the plan after the workout and change the sets to come during it.

## Tests

```
npm test             # unit tests for the rules, planner, session logic, text readers, request formats, cloud merge
npm run smoke        # end-to-end checks in a phone-sized headless Chrome
npm run smoke:shots  # same, and saves screenshots to report/shots
npm run check:live   # checks the published app at its real address, including an offline start
```

The smoke test needs Google Chrome installed. It uses no real API key and no network: the models are played by local stand-ins for the Anthropic API (`tests/e2e/mock-anthropic.mjs`), the OpenAI API (`tests/e2e/mock-openai.mjs`) and the claude.ai runtime.

## How the code is laid out

```
index.html, manifest.webmanifest, sw.js   the installable page and its offline cache
css/app.css                               one stylesheet, colours and type from the design file
js/app.js                                 shell: top bar, tabs, start-up
js/store.js                               all app state, saved to the browser on every change
js/platform.js                            what the page can do where it runs: voice, sound, files
js/cloud.js                               cloud copy when inside claude.ai
js/domain/rules.js                        the training rules library, versioned, with sources
js/domain/catalog.js                      equipment and exercises
js/domain/planner.js                      builds the plan, estimates time
js/domain/schedule.js                     what to train today, the order and rests of what follows
js/domain/session.js                      the workout: ready, set, rest, next, summary, and its log
js/domain/progression.js                  reads results, makes changes to the plan, and can undo them
js/ai/prompts.js                          the prompt, the answer schema, the request data
js/ai/ai.js                               picks the provider, checks the answer
js/ai/claude.js                           the two ways to reach Claude
js/ai/openai.js                           OpenAI through its Responses API
js/ai/coach.js                            the conversation, with and without a model
js/ui/*.js                                the screens
js/ui/sketch.js                           line sketches of each kind of equipment
vendor/                                   Preact + htm, the Anthropic SDK and the OpenAI SDK, built by npm run vendor
docs/training-rules.md                    the rules as a document, generated from rules.js
scripts/                                  local server, icon, vendor, rules-doc and single-file builders
tests/                                    unit tests and the end-to-end smoke test
report/                                   the build report, test results and screenshots
```

## Changing things

- **Training rules:** edit `js/domain/rules.js`, bump `RULES_VERSION`, run `npm run rules-doc`. The generator, the changes made during and after a workout, and the prompt sent to the model all pick up the change.
- **Exercises and machines:** `js/domain/catalog.js`.
- **Releasing:** push to `main`. The deploy stamps the offline cache with the commit id, so installed phones pick up new files on the next start or the one after. On any other host, bump `VERSION` in `sw.js` yourself.
- **The claude.ai page:** `npm run build:artifact` packs everything into `dist/seria-artifact.html`. Publish that file as an update to the page address above, so the link and the saved data stay the same.
- **The report:** `npm run smoke:shots`, then `npm run report`, writes `report/report.html`. The published copy is at <https://claude.ai/artifact/GKCR9m4UWxaKrQw2wcNwU7>.

## Limits to know about

- Weights are in kilograms only.
- The claude.ai page and the stand-alone app do not share data. Move it with a backup file.
- Cloud sync is simple: the newest main record wins, workouts are merged one by one. It is meant for one person, mostly on one device at a time.
- With the screen off, the rest-over signal is a notification, and only in the stand-alone app. Whether the phone buzzes for it is up to the phone's notification settings, and it was not tried on a real phone. The countdown itself is always right, because it is stored as an end time.
- Undo works on the plan a change was made to. After the plan is rebuilt, older changes stay in the list as a record only.
- Not medical advice. The limitation handling is deliberately cautious and says what it left out.
