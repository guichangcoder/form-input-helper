/* eslint-disable */
// 核心逻辑测试：值转换 + Excel 解析（用 esbuild 打包后以 node 运行）
import assert from 'node:assert';
import { convertCellValue } from './src/utils/convert.ts';
import { parseExcel, formatDate } from './src/utils/excel.ts';
import * as XLSX from 'xlsx';

const field = (type, name = 'f') => ({ id: 'f1', type, name, isPrimary: false });

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    console.error(`  ✘ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('-- convertCellValue --');
t('文本', () => assert.deepStrictEqual(convertCellValue('abc', field(1)), { ok: true, value: 'abc' }));
t('数字-千分位', () => assert.deepStrictEqual(convertCellValue('1,234.56', field(2)), { ok: true, value: 1234.56 }));
t('数字-货币符', () => assert.deepStrictEqual(convertCellValue('¥1,000', field(99003)), { ok: true, value: 1000 }));
t('数字-百分号', () => assert.deepStrictEqual(convertCellValue('85%', field(2)), { ok: true, value: 85 }));
t('数字-非法', () => assert.ok(!convertCellValue('abc', field(2)).ok));
t('单选', () => assert.deepStrictEqual(convertCellValue('A', field(3)), { ok: true, value: 'A' }));
t('多选-多分隔符', () => assert.deepStrictEqual(convertCellValue('A，B, C;D、E', field(4)), { ok: true, value: ['A', 'B', 'C', 'D', 'E'] }));
t('多选-去重', () => assert.deepStrictEqual(convertCellValue('A,A,B', field(4)), { ok: true, value: ['A', 'B'] }));
t('日期-字符串', () => {
  const r = convertCellValue('2024-01-01', field(5));
  assert.ok(r.ok);
  assert.strictEqual(new Date(r.value).getHours(), 0);
  assert.strictEqual(new Date(r.value).getMonth(), 0);
});
t('日期-中文', () => {
  const r = convertCellValue('2024年1月1日', field(5));
  assert.ok(r.ok);
  assert.strictEqual(new Date(r.value).getDate(), 1);
});
t('日期-Date对象', () => {
  const d = new Date(2024, 5, 15, 10, 30);
  const r = convertCellValue(d, field(5));
  assert.strictEqual(r.value, d.getTime());
});
t('日期-非法', () => assert.ok(!convertCellValue('不是日期', field(5)).ok));
t('复选框-是', () => assert.deepStrictEqual(convertCellValue('是', field(7)), { ok: true, value: true }));
t('复选框-否', () => assert.deepStrictEqual(convertCellValue('false', field(7)), { ok: true, value: false }));
t('复选框-非法', () => assert.ok(!convertCellValue('x', field(7)).ok));
t('空值-跳过', () => assert.ok(convertCellValue('', field(1)).skip));
t('电话-数字开头0', () => assert.deepStrictEqual(convertCellValue('13800138000', field(13)), { ok: true, value: '13800138000' }));
t('邮箱', () => assert.deepStrictEqual(convertCellValue('a@b.com', field(99005)), { ok: true, value: 'a@b.com' }));
t('人员-对象数组', () => {
  const r = convertCellValue([{ id: 'ou_a', name: '张三' }], field(11));
  assert.ok(r.ok);
  assert.deepStrictEqual(r.value, [{ id: 'ou_a', name: '张三' }]);
});
t('人员-open_id字符串', () => {
  const r = convertCellValue('ou_abc123', field(11));
  assert.ok(r.ok);
  assert.deepStrictEqual(r.value, [{ id: 'ou_abc123' }]);
});
t('人员-非法文本', () => assert.ok(!convertCellValue('张三', field(11)).ok));
t('人员-去重', () => {
  const r = convertCellValue([{ id: 'ou_a' }, { id: 'ou_a' }, { id: 'ou_b' }], field(11));
  assert.ok(r.ok);
  assert.strictEqual((r.value as unknown[]).length, 2);
});

console.log('-- matchCell --');
import { matchCell } from './src/utils/match.ts';
const cond = (type, rawValue, op = 'eq') => ({ fieldId: 'f1', fieldMeta: field(type), operator: op, rawValue });
t('匹配-文本等于', () => assert.ok(matchCell('张三', cond(1, '张三'))));
t('匹配-文本等于-trim', () => assert.ok(matchCell(' 张三 ', cond(1, '张三'))));
t('匹配-文本等于-大小写', () => assert.ok(matchCell('ABC', cond(1, 'abc'))));
t('匹配-文本不等于', () => assert.ok(!matchCell('张三', cond(1, '李四'))));
t('匹配-文本包含', () => assert.ok(matchCell('智能工厂项目', cond(1, '智能', 'contains'))));
t('匹配-文本不包含', () => assert.ok(!matchCell('普通项目', cond(1, '智能', 'contains'))));
t('匹配-单选', () => assert.ok(matchCell({ text: '进行中' }, cond(3, '进行中'))));
t('匹配-多选-单个', () => assert.ok(matchCell([{ text: 'a' }, { text: 'b' }], cond(4, 'a'))));
t('匹配-多选-多个都含', () => assert.ok(matchCell([{ text: 'a' }, { text: 'b' }], cond(4, 'a,b'))));
t('匹配-多选-缺一不中', () => assert.ok(!matchCell([{ text: 'a' }, { text: 'b' }], cond(4, 'a,c'))));
t('匹配-数字等于', () => assert.ok(matchCell(100, cond(2, '100'))));
t('匹配-数字大于等于', () => assert.ok(matchCell(100, cond(2, '90', 'gte'))));
t('匹配-数字不大于', () => assert.ok(!matchCell(80, cond(2, '90', 'gte'))));
t('匹配-数字小于等于', () => assert.ok(matchCell(80, cond(2, '90', 'lte'))));
t('匹配-日期同天', () => {
  const a = Date.parse('2026-10-01 08:00');
  const b = Date.parse('2026-10-01 20:00');
  assert.ok(matchCell(a, cond(5, b)));
});
t('匹配-日期不同天', () => {
  const a = Date.parse('2026-10-01 08:00');
  const b = Date.parse('2026-10-02 20:00');
  assert.ok(!matchCell(a, cond(5, b)));
});
t('匹配-复选框是', () => assert.ok(matchCell(true, cond(7, '是'))));
t('匹配-复选框否', () => assert.ok(!matchCell(false, cond(7, '是'))));
t('匹配-人员', () => assert.ok(matchCell([{ id: 'ou_a', name: '张三' }], cond(11, [{ id: 'ou_a' }]))));
t('匹配-人员不中', () => assert.ok(!matchCell([{ id: 'ou_a' }], cond(11, [{ id: 'ou_b' }]))));

console.log('-- cellToRawValue --');
import { cellToRawValue } from './src/utils/match.ts';
t('预填-文本', () => assert.strictEqual(cellToRawValue('abc', field(1)), 'abc'));
t('预填-单选', () => assert.strictEqual(cellToRawValue({ text: 'A' }, field(3)), 'A'));
t('预填-多选', () => assert.strictEqual(cellToRawValue([{ text: 'a' }, { text: 'b' }], field(4)), 'a、b'));
t('预填-数字', () => assert.strictEqual(cellToRawValue(100, field(2)), 100));
t('预填-复选框', () => assert.strictEqual(cellToRawValue(true, field(7)), '是'));
t('预填-空值', () => assert.strictEqual(cellToRawValue(null, field(1)), ''));
t('预填-人员', () => {
  const r = cellToRawValue([{ id: 'ou_a', name: '张三' }], field(11));
  assert.deepStrictEqual(r, [{ id: 'ou_a', name: '张三' }]);
});

console.log('-- parseExcel --');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['名称', '数量', '日期', '标签', '勾选'],
  ['A', 123, new Date(2024, 0, 1), 'x;y', '是'],
  ['B', '1,234', '2024-02-03', 'z', '否'],
  ['', '', '', '', ''],
]);
XLSX.utils.book_append_sheet(wb, ws, '数据');
const tmpXlsx = process.env.TEMP + '\\core_test.xlsx';
XLSX.writeFile(wb, tmpXlsx);

t('Excel 解析-表头', async () => {
  const file = new File([require('fs').readFileSync(tmpXlsx)], 'test.xlsx');
  const sheets = await parseExcel(file);
  assert.strictEqual(sheets.length, 1);
  assert.deepStrictEqual(sheets[0].headers, ['名称', '数量', '日期', '标签', '勾选']);
  assert.strictEqual(sheets[0].total, 2);
  // 日期单元格应解析为 Date
  assert.ok(sheets[0].rows[0][2] instanceof Date);
});
t('formatDate', () => {
  assert.strictEqual(formatDate(new Date(2024, 0, 2, 3, 4, 5)), '2024-01-02 03:04:05');
});

console.log(`\n通过 ${passed} 项；未通过: ${process.exitCode ? '有' : '无'}`);
