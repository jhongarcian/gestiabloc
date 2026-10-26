// Small, fully local PDF fixture with a correct cross-reference table.
export function aiSourcePdf(
  text:
    | string
    | null = "Harbor PDF intake uses the Cedar desk. Reference P-42.",
) {
  const escaped = (text ?? "").replace(/[()\\]/g, "\\$&")
  const stream =
    text === null ? "" : `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body))
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
    .join(
      "",
    )}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}
