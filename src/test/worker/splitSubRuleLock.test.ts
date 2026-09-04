import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { ProjectState, SemesterSchedules, LockedLesson, CurriculumRule } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

const PROJECT_FILE = path.join(process.cwd(), 'almost_complete.schoolproj');
const hasProject = existsSync(PROJECT_FILE);

async function loadProject(file: string): Promise<ProjectState> {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const readJson = async (name: string): Promise<any> => {
    const f = zip.file(name);
    if (!f) return undefined;
    try {
      return JSON.parse(await f.async('string'));
    } catch {
      return undefined;
    }
  };
  const manifest = await readJson('manifest.json');
  return {
    version: manifest?.version || '1.0.0',
    school: manifest?.school || { id: 'imported', name: 'Imported' },
    academicYears: (await readJson('academic_years.json')) || [],
    teachers: (await readJson('teachers.json')) || [],
    subjects: (await readJson('subjects.json')) || [],
    rooms: (await readJson('rooms.json')) || [],
    groups: (await readJson('groups.json')) || [],
    curriculum: (await readJson('curriculum.json')) || [],
    loadDistribution: (await readJson('load_distribution.json')) || [],
    constraints: (await readJson('constraints.json')) || [],
    generatedSchedules: (await readJson('semester_schedules.json')) as SemesterSchedules,
    generatedSplits: (await readJson('semester_splits.json')) || [],
  };
}

function splitSubjects(curriculum: CurriculumRule[]): Map<string, CurriculumRule[]> {
  const byKey = new Map<string, CurriculumRule[]>();
  for (const r of curriculum) {
    const key = `${r.groupId}|${r.subjectId}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  return new Map([...byKey].filter(([, rules]) => rules.length > 1));
}

async function regenerate(project: ProjectState): Promise<SemesterSchedules> {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (m) => messages.push(m), {
    mode: 'runs',
    attempts: 4,
    maxSpillPasses: 2,
    optimizePasses: 8,
  });
  const res = messages.find((m) => m.type === 'RESULT');
  return res!.payload.schedules as SemesterSchedules;
}

const LONG = 400000;

describe.skipIf(!hasProject)('Locks on split-subject sub-rules survive generation (almost_complete)', () => {
  let base!: ProjectState;

  beforeAll(async () => {
    vi.setConfig({ testTimeout: LONG });
    base = await loadProject(PROJECT_FILE);
  }, 120000);

  it('loads the almost_complete project', () => {
    expect(base.curriculum.length).toBeGreaterThan(0);
    expect(splitSubjects(base.curriculum).size).toBeGreaterThan(0);
  });

  it('honors a lock on a NON-FIRST split sub-rule at its exact slot', async () => {
    const splits = splitSubjects(base.curriculum);
    const s1 = base.generatedSchedules!.semester1.schedule;

    let lock: LockedLesson | undefined;
    for (const [, rules] of splits) {
      const lockedRule = rules[1];
      const lesson = s1.find((l) => l.ruleId === lockedRule.id);
      if (!lesson) continue;
      lock = { ruleId: lockedRule.id, day: lesson.day, period: lesson.period, semester: 'semester1' };
      break;
    }
    expect(lock).toBeDefined();

    const project: ProjectState = { ...base, lockedLessons: [lock!] };
    const out = await regenerate(project);

    const atSlot = out.semester1.schedule.find(
      (l) => l.ruleId === lock!.ruleId && l.day === lock!.day && l.period === lock!.period
    );
    const lockedConflict = (out.semester1.conflicts || []).filter(
      (c) => c.ruleId === lock!.ruleId && c.locked
    );

    console.log(`\n[SPLIT NON-FIRST LOCK] rule=${lock!.ruleId} locked at ${lock!.day}/${lock!.period}`);
    console.log(`  lesson at locked slot after regen: ${atSlot ? 'YES' : 'NO'}`);
    console.log(`  locked conflict reported: ${lockedConflict.length}`);

    // The lock must be honored in place OR reported infeasible (never a silent
    // drop). Before the fix it was silently skipped (no placement, no conflict).
    const settled =
      (atSlot && lockedConflict.length === 0) || (!atSlot && lockedConflict.length > 0);
    expect(settled).toBe(true);
  }, LONG);

  it('reports an infeasible lock as a locked conflict without leaking the locked hour elsewhere', async () => {
    const splits = splitSubjects(base.curriculum);
    const busyRules = (base.constraints || []).filter((c) => c.kind === 'TEACHER_BUSY' && c.teacherId);

    let lock: LockedLesson | undefined;
    for (const [, rules] of splits) {
      const lockedRule = rules[1];
      if (!lockedRule.teacherId) continue;
      const busy = busyRules.find((b) => b.teacherId === lockedRule.teacherId && b.periods && b.periods.length);
      if (!busy) continue;
      const period = busy.periods![0];
      const day = busy.day && busy.day !== '*' ? busy.day : 'Monday';
      lock = { ruleId: lockedRule.id, day, period, semester: 'semester1' };
      break;
    }
    expect(lock).toBeDefined();

    const project: ProjectState = { ...base, lockedLessons: [lock!] };
    const out = await regenerate(project);

    const placed = out.semester1.schedule.filter((l) => l.ruleId === lock!.ruleId);
    const atLockedSlot = placed.find((l) => l.day === lock!.day && l.period === lock!.period);
    const lockedConflict = (out.semester1.conflicts || []).filter(
      (c) => c.ruleId === lock!.ruleId && c.locked
    );

    console.log(`\n[INFEASIBLE LOCK] rule=${lock!.ruleId} locked at ${lock!.day}/${lock!.period}`);
    console.log(`  lesson at (forbidden) locked slot: ${atLockedSlot ? 'YES (BUG)' : 'no'}`);
    console.log(`  locked conflict reported: ${lockedConflict.length}`);

    // The locked hour must be reported unassigned (locked conflict) - not silently
    // dropped (would be 0) and not placed at the forbidden slot.
    expect(lockedConflict.length).toBeGreaterThan(0);
    expect(atLockedSlot).toBeUndefined();
  }, LONG);
});
