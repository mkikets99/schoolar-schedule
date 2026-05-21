import { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Modal, FormField } from './Modal';
import { parseFile, ImportFormat, getTemplateData } from '../services/UniversalImportService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  type: 'teacher' | 'subject' | 'room' | 'group';
  onImport: (data: any[]) => void;
}

export const ImportWizard = ({ isOpen, onClose, type, onImport }: Props) => {
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [previewData, setPreviewData] = useState<any[]>([]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Auto-detect format
      let detectedFormat: ImportFormat = 'json';
      if (selectedFile.name.endsWith('.csv')) detectedFormat = 'csv';
      else if (selectedFile.name.endsWith('.xlsx')) detectedFormat = 'xlsx';
      
      setFormat(detectedFormat);
      const data = await parseFile(selectedFile, detectedFormat);
      setPreviewData(data.slice(0, 5));
    }
  };

  const handleDownloadTemplate = () => {
    const data = getTemplateData(type);
    let content: Blob;
    let extension = 'json';

    if (format === 'csv') {
      content = new Blob([Papa.unparse(data as any)], { type: 'text/csv' });
      extension = 'csv';
    } else if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      content = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      extension = 'xlsx';
    } else {
      content = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    }

    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}_template.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Import ${type}s`}>
      <FormField label="Choose Format">
        <select value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)}>
          <option value="csv">CSV</option>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="json">JSON</option>
        </select>
      </FormField>

      <div style={{ marginBottom: '1rem' }}>
        <button onClick={handleDownloadTemplate} className="secondary-btn">Download Template</button>
      </div>

      <FormField label="Select File">
        <input type="file" onChange={handleFileChange} accept=".csv,.xlsx,.json" />
      </FormField>

      {previewData.length > 0 && (
        <div className="preview-area">
          <h4>Preview (first 5 rows):</h4>
          <div style={{ overflowX: 'auto', border: '1px solid #333', borderRadius: '4px' }}>
            <table className="editor-table" style={{ fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  {Object.keys(previewData[0]).map(key => <th key={key}>{key}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewData.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((val: any, j) => <td key={j}>{val}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
        <button onClick={onClose} className="secondary-btn">Cancel</button>
        <button 
          onClick={() => { onImport(previewData); onClose(); }} 
          className="primary-btn"
          disabled={previewData.length === 0}
        >
          Confirm Import
        </button>
      </div>
    </Modal>
  );
};
