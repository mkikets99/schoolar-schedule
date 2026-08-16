import { ProjectState } from '../shared/types';
import { generateSemesterSchedules } from './generator';

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      self.postMessage({
        type: 'READY',
        payload: { version: __APP_VERSION__, buildDate: __BUILD_DATE__, buildVersion: __BUILD_VERSION__ },
      });
      break;

    case 'GENERATE_SCHEDULE':
      generateSemesterSchedules(payload as ProjectState, (msg) => self.postMessage(msg));
      break;

    default:
      console.warn('Worker: Unknown message type', type);
  }
};
