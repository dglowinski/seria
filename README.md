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
- uses Claude or OpenAI with your own API key, pasted in Settings. Without a key the built-in coach and the training rules do the job.

It is served by GitHub Pages from this repository. Every push to `main` runs the unit tests and then publishes the app files (`.github/workflows/pages.yml`). Tests, scripts and the report are not published. The folder has no build step, so any other static HTTPS host works too.

## Telling it what your gym has

On the Equipment tab, "Add to list" opens a box where you can name the machines or paste any text: a list, a sentence, notes from the gym's website. You can also dictate it. The text is read and the list is saved in one go, and you see what was added, what was marked as missing ("no barbell"), and what could not be placed. The connected model (Claude or OpenAI) does the reading; a built-in reader does it otherwise. You can still pick machines from the list or add your own by hand.

### Naming the maker

Say who makes the machines, as in "these are from Technogym: leg press, chest press", and the exact machines are identified. For each one the app saves the maker, the model, how the machine works, what it isolates and how it is loaded. The coach gets this with every request, on the equipment list and on each exercise done on that machine, and you see it on the Equipment tab, in the day preview and on the workout screen.

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

The model is never on the critical path. Saving a set and the rest timer work at once. If the model is off, slow or failing, the app carries on with the last approved plan and the rule-based suggestions.

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
js/domain/planner.js                      builds the week, estimates time
js/domain/session.js                      the workout: ready, set, result, rest, next, summary
js/domain/progression.js                  reads results, proposes changes, applies them
js/ai/prompts.js                          the prompt, the answer schema, the request data
js/ai/ai.js                               picks the provider, checks the answer
js/ai/claude.js                           the two ways to reach Claude
js/ai/openai.js                           OpenAI through its Responses API
js/ai/coach.js                            the conversation, with and without a model
js/ui/*.js                                the screens
vendor/                                   Preact + htm, the Anthropic SDK and the OpenAI SDK, built by npm run vendor
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
