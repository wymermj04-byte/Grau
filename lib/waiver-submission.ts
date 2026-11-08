export type WaiverSubmissionRequest = {
  studentId: number;
  waiverVersionId: string;
  participantName: string;
  signerName: string;
  signerRole: 'participant' | 'parent_guardian';
  emergencyContactName: string;
  emergencyContactPhone: string;
  signatureObjectPath: string;
  signatureSvg: string;
  idempotencyKey: string;
};

export type WaiverSubmissionGateway = {
  uploadSignature: (path: string, signatureSvg: string) => Promise<'uploaded' | 'already-exists'>;
  finalize: (request: Omit<WaiverSubmissionRequest, 'signatureSvg'>) => Promise<string>;
};

export function createWaiverIdempotencyKey() {
  const part = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${part()}-${part().slice(0, 4)}-4${part().slice(0, 3)}-8${part().slice(0, 3)}-${part()}${part().slice(0, 4)}`;
}

export async function submitWaiverWithGateway(
  gateway: WaiverSubmissionGateway,
  request: WaiverSubmissionRequest,
) {
  await gateway.uploadSignature(request.signatureObjectPath, request.signatureSvg);

  const submissionId = await gateway.finalize({
    studentId: request.studentId,
    waiverVersionId: request.waiverVersionId,
    participantName: request.participantName,
    signerName: request.signerName,
    signerRole: request.signerRole,
    emergencyContactName: request.emergencyContactName,
    emergencyContactPhone: request.emergencyContactPhone,
    signatureObjectPath: request.signatureObjectPath,
    idempotencyKey: request.idempotencyKey,
  });

  if (!submissionId) throw new Error('The signed waiver could not be finalized.');
  return submissionId;
}
