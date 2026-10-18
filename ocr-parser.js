/* Geometry-based schedule parsing. Pure/local: no network or model calls. */
'use strict';
(() => {
  const studentLabel = /(?:学生(?:姓名|名称|名)\s*[:：]?|学生\s*[:：]|student\s*name\s*[:：]?)/i;
  const otherLabel = /(?:教室|教师|老师|导师|classroom|teacher)\s*(?:名称|姓名)?\s*[:：]?/i;
  const timePattern = /(?<!\d)([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?!\d)/g;
  const empty = () => ({ studentName: '', courseName: '', lessonDate: '', checkIn: '', checkOut: '', teacherName: '' });
  function textOf(words) {
    return words.map(w => w.text).join(' ')
      .replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
      .replace(/\s*([:：+＋—–])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  }
  function times(text) { return [...text.matchAll(timePattern)].map(m => String(+m[1]).padStart(2, '0') + ':' + m[2]); }
  function date(text) {
    const m = text.match(/(\d{4})[-/.年]\s*(\d{1,2})[-/.月]\s*(\d{1,2})/);
    if (!m) return ''; // A missing year is not evidence for the current year.
    const value = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const d = new Date(value + 'T12:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === value ? value : '';
  }
  function title(text) {
    return text.replace(timePattern, '').replace(/(?:1\s*[vV]\s*1|一对一|1对1)\s*授课/g, '')
      .replace(/^课程(?:名称)?\s*[:：]?/, '').replace(/^[\s|｜·•—–-]+|[\s|｜·•—–-]+$/g, '').trim();
  }
  function teacher(text, roster) {
    const label = text.match(/(?:教师|老师|导师|teacher)\s*(?:姓名|名称)?\s*[:：]\s*(.+)/i);
    if (label) return label[1].trim();
    return [...roster].sort((a, b) => b.length - a.length).find(name => text.trim() === name) || '';
  }
  function lines(words) {
    const groups = [];
    for (const source of words || []) {
      if (!source || typeof source.text !== 'string' || !source.text.trim()) continue;
      const w = { ...source, x: Number(source.x) || 0, y: Number(source.y) || 0, w: Number(source.w) || source.text.length * (Number(source.h) || 20) * .6, h: Math.max(1, Number(source.h) || 20) };
      const cy = w.y + w.h / 2;
      let g = groups.find(g => Math.abs(g.cy - cy) <= Math.min(g.h, w.h) * .55);
      if (!g) { g = { cy, h: w.h, words: [] }; groups.push(g); }
      g.words.push(w);
    }
    const result = [];
    for (const g of groups) {
      const sorted = g.words.sort((a, b) => a.x - b.x), parts = [[]];
      for (const w of sorted) {
        const part = parts.at(-1), prev = part.at(-1);
        if (prev && w.x - (prev.x + prev.w) > Math.max(prev.h, w.h) * 6) parts.push([]);
        parts.at(-1).push(w);
      }
      for (const part of parts) result.push({ words: part, text: textOf(part), x: part[0].x, y: Math.min(...part.map(w => w.y)), h: Math.max(...part.map(w => w.h)) });
    }
    return result.sort((a, b) => a.y - b.y || a.x - b.x);
  }
  function parse(words, roster = []) {
    const all = lines(words), anchors = all.filter(l => studentLabel.test(l.text));
    // Explicit student labels identify cards. Other text lines are not lessons.
    if (anchors.length) {
      const columns = [];
      for (const anchor of anchors) {
        const labelWord = anchor.words.find(w => /学|student/i.test(w.text));
        anchor.labelX = labelWord ? labelWord.x : anchor.x;
        let column = columns.find(c => Math.abs(c.x - anchor.labelX) < anchor.h * 5);
        if (!column) { column = { x: anchor.labelX, anchors: [] }; columns.push(column); }
        column.anchors.push(anchor);
      }
      columns.sort((a, b) => a.x - b.x);
      const output = [];
      for (let c = 0; c < columns.length; c++) {
        const column = columns[c], left = c ? (columns[c - 1].x + column.x) / 2 : -Infinity;
        const right = c + 1 < columns.length ? (column.x + columns[c + 1].x) / 2 : Infinity;
        for (let i = 0; i < column.anchors.length; i++) {
          const anchor = column.anchors[i], previous = column.anchors[i - 1], next = column.anchors[i + 1];
          const top = previous ? (previous.y + anchor.y) / 2 : -Infinity;
          const bottom = next ? (next.y + anchor.y) / 2 : Infinity;
          // Split again at column boundaries: simultaneous cards may share a text line.
          const region = lines((words || []).filter(w => w.x >= left && w.x < right && w.y >= top && w.y < bottom));
          const row = empty();
          row.studentName = anchor.text.split(studentLabel)[1]?.split(otherLabel)[0].replace(/^[\s:：]+/, '').trim() || '';
          const continuation = region.filter(l => l.y > anchor.y + anchor.h * .65 && l.y < anchor.y + anchor.h * 2.6 && l.x >= anchor.labelX - anchor.h && !otherLabel.test(l.text) && !studentLabel.test(l.text) && !times(l.text).length && !/课|项目|日期|授课/.test(l.text));
          for (const line of continuation) {
            if (/^[\p{L}][\p{L}\s.'’·-]*$/u.test(line.text)) row.studentName += (row.studentName ? ' ' : '') + line.text;
          }
          const near = region.filter(l => Math.abs(l.y - anchor.y) < anchor.h * 4);
          const clock = near.flatMap(l => times(l.text));
          if (clock.length <= 2) { row.checkIn = clock[0] || ''; row.checkOut = clock[1] || ''; }
          const course = near.filter(l => l.y < anchor.y && !studentLabel.test(l.text) && !otherLabel.test(l.text) && !date(l.text) && !/课表|课程表/.test(l.text))
            .map(l => ({ ...l, title: title(l.text) })).filter(l => l.title && !/^(?:\d|星期|周[一二三四五六日天])/.test(l.title)).at(-1);
          row.courseName = course?.title || '';
          row.teacherName = region.map(l => teacher(l.text, roster)).find(Boolean) || '';
          row.lessonDate = all.filter(l => l.y <= anchor.y && l.x >= left && l.x < right).map(l => date(l.text)).filter(Boolean).at(-1) || '';
          // An explicit but empty label remains one editable, unselected candidate.
          output.push({ row, y: anchor.y, x: anchor.labelX });
        }
      }
      return output.sort((a, b) => a.y - b.y || a.x - b.x).map(item => item.row);
    }
    // Ordinary one-line tables: require a time range AND a plausible name.
    const output = [];
    for (const line of all) {
      const clock = times(line.text);
      if (clock.length !== 2 || otherLabel.test(line.text) || /课表|课程表/.test(line.text)) continue;
      const row = empty(); row.checkIn = clock[0]; row.checkOut = clock[1]; row.lessonDate = date(line.text);
      let rest = line.words.map(w => w.text).join(' ').replace(timePattern, '').replace(/\d{4}[-/.年]\s*\d{1,2}[-/.月]\s*\d{1,2}日?/, '').replace(/[|｜~至到—–-]/g, ' ').trim();
      for (const name of roster) if (rest.includes(name)) { row.teacherName = name; rest = rest.replace(name, ' '); break; }
      const tokens = rest.split(/\s+/).filter(Boolean);
      const candidate = tokens.findIndex(t => /^[\p{Script=Han}]{2,8}$/u.test(t) && !/课|项目|授课/.test(t) && !/^(?:学生|教师|教室|名称|姓名|基础|软件)$/.test(t));
      if (candidate < 0) continue;
      row.studentName = tokens.splice(candidate, 1)[0]; row.courseName = title(tokens.join(' ')); output.push(row);
    }
    return output;
  }
  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.SFKScheduleParser = api;
})();
