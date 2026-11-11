import 'server-only';
import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

// Neon Object Storage (API compatível com S3). Docs: https://neon.com/docs/storage/get-started
// Credencial com escopos storage:read e storage:write, criada no Neon (nunca exposta ao navegador).
let client: S3Client | undefined;

export function getStorage() {
  client ??= new S3Client({
    region: env('AWS_REGION'),
    endpoint: env('AWS_ENDPOINT_URL_S3'),
    credentials: { accessKeyId: env('AWS_ACCESS_KEY_ID'), secretAccessKey: env('AWS_SECRET_ACCESS_KEY') },
    forcePathStyle: true, // obrigatório no Neon Object Storage
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  return client;
}

export const bucket = () => env('STORAGE_BUCKET');
