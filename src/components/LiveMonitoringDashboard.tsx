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
  ArrowUpRight
} from 'lucide-react';
import { normalizeRoomName } from '../lib/classConstants';

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
  activeTokens: {
    id: string;
    code: string;
    examTitle: string;
    expiresAt?: number | string;
    studentCount: number;
    workingCount: number;
    finishedCount: number;
    violationCount: number;
  }[];
  totalStudents: number;
  workingStudents: number;
  finishedStudents: number;
  violationStudents: number;
}

interface LiveMonitoringDashboardProps {
  role: 'admin' | 'pengawas' | 'siswa';
  currentUser: any;
  userProfile: any;
  effectiveSupervisorRuang?: string;
  effectiveSupervisorEmail?: string;
  effectiveSupervisorName?: string;
  effectiveSupervisorUid?: string;
  tokens: any[];
  users: any[];
  violations: any[];
  exams: any[];
  rooms: any[];
  classrooms: any[];
  onResetStudentToken?: (tokenId: string, studentUid: string, studentName?: string) => Promise<void> | void;
  onRefreshData?: () => void;
  isSuperAdmin?: boolean;
}

export const LiveMonitoringDashboard: React.FC<LiveMonitoringDashboardProps> = ({
  role,
  currentUser,
  userProfile,
  effectiveSupervisorRuang,
  effectiveSupervisorEmail,
  effectiveSupervisorName,
  effectiveSupervisorUid,
  tokens = [],
  users = [],
  violations = [],
  exams = [],
  rooms = [],
  classrooms = [],
  onResetStudentToken,
  onRefreshData,
  isSuperAdmin = false,
}) => {
  const isAdmin = role === 'admin';
  const isPengawas = role === 'pengawas';

  const targetSupervisorRoom = useMemo(() => {
    const raw = effectiveSupervisorRuang || userProfile?.ruang || (currentUser as any)?.ruang || 'Ruang 01';
    return normalizeRoomName(raw) || 'Ruang 01';
  }, [effectiveSupervisorRuang, userProfile?.ruang, currentUser]);

  const [activeAdminSubTab, setActiveAdminSubTab] = useState<'supervisors' | 'students'>('supervisors');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('ALL');
  const [selectedTokenFilter, setSelectedTokenFilter] = useState<string>('ALL');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'working' | 'finished' | 'violation' | 'idle'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [resettingUid, setResettingUid] = useState<string | null>(null);
  const [focusedStudent, setFocusedStudent] = useState<StudentMonitoringRecord | null>(null);

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

    return list.sort((a, b) => {
      // Prioritaskan pelanggaran di atas agar pengawas langsung melihat yang butuh tindakan
      if (a.status === 'violation' && b.status !== 'violation') return -1;
      if (b.status === 'violation' && a.status !== 'violation') return 1;
      if (a.status === 'working' && b.status !== 'working') return -1;
      if (b.status === 'working' && a.status !== 'working') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [tokens, exams, users, violations, nowMs]);

  // 1. Daftar token yang HANYA dirilis oleh akun Pengawas ini sendiri atau khusus ruangannya
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
      return Boolean(matchUid || matchEmail || matchName || matchRoom);
    });
  }, [tokens, isPengawas, isAdmin, effectiveSupervisorUid, effectiveSupervisorEmail, effectiveSupervisorName, targetSupervisorRoom, currentUser, userProfile]);

  const mySupervisorTokenCodes = useMemo(() => {
    return new Set(mySupervisorTokens.map((t: any) => String(t.code || '').toUpperCase().trim()));
  }, [mySupervisorTokens]);

  // 2. Filter siswa sesuai role Pengawas atau Admin
  const visibleStudentRecords = useMemo(() => {
    let result = allStudentRecords;

    // Jika Pengawas, HANYA tampilkan status siswa yang ada di ruangannya sendiri!
    if (isPengawas && !isAdmin) {
      result = result.filter((s) => {
        const studentRoom = normalizeRoomName(s.ruang || '');
        const tokenRoom = normalizeRoomName(s.creatorRuang || '');

        // Pengawas masing-masing ruang HANYA melihat siswa di ruangannya sendiri!
        if (targetSupervisorRoom) {
          const isMyRoom = (studentRoom && studentRoom === targetSupervisorRoom) || (tokenRoom && tokenRoom === targetSupervisorRoom);
          if (!isMyRoom) {
            // Jangan keluarkan siswa dari ruangan lain!
            return false;
          }
          return true;
        }

        // Fallback jika belum memiliki ruangan tugas yang jelas: hanya siswa pemakai tokennya
        if (mySupervisorTokenCodes.size > 0) {
          return Boolean(s.tokenCode && mySupervisorTokenCodes.has(s.tokenCode.toUpperCase().trim()));
        }

        return false;
      });
    }

    // Filter Ruang (Khusus Admin yang dapat memfilter antar ruang)
    if (isAdmin && selectedRoomFilter !== 'ALL') {
      result = result.filter(
        (s) => (s.ruang || '').toUpperCase().trim() === selectedRoomFilter.toUpperCase().trim()
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

  // 3. Ringkasan Pengawas untuk Admin
  const supervisorRecords = useMemo<SupervisorMonitoringRecord[]>(() => {
    // Kumpulkan seluruh user dengan role 'pengawas'
    const supervisorUsers = users.filter((u: any) => {
      const r = String(u.role || '').toLowerCase().trim();
      return r === 'pengawas' || r === 'guru' || r === 'proktor';
    });

    return supervisorUsers.map((u: any) => {
      const uUid = String(u.uid || u.id || '');
      const uName = String(u.username || u.name || 'Pengawas');
      const uEmail = String(u.email || '').toLowerCase().trim();
      const uRuang = String(u.ruang || '-');

      // Cari token yang dirilis oleh pengawas ini
      const myTokens = tokens.filter((t: any) => {
        const matchUid = t.createdBy && t.createdBy === uUid;
        const matchEmail = t.creatorEmail && t.creatorEmail.toLowerCase().trim() === uEmail;
        const matchName = t.creatorName && t.creatorName.toLowerCase().trim() === uName.toLowerCase().trim();
        const matchRuang = uRuang !== '-' && t.creatorRuang && t.creatorRuang.toLowerCase().trim() === uRuang.toLowerCase().trim();
        return matchUid || matchEmail || matchName || matchRuang;
      });

      // Kumpulkan siswa di bawah token/ruang pengawas ini
      const myStudents = allStudentRecords.filter((s) => {
        const hasToken = myTokens.some((t: any) => String(t.code || '').toUpperCase() === s.tokenCode);
        const matchRoom = uRuang !== '-' && s.ruang && s.ruang.toLowerCase().trim() === uRuang.toLowerCase().trim();
        return hasToken || matchRoom;
      });

      const workingCount = myStudents.filter((s) => s.status === 'working' || s.status === 'reset').length;
      const finishedCount = myStudents.filter((s) => s.status === 'finished').length;
      const violationCount = myStudents.filter((s) => s.status === 'violation').length;

      // Status pengawas: 'active' jika ada token aktif / siswa aktif dalam 30 menit
      const hasActiveTokens = myTokens.some((t: any) => {
        const exp = t.expiresAt ? new Date(t.expiresAt).getTime() : 0;
        return exp > nowMs;
      });

      let status: 'active' | 'standby' | 'offline' = 'standby';
      if (hasActiveTokens || workingCount > 0) {
        status = 'active';
      } else if (myTokens.length > 0) {
        status = 'standby';
      } else {
        status = 'offline';
      }

      return {
        uid: uUid,
        name: uName,
        email: uEmail,
        nip: u.nip || u.nis,
        ruang: uRuang,
        status,
        lastActive: nowMs,
        activeTokens: myTokens.map((t: any) => {
          const tCode = String(t.code || '').toUpperCase().trim();
          const tStudents = allStudentRecords.filter((s) => s.tokenCode === tCode);
          return {
            id: t.id,
            code: tCode,
            examTitle: t.examTitle || exams.find((e: any) => e.id === t.examId)?.title || 'Ujian',
            expiresAt: t.expiresAt,
            studentCount: tStudents.length,
            workingCount: tStudents.filter((s) => s.status === 'working').length,
            finishedCount: tStudents.filter((s) => s.status === 'finished').length,
            violationCount: tStudents.filter((s) => s.status === 'violation').length,
          };
        }),
        totalStudents: myStudents.length,
        workingStudents: workingCount,
        finishedStudents: finishedCount,
        violationStudents: violationCount,
      };
    }).sort((a, b) => {
      // Prioritaskan pengawas aktif
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return a.ruang.localeCompare(b.ruang);
    });
  }, [users, tokens, allStudentRecords, exams, nowMs]);

  // Statistik Keseluruhan
  const stats = useMemo(() => {
    const listToCount = visibleStudentRecords;
    const totalStudents = listToCount.length;
    const workingCount = listToCount.filter((s) => s.status === 'working' || s.status === 'reset').length;
    const finishedCount = listToCount.filter((s) => s.status === 'finished').length;
    const violationCount = listToCount.filter((s) => s.status === 'violation').length;
    const idleCount = listToCount.filter((s) => s.status === 'idle').length;

    const activeSupervisorsCount = supervisorRecords.filter((s) => s.status === 'active').length;
    const totalSupervisorsCount = supervisorRecords.length;

    return {
      totalStudents,
      workingCount,
      finishedCount,
      violationCount,
      idleCount,
      activeSupervisorsCount,
      totalSupervisorsCount,
    };
  }, [visibleStudentRecords, supervisorRecords]);

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
          <div className="mt-6 pt-4 border-t border-white/10 flex items-center gap-2">
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
              <span>Monitoring Pengawas Aktif ({stats.activeSupervisorsCount}/{stats.totalSupervisorsCount})</span>
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
                <p className="text-xs font-bold text-gray-500 uppercase truncate">Total Peserta Token</p>
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
                <span>Daftar Seluruh Pengawas &amp; Ruangan Ujian</span>
              </h2>
              <p className="text-xs text-gray-500">
                Klik kartu pengawas untuk melihat rincian kotak siswa yang sedang diawasi di ruangannya.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
                <span>{stats.activeSupervisorsCount} Online</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-200">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <span>{stats.totalSupervisorsCount - stats.activeSupervisorsCount} Standby</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {supervisorRecords.map((sup) => {
              const isOnline = sup.status === 'active';
              return (
                <div
                  key={sup.uid || sup.name}
                  className={`relative rounded-3xl p-5 border-2 transition-all flex flex-col justify-between gap-4 ${
                    isOnline
                      ? 'border-emerald-200 bg-gradient-to-br from-emerald-50/40 via-white to-white shadow-sm hover:border-emerald-400 hover:shadow-emerald-100 hover:shadow-lg'
                      : 'border-gray-200 bg-white hover:border-gray-300 shadow-sm'
                  }`}
                >
                  {/* Top Bar: LED Lampu Penanda + Ruang */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* LED Indicator Lamp */}
                      <div className="relative shrink-0">
                        {isOnline ? (
                          <span className="flex h-3.5 w-3.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-[0_0_10px_#10b981] ring-4 ring-emerald-100"></span>
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full h-3.5 w-3.5 bg-gray-300 ring-2 ring-gray-100"></span>
                        )}
                      </div>
                      <div className="truncate">
                        <span
                          className={`text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full border ${
                            isOnline
                              ? 'text-emerald-700 bg-emerald-100/80 border-emerald-300'
                              : 'text-gray-500 bg-gray-100 border-gray-200'
                          }`}
                        >
                          {isOnline ? '🟢 AKTIF MENGAWASI' : '⚪ STANDBY / BELUM AKTIF'}
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
                  <div className="bg-gray-50/80 p-3 rounded-2xl border border-gray-100 space-y-1.5 text-xs">
                    <p className="text-[11px] font-bold text-gray-500 uppercase flex items-center justify-between">
                      <span>Token Dirilis:</span>
                      <span className="font-extrabold text-blue-600">{sup.activeTokens.length} Token</span>
                    </p>
                    {sup.activeTokens.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {sup.activeTokens.map((tok) => (
                          <span
                            key={tok.id || tok.code}
                            className="px-2 py-0.5 bg-blue-100 text-blue-800 font-mono font-black text-[11px] rounded-lg border border-blue-200"
                            title={tok.examTitle}
                          >
                            #{tok.code}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic text-[11px]">Belum merilis token ujian hari ini</p>
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

                  {/* Tombol Lihat Siswa Ruangan */}
                  <button
                    type="button"
                    onClick={() => {
                      if (sup.ruang && sup.ruang !== '-') {
                        setSelectedRoomFilter(sup.ruang);
                      }
                      setActiveAdminSubTab('students');
                    }}
                    className="w-full py-2.5 bg-gray-900 hover:bg-black text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <span>Pantau Kotak Siswa di Ruang Ini</span>
                    <ArrowUpRight size={14} />
                  </button>
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
                  className="text-blue-600 hover:text-blue-800 text-[11px] font-bold underline ml-auto cursor-pointer"
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
          {visibleStudentRecords.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {visibleStudentRecords.map((student) => {
                const isWorking = student.status === 'working' || student.status === 'reset';
                const isFinished = student.status === 'finished';
                const isViolation = student.status === 'violation';
                const isIdle = student.status === 'idle';

                // Tema visual per status
                let cardBorder = 'border-gray-200 bg-white hover:border-gray-300';
                let ledElement = (
                  <span className="inline-flex rounded-full h-3.5 w-3.5 bg-amber-400 ring-2 ring-amber-100" />
                );
                let badgeText = 'TIDAK AKTIF';
                let badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';

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
                    key={`${student.uid}_${student.tokenCode}`}
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
                          <span>Mulai {formatClock(student.startedAt)}</span>
                        </span>
                        <span className="font-extrabold text-gray-700">
                          {isFinished ? `Selesai ${formatClock(student.finishedAt)}` : `Durasi: ${formatDuration(student.startedAt, student.finishedAt)}`}
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
    </div>
  );
};

export default LiveMonitoringDashboard;
