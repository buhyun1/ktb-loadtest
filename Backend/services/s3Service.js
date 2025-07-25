const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

exports.uploadFile = async (fileBuffer, filename, mimeType) => {
  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: filename,
    Body: fileBuffer,
    ContentType: mimeType,
  };
  await s3.send(new PutObjectCommand(params));
  return `https://${params.Bucket}.s3.${process.env.S3_REGION}.amazonaws.com/${filename}`;
}; 