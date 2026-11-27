export const MAX_PAYMENT_PROOF_BYTES = 10 * 1024 * 1024;

export type PaymentProofMimeType = 'image/jpeg' | 'image/png';

const jpegSignature = [0xff, 0xd8, 0xff];
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function validatePaymentProofPhoto(file: File): Promise<File> {
  if (file.size === 0) throw new Error('Choose a non-empty JPG or PNG photo.');
  if (file.size > MAX_PAYMENT_PROOF_BYTES) throw new Error('Choose a JPG or PNG photo up to 10 MiB.');

  const bytes = new Uint8Array(await file.slice(0, pngSignature.length).arrayBuffer());
  const matches = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const type: PaymentProofMimeType | null = matches(pngSignature) ? 'image/png' : matches(jpegSignature) ? 'image/jpeg' : null;
  if (!type) throw new Error('Choose a JPG, JPEG, or PNG image.');

  return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}
