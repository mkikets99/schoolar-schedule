# Schedule Multi-Objective Optimization & Rearrangement Specification

## 1. Purpose

Implement an **anytime, multi-objective schedule optimizer** for a school timetable.

The optimizer must maximize timetable completeness while continuously improving timetable quality during the configured generation time.

The optimizer must:

- produce the best valid schedule found before the deadline;
- maximize the number of scheduled lessons;
- preserve all hard constraints;
- optimize configurable soft constraints;
- support arbitrary-depth recursive rearrangement chains;
- use backtracking/rollback when a rearrangement fails;
- use all remaining generation time for further optimization;
- never depend on a fixed maximum rearrangement depth as a correctness constraint.

The algorithm is an **anytime optimization algorithm**:

> More generation time should allow the algorithm to search more states and potentially return a better schedule. If the deadline is reached, return the best schedule found so far.

---

# 2. Terminology

### Lesson

A single scheduled or unscheduled teaching occurrence.

A lesson normally contains:

- class/group;
- subject;
- teacher;
- room;
- required weekly count;
- duration;
- other domain-specific attributes.

### Slot

A timetable position identified by at least:

```text
day + lesson_period
```

Example:

```text
Monday, period 3
Tuesday, period 5
```

### Schedule

A complete state containing all currently scheduled and unscheduled lessons.

### Hard Constraint

A rule that must never be violated.

A state violating a hard constraint is invalid.

### Soft Constraint

A preference that may be violated, but causes a penalty.

### Rearrangement

An operation that moves one or more already scheduled lessons in order to make a desired slot available.

### Displacement Chain

A sequence in which moving one lesson requires moving another lesson, which may require moving another lesson, etc.

Example:

```text
Math → Tuesday 3
Tuesday 3 occupied by Physics
Physics → Wednesday 2
Wednesday 2 occupied by Informatics
Informatics → Thursday 4
Thursday 4 is free
```

Result:

```text
Informatics: Wednesday 2 → Thursday 4
Physics:      Tuesday 3 → Wednesday 2
Math:         → Tuesday 3
```

---

# 3. Optimization Priority

The optimizer must use **lexicographic multi-objective optimization**.

Objectives are ordered by importance.

## Priority 0 — Hard Constraints

Hard constraints have absolute priority.

A schedule that violates a hard constraint is invalid.

Examples:

- teacher cannot teach two classes simultaneously;
- class cannot have two lessons simultaneously;
- room cannot host two lessons simultaneously;
- teacher must be available;
- room must be suitable/available;
- lesson must belong to the correct class;
- required lesson counts must be respected where applicable;
- any other configured hard constraint.

Never accept a state that violates a hard constraint.

---

## Priority 1 — Completeness

Maximize:

```text
scheduled_lessons
```

Equivalent objective:

```text
unscheduled_lessons → MINIMIZE
```

Example:

```text
Schedule A = 620 / 620 lessons
Schedule B = 619 / 620 lessons
```

Schedule A is always better than Schedule B regardless of soft-constraint quality.

The optimizer must prioritize putting all required lessons into the timetable.

---

## Priority 2 — Teacher schedule quality

Minimize teacher-related penalties.

Examples:

```text
teacher_gap_count
teacher_total_gap_length
teacher_max_gap_length
teacher_unnecessary_idle_periods
```

A "gap" means an empty period between two lessons of the same teacher.

Example:

```text
Period 1 = lesson
Period 2 = EMPTY
Period 3 = lesson
```

has one teacher gap of length 1.

Long gaps should normally have a higher penalty than short gaps.

---

## Priority 3 — Class schedule quality

Minimize class-related penalties.

Examples:

```text
class_gap_count
class_total_gap_length
class_max_gap_length
uneven_daily_distribution
undesirable lesson ordering
```

---

## Priority 4 — Lesson distribution

Prefer reasonable distribution of subjects throughout the week.

Examples:

- avoid excessive concentration of the same subject;
- avoid unnecessary consecutive occurrences of the same subject;
- distribute weekly lessons across different days where possible;
- respect configured subject-specific distribution rules.

---

## Priority 5 — Other soft constraints

The implementation must allow additional soft constraints to be added without rewriting the optimizer.

Examples:

```text
first_period_penalty
last_period_penalty
room_change_penalty
teacher_room_change_penalty
undesirable_day_penalty
subject_consecutive_penalty
daily_load_penalty
```

---

# 4. Schedule Score

The preferred representation is a lexicographic score vector.

Example:

```text
score = [
    scheduled_lessons,
    -teacher_gap_penalty,
    -teacher_long_gap_penalty,
    -class_gap_penalty,
    -distribution_penalty,
    -other_penalties
]
```

Comparison:

1. compare scheduled lesson count;
2. if equal, compare teacher gap penalties;
3. if equal, compare long-gap penalties;
4. if equal, compare class penalties;
5. continue through configured objectives.

Higher score is better.

Do NOT replace this with arbitrary weighted multiplication unless the project explicitly requires it.

This prevents a high-quality but incomplete timetable from defeating a complete timetable.

---

# 5. Anytime Generation

The optimizer receives:

```text
generation_time
```

or an equivalent deadline.

At startup:

```text
start_time = current_time()
deadline = start_time + generation_time
```

The optimizer must repeatedly check remaining time.

Conceptually:

```text
while current_time() < deadline:
    improve_schedule()
```

At any moment:

```text
BEST_SCHEDULE
BEST_SCORE
```

must be available.

When the deadline is reached:

```text
return BEST_SCHEDULE
```

The optimizer must not return a partially modified temporary state.

---

# 6. Initial Schedule

The optimizer may use any constructive strategy to create the initial schedule.

Recommended strategy:

1. identify all required lessons;
2. calculate possible slots for each lesson;
3. prioritize the most constrained lessons;
4. place lessons greedily where possible;
5. use rearrangement when direct placement fails;
6. preserve the best state found.

The initial solution does not need to be perfect.

The optimization phase must be capable of improving it.

---

# 7. Most Constrained Lesson First

When selecting a lesson to place or repair, prefer lessons with the smallest feasible search space.

Possible difficulty score:

```text
difficulty =
    inverse(number_of_available_slots)
    + teacher_constraint_score
    + room_constraint_score
    + class_constraint_score
    + other_constraint_score
```

The exact implementation may differ.

The important principle is:

> Resolve the most constrained lessons first.

---

# 8. Direct Placement

For every unscheduled or problematic lesson:

```text
candidate_slots = find_candidate_slots(lesson)
```

Candidate slots must already satisfy all hard constraints.

Sort candidates by estimated schedule quality.

Try the best candidates first.

If a slot is free:

```text
place(lesson, slot)
```

If the slot is occupied:

```text
rearrange(lesson, slot)
```

---

# 9. Rearrangement

Rearrangement is a recursive displacement search.

The operation must support arbitrary depth.

There is intentionally no fixed correctness limit such as:

```text
max_depth = 3
max_depth = 5
max_depth = 10
```

Instead, practical search termination is controlled by:

- remaining generation time;
- optional search-node budget;
- optional evaluation budget;
- detection of cycles;
- state dominance/pruning;
- hard constraints.

The algorithm may produce:

```text
A → B
A → B → C
A → B → C → D
A → B → C → D → E → ...
```

for as long as the search budget permits.

---

# 10. Recursive Rearrangement Algorithm

Conceptual pseudocode:

```text
TRY_PLACE(lesson, target_slot, state):

    if deadline_reached():
        return TIMEOUT

    if target_slot is free:
        place lesson in target_slot
        return SUCCESS

    occupying_lesson = state.lesson_at(target_slot)

    candidate_slots = FIND_VALID_SLOTS(
        occupying_lesson,
        state
    )

    sort candidate_slots by estimated quality descending

    for candidate_slot in candidate_slots:

        if deadline_reached():
            return TIMEOUT

        save_state()

        move occupying_lesson → candidate_slot

        if violates_hard_constraints(state):
            rollback()
            continue

        result = TRY_PLACE(
            lesson,
            target_slot,
            state
        )

        if result == SUCCESS:
            return SUCCESS

        rollback()

    return FAILURE
```

Important:

The recursive call must operate on the same transactional state.

If any branch fails, restore the exact previous state.

---

# 11. Cycle Prevention

Arbitrary depth does not mean arbitrary repetition.

The search must prevent cycles.

Example invalid search:

```text
A → B
B → A
A → B
B → A
...
```

Track the current displacement path.

A lesson should not be moved into a state already present in the current path unless the implementation has a proven reason to allow it.

Recommended structure:

```text
visited_states
current_path
```

At minimum, prevent moving the same lesson through the same slot repeatedly inside one search branch.

---

# 12. Transactional Operations

Every rearrangement must be transactional.

Conceptually:

```text
BEGIN TRANSACTION

move A
move B
move C
...

evaluate resulting state

if successful:
    COMMIT
else:
    ROLLBACK
```

Rollback must restore:

- lesson positions;
- teacher occupancy;
- class occupancy;
- room occupancy;
- derived constraint state;
- cached scores;
- any other mutable schedule state.

Never leave a failed search branch partially applied.

---

# 13. Candidate Slot Selection

When moving an occupying lesson, do not select a random slot first.

Calculate all valid candidate slots:

```text
candidate_slots =
    all_slots
    filtered_by_hard_constraints
```

Then estimate their effect on schedule quality.

Prefer slots that:

1. preserve hard constraints;
2. improve or minimally damage teacher gaps;
3. improve or minimally damage class gaps;
4. preserve subject distribution;
5. preserve room quality;
6. do not create new difficult conflicts;
7. keep the affected entities well distributed.

---

# 14. Global Impact Evaluation

A rearrangement must not be evaluated only from the perspective of the class being repaired.

Moving a lesson can affect:

- the lesson's class;
- the lesson's teacher;
- the lesson's room;
- other classes using the same teacher;
- other lessons affected by the chain;
- global subject distribution.

Therefore every committed candidate must be evaluated against the complete schedule.

Example:

```text
Physics 7-A:
Tuesday 3 → Wednesday 2
```

must evaluate the resulting:

```text
7-A schedule
Physics teacher schedule
Wednesday occupancy
room schedule
all related constraints
```

---

# 15. Complete Chain Evaluation

Do not accept a rearrangement merely because it created a free slot.

Example:

```text
Math → Tue 3
Physics → Wed 2
Informatics → Thu 4
```

The complete resulting schedule must be evaluated.

Only after the entire displacement chain is valid should it become a candidate.

---

# 16. Best Candidate Selection

There may be multiple valid rearrangement chains.

Example:

```text
Chain A:
Math → Tue 3
Physics → Wed 2
Informatics → Thu 4

Chain B:
Math → Tue 3
Physics → Fri 6
Informatics → Thu 4
```

If both produce complete schedules, choose the one with the better lexicographic score.

The search should therefore not stop at the first successful rearrangement if sufficient generation time remains.

The first valid result may be used as an immediate improvement, but optimization should continue searching for a better result.

---

# 17. Search Strategy

The implementation should combine multiple strategies.

Recommended baseline:

```text
Constructive placement
        +
Greedy candidate ordering
        +
Recursive rearrangement
        +
Backtracking
        +
Local search
        +
Randomized perturbation/restart
```

Not all strategies must run simultaneously.

The implementation may begin with:

```text
greedy + recursive rearrangement + backtracking
```

and add additional optimization strategies later.

---

# 18. Local Search

After obtaining a complete or mostly complete timetable, attempt local improvements.

Examples:

```text
move one lesson
swap two lessons
move a small group of lessons
rearrange a displacement chain
```

Accept a candidate if:

```text
candidate_score > current_score
```

or according to a configured metaheuristic.

Local search must never violate hard constraints.

---

# 19. Randomized Perturbation

If the optimizer becomes stuck:

```text
no improvement for N iterations
```

it may perform a controlled perturbation.

Example:

```text
select several non-critical lessons
move/rearrange them
resume optimization
```

This is intended to escape local optima.

Perturbation must preserve hard constraints.

If the perturbation does not improve the global best solution, discard it or continue from the better state according to the configured strategy.

---

# 20. Elite Solutions

Optionally maintain a small set of high-quality solutions:

```text
elite_solutions = top K schedules
```

Example:

```text
K = 10
```

This can prevent the optimizer from becoming trapped in one local optimum.

A new candidate can replace the weakest elite solution if it is better and sufficiently distinct.

This feature is optional for the first implementation.

---

# 21. Time Management

The optimizer must be explicitly time-aware.

Every expensive search operation should check:

```text
if current_time() >= deadline:
    terminate_search()
```

Avoid starting a very expensive branch when almost no time remains.

If possible, use:

```text
estimated_cost
remaining_time
```

to decide whether another deep search is worthwhile.

Near the deadline, prioritize:

1. preserving the current best solution;
2. cheap local improvements;
3. final validation.

---

# 22. Search Budgets

Time is the primary budget.

Optional secondary budgets may include:

```text
max_search_nodes
max_schedule_evaluations
max_rearrangement_attempts
```

These must be configurable.

Example:

```yaml
optimization:
  generation_time_ms: 30000

  budgets:
    max_nodes: null
    max_evaluations: null
    max_rearrangements: null
```

`null` means no explicit count limit; the time limit remains the effective limit.

---

# 23. State Evaluation

`evaluate(schedule)` must return at least:

```text
{
    valid: boolean,

    scheduled_lessons: integer,
    unscheduled_lessons: integer,

    teacher_gap_count: number,
    teacher_total_gap_length: number,
    teacher_max_gap_length: number,

    class_gap_count: number,
    class_total_gap_length: number,
    class_max_gap_length: number,

    distribution_penalty: number,

    other_penalties: ...
}
```

The exact metrics must be extensible.

---

# 24. Score Comparison

Implement a single canonical function:

```text
compare_scores(a, b)
```

It must determine whether:

```text
a > b
a == b
a < b
```

using the configured lexicographic objective order.

Do not duplicate score-comparison logic throughout the codebase.

---

# 25. Required Invariants

At all times:

```text
BEST_SCHEDULE is valid
```

unless the input itself makes a valid schedule impossible and the system explicitly permits returning a partial schedule.

The optimizer must never lose the best known state.

Temporary search states may be invalid only inside a controlled transaction and must never become the returned result.

---

# 26. Failure Handling

If a lesson cannot be placed directly:

```text
try rearrangement
```

If rearrangement fails:

```text
leave the current schedule unchanged
mark lesson as unresolved
continue with other candidates
```

Do not abort the entire generation because one lesson cannot currently be placed.

The optimizer should later revisit unresolved lessons after other changes.

---

# 27. Handling Impossible Inputs

If the requested timetable is mathematically impossible because of hard constraints:

- do not fabricate a valid result;
- return the best valid partial schedule;
- report unresolved lessons;
- report the relevant conflicts if available.

Example output:

```text
{
    scheduled_lessons: 618,
    required_lessons: 620,
    unresolved_lessons: [...],
    best_schedule: ...
}
```

---

# 28. Recommended Optimization Loop

High-level algorithm:

```text
GENERATE_SCHEDULE(input, generation_time):

    start = now()
    deadline = start + generation_time

    current = BUILD_INITIAL_SCHEDULE(input)

    if is_valid(current):
        best = clone(current)
    else:
        best = BEST_VALID_STATE_AVAILABLE(current)

    best_score = evaluate(best)

    while now() < deadline:

        problematic_lessons =
            FIND_UNSCHEDULED_OR_PROBLEMATIC_LESSONS(current)

        lesson =
            SELECT_MOST_CONSTRAINED(problematic_lessons)

        if lesson exists:

            candidates =
                FIND_CANDIDATE_SLOTS(lesson, current)

            candidates =
                SORT_BY_ESTIMATED_QUALITY(candidates)

            for slot in candidates:

                if deadline_reached():
                    break

                transaction = begin_transaction(current)

                result =
                    TRY_PLACE(
                        lesson,
                        slot,
                        current,
                        deadline
                    )

                if result.success:

                    candidate_score =
                        evaluate(current)

                    if candidate_score > best_score:

                        best = clone(current)
                        best_score = candidate_score

                    else:

                        rollback(transaction)

                else:
                    rollback(transaction)

        else:

            improvement =
                LOCAL_SEARCH(current, deadline)

            if improvement exists:
                current = improvement

            else:
                PERTURB_OR_RESTART(current)

        if evaluate(current) > best_score:
            best = clone(current)
            best_score = evaluate(current)

    return best
```

The implementation may optimize this pseudocode, especially by avoiding repeated full schedule evaluations.

---

# 29. Performance Requirements

Full schedule evaluation can be expensive.

The implementation should maintain incremental/derived data where practical:

```text
teacher occupancy map
class occupancy map
room occupancy map
teacher gap metrics
class gap metrics
lesson position index
```

A move should update only affected structures where possible.

However, correctness takes priority over premature optimization.

A correct full evaluation may be used initially, followed by incremental optimization.

---

# 30. Recommended Internal API

The implementation should expose concepts similar to:

```text
buildInitialSchedule()
findCandidateSlots(lesson, state)
tryPlace(lesson, slot, state, context)
rearrange(lesson, targetSlot, state, context)
moveLesson(lesson, from, to, state)
beginTransaction(state)
rollback(transaction)
commit(transaction)
evaluate(state)
compareScores(a, b)
findProblematicLessons(state)
selectMostConstrained(lessons, state)
localSearch(state, context)
perturb(state, context)
```

Names may be adapted to the existing codebase.

---

# 31. Separation of Concerns

Do not mix constraint definitions directly into the rearrangement algorithm.

Prefer:

```text
Scheduler
    ↓
Optimizer
    ↓
Search Engine
    ↓
Constraint Engine
    ↓
Schedule State
```

The optimizer should ask the constraint engine:

```text
isValidMove(...)
findValidSlots(...)
evaluate(...)
```

rather than hardcoding every school-specific rule.

---

# 32. Extensibility

The following must be configurable:

- hard constraints;
- soft constraints;
- objective priority;
- penalties;
- generation time;
- optional search budgets;
- candidate ordering;
- local-search strategy;
- perturbation strategy.

Adding a new soft constraint should not require rewriting recursive rearrangement.

---

# 33. Important Design Rule

Never interpret:

```text
rearrangement depth
```

as:

```text
optimization quality
```

A deep chain is only one possible search path.

A depth-8 rearrangement is not automatically better than a depth-2 rearrangement.

The final schedule is judged by:

```text
hard constraints
→ completeness
→ configured objective priorities
```

not by chain length.

---

# 34. Example

Initial:

```text
Tuesday:
P1  Mathematics
P2  English
P3  Physics
P4  EMPTY

Wednesday:
P1  EMPTY
P2  Informatics
P3  History
```

Need to place:

```text
Chemistry → Tuesday P3
```

But:

```text
Tuesday P3 = Physics
```

Possible rearrangement:

```text
Chemistry → Tuesday P3
Physics → Wednesday P2
```

But:

```text
Wednesday P2 = Informatics
```

Continue:

```text
Informatics → Tuesday P4
```

Tuesday P4 is free.

Final:

```text
Tuesday:
P1 Mathematics
P2 English
P3 Chemistry
P4 Informatics

Wednesday:
P1 EMPTY
P2 Physics
P3 History
```

Before committing, evaluate:

- Chemistry teacher;
- Physics teacher;
- Informatics teacher;
- affected classes;
- affected rooms;
- all hard constraints;
- teacher gaps;
- class gaps;
- distribution penalties.

If the resulting score is better than the current best state, keep it.

---

# 35. Acceptance Rule

A candidate schedule may become the global best only if:

```text
is_valid(candidate)
AND
compare_scores(candidate, best) > 0
```

A candidate may be temporarily explored even if it is not better, because it can lead to a better future state.

This distinction is important:

```text
current search state
```

and

```text
global best state
```

are not necessarily identical.

---

# 36. Optimization Philosophy

The optimizer should behave like an intelligent search process:

```text
Find something valid.
        ↓
Make it complete.
        ↓
Improve its quality.
        ↓
Try alternative arrangements.
        ↓
Escape local optima.
        ↓
Continue until deadline.
        ↓
Return best known solution.
```

Do not optimize only for speed.

Do not optimize only for the first valid timetable.

Do not stop at the first successful rearrangement if there is remaining time.

Do not sacrifice completeness merely to improve soft constraints.

---

# 37. Acceptance Tests

The implementation should include tests for at least:

### Test 1 — Direct placement

A lesson has a free valid slot.

Expected:

```text
lesson is placed directly
```

### Test 2 — One-level rearrangement

```text
A → occupied slot
B → free slot
```

Expected:

```text
B moves
A is placed
```

### Test 3 — Multi-level rearrangement

```text
A → B's slot
B → C's slot
C → D's slot
D → free slot
```

Expected:

```text
entire chain succeeds
```

### Test 4 — Failed chain

No valid final slot exists.

Expected:

```text
complete rollback
original schedule unchanged
```

### Test 5 — Teacher conflict

A candidate move creates a simultaneous teacher lesson.

Expected:

```text
candidate rejected
```

### Test 6 — Gap degradation

Two valid candidates exist.

Expected:

```text
candidate creating fewer/shorter teacher gaps wins
```

### Test 7 — Completeness priority

```text
A = 100% complete, lower soft score
B = 99% complete, higher soft score
```

Expected:

```text
A wins
```

### Test 8 — Time limit

Generation time is very short.

Expected:

```text
algorithm terminates near deadline
best known schedule is returned
```

### Test 9 — Longer generation

With a longer generation budget:

```text
best_score_after_long_run >= best_score_after_short_run
```

The algorithm must never intentionally discard the global best state.

### Test 10 — Deep chain

Construct a case requiring a chain deeper than any previously hardcoded depth.

Expected:

```text
algorithm can continue beyond that depth while time remains
```

---

# 38. Non-Goals

The rearrangement engine is not responsible for:

- defining school-specific rules;
- generating curriculum requirements;
- deciding whether a teacher is employed;
- creating classes;
- assigning teachers;
- assigning rooms unless room assignment is part of the existing scheduler;
- UI rendering.

It is responsible for optimizing an already defined scheduling problem.

---

# 39. Implementation Priority

Implement in this order:

```text
1. Schedule state representation
2. Hard constraint validation
3. Score/evaluation system
4. Initial schedule construction
5. Direct placement
6. Transaction + rollback
7. Recursive rearrangement
8. Arbitrary-depth search
9. Time/deadline controller
10. Global best state
11. Local search
12. Performance optimization
13. Optional elite states / perturbation
```

Do not implement complex metaheuristics before the basic recursive rearrangement and rollback are correct.

---

# 40. Final Requirement

The final implementation must satisfy this principle:

> Given the same scheduling problem and a larger generation-time budget, the optimizer should be able to continue searching rather than being artificially limited by a fixed rearrangement depth. It must always preserve the best valid timetable found so far and return that timetable when the generation deadline is reached.

The algorithm should therefore be treated as a **time-bounded anytime multi-objective constraint optimizer with recursive arbitrary-depth rearrangement and backtracking**.
