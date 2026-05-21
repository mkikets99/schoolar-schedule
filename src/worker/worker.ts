import { ProjectState } from '../shared/types';

/**
 * Scheduling Engine Web Worker
 */

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      console.log('Worker: Initializing...');
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
  console.log('Worker: Generating schedule...', project);
  
  self.postMessage({ type: 'PROGRESS', payload: { progress: 5 } });
  
  // Phase 1: Initialization
  const timeSlots = buildTimeSlots();
  const schedule: any[] = [];
  const conflicts: any[] = [];
  
  // Track availability
  const teacherBusy = new Set<string>(); // "teacherId-day-period"
  const groupBusy = new Set<string>();   // "groupId-day-period"
  const roomBusy = new Set<string>();    // "roomId-day-period"

  self.postMessage({ type: 'PROGRESS', payload: { progress: 10 } });

  // Phase 2: Base Assignment
  let lessonsAssigned = 0;
  const totalHours = project.curriculum.reduce((sum, r) => sum + r.hoursPerWeek, 0);

  for (const rule of project.curriculum) {
    const hoursNeeded = rule.hoursPerWeek;
    let hoursAssigned = 0;

    // Try to find slots for each hour
    for (const slot of timeSlots) {
      if (hoursAssigned >= hoursNeeded) break;

      const slotKey = `${slot.day}-${slot.period}`;
      const tKey = `${rule.teacherId}-${slotKey}`;
      const gKey = `${rule.groupId}-${slotKey}`;
      const rKey = `${rule.roomId}-${slotKey}`;

      const isTeacherBusy = rule.teacherId && teacherBusy.has(tKey);
      const isGroupBusy = groupBusy.has(gKey);
      const isRoomBusy = rule.roomId && roomBusy.has(rKey);

      if (!isTeacherBusy && !isGroupBusy && !isRoomBusy) {
        // Assign!
        schedule.push({
          id: crypto.randomUUID(),
          ruleId: rule.id,
          groupId: rule.groupId,
          subjectId: rule.subjectId,
          teacherId: rule.teacherId,
          roomId: rule.roomId,
          day: slot.day,
          period: slot.period
        });

        if (rule.teacherId) teacherBusy.add(tKey);
        groupBusy.add(gKey);
        if (rule.roomId) roomBusy.add(rKey);

        hoursAssigned++;
        lessonsAssigned++;
      }
    }

    if (hoursAssigned < hoursNeeded) {
      conflicts.push({
        type: 'UNASSIGNED_HOURS',
        ruleId: rule.id,
        missing: hoursNeeded - hoursAssigned
      });
    }

    const progress = 10 + Math.floor((lessonsAssigned / totalHours) * 80);
    self.postMessage({ type: 'PROGRESS', payload: { progress } });
  }

  await sleep(300);
  
  self.postMessage({ 
    type: 'RESULT', 
    payload: { 
      schedule, 
      conflicts,
      score: lessonsAssigned / totalHours
    } 
  });
}

function buildTimeSlots() {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periods = [1, 2, 3, 4, 5, 6, 7, 8];
  const slots = [];

  for (const day of days) {
    for (const period of periods) {
      slots.push({ day, period });
    }
  }
  return slots;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
