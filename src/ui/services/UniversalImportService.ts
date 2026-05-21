import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type ImportFormat = 'csv' | 'xlsx' | 'json';

export const parseFile = async (file: File, format: ImportFormat): Promise<any[]> => {
  if (format === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
        error: (error) => reject(error)
      });
    });
  }

  if (format === 'xlsx') {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(worksheet);
  }

  if (format === 'json') {
    const text = await file.text();
    return JSON.parse(text);
  }

  throw new Error('Unsupported format');
};

export const getTemplateData = (type: 'teacher' | 'subject' | 'room' | 'group') => {
  switch(type) {
    case 'teacher': return [{ Name: 'John Doe', ShortName: 'JD' }];
    case 'subject': return [{ Name: 'Mathematics', Code: 'MATH' }];
    case 'room': return [{ Name: 'Room 101', Capacity: 30 }];
    case 'group': return [{ Name: '10-A', Grade: 10 }];
  }
};
