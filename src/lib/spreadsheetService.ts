// ============================================================================
// LAYANAN DATABASE HYBRID: GOOGLE SPREADSHEET (UTAMA) + FIREBASE (CADANGAN KE-2)
// ============================================================================
// Menggunakan Google Apps Script Web App dengan Content-Type: text/plain;charset=utf-8
// agar bebas masalah CORS Preflight pada seluruh browser HP & Laptop siswa.

import { Timestamp, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { isFirestoreQuotaExhausted, checkAndHandleQuotaError } from '../firebase';
import firebaseConfig from '../../firebase-applet-config.json';
import bundledSchoolData from './bundledSchoolData.json';

export interface SpreadsheetSyncResult {
  ok: boolean;
  users?: any[];
  exams?: any[];
  subjects?: any[];
  schedules?: any[];
  masterPlan?: any[];
  appSettings?: any;
  message?: string;
  updatedAt?: string;
}

const SPREADSHEET_URL_STORAGE_KEY = 'smpn2_spreadsheet_webapp_url';
const SPREADSHEET_LAST_SYNC_KEY = 'smpn2_spreadsheet_last_sync_ms';
const DELETED_EXAM_IDS_STORAGE_KEY = 'smpn2_deleted_exam_ids';
const CREATED_EXAMS_STORAGE_KEY = 'smpn2_created_exams_registry';
const UPDATED_USERS_STORAGE_KEY = 'smpn2_updated_users_registry';
const CUSTOM_DATA_RESTORED_KEY = 'smpn2_custom_data_restored';
const DEMO_ACCOUNT_DELETED_KEY = 'smpn2_demo_account_deleted';
const DEMO_USED_ONCE_KEY = 'smpn2_demo_used_once';
const REAL_USERS_CONFIGURED_KEY = 'smpn2_real_users_configured';

// ID Database Asli saat ini; apabila di-Remix ke project baru, firestoreDatabaseId akan berubah otomatis
export const ORIGINAL_SOURCE_DATABASE_ID = 'ai-studio-remixremixnewapl-66b126f6-b5a3-49f9-9e48-f8f855eca361';

/**
 * Mengecek apakah aplikasi sedang berjalan di database baru hasil Remix.
 * Jika di-Remix, database menyesuaikan dengan data baru (atau hasil Restore File Backup), bukan memaksakan data lama.
 */
export const isRemixedNewDatabase = (): boolean => {
  try {
    if (localStorage.getItem('smpn2_force_remix_clean_mode') === 'true') return true;
  } catch (e) {}
  return false;
};

export const isCustomDataRestored = (): boolean => {
  try {
    return localStorage.getItem(CUSTOM_DATA_RESTORED_KEY) === 'true';
  } catch (e) {
    return false;
  }
};

/**
 * Mengecek apakah suatu objek user merupakan Akun Demo bawaan yang wajib dihapus setelah user utama ditentukan.
 */
export const isDemoUserRecord = (u: any): boolean => {
  if (!u || typeof u !== 'object') return false;
  if (u.isDemo === true || u.isOneTimeDemo === true) return true;
  const uid = String(u.id || u.uid || '').trim().toLowerCase();
  const email = String(u.email || '').trim().toLowerCase();
  const username = String(u.username || u.name || '').trim().toLowerCase();
  const nis = String(u.nis || '').trim().toLowerCase();
  const nip = String(u.nip || '').trim().toLowerCase();

  if (
    uid.startsWith('demo_') ||
    uid === 'master_super_admin' ||
    uid === 'one_time_demo_admin'
  ) {
    return true;
  }
  if (
    email === 'pengawas@smpn2sutojayan.sch.id' ||
    email === 'siswa@smpn2sutojayan.sch.id' ||
    email === '240101@siswa.smpn2sutojayan.sch.id' ||
    email === 'demo@smpn2sutojayan.sch.id'
  ) {
    return true;
  }
  if (
    username.includes('(pengawas demo)') ||
    username.includes('(siswa demo)') ||
    username.includes('(akun demo') ||
    username.includes('akun demo 1x')
  ) {
    return true;
  }
  if ((nis === '240101' && username.includes('ahmad fauzi')) || (nip === '19850202' && username.includes('budi santoso'))) {
    return true;
  }
  return false;
};

/**
 * Mengecek apakah sudah ada user nyata (non-demo) yang ditentukan di sistem.
 */
export const hasRealUsersConfigured = (candidateList?: any[]): boolean => {
  try {
    if (Array.isArray(candidateList)) {
      const realCount = candidateList.filter((u) => u && !isDemoUserRecord(u)).length;
      if (realCount > 0) return true;
    }
    if (localStorage.getItem(REAL_USERS_CONFIGURED_KEY) === 'true') return true;
    for (const key of ['cached_roster_catalog', 'cached_dashboard_users']) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.some((u: any) => u && !isDemoUserRecord(u))) {
          return true;
        }
      }
    }
  } catch (e) {}
  // Pada database asli yang belum di-Remix dan belum di-reset, data user sekolah sudah tersedia
  if (!isRemixedNewDatabase() && !isCustomDataRestored()) {
    const bundledList = Array.isArray((bundledSchoolData as any)?.users) ? (bundledSchoolData as any).users : [];
    if (bundledList.some((u: any) => u && !isDemoUserRecord(u))) {
      return true;
    }
  }
  return false;
};

/**
 * Akun Demo HANYA boleh keluar 1 kali saat aplikasi benar-benar kosong (belum ada user yang ditentukan).
 * Begitu sudah dipakai 1 kali ATAU user sudah ditentukan, fungsi ini mengembalikan false selamanya.
 */
export const canUseInitialOneTimeDemoAdmin = (candidateList?: any[]): boolean => {
  try {
    if (localStorage.getItem(DEMO_ACCOUNT_DELETED_KEY) === 'true') return false;
    if (localStorage.getItem(DEMO_USED_ONCE_KEY) === 'true') return false;
    if (hasRealUsersConfigured(candidateList)) {
      localStorage.setItem(DEMO_ACCOUNT_DELETED_KEY, 'true');
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
};

export const markOneTimeDemoAdminUsed = (): void => {
  try {
    localStorage.setItem(DEMO_USED_ONCE_KEY, 'true');
  } catch (e) {}
};

/**
 * Menghapus secara otomatis & permanen seluruh akun demo dari daftar user dan cache lokal
 * begitu Admin telah menentukan user (melalui Tambah User, Import, Spreadsheet, atau Restore Backup).
 */
export const purgeDemoAccountsEverywhere = (userList?: any[]): any[] => {
  const cleanInputList = Array.isArray(userList)
    ? userList.filter((u) => u && !isDemoUserRecord(u))
    : [];

  try {
    if (cleanInputList.length > 0 || hasRealUsersConfigured()) {
      localStorage.setItem(DEMO_ACCOUNT_DELETED_KEY, 'true');
      localStorage.setItem(DEMO_USED_ONCE_KEY, 'true');
      localStorage.setItem(REAL_USERS_CONFIGURED_KEY, 'true');
    }

    for (const key of ['cached_roster_catalog', 'cached_dashboard_users', UPDATED_USERS_STORAGE_KEY]) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const filtered = parsed.filter((u: any) => u && !isDemoUserRecord(u));
          if (filtered.length !== parsed.length) {
            localStorage.setItem(key, JSON.stringify(filtered));
          }
        }
      }
    }

    // Jika sesi lokal yang tersimpan adalah akun demo dan user nyata sudah ada, bersihkan sesi demo tersebut
    for (const sessionKey of ['local_roster_session', 'cached_local_auth_session']) {
      const rawSession = localStorage.getItem(sessionKey);
      if (rawSession && (cleanInputList.length > 0 || hasRealUsersConfigured())) {
        const parsedSession = JSON.parse(rawSession);
        const targetProfile = parsedSession?.profile || parsedSession;
        if (isDemoUserRecord(targetProfile)) {
          localStorage.removeItem(sessionKey);
        }
      }
    }
  } catch (e) {}

  return cleanInputList;
};

/**
 * Dipanggil saat proses Restore dari File Backup (.JSON) selesai agar data hasil Restore
 * menjadi sumber data utama aplikasi (termasuk setelah Remix).
 */
export const markCustomDataRestored = (payload: {
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
} = {}): void => {
  try {
    localStorage.setItem(CUSTOM_DATA_RESTORED_KEY, 'true');
    localStorage.removeItem(DELETED_EXAM_IDS_STORAGE_KEY);

    if (payload?.appSettings) {
      localStorage.setItem('appSettingsCache', JSON.stringify(payload.appSettings));
      if (payload.appSettings.spreadsheetWebAppUrl) {
        saveSpreadsheetUrlLocally(payload.appSettings.spreadsheetWebAppUrl);
      } else {
        localStorage.removeItem(SPREADSHEET_URL_STORAGE_KEY);
      }
    }

    if (Array.isArray(payload.users)) {
      const cleanUsers = purgeDemoAccountsEverywhere(payload.users);
      localStorage.setItem('cached_dashboard_users', JSON.stringify(cleanUsers));
      localStorage.setItem('cached_roster_catalog', JSON.stringify(cleanUsers));
      localStorage.setItem(UPDATED_USERS_STORAGE_KEY, JSON.stringify(cleanUsers));
      if (cleanUsers.length > 0) {
        localStorage.setItem(REAL_USERS_CONFIGURED_KEY, 'true');
        localStorage.setItem(DEMO_ACCOUNT_DELETED_KEY, 'true');
        localStorage.setItem(DEMO_USED_ONCE_KEY, 'true');
      }
    }

    if (Array.isArray(payload.exams)) {
      const serializableExams = payload.exams.map((ex: any) => ({
        ...ex,
        startTime: ex?.startTime?.toMillis ? ex.startTime.toMillis() : ex?.startTime,
        endTime: ex?.endTime?.toMillis ? ex.endTime.toMillis() : ex?.endTime,
        updatedAtMs: Date.now(),
      }));
      localStorage.setItem('cached_dashboard_exams', JSON.stringify(serializableExams));
      localStorage.setItem(CREATED_EXAMS_STORAGE_KEY, JSON.stringify(serializableExams));
    }

    if (Array.isArray(payload.classrooms)) {
      localStorage.setItem('cached_dashboard_classrooms', JSON.stringify(payload.classrooms));
    }
    if (Array.isArray(payload.rooms)) {
      localStorage.setItem('cached_dashboard_rooms', JSON.stringify(payload.rooms));
    }
    if (Array.isArray(payload.subjects)) {
      localStorage.setItem('cached_dashboard_subjects', JSON.stringify(payload.subjects));
    }
    if (Array.isArray(payload.schedules)) {
      localStorage.setItem('cached_dashboard_schedules', JSON.stringify(payload.schedules));
    }
    if (Array.isArray(payload.masterPlan)) {
      localStorage.setItem('cached_dashboard_masterPlan', JSON.stringify(payload.masterPlan));
    }
    if (Array.isArray(payload.tokens)) {
      localStorage.setItem('cached_dashboard_tokens', JSON.stringify(payload.tokens));
      localStorage.setItem('cached_dashboard_studentTokens', JSON.stringify(payload.tokens));
      localStorage.setItem('shared_released_tokens_registry', JSON.stringify(payload.tokens));
    }
    if (Array.isArray(payload.violations)) {
      localStorage.setItem('cached_dashboard_violations', JSON.stringify(payload.violations));
      localStorage.setItem('smpn2_shared_violations_registry', JSON.stringify(payload.violations));
    }
    if (payload.attendanceAbsenceNotes) {
      localStorage.setItem('cached_attendance_absence_notes', JSON.stringify(payload.attendanceAbsenceNotes));
    }
  } catch (e) {}
};

export const getUpdatedUsersLocally = (): any[] => {
  try {
    const raw = localStorage.getItem(UPDATED_USERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((u: any) => u && (u.id || u.uid || u.nis || u.nip || u.email));
      }
    }
  } catch (e) {}
  return [];
};

export const saveUpdatedUserLocally = (userObj: any): any[] => {
  if (!userObj) return getUpdatedUsersLocally();
  const uidKey = String(userObj.id || userObj.uid || '').trim();
  const nisKey = String(userObj.nis || '').trim().toLowerCase();
  const emailKey = String(userObj.email || '').trim().toLowerCase();
  if (!uidKey && !nisKey && !emailKey) return getUpdatedUsersLocally();

  const current = getUpdatedUsersLocally();
  const cleanEntry = {
    id: uidKey || userObj.id || userObj.uid || '',
    uid: userObj.uid || uidKey || '',
    username: String(userObj.username || userObj.name || '').trim(),
    role: String(userObj.role || 'siswa').toLowerCase().trim(),
    kelas: String(userObj.kelas || '-').trim(),
    ruang: String(userObj.ruang || '-').trim(),
    nis: String(userObj.nis || '').trim(),
    nip: String(userObj.nip || '').trim(),
    email: String(userObj.email || '').toLowerCase().trim(),
    password: String(userObj.password || userObj.nis || userObj.nip || '123456').trim(),
    verified: userObj.verified !== false,
    isProfileCompletedByUser: Boolean(userObj.isProfileCompletedByUser),
    updatedAtMs: Date.now(),
  };

  const idx = current.findIndex((u: any) => {
    const cId = String(u.id || u.uid || '').trim();
    const cNis = String(u.nis || '').trim().toLowerCase();
    const cEmail = String(u.email || '').trim().toLowerCase();
    if (uidKey && cId && uidKey === cId) return true;
    if (nisKey && cNis && nisKey === cNis) return true;
    if (emailKey && cEmail && emailKey === cEmail) return true;
    return false;
  });

  const next = idx >= 0
    ? current.map((u: any, i: number) => (i === idx ? { ...u, ...cleanEntry } : u))
    : [cleanEntry, ...current].slice(0, 1500);

  try {
    localStorage.setItem(UPDATED_USERS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {}
  return next;
};

export const removeUpdatedUserLocally = (userId: string): void => {
  if (!userId) return;
  const target = String(userId).trim();
  try {
    const next = getUpdatedUsersLocally().filter(
      (u: any) => String(u.id || u.uid || '').trim() !== target
    );
    localStorage.setItem(UPDATED_USERS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {}
};

export const getDeletedExamIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DELETED_EXAM_IDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.map((x: any) => String(x).trim()).filter(Boolean));
    }
  } catch (e) {}
  return new Set();
};

export const getCreatedExamsLocally = (): any[] => {
  try {
    const delSet = getDeletedExamIds();
    const raw = localStorage.getItem(CREATED_EXAMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((e: any) => e && e.id && !delSet.has(String(e.id).trim()));
      }
    }
  } catch (e) {}
  return [];
};

export const saveCreatedExamLocally = (examObj: any): any[] => {
  if (!examObj || !examObj.id) return getCreatedExamsLocally();
  const delSet = getDeletedExamIds();
  const examId = String(examObj.id).trim();
  if (delSet.has(examId)) {
    delSet.delete(examId);
    try {
      localStorage.setItem(DELETED_EXAM_IDS_STORAGE_KEY, JSON.stringify(Array.from(delSet)));
    } catch (e) {}
  }
  const current = getCreatedExamsLocally();
  const idx = current.findIndex((e: any) => String(e.id).trim() === examId);
  const existingLocal = idx >= 0 ? current[idx] : {};
  const serializable = {
    ...existingLocal,
    ...examObj,
    startTime: examObj.startTime?.toMillis ? examObj.startTime.toMillis() : (examObj.startTime ?? existingLocal.startTime),
    endTime: examObj.endTime?.toMillis ? examObj.endTime.toMillis() : (examObj.endTime ?? existingLocal.endTime),
    updatedAtMs: examObj.updatedAtMs || Date.now(),
  };
  const next = idx >= 0
    ? current.map((e: any, i: number) => (i === idx ? serializable : e))
    : [serializable, ...current];
  try {
    localStorage.setItem(CREATED_EXAMS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {}
  return next;
};

/**
 * Menggabungkan data ujian dari Server (Firestore / Spreadsheet / Public Bundle) dengan registri lokal.
 * Mencegah entri lokal lama (tanpa tokenStatusUpdatedAtMs) menimpa status Izin Rilis Token dari Admin.
 */
export const mergeExamWithLocalOverride = (remoteExam: any, localExam: any): any => {
  if (!remoteExam) return hydrateRecordTimestamps(localExam);
  if (!localExam) return hydrateRecordTimestamps(remoteExam);

  const remoteTokenTs = Number(remoteExam.tokenStatusUpdatedAtMs || 0);
  const localTokenTs = Number(localExam.tokenStatusUpdatedAtMs || 0);

  const baseMerged = {
    ...localExam,
    ...remoteExam,
    googleFormLink: remoteExam.googleFormLink || localExam.googleFormLink || remoteExam.link || localExam.link || '',
    startTime: remoteExam.startTime || localExam.startTime,
    endTime: remoteExam.endTime || localExam.endTime,
    duration: remoteExam.duration || localExam.duration || 90,
  };

  // Jika entri lokal memiliki timestamp pembaruan status token yang lebih baru dari data spreadsheet/remote,
  // pertahankan status izin rilis token dari lokal (yang berasal dari Firestore / public_bundle).
  const preferLocal = localTokenTs > 0 && localTokenTs > remoteTokenTs;

  const isArchived = preferLocal
    ? Boolean(localExam.isArchived)
    : (remoteExam.isArchived !== undefined ? Boolean(remoteExam.isArchived) : Boolean(localExam.isArchived));

  const isActive = preferLocal
    ? (localExam.isActive !== false && !isArchived)
    : (remoteExam.isActive !== undefined ? (remoteExam.isActive !== false && !isArchived) : (localExam.isActive !== false && !isArchived));

  const isTokenReleased = preferLocal
    ? Boolean(localExam.isTokenReleased && !isArchived)
    : (remoteExam.isTokenReleased !== undefined
        ? Boolean(remoteExam.isTokenReleased && !isArchived)
        : (!isArchived && Boolean(localExam.isTokenReleased || !localExam.adminLocked)));

  const adminLocked = isArchived || (preferLocal
    ? Boolean(localExam.adminLocked)
    : (remoteExam.adminLocked !== undefined
        ? Boolean(remoteExam.adminLocked)
        : Boolean(localExam.adminLocked)));

  return hydrateRecordTimestamps({
    ...baseMerged,
    isArchived,
    isActive,
    isTokenReleased,
    adminLocked,
    tokenStatusUpdatedAtMs: Math.max(remoteTokenTs, localTokenTs),
  });
};

export const markExamDeletedLocally = (examId?: string, serverDeletedIds?: string[]): string[] => {
  const current = getDeletedExamIds();
  if (examId) current.add(String(examId).trim());
  if (Array.isArray(serverDeletedIds)) {
    serverDeletedIds.forEach((id) => {
      if (id) current.add(String(id).trim());
    });
  }
  const list = Array.from(current);
  try {
    localStorage.setItem(DELETED_EXAM_IDS_STORAGE_KEY, JSON.stringify(list));
    if (examId) {
      const created = getCreatedExamsLocally().filter((e: any) => String(e.id).trim() !== String(examId).trim());
      localStorage.setItem(CREATED_EXAMS_STORAGE_KEY, JSON.stringify(created));
    }
  } catch (e) {}
  return list;
};

export const DEFAULT_SPREADSHEET_WEBAPP_URL =
  (bundledSchoolData as any)?.appSettings?.spreadsheetWebAppUrl ||
  'https://script.google.com/macros/s/AKfycbzvopqsD2G6jD2se8iRtCL4SXSWMA19Oo-Em8a2433k3UMyiNXx7oblUzWCBG8gw4ni/exec';

export const toFirestoreTimestamp = (val: any): any => {
  if (!val) return val;
  if (typeof val?.toDate === 'function') return val;
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    return new Timestamp(val.seconds, val.nanoseconds || 0);
  }
  if (typeof val === 'number' && val > 100000000000) {
    return Timestamp.fromMillis(val);
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed)) {
      return Timestamp.fromMillis(parsed);
    }
  }
  return val;
};

export const hydrateRecordTimestamps = (item: any): any => {
  if (!item || typeof item !== 'object') return item;
  const copy: any = { ...item };
  for (const field of ['startTime', 'endTime', 'createdAt', 'expiresAt', 'timestamp', 'finishedAt']) {
    if (copy[field] !== undefined && copy[field] !== null) {
      copy[field] = toFirestoreTimestamp(copy[field]);
    }
  }
  return copy;
};

export const sanitizeAppSettingsWithDefaults = (raw?: any) => {
  const bSettings = (bundledSchoolData as any)?.appSettings || {};
  const baseDefaults = {
    title: bSettings.title || 'UPT SMPN 2 SUTOJAYAN',
    loginSubtitle:
      bSettings.loginSubtitle !== undefined
        ? bSettings.loginSubtitle
        : 'PENILAIAN TENGAH SEMESTER TA. 2026/2027 ',
    logoUrl: bSettings.logoUrl || '',
    spreadsheetWebAppUrl: bSettings.spreadsheetWebAppUrl || DEFAULT_SPREADSHEET_WEBAPP_URL,
    allowGoogleLogin: Boolean(bSettings.allowGoogleLogin),
    allowSelfRegistration: Boolean(bSettings.allowSelfRegistration),
    allowStudentProfileEdit: bSettings.allowStudentProfileEdit !== false,
    allowSupervisorProfileEdit: bSettings.allowSupervisorProfileEdit !== false,
    allowStudentEditAcademic: bSettings.allowStudentEditAcademic !== false,
    allowSupervisorAddExam: Boolean(bSettings.allowSupervisorAddExam),
    allowSupervisorDeleteViolation: Boolean(bSettings.allowSupervisorDeleteViolation),
    allowSupervisorResetViolation: Boolean(bSettings.allowSupervisorResetViolation),
    allowStudentSelfReactivateToken: Boolean(bSettings.allowStudentSelfReactivateToken),
    studentViolationSoundEnabled: bSettings.studentViolationSoundEnabled !== false,
    exitCountdownSeconds:
      typeof bSettings.exitCountdownSeconds === 'number' && bSettings.exitCountdownSeconds >= 1 && bSettings.exitCountdownSeconds !== 7
        ? Math.min(120, Math.round(bSettings.exitCountdownSeconds))
        : 10,
    earlyExamGracePeriodMinutes:
      typeof bSettings.earlyExamGracePeriodMinutes === 'number' && !isNaN(bSettings.earlyExamGracePeriodMinutes) && bSettings.earlyExamGracePeriodMinutes >= 0
        ? Math.min(60, Math.round(bSettings.earlyExamGracePeriodMinutes))
        : 15,
    attendanceAbsenceNotes: bSettings.attendanceAbsenceNotes || {},
    customPortalConfig: bSettings.customPortalConfig || {
      menuTitle: 'Hasil Ujian / Nilai',
      menuSubtitle: 'Daftar Nilai Hasil Ujian & Pengumuman Resmi Sekolah',
      enabledForSupervisor: true,
      enabledForStudent: true,
      enableStartupPopup: true,
      popupFrequency: 'every_open',
      items: [],
    },
    supervisorMenus: {
      schedule: bSettings.supervisorMenus?.schedule !== false,
      exams: bSettings.supervisorMenus?.exams !== false,
      attendance: bSettings.supervisorMenus?.attendance !== false,
      violations: bSettings.supervisorMenus?.violations !== false,
      custom_portal: bSettings.supervisorMenus?.custom_portal !== false,
    },
    studentMenus: {
      schedule: bSettings.studentMenus?.schedule !== false,
      violations: bSettings.studentMenus?.violations !== false,
      custom_portal: bSettings.studentMenus?.custom_portal !== false,
    },
  };

  if (!raw || typeof raw !== 'object') {
    return baseDefaults;
  }

  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  const isGenericPlaceholderTitle =
    !rawTitle || rawTitle === 'SISTEM UJIAN SEKOLAH' || rawTitle === 'Selamat Datang';

  const rawSubtitle = typeof raw.loginSubtitle === 'string' ? raw.loginSubtitle.trim() : '';
  const isGenericPlaceholderSubtitle =
    !rawSubtitle ||
    rawSubtitle === 'PENILAIAN AKADEMIK BERBASIS KOMPUTER' ||
    rawSubtitle === 'Masuk ke sistem ujian anti-curang';

  const rawLogo = typeof raw.logoUrl === 'string' ? raw.logoUrl.trim() : '';
  const rawSheetUrl = typeof raw.spreadsheetWebAppUrl === 'string' ? raw.spreadsheetWebAppUrl.trim() : '';

  // Jika dokumen settings berasal dari template kosong otomatis saat Remix, pertahankan setting asli sekolah
  const isStaleGenericRecord = isGenericPlaceholderTitle && !rawLogo;

  return {
    ...baseDefaults,
    ...raw,
    title: isGenericPlaceholderTitle ? baseDefaults.title : rawTitle,
    loginSubtitle: isGenericPlaceholderSubtitle ? baseDefaults.loginSubtitle : raw.loginSubtitle,
    logoUrl: rawLogo || baseDefaults.logoUrl,
    spreadsheetWebAppUrl: rawSheetUrl || baseDefaults.spreadsheetWebAppUrl,
    allowGoogleLogin: isStaleGenericRecord
      ? baseDefaults.allowGoogleLogin
      : raw.allowGoogleLogin !== undefined
      ? Boolean(raw.allowGoogleLogin)
      : baseDefaults.allowGoogleLogin,
    allowSelfRegistration:
      raw.allowSelfRegistration !== undefined
        ? Boolean(raw.allowSelfRegistration)
        : baseDefaults.allowSelfRegistration,
    allowStudentProfileEdit:
      raw.allowStudentProfileEdit !== undefined
        ? raw.allowStudentProfileEdit !== false
        : baseDefaults.allowStudentProfileEdit,
    allowSupervisorProfileEdit:
      raw.allowSupervisorProfileEdit !== undefined
        ? raw.allowSupervisorProfileEdit !== false
        : baseDefaults.allowSupervisorProfileEdit,
    allowStudentEditAcademic:
      raw.allowStudentEditAcademic !== undefined
        ? Boolean(raw.allowStudentEditAcademic)
        : baseDefaults.allowStudentEditAcademic,
    allowSupervisorAddExam:
      raw.allowSupervisorAddExam !== undefined
        ? Boolean(raw.allowSupervisorAddExam)
        : baseDefaults.allowSupervisorAddExam,
    allowSupervisorDeleteViolation:
      raw.allowSupervisorDeleteViolation !== undefined
        ? Boolean(raw.allowSupervisorDeleteViolation)
        : baseDefaults.allowSupervisorDeleteViolation,
    allowSupervisorResetViolation:
      raw.allowSupervisorResetViolation !== undefined
        ? Boolean(raw.allowSupervisorResetViolation)
        : baseDefaults.allowSupervisorResetViolation,
    allowStudentSelfReactivateToken:
      raw.allowStudentSelfReactivateToken !== undefined
        ? Boolean(raw.allowStudentSelfReactivateToken)
        : baseDefaults.allowStudentSelfReactivateToken,
    studentViolationSoundEnabled:
      raw.studentViolationSoundEnabled !== undefined
        ? raw.studentViolationSoundEnabled !== false
        : baseDefaults.studentViolationSoundEnabled,
    exitCountdownSeconds:
      typeof raw.exitCountdownSeconds === 'number' && !isNaN(raw.exitCountdownSeconds) && raw.exitCountdownSeconds >= 1
        ? Math.min(120, Math.round(raw.exitCountdownSeconds))
        : typeof raw.exitCountdownSeconds === 'string' && !isNaN(Number(raw.exitCountdownSeconds)) && Number(raw.exitCountdownSeconds) >= 1
        ? Math.min(120, Math.round(Number(raw.exitCountdownSeconds)))
        : baseDefaults.exitCountdownSeconds,
    earlyExamGracePeriodMinutes:
      typeof raw.earlyExamGracePeriodMinutes === 'number' && !isNaN(raw.earlyExamGracePeriodMinutes) && raw.earlyExamGracePeriodMinutes >= 0
        ? Math.min(60, Math.round(raw.earlyExamGracePeriodMinutes))
        : typeof raw.earlyExamGracePeriodMinutes === 'string' && !isNaN(Number(raw.earlyExamGracePeriodMinutes)) && Number(raw.earlyExamGracePeriodMinutes) >= 0
        ? Math.min(60, Math.round(Number(raw.earlyExamGracePeriodMinutes)))
        : baseDefaults.earlyExamGracePeriodMinutes,
    attendanceAbsenceNotes: raw.attendanceAbsenceNotes || baseDefaults.attendanceAbsenceNotes,
    customPortalConfig: raw?.customPortalConfig
      ? {
          menuTitle: String(raw.customPortalConfig.menuTitle || baseDefaults.customPortalConfig.menuTitle),
          menuSubtitle: String(raw.customPortalConfig.menuSubtitle || baseDefaults.customPortalConfig.menuSubtitle),
          enabledForSupervisor: raw.customPortalConfig.enabledForSupervisor !== false,
          enabledForStudent: raw.customPortalConfig.enabledForStudent !== false,
          enableStartupPopup: raw.customPortalConfig.enableStartupPopup !== false,
          popupFrequency: raw.customPortalConfig.popupFrequency || 'every_open',
          items: Array.isArray(raw.customPortalConfig.items) ? raw.customPortalConfig.items : [],
        }
      : baseDefaults.customPortalConfig,
    supervisorMenus: {
      schedule: raw.supervisorMenus?.schedule !== undefined ? raw.supervisorMenus.schedule !== false : baseDefaults.supervisorMenus.schedule,
      exams: raw.supervisorMenus?.exams !== undefined ? raw.supervisorMenus.exams !== false : baseDefaults.supervisorMenus.exams,
      attendance: raw.supervisorMenus?.attendance !== undefined ? raw.supervisorMenus.attendance !== false : baseDefaults.supervisorMenus.attendance,
      violations: raw.supervisorMenus?.violations !== undefined ? raw.supervisorMenus.violations !== false : baseDefaults.supervisorMenus.violations,
      custom_portal: raw.supervisorMenus?.custom_portal !== undefined ? raw.supervisorMenus.custom_portal !== false : baseDefaults.supervisorMenus.custom_portal,
    },
    studentMenus: {
      schedule: raw.studentMenus?.schedule !== undefined ? raw.studentMenus.schedule !== false : baseDefaults.studentMenus.schedule,
      violations: raw.studentMenus?.violations !== undefined ? raw.studentMenus.violations !== false : baseDefaults.studentMenus.violations,
      custom_portal: raw.studentMenus?.custom_portal !== undefined ? raw.studentMenus.custom_portal !== false : baseDefaults.studentMenus.custom_portal,
    },
  };
};

export const getBundledAppSettings = () => {
  try {
    const cached = localStorage.getItem('appSettingsCache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        return sanitizeAppSettingsWithDefaults(parsed);
      }
    }
  } catch (e) {}

  return sanitizeAppSettingsWithDefaults();
};

export const getBundledUsers = (): any[] => {
  // Jika sudah pernah Restore dari File Backup (.JSON), gunakan data user dari Backup yang telah dipulihkan
  if (isCustomDataRestored()) {
    try {
      const raw = localStorage.getItem('cached_dashboard_users') || localStorage.getItem('cached_roster_catalog');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((u: any) => u && !isDemoUserRecord(u));
        }
      }
    } catch (e) {}
    return [];
  }

  // Jika aplikasi baru di-Remix ke database baru dan belum di-Restore, mulai bersih agar menyesuaikan data sekolah baru
  if (isRemixedNewDatabase()) {
    return [];
  }

  const list = (bundledSchoolData as any)?.users;
  return Array.isArray(list) ? list.filter((u: any) => u && !isDemoUserRecord(u)) : [];
};

export const getBundledPublicData = () => {
  // 1. Jika data telah di-Restore dari File Backup (.JSON), prioritaskan 100% data hasil Restore
  if (isCustomDataRestored()) {
    const readCachedArray = (key: string): any[] => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.map(hydrateRecordTimestamps);
        }
      } catch (e) {}
      return [];
    };

    const deletedIds = getDeletedExamIds();
    const restoredExamsMap = new Map<string, any>();
    readCachedArray('cached_dashboard_exams').forEach((e: any) => {
      if (e?.id) restoredExamsMap.set(String(e.id).trim(), e);
    });
    getCreatedExamsLocally().forEach((e: any) => {
      if (e?.id) {
        const prev = restoredExamsMap.get(String(e.id).trim());
        restoredExamsMap.set(String(e.id).trim(), mergeExamWithLocalOverride(prev, e));
      }
    });

    const exams = Array.from(restoredExamsMap.values())
      .filter((e: any) => e?.id && !deletedIds.has(String(e.id).trim()))
      .map(hydrateRecordTimestamps);
    const subjects = readCachedArray('cached_dashboard_subjects');
    const schedules = readCachedArray('cached_dashboard_schedules');
    const masterPlan = readCachedArray('cached_dashboard_masterPlan');
    const classrooms = readCachedArray('cached_dashboard_classrooms');
    const rooms = readCachedArray('cached_dashboard_rooms');
    const tokens = readCachedArray('cached_dashboard_tokens');
    return {
      exams,
      subjects,
      schedules,
      masterPlan,
      classrooms,
      rooms,
      tokens,
      activeTokens: tokens,
    };
  }

  // 2. Jika database baru hasil Remix (dan belum Restore Backup), kembalikan struktur bersih yang siap diisi data baru
  if (isRemixedNewDatabase()) {
    const deletedIds = getDeletedExamIds();
    const exams = getCreatedExamsLocally()
      .filter((e: any) => e?.id && !deletedIds.has(String(e.id).trim()))
      .map(hydrateRecordTimestamps);
    return {
      exams,
      subjects: [],
      schedules: [],
      masterPlan: [],
      classrooms: [],
      rooms: [],
      tokens: [],
      activeTokens: [],
    };
  }

  const pb = (bundledSchoolData as any)?.publicBundle || {};
  const cols = (bundledSchoolData as any)?.collections || {};

  const subjects = (Array.isArray(cols.subjects) && cols.subjects.length > 0 ? cols.subjects : (Array.isArray(pb.subjects) ? pb.subjects : [])).map(hydrateRecordTimestamps);
  if (!subjects.some((s: any) => String(s?.name || '').trim().toUpperCase() === 'SURVEY')) {
    subjects.push({ id: 'SURVEY', name: 'SURVEY' });
  }
  const subjectById = new Map<string, any>();
  const subjectByName = new Map<string, any>();
  subjects.forEach((s: any) => {
    if (s?.id) subjectById.set(String(s.id).trim(), s);
    if (s?.name) subjectByName.set(String(s.name).trim().toLowerCase(), s);
  });

  // Merge collection exams (has startTime, endTime, real subjectId) with publicBundle exams (has decrypted googleFormLink & subjectName)
  const rawExamsMap = new Map<string, any>();
  (Array.isArray(pb.exams) ? pb.exams : []).forEach((e: any) => {
    if (e?.id) rawExamsMap.set(e.id, { ...e });
  });
  (Array.isArray(cols.exams) ? cols.exams : []).forEach((e: any) => {
    if (e?.id) {
      const prev = rawExamsMap.get(e.id) || {};
      const matchedSubj = subjectById.get(e.subjectId) || subjectByName.get(String(prev.subjectName || e.subjectId || '').toLowerCase());
      rawExamsMap.set(e.id, {
        ...prev,
        ...e,
        subjectId: matchedSubj?.id || e.subjectId || prev.subjectId || '',
        subjectName: matchedSubj?.name || prev.subjectName || e.subjectName || '',
        googleFormLink: prev.googleFormLink || e.googleFormLink || '',
      });
    }
  });
  getCreatedExamsLocally().forEach((e: any) => {
    if (e?.id) {
      const prev = rawExamsMap.get(e.id);
      rawExamsMap.set(e.id, mergeExamWithLocalOverride(prev, e));
    }
  });

  const deletedIds = getDeletedExamIds();
  const exams = Array.from(rawExamsMap.values())
    .filter((e: any) => e?.id && !deletedIds.has(String(e.id).trim()))
    .map(hydrateRecordTimestamps);
  const schedules = (Array.isArray(cols.schedules) && cols.schedules.length > 0 ? cols.schedules : (Array.isArray(pb.schedules) ? pb.schedules : [])).map(hydrateRecordTimestamps);
  const masterPlan = (Array.isArray(cols.master_plan) && cols.master_plan.length > 0 ? cols.master_plan : (Array.isArray(pb.masterPlan) ? pb.masterPlan : [])).map(hydrateRecordTimestamps);
  const classrooms = (Array.isArray(cols.classrooms) ? cols.classrooms : []).map(hydrateRecordTimestamps);
  const rooms = (Array.isArray(cols.rooms) ? cols.rooms : []).map(hydrateRecordTimestamps);
  const tokens: any[] = [];
  const activeTokens: any[] = [];

  return {
    exams,
    subjects,
    schedules,
    masterPlan,
    classrooms,
    rooms,
    tokens,
    activeTokens,
  };
};

export const cleanDataForFirestore = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanDataForFirestore).filter((v: any) => v !== undefined);
  const res: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      res[k] = cleanDataForFirestore(v);
    }
  }
  return res;
};

let hasAttemptedRemixSeed = false;

/**
 * Ketika aplikasi di-Remix ke database baru, database TIDAK lagi ditimpa otomatis dengan data lama,
 * melainkan menyesuaikan dengan data baru yang diinput Admin atau hasil Restore dari File Backup (.JSON).
 */
export const seedBundledDataToFirestoreIfEmpty = async (dbInstance: any): Promise<void> => {
  if (!dbInstance || hasAttemptedRemixSeed || isFirestoreQuotaExhausted()) return;
  hasAttemptedRemixSeed = true;

  try {
    const appSnap = await getDoc(doc(dbInstance, 'settings', 'app'));
    const defaults = cleanDataForFirestore(sanitizeAppSettingsWithDefaults());
    if (appSnap.exists()) {
      const existing = appSnap.data() as any;
      const needsHeal =
        !existing?.logoUrl ||
        existing?.title === 'SISTEM UJIAN SEKOLAH' ||
        existing?.loginSubtitle === 'PENILAIAN AKADEMIK BERBASIS KOMPUTER';
      if (needsHeal) {
        const healed = cleanDataForFirestore(sanitizeAppSettingsWithDefaults(existing));
        await setDoc(doc(dbInstance, 'settings', 'app'), healed, { merge: true }).catch(() => {});
      }
      return;
    }

    // Jika database hasil Remix benar-benar baru/kosong, inisialisasi settings/app, public_bundle, dan roster_catalog secara otomatis
    await setDoc(doc(dbInstance, 'settings', 'app'), defaults, { merge: true }).catch(() => {});

    const bUsers = getBundledUsers();
    if (bUsers.length > 0) {
      const compactUsers = bUsers.slice(0, 1500).map((u: any) => ({
        id: String(u.id || u.uid || ''),
        uid: String(u.uid || u.id || ''),
        username: String(u.username || u.name || 'Peserta'),
        nis: u.nis ? String(u.nis).trim() : '',
        nip: u.nip ? String(u.nip).trim() : '',
        email: String(u.email || '').toLowerCase().trim(),
        role: String(u.role || 'siswa').toLowerCase().trim(),
        kelas: String(u.kelas || ''),
        ruang: String(u.ruang || ''),
        password: String(u.password || ''),
      }));
      await setDoc(
        doc(dbInstance, 'settings', 'roster_catalog'),
        {
          users: compactUsers,
          totalCount: compactUsers.length,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }

    const bPub = getBundledPublicData();
    if (bPub.exams.length > 0 || bPub.subjects.length > 0) {
      await setDoc(
        doc(dbInstance, 'settings', 'public_bundle'),
        {
          exams: bPub.exams.slice(0, 80).map((e: any) => ({
            ...e,
            startTime: e.startTime?.toMillis ? e.startTime.toMillis() : e.startTime || null,
            endTime: e.endTime?.toMillis ? e.endTime.toMillis() : e.endTime || null,
          })),
          subjects: bPub.subjects.slice(0, 60),
          schedules: bPub.schedules.slice(0, 80).map((s: any) => ({
            ...s,
            startTime: s.startTime?.toMillis ? s.startTime.toMillis() : s.startTime || null,
          })),
          masterPlan: bPub.masterPlan.slice(0, 25),
          spreadsheetWebAppUrl: defaults.spreadsheetWebAppUrl || DEFAULT_SPREADSHEET_WEBAPP_URL,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ).catch(() => {});
    }
  } catch (e) {
    checkAndHandleQuotaError(e);
  }
};

export const getSavedSpreadsheetUrl = (fromSettingsUrl?: string): string => {
  const cleanSettings = typeof fromSettingsUrl === 'string' ? fromSettingsUrl.trim() : '';
  if (cleanSettings && cleanSettings.startsWith('https://script.google.com/')) {
    try {
      localStorage.setItem(SPREADSHEET_URL_STORAGE_KEY, cleanSettings);
    } catch (e) {}
    return cleanSettings;
  }
  try {
    const saved = (localStorage.getItem(SPREADSHEET_URL_STORAGE_KEY) || '').trim();
    if (saved && saved.startsWith('https://script.google.com/')) return saved;
  } catch (e) {}
  return DEFAULT_SPREADSHEET_WEBAPP_URL;
};

export const saveSpreadsheetUrlLocally = (url: string) => {
  try {
    const clean = typeof url === 'string' ? url.trim() : '';
    if (clean) {
      localStorage.setItem(SPREADSHEET_URL_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(SPREADSHEET_URL_STORAGE_KEY);
    }
  } catch (e) {}
};

// Helper timeout 20 detik agar cold-start Google Apps Script di browser baru tidak terputus
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 20000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const EXAM_LINK_SECRET_KEY = 'ais-exam-secure-key';

export const decryptExamLinkForSheet = (encoded: string): string => {
  if (!encoded) return '';
  const trimmed = String(encoded).trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (!trimmed.includes('.') && trimmed.length > 10) {
    try {
      const decoded = decodeURIComponent(escape(atob(trimmed)));
      const plain = decoded
        .split('')
        .map((char, i) =>
          String.fromCharCode(char.charCodeAt(0) ^ EXAM_LINK_SECRET_KEY.charCodeAt(i % EXAM_LINK_SECRET_KEY.length))
        )
        .join('');
      if (plain.startsWith('http://') || plain.startsWith('https://') || plain.includes('.')) {
        return plain;
      }
    } catch {}
  }
  return trimmed;
};

/**
 * Mencari URL Google Apps Script di browser/perangkat baru:
 * Cek parameter URL -> localStorage -> appSettingsCache -> Firestore (settings/app & settings/public_bundle)
 */
export const resolveSpreadsheetUrl = async (
  explicitUrl?: string,
  dbInstance?: any
): Promise<string> => {
  // 1. Cek explicitUrl atau localStorage (Utama - 0ms tanpa ketergantungan Firebase)
  const direct = getSavedSpreadsheetUrl(explicitUrl);
  if (direct) return direct;

  // 2. Cek dari cache appSettingsCache bila ada
  try {
    const rawCache = localStorage.getItem('appSettingsCache');
    if (rawCache) {
      const parsed = JSON.parse(rawCache);
      if (parsed?.spreadsheetWebAppUrl && String(parsed.spreadsheetWebAppUrl).startsWith('https://script.google.com/')) {
        saveSpreadsheetUrlLocally(parsed.spreadsheetWebAppUrl);
        return String(parsed.spreadsheetWebAppUrl).trim();
      }
    }
  } catch (e) {}

  // 3. Cadangan Ke-2: Jika localStorage benar-benar kosong, cek Firestore dengan timeout cepat 2 detik agar tidak pernah menggantung
  if (dbInstance && !isFirestoreQuotaExhausted()) {
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const withShortTimeout = <T,>(p: Promise<T>, ms = 2000): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('TIMEOUT')), ms);
          p.then((v) => {
            clearTimeout(t);
            resolve(v);
          }).catch((err) => {
            clearTimeout(t);
            reject(err);
          });
        });

      const [appSnap, bundleSnap] = await Promise.allSettled([
        withShortTimeout(getDoc(doc(dbInstance, 'settings', 'app')), 2000),
        withShortTimeout(getDoc(doc(dbInstance, 'settings', 'public_bundle')), 2000),
      ]);

      if (appSnap.status === 'fulfilled' && appSnap.value.exists()) {
        const u1 = (appSnap.value.data()?.spreadsheetWebAppUrl || '').trim();
        if (u1 && u1.startsWith('https://script.google.com/')) {
          saveSpreadsheetUrlLocally(u1);
          return u1;
        }
      }
      if (bundleSnap.status === 'fulfilled' && bundleSnap.value.exists()) {
        const u2 = (bundleSnap.value.data()?.spreadsheetWebAppUrl || '').trim();
        if (u2 && u2.startsWith('https://script.google.com/')) {
          saveSpreadsheetUrlLocally(u2);
          return u2;
        }
      }
    } catch (e) {}
  }

  return DEFAULT_SPREADSHEET_WEBAPP_URL;
};

let cachedSpreadsheetSyncResult: SpreadsheetSyncResult | null = null;
let lastSpreadsheetSyncTimestamp = 0;
let inFlightSpreadsheetPromise: Promise<SpreadsheetSyncResult> | null = null;
let gasThrottledUntil = 0;

/**
 * PEMERIKSAAN KE-1 (BACA DARI GOOGLE SPREADSHEET):
 * Mengambil seluruh DATA_USER dan DATA_SOAL langsung dari Google Spreadsheet (Tanpa Kuota).
 * Otomatis mencari URL dari Firestore jika dibuka di browser/perangkat baru.
 * Dilengkapi proteksi deduplikasi request dan circuit-breaker agar 1.000 siswa tidak memicu HTTP 429.
 */
export const fetchMasterFromSpreadsheet = async (
  webAppUrl?: string,
  force = true,
  dbInstance?: any
): Promise<SpreadsheetSyncResult> => {
  // 1. Jika tidak dipaksa dan data di memori masih segar (< 3 menit), kembalikan langsung tanpa request HTTP
  if (!force && cachedSpreadsheetSyncResult && (Date.now() - lastSpreadsheetSyncTimestamp < 3 * 60 * 1000)) {
    return cachedSpreadsheetSyncResult;
  }

  // 2. Jika sedang ada request yang berjalan (in-flight), gunakan kembali promise tersebut (Deduplication)
  if (!force && inFlightSpreadsheetPromise) {
    return inFlightSpreadsheetPromise;
  }

  // 3. Circuit breaker jika Google Apps Script sebelumnya mengirimkan status 429 / 503 (Throttling)
  if (!force && Date.now() < gasThrottledUntil) {
    if (cachedSpreadsheetSyncResult) return cachedSpreadsheetSyncResult;
    try {
      const cachedUsersStr = localStorage.getItem('cached_roster_catalog') || localStorage.getItem('cached_dashboard_users');
      const cachedExamsStr = localStorage.getItem('cached_dashboard_exams');
      if (cachedUsersStr || cachedExamsStr) {
        return {
          ok: true,
          users: cachedUsersStr ? JSON.parse(cachedUsersStr) : [],
          exams: cachedExamsStr ? JSON.parse(cachedExamsStr) : [],
          message: 'Menggunakan data cache lokal (Google Apps Script cooldown)',
        };
      }
    } catch (e) {}
  }

  const executeFetch = async (): Promise<SpreadsheetSyncResult> => {
    const targetUrl = await resolveSpreadsheetUrl(webAppUrl, dbInstance);
    if (!targetUrl) {
      return { ok: false, message: 'URL Google Apps Script belum diatur.' };
    }

    try {
      const sep = targetUrl.includes('?') ? '&' : '?';
      // Untuk mengurangi beban konkurensi 1.000 siswa, jangan gunakan timestamp acak setiap milidetik jika force=false
      const cacheBustParam = force ? `_t=${Date.now()}` : `_v=${Math.floor(Date.now() / 60000)}`;
      const res = await fetchWithTimeout(`${targetUrl}${sep}action=getAll&${cacheBustParam}`, {
        method: 'GET',
        redirect: 'follow',
      }, 20000);

      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          gasThrottledUntil = Date.now() + 3 * 60 * 1000; // Cooldown 3 menit
        }
        return { ok: false, message: `HTTP ${res.status}` };
      }

      const data = await res.json();
      if (!data || data.status !== 'ok') {
        return { ok: false, message: data?.message || 'Respons Spreadsheet tidak valid.' };
      }

    const rawSheetUsers: any[] = Array.isArray(data.users)
      ? data.users
          .filter((u: any) => u && (u.username || u.nis || u.nip || u.email))
          .map((u: any, idx: number) => ({
            id: String(u.id || u.uid || u.nis || u.nip || `sheet_u_${idx}`).trim(),
            uid: String(u.uid || u.id || u.nis || u.nip || `sheet_u_${idx}`).trim(),
            username: String(u.username || u.nama || 'Siswa').trim(),
            role: String(u.role || 'siswa').toLowerCase().trim(),
            kelas: String(u.kelas || '-').trim(),
            ruang: String(u.ruang || '-').trim(),
            nis: String(u.nis || u.nisn || '').trim(),
            nip: String(u.nip || '').trim(),
            email: String(u.email || '').toLowerCase().trim(),
            password: String(u.password || u.nis || u.nip || '123456').trim(),
          }))
      : [];

    // Overlay locally updated user profiles (e.g., student who just added NIS/Email) so slow Spreadsheet sync never reverts them
    const localUpdatedUsers = getUpdatedUsersLocally();
    const mergedUsersList = [...rawSheetUsers];
    localUpdatedUsers.forEach((lu: any) => {
      const luId = String(lu.id || lu.uid || '').trim();
      const luNis = String(lu.nis || '').trim().toLowerCase();
      const luEmail = String(lu.email || '').trim().toLowerCase();
      const luName = String(lu.username || '').trim().toLowerCase();

      const matchIdx = mergedUsersList.findIndex((su: any) => {
        const sId = String(su.id || su.uid || '').trim();
        const sNis = String(su.nis || '').trim().toLowerCase();
        const sEmail = String(su.email || '').trim().toLowerCase();
        const sName = String(su.username || '').trim().toLowerCase();
        if (luId && sId && luId === sId) return true;
        if (luNis && sNis && luNis === sNis) return true;
        if (luEmail && sEmail && luEmail === sEmail) return true;
        if (luName && sName && luName === sName && String(lu.kelas || '') === String(su.kelas || '')) return true;
        return false;
      });

      if (matchIdx >= 0) {
        mergedUsersList[matchIdx] = {
          ...mergedUsersList[matchIdx],
          ...lu,
          nis: lu.nis || mergedUsersList[matchIdx].nis || '',
          nip: lu.nip || mergedUsersList[matchIdx].nip || '',
          email: lu.email || mergedUsersList[matchIdx].email || '',
          password: lu.password || mergedUsersList[matchIdx].password || '',
        };
      } else {
        mergedUsersList.push(lu);
      }
    });
    const users: any[] = mergedUsersList;

    const bundledPub = getBundledPublicData();
    const bundledExamById = new Map<string, any>();
    bundledPub.exams.forEach((be: any) => {
      if (be?.id) bundledExamById.set(String(be.id).trim(), be);
    });
    // Also index cached_dashboard_exams and createdExamsLocally so startTime/endTime of newly created exams are preserved
    try {
      const rawCachedEx = localStorage.getItem('cached_dashboard_exams');
      if (rawCachedEx) {
        const parsedCachedEx = JSON.parse(rawCachedEx);
        if (Array.isArray(parsedCachedEx)) {
          parsedCachedEx.forEach((ce: any) => {
            if (ce?.id) bundledExamById.set(String(ce.id).trim(), { ...(bundledExamById.get(String(ce.id).trim()) || {}), ...ce });
          });
        }
      }
    } catch (e) {}
    getCreatedExamsLocally().forEach((ce: any) => {
      if (ce?.id) bundledExamById.set(String(ce.id).trim(), mergeExamWithLocalOverride(bundledExamById.get(String(ce.id).trim()), ce));
    });

    const subjectByName = new Map<string, any>();
    const subjectById = new Map<string, any>();
    bundledPub.subjects.forEach((s: any) => {
      if (s?.id) subjectById.set(String(s.id).trim(), s);
      if (s?.name) subjectByName.set(String(s.name).trim().toLowerCase(), s);
    });

    const deletedIds = getDeletedExamIds();
    let extractedSysConfig: any = data.config || null;
    if (Array.isArray(data.exams)) {
      const sysRow = data.exams.find(
        (e: any) =>
          String(e?.id || '').trim() === '__SYS_APP_CONFIG__' ||
          String(e?.statusToken || '').toUpperCase().trim() === 'SYSTEM_CONFIG'
      );
      if (sysRow && sysRow.googleFormLink) {
        try {
          extractedSysConfig = JSON.parse(String(sysRow.googleFormLink));
        } catch {}
      }
    }

    const sheetExams: any[] = Array.isArray(data.exams)
      ? data.exams
          .filter((e: any) => e && (e.title || e.googleFormLink || e.link))
          .filter((e: any) => {
            const eid = String(e.id || '').trim();
            const status = String(e.statusToken || '').toUpperCase().trim();
            if (eid === '__SYS_APP_CONFIG__' || status === 'SYSTEM_CONFIG') return false;
            return !deletedIds.has(eid) && status !== 'HAPUS' && status !== 'DELETED';
          })
          .map((e: any, idx: number) => {
            const examId = String(e.id || `sheet_exam_${idx + 1}`).trim();
            const existingExam = bundledExamById.get(examId) || {};
            const rawStatus = String(e.statusToken || e.isTokenReleased || 'BUKA').toUpperCase().trim();
            const isExplicitLocked = rawStatus === 'KUNCI' || rawStatus === 'LOCKED' || e.adminLocked === true;
            const isArchivedExam = rawStatus === 'ARSIP' || e.isArchived === true;
            const isReleased = rawStatus === 'BUKA' || rawStatus === 'TRUE' || rawStatus === 'AKTIF' || rawStatus === '1' || !isExplicitLocked;
            const rawClasses = typeof e.classes === 'string'
              ? e.classes.split(',').map((c: string) => c.trim()).filter(Boolean)
              : (Array.isArray(e.classes) ? e.classes : []);

            const rawSubjName = String(e.subjectName || e.mapel || existingExam.subjectName || '').trim();
            const rawSubjId = String(e.subjectId || existingExam.subjectId || rawSubjName).trim();
            const matchedSubj = subjectById.get(rawSubjId) || subjectByName.get(rawSubjName.toLowerCase());

            const nowDefaultStart = new Date();
            nowDefaultStart.setHours(7, 30, 0, 0);
            const nowDefaultEnd = new Date();
            nowDefaultEnd.setHours(9, 0, 0, 0);

            return hydrateRecordTimestamps({
              ...existingExam,
              id: examId,
              title: String(e.title || e.namaUjian || existingExam.title || `Ujian ${idx + 1}`).trim(),
              subjectId: matchedSubj?.id || existingExam.subjectId || rawSubjId,
              subjectName: matchedSubj?.name || rawSubjName || existingExam.subjectName || '',
              googleFormLink: String(e.googleFormLink || e.link || existingExam.googleFormLink || '').trim(),
              startTime: e.startTime || existingExam.startTime || Timestamp.fromDate(nowDefaultStart),
              endTime: e.endTime || existingExam.endTime || Timestamp.fromDate(nowDefaultEnd),
              duration: Number(e.duration || e.durasi || existingExam.duration || 90) || 90,
              isActive:
                isArchivedExam ? false : (e.isActive !== false),
              isArchived:
                isArchivedExam,
              isTokenReleased: !isArchivedExam && !isExplicitLocked,
              adminLocked: !isArchivedExam && isExplicitLocked,
              tokenReleaseMode: e.tokenReleaseMode || existingExam.tokenReleaseMode || 'manual',
              assignments: rawClasses.length > 0
                ? [{ className: rawClasses.join(', '), classes: rawClasses }]
                : (Array.isArray(e.assignments) && e.assignments.length > 0 ? e.assignments : (existingExam.assignments || [])),
            });
          })
      : [];

    // Merge locally created/updated exams so they are never lost if Spreadsheet write is still in flight
    const mergedExamMap = new Map<string, any>();
    sheetExams.forEach((se: any) => {
      if (se?.id) mergedExamMap.set(String(se.id).trim(), se);
    });
    getCreatedExamsLocally().forEach((ce: any) => {
      const cid = String(ce?.id || '').trim();
      if (cid && !deletedIds.has(cid)) {
        mergedExamMap.set(cid, mergeExamWithLocalOverride(mergedExamMap.get(cid), ce));
      }
    });
    const exams = Array.from(mergedExamMap.values());

    let restoredAppSettings: any = undefined;
    let restoredSchedules: any[] | undefined = undefined;
    let restoredMasterPlan: any[] | undefined = undefined;
    let restoredSubjects: any[] | undefined = undefined;

    if (extractedSysConfig && typeof extractedSysConfig === 'object') {
      try {
        if (extractedSysConfig.appSettingsMeta || extractedSysConfig.customPortalConfig) {
          const existingRaw = localStorage.getItem('appSettingsCache');
          const existingParsed = existingRaw ? JSON.parse(existingRaw) : {};
          restoredAppSettings = sanitizeAppSettingsWithDefaults({
            ...existingParsed,
            ...(extractedSysConfig.appSettingsMeta || {}),
            ...(extractedSysConfig.customPortalConfig
              ? { customPortalConfig: extractedSysConfig.customPortalConfig }
              : {}),
          });
          localStorage.setItem('appSettingsCache', JSON.stringify(restoredAppSettings));
        }
        if (Array.isArray(extractedSysConfig.schedules) && extractedSysConfig.schedules.length > 0) {
          restoredSchedules = extractedSysConfig.schedules.map(hydrateRecordTimestamps);
          localStorage.setItem('cached_dashboard_schedules', JSON.stringify(extractedSysConfig.schedules));
        }
        if (Array.isArray(extractedSysConfig.masterPlan) && extractedSysConfig.masterPlan.length > 0) {
          restoredMasterPlan = extractedSysConfig.masterPlan;
          localStorage.setItem('cached_dashboard_masterPlan', JSON.stringify(extractedSysConfig.masterPlan));
        }
        if (Array.isArray(extractedSysConfig.subjects) && extractedSysConfig.subjects.length > 0) {
          restoredSubjects = extractedSysConfig.subjects;
          localStorage.setItem('cached_dashboard_subjects', JSON.stringify(extractedSysConfig.subjects));
        }
      } catch (e) {}
    }

    try {
      localStorage.setItem(SPREADSHEET_LAST_SYNC_KEY, String(Date.now()));
      if (users.length > 0) {
        localStorage.setItem('cached_roster_catalog', JSON.stringify(users));
        localStorage.setItem('cached_dashboard_users', JSON.stringify(users));
      }
      if (exams.length > 0) {
        localStorage.setItem('cached_dashboard_exams', JSON.stringify(exams));
      }
    } catch (e) {}

    return {
      ok: true,
      users,
      exams,
      subjects: restoredSubjects,
      schedules: restoredSchedules,
      masterPlan: restoredMasterPlan,
      appSettings: restoredAppSettings,
      updatedAt: data.updatedAt || new Date().toISOString(),
      message: `Berhasil memuat ${users.length} akun & ${exams.length} ujian dari Google Spreadsheet.`,
    };
    } catch (err: any) {
      return {
        ok: false,
        message: err?.message || 'Gagal menghubungi Google Spreadsheet, beralih ke Pemeriksaan Ke-2 (Firebase).',
      };
    }
  };

  inFlightSpreadsheetPromise = executeFetch().finally(() => {
    inFlightSpreadsheetPromise = null;
  });

  const finalResult = await inFlightSpreadsheetPromise;
  if (finalResult.ok) {
    cachedSpreadsheetSyncResult = finalResult;
    lastSpreadsheetSyncTimestamp = Date.now();
  }
  return finalResult;
};

/**
 * TULIS / SINKRONKAN SELURUH DATA MASTER (USER & SOAL) KE GOOGLE SPREADSHEET
 */
export const pushAllMasterToSpreadsheet = async (
  webAppUrl: string,
  payload: {
    users: any[];
    exams: any[];
    subjects?: any[];
    schedules?: any[];
    masterPlan?: any[];
    appSettings?: any;
  }
): Promise<SpreadsheetSyncResult> => {
  const targetUrl = getSavedSpreadsheetUrl(webAppUrl);
  if (!targetUrl) {
    return { ok: false, message: 'URL Google Apps Script belum diisi.' };
  }

  try {
    const cleanUsers = (payload.users || [])
      .filter((u: any) => u && !isDemoUserRecord(u))
      .map((u: any) => ({
        id: u.id || u.uid || '',
        username: u.username || u.name || '',
        role: u.role || 'siswa',
        kelas: u.kelas || '-',
        ruang: u.ruang || '-',
        nis: u.nis || u.nisn || '',
        nip: u.nip || '',
        email: u.email || '',
        password: u.password || u.nis || u.nip || '123456',
      }));

    const subjMap = new Map<string, string>();
    (payload.subjects || []).forEach((s: any) => {
      if (s?.id && s?.name) subjMap.set(s.id, s.name);
    });

    const cleanExams = (payload.exams || [])
      .filter((e: any) => e && String(e.id || '') !== '__SYS_APP_CONFIG__')
      .map((e: any) => ({
        id: e.id || '',
        title: e.title || '',
        subjectName: subjMap.get(e.subjectId) || e.subjectName || e.subjectId || '',
        classes: Array.isArray(e.assignments)
          ? e.assignments.map((a: any) => a.className || (a.classes || []).join(', ')).filter(Boolean).join(', ')
          : '',
        googleFormLink: decryptExamLinkForSheet(e.rawLink || e.googleFormLink || e.link || ''),
        statusToken: e.isArchived ? 'ARSIP' : (e.isTokenReleased && !e.adminLocked ? 'BUKA' : 'KUNCI'),
        duration: e.duration || 90,
      }));

    // Sisipkan juga konfigurasi menu custom (Hasil Ujian / Pengumuman / Pop-up), jadwal, dan mapel ke baris sistem Spreadsheet
    // sehingga ketika Tarik Data dari Spreadsheet dilakukan di perangkat baru, 100% konfigurasi ikut tertarik tanpa bergantung Firebase!
    try {
      let currentAppSettings = payload.appSettings;
      if (!currentAppSettings) {
        const rawApp = localStorage.getItem('appSettingsCache');
        if (rawApp) currentAppSettings = JSON.parse(rawApp);
      }
      let currentSchedules = payload.schedules;
      if (!currentSchedules) {
        const rawSc = localStorage.getItem('cached_dashboard_schedules');
        if (rawSc) currentSchedules = JSON.parse(rawSc);
      }
      let currentMasterPlan = payload.masterPlan;
      if (!currentMasterPlan) {
        const rawMp = localStorage.getItem('cached_dashboard_masterPlan');
        if (rawMp) currentMasterPlan = JSON.parse(rawMp);
      }
      let currentSubjects = payload.subjects;
      if (!currentSubjects || currentSubjects.length === 0) {
        const rawSub = localStorage.getItem('cached_dashboard_subjects');
        if (rawSub) currentSubjects = JSON.parse(rawSub);
      }

      const sysConfigObj = {
        customPortalConfig: currentAppSettings?.customPortalConfig || undefined,
        appSettingsMeta: currentAppSettings
          ? {
              title: currentAppSettings.title,
              loginSubtitle: currentAppSettings.loginSubtitle,
              allowGoogleLogin: currentAppSettings.allowGoogleLogin,
              allowSelfRegistration: currentAppSettings.allowSelfRegistration,
              allowStudentProfileEdit: currentAppSettings.allowStudentProfileEdit,
              allowSupervisorProfileEdit: currentAppSettings.allowSupervisorProfileEdit,
              allowStudentEditAcademic: currentAppSettings.allowStudentEditAcademic,
              allowSupervisorAddExam: currentAppSettings.allowSupervisorAddExam,
              allowSupervisorDeleteViolation: currentAppSettings.allowSupervisorDeleteViolation,
              allowSupervisorResetViolation: currentAppSettings.allowSupervisorResetViolation,
              allowStudentSelfReactivateToken: currentAppSettings.allowStudentSelfReactivateToken,
              studentViolationSoundEnabled: currentAppSettings.studentViolationSoundEnabled,
              exitCountdownSeconds: currentAppSettings.exitCountdownSeconds,
              supervisorMenus: currentAppSettings.supervisorMenus,
              studentMenus: currentAppSettings.studentMenus,
            }
          : undefined,
        subjects: Array.isArray(currentSubjects) ? currentSubjects.slice(0, 60) : undefined,
        schedules: Array.isArray(currentSchedules) ? currentSchedules.slice(0, 80) : undefined,
        masterPlan: Array.isArray(currentMasterPlan) ? currentMasterPlan.slice(0, 25) : undefined,
      };

      const sysJson = JSON.stringify(sysConfigObj);
      if (sysJson.length < 45000) {
        cleanExams.push({
          id: '__SYS_APP_CONFIG__',
          title: '__SYS_APP_CONFIG__',
          subjectName: 'SYSTEM_CONFIG',
          classes: 'ALL',
          googleFormLink: sysJson,
          statusToken: 'SYSTEM_CONFIG',
          duration: 0,
        });
      }
    } catch (e) {}

    const res = await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify({
          action: 'syncMaster',
          users: cleanUsers,
          exams: cleanExams,
        }),
      },
      20000
    );

    const visibleExamCount = cleanExams.filter((e: any) => e.id !== '__SYS_APP_CONFIG__').length;
    const data = await res.json();
    if (data && data.status === 'ok') {
      return {
        ok: true,
        message:
          data.message ||
          `Berhasil menulis ${cleanUsers.length} User, ${visibleExamCount} Soal & Konfigurasi ke Google Spreadsheet!`,
      };
    }
    return { ok: false, message: data?.message || 'Gagal menulis ke Google Spreadsheet.' };
  } catch (err: any) {
    return { ok: false, message: 'Gagal mengirim ke Spreadsheet: ' + (err?.message || 'Periksa URL Web App') };
  }
};

/**
 * TULIS / UPDATE 1 BARIS USER KE GOOGLE SPREADSHEET (Saat Admin/Siswa mengubah profil/password/tambah user)
 */
export const upsertUserToSpreadsheet = async (userObj: any, webAppUrl?: string): Promise<boolean> => {
  if (userObj) {
    saveUpdatedUserLocally(userObj);
  }
  const targetUrl = getSavedSpreadsheetUrl(webAppUrl);
  if (!targetUrl || !userObj) return false;

  try {
    const res = await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'upsertUser',
          user: {
            id: userObj.id || userObj.uid || '',
            username: userObj.username || userObj.name || '',
            role: userObj.role || 'siswa',
            kelas: userObj.kelas || '-',
            ruang: userObj.ruang || '-',
            nis: userObj.nis || userObj.nisn || '',
            nip: userObj.nip || '',
            email: userObj.email || '',
            password: userObj.password || userObj.nis || userObj.nip || '123456',
          },
        }),
      },
      5000
    );
    const data = await res.json();
    return data?.status === 'ok';
  } catch (e) {
    return false;
  }
};

/**
 * HAPUS 1 BARIS USER DARI GOOGLE SPREADSHEET
 */
export const deleteUserFromSpreadsheet = async (userId: string, webAppUrl?: string): Promise<boolean> => {
  if (userId) {
    removeUpdatedUserLocally(userId);
  }
  const targetUrl = getSavedSpreadsheetUrl(webAppUrl);
  if (!targetUrl || !userId) return false;
  try {
    const res = await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'deleteUser',
          id: userId,
        }),
      },
      5000
    );
    const data = await res.json();
    return data?.status === 'ok';
  } catch (e) {
    return false;
  }
};

/**
 * TULIS / UPDATE 1 BARIS SOAL UJIAN KE GOOGLE SPREADSHEET
 */
export const upsertExamToSpreadsheet = async (examObj: any, webAppUrl?: string): Promise<boolean> => {
  if (examObj && examObj.id) {
    saveCreatedExamLocally({
      ...examObj,
      googleFormLink: examObj.googleFormLink || examObj.link || examObj.rawLink || '',
    });
  }
  const targetUrl = getSavedSpreadsheetUrl(webAppUrl);
  if (!targetUrl || !examObj) return false;

  try {
    const res = await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'upsertExam',
          exam: {
            id: examObj.id || '',
            title: examObj.title || '',
            subjectName: examObj.subjectName || examObj.subjectId || '',
            classes: Array.isArray(examObj.assignments)
              ? examObj.assignments.map((a: any) => a.className || (a.classes || []).join(', ')).filter(Boolean).join(', ')
              : '',
            googleFormLink: decryptExamLinkForSheet(examObj.rawLink || examObj.googleFormLink || examObj.link || ''),
            statusToken: examObj.isArchived ? 'ARSIP' : (examObj.adminLocked && !examObj.isTokenReleased ? 'KUNCI' : 'BUKA'),
            duration: examObj.duration || 90,
          },
        }),
      },
      12000
    );
    const data = await res.json();
    return data?.status === 'ok';
  } catch (e) {
    return false;
  }
};

/**
 * HAPUS 1 BARIS SOAL UJIAN DARI GOOGLE SPREADSHEET (DAN SINKRONKAN DAFTAR SOAL TERSISA)
 */
export const deleteExamFromSpreadsheet = async (
  examId: string,
  remainingExams: any[] = [],
  subjects: any[] = [],
  webAppUrl?: string
): Promise<boolean> => {
  const targetUrl = getSavedSpreadsheetUrl(webAppUrl);
  if (!targetUrl || !examId) return false;

  try {
    // 1. Kosongkan baris soal yang dihapus via upsertExam (agar doGet otomatis melewati baris dengan title='' & link='' bahkan bila sisa soal 0)
    await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'upsertExam',
          exam: {
            id: examId,
            title: '',
            subjectName: '',
            classes: '',
            googleFormLink: '',
            statusToken: 'HAPUS',
            duration: 0,
          },
        }),
      },
      6000
    );

    // 2. Kirim juga aksi deleteExam (untuk script versi terbaru) atau syncMaster (bila masih ada soal tersisa)
    if (remainingExams.length > 0) {
      await pushAllMasterToSpreadsheet(targetUrl, {
        users: [],
        exams: remainingExams,
        subjects,
      });
    } else {
      await fetchWithTimeout(
        targetUrl,
        {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'deleteExam',
            id: examId,
          }),
        },
        5000
      ).catch(() => {});
    }
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * KODE LENGKAP GOOGLE APPS SCRIPT SIAP PAKAI (TINGGAL COPY-PASTE KE EKSTENSI -> APPS SCRIPT)
 */
export const GOOGLE_APPS_SCRIPT_TEMPLATE = `// ============================================================================
// GOOGLE APPS SCRIPT - DATABASE UJIAN ANTI-CURANG SMPN 2 SUTOJAYAN
// Menyimpan: 1) DATA_USER  2) DATA_SOAL  3) REKAP_TRANSAKSI (Baca & Tulis 2 Arah)
// ============================================================================

function ensureSheetsExist() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Sheet DATA_USER
  var userSheet = ss.getSheetByName('DATA_USER');
  if (!userSheet) {
    userSheet = ss.insertSheet('DATA_USER');
    userSheet.appendRow(['ID', 'NAMA_LENGKAP', 'ROLE', 'KELAS', 'RUANG', 'NIS_NISN', 'NIP', 'EMAIL', 'PASSWORD', 'UPDATED_AT']);
    userSheet.getRange('A1:J1').setFontWeight('bold').setBackground('#1d4ed8').setFontColor('#ffffff');
    userSheet.setFrozenRows(1);
  }
  
  // 2. Sheet DATA_SOAL
  var examSheet = ss.getSheetByName('DATA_SOAL');
  if (!examSheet) {
    examSheet = ss.insertSheet('DATA_SOAL');
    examSheet.appendRow(['ID_UJIAN', 'NAMA_UJIAN', 'MATA_PELAJARAN', 'KELAS_TARGET', 'LINK_GOOGLE_FORM', 'STATUS_TOKEN', 'DURASI_MENIT', 'UPDATED_AT']);
    examSheet.getRange('A1:H1').setFontWeight('bold').setBackground('#047857').setFontColor('#ffffff');
    examSheet.setFrozenRows(1);
  }

  // 3. Sheet REKAP_TRANSAKSI
  var txSheet = ss.getSheetByName('REKAP_TRANSAKSI');
  if (!txSheet) {
    txSheet = ss.insertSheet('REKAP_TRANSAKSI');
    txSheet.appendRow(['WAKTU', 'JENIS_TRANSAKSI', 'KODE_TOKEN', 'NAMA_UJIAN', 'NAMA_SISWA', 'KELAS', 'RUANG', 'KETERANGAN']);
    txSheet.getRange('A1:H1').setFontWeight('bold').setBackground('#b45309').setFontColor('#ffffff');
    txSheet.setFrozenRows(1);
  }
  
  return { ss: ss, userSheet: userSheet, examSheet: examSheet, txSheet: txSheet };
}

function doGet(e) {
  try {
    var sheets = ensureSheetsExist();
    
    // Baca DATA_USER
    var uValues = sheets.userSheet.getDataRange().getValues();
    var users = [];
    for (var i = 1; i < uValues.length; i++) {
      var r = uValues[i];
      if (!r[1] && !r[5] && !r[7]) continue;
      users.push({
        id: String(r[0] || ('usr_' + i)),
        username: String(r[1] || ''),
        role: String(r[2] || 'siswa').toLowerCase(),
        kelas: String(r[3] || '-'),
        ruang: String(r[4] || '-'),
        nis: String(r[5] || ''),
        nip: String(r[6] || ''),
        email: String(r[7] || ''),
        password: String(r[8] || r[5] || r[6] || '123456')
      });
    }

    // Baca DATA_SOAL
    var eValues = sheets.examSheet.getDataRange().getValues();
    var exams = [];
    for (var j = 1; j < eValues.length; j++) {
      var er = eValues[j];
      if (!er[1] && !er[4]) continue;
      exams.push({
        id: String(er[0] || ('exam_' + j)),
        title: String(er[1] || ''),
        subjectName: String(er[2] || ''),
        classes: String(er[3] || ''),
        googleFormLink: String(er[4] || ''),
        statusToken: String(er[5] || 'BUKA').toUpperCase(),
        duration: Number(er[6] || 90)
      });
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      users: users,
      exams: exams,
      updatedAt: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sheets = ensureSheetsExist();
    var body = JSON.parse(e.postData.contents || '{}');
    var action = body.action || '';
    var nowStr = new Date().toLocaleString('id-ID');

    // 1. SINKRONISASI PENUH DATA MASTER (USER & SOAL)
    if (action === 'syncMaster') {
      if (Array.isArray(body.users) && body.users.length > 0) {
        sheets.userSheet.clearContents();
        var uRows = [['ID', 'NAMA_LENGKAP', 'ROLE', 'KELAS', 'RUANG', 'NIS_NISN', 'NIP', 'EMAIL', 'PASSWORD', 'UPDATED_AT']];
        body.users.forEach(function(u) {
          uRows.push([
            u.id || '',
            u.username || '',
            u.role || 'siswa',
            u.kelas || '-',
            u.ruang || '-',
            u.nis || '',
            u.nip || '',
            u.email || '',
            u.password || '123456',
            nowStr
          ]);
        });
        sheets.userSheet.getRange(1, 1, uRows.length, uRows[0].length).setValues(uRows);
      }

      if (Array.isArray(body.exams) && body.exams.length > 0) {
        sheets.examSheet.clearContents();
        var eRows = [['ID_UJIAN', 'NAMA_UJIAN', 'MATA_PELAJARAN', 'KELAS_TARGET', 'LINK_GOOGLE_FORM', 'STATUS_TOKEN', 'DURASI_MENIT', 'UPDATED_AT']];
        body.exams.forEach(function(ex) {
          eRows.push([
            ex.id || '',
            ex.title || '',
            ex.subjectName || '',
            ex.classes || '',
            ex.googleFormLink || '',
            ex.statusToken || 'BUKA',
            ex.duration || 90,
            nowStr
          ]);
        });
        sheets.examSheet.getRange(1, 1, eRows.length, eRows[0].length).setValues(eRows);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: 'ok',
        message: 'Data User & Soal berhasil ditulis ke Google Spreadsheet!'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. TAMBAH / UPDATE 1 USER
    if (action === 'upsertUser' && body.user) {
      var u = body.user;
      var data = sheets.userSheet.getDataRange().getValues();
      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        var rowId = String(data[i][0] || '').trim();
        var rowName = String(data[i][1] || '').trim().toLowerCase();
        var rowNis = String(data[i][5] || '').trim();
        var rowEmail = String(data[i][7] || '').trim().toLowerCase();
        if (
          (u.id && rowId === String(u.id).trim()) ||
          (u.nis && rowNis && rowNis === String(u.nis).trim()) ||
          (u.email && rowEmail && rowEmail === String(u.email).trim().toLowerCase()) ||
          (u.username && rowName && rowName === String(u.username).trim().toLowerCase())
        ) {
          foundRow = i + 1;
          break;
        }
      }
      var rowVal = [u.id || '', u.username || '', u.role || 'siswa', u.kelas || '-', u.ruang || '-', u.nis || '', u.nip || '', u.email || '', u.password || '123456', nowStr];
      if (foundRow > 0) {
        sheets.userSheet.getRange(foundRow, 1, 1, rowVal.length).setValues([rowVal]);
      } else {
        sheets.userSheet.appendRow(rowVal);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. HAPUS 1 USER
    if (action === 'deleteUser' && body.id) {
      var uData = sheets.userSheet.getDataRange().getValues();
      for (var k = uData.length - 1; k >= 1; k--) {
        if (String(uData[k][0]) === String(body.id)) {
          sheets.userSheet.deleteRow(k + 1);
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. TAMBAH / UPDATE 1 SOAL UJIAN
    if (action === 'upsertExam' && body.exam) {
      var ex = body.exam;
      var eData = sheets.examSheet.getDataRange().getValues();
      var exRow = -1;
      for (var m = 1; m < eData.length; m++) {
        if (String(eData[m][0]) === String(ex.id)) {
          exRow = m + 1;
          break;
        }
      }
      var exVal = [ex.id || '', ex.title || '', ex.subjectName || '', ex.classes || '', ex.googleFormLink || '', ex.statusToken || 'BUKA', ex.duration || 90, nowStr];
      if (exRow > 0) {
        sheets.examSheet.getRange(exRow, 1, 1, exVal.length).setValues([exVal]);
      } else {
        sheets.examSheet.appendRow(exVal);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
`;
