// ============================================================================
// LAYANAN SUARA ALARM & PENANDA PELANGGARAN UJIAN (ADMIN, PENGAWAS & SISWA)
// ============================================================================
// Menghasilkan suara sirine darurat "TII-NUU TII-NUU" + Triple Strobe Beep yang
// sangat khas dan mudah dikenali menggunakan Web Audio API (100% bekerja tanpa file eksternal)
// ditambah pengumuman suara Bahasa Indonesia (Web Speech API).

const SOUND_ENABLED_KEY = 'smpn2_violation_sound_enabled';
const STUDENT_SOUND_ENABLED_KEY = 'smpn2_student_violation_sound_enabled';

let sharedAudioCtx: AudioContext | null = null;
let isAudioUnlocked = false;
let activeSirenStopTimer: number | null = null;
let lastPlayedTimestamp = 0;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
};

// Buka kunci AudioContext secara otomatis pada interaksi pertama pengguna (klik/ketuk/ketik)
// agar ketika notifikasi real-time pelanggaran masuk ke layar Admin/Pengawas, suara langsung berbunyi.
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (isAudioUnlocked) return;
    try {
      const ctx = getAudioContext();
      if (ctx) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        isAudioUnlocked = true;
      }
    } catch (e) {}
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

export const isViolationSoundEnabled = (): boolean => {
  try {
    const saved = localStorage.getItem(SOUND_ENABLED_KEY);
    if (saved === 'false') return false;
  } catch (e) {}
  return true;
};

export const setViolationSoundEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
    if (!enabled) {
      stopViolationAlarmSound();
    }
  } catch (e) {}
};

// Status notifikasi suara khusus pada akun Siswa (HANYA dapat diubah oleh Admin & Pengawas)
export const isStudentViolationSoundEnabled = (): boolean => {
  try {
    const saved = localStorage.getItem(STUDENT_SOUND_ENABLED_KEY);
    if (saved === 'false') return false;
  } catch (e) {}
  return true;
};

export const setStudentViolationSoundEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(STUDENT_SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
    if (!enabled) {
      stopViolationAlarmSound();
    }
  } catch (e) {}
};

export const stopViolationAlarmSound = (): void => {
  try {
    if (activeSirenStopTimer) {
      window.clearTimeout(activeSirenStopTimer);
      activeSirenStopTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (e) {}
};

export interface ViolationAlertPayload {
  role: 'admin' | 'pengawas' | 'siswa';
  studentName?: string;
  kelas?: string;
  ruang?: string;
  examTitle?: string;
  violationType?: string;
  forcePlay?: boolean;
}

/**
 * Memutar suara sirine khas pelanggaran ujian:
 * 1) 3x Beep Strobe Tajam (Penarik Perhatian Cepat)
 * 2) Sirine Hi-Lo "TII-NUU TII-NUU" (980 Hz <-> 740 Hz) yang nyaring & mudah dikenali
 * 3) Pengumuman Suara Bahasa Indonesia otomatis menyebutkan nama siswa, kelas, dan ruang
 */
export const playViolationAlarmSound = (payload: ViolationAlertPayload): void => {
  if (!payload.forcePlay) {
    if (payload.role === 'siswa') {
      if (!isStudentViolationSoundEnabled()) return;
    } else {
      if (!isViolationSoundEnabled()) return;
    }
  }

  const now = Date.now();
  // Cegah tumpang-tindih ekstrem jika dipicu beruntun dalam < 1.2 detik
  if (!payload.forcePlay && now - lastPlayedTimestamp < 1200) return;
  lastPlayedTimestamp = now;

  try {
    const ctx = getAudioContext();
    if (ctx) {
      const startTime = ctx.currentTime + 0.02;

      // Master Gain (Volume Utama Nyaring & Jelas)
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.45, startTime);
      masterGain.connect(ctx.destination);

      // BAGIAN 1: 3x Beep Strobe Tajam (0.0s - 0.55s) -> "TIT! TIT! TIT!"
      const beepFreqs = [1318.5, 1318.5, 1567.98];
      beepFreqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t0 = startTime + idx * 0.16;
        const t1 = t0 + 0.11;

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, t0);

        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.85, t0 + 0.015);
        gain.gain.setValueAtTime(0.85, t1 - 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t1);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t0);
        osc.stop(t1 + 0.01);
      });

      // BAGIAN 2: Sirine Darurat Hi-Lo "TII-NUU TII-NUU" (0.55s - 3.25s)
      // Menggunakan 2 osilator (square + triangle) agar suaranya tebal dan langsung dikenali di dalam kelas
      const sirenStart = startTime + 0.56;
      const cycles = payload.role === 'siswa' ? 4 : 3; // Siswa 4 siklus, Admin/Pengawas 3 siklus
      const halfCycleDuration = 0.32;
      const totalSirenDuration = cycles * 2 * halfCycleDuration;

      const oscPrimary = ctx.createOscillator();
      const oscHarmonic = ctx.createOscillator();
      const sirenGain = ctx.createGain();

      oscPrimary.type = 'square';
      oscHarmonic.type = 'triangle';

      for (let i = 0; i < cycles * 2; i++) {
        const segmentStart = sirenStart + i * halfCycleDuration;
        const isHigh = i % 2 === 0;
        const f1 = isHigh ? 988 : 740; // B5 <-> F#5 (Interval khas sirine peringatan)
        const f2 = isHigh ? 1976 : 1480;
        oscPrimary.frequency.setValueAtTime(f1, segmentStart);
        oscHarmonic.frequency.setValueAtTime(f2, segmentStart);
      }

      sirenGain.gain.setValueAtTime(0.001, sirenStart);
      sirenGain.gain.exponentialRampToValueAtTime(0.75, sirenStart + 0.03);
      sirenGain.gain.setValueAtTime(0.75, sirenStart + totalSirenDuration - 0.05);
      sirenGain.gain.exponentialRampToValueAtTime(0.001, sirenStart + totalSirenDuration);

      oscPrimary.connect(sirenGain);
      oscHarmonic.connect(sirenGain);
      sirenGain.connect(masterGain);

      oscPrimary.start(sirenStart);
      oscHarmonic.start(sirenStart);
      oscPrimary.stop(sirenStart + totalSirenDuration + 0.02);
      oscHarmonic.stop(sirenStart + totalSirenDuration + 0.02);
    }
  } catch (e) {
    console.warn('Web Audio alarm warning:', e);
  }

  // BAGIAN 3: Pengumuman Suara Bahasa Indonesia (Web Speech API) agar langsung tahu siapa yang melanggar
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (activeSirenStopTimer) {
        window.clearTimeout(activeSirenStopTimer);
      }
      activeSirenStopTimer = window.setTimeout(() => {
        try {
          window.speechSynthesis.cancel();
          let speechText = '';
          if (payload.role === 'siswa') {
            speechText = `Peringatan! Terdeteksi pelanggaran ujian. Akses ujian Anda telah dikunci. Silakan lapor kepada pengawas ruang.`;
          } else {
            const sName = payload.studentName || 'Peserta ujian';
            const sClass = payload.kelas && payload.kelas !== '-' ? `, kelas ${payload.kelas}` : '';
            const sRoom = payload.ruang && payload.ruang !== '-' ? `, di ${payload.ruang}` : '';
            speechText = `Peringatan pelanggaran ujian! ${sName}${sClass}${sRoom}, terdeteksi melakukan pelanggaran.`;
          }

          const utterance = new SpeechSynthesisUtterance(speechText);
          utterance.lang = 'id-ID';
          utterance.rate = 1.02;
          utterance.pitch = 1.05;
          utterance.volume = 1.0;
          window.speechSynthesis.speak(utterance);
        } catch (err) {}
      }, 1800);
    }
  } catch (e) {}
};
