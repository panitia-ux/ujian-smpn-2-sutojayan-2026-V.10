import React, { useState, useMemo, useEffect } from 'react';
import {
  Activity,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  Unlock,
  RefreshCw,
  Search,
  Filter,
  School,
  Radio,
  Eye,
  ShieldAlert,
  Wifi,
  Sparkles,
  ChevronRight,
  BookOpen,
  Calendar,
  Layers,
  ArrowUpRight,
  Key,
  History,
  ArrowUpDown,
  FileText,
  Printer,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Award
} from 'lucide-react';
import { normalizeRoomName } from '../lib/classConstants';
import {
  getCachedSupervisorsPresence,
  getManualOnlineSupervisors,
  setManualOnlineSupervisor,
  listenSupervisorsPresence,
  checkIsSupervisorOnline,
  normalizeSupervisorEmail,
  normalizeSupervisorName,
  SupervisorPresenceRecord
} from '../lib/presenceService';

export interface StudentMonitoringRecord {
  uid: string;
  name: string;
  nis?: string;
  email?: string;
  kelas?: string;
  ruang?: string;
  tokenCode?: string;
  tokenId?: string;
  examId?: string;
  examTitle?: string;
  status: 'working' | 'finished' | 'violation' | 'idle' | 'reset';
  isReset?: boolean;
  startedAt?: string;
  finishedAt?: string;
  reEnteredAt?: string;
  lastHeartbeat?: string | number;
  violationCount?: number;
  latestViolationType?: string;
  creatorName?: string;
  creatorRuang?: string;
}

export interface SupervisorMonitoringRecord {
  uid: string;
  name: string;
  email?: string;
  nip?: string;
  ruang: string;
  status: 'active' | 'standby' | 'offline';
  lastActive: string | number;
  hasReleasedToken: boolean;
  latestTokenCode?: string;
  latestTokenExam?: string;
  latestTokenTime?: any;
  activeTokens: {
    id: string;
    code: string;
    examTitle: string;
    createdAt?: any;
    releasedAt?: any;
    expiresAt?: number | string;
    creatorRuang?: string;
    creatorName?: string;
    creatorEmail?: string;
    studentCount: number;
    workingCount: number;
    finishedCount: number;
    violationCount: number;
    students: StudentMonitoringRecord[];
  }[];
  totalStudents: number;
  workingStudents: number;
  finishedStudents: number;
  violationStudents: number;
}

export interface SupervisorHistoryGroup {
  supervisorKey: string;
  uid: string;
  name: string;
  email: string;
  nip?: string;
  ruang: string;
  status: 'active' | 'standby' | 'offline';
  hasReleasedToken: boolean;
  tokens: {
    id: string;
    code: string;
    examId?: string;
    examTitle: string;
    creatorName: string;
    creatorEmail: string;
    creatorRuang: string;
    createdBy: string;
    createdAt?: any;
    expiresAt?: any;
    isActive: boolean;
    isExpired: boolean;
    participants: StudentMonitoringRecord[];
    studentCount: number;
    workingCount: number;
    finishedCount: number;
    violationCount: number;
  }[];
  totalTokensCount: number;
  totalParticipantsCount: number;
  totalWorkingCount: number;
  totalFinishedCount: number;
  totalViolationCount: number;
}

interface LiveMonitoringDashboardProps {
  role: 'admin' | 'pengawas' | 'siswa';
  currentUser: any;
  userProfile: any;
  effectiveSupervisorRuang?: string;
  effectiveSupervisorEmail?: string;
  effectiveSupervisorName?: string;
  effectiveSupervisorUid?: string;
  simulatedSupervisorEmail?: string;
  onSimulateSupervisor?: (email: string) => void;
  tokens: any[];
  users: any[];
  violations: any[];
  exams: any[];
  rooms: any[];
  classrooms: any[];
  masterPlan?: any[];
  onResetStudentToken?: (tokenId: string, studentUid: string, studentName?: string) => Promise<void> | void;
  onRefreshData?: () => void;
  isSuperAdmin?: boolean;
}

export const parseTimestampMs = (val: any): number => {
  if (!val) return 0;
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (typeof val?.toDate === 'function') return val.toDate().getTime();
  if (typeof val === 'number') {
    return val > 100000000000 ? val : val * 1000;
  }
  if (typeof val === 'object' && typeof val.seconds === 'number') {
    return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
  }
  if (typeof val === 'object' && typeof val._seconds === 'number') {
    return val._seconds * 1000 + Math.floor((val._nanoseconds || 0) / 1000000);
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

export const LiveMonitoringDashboard: React.FC<LiveMonitoringDashboardProps> = ({
  role,
  currentUser,
  userProfile,
  effectiveSupervisorRuang,
  effectiveSupervisorEmail,
  effectiveSupervisorName,
  effectiveSupervisorUid,
  simulatedSupervisorEmail,
  onSimulateSupervisor,
  tokens = [],
  users = [],
  violations = [],
  exams = [],
  rooms = [],
  classrooms = [],
  masterPlan = [],
  onResetStudentToken,
  onRefreshData,
  isSuperAdmin = false,
}) => {
  const isAdmin = role === 'admin';
  const isPengawas = role === 'pengawas';

  // Live Supervisor Presence state (Firestore + BroadcastChannel + LocalStorage)
  const [presenceMap, setPresenceMap] = useState<Record<string, SupervisorPresenceRecord>>(() => getCachedSupervisorsPresence());
  const [manualOnlineSet, setManualOnlineSet] = useState<Set<string>>(() => getManualOnlineSupervisors());

  useEffect(() => {
    const cleanup = listenSupervisorsPresence((updatedMap) => {
      setPresenceMap(updatedMap);
      setManualOnlineSet(getManualOnlineSupervisors());
    });
    return cleanup;
  }, []);

  const targetSupervisorRoom = useMemo(() => {
    const raw = effectiveSupervisorRuang || userProfile?.ruang || (currentUser as any)?.ruang || 'Ruang 01';
    return normalizeRoomName(raw) || 'Ruang 01';
  }, [effectiveSupervisorRuang, userProfile?.ruang, currentUser]);

  const [activeAdminSubTab, setActiveAdminSubTab] = useState<'supervisors' | 'students' | 'history'>('supervisors');
  const [supervisorFilter, setSupervisorFilter] = useState<'ALL' | 'RELEASED' | 'PENDING' | 'ONLINE'>('ALL');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('ALL');
  const [selectedTokenFilter, setSelectedTokenFilter] = useState<string>('ALL');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'working' | 'finished' | 'violation' | 'idle'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [focusedStudent, setFocusedStudent] = useState<StudentMonitoringRecord | null>(null);

  // Opsi Pengurutan Fleksibel (Sesuai Nama, Sesuai Yang Dipilih, Penggabungan)
  const [studentSortBy, setStudentSortBy] = useState<'status' | 'name_asc' | 'name_desc' | 'class_room' | 'started_desc' | 'combined'>('status');
  const [supervisorSortBy, setSupervisorSortBy] = useState<'token_active' | 'name_asc' | 'name_desc' | 'room' | 'students_desc' | 'combined'>('token_active');

  // Filter & Pengurutan untuk Tab Histori Token & Peserta Pengawas
  const [historySupervisorFilter, setHistorySupervisorFilter] = useState<string>('ALL');
  const [historyExamFilter, setHistoryExamFilter] = useState<string>('ALL');
  const [historyRoomFilter, setHistoryRoomFilter] = useState<string>('ALL');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [historySortBy, setHistorySortBy] = useState<'latest_token' | 'oldest_token' | 'sup_name_asc' | 'sup_name_desc' | 'most_students' | 'combined'>('latest_token');
  const [historyViewMode, setHistoryViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [selectedSupervisorModal, setSelectedSupervisorModal] = useState<SupervisorMonitoringRecord | null>(null);
  const [copiedTokenCode, setCopiedTokenCode] = useState<string | null>(null);
  const [expandedHistoryTokens, setExpandedHistoryTokens] = useState<Set<string>>(new Set());

  // Interval realtime auto-refresh timer display (per detik)
  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Format durasi (misal: "35m" atau "1j 12m")
  const formatDuration = (startIso?: string, finishIso?: string) => {
    if (!startIso) return '-';
    try {
      const startMs = new Date(startIso).getTime();
      const endMs = finishIso ? new Date(finishIso).getTime() : nowMs;
      const diffMs = Math.max(0, endMs - startMs);
      const minutes = Math.floor(diffMs / 60000);
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}j ${remainingMinutes}m`;
    } catch {
      return '-';
    }
  };

  const formatClock = (iso?: string) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '-';
    }
  };

  const formatDateTimeId = (val: any): string => {
    if (!val) return '-';
    try {
      let dateObj: Date;
      if (typeof val?.toDate === 'function') dateObj = val.toDate();
      else if (typeof val === 'number') dateObj = new Date(val > 100000000000 ? val : val * 1000);
      else if (typeof val === 'string') dateObj = new Date(val);
      else if (val?.seconds) dateObj = new Date(val.seconds * 1000);
      else return '-';

      if (isNaN(dateObj.getTime())) return '-';
      return dateObj.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '-';
    }
  };

  const handleCopyToken = (code: string) => {
    if (!code) return;
    try {
      navigator.clipboard.writeText(code);
      setCopiedTokenCode(code);
      setTimeout(() => setCopiedTokenCode(null), 2500);
    } catch (e) {
      console.warn('Copy clipboard failed:', e);
    }
  };

  // Safe iframe-based print utility (no window.open, no window.alert)
  const handlePrintHtml = (title: string, htmlContent: string) => {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) return;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      iframe.contentWindow?.focus();
      setTimeout(() => {
        try {
          iframe.contentWindow?.print();
        } catch (err) {
          console.error('Print iframe error:', err);
        }
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch (e) {}
        }, 3000);
      }, 400);
    } catch (e) {
      console.error('Print error:', e);
    }
  };

  // 1. Ekstraksi seluruh sesi siswa dari daftar tokens & usedByDetails
  const allStudentRecords = useMemo<StudentMonitoringRecord[]>(() => {
    const list: StudentMonitoringRecord[] = [];
    const seenStudentExam = new Set<string>();

    tokens.forEach((t: any) => {
      const tokenId = String(t.id || '');
      const tokenCode = String(t.code || '').toUpperCase().trim();
      const examId = String(t.examId || '');
      const examTitle = String(
        t.examTitle || exams.find((e: any) => e.id === examId)?.title || 'Ujian Sekolah'
      );
      const creatorName = String(t.creatorName || 'Pengawas');
      const creatorRuang = String(t.creatorRuang || '');

      const details: any[] = Array.isArray(t.usedByDetails) ? t.usedByDetails : [];
      details.forEach((d: any) => {
        if (!d) return;
        const uid = String(d.uid || d.studentId || '');
        if (!uid) return;

        const compositeKey = `${uid}_${examId || tokenCode}`;
        if (seenStudentExam.has(compositeKey)) return;
        seenStudentExam.add(compositeKey);

        // Cari profil tambahan siswa dari users catalog
        const userObj = users.find(
          (u: any) =>
            u.uid === uid ||
            u.id === uid ||
            (d.nis && u.nis && String(u.nis).trim() === String(d.nis).trim()) ||
            (d.name && u.username && String(u.username).trim().toLowerCase() === String(d.name).trim().toLowerCase())
        );

        // Cari apakah ada pelanggaran aktif
        const matchingViolations = violations.filter((v: any) => {
          const matchStudent =
            (v.studentId && v.studentId === uid) ||
            (v.studentName && d.name && v.studentName.toLowerCase().trim() === d.name.toLowerCase().trim());
          const matchExamOrToken =
            (examId && v.examId === examId) ||
            (tokenCode && String(v.tokenCode || '').toUpperCase().trim() === tokenCode);
          return matchStudent && matchExamOrToken;
        });

        const activeViolation = matchingViolations.find((v: any) => !v.isReset);
        const hasViolations = matchingViolations.length > 0;
        const latestViol = matchingViolations[0];

        // Tentukan status siswa
        let calculatedStatus: 'working' | 'finished' | 'violation' | 'idle' | 'reset' = 'working';
        if (activeViolation || d.status === 'violation') {
          calculatedStatus = 'violation';
        } else if (d.status === 'finished' || d.finishedAt) {
          calculatedStatus = 'finished';
        } else if (d.isReset) {
          calculatedStatus = 'reset';
        } else if (d.status === 'working') {
          // Cek idle / timeout jika heartbeat > 10 menit
          const startMs = d.reEnteredAt
            ? new Date(d.reEnteredAt).getTime()
            : d.timestamp
            ? new Date(d.timestamp).getTime()
            : 0;
          if (startMs > 0 && nowMs - startMs > 150 * 60 * 1000) {
            calculatedStatus = 'idle';
          } else {
            calculatedStatus = 'working';
          }
        } else {
          calculatedStatus = 'idle';
        }

        list.push({
          uid,
          name: String(d.name || userObj?.username || userObj?.name || 'Siswa'),
          nis: String(d.nis || userObj?.nis || ''),
          email: String(d.email || userObj?.email || ''),
          kelas: String(d.kelas || userObj?.kelas || '-'),
          ruang: String(d.ruang || userObj?.ruang || creatorRuang || '-'),
          tokenCode,
          tokenId,
          examId,
          examTitle,
          status: calculatedStatus,
          isReset: Boolean(d.isReset),
          startedAt: d.timestamp || d.reEnteredAt,
          finishedAt: d.finishedAt,
          reEnteredAt: d.reEnteredAt,
          violationCount: matchingViolations.length,
          latestViolationType: latestViol?.type || activeViolation?.type,
          creatorName,
          creatorRuang,
        });
      });
    });

    // 2. Tambahkan juga daftar seluruh siswa terdaftar dari Master Data User (role 'siswa')
    // agar kotak siswa di ruang tugas tetap muncul dengan status 'Belum Masuk / Menunggu Token'
    // sebelum siswa mulai mengetik token (sehingga layar monitoring tidak kosong 0 siswa!)
    const seenUids = new Set(list.map((s) => s.uid));
    const studentUsers = users.filter((u: any) => String(u.role || '').toLowerCase().trim() === 'siswa');
    studentUsers.forEach((stu: any) => {
      const sUid = String(stu.uid || stu.id || '');
      if (!sUid || seenUids.has(sUid)) return;
      seenUids.add(sUid);
      list.push({
        uid: sUid,
        name: String(stu.username || stu.name || 'Siswa'),
        nis: String(stu.nis || stu.nisn || ''),
        email: String(stu.email || ''),
        kelas: String(stu.kelas || '-'),
        ruang: String(stu.ruang || '-'),
        tokenCode: '',
        tokenId: '',
        examId: '',
        examTitle: 'Menunggu Siswa Memulai Ujian',
        status: 'idle',
        isReset: false,
        violationCount: 0,
        creatorName: '-',
        creatorRuang: stu.ruang || '-',
      });
    });

    return list.sort((a, b) => {
      // Prioritaskan pelanggaran di atas agar pengawas langsung melihat yang butuh tindakan
      if (a.status === 'violation' && b.status !== 'violation') return -1;
      if (b.status === 'violation' && a.status !== 'violation') return 1;
      if (a.status === 'working' && b.status !== 'working') return -1;
      if (b.status === 'working' && a.status !== 'working') return 1;
      if (a.status === 'finished' && b.status === 'idle') return -1;
      if (a.status === 'idle' && b.status === 'finished') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [tokens, exams, users, violations, nowMs]);

  // 1. Daftar token yang HANYA dirilis oleh akun Pengawas ini sendiri atau khusus ruangannya / token global Admin
  const mySupervisorTokens = useMemo(() => {
    if (!isPengawas || isAdmin) return tokens;
    const myUid = effectiveSupervisorUid || currentUser?.uid || userProfile?.uid || userProfile?.id;
    const myEmail = (effectiveSupervisorEmail || currentUser?.email || userProfile?.email || '').toLowerCase().trim();
    const myName = (effectiveSupervisorName || userProfile?.username || userProfile?.name || currentUser?.displayName || '').toLowerCase().trim();

    return tokens.filter((t: any) => {
      const matchUid = t.createdBy && myUid && String(t.createdBy).trim() === String(myUid).trim();
      const matchEmail = t.creatorEmail && myEmail && String(t.creatorEmail).toLowerCase().trim() === myEmail;
      const matchName = t.creatorName && myName && String(t.creatorName).toLowerCase().trim() === myName;
      const matchRoom = targetSupervisorRoom && t.creatorRuang && normalizeRoomName(t.creatorRuang) === targetSupervisorRoom;
      const matchGlobal = Boolean(t.isGlobalForAllWindows || t.creatorRuang === 'Semua Ruang');
      return Boolean(matchUid || matchEmail || matchName || matchRoom || matchGlobal);
    });
  }, [tokens, isPengawas, isAdmin, effectiveSupervisorUid, effectiveSupervisorEmail, effectiveSupervisorName, targetSupervisorRoom, currentUser, userProfile]);

  const mySupervisorTokenCodes = useMemo(() => {
    return new Set(mySupervisorTokens.map((t: any) => String(t.code || '').toUpperCase().trim()));
  }, [mySupervisorTokens]);

  // 2. Filter siswa sesuai role Pengawas atau Admin
  const visibleStudentRecords = useMemo(() => {
    let result = allStudentRecords;

    // Jika Pengawas, HANYA tampilkan status siswa yang ada di ruangannya sendiri atau pemakai tokennya!
    if (isPengawas && !isAdmin) {
      result = result.filter((s) => {
        const studentRoom = normalizeRoomName(s.ruang || '');
        const tokenRoom = normalizeRoomName(s.creatorRuang || '');

        // 1. MUTLAK: Jika siswa memakai token yang dirilis pengawas ini, SELALU tampilkan!
        const isUsingMyToken = Boolean(s.tokenCode && mySupervisorTokenCodes.has(s.tokenCode.toUpperCase().trim()));
        if (isUsingMyToken) return true;

        // 2. Jika pengawas memiliki ruang tugas, tampilkan seluruh siswa di ruangannya (termasuk yang belum masuk)
        if (targetSupervisorRoom) {
          const isMyRoom = (studentRoom && studentRoom === targetSupervisorRoom) || (tokenRoom && tokenRoom === targetSupervisorRoom);
          if (isMyRoom) return true;
        }

        // 3. Fallback jika nama pembuat token cocok
        if (s.creatorName && effectiveSupervisorName && s.creatorName.toLowerCase().trim() === effectiveSupervisorName.toLowerCase().trim()) {
          return true;
        }

        return false;
      });
    }

    // Filter Ruang (Khusus Admin yang dapat memfilter antar ruang)
    if (isAdmin && selectedRoomFilter !== 'ALL') {
      result = result.filter(
        (s) => normalizeRoomName(s.ruang || '') === normalizeRoomName(selectedRoomFilter)
      );
    }

    // Filter Token
    if (selectedTokenFilter !== 'ALL') {
      result = result.filter(
        (s) => (s.tokenCode || '').toUpperCase().trim() === selectedTokenFilter.toUpperCase().trim()
      );
    }

    // Filter Kelas
    if (selectedClassFilter !== 'ALL') {
      result = result.filter(
        (s) => (s.kelas || '').toUpperCase().trim() === selectedClassFilter.toUpperCase().trim()
      );
    }

    // Filter Status
    if (statusFilter !== 'ALL') {
      result = result.filter((s) => {
        if (statusFilter === 'working') return s.status === 'working' || s.status === 'reset';
        return s.status === statusFilter;
      });
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.nis && s.nis.toLowerCase().includes(q)) ||
          (s.kelas && s.kelas.toLowerCase().includes(q)) ||
          (s.tokenCode && s.tokenCode.toLowerCase().includes(q)) ||
          (s.examTitle && s.examTitle.toLowerCase().includes(q))
      );
    }

    return result;
  }, [
    allStudentRecords,
    isPengawas,
    isAdmin,
    targetSupervisorRoom,
    mySupervisorTokenCodes,
    selectedRoomFilter,
    selectedTokenFilter,
    selectedClassFilter,
    statusFilter,
    searchQuery,
  ]);

  // Pengurutan Siswa Fleksibel (Sesuai Nama, Sesuai Yang Dipilih: Ruang & Kelas, Status, Waktu Mulai, Penggabungan)
  const sortedVisibleStudentRecords = useMemo(() => {
    const list = [...visibleStudentRecords];
    return list.sort((a, b) => {
      if (studentSortBy === 'name_asc') {
        return a.name.localeCompare(b.name);
      }
      if (studentSortBy === 'name_desc') {
        return b.name.localeCompare(a.name);
      }
      if (studentSortBy === 'class_room') {
        const roomCmp = (a.ruang || '').localeCompare(b.ruang || '');
        if (roomCmp !== 0) return roomCmp;
        const classCmp = (a.kelas || '').localeCompare(b.kelas || '');
        if (classCmp !== 0) return classCmp;
        return a.name.localeCompare(b.name);
      }
      if (studentSortBy === 'started_desc') {
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return bTime - aTime;
      }
      if (studentSortBy === 'combined') {
        // Penggabungan: Status Urgensi -> Ruang -> Kelas -> Nama
        const statusRank = (s: string) => {
          if (s === 'violation') return 1;
          if (s === 'working') return 2;
          if (s === 'reset') return 3;
          if (s === 'idle') return 4;
          return 5;
        };
        const rDiff = statusRank(a.status) - statusRank(b.status);
        if (rDiff !== 0) return rDiff;
        const roomCmp = (a.ruang || '').localeCompare(b.ruang || '');
        if (roomCmp !== 0) return roomCmp;
        const classCmp = (a.kelas || '').localeCompare(b.kelas || '');
        if (classCmp !== 0) return classCmp;
        return a.name.localeCompare(b.name);
      }
      // Default: 'status' (Prioritaskan Pelanggaran -> Mengerjakan -> Reset -> Belum Masuk -> Selesai -> Nama)
      if (a.status === 'violation' && b.status !== 'violation') return -1;
      if (a.status !== 'violation' && b.status === 'violation') return 1;
      if (a.status === 'working' && b.status !== 'working') return -1;
      if (a.status !== 'working' && b.status === 'working') return 1;
      if (a.status === 'idle' && b.status === 'finished') return -1;
      if (a.status === 'finished' && b.status === 'idle') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [visibleStudentRecords, studentSortBy]);

  // 3. Ringkasan Pengawas untuk Admin
  const supervisorRecords = useMemo<SupervisorMonitoringRecord[]>(() => {
    // Kumpulkan seluruh user dengan role 'pengawas'
    const supervisorUsers = users.filter((u: any) => {
      const r = String(u.role || '').toLowerCase().trim();
      return r === 'pengawas' || r === 'guru' || r === 'proktor';
    });

    const todayIso = new Date().toISOString().split('T')[0];

    return supervisorUsers.map((u: any) => {
      const uUid = String(u.uid || u.id || '');
      const uName = String(u.username || u.name || 'Pengawas');
      const uEmail = String(u.email || '').toLowerCase().trim();
      const rawRuang = String(u.ruang || '-');

      // Ambil penugasan dari masterPlan (Matriks Pengawas Ruang)
      let planRoom = '';
      let partnerName = '';
      let sessionName = '';
      let isScheduledToday = false;

      (masterPlan || []).forEach((day: any) => {
        const isToday = String(day?.date || '').trim() === todayIso;
        (day?.sessions || []).forEach((session: any) => {
          const roomSups: any[] = Array.isArray(session?.roomSupervisors) ? session.roomSupervisors : [];
          roomSups.forEach((rs: any) => {
            const em1 = String(rs?.supervisorEmail || '').toLowerCase().trim();
            const nm1 = String(rs?.supervisorName || '').toLowerCase().trim();
            const em2 = String(rs?.supervisor2Email || '').toLowerCase().trim();
            const nm2 = String(rs?.supervisor2Name || '').toLowerCase().trim();
            const nmL = uName.toLowerCase();

            const match1 = (uEmail && em1 === uEmail) || (nmL && (nm1 === nmL || (nmL.length > 3 && nm1.includes(nmL))));
            const match2 = (uEmail && em2 === uEmail) || (nmL && (nm2 === nmL || (nmL.length > 3 && nm2.includes(nmL))));

            if (match1 || match2) {
              if (!planRoom || isToday) {
                planRoom = rs.roomName || '';
                partnerName = match1 ? (rs.supervisor2Name || rs.supervisor2Email || '') : (rs.supervisorName || rs.supervisorEmail || '');
                sessionName = session.name || '';
                if (isToday) isScheduledToday = true;
              }
            }
          });
        });
      });

      const uRuang = rawRuang !== '-' ? rawRuang : (planRoom || '-');

      // Cari token yang dirilis oleh pengawas ini (pencocokan cerdas UID, Email, Nama, atau Ruangan Tugas)
      const normUName = normalizeSupervisorName(uName);
      const myTokens = tokens.filter((t: any) => {
        const matchUid = t.createdBy && (t.createdBy === uUid || t.createdBy === u.id || t.createdBy === u.uid);
        const matchEmail = uEmail && t.creatorEmail && normalizeSupervisorEmail(t.creatorEmail) === uEmail;
        const normTokName = normalizeSupervisorName(t.creatorName);
        const matchName = normUName && normTokName && (
          normTokName === normUName ||
          normTokName.includes(normUName) ||
          normUName.includes(normTokName)
        );
        const matchRuang = uRuang !== '-' && t.creatorRuang && normalizeRoomName(t.creatorRuang) === normalizeRoomName(uRuang);
        const matchPlanRoom = planRoom && t.creatorRuang && normalizeRoomName(t.creatorRuang) === normalizeRoomName(planRoom);
        return Boolean(matchUid || matchEmail || matchName || matchRuang || matchPlanRoom);
      });

      // Kumpulkan siswa di bawah token/ruang pengawas ini
      const myStudents = allStudentRecords.filter((s) => {
        const hasToken = myTokens.some((t: any) => String(t.code || '').toUpperCase() === s.tokenCode);
        const matchRoom = uRuang !== '-' && s.ruang && normalizeRoomName(s.ruang) === normalizeRoomName(uRuang);
        return hasToken || matchRoom;
      });

      const workingCount = myStudents.filter((s) => s.status === 'working' || s.status === 'reset').length;
      const finishedCount = myStudents.filter((s) => s.status === 'finished').length;
      const violationCount = myStudents.filter((s) => s.status === 'violation').length;

      // Pengecekan status online pengawas secara real-time & multi-level (Session, Presence Firestore, Broadcast, Simulation, Manual)
      const isOnline = checkIsSupervisorOnline(
        u,
        presenceMap,
        {
          currentUserEmail: currentUser?.email,
          currentUserId: currentUser?.uid || currentUser?.id,
          currentUserName: currentUser?.username || currentUser?.name || currentUser?.displayName,
          effectiveEmail: effectiveSupervisorEmail,
          simulatedEmail: simulatedSupervisorEmail,
          manualOnlineEmails: manualOnlineSet
        }
      );

      const hasReleasedToken = myTokens.length > 0;
      const hasActiveTokens = myTokens.some((t: any) => {
        const exp = parseTimestampMs(t.expiresAt) || (parseTimestampMs(t.createdAt) ? parseTimestampMs(t.createdAt) + 4 * 3600 * 1000 : 0);
        return exp > nowMs || !t.expiresAt;
      });

      let status: 'active' | 'standby' | 'offline' = 'standby';
      if (isOnline || hasReleasedToken || workingCount > 0) {
        status = 'active';
      } else if (isScheduledToday || planRoom || rawRuang !== '-') {
        status = 'standby';
      } else {
        status = 'offline';
      }

      const latestTok = myTokens[0];

      return {
        uid: uUid,
        name: uName,
        email: uEmail,
        nip: u.nip || u.nis,
        ruang: uRuang,
        status,
        lastActive: nowMs,
        hasReleasedToken,
        latestTokenCode: latestTok?.code,
        latestTokenExam: latestTok?.examTitle || exams.find((e: any) => e.id === latestTok?.examId)?.title,
        latestTokenTime: latestTok?.createdAt || latestTok?.releasedAt,
        activeTokens: myTokens.map((t: any) => {
          const tCode = String(t.code || '').toUpperCase().trim();
          const tStudents = allStudentRecords.filter((s) => s.tokenCode === tCode);
          return {
            id: t.id,
            code: tCode,
            examTitle: t.examTitle || exams.find((e: any) => e.id === t.examId)?.title || 'Ujian',
            createdAt: t.createdAt || t.releasedAt,
            releasedAt: t.releasedAt || t.createdAt,
            expiresAt: t.expiresAt,
            creatorRuang: t.creatorRuang || uRuang,
            creatorName: t.creatorName || uName,
            creatorEmail: t.creatorEmail || uEmail,
            studentCount: tStudents.length,
            workingCount: tStudents.filter((s) => s.status === 'working' || s.status === 'reset').length,
            finishedCount: tStudents.filter((s) => s.status === 'finished').length,
            violationCount: tStudents.filter((s) => s.status === 'violation').length,
            students: tStudents,
          };
        }),
        totalStudents: myStudents.length,
        workingStudents: workingCount,
        finishedStudents: finishedCount,
        violationStudents: violationCount,
      };
    }).sort((a, b) => {
      // Prioritaskan pengawas yang sudah rilis token dan sedang aktif
      if (a.hasReleasedToken && !b.hasReleasedToken) return -1;
      if (!a.hasReleasedToken && b.hasReleasedToken) return 1;
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      if (a.status === 'standby' && b.status === 'offline') return -1;
      if (a.status === 'offline' && b.status === 'standby') return 1;
      return a.ruang.localeCompare(b.ruang);
    });
  }, [users, tokens, allStudentRecords, exams, masterPlan, currentUser, effectiveSupervisorEmail, effectiveSupervisorName, effectiveSupervisorUid, simulatedSupervisorEmail, presenceMap, manualOnlineSet, nowMs]);

  // Statistik Keseluruhan
  const stats = useMemo(() => {
    const listToCount = visibleStudentRecords;
    const totalStudents = listToCount.length;
    const workingCount = listToCount.filter((s) => s.status === 'working' || s.status === 'reset').length;
    const finishedCount = listToCount.filter((s) => s.status === 'finished').length;
    const violationCount = listToCount.filter((s) => s.status === 'violation').length;
    const idleCount = listToCount.filter((s) => s.status === 'idle').length;

    const activeSupervisorsCount = supervisorRecords.filter((s) => s.status === 'active').length;
    const releasedSupervisorsCount = supervisorRecords.filter((s) => s.hasReleasedToken).length;
    const pendingSupervisorsCount = supervisorRecords.length - releasedSupervisorsCount;
    const totalSupervisorsCount = supervisorRecords.length;

    return {
      totalStudents,
      workingCount,
      finishedCount,
      violationCount,
      idleCount,
      activeSupervisorsCount,
      releasedSupervisorsCount,
      pendingSupervisorsCount,
      totalSupervisorsCount,
    };
  }, [visibleStudentRecords, supervisorRecords]);

  // Pengawas yang difilter untuk tampilan Admin dengan Opsi Pengurutan
  const displayedSupervisors = useMemo(() => {
    let result = supervisorRecords.filter((sup) => {
      if (supervisorFilter === 'RELEASED' && !sup.hasReleasedToken) return false;
      if (supervisorFilter === 'PENDING' && sup.hasReleasedToken) return false;
      if (supervisorFilter === 'ONLINE' && sup.status !== 'active') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = sup.name.toLowerCase().includes(q);
        const matchEmail = (sup.email || '').toLowerCase().includes(q);
        const matchNip = (sup.nip || '').toLowerCase().includes(q);
        const matchRuang = sup.ruang.toLowerCase().includes(q);
        const matchToken = sup.activeTokens.some((t) => t.code.toLowerCase().includes(q));
        return matchName || matchEmail || matchNip || matchRuang || matchToken;
      }
      return true;
    });

    return result.sort((a, b) => {
      if (supervisorSortBy === 'name_asc') {
        return a.name.localeCompare(b.name);
      }
      if (supervisorSortBy === 'name_desc') {
        return b.name.localeCompare(a.name);
      }
      if (supervisorSortBy === 'room') {
        return a.ruang.localeCompare(b.ruang);
      }
      if (supervisorSortBy === 'students_desc') {
        return b.totalStudents - a.totalStudents;
      }
      if (supervisorSortBy === 'combined') {
        const roomCmp = a.ruang.localeCompare(b.ruang);
        if (roomCmp !== 0) return roomCmp;
        if (a.hasReleasedToken && !b.hasReleasedToken) return -1;
        if (!a.hasReleasedToken && b.hasReleasedToken) return 1;
        return a.name.localeCompare(b.name);
      }
      // Default: 'token_active'
      if (a.hasReleasedToken && !b.hasReleasedToken) return -1;
      if (!a.hasReleasedToken && b.hasReleasedToken) return 1;
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      if (a.status === 'standby' && b.status === 'offline') return -1;
      if (a.status === 'offline' && b.status === 'standby') return 1;
      return a.ruang.localeCompare(b.ruang);
    });
  }, [supervisorRecords, supervisorFilter, searchQuery, supervisorSortBy]);

  // 4. Seluruh Histori Token dengan Rincian Siswa Peserta Ujian
  const allTokensWithParticipants = useMemo(() => {
    return tokens.map((t: any) => {
      const tCode = String(t.code || '').toUpperCase().trim();
      const examId = String(t.examId || '');
      const examTitle = String(
        t.examTitle || exams.find((e: any) => e.id === examId)?.title || 'Ujian Sekolah'
      );
      const creatorName = String(t.creatorName || 'Pengawas');
      const creatorEmail = String(t.creatorEmail || '').toLowerCase().trim();
      const creatorRuang = String(t.creatorRuang || '-');
      const createdBy = String(t.createdBy || '');
      const createdAt = t.createdAt || t.releasedAt;
      const expiresAt = t.expiresAt;
      const expMs = parseTimestampMs(expiresAt) || (parseTimestampMs(createdAt) ? parseTimestampMs(createdAt) + 4 * 3600 * 1000 : 0);
      const isExpired = expMs > 0 ? expMs < nowMs : false;
      const isActive = !isExpired;

      // Kumpulkan siswa yang memakai token ini
      const participants = allStudentRecords.filter(
        (s) => s.tokenCode && s.tokenCode.toUpperCase().trim() === tCode
      );

      const workingCount = participants.filter((s) => s.status === 'working' || s.status === 'reset').length;
      const finishedCount = participants.filter((s) => s.status === 'finished').length;
      const violationCount = participants.filter((s) => s.status === 'violation').length;

      return {
        id: String(t.id || tCode),
        code: tCode,
        examId,
        examTitle,
        creatorName,
        creatorEmail,
        creatorRuang,
        createdBy,
        createdAt,
        expiresAt,
        isActive,
        isExpired,
        participants,
        studentCount: participants.length,
        workingCount,
        finishedCount,
        violationCount,
      };
    });
  }, [tokens, exams, allStudentRecords, nowMs]);

  // 5. Histori Pengelompokan Token & Peserta per Pengawas
  const supervisorTokenHistoryList = useMemo<SupervisorHistoryGroup[]>(() => {
    // 1. Dari daftar supervisorRecords
    const groups: SupervisorHistoryGroup[] = supervisorRecords.map((sup) => {
      const normSupName = normalizeSupervisorName(sup.name);
      const supTokens = allTokensWithParticipants.filter((t) => {
        const matchUid = t.createdBy && (t.createdBy === sup.uid || t.createdBy === (sup as any).id);
        const matchEmail = sup.email && t.creatorEmail && normalizeSupervisorEmail(t.creatorEmail) === sup.email;
        const normTokName = normalizeSupervisorName(t.creatorName);
        const matchName = normSupName && normTokName && (
          normTokName === normSupName ||
          normTokName.includes(normSupName) ||
          normSupName.includes(normTokName)
        );
        const matchRuang = sup.ruang !== '-' && t.creatorRuang && normalizeRoomName(t.creatorRuang) === normalizeRoomName(sup.ruang);
        return Boolean(matchUid || matchEmail || matchName || matchRuang);
      });

      // Total peserta unik dari pengawas ini
      const uniqueStudents = new Set<string>();
      supTokens.forEach((t) => t.participants.forEach((p) => uniqueStudents.add(p.uid)));

      return {
        supervisorKey: sup.uid || sup.email || sup.name,
        uid: sup.uid,
        name: sup.name,
        email: sup.email || '',
        nip: sup.nip,
        ruang: sup.ruang,
        status: sup.status,
        hasReleasedToken: supTokens.length > 0,
        tokens: supTokens,
        totalTokensCount: supTokens.length,
        totalParticipantsCount: uniqueStudents.size,
        totalWorkingCount: supTokens.reduce((acc, t) => acc + t.workingCount, 0),
        totalFinishedCount: supTokens.reduce((acc, t) => acc + t.finishedCount, 0),
        totalViolationCount: supTokens.reduce((acc, t) => acc + t.violationCount, 0),
      };
    });

    // 2. Token yang dibuat Admin atau nama lain yang belum masuk
    const coveredCodes = new Set<string>();
    groups.forEach((g) => g.tokens.forEach((t) => coveredCodes.add(t.code)));

    const orphanTokens = allTokensWithParticipants.filter((t) => !coveredCodes.has(t.code));
    if (orphanTokens.length > 0) {
      const orphanMap = new Map<string, typeof orphanTokens>();
      orphanTokens.forEach((ot) => {
        const creatorKey = ot.creatorName || ot.creatorEmail || 'Admin / Panitia Ujian';
        if (!orphanMap.has(creatorKey)) orphanMap.set(creatorKey, []);
        orphanMap.get(creatorKey)!.push(ot);
      });

      orphanMap.forEach((toks, creatorKey) => {
        const uniqueStudents = new Set<string>();
        toks.forEach((t) => t.participants.forEach((p) => uniqueStudents.add(p.uid)));

        groups.push({
          supervisorKey: `custom_${creatorKey}`,
          uid: toks[0]?.createdBy || `custom_${creatorKey}`,
          name: creatorKey,
          email: toks[0]?.creatorEmail || '',
          nip: undefined,
          ruang: toks[0]?.creatorRuang || 'Semua Ruang',
          status: 'active',
          hasReleasedToken: true,
          tokens: toks,
          totalTokensCount: toks.length,
          totalParticipantsCount: uniqueStudents.size,
          totalWorkingCount: toks.reduce((acc, t) => acc + t.workingCount, 0),
          totalFinishedCount: toks.reduce((acc, t) => acc + t.finishedCount, 0),
          totalViolationCount: toks.reduce((acc, t) => acc + t.violationCount, 0),
        });
      });
    }

    return groups;
  }, [supervisorRecords, allTokensWithParticipants]);

  // Histori per Pengawas yang Difilter & Diurutkan
  const filteredSupervisorHistoryList = useMemo(() => {
    let list = supervisorTokenHistoryList.filter((group) => {
      // Filter Pengawas
      if (historySupervisorFilter !== 'ALL') {
        const matchKey = group.supervisorKey === historySupervisorFilter;
        const matchEmail = group.email && group.email === historySupervisorFilter;
        const matchName = group.name && group.name.toLowerCase().trim() === historySupervisorFilter.toLowerCase().trim();
        if (!matchKey && !matchEmail && !matchName) return false;
      }

      // Filter Ruangan
      if (historyRoomFilter !== 'ALL') {
        if (normalizeRoomName(group.ruang) !== normalizeRoomName(historyRoomFilter)) return false;
      }

      // Filter Ujian
      if (historyExamFilter !== 'ALL') {
        const hasExam = group.tokens.some((t) => t.examId === historyExamFilter || t.examTitle === historyExamFilter);
        if (!hasExam) return false;
      }

      // Search Query
      if (historySearchQuery.trim()) {
        const q = historySearchQuery.toLowerCase().trim();
        const matchName = group.name.toLowerCase().includes(q);
        const matchEmail = (group.email || '').toLowerCase().includes(q);
        const matchNip = (group.nip || '').toLowerCase().includes(q);
        const matchRuang = group.ruang.toLowerCase().includes(q);
        const matchToken = group.tokens.some(
          (t) =>
            t.code.toLowerCase().includes(q) ||
            t.examTitle.toLowerCase().includes(q) ||
            t.participants.some(
              (p) => p.name.toLowerCase().includes(q) || (p.nis && p.nis.toLowerCase().includes(q))
            )
        );
        return matchName || matchEmail || matchNip || matchRuang || matchToken;
      }

      return true;
    });

    // Urutkan groups
    return list.sort((a, b) => {
      if (historySortBy === 'sup_name_asc') {
        return a.name.localeCompare(b.name);
      }
      if (historySortBy === 'sup_name_desc') {
        return b.name.localeCompare(a.name);
      }
      if (historySortBy === 'most_students') {
        return b.totalParticipantsCount - a.totalParticipantsCount;
      }
      if (historySortBy === 'oldest_token') {
        const aOldest = a.tokens.length > 0 ? Math.min(...a.tokens.map((t) => parseTimestampMs(t.createdAt) || 0)) : 0;
        const bOldest = b.tokens.length > 0 ? Math.min(...b.tokens.map((t) => parseTimestampMs(t.createdAt) || 0)) : 0;
        return aOldest - bOldest;
      }
      if (historySortBy === 'combined') {
        // Penggabungan: Sudah Rilis Token -> Total Peserta Terbanyak -> Nama A-Z
        if (a.hasReleasedToken && !b.hasReleasedToken) return -1;
        if (!a.hasReleasedToken && b.hasReleasedToken) return 1;
        const pDiff = b.totalParticipantsCount - a.totalParticipantsCount;
        if (pDiff !== 0) return pDiff;
        return a.name.localeCompare(b.name);
      }
      // Default: 'latest_token' (Waktu Rilis Terbaru)
      const aLatest = a.tokens.length > 0 ? Math.max(...a.tokens.map((t) => parseTimestampMs(t.createdAt) || 0)) : 0;
      const bLatest = b.tokens.length > 0 ? Math.max(...b.tokens.map((t) => parseTimestampMs(t.createdAt) || 0)) : 0;
      if (aLatest !== bLatest) return bLatest - aLatest;
      return a.name.localeCompare(b.name);
    });
  }, [supervisorTokenHistoryList, historySupervisorFilter, historyRoomFilter, historyExamFilter, historySearchQuery, historySortBy]);

  // Histori Daftar Seluruh Token (Flat List)
  const filteredFlatTokenHistoryList = useMemo(() => {
    let list = allTokensWithParticipants.filter((t) => {
      if (historySupervisorFilter !== 'ALL') {
        const matchCreator =
          t.creatorName.toLowerCase().trim() === historySupervisorFilter.toLowerCase().trim() ||
          t.creatorEmail.toLowerCase().trim() === historySupervisorFilter.toLowerCase().trim();
        if (!matchCreator) return false;
      }
      if (historyRoomFilter !== 'ALL') {
        if (normalizeRoomName(t.creatorRuang) !== normalizeRoomName(historyRoomFilter)) return false;
      }
      if (historyExamFilter !== 'ALL') {
        if (t.examId !== historyExamFilter && t.examTitle !== historyExamFilter) return false;
      }
      if (historySearchQuery.trim()) {
        const q = historySearchQuery.toLowerCase().trim();
        const matchToken = t.code.toLowerCase().includes(q);
        const matchExam = t.examTitle.toLowerCase().includes(q);
        const matchCreator = t.creatorName.toLowerCase().includes(q);
        const matchRuang = t.creatorRuang.toLowerCase().includes(q);
        const matchStudent = t.participants.some(
          (p) => p.name.toLowerCase().includes(q) || (p.nis && p.nis.toLowerCase().includes(q))
        );
        return matchToken || matchExam || matchCreator || matchRuang || matchStudent;
      }
      return true;
    });

    return list.sort((a, b) => {
      if (historySortBy === 'sup_name_asc') {
        return a.creatorName.localeCompare(b.creatorName);
      }
      if (historySortBy === 'sup_name_desc') {
        return b.creatorName.localeCompare(a.creatorName);
      }
      if (historySortBy === 'most_students') {
        return b.studentCount - a.studentCount;
      }
      if (historySortBy === 'oldest_token') {
        return (parseTimestampMs(a.createdAt) || 0) - (parseTimestampMs(b.createdAt) || 0);
      }
      if (historySortBy === 'combined') {
        const cCmp = a.creatorName.localeCompare(b.creatorName);
        if (cCmp !== 0) return cCmp;
        return (parseTimestampMs(b.createdAt) || 0) - (parseTimestampMs(a.createdAt) || 0);
      }
      // Default: 'latest_token'
      return (parseTimestampMs(b.createdAt) || 0) - (parseTimestampMs(a.createdAt) || 0);
    });
  }, [allTokensWithParticipants, historySupervisorFilter, historyRoomFilter, historyExamFilter, historySearchQuery, historySortBy]);

  // Handler Cetak Laporan Resmi Histori Token Pengawas & Peserta
  const handlePrintSupervisorHistoryReport = (group?: SupervisorHistoryGroup) => {
    const todayStr = new Date().toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    const printTimeStr = new Date().toLocaleTimeString('id-ID');

    const targetGroups = group ? [group] : filteredSupervisorHistoryList.filter((g) => g.tokens.length > 0);
    const totalTokens = targetGroups.reduce((acc, g) => acc + g.tokens.length, 0);
    const totalStudents = targetGroups.reduce((acc, g) => acc + g.totalParticipantsCount, 0);

    let rowsHtml = '';
    let globalNo = 1;

    targetGroups.forEach((g) => {
      rowsHtml += `
        <tr style="background-color: #f1f5f9; font-weight: bold;">
          <td colspan="10" style="padding: 10px 8px; border: 1px solid #cbd5e1; font-size: 12px; color: #0f172a;">
            PENGAWAS: ${g.name} ${g.nip ? `(NIP: ${g.nip})` : ''} &bull; RUANG: ${g.ruang} &bull; TOTAL TOKEN: ${g.tokens.length} &bull; TOTAL SISWA: ${g.totalParticipantsCount}
          </td>
        </tr>
      `;

      if (g.tokens.length === 0) {
        rowsHtml += `
          <tr>
            <td colspan="10" style="padding: 8px; text-align: center; color: #94a3b8; font-style: italic; border: 1px solid #cbd5e1;">
              Belum ada token yang dirilis oleh pengawas ini.
            </td>
          </tr>
        `;
      } else {
        g.tokens.forEach((tok) => {
          if (tok.participants.length === 0) {
            rowsHtml += `
              <tr>
                <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">${globalNo++}</td>
                <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-family: monospace; font-weight: bold; color: #1e40af;">#${tok.code}</td>
                <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">${tok.examTitle}</td>
                <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px;">${formatDateTimeId(tok.createdAt)}</td>
                <td colspan="6" style="padding: 6px 8px; border: 1px solid #cbd5e1; color: #94a3b8; font-style: italic;">
                  Belum ada siswa yang menggunakan token ini.
                </td>
              </tr>
            `;
          } else {
            tok.participants.forEach((p) => {
              const statusBadgeColor =
                p.status === 'finished' ? '#166534' :
                p.status === 'working' ? '#1e40af' :
                p.status === 'violation' ? '#991b1b' : '#854d0e';
              const statusLabel =
                p.status === 'finished' ? 'Selesai' :
                p.status === 'working' ? 'Mengerjakan' :
                p.status === 'violation' ? 'Terkunci' : 'Reset / Menunggu';

              rowsHtml += `
                <tr>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">${globalNo++}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-family: monospace; font-weight: bold; color: #1e40af;">#${tok.code}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">${tok.examTitle}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px;">${formatClock(p.startedAt)}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-weight: 600;">${p.name}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">${p.nis || '-'}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">${p.kelas || '-'}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">${p.ruang || '-'}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold; color: ${statusBadgeColor};">${statusLabel}</td>
                  <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-size: 11px; color: ${p.violationCount ? '#b91c1c' : '#64748b'};">${p.latestViolationType || (p.violationCount ? 'Tercatat Pelanggaran' : 'Tertib')}</td>
                </tr>
              `;
            });
          }
        });
      }
    });

    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Rekapitulasi Histori Token & Peserta Pengawas</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          body { font-family: 'Times New Roman', Times, serif; color: #000; margin: 0; padding: 10px; font-size: 12px; }
          .kop-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
          .kop-table td { padding: 0; vertical-align: middle; }
          .kop-header { text-align: center; }
          .kop-header h3 { margin: 0; font-size: 14px; font-weight: normal; text-transform: uppercase; }
          .kop-header h2 { margin: 2px 0; font-size: 16px; font-weight: bold; text-transform: uppercase; }
          .kop-header h1 { margin: 2px 0; font-size: 18px; font-weight: 900; text-transform: uppercase; }
          .kop-header p { margin: 0; font-size: 11px; }
          .divider { border-top: 3px double #000; margin-top: 6px; margin-bottom: 12px; }
          .title { text-align: center; font-size: 14px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; text-decoration: underline; }
          .sub-title { text-align: center; font-size: 11px; margin-bottom: 14px; }
          .meta-table { width: 100%; margin-bottom: 12px; font-size: 11px; }
          .meta-table td { padding: 2px 4px; }
          .data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
          .data-table th { background-color: #e2e8f0; border: 1px solid #64748b; padding: 6px 4px; text-align: center; font-weight: bold; font-size: 11px; }
          .sign-area { width: 100%; margin-top: 25px; page-break-inside: avoid; }
          .sign-area td { width: 50%; text-align: center; vertical-align: top; font-size: 12px; }
        </style>
      </head>
      <body>
        <table class="kop-table">
          <tr>
            <td class="kop-header">
              <h3>PEMERINTAH KABUPATEN TEGAL</h3>
              <h2>DINAS PENDIDIKAN DAN KEBUDAYAAN</h2>
              <h1>SMP NEGERI 2 BOJONG</h1>
              <p>Jl. Raya Tuwel - Bojong, Kec. Bojong, Kab. Tegal, Jawa Tengah 52465 &bull; Surel: smpn2bojong@gmail.com</p>
            </td>
          </tr>
        </table>
        <div class="divider"></div>

        <div class="title">REKAPITULASI HISTORI TOKEN DAN PESERTA UJIAN PENGAWAS</div>
        <div class="sub-title">Tahun Pelajaran 2026/2027 &bull; Dicetak: ${todayStr}, ${printTimeStr} WIB</div>

        <table class="meta-table">
          <tr>
            <td style="width: 18%;"><b>Total Pengawas Terdata</b></td>
            <td style="width: 32%;">: ${targetGroups.length} Pengawas</td>
            <td style="width: 18%;"><b>Total Token Dikeluarkan</b></td>
            <td style="width: 32%;">: ${totalTokens} Token</td>
          </tr>
          <tr>
            <td><b>Total Peserta Ujian</b></td>
            <td>: ${totalStudents} Siswa Terdaftar</td>
            <td><b>Cakupan Laporan</b></td>
            <td>: ${group ? `Khusus Pengawas: ${group.name}` : 'Semua Pengawas Terpilih'}</td>
          </tr>
        </table>

        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 4%;">No</th>
              <th style="width: 9%;">Token</th>
              <th style="width: 17%;">Mata Pelajaran</th>
              <th style="width: 7%;">Mulai</th>
              <th style="width: 20%;">Nama Siswa</th>
              <th style="width: 8%;">NIS</th>
              <th style="width: 7%;">Kelas</th>
              <th style="width: 8%;">Ruang</th>
              <th style="width: 9%;">Status</th>
              <th style="width: 11%;">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="10" style="text-align:center; padding:12px;">Tidak ada data token dan peserta yang cocok.</td></tr>'}
          </tbody>
        </table>

        <table class="sign-area">
          <tr>
            <td>
              Mengetahui,<br />
              Kepala SMP Negeri 2 Bojong<br /><br /><br /><br /><br />
              <b><u>Drs. H. Mulyadi, M.Pd.</u></b><br />
              NIP. 19680512 199412 1 002
            </td>
            <td>
              Bojong, ${todayStr}<br />
              Koordinator Proktor / Administrator<br /><br /><br /><br /><br />
              <b><u>Panitia Pelaksana Asesmen</u></b><br />
              NIP. -
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    handlePrintHtml('Rekapitulasi Histori Token Pengawas', fullHtml);
  };

  // List Ruangan unik untuk filter
  const availableRooms = useMemo(() => {
    const set = new Set<string>();
    if (isPengawas && !isAdmin) {
      visibleStudentRecords.forEach((s) => {
        if (s.ruang && s.ruang !== '-') set.add(s.ruang);
      });
    } else {
      rooms.forEach((r: any) => {
        const name = String(r.name || r.id || '').trim();
        if (name) set.add(name);
      });
      allStudentRecords.forEach((s) => {
        if (s.ruang && s.ruang !== '-') set.add(s.ruang);
      });
    }
    return Array.from(set).sort();
  }, [rooms, allStudentRecords, visibleStudentRecords, isPengawas, isAdmin]);

  // List Token unik untuk filter
  const availableTokens = useMemo(() => {
    const set = new Set<string>();
    const sourceTokens = isPengawas && !isAdmin ? mySupervisorTokens : tokens;
    sourceTokens.forEach((t: any) => {
      const c = String(t.code || '').toUpperCase().trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort();
  }, [tokens, mySupervisorTokens, isPengawas, isAdmin]);

  // List Kelas unik untuk filter
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    if (isPengawas && !isAdmin) {
      visibleStudentRecords.forEach((s) => {
        if (s.kelas && s.kelas !== '-') set.add(s.kelas);
      });
    } else {
      classrooms.forEach((c: any) => {
        const name = String(c.name || c.id || '').trim();
        if (name) set.add(name);
      });
      allStudentRecords.forEach((s) => {
        if (s.kelas && s.kelas !== '-') set.add(s.kelas);
      });
    }
    return Array.from(set).sort();
  }, [classrooms, allStudentRecords, visibleStudentRecords, isPengawas, isAdmin]);

  // Handle Quick Reactivate Token langsung dari kartu siswa
  const handleQuickReset = async (student: StudentMonitoringRecord) => {
    if (!student.tokenId && !student.tokenCode) return;
    if (!onResetStudentToken) return;

    setResettingUid(student.uid);
    try {
      await onResetStudentToken(student.tokenId || student.tokenCode || '', student.uid, student.name);
      setLastRefreshedAt(new Date());
    } finally {
      setResettingUid(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Realtime Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 rounded-3xl p-6 text-white shadow-xl border border-blue-700/40">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-16 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-3.5 w-3.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-[0_0_10px_#10b981]"></span>
              </span>
              <span className="text-xs font-black uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                LIVE MONITORING AKTIF
              </span>
              <span className="text-xs text-blue-200/80 font-medium">
                Pembaruan: {lastRefreshedAt.toLocaleTimeString('id-ID')}
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-2.5">
              <Activity className="text-blue-400" size={28} />
              <span>{isAdmin ? 'Pusat Kendali & Monitoring Ujian' : `Dashboard Monitoring ${targetSupervisorRoom}`}</span>
            </h1>
            <p className="text-xs md:text-sm text-blue-100/80 max-w-2xl">
              {isAdmin
                ? 'Pantau kehadiran pengawas, status ruangan, serta aktivitas siswa yang sedang mengerjakan ujian secara realtime dengan visualisasi lampu penanda.'
                : `Hanya memantau status siswa di ${targetSupervisorRoom}. Siswa dari ruangan lain tidak ditampilkan.`}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-center">
            {onRefreshData && (
              <button
                type="button"
                onClick={() => {
                  onRefreshData();
                  setLastRefreshedAt(new Date());
                }}
                className="px-4 py-2.5 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-white/10 shadow-sm cursor-pointer"
                title="Segarkan data monitoring sekarang"
              >
                <RefreshCw size={15} className="animate-spin-hover" />
                <span>Segarkan Data</span>
              </button>
            )}
          </div>
        </div>

        {/* Admin Navigation Sub-Tabs */}
        {isAdmin && (
          <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveAdminSubTab('supervisors')}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                activeAdminSubTab === 'supervisors'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                  : 'bg-white/5 text-blue-200 hover:bg-white/10'
              }`}
            >
              <Users size={16} />
              <span>Monitoring Pengawas ({stats.releasedSupervisorsCount} Rilis Token • {stats.activeSupervisorsCount}/{stats.totalSupervisorsCount} Aktif)</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveAdminSubTab('students')}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                activeAdminSubTab === 'students'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/50'
                  : 'bg-white/5 text-blue-200 hover:bg-white/10'
              }`}
            >
              <Radio size={16} />
              <span>Monitoring Kotak Siswa ({stats.totalStudents})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveAdminSubTab('history')}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer ${
                activeAdminSubTab === 'history'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/50 ring-2 ring-emerald-400'
                  : 'bg-white/5 text-emerald-200 hover:bg-white/10'
              }`}
            >
              <History size={16} />
              <span>Histori Token &amp; Peserta Pengawas ({allTokensWithParticipants.length} Token)</span>
            </button>
          </div>
        )}

        {/* Strip Info Token Pengawas (Hanya milik pengawas sendiri) */}
        {isPengawas && !isAdmin && (
          <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-blue-200">Token Rilis Anda Sendiri:</span>
              {mySupervisorTokens.length > 0 ? (
                mySupervisorTokens.map((t: any) => {
                  const code = String(t.code || '').toUpperCase().trim();
                  const isSelected = selectedTokenFilter === code;
                  const countForToken = visibleStudentRecords.filter((s) => s.tokenCode === code).length;
                  return (
                    <button
                      key={t.id || code}
                      type="button"
                      onClick={() => setSelectedTokenFilter(isSelected ? 'ALL' : code)}
                      className={`px-3 py-1.5 rounded-xl font-mono font-black text-xs transition-all flex items-center gap-2 cursor-pointer border ${
                        isSelected
                          ? 'bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-950/40 ring-2 ring-emerald-300'
                          : 'bg-white/15 text-white border-white/20 hover:bg-white/25'
                      }`}
                    >
                      <span>#{code}</span>
                      <span className="text-[10px] bg-black/25 px-1.5 py-0.5 rounded-full font-sans font-bold">
                        {countForToken} Siswa
                      </span>
                    </button>
                  );
                })
              ) : (
                <span className="text-amber-300 font-semibold italic bg-amber-950/40 px-3 py-1 rounded-xl border border-amber-500/30">
                  ⚠️ Anda belum merilis token ujian hari ini di menu Beranda
                </span>
              )}
            </div>
            {mySupervisorTokens.length > 0 && selectedTokenFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedTokenFilter('ALL')}
                className="text-blue-300 hover:text-white underline text-[11px] font-bold cursor-pointer"
              >
                Tampilkan Semua Token Saya
              </button>
            )}
          </div>
        )}
      </div>

      {/* Metric Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isAdmin && activeAdminSubTab === 'supervisors' ? (
          <>
            <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                <span className="relative flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase truncate">Pengawas Online</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-gray-900">{stats.activeSupervisorsCount}</span>
                  <span className="text-xs text-gray-400">/ {stats.totalSupervisorsCount} Pengawas</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                <School size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase truncate">Ruang Terpantau</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-gray-900">{availableRooms.length}</span>
                  <span className="text-xs text-gray-400">Ruangan</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                <Activity size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase truncate">Siswa Mengerjakan</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-emerald-600">{stats.workingCount}</span>
                  <span className="text-xs text-gray-400">Siswa Aktif</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                <ShieldAlert size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-500 uppercase truncate">Terkunci / Kendala</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-rose-600">{stats.violationCount}</span>
                  <span className="text-xs text-gray-400">Perlu Bantuan</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* 🟢 Sedang Mengerjakan */}
            <div className="bg-gradient-to-br from-emerald-50 to-white p-4 rounded-2xl border border-emerald-200 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
                <span className="relative flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-emerald-800 uppercase truncate flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Sedang Mengerjakan</span>
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-emerald-600">{stats.workingCount}</span>
                  <span className="text-xs text-emerald-700/80 font-medium">Siswa</span>
                </div>
              </div>
            </div>

            {/* 🔵 Selesai Ujian */}
            <div className="bg-gradient-to-br from-blue-50 to-white p-4 rounded-2xl border border-blue-200 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                <CheckCircle2 size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-blue-800 uppercase truncate flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Ujian Selesai</span>
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-blue-600">{stats.finishedCount}</span>
                  <span className="text-xs text-blue-700/80 font-medium">Siswa</span>
                </div>
              </div>
            </div>

            {/* 🔴 Terkendala Pelanggaran */}
            <div className="bg-gradient-to-br from-rose-50 to-white p-4 rounded-2xl border border-rose-200 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 shadow-sm">
                <AlertCircle size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-rose-800 uppercase truncate flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span>Terkunci Pelanggaran</span>
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-rose-600">{stats.violationCount}</span>
                  <span className="text-xs text-rose-700/80 font-medium">Siswa</span>
                </div>
              </div>
            </div>

            {/* ⚪ Total Peserta Terhubung */}
            <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center shrink-0 shadow-sm">
                <Users size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-500 uppercase truncate">Total Peserta Ruangan</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black text-gray-900">{stats.totalStudents}</span>
                  <span className="text-xs text-gray-400 font-medium">Siswa</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ============================================================== */}
      {/* TAMPILAN 1: GRID PENGAWAS AKTIF (KHUSUS ADMIN)                */}
      {/* ============================================================== */}
      {isAdmin && activeAdminSubTab === 'supervisors' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-200/80 shadow-sm">
            <div>
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Users size={18} className="text-blue-600" />
                <span>Deteksi Pengawas yang Merilis Token &amp; Ruangan Ujian</span>
              </h2>
              <p className="text-xs text-gray-500">
                Sistem otomatis mendeteksi siapa saja pengawas yang telah merilis token untuk ujian yang dibuka kuncinya oleh Admin.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 shadow-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
                <span>{stats.releasedSupervisorsCount} Sudah Rilis Token</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200 shadow-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span>{stats.pendingSupervisorsCount} Belum Rilis</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-200 shadow-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span>{stats.activeSupervisorsCount} Online</span>
              </span>
            </div>
          </div>

          {/* Quick Filter Bar Pengawas */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 p-3 rounded-2xl border border-gray-200">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase mr-1">Filter Pengawas:</span>
              <button
                type="button"
                onClick={() => setSupervisorFilter('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  supervisorFilter === 'ALL'
                    ? 'bg-gray-900 text-white shadow-xs'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                Semua ({stats.totalSupervisorsCount})
              </button>
              <button
                type="button"
                onClick={() => setSupervisorFilter('RELEASED')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  supervisorFilter === 'RELEASED'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white text-emerald-700 hover:bg-emerald-50 border border-emerald-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Sudah Rilis Token ({stats.releasedSupervisorsCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setSupervisorFilter('PENDING')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  supervisorFilter === 'PENDING'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'bg-white text-amber-700 hover:bg-amber-50 border border-amber-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Belum Rilis Token ({stats.pendingSupervisorsCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setSupervisorFilter('ONLINE')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  supervisorFilter === 'ONLINE'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-blue-700 hover:bg-blue-50 border border-blue-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span>Aktif Online ({stats.activeSupervisorsCount})</span>
              </button>

              {/* Selector Cepat Aktifkan Pengawas Online */}
              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-blue-200 shadow-2xs">
                <span className="text-[11px] font-black text-blue-900 uppercase">Aktivasi:</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const targetEmail = e.target.value;
                    setManualOnlineSupervisor(targetEmail, true);
                    setManualOnlineSet(getManualOnlineSupervisors());
                    setPresenceMap(getCachedSupervisorsPresence());
                  }}
                  className="bg-transparent text-gray-800 text-xs font-bold outline-none cursor-pointer max-w-[200px] truncate"
                >
                  <option value="">+ Aktifkan Pengawas Online...</option>
                  {users
                    .filter((u: any) => {
                      const r = String(u.role || '').toLowerCase().trim();
                      return r === 'pengawas' || r === 'guru' || r === 'proktor';
                    })
                    .map((u: any) => (
                      <option key={u.id || u.email} value={u.email}>
                        {u.username} ({u.email || '-'})
                      </option>
                    ))}
                </select>
              </div>
              {/* Selector Cepat Urutan Pengawas */}
              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-xl border border-blue-200 shadow-2xs">
                <span className="text-[11px] font-black text-gray-600 uppercase flex items-center gap-1">
                  <ArrowUpDown size={12} className="text-blue-600" />
                  <span>Urutkan:</span>
                </span>
                <select
                  value={supervisorSortBy}
                  onChange={(e) => setSupervisorSortBy(e.target.value as any)}
                  className="bg-transparent text-gray-800 text-xs font-bold outline-none cursor-pointer"
                >
                  <option value="token_active">Rilis Token &amp; Keaktifan (Default)</option>
                  <option value="name_asc">Nama Pengawas (A &rarr; Z)</option>
                  <option value="name_desc">Nama Pengawas (Z &rarr; A)</option>
                  <option value="room">Sesuai Ruang Tugas</option>
                  <option value="students_desc">Jumlah Siswa Terbanyak</option>
                  <option value="combined">Penggabungan (Ruang + Status + Nama)</option>
                </select>
              </div>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="Cari pengawas, ruang, atau token..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedSupervisors.map((sup) => {
              const isOnline = sup.status === 'active';
              return (
                <div
                  key={sup.uid || sup.name}
                  className={`relative rounded-3xl p-5 border-2 transition-all flex flex-col justify-between gap-4 ${
                    sup.hasReleasedToken
                      ? 'border-emerald-300 bg-gradient-to-br from-emerald-50/50 via-white to-white shadow-sm hover:border-emerald-500 hover:shadow-emerald-100 hover:shadow-lg'
                      : isOnline
                      ? 'border-blue-200 bg-white hover:border-blue-400 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 shadow-sm'
                  }`}
                >
                  {/* Top Bar: Status Rilis Token + LED + Ruang */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* LED Indicator Lamp */}
                      <div className="relative shrink-0">
                        {sup.hasReleasedToken ? (
                          <span className="flex h-3.5 w-3.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-[0_0_10px_#10b981] ring-4 ring-emerald-100"></span>
                          </span>
                        ) : isOnline ? (
                          <span className="inline-flex rounded-full h-3.5 w-3.5 bg-blue-500 ring-2 ring-blue-100 shadow-[0_0_6px_#3b82f6]"></span>
                        ) : (
                          <span className="inline-flex rounded-full h-3.5 w-3.5 bg-amber-400 ring-2 ring-amber-100 shadow-[0_0_6px_#f59e0b]"></span>
                        )}
                      </div>
                      <div className="truncate">
                        <span
                          className={`text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            sup.hasReleasedToken
                              ? 'text-emerald-800 bg-emerald-100 border-emerald-300 shadow-xs'
                              : isOnline
                              ? 'text-blue-700 bg-blue-100/80 border-blue-300'
                              : 'text-amber-800 bg-amber-100/90 border-amber-300'
                          }`}
                        >
                          {sup.hasReleasedToken ? '🟢 SUDAH RILIS TOKEN' : isOnline ? '🔵 ONLINE (BELUM RILIS)' : '🟡 STANDBY BERTUGAS'}
                        </span>
                      </div>
                    </div>

                    <span className="text-xs font-black text-blue-700 bg-blue-50 px-2.5 py-1 rounded-xl border border-blue-200 shrink-0">
                      {sup.ruang !== '-' ? sup.ruang : 'Semua Ruang'}
                    </span>
                  </div>

                  {/* Info Pengawas */}
                  <div>
                    <h3 className="text-base font-bold text-gray-900 truncate" title={sup.name}>
                      {sup.name}
                    </h3>
                    <p className="text-xs text-gray-500 truncate">
                      {sup.nip ? `NIP: ${sup.nip}` : sup.email || 'Pengawas Ruang Ujian'}
                    </p>
                  </div>

                  {/* Token yang dirilis */}
                  <div className={`p-3 rounded-2xl border space-y-1.5 text-xs ${
                    sup.hasReleasedToken
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-gray-50/80 border-gray-100'
                  }`}>
                    <p className="text-[11px] font-bold text-gray-500 uppercase flex items-center justify-between">
                      <span>Token Ujian:</span>
                      <span className={`font-extrabold ${sup.hasReleasedToken ? 'text-emerald-700' : 'text-gray-400'}`}>
                        {sup.activeTokens.length > 0 ? `${sup.activeTokens.length} Token Dirilis` : 'Belum Dirilis'}
                      </span>
                    </p>
                    {sup.activeTokens.length > 0 ? (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-1.5">
                          {sup.activeTokens.map((tok) => (
                            <span
                              key={tok.id || tok.code}
                              className="px-2.5 py-1 bg-emerald-600 text-white font-mono font-black text-xs rounded-xl shadow-xs border border-emerald-500 flex items-center gap-1.5"
                              title={tok.examTitle}
                            >
                              <Key size={12} />
                              <span>{tok.code}</span>
                            </span>
                          ))}
                        </div>
                        <p className="text-[11px] text-emerald-800 font-medium truncate">
                          {sup.latestTokenExam || sup.activeTokens[0]?.examTitle}
                        </p>
                      </div>
                    ) : (
                      <p className="text-amber-700/80 italic text-[11px]">
                        Menunggu pengawas merilis token untuk ruangan ini...
                      </p>
                    )}
                  </div>

                  {/* Siswa Status Mini Pills */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100">
                      <p className="text-[10px] font-bold text-emerald-800 uppercase">Mengerjakan</p>
                      <p className="text-base font-black text-emerald-600">{sup.workingStudents}</p>
                    </div>
                    <div className="p-2 rounded-xl bg-blue-50 border border-blue-100">
                      <p className="text-[10px] font-bold text-blue-800 uppercase">Selesai</p>
                      <p className="text-base font-black text-blue-600">{sup.finishedStudents}</p>
                    </div>
                    <div className="p-2 rounded-xl bg-rose-50 border border-rose-100">
                      <p className="text-[10px] font-bold text-rose-800 uppercase">Kendala</p>
                      <p className="text-base font-black text-rose-600">{sup.violationStudents}</p>
                    </div>
                  </div>

                  {/* Action Bar: Toggle Online & Simulasi */}
                  <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        const nextOnline = !isOnline;
                        setManualOnlineSupervisor(sup.email || '', nextOnline);
                        setManualOnlineSet(getManualOnlineSupervisors());
                        setPresenceMap(getCachedSupervisorsPresence());
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border flex-1 justify-center ${
                        isOnline
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 shadow-2xs'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                      }`}
                      title={isOnline ? 'Tandai Offline' : 'Aktifkan Pengawas Ini Agar Terdeteksi Online'}
                    >
                      <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-gray-400'}`} />
                      <span>{isOnline ? 'Online (Aktif)' : 'Aktifkan Online'}</span>
                    </button>

                    {onSimulateSupervisor && sup.email && (
                      <button
                        type="button"
                        onClick={() => onSimulateSupervisor(sup.email)}
                        className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                        title={`Masuk mode simulasi peran sebagai ${sup.name}`}
                      >
                        <Eye size={13} />
                        <span>Simulasi</span>
                      </button>
                    )}
                  </div>

                  {/* Tombol Aksi: Histori Token & Peserta + Kotak Siswa */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupervisorModal(sup);
                      }}
                      className="py-2.5 px-2 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-2xs border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 cursor-pointer"
                      title="Lihat histori semua token yang dikeluarkan pengawas ini dan siapa saja siswa yang ikut ujian"
                    >
                      <History size={14} className="shrink-0" />
                      <span className="truncate">Histori ({sup.activeTokens.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (sup.ruang && sup.ruang !== '-') {
                          setSelectedRoomFilter(sup.ruang);
                        }
                        if (sup.activeTokens.length > 0 && sup.activeTokens[0]?.code) {
                          setSelectedTokenFilter(sup.activeTokens[0].code);
                        }
                        setActiveAdminSubTab('students');
                      }}
                      className={`py-2.5 px-2 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${
                        sup.hasReleasedToken
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-gray-900 hover:bg-black text-white'
                      }`}
                    >
                      <span className="truncate">Kotak Siswa</span>
                      <ArrowUpRight size={14} className="shrink-0" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAMPILAN 2: VISUALISASI KOTAK-KOTAK SISWA DENGAN LAMPU PENANDA */}
      {/* ============================================================== */}
      {(!isAdmin || activeAdminSubTab === 'students') && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white p-4 rounded-3xl border border-gray-200/80 shadow-sm space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Cari nama siswa, NIS, kelas, atau kode token..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0">
                <button
                  type="button"
                  onClick={() => setStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                    statusFilter === 'ALL'
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Semua ({allStudentRecords.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('working')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    statusFilter === 'working'
                      ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Mengerjakan ({stats.workingCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('finished')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    statusFilter === 'finished'
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-200'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Selesai ({stats.finishedCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('violation')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    statusFilter === 'violation'
                      ? 'bg-rose-600 text-white shadow-sm shadow-rose-200'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200/60'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                  <span>Terkunci ({stats.violationCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('idle')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    statusFilter === 'idle'
                      ? 'bg-amber-600 text-white shadow-sm shadow-amber-200'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/60'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Belum Masuk ({stats.idleCount})</span>
                </button>
              </div>
            </div>

            {/* Dropdown Filters: Ruang, Kelas, Token */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-xs">
              <span className="text-gray-400 font-bold uppercase text-[10px] flex items-center gap-1">
                <Filter size={12} />
                <span>Filter:</span>
              </span>

              {/* Ruang Indicator for Supervisor / Selector for Admin */}
              {isPengawas && !isAdmin ? (
                <span className="px-3 py-1 bg-blue-100 text-blue-900 border border-blue-200 font-extrabold text-xs rounded-xl flex items-center gap-1.5 shadow-2xs">
                  <School size={14} className="text-blue-700" />
                  <span>Ruangan: {targetSupervisorRoom || 'Ruang Tugas'}</span>
                </span>
              ) : (
                availableRooms.length > 0 && (
                  <select
                    value={selectedRoomFilter}
                    onChange={(e) => setSelectedRoomFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none cursor-pointer"
                  >
                    <option value="ALL">Semua Ruangan</option>
                    {availableRooms.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                )
              )}

              {/* Kelas Filter */}
              {availableClasses.length > 0 && (
                <select
                  value={selectedClassFilter}
                  onChange={(e) => setSelectedClassFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none cursor-pointer"
                >
                  <option value="ALL">Semua Kelas</option>
                  {availableClasses.map((c) => (
                    <option key={c} value={c}>
                      Kelas {c}
                    </option>
                  ))}
                </select>
              )}

              {/* Token Filter */}
              {availableTokens.length > 0 && (
                <select
                  value={selectedTokenFilter}
                  onChange={(e) => setSelectedTokenFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none cursor-pointer font-mono"
                >
                  <option value="ALL">Semua Token Ujian</option>
                  {availableTokens.map((t) => (
                    <option key={t} value={t}>
                      Token #{t}
                    </option>
                  ))}
                </select>
              )}

              {/* Opsi Pengurutan Siswa */}
              <div className="flex items-center gap-1.5 ml-auto bg-white px-2.5 py-1 rounded-xl border border-blue-200 shadow-2xs">
                <span className="text-[11px] font-black text-gray-600 uppercase flex items-center gap-1">
                  <ArrowUpDown size={12} className="text-blue-600" />
                  <span>Urutkan:</span>
                </span>
                <select
                  value={studentSortBy}
                  onChange={(e) => setStudentSortBy(e.target.value as any)}
                  className="bg-transparent text-gray-800 text-xs font-bold outline-none cursor-pointer"
                >
                  <option value="status">Status &amp; Urgensi (Default)</option>
                  <option value="name_asc">Nama Siswa (A &rarr; Z)</option>
                  <option value="name_desc">Nama Siswa (Z &rarr; A)</option>
                  <option value="class_room">Sesuai Pilihan: Ruang &amp; Kelas</option>
                  <option value="started_desc">Waktu Mulai Terbaru</option>
                  <option value="combined">Penggabungan (Status + Ruang + Nama)</option>
                </select>
              </div>

              {(selectedRoomFilter !== 'ALL' || selectedClassFilter !== 'ALL' || selectedTokenFilter !== 'ALL' || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRoomFilter('ALL');
                    setSelectedClassFilter('ALL');
                    setSelectedTokenFilter('ALL');
                    setSearchQuery('');
                    setStatusFilter('ALL');
                  }}
                  className="text-blue-600 hover:text-blue-800 text-[11px] font-bold underline cursor-pointer"
                >
                  Reset Filter
                </button>
              )}
            </div>
          </div>

          {/* Legenda Lampu Penanda LED */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50/80 px-4 py-2.5 rounded-2xl border border-gray-200 text-xs">
            <span className="font-extrabold text-gray-700 uppercase tracking-wider text-[10px]">
              Keterangan Lampu Penanda:
            </span>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-gray-600">
              <span className="flex items-center gap-2">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                </span>
                <span>Hijau: Sedang Mengerjakan</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-flex rounded-full h-3 w-3 bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                <span>Biru: Ujian Selesai</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                </span>
                <span>Merah: Terkunci Pelanggaran</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-flex rounded-full h-3 w-3 bg-amber-400" />
                <span>Kuning: Tidak Aktif / Jeda</span>
              </span>
            </div>
          </div>

          {/* Grid Kotak-Kotak Siswa */}
          {sortedVisibleStudentRecords.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sortedVisibleStudentRecords.map((student) => {
                const isWorking = student.status === 'working' || student.status === 'reset';
                const isFinished = student.status === 'finished';
                const isViolation = student.status === 'violation';
                const isIdle = student.status === 'idle';

                // Tema visual per status
                let cardBorder = 'border-gray-200 bg-white hover:border-gray-300 shadow-2xs';
                let ledElement = (
                  <span className="inline-flex rounded-full h-3.5 w-3.5 bg-gray-300 ring-2 ring-gray-100" />
                );
                let badgeText = 'BELUM MASUK';
                let badgeClass = 'bg-gray-100 text-gray-600 border-gray-200';

                if (isWorking) {
                  cardBorder =
                    'border-emerald-300 bg-gradient-to-br from-emerald-50/50 via-white to-white shadow-sm hover:border-emerald-500 hover:shadow-emerald-100 hover:shadow-md';
                  ledElement = (
                    <span className="flex h-3.5 w-3.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-[0_0_10px_#10b981] ring-4 ring-emerald-100" />
                    </span>
                  );
                  badgeText = 'SEDANG MENGERJAKAN';
                  badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                } else if (isFinished) {
                  cardBorder =
                    'border-blue-200 bg-gradient-to-br from-blue-50/40 via-white to-white shadow-sm hover:border-blue-400 hover:shadow-blue-100';
                  ledElement = (
                    <span className="inline-flex rounded-full h-3.5 w-3.5 bg-blue-500 shadow-[0_0_8px_#3b82f6] ring-4 ring-blue-100" />
                  );
                  badgeText = 'UJIAN SELESAI';
                  badgeClass = 'bg-blue-100 text-blue-800 border-blue-200';
                } else if (isViolation) {
                  cardBorder =
                    'border-rose-400 bg-gradient-to-br from-rose-50 via-white to-white shadow-md shadow-rose-100 hover:border-rose-600';
                  ledElement = (
                    <span className="flex h-3.5 w-3.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-80" />
                      <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-600 shadow-[0_0_12px_#e11d48] ring-4 ring-rose-200" />
                    </span>
                  );
                  badgeText = 'TERKUNCI PELANGGARAN';
                  badgeClass = 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse';
                }

                return (
                  <div
                    key={`${student.uid}_${student.tokenCode || 'notoken'}`}
                    className={`relative rounded-3xl p-4 border-2 transition-all flex flex-col justify-between gap-3 ${cardBorder}`}
                  >
                    {/* Header Kotak: Lampu Penanda LED + Status Badge + Token Code */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {ledElement}
                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${badgeClass}`}>
                          {badgeText}
                        </span>
                      </div>
                      {student.tokenCode && (
                        <span className="font-mono text-[11px] font-black text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200 shrink-0">
                          #{student.tokenCode}
                        </span>
                      )}
                    </div>

                    {/* Informasi Siswa */}
                    <div className="space-y-1">
                      <h4 className="text-sm font-extrabold text-gray-900 leading-snug line-clamp-1" title={student.name}>
                        {student.name}
                      </h4>
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                        {student.nis && <span className="bg-gray-100 px-2 py-0.5 rounded text-[11px]">NIS: {student.nis}</span>}
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[11px]">Kelas {student.kelas}</span>
                        <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[11px]">{student.ruang}</span>
                      </div>
                    </div>

                    {/* Keterangan Mata Pelajaran & Waktu */}
                    <div className="bg-gray-50/70 p-2.5 rounded-2xl border border-gray-100 text-xs space-y-1">
                      <p className="text-[11px] font-bold text-gray-800 truncate" title={student.examTitle}>
                        {student.examTitle || 'Ujian Sekolah'}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock size={12} className="text-gray-400" />
                          <span>{student.startedAt ? `Mulai ${formatClock(student.startedAt)}` : 'Belum Masuk'}</span>
                        </span>
                        <span className="font-extrabold text-gray-700">
                          {isFinished
                            ? `Selesai ${formatClock(student.finishedAt)}`
                            : isWorking
                            ? `Durasi: ${formatDuration(student.startedAt, student.finishedAt)}`
                            : 'Menunggu Token'}
                        </span>
                      </div>

                      {/* Notifikasi Pelanggaran jika ada */}
                      {isViolation && (
                        <div className="mt-1 pt-1.5 border-t border-rose-200/60 text-[11px] text-rose-700 font-bold flex items-center gap-1.5">
                          <AlertCircle size={13} className="shrink-0 text-rose-600" />
                          <span className="truncate">{student.latestViolationType || 'Pindah Tab / Keluar Layar Penuh'}</span>
                        </div>
                      )}
                    </div>

                    {/* Aksi Cepat: Tombol Buka Kunci / Reaktivasi Token */}
                    {isViolation && onResetStudentToken && (
                      <button
                        type="button"
                        disabled={resettingUid === student.uid}
                        onClick={() => handleQuickReset(student)}
                        className="w-full py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-md shadow-rose-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {resettingUid === student.uid ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Membuka Kunci...</span>
                          </>
                        ) : (
                          <>
                            <Unlock size={14} />
                            <span>Buka Kunci Token Sekarang</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Footer kecil: Pengawas penanggung jawab */}
                    <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1">
                      <span className="truncate">Pengawas: {student.creatorName || 'Pengawas'}</span>
                      <button
                        type="button"
                        onClick={() => setFocusedStudent(student)}
                        className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-0.5 cursor-pointer"
                      >
                        <span>Detail</span>
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-white rounded-3xl p-12 text-center border border-gray-200/80 shadow-sm space-y-3">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                <Users size={32} />
              </div>
              <h3 className="text-base font-bold text-gray-900">
                {isPengawas && !isAdmin && mySupervisorTokens.length === 0
                  ? 'Belum Ada Token yang Anda Rilis'
                  : 'Belum Ada Siswa Menggunakan Token Anda'}
              </h3>
              <p className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed">
                {isPengawas && !isAdmin && mySupervisorTokens.length === 0
                  ? 'Anda belum merilis token ujian hari ini. Silakan buka menu Beranda dan buat/rilis token ujian untuk ruang tugas Anda agar siswa dapat terhubung ke pengawasan Anda.'
                  : isPengawas && !isAdmin
                  ? 'Token yang Anda rilis belum dimasukkan oleh siswa di kelas. Begitu siswa memasukkan kode token Anda dan mulai mengerjakan, kartu kotak status mereka (lampu hijau/merah/biru) otomatis muncul di sini.'
                  : searchQuery || selectedRoomFilter !== 'ALL' || selectedTokenFilter !== 'ALL' || statusFilter !== 'ALL'
                  ? 'Tidak ada siswa yang sesuai dengan filter pencarian Anda. Coba sesuaikan filter atau reset.'
                  : 'Belum ada siswa yang sedang terhubung ke token ujian aktif saat ini.'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAMPILAN 3: HISTORI TOKEN & PESERTA PENGAWAS (KHUSUS ADMIN)    */}
      {/* ============================================================== */}
      {isAdmin && activeAdminSubTab === 'history' && (
        <div className="space-y-5">
          {/* Header Banner & Stats */}
          <div className="bg-white p-5 rounded-3xl border border-gray-200/80 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-gray-900 flex items-center gap-2.5">
                  <History className="text-emerald-600" size={22} />
                  <span>Histori Seluruh Token &amp; Peserta Ujian per Pengawas</span>
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Rekapitulasi lengkap riwayat token yang dikeluarkan masing-masing pengawas, waktu rilis, serta siapa saja siswa yang mengikuti ujian.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handlePrintSupervisorHistoryReport()}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-sm shadow-emerald-900/20 cursor-pointer"
                  title="Cetak seluruh rekapitulasi histori token dan peserta pengawas ke printer/PDF"
                >
                  <Printer size={15} />
                  <span>Cetak Laporan Rekap</span>
                </button>
              </div>
            </div>

            {/* Quick Stat Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-gray-100">
              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Total Token Dikeluarkan</p>
                <p className="text-xl font-black text-gray-900">{allTokensWithParticipants.length} <span className="text-xs font-normal text-gray-500">Token</span></p>
              </div>
              <div className="bg-indigo-50/60 p-3 rounded-2xl border border-indigo-100">
                <p className="text-[10px] font-bold text-indigo-700 uppercase">Total Peserta Terdata</p>
                <p className="text-xl font-black text-indigo-700">
                  {filteredSupervisorHistoryList.reduce((acc, g) => acc + g.totalParticipantsCount, 0)} <span className="text-xs font-normal text-indigo-600/80">Siswa</span>
                </p>
              </div>
              <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-100">
                <p className="text-[10px] font-bold text-emerald-700 uppercase">Selesai Mengerjakan</p>
                <p className="text-xl font-black text-emerald-700">
                  {filteredSupervisorHistoryList.reduce((acc, g) => acc + g.totalFinishedCount, 0)} <span className="text-xs font-normal text-emerald-600/80">Siswa</span>
                </p>
              </div>
              <div className="bg-rose-50/60 p-3 rounded-2xl border border-rose-100">
                <p className="text-[10px] font-bold text-rose-700 uppercase">Terkunci / Kendala</p>
                <p className="text-xl font-black text-rose-700">
                  {filteredSupervisorHistoryList.reduce((acc, g) => acc + g.totalViolationCount, 0)} <span className="text-xs font-normal text-rose-600/80">Siswa</span>
                </p>
              </div>
            </div>
          </div>

          {/* Filter & Toolbar */}
          <div className="bg-white p-4 rounded-3xl border border-gray-200/80 shadow-sm space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search */}
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Cari pengawas, kode token #..., nama siswa, NIS, atau ujian..."
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>

              {/* View Mode Toggle: Kelompok per Pengawas vs Daftar Semua Token */}
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setHistoryViewMode('grouped')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    historyViewMode === 'grouped'
                      ? 'bg-white text-gray-900 shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <Users size={13} />
                  <span>Kelompok per Pengawas ({filteredSupervisorHistoryList.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryViewMode('flat')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    historyViewMode === 'flat'
                      ? 'bg-white text-gray-900 shadow-2xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <Key size={13} />
                  <span>Daftar Seluruh Token ({filteredFlatTokenHistoryList.length})</span>
                </button>
              </div>
            </div>

            {/* Dropdown Filters */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-xs">
              <span className="text-gray-400 font-bold uppercase text-[10px] flex items-center gap-1">
                <Filter size={12} />
                <span>Filter Histori:</span>
              </span>

              {/* Filter Pengawas */}
              <select
                value={historySupervisorFilter}
                onChange={(e) => setHistorySupervisorFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none cursor-pointer max-w-[200px] truncate"
              >
                <option value="ALL">Semua Pengawas</option>
                {supervisorTokenHistoryList.map((g) => (
                  <option key={g.supervisorKey} value={g.supervisorKey}>
                    {g.name} ({g.totalTokensCount} Token)
                  </option>
                ))}
              </select>

              {/* Filter Ujian */}
              <select
                value={historyExamFilter}
                onChange={(e) => setHistoryExamFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none cursor-pointer max-w-[200px] truncate"
              >
                <option value="ALL">Semua Mata Pelajaran / Ujian</option>
                {exams.map((ex: any) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>

              {/* Filter Ruangan */}
              {availableRooms.length > 0 && (
                <select
                  value={historyRoomFilter}
                  onChange={(e) => setHistoryRoomFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 outline-none cursor-pointer"
                >
                  <option value="ALL">Semua Ruangan</option>
                  {availableRooms.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}

              {/* Dropdown Urutkan Histori */}
              <div className="flex items-center gap-1.5 ml-auto bg-emerald-50/60 px-2.5 py-1 rounded-xl border border-emerald-200 shadow-2xs">
                <span className="text-[11px] font-black text-emerald-800 uppercase flex items-center gap-1">
                  <ArrowUpDown size={12} className="text-emerald-700" />
                  <span>Urutkan:</span>
                </span>
                <select
                  value={historySortBy}
                  onChange={(e) => setHistorySortBy(e.target.value as any)}
                  className="bg-transparent text-emerald-950 text-xs font-bold outline-none cursor-pointer"
                >
                  <option value="latest_token">Waktu Rilis Token (Terbaru)</option>
                  <option value="oldest_token">Waktu Rilis Token (Terlama)</option>
                  <option value="sup_name_asc">Nama Pengawas (A &rarr; Z)</option>
                  <option value="sup_name_desc">Nama Pengawas (Z &rarr; A)</option>
                  <option value="most_students">Jumlah Siswa Terbanyak</option>
                  <option value="combined">Penggabungan (Rilis + Siswa + Nama)</option>
                </select>
              </div>

              {(historySupervisorFilter !== 'ALL' || historyExamFilter !== 'ALL' || historyRoomFilter !== 'ALL' || historySearchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setHistorySupervisorFilter('ALL');
                    setHistoryExamFilter('ALL');
                    setHistoryRoomFilter('ALL');
                    setHistorySearchQuery('');
                  }}
                  className="text-emerald-700 hover:text-emerald-900 text-[11px] font-bold underline cursor-pointer"
                >
                  Reset Filter
                </button>
              )}
            </div>
          </div>

          {/* MODE 1: KELOMPOK PER PENGAWAS */}
          {historyViewMode === 'grouped' && (
            <div className="space-y-4">
              {filteredSupervisorHistoryList.length > 0 ? (
                filteredSupervisorHistoryList.map((supGroup) => {
                  const hasTokens = supGroup.tokens.length > 0;
                  return (
                    <div
                      key={supGroup.supervisorKey}
                      className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden transition-all hover:border-gray-300"
                    >
                      {/* Header Pengawas */}
                      <div className="p-5 bg-gradient-to-r from-slate-50 via-white to-white border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-black text-base shrink-0 border border-indigo-100 shadow-2xs">
                            {supGroup.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-base font-extrabold text-gray-900 truncate">
                                {supGroup.name}
                              </h3>
                              <span className="text-[11px] font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                                {supGroup.ruang !== '-' ? supGroup.ruang : 'Semua Ruang'}
                              </span>
                              {hasTokens ? (
                                <span className="text-[11px] font-black text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  <span>{supGroup.tokens.length} Token Dirilis</span>
                                </span>
                              ) : (
                                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                  Belum Rilis Token
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              {supGroup.nip ? `NIP: ${supGroup.nip} • ` : ''}
                              {supGroup.email || 'Pengawas Ruang'}
                            </p>
                          </div>
                        </div>

                        {/* Statistik Mini & Aksi */}
                        <div className="flex items-center gap-2 flex-wrap self-start md:self-center">
                          <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200 text-xs">
                            <span className="font-bold text-gray-600">Peserta:</span>
                            <span className="font-black text-gray-900">{supGroup.totalParticipantsCount} Siswa</span>
                            <span className="text-gray-300">|</span>
                            <span className="font-bold text-emerald-700">{supGroup.totalFinishedCount} Selesai</span>
                            {supGroup.totalViolationCount > 0 && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span className="font-bold text-rose-600">{supGroup.totalViolationCount} Terkunci</span>
                              </>
                            )}
                          </div>

                          {hasTokens && (
                            <button
                              type="button"
                              onClick={() => handlePrintSupervisorHistoryReport(supGroup)}
                              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-gray-200"
                              title={`Cetak rekapitulasi khusus untuk pengawas ${supGroup.name}`}
                            >
                              <Printer size={13} />
                              <span>Cetak</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Isi: Daftar Token & Peserta per Token */}
                      {hasTokens ? (
                        <div className="p-5 space-y-4">
                          {supGroup.tokens.map((tokenItem) => {
                            const isExpanded = !expandedHistoryTokens.has(tokenItem.id);
                            return (
                              <div
                                key={tokenItem.id || tokenItem.code}
                                className="rounded-2xl border border-gray-200 overflow-hidden shadow-2xs"
                              >
                                {/* Header Bar Token */}
                                <div className="p-3.5 bg-slate-50/80 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80">
                                  <div className="flex items-center gap-2.5 flex-wrap">
                                    <div className="flex items-center gap-1.5 bg-white px-3 py-1 rounded-xl border border-blue-200 shadow-2xs font-mono font-black text-sm text-blue-800">
                                      <Key size={14} className="text-blue-600" />
                                      <span>#{tokenItem.code}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleCopyToken(tokenItem.code)}
                                        className="ml-1 text-gray-400 hover:text-blue-700 p-0.5 rounded cursor-pointer"
                                        title="Salin kode token"
                                      >
                                        {copiedTokenCode === tokenItem.code ? (
                                          <Check size={13} className="text-emerald-600" />
                                        ) : (
                                          <Copy size={13} />
                                        )}
                                      </button>
                                    </div>

                                    <div>
                                      <h4 className="text-xs font-bold text-gray-900">
                                        {tokenItem.examTitle}
                                      </h4>
                                      <p className="text-[11px] text-gray-500">
                                        Dikeluarkan: {formatDateTimeId(tokenItem.createdAt)} • Ruang: {tokenItem.creatorRuang}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                        tokenItem.isActive
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-gray-100 text-gray-600 border-gray-200'
                                      }`}
                                    >
                                      {tokenItem.isActive ? '🟢 AKTIF' : '⚪ SELESAI / EXPIRED'}
                                    </span>

                                    <span className="text-xs font-extrabold text-gray-700 bg-white px-2.5 py-1 rounded-xl border border-gray-200 shadow-2xs">
                                      {tokenItem.studentCount} Siswa Ikut
                                    </span>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExpandedHistoryTokens((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(tokenItem.id)) next.delete(tokenItem.id);
                                          else next.add(tokenItem.id);
                                          return next;
                                        });
                                      }}
                                      className="p-1 text-gray-400 hover:text-gray-700 rounded-lg cursor-pointer transition-transform"
                                      title={isExpanded ? 'Sembunyikan daftar peserta' : 'Buka daftar peserta'}
                                    >
                                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </button>
                                  </div>
                                </div>

                                {/* Tabel Rincian Siswa Peserta Ujian */}
                                {isExpanded && (
                                  <div className="overflow-x-auto">
                                    {tokenItem.participants.length > 0 ? (
                                      <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                          <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase font-bold border-b border-gray-200">
                                            <th className="py-2.5 px-3 w-10 text-center">No</th>
                                            <th className="py-2.5 px-3">Nama Siswa &amp; NIS</th>
                                            <th className="py-2.5 px-3 w-20 text-center">Kelas</th>
                                            <th className="py-2.5 px-3 w-24 text-center">Ruang</th>
                                            <th className="py-2.5 px-3 w-24">Waktu Mulai</th>
                                            <th className="py-2.5 px-3 w-28">Waktu Selesai</th>
                                            <th className="py-2.5 px-3 w-36 text-center">Status Ujian</th>
                                            <th className="py-2.5 px-3">Catatan Pelanggaran</th>
                                            <th className="py-2.5 px-3 w-28 text-center">Aksi</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {tokenItem.participants.map((stu, idx) => {
                                            const isDone = stu.status === 'finished';
                                            const isRunning = stu.status === 'working' || stu.status === 'reset';
                                            const isLocked = stu.status === 'violation';

                                            return (
                                              <tr key={`${stu.uid}_${stu.tokenCode}`} className="hover:bg-slate-50/70 transition-colors">
                                                <td className="py-2.5 px-3 text-center text-gray-400 font-mono text-[11px]">{idx + 1}</td>
                                                <td className="py-2.5 px-3">
                                                  <div className="font-extrabold text-gray-900">{stu.name}</div>
                                                  <div className="text-[10px] text-gray-400">{stu.nis ? `NIS: ${stu.nis}` : stu.email || '-'}</div>
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px]">
                                                    {stu.kelas || '-'}
                                                  </span>
                                                </td>
                                                <td className="py-2.5 px-3 text-center text-gray-600 font-semibold">{stu.ruang || '-'}</td>
                                                <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                                                  {stu.startedAt ? formatClock(stu.startedAt) : '-'}
                                                </td>
                                                <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                                                  {stu.finishedAt ? formatClock(stu.finishedAt) : isRunning ? 'Sedang Jalan' : '-'}
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  {isDone ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                                                      <CheckCircle2 size={11} className="text-emerald-600" />
                                                      <span>Selesai</span>
                                                    </span>
                                                  ) : isRunning ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                                                      <span>Mengerjakan</span>
                                                    </span>
                                                  ) : isLocked ? (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full border border-rose-300 animate-pulse">
                                                      <AlertCircle size={11} className="text-rose-600" />
                                                      <span>Terkunci</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                                      Belum Masuk
                                                    </span>
                                                  )}
                                                </td>
                                                <td className="py-2.5 px-3 text-[11px]">
                                                  {stu.latestViolationType ? (
                                                    <span className="text-rose-700 font-bold flex items-center gap-1">
                                                      <AlertCircle size={12} className="shrink-0 text-rose-500" />
                                                      <span className="truncate max-w-[200px]" title={stu.latestViolationType}>{stu.latestViolationType}</span>
                                                    </span>
                                                  ) : (
                                                    <span className="text-gray-400 italic">Tertib</span>
                                                  )}
                                                </td>
                                                <td className="py-2.5 px-3 text-center">
                                                  <div className="flex items-center justify-center gap-1">
                                                    {isLocked && onResetStudentToken && (
                                                      <button
                                                        type="button"
                                                        onClick={() => handleQuickReset(stu)}
                                                        className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer transition-colors shadow-2xs"
                                                        title="Buka kunci token siswa ini"
                                                      >
                                                        Buka Kunci
                                                      </button>
                                                    )}
                                                    <button
                                                      type="button"
                                                      onClick={() => setFocusedStudent(stu)}
                                                      className="p-1 text-blue-600 hover:text-blue-800 rounded cursor-pointer"
                                                      title="Detail data siswa"
                                                    >
                                                      <ChevronRight size={14} />
                                                    </button>
                                                  </div>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <div className="p-6 text-center text-gray-400 italic text-xs">
                                        Belum ada siswa yang memasukkan token #{tokenItem.code} ini.
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-8 text-center text-gray-400 italic text-xs">
                          Pengawas ini belum merilis token ujian pada hari ini.
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="bg-white rounded-3xl p-12 text-center border border-gray-200/80 shadow-sm space-y-2">
                  <History className="mx-auto text-gray-300" size={36} />
                  <h3 className="text-sm font-bold text-gray-900">Tidak Ada Data Histori yang Cocok</h3>
                  <p className="text-xs text-gray-500">Coba sesuaikan pencarian atau reset filter untuk menampilkan data.</p>
                </div>
              )}
            </div>
          )}

          {/* MODE 2: DAFTAR SEMUA TOKEN (FLAT LIST) */}
          {historyViewMode === 'flat' && (
            <div className="space-y-4">
              {filteredFlatTokenHistoryList.length > 0 ? (
                filteredFlatTokenHistoryList.map((tok) => {
                  return (
                    <div
                      key={tok.id || tok.code}
                      className="bg-white rounded-3xl border border-gray-200/80 shadow-sm overflow-hidden"
                    >
                      {/* Token Header */}
                      <div className="p-4 bg-slate-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-xl border border-blue-200 shadow-2xs font-mono font-black text-base text-blue-800">
                            <Key size={15} className="text-blue-600" />
                            <span>#{tok.code}</span>
                            <button
                              type="button"
                              onClick={() => handleCopyToken(tok.code)}
                              className="ml-1 text-gray-400 hover:text-blue-700 p-0.5 rounded cursor-pointer"
                              title="Salin kode token"
                            >
                              {copiedTokenCode === tok.code ? (
                                <Check size={13} className="text-emerald-600" />
                              ) : (
                                <Copy size={13} />
                              )}
                            </button>
                          </div>

                          <div>
                            <h4 className="text-sm font-extrabold text-gray-900">{tok.examTitle}</h4>
                            <p className="text-xs text-gray-500">
                              Dirilis oleh: <strong className="text-gray-700">{tok.creatorName}</strong> ({tok.creatorRuang}) &bull; Waktu: {formatDateTimeId(tok.createdAt)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${
                              tok.isActive
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : 'bg-gray-100 text-gray-600 border-gray-200'
                            }`}
                          >
                            {tok.isActive ? '🟢 AKTIF' : '⚪ SELESAI / EXPIRED'}
                          </span>
                          <span className="text-xs font-black text-indigo-700 bg-indigo-50 px-3 py-1 rounded-xl border border-indigo-200">
                            {tok.studentCount} Siswa Terdaftar
                          </span>
                        </div>
                      </div>

                      {/* Participant Table */}
                      <div className="overflow-x-auto">
                        {tok.participants.length > 0 ? (
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-50/70 text-gray-500 text-[10px] uppercase font-bold border-b border-gray-200">
                                <th className="py-2.5 px-3 w-10 text-center">No</th>
                                <th className="py-2.5 px-3">Nama Siswa &amp; NIS</th>
                                <th className="py-2.5 px-3 w-20 text-center">Kelas</th>
                                <th className="py-2.5 px-3 w-24 text-center">Ruang</th>
                                <th className="py-2.5 px-3 w-24">Waktu Mulai</th>
                                <th className="py-2.5 px-3 w-28">Waktu Selesai</th>
                                <th className="py-2.5 px-3 w-36 text-center">Status Ujian</th>
                                <th className="py-2.5 px-3">Catatan Pelanggaran</th>
                                <th className="py-2.5 px-3 w-28 text-center">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {tok.participants.map((stu, idx) => {
                                const isDone = stu.status === 'finished';
                                const isRunning = stu.status === 'working' || stu.status === 'reset';
                                const isLocked = stu.status === 'violation';

                                return (
                                  <tr key={`${stu.uid}_${stu.tokenCode}`} className="hover:bg-slate-50/70 transition-colors">
                                    <td className="py-2.5 px-3 text-center text-gray-400 font-mono text-[11px]">{idx + 1}</td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-extrabold text-gray-900">{stu.name}</div>
                                      <div className="text-[10px] text-gray-400">{stu.nis ? `NIS: ${stu.nis}` : stu.email || '-'}</div>
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-[11px]">
                                        {stu.kelas || '-'}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 text-center text-gray-600 font-semibold">{stu.ruang || '-'}</td>
                                    <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                                      {stu.startedAt ? formatClock(stu.startedAt) : '-'}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                                      {stu.finishedAt ? formatClock(stu.finishedAt) : isRunning ? 'Sedang Jalan' : '-'}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      {isDone ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                                          <CheckCircle2 size={11} className="text-emerald-600" />
                                          <span>Selesai</span>
                                        </span>
                                      ) : isRunning ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full border border-blue-200">
                                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                                          <span>Mengerjakan</span>
                                        </span>
                                      ) : isLocked ? (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-rose-800 bg-rose-100 px-2 py-0.5 rounded-full border border-rose-300 animate-pulse">
                                          <AlertCircle size={11} className="text-rose-600" />
                                          <span>Terkunci</span>
                                        </span>
                                      ) : (
                                        <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                          Belum Masuk
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-[11px]">
                                      {stu.latestViolationType ? (
                                        <span className="text-rose-700 font-bold flex items-center gap-1">
                                          <AlertCircle size={12} className="shrink-0 text-rose-500" />
                                          <span className="truncate max-w-[200px]" title={stu.latestViolationType}>{stu.latestViolationType}</span>
                                        </span>
                                      ) : (
                                        <span className="text-gray-400 italic">Tertib</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <div className="flex items-center justify-center gap-1">
                                        {isLocked && onResetStudentToken && (
                                          <button
                                            type="button"
                                            onClick={() => handleQuickReset(stu)}
                                            className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[10px] font-bold cursor-pointer transition-colors shadow-2xs"
                                            title="Buka kunci token siswa ini"
                                          >
                                            Buka Kunci
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => setFocusedStudent(stu)}
                                          className="p-1 text-blue-600 hover:text-blue-800 rounded cursor-pointer"
                                          title="Detail data siswa"
                                        >
                                          <ChevronRight size={14} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        ) : (
                          <div className="p-6 text-center text-gray-400 italic text-xs">
                            Belum ada siswa yang menggunakan token ini.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="bg-white rounded-3xl p-12 text-center border border-gray-200/80 shadow-sm space-y-2">
                  <Key className="mx-auto text-gray-300" size={36} />
                  <h3 className="text-sm font-bold text-gray-900">Tidak Ada Token yang Cocok</h3>
                  <p className="text-xs text-gray-500">Coba sesuaikan kata kunci pencarian atau reset filter.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal Detail Siswa */}
      {focusedStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                  {focusedStudent.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">{focusedStudent.name}</h3>
                  <p className="text-xs text-gray-500">Kelas {focusedStudent.kelas} • {focusedStudent.ruang}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFocusedStudent(null)}
                className="text-gray-400 hover:text-gray-700 p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500">Status Ujian:</span>
                <span className="font-bold text-gray-900 uppercase">{focusedStudent.status}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500">Kode Token:</span>
                <span className="font-mono font-bold text-blue-700">#{focusedStudent.tokenCode}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500">Mata Pelajaran / Ujian:</span>
                <span className="font-bold text-gray-900">{focusedStudent.examTitle}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500">Waktu Mulai:</span>
                <span className="font-semibold text-gray-700">{formatClock(focusedStudent.startedAt)}</span>
              </div>
              {focusedStudent.finishedAt && (
                <div className="flex justify-between py-1.5 border-b border-gray-50">
                  <span className="text-gray-500">Waktu Selesai:</span>
                  <span className="font-semibold text-emerald-700">{formatClock(focusedStudent.finishedAt)}</span>
                </div>
              )}
              <div className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500">Durasi Pengerjaan:</span>
                <span className="font-bold text-gray-900">{formatDuration(focusedStudent.startedAt, focusedStudent.finishedAt)}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-50">
                <span className="text-gray-500">Pengawas Ruang:</span>
                <span className="font-semibold text-gray-700">{focusedStudent.creatorName}</span>
              </div>
              {focusedStudent.latestViolationType && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertCircle size={14} className="text-rose-600" />
                    <span>Catatan Pelanggaran Terakhir:</span>
                  </p>
                  <p className="text-[11px] leading-relaxed">{focusedStudent.latestViolationType}</p>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              {focusedStudent.status === 'violation' && onResetStudentToken && (
                <button
                  type="button"
                  onClick={async () => {
                    await handleQuickReset(focusedStudent);
                    setFocusedStudent(null);
                  }}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-rose-200 cursor-pointer"
                >
                  <Unlock size={14} />
                  <span>Buka Kunci Siswa</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setFocusedStudent(null)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Histori Pengawas Spesifik */}
      {selectedSupervisorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-3xl max-w-4xl w-full p-6 space-y-4 shadow-2xl border border-gray-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-black text-base border border-indigo-100">
                  {selectedSupervisorModal.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                    <span>{selectedSupervisorModal.name}</span>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                      {selectedSupervisorModal.ruang !== '-' ? selectedSupervisorModal.ruang : 'Semua Ruang'}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedSupervisorModal.nip ? `NIP: ${selectedSupervisorModal.nip} • ` : ''}
                    {selectedSupervisorModal.email || 'Pengawas Ruang'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const grp = supervisorTokenHistoryList.find((g) => g.uid === selectedSupervisorModal.uid || g.name === selectedSupervisorModal.name);
                    if (grp) handlePrintSupervisorHistoryReport(grp);
                  }}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border border-gray-200"
                >
                  <Printer size={13} />
                  <span>Cetak Rekap</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistorySupervisorFilter(selectedSupervisorModal.uid || selectedSupervisorModal.name);
                    setActiveAdminSubTab('history');
                    setSelectedSupervisorModal(null);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Buka tab Histori Lengkap khusus pengawas ini"
                >
                  <History size={13} />
                  <span>Buka di Tab Histori</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSupervisorModal(null)}
                  className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-4 gap-2.5 shrink-0 text-center text-xs">
              <div className="p-2.5 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-[10px] font-bold text-gray-500 uppercase">Token Dirilis</p>
                <p className="text-base font-black text-gray-900">{selectedSupervisorModal.activeTokens.length}</p>
              </div>
              <div className="p-2.5 rounded-2xl bg-indigo-50 border border-indigo-100">
                <p className="text-[10px] font-bold text-indigo-800 uppercase">Total Peserta</p>
                <p className="text-base font-black text-indigo-700">{selectedSupervisorModal.totalStudents}</p>
              </div>
              <div className="p-2.5 rounded-2xl bg-emerald-50 border border-emerald-100">
                <p className="text-[10px] font-bold text-emerald-800 uppercase">Selesai</p>
                <p className="text-base font-black text-emerald-600">{selectedSupervisorModal.finishedStudents}</p>
              </div>
              <div className="p-2.5 rounded-2xl bg-rose-50 border border-rose-100">
                <p className="text-[10px] font-bold text-rose-800 uppercase">Terkendala</p>
                <p className="text-base font-black text-rose-600">{selectedSupervisorModal.violationStudents}</p>
              </div>
            </div>

            {/* List of Tokens & Students for this supervisor */}
            <div className="overflow-y-auto space-y-3 flex-1 pr-1">
              {selectedSupervisorModal.activeTokens.length > 0 ? (
                selectedSupervisorModal.activeTokens.map((tok) => {
                  return (
                    <div key={tok.id || tok.code} className="rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
                      <div className="p-3 bg-slate-50 flex items-center justify-between gap-2 border-b border-gray-200">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-xs text-blue-700 bg-white px-2.5 py-1 rounded-lg border border-blue-200 shadow-2xs">
                            #{tok.code}
                          </span>
                          <div>
                            <p className="text-xs font-bold text-gray-900">{tok.examTitle}</p>
                            <p className="text-[10px] text-gray-500">Dirilis: {formatDateTimeId(tok.createdAt)}</p>
                          </div>
                        </div>
                        <span className="text-xs font-extrabold text-gray-700 bg-white px-2.5 py-0.5 rounded-lg border border-gray-200">
                          {tok.studentCount} Siswa
                        </span>
                      </div>

                      <div className="overflow-x-auto max-h-56">
                        {tok.students && tok.students.length > 0 ? (
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="bg-gray-50 text-gray-500 text-[10px] uppercase font-bold border-b border-gray-100">
                                <th className="p-2 text-center w-8">No</th>
                                <th className="p-2">Nama Siswa</th>
                                <th className="p-2 text-center">Kelas</th>
                                <th className="p-2 text-center">Ruang</th>
                                <th className="p-2">Mulai</th>
                                <th className="p-2">Selesai</th>
                                <th className="p-2 text-center">Status</th>
                                <th className="p-2 text-center">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {tok.students.map((st, sIdx) => (
                                <tr key={`${st.uid}_${sIdx}`} className="hover:bg-slate-50">
                                  <td className="p-2 text-center text-gray-400 font-mono text-[10px]">{sIdx + 1}</td>
                                  <td className="p-2 font-bold text-gray-900">{st.name}</td>
                                  <td className="p-2 text-center text-blue-700 font-bold">{st.kelas}</td>
                                  <td className="p-2 text-center text-gray-600">{st.ruang}</td>
                                  <td className="p-2 font-mono text-[11px] text-gray-500">{formatClock(st.startedAt)}</td>
                                  <td className="p-2 font-mono text-[11px] text-gray-500">{formatClock(st.finishedAt)}</td>
                                  <td className="p-2 text-center">
                                    <span
                                      className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                        st.status === 'finished'
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : st.status === 'working' || st.status === 'reset'
                                          ? 'bg-blue-100 text-blue-800 border-blue-300'
                                          : st.status === 'violation'
                                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                                          : 'bg-gray-100 text-gray-600 border-gray-200'
                                      }`}
                                    >
                                      {st.status}
                                    </span>
                                  </td>
                                  <td className="p-2 text-center">
                                    {st.status === 'violation' && onResetStudentToken && (
                                      <button
                                        type="button"
                                        onClick={() => handleQuickReset(st)}
                                        className="px-2 py-0.5 bg-rose-600 text-white rounded text-[10px] font-bold cursor-pointer"
                                      >
                                        Buka
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="p-4 text-center text-gray-400 italic text-xs">Belum ada siswa menggunakan token ini.</p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="p-6 text-center text-gray-400 italic text-xs">Pengawas ini belum merilis token ujian.</p>
              )}
            </div>

            <div className="pt-2 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedSupervisorModal(null)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveMonitoringDashboard;
