import { 
  collection, 
  addDoc, 
  setDoc,
  updateDoc, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db, auth, isFirestoreQuotaExhausted, checkAndHandleQuotaError } from '../firebase';
import { getSavedSpreadsheetUrl } from '../lib/spreadsheetService';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  if (checkAndHandleQuotaError(error)) {
    return;
  }
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.warn('Firestore Notice: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const LOCAL_VIOLATIONS_REGISTRY_KEY = 'smpn2_shared_violations_registry';
const DELETED_VIOLATION_IDS_KEY = 'smpn2_deleted_violation_ids';

const withTimeout = <T>(promise: Promise<T>, ms = 3000): Promise<T> => {
  if (isFirestoreQuotaExhausted()) {
    return Promise.reject(new Error('FIRESTORE_QUOTA_EXHAUSTED'));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firestore timeout')), ms);
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

export const getDeletedViolationIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DELETED_VIOLATION_IDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map((x: any) => String(x).trim()).filter(Boolean));
      }
    }
  } catch (e) {}
  return new Set();
};

export const markViolationsDeletedLocally = (ids: string[], serverDeletedIds?: string[]): string[] => {
  const set = getDeletedViolationIds();
  (ids || []).forEach((id) => {
    if (id) set.add(String(id).trim());
  });
  (serverDeletedIds || []).forEach((id) => {
    if (id) set.add(String(id).trim());
  });
  const arr = Array.from(set).slice(-500);
  try {
    localStorage.setItem(DELETED_VIOLATION_IDS_KEY, JSON.stringify(arr));
  } catch (e) {}
  return arr;
};

export const getLocalViolationsRegistry = (): any[] => {
  try {
    const deletedSet = getDeletedViolationIds();
    const map = new Map<string, any>();
    for (const key of [LOCAL_VIOLATIONS_REGISTRY_KEY, 'cached_dashboard_violations']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((v: any) => {
          if (v && v.id && !deletedSet.has(String(v.id).trim())) {
            map.set(String(v.id), v);
          }
        });
      }
    }
    return Array.from(map.values()).sort((a: any, b: any) => {
      const tA = a.timestamp?.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp || 0).getTime();
      const tB = b.timestamp?.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp || 0).getTime();
      return tB - tA;
    });
  } catch (e) {
    return [];
  }
};

export const saveViolationToLocalRegistry = (violation: any): any[] => {
  if (!violation || !violation.id) return getLocalViolationsRegistry();
  const current = getLocalViolationsRegistry();
  const existsIdx = current.findIndex((v: any) => v.id === violation.id);
  let next: any[];
  if (existsIdx >= 0) {
    next = current.map((v: any, i: number) => (i === existsIdx ? { ...v, ...violation } : v));
  } else {
    next = [violation, ...current].slice(0, 250);
  }
  try {
    localStorage.setItem(LOCAL_VIOLATIONS_REGISTRY_KEY, JSON.stringify(next));
    localStorage.setItem('cached_dashboard_violations', JSON.stringify(next));
  } catch (e) {}
  return next;
};

/**
 * Sinkronkan daftar pelanggaran ke `settings/live_ops` (yang mengizinkan baca/tulis 200 OK
 * meskipun siswa/pengawas/admin login menggunakan NIS/NIP/Email tanpa Google OAuth).
 */
export const syncViolationToLiveOpsFirestore = async (violationRecord: any): Promise<void> => {
  if (!violationRecord || !violationRecord.id) return;
  try {
    const liveOpsRef = doc(db, 'settings', 'live_ops');
    const snap = await withTimeout(getDoc(liveOpsRef), 2500).catch(() => null);
    const deletedSet = getDeletedViolationIds();
    const existingList: any[] = snap && snap.exists() && Array.isArray(snap.data()?.violations)
      ? snap.data().violations
      : [];

    const map = new Map<string, any>();
    existingList.forEach((v: any) => {
      if (v && v.id && !deletedSet.has(String(v.id).trim())) {
        map.set(String(v.id), v);
      }
    });
    map.set(String(violationRecord.id), violationRecord);

    const merged = Array.from(map.values())
      .sort((a: any, b: any) => {
        const tA = a.timestamp?.toMillis ? a.timestamp.toMillis() : new Date(a.timestamp || 0).getTime();
        const tB = b.timestamp?.toMillis ? b.timestamp.toMillis() : new Date(b.timestamp || 0).getTime();
        return tB - tA;
      })
      .slice(0, 200);

    await withTimeout(
      setDoc(
        liveOpsRef,
        {
          violations: merged,
          deletedViolationIds: Array.from(deletedSet).slice(-300),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      ),
      3000
    );
  } catch (e) {
    // Non-blocking fallback
  }
};

export const markViolationsResetInLiveOps = async (
  violationIds: string[],
  studentId: string,
  examId: string,
  resetBy: string
): Promise<void> => {
  const nowIso = new Date().toISOString();
  const idSet = new Set((violationIds || []).map((x) => String(x)));

  // 1. Update local registry immediately
  try {
    const current = getLocalViolationsRegistry();
    const updatedLocal = current.map((v: any) => {
      if (idSet.has(String(v.id)) || (studentId && examId && v.studentId === studentId && v.examId === examId)) {
        return { ...v, isReset: true, resetAt: nowIso, resetBy };
      }
      return v;
    });
    localStorage.setItem(LOCAL_VIOLATIONS_REGISTRY_KEY, JSON.stringify(updatedLocal));
    localStorage.setItem('cached_dashboard_violations', JSON.stringify(updatedLocal));
  } catch (e) {}

  // 2. Update settings/live_ops in Firestore
  try {
    const liveOpsRef = doc(db, 'settings', 'live_ops');
    const snap = await withTimeout(getDoc(liveOpsRef), 2500).catch(() => null);
    if (snap && snap.exists()) {
      const data = snap.data() || {};
      const existingViolations: any[] = Array.isArray(data.violations) ? data.violations : [];
      const updatedViolations = existingViolations.map((v: any) => {
        if (idSet.has(String(v.id)) || (studentId && examId && v.studentId === studentId && v.examId === examId)) {
          return { ...v, isReset: true, resetAt: nowIso, resetBy };
        }
        return v;
      });
      const existingTokens: any[] = Array.isArray(data.tokens) ? data.tokens : [];
      const updatedTokens = existingTokens.map((t: any) => {
        if (examId && t.examId !== examId) return t;
        const usedBy = (t.usedBy || []).filter((uid: string) => uid !== studentId);
        const usedByDetails = (t.usedByDetails || []).map((d: any) =>
          d.uid === studentId ? { ...d, isReset: true, status: 'reset', resetAt: nowIso, resetBy } : d
        );
        return { ...t, usedBy, usedByDetails };
      });
      await withTimeout(
        setDoc(
          liveOpsRef,
          {
            violations: updatedViolations,
            tokens: updatedTokens,
            updatedAt: nowIso,
          },
          { merge: true }
        ),
        3000
      );
    }
  } catch (e) {}
};

export const deleteViolationsFromLiveOps = async (violationIds: string[], clearAll = false): Promise<void> => {
  try {
    const liveOpsRef = doc(db, 'settings', 'live_ops');
    const snap = await withTimeout(getDoc(liveOpsRef), 2500).catch(() => null);
    const existingViolations: any[] = snap && snap.exists() && Array.isArray(snap.data()?.violations)
      ? snap.data().violations
      : [];

    const allIdsToDelete = clearAll
      ? [
          ...existingViolations.map((v: any) => String(v.id)),
          ...getLocalViolationsRegistry().map((v: any) => String(v.id)),
        ]
      : violationIds.map((x) => String(x));

    const deletedList = markViolationsDeletedLocally(allIdsToDelete);
    const deletedSet = new Set(deletedList);

    const remainingLocal = clearAll
      ? []
      : getLocalViolationsRegistry().filter((v: any) => !deletedSet.has(String(v.id)));
    try {
      localStorage.setItem(LOCAL_VIOLATIONS_REGISTRY_KEY, JSON.stringify(remainingLocal));
      localStorage.setItem('cached_dashboard_violations', JSON.stringify(remainingLocal));
    } catch (e) {}

    const remainingRemote = clearAll
      ? []
      : existingViolations.filter((v: any) => !deletedSet.has(String(v.id)));

    const payload: Record<string, any> = {
      violations: remainingRemote,
      deletedViolationIds: deletedList.slice(-300),
      updatedAt: new Date().toISOString(),
    };
    if (clearAll) {
      payload.tokens = [];
    }

    await withTimeout(setDoc(liveOpsRef, payload, { merge: true }), 3000);
  } catch (e) {}
};

// User Services
export const createUserProfile = async (uid: string, username: string, email: string, role: string) => {
  const path = `users/${uid}`;
  try {
    await addDoc(collection(db, 'users'), {
      uid,
      username,
      email,
      role,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

// Exam Services
export const createExam = async (title: string, googleFormLink: string) => {
  const path = 'exams';
  try {
    await addDoc(collection(db, path), {
      title,
      googleFormLink,
      isActive: true,
      createdBy: auth.currentUser?.uid || 'admin',
      createdAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

// Token Services
export const generateToken = async (examId: string, createdBy?: string, creatorName?: string, creatorRuang?: string) => {
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 2); // 2 hours expiry

  const path = 'tokens';
  try {
    const docRef = await addDoc(collection(db, path), {
      code,
      examId,
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: serverTimestamp(),
      createdBy: createdBy || auth.currentUser?.uid || 'admin',
      creatorName: creatorName || auth.currentUser?.displayName || 'Pengawas',
      creatorRuang: creatorRuang || '',
      usedBy: [],
      usedByDetails: []
    });
    return { id: docRef.id, code };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

// Violation Services
export const reportViolation = async (
  studentId: string, 
  studentName: string, 
  kelas: string, 
  ruang: string, 
  examId: string, 
  examTitle: string, 
  subjectName: string,
  type: string,
  tokenCode?: string,
  tokenCreatorId?: string
) => {
  const path = 'violations';
  const nowIso = new Date().toISOString();
  const generatedId = `viol_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

  const baseRecord = {
    studentId: studentId || 'siswa',
    studentName: studentName || 'Siswa',
    kelas: kelas || '-',
    ruang: ruang || '-',
    examId: examId || '',
    examTitle: examTitle || 'Ujian',
    subjectName: subjectName || 'Umum',
    type: type || 'Pelanggaran Aturan Ujian',
    tokenCode: tokenCode || '',
    tokenCreatorId: tokenCreatorId || '',
    isReset: false,
  };

  const fullRecord = {
    id: generatedId,
    ...baseRecord,
    timestamp: nowIso,
  };

  // 1. LANGSUNG simpan ke localStorage & BroadcastChannel dalam 0ms agar tidak pernah hilang
  saveViolationToLocalRegistry(fullRecord);
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel('smpn2_violation_sync_channel');
      bc.postMessage({ type: 'NEW_VIOLATION_RECORDED', violation: fullRecord });
      bc.close();
    }
  } catch (e) {}

  // 2. Simpan paralel ke settings/live_ops (200 OK tanpa Google Auth) + koleksi violations + Google Spreadsheet
  await Promise.allSettled([
    syncViolationToLiveOpsFirestore(fullRecord),
    withTimeout(
      setDoc(doc(db, path, generatedId), {
        ...baseRecord,
        timestamp: serverTimestamp(),
      }),
      2500
    ),
    (async () => {
      try {
        const sheetUrl = getSavedSpreadsheetUrl();
        if (sheetUrl) {
          await fetch(sheetUrl, {
            method: 'POST',
            redirect: 'follow',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'logTransaction',
              transaction: {
                timestamp: nowIso,
                type: 'PELANGGARAN',
                tokenCode: baseRecord.tokenCode,
                examTitle: baseRecord.examTitle,
                studentName: baseRecord.studentName,
                kelas: baseRecord.kelas,
                ruang: baseRecord.ruang,
                notes: `${baseRecord.type} (ID:${generatedId}|SID:${baseRecord.studentId}|EID:${baseRecord.examId})`,
              },
            }),
          });
        }
      } catch (e) {}
    })(),
  ]);

  return fullRecord;
};
