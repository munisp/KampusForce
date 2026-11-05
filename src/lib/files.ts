export const documentLabels: Record<string, { title: string; hint: string }> = {
  government_id: { title: "Your government ID", hint: "National ID, voter's card, driver's licence or passport. Make sure all four corners are visible." },
  selfie: { title: "A selfie holding your ID", hint: "Hold your ID next to your face, in good light." },
  business_certificate: { title: "CAC certificate", hint: "Your business registration certificate." },
  owner_id: { title: "The owner's government ID", hint: "National ID, voter's card, driver's licence or passport of the owner or a director." },
  student_proof: { title: "Proof of enrolment", hint: "Your campus ID card, admission letter or school fee receipt for this term." },
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

// Which government ID someone uploaded, so Operations knows what they're looking at.
export const GOVERNMENT_ID_TYPES = [
  { value: "nin_slip", label: "NIN slip" },
  { value: "national_id_card", label: "National ID card" },
  { value: "passport", label: "International passport" },
  { value: "drivers_licence", label: "Driver's licence" },
  { value: "voters_card", label: "Voter's card (PVC)" },
] as const;
export type GovernmentIdType = typeof GOVERNMENT_ID_TYPES[number]["value"];
export const idTypeLabel = (value?: string | null) => GOVERNMENT_ID_TYPES.find((t) => t.value === value)?.label;

const MAX_PHOTO_SIDE = 2000;

/**
 * Phone and laptop photos are often 4–12 MB; an ID check needs a fraction of that. Photos are redrawn at up to
 * 2000 px on the long side as a good-quality JPEG (usually under 1 MB) before upload. PDFs and small images are sent
 * as they are. Text on an ID stays readable at this size.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(file.type) || file.size < 800 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff"; // transparent PNG areas become white, not black
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // an image the browser can't decode goes as it is; the server checks the type
  }
}

export const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export async function fileToBase64(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

export function base64ToObjectUrl(contentBase64: string, contentType: string) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}
