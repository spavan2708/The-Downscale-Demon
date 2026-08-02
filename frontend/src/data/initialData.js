import { formatHour } from "../utils/format";

export const seedWorkspaces = [
  {
    id: 1,
    name: "Feature-Login",
    owner: "Ravi Kumar",
    namespace: "prod-login",
    status: "Running",
    cpu: 38,
    memory: 52,
    pods: 12,
    idle: 12,
    traffic: 240,
  },
  {
    id: 2,
    name: "Feature-Payment",
    owner: "Priya Sharma",
    namespace: "prod-payment",
    status: "Idle",
    cpu: 9,
    memory: 14,
    pods: 6,
    idle: 28,
    traffic: 38,
  },
  {
    id: 3,
    name: "Feature-Dashboard",
    owner: "Arjun",
    namespace: "prod-dashboard",
    status: "Sleeping",
    cpu: 0,
    memory: 0,
    pods: 0,
    idle: 0,
    traffic: 0,
  },
  {
    id: 4,
    name: "Feature-Notifications",
    owner: "Sneha Iyer",
    namespace: "prod-notifications",
    status: "Idle",
    cpu: 12,
    memory: 22,
    pods: 4,
    idle: 19,
    traffic: 84,
  },
  {
    id: 5,
    name: "Feature-Reports",
    owner: "Vikram Rao",
    namespace: "prod-reports",
    status: "Running",
    cpu: 57,
    memory: 68,
    pods: 9,
    idle: 4,
    traffic: 310,
  },
  {
    id: 6,
    name: "Feature-Auth",
    owner: "Kavya Menon",
    namespace: "prod-auth",
    status: "Running",
    cpu: 44,
    memory: 39,
    pods: 8,
    idle: 7,
    traffic: 265,
  },
];

export const seedOvertimeRequests = [
  {
    id: 1,
    employee: "Priya Sharma",
    workspace: "Feature-Payment",
    reason: "Production Bug Fix",
    status: "pending",
  },
  {
    id: 2,
    employee: "Ravi Kumar",
    workspace: "Feature-Login",
    reason: "Sprint Deadline",
    status: "pending",
  },
  {
    id: 3,
    employee: "Vikram Rao",
    workspace: "Feature-Reports",
    reason: "Release Night",
    status: "approved",
  },
  {
    id: 4,
    employee: "Kavya Menon",
    workspace: "Feature-Auth",
    reason: "Security Patch",
    status: "rejected",
  },
];

export const seedNotifications = [
  {
    id: 1,
    type: "success",
    message: "Sleeping workspace awakened",
    timestamp: new Date(Date.now() - 25 * 60 * 1000),
  },
  {
    id: 2,
    type: "info",
    message: "Manager approved overtime for Vikram Rao",
    timestamp: new Date(Date.now() - 70 * 60 * 1000),
  },
  {
    id: 3,
    type: "warning",
    message: "Priya Sharma attempted access outside shift",
    timestamp: new Date(Date.now() - 2.5 * 3600 * 1000),
  },
];

export const employeeMeta = {
  "Ravi Kumar": {
    department: "Engineering",
    manager: "Arjun",
    activity: "Pushed code to Feature-Login · 12m ago",
  },
  "Priya Sharma": {
    department: "Engineering",
    manager: "Arjun",
    activity: "Opened workspace Feature-Payment · 1h ago",
  },
  Arjun: {
    department: "Leadership",
    manager: "—",
    activity: "Approved 2 overtime requests · 4h ago",
  },
};

export const defaultSettings = {
  companyName: "TechNova Solutions",
  notifications: true,
  autoScale: true,
  enginePaused: false,
  idleTimeout: 30,
  region: "ap-south-1",
  accent: "cyan",
};

export const seedSavings = {
  today: 1240,
  week: 8450,
  month: 31200,
  year: 148000,
  total: 18430,
};

export function buildSavingsTrend(total) {
  const now = Date.now();
  return Array.from({ length: 24 }, (_, i) => ({
    time: formatHour(new Date(now - (23 - i) * 3600 * 1000)),
    total: Math.max(400, total - Math.round((23 - i) * 145)),
  }));
}
