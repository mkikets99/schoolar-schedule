import { ProjectState, Lesson } from '../shared/types';
import { generateSemesterSchedules } from './generator';
import { suggestRearrange } from './rearrange';

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      self.postMessage({
        type: 'READY',
        payload: { version: __APP_VERSION__, buildDate: __BUILD_DATE__, buildVersion: __BUILD_VERSION__ },
      });
      break;

    case 'GENERATE_SCHEDULE': {
      const project = payload?.project ?? payload;
      const settings = payload?.settings;
      generateSemesterSchedules(project as ProjectState, (msg) => self.postMessage(msg), settings);
      break;
    }

    case 'REARRANGE': {
      const project = payload?.project ?? {};
      const schedule: Lesson[] = payload?.schedule ?? [];
      const lessonId: string = payload?.lessonId;
      const target: { day: string; period: number } = payload?.target ?? {};
      const reassignTeacherId: string | undefined = payload?.teacherId;
      const suggestion = suggestRearrange(
        project as ProjectState,
        schedule,
        lessonId,
        target,
        reassignTeacherId
      );
      self.postMessage({ type: 'REARRANGE_RESULT', payload: suggestion });
      break;
    }

    default:
      console.warn('Worker: Unknown message type', type);
  }
};
