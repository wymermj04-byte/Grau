import { QRCode } from '@ttsalpha/qrcode';

type AcademyCheckInQrProps = {
  value: string;
  size?: number;
};

export function AcademyCheckInQr({ value, size = 232 }: AcademyCheckInQrProps) {
  return <QRCode value={value} size={size} margin={4} dotColor="#171B1A" backgroundColor="#FFFFFF" qr={{ errorCorrectionLevel: 'M' }} ariaLabel="Reusable academy family check-in QR code" />;
}
