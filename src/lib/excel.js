// 엑셀(xlsx) 읽기/쓰기 — 필요할 때만 exceljs를 불러와서 첫 화면 속도에 영향 없음
let _excel = null;
async function ExcelJS() {
  if (!_excel) {
    const m = await import("exceljs");
    _excel = m.default || m;
  }
  return _excel;
}

function cellValue(v) {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return undefined;
    return String(v);
  }
  return v;
}

// 첫 번째 시트의 1행을 컬럼명으로 사용 (pandas.read_excel 기본 동작과 동일)
export async function readExcel(file) {
  const Excel = await ExcelJS();
  const wb = new Excel.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return { columns: [], rows: [] };
  const header = [];
  const first = ws.getRow(1);
  first.eachCell({ includeEmpty: true }, (cell, col) => {
    const v = cellValue(cell.value);
    header[col] = v === undefined ? `Unnamed: ${col - 1}` : String(v).trim();
  });
  const columns = header.filter((x) => x !== undefined);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1) return;
    const obj = {};
    let any = false;
    header.forEach((h, col) => {
      if (h === undefined) return;
      const v = cellValue(row.getCell(col).value);
      if (v !== undefined && v !== "") any = true;
      obj[h] = v;
    });
    if (any) rows.push(obj);
  });
  return { columns, rows };
}

// sheets: [{ name, columns, rows, hidden, validations: [{ range: "C2:C500", formula: "='시트'!$A$2:$A$200" }] }]
export async function downloadExcel(filename, sheets) {
  const Excel = await ExcelJS();
  const wb = new Excel.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.columns);
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows || []) ws.addRow(s.columns.map((c) => (r[c] === undefined ? null : r[c])));
    s.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.max(10, String(c).length * 2 + 4);
    });
    if (s.hidden) ws.state = "hidden";
    for (const v of s.validations || []) {
      const [a, b] = v.range.split(":");
      const colL = a.replace(/\d+/g, "");
      const r1 = Number(a.replace(/\D+/g, ""));
      const r2 = Number(b.replace(/\D+/g, ""));
      for (let r = r1; r <= r2; r++) {
        ws.getCell(`${colL}${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [v.formula.replace(/^=/, "")] };
      }
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
