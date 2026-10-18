// Local word-box fixtures based on the supplied card layout, not a paid OCR call.
const assert = require('node:assert/strict');
const { parse } = require('../ocr-parser.js');
const word = (text, x, y, w = text.length * 12, h = 22) => ({ text, x, y, w, h });
function card({ name = 'Michael Zhicheng Fan', x = 0, y = 0, start = '13:30', end = '14:30' } = {}) {
  return [word('基础课', x + 168, y + 40, 70), word('+', x + 240, y + 40, 12), word('项目', x + 254, y + 40, 50), word('—', x + 307, y + 40, 16), word('1V1授课', x + 362, y + 33, 90),
    word(start, x + 42, y + 60, 65), word('学', x + 168, y + 85, 22), word('生', x + 190, y + 85, 22), word('名', x + 212, y + 85, 22), word('称', x + 234, y + 85, 22), word(':', x + 256, y + 85, 6),
    ...name.split(' ').map((text, i, names) => word(text, x + 288 + names.slice(0, i).join(' ').length * 12 + (i ? 12 : 0), y + 85)),
    word(end, x + 42, y + 106, 65), word('教室名称', x + 168, y + 128, 88), word(':', x + 258, y + 128, 6)];
}
function test(name, check) { check(); console.log('PASS', name); }

test('用户示例：一张卡只生成一节课，保留英文全名并合并上下时间', () => {
  const result = parse(card()); assert.equal(result.length, 1);
  assert.deepEqual(result[0], { studentName: 'Michael Zhicheng Fan', courseName: '基础课+项目', lessonDate: '', checkIn: '13:30', checkOut: '14:30', teacherName: '' });
});
test('同一个学生的两节实际课程保留两条，不按姓名盲目去重', () => {
  const result = parse([...card(), ...card({ y: 200, start: '15:00', end: '16:00' })]);
  assert.equal(result.length, 2); assert.deepEqual(result.map(r => r.checkIn), ['13:30', '15:00']);
});
test('并排卡片不串学生或时间', () => {
  const result = parse([...card({ name: '张三' }), ...card({ name: '李四', x: 800, start: '09:00', end: '10:00' })]);
  assert.equal(result.length, 2); assert.deepEqual(result.map(r => [r.studentName, r.checkIn, r.checkOut]), [['张三', '13:30', '14:30'], ['李四', '09:00', '10:00']]);
});
test('单独的课程、时间、教室和字段标签不生成课程', () => {
  assert.deepEqual(parse([word('基础课+项目', 160, 10), word('13:30', 40, 40), word('14:30', 40, 80), word('教室名称:', 160, 100)]), []);
});
test('空学生标签保留一张待补全卡，不把标签当作姓名', () => {
  const result = parse(card({ name: '' })); assert.equal(result.length, 1); assert.equal(result[0].studentName, '');
});
test('缩放或打乱词框顺序不改变分组', () => {
  const resized = card().reverse().map(w => ({ text: w.text, x: w.x * 2, y: w.y * 2, w: w.w * 2, h: w.h * 2 }));
  assert.deepEqual(parse(resized), parse(card()));
});
test('显式完整日期可继承，缺少年份不推测今天或当前年', () => {
  assert.equal(parse([word('2026-10-18', 180, -30), ...card()])[0].lessonDate, '2026-10-18');
  assert.equal(parse([word('10/18', 180, -30), ...card()])[0].lessonDate, '');
});
test('兼容一行表格，规范化单数字小时', () => {
  const result = parse([word('测试学生', 0, 0, 80), word('2026-10-18', 100, 0, 120), word('9:00-10:00', 250, 0, 130)]);
  assert.equal(result.length, 1); assert.equal(result[0].studentName, '测试学生'); assert.equal(result[0].checkIn, '09:00');
});
test('英文姓名换行可续接，教室标签不进入姓名', () => {
  const words = card({ name: 'Michael' }).map(w => w.text === '教室名称' || (w.text === ':' && w.y === 128) ? { ...w, y: 155 } : w);
  words.push(word('Zhicheng', 288, 112, 96), word('Fan', 396, 112, 36));
  assert.equal(parse(words)[0].studentName, 'Michael Zhicheng Fan');
});
