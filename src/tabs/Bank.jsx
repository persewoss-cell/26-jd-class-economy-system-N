// 🏦 내 통장 (관리자: 💰입금/출금 / 학생: 📝 통장/거래 / 권한학생: ⍟💰입금/출금(관리자))
import React, { useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import {
  useApp, useLoad, Cols, H3, Subheader, Caption, Btn, TextInput, Select, NumberInput, Checkbox, Radio, SubTabs, ConfirmModal,
  Info, Warning, ErrorBox, Success, DataTable, FileUpload, SectionDivider, Loading,
} from "../components/ui.jsx";
import { TradeForm, useTradeForm, splitAmount, templateDisplay, TX_COLUMNS, txRowsView } from "../components/trade.jsx";

// ---------------- 되돌리기(관리자) ----------------
function RollbackPanel({ mode, selfRows, onDone }) {
  const app = useApp();
  const [pin, setPin] = useState("");
  const [pick, setPick] = useState("(선택)");
  const [checked, setChecked] = useState({});
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const accounts = useLoad("accounts_list", {}, []);
  const nameMap = useMemo(() => {
    const m = {};
    ((accounts.data && accounts.data.accounts) || []).forEach((a) => {
      if (a.name) m[a.name] = a.student_id;
    });
    return m;
  }, [accounts.data]);
  const sid = mode === "admin" ? nameMap[pick] || "" : "";
  const txs = useLoad("tx_list", { sid, limit: 120 }, [sid, mode === "admin" ? pick : "self"]);
  const rows = mode === "admin" ? (sid ? (txs.data && txs.data.rows) || [] : []) : selfRows || [];
  const view = rows.slice(0, 50);
  const can = (r) => (mode === "admin" ? r.can_rollback_admin : r.can_rollback_user);

  const run = async () => {
    setErr("");
    setWarn("");
    const ids = view.filter((r) => checked[r.tx_id] && can(r)).map((r) => r.tx_id);
    if (!ids.length) {
      const c = await api("check_admin_pin", { pin });
      if (!c.valid) return setErr("관리자 PIN이 틀립니다.");
      return setWarn("체크된 항목이 없어요.");
    }
    const r = await api("rollback", { admin_pin: pin, sid: mode === "admin" ? sid : undefined, tx_ids: ids });
    if (r.ok) {
      app.toast(`선택 ${r.undone}건 되돌림 완료`, "↩️");
      setChecked({});
      app.refresh();
      onDone && onDone();
      if (mode === "admin") txs.reload();
    } else setErr(r.error || "되돌리기 실패");
  };

  return (
    <>
      <Subheader>{mode === "admin" ? "↩️ 선택 되돌리기(관리자)" : "↩️ 선택 되돌리기(관리자 전용)"}</Subheader>
      <TextInput label="관리자 PIN 입력" type="password" value={pin} onChange={setPin} />
      {mode === "admin" ? (
        <Select label="되돌릴 학생 선택" value={pick} options={["(선택)", ...Object.keys(nameMap)]} onChange={(v) => { setPick(v); setChecked({}); }} />
      ) : null}
      {mode === "self" && view.length === 0 ? <Info>거래 내역이 없어요.</Info> : null}
      {mode === "self" && view.length > 0 ? <Caption>✅ 체크한 항목만 되돌립니다. (이미 되돌림/적금은 제외)</Caption> : null}
      {(mode === "self" || pick !== "(선택)") && view.length > 0 ? (
        <>
          {view.map((r) => (
            <Checkbox
              key={r.tx_id}
              label={`${r.created_at_kr} | ${r.memo} | +${r.deposit} / -${r.withdraw}`}
              checked={!!checked[r.tx_id]}
              disabled={!can(r)}
              onChange={(v) => setChecked((c) => ({ ...c, [r.tx_id]: v }))}
            />
          ))}
          <Btn onClick={run}>선택 항목 되돌리기</Btn>
        </>
      ) : null}
      {warn ? <Warning>{warn}</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

// ---------------- 템플릿 추가/수정/삭제 + 엑셀 ----------------
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

  return (
    <>
      <SectionDivider />
      <H3>🧩 템플릿 추가/수정/삭제</H3>
      <Radio label="작업" options={["추가", "수정"]} value={mode} onChange={onMode} />
      {mode === "수정" && templates.length ? (
        <Select
          label="수정할 템플릿 선택"
          value={pickIdx}
          options={templates.map((t, i) => ({ value: i, label: templateDisplay(t) }))}
          onChange={(i) => {
            setPickIdx(i);
            fill(templates[i]);
          }}
        />
      ) : null}
      <Cols w={[2, 1.2, 1, 1]}>
        <TextInput label="내역 이름" value={form.base} onChange={(v) => setForm((f) => ({ ...f, base: v }))} />
        <Select label="구분" value={form.cat} options={CATS} onChange={(v) => setForm((f) => ({ ...f, cat: v }))} />
        <Select label="종류" value={form.kind} options={["입금", "출금"]} onChange={(v) => setForm((f) => ({ ...f, kind: v }))} />
        <NumberInput label="금액" min={1} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
      </Cols>
      <NumberInput label="순서(order)" min={1} value={form.order} onChange={(v) => setForm((f) => ({ ...f, order: v }))} />
      <Btn onClick={save}>저장(추가/수정)</Btn>
      <ErrorBox>{err}</ErrorBox>
      <Caption>삭제</Caption>
      {templates.length ? (
        <>
          <Select label="삭제할 템플릿 선택" value={delIdx} options={templates.map((t, i) => ({ value: i, label: templateDisplay(t) }))} onChange={setDelIdx} />
          <Btn onClick={() => setDelConfirm(true)}>삭제</Btn>
          {delConfirm ? (
            <>
              <Warning>정말로 삭제하시겠습니까?</Warning>
              <Cols w={2}>
                <Btn onClick={del}>예</Btn>
                <Btn onClick={() => setDelConfirm(false)}>아니오</Btn>
              </Cols>
            </>
          ) : null}
        </>
      ) : null}

      <H3>📥 템플릿 엑셀로 일괄 추가</H3>
      <Cols w={2}>
        <Btn className="dl" onClick={() => downloadExcel("템플릿_샘플.xlsx", [{ name: "templates", columns: COLS, rows: sample }])}>📄 샘플 엑셀 다운로드</Btn>
        <Btn className="dl" onClick={() => downloadExcel("템플릿_현재목록.xlsx", [{ name: "templates", columns: COLS, rows: current }])}>📄 현재 템플릿 엑셀 다운로드</Btn>
      </Cols>
      <Caption>• 샘플 형식: 내역이름 | 구분(없음/보상/구입/벌금) | 종류(입금/출금) | 금액 | 순서</Caption>
      <Caption>
        • 엑셀을 올린 뒤, 아래의 <b>저장</b> 버튼을 눌러야 실제 반영됩니다.
      </Caption>
      <FileUpload label="엑셀 업로드(.xlsx)" file={file} onFile={onFile} help="샘플 형식 그대로 업로드하세요. 업로드만으로는 반영되지 않고, 아래 '저장' 버튼을 눌러야 반영됩니다." />
      {bulkMsgs.map((m) => (
        <ErrorBox key={m}>{m}</ErrorBox>
      ))}
      {bulk ? (
        <>
          <Success>업로드 완료! ({bulk.length}행) 아래 미리보기 확인 후 저장을 누르세요.</Success>
          <DataTable rows={bulk} columns={COLS} />
        </>
      ) : null}
      <Checkbox label="저장 시 기존 템플릿 리스트를 모두 삭제하고 새로 올린 엑셀로 덮어쓰기" checked={delOld} onChange={setDelOld} />
      <Btn onClick={bulkSave}>✅ 엑셀 내용 저장(반영)</Btn>
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

  // 국고 반영: 탭을 열 때 팝업으로 한 번 물어보고, 고른 값이 저장 후에도 기본값으로 유지됨
  const treasuryRef = useRef(false);
  const [askTreasury, setAskTreasury] = useState(true);
  const answerTreasury = (yes) => {
    treasuryRef.current = yes;
    setBForm((f) => ({ ...f, treasury: yes }));
    setPForm((f) => ({ ...f, treasury: yes }));
    setAskTreasury(false);
  };

  // 전체
  const [bForm, setBForm, bReset] = useTradeForm(treasuryRef);
  const [bErr, setBErr] = useState("");
  const [undo, setUndo] = useState(false);
  const saveBulk = async (dir) => {
    setBErr("");
    const { memo } = bForm;
    const { dep, wd } = splitAmount(dir, bForm.amount);
    if (!(bForm.amount > 0)) return setBErr("금액을 입력해 주세요.");
    if (!memo.trim()) return setBErr("내역(메모)을 입력해 주세요.");
    const r = await api("bank_bulk", { memo: memo.trim(), dep, wd, treasury: bForm.treasury });
    if (r.ok) {
      if (r.mode === "deposit") app.toast(`일괄 지급 완료! (${r.count}명)`, "🎉");
      else app.toast(`일괄 출금 완료! (적용 ${r.count}명)`, "⚠️");
      bReset();
      app.refresh();
    } else setBErr(r.error || (dep > 0 ? "일괄 지급 실패" : "일괄 출금 실패"));
  };

  // 개인
  const [picks, setPicks] = useState({});
  const [pForm, setPForm, pReset] = useTradeForm(treasuryRef);
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
  const savePersonal = async (dir) => {
    setPErr("");
    const { memo } = pForm;
    const { dep, wd } = splitAmount(dir, pForm.amount);
    if (!(pForm.amount > 0)) return setPErr("금액을 입력해 주세요.");
    if (!memo.trim()) return setPErr("내역(메모)을 입력해 주세요.");
    const isDep = dep > 0;
    if (!selected.length) {
      app.toast(isDep ? "입금 완료! (0명)" : "출금 완료! (적용 0명)", isDep ? "🎉" : "⚠️");
      return;
    }
    const r = await api("bank_personal", { sids: selected.map((a) => a.student_id), memo: memo.trim(), dep, wd, treasury: pForm.treasury });
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
      <ConfirmModal open={askTreasury} title="🏛️ 국고 반영" message="국고에 반영할까요?" onYes={() => answerTreasury(true)} onNo={() => answerTreasury(false)} />
      <SubTabs tabs={["개인", "전체"]} active={sub} onChange={setSub} />
      {sub === "전체" ? (
        <>
          <H3>🎁 전체 일괄 입금/출금</H3>
          <TradeForm form={bForm} setForm={setBForm} templates={templates} onAction={saveBulk} />
          <Btn onClick={() => setUndo((v) => !v)}>되돌리기(관리자)</Btn>
          <ErrorBox>{bErr}</ErrorBox>
          {undo ? <RollbackPanel mode="admin" /> : null}
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
              {selected.length ? <Caption>선택됨: {selected.map((a) => a.name).join(" · ")}</Caption> : null}
              <H3>🎁 개인 입금/출금</H3>
              <TradeForm form={pForm} setForm={setPForm} templates={templates} onAction={savePersonal} />
              <ErrorBox>{pErr}</ErrorBox>
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
  const [undo, setUndo] = useState(false);
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
      <Btn onClick={() => setUndo((v) => !v)}>되돌리기(관리자)</Btn>
      <ErrorBox>{err}</ErrorBox>
      {undo ? <RollbackPanel mode="self" selfRows={rows} onDone={() => setUndo(false)} /> : null}
      <Subheader>📒 통장 거래 내역(최신순)</Subheader>
      {txs.loading && !txs.data ? <Loading /> : rows.length ? <DataTable rows={txRowsView(rows)} columns={TX_COLUMNS} csvName="통장내역" /> : <Info>거래 내역이 없어요.</Info>}
    </>
  );
}
