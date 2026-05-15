// utils/s3Client.js
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { randomUUID } from "crypto";

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true, // Required for MinIO
});

export const uploadFile = async (fileStream, fileName, contentType) => {
  const objectKey = `${randomUUID()}-${fileName}`;
  const bucket = process.env.S3_BUCKET;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: objectKey,
      Body: fileStream,
      ContentType: contentType,
      ACL: "public-read",
    },
  });

  await upload.done();

  // Construct public URL
  // Example: http://38.242.251.70:9000/microfinance-uploads/objectKey
  const fileUrl = `${process.env.S3_ENDPOINT}/${bucket}/${objectKey}`;

  return {
    bucket,
    objectKey,
    fileUrl,
  };
};

export const deleteFile = async (objectKey) => {
  const command = new DeleteObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: objectKey,
  });

  await s3Client.send(command);
};

export default s3Client;
