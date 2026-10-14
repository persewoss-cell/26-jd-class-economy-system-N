// 📈 투자 (관리자 / 학생 / 권한학생 ⍟📈 투자(관리자))
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, H4, Caption, Btn, TextInput, Select, NumberInput, Info, Warning, ErrorBox, Expander, DataTable, Loading, ConfirmModal } from "../components/ui.jsx";

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

// 꺾은선 그래프: 굵고 부드러운 선 + 점마다 값 표시. 상승 빨강 / 하락 파랑 / 보합 검정
function PriceChart({ points }) {
  const W = 620;
  const padX = 24;
  const padT = 32;
  const plotH = 230;
  const n = points.length;
  const band = (W - padX * 2) / Math.max(n, 1);
  const perLine = Math.max(3, Math.floor(band / 16));
  const labels = points.map((p) => wrapLabel(p.label, perLine));
  const maxLines = Math.max(1, ...labels.map((l) => l.length));
  const H = padT + plotH + 18 + maxLines * 19;
  const [, , ticks] = niceAxis(points.map((p) => p.y));
  const x = (i) => padX + band * (i + 0.5);
  // 가장 높은/낮은 점이 테두리에 붙지 않게 위아래 여유
  const vmin = Math.min(...points.map((p) => p.y));
  const vmax = Math.max(...points.map((p) => p.y));
  const span = vmax - vmin || Math.abs(vmax) || 1;
  const ylo = vmin - span * 0.18;
  const yhi = vmax + span * 0.18;
  const y = (v) => padT + plotH * (1 - (v - ylo) / (yhi - ylo || 1));
  const minor = [];
  for (let k = 0; k < ticks.length - 1; k++) for (let m = 1; m < 4; m++) minor.push(ticks[k] + ((ticks[k + 1] - ticks[k]) * m) / 4);
  const inPlot = (t) => y(t) >= padT - 6 && y(t) <= padT + plotH + 6;
  const colorOf = (a, b) => (b > a ? "#ef4444" : b < a ? "#3b82f6" : "#111827");
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="주가 변동 그래프">
        {minor.filter(inPlot).map((t, k) => (
          <line key={`m${k}`} x1={padX / 2} x2={W - padX / 2} y1={y(t)} y2={y(t)} stroke="#f1f3f6" strokeWidth="1" />
        ))}
        {ticks.filter(inPlot).map((t) => (
          <line key={t} x1={padX / 2} x2={W - padX / 2} y1={y(t)} y2={y(t)} stroke="#e3e7ee" strokeWidth="1" />
        ))}
        {points.slice(0, -1).map((p, i) => {
          const q = points[i + 1];
          return <line key={i} x1={x(i)} y1={y(p.y)} x2={x(i + 1)} y2={y(q.y)} stroke={colorOf(p.y, q.y)} strokeOpacity="0.35" strokeWidth="9" strokeLinecap="round" />;
        })}
        {points.map((p, i) => {
          const prev = i > 0 ? points[i - 1].y : p.y;
          const next = i < n - 1 ? points[i + 1].y : p.y;
          const below = p.y < prev && p.y <= next && i > 0; // 골짜기 점은 값 글자를 아래에
          return (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.y)} r="4.5" fill="#fff" stroke={i > 0 ? colorOf(prev, p.y) : "#9ca3af"} strokeWidth="2">
                <title>{`${p.label}: ${p.y}`}</title>
              </circle>
              <text x={x(i)} y={below ? y(p.y) + 25 : y(p.y) - 13} fontSize="18" fontWeight="800" textAnchor="middle" fill="#374151">
                {p.y}
              </text>
              {labels[i].map((line, k) => (
                <text key={k} x={x(i)} y={padT + plotH + 24 + k * 19} fontSize="15.5" textAnchor="middle" fill="#4b5563">
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HistoryBlock({ hist, product }) {
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
              <th>변동일시</th>
              <th>변동사유</th>
              <th>실제주가</th>
              <th>환산주가</th>
              <th>주가 등락</th>
            </tr>
          </thead>
          <tbody>
            {hist.map((h, i) => {
              const diff = +(h.price_after - h.price_before).toFixed(2);
              return (
                <tr key={i}>
                  <td>{h.dt_text}</td>
                  <td>{h.reason}</td>
                  <td>{f2(h.real_price_after)}</td>
                  <td>{f2(h.price_after)}</td>
                  <td>{diff > 0 ? <span style={{ color: "red" }}>▲ +{f2(diff)}</span> : diff < 0 ? <span style={{ color: "blue" }}>▼ {f2(diff)}</span> : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      <PriceChart points={points} />
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
              <HistoryBlock hist={histories[p.product_id]} product={p} />
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
