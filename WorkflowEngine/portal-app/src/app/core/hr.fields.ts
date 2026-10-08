import { Employee } from './hr.models';

export type FieldType = 'text' | 'email' | 'date' | 'number' | 'status' | 'gender';

export interface EmpField {
  key: keyof Employee;
  /** translation key of the label */
  label: string;
  type: FieldType;
  required?: boolean;
  /** Column headings (lower-case, English / Arabic) that map onto this field automatically when importing. */
  names: string[];
  /** value shown in the downloadable template */
  sample: string | number;
  /** only with the "view salary" privilege */
  salary?: boolean;
}

export const EMP_FIELDS: EmpField[] = [
  { key: 'empNo', label: 'hr.f.empNo', type: 'text', required: true, sample: 'E1001', names: ['empno', 'emp no', 'employee no', 'employee number', 'employee id', 'emp id', 'id', 'staff no', 'staff number', 'رقم الموظف', 'الرقم الوظيفي', 'رقم وظيفي'] },
  { key: 'fullName', label: 'hr.f.fullName', type: 'text', required: true, sample: 'Ahmed Ali', names: ['fullname', 'full name', 'name', 'employee name', 'اسم الموظف', 'الاسم', 'الاسم الكامل', 'الاسم بالانجليزي'] },
  { key: 'fullNameAr', label: 'hr.f.fullNameAr', type: 'text', sample: 'أحمد علي', names: ['fullnamear', 'arabic name', 'name ar', 'name (arabic)', 'الاسم بالعربي', 'الاسم عربي', 'اسم الموظف بالعربي'] },
  { key: 'email', label: 'hr.f.email', type: 'email', sample: 'ahmed@company.com', names: ['email', 'e-mail', 'mail', 'work email', 'البريد', 'البريد الالكتروني', 'البريد الإلكتروني'] },
  { key: 'phone', label: 'hr.f.phone', type: 'text', sample: '+966500000000', names: ['phone', 'mobile', 'tel', 'telephone', 'cell', 'الجوال', 'الهاتف', 'رقم الجوال'] },
  { key: 'nationality', label: 'hr.f.nationality', type: 'text', sample: 'Saudi', names: ['nationality', 'country', 'الجنسية'] },
  { key: 'gender', label: 'hr.f.gender', type: 'gender', sample: 'Male', names: ['gender', 'sex', 'الجنس', 'النوع'] },
  { key: 'nationalId', label: 'hr.f.nationalId', type: 'text', sample: '1000000000', names: ['nationalid', 'national id', 'iqama', 'id number', 'iqama no', 'الهوية', 'رقم الهوية', 'رقم الإقامة', 'الاقامة'] },
  { key: 'birthDate', label: 'hr.f.birthDate', type: 'date', sample: '1990-05-20', names: ['birthdate', 'birth date', 'date of birth', 'dob', 'تاريخ الميلاد'] },
  { key: 'hireDate', label: 'hr.f.hireDate', type: 'date', sample: '2022-01-15', names: ['hiredate', 'hire date', 'join date', 'joining date', 'date of joining', 'start date', 'تاريخ التعيين', 'تاريخ الالتحاق', 'تاريخ المباشرة'] },
  { key: 'terminationDate', label: 'hr.f.terminationDate', type: 'date', sample: '', names: ['terminationdate', 'termination date', 'end date', 'leaving date', 'exit date', 'تاريخ انتهاء الخدمة', 'تاريخ الانتهاء'] },
  { key: 'status', label: 'hr.f.status', type: 'status', sample: 'Active', names: ['status', 'employee status', 'الحالة', 'حالة الموظف'] },
  { key: 'company', label: 'hr.f.company', type: 'text', sample: 'MAIN', names: ['company', 'company code', 'الشركة'] },
  { key: 'branch', label: 'hr.f.branch', type: 'text', sample: 'RUH', names: ['branch', 'branch code', 'الفرع'] },
  { key: 'unit', label: 'hr.f.unit', type: 'text', sample: 'Finance', names: ['unit', 'department', 'dept', 'division', 'section', 'team', 'org unit', 'القسم', 'الإدارة', 'الادارة', 'الوحدة'] },
  { key: 'position', label: 'hr.f.position', type: 'text', sample: 'Senior Accountant', names: ['position', 'job title', 'title', 'designation', 'المسمى الوظيفي', 'المنصب', 'الوظيفة'] },
  { key: 'job', label: 'hr.f.job', type: 'text', sample: 'Accountant', names: ['job', 'job code', 'job family', 'الوظيفة العامة'] },
  { key: 'grade', label: 'hr.f.grade', type: 'text', sample: 'G5', names: ['grade', 'level', 'band', 'الدرجة', 'المرتبة'] },
  { key: 'managerEmpNo', label: 'hr.f.managerEmpNo', type: 'text', sample: 'E1000', names: ['manager', 'manager no', 'manager empno', 'manager id', 'line manager', 'reports to', 'المدير', 'رقم المدير', 'المدير المباشر'] },
  { key: 'costCenter', label: 'hr.f.costCenter', type: 'text', sample: 'CC-100', names: ['costcenter', 'cost center', 'cost centre', 'cc', 'مركز التكلفة'] },
  { key: 'location', label: 'hr.f.location', type: 'text', sample: 'Riyadh', names: ['location', 'city', 'work location', 'site', 'الموقع', 'المدينة'] },
  { key: 'legalEntity', label: 'hr.f.legalEntity', type: 'text', sample: '', names: ['legalentity', 'legal entity', 'الكيان القانوني'] },
  { key: 'businessUnit', label: 'hr.f.businessUnit', type: 'text', sample: '', names: ['businessunit', 'business unit', 'bu', 'وحدة الأعمال', 'وحدة الاعمال'] },
  { key: 'basicSalary', label: 'hr.f.basicSalary', type: 'number', sample: 12000, salary: true, names: ['basicsalary', 'basic salary', 'salary', 'basic', 'الراتب', 'الراتب الأساسي', 'الراتب الاساسي'] },
  { key: 'username', label: 'hr.f.username', type: 'text', sample: 'ahmed', names: ['username', 'user name', 'login', 'user', 'اسم المستخدم'] },
  { key: 'notes', label: 'hr.f.notes', type: 'text', sample: '', names: ['notes', 'remarks', 'comment', 'ملاحظات'] },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/[\s_\-.]+/g, ' ');

/** Guess which field a spreadsheet heading belongs to (undefined = leave unmapped). */
export function guessField(heading: unknown): keyof Employee | undefined {
  const h = norm(heading);
  if (!h) return undefined;
  const flat = h.replace(/ /g, '');
  for (const f of EMP_FIELDS) {
    for (const n of f.names) {
      const nn = norm(n);
      if (nn === h || nn.replace(/ /g, '') === flat) return f.key;
    }
  }
  return undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Accepts Date objects, Excel serial numbers, yyyy-mm-dd, dd/mm/yyyy and dd-mm-yyyy. Returns yyyy-mm-dd or null when it can't be read. */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : ymd(v);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
    return null;
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return +m[1] > 12 ? valid(+m[3], +m[2], +m[1]) : (+m[2] > 12 ? valid(+m[3], +m[1], +m[2]) : valid(+m[3], +m[2], +m[1])); // day first (the usual format in the region)
  return null;
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

const STATUS_WORDS: Record<string, string> = {
  active: 'Active', 'on job': 'Active', 'نشط': 'Active', 'على رأس العمل': 'Active', 'علي راس العمل': 'Active',
  probation: 'Probation', 'تجربة': 'Probation', 'تحت التجربة': 'Probation',
  'on leave': 'OnLeave', onleave: 'OnLeave', leave: 'OnLeave', 'في إجازة': 'OnLeave', 'اجازة': 'OnLeave', 'إجازة': 'OnLeave',
  terminated: 'Terminated', resigned: 'Terminated', inactive: 'Terminated', left: 'Terminated', 'منتهي': 'Terminated', 'مستقيل': 'Terminated', 'منتهية خدمته': 'Terminated',
};
export function parseStatus(v: unknown): string | null {
  const s = norm(v);
  if (!s) return 'Active';
  return STATUS_WORDS[s] ?? STATUS_WORDS[s.replace(/ /g, '')] ?? null;
}
export function parseGender(v: unknown): string | null {
  const s = norm(v);
  if (!s) return null;
  if (['m', 'male', 'man', 'ذكر', 'رجل'].includes(s)) return 'Male';
  if (['f', 'female', 'woman', 'أنثى', 'انثى', 'امرأة'].includes(s)) return 'Female';
  return '?';
}

export interface MappedRow { row: number; data: Partial<Employee>; errors: string[]; warnings: string[]; }

/**
 * Turns the spreadsheet rows into employee records using the column mapping (column index -> field).
 * `errors` make a row unimportable; `warnings` (e.g. a department that is not in the org structure) don't.
 */
export function mapRows(rows: unknown[][], mapping: Record<number, keyof Employee | ''>, firstDataRow = 1, canSalary = true): MappedRow[] {
  const out: MappedRow[] = [];
  const byField = new Map<keyof Employee, number>();
  Object.entries(mapping).forEach(([col, f]) => { if (f) byField.set(f, +col); });

  for (let i = firstDataRow; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every(c => c === null || c === undefined || String(c).trim() === '')) continue;   // blank line
    const data: Record<string, any> = {};
    const errors: string[] = [];
    for (const f of EMP_FIELDS) {
      const col = byField.get(f.key);
      if (col === undefined) continue;
      if (f.salary && !canSalary) continue;
      const raw = r[col];
      const empty = raw === null || raw === undefined || String(raw).trim() === '';
      if (empty) { if (f.required) errors.push(`${f.key}`); continue; }
      switch (f.type) {
        case 'date': { const d = parseDate(raw); if (d) data[f.key] = d; else errors.push(`${f.key}:date`); break; }
        case 'number': { const n = Number(String(raw).replace(/[, ]/g, '')); if (isFinite(n)) data[f.key] = n; else errors.push(`${f.key}:number`); break; }
        case 'status': { const s = parseStatus(raw); if (s) data[f.key] = s; else errors.push(`${f.key}:status`); break; }
        case 'gender': { const g = parseGender(raw); if (g && g !== '?') data[f.key] = g; else errors.push(`${f.key}:gender`); break; }
        case 'email': { const e = String(raw).trim(); if (e.includes('@')) data[f.key] = e; else errors.push(`${f.key}:email`); break; }
        default: data[f.key] = String(raw).trim();
      }
    }
    if (!data['status']) data['status'] = 'Active';
    out.push({ row: i + 1, data: data as Partial<Employee>, errors, warnings: [] });
  }
  return out;
}

/** Minimal CSV reader: quotes, escaped quotes, BOM, comma / semicolon / tab delimiters. */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
