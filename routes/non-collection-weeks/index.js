// routes/non-collection-weeks/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";
import { getStartOfDaySL, getEndOfDaySL } from "../../utils/dateHelpers.js";

export default async function nonCollectionWeekRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Get all
  fastify.get("/", async (request, reply) => {
    const weeks = await fastify.prisma.nonCollectionWeek.findMany({
      orderBy: { startDate: "desc" },
    });
    return { success: true, weeks };
  });

  // Create
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["startDate", "endDate"],
        properties: {
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          reason: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { startDate, endDate, reason } = request.body;
      
      const startObj = getStartOfDaySL(startDate);
      const endObj = getEndOfDaySL(endDate);
      const today = getStartOfDaySL();

      // 1. Only allow future dates
      if (startObj <= today) {
        throw createBadRequestError("Non-collection weeks can only be created for future dates.");
      }

      const week = await fastify.prisma.$transaction(async (tx) => {
        // 2. Check for PARTIAL or PAID installments in this period
        const partialOrPaid = await tx.instalment.findFirst({
          where: {
            dueDate: { gte: startObj, lte: endObj },
            status: { in: ["PARTIAL", "PAID"] }
          }
        });
        
        if (partialOrPaid) {
          throw createBadRequestError("Cannot create non-collection week: Partial or paid installments exist in this period.");
        }

        // 3. Create the non-collection week
        const newWeek = await tx.nonCollectionWeek.create({
          data: {
            startDate: startObj,
            endDate: endObj,
            reason,
          },
        });

        // 4. Shift all upcoming UNPAID installments forward by 7 days
        await tx.$executeRaw`
          UPDATE instalments 
          SET dueDate = DATE_ADD(dueDate, INTERVAL 7 DAY) 
          WHERE dueDate >= ${startObj} AND status = 'UNPAID'
        `;

        await tx.auditLog.create({
          data: {
            action: "CREATE",
            entity: "SETTINGS",
            entityId: newWeek.id,
            userId: request.user?.id || "SYSTEM",
            details: { message: "Created Non-Collection Week", startDate: startObj, endDate: endObj, reason }
          }
        });

        return newWeek;
      });

      return { success: true, week };
    },
  });

  // Update
  fastify.put("/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          reason: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      const week = await fastify.prisma.$transaction(async (tx) => {
        const existingWeek = await tx.nonCollectionWeek.findUnique({ where: { id } });
        if (!existingWeek) throw createNotFoundError();

        const oldStart = existingWeek.startDate;
        const oldEnd = existingWeek.endDate;

        let newStart = oldStart;
        let newEnd = oldEnd;

        if (data.startDate) {
          newStart = getStartOfDaySL(data.startDate);
        }
        if (data.endDate) {
          newEnd = getEndOfDaySL(data.endDate);
        }

        const datesChanged = newStart.getTime() !== oldStart.getTime() || newEnd.getTime() !== oldEnd.getTime();

        if (datesChanged) {
          const today = getStartOfDaySL();
          
          if (newStart <= today) {
            throw createBadRequestError("Non-collection weeks can only be set to future dates.");
          }

          const partialOrPaid = await tx.instalment.findFirst({
            where: {
              dueDate: { gte: newStart, lte: newEnd },
              status: { in: ["PARTIAL", "PAID"] }
            }
          });
          
          if (partialOrPaid) {
            throw createBadRequestError("Cannot update: Partial or paid installments exist in the new period.");
          }

          // Revert old shift (+7 days from old start => everything >= oldStart + 7 needs -7 days)
          const oldShiftBoundary = new Date(oldStart);
          oldShiftBoundary.setDate(oldShiftBoundary.getDate() + 7);
          
          await tx.$executeRaw`
            UPDATE instalments 
            SET dueDate = DATE_SUB(dueDate, INTERVAL 7 DAY) 
            WHERE dueDate >= ${oldShiftBoundary} AND status = 'UNPAID'
          `;

          // Apply new shift
          await tx.$executeRaw`
            UPDATE instalments 
            SET dueDate = DATE_ADD(dueDate, INTERVAL 7 DAY) 
            WHERE dueDate >= ${newStart} AND status = 'UNPAID'
          `;
        }

        const updateData = {};
        if (data.startDate) updateData.startDate = newStart;
        if (data.endDate) updateData.endDate = newEnd;
        if (data.reason !== undefined) updateData.reason = data.reason;

        const updatedWeek = await tx.nonCollectionWeek.update({
          where: { id },
          data: updateData,
        });

        await tx.auditLog.create({
          data: {
            action: "UPDATE",
            entity: "SETTINGS",
            entityId: id,
            userId: request.user?.id || "SYSTEM",
            details: { message: "Updated Non-Collection Week", changes: updateData }
          }
        });

        return updatedWeek;
      });

      return { success: true, week };
    },
  });

  // Delete
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params;
    
    await fastify.prisma.$transaction(async (tx) => {
      const existingWeek = await tx.nonCollectionWeek.findUnique({ where: { id } });
      if (!existingWeek) throw createNotFoundError();

      // If a non-collection week is deleted, revert its shift
      const oldShiftBoundary = new Date(existingWeek.startDate);
      oldShiftBoundary.setDate(oldShiftBoundary.getDate() + 7);
      
      await tx.$executeRaw`
        UPDATE instalments 
        SET dueDate = DATE_SUB(dueDate, INTERVAL 7 DAY) 
        WHERE dueDate >= ${oldShiftBoundary} AND status = 'UNPAID'
      `;

      await tx.nonCollectionWeek.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          action: "DELETE",
          entity: "SETTINGS",
          entityId: id,
          userId: request.user?.id || "SYSTEM",
          details: { message: "Deleted Non-Collection Week", startDate: existingWeek.startDate }
        }
      });
    });

    return { success: true };
  });
}
