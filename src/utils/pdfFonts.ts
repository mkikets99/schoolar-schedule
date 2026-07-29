import { jsPDF } from 'jspdf';

let fontDataPromise: Promise<string> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function ensureFonts(doc: jsPDF): Promise<void> {
  if (!fontDataPromise) {
    fontDataPromise = fetch('https://cdn.jsdelivr.net/npm/dejavu-sans@1.0.0/fonts/dejavu-sans-webfont.ttf')
      .then(r => r.arrayBuffer())
      .then(arrayBufferToBase64);
  }
  const b64 = await fontDataPromise;
  if (!doc.getFontList().DejaVuSans) {
    doc.addFileToVFS('DejaVuSans.ttf', b64);
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'bold');
  }
}
