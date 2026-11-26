type Cell = string | number | null;

export function csvCell(value: Cell) {
  const text = String(value ?? "");
  const safe = typeof value === "string" && /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function csv(rows: Cell[][]) {
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
}
