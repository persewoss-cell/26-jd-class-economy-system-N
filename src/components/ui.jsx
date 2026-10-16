// 화면 기본 부품 (Streamlit 위젯과 같은 모양/배치로 만든 React 컴포넌트)
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// 서버 데이터 불러오기
// 한 번 불러온 화면은 기억해 두었다가 탭을 다시 열면 바로 보여주고, 뒤에서 최신으로 바꿈
const _cache = new Map();
const _inflight = new Map();
const cacheKey = (action, args) => `${action}|${JSON.stringify(args || {})}`;
function fetchShared(action, args) {
  const k = cacheKey(action, args);
  if (_inflight.has(k)) return _inflight.get(k);
  const p = api(action, args).then((r) => {
    _inflight.delete(k);
    if (r.ok) _cache.set(k, r);
    return r;
  });
  _inflight.set(k, p);
  return p;
}
// 로그인 직후 자주 쓰는 화면을 미리 불러 둠
export function prefetch(list) {
  const queue = list.filter(([a, g]) => !_cache.has(cacheKey(a, g)));
  const worker = async () => {
    while (queue.length) {
      const [a, g] = queue.shift();
      await fetchShared(a, g);
    }
  };
  for (let i = 0; i < 3; i++) worker(); // 동시에 3개씩만
}
export function clearLoadCache() {
  _cache.clear();
}

export function useLoad(action, args = {}, deps = []) {
  const [state, setState] = useState(() => {
    const c = _cache.get(cacheKey(action, args));
    return c ? { data: c, loading: false, error: "" } : { data: null, loading: true, error: "" };
  });
  const argsRef = useRef(args);
  argsRef.current = args;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    const c = _cache.get(cacheKey(action, argsRef.current));
    setState((s) => (c ? { data: c, loading: true, error: "" } : { ...s, loading: true }));
    // 처음 열 때는 미리 불러 둔 요청을 같이 쓰고, 그 뒤(저장 후 새로고침 등)는 항상 새로 요청
    const r =
      my === 1
        ? await fetchShared(action, argsRef.current)
        : await api(action, argsRef.current).then((x) => {
            if (x.ok) _cache.set(cacheKey(action, argsRef.current), x);
            return x;
          });
    if (my !== seq.current) return r;
    if (r.ok) setState({ data: r, loading: false, error: "" });
    // 다시 불러오기가 실패하면(잠깐 끊김 등) 보이던 화면은 그대로 둠
    else setState((s) => (s.data ? { ...s, loading: false } : { data: null, loading: false, error: r.error || "불러오기 실패" }));
    return r;
  }, [action]);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload };
}

// ---------------- 배치 ----------------
export function Cols({ w, children, va, gap, className = "", style }) {
  const weights = Array.isArray(w) ? w : Array(Number(w) || 1).fill(1);
  const tpl = weights.map((x) => `minmax(0, ${x}fr)`).join(" ");
  const kids = React.Children.toArray(children);
  return (
    <div className={`cols ${va ? `va-${va}` : ""} ${gap ? `gap-${gap}` : ""} ${className}`} style={{ gridTemplateColumns: tpl, ...style }}>
      {weights.map((_, i) => (
        <div className="col" key={i}>
          {kids[i] ?? null}
        </div>
      ))}
    </div>
  );
}

export const H2 = ({ children }) => <div className="h2">{children}</div>;
export const H3 = ({ children }) => <div className="h3">{children}</div>;
export const H4 = ({ children }) => <div className="h4">{children}</div>;
export const Subheader = ({ children }) => <div className="subheader">{children}</div>;
export const Caption = ({ children, style }) => <div className="caption" style={style}>{children}</div>;
export const Divider = () => <hr className="divider" />;
export function SectionDivider() {
  return (
    <>
      <div className="section-divider-space" />
      <hr className="section-divider" />
    </>
  );
}
export const Info = ({ children }) => <div className="alert info">{children}</div>;
export const Success = ({ children }) => <div className="alert success">{children}</div>;
export const Warning = ({ children }) => <div className="alert warning">{children}</div>;
export const ErrorBox = ({ children }) => (children ? <div className="alert error">{children}</div> : null);
export const Loading = ({ text = "불러오는 중..." }) => (
  <div className="loading">
    <span className="spin" />
    {text}
  </div>
);

// ---------------- 버튼 ----------------
// 버튼 글자로 색을 정함: 저장·추가·승인 같은 실행은 민트, 삭제·회수·거절은 코랄, 나머지는 기본
const textOf = (c) => (typeof c === "string" || typeof c === "number" ? String(c) : Array.isArray(c) ? c.map(textOf).join("") : c && c.props ? textOf(c.props.children) : "");
function toneOf(children) {
  const t = textOf(children);
  if (/전체 해제|선택 해제|닫기|다시 검사|지급 안 함|취소|숫자 초기화|접기|전체 체크/.test(t)) return "";
  if (/삭제|회수|거절|초기화|해제|마감|중도해지|중도 해지|되돌리기|아니오/.test(t)) return "tone-danger";
  if (/저장|추가|승인|지급|개시|구입|제출|고용|부여|조회|반영|참여|추첨|생성|변경|로그인|예$|^예|투자하기|가입|적용|실행|등록/.test(t)) return "tone-main";
  return "";
}

export function Btn({ children, onClick, full = true, disabled, className = "", style, title }) {
  const [busy, setBusy] = useState(false);
  const handle = async (e) => {
    if (busy || disabled || !onClick) return;
    try {
      const r = onClick(e);
      if (r && typeof r.then === "function") {
        setBusy(true);
        await r;
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" title={title} className={`btn ${full ? "full" : ""} ${busy ? "busy" : ""} ${/\b(act|dl|ghost|primary)\b/.test(className) ? "" : toneOf(children)} ${className}`} style={style} disabled={disabled} onClick={handle}>
      {children}
    </button>
  );
}

function Label({ label, help, hidden }) {
  if (hidden) return null;
  return (
    <label className="lbl">
      {label}
      {help ? (
        <span className="help" title={help}>
          ?
        </span>
      ) : null}
    </label>
  );
}

// ---------------- 입력 ----------------
export function TextInput({ label, value, onChange, type = "text", placeholder, help, hideLabel, disabled, className = "", onEnter, autoComplete, inputMode }) {
  return (
    <div className="field">
      <Label label={label} help={help} hidden={hideLabel} />
      <input
        className={`input ${className}`}
        type={type}
        inputMode={inputMode}
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        autoComplete={autoComplete || (type === "password" ? "new-password" : "off")}
        onChange={(e) => onChange && onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
      />
    </div>
  );
}

// st.number_input (− / + 버튼 포함)
export function NumberInput({ label, value, onChange, min = null, max = null, step = 1, decimals = 0, help, hideLabel, disabled, stepper = true }) {
  const fmt = (v) => (v === "" || v === null || v === undefined ? "" : decimals ? Number(v).toFixed(decimals) : String(v));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);
  const clamp = (n) => {
    if (min !== null && n < min) n = min;
    if (max !== null && n > max) n = max;
    return decimals ? Number(n.toFixed(decimals)) : Math.trunc(n);
  };
  const commit = (t) => {
    const n = Number(String(t).replace(/,/g, ""));
    if (t === "" || !Number.isFinite(n)) {
      setText(fmt(value));
      return;
    }
    const c = clamp(n);
    setText(fmt(c));
    if (c !== value) onChange && onChange(c);
  };
  const bump = (d) => {
    const base = Number.isFinite(Number(value)) ? Number(value) : 0;
    const c = clamp(base + d * step);
    setText(fmt(c));
    onChange && onChange(c);
  };
  return (
    <div className="field">
      <Label label={label} help={help} hidden={hideLabel} />
      <div className={`num ${disabled ? "disabled" : ""}`}>
        <input
          inputMode={decimals ? "decimal" : "numeric"}
          value={text}
          disabled={disabled}
          aria-label={label}
          onFocus={() => (focused.current = true)}
          onBlur={(e) => {
            focused.current = false;
            commit(e.target.value);
          }}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            // 입력하는 즉시 반영(바로 버튼을 눌러도 새 값으로 처리) — 범위 밖 값은 칸을 벗어날 때 맞춰 줌
            const n = Number(String(t).replace(/,/g, ""));
            if (t.trim() !== "" && Number.isFinite(n) && (min === null || n >= min) && (max === null || n <= max)) {
              const c = clamp(n);
              if (c !== value) onChange && onChange(c);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.target.blur();
          }}
        />
        {stepper ? (
          <>
            <button type="button" disabled={disabled} onClick={() => bump(-1)} aria-label="감소">
              −
            </button>
            <button type="button" disabled={disabled} onClick={() => bump(1)} aria-label="증가">
              +
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

// options: ["a","b"] 또는 [{value,label}]
// onMove(index, -1|1)를 주면 목록 각 줄 오른쪽에 작은 ▲▼ (순서 바꾸기)가 생김
// 옵션에 fixed: true 를 주면 그 줄(예: "(직접 입력)")은 움직이지 않고 다른 줄도 그 자리를 넘지 못함
export function Select({ label, value, onChange, options, help, hideLabel, disabled, onMove }) {
  const opts = (options || []).map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  const idx = Math.max(0, opts.findIndex((o) => String(o.value) === String(value)));
  if (onMove) return <MoveSelect label={label} help={help} hideLabel={hideLabel} disabled={disabled} opts={opts} idx={idx} onChange={onChange} onMove={onMove} />;
  return (
    <div className="field">
      <Label label={label} help={help} hidden={hideLabel} />
      <select
        className="select"
        value={opts.length ? String(idx) : ""}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          const o = opts[Number(e.target.value)];
          if (o && onChange) onChange(o.value);
        }}
      >
        {opts.map((o, i) => (
          <option key={i} value={String(i)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MoveSelect({ label, help, hideLabel, disabled, opts, idx, onChange, onMove }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  const move = async (i, d) => {
    if (busy) return;
    setBusy(true);
    try {
      await onMove(i, d);
    } finally {
      setBusy(false);
    }
  };
  const cur = opts[idx];
  return (
    <div className="field">
      <Label label={label} help={help} hidden={hideLabel} />
      <div className="msel" ref={ref}>
        <button type="button" className="select msel-btn" disabled={disabled} aria-label={label} onClick={() => setOpen((o) => !o)}>
          {cur ? cur.label : ""}
        </button>
        {open ? (
          <div className={`msel-list ${busy ? "busy" : ""}`}>
            {opts.map((o, i) => (
              <div key={i} className={`msel-item ${i === idx ? "on" : ""}`}>
                <span
                  className="msel-label"
                  onClick={() => {
                    if (onChange) onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </span>
                {o.fixed ? null : (
                  <span className="msel-moves">
                    <button type="button" title="위로" aria-label="위로" disabled={busy || i === 0 || opts[i - 1].fixed} onClick={() => move(i, -1)}>
                      ▲
                    </button>
                    <button type="button" title="아래로" aria-label="아래로" disabled={busy || i === opts.length - 1 || opts[i + 1].fixed} onClick={() => move(i, 1)}>
                      ▼
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// 목록에서 i번째를 d(-1 위, +1 아래)만큼 옮긴 새 배열
export function moveItem(arr, i, d) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

export function MultiSelect({ label, value, onChange, options, placeholder = "선택하세요" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, []);
  const sel = value || [];
  const rest = (options || []).filter((o) => !sel.includes(o));
  return (
    <div className="field">
      <Label label={label} />
      <div className={`ms ${open ? "open" : ""}`} ref={ref}>
        <div className="ms-box" onClick={() => setOpen((v) => !v)}>
          {sel.length === 0 ? <span className="ms-ph">{placeholder}</span> : null}
          {sel.map((s) => (
            <span className="chip" key={s}>
              {s}
              <b
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(sel.filter((x) => x !== s));
                }}
              >
                ✕
              </b>
            </span>
          ))}
        </div>
        {open ? (
          <div className="ms-list">
            {rest.length === 0 ? <div className="ms-none">선택할 항목이 없습니다.</div> : null}
            {rest.map((o) => (
              <div
                key={o}
                onClick={() => {
                  onChange([...sel, o]);
                }}
              >
                {o}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, help }) {
  return (
    <label className={`check ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange && onChange(e.target.checked)} />
      <span className="box" />
      {label !== undefined && label !== "" ? <span>{label}</span> : null}
      {help ? (
        <span className="help" title={help}>
          ?
        </span>
      ) : null}
    </label>
  );
}

// 가로 라디오(버튼 모양). 선택하면 한 가지 색(--sel)으로 표시
export function Radio({ label, options, value, onChange, hideLabel, disabled }) {
  return (
    <div className="field">
      <Label label={label} hidden={hideLabel} />
      <div className={`radio ${disabled ? "disabled" : ""}`} role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = String(o) === String(value);
          return (
            <div key={o} className={`opt ${on ? "on" : ""}`} onClick={() => !disabled && onChange && onChange(o)}>
              {o}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DateInput({ label, value, onChange }) {
  return (
    <div className="field">
      <Label label={label} />
      <input className="input" type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Expander({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`expander ${open ? "open" : ""}`}>
      <div className="exp-head" onClick={() => setOpen((v) => !v)}>
        <span className="arrow">▶</span>
        <span>{title}</span>
      </div>
      {open ? (
        <div className="exp-body">
          <div className="stack">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

// 가운데 확인 팝업(예/아니오)
// children: 팝업 안에 넣을 추가 내용(관리자 비밀번호 칸, 체크 목록, 오류 문구 등)
// onCancel을 주면 오른쪽 위 ✕(아무것도 하지 않고 닫기)가 생김
export function ConfirmModal({ open, title, message, yesText = "예", noText = "아니오", onYes, onNo, onCancel, children, wide }) {
  // 처리 중에는 '예'를 다시 눌러도 두 번 실행되지 않게
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const yes = async () => {
    if (busy || !onYes) return;
    setBusy(true);
    try {
      await onYes();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title || message}>
      <div className={`modal ${wide ? "confirm-wide" : ""}`}>
        {onCancel ? (
          <button type="button" className="modal-x" disabled={busy} onClick={onCancel} aria-label="취소">
            ✕
          </button>
        ) : null}
        {title ? <div className="modal-title">{title}</div> : null}
        <div className="modal-msg">{message}</div>
        {children ? <div className="modal-body stack">{children}</div> : null}
        <div className="modal-btns">
          <button type="button" className={`btn primary ${toneOf(yesText) === "tone-danger" ? "tone-danger" : ""}`} disabled={busy} onClick={yes}>
            {busy ? "처리 중…" : yesText}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onNo}>
            {noText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="subtabs">
      {tabs.map((t) => (
        <button key={t} type="button" className={`st ${t === active ? "on" : ""}`} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value">{value}</div>
    </div>
  );
}

export function Progress({ ratio }) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  return (
    <div className="progress">
      <div style={{ width: `${r * 100}%` }} />
    </div>
  );
}

// ---------------- 표 (st.dataframe) ----------------
export function cellText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function toCsv(columns, rows) {
  const esc = (s) => {
    const t = cellText(s);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

// ---------------- 표 정렬 (엑셀처럼) ----------------
// 머리글 오른쪽 세모: 검은 ▼(기본 순서) → 파란 ▼(내림차순) → 빨간 ▲(오름차순) → 다시 기본
const NUMLIKE = /^[+-]?[\d,]+(\.\d+)?$/;
// "2026년 10월 14일(수) 오후 3시 5분" / "10월 14일 오전 9시" / "2026-10-14 15:05" 같은 날짜는 시간 순서로
const KR_DT = /^(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일[^오]*(?:(오전|오후)\s*(\d{1,2})시(?:\s*(\d{1,2})분)?(?:\s*(\d{1,2})초)?)?/;
const ISO_DT = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/;
function dateKey(t) {
  let m = KR_DT.exec(t);
  if (m) {
    let h = m[5] ? Number(m[5]) % 12 : 0;
    if (m[4] === "오후") h += 12;
    return Date.UTC(Number(m[1] || 2000), Number(m[2]) - 1, Number(m[3]), h, Number(m[6] || 0), Number(m[7] || 0));
  }
  m = ISO_DT.exec(t);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
  return null;
}
function sortKey(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const t = cellText(v).trim();
  if (t !== "" && NUMLIKE.test(t)) return Number(t.replace(/,/g, ""));
  const d = t ? dateKey(t) : null;
  return d !== null ? d : t;
}
function compareVals(a, b) {
  const x = sortKey(a);
  const y = sortKey(b);
  const ex = x === "" || x === null || x === undefined;
  const ey = y === "" || y === null || y === undefined;
  if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; // 빈 칸은 항상 아래
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).localeCompare(String(y), "ko", { numeric: true });
}

// rows를 정렬해서 돌려줌. getVal(row, col): 정렬에 쓸 값 (기본 row[col])
export function useSort(rows, getVal) {
  const [st, setSt] = useState({ col: null, dir: 0 });
  const getRef = useRef(getVal);
  getRef.current = getVal;
  const sorted = useMemo(() => {
    const arr = [...(rows || [])];
    if (st.col === null) return arr;
    const g = getRef.current || ((r, c) => (r ? r[c] : undefined));
    return arr
      .map((r, i) => [r, i])
      .sort((a, b) => {
        const c = compareVals(g(a[0], st.col), g(b[0], st.col));
        const ea = sortKey(g(a[0], st.col)) === "";
        const eb = sortKey(g(b[0], st.col)) === "";
        if (ea || eb) return c || a[1] - b[1];
        return c * st.dir || a[1] - b[1];
      })
      .map((x) => x[0]);
  }, [rows, st]);
  const toggle = (col) => setSt((p) => (p.col !== col ? { col, dir: -1 } : p.dir === -1 ? { col, dir: 1 } : { col: null, dir: 0 }));
  const btn = (col) => <SortBtn active={st.col === col ? st.dir : 0} onClick={() => toggle(col)} />;
  return { sorted, btn, sort: st };
}

export function SortBtn({ active, onClick }) {
  const cls = active === -1 ? "desc" : active === 1 ? "asc" : "";
  const tip = active === -1 ? "내림차순 (누르면 오름차순)" : active === 1 ? "오름차순 (누르면 원래 순서)" : "누르면 내림차순";
  return (
    <button
      type="button"
      className={`sort-btn ${cls}`}
      title={tip}
      aria-label={tip}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {active === 1 ? "▲" : "▼"}
    </button>
  );
}

// 머리글 칸: 글자 + 정렬 세모
export function SortTh({ label, col, s, className, style }) {
  return (
    <th className={className} style={style}>
      <span className="th-in">
        <span>{label}</span>
        {s.btn(col ?? label)}
      </span>
    </th>
  );
}

export function DataTable({ rows, columns, small, height, emptyText = null, csvName = "table" }) {
  const cols = columns || (rows && rows[0] ? Object.keys(rows[0]).filter((k) => !k.startsWith("_")) : []);
  const srt = useSort(rows);
  const sorted = srt.sorted;
  if ((!rows || rows.length === 0) && emptyText !== null) return <div className="tbl-empty">{emptyText}</div>;
  const download = () => {
    const blob = new Blob(["﻿" + toCsv(cols, sorted)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="tbl-wrap" style={{ marginTop: "2.1rem" }}>
      <div className="tbl-tools">
        <button type="button" onClick={download} title="CSV로 내려받기">
          ⬇ CSV
        </button>
      </div>
      <div className="tbl-scroll" style={height ? { maxHeight: height } : undefined}>
        <table className={`tbl ${small ? "small" : ""}`}>
          <thead>
            <tr>
              {cols.map((c) => (
                <SortTh key={c} label={c} col={c} s={srt} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={cols.length || 1} className="tbl-empty">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              sorted.map((r, i) => (
                <tr key={i}>
                  {cols.map((c, j) => (
                    <td key={c} className={`${typeof r[c] === "number" ? "num-cell" : ""} ${j < 2 ? `c${j}` : ""}`}>
                      {cellText(r[c])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- 파일 업로드 / 다운로드 ----------------
function FileUpload({ label, file, onFile, help, accept = ".xlsx", hideLabel }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  // 저장 뒤 파일이 비워지면 선택칸도 비움(같은 파일을 다시 골라도 인식되게)
  useEffect(() => {
    if (!file && ref.current) ref.current.value = "";
  }, [file]);
  // 파일을 끌어다 놓아도 올라감 (드래그 앤 드롭)
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  };
  return (
    <div className="field">
      <Label label={label} help={help} hidden={hideLabel} />
      <div
        className={`uploader ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <button type="button" className="btn" onClick={() => ref.current && ref.current.click()}>
          파일 선택
        </button>
        <span className="fname">{file ? `${file.name} (${Math.round(file.size / 1024)}KB)` : over ? "여기에 놓으세요 📥" : "파일을 끌어다 놓거나 선택하세요 · xlsx"}</span>
        {file ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (ref.current) ref.current.value = "";
              onFile(null);
            }}
          >
            ✕
          </button>
        ) : null}
        <input
          ref={ref}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            onFile(f || null);
          }}
        />
      </div>
    </div>
  );
}

export function Toasts({ items }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div className="toast" key={t.id}>
          <span>{t.icon}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// 엑셀 일괄 추가 한 덩어리: [파일 선택 칸][샘플][현재] / [덮어쓰기 체크][저장]
// downloads: [[버튼 글자, 클릭], ...]
export function ExcelBar({ downloads = [], file, onFile, overwrite, setOverwrite, overwriteLabel, onSave, saveText = "✅ 엑셀 내용 저장(반영)", children }) {
  return (
    <div className="excel-bar">
      <div className="xb-row">
        <div className="xb-file">
          <FileUpload label="엑셀 업로드" hideLabel file={file} onFile={onFile} />
        </div>
        {downloads.map(([text, fn]) => (
          <Btn key={text} full={false} className="dl" onClick={fn}>
            {text}
          </Btn>
        ))}
        {!setOverwrite ? (
          <Btn full={false} onClick={onSave}>
            {saveText}
          </Btn>
        ) : null}
      </div>
      {children}
      {setOverwrite ? (
        <div className="xb-row">
          <Checkbox label={overwriteLabel} checked={overwrite} onChange={setOverwrite} />
          <Btn full={false} onClick={onSave}>
            {saveText}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}

// 템플릿 편집 공용: [추가 | 수정 | 삭제]
//  - 추가/수정: (수정이면 대상 선택) + 입력칸들과 [저장]이 한 줄
//  - 삭제: 대상 선택 + [삭제] → 확인 팝업
// fields(f, set) → 입력칸 배열, widths → 입력칸 폭 비율(저장 버튼 칸은 자동으로 붙음)
// onReorder(ids): 드롭다운의 ▲▼로 순서를 바꾸면 바뀐 id 순서로 저장
export function TplEditor({ items, itemLabel, blank, fromItem, fields, widths, onSave, onDelete, saveToast = "템플릿 저장 완료!", deleteToast = "삭제 완료!", reload, noun = "템플릿", idOf, onReorder }) {
  const app = useApp();
  const [mode, setMode] = useState("추가");
  // 고른 항목은 id로 기억 (다른 드롭다운에서 순서를 바꿔도 같은 항목 유지)
  const keyOf = idOf || ((t) => String(t.template_id ?? t._id ?? ""));
  const [selId, setSelId] = useState(null);
  const idx = Math.max(0, items.findIndex((t) => keyOf(t) === selId));
  const setIdx = (i) => setSelId(items[i] ? keyOf(items[i]) : null);
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const cur = items[idx] || null;
  const opts = items.map((t, i) => ({ value: i, label: itemLabel(t) }));
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const onMode = (m) => {
    setMode(m);
    setErr("");
    setIdx(0);
    setF(m === "수정" && items[0] ? fromItem(items[0]) : blank());
  };
  const save = async () => {
    setErr("");
    const r = await onSave(f, mode === "수정" ? cur : null);
    if (r.ok) {
      app.toast(saveToast, "✅");
      if (mode === "추가") setF(blank());
      reload();
    } else setErr(r.error || "저장 실패");
  };
  // 순서 바꾸기: 고른 항목은 같이 따라가고, 수정 칸의 '순서' 숫자도 새 순서로
  const onMove = onReorder
    ? async (i, d) => {
        const ids = moveItem(items, i, d).map(keyOf);
        const keep = cur ? keyOf(cur) : null;
        const r = await onReorder(ids);
        if (!r.ok) return setErr(r.error || "순서 변경 실패");
        setErr("");
        await reload();
        setSelId(keep);
      }
    : undefined;
  // 순서가 바뀌면(어느 드롭다운에서든) 수정 칸의 '순서' 숫자도 지금 순서로
  const curKey = cur ? keyOf(cur) : "";
  const curOrder = cur ? cur.order : null;
  useEffect(() => {
    if (mode === "수정" && curOrder) setF((x) => ("order" in x && x.order !== curOrder ? { ...x, order: curOrder } : x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey, curOrder]);
  const del = async () => {
    setConfirm(false);
    if (!cur) return;
    const r = await onDelete(cur);
    if (r.ok) {
      app.toast(deleteToast, "🗑️");
      setIdx(0);
      reload();
    } else setErr(r.error || "삭제 실패");
  };
  return (
    <>
      <Radio label="작업" hideLabel options={["추가", "수정", "삭제"]} value={mode} onChange={onMode} />
      {mode !== "추가" && !items.length ? <Info>{mode === "수정" ? "수정할" : "삭제할"} {noun}이 없어요.</Info> : null}
      {mode === "삭제" && items.length ? (
        <Cols w={[3, 1]} va="bottom">
          <Select label={`삭제할 ${noun} 선택`} value={idx} options={opts} onChange={setIdx} onMove={onMove} />
          <Btn onClick={() => setConfirm(true)}>🗑️ 삭제</Btn>
        </Cols>
      ) : null}
      {mode === "수정" && items.length ? (
        <Select
          label={`수정할 ${noun} 선택`}
          value={idx}
          options={opts}
          onMove={onMove}
          onChange={(i) => {
            setIdx(i);
            setF(fromItem(items[i]));
          }}
        />
      ) : null}
      {mode === "추가" || (mode === "수정" && items.length) ? (
        <Cols w={[...widths, 1.1]} va="bottom">
          {fields(f, set)}
          <Btn onClick={save}>✅ 저장</Btn>
        </Cols>
      ) : null}
      <ErrorBox>{err}</ErrorBox>
      <ConfirmModal open={confirm} title={`🗑️ ${noun} 삭제`} message={`'${cur ? itemLabel(cur) : ""}' ${noun}을 삭제할까요?`} onYes={del} onNo={() => setConfirm(false)} />
    </>
  );
}

// 오른쪽 위 ✕ 로 닫는 넓은 팝업
export function Popup({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal wide">
        <button type="button" className="modal-x" onClick={onClose} aria-label="닫기">
          ✕
        </button>
        <div className="modal-head">{title}</div>
        <div className="stack">{children}</div>
      </div>
    </div>
  );
}
