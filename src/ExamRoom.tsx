import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { reportViolation } from './services/firestoreService';
import { playViolationAlarmSound, stopViolationAlarmSound } from './lib/violationSoundService';
import { ShieldAlert, LogOut, Maximize, AlertTriangle, RefreshCw, Wifi, WifiOff, Clock as ClockIcon, Sparkles, Zap, ShieldCheck, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react';

interface ExamRoomProps {
  exam: {
    id: string;
    title: string;
    googleFormLink?: string;
    link?: string; // Fallback for older data
    subjectName?: string;
    endTime?: any;
    tokenCreatorRuang?: string;
    tokenCode?: string;
    tokenCreatorId?: string;
    tokenCreatorName?: string;
    isSimulation?: boolean;
    simulatedClass?: string;
    simulatedRoom?: string;
    simulatedStudentName?: string;
    simulatedStudentUid?: string;
    exitCountdownSeconds?: number;
    earlyExamGracePeriodMinutes?: number;
    sessionInstanceKey?: number;
  };
  onExit: (reason?: 'finished' | 'violation', violationType?: string, violationData?: any) => void;
}

// Encryption helpers for Google Form links (must match Dashboard.tsx)
const secretKey = "ais-exam-secure-key";
const decryptLink = (encoded: string) => {
  if (!encoded) return "";
  
  // If it's already a full URL, don't try to decrypt
  if (encoded.startsWith('http://') || encoded.startsWith('https://')) {
    return encoded;
  }

  // Heuristic: Encrypted links in this app are Base64 encoded XOR strings.
  // They typically don't contain dots (which are present in almost all URLs).
  // Base64 can contain '/', '+', and '='.
  if (!encoded.includes('.') && encoded.length > 10) {
    try {
      const decoded = decodeURIComponent(escape(atob(encoded)));
      return decoded.split('').map((char, i) => 
        String.fromCharCode(char.charCodeAt(0) ^ secretKey.charCodeAt(i % secretKey.length))
      ).join('');
    } catch (e) {
      console.error("Decryption failed for:", encoded, e);
      return encoded;
    }
  }
  return encoded;
};

export default function ExamRoom({ exam, onExit }: ExamRoomProps) {
  const { user, userProfile } = useAuth();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [skipFullscreenPrompt, setSkipFullscreenPrompt] = useState(false);
  const [bypassAntiCheat, setBypassAntiCheat] = useState(false);
  const [violationCount, setViolationCount] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [timeLeft, setTimeLeft] = useState<string>('--:--:--');
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [hasSubmittedOrNavigatedForm, setHasSubmittedOrNavigatedForm] = useState(false);
  const [showMobileHeaderDetail, setShowMobileHeaderDetail] = useState(false);
  const [iframeRenderKey, setIframeRenderKey] = useState(0);
  const [exitCountdown, setExitCountdown] = useState<{ type: string; remainingMs: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const isExiting = useRef(false);
  const isSafeExitRef = useRef(false);
  const hasEnteredFullscreenRef = useRef(false);
  const hasStartedExamRef = useRef(false);
  const mountedAtRef = useRef<number>(Date.now());
  const fullscreenTransitionUntilRef = useRef<number>(0);
  const baselineViewportRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const showFinishConfirmRef = useRef(false);
  const hasSubmittedOrNavigatedRef = useRef(false);
  const exitCountdownActiveRef = useRef(false);
  const exitCountdownIntervalRef = useRef<any>(null);
  const exitCountdownTimeoutRef = useRef<any>(null);
  const iframeLoadCountRef = useRef(0);
  const firstIframeLoadAtRef = useRef<number>(0);
  const lastIframeLoadAtRef = useRef<number>(0);
  const lastIframeActiveAtRef = useRef<number>(0);
  const lastParentInteractionAtRef = useRef<number>(0);
  const isManualReloadingIframeRef = useRef(false);
  const wasIframeFocusedRef = useRef(false);
  const graceProtectionUntilRef = useRef<number>(0);
  const wakeLockSentinelRef = useRef<any>(null);
  const blurCheckTimeoutRef = useRef<any>(null);
  const postLoadModalTimeoutRef = useRef<any>(null);

  useEffect(() => {
    showFinishConfirmRef.current = showFinishConfirm;
  }, [showFinishConfirm]);

  useEffect(() => {
    hasSubmittedOrNavigatedRef.current = hasSubmittedOrNavigatedForm;
  }, [hasSubmittedOrNavigatedForm]);

  const clearExitCountdownTimers = () => {
    if (exitCountdownIntervalRef.current) {
      clearInterval(exitCountdownIntervalRef.current);
      exitCountdownIntervalRef.current = null;
    }
    if (exitCountdownTimeoutRef.current) {
      clearTimeout(exitCountdownTimeoutRef.current);
      exitCountdownTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    // Pastikan body/html tidak terkunci scroll atau pointer-events dari modal sebelumnya saat ruang ujian dibuka kembali
    stopViolationAlarmSound();
    try {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.style.pointerEvents = '';
    } catch (e) {}
    return () => {
      clearExitCountdownTimers();
      try {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.pointerEvents = '';
      } catch (e) {}
    };
  }, []);

  const displayStudentName = exam.isSimulation
    ? (exam.simulatedStudentName || `[Simulasi] ${userProfile?.username || 'Siswa'}`)
    : (userProfile?.username || userProfile?.name || user?.displayName || 'Siswa');

  const configuredCountdownSeconds = (() => {
    if (typeof exam.exitCountdownSeconds === 'number' && !isNaN(exam.exitCountdownSeconds) && exam.exitCountdownSeconds >= 1) {
      return Math.min(120, Math.round(exam.exitCountdownSeconds));
    }
    try {
      const raw = localStorage.getItem('appSettingsCache');
      if (raw) {
        const parsed = JSON.parse(raw);
        const val = Number(parsed?.exitCountdownSeconds);
        if (!isNaN(val) && val >= 1) {
          return Math.min(120, Math.round(val));
        }
      }
    } catch (e) {}
    return 10;
  })();
  const configuredCountdownMs = configuredCountdownSeconds * 1000;

  // Masa Toleransi Awal Ujian (Default: 15 Menit, dikontrol dari Pengaturan Admin)
  const configuredGraceMinutes = (() => {
    try {
      if (typeof exam.earlyExamGracePeriodMinutes === 'number' && !isNaN(exam.earlyExamGracePeriodMinutes) && exam.earlyExamGracePeriodMinutes >= 0) {
        return Math.min(60, Math.round(exam.earlyExamGracePeriodMinutes));
      }
      const raw = localStorage.getItem('appSettingsCache');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.earlyExamGracePeriodMinutes === 'number' && !isNaN(parsed.earlyExamGracePeriodMinutes) && parsed.earlyExamGracePeriodMinutes >= 0) {
          return Math.min(60, Math.round(parsed.earlyExamGracePeriodMinutes));
        }
      }
    } catch (e) {}
    return 15;
  })();
  const configuredGraceMs = configuredGraceMinutes * 60 * 1000;

  // Rekam waktu mulai ujian siswa di sessionStorage agar tidak reset bila refresh halaman
  const examSessionStartedAtRef = useRef<number>((() => {
    try {
      const studentUid = exam.isSimulation
        ? (exam.simulatedStudentUid || 'sim_siswa')
        : (user?.uid || userProfile?.uid || userProfile?.id || 'siswa');
      const storageKey = `exam_session_start_${exam.id}_${studentUid}`;
      const saved = sessionStorage.getItem(storageKey);
      if (saved && !isNaN(Number(saved))) {
        return Number(saved);
      }
      const now = Date.now();
      sessionStorage.setItem(storageKey, String(now));
      return now;
    } catch (e) {
      return Date.now();
    }
  })());

  const [graceTimeRemainingMs, setGraceTimeRemainingMs] = useState<number>(() => {
    if (configuredGraceMs <= 0) return 0;
    const elapsed = Date.now() - examSessionStartedAtRef.current;
    return Math.max(0, configuredGraceMs - elapsed);
  });

  const isInEarlyGracePeriod = graceTimeRemainingMs > 0;

  useEffect(() => {
    if (configuredGraceMs <= 0) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - examSessionStartedAtRef.current;
      const left = Math.max(0, configuredGraceMs - elapsed);
      setGraceTimeRemainingMs(left);
      if (left === 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [configuredGraceMs]);

  const formatGraceTime = (ms: number) => {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Fitur Penahan Layar Tetap Menyala (Screen Wake Lock API) agar HP siswa tidak masuk mode siaga/mati sendiri
  const requestScreenWakeLock = async () => {
    try {
      const navAny = navigator as any;
      if (navAny?.wakeLock?.request && !document.hidden) {
        if (wakeLockSentinelRef.current) {
          try { await wakeLockSentinelRef.current.release(); } catch (e) {}
        }
        const sentinel = await navAny.wakeLock.request('screen');
        wakeLockSentinelRef.current = sentinel;
        setWakeLockActive(true);
        sentinel.addEventListener?.('release', () => {
          setWakeLockActive(false);
        });
      }
    } catch (e) {
      // Wake Lock tidak didukung atau ditolak browser, diabaikan dengan aman
      setWakeLockActive(false);
    }
  };

  const releaseScreenWakeLock = async () => {
    try {
      if (wakeLockSentinelRef.current) {
        await wakeLockSentinelRef.current.release();
        wakeLockSentinelRef.current = null;
      }
      setWakeLockActive(false);
    } catch (e) {}
  };

  const clearBlurCheckTimer = () => {
    if (blurCheckTimeoutRef.current) {
      clearTimeout(blurCheckTimeoutRef.current);
      blurCheckTimeoutRef.current = null;
    }
    if (postLoadModalTimeoutRef.current) {
      clearTimeout(postLoadModalTimeoutRef.current);
      postLoadModalTimeoutRef.current = null;
    }
  };

  const safelyCloseFullscreen = async () => {
    try {
      const docAny = document as any;
      if (
        document.fullscreenElement ||
        docAny.webkitFullscreenElement ||
        docAny.mozFullScreenElement ||
        docAny.msFullscreenElement
      ) {
        if (document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {});
        } else if (docAny.webkitExitFullscreen) {
          docAny.webkitExitFullscreen();
        } else if (docAny.mozCancelFullScreen) {
          docAny.mozCancelFullScreen();
        } else if (docAny.msExitFullscreen) {
          docAny.msExitFullscreen();
        }
        // Beri jeda singkat agar compositor browser menyelesaikan transisi keluar fullscreen sebelum komponen di-unmount
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    } catch (e) {}
  };

  const openFinishConfirmModalSafely = () => {
    clearBlurCheckTimer();
    const now = Date.now();
    lastParentInteractionAtRef.current = now;
    graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, now + 8000);
    showFinishConfirmRef.current = true;
    setShowFinishConfirm(true);
  };

  const handleContinueExamFromConfirm = () => {
    clearBlurCheckTimer();
    const now = Date.now();
    lastParentInteractionAtRef.current = now;
    lastIframeActiveAtRef.current = now;
    graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, now + 4000);
    showFinishConfirmRef.current = false;
    setShowFinishConfirm(false);
    if (!isFullscreen && !(exam.isSimulation && bypassAntiCheat) && !skipFullscreenPrompt) {
      enterFullscreen();
    }
    setTimeout(() => {
      try {
        iframeRef.current?.focus();
      } catch (e) {}
    }, 80);
  };

  const handleSafeFinishExam = async () => {
    // Hentikan hitungan mundur 3 detik pelanggaran seketika saat tombol Selesai Ujian ditekan!
    isSafeExitRef.current = true;
    isExiting.current = true;
    exitCountdownActiveRef.current = false;
    clearExitCountdownTimers();
    clearBlurCheckTimer();
    setExitCountdown(null);
    showFinishConfirmRef.current = false;
    setShowFinishConfirm(false);
    await releaseScreenWakeLock();
    await safelyCloseFullscreen();
    onExit('finished');
  };

  // Fungsi eksekusi akhir: baru mencatat ke Data Pelanggaran & membunyikan Alarm jika siswa kembali ke ujian atau tidak klik Selesai Ujian dalam 3 detik
  const commitFinalViolation = async (type: string) => {
    if (isExiting.current || isSafeExitRef.current) return;

    exitCountdownActiveRef.current = false;
    clearExitCountdownTimers();
    clearBlurCheckTimer();
    setExitCountdown(null);
    setViolationCount(prev => prev + 1);
    isExiting.current = true;
    showFinishConfirmRef.current = false;
    setShowFinishConfirm(false);
    await releaseScreenWakeLock();

    const studentUid = exam.isSimulation
      ? (exam.simulatedStudentUid || `sim_${user?.uid || 'siswa'}`)
      : (user?.uid || userProfile?.uid || userProfile?.id || 'siswa');
    const studentName = displayStudentName;
    const studentClass = exam.isSimulation ? (exam.simulatedClass || '7A') : (userProfile?.kelas || '');
    const studentRoom = exam.isSimulation
      ? (exam.simulatedRoom || exam.tokenCreatorRuang || 'Ruang 01')
      : (userProfile?.ruang || exam.tokenCreatorRuang || '');

    // Bunyikan sirine peringatan pelanggaran yang nyaring & mudah dikenali di perangkat siswa
    playViolationAlarmSound({
      role: 'siswa',
      studentName,
      kelas: studentClass,
      ruang: studentRoom,
      examTitle: exam.title,
      violationType: type,
    });

    const fallbackRecord = {
      id: `local_viol_${Date.now()}`,
      studentId: studentUid,
      studentName,
      kelas: studentClass,
      ruang: studentRoom,
      examId: exam.id,
      examTitle: exam.title,
      subjectName: exam.subjectName || 'N/A',
      type,
      tokenCode: exam.tokenCode || '',
      tokenCreatorId: exam.tokenCreatorId || '',
      isReset: false,
      timestamp: new Date().toISOString()
    };

    try {
      const savedViolation = await reportViolation(
        studentUid,
        studentName,
        studentClass,
        studentRoom,
        exam.id,
        exam.title,
        exam.subjectName || 'N/A',
        type,
        exam.tokenCode || '',
        exam.tokenCreatorId || ''
      );
      
      await safelyCloseFullscreen();
      onExit('violation', type, savedViolation || fallbackRecord);
    } catch (e) {
      console.error("Error reporting violation:", e);
      await safelyCloseFullscreen();
      onExit('violation', type, fallbackRecord);
    }
  };

  // Saat siswa keluar untuk pertama kalinya (lepas fullscreen / kehilangan fokus / pindah layar):
  // Jangan langsung vonis pelanggaran! Beri tombol "Selesai Ujian" dengan waktu hitungan mundur (default 10 detik, bisa di-custom Admin).
  // Bila siswa memilih "Kembali ke Ujian" atau tidak segera klik "Selesai Ujian" dalam waktu tersebut, baru masuk Data Pelanggaran & Alarm berbunyi!
  const handleViolation = (type: string, forceTrigger = false, immediateCommit = false) => {
    if (isExiting.current || isSafeExitRef.current) return;
    if (!forceTrigger && showFinishConfirmRef.current) return;
    if (exam.isSimulation && bypassAntiCheat && !forceTrigger) return;

    // Masa Toleransi Awal Ujian (Default: 15 Menit Pertama, dikontrol Admin)
    // Dalam masa longgar ini, siswa bebas mengetik email & identitas tanpa divonis pelanggaran
    if (isInEarlyGracePeriod && !forceTrigger) {
      if (type.includes('Layar Penuh') || type.includes('Escape')) {
        setIsFullscreen(false);
      }
      return;
    }

    if (immediateCommit) {
      commitFinalViolation(type);
      return;
    }

    // Jika hitungan mundur sudah berjalan, jangan di-reset agar waktu tetap berjalan ketat
    if (exitCountdownActiveRef.current) return;

    clearBlurCheckTimer();
    clearExitCountdownTimers();
    exitCountdownActiveRef.current = true;
    hasStartedExamRef.current = true;

    const durationMs = configuredCountdownMs;
    const deadline = Date.now() + durationMs;
    setExitCountdown({ type, remainingMs: durationMs });

    exitCountdownIntervalRef.current = setInterval(() => {
      if (isSafeExitRef.current || isExiting.current) {
        clearExitCountdownTimers();
        return;
      }
      const left = Math.max(0, deadline - Date.now());
      setExitCountdown(prev => (prev ? { ...prev, remainingMs: left } : null));
    }, 100);

    exitCountdownTimeoutRef.current = setTimeout(() => {
      if (!isSafeExitRef.current && !isExiting.current) {
        commitFinalViolation(type);
      }
    }, durationMs);
  };

  // Aktifkan Screen Wake Lock saat ruang ujian dibuka & saat kembali fokus
  useEffect(() => {
    requestScreenWakeLock();
    const handleUserInteraction = () => {
      if (!wakeLockSentinelRef.current && !document.hidden && !isExiting.current) {
        requestScreenWakeLock();
      }
    };
    window.addEventListener('click', handleUserInteraction, { passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });
    return () => {
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('touchstart', handleUserInteraction);
      releaseScreenWakeLock();
    };
  }, []);

  useEffect(() => {
    const updateTick = () => {
      const now = new Date();
      setCurrentTime(now);

      if (exam.endTime) {
        const end = exam.endTime.toDate ? exam.endTime.toDate() : new Date(exam.endTime);
        const diff = end.getTime() - now.getTime();

        if (diff <= 0) {
          setTimeLeft('WAKTU HABIS');
        } else {
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }
      }
    };

    updateTick();
    const timer = setInterval(updateTick, 1000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [exam.endTime]);

  useEffect(() => {
    // Rekam ukuran awal layar saat ujian dibuka sebagai acuan deteksi Split Screen
    if (baselineViewportRef.current.width === 0 && window.innerWidth > 0) {
      baselineViewportRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }

    const isCurrentlyInNativeFullscreen = (): boolean => {
      if (typeof document === 'undefined') return false;
      const docAny = document as any;
      return !!(
        document.fullscreenElement ||
        docAny.webkitFullscreenElement ||
        docAny.mozFullScreenElement ||
        docAny.msFullscreenElement
      );
    };

    // Deteksi apakah fokus sedang berada di dalam iframe Google Form atau baru saja berinteraksi di dalam ruang ujian
    // Saat siswa menekan tombol Berikutnya, Kembali, atau Submit di Google Form, iframe melakukan unload -> network POST -> reload.
    // Selama tab TIDAK pindah (!document.hidden) dan layar TIDAK terbagi (Split Screen), pelepasan fokus internal iframe BUKAN pelanggaran.
    const isInternalExamOrIframeTransition = (): boolean => {
      const now = Date.now();
      if (now < graceProtectionUntilRef.current || now < fullscreenTransitionUntilRef.current) {
        return true;
      }

      // Pada perangkat iOS (iPhone / iPad), WebKit tidak menyediakan API Fullscreen native untuk elemen HTML biasa.
      // Selama tab masih berada di latar depan (!document.hidden) dan siswa sudah menekan tombol Mulai Ujian,
      // fokus yang berada di dalam iframe Google Form adalah aktivitas sah dan BUKAN pelanggaran.
      const isIOSDevice = typeof navigator !== 'undefined' && (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1)
      );
      if (isIOSDevice && !document.hidden && hasEnteredFullscreenRef.current) {
        return true;
      }

      if (typeof document !== 'undefined') {
        const active = document.activeElement;
        if (active === iframeRef.current || active?.tagName === 'IFRAME') {
          wasIframeFocusedRef.current = true;
          lastIframeActiveAtRef.current = now;
          return true;
        }
      }
      // Selama fokus sebelumnya berada di dalam iframe Google Form (misal sedang mengisi soal, klik Berikutnya, Kembali, atau Submit)
      // dan tab masih terlihat (!document.hidden), lindungi transisi fokus internal iframe
      if (wasIframeFocusedRef.current && !document.hidden) {
        return true;
      }
      if (isCurrentlyInNativeFullscreen() && !document.hidden) {
        return true;
      }
      if (now - lastIframeLoadAtRef.current < 8000) return true;
      if (now - lastIframeActiveAtRef.current < 10000) return true;
      if (now - lastParentInteractionAtRef.current < 3500) return true;
      return false;
    };

    const isFullscreenLockOverlayVisible = (): boolean => {
      return (
        exitCountdownActiveRef.current ||
        (!isFullscreen && !hasStartedExamRef.current && !skipFullscreenPrompt && !showFinishConfirmRef.current && !(exam.isSimulation && bypassAntiCheat))
      );
    };

    const detectSplitScreenViolation = (): string | null => {
      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return null;
      if (exam.isSimulation && bypassAntiCheat) return null;
      if (isInEarlyGracePeriod) return null;
      // Jika sedang berada di Layar Pengunci Peringatan (keluar fullscreen) atau masa transisi aman, jangan picu pelanggaran ukuran layar
      if (isFullscreenLockOverlayVisible()) return null;

      // iPhone secara sistem operasi (iOS) tidak mendukung fitur Split Screen aplikasi berdampingan (hanya ada di iPad & Android).
      // Jangan pernah memicu pelanggaran split screen di iPhone akibat keyboard virtual atau bar navigasi Safari.
      const isIPhoneDevice = typeof navigator !== 'undefined' && (
        /iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1 && window.screen.width < 500)
      );
      if (isIPhoneDevice) return null;

      const now = Date.now();
      if (now < fullscreenTransitionUntilRef.current || now < graceProtectionUntilRef.current) return null;
      if (now - lastIframeLoadAtRef.current < 4000) return null;

      const isTopWindow = (() => {
        try {
          return window.self === window.top;
        } catch {
          return false;
        }
      })();

      const availW = window.screen?.availWidth || window.screen?.width || 0;
      const innerW = window.innerWidth || 0;
      const outerW = window.outerWidth || innerW;

      // 1. Jika berjalan di jendela utama (bukan preview iframe), periksa apakah jendela dibagi kiri-kanan (Split Screen)
      // Ambang batas 70% agar keyboard HP, margin scrollbar, atau autofill popup tidak memicu pelanggaran palsu
      if (isTopWindow && availW > 0 && now - mountedAtRef.current > 600) {
        if (outerW < availW * 0.70 || innerW < availW * 0.70) {
          return 'Terdeteksi Membuka 2 Aplikasi / Split Layar di Luar Ujian';
        }
      }

      // 2. Periksa penyusutan lebar layar dibanding ukuran awal (hanya split horizontal yang dianggap pelanggaran)
      const baseW = baselineViewportRef.current.width;
      if (baseW > 0 && innerW < baseW * 0.70) {
        return 'Terdeteksi Membuka 2 Aplikasi / Split Layar (Ukuran Layar Menyusut)';
      }

      // Catatan: JANGAN memeriksa penyusutan tinggi layar (innerH) karena saat mengetik email di HP,
      // keyboard virtual (Gboard/Samsung) memotong 40-50% tinggi layar dan itu wajar, BUKAN split screen!

      return null;
    };

    // 1. Deteksi Pindah Tab / Minimize Browser
    const handleVisibilityChange = () => {
      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
      if (exam.isSimulation && bypassAntiCheat) return;
      if (isInEarlyGracePeriod) return;

      if (document.hidden) {
        handleViolation('Membuka Tab Lain / Meninggalkan Layar Ujian', true);
      } else if (exitCountdownActiveRef.current) {
        // Bila siswa keluar tab lalu kembali lagi ke layar ujian (bukannya klik Selesai Ujian), langsung catat pelanggaran & bunyikan alarm!
        commitFinalViolation('Membuka Tab Lain / Meninggalkan Layar Ujian lalu Kembali ke Ujian');
      }
    };

    const handlePageHide = () => {
      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
      if (exam.isSimulation && bypassAntiCheat) return;
      if (isInEarlyGracePeriod) return;
      if (Date.now() < graceProtectionUntilRef.current) {
        return;
      }
      handleViolation('Membuka Tab Lain / Meninggalkan Halaman Ujian', true);
    };

    // 2. Deteksi Kehilangan Fokus / Membuka 2 Aplikasi (Aman Saat Ketik Email, Autofill, & Klik Berikutnya/Kembali/Submit di Google Form)
    const handleBlur = () => {
      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
      if (exam.isSimulation && bypassAntiCheat) return;
      if (isFullscreenLockOverlayVisible()) return;
      if (isInEarlyGracePeriod) return;

      // Jika tab benar-benar tersembunyi (pindah tab atau minimize aplikasi)
      if (document.hidden) {
        if (Date.now() < graceProtectionUntilRef.current) return;
        handleViolation('Membuka Tab Lain / Meninggalkan Layar Ujian', true);
        return;
      }

      // Jika tab masih terlihat (!document.hidden), kehilangan fokus jendela utama
      // seringkali terjadi saat siswa mengetik email, saran autofill muncul, keyboard virtual HP aktif,
      // atau fokus berpindah ke dalam input form di iframe.
      // Hanya picu jika terdeteksi split screen nyata:
      const splitReasonNow = detectSplitScreenViolation();
      if (splitReasonNow) {
        handleViolation(splitReasonNow, true);
        return;
      }

      // Jika fokus berpindah ke dalam iframe Google Form atau sedang dalam masa aman transisi Berikutnya / Kembali / Submit
      if (isInternalExamOrIframeTransition()) {
        return;
      }

      clearBlurCheckTimer();
      blurCheckTimeoutRef.current = setTimeout(() => {
        if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
        if (exam.isSimulation && bypassAntiCheat) return;
        if (isFullscreenLockOverlayVisible()) return;
        if (isInEarlyGracePeriod) return;

        if (document.hidden) {
          if (Date.now() < graceProtectionUntilRef.current) return;
          handleViolation('Membuka Tab Lain / Meninggalkan Layar Ujian', true);
          return;
        }

        const splitReason = detectSplitScreenViolation();
        if (splitReason) {
          handleViolation(splitReason, true);
          return;
        }

        // Selama tab browser masih terlihat di layar depan (!document.hidden),
        // jangan memvonis pelanggaran hanya karena keyboard atau saran email autofill
      }, 500);
    };

    // 3. Deteksi Perubahan Ukuran Layar / Split Screen secara Real-Time
    const handleResize = () => {
      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
      if (exam.isSimulation && bypassAntiCheat) return;
      if (isInEarlyGracePeriod) return;
      if (isFullscreenLockOverlayVisible()) return;

      // Perbarui baseline jika layar membesar (misalnya baru masuk Fullscreen)
      if (window.innerWidth > baselineViewportRef.current.width) {
        baselineViewportRef.current.width = window.innerWidth;
      }
      if (window.innerHeight > baselineViewportRef.current.height) {
        baselineViewportRef.current.height = window.innerHeight;
      }

      const splitReason = detectSplitScreenViolation();
      if (splitReason) {
        handleViolation(splitReason, true);
      }
    };

    // 4. Deteksi Pintasan Keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
      if (exam.isSimulation && bypassAntiCheat) return;

      if (e.key === 'Escape') {
        // Saat tombol Escape ditekan, buka layar hitungan mundur 3 detik Selesai Ujian sebelum masuk ke pelanggaran
        handleViolation('Keluar dari Mode Layar Penuh / Menekan Tombol Escape', true);
        return;
      }

      const key = e.key?.toLowerCase();
      if (
        ((e.ctrlKey || e.metaKey) && (key === 't' || key === 'n' || key === 'w' || key === 'l' || key === 'tab')) ||
        (e.altKey && (key === 'tab' || key === 'f4')) ||
        (e.metaKey && (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown')) ||
        e.key === 'F12'
      ) {
        e.preventDefault();
        e.stopPropagation();
        handleViolation('Menggunakan Pintasan Keyboard untuk Pindah Tab / Split Layar', true);
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isSafeExitRef.current || isExiting.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    // 5. Deteksi Keluar dari Mode Layar Penuh (Fullscreen) -> Beri Tombol Selesai Ujian & Waktu 3 Detik Sebelum Masuk Pelanggaran
    const handleFullscreenChange = () => {
      const isFull = isCurrentlyInNativeFullscreen();
      const now = Date.now();
      fullscreenTransitionUntilRef.current = now + 1500;
      clearBlurCheckTimer();

      if (isFull) {
        hasEnteredFullscreenRef.current = true;
        hasStartedExamRef.current = true;
        baselineViewportRef.current = {
          width: Math.max(baselineViewportRef.current.width, window.innerWidth),
          height: Math.max(baselineViewportRef.current.height, window.innerHeight),
        };
        setIsFullscreen(true);
      } else {
        setIsFullscreen(false);
        if (hasEnteredFullscreenRef.current && !isSafeExitRef.current && !isExiting.current && !showFinishConfirmRef.current) {
          if (!(exam.isSimulation && bypassAntiCheat)) {
            handleViolation('Keluar dari Mode Layar Penuh / Meninggalkan Layar Ujian', true);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Anti copy-paste
    const preventDefault = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', preventDefault);
    document.addEventListener('copy', preventDefault);
    document.addEventListener('paste', preventDefault);

    // 6. Patroli Ketat (Heartbeat) setiap 200 milidetik untuk memantau fokus iframe & menangkap Pindah Tab / Split Screen
    const heartbeat = setInterval(() => {
      // Pantau terus apakah siswa sedang aktif di dalam iframe Google Form
      if (typeof document !== 'undefined') {
        const active = document.activeElement;
        if (active === iframeRef.current || active?.tagName === 'IFRAME') {
          wasIframeFocusedRef.current = true;
          lastIframeActiveAtRef.current = Date.now();
        }
      }

      if (isExiting.current || isSafeExitRef.current || showFinishConfirmRef.current) return;
      if (exam.isSimulation && bypassAntiCheat) return;
      if (isFullscreenLockOverlayVisible()) return;

      if (document.hidden) {
        if (Date.now() < graceProtectionUntilRef.current) {
          return;
        }
        handleViolation('Membuka Tab Lain / Meninggalkan Layar Ujian', true);
        return;
      }

      const splitReason = detectSplitScreenViolation();
      if (splitReason) {
        handleViolation(splitReason, true);
        return;
      }

      // Selama siswa berada di dalam Fullscreen atau sedang berinteraksi/navigasi (Berikutnya/Kembali/Submit) di iframe Google Form,
      // jangan anggap pelepasan fokus internal iframe sebagai pelanggaran
      if (isInternalExamOrIframeTransition()) {
        return;
      }

      if (Date.now() - mountedAtRef.current > 500 && !document.hasFocus()) {
        handleViolation('Membuka 2 Aplikasi / Aktivitas Split Layar di Luar Ujian');
      }
    }, 200);

    return () => {
      clearBlurCheckTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      document.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('copy', preventDefault);
      document.removeEventListener('paste', preventDefault);
      clearInterval(heartbeat);
    };
  }, [exam.id, user, userProfile, bypassAntiCheat, isFullscreen]);

  const enterFullscreen = () => {
    const elem = (document.documentElement || containerRef.current) as any;
    const now = Date.now();
    fullscreenTransitionUntilRef.current = now + 1500;
    graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, now + 4000);
    hasEnteredFullscreenRef.current = true;
    hasStartedExamRef.current = true;
    setIsFullscreen(true);
    baselineViewportRef.current = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
    requestScreenWakeLock();

    const focusIframeSafely = () => {
      setTimeout(() => {
        try {
          baselineViewportRef.current = {
            width: Math.max(baselineViewportRef.current.width, window.innerWidth),
            height: Math.max(baselineViewportRef.current.height, window.innerHeight),
          };
          iframeRef.current?.focus();
        } catch (e) {}
      }, 150);
    };

    if (!elem) {
      focusIframeSafely();
      return;
    }

    try {
      if (elem.requestFullscreen) {
        elem.requestFullscreen()
          .then(() => {
            setIsFullscreen(true);
            focusIframeSafely();
          })
          .catch(() => {
            setIsFullscreen(true);
            focusIframeSafely();
          });
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
        focusIframeSafely();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
        focusIframeSafely();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
        focusIframeSafely();
      } else {
        focusIframeSafely();
      }
    } catch (err) {
      console.error("Fullscreen error:", err);
      setIsFullscreen(true);
      focusIframeSafely();
    }
  };

  const getEmbedUrl = (url?: string) => {
    if (!url) return '';
    let processedUrl = url.trim();
    
    // Ensure protocol
    if (!processedUrl.startsWith('http')) {
      processedUrl = 'https://' + processedUrl;
    }

    // Google Forms handling
    if (processedUrl.includes('docs.google.com/forms')) {
      try {
        // Normalisasi path agar selalu berakhir pada /viewform?embedded=true
        if (processedUrl.includes('/edit')) {
          processedUrl = processedUrl.replace(/\/edit(\?.*)?$/, '/viewform');
        } else if (processedUrl.includes('/formResponse')) {
          processedUrl = processedUrl.replace(/\/formResponse(\?.*)?$/, '/viewform');
        }
        
        const urlObj = new URL(processedUrl);
        urlObj.searchParams.set('embedded', 'true');
        processedUrl = urlObj.toString();
      } catch (e) {
        if (!processedUrl.includes('embedded=true')) {
          processedUrl = processedUrl.includes('?') 
            ? `${processedUrl}&embedded=true` 
            : `${processedUrl}?embedded=true`;
        }
      }
    } else if (processedUrl.includes('forms.gle/')) {
      console.warn("Shortened Google Forms links (forms.gle) may not work reliably in iframes. Please use the full URL from the 'Send' dialog.");
    }
    
    return processedUrl;
  };

  const embedUrl = getEmbedUrl(decryptLink(exam.googleFormLink || exam.link || ''));

  useEffect(() => {
    console.log('ExamRoom initialized with URL:', embedUrl);
  }, [embedUrl]);

  const reloadExamIframe = () => {
    const now = Date.now();
    lastParentInteractionAtRef.current = now;
    graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, now + 6000);
    isManualReloadingIframeRef.current = false;
    iframeLoadCountRef.current = 0;
    hasSubmittedOrNavigatedRef.current = false;
    setHasSubmittedOrNavigatedForm(false);
    // Remount elemen <iframe> secara bersih agar scroll & compositor browser selalu segar
    setIframeRenderKey(prev => prev + 1);
  };

  const isFullscreenPromptVisible =
    !isFullscreen && !exitCountdown && !skipFullscreenPrompt && !showFinishConfirm && !(exam.isSimulation && bypassAntiCheat);

  return (
    <div ref={containerRef} className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
      {/* MOBILE ULTRA-COMPACT TOP BAR (< md): Hanya Timer & Tombol Selesai Ujian (+ ikon kecil Reload/Info) agar layar soal maksimal */}
      <div className="md:hidden bg-gray-900 text-white px-2.5 py-1.5 flex items-center justify-between gap-2 border-b border-gray-800 shrink-0">
        {/* Kiri: Timer + Titik Indikator Online + Badge Mode Longgar */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-blue-950/80 px-2.5 py-1 rounded-lg border border-blue-500/40">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-emerald-400' : 'bg-red-500 animate-ping'}`}
              title={isOnline ? 'Online' : 'Offline'}
            />
            <ClockIcon size={13} className="text-blue-400 shrink-0" />
            <span className={`text-xs font-mono font-extrabold tracking-tight ${timeLeft === 'WAKTU HABIS' ? 'text-red-400 animate-pulse' : 'text-white'}`}>
              {timeLeft}
            </span>
          </div>

          {isInEarlyGracePeriod ? (
            <div className="flex items-center gap-1 bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 px-2 py-0.5 rounded-lg text-[10px] font-extrabold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
              <span>Longgar: {formatGraceTime(graceTimeRemainingMs)}</span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1 bg-blue-950/80 border border-blue-500/30 text-blue-300 px-2 py-0.5 rounded-lg text-[10px] font-bold">
              <ShieldCheck size={11} className="text-blue-400 shrink-0" />
              <span>Ketat</span>
            </div>
          )}
        </div>

        {/* Kanan: Ikon Kecil Reload, Toggle Detail, & Tombol Utama Selesai Ujian */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onPointerDown={() => { lastParentInteractionAtRef.current = Date.now(); }}
            onTouchStart={() => { lastParentInteractionAtRef.current = Date.now(); }}
            onClick={reloadExamIframe}
            className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 cursor-pointer active:scale-95"
            title="Muat ulang lembar soal"
          >
            <RefreshCw size={14} />
          </button>

          <button
            type="button"
            onPointerDown={() => { lastParentInteractionAtRef.current = Date.now(); }}
            onTouchStart={() => { lastParentInteractionAtRef.current = Date.now(); }}
            onClick={() => setShowMobileHeaderDetail(prev => !prev)}
            className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 cursor-pointer active:scale-95"
            title="Lihat detail mapel & info peserta"
          >
            {showMobileHeaderDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          <button
            type="button"
            onPointerDown={openFinishConfirmModalSafely}
            onTouchStart={openFinishConfirmModalSafely}
            onClick={openFinishConfirmModalSafely}
            className={`flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-3 py-1.5 rounded-lg shadow-sm transition-all text-xs cursor-pointer active:scale-95 ${
              hasSubmittedOrNavigatedForm ? 'ring-2 ring-emerald-300/80 shadow-md shadow-emerald-500/20' : ''
            }`}
          >
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{exam.isSimulation ? 'Selesai' : 'Selesai Ujian'}</span>
          </button>
        </div>
      </div>

      {/* Laci Info Tambahan di Mobile (Hanya muncul jika siswa/pengawas menekan ikon panah kecil) */}
      {showMobileHeaderDetail && (
        <div className="md:hidden bg-gray-800/95 text-white px-3 py-2 border-b border-gray-700 text-[11px] space-y-1.5 shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-white truncate">{exam.title}</span>
            <span className="text-gray-400 shrink-0 font-mono">Token: {exam.tokenCode || '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-gray-300">
            <span className="truncate">
              {displayStudentName} {exam.simulatedClass ? `(${exam.simulatedClass})` : ''}
            </span>
            <span className="text-red-300 font-bold shrink-0">Pelanggaran: {violationCount}</span>
          </div>
          {Boolean(exam.isSimulation && (userProfile?.role === 'admin' || userProfile?.role === 'pengawas')) && (
            <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-gray-700">
              <span className="text-[10px] font-bold text-amber-300 flex items-center gap-1">
                <Sparkles size={11} className="text-amber-400" /> Mode Uji Coba
              </span>
              <div className="flex items-center gap-1.5">
                {exam.isSimulation && (
                  <button
                    type="button"
                    onClick={() => setBypassAntiCheat(prev => !prev)}
                    className={`px-2 py-0.5 rounded text-[10px] font-extrabold flex items-center gap-1 cursor-pointer ${
                      bypassAntiCheat ? 'bg-emerald-500 text-gray-950' : 'bg-gray-700 text-gray-200'
                    }`}
                  >
                    <ShieldCheck size={10} />
                    {bypassAntiCheat ? 'Bypass: ON' : 'Anti-Curang: ON'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleViolation('Pindah Tab / Pelanggaran Uji Coba Ujian', true)}
                  className="px-2 py-0.5 bg-red-600 text-white rounded text-[10px] font-extrabold flex items-center gap-1 cursor-pointer"
                >
                  <Zap size={10} />
                  Tes Pelanggaran
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DESKTOP / TABLET HEADER (md:flex): Tampil lengkap di layar besar */}
      <div className="hidden md:flex bg-gray-800 text-white p-3.5 justify-between items-center gap-4 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3 w-auto">
          <ShieldAlert className="text-red-500 shrink-0" />
          <div className="overflow-hidden">
            <h1 className="font-bold text-lg truncate">{exam.title}</h1>
            <p className="text-xs text-gray-400 truncate">
              Siswa: {displayStudentName} {exam.simulatedClass ? `(${exam.simulatedClass} • ${exam.simulatedRoom || 'Ruang 01'})` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-4 w-auto flex-wrap">
          {/* Clock & Network */}
          <div className="flex items-center gap-4 mr-2">
            <div className="flex items-center gap-1.5 text-gray-300">
              <ClockIcon size={14} className="text-blue-400" />
              <span className="text-xs font-mono font-bold">{currentTime.toLocaleTimeString('id-ID')}</span>
            </div>
            <div className={`flex items-center gap-1.5 ${isOnline ? 'text-green-400' : 'text-red-400'}`}>
              {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span className="text-[10px] font-bold uppercase">{isOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>

          {/* Timer */}
          <div className="flex items-center gap-2 bg-blue-900/30 px-3 py-1 rounded-lg border border-blue-500/50">
            <span className="text-[10px] text-blue-300 font-bold uppercase">Sisa Waktu:</span>
            <span className={`text-sm font-mono font-bold ${timeLeft === 'WAKTU HABIS' ? 'text-red-400' : 'text-white'}`}>{timeLeft}</span>
          </div>

          <div className="flex items-center gap-2 bg-red-900/30 px-3 py-1 rounded-lg border border-red-500/50">
            <AlertTriangle size={14} className="text-red-500" />
            <span className="text-sm font-medium text-red-200">Pelanggaran: {violationCount}</span>
          </div>
          
          {Boolean(exam.isSimulation && (userProfile?.role === 'admin' || userProfile?.role === 'pengawas')) && (
            <div className="flex items-center gap-1.5 bg-amber-500/20 border border-amber-400/50 px-2.5 py-1 rounded-lg">
              <Sparkles size={13} className="text-amber-400 shrink-0" />
              <span className="text-[11px] font-bold text-amber-300">Mode Uji Coba</span>
              {exam.isSimulation && (
                <button
                  type="button"
                  onClick={() => setBypassAntiCheat(prev => !prev)}
                  className={`ml-1 px-2 py-0.5 rounded text-[10px] font-extrabold transition-all flex items-center gap-1 cursor-pointer ${
                    bypassAntiCheat
                      ? 'bg-emerald-500 text-gray-950 shadow-sm'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                  title="Jika aktif, Anda bebas klik di luar layar / keluar fullscreen tanpa terkena sanksi pelanggaran"
                >
                  <ShieldCheck size={11} />
                  {bypassAntiCheat ? 'Bypass Anti-Curang: ON' : 'Anti-Curang: AKTIF'}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleViolation('Pindah Tab / Pelanggaran Uji Coba Ujian', true)}
                className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-extrabold transition-all flex items-center gap-1 cursor-pointer"
                title="Simulasikan terjadinya pelanggaran untuk menguji pencatatan data pelanggaran, alarm suara, & penguncian token"
              >
                <Zap size={11} />
                Tes Rekam Pelanggaran
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button 
              type="button"
              onPointerDown={() => { lastParentInteractionAtRef.current = Date.now(); }}
              onClick={reloadExamIframe}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-3.5 py-2 rounded-md transition-colors text-sm cursor-pointer"
              title="Muat ulang soal jika tidak tampil"
            >
              <RefreshCw size={16} />
              <span>Muat Ulang</span>
            </button>

            {!isFullscreen && (
              <button 
                onClick={enterFullscreen}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-3.5 py-2 rounded-md transition-colors text-sm"
              >
                <Maximize size={16} />
                <span>Fokus</span>
              </button>
            )}

            <button 
              type="button"
              onPointerDown={openFinishConfirmModalSafely}
              onTouchStart={openFinishConfirmModalSafely}
              onClick={openFinishConfirmModalSafely}
              className={`flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-lg shadow-sm transition-all text-sm cursor-pointer ${
                hasSubmittedOrNavigatedForm ? 'ring-2 ring-emerald-300/80 shadow-md shadow-emerald-500/20' : ''
              }`}
              title="Klik tombol ini jika Anda sudah mengirim jawaban (Submit) dan ingin mengakhiri ujian"
            >
              <CheckCircle2 size={16} />
              <span>{exam.isSimulation ? 'Selesai Simulasi' : 'Selesai Ujian'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content (min-h-0 & overflow-hidden wajib ada agar tinggi flex-1 terkunci dan iframe bisa di-scroll ke atas & bawah) */}
      <div className="flex-1 min-h-0 w-full relative bg-white overflow-hidden">
        {/* Layar Hitungan Mundur Saat Siswa Keluar Pertama Kali (Sebelum Masuk Data Pelanggaran & Bunyi Alarm) */}
        {exitCountdown && (
          <div className="absolute inset-0 bg-gray-950/95 backdrop-blur-md z-40 flex items-center justify-center p-4 sm:p-6 text-center select-none">
            <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-amber-400 space-y-5 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex flex-col items-center gap-2">
                <div className="w-20 h-20 rounded-full bg-amber-100 border-4 border-amber-500 text-amber-700 flex flex-col items-center justify-center shadow-inner">
                  <span className="text-3xl font-black font-mono leading-none">
                    {Math.max(1, Math.ceil(exitCountdown.remainingMs / 1000))}
                  </span>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider">Detik</span>
                </div>
                <div className="w-full bg-gray-200 h-2.5 rounded-full overflow-hidden mt-1">
                  <div
                    className="bg-amber-500 h-full transition-all duration-100 ease-linear"
                    style={{ width: `${Math.min(100, Math.max(0, (exitCountdown.remainingMs / configuredCountdownMs) * 100))}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-lg sm:text-xl font-black text-gray-900">
                  Sudah Submit? Klik Selesai Ujian Sekarang!
                </h3>
                <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                  Jika Anda sudah menekan <strong>Submit / Kirim</strong> pada Google Form, segera klik tombol hijau <strong>Selesai Ujian</strong> dalam <strong>{Math.max(1, Math.ceil(exitCountdown.remainingMs / 1000))} detik</strong> (Batas: {configuredCountdownSeconds} detik) agar tidak tercatat sebagai pelanggaran.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-1">
                <button
                  type="button"
                  onPointerDown={handleSafeFinishExam}
                  onTouchStart={handleSafeFinishExam}
                  onClick={handleSafeFinishExam}
                  className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl text-base sm:text-lg shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2.5 cursor-pointer active:scale-95"
                >
                  <CheckCircle2 size={22} className="shrink-0" />
                  <span>Selesai Ujian (Saya Sudah Submit)</span>
                </button>

                <button
                  type="button"
                  onClick={() => commitFinalViolation(`${exitCountdown.type} (Kembali ke Ujian)`)}
                  className="w-full py-3 px-5 bg-gray-100 hover:bg-red-50 text-gray-700 hover:text-red-700 font-extrabold rounded-2xl text-xs sm:text-sm border border-gray-300 transition-all cursor-pointer"
                >
                  Kembali ke Ujian
                </button>
              </div>

              <p className="text-[11px] font-bold text-red-600 leading-snug">
                ⚠️ Apabila Anda kembali ke ujian atau tidak menekan tombol Selesai Ujian dalam {configuredCountdownSeconds} detik, sistem akan mencatat ke Data Pelanggaran dan membunyikan Alarm Peringatan!
              </p>
            </div>
          </div>
        )}

        {!isFullscreen && !exitCountdown && !skipFullscreenPrompt && !showFinishConfirm && !(exam.isSimulation && bypassAntiCheat) ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/95 backdrop-blur-sm z-20 p-6 text-center select-none">
            <div className="max-w-lg w-full bg-gray-800/95 border border-gray-700 rounded-3xl p-6 sm:p-8 shadow-2xl">
              <div className="bg-blue-500/20 border-blue-500 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4 border">
                <Maximize className="text-blue-400" size={30} />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
                Mode Fokus Layar Penuh Wajib Aktif
              </h2>
              <p className="text-gray-300 text-xs sm:text-sm mb-4 leading-relaxed">
                Klik tombol di bawah untuk membuka lembar soal dalam mode layar penuh. Apabila sudah selesai mengirim jawaban (Submit), gunakan tombol <strong>Selesai Ujian</strong> agar keluar dengan aman.
              </p>
              <div className="p-3.5 bg-red-950/80 border border-red-500/60 rounded-2xl text-left text-xs text-red-200 mb-4 space-y-1">
                <p className="font-extrabold text-red-400 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>PERINGATAN ANTI-CURANG AKTIF:</span>
                </p>
                <p className="text-[11px] leading-relaxed text-red-100">
                  Membuka tab lain, berpindah aplikasi, atau menggunakan <strong>Split Layar (Layar Terbagi)</strong> akan menghentikan ujian dan mengunci token Anda.
                </p>
              </div>

              {/* Tips Khusus Pengguna iPhone / Safari */}
              <div className="p-3 bg-blue-950/70 border border-blue-500/40 rounded-2xl text-left text-xs text-blue-200 mb-5 space-y-1">
                <p className="font-bold text-blue-300 flex items-center gap-1.5 text-[11px]">
                  <span>📱 Khusus Pengguna iPhone / iPad:</span>
                </p>
                <p className="text-[10px] leading-relaxed text-blue-200/90">
                  • Wajib gunakan <strong>Safari resmi</strong> (bukan dari chat WhatsApp/Line).<br />
                  • Pastikan tidak dalam <strong>Mode Samaran/Pribadi (Private)</strong>.<br />
                  • Jika Google Form meminta izin / menolak terhubung: Buka <strong>Pengaturan iPhone &gt; Safari</strong> lalu matikan <strong>"Cegah Pelacakan Lintas Situs"</strong>.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  type="button"
                  onPointerDown={() => {
                    lastParentInteractionAtRef.current = Date.now();
                    graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, Date.now() + 4000);
                  }}
                  onClick={enterFullscreen}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-3.5 px-6 rounded-2xl text-xs sm:text-sm transition-all w-full flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-900/40 active:scale-98"
                >
                  <Maximize size={18} className="shrink-0" />
                  <span>Mulai Ujian Sekarang (Layar Penuh)</span>
                </button>

                {exam.isSimulation && (
                  <button
                    type="button"
                    onClick={() => {
                      hasStartedExamRef.current = true;
                      setSkipFullscreenPrompt(true);
                      setIsFullscreen(true);
                    }}
                    className="bg-amber-500 hover:bg-amber-400 text-gray-950 font-extrabold py-3 px-5 rounded-2xl text-xs sm:text-sm transition-all w-full flex items-center justify-center gap-2 cursor-pointer"
                    title="Khusus Simulasi Admin/Pengawas: Masuk tanpa fullscreen namun deteksi pindah tab & split layar tetap aktif"
                  >
                    <ShieldCheck size={18} />
                    Lewati Fullscreen (Khusus Simulasi)
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* In-App Confirmation Modal for Selesai Ujian */}
        {showFinishConfirm && (
          <div className="absolute inset-0 bg-gray-900/75 backdrop-blur-sm z-30 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-emerald-100 space-y-5 text-center animate-in fade-in zoom-in-95 duration-150">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={34} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-extrabold text-gray-900">Konfirmasi Selesai Ujian</h3>
                <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                  Apakah Anda yakin sudah menekan tombol <strong>Kirim / Submit</strong> pada formulir soal Google Form dan ingin mengakhiri ujian dengan tertib?
                </p>
              </div>
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-left text-xs text-emerald-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-emerald-800">
                  <ShieldCheck size={14} className="shrink-0 text-emerald-600" />
                  <span>Proteksi Aman Aktif Selama Konfirmasi:</span>
                </p>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  • Pilih <strong>"Batal (Lanjutkan Ujian)"</strong> jika Anda belum men-submit jawaban.<br />
                  • Pilih <strong>"Ya, Selesai Ujian"</strong> jika jawaban sudah terkirim (keluar tertib tanpa pelanggaran).
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onPointerDown={() => {
                    lastParentInteractionAtRef.current = Date.now();
                    graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, Date.now() + 4000);
                  }}
                  onClick={handleContinueExamFromConfirm}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-extrabold rounded-xl text-xs sm:text-sm transition-all cursor-pointer border border-gray-300"
                >
                  Batal (Lanjutkan Ujian)
                </button>
                <button
                  type="button"
                  onPointerDown={() => {
                    isSafeExitRef.current = true;
                    isExiting.current = true;
                  }}
                  onTouchStart={() => {
                    isSafeExitRef.current = true;
                    isExiting.current = true;
                  }}
                  onClick={handleSafeFinishExam}
                  className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs sm:text-sm shadow-lg shadow-emerald-100 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <CheckCircle2 size={16} />
                  <span>Ya, Selesai Ujian</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {embedUrl ? (
          isFullscreenPromptVisible ? (
            <div className="w-full h-full bg-gray-950" />
          ) : (
            <iframe 
              ref={iframeRef}
              key={`${embedUrl}-${exam.sessionInstanceKey || 0}-${iframeRenderKey}`}
              src={embedUrl}
              scrolling="yes"
              onFocus={() => {
                wasIframeFocusedRef.current = true;
                lastIframeActiveAtRef.current = Date.now();
              }}
              onMouseEnter={() => {
                lastIframeActiveAtRef.current = Date.now();
              }}
              onLoad={() => {
                const now = Date.now();
                lastIframeLoadAtRef.current = now;
                lastIframeActiveAtRef.current = now;
                wasIframeFocusedRef.current = true;
                clearBlurCheckTimer();

                // Pastikan fokus langsung masuk ke dalam iframe agar scroll roda mouse & sentuhan langsung aktif
                setTimeout(() => {
                  try {
                    if (!showFinishConfirmRef.current && !exitCountdownActiveRef.current) {
                      iframeRef.current?.focus();
                    }
                  } catch (e) {}
                }, 80);

                // Abaikan onLoad yang berasal dari tombol manual "Muat Ulang"
                if (isManualReloadingIframeRef.current) {
                  const currentSrc = iframeRef.current?.getAttribute('src') || '';
                  if (currentSrc && currentSrc !== 'about:blank') {
                    isManualReloadingIframeRef.current = false;
                    iframeLoadCountRef.current = 1;
                    firstIframeLoadAtRef.current = now;
                  }
                  return;
                }

                iframeLoadCountRef.current += 1;
                if (iframeLoadCountRef.current === 1) {
                  firstIframeLoadAtRef.current = now;
                  return;
                }

                // Saat <iframe> mengalami perpindahan halaman (misal klik Berikutnya, Kembali, atau Kirim/Submit di Google Form):
                // Berikan masa aman (grace protection) dan tampilkan banner bantuan di bagian atas tanpa mengunci layar soal.
                if (iframeLoadCountRef.current >= 2 && now - firstIframeLoadAtRef.current > 800) {
                  graceProtectionUntilRef.current = Math.max(graceProtectionUntilRef.current, now + 10000);
                  hasSubmittedOrNavigatedRef.current = true;
                  setHasSubmittedOrNavigatedForm(true);
                }
              }}
              className="absolute inset-0 w-full h-full border-none block z-10"
              style={{
                touchAction: 'auto',
                WebkitOverflowScrolling: 'touch',
                pointerEvents: exitCountdown || showFinishConfirm ? 'none' : 'auto',
              }}
              title="Exam Content"
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
            <AlertTriangle size={48} className="mb-4 text-amber-500" />
            <p className="text-lg font-bold">Link Soal Tidak Tersedia</p>
            <p className="text-sm">Admin belum mengatur link Google Form untuk ujian ini atau link tidak valid.</p>
          </div>
        )}
      </div>

      {/* Footer Info (Disembunyikan pada tampilan Mobile agar tidak memakan ruang layar soal) */}
      <div className="hidden md:flex bg-gray-800 text-gray-400 px-4 py-2 text-xs flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-bold text-red-300">
            🛡️ Anti-Curang & Anti-Split Layar Aktif • Tanpa Toleransi (0 Detik — Buka Tab Lain / Split Layar Langsung Terkunci!)
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
            wakeLockActive
              ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60'
              : 'bg-red-900/60 text-red-200 border border-red-700/60'
          }`}>
            {wakeLockActive
              ? '💡 Penahan Layar Anti-Mati: Aktif'
              : '🔒 Proteksi Fokus & Split Layar: Ketat'}
          </span>
        </div>
        <span>Token: {exam.tokenCode || '-'} (1x Pakai)</span>
      </div>
    </div>
  );
}
