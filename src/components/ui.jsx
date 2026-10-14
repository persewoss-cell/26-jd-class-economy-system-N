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
  if (/전체 해제|선택 해제|닫기|다시 검사|지급 안 함|취소|숫자 초기화|접기/.test(t)) return "";
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
export function Select({ label, value, onChange, options, help, hideLabel, disabled }) {
  const opts = (options || []).map((o) => (typeof o === "object" ? o : { value: o, label: String(o) }));
  const idx = Math.max(0, opts.findIndex((o) => String(o.value) === String(value)));
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
function cellText(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function toCsv(columns, rows) {
  const esc = (s) => {
    const t = cellText(s);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}

export function DataTable({ rows, columns, small, height, emptyText = null, csvName = "table" }) {
  const cols = columns || (rows && rows[0] ? Object.keys(rows[0]).filter((k) => !k.startsWith("_")) : []);
  const [sort, setSort] = useState({ col: null, dir: 1 });
  const sorted = useMemo(() => {
    const arr = [...(rows || [])];
    if (sort.col !== null) {
      arr.sort((a, b) => {
        const x = a[sort.col];
        const y = b[sort.col];
        const nx = typeof x === "number";
        const ny = typeof y === "number";
        if (nx && ny) return (x - y) * sort.dir;
        return cellText(x).localeCompare(cellText(y), "ko") * sort.dir;
      });
    }
    return arr;
  }, [rows, sort]);
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
                <th key={c} onClick={() => setSort((s) => ({ col: c, dir: s.col === c ? -s.dir : 1 }))}>
                  {c}
                  {sort.col === c ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                </th>
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
export function TplEditor({ items, itemLabel, blank, fromItem, fields, widths, onSave, onDelete, saveToast = "템플릿 저장 완료!", deleteToast = "삭제 완료!", reload, noun = "템플릿" }) {
  const app = useApp();
  const [mode, setMode] = useState("추가");
  const [idx, setIdx] = useState(0);
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
          <Select label={`삭제할 ${noun} 선택`} value={idx} options={opts} onChange={setIdx} />
          <Btn onClick={() => setConfirm(true)}>🗑️ 삭제</Btn>
        </Cols>
      ) : null}
      {mode === "수정" && items.length ? (
        <Select
          label={`수정할 ${noun} 선택`}
          value={idx}
          options={opts}
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
