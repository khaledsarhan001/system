export type Permission = 'productsRead' | 'productsWrite' | 'salesCreate' | 'employeesRead' | 'analyticsRead';

export type Env = {
  JWT_SECRET: string;
  DB: D1Database;
  ASSETS: Fetcher;
};

export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone?: string;
  branch?: string;
  jobTitle?: string;
  role: 'admin' | 'employee';
  isActive: boolean;
  permissions: Record<Permission, boolean>;
};

export const DEFAULT_PERMISSIONS: Record<Permission, boolean> = {
  productsRead: true,
  productsWrite: false,
  salesCreate: true,
  employeesRead: false,
  analyticsRead: false,
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  productsRead: 'عرض المنتجات',
  productsWrite: 'إضافة وتعديل المنتجات والمخزون',
  salesCreate: 'تسجيل المبيعات',
  employeesRead: 'عرض الموظفين',
  analyticsRead: 'عرض التقارير',
};
