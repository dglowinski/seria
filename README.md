# Seria

A gym training app that runs in the phone's browser. You tell the coach how you want to train. Seria builds a week around your goal, your time and your gym's equipment, walks you through every set with a rest timer, keeps a history, and proposes changes for the next workouts.

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
- reaches Claude with your own Anthropic API key, pasted in Settings. Without a key the built-in coach and the training rules do the job.

It is served by GitHub Pages from this repository. Every push to `main` runs the unit tests and then publishes the app files (`.github/workflows/pages.yml`). Tests, scripts and the report are not published. The folder has no build step, so any other static HTTPS host works too.

## Run it on this computer

```
npm install          # only needed for tests and rebuilding vendor files
npm run serve        # http://127.0.0.1:4173
```

## Connecting Claude

| Where it runs | How Claude is reached | What you do |
|---|---|---|
| claude.ai page | the viewer's own Claude | nothing, allow it when asked |
| your own address | Anthropic API, official SDK, called from the browser | Settings, paste an API key, "Test the connection" |

Details for the API path (`js/ai/claude.js`):

- Model: `claude-opus-5-5` by default. Sonnet 5.5, Haiku 5.5 and Fable 5.2 can be picked in Settings.
- One request shape for every job: the same system prompt (it contains the whole rules library and is marked for caching), a JSON request, and a JSON answer forced by a schema.
- Refusal fallback is on for the models that support it (`fallbacks: "default"`). If Claude's safety filters decline a request, the API retries it on another model by itself.
- The key lives only in this browser's storage, is sent only to Anthropic, and is never part of a backup. Set a spend limit on it.
- Settings, Advanced lets you point the app at your own relay instead of `api.anthropic.com`.

Claude is never on the critical path. Saving a set and the rest timer work at once. If Claude is off, slow or failing, the app carries on with the last approved plan and the rule-based suggestions.

## Tests

```
npm test             # 26 unit tests for the rules, planner, session logic, text reader, cloud merge
npm run smoke        # 99 end-to-end checks in a phone-sized headless Chrome
npm run smoke:shots  # same, and saves screenshots to report/shots
npm run check:live   # checks the published app at its real address, including an offline start
```

The smoke test needs Google Chrome installed. It uses no real API key and no network: Claude is played by a local stand-in for the API (`tests/e2e/mock-anthropic.mjs`) and by a stand-in for the claude.ai runtime.

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
js/domain/planner.js                      builds the week, estimates time
js/domain/session.js                      the workout: ready, set, result, rest, next, summary
js/domain/progression.js                  reads results, proposes changes, applies them
js/ai/prompts.js                          the prompt, the answer schema, the request data
js/ai/claude.js                           the two ways to reach Claude
js/ai/coach.js                            the conversation, with and without Claude
js/ui/*.js                                the screens
vendor/                                   Preact + htm, and the Anthropic SDK, built by npm run vendor
docs/training-rules.md                    the rules as a document, generated from rules.js
scripts/                                  local server, icon, vendor, rules-doc and single-file builders
tests/                                    unit tests and the end-to-end smoke test
report/                                   the build report, test results and screenshots
```

## Changing things

- **Training rules:** edit `js/domain/rules.js`, bump `RULES_VERSION`, run `npm run rules-doc`. The generator, the suggestions and the Claude prompt all pick up the change.
- **Exercises and machines:** `js/domain/catalog.js`.
- **Releasing:** push to `main`. The deploy stamps the offline cache with the commit id, so installed phones pick up new files on the next start or the one after. On any other host, bump `VERSION` in `sw.js` yourself.
- **The claude.ai page:** `npm run build:artifact` packs everything into `dist/seria-artifact.html`. Publish that file as an update to the page address above, so the link and the saved data stay the same.
- **The report:** `npm run smoke:shots`, then `npm run report`, writes `report/report.html`. The published copy is at <https://claude.ai/artifact/GKCR9m4UWxaKrQw2wcNwU7>.

## Limits to know about

- Weights are in kilograms only.
- The claude.ai page and the stand-alone app do not share data. Move it with a backup file.
- Cloud sync is simple: the newest main record wins, workouts are merged one by one. It is meant for one person, mostly on one device at a time.
- Rest-over sound and vibration only fire while the page is on screen. The countdown itself is always right, because it is stored as an end time.
- Not medical advice. The limitation handling is deliberately cautious and says what it left out.
