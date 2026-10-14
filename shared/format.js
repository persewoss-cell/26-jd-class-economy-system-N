// 서버/화면 공용: 숫자·날짜 변환과 한국어 날짜 표기 (기존 app.py 표기 그대로)
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DAYS_KO = ["월", "화", "수", "목", "금", "토", "일"];

// 파이썬 int(v or 0)과 같은 의미
export function toInt(v, d = 0) {
  if (v === null || v === undefined || v === "" || v === false) return d;
  if (v === true) return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.trunc(n);
}

// 파이썬 int(v or d) : 0/빈값이면 d
export function ior(v, d) {
  const n = toInt(v, 0);
  return n ? n : d;
}

export function toFloat(v, d = 0) {
  if (v === null || v === undefined || v === "" || v === false) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// 파이썬 float(v or d)
export function forr(v, d) {
  const n = toFloat(v, 0);
  return n ? n : d;
}

export function str(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

// 파이썬 round(): 은행원 반올림(짝수 쪽) — 기존 계산 결과와 같게 맞춤
export function pyRound(x, nd = 0) {
  const m = Math.pow(10, nd);
  const v = x * m;
  const r = Math.round(v);
  if (Math.abs(v % 1) === 0.5) {
    const f = Math.floor(v);
    return (f % 2 === 0 ? f : f + 1) / m;
  }
  return r / m;
}

export function as2(v) {
  const n = toFloat(v, 0);
  return Number(n.toFixed(2));
}

// Date | ISO 문자열 | {$date} → Date(UTC 기준). 시간대 없는 문자열은 UTC로 간주(_to_utc_datetime과 동일)
export function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "object" && v.$date) return toDate(v.$date);
  if (typeof v === "number") return new Date(v);
  let s = String(v).trim();
  if (!s) return null;
  // "2026-03-07 05:00:00.123000" 같은 파이썬 str(datetime) 형태도 처리
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    s = s.replace(" ", "T");
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
    s = s.replace(/(\.\d{3})\d+/, "$1");
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    s += "T00:00:00Z";
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// KST 기준 구성요소
export function kstParts(v) {
  const d = toDate(v);
  if (!d) return null;
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  const jsDow = k.getUTCDay(); // 0=일
  const dowIdx = (jsDow + 6) % 7; // 0=월
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    second: k.getUTCSeconds(),
    dow: DAYS_KO[dowIdx],
    dowIdx,
  };
}

function ampm12(h) {
  const ap = h < 12 ? "오전" : "오후";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return [ap, h12];
}

// "2026년 03월 07일(토) 오후 02시 05분"
export function fmtKrDatetime(v) {
  const p = kstParts(v);
  if (!p) return v ? String(v) : "";
  const [ap, h12] = ampm12(p.hour);
  return `${p.year}년 ${pad2(p.month)}월 ${pad2(p.day)}일(${p.dow}) ${ap} ${pad2(h12)}시 ${pad2(p.minute)}분`;
}

export function fmtKrDatetimeNoYear(v) {
  const s = fmtKrDatetime(v);
  return s.replace(/^\d{4}년\s*/, "");
}

// "3월 7일(토)"
export function fmtMd(v) {
  const p = kstParts(v);
  if (!p) return "";
  return `${p.month}월 ${p.day}일(${p.dow})`;
}

// 경매: "2026년 03월 07일 오후 2시 05분 09초"
export function fmtAuctionDt(v) {
  const p = kstParts(v);
  if (!p) return "";
  const [ap, h12] = ampm12(p.hour);
  return `${p.year}년 ${pad2(p.month)}월 ${pad2(p.day)}일 ${ap} ${h12}시 ${pad2(p.minute)}분 ${pad2(p.second)}초`;
}

// 복권: "03월 07일 오후 02시 05분 09초"
export function fmtLotteryDt(v) {
  const p = kstParts(v);
  if (!p) return "";
  const [ap, h12] = ampm12(p.hour);
  return `${pad2(p.month)}월 ${pad2(p.day)}일 ${ap} ${pad2(h12)}시 ${pad2(p.minute)}분 ${pad2(p.second)}초`;
}

// 투자 주가 변동일시: "3월 7일(토) 오후 02시 05분"
export function fmtInvestDt(v) {
  const p = kstParts(v);
  if (!p) return "-";
  const [ap, h12] = ampm12(p.hour);
  return `${p.month}월 ${p.day}일(${p.dow}) ${ap} ${pad2(h12)}시 ${pad2(p.minute)}분`;
}

// "MM.DD."
export function fmtMmDd(v) {
  const p = kstParts(v);
  if (!p) return "--.--.";
  return `${pad2(p.month)}.${pad2(p.day)}.`;
}

// 오늘(KST) 날짜 문자열 "YYYY-MM-DD"
export function kstTodayIso(now = new Date()) {
  const p = kstParts(now);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function monthKey(now = new Date()) {
  const p = kstParts(now);
  return `${p.year}-${pad2(p.month)}`;
}

export function scoreToGrade(score) {
  const s = toInt(score, 0);
  if (s >= 90) return 1;
  if (s >= 80) return 2;
  if (s >= 70) return 3;
  if (s >= 60) return 4;
  if (s >= 50) return 5;
  if (s >= 40) return 6;
  if (s >= 30) return 7;
  if (s >= 20) return 8;
  if (s >= 10) return 9;
  return 10;
}

export function normStatus(v) {
  const s = str(v).trim().toUpperCase();
  if (s === "O" || s === "○") return "O";
  if (s === "△" || s === "▲" || s === "Δ") return "△";
  return "X";
}

export function numComma(n) {
  return toInt(n, 0).toLocaleString("en-US");
}
