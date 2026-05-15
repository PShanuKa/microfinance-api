// routes/attachments/index.js
import { uploadFile, deleteFile } from "../../utils/s3Client.js";
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function attachmentRoutes(fastify, opts) {
  // POST /api/attachments/upload
  fastify.post("/upload", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      throw createBadRequestError("No file uploaded");
    }

    try {
      const { bucket, objectKey, fileUrl } = await uploadFile(
        data.file,
        data.filename,
        data.mimetype
      );

      const attachment = await fastify.prisma.attachment.create({
        data: {
          fileName: data.filename,
          fileType: data.mimetype,
          fileSize: 0, // Stream doesn't provide size easily
          fileUrl,
          bucket,
          objectKey,
        },
      });

      return {
        success: true,
        id: attachment.id,
        link: fileUrl,
      };
    } catch (error) {
      fastify.log.error(error);
      throw createBadRequestError("File upload failed: " + error.message);
    }
  });

  // DELETE /api/attachments/:id
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params;

    const attachment = await fastify.prisma.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      throw createNotFoundError("Attachment not found");
    }

    try {
      // 1. Delete from S3
      await deleteFile(attachment.objectKey);

      // 2. Delete from DB
      await fastify.prisma.attachment.delete({
        where: { id },
      });

      return {
        success: true,
        message: "File removed successfully",
      };
    } catch (error) {
      fastify.log.error(error);
      throw createBadRequestError("File deletion failed");
    }
  });
}
