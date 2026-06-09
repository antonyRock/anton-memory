import * as XLSX from "xlsx";

export type RawCell = {
  sheet_name: string;
  cell_address: string;
  row: number;
  column: string;
  raw_value: string | number | boolean;
  formatted_value: string;
  formula?: string;
};

export type DetectedTable = {
  sheet_name: string;
  table_range: string;
  detected_headers: string[];
  header_row: number;
  rows: Array<Record<string, string>>;
};

export type ParsedSheet = {
  name: string;
  row_count: number;
  column_count: number;
  non_empty_cells: RawCell[];
  detected_tables: DetectedTable[];
};

export type SpreadsheetParseResult = {
  text: string;
  summary: string;
  metadata: {
    kind: "spreadsheet";
    file_type: string;
    sheet_count: number;
    row_count: number;
    column_count: number;
    sheets: Array<{ name: string; row_count: number; column_count: number; non_empty_cell_count: number }>;
    non_empty_cells: RawCell[];
    detected_tables: DetectedTable[];
  };
};

const MAX_CELLS_IN_METADATA = 2500;
const MAX_CELLS_IN_TEXT = 800;
const MAX_TABLE_ROWS = 200;
const MAX_EXTRACTED_TEXT = 80_000;

function columnLetter(columnIndex: number) {
  return XLSX.utils.encode_col(columnIndex);
}

function isEmptyValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

function cellFormattedValue(cell: XLSX.CellObject) {
  if (cell.w != null && String(cell.w).trim()) return String(cell.w).trim();
  if (cell.v == null) return "";
  if (cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.v).trim();
}

function extractRawCellsFromSheet(worksheet: XLSX.WorkSheet, sheetName: string): RawCell[] {
  const ref = worksheet["!ref"];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const cells: RawCell[] = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[cellAddress] as XLSX.CellObject | undefined;
      if (!cell || isEmptyValue(cell.v)) continue;

      const formatted = cellFormattedValue(cell);
      if (!formatted) continue;

      cells.push({
        sheet_name: sheetName,
        cell_address: cellAddress,
        row: rowIndex + 1,
        column: columnLetter(columnIndex),
        raw_value: cell.v as string | number | boolean,
        formatted_value: formatted,
        ...(cell.f ? { formula: String(cell.f) } : {})
      });
    }
  }

  return cells;
}

function looksLikeHeaderValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^__empty/i.test(trimmed)) return false;
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return false;
  return trimmed.length <= 80;
}

function detectTableOnSheet(cells: RawCell[], worksheet: XLSX.WorkSheet, sheetName: string): DetectedTable[] {
  if (cells.length === 0) return [];

  const byRow = new Map<number, RawCell[]>();
  for (const cell of cells) {
    const rowCells = byRow.get(cell.row) ?? [];
    rowCells.push(cell);
    byRow.set(cell.row, rowCells);
  }

  const sortedRows = [...byRow.keys()].sort((a, b) => a - b);
  if (sortedRows.length < 2) return [];

  const headerRow = sortedRows[0];
  const headerCells = (byRow.get(headerRow) ?? []).sort((a, b) => a.column.localeCompare(b.column));
  if (headerCells.length < 2) return [];

  const headerValues = headerCells.map((cell) => cell.formatted_value);
  if (headerValues.filter(looksLikeHeaderValue).length < Math.ceil(headerCells.length * 0.6)) {
    return [];
  }

  const headers = headerValues.map((value, index) => value || `Column_${index + 1}`);
  const uniqueHeaders = new Set(headers.map((header) => header.toLowerCase()));
  if (uniqueHeaders.size < headers.length) return [];

  const dataRows: Array<Record<string, string>> = [];
  for (const rowNumber of sortedRows.slice(1, 1 + MAX_TABLE_ROWS)) {
    const rowCells = byRow.get(rowNumber) ?? [];
    if (rowCells.length === 0) continue;

    const rowRecord: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const headerCell = headerCells[index];
      const match = headerCell
        ? rowCells.find((cell) => cell.column === headerCell.column)
        : undefined;
      rowRecord[headers[index]] = match?.formatted_value ?? "";
    }

    if (Object.values(rowRecord).some(Boolean)) {
      dataRows.push(rowRecord);
    }
  }

  if (dataRows.length === 0) return [];

  const ref = worksheet["!ref"] ?? "A1";
  const range = XLSX.utils.decode_range(ref);
  const tableRange = `${XLSX.utils.encode_cell({ r: headerRow - 1, c: range.s.c })}:${XLSX.utils.encode_cell({
    r: Math.min(range.e.r, headerRow - 1 + dataRows.length),
    c: range.e.c
  })}`;

  return [
    {
      sheet_name: sheetName,
      table_range: tableRange,
      detected_headers: headers,
      header_row: headerRow,
      rows: dataRows
    }
  ];
}

function parseSheet(worksheet: XLSX.WorkSheet, sheetName: string): ParsedSheet {
  const nonEmptyCells = extractRawCellsFromSheet(worksheet, sheetName);
  const detectedTables = detectTableOnSheet(nonEmptyCells, worksheet, sheetName);

  const ref = worksheet["!ref"];
  let rowCount = 0;
  let columnCount = 0;
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    rowCount = range.e.r - range.s.r + 1;
    columnCount = range.e.c - range.s.c + 1;
  }

  return {
    name: sheetName,
    row_count: rowCount,
    column_count: columnCount,
    non_empty_cells: nonEmptyCells,
    detected_tables: detectedTables
  };
}

export function formatSpreadsheetCompactText(fileName: string, sheets: ParsedSheet[]) {
  const lines = [`Файл: ${fileName}`];

  for (const sheet of sheets) {
    lines.push(`${sheet.name}:`);

    const cellsForText = sheet.non_empty_cells.slice(0, MAX_CELLS_IN_TEXT);
    for (const cell of cellsForText) {
      lines.push(`${cell.cell_address} = ${cell.formatted_value}`);
    }

    if (sheet.non_empty_cells.length > MAX_CELLS_IN_TEXT) {
      lines.push(
        `… ещё ${sheet.non_empty_cells.length - MAX_CELLS_IN_TEXT} непустых ячеек (см. metadata.non_empty_cells)`
      );
    }

    for (const table of sheet.detected_tables) {
      lines.push(
        `Таблица ${table.sheet_name} (${table.table_range}), заголовки: ${table.detected_headers.join(" | ")}`
      );
      for (const row of table.rows.slice(0, 50)) {
        lines.push(table.detected_headers.map((header) => row[header] ?? "").join("\t"));
      }
      if (table.rows.length > 50) {
        lines.push(`… ещё ${table.rows.length - 50} строк таблицы`);
      }
    }
  }

  return lines.join("\n").slice(0, MAX_EXTRACTED_TEXT);
}

function summarizeSpreadsheet(fileName: string, fileType: string, sheets: ParsedSheet[]) {
  const cellCount = sheets.reduce((sum, sheet) => sum + sheet.non_empty_cells.length, 0);
  const sheetNames = sheets.map((sheet) => sheet.name).slice(0, 4).join(", ");
  const sampleCells = sheets
    .flatMap((sheet) => sheet.non_empty_cells.slice(0, 3))
    .map((cell) => `${cell.sheet_name}!${cell.cell_address}=${cell.formatted_value}`)
    .join("; ");
  return `Файл ${fileName} (${fileType.toUpperCase()}): ${sheets.length} лист., ${cellCount} непустых ячеек. ${sheetNames}. ${sampleCells}`.slice(
    0,
    500
  );
}

export function parseSpreadsheetWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string,
  fileType: string
): SpreadsheetParseResult {
  const sheets = workbook.SheetNames.map((sheetName) => parseSheet(workbook.Sheets[sheetName], sheetName));
  const allCells = sheets.flatMap((sheet) => sheet.non_empty_cells);
  const allTables = sheets.flatMap((sheet) => sheet.detected_tables);

  return {
    text: formatSpreadsheetCompactText(fileName, sheets),
    summary: summarizeSpreadsheet(fileName, fileType, sheets),
    metadata: {
      kind: "spreadsheet",
      file_type: fileType,
      sheet_count: sheets.length,
      row_count: sheets.reduce((sum, sheet) => sum + sheet.row_count, 0),
      column_count: sheets.reduce((max, sheet) => Math.max(max, sheet.column_count), 0),
      sheets: sheets.map((sheet) => ({
        name: sheet.name,
        row_count: sheet.row_count,
        column_count: sheet.column_count,
        non_empty_cell_count: sheet.non_empty_cells.length
      })),
      non_empty_cells: allCells.slice(0, MAX_CELLS_IN_METADATA),
      detected_tables: allTables
    }
  };
}

export function spreadsheetFileTypeFromName(lowerName: string) {
  if (lowerName.endsWith(".csv")) return "csv";
  if (lowerName.endsWith(".xls")) return "xls";
  return "xlsx";
}
