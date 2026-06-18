import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  User,
  Sample,
  Batch,
  AuditEntry,
  ExportConfig,
  SampleTemplate,
  ImportDraft,
  ImportUndoRecord,
  ImportNotification,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

export interface Database {
  users: User[];
  samples: Sample[];
  batches: Batch[];
  audits: AuditEntry[];
  exportConfigs: ExportConfig[];
  sampleTemplates: SampleTemplate[];
  importDrafts: ImportDraft[];
  importUndoRecords: ImportUndoRecord[];
  importNotifications: ImportNotification[];
  initialized: boolean;
}

const DEFAULT_USERS: User[] = [
  {
    id: 'user-sampler-001',
    username: 'sampler1',
    password: 'sampler123',
    role: 'SAMPLER',
    name: '张采样',
    department: '采样部',
  },
  {
    id: 'user-sampler-002',
    username: 'sampler2',
    password: 'sampler123',
    role: 'SAMPLER',
    name: '李采样',
    department: '采样部',
  },
  {
    id: 'user-receiver-001',
    username: 'receiver1',
    password: 'receiver123',
    role: 'RECEIVER',
    name: '王接收',
    department: '检验科',
  },
  {
    id: 'user-receiver-002',
    username: 'receiver2',
    password: 'receiver123',
    role: 'RECEIVER',
    name: '赵接收',
    department: '检验科',
  },
  {
    id: 'user-admin-001',
    username: 'admin1',
    password: 'admin123',
    role: 'ADMIN',
    name: '孙管理',
    department: '质量管理部',
  },
];

function getDbPath(): string {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  return path.join(DATA_DIR, 'db.json');
}

function createInitialDb(): Database {
  return {
    users: [...DEFAULT_USERS],
    samples: [],
    batches: [],
    audits: [],
    exportConfigs: [],
    sampleTemplates: [],
    importDrafts: [],
    importUndoRecords: [],
    importNotifications: [],
    initialized: true,
  };
}

export function loadDb(): Database {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    const initialDb = createInitialDb();
    saveDb(initialDb);
    return initialDb;
  }
  try {
    const raw = fs.readFileSync(dbPath, 'utf-8');
    const db = JSON.parse(raw) as Database;
    if (!db.initialized) {
      return createInitialDb();
    }
    if (!db.exportConfigs) db.exportConfigs = [];
    if (!db.sampleTemplates) db.sampleTemplates = [];
    if (!db.importDrafts) db.importDrafts = [];
    if (!db.importUndoRecords) db.importUndoRecords = [];
    if (!db.importNotifications) db.importNotifications = [];
    for (const n of db.importNotifications) {
      if (!n.readBy) n.readBy = {};
    }
    return db;
  } catch (e) {
    console.error('Failed to load DB, creating new one:', e);
    const newDb = createInitialDb();
    saveDb(newDb);
    return newDb;
  }
}

export function saveDb(db: Database): void {
  const dbPath = getDbPath();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
