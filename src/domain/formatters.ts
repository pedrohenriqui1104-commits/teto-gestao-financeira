const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function centsToBRL(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  // Evita "-R$ 0,00"
  const normalized = safeCents === 0 ? 0 : safeCents;
  return BRL_FORMATTER.format(normalized / 100);
}

/**
 * Converte texto monetário (ex: "1.234,56", "250.00", "R$ 99,90") em centavos inteiros.
 * Retorna null se inválido ou <= 0 quando requirePositive = true.
 */
export function parseCurrencyInputToCents(raw: string, requirePositive = true): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[R$\s]/g, '').trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  // Formato brasileiro com vírgula decimal: 1.234,56 ou 250,50
  if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // Se tiver múltiplos pontos como separador de milhar (ex: 1.000.000)
    const dotParts = cleaned.split('.');
    if (dotParts.length > 2) {
      normalized = dotParts.join('');
    }
  }

  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  const cents = Math.round(parsed * 100);
  if (requirePositive && cents <= 0) return null;
  return cents;
}

export function centsToInputString(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  return `${reais},${dec}`;
}

export function isValidISODate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function formatDateBR(isoDate: string): string {
  if (!isValidISODate(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

export function formatShortDateBR(isoDate: string): string {
  if (!isValidISODate(isoDate)) return isoDate;
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

export function getTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function addMonthsISO(isoDate: string, monthsToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const targetMonthIndex = m - 1 + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function diffDaysInclusive(startISO: string, endISO: string): number {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  const startUTC = Date.UTC(sy, sm - 1, sd);
  const endUTC = Date.UTC(ey, em - 1, ed);
  if (endUTC < startUTC) return 0;
  return Math.floor((endUTC - startUTC) / 86_400_000) + 1;
}

export function getMonthRange(year: number, month1Based: number): { start: string; end: string } {
  const lastDay = new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
  const mm = String(month1Based).padStart(2, '0');
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function getPeriodRangeForReference(
  referenceISO: string,
  monthOffset = 0,
  cycleClosingDay = 0
): { start: string; end: string; label: string } {
  const [y, m, d] = referenceISO.split('-').map(Number);

  if (cycleClosingDay <= 0 || cycleClosingDay > 28) {
    const dt = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
    const targetY = dt.getUTCFullYear();
    const targetM = dt.getUTCMonth() + 1;
    const range = getMonthRange(targetY, targetM);
    const monthName = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(dt);
    const label = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    return { ...range, label };
  }

  // Ciclo personalizado (ex: fecha dia 10 -> ciclo vai do dia 11 do mês anterior até dia 10 do mês atual)
  let baseMonthOffset = d > cycleClosingDay ? 1 : 0;
  baseMonthOffset += monthOffset;
  const endDt = new Date(Date.UTC(y, m - 1 + baseMonthOffset, cycleClosingDay));
  const endY = endDt.getUTCFullYear();
  const endM = endDt.getUTCMonth() + 1;
  const endISO = `${endY}-${String(endM).padStart(2, '0')}-${String(cycleClosingDay).padStart(2, '0')}`;

  const prevEndDt = new Date(Date.UTC(y, m - 1 + baseMonthOffset - 1, cycleClosingDay));
  const prevEndISO = `${prevEndDt.getUTCFullYear()}-${String(prevEndDt.getUTCMonth() + 1).padStart(2, '0')}-${String(cycleClosingDay).padStart(2, '0')}`;
  const startISO = addDaysISO(prevEndISO, 1);

  return {
    start: startISO,
    end: endISO,
    label: `Ciclo ${formatShortDateBR(startISO)} – ${formatShortDateBR(endISO)}`,
  };
}

/**
 * Calcula o Domingo de Páscoa pelo algoritmo gregoriano de Meeus/Jones/Butcher.
 */
function getEasterDateISO(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getBrazilianNationalHolidayName(isoDate: string): string | null {
  if (!isValidISODate(isoDate)) return null;
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const year = Number(yearStr);
  const mmdd = `${monthStr}-${dayStr}`;

  const fixedHolidays: Record<string, string> = {
    '01-01': 'Confraternização Universal',
    '04-21': 'Tiradentes',
    '05-01': 'Dia do Trabalho',
    '09-07': 'Independência do Brasil',
    '10-12': 'Nossa Senhora Aparecida',
    '11-02': 'Finados',
    '11-15': 'Proclamação da República',
    '11-20': 'Dia da Consciência Negra',
    '12-25': 'Natal',
  };

  if (fixedHolidays[mmdd]) return fixedHolidays[mmdd];

  const easter = getEasterDateISO(year);
  if (isoDate === addDaysISO(easter, -47)) return 'Carnaval';
  if (isoDate === addDaysISO(easter, -2)) return 'Sexta-feira Santa';
  if (isoDate === addDaysISO(easter, 60)) return 'Corpus Christi';

  return null;
}

export function getNonBusinessDayReason(isoDate: string): string | null {
  if (!isValidISODate(isoDate)) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const holiday = getBrazilianNationalHolidayName(isoDate);

  if (dayOfWeek === 0 && holiday) return `Domingo e feriado (${holiday})`;
  if (dayOfWeek === 6 && holiday) return `Sábado e feriado (${holiday})`;
  if (dayOfWeek === 0) return 'Domingo (dia não útil)';
  if (dayOfWeek === 6) return 'Sábado (dia não útil)';
  if (holiday) return `Feriado nacional (${holiday})`;
  return null;
}

export function isNonBusinessDay(isoDate: string): boolean {
  return getNonBusinessDayReason(isoDate) !== null;
}

export function getNextBusinessDayISO(isoDate: string): string {
  if (!isValidISODate(isoDate)) return isoDate;
  let candidate = isoDate;
  for (let i = 0; i < 14; i++) {
    if (!isNonBusinessDay(candidate)) return candidate;
    candidate = addDaysISO(candidate, 1);
  }
  return candidate;
}
