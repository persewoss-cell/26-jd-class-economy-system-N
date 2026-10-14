// 🏛️ 국세청(국고)
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, H2, H3, TextInput, Select, NumberInput, Info, ErrorBox, Success, DataTable, SectionDivider, Loading, TplEditor, ExcelBar } from "../components/ui.jsx";
import { TreasuryForm, useTreasuryForm, treasuryTemplateDisplay } from "../components/trade.jsx";

function TreTemplates({ templates, reload }) {
  return (
    <TplEditor
      items={templates}
      itemLabel={(t) => `${t.order} | ${treasuryTemplateDisplay(t)}`}
      blank={() => ({ label: "", kind: "세입", amount: 0, order: Math.max(1, templates.length + 1) })}
      fromItem={(t) => ({ label: t.label, kind: t.kind === "expense" ? "세출" : "세입", amount: t.amount, order: t.order || 1 })}
      widths={[3, 1.2, 1.2, 0.9]}
      fields={(f, set) => [
        <TextInput key="l" label="라벨(내역)" value={f.label} onChange={(v) => set({ label: v })} />,
        <Select key="k" label="종류" value={f.kind} options={["세입", "세출"]} onChange={(v) => set({ kind: v })} />,
        <NumberInput key="a" label="금액" min={0} stepper={false} value={f.amount} onChange={(v) => set({ amount: v })} />,
        <NumberInput key="o" label="순서" min={1} stepper={false} value={f.order} onChange={(v) => set({ order: v })} />,
      ]}
      onSave={(f, edit) => api("tre_tpl_save", { template_id: edit ? edit.template_id : "", label: f.label.trim(), kind: f.kind === "세출" ? "expense" : "income", amount: f.amount, order: f.order })}
      onDelete={(t) => api("tre_tpl_delete", { template_id: t.template_id })}
      idOf={(t) => t.template_id}
      onReorder={(ids) => api("tpl_reorder", { kind: "treasury", ids })}
      saveToast="국고 템플릿 저장 완료!"
      deleteToast="국고 템플릿 삭제 완료!"
      reload={reload}
    />
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
      <ExcelBar
        downloads={[
          [
            "📄 샘플 엑셀",
            () =>
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
              ]),
          ],
          ["📄 현재 템플릿 엑셀", () => downloadExcel("국고_템플릿_현재목록.xlsx", [{ name: "treasury_templates", columns: COLS, rows: current }])],
        ]}
        file={file}
        onFile={onFile}
        overwrite={overwrite}
        setOverwrite={setOverwrite}
        overwriteLabel="기존 국고 템플릿을 모두 지우고 엑셀로 덮어쓰기"
        onSave={bulkSave}
      >
        {msgs.map((m) => (
          <ErrorBox key={m}>{m}</ErrorBox>
        ))}
        {bulk ? (
          <>
            <Success>{`업로드 완료! (${bulk.length}행) 미리보기 확인 후 저장을 누르세요.`}</Success>
            <DataTable rows={bulk} columns={COLS} />
          </>
        ) : null}
      </ExcelBar>
      <ErrorBox>{bulkErr}</ErrorBox>
    </>
  );
}
