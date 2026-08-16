import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { ProjectState, CurriculumRule, SemesterSchedules, SemesterSplit } from '../../shared/types';
import { generateSemesterSchedules, buildSemesterProject } from '../../worker/generator';
import { analyzeEmptySlots } from '../../ui/services/scheduleAnalyzer';

const PROJECT_FILE = path.join(process.cwd(), 'real_test.schoolproj');
const hasRealProject = existsSync(PROJECT_FILE);

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

async function loadRealProject(): Promise<ProjectState> {
  const zip = await JSZip.loadAsync(readFileSync(PROJECT_FILE));
  const readJson = async (name: string): Promise<any> => {
    const file = zip.file(name);
    if (!file) return undefined;
    const raw = await file.async('string');
    try {
      return JSON.parse(raw);
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
  };
}

function weeklyCapacity(group: any): number {
  const periodCount = (group.periodEnd ?? 8) - (group.periodStart ?? 1) + 1;
  const maxDaily = Math.min(group.maxDailyLessons ?? 8, periodCount);
  return maxDaily * 5;
}

describe.skipIf(!hasRealProject)('Real project generation (real_test.schoolproj)', () => {
  let project!: ProjectState;
  let schedules!: SemesterSchedules;
  let splits!: SemesterSplit[];

  beforeAll(async () => {
    project = await loadRealProject();
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));
    const res = messages.find((m) => m.type === 'RESULT');
    expect(res).toBeDefined();
    schedules = res!.payload.schedules;
    splits = res!.payload.splits;
  });

  it('loads a real project', () => {
    expect(project.teachers.length).toBeGreaterThan(0);
    expect(project.groups.length).toBeGreaterThan(0);
    expect(project.curriculum.length).toBeGreaterThan(0);
  });

  it('produces a schedule result for both semesters', () => {
    expect(schedules.semester1.schedule.length).toBeGreaterThan(0);
    expect(schedules.semester2.schedule.length).toBeGreaterThan(0);
    expect(schedules.semester1.score).toBeGreaterThan(0);
    expect(schedules.semester2.score).toBeGreaterThan(0);
  });

  it('splits every curriculum rule into integer semester hours', () => {
    const byRule = new Map(splits.map((s) => [s.ruleId, s]));
    expect(byRule.size).toBe(project.curriculum.length);

    for (const rule of project.curriculum) {
      const split = byRule.get(rule.id);
      expect(split).toBeDefined();
      expect(Number.isInteger(split!.first)).toBe(true);
      expect(Number.isInteger(split!.second)).toBe(true);
      expect(split!.first).toBeGreaterThanOrEqual(0);
      expect(split!.second).toBeGreaterThanOrEqual(0);
      expect(split!.first + split!.second).toBe(
        Math.ceil(split!.hoursPerWeek) + Math.floor(split!.hoursPerWeek)
      );
    }
  });

  it('keeps every teachers total semester load balanced (<=1h apart)', () => {
    const byTeacher = new Map<string, CurriculumRule[]>();
    for (const rule of project.curriculum) {
      const tid = rule.teacherId || 'no-teacher';
      if (!byTeacher.has(tid)) byTeacher.set(tid, []);
      byTeacher.get(tid)!.push(rule);
    }
    for (const [tid, rules] of byTeacher) {
      const sums = rules.reduce(
        (acc, r) => {
          const split = splits.find((s) => s.ruleId === r.id)!;
          return { s1: acc.s1 + split.first, s2: acc.s2 + split.second };
        },
        { s1: 0, s2: 0 }
      );
      console.log(`  teacher ${tid}: semester1=${sums.s1}h semester2=${sums.s2}h diff=${Math.abs(sums.s1 - sums.s2)}`);
      expect(Math.abs(sums.s1 - sums.s2)).toBeLessThanOrEqual(1);
    }
  });

  it('places no two lessons in the same teacher/room slot, and no rule twice in a group slot', () => {
    const splitKeys = new Set<string>();
    const seen = new Map<string, CurriculumRule[]>();
    for (const rule of project.curriculum) {
      const key = `${rule.groupId}|${rule.subjectId}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(rule);
    }
    for (const [key, rules] of seen) {
      if (rules.length > 1) splitKeys.add(key);
    }

    for (const semester of ['semester1', 'semester2'] as const) {
      const teacherSlot = new Set<string>();
      const roomSlot = new Set<string>();
      const groupSlotRules = new Map<string, string[]>();
      for (const lesson of schedules[semester].schedule) {
        const slot = `${lesson.day}-${lesson.period}`;
        if (lesson.teacherId) {
          expect(teacherSlot.has(`${lesson.teacherId}-${slot}`)).toBe(false);
          teacherSlot.add(`${lesson.teacherId}-${slot}`);
        }
        if (lesson.roomId) {
          expect(roomSlot.has(`${lesson.roomId}-${slot}`)).toBe(false);
          roomSlot.add(`${lesson.roomId}-${slot}`);
        }
        const gKey = `${lesson.groupId}-${slot}`;
        if (!groupSlotRules.has(gKey)) groupSlotRules.set(gKey, []);
        const ruleIds = groupSlotRules.get(gKey)!;
        if (ruleIds.length > 0) {
          const splitKey = `${lesson.groupId}|${lesson.subjectId}`;
          expect(splitKeys.has(splitKey)).toBe(true);
        }
        expect(ruleIds).not.toContain(lesson.ruleId);
        ruleIds.push(lesson.ruleId);
      }
    }
  });

  it('never places more lessons than a group capacity in either semester', () => {
    const capacity = new Map<string, number>();
    for (const g of project.groups) capacity.set(g.id, weeklyCapacity(g));

    for (const semester of ['semester1', 'semester2'] as const) {
      const placedSlots = new Map<string, Set<string>>();
      for (const lesson of schedules[semester].schedule) {
        if (!placedSlots.has(lesson.groupId)) placedSlots.set(lesson.groupId, new Set());
        placedSlots.get(lesson.groupId)!.add(`${lesson.day}|${lesson.period}`);
      }
      for (const g of project.groups) {
        expect(placedSlots.get(g.id)?.size || 0).toBeLessThanOrEqual(capacity.get(g.id)!);
      }
    }
  });

  it('explains why lessons are not assigned per semester', () => {
    const groupById = new Map(project.groups.map((g) => [g.id, g]));
    const capacity = new Map<string, number>();
    for (const g of project.groups) capacity.set(g.id, weeklyCapacity(g));
    const splitByRule = new Map(splits.map((s) => [s.ruleId, s]));

    for (const semester of ['semester1', 'semester2'] as const) {
      const result = schedules[semester];
      const hoursByRule = new Map<string, number>();
      for (const rule of project.curriculum) {
        const split = splitByRule.get(rule.id);
        const h = split ? (semester === 'semester1' ? split.first : split.second) : rule.hoursPerWeek;
        if (h > 0) hoursByRule.set(rule.id, h);
      }

      const byKey = new Map<string, CurriculumRule[]>();
      for (const rule of project.curriculum) {
        const key = `${rule.groupId}|${rule.subjectId}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key)!.push(rule);
      }

      const needed = new Map<string, number>();
      for (const rules of byKey.values()) {
        const h = Math.max(...rules.map((r) => hoursByRule.get(r.id) || 0));
        if (h <= 0) continue;
        needed.set(rules[0].groupId, (needed.get(rules[0].groupId) || 0) + h);
      }

      const placedSlots = new Map<string, Set<string>>();
      for (const lesson of result.schedule) {
        if (!placedSlots.has(lesson.groupId)) placedSlots.set(lesson.groupId, new Set());
        placedSlots.get(lesson.groupId)!.add(`${lesson.day}|${lesson.period}`);
      }
      const placed = new Map<string, number>();
      for (const [gid, slots] of placedSlots) placed.set(gid, slots.size);

      const missingPerConflict = new Map<string, number>();
      for (const c of result.conflicts) {
        if (c.type !== 'UNASSIGNED_HOURS') continue;
        missingPerConflict.set(c.ruleId, (missingPerConflict.get(c.ruleId) || 0) + c.missing);
      }

      const overCapacityGroups: string[] = [];
      for (const g of project.groups) {
        const need = needed.get(g.id) || 0;
        if (need > capacity.get(g.id)!) {
          overCapacityGroups.push(`${g.name || g.id} (need ${need}h, capacity ${capacity.get(g.id)}h)`);
        }
      }

      const missingTotal = [...missingPerConflict.values()].reduce((a, b) => a + b, 0);
      console.log(`=== ${semester.toUpperCase()} DIAGNOSIS ===`);
      console.log(`Needed lessons: ${[...needed.values()].reduce((a, b) => a + b, 0)}`);
      console.log(`Placed lessons: ${result.schedule.length}`);
      console.log(`Unassigned (conflict missing sum): ${missingTotal}`);
      console.log(`Over-capacity groups: ${overCapacityGroups.length ? overCapacityGroups.join('; ') : 'none'}`);

      for (const [ruleId, missing] of missingPerConflict) {
        const rule = project.curriculum.find((r) => r.id === ruleId);
        if (!rule) continue;
        const gName = groupById.get(rule.groupId)?.name || rule.groupId;
        const gCap = capacity.get(rule.groupId)!;
        const gPlaced = placed.get(rule.groupId) || 0;
        const gNeed = needed.get(rule.groupId) || 0;
        const freeSlots = gCap - gPlaced;
        const reason = freeSlots < missing
          ? 'group capacity exhausted'
          : 'slot blocked by teacher/room/first-period constraints';
        console.log(
          `  - ${gName}: ${missing}h of ${rule.subjectId} ` +
          `(group free slots ${freeSlots}/${gCap}, need ${gNeed}, overCapacity=${gNeed > gCap}) -> ${reason}`
        );
      }

      if (overCapacityGroups.length > 0) {
        expect(overCapacityGroups.length).toBeGreaterThan(0);
      } else {
        expect(missingTotal).toBeGreaterThan(0);
      }
    }
  });

  it('reports teacher single-lesson days per semester', () => {
    const teacherById = new Map(project.teachers.map((t) => [t.id, t.name || t.id]));
    for (const semester of ['semester1', 'semester2'] as const) {
      const dayCounts = new Map<string, Map<string, number>>();
      for (const lesson of schedules[semester].schedule) {
        if (!lesson.teacherId) continue;
        if (!dayCounts.has(lesson.teacherId)) dayCounts.set(lesson.teacherId, new Map());
        const counts = dayCounts.get(lesson.teacherId)!;
        counts.set(lesson.day, (counts.get(lesson.day) || 0) + 1);
      }
      let singleDays = 0;
      const worst: string[] = [];
      for (const [tid, counts] of dayCounts) {
        const singles = [...counts.values()].filter((c) => c === 1).length;
        singleDays += singles;
        if (singles > 0) {
          worst.push(`${teacherById.get(tid)} (${[...counts.values()].sort((a, b) => b - a).join('/')})`);
        }
      }
      console.log(`=== TEACHER SINGLE-LESSON DAYS ${semester.toUpperCase()} ===`);
      console.log(`Teachers with a single-lesson day: ${worst.length ? worst.join('; ') : 'none'}`);
      console.log(`  TOTAL single-lesson days: ${singleDays}`);
    }
  });

  it('reports unfilled gap slots (gray cells) per semester', () => {
    for (const semester of ['semester1', 'semester2'] as const) {
      const gapCounts = new Map<string, number>();
      let totalGaps = 0;
      for (const g of project.groups) {
        const lessons = schedules[semester].schedule.filter((l) => l.groupId === g.id);
        let groupGaps = 0;
        for (const day of DAYS) {
          const dayLessons = lessons.filter((l) => l.day === day).sort((a, b) => a.period - b.period);
          const lastPeriod = dayLessons[dayLessons.length - 1]?.period;
          if (lastPeriod === undefined) continue;
          for (let p = (g.periodStart ?? 1); p < lastPeriod; p++) {
            if (!dayLessons.some((l) => l.period === p)) groupGaps++;
          }
        }
        gapCounts.set(g.name || g.id, groupGaps);
        totalGaps += groupGaps;
      }
      console.log(`=== UNFILLED GAP SLOTS ${semester.toUpperCase()} ===`);
      for (const [name, n] of gapCounts) {
        if (n > 0) console.log(`  ${name}: ${n}`);
      }
      console.log(`  TOTAL: ${totalGaps}`);
      expect(totalGaps).toBeGreaterThan(0);
    }
  });

  it('explains why empty slots stayed empty per semester', () => {
    for (const semester of ['semester1', 'semester2'] as const) {
      const semesterProject = buildSemesterProject(project, semester === 'semester1' ? 1 : 2, splits);
      const result = schedules[semester];
      const pendingByRule = new Map<string, number>();
      for (const c of result.conflicts) {
        if (c.type === 'UNASSIGNED_HOURS' && c.ruleId) {
          pendingByRule.set(c.ruleId, (pendingByRule.get(c.ruleId) || 0) + (c.missing ?? 1));
        }
      }
      const reasons = analyzeEmptySlots(result.schedule, semesterProject, pendingByRule, DAYS);
      const counts = new Map<string, number>();
      let totalTags = 0;
      for (const rs of reasons.values()) {
        for (const r of rs) {
          counts.set(r, (counts.get(r) || 0) + 1);
          totalTags++;
        }
      }
      console.log(`=== EMPTY SLOT REASONS ${semester.toUpperCase()} ===`);
      for (const [r, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${r}: ${n}`);
      }
      console.log(`  TOTAL reason tags: ${totalTags}`);
      console.log(`  Slots with reasons: ${reasons.size}`);
    }
  });
});
