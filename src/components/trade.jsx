// 입금/출금 입력 폼(render_admin_trade_ui) + 국고 세입/세출 입력 폼(render_treasury_trade_ui)
import React, { useState } from "react";
import { Btn, TextInput, NumberInput, Select, Checkbox, moveItem } from "./ui.jsx";

const QUICK = [10, 20, 50, 100, 200, 500, 1000];

export const templateDisplay = (t) => `${t.label}[${t.kind === "deposit" ? "입금" : "출금"} ${parseInt(t.amount, 10) || 0}]`;
export const treasuryTemplateDisplay = (t) => `${t.label}[${t.kind === "income" ? "세입" : "세출"} ${parseInt(t.amount, 10) || 0}]`;

// 금액칸 하나 + 맨 아래 [입금] [출금] 버튼. 버튼을 누르는 순간 방향이 정해져서 (+)/(-) 전환을 깜빡할 일이 없음.
// treasuryDefault: 국고 반영 처음 상태(학생 true / 관리자 false → 입금·출금 누를 때 팝업으로 물어봄)
// treasuryTouched: 체크칸을 직접 눌렀는지 (눌렀으면 팝업 없이 그 상태로 반영)
export function useTradeForm(treasuryDefault = true) {
  const init = () => ({ tpl: "(직접 입력)", memo: "", treasury: treasuryDefault, treasuryTouched: false, amount: 0, hint: "" });
  const [f, setF] = useState(init);
  return [f, setF, () => setF(init())];
}
export const useTreasuryForm = () => useTradeForm();

// 빠른 금액 원형 버튼: 누를 때마다 더해짐, [지우기]는 0으로
function RoundButtons({ onPick }) {
  return (
    <div className="round-btns" role="group" aria-label="빠른 금액">
      {QUICK.map((a) => (
        <div key={a} className="rb" onClick={() => onPick(a)}>
          +{a}
        </div>
      ))}
      <div className="rb clear" onClick={() => onPick(0)}>
        지우기
      </div>
    </div>
  );
}

// 금액 입력 + 방향 버튼 공용 폼 (2줄 · 3칸이 위아래로 맞춰짐)
//   1줄: [내역 템플릿] [내역]          [국고 반영]
//   2줄: [금액]       [+10 … 지우기] [입금] [출금] (+ 되돌리기 등 extra)
// actions: [[방향("in"|"out"), 버튼 글자], [..]]  onAction(방향) 은 Promise 를 돌려주면 처리 중 버튼이 잠김
// onMove: 템플릿 드롭다운 각 줄의 ▲▼ (있을 때만)
function AmountForm({ form, setForm, tplLabel, tplOptions, onTpl, onMove, showTreasury, actions, onAction, extra }) {
  const onPick = (amt) => setForm((f) => ({ ...f, amount: amt === 0 ? 0 : (f.amount || 0) + amt }));
  return (
    <div className="trade-grid">
      <Select label={tplLabel} value={form.tpl} options={tplOptions} onChange={onTpl} onMove={onMove} />
      <TextInput label="내역" value={form.memo} onChange={(v) => setForm((f) => ({ ...f, memo: v }))} />
      <div className="tg-check">
        {showTreasury ? <Checkbox label="국고 반영" checked={form.treasury} onChange={(v) => setForm((f) => ({ ...f, treasury: v, treasuryTouched: true }))} /> : null}
      </div>
      <NumberInput label="금액" min={0} value={form.amount} stepper={false} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
      <RoundButtons onPick={onPick} />
      <div className="tg-actions">
        {actions.map(([dir, text]) => (
          <Btn key={dir} full={false} className={`act act-${dir} ${form.hint === dir ? "hint" : ""}`} onClick={() => onAction(dir)}>
            {text}
          </Btn>
        ))}
        {extra || null}
      </div>
    </div>
  );
}

// 템플릿 목록 → 드롭다운 옵션("(직접 입력)"은 맨 위 고정) + ▲▼ 순서 바꾸기
// onReorder(ids): 바뀐 템플릿 id 순서를 저장 (권한이 있는 화면에서만 넘김)
function tplChoices(templates, disp, onReorder) {
  const list = templates || [];
  const options = [{ value: "(직접 입력)", label: "(직접 입력)", fixed: true }, ...list.map((t) => ({ value: disp(t), label: disp(t) }))];
  const onMove = onReorder ? (i, d) => onReorder(moveItem(list, i - 1, d).map((t) => t.template_id)) : undefined;
  return { options, onMove };
}

// 통장 입금/출금 (관리자 개인·전체, 학생 통장)
export function TradeForm({ form, setForm, templates, onAction, depositText = "💰 입금", extra, onReorder }) {
  const byDisp = {};
  (templates || []).forEach((t) => (byDisp[templateDisplay(t)] = t));
  const { options: labels, onMove } = tplChoices(templates, templateDisplay, onReorder);
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
      onMove={onMove}
      showTreasury
      actions={[["in", depositText], ["out", "💸 출금"]]}
      onAction={onAction}
      extra={extra}
    />
  );
}

// 국고 세입/세출
export function TreasuryForm({ form, setForm, templates, onAction, onReorder }) {
  const byDisp = {};
  (templates || []).forEach((t) => (byDisp[treasuryTemplateDisplay(t)] = t));
  const { options: labels, onMove } = tplChoices(templates, treasuryTemplateDisplay, onReorder);
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
      onMove={onMove}
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
