// 🛒 마트 (학생: 장보기 / 관리자·권한학생: 제한·승인·장부·템플릿)
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H4, Caption, Btn, TextInput, Select, NumberInput, Info, Warning, ErrorBox, DataTable, Loading, TplEditor, ExcelBar } from "../components/ui.jsx";

export function MartUser() {
  const app = useApp();
  const { data, error, reload } = useLoad("mart_user_load", {}, [app.ver]);
  const [pick, setPick] = useState("(직접입력)");
  const [item, setItem] = useState("");
  const [price, setPrice] = useState(0);
  const [err, setErr] = useState("");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  if (data.blocked) return <div className="mart-block">{data.blocked}</div>;
  const tpls = data.templates || [];
  const opts = ["(직접입력)", ...tpls.map((r) => `${r.item} | ${r.price}드림`)];
  const onPick = (v) => {
    setPick(v);
    if (v === "(직접입력)") {
      setItem("");
      setPrice(0);
    } else {
      const t = tpls[Math.max(0, opts.indexOf(v) - 1)];
      setItem(t.item);
      setPrice(t.price);
    }
  };
  const save = async () => {
    setErr("");
    const r = await api("mart_request", { item, price });
    if (r.ok) {
      app.toast("마트 구입 요청이 저장되었습니다.", "✅");
      setPick("(직접입력)");
      setItem("");
      setPrice(0);
      reload();
    } else setErr(r.error || "저장 실패");
  };
  return (
    <>
      <H4>🛍️ 마트 장보기</H4>
      <Cols w={[1.4, 2, 1, 0.9]} va="bottom">
        <Select label="내역 템플릿" value={pick} options={opts} onChange={onPick} />
        <TextInput label="내역" value={item} onChange={setItem} />
        <NumberInput label="금액" min={0} stepper={false} value={price} onChange={setPrice} />
        <Btn onClick={save}>🛍️ 구입 요청</Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

function MartTemplates({ templates, reload }) {
  return (
    <>
      <H4>🧩 마트 템플릿 추가/수정/삭제</H4>
      <TplEditor
        items={templates}
        itemLabel={(t) => `${t.order} | ${t.item} | ${t.price}드림`}
        blank={() => ({ item: "", price: 0, order: Math.max(1, templates.length + 1) })}
        fromItem={(t) => ({ item: t.item, price: t.price, order: t.order })}
        widths={[3, 1.2, 0.9]}
        fields={(f, set) => [
          <TextInput key="i" label="내역" value={f.item} onChange={(v) => set({ item: v })} />,
          <NumberInput key="p" label="금액" min={0} stepper={false} value={f.price} onChange={(v) => set({ price: v })} />,
          <NumberInput key="o" label="순서" min={0} stepper={false} value={f.order} onChange={(v) => set({ order: v })} />,
        ]}
        onSave={(f, edit) => api("mart_tpl_save", { item: f.item.trim(), price: f.price, order: f.order, template_id: edit ? edit.template_id : "" })}
        onDelete={(t) => api("mart_tpl_delete", { template_id: t.template_id })}
        saveToast="템플릿 저장 완료"
        deleteToast="삭제 완료"
        reload={reload}
      />
    </>
  );
}

export function MartAdmin() {
  const app = useApp();
  const { data, error, reload } = useLoad("mart_admin_load", {}, [app.ver]);
  const [limit, setLimit] = useState(null);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [xMsg, setXMsg] = useState(null);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const lim = limit === null ? data.limit : limit;

  const saveLimit = async () => {
    setErr("");
    const r = await api("mart_limit_save", { weekly_limit: lim });
    if (r.ok) {
      app.toast("주간 제한 저장 완료", "✅");
      setLimit(null);
      reload();
    } else setErr(r.error || "저장 실패");
  };
  const decide = async (id, ok) => {
    setErr("");
    const r = await api(ok ? "mart_approve" : "mart_reject", { request_id: id });
    if (r.ok) {
      app.toast(ok ? "승인 완료" : "거절 완료", "✅");
      app.refresh();
    } else setErr(r.error || (ok ? "승인 실패" : "거절 실패"));
  };
  const COLS = ["내역", "금액", "순서"];
  const applyExcel = async () => {
    setXMsg(null);
    if (!file) return setXMsg(["warning", "엑셀 파일을 업로드해 주세요."]);
    try {
      const { columns, rows } = await readExcel(file);
      if (!COLS.every((c) => columns.includes(c))) return setXMsg(["error", "엑셀 컬럼이 부족합니다. 필요 컬럼: 내역, 금액, 순서"]);
      const r = await api("mart_tpl_bulk", { rows, overwrite });
      if (!r.ok) return setXMsg(["error", `엑셀 반영 실패: ${r.error}`]);
      app.toast(`마트 템플릿 반영 완료: ${r.n}건`, "✅");
      setFile(null);
      reload();
    } catch (e) {
      setXMsg(["error", `엑셀 반영 실패: ${e.message || e}`]);
    }
  };
  return (
    <>
      <H4>🚦 구입 제한 설정</H4>
      <Cols w={[2, 1, 1]} va="bottom">
        <NumberInput label="주간 구입 가능 개수" min={0} value={lim} onChange={setLimit} />
        <Btn onClick={saveLimit}>저장</Btn>
        <span />
      </Cols>
      <Caption>{data.available.length ? `간식 구입 가능 학생: ${data.available.map(([no, nm]) => `${no}번 ${nm}`.trim()).join(", ")}` : "간식 구입 가능 학생: 없음"}</Caption>
      <H4>✅ 구입 승인</H4>
      {!data.pending.length ? <Info>승인 대기 요청이 없습니다.</Info> : null}
      {data.pending.map((r) => (
        <Cols w={[3, 1, 1]} va="center" key={r.request_id}>
          <div>{`${r.created_at_kr} | ${String(r.student_no).padStart(2, "0")}번 | ${r.student_name} | ${r.item} | ${r.price}드림`}</div>
          <Btn onClick={() => decide(r.request_id, true)}>승인</Btn>
          <Btn onClick={() => decide(r.request_id, false)}>거절</Btn>
        </Cols>
      ))}
      <ErrorBox>{err}</ErrorBox>
      <H4>📒 마트 구입 장부</H4>
      <DataTable rows={data.ledger} columns={["구입일시", "번호", "이름", "구입내역", "구입가격"]} csvName="마트장부" />
      <MartTemplates templates={data.templates} reload={reload} />
      <H4>📥 마트 템플릿 엑셀로 일괄 추가</H4>
      <ExcelBar
        downloads={[
          ["📄 샘플 엑셀", () => downloadExcel("mart_template_sample.xlsx", [{ name: "mart_templates", columns: COLS, rows: [{ 내역: "초코파이", 금액: 60, 순서: 1 }] }])],
          ["📄 현재 템플릿 엑셀", () => downloadExcel("mart_template_current.xlsx", [{ name: "mart_templates", columns: COLS, rows: data.templates.map((t) => ({ 내역: t.item.trim(), 금액: t.price, 순서: t.order })) }])],
        ]}
        file={file}
        onFile={setFile}
        overwrite={overwrite}
        setOverwrite={setOverwrite}
        overwriteLabel="기존 마트 템플릿을 모두 지우고 엑셀로 덮어쓰기"
        onSave={applyExcel}
        saveText="✅ 저장(반영)"
      >
        {xMsg ? xMsg[0] === "warning" ? <Warning>{xMsg[1]}</Warning> : <ErrorBox>{xMsg[1]}</ErrorBox> : null}
      </ExcelBar>
    </>
  );
}
