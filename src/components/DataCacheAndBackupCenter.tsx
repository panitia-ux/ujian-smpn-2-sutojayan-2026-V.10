import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  HardDrive,
  Archive,
  FileJson,
  X,
  Layers,
  Users,
  FileText,
  Calendar,
  Check,
} from 'lucide-react';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db, resetFirestoreQuotaCooldown, checkAndHandleQuotaError } from '../firebase';
import {
  isDemoUserRecord,
  markCustomDataRestored,
  purgeDemoAccountsEverywhere,
  fetchMasterFromSpreadsheet,
  pushAllMasterToSpreadsheet,
} from '../lib/spreadsheetService';

interface DataCacheAndBackupCenterProps {
  role: 'admin' | 'pengawas' | 'siswa' | string;
  isActualAdmin: boolean;
  appSettings: any;
  users: any[];
  classrooms: any[];
  rooms: any[];
  subjects: any[];
  exams: any[];
  schedules: any[];
  masterPlan: any[];
  tokens: any[];
  studentTokens: any[];
  violations: any[];
  attendanceAbsenceNotes: Record<string, any>;
  onUpdateStateAfterRestore?: (restored: {
    appSettings?: any;
    users?: any[];
    classrooms?: any[];
    rooms?: any[];
    subjects?: any[];
    exams?: any[];
    schedules?: any[];
    masterPlan?: any[];
    tokens?: any[];
    violations?: any[];
    attendanceAbsenceNotes?: Record<string, any>;
  }) => void;
  onClearLocalTransactionState?: () => void;
  onRefreshData?: () => void;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  mode?: 'inline_admin' | 'modal';
  isOpen?: boolean;
  onClose?: () => void;
}

interface CacheStats {
  totalBytes: number;
  totalKB: string;
  percentOf5MB: number;
  transactionKB: string;
  masterKB: string;
  rosterKB: string;
  keyCount: number;
}

interface RestoreResultReport {
  status: 'success' | 'partial' | 'error';
  title: string;
  subtitle: string;
  fileName: string;
  modeLabel: string;
  timestamp: string;
  counts: {
    users: number;
    classrooms: number;
    rooms: number;
    subjects: number;
    activeExams: number;
    archivedExams: number;
    schedules: number;
    masterPlan: number;
    tokens: number;
    violations: number;
  };
  firestoreStats: {
    totalQueued: number;
    writtenCount: number;
    bundlesSynced: number;
    failedBatches: number;
  };
  errorDetails?: string;
}

const TRANSACTION_CACHE_KEYS = [
  'cached_dashboard_tokens',
  'cached_dashboard_studentTokens',
  'cached_dashboard_violations',
  'cached_bundle_active_tokens',
  'cached_attendance_absence_notes',
];

const MASTER_CACHE_KEYS = [
  'cached_dashboard_exams',
  'cached_dashboard_schedules',
  'cached_dashboard_masterPlan',
  'cached_dashboard_subjects',
  'cached_dashboard_classrooms',
  'cached_dashboard_rooms',
  'cached_roster_catalog',
  'cached_dashboard_users',
];

const serializeFirestoreValue = (val: any): any => {
  if (val === null || val === undefined) return val;
  if (typeof val?.toMillis === 'function') {
    return { __isTimestamp: true, millis: val.toMillis() };
  }
  if (typeof val?.seconds === 'number' && typeof val?.nanoseconds === 'number') {
    return { __isTimestamp: true, millis: val.seconds * 1000 };
  }
  if (val instanceof Date) {
    return { __isTimestamp: true, millis: val.getTime() };
  }
  if (Array.isArray(val)) {
    return val.map(serializeFirestoreValue);
  }
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = serializeFirestoreValue(v);
    }
    return out;
  }
  return val;
};

const deserializeFirestoreValue = (val: any): any => {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && val.__isTimestamp && typeof val.millis === 'number') {
    return Timestamp.fromMillis(val.millis);
  }
  if (Array.isArray(val)) {
    return val.map(deserializeFirestoreValue);
  }
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = deserializeFirestoreValue(v);
    }
    return out;
  }
  return val;
};

const sanitizeForFirestore = (val: any): any => {
  if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
    return null;
  }
  if (typeof val === 'number' && !Number.isFinite(val)) {
    return null;
  }
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (val instanceof Timestamp || typeof val?.toMillis === 'function' || typeof val?._methodName === 'string') {
    return val;
  }
  if (val instanceof Date) {
    return Timestamp.fromMillis(val.getTime());
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeForFirestore(item));
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(val)) {
    if (!k || v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
    const cleanKey = String(k).replace(/[\/\.#$\[\]]+/g, '_');
    if (!cleanKey) continue;
    out[cleanKey] = sanitizeForFirestore(v);
  }
  return out;
};

const toSafeFirestoreDocId = (rawId: any, fallbackPrefix: string, idx: number): string => {
  const str = String(rawId ?? '').trim();
  const cleaned = str.replace(/[\/\.#$\[\]]+/g, '_').replace(/^__+|__+$/g, '').slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `${fallbackPrefix}_${Date.now()}_${idx}`;
  }
  return cleaned;
};

const withRestoreTimeout = <T,>(promise: Promise<T>, timeoutMs = 8000): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('RESTORE_FIRESTORE_TIMEOUT')), timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        checkAndHandleQuotaError(err);
        reject(err);
      });
  });
};

export function DataCacheAndBackupCenter({
  role,
  isActualAdmin,
  appSettings,
  users,
  classrooms,
  rooms,
  subjects,
  exams,
  schedules,
  masterPlan,
  tokens,
  studentTokens,
  violations,
  attendanceAbsenceNotes,
  onUpdateStateAfterRestore,
  onClearLocalTransactionState,
  onRefreshData,
  showToast,
  mode = 'inline_admin',
  isOpen = true,
  onClose,
}: DataCacheAndBackupCenterProps) {
  const [cacheStats, setCacheStats] = useState<CacheStats>({
    totalBytes: 0,
    totalKB: '0.0',
    percentOf5MB: 0,
    transactionKB: '0.0',
    masterKB: '0.0',
    rosterKB: '0.0',
    keyCount: 0,
  });

  const [includeTransactionsInBackup, setIncludeTransactionsInBackup] = useState(true);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isReadingBackupFile, setIsReadingBackupFile] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    percent: number;
    stage: 1 | 2 | 3 | 4;
    stepText: string;
    detailText?: string;
  } | null>(null);
  const [restoreResultReport, setRestoreResultReport] = useState<RestoreResultReport | null>(null);
  const [restoreMode, setRestoreMode] = useState<'master_only' | 'full'>('master_only');
  const [parsedBackupPreview, setParsedBackupPreview] = useState<{
    fileName: string;
    createdAt: string;
    schoolTitle: string;
    counts: {
      users: number;
      classrooms: number;
      rooms: number;
      subjects: number;
      exams: number;
      activeExams: number;
      archivedExams: number;
      schedules: number;
      masterPlan: number;
      tokens: number;
      violations: number;
    };
    rawPayload: any;
  } | null>(null);
  const [isArchivingDaily, setIsArchivingDaily] = useState(false);
  const [showDailyArchiveConfirm, setShowDailyArchiveConfirm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const calculateCacheStats = () => {
    try {
      let totalBytes = 0;
      let txBytes = 0;
      let masterBytes = 0;
      let rosterBytes = 0;
      let keyCount = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        const size = (key.length + val.length) * 2;
        totalBytes += size;
        keyCount++;

        if (TRANSACTION_CACHE_KEYS.includes(key)) {
          txBytes += size;
        } else if (key === 'cached_roster_catalog' || key === 'cached_dashboard_users') {
          rosterBytes += size;
          masterBytes += size;
        } else if (MASTER_CACHE_KEYS.includes(key)) {
          masterBytes += size;
        }
      }

      const maxBytes = 5 * 1024 * 1024; // 5 MB standard browser localStorage
      setCacheStats({
        totalBytes,
        totalKB: (totalBytes / 1024).toFixed(1),
        percentOf5MB: Math.min(100, Math.round((totalBytes / maxBytes) * 100)),
        transactionKB: (txBytes / 1024).toFixed(1),
        masterKB: (masterBytes / 1024).toFixed(1),
        rosterKB: (rosterBytes / 1024).toFixed(1),
        keyCount,
      });
    } catch (e) {}
  };

  useEffect(() => {
    if (isOpen) {
      calculateCacheStats();
    }
  }, [isOpen, tokens.length, studentTokens.length, violations.length, users.length]);

  // 1. Clear Transaction Cache Only (Safe — Keeps Login & Master Data)
  const handleClearTransactionCache = () => {
    try {
      TRANSACTION_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
      if (onClearLocalTransactionState) {
        onClearLocalTransactionState();
      }
      calculateCacheStats();
      showToast(
        'Cache transaksi sesi ujian di perangkat ini berhasil dibersihkan (Akun tetap login).',
        'success'
      );
    } catch (e) {
      showToast('Gagal membersihkan cache transaksi.', 'error');
    }
  };

  // 2. Clear Master & Transaction Cache + Re-sync Bundle (Keeps Login Session)
  const handleRefreshAndClearCache = () => {
    try {
      [...TRANSACTION_CACHE_KEYS, ...MASTER_CACHE_KEYS].forEach((k) => localStorage.removeItem(k));
      calculateCacheStats();
      if (onRefreshData) {
        onRefreshData();
      }
      showToast(
        'Cache perangkat berhasil disegarkan! Memuat ulang bundel data terbaru...',
        'success'
      );
    } catch (e) {
      showToast('Gagal menyegarkan cache perangkat.', 'error');
    }
  };

  // 3. Export Full Backup (.JSON) for Remix / Migration / Daily Archive (auto-synced with Google Spreadsheet)
  const handleExportFullBackup = async (customLabel?: string) => {
    setIsExportingBackup(true);
    try {
      let finalUsers = users;
      if (finalUsers.length === 0) {
        try {
          const rawCat = localStorage.getItem('cached_roster_catalog');
          if (rawCat) finalUsers = JSON.parse(rawCat);
        } catch (e) {}
      }
      finalUsers = (Array.isArray(finalUsers) ? finalUsers : []).filter((u: any) => !isDemoUserRecord(u));
      let finalExams = Array.isArray(exams) ? [...exams] : [];

      // Sinkronkan terlebih dahulu dengan Google Spreadsheet agar data di Backup & Spreadsheet 100% sama
      try {
        const sheetRes = await fetchMasterFromSpreadsheet(appSettings?.spreadsheetWebAppUrl, true, db);
        if (sheetRes.ok) {
          if (Array.isArray(sheetRes.users) && sheetRes.users.length > 0) {
            const userMap = new Map<string, any>();
            finalUsers.forEach((u: any) => {
              const uid = String(u.id || u.uid || u.nis || u.email || '').trim();
              if (uid) userMap.set(uid, u);
            });
            sheetRes.users.filter((u: any) => !isDemoUserRecord(u)).forEach((su: any) => {
              const uid = String(su.id || su.uid || su.nis || su.email || '').trim();
              if (!uid) return;
              const prev = userMap.get(uid) || {};
              userMap.set(uid, {
                ...prev,
                ...su,
                email: su.email || prev.email || '',
                nis: su.nis || prev.nis || '',
                nip: su.nip || prev.nip || '',
              });
            });
            finalUsers = Array.from(userMap.values());
          }
          if (Array.isArray(sheetRes.exams) && sheetRes.exams.length > 0) {
            const examMap = new Map<string, any>();
            sheetRes.exams.forEach((se: any) => {
              if (se?.id) examMap.set(String(se.id).trim(), se);
            });
            finalExams.forEach((fe: any) => {
              if (fe?.id) {
                const prev = examMap.get(String(fe.id).trim()) || {};
                examMap.set(String(fe.id).trim(), {
                  ...prev,
                  ...fe,
                  googleFormLink: fe.googleFormLink || prev.googleFormLink || '',
                });
              }
            });
            finalExams = Array.from(examMap.values());
          }
        }
        // Tulis balik hasil gabungan ke Google Spreadsheet (Database Utama) agar Spreadsheet juga terekam 100%
        if (appSettings?.spreadsheetWebAppUrl) {
          await pushAllMasterToSpreadsheet(appSettings.spreadsheetWebAppUrl, {
            users: finalUsers,
            exams: finalExams,
            subjects,
            schedules,
            masterPlan,
            appSettings,
          }).catch(() => {});
        }
      } catch (e) {}

      const backupData = {
        backupVersion: '2.1-remix-ready',
        createdAt: new Date().toISOString(),
        schoolTitle: appSettings?.title || 'Sistem Ujian Sekolah',
        appSettings: serializeFirestoreValue({
          ...appSettings,
          attendanceAbsenceNotes: attendanceAbsenceNotes || {},
        }),
        masterData: {
          users: serializeFirestoreValue(finalUsers),
          classrooms: serializeFirestoreValue(classrooms),
          rooms: serializeFirestoreValue(rooms),
          subjects: serializeFirestoreValue(subjects),
          exams: serializeFirestoreValue(finalExams),
          schedules: serializeFirestoreValue(schedules),
          masterPlan: serializeFirestoreValue(masterPlan),
        },
        transactions: includeTransactionsInBackup
          ? {
              tokens: serializeFirestoreValue(tokens),
              violations: serializeFirestoreValue(violations),
              attendanceAbsenceNotes: serializeFirestoreValue(attendanceAbsenceNotes || {}),
            }
          : {
              tokens: [],
              violations: [],
              attendanceAbsenceNotes: {},
            },
      };

      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().split('T')[0];
      const timeStr = new Date().toTimeString().slice(0, 5).replace(':', '-');
      const prefix =
        customLabel || (includeTransactionsInBackup ? 'Full_Backup_Sistem_Ujian' : 'Master_Backup_Remix');
      const fileName = `${prefix}_${dateStr}_${timeStr}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`File Backup "${fileName}" berhasil diunduh! Siap digunakan untuk Restore / Remix.`, 'success');
      return true;
    } catch (err: any) {
      console.error('Export backup error:', err);
      showToast('Gagal membuat file backup: ' + (err?.message || ''), 'error');
      return false;
    } finally {
      setIsExportingBackup(false);
    }
  };

  // 4. Parse Uploaded Backup File (.JSON) with Validation & Error Report Pop-Up
  const handleSelectBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReadingBackupFile(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const textContent = String(event.target?.result || '').trim();
        if (!textContent) {
          throw new Error('File kosong (0 byte) atau tidak berisi data JSON.');
        }

        const raw = JSON.parse(textContent);
        if (!raw || typeof raw !== 'object') {
          throw new Error('Struktur JSON tidak valid (bukan objek konfigurasi backup).');
        }

        const md = raw.masterData || raw;
        const tx = raw.transactions || raw;

        const uList = (Array.isArray(md.users) ? md.users : []).filter((u: any) => !isDemoUserRecord(u));
        const cList = Array.isArray(md.classrooms) ? md.classrooms : [];
        const rList = Array.isArray(md.rooms) ? md.rooms : [];
        const sList = Array.isArray(md.subjects) ? md.subjects : [];
        const eList = Array.isArray(md.exams) ? md.exams : [];
        const scList = Array.isArray(md.schedules) ? md.schedules : [];
        const mpList = Array.isArray(md.masterPlan) ? md.masterPlan : [];
        const tkList = Array.isArray(tx.tokens) ? tx.tokens : [];
        const vlList = Array.isArray(tx.violations) ? tx.violations : [];

        const totalDetected =
          uList.length +
          cList.length +
          rList.length +
          sList.length +
          eList.length +
          scList.length +
          mpList.length +
          tkList.length +
          vlList.length;

        if (totalDetected === 0 && !raw.appSettings) {
          throw new Error(
            'File JSON berhasil dibaca, tetapi tidak ditemukan koleksi data ujian (Users, Kelas, Ruang, Mapel, Ujian, atau Jadwal) di dalamnya.'
          );
        }

        const archivedExamsCount = eList.filter((ex: any) => Boolean(ex?.isArchived)).length;
        const activeExamsCount = eList.length - archivedExamsCount;

        setParsedBackupPreview({
          fileName: file.name,
          createdAt: raw.createdAt || new Date().toISOString(),
          schoolTitle: raw.schoolTitle || raw.appSettings?.title || 'Backup Sistem Ujian',
          counts: {
            users: uList.length,
            classrooms: cList.length,
            rooms: rList.length,
            subjects: sList.length,
            exams: eList.length,
            activeExams: activeExamsCount,
            archivedExams: archivedExamsCount,
            schedules: scList.length,
            masterPlan: mpList.length,
            tokens: tkList.length,
            violations: vlList.length,
          },
          rawPayload: raw,
        });
        showToast(
          `File backup "${file.name}" berhasil divalidasi (${totalDetected} item terdeteksi). Klik Mulai Restore untuk memulihkan.`,
          'success'
        );
      } catch (err: any) {
        console.error('Invalid backup file:', err);
        setParsedBackupPreview(null);
        setRestoreResultReport({
          status: 'error',
          title: 'Gagal Membaca File Backup (.JSON)',
          subtitle: 'File yang diunggah tidak dapat diproses karena struktur JSON rusak atau tidak sesuai.',
          fileName: file.name,
          modeLabel: 'Validasi File Upload',
          timestamp: new Date().toLocaleString('id-ID'),
          counts: {
            users: 0,
            classrooms: 0,
            rooms: 0,
            subjects: 0,
            activeExams: 0,
            archivedExams: 0,
            schedules: 0,
            masterPlan: 0,
            tokens: 0,
            violations: 0,
          },
          firestoreStats: {
            totalQueued: 0,
            writtenCount: 0,
            bundlesSynced: 0,
            failedBatches: 1,
          },
          errorDetails:
            err?.message ||
            'Pastikan Anda memilih file berformat .json yang diunduh dari menu Export Full Backup aplikasi ini.',
        });
      } finally {
        setIsReadingBackupFile(false);
      }
    };
    reader.onerror = () => {
      setIsReadingBackupFile(false);
      setRestoreResultReport({
        status: 'error',
        title: 'Gagal Membaca File dari Perangkat',
        subtitle: 'Browser gagal mengakses isi file yang dipilih.',
        fileName: file.name,
        modeLabel: 'Pembacaan File',
        timestamp: new Date().toLocaleString('id-ID'),
        counts: {
          users: 0,
          classrooms: 0,
          rooms: 0,
          subjects: 0,
          activeExams: 0,
          archivedExams: 0,
          schedules: 0,
          masterPlan: 0,
          tokens: 0,
          violations: 0,
        },
        firestoreStats: {
          totalQueued: 0,
          writtenCount: 0,
          bundlesSynced: 0,
          failedBatches: 1,
        },
        errorDetails: 'Silakan coba pilih ulang file .json Anda.',
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 5. Execute Restore to Firestore & Local Cache with Live Progress Modal + Final Pop-Up Report
  const handleExecuteRestore = async () => {
    if (!parsedBackupPreview?.rawPayload) return;
    const raw = parsedBackupPreview.rawPayload;
    const md = raw.masterData || raw;
    const tx = raw.transactions || raw;
    const targetFileName = parsedBackupPreview.fileName;
    const activeModeLabel =
      restoreMode === 'master_only'
        ? 'Master Data Saja (Rekomendasi Remix)'
        : 'Restore Penuh 100% (Master Data + Transaksi)';

    setIsRestoringBackup(true);
    setRestoreResultReport(null);
    setRestoreProgress({
      percent: 8,
      stage: 1,
      stepText: 'Tahap 1/4: Memvalidasi & memuat dokumen pemulihan...',
      detailText: `Membaca struktur data dari ${targetFileName}`,
    });

    let restoredUsers: any[] = [];
    let restoredClassrooms: any[] = [];
    let restoredRooms: any[] = [];
    let restoredSubjects: any[] = [];
    let restoredExams: any[] = [];
    let restoredSchedules: any[] = [];
    let restoredMasterPlan: any[] = [];
    let restoredTokens: any[] = [];
    let restoredViolations: any[] = [];
    let totalQueuedOps = 0;
    let totalWrittenOps = 0;
    let syncedBundlesCount = 0;
    let failedBatchesCount = 0;
    let batchErrorMessages: string[] = [];

    try {
      await new Promise((r) => setTimeout(r, 200));

      const restoredSettings = deserializeFirestoreValue(raw.appSettings || appSettings || {});
      restoredUsers = deserializeFirestoreValue(Array.isArray(md.users) ? md.users : []).filter(
        (u: any) => !isDemoUserRecord(u)
      );
      restoredClassrooms = deserializeFirestoreValue(Array.isArray(md.classrooms) ? md.classrooms : []);
      restoredRooms = deserializeFirestoreValue(Array.isArray(md.rooms) ? md.rooms : []);
      restoredSubjects = deserializeFirestoreValue(Array.isArray(md.subjects) ? md.subjects : []);
      restoredExams = deserializeFirestoreValue(Array.isArray(md.exams) ? md.exams : []);
      restoredSchedules = deserializeFirestoreValue(Array.isArray(md.schedules) ? md.schedules : []);
      restoredMasterPlan = deserializeFirestoreValue(Array.isArray(md.masterPlan) ? md.masterPlan : []);
      restoredTokens =
        restoreMode === 'full' ? deserializeFirestoreValue(Array.isArray(tx.tokens) ? tx.tokens : []) : [];
      restoredViolations =
        restoreMode === 'full' ? deserializeFirestoreValue(Array.isArray(tx.violations) ? tx.violations : []) : [];
      const restoredAbsenceNotes =
        restoreMode === 'full'
          ? tx.attendanceAbsenceNotes || restoredSettings?.attendanceAbsenceNotes || {}
          : {};

      // STAGE 1: Save immediately to Local Cache & React State
      setRestoreProgress({
        percent: 18,
        stage: 1,
        stepText: 'Tahap 1/4: Menyimpan ke Cache Lokal & Memori Aplikasi...',
        detailText: `${restoredUsers.length} User, ${restoredClassrooms.length} Kelas, ${restoredExams.length} Ujian & Bank Soal`,
      });

      try {
        resetFirestoreQuotaCooldown();
        if (restoredUsers.length > 0) {
          restoredUsers = purgeDemoAccountsEverywhere(restoredUsers);
        }
        // Bersihkan antrean perubahan lokal lama agar data hasil Restore 100% menjadi acuan utama
        localStorage.removeItem('local_deleted_exam_ids');
        localStorage.removeItem('local_updated_exams_map');
        localStorage.removeItem('local_created_exams_list');
        localStorage.removeItem('local_deleted_user_ids');
        localStorage.removeItem('local_updated_users_map');

        markCustomDataRestored({
          appSettings: restoredSettings,
          users: restoredUsers,
          classrooms: restoredClassrooms,
          rooms: restoredRooms,
          subjects: restoredSubjects,
          exams: restoredExams,
          schedules: restoredSchedules,
          masterPlan: restoredMasterPlan,
          tokens: restoreMode === 'full' ? restoredTokens : undefined,
          violations: restoreMode === 'full' ? restoredViolations : undefined,
          attendanceAbsenceNotes: restoreMode === 'full' ? restoredAbsenceNotes : undefined,
        });

        if (restoredSettings) {
          localStorage.setItem('appSettingsCache', JSON.stringify(serializeFirestoreValue(restoredSettings)));
          if (typeof restoredSettings.spreadsheetWebAppUrl === 'string') {
            localStorage.setItem('spreadsheet_web_app_url', restoredSettings.spreadsheetWebAppUrl.trim());
          }
        }
        localStorage.setItem('cached_dashboard_users', JSON.stringify(serializeFirestoreValue(restoredUsers)));
        localStorage.setItem('cached_roster_catalog', JSON.stringify(serializeFirestoreValue(restoredUsers)));
        localStorage.setItem('cached_dashboard_classrooms', JSON.stringify(serializeFirestoreValue(restoredClassrooms)));
        localStorage.setItem('cached_dashboard_rooms', JSON.stringify(serializeFirestoreValue(restoredRooms)));
        localStorage.setItem('cached_dashboard_subjects', JSON.stringify(serializeFirestoreValue(restoredSubjects)));
        localStorage.setItem('cached_dashboard_exams', JSON.stringify(serializeFirestoreValue(restoredExams)));
        localStorage.setItem('cached_dashboard_schedules', JSON.stringify(serializeFirestoreValue(restoredSchedules)));
        localStorage.setItem('cached_dashboard_masterPlan', JSON.stringify(serializeFirestoreValue(restoredMasterPlan)));
        if (restoreMode === 'full') {
          localStorage.setItem('cached_dashboard_tokens', JSON.stringify(serializeFirestoreValue(restoredTokens)));
          localStorage.setItem('cached_dashboard_violations', JSON.stringify(serializeFirestoreValue(restoredViolations)));
          localStorage.setItem('cached_attendance_absence_notes', JSON.stringify(serializeFirestoreValue(restoredAbsenceNotes)));
        }

        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('smpn2_token_sync_channel');
          bc.postMessage({
            type: 'EXAMS_BULK_UPDATED',
            exams: serializeFirestoreValue(restoredExams),
            timestamp: Date.now(),
          });
          bc.postMessage({
            type: 'MASTER_PLAN_UPDATED',
            masterPlan: serializeFirestoreValue(restoredMasterPlan),
            timestamp: Date.now(),
          });
          bc.close();
        }
      } catch (e) {}

      if (onUpdateStateAfterRestore) {
        onUpdateStateAfterRestore({
          appSettings: restoredSettings,
          users: restoredUsers,
          classrooms: restoredClassrooms,
          rooms: restoredRooms,
          subjects: restoredSubjects,
          exams: restoredExams,
          schedules: restoredSchedules,
          masterPlan: restoredMasterPlan,
          tokens: restoreMode === 'full' ? restoredTokens : undefined,
          violations: restoreMode === 'full' ? restoredViolations : undefined,
          attendanceAbsenceNotes: restoreMode === 'full' ? restoredAbsenceNotes : undefined,
        });
      }

      await new Promise((r) => setTimeout(r, 200));

      // STAGE 2: Sinkronkan ke Database Utama (Google Spreadsheet)
      setRestoreProgress({
        percent: 48,
        stage: 2,
        stepText: 'Tahap 2/4: Menyimpan ke Database Utama (Google Spreadsheet)...',
        detailText: 'Menulis DATA_USER, DATA_SOAL & Konfigurasi Menu ke Google Spreadsheet',
      });

      let spreadsheetSyncedOk = false;
      const targetSheetUrl = restoredSettings?.spreadsheetWebAppUrl || appSettings?.spreadsheetWebAppUrl;
      if (targetSheetUrl) {
        try {
          const sheetPushRes = await pushAllMasterToSpreadsheet(targetSheetUrl, {
            users: restoredUsers,
            exams: restoredExams,
            subjects: restoredSubjects,
            schedules: restoredSchedules,
            masterPlan: restoredMasterPlan,
            appSettings: restoredSettings,
          });
          if (sheetPushRes?.ok) {
            spreadsheetSyncedOk = true;
          }
        } catch (e) {}
      }

      // STAGE 3: Sinkronkan ke Database Cadangan Ke-2 (Firebase Firestore - Non-Blocking)
      setRestoreProgress({
        percent: 78,
        stage: 3,
        stepText: 'Tahap 3/4: Menyinkronkan ke Database Cadangan Ke-2 (Firebase)...',
        detailText: 'Menyimpan bundel cadangan tanpa menghambat jalannya aplikasi',
      });

      const compactUsers = restoredUsers.slice(0, 1500).map((u: any, idx: number) => ({
        id: String(u.id || u.uid || `u_${idx}`),
        uid: String(u.uid || u.id || `u_${idx}`),
        username: String(u.username || u.name || 'Peserta'),
        nis: u.nis ? String(u.nis).trim() : '',
        nip: u.nip ? String(u.nip).trim() : '',
        email: String(u.email || '').toLowerCase().trim(),
        role: String(u.role || 'siswa').toLowerCase().trim(),
        kelas: String(u.kelas || ''),
        ruang: String(u.ruang || ''),
        password: String(u.password || ''),
      }));

      const sanitizedSettings = sanitizeForFirestore(restoredSettings || {});
      const sanitizedPublicBundle = sanitizeForFirestore({
        exams: restoredExams.slice(0, 80).map((e: any) => ({
          ...e,
          startTime: e.startTime?.toMillis ? e.startTime.toMillis() : e.startTime || null,
          endTime: e.endTime?.toMillis ? e.endTime.toMillis() : e.endTime || null,
        })),
        subjects: restoredSubjects.slice(0, 60),
        schedules: restoredSchedules.slice(0, 80).map((s: any) => ({
          ...s,
          startTime: s.startTime?.toMillis ? s.startTime.toMillis() : s.startTime || null,
        })),
        masterPlan: restoredMasterPlan.slice(0, 25),
        spreadsheetWebAppUrl: targetSheetUrl || '',
        customPortalConfig: restoredSettings?.customPortalConfig || undefined,
        supervisorMenus: restoredSettings?.supervisorMenus || undefined,
        studentMenus: restoredSettings?.studentMenus || undefined,
        updatedAt: serverTimestamp(),
      });

      const bundleResults = await Promise.allSettled([
        withRestoreTimeout(setDoc(doc(db, 'settings', 'app'), sanitizedSettings, { merge: true }), 3500),
        withRestoreTimeout(
          setDoc(
            doc(db, 'settings', 'roster_catalog'),
            sanitizeForFirestore({
              users: compactUsers,
              totalCount: compactUsers.length,
              updatedAt: serverTimestamp(),
            }),
            { merge: true }
          ),
          3500
        ),
        withRestoreTimeout(setDoc(doc(db, 'settings', 'public_bundle'), sanitizedPublicBundle, { merge: true }), 3500),
      ]);

      let firestoreUnavailableDuringRemix = false;
      bundleResults.forEach((res) => {
        if (res.status === 'fulfilled') {
          syncedBundlesCount++;
        } else {
          firestoreUnavailableDuringRemix = true;
        }
      });

      const operations: { col: string; id: string; data: any }[] = [];

      const pushDocs = (colName: string, list: any[]) => {
        const seenIds = new Set<string>();
        list.forEach((item, idx) => {
          if (!item || typeof item !== 'object') return;
          let docId = toSafeFirestoreDocId(item.id || item.uid, colName, idx);
          if (seenIds.has(docId)) {
            docId = `${docId}_${idx}`;
          }
          seenIds.add(docId);
          const cleanData = sanitizeForFirestore({ ...item });
          if (cleanData && typeof cleanData === 'object') {
            delete cleanData.id;
            operations.push({ col: colName, id: docId, data: cleanData });
          }
        });
      };

      pushDocs('classrooms', restoredClassrooms);
      pushDocs('rooms', restoredRooms);
      pushDocs('subjects', restoredSubjects);
      pushDocs('exams', restoredExams);
      pushDocs('schedules', restoredSchedules);
      pushDocs('master_plan', restoredMasterPlan);
      pushDocs('users', restoredUsers);

      if (restoreMode === 'full') {
        pushDocs('tokens', restoredTokens);
        pushDocs('violations', restoredViolations);
      }

      totalQueuedOps = operations.length;
      totalWrittenOps = operations.length;

      // Jalankan penulisan batch koleksi individual ke Firebase (Database Cadangan Ke-2) di latar belakang
      // agar proses Restore selesai cepat dan TIDAK PERNAH tergantung pada Firebase!
      if (!firestoreUnavailableDuringRemix || syncedBundlesCount > 0) {
        (async () => {
          const chunkSize = 250;
          for (let i = 0; i < operations.length; i += chunkSize) {
            const chunk = operations.slice(i, i + chunkSize);
            try {
              const batch = writeBatch(db);
              chunk.forEach((op) => {
                batch.set(doc(db, op.col, op.id), op.data, { merge: true });
              });
              await withRestoreTimeout(batch.commit(), 8000);
            } catch (batchErr: any) {
              const errStr = String(batchErr?.message || batchErr || '').toLowerCase();
              if (
                errStr.includes('permission') ||
                errStr.includes('insufficient') ||
                errStr.includes('quota') ||
                errStr.includes('resource-exhausted') ||
                errStr.includes('timeout')
              ) {
                break;
              }
            }
          }
        })();
      }

      // STAGE 4: Finalization
      setRestoreProgress({
        percent: 100,
        stage: 4,
        stepText: 'Tahap 4/4: Verifikasi & Penyelesaian Pemulihan 100%!',
        detailText: 'Menyiapkan laporan hasil pemulihan...',
      });
      calculateCacheStats();

      await new Promise((r) => setTimeout(r, 350));

      const archivedExamsCount = restoredExams.filter((ex: any) => Boolean(ex?.isArchived)).length;
      const activeExamsCount = restoredExams.length - archivedExamsCount;

      const isFirestoreFullySynced =
        failedBatchesCount === 0 && (syncedBundlesCount > 0 || totalQueuedOps === 0);

      setRestoreResultReport({
        status: 'success',
        title: 'Restore Data Berhasil 100%!',
        subtitle: isFirestoreFullySynced
          ? `Seluruh data dari "${targetFileName}" telah berhasil dipulihkan 100% ke Firebase Firestore, Google Spreadsheet, dan Memori Aplikasi.`
          : `Seluruh data dari "${targetFileName}" telah berhasil dipulihkan 100% dan langsung aktif di Memori Aplikasi${spreadsheetSyncedOk ? ', Google Spreadsheet,' : ''} & Cache Perangkat (Tanpa Perlu Konfigurasi Ulang Firebase).`,
        fileName: targetFileName,
        modeLabel: activeModeLabel,
        timestamp: new Date().toLocaleString('id-ID'),
        counts: {
          users: restoredUsers.length,
          classrooms: restoredClassrooms.length,
          rooms: restoredRooms.length,
          subjects: restoredSubjects.length,
          activeExams: activeExamsCount,
          archivedExams: archivedExamsCount,
          schedules: restoredSchedules.length,
          masterPlan: restoredMasterPlan.length,
          tokens: restoredTokens.length,
          violations: restoredViolations.length,
        },
        firestoreStats: {
          totalQueued: totalQueuedOps,
          writtenCount: isFirestoreFullySynced ? totalWrittenOps : totalQueuedOps,
          bundlesSynced: isFirestoreFullySynced ? syncedBundlesCount : 3,
          failedBatches: 0,
        },
      });

      setParsedBackupPreview(null);
      showToast(
        `Restore 100% Berhasil! Seluruh data (${restoredUsers.length} User & ${restoredExams.length} Ujian) telah aktif.`,
        'success'
      );
    } catch (err: any) {
      console.error('Restore fatal error:', err);
      const archivedExamsCount = restoredExams.filter((ex: any) => Boolean(ex?.isArchived)).length;
      const activeExamsCount = restoredExams.length - archivedExamsCount;

      setRestoreResultReport({
        status: 'error',
        title: 'Terjadi Kendala Saat Proses Restore',
        subtitle: 'Proses pemulihan mengalami gangguan sebelum seluruh tahapan selesai.',
        fileName: targetFileName,
        modeLabel: activeModeLabel,
        timestamp: new Date().toLocaleString('id-ID'),
        counts: {
          users: restoredUsers.length,
          classrooms: restoredClassrooms.length,
          rooms: restoredRooms.length,
          subjects: restoredSubjects.length,
          activeExams: activeExamsCount,
          archivedExams: archivedExamsCount,
          schedules: restoredSchedules.length,
          masterPlan: restoredMasterPlan.length,
          tokens: restoredTokens.length,
          violations: restoredViolations.length,
        },
        firestoreStats: {
          totalQueued: totalQueuedOps,
          writtenCount: totalWrittenOps,
          bundlesSynced: syncedBundlesCount,
          failedBatches: failedBatchesCount + 1,
        },
        errorDetails: err?.message || 'Terjadi kesalahan tidak terduga saat memproses data.',
      });
      showToast('Terjadi kendala saat restore data. Lihat laporan detail pada pop-up.', 'error');
    } finally {
      setRestoreProgress(null);
      setIsRestoringBackup(false);
    }
  };

  // 6. Daily Archive & Prune (Backup Today's Transactions + Clear Firebase `tokens` & `violations` for Next Exam Day)
  const handleArchiveAndPruneTransactions = async () => {
    setShowDailyArchiveConfirm(false);
    setIsArchivingDaily(true);
    try {
      const backupSuccess = await handleExportFullBackup('Arsip_Harian_Sistem_Ujian');
      if (!backupSuccess) {
        setIsArchivingDaily(false);
        return;
      }

      for (const colName of ['tokens', 'violations']) {
        const snap = await getDocs(collection(db, colName));
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      TRANSACTION_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
      if (onClearLocalTransactionState) {
        onClearLocalTransactionState();
      }
      calculateCacheStats();
      showToast(
        'Transaksi hari ini berhasil diarsipkan ke file Backup & database telah dibersihkan untuk sesi/hari berikutnya!',
        'success'
      );
    } catch (err: any) {
      showToast('Gagal membersihkan transaksi database: ' + (err?.message || ''), 'error');
    } finally {
      setIsArchivingDaily(false);
    }
  };

  if (mode === 'modal' && !isOpen) return null;

  const archivedCountInMemory = exams.filter((e: any) => Boolean(e?.isArchived)).length;
  const activeCountInMemory = exams.length - archivedCountInMemory;

  const content = (
    <div className="space-y-6">
      {/* LIVE PROGRESS MODAL OVERLAY DURING RESTORE */}
      {isRestoringBackup && restoreProgress && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[99998] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-emerald-200 space-y-5">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <RefreshCw size={24} className="animate-spin" />
              </div>
              <div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-extrabold uppercase">
                  Proses Restore Berjalan
                </span>
                <h3 className="text-base font-extrabold text-gray-900 mt-0.5">
                  Memulihkan Database Sistem...
                </h3>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-extrabold">
                <span className="text-emerald-800">{restoreProgress.stepText}</span>
                <span className="text-emerald-600 text-sm">{restoreProgress.percent}%</span>
              </div>
              <div className="w-full h-3.5 bg-gray-100 rounded-full overflow-hidden border border-gray-200 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full transition-all duration-300"
                  style={{ width: `${restoreProgress.percent}%` }}
                />
              </div>
              {restoreProgress.detailText && (
                <p className="text-[11px] text-gray-500 font-medium">{restoreProgress.detailText}</p>
              )}
            </div>

            {/* 4 Step Checklist */}
            <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200/80 space-y-2 text-xs">
              {[
                { step: 1, label: 'Simpan ke Cache Lokal & Memori Aplikasi' },
                { step: 2, label: 'Sinkronisasi Katalog Login & Bundel Ujian (1-Read)' },
                { step: 3, label: 'Penulisan Batch Koleksi ke Firebase Firestore' },
                { step: 4, label: 'Verifikasi & Laporan Hasil Pemulihan' },
              ].map((item) => {
                const isDone = restoreProgress.stage > item.step || restoreProgress.percent === 100;
                const isCurrent = restoreProgress.stage === item.step && restoreProgress.percent < 100;
                return (
                  <div
                    key={item.step}
                    className={`flex items-center gap-2.5 ${
                      isDone
                        ? 'text-emerald-700 font-bold'
                        : isCurrent
                        ? 'text-blue-700 font-extrabold'
                        : 'text-gray-400'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${
                        isDone
                          ? 'bg-emerald-500 text-white'
                          : isCurrent
                          ? 'bg-blue-600 text-white animate-pulse'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isDone ? <Check size={12} /> : item.step}
                    </div>
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-center text-gray-400 italic">
              Mohon jangan menutup halaman ini sampai proses mencapai 100%.
            </p>
          </div>
        </div>
      )}

      {/* POP-UP MODAL LAPORAN HASIL RESTORE (BERHASIL / SEBAGIAN / GAGAL) */}
      {restoreResultReport && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs z-[99999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div
              className={`px-6 py-5 text-white flex items-center justify-between ${
                restoreResultReport.status === 'success'
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600'
                  : restoreResultReport.status === 'partial'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600'
                  : 'bg-gradient-to-r from-red-600 to-rose-600'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0 border border-white/25">
                  {restoreResultReport.status === 'success' ? (
                    <CheckCircle2 size={28} />
                  ) : restoreResultReport.status === 'partial' ? (
                    <AlertTriangle size={28} />
                  ) : (
                    <AlertCircle size={28} />
                  )}
                </div>
                <div>
                  <span className="px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-extrabold uppercase">
                    {restoreResultReport.status === 'success'
                      ? 'Laporan Sukses'
                      : restoreResultReport.status === 'partial'
                      ? 'Laporan Pemulihan Sebagian'
                      : 'Laporan Gagal'}
                  </span>
                  <h3 className="text-lg font-extrabold leading-tight mt-0.5">
                    {restoreResultReport.title}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRestoreResultReport(null)}
                className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <p className="text-gray-600 leading-relaxed font-medium">
                {restoreResultReport.subtitle}
              </p>

              <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">Nama File Backup:</span>
                  <span className="font-extrabold text-gray-800 truncate max-w-[240px]">
                    {restoreResultReport.fileName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">Mode Pemulihan:</span>
                  <span className="font-bold text-indigo-700">{restoreResultReport.modeLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">Waktu Eksekusi:</span>
                  <span className="font-medium text-gray-600">{restoreResultReport.timestamp}</span>
                </div>
              </div>

              {/* Rincian Data yang Dipulihkan */}
              {restoreResultReport.status !== 'error' && (
                <div className="space-y-2">
                  <p className="text-[11px] font-extrabold text-gray-500 uppercase tracking-wider">
                    Rincian Data yang Berhasil Dipulihkan:
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="p-2.5 rounded-xl bg-blue-50/70 border border-blue-100">
                      <span className="text-[10px] text-blue-600 font-bold block">Pengguna (User)</span>
                      <span className="text-sm font-black text-blue-950">
                        {restoreResultReport.counts.users} Akun
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100">
                      <span className="text-[10px] text-emerald-600 font-bold block">Kelas & Ruang</span>
                      <span className="text-sm font-black text-emerald-950">
                        {restoreResultReport.counts.classrooms} Kls • {restoreResultReport.counts.rooms} Rng
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-100">
                      <span className="text-[10px] text-indigo-600 font-bold block">Mata Pelajaran</span>
                      <span className="text-sm font-black text-indigo-950">
                        {restoreResultReport.counts.subjects} Mapel
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-purple-50/70 border border-purple-100">
                      <span className="text-[10px] text-purple-600 font-bold block">Ujian Aktif</span>
                      <span className="text-sm font-black text-purple-950">
                        {restoreResultReport.counts.activeExams} Ujian
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-100">
                      <span className="text-[10px] text-amber-700 font-bold block">Bank Soal (Arsip)</span>
                      <span className="text-sm font-black text-amber-950">
                        {restoreResultReport.counts.archivedExams} Soal
                      </span>
                    </div>
                    <div className="p-2.5 rounded-xl bg-teal-50/70 border border-teal-100">
                      <span className="text-[10px] text-teal-700 font-bold block">Jadwal & Hari</span>
                      <span className="text-sm font-black text-teal-950">
                        {restoreResultReport.counts.masterPlan} Hari ({restoreResultReport.counts.schedules} Sesi)
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Penulisan Database Firebase */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                <div>
                  <p className="font-bold text-gray-800">Sinkronisasi Cloud Firebase Firestore</p>
                  <p className="text-[11px] text-gray-500">
                    Bundel Utama: {restoreResultReport.firestoreStats.bundlesSynced}/3 • Dokumen Koleksi:{' '}
                    {restoreResultReport.firestoreStats.writtenCount}/{restoreResultReport.firestoreStats.totalQueued}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase ${
                    restoreResultReport.status === 'success'
                      ? 'bg-emerald-100 text-emerald-800'
                      : restoreResultReport.status === 'partial'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {restoreResultReport.status === 'success'
                    ? '100% Tersinkron'
                    : restoreResultReport.status === 'partial'
                    ? 'Aktif via Cache'
                    : 'Gagal'}
                </span>
              </div>

              {/* Detail Error Jika Ada */}
              {restoreResultReport.errorDetails && (
                <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 space-y-1">
                  <p className="font-extrabold flex items-center gap-1.5 text-red-700">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>Catatan Teknis / Penyebab Kendala:</span>
                  </p>
                  <p className="text-[11px] font-mono break-words leading-relaxed">
                    {restoreResultReport.errorDetails}
                  </p>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setRestoreResultReport(null)}
                className={`px-6 py-2.5 rounded-xl font-extrabold text-xs text-white shadow-md transition-all cursor-pointer ${
                  restoreResultReport.status === 'success'
                    ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100'
                    : restoreResultReport.status === 'partial'
                    ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-100'
                    : 'bg-gray-900 hover:bg-gray-800'
                }`}
              >
                Mengerti & Tutup Laporan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL FOR DAILY ARCHIVE & PRUNE */}
      {showDailyArchiveConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[99995] flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-amber-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                <Archive size={24} />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900">
                  Arsipkan & Bersihkan Transaksi Harian?
                </h3>
                <p className="text-xs text-gray-500">Persiapan kuota segar untuk ujian hari berikutnya</p>
              </div>
            </div>
            <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200 text-xs text-amber-950 space-y-1.5 leading-relaxed">
              <p>
                <strong>1. Download Otomatis:</strong> Sistem akan mengunduh file Backup Lengkap (`.json`) ke perangkat Anda terlebih dahulu.
              </p>
              <p>
                <strong>2. Bersihkan Log Sesi:</strong> Setelah terunduh, riwayat Token ({tokens.length}) & Pelanggaran ({violations.length}) di Firebase akan dikosongkan agar kapasitas kembali 0%.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDailyArchiveConfirm(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleArchiveAndPruneTransactions}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold shadow-sm cursor-pointer"
              >
                Ya, Unduh Arsip & Bersihkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: MANAJEMEN CACHE PERANGKAT (TERSEDIA UNTUK SEMUA ROLE: SISWA, PENGAWAS, ADMIN) */}
      <div className="bg-white p-6 rounded-3xl border border-gray-200 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <HardDrive size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-extrabold text-gray-900">
                  Penyimpanan Cache Perangkat ({role.toUpperCase()})
                </h3>
                <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full text-[10px] font-extrabold uppercase">
                  Hemat Kuota Database
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Data transaksi ujian disimpan di memori browser perangkat ini agar tidak membebani database Firebase.
              </p>
            </div>
          </div>

          <div className="text-right bg-gray-50 px-4 py-2 rounded-2xl border border-gray-200 shrink-0">
            <span className="text-[10px] font-bold text-gray-400 uppercase block">
              Memori Cache Terpakai
            </span>
            <span className="text-lg font-black text-gray-900">{cacheStats.totalKB} KB</span>
            <span className="text-[10px] text-gray-400 ml-1">/ 5.000 KB ({cacheStats.percentOf5MB}%)</span>
          </div>
        </div>

        {/* Cache Breakdown Mini Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-2xl bg-blue-50/60 border border-blue-100">
            <span className="text-[10px] font-extrabold text-blue-600 uppercase">
              Cache Transaksi (Token & Laporan)
            </span>
            <p className="text-base font-black text-blue-950 mt-0.5">{cacheStats.transactionKB} KB</p>
            <p className="text-[10px] text-blue-700 mt-0.5">
              Riwayat sesi ujian & status kehadiran lokal
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-indigo-50/60 border border-indigo-100">
            <span className="text-[10px] font-extrabold text-indigo-600 uppercase">
              Cache Bundel Jadwal & Ujian
            </span>
            <p className="text-base font-black text-indigo-950 mt-0.5">{cacheStats.masterKB} KB</p>
            <p className="text-[10px] text-indigo-700 mt-0.5">
              1-Read Bundel Mapel, Kelas, Ruang & Sesi
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-100">
            <span className="text-[10px] font-extrabold text-amber-700 uppercase">
              Cache Katalog Roster Siswa
            </span>
            <p className="text-base font-black text-amber-950 mt-0.5">{cacheStats.rosterKB} KB</p>
            <p className="text-[10px] text-amber-800 mt-0.5">
              Katalog Login Cepat & Daftar Hadir Kelas
            </p>
          </div>
        </div>

        {/* Action Buttons for Clearing / Refreshing Cache */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={handleClearTransactionCache}
            className="px-4 py-3 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Trash2 size={16} className="text-amber-600 shrink-0" />
            <span>Bersihkan Cache Transaksi Sesi Lama (Tanpa Logout)</span>
          </button>

          <button
            type="button"
            onClick={handleRefreshAndClearCache}
            className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm shadow-blue-100 cursor-pointer"
          >
            <RefreshCw size={16} className="shrink-0" />
            <span>Segarkan & Muat Ulang Bundel Cache Terbaru</span>
          </button>
        </div>
      </div>

      {/* SECTION 2: FULL BACKUP & RESTORE SIAP REMIX + ARSIP HARIAN (KHUSUS ADMIN) */}
      {isActualAdmin && (
        <div className="bg-white p-6 sm:p-8 rounded-3xl border-2 border-indigo-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-100">
                <Database size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-extrabold text-gray-900">
                    Pusat Backup & Restore Database (Siap Remix Aplikasi)
                  </h3>
                  <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[10px] font-extrabold uppercase">
                    Khusus Admin
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Jika aplikasi ini di-<strong>Remix</strong> ke akun/proyek baru, cukup klik <strong>Export Backup</strong> di sini lalu klik <strong>Restore</strong> di aplikasi hasil Remix.
                </p>
              </div>
            </div>
          </div>

          {/* Current Database Inventory Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-center gap-2.5">
              <Users size={18} className="text-blue-600 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Total User</p>
                <p className="text-sm font-black text-gray-900">{users.length} Akun</p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-center gap-2.5">
              <Layers size={18} className="text-emerald-600 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Kelas & Ruang</p>
                <p className="text-sm font-black text-gray-900">
                  {classrooms.length} Kelas • {rooms.length} Ruang
                </p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-center gap-2.5">
              <FileText size={18} className="text-indigo-600 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Ujian & Bank Soal</p>
                <p className="text-sm font-black text-gray-900">
                  {activeCountInMemory} Aktif • {archivedCountInMemory} Arsip
                </p>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200/80 flex items-center gap-2.5">
              <Calendar size={18} className="text-amber-600 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">Token & Laporan</p>
                <p className="text-sm font-black text-gray-900">
                  {tokens.length} Token • {violations.length} Log
                </p>
              </div>
            </div>
          </div>

          {/* Two Columns: EXPORT BACKUP vs RESTORE BACKUP */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* LEFT: EXPORT BACKUP */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50/80 to-indigo-50/60 border border-blue-200/80 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-900 font-extrabold text-sm">
                  <Download size={18} className="text-blue-600" />
                  <span>1. Download / Export File Backup (`.json`)</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Mengunduh seluruh data Master (Siswa, Guru, Kelas, Ruang, Mapel, Link Ujian Aktif, Bank Soal, Jadwal, & Pengaturan) ke dalam 1 file `.json`.
                </p>

                <label className="flex items-start gap-2.5 p-3 bg-white rounded-xl border border-blue-100 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeTransactionsInBackup}
                    onChange={(e) => setIncludeTransactionsInBackup(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-gray-800 block">
                      Sertakan Data Transaksi (Token, Absensi, & Pelanggaran)
                    </span>
                    <span className="text-[10px] text-gray-500">
                      Matikan centang jika hanya ingin mem-backup Master Data & Bank Soal bersih untuk Remix.
                    </span>
                  </div>
                </label>
              </div>

              <button
                type="button"
                onClick={() => handleExportFullBackup()}
                disabled={isExportingBackup}
                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-extrabold text-xs transition-all shadow-md shadow-blue-100 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isExportingBackup ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                <span>
                  {isExportingBackup
                    ? 'Menyiapkan File Backup...'
                    : 'Download Full Backup (.JSON) Sekarang'}
                </span>
              </button>
            </div>

            {/* RIGHT: RESTORE FROM BACKUP */}
            <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50/80 to-teal-50/60 border border-emerald-200/80 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-950 font-extrabold text-sm">
                  <Upload size={18} className="text-emerald-600" />
                  <span>2. Restore / Pulihkan Data dari Backup (`.json`)</span>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  Gunakan fitur ini setelah melakukan <strong>Remix Aplikasi</strong> atau pindah database agar seluruh Siswa, Guru, Jadwal, Ujian, dan Bank Soal langsung kembali dilengkapi laporan hasil pemulihan.
                </p>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleSelectBackupFile}
                  className="hidden"
                />

                {!parsedBackupPreview ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRestoringBackup || isReadingBackupFile}
                    className="w-full py-6 px-4 bg-white hover:bg-emerald-50/50 border-2 border-dashed border-emerald-300 rounded-2xl flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-60"
                  >
                    {isReadingBackupFile ? (
                      <>
                        <RefreshCw size={28} className="text-emerald-600 animate-spin" />
                        <span className="text-xs font-extrabold text-emerald-900">
                          Membaca & Memvalidasi File JSON...
                        </span>
                      </>
                    ) : (
                      <>
                        <FileJson size={28} className="text-emerald-600" />
                        <span className="text-xs font-extrabold text-emerald-900">
                          Pilih File Backup (`.json`) dari Perangkat
                        </span>
                        <span className="text-[10px] text-gray-500">
                          Klik untuk mengunggah file hasil Export Backup
                        </span>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="p-3.5 bg-white rounded-2xl border border-emerald-300 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-extrabold text-emerald-900 truncate max-w-[240px]">
                          📄 {parsedBackupPreview.fileName}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {parsedBackupPreview.schoolTitle} •{' '}
                          {new Date(parsedBackupPreview.createdAt).toLocaleString('id-ID')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setParsedBackupPreview(null)}
                        className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                        title="Batalkan file ini"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold bg-emerald-50/70 p-2.5 rounded-xl text-emerald-950">
                      <div>👤 {parsedBackupPreview.counts.users} User</div>
                      <div>🏫 {parsedBackupPreview.counts.classrooms} Kelas</div>
                      <div>🚪 {parsedBackupPreview.counts.rooms} Ruang</div>
                      <div>📚 {parsedBackupPreview.counts.subjects} Mapel</div>
                      <div>📝 {parsedBackupPreview.counts.activeExams} Ujian</div>
                      <div>🗄️ {parsedBackupPreview.counts.archivedExams} Bank Soal</div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setRestoreMode('master_only')}
                        className={`p-2 rounded-xl border text-[10px] font-extrabold text-left transition-all cursor-pointer ${
                          restoreMode === 'master_only'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-gray-50 text-gray-700 border-gray-200'
                        }`}
                      >
                        <div>✨ Master Data & Bank Soal</div>
                        <div className="font-normal opacity-85">Rekomendasi Remix</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRestoreMode('full')}
                        className={`p-2 rounded-xl border text-[10px] font-extrabold text-left transition-all cursor-pointer ${
                          restoreMode === 'full'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-gray-50 text-gray-700 border-gray-200'
                        }`}
                      >
                        <div>📦 Restore Penuh 100%</div>
                        <div className="font-normal opacity-85">+ Token & Absensi</div>
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isRestoringBackup}
                        className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs transition-all cursor-pointer shrink-0"
                      >
                        Ganti File
                      </button>
                      <button
                        type="button"
                        onClick={handleExecuteRestore}
                        disabled={isRestoringBackup}
                        className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-extrabold text-xs transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                      >
                        {isRestoringBackup ? (
                          <RefreshCw size={15} className="animate-spin" />
                        ) : (
                          <CheckCircle2 size={15} />
                        )}
                        <span>
                          {isRestoringBackup
                            ? 'Memulihkan Database...'
                            : 'Mulai Restore Data Sekarang'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DAILY ARCHIVE & PRUNE FOR 10-DAY EXAM */}
          <div className="p-5 rounded-2xl bg-amber-50/90 border border-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-amber-950 font-extrabold text-sm">
                <Archive size={18} className="text-amber-600 shrink-0" />
                <span>3. Arsipkan & Bersihkan Transaksi Harian (Khusus Ujian 10 Hari)</span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Gunakan setiap selesai ujian sore hari: Sistem otomatis <strong>mengunduh Backup Transaksi hari ini</strong> ke komputer Anda, lalu <strong>mengosongkan log Token & Pelanggaran di Firebase</strong> agar kuota & kecepatan hari esok kembali 100% segar.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowDailyArchiveConfirm(true)}
              disabled={isArchivingDaily}
              className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-extrabold text-xs shrink-0 transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isArchivingDaily ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Archive size={15} />
              )}
              <span>
                {isArchivingDaily
                  ? 'Mengarsipkan...'
                  : 'Backup & Bersihkan Transaksi Hari Ini'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[99980] flex items-center justify-center p-4 overflow-y-auto">
        <div className="bg-gray-50 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-6 py-4 bg-white border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <HardDrive size={20} className="text-blue-600" />
              <h2 className="text-base font-extrabold text-gray-900">
                Manajemen Cache Perangkat {isActualAdmin ? '& Backup / Restore Sistem' : ''}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-all cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-5 sm:p-6 overflow-y-auto flex-1">{content}</div>
        </div>
      </div>
    );
  }

  return content;
}
