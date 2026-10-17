export type Permission = 'productsRead' | 'productsWrite' | 'salesCreate' | 'employeesRead' | 'analyticsRead';

export type Env = {
  JWT_SECRET: string;
  MONGODB_DATA_API_URL: string;
  MONGODB_DATA_API_KEY: string;
  MONGODB_DATABASE: string;
  MONGODB_DATASOURCE: string;
  ASSETS: Fetcher;
};

export type User = {
  id: string;
  name: string;
  username: string;
  email: string;
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
