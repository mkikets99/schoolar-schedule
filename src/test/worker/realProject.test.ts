import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { ProjectState, CurriculumRule } from '../../shared/types';
import { generateSchedule } from '../../worker/generator';

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

// The worker builds lessons with `for (let h = 0; h < hoursPerWeek; h++)`,
// which yields Math.ceil(hoursPerWeek) lessons for fractional hours.
function ceilHours(hours: number): number {
  return hours <= 0 ? 0 : Math.ceil(hours);
}

function buildExpectedUnits(project: ProjectState, mode: 'ceil' | 'floor'): Map<string, number> {
  const byGroup = new Map<string, number>();
  const seen = new Map<string, CurriculumRule[]>();
  for (const rule of project.curriculum) {
    const key = `${rule.groupId}|${rule.subjectId}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(rule);
  }
  for (const [key, rules] of seen) {
    const [groupId] = key.split('|');
    const lessons = rules.length > 1
      ? (mode === 'ceil' ? ceilHours(rules[0].hoursPerWeek) : Math.floor(rules[0].hoursPerWeek)) * rules.length
      : (mode === 'ceil' ? ceilHours(rules[0].hoursPerWeek) : Math.floor(rules[0].hoursPerWeek));
    byGroup.set(groupId, (byGroup.get(groupId) || 0) + lessons);
  }
  return byGroup;
}

function weeklyCapacity(group: any): number {
  const periodCount = (group.periodEnd ?? 8) - (group.periodStart ?? 1) + 1;
  const maxDaily = Math.min(group.maxDailyLessons ?? 8, periodCount);
  return maxDaily * 5;
}

describe.skipIf(!hasRealProject)('Real project generation (real_test.schoolproj)', () => {
  let project!: ProjectState;
  let result!: { schedule: any[]; conflicts: any[]; score: number };

  beforeAll(async () => {
    project = await loadRealProject();
    const messages: { type: string; payload?: any }[] = [];
    await generateSchedule(project, (msg) => messages.push(msg));
    const res = messages.find((m) => m.type === 'RESULT');
    expect(res).toBeDefined();
    result = res!.payload;
  });

  it('loads a real project', () => {
    expect(project.teachers.length).toBeGreaterThan(0);
    expect(project.groups.length).toBeGreaterThan(0);
    expect(project.curriculum.length).toBeGreaterThan(0);
  });

  it('produces a schedule result with the real worker algorithm', () => {
    expect(result.schedule.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThan(0);
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

    const teacherSlot = new Set<string>();
    const roomSlot = new Set<string>();
    const groupSlotRules = new Map<string, string[]>();
    for (const lesson of result.schedule) {
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
  });

  it('explains why lessons are not assigned', () => {
    const groupById = new Map(project.groups.map((g) => [g.id, g]));
    const expectedCeil = buildExpectedUnits(project, 'ceil');
    const expectedFloor = buildExpectedUnits(project, 'floor');
    const expectedCeilTotal = [...expectedCeil.values()].reduce((a, b) => a + b, 0);
    const expectedFloorTotal = [...expectedFloor.values()].reduce((a, b) => a + b, 0);

    const capacity = new Map<string, number>();
    for (const g of project.groups) capacity.set(g.id, weeklyCapacity(g));

    const placedPerGroup = new Map<string, number>();
    for (const lesson of result.schedule) {
      placedPerGroup.set(lesson.groupId, (placedPerGroup.get(lesson.groupId) || 0) + 1);
    }

    const missingPerConflict = new Map<string, number>();
    for (const c of result.conflicts) {
      if (c.type !== 'UNASSIGNED_HOURS') continue;
      missingPerConflict.set(c.ruleId, (missingPerConflict.get(c.ruleId) || 0) + c.missing);
    }
    const ruleById = new Map(project.curriculum.map((r) => [r.id, r]));

    const overCapacityGroups: string[] = [];
    for (const g of project.groups) {
      const need = expectedCeil.get(g.id) || 0;
      if (need > capacity.get(g.id)!) {
        overCapacityGroups.push(
          `${g.name || g.id} (generates ${need}h, capacity ${capacity.get(g.id)}h)`
        );
      }
    }

    console.log('=== REAL PROJECT DIAGNOSIS ===');
    console.log(`Curriculum rules: ${project.curriculum.length}`);
    console.log(`Lessons if fractional hours floored: ${expectedFloorTotal}`);
    console.log(`Lessons the worker generates (fractional rounded up by h<hours loop): ${expectedCeilTotal}`);
    console.log(`Placed lessons: ${result.schedule.length}`);
    console.log(`Unassigned (conflict missing sum): ${[...missingPerConflict.values()].reduce((a, b) => a + b, 0)}`);
    console.log(`Over-capacity groups: ${overCapacityGroups.length ? overCapacityGroups.join('; ') : 'none'}`);

    for (const g of project.groups) {
      const placed = placedPerGroup.get(g.id) || 0;
      const cap = capacity.get(g.id)!;
      const need = expectedCeil.get(g.id) || 0;
      const flag = need > cap || placed > cap ? '  <-- PROBLEM' : '';
      if (need > cap || placed > cap || placed === cap) {
        console.log(`  ${g.name || g.id}: need ${need}, placed ${placed}, capacity ${cap}${flag}`);
      }
    }

    console.log(`Conflict rules: ${missingPerConflict.size}`);
    for (const [ruleId, missing] of missingPerConflict) {
      const rule = ruleById.get(ruleId);
      const group = rule ? groupById.get(rule.groupId) : undefined;
      const gName = group?.name || rule?.groupId || 'unknown';
      const gCap = rule ? capacity.get(rule.groupId)! : 0;
      const gPlaced = rule ? placedPerGroup.get(rule.groupId) || 0 : 0;
      const gNeed = rule ? expectedCeil.get(rule.groupId) || 0 : 0;
      const freeSlots = gCap - gPlaced;
      const reason = freeSlots < missing
        ? 'group capacity exhausted'
        : 'slot blocked by teacher/room/first-period constraints';
      console.log(
        `  - ${gName}: ${missing}h of ${rule?.subjectId || ruleId} ` +
        `(group free slots ${freeSlots}/${gCap}, need ${gNeed}, overCapacity=${gNeed > gCap}) -> ${reason}`
      );
    }

    expect(overCapacityGroups.length).toBeGreaterThan(0);
    for (const g of project.groups) {
      expect(placedPerGroup.get(g.id) || 0).toBeLessThanOrEqual(capacity.get(g.id)!);
    }
  });

  it('reports unfilled gap slots (gray cells) for display groups', () => {
    const gapCounts = new Map<string, number>();
    let totalGaps = 0;
    for (const g of project.groups) {
      const lessons = result.schedule.filter((l) => l.groupId === g.id);
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
    console.log('=== UNFILLED GAP SLOTS ===');
    for (const [name, n] of gapCounts) {
      if (n > 0) console.log(`  ${name}: ${n}`);
    }
    console.log(`  TOTAL: ${totalGaps}`);
    expect(totalGaps).toBeGreaterThan(0);
  });
});
