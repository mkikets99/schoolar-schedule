import JSZip from 'jszip';
import { ProjectState } from '../../shared/types';

/**
 * Service for exporting and importing project files.
 * Format: .schoolproj (A ZIP archive containing multiple JSON files and a manifest)
 */

export const exportProject = async (project: ProjectState) => {
  const zip = new JSZip();

  // 1. Manifest
  const manifest = {
    version: project.version || '1.0.0',
    school: project.school,
    exportedAt: new Date().toISOString(),
    files: [
      'academic_years.json',
      'teachers.json',
      'subjects.json',
      'rooms.json',
      'groups.json',
      'curriculum.json',
      'load_distribution.json',
      'constraints.json',
      'schedule.json',
      'semester_schedules.json',
      'semester_splits.json'
    ]
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  // 2. Entity Files
  zip.file('academic_years.json', JSON.stringify(project.academicYears, null, 2));
  zip.file('teachers.json', JSON.stringify(project.teachers, null, 2));
  zip.file('subjects.json', JSON.stringify(project.subjects, null, 2));
  zip.file('rooms.json', JSON.stringify(project.rooms, null, 2));
  zip.file('groups.json', JSON.stringify(project.groups, null, 2));
  zip.file('curriculum.json', JSON.stringify(project.curriculum, null, 2));
  zip.file('load_distribution.json', JSON.stringify(project.loadDistribution, null, 2));
  zip.file('constraints.json', JSON.stringify(project.constraints, null, 2));
  
  if (project.generatedSchedules) {
    zip.file('semester_schedules.json', JSON.stringify(project.generatedSchedules, null, 2));
    zip.file('schedule.json', JSON.stringify(project.generatedSchedules.semester1, null, 2));
  } else if (project.generatedSchedule) {
    zip.file('schedule.json', JSON.stringify(project.generatedSchedule, null, 2));
  }

  if (project.generatedSplits && project.generatedSplits.length > 0) {
    zip.file('semester_splits.json', JSON.stringify(project.generatedSplits, null, 2));
  }

  const content = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(content);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.school.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.schoolproj`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const importProject = async (file: File): Promise<ProjectState> => {
  try {
    const zip = await JSZip.loadAsync(file);
    
    // Load manifest first
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Missing manifest.json');
    }
    const manifest = JSON.parse(await manifestFile.async('string'));

    // Helper to read entity file
    const readJson = async (filename: string, defaultValue: any = []) => {
      try {
        const f = zip.file(filename);
        if (!f) return defaultValue;
        const content = await f.async('string');
        const parsed = JSON.parse(content);
        return parsed ?? defaultValue;
      } catch (e) {
        console.warn(`Failed to parse ${filename}, using default`, e);
        return defaultValue;
      }
    };

    // Reconstruct project state with defensive defaults
    const project: ProjectState = {
      version: manifest.version || '1.0.0',
      school: manifest.school || { id: crypto.randomUUID(), name: 'Imported School' },
      academicYears: await readJson('academic_years.json'),
      teachers: await readJson('teachers.json'),
      subjects: await readJson('subjects.json'),
      rooms: await readJson('rooms.json'),
      groups: await readJson('groups.json'),
      curriculum: await readJson('curriculum.json'),
      loadDistribution: await readJson('load_distribution.json'),
      constraints: await readJson('constraints.json'),
      generatedSchedule: await readJson('schedule.json', null),
      generatedSchedules: await readJson('semester_schedules.json', undefined),
      generatedSplits: await readJson('semester_splits.json', undefined)
    };

    
    // Final check for mandatory structure in generatedSchedule
    if (project.generatedSchedule && !Array.isArray(project.generatedSchedule)) {
      if (!Array.isArray(project.generatedSchedule.schedule)) project.generatedSchedule.schedule = [];
      if (!Array.isArray(project.generatedSchedule.conflicts)) project.generatedSchedule.conflicts = [];
      if (typeof project.generatedSchedule.score !== 'number') project.generatedSchedule.score = 0;
    }

    if (project.generatedSchedules && !Array.isArray(project.generatedSchedules)) {
      for (const semester of ['semester1', 'semester2'] as const) {
        const result = project.generatedSchedules[semester];
        if (!result || !Array.isArray(result.schedule)) {
          project.generatedSchedules[semester] = { schedule: [], conflicts: [], score: 0 };
        } else {
          if (!Array.isArray(result.conflicts)) result.conflicts = [];
          if (typeof result.score !== 'number') result.score = 0;
        }
      }
    }
    
    return project;
  } catch (err) {
    console.error('Import failed:', err);
    throw new Error('Failed to import project. Invalid .schoolproj structure.');
  }
};
