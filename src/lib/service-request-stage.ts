// Derives the display stage of an agency service-area request from its two
// decision columns: `status` (the ADMIN's final decision) and `campus_status`
// (the CAMPUS decision). See migration 0124 for the two-stage model.

export type ServiceReqStage =
  | 'AWAITING_CAMPUS'
  | 'AWAITING_ADMIN'
  | 'APPROVED'
  | 'CAMPUS_REJECTED'
  | 'ADMIN_REJECTED';

export function serviceRequestStage(status: string, campusStatus: string): ServiceReqStage {
  if (status === 'APPROVED') return 'APPROVED';
  if (campusStatus === 'REJECTED') return 'CAMPUS_REJECTED';
  if (status === 'REJECTED') return 'ADMIN_REJECTED'; // campus approved, admin then rejected
  if (campusStatus === 'APPROVED') return 'AWAITING_ADMIN';
  return 'AWAITING_CAMPUS';
}

export const STAGE_LABEL: Record<ServiceReqStage, string> = {
  AWAITING_CAMPUS: 'Awaiting campus',
  AWAITING_ADMIN: 'Awaiting admin',
  APPROVED: 'Approved · Live',
  CAMPUS_REJECTED: 'Rejected by campus',
  ADMIN_REJECTED: 'Rejected by admin',
};

export const STAGE_TONE: Record<ServiceReqStage, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  AWAITING_CAMPUS: 'amber',
  AWAITING_ADMIN: 'blue',
  APPROVED: 'green',
  CAMPUS_REJECTED: 'red',
  ADMIN_REJECTED: 'red',
};
