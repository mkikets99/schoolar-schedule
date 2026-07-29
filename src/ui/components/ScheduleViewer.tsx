import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { useProject } from '../context/ProjectContext';

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

  const formatCellText = (day: string, period: number): string => {
    const lessons = schedule.filter(l => l.day === day && l.period === period);
    if (lessons.length === 0) return '';
    return lessons.map(l => {
      const parts = [getSubjectName(l.subjectId), getGroupName(l.groupId)];
      if (l.teacherId) parts.push(getTeacherName(l.teacherId));
      if (l.roomId) parts.push(getRoomName(l.roomId));
      return parts.join(' | ');
    }).join('\n');
  };

  const buildGridData = () => {
    const usedPeriods = new Set<number>();
    for (const lesson of schedule) usedPeriods.add(lesson.period);
    const periods = [...usedPeriods].sort((a, b) => a - b);

    const header = ['Period', ...days];
    const rows: string[][] = [header];
    for (const p of periods) {
      rows.push([String(p), ...days.map(d => formatCellText(d, p))]);
    }
    return rows;
  };

  const exportXLSX = useCallback(() => {
    const data = buildGridData();
    const ws = XLSX.utils.aoa_to_sheet(data);

    const colWidths = [{ wch: 8 }, ...days.map(() => ({ wch: 30 }))];
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, `${schoolName.replace(/\s+/g, '_')}_schedule.xlsx`);
  }, [schedule, schoolName, days]);

  const exportPDF = useCallback(() => {
    if (!schedule.length) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
      schedule.filter(l => l.day === day && l.period === period);

    const statLabel = (key: string) => t(key);

    const dayLabels = days.map(d => t(d.toLowerCase()));

    const periods = [...new Set(schedule.map(l => l.period))].sort((a, b) => a - b);

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
      doc.setFont('helvetica', 'bold');
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
        doc.setFont('helvetica', 'bold');
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

              // lesson background
              const bg = subjColor(l.subjectId);
              drawCellBg(lx, ly, lw, lh, isConfl ? [255, 220, 220] : bg);

              // thin left accent
              doc.setFillColor(isConfl ? 200 : 100, isConfl ? 60 : 130, isConfl ? 60 : 180);
              doc.rect(lx, ly, 1.5, lh, 'F');

              // subject name
              doc.setTextColor(30, 30, 30);
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(6);
              doc.text(getSubjectName(l.subjectId), lx + 2.5, ly + 2.8);

              // details
              const detailParts = [getTeacherName(l.teacherId), getGroupName(l.groupId)];
              if (l.roomId) detailParts.push(getRoomName(l.roomId));
              doc.setTextColor(100, 100, 100);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(4.5);
              doc.text(detailParts.join(' · '), lx + 2.5, ly + lh - 2);

              // conflict mark
              if (isConfl) {
                doc.setTextColor(200, 50, 50);
                doc.setFont('helvetica', 'bold');
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

    // ---- compute layout ----
    let totalTableH = headerH + rowHeights.reduce((s, h) => s + h, 0);
    const titleBlockH = 30;
    const legendH = 12;
    let neededH = titleBlockH + totalTableH + legendH + 5;

    // ---- title block ----
    let cursorY = M;
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(schoolName, M, cursorY + 8);
    cursorY += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const dateStr = new Date().toLocaleDateString();
    doc.text(`${t('schedule_title')} • ${dateStr}`, M, cursorY + 2);
    cursorY += 9;

    // stats badges
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
      doc.setFont('helvetica', 'bold');
      const sw = 30;
      doc.roundedRect(sx, cursorY, sw, 7, 1.5, 1.5, 'F');
      doc.text(`${label} ${value}`, sx + sw / 2, cursorY + 4.5, { align: 'center' });
      sx += sw + 3;
    }
    cursorY += 13;

    // ---- table ----
    const tableStartY = cursorY;

    // check if we need multiple pages
    const availableH = pageH - M - legendH - 3;
    if (neededH > pageH - M) {
      // need to split
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

    // ---- legend ----
    cursorY += 3;
    if (cursorY > pageH - M - 2) {
      doc.addPage();
      cursorY = M;
    }

    doc.setDrawColor(...BORDER);
    doc.setFillColor(250, 250, 252);
    doc.roundedRect(M, cursorY, pageW - M * 2, 10, 2, 2, 'FD');

    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    let lx = M + 3;
    doc.text(t('legend') + ': ', lx, cursorY + 6.5);
    lx += doc.getTextWidth(t('legend') + ': ') + 2;

    const uniqueSubjects = [...new Set(schedule.map(l => l.subjectId))];
    for (const sid of uniqueSubjects) {
      const color = subjColor(sid);
      const name = getSubjectName(sid);
      doc.setFillColor(...color);
      doc.rect(lx, cursorY + 3, 6, 4.5, 'F');
      doc.setDrawColor(...BORDER);
      doc.rect(lx, cursorY + 3, 6, 4.5, 'S');
      doc.setTextColor(60, 60, 60);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.5);
      doc.text(name, lx + 8, cursorY + 6.5);

      lx += doc.getTextWidth(name) + 13;
      if (lx > pageW - M - 15) {
        cursorY += 7;
        lx = M + 3;
      }
    }

    // ---- page numbers ----
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setTextColor(180, 180, 180);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(`${i} / ${totalPages}`, pageW - M, pageH - 5, { align: 'right' });
    }

    doc.save(`${schoolName.replace(/\s+/g, '_')}_schedule.pdf`);
  }, [schedule, schoolName, days, subjects, teachers, groups, rooms, conflictKeys, neededHours, assignedHours, unassignedHours, score, t]);

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
