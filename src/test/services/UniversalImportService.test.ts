import { describe, it, expect } from 'vitest';
import { parseFile, getTemplateData, ImportFormat } from '../../ui/services/UniversalImportService';

function makeFile(content: string, filename: string, type: string): File {
  return new File([content], filename, { type });
}

describe('UniversalImportService', () => {
  describe('parseFile', () => {
    it('parses CSV files', async () => {
      const csv = 'name,grade\n10-A,10\n11-B,11\n';
      const data = await parseFile(makeFile(csv, 'test.csv', 'text/csv'), 'csv');

      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('10-A');
      expect(data[0].grade).toBe('10');
    });

    it('parses JSON files', async () => {
      const json = '[{"name":"10-A","grade":10},{"name":"11-B","grade":11}]';
      const data = await parseFile(makeFile(json, 'test.json', 'application/json'), 'json');

      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('10-A');
      expect(data[0].grade).toBe(10);
    });

    it('throws on unsupported format', async () => {
      const txt = 'hello';
      await expect(parseFile(makeFile(txt, 'test.txt', 'text/plain'), 'txt' as ImportFormat)).rejects.toThrow('Unsupported format');
    });
  });

  describe('getTemplateData', () => {
    it('returns teacher template', () => {
      const data = getTemplateData('teacher');
      expect(data).toEqual([{ Name: 'John Doe', ShortName: 'JD' }]);
    });

    it('returns subject template', () => {
      const data = getTemplateData('subject');
      expect(data).toEqual([{ Name: 'Mathematics', Code: 'MATH' }]);
    });

    it('returns room template', () => {
      const data = getTemplateData('room');
      expect(data).toEqual([{ Name: 'Room 101', Capacity: 30 }]);
    });

    it('returns group template', () => {
      const data = getTemplateData('group');
      expect(data).toEqual([{ Name: '10-A', Grade: 10 }]);
    });
  });
});
