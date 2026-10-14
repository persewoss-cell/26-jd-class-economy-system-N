// 입금/출금 입력 폼(render_admin_trade_ui) + 국고 세입/세출 입력 폼(render_treasury_trade_ui)
import React, { useState } from "react";
import { Cols, Btn, TextInput, NumberInput, Select, Checkbox } from "./ui.jsx";

const QUICK = [0, 10, 20, 50, 100, 200, 500, 1000];

export const templateDisplay = (t) => `${t.label}[${t.kind === "deposit" ? "입금" : "출금"} ${parseInt(t.amount, 10) || 0}]`;
export const treasuryTemplateDisplay = (t) => `${t.label}[${t.kind === "income" ? "세입" : "세출"} ${parseInt(t.amount, 10) || 0}]`;

// 금액칸 하나 + 맨 아래 [입금] [출금] 버튼. 버튼을 누르는 순간 방향이 정해져서 (+)/(-) 전환을 깜빡할 일이 없음.
// treasuryRef: 관리자 화면에서 팝업으로 고른 "국고 반영" 기본값(저장 후 초기화해도 유지)
export function useTradeForm(treasuryRef) {
  const init = () => ({ tpl: "(직접 입력)", memo: "", treasury: treasuryRef ? treasuryRef.current : true, amount: 0, hint: "" });
  const [f, setF] = useState(init);
  return [f, setF, () => setF(init())];
}
export const useTreasuryForm = () => useTradeForm();

// 빠른 금액 원형 버튼: 누를 때마다 더해짐, 0은 초기화
function RoundButtons({ onPick }) {
  return (
    <div className="round-btns" role="group" aria-label="빠른 금액">
      {QUICK.map((a) => (
        <div key={a} className="rb" onClick={() => onPick(a)}>
          {a}
        </div>
      ))}
    </div>
  );
}

// 금액 입력 + 방향 버튼 공용 폼
// actions: [[방향("in"|"out"), 버튼 글자], [..]]  onAction(방향) 은 Promise 를 돌려주면 처리 중 버튼이 잠김
function AmountForm({ form, setForm, tplLabel, tplOptions, onTpl, showTreasury, actions, onAction }) {
  const onPick = (amt) => setForm((f) => ({ ...f, amount: amt === 0 ? 0 : (f.amount || 0) + amt }));
  return (
    <>
      <Select label={tplLabel} value={form.tpl} options={tplOptions} onChange={onTpl} />
      <TextInput label="내역" value={form.memo} onChange={(v) => setForm((f) => ({ ...f, memo: v }))} />
      {showTreasury ? <Checkbox label="국고 반영" checked={form.treasury} onChange={(v) => setForm((f) => ({ ...f, treasury: v }))} /> : null}
      <Cols w={[1, 1.5]} va="bottom">
        <NumberInput label="금액" min={0} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
        <RoundButtons onPick={onPick} />
      </Cols>
      <Cols w={2}>
        {actions.map(([dir, text]) => (
          <Btn key={dir} className={`act act-${dir} ${form.hint === dir ? "hint" : ""}`} onClick={() => onAction(dir)}>
            {text}
          </Btn>
        ))}
      </Cols>
    </>
  );
}

// 통장 입금/출금 (관리자 개인·전체, 학생 통장)
export function TradeForm({ form, setForm, templates, onAction, depositText = "💰 입금" }) {
  const byDisp = {};
  (templates || []).forEach((t) => (byDisp[templateDisplay(t)] = t));
  const labels = ["(직접 입력)", ...(templates || []).map(templateDisplay)];
  const onTpl = (sel) => {
    setForm((f) => {
      const t = sel === "(직접 입력)" ? null : byDisp[sel];
      if (!t) return { ...f, tpl: sel, hint: "" };
      return { ...f, tpl: sel, memo: t.label, amount: parseInt(t.amount, 10) || 0, hint: t.kind === "deposit" ? "in" : "out" };
    });
  };
  return (
    <AmountForm
      form={form}
      setForm={setForm}
      tplLabel="내역 템플릿"
      tplOptions={labels}
      onTpl={onTpl}
      showTreasury
      actions={[["in", depositText], ["out", "💸 출금"]]}
      onAction={onAction}
    />
  );
}

// 국고 세입/세출
export function TreasuryForm({ form, setForm, templates, onAction }) {
  const byDisp = {};
  (templates || []).forEach((t) => (byDisp[treasuryTemplateDisplay(t)] = t));
  const labels = ["(직접 입력)", ...(templates || []).map(treasuryTemplateDisplay)];
  const onTpl = (sel) => {
    setForm((f) => {
      const t = sel === "(직접 입력)" ? null : byDisp[sel];
      if (!t) return { ...f, tpl: sel, hint: "" };
      return { ...f, tpl: sel, memo: t.label, amount: parseInt(t.amount, 10) || 0, hint: t.kind === "income" ? "in" : "out" };
    });
  };
  return (
    <AmountForm
      form={form}
      setForm={setForm}
      tplLabel="국고 템플릿"
      tplOptions={labels}
      onTpl={onTpl}
      actions={[["in", "📥 세입"], ["out", "📤 세출"]]}
      onAction={onAction}
    />
  );
}

// 방향 + 금액 → 기존 API 형식(입금/출금 중 하나만)
export const splitAmount = (dir, amount) => (dir === "in" ? { dep: amount, wd: 0 } : { dep: 0, wd: amount });

// st.dataframe 형태의 통장 거래 내역
export const TX_COLUMNS = ["내역", "입금", "출금", "총액", "날짜-시간", "기록자"];
export function txRowsView(rows) {
  return (rows || []).map((r) => ({ 내역: r.memo, 입금: r.deposit, 출금: r.withdraw, 총액: r.balance_after, "날짜-시간": r.created_at_kr, 기록자: r.recorder || "" }));
}
