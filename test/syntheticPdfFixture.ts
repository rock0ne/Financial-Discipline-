import { jsPDF } from 'jspdf';

/** Fictional values only; safe for automated importer tests. */
export function makeSyntheticStatementPdf(): Uint8Array {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: false });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text('Synthetic test statement GBP', 40, 60);
  pdf.text('Date', 40, 100);
  pdf.text('Description', 120, 100);
  pdf.text('Debit', 350, 100);
  pdf.text('Credit', 430, 100);
  pdf.text('Balance', 510, 100);

  pdf.text('03/11/2026', 40, 130);
  pdf.text('Trainline ticket', 120, 130);
  pdf.text('£14.50', 350, 130);
  pdf.text('£985.50', 510, 130);

  pdf.text('04/11/2026', 40, 155);
  pdf.text('Salary payroll', 120, 155);
  pdf.text('£2,500.00', 430, 155);
  pdf.text('£3,485.50', 510, 155);

  pdf.text('04/11/2026', 40, 185);
  pdf.text('Closing Balance', 120, 185);
  pdf.text('£3,485.50', 510, 185);
  return new Uint8Array(pdf.output('arraybuffer'));
}
