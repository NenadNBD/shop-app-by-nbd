const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable');
const { getLogoDataUrl } = require('./logoProvider');

function formatInvoiceDate(ms) {
  const d = new Date(ms); // hubspotDateMs
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC', // ensure no timezone shifts
  }).format(d);
}

const money = (n) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: printInvoice.currency || 'USD'
  }).format(Number(n || 0));

function formatCityStatePostal({ city, state, postal }) {
    const c = (city || '').trim();
    const s = (state || '').trim();
    const z = (postal || '').trim();
    if (!c && !s && !z){
      return '';
    }
    if (s && z){
      return c ? `${c}, ${s} ${z}` : `${s} ${z}`;
    }
    if (s){
      return c ? `${c}, ${s}` : s;
    }
    if (z){
      return c ? `${c} ${z}` : z;
    }
    return c;
}

// 1 Prepare Doc Header
function addHeader(doc, {
    marginPx,
    headerHeightPx,
    pageWidthPx,
    titleLines,
    logoDataUrl,
    logoDims,
    logoPaddingRight = 0
  }) {
    // fallback: light gray bar
    doc.setFillColor(255,255,255);
    doc.rect(marginPx, marginPx, pageWidthPx - marginPx*2, headerHeightPx, 'F');
    
    // title
    const x = marginPx;
    const centerY = marginPx + headerHeightPx/2;
    const fontSize = 18;
    const lineHeight = fontSize * 1.2;

    const y1 = centerY - (lineHeight/2);
    const y2 = centerY + (lineHeight/2);

    doc.setFont('helvetica','normal').setFontSize(fontSize).setTextColor(21,30,33);
    if (titleLines?.normal) doc.text(String(titleLines.normal), x, y1);
    doc.setFont('helvetica','bold');
    if (titleLines?.bold) doc.text(String(titleLines.bold), x, y2);

    // logo on right
    if (logoDataUrl && logoDims?.width && logoDims?.height) {
      const { width: logoW, height: logoH } = logoDims;
      const logoX = pageWidthPx - marginPx - logoW - logoPaddingRight;
      const logoY = marginPx + (headerHeightPx - logoH)/2;
      doc.addImage(logoDataUrl, 'PNG', logoX, logoY, logoW, logoH);
    }
}

async function prepareInvoice(printInvoice) {
    // Init jsPDF
  const doc = new jsPDF({ unit: 'px', format: 'letter', orientation: 'portrait', compress: true });
  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Layout constants
  const margin = 21;
  const headerHeight = 50;


  const logoDataUrl = (await getLogoDataUrl());

  // draw header BEFORE saving
  addHeader(doc, {
    marginPx: margin + 8,
    headerHeightPx: headerHeight,
    pageWidthPx: pageWidth,
    titleLines: { bold: 'Invoice' },
    logoDataUrl,
    logoDims: { width: 120, height: 29 },
    logoPaddingRight: 0
  });

  // Invoice Number Table
  autoTable(doc, {
    startY: margin + headerHeight + 20,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { cellPadding: 1, },
    bodyStyles: {
      cellPadding: { top: 3, right: 8, bottom: 3, left: 8 },
      font: 'helvetica', fontSize: 12, fontStyle: 'bold',
      fillColor: [52,213,179], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
    },
    tableLineColor: [255,255,255],
    tableLineWidth: 0,
    head: [],
    body: [[ `Invoice Number: ${printInvoice.invoice_number ?? ''}` ]],
  });
    // Values for Two Columns Table with GAP
    const doubleTablePageW = doc.internal.pageSize.getWidth();
    const doubleTableW = doubleTablePageW - (margin * 2);
    const doubleTableGap = 30;
    const doubleTableColW = (doubleTableW - doubleTableGap) / 2;
    const invoiceInfoLeftRows = [
      [ `Issue Date: ${formatInvoiceDate(printInvoice.issue_date) ?? ''}`],
      [ `Due Date: ${formatInvoiceDate(printInvoice.due_date) ?? ''}`]
    ];
    const invoiceInfoRightRows = [
      [ `State Descriptor: ${printInvoice.statement_descriptor ?? ''}`],
      [ `Payment ID: ${printInvoice.payment_id ?? ''}`],
      [ `Payment Method: ${printInvoice.payment_method ?? ''}`]
    ];
    // continue from here if needed:
    const topAfterInvoiceNumberTable = doc.lastAutoTable.finalY + 8;
    // LEFT (Invoice Data)
    doc.autoTable({
      startY: topAfterInvoiceNumberTable,
      margin: { left: margin},
      tableWidth: doubleTableColW,
      theme: 'grid',
      styles: { cellPadding: 1, },
        bodyStyles: {
          cellPadding: { top: 1, right: 8, bottom: 1, left: 8 },
          font: 'helvetica', fontSize: 11, fontStyle: 'normal',
          fillColor: [255,255,255], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        tableLineColor: [255,255,255],
        tableLineWidth: 0,
      head: [],
      body: invoiceInfoLeftRows.map(r => [r]),
    });
    const invoiceLeftBottom = doc.lastAutoTable.finalY;

    // RIGHT (Invoice Data)
    autoTable(doc, {
      startY: topAfterInvoiceNumberTable,
      margin: { left: margin + doubleTableColW + doubleTableGap},               // ← shifted by colW + GAP
      tableWidth: doubleTableColW,
      theme: 'grid',
      styles: { cellPadding: 1, },
        bodyStyles: {
          cellPadding: { top: 1, right: 8, bottom: 1, left: 8 },
          font: 'helvetica', fontSize: 11, fontStyle: 'normal',
          fillColor: [255,255,255], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        tableLineColor: [255,255,255],
        tableLineWidth: 0,
      head: [],
      body: invoiceInfoRightRows.map(r => [r]),
    });
    const invoiceRightBottom = doc.lastAutoTable.finalY;
    const topBillingTable = Math.max(invoiceLeftBottom, invoiceRightBottom) + 16;
    
    // Invoice Data Tables
    // build left/right column rows as "Label: Value"
    const billingLeftRows = [];
    if(printInvoice.seller.name){
      billingLeftRows.push(`${printInvoice.seller.name}`);
    }
    if(printInvoice.seller.address_line1){
      billingLeftRows.push(`${printInvoice.seller.address_line1}`);
    }
    const sellerLocality = formatCityStatePostal({
      city: printInvoice.seller.city,
      state: printInvoice.seller.state,
      postal: printInvoice.seller.postal_code
    });
    if (sellerLocality){
      billingLeftRows.push(sellerLocality);
    }
    if(printInvoice.seller.country){
      billingLeftRows.push(printInvoice.seller.country);
    }
    
    const billingRightRows = [];
    if(printInvoice.bill_to.name){
      billingRightRows.push(`${printInvoice.bill_to.name}`)
    }
    const customerLocality = formatCityStatePostal({
      city: printInvoice.bill_to.city,
      state: printInvoice.bill_to.state,
      postal: printInvoice.bill_to.postal_code
    });
    if (customerLocality){
      billingRightRows.push(sellerLocality);
    }
    if(printInvoice.bill_to.country){
      billingRightRows.push(printInvoice.bill_to.country);
    }
    if(printInvoice.bill_to.email){
      billingRightRows.push(printInvoice.bill_to.email);
    }

    // LEFT (Seller)
    autoTable(doc, {
      startY: topBillingTable,
      margin: { left: margin},
      tableWidth: doubleTableColW,
      theme: 'grid',
      styles: { cellPadding: 1, },
        headStyles: {
          cellPadding: { top: 3, right: 8, bottom: 3, left: 8 },
          font: 'helvetica', fontSize: 12, fontStyle: 'bold',
          fillColor: [52,213,179], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        bodyStyles: {
          cellPadding: { top: 1, right: 8, bottom: 1, left: 8 },
          font: 'helvetica', fontSize: 11, fontStyle: 'normal',
          fillColor: [255,255,255], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        tableLineColor: [255,255,255],
        tableLineWidth: 0,
      head: [['Seller']],
      body: billingLeftRows.map(r => [r]),
      didParseCell: (d) => {
          if (d.section === 'body' && d.row.index === 0) {
             d.cell.styles.fontSize = 11;
            d.cell.styles.fontStyle = 'bold';  // make first row bold
          }
        }
    });
    const billingLeftBottom = doc.lastAutoTable.finalY;

    // RIGHT (Customer Billing)
    autoTable(doc, {
      startY: topBillingTable,
      margin: { left: margin + doubleTableColW + doubleTableGap},               // ← shifted by colW + GAP
      tableWidth: doubleTableColW,
      theme: 'grid',
      styles: { cellPadding: 1, },
        headStyles: {
          cellPadding: { top: 3, right: 8, bottom: 3, left: 8 },
          font: 'helvetica', fontSize: 12, fontStyle: 'bold',
          fillColor: [52,213,179], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        bodyStyles: {
          cellPadding: { top: 1, right: 8, bottom: 1, left: 8 },
          font: 'helvetica', fontSize: 11, fontStyle: 'normal',
          fillColor: [255,255,255], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        tableLineColor: [255,255,255],
        tableLineWidth: 0,
      head: [['Bill to']],
      body: billingRightRows.map(r => [r]),
      didParseCell: (d) => {
          if (d.section === 'body' && d.row.index === 0) {
             d.cell.styles.fontSize = 11;
            d.cell.styles.fontStyle = 'bold';  // make first row bold
          }
        }
    });
    const billingRightBottom = doc.lastAutoTable.finalY;
    const nextFromBillingTable = Math.max(billingLeftBottom, billingRightBottom) + 32;
    
    // Main Paid Info Table
    const paidInfoRows = [];
    paidInfoRows.push(`Status: ${printInvoice.status ?? ''}`);
    if (printInvoice.status === 'Paid') {
      paidInfoRows.push(`${printInvoice.total} due ${formatInvoiceDate(printInvoice.issue_date)}`);
    }
    autoTable(doc, {
      startY: nextFromBillingTable,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { cellPadding: 1, },
      bodyStyles: {
        cellPadding: { top: 3, right: 8, bottom: 3, left: 8 },
        font: 'helvetica', fontSize: 11, fontStyle: 'bold',
        fillColor: [245,245,245], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
      },
      tableLineColor: [255,255,255],
      tableLineWidth: 0,
      head: [],
      body: paidInfoRows.map(text => [text])
    });
    
    // Line Items Table
    const widths = [0.40, 0.20, 0.20, 0.20].map(p => Math.round(p * doubleTableW));
    // Build body Lineitem rows
    const lineItemBody = [];
    for (const li of printInvoice.line_items || []) {
      const liName = li.name ?? '';
      const qty = li.quantity ?? 1;
      const unit = money(li.unit_price ?? 0);
      const amount = (li.amount != null) ? money(li.amoun) : money((Number(unit) * Number(qty)));
      
      lineItemBody.push([
        // Description (name + optional description)
        String(liName),
        String(qty),
        unit,
        amount
      ]);
      // subscription period row (Description column only)
      if (li.type === 'subscription' && li.billing_cycle) {
        const period = String(li.billing_cycle); // e.g. "Sep 28 – Oct 28, 2025"
        lineItemBody.push([
          {
            content: period,
            styles: {
              fontSize: 9,
              textColor: [90, 98, 104],
              cellPadding: { top: 2, right: 8, bottom: 6, left: 8 }
            }
          },
          '', '', '' // keep grid; only Description has text
        ]);
      }
    }
    
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 16,
      margin: { left: margin, right: margin },
      tableWidth: doubleTableW,
      theme: 'grid',
      styles: { cellPadding: 1, },
        headStyles: {
          cellPadding: { top: 3, right: 8, bottom: 3, left: 8 },
          font: 'helvetica', fontSize: 11, fontStyle: 'bold',
          fillColor: [245,245,245], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        bodyStyles: {
          cellPadding: { top: 1, right: 8, bottom: 1, left: 8 },
          font: 'helvetica', fontSize: 10, fontStyle: 'normal',
          fillColor: [255,255,255], textColor: [21,30,33], lineColor: [255,255,255], lineWidth: 0
        },
        tableLineColor: [255,255,255],
        tableLineWidth: 0,
      head: [['Description', 'Qty', 'Unit price', 'Amount']],
      body: lineItemBody,
      columnStyles: {
        0: { cellWidth: widths[0] },                 // Description (left)
        1: { cellWidth: widths[1], halign: 'right' },// Qty (right)
        2: { cellWidth: widths[2], halign: 'right' },// Unit price (right)
        3: { cellWidth: widths[3], halign: 'right' } // Amount (right)
      },
      didParseCell: (d) => {
        if (d.section === 'head' && d.column.index > 0) {
          d.cell.styles.halign = 'right';
        }
      }
    });
    
    // === Totals table (right 50%) ===
    const halfW   = Math.floor(doubleTableW / 2);
    const totalTableX  = margin + doubleTableW - halfW;

    const subtotal = printInvoice.subtotal ?? 0;
    const total = printInvoice.total ?? subtotal;
    const balance = printInvoice.balance_due ?? 0;

    const totalsBody = [
      ['Subtotal',    money(subtotal)],
      ['Total',       money(total)],
      ['Balance Due', money(balance)]
    ];

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 32,
      margin: {left: totalTableX},
      tableWidth: halfW,
      theme: 'plain', // no borders; we'll draw our own separator
      styles: {
        font: 'helvetica',
        fontSize: 12,
        cellPadding: { top: 4, right: 8, bottom: 4, left: 8 }
      },
      body: totalsBody,
      columnStyles: {
        0: { halign: 'left'  },   // labels
        1: { halign: 'right' }    // values
      },
      didParseCell: (d) => {
        // Bold the entire "Balance Due" row (row index 2)
        if (d.section === 'body' && d.row.index === 2) {
          d.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawCell: (d) => {
        // Draw a horizontal rule between Subtotal (row 0) and Total (row 1)
        if (d.section === 'body' && d.column.index === 1 && (d.row.index === 0 || d.row.index === 1)) {
          const y = d.cell.y + d.cell.height;
          doc.setDrawColor(200);      // light gray
          doc.setLineWidth(0.5);
          doc.line(totalTableX, y, totalTableX + halfW, y);
        }
      }
    });
}

module.exports = { prepareInvoice };

