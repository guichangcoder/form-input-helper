import * as XLSX from 'xlsx';

export interface ParsedSheet {
  /** sheet 名称 */
  name: string;
  /** 表头（第一行非空行的单元格文本） */
  headers: string[];
  /** 数据行（不含表头），每行与 headers 对齐 */
  rows: unknown[][];
  /** 总数据行数 */
  total: number;
}

/**
 * 解析 Excel 文件（.xlsx/.xls/.csv），返回所有 sheet 的解析结果。
 * - cellDates: true 使日期单元格变为 JS Date 对象
 * - 第一行视为表头；若表头为空则自动命名为「列N」
 */
export async function parseExcel(file: File): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheets: ParsedSheet[] = [];

  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    // header:1 得到二维数组，raw:true 保留原始值，defval:'' 保证对齐
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: '',
    }) as unknown[][];

    if (matrix.length === 0) continue;

    // 找到第一个非空行作为表头
    let headerIdx = 0;
    while (headerIdx < matrix.length && isEmptyRow(matrix[headerIdx])) {
      headerIdx++;
    }
    if (headerIdx >= matrix.length) continue;

    const headers = matrix[headerIdx].map((c, i) => {
      const t = cellToText(c);
      return t.trim() ? t.trim() : `列${i + 1}`;
    });
    const rows = matrix.slice(headerIdx + 1).filter((r) => !isEmptyRow(r));

    sheets.push({
      name,
      headers,
      rows,
      total: rows.length,
    });
  }

  return sheets;
}

/** 单元格转文本 */
function cellToText(cell: unknown): string {
  if (cell == null) return '';
  if (cell instanceof Date) {
    return formatDate(cell);
  }
  return String(cell);
}

/** 判断一行是否全空 */
function isEmptyRow(row: unknown[]): boolean {
  return row.every((c) => c == null || String(c).trim() === '');
}

/** Date → 文本（YYYY-MM-DD HH:mm:ss，本地时区） */
export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

/** 单元格值显示文本（预览用） */
export function cellDisplayText(cell: unknown): string {
  if (cell == null || cell === '') return '';
  if (cell instanceof Date) return formatDate(cell);
  const s = String(cell);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
