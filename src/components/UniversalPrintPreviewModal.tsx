import React from 'react';
import { Printer, Download, FileSpreadsheet, FileText, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export interface PrintStatCard {
  label: string;
  value: string | number;
  theme?: 'gray' | 'emerald' | 'red' | 'amber' | 'blue';
}

export interface PrintColumn {
  header: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
  mono?: boolean;
  bold?: boolean;
}

export interface PrintSubTab {
  id: string;
  label: string;
  badge?: string | number;
  activeColor?: 'blue' | 'red' | 'indigo' | 'emerald' | 'amber';
}

export interface UniversalPrintDocumentConfig {
  schoolName: string;
  reportTitle: string;
  metaLine1: string;
  metaLine2?: string;
  stats: PrintStatCard[];
  columns: PrintColumn[];
  rows: (string | number)[][];
  /** Optional rich React cell overrides for preview & print (falls back to `rows` for PDF/XLS/DOC) */
  richRows?: React.ReactNode[][];
  emptyMessage?: string;
  /** Optional narrative block rendered above or below table (e.g. Berita Acara Ujian) */
  narrativeHtml?: string;
  /** Optional footer summary on the bottom-left of the paper */
  footerSummaryLines?: string[];
  /** Signature block on bottom-right */
  signatureLocationLine: string;
  signatureRoleTitle: string;
  signatureName: string;
  signatureIdLine?: string;
  filenameBase: string;
}

interface UniversalPrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalTitle?: string;
  modalSubtitle?: string;
  subTabs?: PrintSubTab[];
  activeSubTab?: string;
  onSubTabChange?: (tabId: string) => void;
  toolbarExtra?: React.ReactNode;
  documentConfig: UniversalPrintDocumentConfig;
}

export const UniversalPrintPreviewModal: React.FC<UniversalPrintPreviewModalProps> = ({
  isOpen,
  onClose,
  modalTitle = 'Pratinjau Cetak & Download Laporan',
  modalSubtitle = 'Pilih jenis dokumen, periksa tampilan kertas, lalu cetak atau unduh PDF / XLS / DOC',
  subTabs,
  activeSubTab,
  onSubTabChange,
  toolbarExtra,
  documentConfig,
}) => {
  if (!isOpen) return null;

  const {
    schoolName,
    reportTitle,
    metaLine1,
    metaLine2,
    stats,
    columns,
    rows,
    richRows,
    emptyMessage = 'Belum ada data untuk laporan ini.',
    narrativeHtml,
    footerSummaryLines,
    signatureLocationLine,
    signatureRoleTitle,
    signatureName,
    signatureIdLine,
    filenameBase,
  } = documentConfig;

  const nowObj = new Date();
  const localClockStr = `${String(nowObj.getHours()).padStart(2, '0')}:${String(nowObj.getMinutes()).padStart(2, '0')}:${String(nowObj.getSeconds()).padStart(2, '0')}`;
  const defaultMetaLine2 =
    metaLine2 ||
    `Hari/Tanggal: ${nowObj.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })}   •   Waktu Cetak: ${localClockStr}`;

  const sanitizedFilename =
    (filenameBase || reportTitle || 'laporan')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') +
    '_' +
    new Date().toISOString().slice(0, 10);

  // 1. Export PDF (.pdf)
  const handleDownloadPDF = () => {
    const doc = new jsPDF({
      orientation: columns.length > 8 ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    }) as any;

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const centerX = pageWidth / 2;

    // Header Kop
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text((schoolName || 'SISTEM INFORMASI UJIAN SEKOLAH').toUpperCase(), centerX, 14, {
      align: 'center',
    });

    doc.setFontSize(11);
    doc.text(reportTitle.toUpperCase(), centerX, 20, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(metaLine1.replace(/•/g, '|'), centerX, 25.5, { align: 'center' });
    doc.text(defaultMetaLine2.replace(/•/g, '|'), centerX, 30, { align: 'center' });

    doc.setLineWidth(0.6);
    doc.line(14, 33, pageWidth - 14, 33);
    doc.setLineWidth(0.2);
    doc.line(14, 34, pageWidth - 14, 34);

    let currentY = 39;

    // Summary stats bar in PDF
    if (stats && stats.length > 0) {
      const boxGap = 3;
      const totalWidth = pageWidth - 28;
      const boxWidth = (totalWidth - boxGap * (stats.length - 1)) / stats.length;
      const boxHeight = 13;

      stats.forEach((st, idx) => {
        const bx = 14 + idx * (boxWidth + boxGap);
        if (st.theme === 'emerald') {
          doc.setFillColor(236, 253, 245);
          doc.setDrawColor(110, 231, 183);
        } else if (st.theme === 'red') {
          doc.setFillColor(254, 242, 242);
          doc.setDrawColor(252, 165, 165);
        } else if (st.theme === 'amber') {
          doc.setFillColor(255, 251, 235);
          doc.setDrawColor(252, 211, 77);
        } else {
          doc.setFillColor(249, 250, 251);
          doc.setDrawColor(209, 213, 219);
        }
        doc.roundedRect(bx, currentY, boxWidth, boxHeight, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(String(st.label).toUpperCase(), bx + boxWidth / 2, currentY + 4.5, {
          align: 'center',
        });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(17, 24, 39);
        doc.text(String(st.value), bx + boxWidth / 2, currentY + 10.5, { align: 'center' });
      });

      doc.setTextColor(17, 24, 39);
      currentY += boxHeight + 5;
    }

    // Optional Narrative Text (e.g., Berita Acara)
    if (narrativeHtml) {
      const plainNarrative = narrativeHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (plainNarrative) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        const splitLines = doc.splitTextToSize(plainNarrative, pageWidth - 28);
        doc.text(splitLines, 14, currentY);
        currentY += splitLines.length * 4.2 + 3;
      }
    }

    const head = [columns.map((c) => c.header)];
    const body =
      rows.length > 0
        ? rows.map((r) => r.map((cell) => String(cell ?? '-')))
        : [[emptyMessage, ...Array(Math.max(0, columns.length - 1)).fill('')]];

    autoTable(doc, {
      head,
      body,
      startY: currentY,
      theme: 'grid',
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'center',
      },
      bodyStyles: {
        fontSize: 8,
        textColor: 25,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      styles: {
        cellPadding: 2.2,
        overflow: 'linebreak',
        lineColor: [156, 163, 175],
        lineWidth: 0.2,
      },
      columnStyles: columns.reduce((acc: any, col, i) => {
        if (col.align) acc[i] = { halign: col.align };
        return acc;
      }, {}),
    });

    const finalY = (doc as any).lastAutoTable?.finalY || currentY + 30;
    let signY = finalY + 10;
    if (signY + 35 > pageHeight - 10) {
      doc.addPage();
      signY = 20;
    }

    if (footerSummaryLines && footerSummaryLines.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text('Ringkasan:', 14, signY);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      footerSummaryLines.forEach((line, idx) => {
        doc.text(line, 14, signY + 4.5 + idx * 4);
      });
    }

    const signCenterX = pageWidth - 45;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(signatureLocationLine, signCenterX, signY, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.text(signatureRoleTitle, signCenterX, signY + 4.5, { align: 'center' });
    doc.text(`( ${signatureName} )`, signCenterX, signY + 23, { align: 'center' });
    if (signatureIdLine) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(signatureIdLine, signCenterX, signY + 27, { align: 'center' });
    }

    doc.save(`${sanitizedFilename}.pdf`);
  };

  // 2. Export Excel (.xlsx)
  const handleDownloadXLS = () => {
    const aoa: any[][] = [
      [(schoolName || 'SISTEM INFORMASI UJIAN SEKOLAH').toUpperCase()],
      [reportTitle.toUpperCase()],
      [metaLine1.replace(/•/g, '|')],
      [defaultMetaLine2.replace(/•/g, '|')],
      [],
    ];

    if (stats && stats.length > 0) {
      aoa.push(stats.map((s) => `${s.label}: ${s.value}`));
      aoa.push([]);
    }

    if (narrativeHtml) {
      const plainNarrative = narrativeHtml
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (plainNarrative) {
        aoa.push([plainNarrative]);
        aoa.push([]);
      }
    }

    // Header row
    aoa.push(columns.map((c) => c.header));

    // Data rows
    if (rows.length > 0) {
      rows.forEach((r) => {
        aoa.push(r.map((cell) => (cell === undefined || cell === null ? '-' : cell)));
      });
    } else {
      aoa.push([emptyMessage]);
    }

    aoa.push([]);
    if (footerSummaryLines && footerSummaryLines.length > 0) {
      footerSummaryLines.forEach((l) => aoa.push([l]));
      aoa.push([]);
    }

    const signColIdx = Math.max(0, columns.length - 2);
    const padCols = Array(signColIdx).fill('');
    aoa.push([...padCols, signatureLocationLine]);
    aoa.push([...padCols, signatureRoleTitle]);
    aoa.push([]);
    aoa.push([]);
    aoa.push([...padCols, `( ${signatureName} )`]);
    if (signatureIdLine) {
      aoa.push([...padCols, signatureIdLine]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = columns.map((col, idx) => ({
      wch: idx === 0 ? 8 : Math.max(col.header.length + 6, 18),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizedFilename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  // 3. Export Word (.doc)
  const handleDownloadDOC = () => {
    const statCellsHtml =
      stats && stats.length > 0
        ? `<table style="width:100%; border-collapse:collapse; margin-bottom:14px;">
            <tr>
              ${stats
                .map((s) => {
                  const bg =
                    s.theme === 'emerald'
                      ? '#ecfdf5'
                      : s.theme === 'red'
                      ? '#fef2f2'
                      : s.theme === 'amber'
                      ? '#fffbeb'
                      : '#f9fafb';
                  const border =
                    s.theme === 'emerald'
                      ? '#6ee7b7'
                      : s.theme === 'red'
                      ? '#fca5a5'
                      : s.theme === 'amber'
                      ? '#fcd34d'
                      : '#d1d5db';
                  return `<td style="border:1px solid ${border}; background:${bg}; padding:8px; text-align:center; width:${Math.floor(
                    100 / stats.length
                  )}%;">
                    <div style="font-size:8.5pt; font-weight:bold; color:#4b5563; text-transform:uppercase;">${s.label}</div>
                    <div style="font-size:14pt; font-weight:bold; color:#111827; margin-top:2px;">${s.value}</div>
                  </td>`;
                })
                .join('')}
            </tr>
          </table>`
        : '';

    const tableRowsHtml =
      rows.length > 0
        ? rows
            .map(
              (r, rIdx) => `
              <tr style="background:${rIdx % 2 === 1 ? '#f8fafc' : '#ffffff'};">
                ${r
                  .map((cell, cIdx) => {
                    const col = columns[cIdx] || { align: 'left' };
                    return `<td style="border:1px solid #6b7280; padding:6px 8px; font-size:9.5pt; text-align:${
                      col.align || 'left'
                    }; ${col.bold ? 'font-weight:bold;' : ''} ${
                      col.mono ? 'font-family:Consolas, monospace;' : ''
                    }">${cell ?? '-'}</td>`;
                  })
                  .join('')}
              </tr>`
            )
            .join('')
        : `<tr><td colspan="${columns.length}" style="border:1px solid #6b7280; padding:16px; text-align:center; color:#6b7280; font-style:italic;">${emptyMessage}</td></tr>`;

    const wordHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:w="urn:schemas-microsoft-com:office:word"
            xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <title>${reportTitle}</title>
        <style>
          @page { size: A4 portrait; margin: 1.5cm; }
          body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 10pt; }
          table { border-collapse: collapse; width: 100%; }
        </style>
      </head>
      <body>
        <div style="text-align:center; border-bottom:3px double #1f2937; padding-bottom:10px; margin-bottom:14px;">
          <div style="font-size:14pt; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px;">
            ${(schoolName || 'SISTEM INFORMASI UJIAN SEKOLAH').toUpperCase()}
          </div>
          <div style="font-size:12pt; font-weight:bold; text-transform:uppercase; margin-top:4px; color:#1f2937;">
            ${reportTitle}
          </div>
          <div style="font-size:9pt; color:#4b5563; margin-top:4px;">
            ${metaLine1}
          </div>
          <div style="font-size:8.5pt; color:#6b7280; margin-top:2px;">
            ${defaultMetaLine2}
          </div>
        </div>

        ${statCellsHtml}

        ${narrativeHtml ? `<div style="margin-bottom:14px; font-size:10pt; line-height:1.5;">${narrativeHtml}</div>` : ''}

        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr>
              ${columns
                .map(
                  (c) =>
                    `<th style="border:1px solid #374151; background:#1e293b; color:#ffffff; padding:7px 8px; font-size:9.5pt; text-align:${
                      c.align || 'left'
                    };">${c.header}</th>`
                )
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>

        <table style="width:100%; margin-top:28px; border:none;">
          <tr>
            <td style="width:55%; vertical-align:bottom; border:none; font-size:9pt; color:#374151;">
              ${
                footerSummaryLines && footerSummaryLines.length > 0
                  ? `<strong>Ringkasan Pelaksanaan:</strong><br/>` + footerSummaryLines.join('<br/>')
                  : ''
              }
            </td>
            <td style="width:45%; text-align:center; vertical-align:top; border:none; font-size:9.5pt;">
              <div>${signatureLocationLine}</div>
              <div style="font-weight:bold; margin-top:2px;">${signatureRoleTitle}</div>
              <br/><br/><br/><br/>
              <div style="font-weight:bold; text-decoration:underline;">( ${signatureName} )</div>
              ${signatureIdLine ? `<div style="font-size:8.5pt; color:#4b5563; margin-top:2px;">${signatureIdLine}</div>` : ''}
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', wordHtml], {
      type: 'application/msword;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizedFilename}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  // 4. Direct Print (Cetak Langsung)
  const handleDirectPrint = () => {
    const printArea = document.getElementById('universal-a4-print-sheet');
    if (!printArea) {
      window.print();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join('\n');

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${reportTitle}</title>
          ${styles}
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            body { background: #ffffff !important; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            #universal-a4-print-sheet { box-shadow: none !important; border: none !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          </style>
        </head>
        <body>
          ${printArea.outerHTML}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }, 450);
  };

  return (
    <div className="fixed inset-0 z-[99995] bg-black/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-5xl w-full shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[93vh]">
        {/* Modal Top Bar (Dark Header matching uploaded screenshot) */}
        <div className="px-6 py-4 bg-gray-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-blue-400 shrink-0">
              <Printer size={20} />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base">{modalTitle}</h3>
              <p className="text-[11px] text-gray-400">{modalSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Unduh dalam format PDF (.pdf)"
            >
              <Download size={14} /> Download PDF
            </button>

            <button
              type="button"
              onClick={handleDownloadXLS}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Unduh dalam format Microsoft Excel (.xlsx)"
            >
              <FileSpreadsheet size={14} /> Download XLS
            </button>

            <button
              type="button"
              onClick={handleDownloadDOC}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Unduh dalam format Microsoft Word (.doc)"
            >
              <FileText size={14} /> Download DOC
            </button>

            <button
              type="button"
              onClick={handleDirectPrint}
              className="px-3.5 py-2 bg-white hover:bg-gray-100 active:scale-95 text-gray-900 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
              title="Cetak langsung ke printer atau Save as PDF"
            >
              <Printer size={14} /> Cetak Langsung
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white rounded-xl transition-all cursor-pointer"
              title="Tutup Pratinjau"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Document Type Switcher & Filter Bar */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {subTabs && subTabs.length > 0 && (
              <>
                <span className="text-xs font-bold text-gray-500 mr-1">Jenis Dokumen:</span>
                {subTabs.map((tab) => {
                  const isActive = activeSubTab === tab.id;
                  const activeClass =
                    tab.activeColor === 'red'
                      ? 'bg-red-600 text-white shadow-xs'
                      : tab.activeColor === 'indigo'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : tab.activeColor === 'emerald'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : tab.activeColor === 'amber'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'bg-blue-600 text-white shadow-xs';

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onSubTabChange?.(tab.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        isActive
                          ? activeClass
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {tab.label}
                      {tab.badge !== undefined ? ` (${tab.badge})` : ''}
                    </button>
                  );
                })}
              </>
            )}
            {toolbarExtra}
          </div>

          <span className="text-[11px] text-gray-500">
            Ukuran: <strong>A4 Portrait</strong> &bull; Format: <strong>PDF / XLS / DOC</strong>
          </span>
        </div>

        {/* Scrollable Paper Sheet Preview Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-gray-200/70">
          <div
            id="universal-a4-print-sheet"
            className="bg-white max-w-4xl mx-auto rounded-xl shadow-lg border border-gray-300 p-6 sm:p-10 text-gray-900"
          >
            {/* Kop Resmi */}
            <div className="border-b-2 border-double border-gray-800 pb-4 mb-5 text-center">
              <h1 className="text-base sm:text-lg font-extrabold uppercase tracking-wide text-gray-900">
                {schoolName || 'SISTEM INFORMASI UJIAN SEKOLAH'}
              </h1>
              <h2 className="text-xs sm:text-sm font-bold uppercase text-gray-800 mt-1">
                {reportTitle}
              </h2>
              <p className="text-[11px] text-gray-600 mt-1">{metaLine1}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">{defaultMetaLine2}</p>
            </div>

            {/* 4 Summary Stat Boxes */}
            {stats && stats.length > 0 && (
              <div
                className={`grid grid-cols-2 sm:grid-cols-${Math.min(
                  stats.length,
                  4
                )} gap-3 mb-6 text-center`}
              >
                {stats.map((st, idx) => {
                  const boxStyle =
                    st.theme === 'emerald'
                      ? 'border-emerald-300 bg-emerald-50/50'
                      : st.theme === 'red'
                      ? 'border-red-300 bg-red-50/50'
                      : st.theme === 'amber'
                      ? 'border-amber-300 bg-amber-50/50'
                      : st.theme === 'blue'
                      ? 'border-blue-300 bg-blue-50/50'
                      : 'border-gray-300 bg-gray-50';
                  const labelStyle =
                    st.theme === 'emerald'
                      ? 'text-emerald-700'
                      : st.theme === 'red'
                      ? 'text-red-600'
                      : st.theme === 'amber'
                      ? 'text-amber-700'
                      : st.theme === 'blue'
                      ? 'text-blue-700'
                      : 'text-gray-500';
                  const valueStyle =
                    st.theme === 'emerald'
                      ? 'text-emerald-800'
                      : st.theme === 'red'
                      ? 'text-red-700'
                      : st.theme === 'amber'
                      ? 'text-amber-800'
                      : st.theme === 'blue'
                      ? 'text-blue-900'
                      : 'text-gray-900';

                  return (
                    <div key={idx} className={`p-2.5 border rounded-lg ${boxStyle}`}>
                      <p className={`text-[10px] font-bold uppercase ${labelStyle}`}>{st.label}</p>
                      <p className={`text-base font-extrabold ${valueStyle}`}>{st.value}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Optional Narrative Block (e.g. Berita Acara Ujian) */}
            {narrativeHtml && (
              <div
                className="mb-5 p-4 bg-gray-50/80 border border-gray-300 rounded-lg text-xs text-gray-800 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: narrativeHtml }}
              />
            )}

            {/* Data Table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-800 text-white">
                    {columns.map((col, idx) => (
                      <th
                        key={idx}
                        className={`border border-gray-600 py-2 px-2.5 ${
                          col.align === 'center'
                            ? 'text-center'
                            : col.align === 'right'
                            ? 'text-right'
                            : 'text-left'
                        } ${col.width || ''}`}
                      >
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="border border-gray-300 py-8 text-center text-gray-400 italic"
                      >
                        {emptyMessage}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, rIdx) => {
                      const richRow = richRows?.[rIdx];
                      return (
                        <tr key={rIdx} className="even:bg-gray-50/60">
                          {row.map((cell, cIdx) => {
                            const col = columns[cIdx] || {};
                            const rawCellStr = String(cell ?? '');
                            const isStatusCol =
                              cIdx === columns.length - 1 ||
                              /status|keterangan/i.test(col.header || '');

                            let autoBadge: React.ReactNode = null;
                            if (
                              isStatusCol &&
                              (!richRow || richRow[cIdx] === undefined) &&
                              rawCellStr &&
                              rawCellStr !== '-'
                            ) {
                              const lower = rawCellStr.toLowerCase();
                              if (
                                lower.includes('tertib') ||
                                lower.includes('hadir (selesai)') ||
                                lower.includes('hadir (aktif)') ||
                                lower === 'hadir' ||
                                lower === 'aktif' ||
                                lower.includes('diaktifkan')
                              ) {
                                autoBadge = (
                                  <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-100 text-emerald-800 inline-block">
                                    {rawCellStr}
                                  </span>
                                );
                              } else if (
                                lower.includes('pelanggaran') ||
                                lower.includes('terkunci') ||
                                lower.includes('alpha') ||
                                lower.includes('tanpa keterangan') ||
                                lower.includes('belum hadir') ||
                                lower.includes('tidak hadir')
                              ) {
                                autoBadge = (
                                  <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-red-100 text-red-700 inline-block">
                                    {rawCellStr}
                                  </span>
                                );
                              } else if (
                                lower.includes('sakit') ||
                                lower.includes('izin') ||
                                lower.includes('reset') ||
                                lower.includes('direset')
                              ) {
                                autoBadge = (
                                  <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-amber-100 text-amber-800 inline-block">
                                    {rawCellStr}
                                  </span>
                                );
                              }
                            }

                            const content =
                              richRow && richRow[cIdx] !== undefined
                                ? richRow[cIdx]
                                : autoBadge || cell;
                            return (
                              <td
                                key={cIdx}
                                className={`border border-gray-400 py-1.5 px-2.5 ${
                                  col.align === 'center'
                                    ? 'text-center'
                                    : col.align === 'right'
                                    ? 'text-right'
                                    : 'text-left'
                                } ${col.mono ? 'font-mono' : ''} ${
                                  col.bold ? 'font-semibold text-gray-900' : 'text-gray-800'
                                }`}
                              >
                                {content ?? '-'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Signature & Footer Block */}
            <div className="mt-10 flex flex-col sm:flex-row justify-between items-end gap-6">
              <div className="text-xs text-gray-600 space-y-0.5">
                {footerSummaryLines && footerSummaryLines.length > 0 && (
                  <>
                    <p className="font-bold text-gray-800 mb-1">Ringkasan Pelaksanaan:</p>
                    {footerSummaryLines.map((line, i) => (
                      <p key={i} className="text-[11px] text-gray-600">
                        {line}
                      </p>
                    ))}
                  </>
                )}
              </div>

              <div className="text-center text-xs w-64">
                <p className="text-gray-600">{signatureLocationLine}</p>
                <p className="font-bold text-gray-800 mt-0.5">{signatureRoleTitle}</p>
                <div className="h-16" />
                <p className="font-bold underline text-gray-900">( {signatureName} )</p>
                {signatureIdLine && (
                  <p className="text-[11px] text-gray-500 mt-0.5">{signatureIdLine}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
