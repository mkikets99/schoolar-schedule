import { ProjectState } from '../shared/types';

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      self.postMessage({ type: 'READY' });
      break;

    case 'GENERATE_SCHEDULE':
      generateSchedule(payload as ProjectState);
      break;

    default:
      console.warn('Worker: Unknown message type', type);
  }
};

async function generateSchedule(project: ProjectState) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const maxPeriod = 8;
  const allRooms = project.rooms || [];

  self.postMessage({ type: 'PROGRESS', payload: { progress: 2 } });

  const teacherBusy = new Set<string>();
  const groupBusy = new Set<string>();
  const roomBusy = new Set<string>();

  const byGroup = new Map<string, typeof project.curriculum>();
  for (const rule of project.curriculum) {
    if (!byGroup.has(rule.groupId)) byGroup.set(rule.groupId, []);
    byGroup.get(rule.groupId)!.push(rule);
  }

  const dailyTargets = new Map<string, number[]>();
  for (const [gid, rules] of byGroup) {
    const total = rules.reduce((s, r) => s + r.hoursPerWeek, 0);
    const targets = days.map(() => 0);
    for (let h = 0; h < total; h++) targets[h % 5]++;
    dailyTargets.set(gid, targets);
  }

  const dailyCounts = new Map<string, number[]>();
  for (const gid of byGroup.keys()) {
    dailyCounts.set(gid, days.map(() => 0));
  }

  const lessons: Array<{
    id: string;
    ruleId: string;
    groupId: string;
    subjectId: string;
    teacherId?: string;
    roomId?: string;
  }> = [];

  for (const rule of project.curriculum) {
    for (let h = 0; h < rule.hoursPerWeek; h++) {
      lessons.push({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        groupId: rule.groupId,
        subjectId: rule.subjectId,
        teacherId: rule.teacherId,
        roomId: rule.roomId,
      });
    }
  }

  lessons.sort((a, b) => {
    const ga = dailyTargets.get(a.groupId)!.reduce((s, v) => s + v, 0);
    const gb = dailyTargets.get(b.groupId)!.reduce((s, v) => s + v, 0);
    if (ga !== gb) return gb - ga;
    const ta = a.teacherId || '';
    const tb = b.teacherId || '';
    return ta.localeCompare(tb);
  });

  const schedule: any[] = [];
  const conflicts: any[] = [];
  const totalLessons = lessons.length;
  let lessonsAssigned = 0;

  self.postMessage({ type: 'PROGRESS', payload: { progress: 5 } });

  function tryAssign(lesson: typeof lessons[0], day: string, period: number): boolean {
    const slotKey = `${day}-${period}`;
    if (groupBusy.has(`${lesson.groupId}-${slotKey}`)) return false;
    if (lesson.teacherId && teacherBusy.has(`${lesson.teacherId}-${slotKey}`)) return false;

    let roomId = lesson.roomId;
    if (roomId && roomBusy.has(`${roomId}-${slotKey}`)) {
      const alt = allRooms.find(r => r.capacity !== undefined && !roomBusy.has(`${r.id}-${slotKey}`));
      if (alt) roomId = alt.id;
      else return false;
    }

    schedule.push({
      id: lesson.id,
      ruleId: lesson.ruleId,
      groupId: lesson.groupId,
      subjectId: lesson.subjectId,
      teacherId: lesson.teacherId,
      roomId,
      day,
      period,
    });

    groupBusy.add(`${lesson.groupId}-${slotKey}`);
    if (lesson.teacherId) teacherBusy.add(`${lesson.teacherId}-${slotKey}`);
    roomBusy.add(`${roomId || lesson.roomId}-${slotKey}`);

    const di = days.indexOf(day);
    if (di >= 0) dailyCounts.get(lesson.groupId)![di]++;
    lessonsAssigned++;
    return true;
  }

  for (const lesson of lessons) {
    const targets = dailyTargets.get(lesson.groupId)!;
    const counts = dailyCounts.get(lesson.groupId)!;
    let assigned = false;

    const dayScores = days.map((day, di) => ({
      day,
      index: di,
      need: targets[di] - counts[di],
    }));

    dayScores.sort((a, b) => b.need - a.need);

    for (const ds of dayScores) {
      if (assigned) break;
      if (ds.need <= 0) {
        for (let p = 1; p <= maxPeriod; p++) {
          if (tryAssign(lesson, ds.day, p)) { assigned = true; break; }
        }
      } else {
        for (let p = 1; p <= maxPeriod; p++) {
          if (lesson.teacherId) {
            const prevBusy = teacherBusy.has(`${lesson.teacherId}-${ds.day}-${p - 1}`);
            const nextBusy = teacherBusy.has(`${lesson.teacherId}-${ds.day}-${p + 1}`);
            if (prevBusy || nextBusy) {
              if (tryAssign(lesson, ds.day, p)) { assigned = true; break; }
            }
          }
        }
        if (!assigned) {
          for (let p = 1; p <= maxPeriod; p++) {
            if (tryAssign(lesson, ds.day, p)) { assigned = true; break; }
          }
        }
      }
    }

    if (!assigned) {
      for (const day of days) {
        if (assigned) break;
        for (let p = 1; p <= maxPeriod; p++) {
          if (tryAssign(lesson, day, p)) { assigned = true; break; }
        }
      }
    }

    if (!assigned) {
      conflicts.push({
        type: 'UNASSIGNED_HOURS',
        ruleId: lesson.ruleId,
        missing: 1,
      });
    }

    if (lessonsAssigned % 5 === 0 || lessonsAssigned === totalLessons || !assigned) {
      const progress = 5 + Math.floor((lessonsAssigned / totalLessons) * 90);
      self.postMessage({ type: 'PROGRESS', payload: { progress } });
    }
  }

  await sleep(200);

  const totalHours = project.curriculum.reduce((s, r) => s + r.hoursPerWeek, 0);
  self.postMessage({
    type: 'RESULT',
    payload: {
      schedule,
      conflicts,
      score: totalHours > 0 ? lessonsAssigned / totalHours : 0,
    },
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
