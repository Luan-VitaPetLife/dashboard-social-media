// reportRenderer.js — os dois exportadores (PDF via pdfkit, DOCX via docx) que consomem o
// mesmo "modelo de relatório" genérico produzido por src/reports.js:
//   {
//     title, subtitle, brandName, countryLabel, generatedAtISO,
//     sections: [{ heading, paragraphs?: string[], table?: {columns, rows}, callout?: {label, text} }]
//   }
// Um único modelo pros dois formatos evita que PDF e DOCX divirjam com o tempo — qualquer
// relatório novo (D+7, Stories, mensal por país/rede/geral, ver src/reports.js) só precisa
// montar esse modelo, sem conhecer nada de pdfkit/docx.
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, AlignmentType, Footer, PageNumber } from 'docx';
import { COLORS, BRAND_FOOTER } from './reportTemplate.js';

// ── PDF (pdfkit) ────────────────────────────────────────────────────────────────────────────
const PAGE_MARGIN = 50;

export function renderReportPdf(model) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const usableWidth = doc.page.width - PAGE_MARGIN * 2;
    const left = doc.page.margins.left;

    doc.font('Helvetica-Bold').fontSize(19).fillColor(COLORS.purpleDark).text(model.title, { width: usableWidth });
    if (model.subtitle) {
      doc.moveDown(0.15);
      doc.font('Helvetica-Oblique').fontSize(10.5).fillColor(COLORS.subtitleBlue).text(model.subtitle, { width: usableWidth });
    }
    doc.moveDown(0.6);
    drawRule(doc, left, usableWidth, COLORS.purpleDark, 1);
    doc.moveDown(0.8);

    for (const section of model.sections) renderSection(doc, section, left, usableWidth);

    // Rodapé com "Página N de M" em todas as páginas — só dá pra saber o total no fim, por
    // isso bufferPages:true (deixa voltar em cada página já criada e desenhar por cima).
    const range = doc.bufferedPageRange();
    const footerText = BRAND_FOOTER(model.brandName, model.countryLabel);
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // O y do rodapé fica dentro da margem inferior reservada — sem zerar `margins.bottom`
      // antes, o pdfkit interpreta isso como overflow e insere silenciosamente uma página em
      // branco só pra desenhar o rodapé (bug real encontrado no teste de fumaça do renderer).
      const originalBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - PAGE_MARGIN + 16;
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted)
        .text(`${footerText} • Página ${i + 1} de ${range.count}`, left, y, { width: usableWidth, align: 'center' });
      doc.page.margins.bottom = originalBottom;
    }

    doc.end();
  });
}

function checkSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function drawRule(doc, left, width, color, thickness) {
  const y = doc.y;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(thickness || 0.75).strokeColor(color).stroke();
  doc.y = y + 4;
}

function renderSection(doc, section, left, usableWidth) {
  doc.x = left;
  checkSpace(doc, 50);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.purpleDark).text(section.heading, { width: usableWidth });
  drawRule(doc, left, usableWidth, COLORS.purpleDark, 0.75);
  doc.moveDown(0.5);

  if (section.paragraphs?.length) {
    doc.font('Helvetica').fontSize(10.5);
    for (const p of section.paragraphs) {
      doc.x = left;
      const h = doc.heightOfString(p, { width: usableWidth });
      checkSpace(doc, h + 12);
      doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.textDark).text(p, { width: usableWidth });
      doc.moveDown(0.4);
    }
  }

  if (section.table) {
    doc.moveDown(0.15);
    renderTable(doc, section.table, left, usableWidth);
    doc.moveDown(0.5);
  }

  if (section.callout) {
    renderCallout(doc, section.callout, left, usableWidth);
    doc.moveDown(0.5);
  }

  doc.x = left;
  doc.moveDown(0.5);
}

// Sem repetição de cabeçalho quando uma tabela atravessa página — simplificação aceitável dado
// o tamanho típico das tabelas destes relatórios (poucas linhas cada).
function renderTable(doc, table, left, usableWidth) {
  const { columns, rows } = table;
  const colWidth = usableWidth / columns.length;
  const pad = 6;

  function rowHeight(cells, font, size) {
    doc.font(font).fontSize(size);
    let max = 0;
    for (const cell of cells) {
      const h = doc.heightOfString(String(cell ?? '—'), { width: colWidth - pad * 2 });
      if (h > max) max = h;
    }
    return max + pad * 2;
  }

  function drawRow(cells, { bg, textColor, bold }) {
    const font = bold ? 'Helvetica-Bold' : 'Helvetica';
    const size = 9.5;
    const h = rowHeight(cells, font, size);
    checkSpace(doc, h + 24);
    const y0 = doc.y;
    if (bg) doc.rect(left, y0, usableWidth, h).fill(bg);
    doc.font(font).fontSize(size).fillColor(textColor);
    cells.forEach((cell, i) => {
      doc.text(String(cell ?? '—'), left + i * colWidth + pad, y0 + pad, { width: colWidth - pad * 2 });
    });
    doc.y = y0 + h;
  }

  drawRow(columns, { bg: COLORS.purpleDark, textColor: COLORS.white, bold: true });
  rows.forEach((r, i) => drawRow(r, { bg: i % 2 === 1 ? COLORS.rowStripe : null, textColor: COLORS.textDark }));
  doc.x = left;
}

function renderCallout(doc, callout, left, usableWidth) {
  const pad = 10;
  const innerWidth = usableWidth - pad * 2;
  doc.font('Helvetica-Bold').fontSize(9.5);
  const labelH = doc.heightOfString(callout.label, { width: innerWidth });
  doc.font('Helvetica').fontSize(9.5);
  const textH = doc.heightOfString(callout.text, { width: innerWidth });
  const boxH = labelH + textH + pad * 2 + 4;
  checkSpace(doc, boxH + 16);
  const y0 = doc.y;
  doc.rect(left, y0, usableWidth, boxH).fillAndStroke(COLORS.calloutBg, COLORS.calloutBorder);
  doc.fillColor(COLORS.purpleDark).font('Helvetica-Bold').fontSize(9.5).text(callout.label, left + pad, y0 + pad, { width: innerWidth });
  doc.fillColor(COLORS.textDark).font('Helvetica').fontSize(9.5).text(callout.text, left + pad, doc.y + 2, { width: innerWidth });
  doc.y = y0 + boxH;
  doc.x = left;
}

// ── DOCX (docx) ─────────────────────────────────────────────────────────────────────────────
function shading(hex) {
  return { fill: hex, type: ShadingType.CLEAR, color: 'auto' };
}

function docxTable(table) {
  const { columns, rows } = table;
  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(col => new TableCell({
      shading: shading(COLORS.purpleDarkHex),
      children: [new Paragraph({ children: [new TextRun({ text: String(col), bold: true, color: COLORS.whiteHex, size: 19 })] })],
    })),
  });
  const bodyRows = rows.map((r, i) => new TableRow({
    children: r.map(cell => new TableCell({
      shading: i % 2 === 1 ? shading(COLORS.rowStripeHex) : undefined,
      children: [new Paragraph({ children: [new TextRun({ text: String(cell ?? '—'), size: 19, color: COLORS.textDarkHex })] })],
    })),
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

function docxCallout(callout) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        shading: shading(COLORS.calloutBgHex),
        children: [
          new Paragraph({ children: [new TextRun({ text: callout.label, bold: true, color: COLORS.purpleDarkHex, size: 19 })] }),
          new Paragraph({ children: [new TextRun({ text: callout.text, color: COLORS.textDarkHex, size: 19 })] }),
        ],
      })],
    })],
  });
}

function spacer(after = 160) {
  return new Paragraph({ text: '', spacing: { after } });
}

export async function renderReportDocx(model) {
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: model.title, bold: true, size: 32, color: COLORS.purpleDarkHex })],
    spacing: { after: model.subtitle ? 60 : 160 },
  }));
  if (model.subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: model.subtitle, italics: true, size: 21, color: COLORS.subtitleBlueHex })],
      spacing: { after: 200 },
      border: { bottom: { color: COLORS.purpleDarkHex, space: 4, style: BorderStyle.SINGLE, size: 6 } },
    }));
  }

  for (const section of model.sections) {
    children.push(new Paragraph({
      children: [new TextRun({ text: section.heading, bold: true, size: 26, color: COLORS.purpleDarkHex })],
      spacing: { before: 220, after: 100 },
      border: { bottom: { color: COLORS.purpleDarkHex, space: 2, style: BorderStyle.SINGLE, size: 4 } },
    }));

    for (const p of section.paragraphs || []) {
      children.push(new Paragraph({
        children: [new TextRun({ text: p, size: 21, color: COLORS.textDarkHex })],
        spacing: { after: 120 },
      }));
    }

    if (section.table) { children.push(docxTable(section.table)); children.push(spacer()); }
    if (section.callout) { children.push(docxCallout(section.callout)); children.push(spacer()); }
  }

  const footerText = BRAND_FOOTER(model.brandName, model.countryLabel);
  const doc = new Document({
    sections: [{
      properties: {},
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: footerText + ' • Página ', size: 16, color: COLORS.mutedHex }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COLORS.mutedHex }),
              new TextRun({ text: ' de ', size: 16, color: COLORS.mutedHex }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: COLORS.mutedHex }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
