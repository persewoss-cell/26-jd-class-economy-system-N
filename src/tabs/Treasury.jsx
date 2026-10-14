// 🏛️ 국세청(국고)
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import {
  useApp, useLoad, Cols, H2, H3, Caption, Btn, TextInput, Select, NumberInput, Checkbox, Info, ErrorBox, Success, DataTable, FileUpload, SectionDivider, Loading,
} from "../components/ui.jsx";
import { TreasuryForm, useTreasuryForm, treasuryTemplateDisplay } from "../components/trade.jsx";

function TreTemplates({ templates, reload }) {
  const app = useApp();
  const labels = ["(새로 추가)", ...templates.map((t) => `${t.order} | ${treasuryTemplateDisplay(t)}`)];
  const [pick, setPick] = useState("(새로 추가)");
  const blank = { label: "", kind: "세입", amount: 0, order: 1 };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  const edit = pick === "(새로 추가)" ? null : templates[labels.indexOf(pick) - 1] || null;
  const onPick = (v) => {
    setPick(v);
    const t = v === "(새로 추가)" ? null : templates[labels.indexOf(v) - 1];
    setF(t ? { label: t.label, kind: t.kind === "expense" ? "세출" : "세입", amount: t.amount, order: t.order || 1 } : blank);
  };
  const save = async () => {
    setErr("");
    const r = await api("tre_tpl_save", { template_id: edit ? edit.template_id : "", label: f.label.trim(), kind: f.kind === "세출" ? "expense" : "income", amount: f.amount, order: f.order });
    if (r.ok) {
      app.toast("국고 템플릿 저장 완료!", "✅");
      onPick("(새로 추가)");
      reload();
    } else setErr(r.error || "저장 실패");
  };
  const del = async () => {
    if (!edit) return;
    const r = await api("tre_tpl_delete", { template_id: edit.template_id });
    if (r.ok) {
      app.toast("국고 템플릿 삭제 완료!", "🗑️");
      onPick("(새로 추가)");
      reload();
    } else setErr(r.error || "삭제 실패");
  };
  return (
    <>
      <Select label="편집 대상" value={pick} options={labels} onChange={onPick} />
      <Cols w={[2.2, 1.2, 1.2, 1.0]}>
        <TextInput label="라벨(내역)" value={f.label} onChange={(v) => setF((x) => ({ ...x, label: v }))} />
        <Select label="종류" value={f.kind} options={["세입", "세출"]} onChange={(v) => setF((x) => ({ ...x, kind: v }))} />
        <NumberInput label="금액" min={0} value={f.amount} onChange={(v) => setF((x) => ({ ...x, amount: v }))} />
        <NumberInput label="순서" min={1} value={f.order} onChange={(v) => setF((x) => ({ ...x, order: v }))} />
      </Cols>
      <Cols w={3}>
        <Btn onClick={save}>
          ✅ 저장
        </Btn>
        <Btn onClick={() => onPick("(새로 추가)")}>🧹 입력 초기화</Btn>
        <Btn onClick={del} disabled={!edit}>
          🗑️ 삭제
        </Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

export default function Treasury() {
  const app = useApp();
  const { data, error, reload } = useLoad("treasury_load", {}, [app.ver]);
  const [form, setForm, reset] = useTreasuryForm();
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [overwrite, setOverwrite] = useState(false);
  const [bulkErr, setBulkErr] = useState("");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;

  const save = async (dir) => {
    setErr("");
    if (!(form.amount > 0)) return setErr("금액을 입력해 주세요.");
    const r = await api("treasury_add", { memo: form.memo.trim(), income: dir === "in" ? form.amount : 0, expense: dir === "out" ? form.amount : 0 });
    if (r.ok) {
      reset();
      app.toast("국고 저장 완료!", "✅");
      reload();
    } else setErr(r.error || "국고 저장 실패");
  };

  const COLS = ["라벨(내역)", "종류", "금액", "순서"];
  const onFile = async (fl) => {
    setFile(fl);
    setBulk(null);
    setMsgs([]);
    if (!fl) return;
    try {
      const { columns, rows } = await readExcel(fl);
      const miss = COLS.filter((c) => !columns.includes(c));
      if (miss.length) return setMsgs([`필수 컬럼이 없습니다: [${miss.map((m) => `'${m}'`).join(", ")}]`]);
      const num = (v, d) => {
        const n = Number(v);
        return v === undefined || v === null || v === "" || !Number.isFinite(n) ? d : Math.trunc(n);
      };
      const df = rows.map((r) => ({ "라벨(내역)": r["라벨(내역)"] === undefined ? "nan" : String(r["라벨(내역)"]).trim(), 종류: r["종류"] === undefined ? "nan" : String(r["종류"]).trim(), 금액: num(r["금액"], 0), 순서: num(r["순서"], 999999) }));
      const m = [];
      if (df.some((r) => r["라벨(내역)"].length === 0)) m.push("❌ 라벨(내역)이 비어있는 행이 있습니다.");
      if (df.some((r) => !["세입", "세출"].includes(r.종류))) m.push("❌ 종류 값이 잘못된 행이 있습니다. (세입/세출만 가능)");
      if (df.some((r) => r.금액 <= 0)) m.push("❌ 금액은 1 이상이어야 합니다.");
      if (m.length) return setMsgs(m);
      setBulk(df);
    } catch (e) {
      setMsgs([`엑셀 읽기 실패: ${e.message || e}`]);
    }
  };
  const bulkSave = async () => {
    setBulkErr("");
    if (!bulk || !bulk.length) return setBulkErr("먼저 올바른 엑셀을 업로드하세요.");
    const r = await api("tre_tpl_bulk", { rows: bulk, overwrite });
    if (r.ok) {
      app.toast("국고 템플릿 엑셀 저장(반영) 완료!", "📥");
      setBulk(null);
      setFile(null);
      reload();
    } else setBulkErr(r.error);
  };
  const current = data.templates.map((t) => ({ "라벨(내역)": t.label.trim(), 종류: t.kind === "income" ? "세입" : "세출", 금액: t.amount, 순서: t.order }));

  return (
    <>
      <H2>
        🪙국고: <b>{Number(data.balance).toLocaleString("en-US")}드림</b>
      </H2>
      <H3>🧾세입/세출 내역</H3>
      {data.rows.length ? <DataTable rows={data.rows} columns={["내역", "세입", "세출", "총액", "날짜-시간", "기록자"]} csvName="국고내역" /> : <Info>국고 내역이 아직 없어요.</Info>}

      <H3>📝 세입/세출 내역 입력</H3>
      <TreasuryForm form={form} setForm={setForm} templates={data.templates} onAction={save} />
      <ErrorBox>{err}</ErrorBox>

      <SectionDivider />
      <H3>🧩 국고 템플릿 추가/수정/삭제</H3>
      <TreTemplates templates={data.templates} reload={reload} />

      <H3>📥 국고 템플릿 엑셀로 일괄 추가</H3>
      <Cols w={2}>
        <Btn
          className="dl"
          onClick={() =>
            downloadExcel("국고_템플릿_샘플.xlsx", [
              {
                name: "treasury_templates",
                columns: COLS,
                rows: [
                  { "라벨(내역)": "행사 지원금", 종류: "세입", 금액: 1000, 순서: 1 },
                  { "라벨(내역)": "교구 구매", 종류: "세출", 금액: 300, 순서: 2 },
                  { "라벨(내역)": "분실 벌금", 종류: "세입", 금액: 50, 순서: 3 },
                ],
              },
            ])
          }
        >
          📄 국고 템플릿 샘플 엑셀 다운로드
        </Btn>
        <Btn className="dl" onClick={() => downloadExcel("국고_템플릿_현재목록.xlsx", [{ name: "treasury_templates", columns: COLS, rows: current }])}>
          📄 현재 템플릿 엑셀 다운로드
        </Btn>
      </Cols>
      <Caption>• 샘플 형식: 라벨(내역) | 종류(세입/세출) | 금액 | 순서</Caption>
      <Caption>
        • 엑셀을 올린 뒤, 아래의 <b>저장</b> 버튼을 눌러야 실제 반영됩니다.
      </Caption>
      <FileUpload label="국고 템플릿 엑셀 업로드(.xlsx)" file={file} onFile={onFile} help="샘플 형식 그대로 업로드하세요. 업로드만으로는 반영되지 않고, 아래 '저장' 버튼을 눌러야 반영됩니다." />
      {msgs.map((m) => (
        <ErrorBox key={m}>{m}</ErrorBox>
      ))}
      {bulk ? (
        <>
          <Success>{`업로드 완료! (${bulk.length}행) 아래 미리보기 확인 후 저장을 누르세요.`}</Success>
          <DataTable rows={bulk} columns={COLS} />
        </>
      ) : null}
      <Checkbox label="저장 시 기존 국고 템플릿 리스트를 모두 삭제하고 새로 올린 엑셀로 덮어쓰기" checked={overwrite} onChange={setOverwrite} />
      <Btn onClick={bulkSave}>
        ✅ 국고 템플릿 엑셀 내용 저장(반영)
      </Btn>
      <ErrorBox>{bulkErr}</ErrorBox>
    </>
  );
}
