# Seria training rules, version 1.6.0

Last updated 2026-11-18. Generated from `js/domain/rules.js` with `npm run rules-doc`. Do not edit by hand: change the rules file, bump `RULES_VERSION`, and run the script again.

This is the one set of rules behind the app. Three things read it:

- the plan generator (`js/domain/planner.js`),
- the suggestions during and after a workout (`js/domain/progression.js`),
- the prompt sent to Claude (`js/ai/prompts.js`), which includes the full text below.

Every plan and every stored workout records the rules version it was made with.

Seria is not medical advice. Stop if something hurts and see a professional.

## Exercise selection

**SEL-1.** Pick exercises only from equipment marked available. Free weights, benches and a pull-up bar count as available unless the user turns them off.

- Source: App convention
- In the code: `equipment list`

**SEL-2.** Cover the big movement patterns across the week: squat, hip hinge, horizontal and vertical push, horizontal and vertical pull. Single-joint work fills the time that is left.

- Source: ACSM 2009; App convention
- In the code: `TEMPLATES`

**SEL-3.** Within a session, do multi-joint lifts before single-joint lifts, and the lifts that matter most for the goal first, while the lifter is fresh.

- Source: ACSM 2009; Simão 2012
- In the code: `TEMPLATES order`

**SEL-4.** Leave out movements the user wants to skip or that clash with a stated limitation, and include the exercises the user asks for when the equipment allows. This is not medical advice; pain is a reason to stop and see a professional.

- Source: App convention
- In the code: `profile.avoid`, `profile.include`, `profile.avoidTags`

## Weekly layout

**FRQ-1.** Train each major muscle group at least twice a week when the number of days allows. With 3 days this means upper, lower, full body; with 4, upper and lower twice.

- Source: Schoenfeld 2016 (frequency); Grgic 2018 (frequency)
- In the code: `SPLITS`

**FRQ-2.** Plan at most 6 training days so one full rest day stays in the week.

- Source: App convention
- In the code: `MAX_DAYS`

## A plan that moves

**RUN-1.** The plan is a running list, not a calendar: train this, rest so many days, train that. It is laid out a couple of weeks ahead. The main lifts come back every week so they can progress, while secondary and accessory exercises take turns, so what did not fit one week is trained the next.

- Source: ACSM 2009; App convention
- In the code: `RUN`, `restPattern()`

**RUN-2.** The list is updated after every workout from what was recorded. When the last session on it is done, the next run is planned: by the connected model from the results so far, or by repeating the run with its exercises taking turns.

- Source: App convention
- In the code: `schedule.js`, `coach.js`

## Training on any day

**REC-1.** Leave about 48 hours before training the same muscle group hard again. Any session can be done on any day: when the next one on the list would repeat a muscle group trained in the last 48 hours, a session that lets it recover goes first.

- Source: ACSM 2011
- In the code: `SCHEDULE.recoverHours`

**REC-2.** Training on the planned day just starts the next session. On any other day, or when a session is picked by hand or skipped, the rest of the list is put in the order that spaces the muscle groups best, and the user sees it before starting. A skipped session comes back in the next run.

- Source: App convention
- In the code: `recommend()`

**REC-3.** After 10 or more days without training, the first session back uses about 10% less load. The plan keeps its numbers.

- Source: App convention
- In the code: `SCHEDULE.breakDays`, `SCHEDULE.easePct`

**REC-4.** Other activity counts toward recovery. A run, ride, hike, game or swim that adds up to about 30 minutes at a moderate effort (less when hard, more when easy) counts as work for the muscles it uses, mostly the legs. Sessions that train those muscles hard wait about 48 hours, as after a gym session. Short, easy activity changes nothing.

- Source: Wilson 2012; ACSM 2011; App convention
- In the code: `ACTIVITIES`, `ACTIVITY.countsFromMin`, `activityGroups()`

## Volume

**VOL-1.** More weekly sets per muscle group bring more muscle growth, with 10 or more sets a week doing better than fewer. Strength also gains more from medium and high weekly set counts than from low ones. The app's own targets, built on that: 6-10 weekly sets per muscle group for novices, 10-16 for intermediates and 12-20 for advanced lifters. The time budget comes first; the plan screen shows where a week falls short of the target.

- Source: Schoenfeld 2017 (volume); Ralston 2017; App convention
- In the code: `WEEKLY_SETS`, `PRESCRIPTION.sets`, `weeklySets()`

**VOL-2.** Novices do at most 3 working sets per exercise. Add volume later, not on day one.

- Source: ACSM 2009
- In the code: `NOVICE`

## Intensity

**INT-1.** Strength: heavy loads, 4-6 reps on the main barbell lifts. Muscle: 6-12 reps on compound lifts, 10-15 on single-joint lifts. General fitness: 8-12. Muscular endurance: 12-20 with lighter loads.

- Source: ACSM 2009; Schoenfeld 2017 (load)
- In the code: `PRESCRIPTION.repLo/repHi`

**INT-2.** Muscle grows across a wide range of loads as long as sets are hard, while maximal strength gains favour heavier loads. So the rep range follows the goal, and effort is kept high in every range.

- Source: Schoenfeld 2017 (load)
- In the code: `PRESCRIPTION`

**INT-3.** End working sets with about 1-3 reps in reserve (novices 2-3). Reps in reserve is the number of extra reps the lifter could still have done with good form.

- Source: Zourdos 2016; Helms 2016
- In the code: `TARGET_RIR`

**EFF-1.** Sets before the last one stop at the target, with reps in reserve. The last set of an exercise may go past the target, to about one rep short of failure (two for novices on the main lifts). The extra reps are recorded: they show when the lifter is ready for more.

- Source: Helms 2016; App convention
- In the code: `effortCue()`

**INT-4.** Keep sets of 5 reps and under for barbell lifts. Dumbbell, machine and bodyweight exercises use at least 6-8 reps, and novices do not go below 6 reps on any lift.

- Source: App convention
- In the code: `NON_BARBELL_MIN_RANGE`, `NOVICE`

## Rest

**RST-1.** Rest longer between heavy compound sets: 2-3 minutes or more for strength work. Longer rests (about 3 minutes against 1) also gave more strength and muscle in trained men. Single-joint and endurance work can use 45-90 seconds.

- Source: ACSM 2009; Schoenfeld 2016 (rest); Grgic 2018 (rest)
- In the code: `PRESCRIPTION.rest`

## Session time

**TIM-1.** The time shown for a day counts a 5 minute general warm-up, 3 minutes of lighter ramp-up sets, every working set, the rests, and 2 minutes to move between stations. When a day runs over the budget, drop the last single-joint exercises first, then cut sets, and never go below 3 exercises or 2 sets.

- Source: App convention
- In the code: `TIME`

## Optional extras

**OPT-1.** Each session lists up to two optional exercises for the end, for days with time and energy left. They train the same part of the body as the session, so they add sets without tiring what the next session needs fresh. The choice, in order: what was left out of that session for time; a big muscle group that is under its weekly set target; a small muscle group with no direct work that week; then more single-joint work for what was just trained. They are done for 2 sets, are not counted in the session time, and skipping them changes nothing. When done, they are recorded and progress like any other exercise.

- Source: Schoenfeld 2017 (volume); App convention
- In the code: `OPTIONAL`, `fillOptional()`

## Supersets

**PAR-1.** Supersets are off unless the user turns them on. A superset here is a pair: two neighbouring exercises that use different muscles, done in turns: a set of one, a short rest, a set of the other. Good pairs are opposite muscles (a press with a row, biceps with triceps, leg extension with leg curl) or exercises far apart on the body. Exercises that share a muscle are never paired, because the second one loses reps. Squats and hip hinges are never paired, nor are the main lifts of a strength plan: the heaviest lifts keep their full rest. Core work is paired only with single-joint lifts. Trained this way, sessions take clearly less time for the same sets, and over weeks strength and muscle gains were no different from doing one exercise at a time. The sets feel harder, and both stations have to be free.

- Source: Zhang 2025; Iversen 2021; Robbins 2010
- In the code: `PAIRS`, `pairUp()`

**PAR-2.** In a pair, the rest after each set is 45% of the longer of the two planned rests, and never under 30 seconds, which is the time to get to the other station. With the other exercise's set in between, each muscle still waits at least its planned rest before it works again. The session time is counted this way. During a workout a pair can be split for the day when one of the two stations is taken.

- Source: Robbins 2010; App convention
- In the code: `PAIRS.restShare`, `PAIRS.minRestSec`, `pairRestSec()`

**PAR-3.** With supersets on, a plan is built for them, not just paired where two exercises happen to meet. The week is split into sessions that hold opposite muscle groups: upper-body and lower-body days, not push-only and pull-only days, where hardly anything has a partner. Inside a session each exercise is put next to a partner where the training allows, opposite muscles first. This is a way to train as much as a way to save time: some people would rather do a set of something else than sit through a rest. The training still comes first: compound lifts before single-joint work, full rest for squats, hip hinges and the main lifts of a strength plan, and no pair that shares a muscle.

- Source: Zhang 2025; Robbins 2010; App convention
- In the code: `PAIRS.splits`, `weekSplit()`, `arrangeForPairs()`

## Starting weight

**LOD-1.** With no history for an exercise, the user picks a starting weight: one they could lift for about 2 reps more than the target with good form. Loads are recorded as weight per dumbbell, total weight (bar included), machine setting, or bodyweight plus added weight.

- Source: Helms 2016; App convention
- In the code: `LOAD_TYPES`

## Progression

**PRG-1.** Double progression. Keep the load and add reps until every set reaches the top of the rep range, then raise the load by the smallest step the equipment allows (roughly 2-10%) and go back to the bottom of the range.

- Source: ACSM 2009
- In the code: `PROGRESSION.increasePct*`, `PROGRESSION.defaultStep`

**PRG-2.** When every set hits its target but not yet the top of the range, add one rep to the target next time and keep the load.

- Source: App convention
- In the code: `repLo/repHi`

## Reading results

**ADJ-1.** During a session: if a set ends short of its target with no reps in reserve, lower the load for the sets still to come, by about 5% for a miss of one rep and about 10% for two or more. If a set hits its target with 4 or more reps in reserve, raise the load one step for the remaining sets.

- Source: Helms 2016; Zourdos 2016; App convention
- In the code: `PROGRESSION.bigMissReps`, `smallDropPct`, `bigDropPct`, `lightRir`

**ADJ-2.** After a session: one off day changes nothing. If the same exercise falls short of its target at the same load in two sessions running, lower the load by about 10% and build back up.

- Source: ACSM 2009; App convention
- In the code: `PROGRESSION.shortfallReps`, `deloadPct`

**ADJ-3.** Judge only what was recorded: planned against done reps and load, reps in reserve when given, skipped sets, and earlier sessions of the same exercise. If the records do not justify a change, make none. Changes are made at once and listed with their reasons; each can be undone or corrected by hand.

- Source: App convention
- In the code: `history`

## Substitutes

**SUB-1.** When a machine is busy or missing, swap to an exercise with the same movement pattern on available equipment, and keep the sets, reps and rest. The swap applies to that session only unless the user changes the plan.

- Source: App convention
- In the code: `exercise patterns`

## Numbers

### Sets, reps and rest by goal

| Goal | Role in the session | Sets | Reps | Rest between sets |
|---|---|---|---|---|
| Strength | main | 4 | 4-6 | 180 s |
| Strength | secondary | 3 | 6-8 | 150 s |
| Strength | accessory | 3 | 8-12 | 90 s |
| Muscle | main | 3 | 6-10 | 150 s |
| Muscle | secondary | 3 | 8-12 | 120 s |
| Muscle | accessory | 3 | 10-15 | 75 s |
| General fitness | main | 3 | 8-12 | 120 s |
| General fitness | secondary | 2 | 8-12 | 90 s |
| General fitness | accessory | 2 | 10-15 | 60 s |
| Muscular endurance | main | 3 | 12-15 | 75 s |
| Muscular endurance | secondary | 2 | 12-20 | 60 s |
| Muscular endurance | accessory | 2 | 15-20 | 45 s |

Main means the first heavy compound lifts of the day, secondary the compound lifts after them, accessory the single-joint and core work.

Dumbbell, machine and bodyweight exercises use at least 6-8 reps. Novices do at most 3 sets per exercise and no fewer than 6 reps.

### Experience levels

| Level | Months of regular training | Reps left in reserve | Weekly sets per muscle group |
|---|---|---|---|
| Novice | 0 to under 6 | 2-3 | 6-10 |
| Intermediate | 6 to under 24 | 1-3 | 10-16 |
| Advanced | 24 and more | 1-2 | 12-20 |

### Week layout

| Training days a week | Days |
|---|---|
| 1 | Full body |
| 2 | Full body, Full body |
| 3 | Upper body, Lower body, Full body |
| 4 | Upper body, Lower body, Upper body, Lower body |
| 5 | Upper body, Lower body, Push, Pull, Legs |
| 6 | Push, Pull, Legs, Push, Pull, Legs |

At most 6 training days are planned.

### Order of movements on each kind of day

Slots are filled in this order. When time is short they are dropped from the end.

- **Upper body:** push h (main), pull h (main), push v (secondary), pull v (secondary), biceps (accessory), triceps (accessory), delt side (accessory)
- **Lower body:** squat (main), hinge (main), lunge (secondary), knee flex (accessory), calf (accessory), core (accessory)
- **Full body:** squat (main), push h (main), pull v (secondary), hinge (secondary), push v (accessory), core (accessory)
- **Full body (second day):** hinge (main), push v (main), pull h (secondary), lunge (secondary), push h (accessory), biceps (accessory)
- **Push:** push h (main), push v (main), chest fly (accessory), delt side (accessory), triceps (accessory)
- **Pull:** pull v (main), pull h (main), delt rear (accessory), biceps (accessory), core (accessory)
- **Legs:** squat (main), hinge (main), lunge (secondary), knee ext (accessory), knee flex (accessory), calf (accessory)

### Session time

- General warm-up: 5 min. Ramp-up sets before the first lift: 3 min.
- One set: 10 s to get into position plus 3.5 s per rep.
- Moving to the next station and setting up: 2 min.
- A day is never trimmed below 3 exercises or 2 sets per exercise.

### Progression and result reading

- Load goes up by one step when every set reaches the top of the rep range (a step is roughly 2-10% of the load).
- Default steps: per dumbbell 2, total 2.5, machine setting 5, bodyweight 2.5. The user can set the step per exercise.
- During a session, a set that ends 1 rep short with no reps in reserve suggests about 5% less load for the sets to come; 2 or more reps short suggests about 10%. Never less than one step.
- During a session, hitting the target with 4 or more reps in reserve suggests one step more.
- After a session, a shortfall counts from 2 missed reps in total, or a load lowered mid-session. Two sessions running with a shortfall at the same load suggest 10% less.

### How loads are recorded

- **per dumbbell** (`per_dumbbell`): weight of one dumbbell.
- **total** (`total`): total weight, bar included.
- **machine setting** (`machine`): number on the weight stack or pin.
- **bodyweight** (`bodyweight`): extra weight added (0 for none).

## Sources

- **ACSM 2009.** American College of Sports Medicine. Progression models in resistance training for healthy adults. Med Sci Sports Exerc. 2009;41(3):687-708. <https://doi.org/10.1249/MSS.0b013e3181915670>
- **Schoenfeld 2017 (volume).** Schoenfeld BJ, Ogborn D, Krieger JW. Dose-response relationship between weekly resistance training volume and increases in muscle mass: a systematic review and meta-analysis. J Sports Sci. 2017;35(11):1073-1082. <https://doi.org/10.1080/02640414.2016.1210197>
- **Ralston 2017.** Ralston GW, Kilgore L, Wyatt FB, Baker JS. The effect of weekly set volume on strength gain: a meta-analysis. Sports Med. 2017;47(12):2585-2601. <https://doi.org/10.1007/s40279-017-0762-7>
- **Schoenfeld 2016 (frequency).** Schoenfeld BJ, Ogborn D, Krieger JW. Effects of resistance training frequency on measures of muscle hypertrophy: a systematic review and meta-analysis. Sports Med. 2016;46(11):1689-1697. <https://doi.org/10.1007/s40279-016-0543-8>
- **Grgic 2018 (frequency).** Grgic J, Schoenfeld BJ, Davies TB, Lazinica B, Krieger JW, Pedisic Z. Effect of resistance training frequency on gains in muscular strength: a systematic review and meta-analysis. Sports Med. 2018;48(5):1207-1220. <https://doi.org/10.1007/s40279-018-0872-x>
- **Schoenfeld 2017 (load).** Schoenfeld BJ, Grgic J, Ogborn D, Krieger JW. Strength and hypertrophy adaptations between low- vs. high-load resistance training: a systematic review and meta-analysis. J Strength Cond Res. 2017;31(12):3508-3523. <https://doi.org/10.1519/JSC.0000000000002200>
- **Schoenfeld 2016 (rest).** Schoenfeld BJ, Pope ZK, Benik FM, et al. Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men. J Strength Cond Res. 2016;30(7):1805-1812. <https://doi.org/10.1519/JSC.0000000000001272>
- **Grgic 2018 (rest).** Grgic J, Schoenfeld BJ, Skrepnik M, Davies TB, Mikulic P. Effects of rest interval duration in resistance training on measures of muscular strength: a systematic review. Sports Med. 2018;48(1):137-151. <https://doi.org/10.1007/s40279-017-0788-x>
- **Zourdos 2016.** Zourdos MC, Klemp A, Dolan C, et al. Novel resistance training-specific rating of perceived exertion scale measuring repetitions in reserve. J Strength Cond Res. 2016;30(1):267-275. <https://doi.org/10.1519/JSC.0000000000001049>
- **Helms 2016.** Helms ER, Cronin J, Storey A, Zourdos MC. Application of the repetitions in reserve-based rating of perceived exertion scale for resistance training. Strength Cond J. 2016;38(4):42-49. <https://doi.org/10.1519/SSC.0000000000000218>
- **ACSM 2011.** Garber CE, Blissmer B, Deschenes MR, et al. Quantity and quality of exercise for developing and maintaining cardiorespiratory, musculoskeletal, and neuromotor fitness in apparently healthy adults: guidance for prescribing exercise. Med Sci Sports Exerc. 2011;43(7):1334-1359. <https://doi.org/10.1249/MSS.0b013e318213fefb>
- **Wilson 2012.** Wilson JM, Marin PJ, Rhea MR, Wilson SMC, Loenneke JP, Anderson JC. Concurrent training: a meta-analysis examining interference of aerobic and resistance exercises. J Strength Cond Res. 2012;26(8):2293-2307. <https://doi.org/10.1519/JSC.0b013e31823a3e2d>
- **Simão 2012.** Simão R, de Salles BF, Figueiredo T, Dias I, Willardson JM. Exercise order in resistance training. Sports Med. 2012;42(3):251-265. <https://doi.org/10.2165/11597240-000000000-00000>
- **Zhang 2025.** Zhang X, Weakley J, Li H, Li Z, García-Ramos A. Superset versus traditional resistance training prescriptions: a systematic review and meta-analysis exploring acute and chronic effects on mechanical, metabolic, and perceptual variables. Sports Med. 2025. <https://doi.org/10.1007/s40279-025-02176-8>
- **Iversen 2021.** Iversen VM, Norum M, Schoenfeld BJ, Fimland MS. No time to lift? Designing time-efficient training programs for strength and hypertrophy: a narrative review. Sports Med. 2021;51(10):2079-2095. <https://doi.org/10.1007/s40279-021-01490-1>
- **Robbins 2010.** Robbins DW, Young WB, Behm DG, Payne WR. Agonist-antagonist paired set resistance training: a brief review. J Strength Cond Res. 2010;24(10):2873-2882. <https://doi.org/10.1519/JSC.0b013e3181f00bfc>
- **App convention.** Practical convention chosen for this app. Not taken from a study; change it if it does not suit you.

The journal references were checked against their DOI records on 2026-11-13. Rules marked "App convention" are practical choices made for this app, not findings from a study.
