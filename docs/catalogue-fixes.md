# Catalogue fixes

The agreed result of the catalogue review on 2026-11-01. Apply these to `src/data/catalogue.json` and `scripts/build-exercises.mjs`, then regenerate `src/data/exercises.json`. The catalogue goes from 566 rows to 534. Every row below was checked against the 566 rows on this branch.

Ratios are written assumptions from general lifting knowledge. No old table or Strength Level value was used.

## Drop 40 rows

**Cleans, snatches and jerks (18):** Alternating Hang Clean, Bottoms-Up Clean From The Hang Position, Double Kettlebell Alternating Hang Clean, Double Kettlebell Jerk, Double Kettlebell Snatch, Dumbbell Clean, Kettlebell Dead Clean, Kettlebell Hang Clean, One-Arm Kettlebell Clean, One-Arm Kettlebell Clean and Jerk, One-Arm Kettlebell Jerk, One-Arm Kettlebell Snatch, One-Arm Kettlebell Split Jerk, One-Arm Kettlebell Split Snatch, One-Arm Open Palm Kettlebell Clean, Open Palm Kettlebell Clean, Two-Arm Kettlebell Clean, Two-Arm Kettlebell Jerk.

**Speed work, or a band or ball in the source text (3):** Speed Squats, Speed Box Squat, Cable Russian Twists.

**Other dynamic lifts (12):** One-Arm Kettlebell Push Press, Double Kettlebell Push Press, Kettlebell Thruster, Landmine Linear Jammer, Single-Arm Linear Jammer, Kipping Muscle Up, One-Arm Kettlebell Swings, Kettlebell Pirate Ships, Landmine 180's, Spell Caster, Wind Sprints, Kettlebell Sumo High Pull.

**Passes and movement drills (7):** Kettlebell Figure 8, Kettlebell Pass Between The Legs, Lunge Pass Through, Cable Judo Flip, Rope Climb, Spider Crawl, Iron Cross.

## Add 8 rows

All eight ids already exist on `main`. `Weighted_Crunches` is tagged medicine ball in the source and the other seven are in its Olympic category, so the build must let exactly these through. Muscles are the source muscles after mapping.

| Row | Primary | Secondary | Base lift | Ratio | Confidence | Reason |
|---|---|---|---|---|---|---|
| Weighted Crunches | abs | none | Back Squat | 1.55 | low | Total load; bodyweight plus the held plate, about 40 reps at bodyweight. |
| Romanian Deadlift from Deficit | hamstring | forearm, gluteal, lower-back, trapezius | Deadlift | 0.7 | medium | The extra range costs a little against a Romanian deadlift. |
| Wide Stance Stiff Legs | hamstring | adductor, gluteal, lower-back | Deadlift | 0.75 | medium | Wide stance; about the same as a stiff-legged deadlift. |
| Clean Deadlift | hamstring | forearm, gluteal, lower-back, upper-back, quadriceps, trapezius | Deadlift | 0.9 | medium | Clean grip and a held back angle cost about 10%. |
| Snatch Deadlift | hamstring | forearm, gluteal, lower-back, quadriceps, trapezius | Deadlift | 0.8 | medium | The wide snatch grip lengthens the pull, about 20% lighter. |
| Olympic Squat | quadriceps | calves, gluteal, hamstring | Back Squat | 0.95 | medium | High bar and full depth, so slightly lighter. |
| Overhead Squat | quadriceps | abs, calves, gluteal, hamstring, lower-back, front-deltoids, triceps | Front Squat | 0.6 | low | Bar held overhead; shoulders and mobility limit it. |
| Frankenstein Squat | quadriceps | abs, calves, gluteal, hamstring | Front Squat | 0.7 | low | No hands on the bar, so balance limits it below a front squat. |

Weighted Crunches is bodyweight equipment. In the source, Overhead Squat lists shoulders, which must map to front delts only.

## Change 20 ratios

| Row | Now | Fix | Note |
|---|---|---|---|
| Muscle Up | 1.05 | 0.75 | Keep the reason. |
| Handstand Push-Ups | 1.3 | 1.1 | Keep the reason. |
| Single-Arm Push-Up | 1 | 0.8 | Reason: "Total load; a single rep is already a strong press." |
| Natural Glute Ham Raise | 0.75 | 0.6 | Keep the reason. |
| Floor Glute-Ham Raise | 0.8 | 0.65 | Keep the reason. |
| Scapular Pull-Up | 1.05 | 1.2 | Reason: "Total load; only scapular depression, about 15 reps." |
| Bodyweight Mid Row | 0.95 | 1.05 | Reason: "Total load; legs hooked over the bar, so the pull is partial." |
| Palms-Up Barbell Wrist Curl Over A Bench | 0.55 | 0.45 | Matches the dumbbell rows at 0.22 per hand. |
| Seated Palm-Up Barbell Wrist Curl | 0.55 | 0.45 | Matches the dumbbell rows at 0.22 per hand. |
| Standing Palms-Up Barbell Behind The Back Wrist Curl | 0.6 | 0.5 | Stays a little above the bench version. |
| Barbell Ab Rollout | 1 | 0.8 | Reason: "Total load; from the toes, about 5 reps." |
| Barbell Ab Rollout - On Knees | 1.2 | 1 | Reason: "Total load; the same lever as the Ab Roller, about 12 reps." |
| Barbell Shoulder Press | 1 | 0.95 | Same seated lift as Seated Barbell Military Press; update the reason. |
| Barbell Guillotine Bench Press | 0.75 | 0.7 | Same lift as Neck Press. |
| Rocking Standing Calf Raise | 1 | 0.9 | Same bar raise as Standing Barbell Calf Raise; update the reason. |
| Bench Press - Powerlifting | 1.03 | 1 | Reason: "Same lift as the base bench press." Stays high. |
| Straight Bar Bench Mid Rows | 0.9 | 0.95 | Reason: "Standing on the bench, so a slightly longer bent-over row." |
| Close-Grip Dumbbell Press | 0.35 | 0.45 | Reason: "One dumbbell, both hands, pressed from the chest." |
| Calf Raise On A Dumbbell | 0.3 | 1.05, bodyweight | Reason: "Total load; one foot on the handle, about 15 reps." |
| Chair Squat | 0.8 | 0.9, machine | Remove the equipment correction: the source describes a Smith machine. |

## Match 10 ratios to their stated reps

The reason states a rep count at p50 for an 80 kg lifter, read before the raise. Keep the reason and change the ratio.

| Row | Now | Fix |
|---|---|---|
| Hanging Knee Raise | 1.15 | 1.05 |
| Body-Up | 1.1 | 1 |
| Body Tricep Press | 1.1 | 1 |
| Platform Hamstring Slides | 1 | 0.85 |
| Single-Leg High Box Squat | 1 | 0.9 |
| Single Leg Glute Bridge | 1.05 | 0.85 |
| Step-up with Knee Raise | 1.3 | 1.15 |
| Suspended Split Squat | 1.3 | 1.15 |
| Suspended Fallout | 1.1 | 0.95 |
| Suspended Reverse Crunch | 1.2 | 1.05 |

## Lower 5 ratios on judgement

| Row | Now | Fix |
|---|---|---|
| Barbell Side Bend | 0.4 | 0.3 |
| Press Sit-Up | 0.5 | 0.3 |
| Kettlebell Turkish Get-Up (Lunge style) | 0.5 | 0.4 |
| Kettlebell Turkish Get-Up (Squat style) | 0.5 | 0.4 |
| Plie Dumbbell Squat | 0.5 | 0.42 |

## Remove rear delts from 24 rows

`deltoids()` in `scripts/build-exercises.mjs` credits both delts when a name matches neither pattern. Fix the cause or correct the rows, whichever is simpler, but no other row may change.

Incline Dumbbell Bench With Palms Facing In, Decline Close-Grip Bench To Skull Crusher, Lying Dumbbell Tricep Extension, Kettlebell Overhead Triceps Extension, Standing Overhead Barbell Triceps Extension, Standing Low-Pulley One-Arm Triceps Extension, Standing One-Arm Dumbbell Triceps Extension, Standing Bent-Over One-Arm Dumbbell Triceps Extension, Push Up to Side Plank, Otis-Up, Ab Roller, Barbell Ab Rollout, Barbell Ab Rollout - On Knees, Barbell Rollout from Bench, Suspended Fallout, Goblet Squat, Kettlebell Pistol Squat, One-Arm Overhead Kettlebell Squats, Single Dumbbell Raise, Straight Raises on Incline Bench, Car Drivers, Dumbbell Incline Shoulder Raise, Barbell Incline Shoulder Raise, Smith Incline Shoulder Raise.

Car Drivers also changes equipment to other, because it is a held plate. Where these rows list rear delts as primary, front delts stay primary.

## Other muscle fixes (10 rows)

- **Incline Bench Pull:** remove front delts. It stays barbell at 0.7, though the source text says dumbbells, because the app shows no instructions and the name reads as a barbell lift.
- **Standing Dumbbell Upright Row, Smith Machine Upright Row, Upright Cable Row:** make front and rear delts primary and trapezius secondary, like Upright Barbell Row. All three move from Back to Shoulders.
- **Hammer Curls, Incline Hammer Curls, Cable Hammer Curls - Rope Attachment:** add forearm as secondary.
- **Inverted Row:** add biceps as secondary.
- **Air Bike:** add obliques as secondary.
- **Bent Press:** make obliques primary and move abs to secondary.

## Wording and confidence (9 rows)

- **Chain Press:** say the logged figure is both chains together. The ratio stays.
- **Chain Handle Extension:** replace "Stack weight" with chains alone, both chains together. The ratio stays.
- **Squat with Plate Movers:** the steps come between reps, not sets.
- **Rope Crunch:** the arms reach overhead; the rope is not behind the head.
- **Triceps Pushdown:** remove the "strongest" claim, which belongs to the V-bar.
- **Triceps Pushdown - V-Bar Attachment:** keep the claim and say it is the strongest pushdown grip.
- **Butterfly, Leg Extensions, Lying Leg Curls:** change to low, because each reason says the lever varies.

## Follow-through

- Change the row count test at `src/data/index.test.ts:74`: its lower limit of 550 fails at 534.
- Add the dropped rows to the AC19 test.
- Republish https://claude.ai/artifact/6Gf52dHv4QnwWDMvJaMgg7 with the new rows, tallies and left-out lists, and replace "Check these first" with the changes above.
- Stop there. A separate session re-checks only the changed, added and dropped rows, and confirms the rest are unchanged.
