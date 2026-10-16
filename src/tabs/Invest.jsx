// 📈 투자 (관리자 / 학생 / 권한학생 ⍟📈 투자(관리자))
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, H4, Caption, Btn, TextInput, Select, NumberInput, Info, Warning, ErrorBox, Expander, DataTable, Loading, ConfirmModal, useSort, SortTh, Popup } from "../components/ui.jsx";

const f2 = (v) => (Number(v) || 0).toFixed(2);

function niceStep(raw) {
  if (raw <= 0) return 1;
  const e = Math.floor(Math.log10(raw));
  const base = 10 ** e;
  const fr = raw / base;
  return (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 5 ? 5 : 10) * base;
}
function nextNice(s) {
  const e = Math.floor(Math.log10(s));
  const base = 10 ** e;
  const fr = s / base;
  return (fr <= 1 ? 2 : fr <= 2 ? 5 : fr <= 5 ? 10 : 20) * base;
}
// _calc_nice_y_axis 그대로
function niceAxis(values, target = 6) {
  const nums = values.map(Number).filter((v) => Number.isFinite(v));
  if (!nums.length) return [0, 100, [0, 20, 40, 60, 80, 100]];
  const vmin = Math.min(...nums);
  const vmax = Math.max(...nums);
  const range = vmax - vmin;
  if (range <= 0) {
    const st = niceStep(Math.max(Math.abs(vmax), 1) / Math.max(target - 1, 1));
    let lo = Math.floor(vmin / st) * st;
    let hi = Math.ceil(vmax / st) * st;
    if (hi <= lo) hi = lo + st;
    return [lo, hi, Array.from({ length: target }, (_, i) => +(lo + st * i).toFixed(10))];
  }
  let st = niceStep(range / Math.max(target - 1, 1));
  let lo = Math.floor(vmin / st) * st;
  let hi = Math.ceil(vmax / st) * st;
  if (hi <= lo) hi = lo + st;
  let cnt = Math.round((hi - lo) / st) + 1;
  while (cnt > 6) {
    st = nextNice(st);
    lo = Math.floor(vmin / st) * st;
    hi = Math.ceil(vmax / st) * st;
    if (hi <= lo) hi = lo + st;
    cnt = Math.round((hi - lo) / st) + 1;
  }
  return [lo, hi, Array.from({ length: cnt }, (_, i) => +(lo + st * i).toFixed(10))];
}

// 긴 글자를 칸 폭에 맞춰 여러 줄로 (잘리지 않게)
function wrapLabel(text, perLine) {
  const out = [];
  for (const word of String(text || "-").split(/\s+/)) {
    let w = word;
    while (w.length > perLine) {
      out.push(w.slice(0, perLine));
      w = w.slice(perLine);
    }
    if (out.length && (out[out.length - 1] + " " + w).length <= perLine) out[out.length - 1] += " " + w;
    else if (w) out.push(w);
  }
  return out.length ? out : ["-"];
}

// ---------- 그래프 저장(PNG) / 인쇄(A4 가로) ----------
// 화면 그래프를 그대로 찍지 않고, 인쇄용 꺾은선 그래프를 새로 그림
// 제목: 주아 / 눈금·항목·값: SUIT (둘 다 사이트 안에 들어 있는 글씨체)
async function ensureFonts() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('100px "Jua"', "주가 그래프 0"), document.fonts.load('600 40px "SUIT"', "가0"), document.fonts.load('800 40px "SUIT"', "가0")]),
      new Promise((res) => setTimeout(res, 2500)),
    ]);
  } catch {
    /* 기본 글씨로 */
  }
}

// 칸 폭에 맞춰 줄바꿈 (최대 3줄, 넘치면 …)
function wrapCanvas(g, text, maxW, maxLines = 3) {
  const lines = [];
  let cur = "";
  const fit = (t) => g.measureText(t).width <= maxW;
  for (let word of String(text || "-").split(/\s+/)) {
    const tryLine = cur ? `${cur} ${word}` : word;
    if (fit(tryLine)) {
      cur = tryLine;
      continue;
    }
    if (cur) lines.push(cur);
    while (!fit(word) && word.length > 1) {
      let k = word.length - 1;
      while (k > 1 && !fit(word.slice(0, k))) k -= 1;
      lines.push(word.slice(0, k));
      word = word.slice(k);
    }
    cur = word;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
}

// 화면·저장 그래프 공통: 파스텔 굵은 선(오르면 빨강 / 내리면 파랑 / 그대로면 검정, 35% 투명)
const UP = "#ef4444";
const DOWN = "#3b82f6";
const FLAT = "#111827";
const LINE_ALPHA = 0.35;
const segColor = (a, b) => (b > a ? UP : b < a ? DOWN : FLAT);
// 세로 눈금: 점들이 테두리에 붙지 않게 위아래 여유를 두고 일정 간격(5~6칸) 숫자
function yScale(vals) {
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const span = vmax - vmin || Math.abs(vmax) || 1;
  const [lo, hi, ticks] = niceAxis([vmin - span * 0.12, vmax + span * 0.12]);
  return { lo, hi: hi > lo ? hi : lo + 1, ticks };
}

// A4 가로 비율(297:210) 그림: 제목 + 왼쪽 눈금 숫자 + 꺾은선(상승 빨강/하락 파랑/보합 검정) + 아래 항목
async function chartImage(points, title) {
  await ensureFonts();
  const CW = 2400;
  const CH = Math.round((CW * 210) / 297);
  const cv = document.createElement("canvas");
  cv.width = CW;
  cv.height = CH;
  const g = cv.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, CW, CH);
  const TF = '"Jua", "SUIT", "Malgun Gothic", sans-serif';
  const BF = '"SUIT", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

  // 제목 + 기준 날짜
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#2d3748";
  g.font = `150px ${TF}`;
  g.fillText(title, CW / 2, 150);
  g.fillStyle = "#8a94a6";
  g.font = `600 44px ${BF}`;
  const d = new Date();
  g.fillText(`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 기준`, CW / 2, 255);

  // 그래프 영역
  const n = points.length;
  const L = 250;
  const R = CW - 120;
  const T = 400;
  const B = CH - 300;
  const vals = points.map((p) => Number(p.y) || 0);
  const { lo, hi, ticks } = yScale(vals);
  const y = (v) => B - ((v - lo) / (hi - lo)) * (B - T);
  const band = (R - L) / Math.max(n, 1);
  const x = (i) => L + band * (i + 0.5);

  // 보조 눈금선(연하게, 숫자 없음) + 주 눈금선(숫자 표시)
  g.lineWidth = 2;
  for (let k = 0; k < ticks.length - 1; k++) {
    const mid = (ticks[k] + ticks[k + 1]) / 2;
    g.strokeStyle = "#f2f4f7";
    g.beginPath();
    g.moveTo(L, y(mid));
    g.lineTo(R, y(mid));
    g.stroke();
  }
  g.textAlign = "right";
  g.font = `600 40px ${BF}`;
  for (const t of ticks) {
    g.strokeStyle = "#e3e7ee";
    g.beginPath();
    g.moveTo(L, y(t));
    g.lineTo(R, y(t));
    g.stroke();
    g.fillStyle = "#5a6578";
    g.fillText(String(+t.toFixed(2)), L - 26, y(t));
  }
  // 축
  g.strokeStyle = "#9aa3b2";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(L, T - 30);
  g.lineTo(L, B);
  g.lineTo(R, B);
  g.stroke();

  // 아래 항목 (눈금 표시 + 줄바꿈 글씨)
  const labFs = Math.max(26, Math.min(40, band * 0.32));
  g.font = `600 ${labFs}px ${BF}`;
  g.fillStyle = "#4b5563";
  g.textAlign = "center";
  points.forEach((p, i) => {
    g.strokeStyle = "#9aa3b2";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(x(i), B);
    g.lineTo(x(i), B + 16);
    g.stroke();
    wrapCanvas(g, p.label, band - 24).forEach((line, k) => g.fillText(line, x(i), B + 52 + k * (labFs + 10)));
  });

  // 꺾은선: 앱과 같은 파스텔 굵은 선
  const col = segColor;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = 28;
  g.globalAlpha = LINE_ALPHA;
  for (let i = 0; i < n - 1; i++) {
    g.strokeStyle = col(vals[i], vals[i + 1]);
    g.beginPath();
    g.moveTo(x(i), y(vals[i]));
    g.lineTo(x(i + 1), y(vals[i + 1]));
    g.stroke();
  }
  g.globalAlpha = 1;
  // 점 + 값
  const valFs = Math.max(28, Math.min(48, band * 0.36));
  points.forEach((p, i) => {
    const v = vals[i];
    const c = i > 0 ? col(vals[i - 1], v) : "#9ca3af";
    g.beginPath();
    g.arc(x(i), y(v), 14, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = c;
    g.stroke();
    const prev = i > 0 ? vals[i - 1] : v;
    const next = i < n - 1 ? vals[i + 1] : v;
    const below = i > 0 && v < prev && v <= next; // 골짜기 점은 값 글씨를 아래에
    g.font = `800 ${valFs}px ${BF}`;
    g.fillStyle = "#374151";
    g.textAlign = "center";
    const ty = below ? y(v) + valFs + 22 : y(v) - valFs + 2;
    // 선 위에 겹쳐도 잘 보이게 흰 테두리
    g.lineWidth = 12;
    g.strokeStyle = "#ffffff";
    g.strokeText(String(+v.toFixed(2)), x(i), ty);
    g.fillText(String(+v.toFixed(2)), x(i), ty);
  });
  return cv;
}

async function saveChart(points, title) {
  const cv = await chartImage(points, title);
  const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function printChart(points, title) {
  const url = (await chartImage(points, title)).toDataURL("image/png");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%}</style></head><body><img src="${url}" onload="setTimeout(function(){window.focus();window.print();},150)"></body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }
  // 새 창이 막히면 숨은 칸에서 인쇄
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(html.replace(' onload="setTimeout(function(){window.focus();window.print();},150)"', ""));
  f.contentDocument.close();
  setTimeout(() => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  }, 400);
}

// 꺾은선 그래프: 굵고 부드러운 선 + 점마다 값 표시. 상승 빨강 / 하락 파랑 / 보합 검정
// title 을 주면 오른쪽 위에 💾 저장 / 🖨️ 인쇄 버튼
function PriceChart({ points, title }) {
  // 저장용 그림과 같은 모양: 왼쪽 일정 간격 눈금 숫자 + 축 + 파스텔 굵은 선 + 점마다 값 + 아래 항목
  const W = 620;
  const plotH = 230;
  const padL = 44;
  const padR = 14;
  const padT = 30;
  const n = points.length;
  const band = (W - padL - padR) / Math.max(n, 1);
  const perLine = Math.max(3, Math.floor((band - 4) / 12.5));
  const labels = points.map((p) => wrapLabel(p.label, perLine).slice(0, 3));
  const maxLines = Math.max(1, ...labels.map((l) => l.length));
  const B = padT + plotH;
  const H = B + 14 + maxLines * 17 + 6;
  const vals = points.map((p) => Number(p.y) || 0);
  const { lo, hi, ticks } = yScale(vals);
  const x = (i) => padL + band * (i + 0.5);
  const y = (v) => B - ((v - lo) / (hi - lo)) * plotH;
  const mids = ticks.slice(0, -1).map((t, k) => (t + ticks[k + 1]) / 2);
  const svgEl = (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} preserveAspectRatio="xMidYMid meet" role="img" aria-label="주가 변동 그래프" fontFamily="SUIT, Malgun Gothic, Apple SD Gothic Neo, sans-serif">
      {mids.map((t, k) => (
        <line key={`m${k}`} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#f2f4f7" strokeWidth="1" />
      ))}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e3e7ee" strokeWidth="1" />
          <text x={padL - 7} y={y(t)} dy="0.35em" fontSize="12.5" fontWeight="600" textAnchor="end" fill="#8a94a6">
            {+t.toFixed(2)}
          </text>
        </g>
      ))}
      <polyline points={`${padL},${padT - 8} ${padL},${B} ${W - padR},${B}`} fill="none" stroke="#c4cbd6" strokeWidth="1.5" />
      {points.slice(0, -1).map((p, i) => (
        <line key={i} x1={x(i)} y1={y(vals[i])} x2={x(i + 1)} y2={y(vals[i + 1])} stroke={segColor(vals[i], vals[i + 1])} strokeOpacity={LINE_ALPHA} strokeWidth="9" strokeLinecap="round" />
      ))}
      {points.map((p, i) => {
        const v = vals[i];
        const prev = i > 0 ? vals[i - 1] : v;
        const next = i < n - 1 ? vals[i + 1] : v;
        const below = i > 0 && v < prev && v <= next; // 골짜기 점은 값 글자를 아래에
        return (
          <g key={i}>
            <line x1={x(i)} x2={x(i)} y1={B} y2={B + 5} stroke="#c4cbd6" strokeWidth="1.5" />
            <circle cx={x(i)} cy={y(v)} r="4.5" fill="#fff" stroke={i > 0 ? segColor(prev, v) : "#9ca3af"} strokeWidth="2">
              <title>{`${p.label}: ${v}`}</title>
            </circle>
            <text x={x(i)} y={below ? y(v) + 21 : y(v) - 11} fontSize="15" fontWeight="800" textAnchor="middle" fill="#374151" stroke="#fff" strokeWidth="4" paintOrder="stroke">
              {+v.toFixed(2)}
            </text>
            {labels[i].map((line, k) => (
              <text key={k} x={x(i)} y={B + 21 + k * 17} fontSize="12" fontWeight="600" textAnchor="middle" fill="#4b5563">
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
  return (
    <div className="chart">
      {title ? <ChartTools points={points} title={title} /> : null}
      {svgEl}
    </div>
  );
}

function ChartTools({ points, title }) {
  const app = useApp();
  const [busy, setBusy] = useState("");
  const run = async (kind) => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === "save") await saveChart(points, title);
      else await printChart(points, title);
    } catch (e) {
      app.toast(`그래프 ${kind === "save" ? "저장" : "인쇄"} 실패: ${e.message || e}`, "⚠️");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="chart-tools">
      <button type="button" className="icon-btn" title="그래프 그림으로 저장" aria-label="그래프 저장" disabled={!!busy} onClick={() => run("save")}>
        {busy === "save" ? "…" : "💾"}
      </button>
      <button type="button" className="icon-btn" title="A4 가로로 인쇄" aria-label="그래프 인쇄" disabled={!!busy} onClick={() => run("print")}>
        {busy === "print" ? "…" : "🖨️"}
      </button>
    </div>
  );
}

const HIST_VAL = { 변동일시: (h) => -h._i, 변동사유: (h) => h.reason, 실제주가: (h) => h.real_price_after, 환산주가: (h) => h.price_after, "주가 등락": (h) => h.price_after - h.price_before };
// 실제주가 → 환산주가(0~100) : 서버와 같은 계산 (미리보기용)
const toNorm = (real, mn, mx) => (mx <= mn ? 0 : Math.max(0, Math.min(100, ((real - mn) / (mx - mn)) * 100)));

// ✏️ 주가 변동 기록 수정 팝업
function HistEditPopup({ h, product, onClose, onSaved }) {
  const app = useApp();
  const [reason, setReason] = useState(h.reason);
  const [real, setReal] = useState(h.real_price_after);
  const [err, setErr] = useState("");
  const save = async () => {
    setErr("");
    if (!String(reason).trim()) return setErr("변동 사유를 입력해 주세요.");
    const r = await api("invest_hist_update", { id: h.id, reason: String(reason).trim(), real_price: real });
    if (!r.ok) return setErr(r.error || "수정 실패");
    app.toast(`주가 기록 수정 완료${r.repriced ? ` (진행 중 투자 ${r.repriced}건 매입주가 정정)` : ""}`, "✏️");
    onSaved();
  };
  return (
    <Popup open title={`✏️ 주가 변동 기록 수정 · ${h.dt_text}`} onClose={onClose}>
      <Cols w={[3, 2]} va="bottom">
        <TextInput label="변동 사유" value={reason} onChange={setReason} />
        <NumberInput label="실제주가" value={real} onChange={setReal} min={-9999999.99} max={9999999.99} step={0.01} decimals={2} />
      </Cols>
      <Caption>{`환산주가: ${f2(h.price_after)} → ${f2(toNorm(Number(real) || 0, product.min_price, product.max_price))} (범위 ${f2(product.min_price)}~${f2(product.max_price)})`}</Caption>
      <Caption>그래프와 다음 기록의 등락이 함께 바뀌고, 마지막 기록이면 현재 주가와 진행 중인 투자 평가에도 반영돼요.</Caption>
      <Btn className="primary" onClick={save}>
        ✅ 저장
      </Btn>
      <ErrorBox>{err}</ErrorBox>
    </Popup>
  );
}

function HistoryBlock({ hist, product, editable, onChanged }) {
  const app = useApp();
  const [editing, setEditing] = useState(null);
  const [delAsk, setDelAsk] = useState(null);
  const [delErr, setDelErr] = useState("");
  const srt = useSort(
    (hist || []).map((h, i) => ({ ...h, _i: i })),
    (h, c) => HIST_VAL[c](h)
  );
  if (!hist || !hist.length) return <Caption>아직 주가 변동 기록이 없습니다.</Caption>;
  const init = hist.length ? hist[hist.length - 1].price_before : product.current_price;
  const points = [{ label: "시작환산주가", y: +Number(init).toFixed(2) }, ...[...hist].reverse().map((h) => ({ label: h.reason || "-", y: +Number(h.price_after).toFixed(2) }))];
  return (
    <div className="inv-hist">
      <div className="inv-hist-table">
      <div className="inv_hist_table_wrap">
        <table className="inv_hist_table">
          <thead>
            <tr>
              {Object.keys(HIST_VAL).map((c) => (
                <SortTh key={c} label={c} s={srt} />
              ))}
              {editable ? <th className="hist-act-h">관리</th> : null}
            </tr>
          </thead>
          <tbody>
            {srt.sorted.map((h, i) => {
              const diff = +(h.price_after - h.price_before).toFixed(2);
              return (
                <tr key={h.id || i}>
                  <td>{h.dt_text}</td>
                  <td>{h.reason}</td>
                  <td>{f2(h.real_price_after)}</td>
                  <td>{f2(h.price_after)}</td>
                  <td>{diff > 0 ? <span style={{ color: "red" }}>▲ +{f2(diff)}</span> : diff < 0 ? <span style={{ color: "blue" }}>▼ {f2(diff)}</span> : "-"}</td>
                  {editable ? (
                    <td className="hist-act">
                      <button type="button" className="icon-btn" title="수정" aria-label="수정" onClick={() => setEditing(h)}>
                        ✏️
                      </button>
                      <button type="button" className="icon-btn del" title="삭제" aria-label="삭제" onClick={() => setDelAsk(h)}>
                        🗑️
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      <PriceChart points={points} title={`${product.name} 주가 그래프`} />
      {editing ? (
        <HistEditPopup
          h={editing}
          product={product}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged && onChanged();
          }}
        />
      ) : null}
      <ConfirmModal
        open={!!delAsk}
        title="🗑️ 주가 변동 기록 삭제"
        message={delAsk ? `${delAsk.dt_text}\n'${delAsk.reason}' 기록을 삭제할까요?` : ""}
        yesText="삭제"
        onYes={async () => {
          const h = delAsk;
          setDelErr("");
          const r = await api("invest_hist_delete", { id: h.id });
          setDelAsk(null);
          if (!r.ok) return setDelErr(r.error || "삭제 실패");
          app.toast(`주가 기록 삭제 완료${r.repriced ? ` (진행 중 투자 ${r.repriced}건 매입주가 정정)` : ""}`, "🗑️");
          onChanged && onChanged();
        }}
        onNo={() => setDelAsk(null)}
      >
        <div className="caption center">그 앞 기록의 주가로 이어 붙여요. 마지막 기록이면 현재 주가도 그 앞 값으로 돌아가요.</div>
      </ConfirmModal>
      {delErr ? <ErrorBox>{delErr}</ErrorBox> : null}
    </div>
  );
}

function PriceUpdate({ p, onSaved }) {
  const app = useApp();
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState(p.real_price);
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  const save = async () => {
    setWarn("");
    setErr("");
    if (!reason.trim()) return setWarn("변동 사유를 입력해 주세요.");
    const r = await api("invest_price_update", { product_id: p.product_id, reason: reason.trim(), real_price: price });
    if (r.ok) {
      app.toast("주가가 반영되었습니다.", "✅");
      setReason("");
      onSaved();
    } else setErr(`저장 실패: ${r.error}`);
  };
  return (
    <>
      <Cols w={[3.2, 2.2, 1.2]} va="bottom">
        <TextInput label="변동 사유" value={reason} onChange={setReason} />
        <NumberInput label="실제주가" value={price} onChange={setPrice} min={-9999999.99} max={9999999.99} step={0.01} decimals={2} />
        <Btn onClick={save}>저장</Btn>
      </Cols>
      {warn ? <Warning>{warn}</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

function ProductAdmin({ all, reload }) {
  const app = useApp();
  const active = all.filter((p) => p.is_active);
  const [sel, setSel] = useState("(신규 추가)");
  const [delAsk, setDelAsk] = useState(false);
  const blank = { name: "", min: 0, max: 100, real: 0, pct: 10 };
  const [f, setF] = useState(blank);
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  const cur = active.find((p) => p.name === sel) || null;
  const onSel = (v) => {
    setSel(v);
    const o = active.find((p) => p.name === v);
    setF(o ? { name: o.name, min: o.min_price, max: o.max_price, real: o.real_price, pct: o.point_profit_pct } : blank);
  };
  const norm = (() => {
    const mn = Number(f.min);
    const mx = Number(f.max);
    if (mx <= mn) return 0;
    return Math.max(0, Math.min(100, ((Number(f.real) - mn) / (mx - mn)) * 100));
  })();
  const save = async () => {
    setWarn("");
    setErr("");
    if (!f.name.trim()) return setWarn("종목명을 입력해 주세요.");
    if (Number(f.max) <= Number(f.min)) return setWarn("최대값은 최하값보다 크게 입력해 주세요.");
    const r = await api("invest_product_save", { product_id: cur ? cur.product_id : "", name: f.name, min_price: f.min, max_price: f.max, real_price: f.real, point_profit_pct: f.pct });
    if (r.ok) {
      if (r.result === "restored") app.toast("삭제된 종목을 복구했습니다.", "♻️");
      else if (r.result === "added") app.toast("종목이 추가되었습니다.", "✅");
      else app.toast("종목이 수정되었습니다.", "✅");
      reload();
    } else setErr(r.error);
  };
  const del = async () => {
    if (!cur) return;
    const r = await api("invest_product_delete", { product_id: cur.product_id });
    if (r.ok) {
      app.toast("삭제(비활성화) 완료", "🗑️");
      onSel("(신규 추가)");
      reload();
    } else setErr(`삭제 실패: ${r.error}`);
  };
  return (
    <>
      <H3>
        🧰 투자 종목 추가/수정/삭제 <span className="h-note">환산주가(자동): {f2(norm)} / 100</span>
      </H3>
      <Cols w={[1.3, 1.5, 0.8, 0.8, 1.05, 0.95, 0.75, 0.75]} va="bottom">
        <Select label="편집 대상" value={sel} options={["(신규 추가)", ...active.map((p) => p.name)]} onChange={onSel} />
        <TextInput label="투자 종목명" value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} />
        <NumberInput label="최하값" stepper={false} value={f.min} onChange={(v) => setF((x) => ({ ...x, min: v }))} min={-9999999.99} max={9999999.99} step={0.01} decimals={2} />
        <NumberInput label="최대값" stepper={false} value={f.max} onChange={(v) => setF((x) => ({ ...x, max: v }))} min={-9999999.99} max={9999999.99} step={0.01} decimals={2} />
        <NumberInput label="실제주가" stepper={false} value={f.real} onChange={(v) => setF((x) => ({ ...x, real: v }))} min={-9999999.99} max={9999999.99} step={0.01} decimals={2} />
        <NumberInput label="주가 1당 손익 %" stepper={false} value={f.pct} onChange={(v) => setF((x) => ({ ...x, pct: v }))} min={0} max={1000} step={0.01} decimals={2} />
        <Btn onClick={save}>✅ 저장</Btn>
        <Btn onClick={() => cur && setDelAsk(true)} disabled={!cur}>
          🗑️ 삭제
        </Btn>
      </Cols>
      <ConfirmModal open={delAsk} title="🗑️ 종목 삭제" message={`'${cur ? cur.name : ""}' 종목을 삭제할까요?`} onYes={() => { setDelAsk(false); del(); }} onNo={() => setDelAsk(false)} />
      {warn ? <Warning>{warn}</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

function BuyForm({ products, onDone }) {
  const app = useApp();
  const [pid, setPid] = useState(products[0] ? products[0].product_id : "");
  const [amt, setAmt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!products.some((p) => p.product_id === pid) && products[0]) setPid(products[0].product_id);
  }, [products, pid]);
  const ask = async () => {
    setWarn("");
    setErr("");
    if (amt <= 0) return setWarn("투자 금액을 입력해 주세요.");
    const r = await api("tx_list", { limit: 1 });
    if (!r.ok || amt > (r.balance || 0)) {
      setConfirm(false);
      return setErr("통장 잔액보다 큰 액수는 투자할 수 없어요");
    }
    setConfirm(true);
  };
  const yes = async () => {
    setConfirm(false);
    const r = await api("invest_buy", { product_id: pid, amount: amt });
    if (r.ok) {
      app.toast("투자 완료! (장부에 반영됨)", "✅");
      setAmt(0);
      app.refresh();
      onDone();
    } else setErr(r.error || "투자 실패");
  };
  return (
    <>
      <Cols w={[2, 1.4, 1]} va="bottom">
        <Select label="투자 종목 선택" value={pid} options={products.map((p) => ({ value: p.product_id, label: `${p.name} (현재 ${f2(p.current_price)})` }))} onChange={setPid} />
        <NumberInput label="투자 금액" min={0} step={10} value={amt} onChange={setAmt} />
        <Btn onClick={ask}>💳 투자하기</Btn>
      </Cols>
      {warn ? <Warning>{warn}</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
      <ConfirmModal
        open={confirm}
        title="💳 투자하기"
        message={`${(products.find((p) => p.product_id === pid) || {}).name || ""}에 ${amt}드림을 투자할까요?`}
        onYes={yes}
        onNo={() => setConfirm(false)}
      >
        <div className="caption center">투자한 돈은 통장에서 바로 빠져나가요. 신중하게 결정하세요!</div>
      </ConfirmModal>
    </>
  );
}

export default function Invest({ adminMode }) {
  const app = useApp();
  const { data, error, reload } = useLoad("invest_load", { admin_mode: !!adminMode }, [adminMode, app.ver]);
  const [payErr, setPayErr] = useState("");
  if (error && !data) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const { products, histories, ledger, admin_like: adminLike, invest_enabled: invEnabled } = data;
  const view = ledger.map((x) => ({
    번호: x.no,
    이름: x.name,
    종목: x.product_name,
    매입일자: x.buy_date_label,
    "매입 주가": f2(x.buy_price),
    "주가 1당 손익%": `${f2(x.pct)}%`,
    "투자 금액": x.invest_amount,
    지급완료: x.redeemed ? "✅" : "",
    매수일자: x.sell_date_label,
    "매수 주가": x.redeemed ? f2(x.sell_price) : "",
    주가차이: x.redeemed ? f2(x.diff) : "",
    "수익/손실금": x.redeemed ? x.profit : "",
    "찾을 금액": x.redeemed ? x.redeem_amount : "",
  }));
  const pending = ledger.filter((x) => !x.redeemed);
  const mine = pending.filter((x) => x.student_id === (app.user && app.user.sid));

  const pay = async (x) => {
    setPayErr("");
    const r = await api("invest_redeem", { doc_id: x.doc_id });
    if (r.ok) {
      app.toast("지급 완료!", "✅");
      app.refresh();
    } else setPayErr(r.error || "지급 실패");
  };

  const PendingRow = ({ x, button }) => (
    <Cols w={[1.2, 2.2, 2.8, 1.2]} va="center">
      <div className="bold">{x.no}</div>
      <div>
        <div>{x.name}</div>
        <Caption>{`${x.product_name}(투자 원금:${x.invest_amount}드림)`}</Caption>
      </div>
      <div>
        <Caption>{`매입 ${f2(x.buy_price)} → 현재 ${f2(x.cur_price)} (차이 ${f2(x.proj_diff)}, 주가 1당 손익 ${f2(x.pct)}%)`}</Caption>
        <Caption>{`수익/손실 ${Math.round(x.proj_profit)} | 찾을 금액 ${Math.round(x.proj_redeem)}`}</Caption>
      </div>
      {button ? <Btn onClick={() => pay(x)}>지급</Btn> : <div style={{ textAlign: "center", opacity: 0.65, paddingTop: 8 }}>지급대기</div>}
    </Cols>
  );

  return (
    <>
      <H3>📈 종목 및 주가 변동</H3>
      {!products.length ? <Info>등록된 투자 종목이 없습니다. 이용을 위해 관리자가 종목을 등록해야 합니다.</Info> : null}
      {products.map((p) => (
        <React.Fragment key={p.product_id}>
          <div className="md">
            • <b>{p.name}</b> [실제주가: <b>{f2(p.real_price)}</b>(범위 <b>{f2(p.min_price)}~{f2(p.max_price)}</b>), 환산주가: <b>{f2(p.current_price)}</b>, 주가 1당 손익 <b>{f2(p.point_profit_pct)}%</b>]
          </div>
          {adminLike ? (
            <Expander title={`${p.name} 주가 변동 반영`}>
              <PriceUpdate key={`${p.product_id}-${p.real_price}`} p={p} onSaved={reload} />
              <HistoryBlock hist={histories[p.product_id]} product={p} editable onChanged={reload} />
            </Expander>
          ) : (
            <Expander title={`${p.name} 주가 변동 내역`}>
              <HistoryBlock hist={histories[p.product_id]} product={p} />
            </Expander>
          )}
        </React.Fragment>
      ))}

      <H3>🧾 투자 상품 관리 장부</H3>
      {view.length ? <DataTable rows={view} csvName="투자장부" /> : <Caption>투자 내역이 없습니다.</Caption>}

      {pending.length ? (
        <>
          <H4>💸 투자 회수(지급)</H4>
          {!adminLike ? (
            <>
              <Info>투자 회수는 관리자 또는 관련 권한을 가진 학생만 할 수 있어요.</Info>
              {!mine.length ? <Caption>지급 대기 중인 투자 회수 내역이 없습니다.</Caption> : mine.slice(0, 100).map((x) => <PendingRow key={x.doc_id} x={x} button={false} />)}
            </>
          ) : (
            pending.slice(0, 100).map((x) => <PendingRow key={x.doc_id} x={x} button />)
          )}
          <ErrorBox>{payErr}</ErrorBox>
        </>
      ) : null}

      {!adminMode ? (
        <>
          <H3>💳 투자하기</H3>
          {!invEnabled ? (
            <Warning>이 계정은 현재 투자 기능이 비활성화되어 있어요.</Warning>
          ) : !products.length ? (
            <Info>투자 종목이 아직 없어요. 관리자에게 종목 추가를 요청해 주세요.</Info>
          ) : (
            <BuyForm products={products} onDone={reload} />
          )}
        </>
      ) : null}

      {adminLike ? <ProductAdmin all={data.all_products || []} reload={reload} /> : null}
    </>
  );
}
