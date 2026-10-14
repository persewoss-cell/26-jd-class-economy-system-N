// ⭐ 권한부여
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, Btn, Select, MultiSelect, Warning, ErrorBox, Success, DataTable, Loading, ConfirmModal, ExcelBar } from "../components/ui.jsx";

const ADMIN_OPTS = [
  ["💰입금/출금(관리자)", ["admin", "🏦 내 통장"]],
  ["🏦 은행(적금)(관리자)", ["admin", "🏦 은행(적금)"]],
  ["📈 투자(관리자)", ["admin", "📈 투자"]],
  ["🛒마트(관리자)", ["admin", "🛒마트"]],
];
const ADMIN_DISP = { "🏦 내 통장": "💰입금/출금(관리자)", "🏦 은행(적금)": "🏦 은행(적금)(관리자)", "📈 투자": "📈 투자(관리자)", "🛒마트": "🛒마트(관리자)" };

export default function Permissions() {
  const app = useApp();
  const { data, error, reload } = useLoad("perm_load", {}, [app.ver]);
  const [opt, setOpt] = useState("💰입금/출금(관리자)");
  const [sel, setSel] = useState([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [msg, setMsg] = useState(null);
  const [file, setFile] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const options = [...ADMIN_OPTS, ...data.allowed_tabs.map((t) => [t, ["tab", t]])];
  const optMap = Object.fromEntries(options);
  const stuLabel = (r) => `${String(r.no).padStart(2, "0")} ${r.name}`.trim();
  const byLabel = Object.fromEntries(data.students.map((r) => [stuLabel(r), r]));

  const resetForm = () => {
    setOpt(options[0][0]);
    setSel([]);
    setConfirmAll(false);
  };

  const apply = async (op) => {
    setMsg(null);
    if (!sel.length) return setMsg(["warning", "먼저 학생을 선택해 주세요."]);
    const [kind, tab] = optMap[opt];
    const r = await api("perm_apply", { kind, tab, op, sids: sel.map((l) => byLabel[l] && byLabel[l].sid).filter(Boolean) });
    if (r.ok) {
      setMsg(["success", op === "grant" ? `권한 부여 완료: ${r.n}명` : `권한 회수 완료: ${r.n}명`]);
      resetForm();
      reload();
    } else setMsg(["error", r.error]);
  };

  const revokeAll = async () => {
    const r = await api("perm_revoke_all", {});
    if (r.ok) {
      setMsg(["success", `전체 학생 권한 전체 회수 완료: ${r.n}명`]);
      resetForm();
      reload();
    } else setMsg(["error", r.error]);
  };

  const status = data.students
    .map((x) => {
      const tabs = x.extra.filter((k) => k.startsWith("tab::")).map((k) => k.replace("tab::", ""));
      const adm = x.extra.filter((k) => k.startsWith("admin::")).map((k) => k.replace("admin::", "")).map((t) => ADMIN_DISP[t] || `${t}(관리자)`);
      if (!tabs.length && !adm.length) return null;
      return { 번호: x.no, 이름: x.name, "부여된 권한": [...tabs, ...adm].join(", ") };
    })
    .filter(Boolean)
    .sort((a, b) => a.번호 - b.번호 || (a.이름 < b.이름 ? -1 : 1));

  const PCOLS = ["번호", "이름", "추가 탭(tab::)", "관리자 기능(admin::)"];
  const sampleDownload = () => {
    const rows = data.students.filter((r) => r.no > 0 && r.name.trim()).map((r) => ({ 번호: r.no, 이름: r.name.trim(), "추가 탭(tab::)": "", "관리자 기능(admin::)": "" }));
    rows.sort((a, b) => a.번호 - b.번호 || (a.이름 < b.이름 ? -1 : 1));
    const sample = rows.length
      ? rows
      : [
          { 번호: 1, 이름: "홍길동1", "추가 탭(tab::)": "💼 직업/월급", "관리자 기능(admin::)": "" },
          { 번호: 1, 이름: "홍길동1", "추가 탭(tab::)": "🏛️ 국세청(국고)", "관리자 기능(admin::)": "" },
          { 번호: 2, 이름: "홍길동2", "추가 탭(tab::)": "", "관리자 기능(admin::)": "💰입금/출금(관리자)" },
        ];
    downloadExcel("permissions_bulk_sample.xlsx", [
      {
        name: "permissions",
        columns: PCOLS,
        rows: sample,
        validations: [
          { range: "C2:C500", formula: "='추가탭_목록'!$A$2:$A$200" },
          { range: "D2:D500", formula: "='관리자기능_목록'!$A$2:$A$200" },
        ],
      },
      { name: "추가탭_목록", columns: ["추가 탭(tab::)"], rows: data.allowed_tabs.map((t) => ({ "추가 탭(tab::)": t })), hidden: true },
      { name: "관리자기능_목록", columns: ["관리자 기능(admin::)"], rows: data.admin_options.map((t) => ({ "관리자 기능(admin::)": t })), hidden: true },
    ]);
  };

  const runBulk = async () => {
    setBulkMsg(null);
    if (!file) return setBulkMsg([["warning", "엑셀 파일을 업로드하세요."]]);
    try {
      const { columns, rows } = await readExcel(file);
      if (!PCOLS.every((c) => columns.includes(c))) return setBulkMsg([["error", "엑셀 컬럼이 부족합니다. 필요 컬럼: 번호, 이름, 추가 탭(tab::), 관리자 기능(admin::)"]]);
      const r = await api("perm_bulk", { rows, overwrite });
      if (!r.ok) return setBulkMsg([["error", `엑셀 처리 중 오류: ${r.error}`]]);
      const out = [];
      if (r.applied) out.push(["success", `엑셀 권한 부여 완료: ${r.applied}행 적용`]);
      if (r.skipped && r.skipped.length) out.push(["warning", "일부 행은 제외되었습니다: " + r.skipped.slice(0, 4).join(" / ")]);
      setBulkMsg(out);
      reload();
    } catch (e) {
      setBulkMsg([["error", `엑셀 처리 중 오류: ${e.message || e}`]]);
    }
  };

  const Msg = ({ m }) => (m ? m[0] === "success" ? <Success>{m[1]}</Success> : m[0] === "warning" ? <Warning>{m[1]}</Warning> : <ErrorBox>{m[1]}</ErrorBox> : null);

  return (
    <>
      <H3>🔐 학생별 관리자 탭 권한 부여/회수</H3>
      <Cols w={[2, 2.6, 1, 1, 1.3]} va="bottom">
        <Select label="부여할 항목 선택" value={opt} options={options.map((o) => o[0])} onChange={setOpt} />
        <MultiSelect label="대상 학생 선택(복수 선택 가능)" value={sel} options={Object.keys(byLabel)} onChange={setSel} />
        <Btn onClick={() => apply("grant")}>➕ 권한 부여</Btn>
        <Btn onClick={() => apply("revoke")}>➖ 권한 회수</Btn>
        <Btn onClick={() => setConfirmAll(true)}>🔥 전체 권한 회수</Btn>
      </Cols>
      <Msg m={msg} />
      <ConfirmModal open={confirmAll} title="⚠️ 전체 권한 회수" message="모든 학생에게 준 권한을 회수할까요?" onYes={() => { setConfirmAll(false); revokeAll(); }} onNo={() => setConfirmAll(false)} />

      <H3>📌 권한 부여 현황</H3>
      <DataTable rows={status} columns={["번호", "이름", "부여된 권한"]} csvName="권한현황" />

      <H3>📥 일괄 엑셀 권한 부여</H3>
      <ExcelBar
        downloads={[["📄 샘플 엑셀", sampleDownload]]}
        file={file}
        onFile={setFile}
        overwrite={overwrite}
        setOverwrite={setOverwrite}
        overwriteLabel="기존 권한을 모두 지우고 엑셀로 덮어쓰기"
        onSave={runBulk}
        saveText="✅ 엑셀 일괄 등록"
      >
        {(bulkMsg || []).map((m, i) => (
          <Msg key={i} m={m} />
        ))}
      </ExcelBar>
    </>
  );
}
