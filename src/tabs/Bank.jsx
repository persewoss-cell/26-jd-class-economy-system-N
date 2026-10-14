// 🏦 내 통장 (관리자: 💰입금/출금 / 학생: 📝 통장/거래 / 권한학생: ⍟💰입금/출금(관리자))
import React, { useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, Subheader, Btn, TextInput, Select, NumberInput, Checkbox, Radio, SubTabs, ConfirmModal, Info, ErrorBox, Success, DataTable, SectionDivider, Loading, ExcelBar } from "../components/ui.jsx";
import { TradeForm, useTradeForm, splitAmount, templateDisplay, TX_COLUMNS, txRowsView } from "../components/trade.jsx";

// ---------------- 되돌리기(관리자): 최근 입금/출금을 골라 기록째 지움 ----------------
function UndoPanel({ onClose }) {
  const app = useApp();
  const list = useLoad("undo_list", {}, [app.ver]);
  const rows = (list.data && list.data.rows) || [];
  const [key, setKey] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const pick = rows.find((r) => r.key === key) || rows[0];
  const run = async () => {
    setErr("");
    if (!pick) return setErr("되돌릴 기록이 없어요.");
    const r = await api("undo_apply", { admin_pin: pin, key: pick.key });
    if (r.ok) {
      app.toast(`되돌리기 완료 (학생 ${r.students}명${r.treasury ? " · 국고 기록 포함" : ""})`, "↩️");
      setPin("");
      setKey("");
      app.refresh();
    } else setErr(r.error || "되돌리기 실패");
  };
  return (
    <div className="undo-box">
      <Subheader>↩️ 되돌리기(관리자)</Subheader>
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && !rows.length ? <Info>되돌릴 수 있는 최근 입금/출금이 없어요.</Info> : null}
      {rows.length ? (
        <Cols w={[3.4, 1.4, 1.3, 0.8]} va="bottom">
          <Select label="되돌릴 기록 (최근 순)" value={pick ? pick.key : ""} options={rows.map((r) => ({ value: r.key, label: r.label }))} onChange={setKey} />
          <TextInput label="관리자 비밀번호" type="password" value={pin} onChange={setPin} onEnter={run} />
          <Btn onClick={run}>↩️ 되돌리기</Btn>
          <Btn onClick={onClose}>닫기</Btn>
        </Cols>
      ) : null}
      <ErrorBox>{err}</ErrorBox>
    </div>
  );
}

// ---------------- 템플릿 ----------------
const CATS = ["없음", "보상", "구입", "벌금"];
function parseLabel(label) {
  const s = String(label || "").trim();
  if (s.startsWith("[") && s.includes("]")) {
    const e = s.indexOf("]");
    let rest = s.slice(e + 1).trim();
    if (rest.startsWith("-")) rest = rest.slice(1).trim();
    return [s.slice(1, e).trim(), rest];
  }
  return ["", s];
}
function catForExcel(t) {
  const raw = String(t.category || "").trim();
  const cat = raw || parseLabel(t.label)[0];
  return CATS.includes(cat) ? cat : "없음";
}

function TemplateManager({ templates, reload }) {
  const app = useApp();
  const [mode, setMode] = useState("추가");
  const [pickIdx, setPickIdx] = useState(0);
  const [form, setForm] = useState({ edit_id: "", base: "", cat: "없음", kind: "입금", amount: 10, order: 1 });
  const [err, setErr] = useState("");
  const [delIdx, setDelIdx] = useState(0);
  const [delConfirm, setDelConfirm] = useState(false);
  const [file, setFile] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [bulkMsgs, setBulkMsgs] = useState([]);
  const [delOld, setDelOld] = useState(false);
  const [bulkErr, setBulkErr] = useState("");

  const fill = (t) => {
    let cat = String(t.category || "").trim();
    let base = String(t.base_label || "").trim();
    if (!cat && !base) [cat, base] = parseLabel(t.label);
    setForm({ edit_id: t.template_id, base, cat: cat || "없음", kind: t.kind === "withdraw" ? "출금" : "입금", amount: t.amount || 10, order: t.order || 1 });
  };

  const onMode = (m) => {
    setMode(m);
    setErr("");
    if (m === "수정" && templates.length) {
      setPickIdx(0);
      fill(templates[0]);
    } else setForm((f) => ({ ...f, edit_id: "" }));
  };

  const save = async () => {
    setErr("");
    if (!form.base.trim()) return setErr("내역 이름이 필요합니다.");
    const r = await api("template_save", {
      template_id: mode === "수정" ? form.edit_id : "",
      base_label: form.base.trim(),
      category: form.cat === "없음" ? "" : form.cat,
      kind: form.kind === "입금" ? "deposit" : "withdraw",
      amount: form.amount,
      order: form.order,
    });
    if (r.ok) {
      app.toast("템플릿 저장 완료!", "🧩");
      reload();
    } else setErr(r.error || "템플릿 저장 실패");
  };

  const del = async () => {
    const t = templates[delIdx];
    if (!t) return;
    const r = await api("template_delete", { template_id: t.template_id });
    if (r.ok) {
      app.toast("삭제 완료!", "🗑️");
      setDelConfirm(false);
      setDelIdx(0);
      reload();
    } else setErr(r.error || "삭제 실패");
  };

  const COLS = ["내역이름", "구분", "종류", "금액", "순서"];
  const sample = [
    { 내역이름: "대여료", 구분: "구입", 종류: "출금", 금액: 100, 순서: 1 },
    { 내역이름: "발표", 구분: "보상", 종류: "입금", 금액: 10, 순서: 2 },
    { 내역이름: "지각", 구분: "벌금", 종류: "출금", 금액: 20, 순서: 3 },
    { 내역이름: "기타", 구분: "없음", 종류: "입금", 금액: 5, 순서: 4 },
  ];
  const current = templates.map((t) => ({
    내역이름: String(t.base_label || "").trim() || parseLabel(t.label)[1],
    구분: catForExcel(t),
    종류: t.kind === "deposit" ? "입금" : "출금",
    금액: t.amount,
    순서: t.order,
  }));

  const onFile = async (f) => {
    setFile(f);
    setBulk(null);
    setBulkMsgs([]);
    if (!f) return;
    try {
      const { columns, rows } = await readExcel(f);
      const miss = COLS.filter((c) => !columns.includes(c));
      if (miss.length) return setBulkMsgs([`필수 컬럼이 없습니다: [${miss.map((m) => `'${m}'`).join(", ")}]`]);
      const toNum = (v, d) => {
        const n = Number(v);
        return v === undefined || v === null || v === "" || !Number.isFinite(n) ? d : Math.trunc(n);
      };
      const df = rows.map((r) => {
        let cat = r["구분"] === undefined || r["구분"] === null ? "" : String(r["구분"]).trim();
        if (["nan", "None", ""].includes(cat)) cat = "없음";
        return {
          내역이름: r["내역이름"] === undefined ? "nan" : String(r["내역이름"]).trim(),
          구분: cat,
          종류: r["종류"] === undefined ? "nan" : String(r["종류"]).trim(),
          금액: toNum(r["금액"], 0),
          순서: toNum(r["순서"], 999999),
        };
      });
      const msgs = [];
      if (df.some((r) => r.내역이름.length === 0)) msgs.push("❌ 내역이름이 비어있는 행이 있습니다.");
      if (df.some((r) => !CATS.includes(r.구분))) msgs.push("❌ 구분 값이 잘못된 행이 있습니다. (없음/보상/구입/벌금만 가능)");
      if (df.some((r) => !["입금", "출금"].includes(r.종류))) msgs.push("❌ 종류 값이 잘못된 행이 있습니다. (입금/출금만 가능)");
      if (df.some((r) => r.금액 <= 0)) msgs.push("❌ 금액은 1 이상이어야 합니다.");
      if (msgs.length) return setBulkMsgs(msgs);
      setBulk(df);
    } catch (e) {
      setBulkMsgs([`엑셀 읽기 실패: ${e.message || e}`]);
    }
  };

  const bulkSave = async () => {
    setBulkErr("");
    if (!bulk || !bulk.length) return setBulkErr("먼저 올바른 엑셀을 업로드하세요.");
    const r = await api("templates_bulk_save", { rows: bulk, delete_old: delOld });
    if (r.ok) {
      app.toast(`엑셀 저장 완료! (${r.saved}개 반영)`, "📥");
      setBulk(null);
      setFile(null);
      reload();
    } else setBulkErr(`저장 실패: ${r.error}`);
  };

  const opts = templates.map((t, i) => ({ value: i, label: templateDisplay(t) }));
  return (
    <>
      <SectionDivider />
      <H3>🧩 템플릿 추가/수정/삭제</H3>
      <Radio label="작업" hideLabel options={["추가", "수정", "삭제"]} value={mode} onChange={onMode} />
      {mode === "삭제" ? (
        templates.length ? (
          <Cols w={[3, 1]} va="bottom">
            <Select label="삭제할 템플릿 선택" value={delIdx} options={opts} onChange={setDelIdx} />
            <Btn onClick={() => setDelConfirm(true)}>🗑️ 삭제</Btn>
          </Cols>
        ) : (
          <Info>삭제할 템플릿이 없어요.</Info>
        )
      ) : (
        <>
          {mode === "수정" && templates.length ? (
            <Select
              label="수정할 템플릿 선택"
              value={pickIdx}
              options={opts}
              onChange={(i) => {
                setPickIdx(i);
                fill(templates[i]);
              }}
            />
          ) : null}
          <Cols w={[3, 1.3, 1.1, 1.1, 0.9, 1.2]} va="bottom">
            <TextInput label="내역 이름" value={form.base} onChange={(v) => setForm((f) => ({ ...f, base: v }))} />
            <Select label="구분" value={form.cat} options={CATS} onChange={(v) => setForm((f) => ({ ...f, cat: v }))} />
            <Select label="종류" value={form.kind} options={["입금", "출금"]} onChange={(v) => setForm((f) => ({ ...f, kind: v }))} />
            <NumberInput label="금액" min={1} stepper={false} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
            <NumberInput label="순서" min={1} stepper={false} value={form.order} onChange={(v) => setForm((f) => ({ ...f, order: v }))} />
            <Btn onClick={save}>✅ 저장</Btn>
          </Cols>
        </>
      )}
      <ErrorBox>{err}</ErrorBox>
      <ConfirmModal open={delConfirm} title="🗑️ 템플릿 삭제" message={`'${templates[delIdx] ? templateDisplay(templates[delIdx]) : ""}' 템플릿을 삭제할까요?`} onYes={del} onNo={() => setDelConfirm(false)} />

      <H3>📥 템플릿 엑셀로 일괄 추가</H3>
      <ExcelBar
        downloads={[
          ["📄 샘플 엑셀", () => downloadExcel("템플릿_샘플.xlsx", [{ name: "templates", columns: COLS, rows: sample }])],
          ["📄 현재 템플릿 엑셀", () => downloadExcel("템플릿_현재목록.xlsx", [{ name: "templates", columns: COLS, rows: current }])],
        ]}
        file={file}
        onFile={onFile}
        overwrite={delOld}
        setOverwrite={setDelOld}
        overwriteLabel="기존 템플릿을 모두 지우고 엑셀로 덮어쓰기"
        onSave={bulkSave}
      >
        {bulkMsgs.map((m) => (
          <ErrorBox key={m}>{m}</ErrorBox>
        ))}
        {bulk ? (
          <>
            <Success>업로드 완료! ({bulk.length}행) 미리보기 확인 후 저장을 누르세요.</Success>
            <DataTable rows={bulk} columns={COLS} />
          </>
        ) : null}
      </ExcelBar>
      <ErrorBox>{bulkErr}</ErrorBox>
    </>
  );
}

// ---------------- 관리자(또는 권한 학생) 화면 ----------------
export function BankAdmin() {
  const app = useApp();
  const [sub, setSub] = useState("개인");
  const tpls = useLoad("templates_list", {}, []);
  const templates = (tpls.data && tpls.data.templates) || [];
  const accounts = useLoad("accounts_list", {}, [app.ver]);

  // 국고 반영: 체크칸을 직접 누르지 않았으면 입금/출금을 누를 때 "국고에 반영할까요?" 팝업
  const [askTreasury, setAskTreasury] = useState(null); // { run: (treasury) => Promise }
  // 입력 확인이 끝난 뒤 호출: 직접 체크했으면 그 값, 아니면 팝업으로 물어본 뒤 진행. true를 돌려주면 "물어보는 중"
  const needAsk = (form, again) => {
    if (form.treasuryTouched) return false;
    setAskTreasury({ run: again });
    return true;
  };
  const answerTreasury = (yes) => {
    const a = askTreasury;
    setAskTreasury(null);
    if (a) a.run(yes);
  };

  // 전체
  const [bForm, setBForm, bReset] = useTradeForm(false);
  const [bErr, setBErr] = useState("");
  const [undo, setUndo] = useState(false);
  const undoBtn = (
    <Btn full={false} className="undo" onClick={() => setUndo((v) => !v)}>
      ↩️ 되돌리기(관리자)
    </Btn>
  );
  const saveBulk = async (dir, treasury) => {
    setBErr("");
    const { memo } = bForm;
    const { dep, wd } = splitAmount(dir, bForm.amount);
    if (!(bForm.amount > 0)) return setBErr("금액을 입력해 주세요.");
    if (!memo.trim()) return setBErr("내역(메모)을 입력해 주세요.");
    if (treasury === undefined) {
      if (needAsk(bForm, (t) => saveBulk(dir, t))) return;
      treasury = bForm.treasury;
    }
    const r = await api("bank_bulk", { memo: memo.trim(), dep, wd, treasury });
    if (r.ok) {
      if (r.mode === "deposit") app.toast(`일괄 지급 완료! (${r.count}명)`, "🎉");
      else app.toast(`일괄 출금 완료! (적용 ${r.count}명)`, "⚠️");
      bReset();
      app.refresh();
    } else setBErr(r.error || (dep > 0 ? "일괄 지급 실패" : "일괄 출금 실패"));
  };

  // 개인
  const [picks, setPicks] = useState({});
  const [pForm, setPForm, pReset] = useTradeForm(false);
  const [pErr, setPErr] = useState("");
  const accs = useMemo(() => {
    const list = [...((accounts.data && accounts.data.accounts) || [])];
    const num = (a) => {
      if (a.no > 0) return a.no;
      const m = String(a.name || "").match(/\d+/);
      return m ? parseInt(m[0], 10) : 0;
    };
    list.forEach((a) => (a._num = num(a)));
    list.sort((a, b) => (a._num > 0 ? a._num : 9999) - (b._num > 0 ? b._num : 9999));
    return list;
  }, [accounts.data]);
  const selected = accs.filter((a) => picks[a.student_id]);
  const savePersonal = async (dir, treasury) => {
    setPErr("");
    if (!selected.length) return setPErr("대상 학생을 먼저 체크해 주세요.");
    const { memo } = pForm;
    const { dep, wd } = splitAmount(dir, pForm.amount);
    if (!(pForm.amount > 0)) return setPErr("금액을 입력해 주세요.");
    if (!memo.trim()) return setPErr("내역(메모)을 입력해 주세요.");
    const isDep = dep > 0;
    if (treasury === undefined) {
      if (needAsk(pForm, (t) => savePersonal(dir, t))) return;
      treasury = pForm.treasury;
    }
    const r = await api("bank_personal", { sids: selected.map((a) => a.student_id), memo: memo.trim(), dep, wd, treasury });
    if (r.ok) {
      app.toast(isDep ? `입금 완료! (${r.ok_cnt}명)` : `출금 완료! (적용 ${r.ok_cnt}명)`, isDep ? "🎉" : "⚠️");
      setPicks({});
      pReset();
      app.refresh();
    } else setPErr(r.error || "적용 실패");
  };

  const rows = [];
  for (let i = 0; i < accs.length; i += 5) rows.push(accs.slice(i, i + 5));

  return (
    <>
      <ConfirmModal open={!!askTreasury} title="🏛️ 국고 반영" message="국고에 반영할까요?" onYes={() => answerTreasury(true)} onNo={() => answerTreasury(false)} />
      <SubTabs tabs={["개인", "전체"]} active={sub} onChange={setSub} />
      {sub === "전체" ? (
        <>
          <H3>🎁 전체 일괄 입금/출금</H3>
          <TradeForm form={bForm} setForm={setBForm} templates={templates} onAction={(dir) => saveBulk(dir)} extra={undoBtn} />
          <ErrorBox>{bErr}</ErrorBox>
          {undo ? <UndoPanel onClose={() => setUndo(false)} /> : null}
        </>
      ) : (
        <>
          <H3>👥 대상 학생 선택</H3>
          {accounts.loading && !accounts.data ? <Loading /> : null}
          {accounts.data && !accs.length ? <Info>활성 계정이 없습니다.</Info> : null}
          {accs.length ? (
            <>
              {rows.map((chunk, ri) => (
                <Cols w={5} key={ri}>
                  {[0, 1, 2, 3, 4].map((j) =>
                    chunk[j] ? (
                      <Checkbox
                        key={chunk[j].student_id}
                        label={`${chunk[j]._num > 0 ? chunk[j]._num : "?"}번 ${chunk[j].name}`}
                        checked={!!picks[chunk[j].student_id]}
                        onChange={(v) => setPicks((p) => ({ ...p, [chunk[j].student_id]: v }))}
                      />
                    ) : (
                      <span key={j} />
                    )
                  )}
                </Cols>
              ))}
              <H3>🎁 개인 입금/출금</H3>
              <TradeForm form={pForm} setForm={setPForm} templates={templates} onAction={(dir) => savePersonal(dir)} extra={undoBtn} />
              <ErrorBox>{pErr}</ErrorBox>
              {undo ? <UndoPanel onClose={() => setUndo(false)} /> : null}
            </>
          ) : null}
          <TemplateManager templates={templates} reload={tpls.reload} />
        </>
      )}
    </>
  );
}

// ---------------- 학생 화면 ----------------
export function BankStudent() {
  const app = useApp();
  const tpls = useLoad("templates_list", {}, []);
  const txs = useLoad("tx_list", { limit: 300 }, [app.ver]);
  const [form, setForm, reset] = useTradeForm();
  const [err, setErr] = useState("");
  const rows = (txs.data && txs.data.rows) || [];

  const save = async (dir) => {
    setErr("");
    const memo = form.memo.trim();
    if (!memo) return setErr("내역을 입력해 주세요.");
    if (!(form.amount > 0)) return setErr("금액을 입력해 주세요.");
    const { dep, wd } = splitAmount(dir, form.amount);
    const r = await api("student_trade", { memo, dep, wd, treasury: form.treasury });
    if (r.ok) {
      app.toast(r.mode === "request" ? "입금 요청 완료!" : "저장 완료!", r.mode === "request" ? "📨" : "✅");
      reset();
      app.refresh();
    } else setErr(r.error || (dep > 0 ? "입금 신청 실패" : "저장 실패"));
  };

  if (txs.error && !txs.data) return <ErrorBox>{txs.error}</ErrorBox>;
  return (
    <>
      <Subheader>📝 통장 입금/출금하기</Subheader>
      <TradeForm form={form} setForm={setForm} templates={(tpls.data && tpls.data.templates) || []} onAction={save} depositText="💰 입금 요청" />
      <ErrorBox>{err}</ErrorBox>
      <Subheader>📒 통장 거래 내역(최신순)</Subheader>
      {txs.loading && !txs.data ? <Loading /> : rows.length ? <DataTable rows={txRowsView(rows)} columns={TX_COLUMNS} csvName="통장내역" /> : <Info>거래 내역이 없어요.</Info>}
    </>
  );
}
