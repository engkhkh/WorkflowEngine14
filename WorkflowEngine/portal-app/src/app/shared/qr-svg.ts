import qrcode from './qr';

/** An inline SVG (string) of a QR code for the given text. Error correction M, byte mode: fits the ZATCA TLV payload (about 150 characters base64). */
export function qrSvg(text: string, cell = 4, margin = 2): string {
  const q: any = (qrcode as any)(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: cell, margin, scalable: true });
}
