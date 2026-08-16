import { jsPDF } from 'jspdf';
import ExcelJS from 'exceljs';
import type { TFunction } from 'i18next';
import { Group, Teacher, Subject, Room, Lesson } from '../../shared/types';
import { ensureFonts } from '../../utils/pdfFonts';

export type ExportFormat = 'pdf' | 'xlsx';
export type ExportReportType = 'all' | 'with_teachers' | 'only_lessons' | 'teacher_load';

export interface ExportContext {
  schedule: Lesson[];
  groupIds: string[];
  groups: Group[];
  teachers: Teacher[];
  subjects: Subject[];
  rooms: Room[];
  schoolName: string;
  conflictKeys: Set<string>;
  neededHours: number;
  assignedHours: number;
  unassignedHours: number;
  score: number;
}

interface MatrixCellEntry {
  text: string;
  detail?: string;
  colorIndex: number;
  conflict?: boolean;
}

interface MatrixCell {
  entries?: MatrixCellEntry[];
  text?: string;
  colorIndex?: number;
  conflict?: boolean;
}

interface MatrixRow {
  id: string;
  label: string;
  groupLabel?: string;
  data?: any;
}

interface MatrixColumn {
  id: string;
  label: string;
}

interface MatrixStat {
  label: string;
  value: string | number;
  color: [number, number, number];
}

interface Matrix {
  title: string;
  subtitle: string;
  stats: MatrixStat[];
  columns: MatrixColumn[];
  rows: MatrixRow[];
  getCell: (row: MatrixRow, colIndex: number) => MatrixCell | undefined;
  legend: { label: string; colorIndex: number }[];
  palette: [number, number, number][];
  groupHeader: string;
  rowHeader: string;
  fileNameBase: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const SUBJ_PALETTE: [number, number, number][] = [
  [229, 241, 255], [255, 227, 232], [225, 250, 225],
  [255, 253, 215], [238, 224, 255], [255, 237, 215],
  [215, 245, 255], [255, 247, 215], [245, 225, 255],
  [215, 255, 240],
];
const HEADER_BG: [number, number, number] = [50, 58, 69];
const ALT_ROW: [number, number, number] = [244, 246, 249];
const BORDER: [number, number, number] = [210, 214, 220];
const CONFLICT_BG: [number, number, number] = [255, 220, 220];

const argb = (c: [number, number, number]) =>
  `FF${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')}`;

const subjectName = (ctx: ExportContext, id: string) =>
  ctx.subjects.find(s => s.id === id)?.name || '???';
const teacherName = (ctx: ExportContext, id?: string) =>
  id ? ctx.teachers.find(t => t.id === id)?.shortName || ctx.teachers.find(t => t.id === id)?.name || '' : '';
const groupName = (ctx: ExportContext, id: string) =>
  ctx.groups.find(g => g.id === id)?.name || '';
const roomName = (ctx: ExportContext, id?: string) =>
  id ? ctx.rooms.find(r => r.id === id)?.name || '' : '';
const subjIndex = (ctx: ExportContext, id: string) => {
  const i = ctx.subjects.findIndex(s => s.id === id);
  return i >= 0 ? i % SUBJ_PALETTE.length : 0;
};

const lessonsInGroups = (ctx: ExportContext) =>
  ctx.schedule.filter(l => ctx.groupIds.includes(l.groupId));

const usedDayPeriods = (src: Lesson[]) => {
  const map = new Map<string, number[]>();
  for (const day of DAYS) map.set(day, []);
  for (const l of src) {
    const list = map.get(l.day);
    if (list && !list.includes(l.period)) list.push(l.period);
  }
  for (const day of DAYS) map.get(day)!.sort((a, b) => a - b);
  return map;
};

const buildStats = (ctx: ExportContext, t: TFunction): MatrixStat[] => [
  { label: t('needed'), value: ctx.neededHours, color: [80, 120, 200] },
  { label: t('assigned'), value: ctx.assignedHours, color: [60, 160, 80] },
  { label: t('unassigned'), value: ctx.unassignedHours, color: ctx.unassignedHours > 0 ? [220, 140, 40] : [60, 160, 80] },
  { label: t('conflicts'), value: ctx.conflictKeys.size, color: ctx.conflictKeys.size > 0 ? [220, 60, 60] : [60, 160, 80] },
  { label: t('score'), value: `${(ctx.score * 100).toFixed(0)}%`, color: ctx.score >= 1 ? [60, 160, 80] : ctx.score >= 0.5 ? [200, 160, 40] : [220, 80, 60] },
];

const buildLegend = (src: Lesson[], ctx: ExportContext): { label: string; colorIndex: number }[] => {
  const seen = new Set<string>();
  const legend: { label: string; colorIndex: number }[] = [];
  for (const l of src) {
    if (seen.has(l.subjectId)) continue;
    seen.add(l.subjectId);
    legend.push({ label: subjectName(ctx, l.subjectId), colorIndex: subjIndex(ctx, l.subjectId) });
  }
  return legend;
};

function buildFullScheduleMatrix(ctx: ExportContext, t: TFunction): Matrix {
  const src = lessonsInGroups(ctx);
  const periods = [...new Set(src.map(l => l.period))].sort((a, b) => a - b);
  const columns: MatrixColumn[] = DAYS.map(d => ({ id: d, label: t(d.toLowerCase()) }));
  const rows: MatrixRow[] = periods.map(p => ({ id: `p${p}`, label: String(p), data: { period: p } }));

  const getCell = (row: MatrixRow, colIndex: number): MatrixCell | undefined => {
    const day = DAYS[colIndex];
    const period = row.data.period;
    const lessons = src.filter(l => l.day === day && l.period === period);
    if (lessons.length === 0) return undefined;
    return {
      entries: lessons.map(l => ({
        text: subjectName(ctx, l.subjectId),
        detail: [teacherName(ctx, l.teacherId), groupName(ctx, l.groupId), l.roomId ? roomName(ctx, l.roomId) : null].filter(Boolean).join(' · '),
        colorIndex: subjIndex(ctx, l.subjectId),
        conflict: ctx.conflictKeys.has(l.id),
      })),
    };
  };

  return {
    title: ctx.schoolName,
    subtitle: `${t('report_all')} • ${new Date().toLocaleDateString()}`,
    stats: buildStats(ctx, t),
    columns,
    rows,
    getCell,
    legend: buildLegend(src, ctx),
    palette: SUBJ_PALETTE,
    groupHeader: '',
    rowHeader: '#',
    fileNameBase: `${ctx.schoolName.replace(/\s+/g, '_')}_schedule_all`,
  };
}

function buildGroupMatrix(ctx: ExportContext, t: TFunction, onlyLessons: boolean): Matrix {
  const src = lessonsInGroups(ctx);
  const groupIds = [...ctx.groupIds]
    .filter(id => ctx.groups.some(g => g.id === id))
    .sort((a, b) => groupName(ctx, a).localeCompare(groupName(ctx, b)));
  const dayPeriods = usedDayPeriods(src);
  const usedDays = DAYS.filter(d => (dayPeriods.get(d)?.length ?? 0) > 0);

  const columns: MatrixColumn[] = groupIds.map(id => ({ id, label: groupName(ctx, id) }));
  const rows: MatrixRow[] = [];
  for (const day of usedDays) {
    for (const period of dayPeriods.get(day)!) {
      rows.push({
        id: `${day}-${period}`,
        label: String(period),
        groupLabel: t(day.toLowerCase()),
        data: { day, period },
      });
    }
  }

  const getCell = (row: MatrixRow, colIndex: number): MatrixCell | undefined => {
    const gid = columns[colIndex].id;
    const { day, period } = row.data;
    const lessons = src.filter(l => l.groupId === gid && l.day === day && l.period === period);
    if (lessons.length === 0) return undefined;
    if (onlyLessons) {
      return {
        text: subjectName(ctx, lessons[0].subjectId),
        colorIndex: subjIndex(ctx, lessons[0].subjectId),
        conflict: lessons.some(l => ctx.conflictKeys.has(l.id)),
      };
    }
    return {
      entries: lessons.map(l => ({
        text: subjectName(ctx, l.subjectId),
        detail: [teacherName(ctx, l.teacherId), l.roomId ? roomName(ctx, l.roomId) : null].filter(Boolean).join(' · '),
        colorIndex: subjIndex(ctx, l.subjectId),
        conflict: ctx.conflictKeys.has(l.id),
      })),
    };
  };

  return {
    title: ctx.schoolName,
    subtitle: `${t(onlyLessons ? 'report_only_lessons' : 'report_with_teachers')} • ${new Date().toLocaleDateString()}`,
    stats: buildStats(ctx, t),
    columns,
    rows,
    getCell,
    legend: buildLegend(src, ctx),
    palette: SUBJ_PALETTE,
    groupHeader: t('day'),
    rowHeader: '#',
    fileNameBase: `${ctx.schoolName.replace(/\s+/g, '_')}_${onlyLessons ? 'only_lessons' : 'with_teachers'}`,
  };
}

function buildTeacherLoadMatrix(ctx: ExportContext, t: TFunction): Matrix {
  const src = lessonsInGroups(ctx);
  const teacherIds = [...new Set(src.filter(l => l.teacherId).map(l => l.teacherId!))].sort((a, b) =>
    teacherName(ctx, a).localeCompare(teacherName(ctx, b))
  );
  const dayPeriods = usedDayPeriods(src);
  const usedDays = DAYS.filter(d => (dayPeriods.get(d)?.length ?? 0) > 0);

  const columns: MatrixColumn[] = [];
  const colData: { day: string; period: number }[] = [];
  for (const day of usedDays) {
    for (const period of dayPeriods.get(day)!) {
      colData.push({ day, period });
      columns.push({ id: `${day}-${period}`, label: `${t(day.toLowerCase())} ${period}` });
    }
  }

  const rows: MatrixRow[] = teacherIds.map(id => ({
    id,
    label: teacherName(ctx, id),
    data: { teacherId: id },
  }));

  const getCell = (row: MatrixRow, colIndex: number): MatrixCell | undefined => {
    const { day, period } = colData[colIndex];
    const lessons = src.filter(l => l.teacherId === row.data.teacherId && l.day === day && l.period === period);
    if (lessons.length === 0) return undefined;
    return {
      entries: lessons.map(l => ({
        text: groupName(ctx, l.groupId),
        detail: subjectName(ctx, l.subjectId),
        colorIndex: subjIndex(ctx, l.subjectId),
        conflict: ctx.conflictKeys.has(l.id),
      })),
    };
  };

  return {
    title: ctx.schoolName,
    subtitle: `${t('report_teacher_load')} • ${new Date().toLocaleDateString()}`,
    stats: buildStats(ctx, t),
    columns,
    rows,
    getCell,
    legend: buildLegend(src, ctx),
    palette: SUBJ_PALETTE,
    groupHeader: '',
    rowHeader: t('teacher'),
    fileNameBase: `${ctx.schoolName.replace(/\s+/g, '_')}_teacher_load`,
  };
}

function buildMatrix(type: ExportReportType, ctx: ExportContext, t: TFunction): Matrix {
  switch (type) {
    case 'all':
      return buildFullScheduleMatrix(ctx, t);
    case 'with_teachers':
      return buildGroupMatrix(ctx, t, false);
    case 'only_lessons':
      return buildGroupMatrix(ctx, t, true);
    case 'teacher_load':
      return buildTeacherLoadMatrix(ctx, t);
  }
}

// ---------------------------------------------------------------------------
// PDF renderer
// ---------------------------------------------------------------------------

async function renderMatrixToPdf(matrix: Matrix, t: TFunction): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await ensureFonts(doc);
  const M = 10;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const groupLabelW = 16;
  const maxLabelLen = matrix.rows.reduce((s, r) => Math.max(s, r.label.length), 1);
  const rowLabelW = Math.min(40, Math.max(8, maxLabelLen * 1.9 + 4));
  const headerH = 9;
  const titleBlockH = 30;
  const legendH = 12;

  const nCols = matrix.columns.length;
  const availableW = pageW - M * 2 - groupLabelW - rowLabelW;
  const colW = Math.min(32, Math.max(8, availableW / Math.max(1, nCols)));
  const colsPerPage = Math.max(1, Math.floor(availableW / colW));

  const colChunks: number[][] = [];
  for (let i = 0; i < nCols; i += colsPerPage) {
    colChunks.push(Array.from({ length: Math.min(colsPerPage, nCols - i) }, (_, k) => i + k));
  }

  const rowHeights = matrix.rows.map(row => {
    let maxH = 8;
    matrix.columns.forEach((_, ci) => {
      const cell = matrix.getCell(row, ci);
      if (!cell) return;
      if (cell.entries && cell.entries.length > 0) {
        maxH = Math.max(maxH, Math.min(cell.entries.length * 8 + (cell.entries.length - 1) * 1.5 + 2, 40));
      } else if (cell.text) {
        maxH = Math.max(maxH, 6);
      }
    });
    return maxH;
  });

  const tableH = pageH - M - legendH - 3 - headerH;

  const drawTitleBlock = (topY: number) => {
    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(30, 30, 30);
    doc.text(matrix.title, M, topY + 8);
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(matrix.subtitle, M, topY + 16);

    doc.setFontSize(7);
    let sx = M;
    for (const stat of matrix.stats) {
      doc.setFillColor(...stat.color);
      doc.setTextColor(255, 255, 255);
      doc.setFont('DejaVuSans', 'bold');
      const sw = 30;
      doc.roundedRect(sx, topY + 20, sw, 7, 1.5, 1.5, 'F');
      doc.text(`${stat.label} ${stat.value}`, sx + sw / 2, topY + 24.5, { align: 'center' });
      sx += sw + 3;
    }
  };

  const drawPage = (colChunk: number[], rows: MatrixRow[], heights: number[], topY: number) => {
    const headerY = topY;
    doc.setDrawColor(...BORDER);
    doc.setFillColor(...HEADER_BG);
    doc.setTextColor(255, 255, 255);
    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(7);

    doc.rect(M, headerY, groupLabelW, headerH, 'FD');
    doc.text(matrix.groupHeader, M + groupLabelW / 2, headerY + headerH / 2 + 1.5, { align: 'center' });
    doc.rect(M + groupLabelW, headerY, rowLabelW, headerH, 'FD');
    doc.text(matrix.rowHeader, M + groupLabelW + rowLabelW / 2, headerY + headerH / 2 + 1.5, { align: 'center' });

    for (let i = 0; i < colChunk.length; i++) {
      const x = M + groupLabelW + rowLabelW + i * colW;
      doc.rect(x, headerY, colW, headerH, 'FD');
      doc.text(matrix.columns[colChunk[i]].label, x + colW / 2, headerY + headerH / 2 + 1.5, { align: 'center' });
    }

    let rowY = headerY + headerH;
    let prevGroup = '';
    let groupStartY = rowY;
    let groupH = 0;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rh = heights[ri];
      const isNewGroup = row.groupLabel !== prevGroup;

      if (isNewGroup && prevGroup) {
        doc.setFillColor(...HEADER_BG);
        doc.setTextColor(255, 255, 255);
        doc.setFont('DejaVuSans', 'bold');
        doc.setFontSize(6);
        doc.rect(M, groupStartY, groupLabelW, groupH, 'FD');
        doc.text(prevGroup, M + groupLabelW / 2, groupStartY + groupH / 2 + 1.2, { align: 'center' });
        groupStartY = rowY;
        groupH = 0;
      }
      prevGroup = row.groupLabel ?? '';
      groupH += rh;

      doc.setDrawColor(...BORDER);
      doc.setFillColor(...HEADER_BG);
      doc.setTextColor(255, 255, 255);
      doc.setFont('DejaVuSans', 'bold');
      doc.setFontSize(8);
      doc.rect(M + groupLabelW, rowY, rowLabelW, rh, 'FD');
      doc.text(row.label, M + groupLabelW + rowLabelW / 2, rowY + rh / 2 + 1.5, { align: 'center' });

      const isAlt = ri % 2 === 1;
      if (isAlt) {
        doc.setFillColor(...ALT_ROW);
        doc.rect(M + groupLabelW + rowLabelW, rowY, colW * colChunk.length, rh, 'F');
      }

      for (let ci = 0; ci < colChunk.length; ci++) {
        const cx = M + groupLabelW + rowLabelW + ci * colW;
        const cell = matrix.getCell(row, colChunk[ci]);
        doc.setDrawColor(...BORDER);
        doc.rect(cx, rowY, colW, rh, 'S');
        if (!cell) continue;

        if (cell.entries && cell.entries.length > 0) {
          const lessonH = (rh - 2) / cell.entries.length;
          for (let li = 0; li < cell.entries.length; li++) {
            const entry = cell.entries[li];
            const ly = rowY + 1 + li * lessonH;
            const lh = lessonH - 0.5;
            const lx = cx + 1;
            const lw = colW - 2;
            const bg = entry.conflict ? CONFLICT_BG : matrix.palette[entry.colorIndex % matrix.palette.length];
            doc.setFillColor(...bg);
            doc.rect(lx, ly, lw, lh, 'F');
            doc.setFillColor(entry.conflict ? 200 : 100, entry.conflict ? 60 : 130, entry.conflict ? 60 : 180);
            doc.rect(lx, ly, 1.2, lh, 'F');
            doc.setTextColor(30, 30, 30);
            doc.setFont('DejaVuSans', 'bold');
            doc.setFontSize(6);
            doc.text(entry.text, lx + 2, ly + 2.8);
            if (entry.detail) {
              doc.setTextColor(100, 100, 100);
              doc.setFont('DejaVuSans', 'normal');
              doc.setFontSize(4.5);
              doc.text(entry.detail, lx + 2, ly + lh - 1.8);
            }
            if (entry.conflict) {
              doc.setTextColor(200, 50, 50);
              doc.setFont('DejaVuSans', 'bold');
              doc.setFontSize(7);
              doc.text('!', lx + lw - 3, ly + 3);
            }
          }
        } else if (cell.text) {
          const bg = cell.conflict
            ? CONFLICT_BG
            : cell.colorIndex != null
            ? matrix.palette[cell.colorIndex % matrix.palette.length]
            : undefined;
          if (bg) {
            doc.setFillColor(...bg);
            doc.rect(cx + 0.5, rowY + 0.5, colW - 1, rh - 1, 'F');
          }
          doc.setTextColor(30, 30, 30);
          doc.setFont('DejaVuSans', 'bold');
          doc.setFontSize(5);
          doc.text(cell.text, cx + colW / 2, rowY + rh / 2 + 1.2, { align: 'center' });
          if (cell.conflict) {
            doc.setTextColor(200, 50, 50);
            doc.setFont('DejaVuSans', 'bold');
            doc.setFontSize(7);
            doc.text('!', cx + colW - 4, rowY + 3.5);
          }
        }
      }

      rowY += rh;
    }

    if (prevGroup) {
      doc.setFillColor(...HEADER_BG);
      doc.setTextColor(255, 255, 255);
      doc.setFont('DejaVuSans', 'bold');
      doc.setFontSize(6);
      doc.rect(M, groupStartY, groupLabelW, groupH, 'FD');
      doc.text(prevGroup, M + groupLabelW / 2, groupStartY + groupH / 2 + 1.2, { align: 'center' });
    }

    return rowY;
  };

  const drawLegend = (y: number) => {
    doc.setDrawColor(...BORDER);
    doc.setFillColor(250, 250, 252);
    doc.roundedRect(M, y, pageW - M * 2, 10, 2, 2, 'FD');
    doc.setTextColor(80, 80, 80);
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(6);
    let lx = M + 3;
    doc.text(t('legend') + ': ', lx, y + 6.5);
    lx += doc.getTextWidth(t('legend') + ': ') + 2;
    for (const item of matrix.legend) {
      const color = matrix.palette[item.colorIndex % matrix.palette.length];
      doc.setFillColor(...color);
      doc.rect(lx, y + 3, 6, 4.5, 'F');
      doc.setDrawColor(...BORDER);
      doc.rect(lx, y + 3, 6, 4.5, 'S');
      doc.setTextColor(60, 60, 60);
      doc.setFont('DejaVuSans', 'normal');
      doc.setFontSize(5.5);
      doc.text(item.label, lx + 8, y + 6.5);
      lx += doc.getTextWidth(item.label) + 13;
      if (lx > pageW - M - 15) {
        y += 7;
        lx = M + 3;
      }
    }
  };

  let firstPage = true;
  if (matrix.rows.length === 0) {
    drawTitleBlock(M);
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text(t('export_no_data'), M, M + titleBlockH + 5);
    drawLegend(M + titleBlockH + 12);
  }
  for (const chunk of colChunks) {
    let rowStart = 0;
    while (rowStart < matrix.rows.length) {
      let rowEnd = rowStart;
      let h = 0;
      while (rowEnd < matrix.rows.length && h + rowHeights[rowEnd] <= tableH) {
        h += rowHeights[rowEnd];
        rowEnd++;
      }
      if (rowEnd === rowStart) rowEnd = rowStart + 1;

      if (!firstPage) doc.addPage();
      firstPage = false;

      const topY = M;
      drawTitleBlock(topY);
      const tableTop = topY + titleBlockH;
      drawPage(chunk, matrix.rows.slice(rowStart, rowEnd), rowHeights.slice(rowStart, rowEnd), tableTop);
      drawLegend(tableTop + headerH + h + 3);

      rowStart = rowEnd;
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setTextColor(180, 180, 180);
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(7);
    doc.text(`${i} / ${totalPages}`, pageW - M, pageH - 5, { align: 'right' });
  }

  doc.save(`${matrix.fileNameBase}.pdf`);
}

// ---------------------------------------------------------------------------
// XLSX renderer
// ---------------------------------------------------------------------------

async function renderMatrixToXlsx(matrix: Matrix, t: TFunction): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(matrix.title.slice(0, 31) || 'Export');

  const totalCols = 2 + matrix.columns.length;
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 10;
  for (let ci = 3; ci <= totalCols; ci++) sheet.getColumn(ci).width = 24;

  const b = () => ({ style: 'thin' as const, color: { argb: argb(BORDER) } });
  const border = { top: b(), bottom: b(), left: b(), right: b() };
  const solid = (color: [number, number, number]) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: argb(color) } });

  const r1 = sheet.getRow(1); r1.height = 24;
  r1.getCell(1).value = matrix.title;
  r1.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1E1E1E' } };
  sheet.mergeCells(1, 1, 1, totalCols);

  const r2 = sheet.getRow(2);
  r2.getCell(1).value = matrix.subtitle;
  r2.getCell(1).font = { size: 10, color: { argb: 'FF787878' } };
  sheet.mergeCells(2, 1, 2, totalCols);

  for (let si = 0; si < matrix.stats.length; si++) {
    const s = matrix.stats[si];
    const c = sheet.getRow(3).getCell(si + 1);
    c.value = `${s.label} ${s.value}`;
    c.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
    c.fill = solid(s.color);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = border;
  }

  const hr = sheet.getRow(5); hr.height = 22;
  const hdrFont = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  hr.getCell(1).value = matrix.groupHeader;
  hr.getCell(1).font = hdrFont; hr.getCell(1).fill = solid(HEADER_BG);
  hr.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  hr.getCell(1).border = border;
  hr.getCell(2).value = matrix.rowHeader;
  hr.getCell(2).font = hdrFont; hr.getCell(2).fill = solid(HEADER_BG);
  hr.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
  hr.getCell(2).border = border;
  for (let ci = 0; ci < matrix.columns.length; ci++) {
    const c = hr.getCell(ci + 3);
    c.value = matrix.columns[ci].label;
    c.font = hdrFont; c.fill = solid(HEADER_BG);
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = border;
  }

  let dataRowNum = 6;
  const dataStart = dataRowNum;
  let prevGroup = '';
  let groupStartRow = dataRowNum;

  for (let ri = 0; ri < matrix.rows.length; ri++) {
    const row = matrix.rows[ri];
    const isNewGroup = row.groupLabel !== prevGroup;

    if (isNewGroup && prevGroup && dataRowNum - groupStartRow > 1) {
      sheet.mergeCells(groupStartRow, 1, dataRowNum - 1, 1);
    }
    if (isNewGroup) groupStartRow = dataRowNum;
    prevGroup = row.groupLabel ?? '';

    const xrow = sheet.getRow(dataRowNum);
    xrow.height = 28;
    const isAlt = (dataRowNum - dataStart) % 2 === 1;

    const lc = xrow.getCell(1);
    lc.border = border;
    if (row.groupLabel) {
      lc.value = row.groupLabel;
      lc.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      lc.fill = solid(HEADER_BG);
      lc.alignment = { horizontal: 'center', vertical: 'middle' };
    } else if (isAlt) {
      lc.fill = solid(ALT_ROW);
    }

    const rc = xrow.getCell(2);
    rc.value = row.label;
    rc.font = { bold: true, size: 9, color: { argb: 'FF505050' } };
    rc.alignment = { horizontal: 'center', vertical: 'middle' };
    rc.border = border;
    if (isAlt) rc.fill = solid(ALT_ROW);

    for (let ci = 0; ci < matrix.columns.length; ci++) {
      const c = xrow.getCell(ci + 3);
      c.border = border;
      const cell = matrix.getCell(row, ci);
      if (!cell) {
        if (isAlt) c.fill = solid(ALT_ROW);
        continue;
      }

      if (cell.entries && cell.entries.length > 0) {
        const isConfl = cell.entries.some(e => e.conflict);
        c.fill = isConfl
          ? solid(CONFLICT_BG)
          : solid(matrix.palette[cell.entries[0].colorIndex % matrix.palette.length]);
        const richText: { text: string; font?: { bold?: boolean; size?: number; color?: { argb: string } } }[] = [];
        for (let li = 0; li < cell.entries.length; li++) {
          const e = cell.entries[li];
          if (li > 0) richText.push({ text: '\n' });
          richText.push({ text: e.text, font: { bold: true, size: 10, color: { argb: 'FF1E1E1E' } } });
          if (e.detail) richText.push({ text: '\n' + e.detail, font: { size: 8, color: { argb: 'FF666666' } } });
        }
        c.value = { richText };
        c.alignment = { vertical: 'middle' };
      } else if (cell.text) {
        c.value = cell.text;
        c.font = { bold: true, size: 10, color: { argb: 'FF1E1E1E' } };
        c.alignment = { horizontal: 'center', vertical: 'middle' };
        if (cell.conflict) {
          c.fill = solid(CONFLICT_BG);
        } else if (cell.colorIndex != null) {
          c.fill = solid(matrix.palette[cell.colorIndex % matrix.palette.length]);
        } else if (isAlt) {
          c.fill = solid(ALT_ROW);
        }
      }
    }

    dataRowNum++;
  }

  if (prevGroup && dataRowNum - groupStartRow > 1) {
    sheet.mergeCells(groupStartRow, 1, dataRowNum - 1, 1);
  }

  const legendRowNum = dataRowNum + 1;
  const lr = sheet.getRow(legendRowNum); lr.height = 18;
  lr.getCell(1).value = t('legend') + ':';
  lr.getCell(1).font = { bold: true, size: 8, color: { argb: 'FF505050' } };
  for (let si = 0; si < matrix.legend.length && si + 1 < totalCols; si++) {
    const item = matrix.legend[si];
    const c = lr.getCell(si + 2);
    c.value = item.label;
    c.font = { size: 8, color: { argb: 'FF3C3C3C' } };
    c.fill = solid(matrix.palette[item.colorIndex % matrix.palette.length]);
    c.border = border;
  }

  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${matrix.fileNameBase}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function exportReport(
  type: ExportReportType,
  format: ExportFormat,
  ctx: ExportContext,
  t: TFunction
): Promise<void> {
  const matrix = buildMatrix(type, ctx, t);
  if (format === 'pdf') {
    await renderMatrixToPdf(matrix, t);
  } else {
    await renderMatrixToXlsx(matrix, t);
  }
}
