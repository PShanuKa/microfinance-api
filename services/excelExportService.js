import exceljs from 'exceljs';
import { formatDateSL } from '../utils/dateHelpers.js';

// Helper to format dates for Excel cells in Asia/Colombo timezone
function formatExcelDate(date, pattern = 'dd/MM/yyyy') {
  if (!date) return '';
  const d = new Date(date);
  // Use Asia/Colombo timezone for display
  const opts = { timeZone: 'Asia/Colombo' };
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', ...opts });
  const month = d.toLocaleDateString('en-GB', { month: '2-digit', ...opts });
  const year = d.toLocaleDateString('en-GB', { year: 'numeric', ...opts });
  if (pattern === 'dd/MM/yyyy') return `${day}/${month}/${year}`;
  // For 'dd MMM yy' pattern
  const monthShort = d.toLocaleDateString('en-GB', { month: 'short', ...opts });
  const yearShort = d.toLocaleDateString('en-GB', { year: '2-digit', ...opts });
  return `${day} ${monthShort} ${yearShort}`;
}

/**
 * Service to handle all Excel Exports
 */
export const excelExportService = {
  /**
   * Generates the Group Loan Interest Payments Excel structure.
   * Matches the format of the requested "INTEREST PAYMENTS NEW UPDATES.xlsx".
   */
  async generateGroupLoanInterestPayments(fastify, loanId) {
    // 1. Fetch Loan Details
    const loan = await fastify.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        group: {
          include: {
            members: {
              include: {
                client: true
              }
            }
          }
        },
        instalments: {
          include: {
            client: true,
            collectionItems: true
          },
          orderBy: [
            { clientId: 'asc' },
            { weekNumber: 'asc' }
          ]
        }
      }
    });

    if (!loan) {
      throw new Error("Loan not found");
    }

    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Interest Payments');

    // 2. Prepare headers
    const totalWeeks = loan.totalWeeks;
    
    // Custom header generator for "1st", "2nd", "3rd", "4th"...
    const getOrdinal = (n) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    const weekHeaders = Array.from({ length: totalWeeks }, (_, i) => getOrdinal(i + 1));

    // Row 1: Headers
    const headerRow = [
      'Group Name', 
      'Group Nomber', 
      'Team member', 
      ...weekHeaders
    ];
    worksheet.addRow(headerRow);
    
    // Style the header row
    worksheet.getRow(1).font = { bold: true };

    // Get the dates from the leader's instalments for Row 2
    // We assume all members have the same due dates for the same week
    const leaderMember = loan.group.members.find(m => m.isLeader);
    let datesRow = Array(totalWeeks).fill('');
    if (leaderMember) {
      const leaderInstalments = loan.instalments.filter(i => i.clientId === leaderMember.clientId);
      leaderInstalments.forEach(inst => {
        if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
          datesRow[inst.weekNumber - 1] = formatExcelDate(new Date(inst.dueDate));
        }
      });
    } else if (loan.instalments.length > 0) {
      // Fallback if no leader flag: use first client's instalments
      const firstClientId = loan.instalments[0].clientId;
      const firstInstalments = loan.instalments.filter(i => i.clientId === firstClientId);
      firstInstalments.forEach(inst => {
         if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
          datesRow[inst.weekNumber - 1] = formatExcelDate(new Date(inst.dueDate));
        }
      });
    }

    // Sort members: Leader first, then others
    const sortedMembers = [...loan.group.members].sort((a, b) => {
      if (a.isLeader) return -1;
      if (b.isLeader) return 1;
      return 0;
    });

    const leaderName = leaderMember ? leaderMember.client.fullname : (sortedMembers[0]?.client?.fullname || '');

    // Row 2: Group Name, Group No, Leader Name, Dates...
    worksheet.addRow([
      loan.group.name,
      loan.group.groupNo || loan.group.name, // Fallback to name if groupNo is null
      leaderName,
      ...datesRow
    ]);
    worksheet.getRow(2).font = { bold: true };

    // Get Collection Day string
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    // JS dates have Sunday as 0. Prisma schema says 1 = Monday, 7 = Sunday.
    // Let's map safely. If collectionDay is 1..7:
    const collectionDayIndex = loan.group.collectionDay; 
    let dayString = "";
    if (collectionDayIndex === 7) dayString = "Sunday";
    else if (collectionDayIndex === 1) dayString = "Monday";
    else if (collectionDayIndex === 2) dayString = "Tuesday";
    else if (collectionDayIndex === 3) dayString = "Wednesday";
    else if (collectionDayIndex === 4) dayString = "Thursday";
    else if (collectionDayIndex === 5) dayString = "Friday";
    else if (collectionDayIndex === 6) dayString = "Saturday";

    // Row 3+ : Members and their payments
    sortedMembers.forEach((member, index) => {
      const isLeaderRow = index === 0;
      
      const col1 = isLeaderRow ? dayString : '';
      const col2 = ''; // Empty column as per example
      const col3 = member.client.fullname;

      const paymentsRow = Array(totalWeeks).fill('');
      const memberInstalments = loan.instalments.filter(i => i.clientId === member.clientId);
      
      memberInstalments.forEach(inst => {
        if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
          // If paidAmount > 0, show the amount, otherwise leave empty or you could show 0
          if (Number(inst.paidAmount) > 0) {
            paymentsRow[inst.weekNumber - 1] = Number(inst.paidAmount);
          }
        }
      });

      worksheet.addRow([col1, col2, col3, ...paymentsRow]);
    });

    // Final Empty Row as in the example
    worksheet.addRow([]);

    // Add borders to the entire table and colors to header rows
    const totalCols = totalWeeks + 3;
    const totalRows = sortedMembers.length + 2; // Row 1: Headers, Row 2: Dates, Row 3+: Members

    for (let r = 1; r <= totalRows; r++) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= totalCols; c++) {
        const cell = row.getCell(c);
        
        // Add thin border to all cells
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };

        // Color header rows (Rows 1 and 2)
        if (r === 1 || r === 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD9EAD3' } // A nice light green matching microfinance themes, or use 'FFD9D9D9' for gray
          };
        }
      }
    }

    // Adjust column widths
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 15;
    worksheet.getColumn(3).width = 30;
    for (let i = 4; i <= totalWeeks + 3; i++) {
      worksheet.getColumn(i).width = 12;
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  },

  /**
   * Generates a batch Excel export of multiple Group Loans on a single sheet.
   */
  async generateBatchGroupLoanInterestPayments(fastify, loans) {
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Interest Payments');

    let currentRow = 1;
    let maxTotalWeeks = 0;

    const getOrdinal = (n) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    };

    for (const loan of loans) {
      if (!loan.group || !loan.instalments) continue;
      
      const totalWeeks = loan.totalWeeks;
      if (totalWeeks > maxTotalWeeks) maxTotalWeeks = totalWeeks;

      const weekHeaders = Array.from({ length: totalWeeks }, (_, i) => getOrdinal(i + 1));
      
      // Row 1: Headers
      const headerRow = ['Group Name', 'Group Nomber', 'Team member', ...weekHeaders];
      worksheet.addRow(headerRow);
      const headerRowIndex = currentRow;
      worksheet.getRow(headerRowIndex).font = { bold: true };
      currentRow++;

      // Row 2: Dates
      const leaderMember = loan.group.members.find(m => m.isLeader);
      let datesRow = Array(totalWeeks).fill('');
      if (leaderMember) {
        const leaderInstalments = loan.instalments.filter(i => i.clientId === leaderMember.clientId);
        leaderInstalments.forEach(inst => {
          if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
            datesRow[inst.weekNumber - 1] = format(new Date(inst.dueDate), 'dd/MM/yyyy');
          }
        });
      } else if (loan.instalments.length > 0) {
        const firstClientId = loan.instalments[0].clientId;
        const firstInstalments = loan.instalments.filter(i => i.clientId === firstClientId);
        firstInstalments.forEach(inst => {
           if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
            datesRow[inst.weekNumber - 1] = format(new Date(inst.dueDate), 'dd/MM/yyyy');
          }
        });
      }

      const sortedMembers = [...loan.group.members].sort((a, b) => {
        if (a.isLeader) return -1;
        if (b.isLeader) return 1;
        return 0;
      });

      const leaderName = leaderMember ? leaderMember.client.fullname : (sortedMembers[0]?.client?.fullname || '');

      worksheet.addRow([
        loan.group.name,
        loan.group.groupNo || loan.group.name,
        leaderName,
        ...datesRow
      ]);
      const datesRowIndex = currentRow;
      worksheet.getRow(datesRowIndex).font = { bold: true };
      currentRow++;

      const collectionDayIndex = loan.group.collectionDay; 
      let dayString = "";
      if (collectionDayIndex === 7) dayString = "Sunday";
      else if (collectionDayIndex === 1) dayString = "Monday";
      else if (collectionDayIndex === 2) dayString = "Tuesday";
      else if (collectionDayIndex === 3) dayString = "Wednesday";
      else if (collectionDayIndex === 4) dayString = "Thursday";
      else if (collectionDayIndex === 5) dayString = "Friday";
      else if (collectionDayIndex === 6) dayString = "Saturday";

      // Row 3+ : Members and their payments
      sortedMembers.forEach((member, index) => {
        const isLeaderRow = index === 0;
        const col1 = isLeaderRow ? dayString : '';
        const col2 = ''; 
        const col3 = member.client.fullname;

        const paymentsRow = Array(totalWeeks).fill('');
        const memberInstalments = loan.instalments.filter(i => i.clientId === member.clientId);
        
        memberInstalments.forEach(inst => {
          if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
            if (Number(inst.paidAmount) > 0) {
              paymentsRow[inst.weekNumber - 1] = Number(inst.paidAmount);
            }
          }
        });

        worksheet.addRow([col1, col2, col3, ...paymentsRow]);
        currentRow++;
      });

      // Style the group table block
      const totalCols = totalWeeks + 3;
      const startRow = headerRowIndex;
      const endRow = currentRow - 1;

      for (let r = startRow; r <= endRow; r++) {
        const row = worksheet.getRow(r);
        for (let c = 1; c <= totalCols; c++) {
          const cell = row.getCell(c);
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };

          if (r === headerRowIndex || r === datesRowIndex) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFD9EAD3' }
            };
          }
        }
      }

      // Empty row separation
      worksheet.addRow([]);
      currentRow++;
    }

    // Adjust column widths
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 15;
    worksheet.getColumn(3).width = 30;
    for (let i = 4; i <= maxTotalWeeks + 3; i++) {
      worksheet.getColumn(i).width = 12;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  },

  /**
   * Generates the Loan Information Excel structure (e.g. Name, NIC, Address, Loan Amount)
   */
  async generateGroupLoanInformation(fastify, loanId) {
    // 1. Fetch Loan Details
    const loan = await fastify.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        group: {
          include: {
            members: {
              include: {
                client: true
              }
            }
          }
        },
        instalments: true,
        approvedBy: true
      }
    });

    if (!loan) {
      throw new Error("Loan not found");
    }

    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Loan Information');

    // Row 1: Headers (Main)
    const headerRow1 = [
      'No', 
      'Group', 
      'Team leader', 
      '', // empty for Grp No in row 2
      'Location', 
      'Name', 
      'Address', 
      'Phone Number', 
      'Id Number', 
      'Occupation', 
      'Loan Amount', 
      'Paid Amount', 
      'O/S Amount', 
      'Create Date', 
      'Approval Date', 
      'Status'
    ];
    worksheet.addRow(headerRow1);

    // Row 2: Headers (Sub)
    const headerRow2 = [
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      '', 
      ''
    ];
    worksheet.addRow(headerRow2);

    // Style headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(2).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
    worksheet.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };

    // Prepare data
    const sortedMembers = [...loan.group.members].sort((a, b) => {
      if (a.isLeader) return -1;
      if (b.isLeader) return 1;
      return 0;
    });

    const leaderMember = sortedMembers.find(m => m.isLeader);
    const leaderName = leaderMember ? leaderMember.client.fullname : (sortedMembers[0]?.client?.fullname || '');
    
    // Fallback date values
    const createDate = formatExcelDate(new Date(loan.createdAt), 'dd MMM yy');
    const appDate = loan.approvedAt ? formatExcelDate(new Date(loan.approvedAt), 'dd MMM yy') : '-';
    const status = loan.status;

    // Add members
    sortedMembers.forEach((member, index) => {
      const isLeaderRow = index === 0;
      
      const col1 = index + 1; // No
      const col2 = isLeaderRow ? loan.group.groupNo || '1' : ''; // Group No (or ID/1)
      const col3 = isLeaderRow ? leaderName : ''; // Team leader
      const col4 = isLeaderRow ? loan.loanNo : ''; // Grp No (using Loan No here since it fits better)
      const col5 = loan.group.location || loan.branch?.name || ''; // Location
      const col6 = member.client.fullname; // Name
      const col7 = member.client.address || ''; // Address
      const col8 = member.client.phone || ''; // Phone Number
      const col9 = member.client.nic || ''; // Id Number
      const col10 = member.client.job || 'Self Working'; // Occupation
      const col11 = isLeaderRow ? Number(loan.leaderLentAmount) : Number(loan.memberLentAmount); // Loan Amount
      
      const memberInstalments = loan.instalments ? loan.instalments.filter(i => i.clientId === member.clientId) : [];
      const paidAmount = memberInstalments.reduce((sum, inst) => sum + Number(inst.paidAmount || 0), 0);
      const osAmount = col11 - paidAmount;

      const col12 = paidAmount; // Paid Amount
      const col13 = osAmount; // O/S Amount
      const col14 = createDate; // Create Date
      const col15 = appDate; // Approval Date
      const col16 = status; // Status

      worksheet.addRow([col1, col2, col3, col4, col5, col6, col7, col8, col9, col10, col11, col12, col13, col14, col15, col16]);
    });

    // Add borders to the entire table
    const totalRows = sortedMembers.length + 2;
    for (let r = 1; r <= totalRows; r++) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= 16; c++) {
        const cell = row.getCell(c);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    }

    // Adjust column widths
    worksheet.getColumn(1).width = 5;  // No
    worksheet.getColumn(2).width = 8;  // Group
    worksheet.getColumn(3).width = 20; // Team leader
    worksheet.getColumn(4).width = 15; // Grp No
    worksheet.getColumn(5).width = 15; // Location
    worksheet.getColumn(6).width = 25; // Name
    worksheet.getColumn(7).width = 30; // Address
    worksheet.getColumn(8).width = 15; // Phone
    worksheet.getColumn(9).width = 15; // NIC
    worksheet.getColumn(10).width = 15; // Occupation
    worksheet.getColumn(11).width = 15; // Loan Amount
    worksheet.getColumn(12).width = 15; // Paid Amount
    worksheet.getColumn(13).width = 15; // O/S Amount
    worksheet.getColumn(14).width = 15; // Create Date
    worksheet.getColumn(15).width = 15; // Approval Date
    worksheet.getColumn(16).width = 15; // Status

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  },

  /**
   * Generates the Loan Information Excel structure for multiple loans
   */
  async generateBatchGroupLoanInformation(fastify, loans) {
    const workbook = new exceljs.Workbook();
    const worksheet = workbook.addWorksheet('Loan Information');

    let currentRow = 1;

    for (const loan of loans) {
      if (!loan.group) continue;

      // Row 1: Headers (Main)
      const headerRow1 = [
        'No', 
        'Group', 
        'Team leader', 
        '', // empty for Grp No in row 2
        'Location', 
        'Name', 
        'Address', 
        'Phone Number', 
        'Id Number', 
        'Occupation', 
        'Loan Amount', 
        'Paid Amount', 
        'O/S Amount', 
        'Create Date', 
        'Approval Date', 
        'Status'
      ];
      worksheet.addRow(headerRow1);
      const headerRowIndex1 = currentRow;
      currentRow++;

      // Row 2: Headers (Sub)
      const headerRow2 = [
        '', 
        'No', 
        '', 
        'Grp No ', 
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        ''
      ];
      worksheet.addRow(headerRow2);
      const headerRowIndex2 = currentRow;
      currentRow++;

      // Style headers
      worksheet.getRow(headerRowIndex1).font = { bold: true };
      worksheet.getRow(headerRowIndex2).font = { bold: true };
      worksheet.getRow(headerRowIndex1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
      worksheet.getRow(headerRowIndex2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };

      // Prepare data
      const sortedMembers = [...loan.group.members].sort((a, b) => {
        if (a.isLeader) return -1;
        if (b.isLeader) return 1;
        return 0;
      });

      const leaderMember = sortedMembers.find(m => m.isLeader);
      const leaderName = leaderMember ? leaderMember.client.fullname : (sortedMembers[0]?.client?.fullname || '');
      
      const createDate = formatExcelDate(new Date(loan.createdAt), 'dd MMM yy');
      const appDate = loan.approvedAt ? formatExcelDate(new Date(loan.approvedAt), 'dd MMM yy') : '-';
      const status = loan.status;

      // Add members
      sortedMembers.forEach((member, index) => {
        const isLeaderRow = index === 0;
        
        const col1 = index + 1; // No
        const col2 = isLeaderRow ? loan.group.groupNo || '1' : ''; 
        const col3 = isLeaderRow ? leaderName : ''; 
        const col4 = isLeaderRow ? loan.loanNo : ''; 
        const col5 = loan.group.location || loan.branch?.name || ''; 
        const col6 = member.client.fullname; 
        const col7 = member.client.address || ''; 
        const col8 = member.client.phone || ''; 
        const col9 = member.client.nic || ''; 
        const col10 = member.client.job || 'Self Working'; 
        const col11 = isLeaderRow ? Number(loan.leaderLentAmount) : Number(loan.memberLentAmount); 
        
        const memberInstalments = loan.instalments ? loan.instalments.filter(i => i.clientId === member.clientId) : [];
        const paidAmount = memberInstalments.reduce((sum, inst) => sum + Number(inst.paidAmount || 0), 0);
        const osAmount = col11 - paidAmount;

        const col12 = paidAmount; 
        const col13 = osAmount; 
        const col14 = createDate; 
        const col15 = appDate; 
        const col16 = status; 

        worksheet.addRow([col1, col2, col3, col4, col5, col6, col7, col8, col9, col10, col11, col12, col13, col14, col15, col16]);
        currentRow++;
      });

      // Add borders to the entire table
      const startRow = headerRowIndex1;
      const endRow = currentRow - 1;
      for (let r = startRow; r <= endRow; r++) {
        const row = worksheet.getRow(r);
        for (let c = 1; c <= 16; c++) {
          const cell = row.getCell(c);
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        }
      }

      // Empty row separation
      worksheet.addRow([]);
      currentRow++;
    }

    // Adjust column widths
    worksheet.getColumn(1).width = 5;  // No
    worksheet.getColumn(2).width = 8;  // Group
    worksheet.getColumn(3).width = 20; // Team leader
    worksheet.getColumn(4).width = 15; // Grp No
    worksheet.getColumn(5).width = 15; // Location
    worksheet.getColumn(6).width = 25; // Name
    worksheet.getColumn(7).width = 30; // Address
    worksheet.getColumn(8).width = 15; // Phone
    worksheet.getColumn(9).width = 15; // NIC
    worksheet.getColumn(10).width = 15; // Occupation
    worksheet.getColumn(11).width = 15; // Loan Amount
    worksheet.getColumn(12).width = 15; // Paid Amount
    worksheet.getColumn(13).width = 15; // O/S Amount
    worksheet.getColumn(14).width = 15; // Create Date
    worksheet.getColumn(15).width = 15; // Approval Date
    worksheet.getColumn(16).width = 15; // Status

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  },

  // ─────────────────────────────────────────────────────────────
  // REPORT FUNCTIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Collections Report — Approved collections within a date range.
   */
  async generateCollectionsReport(prisma, startDate, endDate, branchId) {
    const where = { status: "APPROVED" };
    if (startDate && endDate) {
      where.approvedAt = {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }
    if (branchId && branchId !== "All") {
      where.group = { branchId };
    }

    const collections = await prisma.collection.findMany({
      where,
      include: {
        group: { include: { branch: { select: { name: true } } } },
        loan: { select: { loanNo: true } },
        collector: { select: { fullname: true } },
      },
      orderBy: { approvedAt: "desc" },
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Collections Report");

    ws.addRow(["Collections Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Period: ${startDate || "All"} to ${endDate || "All"}`]);
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: "FF666666" } };
    ws.addRow([]);

    const headers = ["#", "Group No", "Group Name", "Branch", "Loan No", "Collector", "Amount Collected", "Collection Date", "Approval Date", "Bank Ref"];
    ws.addRow(headers);
    const headerRow = ws.getRow(4);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };

    let totalCollected = 0;
    collections.forEach((col, idx) => {
      const amount = Number(col.amountCollected);
      totalCollected += amount;
      ws.addRow([
        idx + 1,
        col.group?.groupNo || "-",
        col.group?.name || "-",
        col.group?.branch?.name || "Main",
        col.loan?.loanNo || "-",
        col.collector?.fullname || "-",
        amount,
        col.date ? formatExcelDate(new Date(col.date)) : "-",
        col.approvedAt ? formatExcelDate(new Date(col.approvedAt)) : "-",
        col.bankReference || "-",
      ]);
    });

    ws.addRow([]);
    const summaryRow = ws.addRow(["", "", "", "", "", "TOTAL", totalCollected]);
    summaryRow.font = { bold: true };

    const totalRows = collections.length + 4;
    for (let r = 4; r <= totalRows; r++) {
      for (let c = 1; c <= 10; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 12, 20, 15, 15, 20, 18, 15, 15, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },

  /**
   * Collection Officer Wise Report — Approved collections grouped by collector.
   */
  async generateCollectionsOfficerWiseReport(prisma, startDate, endDate, branchId) {
    const where = { status: "APPROVED" };
    if (startDate && endDate) {
      where.approvedAt = {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }
    if (branchId && branchId !== "All") {
      where.group = { branchId };
    }

    const collections = await prisma.collection.findMany({
      where,
      include: {
        group: { include: { branch: { select: { name: true } } } },
        loan: { select: { loanNo: true } },
        collector: { select: { id: true, fullname: true } },
      },
      orderBy: { approvedAt: "desc" },
    });

    const officerMap = {};
    collections.forEach((col) => {
      const oid = col.collector?.id || "unknown";
      if (!officerMap[oid]) { officerMap[oid] = { name: col.collector?.fullname || "Unknown", collections: [], total: 0 }; }
      officerMap[oid].total += Number(col.amountCollected);
      officerMap[oid].collections.push(col);
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Officer Wise Collections");
    ws.addRow(["Collection Officer Wise Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Period: ${startDate || "All"} to ${endDate || "All"}`]);
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: "FF666666" } };
    ws.addRow([]);

    let currentRow = 4;
    Object.values(officerMap).forEach((officer) => {
      ws.addRow([`Officer: ${officer.name}`, "", "", `Total: Rs ${officer.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, `Collections: ${officer.collections.length}`]);
      ws.getRow(currentRow).font = { bold: true, size: 11 };
      ws.getRow(currentRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      currentRow++;

      ws.addRow(["#", "Group", "Loan No", "Amount", "Collection Date", "Approval Date"]);
      ws.getRow(currentRow).font = { bold: true };
      ws.getRow(currentRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      currentRow++;

      officer.collections.forEach((col, idx) => {
        ws.addRow([idx + 1, col.group?.name || "-", col.loan?.loanNo || "-", Number(col.amountCollected), col.date ? formatExcelDate(new Date(col.date)) : "-", col.approvedAt ? formatExcelDate(new Date(col.approvedAt)) : "-"]);
        currentRow++;
      });
      ws.addRow([]); currentRow++;
    });

    for (let r = 4; r < currentRow; r++) {
      for (let c = 1; c <= 6; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 25, 15, 18, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },

  /**
   * Completed Loans Report — Loans completed within a date range.
   */
  async generateCompletedLoansReport(prisma, startDate, endDate, branchId) {
    const where = { status: "COMPLETED" };
    if (startDate && endDate) {
      where.completedAt = {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }
    if (branchId && branchId !== "All") { where.branchId = branchId; }

    const loans = await prisma.loan.findMany({
      where,
      include: {
        group: { include: { members: { include: { client: { select: { fullname: true } } } }, branch: { select: { name: true } } } },
      },
      orderBy: { completedAt: "desc" },
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Completed Loans");
    ws.addRow(["Completed Loans Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Period: ${startDate || "All"} to ${endDate || "All"}`]);
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: "FF666666" } };
    ws.addRow([]);

    ws.addRow(["#", "Loan No", "Group No", "Group Name", "Branch", "Leader", "Members", "Leader Amount", "Member Amount", "Created At", "Approved At", "Completed At"]);
    ws.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };

    loans.forEach((loan, idx) => {
      const leader = loan.group?.members?.find((m) => m.isLeader)?.client;
      ws.addRow([idx + 1, loan.loanNo, loan.group?.groupNo || "-", loan.group?.name || "-", loan.group?.branch?.name || "Main", leader?.fullname || "-", loan.group?.members?.length || 0, Number(loan.leaderLentAmount), Number(loan.memberLentAmount), formatExcelDate(new Date(loan.createdAt)), loan.approvedAt ? formatExcelDate(new Date(loan.approvedAt)) : "-", loan.completedAt ? formatExcelDate(new Date(loan.completedAt)) : "-"]);
    });

    const totalRows = loans.length + 4;
    for (let r = 4; r <= totalRows; r++) {
      for (let c = 1; c <= 12; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 15, 12, 20, 15, 20, 10, 18, 18, 15, 15, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },

  /**
   * Property (Mortgage) Collections Report — Property-wise.
   */
  async generatePropertyCollectionsReport(prisma, startDate, endDate, branchId) {
    const where = {};
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      };
    }
    if (branchId && branchId !== "All") { where.mortgage = { branchId }; }

    const collections = await prisma.mortgageCollection.findMany({
      where,
      include: {
        mortgage: { include: { client: { select: { fullname: true, clientNo: true } }, branch: { select: { name: true } } } },
        collectedBy: { select: { fullname: true } },
        items: { include: { instalment: { select: { monthNumber: true, dueAmount: true, penaltyAmount: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const propertyMap = {};
    collections.forEach((col) => {
      const mId = col.mortgageId;
      if (!propertyMap[mId]) {
        propertyMap[mId] = {
          loanNo: col.mortgage?.loanNo || "-", assetType: col.mortgage?.assetType || "-",
          clientName: col.mortgage?.client?.fullname || "-", branch: col.mortgage?.branch?.name || "Main",
          lentAmount: Number(col.mortgage?.lentAmount || 0), collections: [], total: 0, principalTotal: 0,
        };
      }
      propertyMap[mId].total += Number(col.amount);
      propertyMap[mId].principalTotal += Number(col.principalReduction);
      propertyMap[mId].collections.push(col);
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Property Collections");
    ws.addRow(["Property Collections Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Period: ${startDate || "All"} to ${endDate || "All"}`]);
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: "FF666666" } };
    ws.addRow([]);

    let currentRow = 4;
    Object.values(propertyMap).forEach((prop) => {
      ws.addRow([`${prop.loanNo} — ${prop.clientName} (${prop.assetType})`, "", "", `Lent: Rs ${prop.lentAmount.toLocaleString()}`, `Total Collected: Rs ${prop.total.toLocaleString()}`]);
      ws.getRow(currentRow).font = { bold: true, size: 11 };
      ws.getRow(currentRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      currentRow++;

      ws.addRow(["#", "Date", "Amount", "Principal Reduction", "Collector", "Notes"]);
      ws.getRow(currentRow).font = { bold: true };
      ws.getRow(currentRow).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      currentRow++;

      prop.collections.forEach((col, idx) => {
        ws.addRow([idx + 1, formatExcelDate(new Date(col.createdAt)), Number(col.amount), Number(col.principalReduction), col.collectedBy?.fullname || "-", col.notes || "-"]);
        currentRow++;
      });
      ws.addRow([]); currentRow++;
    });

    for (let r = 4; r < currentRow; r++) {
      for (let c = 1; c <= 6; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 15, 18, 20, 20, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },

  /**
   * Overdue Summary Report
   */
  async generateOverdueSummaryReport(prisma) {
    const today = new Date();
    const instalments = await prisma.instalment.findMany({
      where: { status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] }, dueDate: { lt: today }, loan: { status: { in: ["ACTIVE", "APPROVED"] } } },
      include: { client: { select: { fullname: true, clientNo: true, phone: true } }, loan: { include: { group: { include: { branch: { select: { name: true } } } } } } },
      orderBy: { dueDate: "asc" },
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Overdue Summary");
    ws.addRow(["Overdue / Arrears Summary Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Generated: ${formatExcelDate(today)}`]);
    ws.getRow(2).font = { italic: true, size: 10 };
    ws.addRow([]);

    ws.addRow(["#", "Client No", "Client Name", "Phone", "Loan No", "Group", "Branch", "Week", "Due Date", "Due Amount", "Paid", "Outstanding", "Days Overdue"]);
    ws.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } };

    let totalOutstanding = 0;
    instalments.forEach((inst, idx) => {
      const outstanding = Number(inst.dueAmount) - Number(inst.paidAmount);
      const daysOverdue = Math.floor((today - new Date(inst.dueDate)) / (1000 * 60 * 60 * 24));
      totalOutstanding += outstanding;
      ws.addRow([idx + 1, inst.client?.clientNo || "-", inst.client?.fullname || "-", inst.client?.phone || "-", inst.loan?.loanNo || "-", inst.loan?.group?.name || "-", inst.loan?.group?.branch?.name || "Main", inst.weekNumber, formatExcelDate(new Date(inst.dueDate)), Number(inst.dueAmount), Number(inst.paidAmount), outstanding, daysOverdue]);
    });

    ws.addRow([]);
    const sumRow = ws.addRow(["", "", "", "", "", "", "", "", "", "", "TOTAL", totalOutstanding]);
    sumRow.font = { bold: true };

    const totalRows = instalments.length + 4;
    for (let r = 4; r <= totalRows; r++) {
      for (let c = 1; c <= 13; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 12, 22, 15, 15, 20, 15, 8, 15, 14, 14, 14, 14].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },

  /**
   * Branch Performance Report
   */
  async generateBranchPerformanceReport(prisma) {
    const branches = await prisma.branch.findMany({
      include: { loans: { include: { instalments: true } } },
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Branch Performance");
    ws.addRow(["Branch Performance Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Generated: ${formatExcelDate(new Date())}`]);
    ws.getRow(2).font = { italic: true, size: 10 };
    ws.addRow([]);

    ws.addRow(["#", "Branch", "Total Loans", "Active", "Completed", "Total Disbursed", "Total Collected", "Outstanding", "Collection Rate %"]);
    ws.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };

    branches.forEach((branch, idx) => {
      const active = branch.loans.filter((l) => ["ACTIVE", "APPROVED"].includes(l.status)).length;
      const completed = branch.loans.filter((l) => l.status === "COMPLETED").length;
      let disbursed = 0, collected = 0, outstanding = 0;
      branch.loans.forEach((loan) => {
        loan.instalments.forEach((inst) => { disbursed += Number(inst.dueAmount); collected += Number(inst.paidAmount); outstanding += Number(inst.remainingDue); });
      });
      const rate = disbursed > 0 ? ((collected / disbursed) * 100).toFixed(1) : "0.0";
      ws.addRow([idx + 1, branch.name, branch.loans.length, active, completed, disbursed, collected, outstanding, `${rate}%`]);
    });

    const totalRows = branches.length + 4;
    for (let r = 4; r <= totalRows; r++) {
      for (let c = 1; c <= 9; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 20, 12, 12, 16, 18, 18, 18, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },

  /**
   * Disbursement Report — Loans approved within a date range.
   */
  async generateDisbursementReport(prisma, startDate, endDate, branchId) {
    const where = { approvedAt: { not: null } };
    if (startDate && endDate) {
      where.approvedAt = { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T23:59:59.999Z`) };
    }
    if (branchId && branchId !== "All") { where.branchId = branchId; }

    const loans = await prisma.loan.findMany({
      where,
      include: { group: { include: { members: { include: { client: { select: { fullname: true } } } }, branch: { select: { name: true } } } }, approvedBy: { select: { fullname: true } } },
      orderBy: { approvedAt: "desc" },
    });

    const workbook = new exceljs.Workbook();
    const ws = workbook.addWorksheet("Disbursement Report");
    ws.addRow(["Loan Disbursement Report"]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([`Period: ${startDate || "All"} to ${endDate || "All"}`]);
    ws.getRow(2).font = { italic: true, size: 10, color: { argb: "FF666666" } };
    ws.addRow([]);

    ws.addRow(["#", "Loan No", "Group No", "Group Name", "Branch", "Leader", "Members", "Leader Amount", "Member Amount", "Processing Fee", "Approved By", "Approved At"]);
    ws.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };

    let totalLeader = 0, totalMember = 0;
    loans.forEach((loan, idx) => {
      const leader = loan.group?.members?.find((m) => m.isLeader)?.client;
      totalLeader += Number(loan.leaderLentAmount); totalMember += Number(loan.memberLentAmount);
      ws.addRow([idx + 1, loan.loanNo, loan.group?.groupNo || "-", loan.group?.name || "-", loan.group?.branch?.name || "Main", leader?.fullname || "-", loan.group?.members?.length || 0, Number(loan.leaderLentAmount), Number(loan.memberLentAmount), Number(loan.processingFee), loan.approvedBy?.fullname || "-", loan.approvedAt ? formatExcelDate(new Date(loan.approvedAt)) : "-"]);
    });

    ws.addRow([]);
    const sumRow = ws.addRow(["", "", "", "", "", "", "TOTALS", totalLeader, totalMember]);
    sumRow.font = { bold: true };

    const totalRows = loans.length + 4;
    for (let r = 4; r <= totalRows; r++) {
      for (let c = 1; c <= 12; c++) {
        ws.getRow(r).getCell(c).border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
    }
    [5, 15, 12, 20, 15, 20, 10, 16, 16, 14, 18, 15].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    return await workbook.xlsx.writeBuffer();
  },
};
