export const documentLabels: Record<string, { title: string; hint: string }> = {
  government_id: { title: "Your government ID", hint: "National ID, voter's card, driver's licence or passport. Make sure all four corners are visible." },
  selfie: { title: "A selfie holding your ID", hint: "Hold your ID next to your face, in good light." },
  business_certificate: { title: "CAC certificate", hint: "Your business registration certificate." },
  owner_id: { title: "The owner's government ID", hint: "National ID, voter's card, driver's licence or passport of the owner or a director." },
  student_proof: { title: "Proof you're a student", hint: "Your student ID card, admission letter or school fee receipt for this term." },
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export async function fileToBase64(file: File) {
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
