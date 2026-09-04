import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectState } from '../../shared/types';

vi.mock('jszip', () => {
  const actual = vi.importActual('jszip');
  return actual;
});

const createMockProject = (): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'Test School', address: '123 St' },
  academicYears: [{ id: 'ay1', name: '2024/25', startDate: '2024-09-01', endDate: '2025-06-30' }],
  teachers: [{ id: 't1', name: 'Alice', subjects: ['subj1'] }],
  subjects: [{ id: 'subj1', name: 'Math', shortName: 'M' }],
  rooms: [{ id: 'r1', name: 'Room 101', maxGroups: 1, types: ['classroom'] }],
  groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [] }],
  curriculum: [{ id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' }],
  loadDistribution: [{ teacherId: 't1', subjectId: 'subj1', groupId: 'g1', hours: 5 }],
  constraints: [],
});

describe('ProjectExportService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('importProject', () => {
    it('rejects file without manifest.json', async () => {
      const { importProject } = await import('../../ui/services/ProjectExportService');
      const jszip = await import('jszip');
      const zip = new jszip.default();
      zip.file('teachers.json', '[]');
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.schoolproj');

      await expect(importProject(file)).rejects.toThrow('Invalid .schoolproj');
    });

    it('imports a valid .schoolproj with schedule', async () => {
      const { importProject } = await import('../../ui/services/ProjectExportService');
      const jszip = await import('jszip');
      const zip = new jszip.default();

      const manifest = {
        version: '1.0.0',
        school: { id: 's1', name: 'Test School' },
        exportedAt: '2024-01-01T00:00:00.000Z',
        files: ['academic_years.json', 'teachers.json', 'subjects.json', 'rooms.json',
          'groups.json', 'curriculum.json', 'load_distribution.json', 'constraints.json', 'schedule.json'],
      };

      zip.file('manifest.json', JSON.stringify(manifest));
      zip.file('academic_years.json', JSON.stringify([{ id: 'ay1', name: '2024/25', startDate: '2024-09-01', endDate: '2025-06-30' }]));
      zip.file('teachers.json', JSON.stringify([]));
      zip.file('subjects.json', JSON.stringify([]));
      zip.file('rooms.json', JSON.stringify([]));
      zip.file('groups.json', JSON.stringify([]));
      zip.file('curriculum.json', JSON.stringify([]));
      zip.file('load_distribution.json', JSON.stringify([]));
      zip.file('constraints.json', JSON.stringify([]));
      zip.file('schedule.json', JSON.stringify({ schedule: [], conflicts: [], score: 1 }));

      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.schoolproj');

      const project = await importProject(file);

      expect(project.version).toBe('1.0.0');
      expect(project.school.name).toBe('Test School');
      expect(project.generatedSchedule).toBeDefined();
      expect(project.generatedSchedule!.score).toBe(1);
    });

    it('imports a minimal .schoolproj without schedule', async () => {
      const { importProject } = await import('../../ui/services/ProjectExportService');
      const jszip = await import('jszip');
      const zip = new jszip.default();

      const manifest = {
        version: '1.0.0',
        school: { id: 's1', name: 'Minimal School' },
        exportedAt: '2024-01-01T00:00:00.000Z',
        files: ['academic_years.json'],
      };

      zip.file('manifest.json', JSON.stringify(manifest));

      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.schoolproj');

      const project = await importProject(file);

      expect(project.school.name).toBe('Minimal School');
      expect(project.teachers).toEqual([]);
      expect(project.generatedSchedule).toBeNull();
    });

    it('recovers gracefully from corrupt entity JSON', async () => {
      const { importProject } = await import('../../ui/services/ProjectExportService');
      const jszip = await import('jszip');
      const zip = new jszip.default();

      const manifest = {
        version: '1.0.0',
        school: { id: 's1', name: 'Recovery School' },
        exportedAt: '2024-01-01T00:00:00.000Z',
        files: ['teachers.json'],
      };

      zip.file('manifest.json', JSON.stringify(manifest));
      zip.file('teachers.json', 'not valid json{{{');

      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.schoolproj');

      const project = await importProject(file);

      expect(project.school.name).toBe('Recovery School');
      expect(project.teachers).toEqual([]);
    });
  });

  describe('exportProject', () => {
    it('generates a downloadable .schoolproj', async () => {
      const { exportProject } = await import('../../ui/services/ProjectExportService');
      const project = createMockProject();

      const linkClicks: HTMLAnchorElement[] = [];
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        const el = origCreateElement(tagName, options);
        if (tagName === 'a') {
          linkClicks.push(el as HTMLAnchorElement);
          vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {});
        }
        return el;
      });

      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      await exportProject(project);

      expect(linkClicks.length).toBeGreaterThan(0);
      expect(linkClicks[0].download).toContain('Test_School');

      createElementSpy.mockRestore();
      revokeSpy.mockRestore();
    });

    it('writes locked_lessons.json and round-trips locked lessons through import', async () => {
      const { exportProject, importProject } = await import('../../ui/services/ProjectExportService');
      const jszip = await import('jszip');

      const project = createMockProject();
      project.lockedLessons = [
        { ruleId: 'c1', day: 'Monday', period: 1, semester: 'semester1' },
        { ruleId: 'c1', day: 'Tuesday', period: 3, semester: 'semester2' },
      ];

      // Capture the Blob that exportProject hands to URL.createObjectURL.
      let capturedBlob: Blob | undefined;
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
        const el = origCreateElement(tagName, options);
        if (tagName === 'a') {
          vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {});
        }
        return el;
      });
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
      const createObjUrlSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: unknown) => {
        capturedBlob = obj as Blob;
        return 'blob:mock';
      });

      await exportProject(project);
      createElementSpy.mockRestore();
      revokeSpy.mockRestore();
      createObjUrlSpy.mockRestore();

      expect(capturedBlob).toBeDefined();
      const zip = await jszip.default.loadAsync(capturedBlob!);
      expect(zip.file('locked_lessons.json')).toBeDefined();
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
      expect(manifest.files).toContain('locked_lessons.json');
      const serialized = JSON.parse(await zip.file('locked_lessons.json')!.async('string'));
      expect(serialized).toEqual(project.lockedLessons);

      // Round-trip: import the same blob back and verify locks survive.
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.schoolproj');
      const imported = await importProject(file);
      expect(imported.lockedLessons).toEqual(project.lockedLessons);
    });
  });
});
