// (학생) 🎯 목표
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, Btn, NumberInput, DateInput, Progress, Info, ErrorBox, Loading } from "../components/ui.jsx";

function kstToday() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

export default function Goal() {
  const app = useApp();
  const { data, error } = useLoad("goal_load", {}, [app.ver]);
  const [amt, setAmt] = useState(1000);
  const [gdate, setGdate] = useState(addDays(kstToday(), 30));
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!data) return;
    setAmt(data.goal_amount > 0 ? data.goal_amount : 1000);
    if (data.goal_date && /^\d{4}-\d{2}-\d{2}/.test(data.goal_date)) setGdate(data.goal_date.slice(0, 10));
  }, [data]);
  if (error) return <ErrorBox>{error || "목표 정보를 불러오지 못했어요."}</ErrorBox>;
  if (!data) return <Loading />;

  const dday = daysBetween(kstToday(), gdate);
  const ddayText = dday >= 0 ? `(D-${String(dday).padStart(2, "0")}일)` : `(D+${String(Math.abs(dday)).padStart(2, "0")}일)`;
  const save = async () => {
    setErr("");
    const r = await api("goal_save", { goal_amount: amt, goal_date: gdate });
    if (r.ok) {
      app.toast("목표 저장 완료!", "🎯");
      app.refresh();
    } else setErr(r.error || "목표 저장 실패");
  };

  // (요청 반영) 진행 중 적금 원금 + 목표일 이전 만기 적금 이자 + 투자 현재평가
  let principalAll = 0;
  let interestBefore = 0;
  for (const s of data.savings) {
    principalAll += s.principal;
    if (s.maturity_kst && s.maturity_kst <= gdate) interestBefore += s.interest;
  }
  const expected = data.balance + principalAll + interestBefore + data.inv_eval_total;
  const ratio = amt > 0 ? Math.max(0, Math.min(1, expected / amt)) : 0;
  let msg = "";
  if (principalAll > 0) {
    msg = `📌 진행 중 적금 원금 +${principalAll} 포함`;
    msg += interestBefore > 0 ? `, 목표일(${gdate}) 이전 만기 적금 이자 +${interestBefore} 포함` : " (목표일 이전 만기 적금은 원금만 반영)";
    if (data.inv_eval_total > 0) msg += `, 투자 현재평가 +${data.inv_eval_total} 포함`;
  }
  return (
    <>
      <div className="h3">
        🎯 나의 목표 자산 <span style={{ fontSize: "0.75em", color: "#777" }}>{ddayText}</span>
      </div>
      <Cols w={2}>
        <NumberInput label="목표 금액" min={1} value={amt} onChange={setAmt} />
        <DateInput label="목표 날짜" value={gdate} onChange={(v) => v && setGdate(v)} />
      </Cols>
      <Btn onClick={save}>목표 저장</Btn>
      <ErrorBox>{err}</ErrorBox>
      <Progress ratio={ratio} />
      <div className="md">
        총 자산 기준 예상 달성률: <b>{(ratio * 100).toFixed(1)}%</b> (예상 {expected} / 목표 {amt})
      </div>
      {msg ? <Info>{msg}</Info> : null}
    </>
  );
}
