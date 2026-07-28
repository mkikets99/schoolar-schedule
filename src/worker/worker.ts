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
    const ta = a.teacherId || '';
    const tb = b.teacherId || '';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.groupId.localeCompare(b.groupId);
  });

  const schedule: any[] = [];
  const conflicts: any[] = [];
  const totalLessons = lessons.length;
  let lessonsAssigned = 0;

  self.postMessage({ type: 'PROGRESS', payload: { progress: 5 } });

  for (const lesson of lessons) {
    const targets = dailyTargets.get(lesson.groupId)!;
    const counts = dailyCounts.get(lesson.groupId)!;

    const dayScores = days.map((day, di) => {
      let score = targets[di] - counts[di];
      if (lesson.teacherId) {
        for (let p = 1; p <= maxPeriod; p++) {
          if (teacherBusy.has(`${lesson.teacherId}-${day}-${p}`)) score += 0.5;
        }
      }
      return { day, index: di, score };
    });

    dayScores.sort((a, b) => b.score - a.score);

    let assigned = false;

    for (const ds of dayScores) {
      if (assigned) break;

      const periodScores: { period: number; score: number }[] = [];

      for (let p = 1; p <= maxPeriod; p++) {
        const slotKey = `${ds.day}-${p}`;
        if (groupBusy.has(`${lesson.groupId}-${slotKey}`)) continue;
        if (lesson.teacherId && teacherBusy.has(`${lesson.teacherId}-${slotKey}`)) continue;
        if (lesson.roomId && roomBusy.has(`${lesson.roomId}-${slotKey}`)) continue;

        let score = 0;
        if (lesson.teacherId) {
          if (teacherBusy.has(`${lesson.teacherId}-${ds.day}-${p - 1}`)) score += 10;
          if (teacherBusy.has(`${lesson.teacherId}-${ds.day}-${p + 1}`)) score += 10;
        }

        periodScores.push({ period: p, score });
      }

      if (periodScores.length === 0) continue;

      periodScores.sort((a, b) => b.score - a.score);
      const best = periodScores[0];

      schedule.push({
        id: lesson.id,
        ruleId: lesson.ruleId,
        groupId: lesson.groupId,
        subjectId: lesson.subjectId,
        teacherId: lesson.teacherId,
        roomId: lesson.roomId,
        day: ds.day,
        period: best.period,
      });

      const slotKey = `${ds.day}-${best.period}`;
      groupBusy.add(`${lesson.groupId}-${slotKey}`);
      if (lesson.teacherId) teacherBusy.add(`${lesson.teacherId}-${slotKey}`);
      if (lesson.roomId) roomBusy.add(`${lesson.roomId}-${slotKey}`);

      counts[ds.index]++;
      lessonsAssigned++;
      assigned = true;
    }

    if (!assigned) {
      for (const day of days) {
        if (assigned) break;
        for (let p = 1; p <= maxPeriod; p++) {
          const slotKey = `${day}-${p}`;
          if (groupBusy.has(`${lesson.groupId}-${slotKey}`)) continue;
          if (lesson.teacherId && teacherBusy.has(`${lesson.teacherId}-${slotKey}`)) continue;
          if (lesson.roomId && roomBusy.has(`${lesson.roomId}-${slotKey}`)) continue;

          schedule.push({
            id: lesson.id,
            ruleId: lesson.ruleId,
            groupId: lesson.groupId,
            subjectId: lesson.subjectId,
            teacherId: lesson.teacherId,
            roomId: lesson.roomId,
            day,
            period: p,
          });

          groupBusy.add(`${lesson.groupId}-${slotKey}`);
          if (lesson.teacherId) teacherBusy.add(`${lesson.teacherId}-${slotKey}`);
          if (lesson.roomId) roomBusy.add(`${lesson.roomId}-${slotKey}`);
          lessonsAssigned++;
          assigned = true;
          break;
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

    const progress = 5 + Math.floor((lessonsAssigned / totalLessons) * 90);
    if (lessonsAssigned % 2 === 0 || lessonsAssigned === totalLessons) {
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
