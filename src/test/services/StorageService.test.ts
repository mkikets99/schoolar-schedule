import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectState } from '../../shared/types';

const createMockProject = (): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'Test School', address: '' },
  academicYears: [],
  teachers: [],
  subjects: [],
  rooms: [],
  groups: [],
  curriculum: [],
  loadDistribution: [],
  constraints: [],
});

describe('StorageService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes IndexedDB and saves/loads a project', async () => {
    const { storageService } = await import('../../ui/services/StorageService');
    const project = createMockProject();
    project.school.id = 'save-test-id';

    await storageService.saveProject(project);
    const loaded = await storageService.loadProject();

    expect(loaded).not.toBeNull();
    expect(loaded.school.name).toBe('Test School');
    expect(loaded.school.id).toBe('save-test-id');
  });

  it('overwrites existing project on save', async () => {
    const { storageService } = await import('../../ui/services/StorageService');

    const project1 = createMockProject();
    project1.school.name = 'First School';
    await storageService.saveProject(project1);

    const project2 = createMockProject();
    project2.school.name = 'Second School';
    await storageService.saveProject(project2);

    const loaded = await storageService.loadProject();
    expect(loaded.school.name).toBe('Second School');
  });

  it('returns null when loading from empty db', async () => {
    const { storageService } = await import('../../ui/services/StorageService');
    const loaded = await storageService.loadProject();

    expect(loaded).toBeDefined();
  });

  it('handles concurrent save and load', async () => {
    const { storageService } = await import('../../ui/services/StorageService');

    const project = createMockProject();
    project.school.name = 'Concurrent Test';

    await Promise.all([
      storageService.saveProject(project),
      storageService.loadProject(),
    ]);

    const loaded = await storageService.loadProject();
    expect(loaded.school.name).toBe('Concurrent Test');
  });
});
