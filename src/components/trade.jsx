// 입금/출금 입력 폼(render_admin_trade_ui) + 국고 세입/세출 입력 폼(render_treasury_trade_ui)
import React, { useState } from "react";
import { Cols, TextInput, NumberInput, Select, Checkbox, Radio, Caption } from "./ui.jsx";

const QUICK = [0, 10, 20, 50, 100, 200, 500, 1000];

export const templateDisplay = (t) => `${t.label}[${t.kind === "deposit" ? "입금" : "출금"} ${parseInt(t.amount, 10) || 0}]`;
export const treasuryTemplateDisplay = (t) => `${t.label}[${t.kind === "income" ? "세입" : "세출"} ${parseInt(t.amount, 10) || 0}]`;

// treasuryRef: 관리자 화면에서 팝업으로 고른 "국고 반영" 기본값(저장 후 초기화해도 유지)
export function useTradeForm(treasuryRef) {
  const init = () => ({ tpl: "(직접 입력)", memo: "", treasury: treasuryRef ? treasuryRef.current : true, mode: "금액(+)", pick: "0", dep: 0, wd: 0 });
  const [f, setF] = useState(init);
  return [f, setF, () => setF(init())];
}

function setByNet(net) {
  return net >= 0 ? { dep: net, wd: 0 } : { dep: 0, wd: -net };
}

// 빠른 금액 원형 버튼: 누를 때마다 더해지거나 줄어듦, 0은 초기화
function RoundButtons({ value, onPick }) {
  return (
    <div className="round-btns" role="radiogroup" aria-label="빠른금액">
      {QUICK.map((a) => {
        const on = String(a) === String(value);
        return (
          <div key={a} className={`rb ${on ? "on" : ""}`} onClick={() => onPick(String(a))}>
            {a}
          </div>
        );
      })}
    </div>
  );
}

export function TradeForm({ form, setForm, templates }) {
  const byDisp = {};
  (templates || []).forEach((t) => (byDisp[templateDisplay(t)] = t));
  const labels = ["(직접 입력)", ...(templates || []).map(templateDisplay)];
  const onTpl = (sel) => {
    setForm((f) => {
      const next = { ...f, tpl: sel, pick: "0" };
      if (sel === "(직접 입력)") return next;
      const t = byDisp[sel];
      if (!t) return next;
      next.memo = t.label;
      const amt = parseInt(t.amount, 10) || 0;
      if (t.kind === "deposit") Object.assign(next, setByNet(amt), { mode: "금액(+)" });
      else Object.assign(next, setByNet(-amt), { mode: "금액(-)" });
      return next;
    });
  };
  const onPick = (p) => {
    setForm((f) => {
      const amt = parseInt(p, 10) || 0;
      if (amt === 0) return { ...f, pick: p, dep: 0, wd: 0 };
      const sign = f.mode === "금액(+)" ? 1 : -1;
      return { ...f, pick: p, ...setByNet((f.dep || 0) - (f.wd || 0) + sign * amt) };
    });
  };
  return (
    <>
      <Select label="내역 템플릿" value={form.tpl} options={labels} onChange={onTpl} />
      <TextInput label="내역" value={form.memo} onChange={(v) => setForm((f) => ({ ...f, memo: v }))} />
      <Checkbox label="국고 반영" checked={form.treasury} onChange={(v) => setForm((f) => ({ ...f, treasury: v }))} />
      <Caption>⚡ 빠른 금액(누른 만큼 더해지거나 줄어듬, 0은 초기화)</Caption>
      <Radio label="적용" options={["금액(+)", "금액(-)"]} value={form.mode} onChange={(v) => setForm((f) => ({ ...f, mode: v, pick: "0" }))} />
      <RoundButtons value={form.pick} onPick={onPick} />
      <Cols w={2}>
        <NumberInput label="입금" min={0} value={form.dep} onChange={(v) => setForm((f) => ({ ...f, dep: v }))} />
        <NumberInput label="출금" min={0} value={form.wd} onChange={(v) => setForm((f) => ({ ...f, wd: v }))} />
      </Cols>
    </>
  );
}

export function useTreasuryForm() {
  const init = () => ({ tpl: "(직접 입력)", memo: "", mode: "세입(+)", pick: "0", inc: 0, exp: 0 });
  const [f, setF] = useState(init);
  return [f, setF, () => setF(init())];
}

export function TreasuryForm({ form, setForm, templates }) {
  const byDisp = {};
  (templates || []).forEach((t) => (byDisp[treasuryTemplateDisplay(t)] = t));
  const labels = ["(직접 입력)", ...(templates || []).map(treasuryTemplateDisplay)];
  const onTpl = (sel) => {
    setForm((f) => {
      const next = { ...f, tpl: sel };
      if (sel === "(직접 입력)") return next;
      const t = byDisp[sel];
      if (!t) return next;
      next.memo = t.label;
      const amt = parseInt(t.amount, 10) || 0;
      if (t.kind === "income") Object.assign(next, { inc: amt, exp: 0 });
      else Object.assign(next, { inc: 0, exp: amt });
      return next;
    });
  };
  const onPick = (p) => {
    setForm((f) => {
      const amt = parseInt(p, 10) || 0;
      if (amt === 0) return { ...f, pick: p, inc: 0, exp: 0 };
      const sign = f.mode === "세입(+)" ? 1 : -1;
      const net = (f.inc || 0) - (f.exp || 0) + sign * amt;
      return { ...f, pick: p, ...(net >= 0 ? { inc: net, exp: 0 } : { inc: 0, exp: -net }) };
    });
  };
  return (
    <>
      <Select label="국고 템플릿" value={form.tpl} options={labels} onChange={onTpl} />
      <TextInput label="내역" value={form.memo} onChange={(v) => setForm((f) => ({ ...f, memo: v }))} />
      <Caption>⚡ 빠른 금액(누른 만큼 더해지거나 줄어듬, 0은 초기화)</Caption>
      <Radio label="적용" options={["세입(+)", "세출(-)"]} value={form.mode} onChange={(v) => setForm((f) => ({ ...f, mode: v, pick: "0" }))} />
      <RoundButtons value={form.pick} onPick={onPick} />
      <Cols w={2}>
        <NumberInput label="세입" min={0} value={form.inc} onChange={(v) => setForm((f) => ({ ...f, inc: v }))} />
        <NumberInput label="세출" min={0} value={form.exp} onChange={(v) => setForm((f) => ({ ...f, exp: v }))} />
      </Cols>
    </>
  );
}

// st.dataframe 형태의 통장 거래 내역
export const TX_COLUMNS = ["내역", "입금", "출금", "총액", "날짜-시간", "기록자"];
export function txRowsView(rows) {
  return (rows || []).map((r) => ({ 내역: r.memo, 입금: r.deposit, 출금: r.withdraw, 총액: r.balance_after, "날짜-시간": r.created_at_kr, 기록자: r.recorder || "" }));
}
