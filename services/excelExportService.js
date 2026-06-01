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
  }
};
