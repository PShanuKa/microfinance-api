import exceljs from 'exceljs';
import { format } from 'date-fns';

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
          datesRow[inst.weekNumber - 1] = format(new Date(inst.dueDate), 'dd/MM/yyyy');
        }
      });
    } else if (loan.instalments.length > 0) {
      // Fallback if no leader flag: use first client's instalments
      const firstClientId = loan.instalments[0].clientId;
      const firstInstalments = loan.instalments.filter(i => i.clientId === firstClientId);
      firstInstalments.forEach(inst => {
         if (inst.weekNumber >= 1 && inst.weekNumber <= totalWeeks) {
          datesRow[inst.weekNumber - 1] = format(new Date(inst.dueDate), 'dd/MM/yyyy');
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
    const createDate = format(new Date(loan.createdAt), 'dd MMM yy');
    const appDate = loan.approvedAt ? format(new Date(loan.approvedAt), 'dd MMM yy') : '-';
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
      
      const createDate = format(new Date(loan.createdAt), 'dd MMM yy');
      const appDate = loan.approvedAt ? format(new Date(loan.approvedAt), 'dd MMM yy') : '-';
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
  }
};
