import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import ExcelJS from 'exceljs';
import { useProject } from '../context/ProjectContext';
import { ensureFonts } from '../../utils/pdfFonts';

export const ScheduleViewer = () => {
  const { t } = useTranslation();
  const { project } = useProject();
  const schedule = project?.generatedSchedule?.schedule || [];
  const groups = project?.groups || [];
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];
  const rooms = project?.rooms || [];
  const schoolName = project?.school.name || 'Schedule';

  const neededHours = useMemo(() =>
    (project?.curriculum || []).reduce((s, r) => s + r.hoursPerWeek, 0),
    [project]);
  const assignedHours = schedule.length;
  const unassignedHours = neededHours - assignedHours;
  const score = project?.generatedSchedule?.score ?? 0;

  const [filterType, setFilterType] = useState<'group' | 'teacher' | 'subject' | 'all'>('all');
  const [filterId, setFilterId] = useState<string>('');
  const [lockedLessons, setLockedLessons] = useState<Set<string>>(new Set());

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const allPeriods = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    const teacherSlot = new Map<string, Map<string, string[]>>();
    const groupSlot = new Map<string, Map<string, string[]>>();

    for (const lesson of schedule) {
      const slotKey = `${lesson.day}-${lesson.period}`;

      if (lesson.teacherId) {
        if (!teacherSlot.has(lesson.teacherId)) teacherSlot.set(lesson.teacherId, new Map());
        if (!teacherSlot.get(lesson.teacherId)!.has(slotKey)) teacherSlot.get(lesson.teacherId)!.set(slotKey, []);
        teacherSlot.get(lesson.teacherId)!.get(slotKey)!.push(lesson.id);
        if (teacherSlot.get(lesson.teacherId)!.get(slotKey)!.length > 1) {
          for (const lid of teacherSlot.get(lesson.teacherId)!.get(slotKey)!) keys.add(lid);
        }
      }

      if (!groupSlot.has(lesson.groupId)) groupSlot.set(lesson.groupId, new Map());
      if (!groupSlot.get(lesson.groupId)!.has(slotKey)) groupSlot.get(lesson.groupId)!.set(slotKey, []);
      const slotLessons = groupSlot.get(lesson.groupId)!.get(slotKey)!;
      const isSameSubjectSplit = slotLessons.length > 0 && slotLessons.some(lid => {
        const other = schedule.find(l => l.id === lid);
        return other && other.subjectId === lesson.subjectId;
      });
      slotLessons.push(lesson.id);
      if (slotLessons.length > 1 && !isSameSubjectSplit) {
        for (const lid of slotLessons) keys.add(lid);
      }
    }
    return keys;
  }, [schedule]);

  const displayedLessons = useMemo(() => {
    if (filterType === 'all') return schedule;
    return schedule.filter(lesson => {
      if (filterType === 'group') return lesson.groupId === filterId;
      if (filterType === 'teacher') return lesson.teacherId === filterId;
      if (filterType === 'subject') return lesson.subjectId === filterId;
      return false;
    });
  }, [schedule, filterType, filterId]);

  const getLessonsAt = (day: string, period: number) => {
    return displayedLessons.filter(l => l.day === day && l.period === period);
  };

  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || '???';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getRoomName = (id?: string) => rooms.find(r => r.id === id)?.name || '';

  const exportXLSX = useCallback(async () => {
    const src = displayedLessons;
    if (!src.length) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Schedule');

    for (let ci = 0; ci < 6; ci++) sheet.getColumn(ci + 1).width = ci === 0 ? 8 : 34;

    const HEADER_BG = 'FF1E232D';
    const ALT_BG = 'FFF4F6F9';
    const BORDER_CLR = 'FFD2D6DC';
    const b = () => ({ style: 'thin' as const, color: { argb: BORDER_CLR } });
    const border = { top: b(), bottom: b(), left: b(), right: b() };

    const SUBJ_PALETTE = [
      'FFE5F1FF','FFFFE3E8','FFE1FAE1','FFFFFDD7',
      'FFEEDEFF','FFFFEDD7','FFD7F5FF','FFFFF7D7',
      'FFF5E1FF','FFD7FFF0',
    ];
    const subjColor = (id: string) => {
      const i = subjects.findIndex(s => s.id === id);
      return SUBJ_PALETTE[i >= 0 ? i % SUBJ_PALETTE.length : 0];
    };

    const periods = [...new Set(src.map(l => l.period))].sort((a, b) => a - b);
    const dayLabels = days.map(d => t(d.toLowerCase()));

    // Row 1 – school name
    const r1 = sheet.getRow(1); r1.height = 24;
    r1.getCell(1).value = schoolName;
    r1.getCell(1).font = { bold: true, size: 14, color: { argb: 'FF1E1E1E' } };
    sheet.mergeCells(1, 1, 1, 6);

    // Row 2 – date
    const r2 = sheet.getRow(2);
    r2.getCell(1).value = `${t('schedule_title')} • ${new Date().toLocaleDateString()}`;
    r2.getCell(1).font = { size: 10, color: { argb: 'FF787878' } };
    sheet.mergeCells(2, 1, 2, 6);

    // Row 3 – stats badges
    const stats: { label: string; value: number | string; color: string }[] = [
      { label: t('needed'), value: neededHours, color: 'FF5078C8' },
      { label: t('assigned'), value: assignedHours, color: 'FF3CA050' },
      { label: t('unassigned'), value: unassignedHours, color: unassignedHours > 0 ? 'FFDC8C28' : 'FF3CA050' },
      { label: t('conflicts'), value: conflictKeys.size, color: conflictKeys.size > 0 ? 'FFDC3C3C' : 'FF3CA050' },
      { label: t('score'), value: `${(score * 100).toFixed(0)}%`, color: score >= 1 ? 'FF3CA050' : score >= 0.5 ? 'FFC8A028' : 'FFDC5040' },
    ];
    for (let si = 0; si < stats.length; si++) {
      const c = sheet.getRow(3).getCell(si + 1);
      c.value = `${stats[si].label} ${stats[si].value}`;
      c.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: stats[si].color } };
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = border;
    }

    // Row 5 – table header
    const hr = sheet.getRow(5); hr.height = 22;
    const hdrNames = [t('period'), ...dayLabels];
    const hdrFont = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    const hdrFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: HEADER_BG } };
    for (let ci = 0; ci < 6; ci++) {
      const c = hr.getCell(ci + 1);
      c.value = hdrNames[ci];
      c.font = hdrFont;
      c.fill = hdrFill;
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.border = border;
    }

    // Data rows
    for (let ri = 0; ri < periods.length; ri++) {
      const period = periods[ri];
      const row = sheet.getRow(6 + ri);
      row.height = 30;

      const pc = row.getCell(1);
      pc.value = period;
      pc.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      pc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
      pc.alignment = { horizontal: 'center', vertical: 'middle' };
      pc.border = border;

      const isAlt = ri % 2 === 1;

      for (let di = 0; di < 5; di++) {
        const lessons = src.filter(l => l.day === days[di] && l.period === period);
        const c = row.getCell(di + 2);
        c.border = border;

        if (lessons.length === 0) {
          if (isAlt) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_BG } };
          continue;
        }

        const isConfl = lessons.some(l => conflictKeys.has(l.id));

        if (isConfl) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFDCDC' } };
        } else {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subjColor(lessons[0].subjectId) } };
        }

        const richText: { text: string; font?: { bold?: boolean; size?: number; color?: { argb: string } } }[] = [];
        for (let li = 0; li < lessons.length; li++) {
          const l = lessons[li];
          if (li > 0) { richText.push({ text: '\n' }); }
          richText.push({ text: getSubjectName(l.subjectId), font: { bold: true, size: 10, color: { argb: 'FF1E1E1E' } } });
          const detailParts = [getTeacherName(l.teacherId), getGroupName(l.groupId)];
          if (l.roomId) detailParts.push(getRoomName(l.roomId));
          richText.push({ text: '\n' + detailParts.join(' · '), font: { size: 8, color: { argb: 'FF666666' } } });
        }
        c.value = { richText };
        c.alignment = { vertical: 'middle' };
      }
    }

    // Legend
    const legendRowNum = 6 + periods.length + 1;
    const uSubj = [...new Set(src.map(l => l.subjectId))];
    const lr = sheet.getRow(legendRowNum); lr.height = 18;
    lr.getCell(1).value = t('legend') + ':';
    lr.getCell(1).font = { bold: true, size: 8, color: { argb: 'FF505050' } };
    for (let si = 0; si < uSubj.length; si++) {
      const c = lr.getCell(si + 2);
      c.value = getSubjectName(uSubj[si]);
      c.font = { size: 8, color: { argb: 'FF3C3C3C' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subjColor(uSubj[si]) } };
      c.border = border;
    }

    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schoolName.replace(/\s+/g, '_')}_schedule.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayedLessons, schoolName, days, subjects, teachers, groups, rooms, conflictKeys, neededHours, assignedHours, unassignedHours, score, t]);

  const exportPDF = useCallback(async () => {
    const src = displayedLessons;
    if (!src.length) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await ensureFonts(doc);
    const M = 10;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const HEADER_BG: [number, number, number] = [50, 58, 69];
    const ALT_ROW: [number, number, number] = [244, 246, 249];
    const BORDER: [number, number, number] = [210, 214, 220];
    const SUBJ_PALETTE: [number, number, number][] = [
      [229, 241, 255], [255, 227, 232], [225, 250, 225],
      [255, 253, 215], [238, 224, 255], [255, 237, 215],
      [215, 245, 255], [255, 247, 215], [245, 225, 255],
      [215, 255, 240],
    ];
    const subjColor = (id: string): [number, number, number] => {
      const i = subjects.findIndex(s => s.id === id);
      return SUBJ_PALETTE[i >= 0 ? i % SUBJ_PALETTE.length : 0];
    };

    const periodColW = 11;
    const dayColW = (pageW - M * 2 - periodColW) / 5;

    const getLessons = (day: string, period: number) =>
      src.filter(l => l.day === day && l.period === period);

    const statLabel = (key: string) => t(key);

    const dayLabels = days.map(d => t(d.toLowerCase()));

    const periods = [...new Set(src.map(l => l.period))].sort((a, b) => a - b);

    const computeRowHeight = (period: number) => {
      let maxH = 10;
      for (const day of days) {
        const lessons = getLessons(day, period);
        if (lessons.length === 0) continue;
        const h = lessons.length * 8 + (lessons.length - 1) * 1.5 + 2;
        maxH = Math.max(maxH, Math.min(h, 40));
      }
      return maxH;
    };

    const rowHeights = periods.map(computeRowHeight);
    const headerH = 9;

    // ---- draw one page of the table ----
    const drawPage = (pIdxStart: number, pIdxEnd: number, startY: number) => {
      const drawCellBg = (x: number, y: number, w: number, h: number, fill?: [number, number, number]) => {
        if (fill) { doc.setFillColor(...fill); doc.rect(x, y, w, h, 'F'); }
      };

      const headerY = startY;
      doc.setDrawColor(...BORDER);
      doc.setFillColor(...HEADER_BG);
      doc.setTextColor(255, 255, 255);
      doc.setFont('DejaVuSans', 'bold');
      doc.setFontSize(7);

      doc.rect(M, headerY, periodColW, headerH, 'FD');
      doc.text('Per', M + periodColW / 2, headerY + headerH / 2 + 1.5, { align: 'center' });

      for (let di = 0; di < days.length; di++) {
        const x = M + periodColW + di * dayColW;
        doc.rect(x, headerY, dayColW, headerH, 'FD');
        doc.text(dayLabels[di], x + dayColW / 2, headerY + headerH / 2 + 1.5, { align: 'center' });
      }

      let rowY = headerY + headerH;

      for (let ri = pIdxStart; ri < pIdxEnd; ri++) {
        const period = periods[ri];
        const rh = rowHeights[ri];
        const isAlt = ri % 2 === 1;

        if (isAlt) {
          doc.setFillColor(...ALT_ROW);
          doc.rect(M, rowY, periodColW + dayColW * 5, rh, 'F');
        }

        doc.setDrawColor(...BORDER);
        doc.setFillColor(...HEADER_BG);
        doc.setTextColor(255, 255, 255);
        doc.setFont('DejaVuSans', 'bold');
        doc.setFontSize(8);
        doc.rect(M, rowY, periodColW, rh, 'FD');
        doc.text(String(period), M + periodColW / 2, rowY + rh / 2 + 1.5, { align: 'center' });

        for (let di = 0; di < days.length; di++) {
          const cx = M + periodColW + di * dayColW;
          const lessons = getLessons(days[di], period);

          doc.setDrawColor(...BORDER);
          doc.rect(cx, rowY, dayColW, rh, 'S');

          if (lessons.length > 0) {
            const lessonH = (rh - 2) / lessons.length;

            for (let li = 0; li < lessons.length; li++) {
              const l = lessons[li];
              const ly = rowY + 1 + li * lessonH;
              const lh = lessonH - 0.5;
              const lx = cx + 1;
              const lw = dayColW - 2;

              const isConfl = conflictKeys.has(l.id);

              const bg = subjColor(l.subjectId);
              drawCellBg(lx, ly, lw, lh, isConfl ? [255, 220, 220] : bg);

              doc.setFillColor(isConfl ? 200 : 100, isConfl ? 60 : 130, isConfl ? 60 : 180);
              doc.rect(lx, ly, 1.5, lh, 'F');

              doc.setTextColor(30, 30, 30);
              doc.setFont('DejaVuSans', 'bold');
              doc.setFontSize(6);
              doc.text(getSubjectName(l.subjectId), lx + 2.5, ly + 2.8);

              const detailParts = [getTeacherName(l.teacherId), getGroupName(l.groupId)];
              if (l.roomId) detailParts.push(getRoomName(l.roomId));
              doc.setTextColor(100, 100, 100);
              doc.setFont('DejaVuSans', 'normal');
              doc.setFontSize(4.5);
              doc.text(detailParts.join(' · '), lx + 2.5, ly + lh - 2);

              if (isConfl) {
                doc.setTextColor(200, 50, 50);
                doc.setFont('DejaVuSans', 'bold');
                doc.setFontSize(7);
                doc.text('!', lx + lw - 3.5, ly + 3);
              }
            }
          }
        }

        rowY += rh;
      }

      return rowY;
    };

    let totalTableH = headerH + rowHeights.reduce((s, h) => s + h, 0);
    const titleBlockH = 30;
    const legendH = 12;
    let neededH = titleBlockH + totalTableH + legendH + 5;

    let cursorY = M;
    doc.setTextColor(30, 30, 30);
    doc.setFont('DejaVuSans', 'bold');
    doc.setFontSize(16);
    doc.text(schoolName, M, cursorY + 8);
    cursorY += 10;

    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const dateStr = new Date().toLocaleDateString();
    doc.text(`${t('schedule_title')} • ${dateStr}`, M, cursorY + 2);
    cursorY += 9;

    doc.setFontSize(7);
    const stats: [string, number | string, [number, number, number]][] = [
      [statLabel('needed'), neededHours, [80, 120, 200]],
      [statLabel('assigned'), assignedHours, [60, 160, 80]],
      [statLabel('unassigned'), unassignedHours, unassignedHours > 0 ? [220, 140, 40] : [60, 160, 80]],
      [statLabel('conflicts'), conflictKeys.size, conflictKeys.size > 0 ? [220, 60, 60] : [60, 160, 80]],
      [statLabel('score'), `${(score * 100).toFixed(0)}%`, score >= 1 ? [60, 160, 80] : score >= 0.5 ? [200, 160, 40] : [220, 80, 60]],
    ];
    let sx = M;
    for (const [label, value, color] of stats) {
      doc.setFillColor(...color);
      doc.setTextColor(255, 255, 255);
      doc.setFont('DejaVuSans', 'bold');
      const sw = 30;
      doc.roundedRect(sx, cursorY, sw, 7, 1.5, 1.5, 'F');
      doc.text(`${label} ${value}`, sx + sw / 2, cursorY + 4.5, { align: 'center' });
      sx += sw + 3;
    }
    cursorY += 13;

    const tableStartY = cursorY;
    const availableH = pageH - M - legendH - 3;
    if (neededH > pageH - M) {
      let pageStart = 0;
      let pageCursorY = tableStartY;
      let pageTop = tableStartY;

      for (let ri = 0; ri < periods.length; ri++) {
        if (pageCursorY + rowHeights[ri] > availableH) {
          drawPage(pageStart, ri, pageTop);
          doc.addPage();
          pageStart = ri;
          pageCursorY = M + titleBlockH;
          pageTop = M + titleBlockH;
        }
        pageCursorY += rowHeights[ri];
      }
      drawPage(pageStart, periods.length, pageTop);
      cursorY = pageCursorY;
    } else {
      cursorY = drawPage(0, periods.length, tableStartY);
    }

    cursorY += 3;
    if (cursorY > pageH - M - 2) {
      doc.addPage();
      cursorY = M;
    }

    doc.setDrawColor(...BORDER);
    doc.setFillColor(250, 250, 252);
    doc.roundedRect(M, cursorY, pageW - M * 2, 10, 2, 2, 'FD');

    doc.setTextColor(80, 80, 80);
    doc.setFont('DejaVuSans', 'normal');
    doc.setFontSize(6);
    let lx = M + 3;
    doc.text(t('legend') + ': ', lx, cursorY + 6.5);
    lx += doc.getTextWidth(t('legend') + ': ') + 2;

    const uniqueSubjects = [...new Set(src.map(l => l.subjectId))];
    for (const sid of uniqueSubjects) {
      const color = subjColor(sid);
      const name = getSubjectName(sid);
      doc.setFillColor(...color);
      doc.rect(lx, cursorY + 3, 6, 4.5, 'F');
      doc.setDrawColor(...BORDER);
      doc.rect(lx, cursorY + 3, 6, 4.5, 'S');
      doc.setTextColor(60, 60, 60);
      doc.setFont('DejaVuSans', 'normal');
      doc.setFontSize(5.5);
      doc.text(name, lx + 8, cursorY + 6.5);

      lx += doc.getTextWidth(name) + 13;
      if (lx > pageW - M - 15) {
        cursorY += 7;
        lx = M + 3;
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

    doc.save(`${schoolName.replace(/\s+/g, '_')}_schedule.pdf`);
  }, [displayedLessons, schoolName, days, subjects, teachers, groups, rooms, conflictKeys, neededHours, assignedHours, unassignedHours, score, t]);

  const exportOverview = useCallback(async () => {
    if (!schedule.length) return;

    const groupIds = [...new Set(schedule.map(l => l.groupId))].sort((a, b) =>
      getGroupName(a).localeCompare(getGroupName(b))
    );

    const dayPeriods = new Map<string, number[]>();
    for (const day of days) dayPeriods.set(day, []);
    for (const l of schedule) {
      const list = dayPeriods.get(l.day)!;
      if (!list.includes(l.period)) list.push(l.period);
    }
    for (const day of days) dayPeriods.get(day)!.sort((a, b) => a - b);

    const usedDays = days.filter(d => (dayPeriods.get(d)?.length ?? 0) > 0);

    const cellText = new Map<string, string>();
    for (const l of schedule) {
      const key = `${l.groupId}|${l.day}|${l.period}`;
      if (!cellText.has(key)) cellText.set(key, getSubjectName(l.subjectId));
    }
    const getCell = (gid: string, day: string, period: number) =>
      cellText.get(`${gid}|${day}|${period}`) || '';

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await ensureFonts(doc);
    const M = 6;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const dayColW = 8;
    const perColW = 5;
    const labelW = dayColW + perColW;
    const rowH = 4.2;
    const headerH = 8;
    const titleH = 11;
    const dayLabels = days.map(d => t(d.toLowerCase()));

    const maxGroupsPerPage = Math.max(1, Math.floor((pageW - M * 2 - labelW) / 12));
    const maxRowsPerPage = Math.max(1, Math.floor((pageH - M * 2 - titleH - headerH) / rowH));

    const groupChunks: string[][] = [];
    for (let i = 0; i < groupIds.length; i += maxGroupsPerPage) groupChunks.push(groupIds.slice(i, i + maxGroupsPerPage));
    const rowChunks: { day: string; period: number }[][] = [];
    let cur: { day: string; period: number }[] = [];
    let ri = 0;
    for (const day of usedDays) {
      for (const period of dayPeriods.get(day)!) {
        if (ri > 0 && ri % maxRowsPerPage === 0) { rowChunks.push(cur); cur = []; }
        cur.push({ day, period });
        ri++;
      }
    }
    if (cur.length) rowChunks.push(cur);

    for (let gc = 0; gc < groupChunks.length; gc++) {
      for (let rc = 0; rc < rowChunks.length; rc++) {
        if (gc > 0 || rc > 0) doc.addPage();

        const chunkGroups = groupChunks[gc];
        const chunkRows = rowChunks[rc];
        const colW = Math.min(28, (pageW - M * 2 - labelW) / chunkGroups.length);

        doc.setFontSize(10);
        doc.setFont('DejaVuSans', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text(schoolName, M, M + 4);
        doc.setFontSize(6);
        doc.setFont('DejaVuSans', 'normal');
        doc.setTextColor(120, 120, 120);
        doc.text(`${t('export_overview')} • ${new Date().toLocaleDateString()}`, M, M + 8);

        const tableTop = M + titleH;

        doc.setDrawColor(30, 35, 45);
        doc.setFillColor(30, 35, 45);
        doc.setTextColor(255, 255, 255);
        doc.setFont('DejaVuSans', 'bold');
        doc.setFontSize(5.5);
        doc.rect(M, tableTop, dayColW + perColW + chunkGroups.length * colW, headerH, 'FD');
        doc.text(t('day'), M + dayColW / 2, tableTop + headerH / 2 + 1.5, { align: 'center' });
        doc.text('#', M + dayColW + perColW / 2, tableTop + headerH / 2 + 1.5, { align: 'center' });

        for (let gi = 0; gi < chunkGroups.length; gi++) {
          const x = M + labelW + gi * colW;
          doc.text(getGroupName(chunkGroups[gi]), x + colW / 2, tableTop + headerH / 2 + 1.5, { align: 'center' });
        }

        let rowY = tableTop + headerH;
        let prevDay = '';
        let daySpanStartY = rowY;
        let daySpanRows = 0;

        for (let idx = 0; idx < chunkRows.length; idx++) {
          const { day, period } = chunkRows[idx];
          const isNewDay = day !== prevDay;

          if (isNewDay && prevDay) {
            const spanH = daySpanRows * rowH;
            doc.setDrawColor(30, 35, 45);
            doc.setFillColor(30, 35, 45);
            doc.setTextColor(255, 255, 255);
            doc.setFont('DejaVuSans', 'bold');
            doc.setFontSize(5);
            doc.rect(M, daySpanStartY, dayColW, spanH, 'FD');
            doc.text(dayLabels[days.indexOf(prevDay)], M + dayColW / 2, daySpanStartY + spanH / 2 + 1.2, { align: 'center' });
            daySpanStartY = rowY;
            daySpanRows = 0;
          }

          prevDay = day;
          daySpanRows++;
          const isAlt = idx % 2 === 1;

          if (isAlt) {
            doc.setFillColor(244, 246, 249);
            doc.rect(M, rowY, labelW + chunkGroups.length * colW, rowH, 'F');
          }

          doc.setDrawColor(210, 214, 220);
          doc.rect(M, rowY, dayColW, rowH, 'S');
          doc.rect(M + dayColW, rowY, perColW, rowH, 'S');

          doc.setTextColor(100, 100, 100);
          doc.setFont('DejaVuSans', 'normal');
          doc.setFontSize(5);
          doc.text(String(period), M + dayColW + perColW / 2, rowY + rowH / 2 + 1.2, { align: 'center' });

          for (let gi = 0; gi < chunkGroups.length; gi++) {
            const cx = M + labelW + gi * colW;
            const text = getCell(chunkGroups[gi], day, period);

            doc.setDrawColor(210, 214, 220);
            doc.rect(cx, rowY, colW, rowH, 'S');

            if (text) {
              doc.setTextColor(30, 30, 30);
              doc.setFont('DejaVuSans', 'bold');
              doc.setFontSize(4.5);
              doc.text(text, cx + colW / 2, rowY + rowH / 2 + 1.2, { align: 'center' });
            }
          }

          rowY += rowH;
        }

        if (prevDay) {
          const spanH = daySpanRows * rowH;
          doc.setDrawColor(30, 35, 45);
          doc.setFillColor(30, 35, 45);
          doc.setTextColor(255, 255, 255);
          doc.setFont('DejaVuSans', 'bold');
          doc.setFontSize(5);
          doc.rect(M, daySpanStartY, dayColW, spanH, 'FD');
          doc.text(dayLabels[days.indexOf(prevDay)], M + dayColW / 2, daySpanStartY + spanH / 2 + 1.2, { align: 'center' });
        }
      }
    }

    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setTextColor(180, 180, 180);
      doc.setFont('DejaVuSans', 'normal');
      doc.setFontSize(6);
      doc.text(`${i} / ${totalPages}`, pageW - M, pageH - 4, { align: 'right' });
    }

    doc.save(`${schoolName.replace(/\s+/g, '_')}_overview.pdf`);
  }, [schedule, schoolName, days, subjects, groups, t]);

  const toggleLock = (lessonId: string) => {
    setLockedLessons(prev => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  const isLocked = (lessonId: string) => lockedLessons.has(lessonId);
  const isConflict = (lessonId: string) => conflictKeys.has(lessonId);

  const hasSchedule = schedule.length > 0;

  return (
    <div className="schedule-viewer">
      <div className="viewer-controls">
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value as any); setFilterId(''); }}>
          <option value="all">{t('all')}</option>
          <option value="group">{t('view_group')}</option>
          <option value="teacher">{t('view_teacher')}</option>
          <option value="subject">{t('view_subject')}</option>
        </select>

        {filterType !== 'all' && (
          <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
            <option value="">{t('select_view', { type: filterType })}</option>
            {filterType === 'group'
              ? groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
              : filterType === 'teacher'
              ? teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
              : subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
            }
          </select>
        )}

        {filterType === 'all' && (
          <div className="summary-badge">
            {schedule.length} {t('lessons_assigned').toLowerCase()}
            {conflictKeys.size > 0 && <span className="conflict-count"> • {conflictKeys.size} {t('conflicts').toLowerCase()}</span>}
          </div>
        )}

        {hasSchedule && (
          <div className="export-actions">
            <button onClick={exportXLSX} className="export-btn" title={t('export_xlsx')}>XLSX</button>
            <button onClick={exportPDF} className="export-btn" title={t('export_pdf')}>PDF</button>
            <button onClick={exportOverview} className="export-btn" title={t('export_overview')}>{t('export_overview')}</button>
          </div>
        )}
      </div>

      <div className="schedule-stats">
        <div className="stat-block needed">
          <span className="stat-label">{t('needed')}</span>
          <span className="stat-value">{neededHours}</span>
        </div>
        <div className="stat-block assigned">
          <span className="stat-label">{t('assigned')}</span>
          <span className="stat-value">{assignedHours}</span>
        </div>
        <div className={`stat-block unassigned ${unassignedHours > 0 ? 'warn' : 'ok'}`}>
          <span className="stat-label">{t('unassigned')}</span>
          <span className="stat-value">{unassignedHours}</span>
        </div>
        <div className={`stat-block conflicts ${conflictKeys.size > 0 ? 'warn' : 'ok'}`}>
          <span className="stat-label">{t('conflicts')}</span>
          <span className="stat-value">{conflictKeys.size}</span>
        </div>
        <div className={`stat-block score ${score >= 1 ? 'ok' : score >= 0.5 ? 'mid' : 'warn'}`}>
          <span className="stat-label">{t('score')}</span>
          <span className="stat-value">{(score * 100).toFixed(0)}%</span>
        </div>
      </div>

      {!hasSchedule ? (
        <div className="no-selection">{t('generate_schedule_first')}</div>
      ) : (
        <div className="schedule-grid-container">
          <table className="schedule-grid full-schedule" id="schedule-table">
            <thead>
              <tr>
                <th>{t('period')}</th>
                {days.map(day => <th key={day}>{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {allPeriods.map(period => (
                <tr key={period}>
                  <td className="period-col">{period}</td>
                  {days.map(day => {
                    const lessons = getLessonsAt(day, period);
                    return (
                      <td key={day} className={`slot ${lessons.length > 1 ? 'multi-slot' : ''}`}>
                        {lessons.length === 0 ? null : lessons.length === 1 ? (() => {
                          const lesson = lessons[0];
                          return (
                            <div
                              className={`lesson-box ${isLocked(lesson.id) ? 'locked' : ''} ${isConflict(lesson.id) ? 'conflict' : ''}`}
                              onClick={() => toggleLock(lesson.id)}
                              title={isLocked(lesson.id) ? t('click_to_unlock') : t('click_to_lock')}
                            >
                              <div className="subject">{getSubjectName(lesson.subjectId)}</div>
                              <div className="details">
                                {filterType === 'all' ? `${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}` : filterType === 'group' ? getTeacherName(lesson.teacherId) : getGroupName(lesson.groupId)}
                                {lesson.roomId && <span> • {getRoomName(lesson.roomId)}</span>}
                              </div>
                              {isLocked(lesson.id) && <div className="lock-badge">{t('locked')}</div>}
                              {isConflict(lesson.id) && <div className="conflict-badge-small">!</div>}
                            </div>
                          );
                        })() : (
                          <div className="lesson-list">
                            {lessons.map(lesson => (
                              <div
                                key={lesson.id}
                                className={`lesson-box mini ${isLocked(lesson.id) ? 'locked' : ''} ${isConflict(lesson.id) ? 'conflict' : ''}`}
                                onClick={() => toggleLock(lesson.id)}
                                title={isLocked(lesson.id) ? t('click_to_unlock') : t('click_to_lock')}
                              >
                                <div className="subject">{getSubjectName(lesson.subjectId)}</div>
                                <div className="details">
                                  {filterType === 'all' ? `${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}` : filterType === 'group' ? getTeacherName(lesson.teacherId) : getGroupName(lesson.groupId)}
                                </div>
                                {isLocked(lesson.id) && <div className="lock-badge">{t('locked')}</div>}
                                {isConflict(lesson.id) && <div className="conflict-badge-small">!</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
