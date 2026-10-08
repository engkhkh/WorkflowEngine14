/** Core HR types (match backend Models/Hr.cs and Controllers/HrController.cs). */

export type EmpStatus = 'Active' | 'Probation' | 'OnLeave' | 'Terminated';
export const EMP_STATUSES: EmpStatus[] = ['Active', 'Probation', 'OnLeave', 'Terminated'];

export interface Employee {
  id: string;
  empNo: string;
  fullName: string;
  fullNameAr?: string | null;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  gender?: string | null;
  nationalId?: string | null;
  birthDate?: string | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  status: EmpStatus;
  company?: string | null;
  branch?: string | null;
  unit?: string | null;
  position?: string | null;
  job?: string | null;
  grade?: string | null;
  managerEmpNo?: string | null;
  costCenter?: string | null;
  location?: string | null;
  legalEntity?: string | null;
  businessUnit?: string | null;
  basicSalary?: number | null;
  username?: string | null;
  notes?: string | null;
}

export type HrKind = 'unit' | 'position' | 'job' | 'grade' | 'costcenter' | 'location' | 'entity' | 'bu' | 'leavetype'
  | 'leave' | 'goal' | 'review' | 'vacancy' | 'candidate';

export interface HrRecord<D = Record<string, any>> {
  id: string;
  kind: HrKind;
  code?: string | null;
  empNo?: string | null;
  status?: string | null;
  data: D;
  createdBy?: string | null;
  createdAt?: string;
}

export interface ImportRow { row: number; data: Partial<Employee>; }
export interface ImportResult { created: number; updated: number; skipped: number; errors: { row: number; empNo: string; message: string }[]; }

export interface HrCount { name: string; count: number; }
export interface HrSummary {
  total: number; active: number; onLeave: number; probation: number; terminated: number;
  newHires12m: number; terminations12m: number; turnoverPct: number; avgTenureYears: number;
  monthlyPayroll: number | null; onLeaveToday: number; pendingLeave: number;
  openVacancies: number; openPositions: number; candidatesInPipeline: number;
  byUnit: HrCount[]; byNationality: HrCount[]; byLocation: HrCount[]; byGender: HrCount[]; hires: HrCount[]; ratings: HrCount[];
}

/** Reference-data kinds shown on the Organization page (the org-unit tree has its own tab). */
export const REF_KINDS: { kind: HrKind; labelKey: string }[] = [
  { kind: 'position', labelKey: 'hr.ref.position' },
  { kind: 'job', labelKey: 'hr.ref.job' },
  { kind: 'grade', labelKey: 'hr.ref.grade' },
  { kind: 'costcenter', labelKey: 'hr.ref.costcenter' },
  { kind: 'location', labelKey: 'hr.ref.location' },
  { kind: 'entity', labelKey: 'hr.ref.entity' },
  { kind: 'bu', labelKey: 'hr.ref.bu' },
  { kind: 'leavetype', labelKey: 'hr.ref.leavetype' },
];

export const UNIT_LEVELS = ['division', 'department', 'section', 'team'] as const;
export const CANDIDATE_STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'] as const;
export const LEAVE_STATUSES = ['Pending', 'Approved', 'Rejected', 'Cancelled'] as const;

/** Holding any of these opens the HR workspace. */
export const HR_ANY = ['hr.view', 'hr.reports.view', 'hr.employees.view', 'hr.org.view', 'hr.leave.view', 'hr.performance.view', 'hr.recruitment.view', 'hr.self'];
