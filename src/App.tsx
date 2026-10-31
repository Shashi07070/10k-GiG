/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ₹10K Delivery Challenge Tracker
 * Mobile-first AMOLED Progressive Web App for Yulu E-Bike delivery riders in Hyderabad.
 * All data stored locally on device via IndexedDB with localStorage fallback.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Trophy,
  Calculator,
  Award,
  Settings,
  ChevronDown,
  ChevronUp,
  Share2,
  Download,
  Upload,
  RotateCcw,
  Check,
  Copy,
  Image as ImageIcon,
  Smartphone,
  Sparkles,
  Zap,
  Navigation,
  BatteryCharging,
  Package,
  IndianRupee,
  Calendar,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
  Sliders,
  Target,
  TrendingUp,
} from 'lucide-react';

// ============================================================================
// 1. TYPES & DEFAULT DATA STRUCTURES
// ============================================================================

export interface DayEntry {
  dayNumber: number;
  date: string;
  orders: string;
  km: string;
  swaps: string;
  gross: string;
  rental: string;
  expenses: string;
}

export interface PromiseItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface CalculatorState {
  gross: string;
  rental: string;
  expenses: string;
  orders: string;
  km: string;
  swaps: string;
  daysLeft: string;
  netSoFar: string;
  whatIfOrdersPerDay: number;
}

export interface ChallengeData {
  targetAmount: number;
  totalDays: number;
  activeDayNumber: number;
  days: DayEntry[];
  promisesDate: string; // YYYY-MM-DD to auto-reset daily promises each new day
  promises: Record<string, boolean>;
  calculator: CalculatorState;
  updatedAt: string;
}

const DAILY_PROMISES_LIST: { id: string; label: string }[] = [
  { id: 'wake_up', label: '⏰ Wake up on time' },
  { id: 'start_7am', label: '🚀 Start at 7 AM' },
  { id: 'high_demand', label: '📍 High-demand areas' },
  { id: 'save_battery', label: '🔋 Save battery' },
  { id: 'rush_hours', label: '🍽️ Lunch & dinner rush' },
  { id: 'record_rupee', label: '📝 Record every rupee' },
  { id: 'never_give_up', label: '💪 Never give up' },
];

function getTodayISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysISO(baseISO: string, offsetDays: number): string {
  const parts = baseISO.split('-').map(Number);
  const d = new Date(parts[0], (parts[1] || 1) - 1, (parts[2] || 1) + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDefaultDays(count: number, startDateISO = getTodayISO()): DayEntry[] {
  return Array.from({ length: count }, (_, idx) => ({
    dayNumber: idx + 1,
    date: addDaysISO(startDateISO, idx),
    orders: '',
    km: '',
    swaps: '',
    gross: '',
    rental: '',
    expenses: '',
  }));
}

function createInitialData(): ChallengeData {
  const today = getTodayISO();
  return {
    targetAmount: 10000,
    totalDays: 7,
    activeDayNumber: 1,
    days: createDefaultDays(7, today),
    promisesDate: today,
    promises: {
      wake_up: false,
      start_7am: false,
      high_demand: false,
      save_battery: false,
      rush_hours: false,
      record_rupee: false,
      never_give_up: false,
    },
    calculator: {
      gross: '1850',
      rental: '220',
      expenses: '120',
      orders: '26',
      km: '95',
      swaps: '2',
      daysLeft: '4',
      netSoFar: '4500',
      whatIfOrdersPerDay: 28,
    },
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// 2. INDIAN CURRENCY & NUMBER FORMATTING HELPERS
// ============================================================================

const inrFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 0,
});

const inrDecimalFormatter = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatINR(amount: number, showSign = false): string {
  if (!Number.isFinite(amount)) return '₹0';
  const rounded = Math.round(amount);
  const absFormatted = inrFormatter.format(Math.abs(rounded));
  if (rounded < 0) return `-₹${absFormatted}`;
  if (showSign && rounded > 0) return `+₹${absFormatted}`;
  return `₹${absFormatted}`;
}

export function formatINRDecimal(amount: number): string {
  if (!Number.isFinite(amount)) return '₹0';
  const absFormatted = inrDecimalFormatter.format(Math.abs(amount));
  return amount < 0 ? `-₹${absFormatted}` : `₹${absFormatted}`;
}

export function formatNum(val: number, decimals = 0): string {
  if (!Number.isFinite(val)) return '0';
  return decimals > 0 ? inrDecimalFormatter.format(val) : inrFormatter.format(Math.round(val));
}

export function parseNum(val: string | number | undefined): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computeDayNet(day: DayEntry): number {
  const gross = parseNum(day.gross);
  const rental = parseNum(day.rental);
  const expenses = parseNum(day.expenses);
  return gross - rental - expenses;
}

export function hasDayActivity(day: DayEntry): boolean {
  return (
    day.gross.trim() !== '' ||
    day.rental.trim() !== '' ||
    day.expenses.trim() !== '' ||
    day.orders.trim() !== '' ||
    day.km.trim() !== '' ||
    day.swaps.trim() !== ''
  );
}

// ============================================================================
// 3. ON-PHONE DATABASE (IndexedDB primary + localStorage fallback)
// ============================================================================

const DB_NAME = 'Yulu10KChallengeDB';
const DB_VERSION = 1;
const STORE_NAME = 'challenge_store';
const RECORD_KEY = 'active_challenge_v1';
const LS_FALLBACK_KEY = 'yulu_10k_challenge_backup_v1';

function openChallengeDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open error'));
  });
}

async function saveToPhoneDB(data: ChallengeData): Promise<void> {
  // Always mirror to localStorage immediately for instant synchronous safety
  try {
    window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(data));
  } catch {
    // Ignore quota errors if localStorage is restricted
  }

  try {
    const db = await openChallengeDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data, RECORD_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // localStorage already saved above as fallback
  }
}

async function loadFromPhoneDB(): Promise<ChallengeData | null> {
  try {
    const db = await openChallengeDB();
    const result = await new Promise<ChallengeData | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(RECORD_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as ChallengeData) || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
    if (result) return normalizeLoadedData(result);
  } catch {
    // Fallback to localStorage
  }

  try {
    const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      return normalizeLoadedData(JSON.parse(raw));
    }
  } catch {
    // Ignore parse error
  }
  return null;
}

function normalizeLoadedData(raw: Partial<ChallengeData>): ChallengeData {
  const defaults = createInitialData();
  const today = getTodayISO();
  const totalDays = Math.max(1, Math.min(60, Math.round(Number(raw.totalDays) || 7)));
  const targetAmount = Math.max(100, Math.round(Number(raw.targetAmount) || 10000));

  const existingDays = Array.isArray(raw.days) ? raw.days : [];
  const normalizedDays: DayEntry[] = Array.from({ length: totalDays }, (_, idx) => {
    const found = existingDays[idx];
    return {
      dayNumber: idx + 1,
      date: found?.date || addDaysISO(today, idx),
      orders: found?.orders !== undefined ? String(found.orders) : '',
      km: found?.km !== undefined ? String(found.km) : '',
      swaps: found?.swaps !== undefined ? String(found.swaps) : '',
      gross: found?.gross !== undefined ? String(found.gross) : '',
      rental: found?.rental !== undefined ? String(found.rental) : '',
      expenses: found?.expenses !== undefined ? String(found.expenses) : '',
    };
  });

  // Daily Promise auto-reset when calendar date changes
  const savedPromisesDate = raw.promisesDate || today;
  const shouldResetPromises = savedPromisesDate !== today;
  const promises = shouldResetPromises
    ? defaults.promises
    : { ...defaults.promises, ...(raw.promises || {}) };

  return {
    targetAmount,
    totalDays,
    activeDayNumber: Math.min(
      totalDays,
      Math.max(1, Number(raw.activeDayNumber) || 1)
    ),
    days: normalizedDays,
    promisesDate: today,
    promises,
    calculator: {
      ...defaults.calculator,
      ...(raw.calculator || {}),
    },
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

// ============================================================================
// 4. PWA INSTALL & CONNECTIVITY HOOKS
// ============================================================================

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    triggerInstall,
  };
}

function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

// ============================================================================
// 5. CONFETTI CELEBRATION OVERLAY (Pure HTML5 Canvas, 100% Offline)
// ============================================================================

const ConfettiCanvas: React.FC<{ active: boolean; onComplete?: () => void }> = ({
  active,
  onComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#FFC83D', '#22C55E', '#FFFFFF', '#F59E0B', '#10B981'];
    const particles = Array.from({ length: 110 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * -0.6 - 20,
      w: Math.random() * 9 + 5,
      h: Math.random() * 6 + 4,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 4 + 2.5,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.14,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    let animId = 0;
    const startTime = performance.now();

    const render = (now: number) => {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vRot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (elapsed < 4200) {
        animId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onComplete?.();
      }
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [active, onComplete]);

  if (!active) return null;
  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50"
      aria-hidden="true"
    />
  );
};

// ============================================================================
// 6. MAIN APPLICATION COMPONENT
// ============================================================================

type TabType = 'tracker' | 'calculator' | 'result' | 'settings';

export default function App() {
  const [data, setData] = useState<ChallengeData>(() => createInitialData());
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('tracker');
  const [expandedDays, setExpandedDays] = useState<Record<number, boolean>>({ 1: true });
  const [lastSavedTime, setLastSavedTime] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, triggerInstall } = usePWAInstall();

  // Show temporary notification toast
  const triggerToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 2800);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Initial load from IndexedDB / localStorage
  useEffect(() => {
    let mounted = true;
    loadFromPhoneDB().then((saved) => {
      if (!mounted) return;
      if (saved) {
        setData(saved);
        // Expand the active day card automatically
        setExpandedDays({ [saved.activeDayNumber || 1]: true });
        const dt = new Date(saved.updatedAt);
        setLastSavedTime(
          Number.isNaN(dt.getTime())
            ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      } else {
        const nowStr = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setLastSavedTime(nowStr);
      }
      setIsLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Auto-save on every state update (every keystroke)
  useEffect(() => {
    if (!isLoaded) return;
    saveToPhoneDB(data).then(() => {
      setLastSavedTime(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    });
  }, [data, isLoaded]);

  // ============================================================================
  // 7. LIVE CHALLENGE CALCULATIONS
  // ============================================================================

  const metrics = useMemo(() => {
    const dailyTarget = Math.round(data.targetAmount / Math.max(1, data.totalDays));
    let totalGross = 0;
    let totalRental = 0;
    let totalOtherExpenses = 0;
    let totalNet = 0;
    let totalOrders = 0;
    let totalKm = 0;
    let totalSwaps = 0;
    let daysTargetHit = 0;
    let activeDaysCount = 0;
    let bestDayNet: number | null = null;
    let bestDayNum: number | null = null;

    const daySummaries = data.days.map((d) => {
      const gross = parseNum(d.gross);
      const rental = parseNum(d.rental);
      const expenses = parseNum(d.expenses);
      const orders = parseNum(d.orders);
      const km = parseNum(d.km);
      const swaps = parseNum(d.swaps);
      const net = gross - rental - expenses;
      const active = hasDayActivity(d);
      const hitTarget = active && net >= dailyTarget;

      totalGross += gross;
      totalRental += rental;
      totalOtherExpenses += expenses;
      totalNet += net;
      totalOrders += orders;
      totalKm += km;
      totalSwaps += swaps;

      if (active) {
        activeDaysCount += 1;
        if (hitTarget) daysTargetHit += 1;
        if (bestDayNet === null || net > bestDayNet) {
          bestDayNet = net;
          bestDayNum = d.dayNumber;
        }
      }

      return {
        ...d,
        grossNum: gross,
        rentalNum: rental,
        expensesNum: expenses,
        ordersNum: orders,
        kmNum: km,
        swapsNum: swaps,
        net,
        active,
        hitTarget,
      };
    });

    const totalAllExpenses = totalRental + totalOtherExpenses;
    const progressPercent =
      data.targetAmount > 0
        ? Math.min(100, Math.max(0, (totalNet / data.targetAmount) * 100))
        : 0;
    const rawProgressPercent =
      data.targetAmount > 0 ? (totalNet / data.targetAmount) * 100 : 0;
    const remainingToTarget = Math.max(0, data.targetAmount - totalNet);
    const avgNetPerDay = activeDaysCount > 0 ? totalNet / activeDaysCount : 0;
    const achieved = totalNet >= data.targetAmount;

    return {
      dailyTarget,
      totalGross,
      totalRental,
      totalOtherExpenses,
      totalAllExpenses,
      totalNet,
      totalOrders,
      totalKm,
      totalSwaps,
      daysTargetHit,
      activeDaysCount,
      bestDayNet,
      bestDayNum,
      progressPercent,
      rawProgressPercent,
      remainingToTarget,
      avgNetPerDay,
      achieved,
      daySummaries,
    };
  }, [data]);

  // Trigger confetti automatically when opening Result tab if target achieved
  useEffect(() => {
    if (activeTab === 'result' && metrics.achieved) {
      setShowConfetti(true);
    }
  }, [activeTab, metrics.achieved]);

  // ============================================================================
  // 8. STATE UPDATERS (Immediate Live Keystroke Handlers)
  // ============================================================================

  const updateDayField = (dayNumber: number, field: keyof DayEntry, value: string) => {
    setData((prev) => ({
      ...prev,
      activeDayNumber: dayNumber,
      updatedAt: new Date().toISOString(),
      days: prev.days.map((d) =>
        d.dayNumber === dayNumber ? { ...d, [field]: value } : d
      ),
    }));
  };

  const setTodayHighlight = (dayNumber: number) => {
    setData((prev) => ({
      ...prev,
      activeDayNumber: dayNumber,
      updatedAt: new Date().toISOString(),
    }));
    setExpandedDays((prev) => ({ ...prev, [dayNumber]: true }));
  };

  const toggleDayExpand = (dayNumber: number) => {
    setExpandedDays((prev) => ({ ...prev, [dayNumber]: !prev[dayNumber] }));
  };

  const expandOrCollapseAll = (expand: boolean) => {
    const next: Record<number, boolean> = {};
    data.days.forEach((d) => {
      next[d.dayNumber] = expand;
    });
    setExpandedDays(next);
  };

  const togglePromise = (id: string) => {
    setData((prev) => ({
      ...prev,
      promisesDate: getTodayISO(),
      updatedAt: new Date().toISOString(),
      promises: {
        ...prev.promises,
        [id]: !prev.promises[id],
      },
    }));
  };

  const resetTodayPromises = () => {
    setData((prev) => ({
      ...prev,
      promisesDate: getTodayISO(),
      updatedAt: new Date().toISOString(),
      promises: DAILY_PROMISES_LIST.reduce(
        (acc, item) => ({ ...acc, [item.id]: false }),
        {} as Record<string, boolean>
      ),
    }));
    triggerToast('Daily promises reset for today');
  };

  const updateCalculatorField = (
    field: keyof CalculatorState,
    value: string | number
  ) => {
    setData((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      calculator: {
        ...prev.calculator,
        [field]: value,
      },
    }));
  };

  const syncCalculatorWithTracker = () => {
    const activeCount = Math.max(1, metrics.activeDaysCount);
    const daysRemaining = Math.max(1, data.totalDays - metrics.activeDaysCount);
    const avgGross =
      metrics.activeDaysCount > 0 ? Math.round(metrics.totalGross / activeCount) : 1800;
    const avgRental =
      metrics.activeDaysCount > 0 ? Math.round(metrics.totalRental / activeCount) : 220;
    const avgExp =
      metrics.activeDaysCount > 0
        ? Math.round(metrics.totalOtherExpenses / activeCount)
        : 100;
    const avgOrders =
      metrics.activeDaysCount > 0 ? Math.round(metrics.totalOrders / activeCount) : 25;
    const avgKm =
      metrics.activeDaysCount > 0 ? Math.round(metrics.totalKm / activeCount) : 90;
    const avgSwaps =
      metrics.activeDaysCount > 0 ? Math.round(metrics.totalSwaps / activeCount) : 2;

    setData((prev) => ({
      ...prev,
      updatedAt: new Date().toISOString(),
      calculator: {
        gross: String(avgGross),
        rental: String(avgRental),
        expenses: String(avgExp),
        orders: String(avgOrders),
        km: String(avgKm),
        swaps: String(avgSwaps),
        daysLeft: String(daysRemaining),
        netSoFar: String(Math.round(metrics.totalNet)),
        whatIfOrdersPerDay: Math.max(1, avgOrders),
      },
    }));
    triggerToast('Synced calculator with your live Tracker stats');
  };

  const updateChallengeSettings = (newTarget: number, newDays: number) => {
    const validTarget = Math.max(100, Math.round(newTarget || 0));
    const validDays = Math.max(1, Math.min(60, Math.round(newDays || 1)));

    setData((prev) => {
      const baseStartDate = prev.days[0]?.date || getTodayISO();
      const updatedDays: DayEntry[] = Array.from({ length: validDays }, (_, idx) => {
        const existing = prev.days[idx];
        if (existing) return { ...existing, dayNumber: idx + 1 };
        return {
          dayNumber: idx + 1,
          date: addDaysISO(baseStartDate, idx),
          orders: '',
          km: '',
          swaps: '',
          gross: '',
          rental: '',
          expenses: '',
        };
      });

      return {
        ...prev,
        targetAmount: validTarget,
        totalDays: validDays,
        activeDayNumber: Math.min(prev.activeDayNumber, validDays),
        days: updatedDays,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleConfirmReset = () => {
    const fresh = createInitialData();
    setData(fresh);
    setExpandedDays({ 1: true });
    setShowResetModal(false);
    triggerToast('Challenge reset to Day 1');
  };

  // ============================================================================
  // 9. BACKUP & RESTORE (.JSON) + WHATSAPP SHARE TEXT + IMAGE EXPORT
  // ============================================================================

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `10k-delivery-challenge-backup-${getTodayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerToast('Backup JSON downloaded to your phone');
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(String(event.target?.result || '{}'));
        const restored = normalizeLoadedData(parsed);
        setData(restored);
        setExpandedDays({ [restored.activeDayNumber]: true });
        triggerToast('Challenge data restored from backup!');
      } catch {
        triggerToast('Invalid backup JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Exact formatted share text required by prompt
  const shareText = useMemo(() => {
    const dayBlocks = metrics.daySummaries.map((d) => {
      const dateStr = d.date || '__';
      const ordersStr = d.orders.trim() !== '' ? d.orders : '__';
      const kmStr = d.km.trim() !== '' ? d.km : '__';
      const swapsStr = d.swaps.trim() !== '' ? d.swaps : '__';
      const grossStr = d.gross.trim() !== '' ? inrFormatter.format(d.grossNum) : '__';
      const rentalStr = d.rental.trim() !== '' ? inrFormatter.format(d.rentalNum) : '__';
      const expStr = d.expenses.trim() !== '' ? inrFormatter.format(d.expensesNum) : '__';
      const netStr = d.active ? inrFormatter.format(d.net) : '__';
      const badge = d.hitTarget ? 'YES' : 'NO';

      return [
        `Day ${d.dayNumber}`,
        `📅 Date: ${dateStr}`,
        `📦 Orders: ${ordersStr} | 🛣️ Km: ${kmStr} | 🔋 Swaps: ${swapsStr}`,
        `💵 Gross: ₹${grossStr} | Rental: ₹${rentalStr} | Expenses: ₹${expStr}`,
        `💰 Net: ₹${netStr} | 🎯 ${formatINR(metrics.dailyTarget)}: ${badge}`,
      ].join('\n');
    });

    const finalBlock = [
      `━━━━━━━━━━━━━━━━━━━━`,
      `🏆 FINAL RESULT`,
      `💵 Total Gross: ${formatINR(metrics.totalGross)}`,
      `🧾 Total Expenses: ${formatINR(metrics.totalAllExpenses)} (Rental ${formatINR(metrics.totalRental)} + Exp ${formatINR(metrics.totalOtherExpenses)})`,
      `💰 TOTAL NET: ${formatINR(metrics.totalNet)}`,
      `🎯 Target ${formatINR(data.targetAmount)} | Achieved: ${metrics.achieved ? 'YES ✅' : 'NO ❌'}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `${data.totalDays} DAYS. ONE MISSION. ${formatINR(data.targetAmount)}. 🏆 DREAM BIG. WORK SMART. EARN BIG. 🏆`,
    ].join('\n');

    return `${dayBlocks.join('\n\n')}\n\n${finalBlock}`;
  }, [metrics, data.targetAmount, data.totalDays]);

  const handleCopyShareText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      triggerToast('Copied WhatsApp/Telegram summary to clipboard!');
    } catch {
      triggerToast('Unable to copy automatically — select text below');
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `🏆 ${formatINR(data.targetAmount)} Delivery Challenge`,
          text: shareText,
        });
        return;
      } catch {
        // User cancelled or share failed; fallback to copy
      }
    }
    handleCopyShareText();
  };

  // High-resolution pure black AMOLED summary poster generator (HTML5 Canvas)
  const handleExportSummaryImage = () => {
    const canvas = document.createElement('canvas');
    const width = 1080;
    const rowHeight = 86;
    const height = 760 + metrics.daySummaries.length * rowHeight;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Pure Black AMOLED Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    // Outer Gold Border Frame
    ctx.strokeStyle = '#FFC83D';
    ctx.lineWidth = 3;
    ctx.strokeRect(28, 28, width - 56, height - 56);

    // Subtle Inner Border
    ctx.strokeStyle = '#1F1F1F';
    ctx.lineWidth = 2;
    ctx.strokeRect(44, 44, width - 88, height - 88);

    // 2. Header Title
    ctx.fillStyle = '#FFC83D';
    ctx.font = '900 46px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `🏆 ${formatINR(data.targetAmount)} DELIVERY CHALLENGE`,
      width / 2,
      115
    );

    ctx.fillStyle = '#9CA3AF';
    ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      `Hyderabad  |  Yulu E-Bike  |  ${data.totalDays} Days`,
      width / 2,
      158
    );

    // 3. Big Net Score Card
    const cardX = 72;
    const cardY = 195;
    const cardW = width - 144;
    const cardH = 230;
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeStyle = metrics.achieved ? '#22C55E' : '#FFC83D';
    ctx.lineWidth = 2;
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#9CA3AF';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('TOTAL NET PROFIT', cardX + 36, cardY + 52);

    ctx.fillStyle = metrics.totalNet >= 0 ? '#22C55E' : '#EF4444';
    ctx.font = '800 72px "JetBrains Mono", monospace';
    ctx.fillText(formatINR(metrics.totalNet), cardX + 36, cardY + 135);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(
      `Gross: ${formatINR(metrics.totalGross)}   •   Expenses: ${formatINR(metrics.totalAllExpenses)}   •   Orders: ${metrics.totalOrders}   •   Km: ${formatNum(metrics.totalKm, 1)}`,
      cardX + 36,
      cardY + 190
    );

    // Status Badge on Right of Main Card
    ctx.textAlign = 'right';
    ctx.fillStyle = metrics.achieved ? '#22C55E' : '#FFC83D';
    ctx.font = '800 28px Outfit, sans-serif';
    ctx.fillText(
      metrics.achieved ? '🎯 TARGET ACHIEVED: YES' : `🎯 TARGET: ${formatINR(data.targetAmount)}`,
      cardX + cardW - 36,
      cardY + 56
    );
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillText(
      `${Math.round(metrics.rawProgressPercent)}% Complete (${metrics.daysTargetHit}/${data.totalDays} Days Hit)`,
      cardX + cardW - 36,
      cardY + 100
    );

    // 4. Day-by-Day Table Breakdown
    let y = 475;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFC83D';
    ctx.font = '700 22px Outfit, sans-serif';
    ctx.fillText('DAY-BY-DAY PERFORMANCE', cardX, y);
    y += 24;

    metrics.daySummaries.forEach((d) => {
      ctx.fillStyle = '#0D0D0D';
      ctx.fillRect(cardX, y, cardW, rowHeight - 12);
      ctx.strokeStyle = '#1F1F1F';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cardX, y, cardW, rowHeight - 12);

      const midY = y + (rowHeight - 12) / 2 + 8;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFC83D';
      ctx.font = '800 24px Outfit, sans-serif';
      ctx.fillText(`Day ${d.dayNumber}`, cardX + 24, midY);

      ctx.fillStyle = '#9CA3AF';
      ctx.font = '500 20px "JetBrains Mono", monospace';
      ctx.fillText(d.date || '--', cardX + 125, midY);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '500 20px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(
        `📦 ${d.orders || '0'}  |  🛣️ ${d.km || '0'} km  |  🔋 ${d.swaps || '0'}`,
        cardX + 295,
        midY
      );

      ctx.textAlign = 'right';
      ctx.fillStyle = d.net >= 0 ? '#22C55E' : '#EF4444';
      ctx.font = '800 24px "JetBrains Mono", monospace';
      ctx.fillText(`Net: ${formatINR(d.net)}`, cardX + cardW - 155, midY);

      ctx.fillStyle = d.hitTarget ? '#22C55E' : '#EF4444';
      ctx.font = '800 20px Outfit, sans-serif';
      ctx.fillText(d.hitTarget ? '🎯 YES' : 'NO', cardX + cardW - 24, midY);

      y += rowHeight;
    });

    // 5. Footer Quote
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFC83D';
    ctx.font = '800 24px Outfit, sans-serif';
    ctx.fillText(
      `${data.totalDays} DAYS. ONE MISSION. ${formatINR(data.targetAmount)}.`,
      width / 2,
      height - 110
    );
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 22px Outfit, sans-serif';
    ctx.fillText(
      '🏆 DREAM BIG. WORK SMART. EARN BIG. 🏆',
      width / 2,
      height - 72
    );

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `10k-challenge-summary-${getTodayISO()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast('Summary image saved to your phone!');
  };

  // ============================================================================
  // 10. CALCULATOR LIVE DERIVATIONS
  // ============================================================================

  const calcMetrics = useMemo(() => {
    const gross = parseNum(data.calculator.gross);
    const rental = parseNum(data.calculator.rental);
    const expenses = parseNum(data.calculator.expenses);
    const orders = parseNum(data.calculator.orders);
    const km = parseNum(data.calculator.km);
    const swaps = parseNum(data.calculator.swaps);
    const daysLeft = Math.max(1, parseNum(data.calculator.daysLeft));
    const netSoFar = parseNum(data.calculator.netSoFar);
    const whatIfOrders = data.calculator.whatIfOrdersPerDay || 25;

    const totalFixedCost = rental + expenses;
    const netProfit = gross - totalFixedCost;
    const grossPerOrder = orders > 0 ? gross / orders : 0;
    const netPerOrder = orders > 0 ? netProfit / orders : 0;
    const grossPerKm = km > 0 ? gross / km : 0;
    const netPerKm = km > 0 ? netProfit / km : 0;
    const costPerSwap = swaps > 0 ? totalFixedCost / swaps : 0;
    const expenseOnlyPerSwap = swaps > 0 ? expenses / swaps : 0;
    const profitMargin = gross > 0 ? (netProfit / gross) * 100 : 0;

    // Goal Planner
    const amountStillNeeded = Math.max(0, data.targetAmount - netSoFar);
    const requiredNetPerDay = amountStillNeeded / daysLeft;
    // Required gross/day = requiredNetPerDay + daily fixed costs (rental + expenses)
    const requiredGrossPerDay = requiredNetPerDay + totalFixedCost;
    const ordersNeededPerDay =
      grossPerOrder > 0 ? Math.ceil(requiredGrossPerDay / grossPerOrder) : 0;

    // Break-even: orders needed just to cover rental + expenses
    const breakEvenOrders =
      grossPerOrder > 0 ? Math.ceil(totalFixedCost / grossPerOrder) : 0;

    // What-If Slider: projected daily & total N-day net if doing `whatIfOrders` orders/day
    const projectedDailyGross = whatIfOrders * grossPerOrder;
    const projectedDailyNet = projectedDailyGross - totalFixedCost;
    const projectedTotalNet = projectedDailyNet * data.totalDays;

    return {
      gross,
      rental,
      expenses,
      orders,
      km,
      swaps,
      daysLeft,
      netSoFar,
      whatIfOrders,
      totalFixedCost,
      netProfit,
      grossPerOrder,
      netPerOrder,
      grossPerKm,
      netPerKm,
      costPerSwap,
      expenseOnlyPerSwap,
      profitMargin,
      amountStillNeeded,
      requiredNetPerDay,
      ordersNeededPerDay,
      breakEvenOrders,
      projectedDailyGross,
      projectedDailyNet,
      projectedTotalNet,
    };
  }, [data.calculator, data.targetAmount, data.totalDays]);

  const promisesCompletedCount = useMemo(
    () => DAILY_PROMISES_LIST.filter((p) => data.promises[p.id]).length,
    [data.promises]
  );

  // ============================================================================
  // 11. RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-black text-white pb-24 selection:bg-[#FFC83D] selection:text-black">
      <ConfettiCanvas active={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Top Sticky Compact App Bar */}
      <header className="sticky top-0 z-30 bg-black/95 backdrop-blur-md border-b border-[#1F1F1F]">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-lg font-extrabold tracking-tight text-[#FFC83D] font-display truncate">
              🏆 {formatINR(data.targetAmount)} DELIVERY CHALLENGE
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Offline status badge when disconnected */}
            {!isOnline && (
              <span className="text-xs text-[#FFC83D] flex items-center gap-1 mr-1">
                <WifiOff className="w-3.5 h-3.5" />
                Offline
              </span>
            )}

            {/* Install App CTA if available */}
            {!isInstalled && (isInstallable || isIOS) && (
              <button
                onClick={() => (isInstallable ? triggerInstall() : setShowIOSModal(true))}
                className="min-h-[38px] px-3 rounded-xl bg-[#FFC83D] text-black font-bold text-xs flex items-center gap-1.5 active:scale-95 transition-transform whitespace-nowrap"
              >
                <Smartphone className="w-3.5 h-3.5" />
                Install
              </button>
            )}

            <button
              onClick={() => setActiveTab('settings')}
              aria-label="Open Settings"
              className={`min-h-[42px] min-w-[42px] rounded-xl border flex items-center justify-center transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#111111] border-[#FFC83D] text-[#FFC83D]'
                  : 'bg-[#0A0A0A] border-[#1F1F1F] text-[#9CA3AF] hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-5xl mx-auto px-4 pt-4 space-y-5">
        {/* Hero Subtitle & Saved Status Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F1F1F] pb-3">
          <p className="text-xs sm:text-sm font-medium text-[#9CA3AF]">
            Hyderabad &nbsp;|&nbsp; Yulu E-Bike &nbsp;|&nbsp; {data.totalDays} Days
            &nbsp;·&nbsp; Daily Target:{' '}
            <span className="text-[#FFC83D] font-bold font-mono-num">
              {formatINR(metrics.dailyTarget)}
            </span>
          </p>

          <div className="flex items-center gap-1.5 text-xs text-[#22C55E] font-medium">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>Saved on this phone</span>
            {lastSavedTime && (
              <span className="text-[#9CA3AF] font-mono-num">· {lastSavedTime}</span>
            )}
          </div>
        </div>

        {/* =====================================================================
            SCREEN 1: TRACKER
        ===================================================================== */}
        {activeTab === 'tracker' && (
          <div className="space-y-5">
            {/* Glowing Progress Card */}
            <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-4 sm:p-5 space-y-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <div>
                  <span className="text-xs font-medium text-[#9CA3AF] block">
                    Total Net Profit Earned
                  </span>
                  <div className="flex items-baseline gap-2.5 mt-0.5">
                    <span
                      className={`text-3xl sm:text-4xl font-extrabold font-mono-num tracking-tight ${
                        metrics.totalNet >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                      }`}
                    >
                      {formatINR(metrics.totalNet)}
                    </span>
                    <span className="text-sm text-[#9CA3AF] font-mono-num">
                      / {formatINR(data.targetAmount)}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-2xl font-extrabold text-[#FFC83D] font-mono-num">
                    {Math.round(metrics.rawProgressPercent)}%
                  </span>
                  <span className="block text-xs text-[#9CA3AF] font-mono-num">
                    {metrics.remainingToTarget > 0
                      ? `${formatINR(metrics.remainingToTarget)} remaining`
                      : '🎉 Goal Crushed!'}
                  </span>
                </div>
              </div>

              {/* Glowing Progress Bar */}
              <div className="w-full h-4 bg-black rounded-full border border-[#1F1F1F] p-0.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${metrics.progressPercent}%`,
                    background:
                      metrics.achieved
                        ? 'linear-gradient(90deg, #FFC83D 0%, #22C55E 100%)'
                        : 'linear-gradient(90deg, #F59E0B 0%, #FFC83D 100%)',
                    boxShadow: metrics.achieved
                      ? '0 0 18px rgba(34, 197, 94, 0.85)'
                      : '0 0 16px rgba(255, 200, 61, 0.75)',
                  }}
                />
              </div>

              {/* 6-Item Stats Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3">
                  <span className="text-[11px] text-[#9CA3AF] block">Best Day</span>
                  <span className="text-base font-bold text-[#22C55E] font-mono-num mt-0.5 block">
                    {metrics.bestDayNet !== null ? formatINR(metrics.bestDayNet) : '₹0'}
                  </span>
                  <span className="text-[10px] text-[#9CA3AF]">
                    {metrics.bestDayNum ? `Day ${metrics.bestDayNum}` : 'No entries'}
                  </span>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3">
                  <span className="text-[11px] text-[#9CA3AF] block">Avg Net / Day</span>
                  <span className="text-base font-bold text-white font-mono-num mt-0.5 block">
                    {formatINR(metrics.avgNetPerDay)}
                  </span>
                  <span className="text-[10px] text-[#9CA3AF]">
                    Target {formatINR(metrics.dailyTarget)}
                  </span>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3">
                  <span className="text-[11px] text-[#9CA3AF] block">Total Orders</span>
                  <span className="text-base font-bold text-[#FFC83D] font-mono-num mt-0.5 block">
                    {formatNum(metrics.totalOrders)}
                  </span>
                  <span className="text-[10px] text-[#9CA3AF]">Deliveries</span>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3">
                  <span className="text-[11px] text-[#9CA3AF] block">Total Km</span>
                  <span className="text-base font-bold text-white font-mono-num mt-0.5 block">
                    {formatNum(metrics.totalKm, 1)} km
                  </span>
                  <span className="text-[10px] text-[#9CA3AF]">Yulu distance</span>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3">
                  <span className="text-[11px] text-[#9CA3AF] block">Total Swaps</span>
                  <span className="text-base font-bold text-white font-mono-num mt-0.5 block">
                    {formatNum(metrics.totalSwaps)}
                  </span>
                  <span className="text-[10px] text-[#9CA3AF]">Battery swaps</span>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3">
                  <span className="text-[11px] text-[#9CA3AF] block">Days Target Hit</span>
                  <span className="text-base font-bold text-[#22C55E] font-mono-num mt-0.5 block">
                    {metrics.daysTargetHit}/{data.totalDays}
                  </span>
                  <span className="text-[10px] text-[#9CA3AF]">
                    ≥ {formatINR(metrics.dailyTarget)}/day
                  </span>
                </div>
              </div>
            </section>

            {/* Desktop 2-column responsive layout: Day Cards on Left (or Main), Daily Promise Checklist on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* 7 Collapsible Day Cards */}
              <div className="lg:col-span-8 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-[#FFC83D] font-display">
                      Daily Rider Log ({data.totalDays} Days)
                    </h2>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#9CA3AF]">
                    <button
                      onClick={() => expandOrCollapseAll(true)}
                      className="hover:text-white transition-colors py-1"
                    >
                      Expand all
                    </button>
                    <span>·</span>
                    <button
                      onClick={() => expandOrCollapseAll(false)}
                      className="hover:text-white transition-colors py-1"
                    >
                      Collapse all
                    </button>
                  </div>
                </div>

                {metrics.daySummaries.map((day) => {
                  const isExpanded = !!expandedDays[day.dayNumber];
                  const isToday = data.activeDayNumber === day.dayNumber;

                  return (
                    <div
                      key={day.dayNumber}
                      className={`bg-[#0A0A0A] rounded-[20px] transition-all border ${
                        isToday
                          ? 'border-[#FFC83D] shadow-[0_0_20px_rgba(255,200,61,0.12)]'
                          : 'border-[#1F1F1F]'
                      }`}
                    >
                      {/* Collapsible Day Header */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleDayExpand(day.dayNumber)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleDayExpand(day.dayNumber);
                          }
                        }}
                        className="w-full p-4 flex items-center justify-between gap-3 cursor-pointer select-none min-h-[64px]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold font-display text-sm shrink-0 border ${
                              isToday
                                ? 'bg-[#FFC83D] text-black border-[#FFC83D]'
                                : 'bg-black text-white border-[#1F1F1F]'
                            }`}
                          >
                            D{day.dayNumber}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-base text-white font-display">
                                Day {day.dayNumber}
                              </span>
                              {isToday && (
                                <span className="text-[11px] font-bold text-[#FFC83D] tracking-wide">
                                  · TODAY
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[#9CA3AF] truncate font-mono-num">
                              {day.date || 'No date'} &nbsp;·&nbsp; {day.orders || 0} orders
                              &nbsp;·&nbsp; {day.km || 0} km
                            </div>
                          </div>
                        </div>

                        {/* Live Net & YES/NO Target Badge */}
                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="text-right">
                            <span className="text-[10px] text-[#9CA3AF] block">Net</span>
                            <span
                              className={`text-base font-extrabold font-mono-num ${
                                day.net > 0
                                  ? 'text-[#22C55E]'
                                  : day.net < 0
                                  ? 'text-[#EF4444]'
                                  : 'text-white'
                              }`}
                            >
                              {formatINR(day.net)}
                            </span>
                          </div>

                          <div
                            className={`px-2.5 py-1 rounded-xl text-xs font-extrabold font-mono-num border ${
                              day.hitTarget
                                ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/50 shadow-[0_0_12px_rgba(34,197,94,0.45)]'
                                : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/40'
                            }`}
                          >
                            {day.hitTarget ? '🎯 YES' : 'NO'}
                          </div>

                          <div className="text-[#9CA3AF] pl-1">
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5" />
                            ) : (
                              <ChevronDown className="w-5 h-5" />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Collapsible Day Body Inputs */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-[#1F1F1F] space-y-4">
                          {/* Top Row: Date + Set as Today button */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <label className="flex-1 block">
                              <span className="text-xs text-[#9CA3AF] mb-1 flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5 text-[#FFC83D]" />
                                Date
                              </span>
                              <input
                                type="date"
                                value={day.date}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'date', e.target.value)
                                }
                                className="w-full min-h-[46px] bg-black border border-[#1F1F1F] rounded-xl px-3.5 text-sm text-white font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>

                            {!isToday && (
                              <button
                                type="button"
                                onClick={() => setTodayHighlight(day.dayNumber)}
                                className="min-h-[46px] sm:mt-5 px-3.5 rounded-xl bg-black border border-[#1F1F1F] text-xs font-semibold text-[#FFC83D] hover:border-[#FFC83D] transition-colors whitespace-nowrap"
                              >
                                Highlight as Today
                              </button>
                            )}
                          </div>

                          {/* Row 2: Orders, Km, Battery Swaps */}
                          <div className="grid grid-cols-3 gap-2.5">
                            <label className="block">
                              <span className="text-xs text-[#9CA3AF] mb-1 block truncate">
                                📦 Orders
                              </span>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={day.orders}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'orders', e.target.value)
                                }
                                className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs text-[#9CA3AF] mb-1 block truncate">
                                🛣️ Km
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                placeholder="0"
                                value={day.km}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'km', e.target.value)
                                }
                                className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs text-[#9CA3AF] mb-1 block truncate">
                                🔋 Swaps
                              </span>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="0"
                                value={day.swaps}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'swaps', e.target.value)
                                }
                                className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>
                          </div>

                          {/* Row 3: Gross ₹, Rental ₹, Expenses ₹ */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <label className="block">
                              <span className="text-xs text-[#9CA3AF] mb-1 block">
                                💵 Gross Earned (₹)
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0"
                                value={day.gross}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'gross', e.target.value)
                                }
                                className="w-full min-h-[50px] bg-black border border-[#1F1F1F] rounded-xl px-3.5 text-lg font-extrabold text-[#22C55E] font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs text-[#9CA3AF] mb-1 block">
                                🛵 Yulu Rental (₹)
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0"
                                value={day.rental}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'rental', e.target.value)
                                }
                                className="w-full min-h-[50px] bg-black border border-[#1F1F1F] rounded-xl px-3.5 text-lg font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>

                            <label className="block">
                              <span className="text-xs text-[#9CA3AF] mb-1 block">
                                🧾 Other Expenses (₹)
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0"
                                value={day.expenses}
                                onChange={(e) =>
                                  updateDayField(day.dayNumber, 'expenses', e.target.value)
                                }
                                className="w-full min-h-[50px] bg-black border border-[#1F1F1F] rounded-xl px-3.5 text-lg font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D] focus:ring-1 focus:ring-[#FFC83D]"
                              />
                            </label>
                          </div>

                          {/* Live Day Formula Summary Strip */}
                          <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-[#9CA3AF] font-mono-num">
                              Net = {formatINR(day.grossNum)} − {formatINR(day.rentalNum)} −{' '}
                              {formatINR(day.expensesNum)}
                            </div>

                            <div className="flex items-center gap-3">
                              <span
                                className={`text-base font-extrabold font-mono-num ${
                                  day.net >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                                }`}
                              >
                                Net: {formatINR(day.net)}
                              </span>
                              <span
                                className={`text-xs font-extrabold font-mono-num ${
                                  day.hitTarget ? 'text-[#22C55E]' : 'text-[#EF4444]'
                                }`}
                              >
                                Target {formatINR(metrics.dailyTarget)}:{' '}
                                {day.hitTarget ? '🎯 YES' : 'NO'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Daily Promise Checklist Card (Resets each day) */}
              <div className="lg:col-span-4 space-y-4">
                <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-4 sm:p-5 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold text-[#FFC83D] font-display">
                        Daily Rider Promises
                      </h2>
                      <p className="text-xs text-[#9CA3AF]">
                        Auto-resets every new day ({promisesCompletedCount}/
                        {DAILY_PROMISES_LIST.length} done)
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={resetTodayPromises}
                      className="min-h-[38px] px-2.5 rounded-xl bg-black border border-[#1F1F1F] text-xs text-[#9CA3AF] hover:text-white transition-colors"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="space-y-2">
                    {DAILY_PROMISES_LIST.map((item) => {
                      const checked = !!data.promises[item.id];
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => togglePromise(item.id)}
                          className={`w-full min-h-[48px] px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-3 text-left transition-all ${
                            checked
                              ? 'bg-[#22C55E]/10 border-[#22C55E]/50 text-white'
                              : 'bg-black border-[#1F1F1F] text-[#9CA3AF] hover:text-white'
                          }`}
                        >
                          <span className="text-sm font-medium">{item.label}</span>
                          <span
                            className={`w-6 h-6 rounded-lg flex items-center justify-center border shrink-0 transition-colors ${
                              checked
                                ? 'bg-[#22C55E] border-[#22C55E] text-black'
                                : 'bg-[#0A0A0A] border-[#1F1F1F]'
                            }`}
                          >
                            {checked && <Check className="w-4 h-4 stroke-[3]" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 2: CALCULATOR
        ===================================================================== */}
        {activeTab === 'calculator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Column: Shift Inputs & Live Unit Outputs */}
            <div className="lg:col-span-7 space-y-5">
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-[#FFC83D] font-display">
                      Daily Shift Profit Calculator
                    </h2>
                    <p className="text-xs text-[#9CA3AF]">
                      Type numbers to see live per-order, per-km & margin metrics
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={syncCalculatorWithTracker}
                    className="min-h-[40px] px-3 rounded-xl bg-black border border-[#FFC83D]/50 text-xs font-bold text-[#FFC83D] hover:bg-[#FFC83D] hover:text-black transition-colors"
                  >
                    Load My Tracker Avg
                  </button>
                </div>

                {/* 6 Calculator Inputs */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Gross (₹)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={data.calculator.gross}
                      onChange={(e) => updateCalculatorField('gross', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-[#22C55E] font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Rental (₹)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={data.calculator.rental}
                      onChange={(e) => updateCalculatorField('rental', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Expenses (₹)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={data.calculator.expenses}
                      onChange={(e) => updateCalculatorField('expenses', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Orders</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={data.calculator.orders}
                      onChange={(e) => updateCalculatorField('orders', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-[#FFC83D] font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Km Driven</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={data.calculator.km}
                      onChange={(e) => updateCalculatorField('km', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Battery Swaps</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={data.calculator.swaps}
                      onChange={(e) => updateCalculatorField('swaps', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>
                </div>

                {/* Live Outputs Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5 col-span-2 sm:col-span-1">
                    <span className="text-xs text-[#9CA3AF] block">Net Profit</span>
                    <span
                      className={`text-2xl font-extrabold font-mono-num mt-0.5 block ${
                        calcMetrics.netProfit >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                      }`}
                    >
                      {formatINR(calcMetrics.netProfit)}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF] font-mono-num">
                      {calcMetrics.netProfit >= metrics.dailyTarget
                        ? '🎯 Hits Daily Target'
                        : `Target: ${formatINR(metrics.dailyTarget)}`}
                    </span>
                  </div>

                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5">
                    <span className="text-xs text-[#9CA3AF] block">Earning / Order</span>
                    <span className="text-xl font-bold text-[#FFC83D] font-mono-num mt-0.5 block">
                      {formatINRDecimal(calcMetrics.grossPerOrder)}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF] font-mono-num">
                      Net: {formatINRDecimal(calcMetrics.netPerOrder)}/order
                    </span>
                  </div>

                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5">
                    <span className="text-xs text-[#9CA3AF] block">Earning / Km</span>
                    <span className="text-xl font-bold text-white font-mono-num mt-0.5 block">
                      {formatINRDecimal(calcMetrics.grossPerKm)}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF] font-mono-num">
                      Net: {formatINRDecimal(calcMetrics.netPerKm)}/km
                    </span>
                  </div>

                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5">
                    <span className="text-xs text-[#9CA3AF] block">Cost / Swap</span>
                    <span className="text-xl font-bold text-white font-mono-num mt-0.5 block">
                      {formatINRDecimal(calcMetrics.costPerSwap)}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF] font-mono-num">
                      Exp only: {formatINRDecimal(calcMetrics.expenseOnlyPerSwap)}
                    </span>
                  </div>

                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5">
                    <span className="text-xs text-[#9CA3AF] block">Profit Margin</span>
                    <span
                      className={`text-xl font-bold font-mono-num mt-0.5 block ${
                        calcMetrics.profitMargin >= 50
                          ? 'text-[#22C55E]'
                          : calcMetrics.profitMargin > 0
                          ? 'text-[#FFC83D]'
                          : 'text-[#EF4444]'
                      }`}
                    >
                      {calcMetrics.profitMargin.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-[#9CA3AF]">Net ÷ Gross</span>
                  </div>

                  {/* Break-Even Box */}
                  <div className="bg-black border border-[#FFC83D]/40 rounded-2xl p-3.5">
                    <span className="text-xs text-[#FFC83D] font-semibold block">
                      Break-Even Orders
                    </span>
                    <span className="text-xl font-extrabold text-white font-mono-num mt-0.5 block">
                      {calcMetrics.breakEvenOrders} orders
                    </span>
                    <span className="text-[11px] text-[#9CA3AF] font-mono-num">
                      Covers {formatINR(calcMetrics.totalFixedCost)} cost
                    </span>
                  </div>
                </div>
              </section>
            </div>

            {/* Right Column: Goal Planner + What-If Slider */}
            <div className="lg:col-span-5 space-y-5">
              {/* Goal Planner */}
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-4 sm:p-5 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-[#FFC83D] font-display">
                    Goal Planner (Target {formatINR(data.targetAmount)})
                  </h2>
                  <p className="text-xs text-[#9CA3AF]">
                    Enter days left and net earned so far to calculate required pace
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">Days Left</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={data.calculator.daysLeft}
                      onChange={(e) => updateCalculatorField('daysLeft', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-[#FFC83D] font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">
                      Net Earned So Far (₹)
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={data.calculator.netSoFar}
                      onChange={(e) => updateCalculatorField('netSoFar', e.target.value)}
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3 text-base font-bold text-[#22C55E] font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-4 space-y-2">
                  <p className="text-sm text-white font-medium">
                    You need{' '}
                    <span className="text-lg font-extrabold text-[#FFC83D] font-mono-num">
                      {formatINR(calcMetrics.requiredNetPerDay)}/day
                    </span>{' '}
                    to hit the target
                  </p>
                  <p className="text-xs text-[#9CA3AF]">
                    Orders needed per day:{' '}
                    <span className="text-sm font-bold text-[#22C55E] font-mono-num">
                      {calcMetrics.ordersNeededPerDay} orders/day
                    </span>{' '}
                    (at {formatINRDecimal(calcMetrics.grossPerOrder)} avg/order +{' '}
                    {formatINR(calcMetrics.totalFixedCost)} daily cost)
                  </p>
                </div>
              </section>

              {/* What-If Slider */}
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-[#FFC83D] font-display">
                      What-If Orders Slider
                    </h2>
                    <p className="text-xs text-[#9CA3AF]">
                      Slide orders/day to see projected {data.totalDays}-day net
                    </p>
                  </div>
                  <span className="text-xl font-extrabold text-[#FFC83D] font-mono-num">
                    {calcMetrics.whatIfOrders} orders/day
                  </span>
                </div>

                <input
                  type="range"
                  min={5}
                  max={60}
                  step={1}
                  value={calcMetrics.whatIfOrders}
                  onChange={(e) =>
                    updateCalculatorField('whatIfOrdersPerDay', Number(e.target.value))
                  }
                  className="w-full amoled-slider"
                />

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5">
                    <span className="text-xs text-[#9CA3AF] block">Projected Daily Net</span>
                    <span
                      className={`text-lg font-extrabold font-mono-num mt-0.5 block ${
                        calcMetrics.projectedDailyNet >= 0
                          ? 'text-[#22C55E]'
                          : 'text-[#EF4444]'
                      }`}
                    >
                      {formatINR(calcMetrics.projectedDailyNet)}/day
                    </span>
                  </div>

                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5">
                    <span className="text-xs text-[#9CA3AF] block">
                      Projected {data.totalDays}-Day Net
                    </span>
                    <span
                      className={`text-lg font-extrabold font-mono-num mt-0.5 block ${
                        calcMetrics.projectedTotalNet >= data.targetAmount
                          ? 'text-[#22C55E]'
                          : 'text-[#FFC83D]'
                      }`}
                    >
                      {formatINR(calcMetrics.projectedTotalNet)}
                    </span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 3: RESULT
        ===================================================================== */}
        {activeTab === 'result' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Final Scorecard */}
            <div className="lg:col-span-6 space-y-4">
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs text-[#9CA3AF] uppercase tracking-wider font-semibold">
                      Final Challenge Scorecard
                    </span>
                    <h2 className="text-2xl font-extrabold text-[#FFC83D] font-display mt-0.5">
                      {data.totalDays}-Day Mission Summary
                    </h2>
                  </div>

                  <div
                    className={`px-3.5 py-1.5 rounded-2xl text-sm font-extrabold font-mono-num border ${
                      metrics.achieved
                        ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E] shadow-[0_0_16px_rgba(34,197,94,0.5)]'
                        : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/50'
                    }`}
                  >
                    Achieved: {metrics.achieved ? '🎯 YES' : 'NO'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-4">
                    <span className="text-xs text-[#9CA3AF] block">Total Gross</span>
                    <span className="text-xl font-bold text-white font-mono-num mt-1 block">
                      {formatINR(metrics.totalGross)}
                    </span>
                  </div>

                  <div className="bg-black border border-[#1F1F1F] rounded-2xl p-4">
                    <span className="text-xs text-[#9CA3AF] block">
                      Total Expenses (Rental + Exp)
                    </span>
                    <span className="text-xl font-bold text-[#EF4444] font-mono-num mt-1 block">
                      {formatINR(metrics.totalAllExpenses)}
                    </span>
                  </div>

                  <div className="bg-black border border-[#FFC83D]/50 rounded-2xl p-4 col-span-2 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-[#FFC83D] font-semibold block">
                        TOTAL NET PROFIT
                      </span>
                      <span
                        className={`text-3xl sm:text-4xl font-extrabold font-mono-num mt-1 block ${
                          metrics.totalNet >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                        }`}
                      >
                        {formatINR(metrics.totalNet)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-[#9CA3AF] block">Target</span>
                      <span className="text-xl font-extrabold text-[#FFC83D] font-mono-num">
                        {formatINR(data.targetAmount)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons: Share, Copy, Export Image, Celebrate */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="min-h-[48px] rounded-xl bg-[#FFC83D] text-black font-extrabold text-sm flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
                  >
                    <Share2 className="w-4 h-4" />
                    Share WhatsApp / Telegram
                  </button>

                  <button
                    type="button"
                    onClick={handleExportSummaryImage}
                    className="min-h-[48px] rounded-xl bg-black border border-[#FFC83D] text-[#FFC83D] font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#FFC83D]/10 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4" />
                    Export as Image (.PNG)
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyShareText}
                    className="min-h-[42px] px-3.5 rounded-xl bg-black border border-[#1F1F1F] text-xs font-semibold text-white hover:border-[#FFC83D] flex items-center gap-1.5 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#FFC83D]" />
                    Copy Report Text
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowConfetti(true)}
                    className="min-h-[42px] px-3.5 rounded-xl bg-black border border-[#1F1F1F] text-xs font-semibold text-[#22C55E] hover:border-[#22C55E] flex items-center gap-1.5 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Celebrate Confetti
                  </button>
                </div>

                <p className="text-center text-xs font-bold text-[#FFC83D] pt-2 tracking-wide">
                  7 DAYS. ONE MISSION. ₹10,000. 🏆 DREAM BIG. WORK SMART. EARN BIG. 🏆
                </p>
              </section>
            </div>

            {/* Formatted WhatsApp / Telegram Share Text Preview */}
            <div className="lg:col-span-6">
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#FFC83D] font-display">
                    WhatsApp / Telegram Formatted Text
                  </h3>
                  <button
                    type="button"
                    onClick={handleCopyShareText}
                    className="text-xs font-bold text-[#22C55E] hover:underline flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>

                <pre className="w-full bg-black border border-[#1F1F1F] rounded-2xl p-4 text-xs text-white font-mono-num whitespace-pre-wrap overflow-x-auto max-h-[520px] leading-relaxed">
                  {shareText}
                </pre>
              </section>
            </div>
          </div>
        )}

        {/* =====================================================================
            SCREEN 4: SETTINGS (Target, Days, Backup & Restore, Reset)
        ===================================================================== */}
        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Challenge Configuration */}
            <div className="lg:col-span-6 space-y-5">
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-[#FFC83D] font-display">
                    Challenge Goal Settings
                  </h2>
                  <p className="text-xs text-[#9CA3AF]">
                    Daily target recalculates live as you edit target or days
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">
                      Target Net Profit (₹)
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={data.targetAmount}
                      onChange={(e) =>
                        updateChallengeSettings(
                          parseNum(e.target.value),
                          data.totalDays
                        )
                      }
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3.5 text-base font-bold text-[#FFC83D] font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-[#9CA3AF] mb-1 block">
                      Number of Days
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={60}
                      value={data.totalDays}
                      onChange={(e) =>
                        updateChallengeSettings(
                          data.targetAmount,
                          parseNum(e.target.value)
                        )
                      }
                      className="w-full min-h-[48px] bg-black border border-[#1F1F1F] rounded-xl px-3.5 text-base font-bold text-white font-mono-num focus:outline-none focus:border-[#FFC83D]"
                    />
                  </label>
                </div>

                <div className="bg-black border border-[#1F1F1F] rounded-2xl p-3.5 flex items-center justify-between">
                  <span className="text-xs text-[#9CA3AF]">
                    Auto-Calculated Daily Target:
                  </span>
                  <span className="text-lg font-extrabold text-[#22C55E] font-mono-num">
                    {formatINR(metrics.dailyTarget)} / day
                  </span>
                </div>
              </section>

              {/* Install PWA Card */}
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-3">
                <h2 className="text-base font-bold text-[#FFC83D] font-display">
                  Install App on Phone (Offline PWA)
                </h2>
                <p className="text-xs text-[#9CA3AF]">
                  Add this tracker to your home screen. Runs 100% offline with zero data
                  usage.
                </p>

                {isInstalled ? (
                  <div className="text-xs font-bold text-[#22C55E] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Installed on Home Screen (Standalone Mode)
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2.5 pt-1">
                    {isInstallable && (
                      <button
                        type="button"
                        onClick={triggerInstall}
                        className="min-h-[46px] px-4 rounded-xl bg-[#FFC83D] text-black font-bold text-xs flex items-center gap-2"
                      >
                        <Smartphone className="w-4 h-4" />
                        Add to Home Screen
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowIOSModal(true)}
                      className="min-h-[46px] px-4 rounded-xl bg-black border border-[#1F1F1F] text-white font-semibold text-xs hover:border-[#FFC83D]"
                    >
                      How to Install on Android / iPhone
                    </button>
                  </div>
                )}
              </section>
            </div>

            {/* Backup & Restore + Danger Zone */}
            <div className="lg:col-span-6 space-y-5">
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-[#FFC83D] font-display">
                    Backup & Restore (On-Phone Database)
                  </h2>
                  <p className="text-xs text-[#9CA3AF]">
                    Export your challenge data as a .json file or restore a previous backup
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleExportJSON}
                    className="min-h-[48px] rounded-xl bg-black border border-[#FFC83D] text-[#FFC83D] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#FFC83D]/10 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export Data (.JSON)
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[48px] rounded-xl bg-black border border-[#1F1F1F] text-white font-bold text-xs flex items-center justify-center gap-2 hover:border-white transition-colors"
                  >
                    <Upload className="w-4 h-4 text-[#22C55E]" />
                    Import Data (.JSON)
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportJSON}
                    className="hidden"
                  />
                </div>
              </section>

              {/* Reset Challenge */}
              <section className="bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-3">
                <h2 className="text-base font-bold text-[#EF4444] font-display">
                  Reset Challenge
                </h2>
                <p className="text-xs text-[#9CA3AF]">
                  Clear all daily entries and start a fresh 7-day ₹10,000 challenge.
                </p>
                <button
                  type="button"
                  onClick={() => setShowResetModal(true)}
                  className="min-h-[48px] px-4 rounded-xl bg-black border border-[#EF4444]/60 text-[#EF4444] font-bold text-xs flex items-center gap-2 hover:bg-[#EF4444]/10 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset Challenge Data
                </button>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-4">
            <div className="flex items-center gap-2.5 text-[#EF4444]">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-bold font-display">Reset Entire Challenge?</h3>
            </div>
            <p className="text-xs text-[#9CA3AF] leading-relaxed">
              This will clear all recorded orders, kilometers, swaps, and earnings on this
              phone. Tip: You can Export Data (.json) first to keep a copy.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="min-h-[44px] rounded-xl bg-black border border-[#1F1F1F] text-xs font-bold text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                className="min-h-[44px] rounded-xl bg-[#EF4444] text-black text-xs font-extrabold"
              >
                Yes, Reset All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install Instructions Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0A0A0A] border border-[#1F1F1F] rounded-[20px] p-5 space-y-4">
            <h3 className="text-base font-bold text-[#FFC83D] font-display">
              Install on Your Phone Home Screen
            </h3>
            <div className="space-y-2.5 text-xs text-[#9CA3AF] leading-relaxed">
              <p className="text-white font-semibold">On Android (Chrome):</p>
              <p>
                Tap the <strong>⋮ menu</strong> (top right) and select{' '}
                <strong>Add to Home screen</strong> or <strong>Install app</strong>.
              </p>
              <p className="text-white font-semibold pt-1">On iPhone (Safari):</p>
              <p>
                Tap the <strong>Share</strong> icon at the bottom of Safari, then tap{' '}
                <strong>Add to Home Screen</strong>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#FFC83D] text-black font-extrabold text-xs"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {/* Toast Feedback Banner */}
      {toastMessage && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-[#111111] border border-[#FFC83D] text-white px-4 py-2.5 rounded-2xl text-xs font-semibold shadow-[0_0_20px_rgba(0,0,0,0.9)] flex items-center gap-2 whitespace-nowrap">
          <Check className="w-4 h-4 text-[#22C55E]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Fixed Bottom Tab Bar (Black with Gold Active Icon) */}
      <nav
        aria-label="Primary Bottom Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 bg-black border-t border-[#1F1F1F]"
      >
        <div className="max-w-xl mx-auto grid grid-cols-4 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('tracker')}
            className={`flex flex-col items-center justify-center min-h-[48px] transition-colors ${
              activeTab === 'tracker'
                ? 'text-[#FFC83D]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <Trophy className="w-5 h-5" />
            <span className="text-[11px] font-bold mt-1">Tracker</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calculator')}
            className={`flex flex-col items-center justify-center min-h-[48px] transition-colors ${
              activeTab === 'calculator'
                ? 'text-[#FFC83D]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <Calculator className="w-5 h-5" />
            <span className="text-[11px] font-bold mt-1">Calculator</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('result')}
            className={`flex flex-col items-center justify-center min-h-[48px] transition-colors ${
              activeTab === 'result'
                ? 'text-[#FFC83D]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <Award className="w-5 h-5" />
            <span className="text-[11px] font-bold mt-1">Result</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center justify-center min-h-[48px] transition-colors ${
              activeTab === 'settings'
                ? 'text-[#FFC83D]'
                : 'text-[#9CA3AF] hover:text-white'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span className="text-[11px] font-bold mt-1">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
