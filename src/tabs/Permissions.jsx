// ⭐ 권한부여
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, Btn, Select, MultiSelect, Warning, ErrorBox, Success, DataTable, Loading, ExcelBar, Popup, Checkbox, Info } from "../components/ui.jsx";

const ADMIN_OPTS = [
  ["💰입금/출금(관리자)", ["admin", "🏦 내 통장"]],
  ["🏦 은행(적금)(관리자)", ["admin", "🏦 은행(적금)"]],
  ["📈 투자(관리자)", ["admin", "📈 투자"]],
  ["🛒마트(관리자)", ["admin", "🛒마트"]],
];
const ADMIN_DISP = { "🏦 내 통장": "💰입금/출금(관리자)", "🏦 은행(적금)": "🏦 은행(적금)(관리자)", "📈 투자": "📈 투자(관리자)", "🛒마트": "🛒마트(관리자)" };

// 권한 회수 팝업: 학생별 부여된 권한을 한 줄씩, 체크한 것만 회수
function RevokePopup({ data, open, onClose, onDone }) {
  const rows = [];
  for (const x of data.students) {
    for (const k of x.extra) {
      let kind = "";
      let tab = "";
      if (k.startsWith("tab::")) [kind, tab] = ["tab", k.slice(5)];
      else if (k.startsWith("admin::")) [kind, tab] = ["admin", k.slice(7)];
      else continue;
      rows.push({ key: `${x.sid}|${k}`, sid: x.sid, kind, tab, no: x.no, name: x.name, label: kind === "admin" ? ADMIN_DISP[tab] || `${tab}(관리자)` : tab });
    }
  }
  rows.sort((a, b) => a.no - b.no || (a.name < b.name ? -1 : 1) || (a.label < b.label ? -1 : 1));
  const [chk, setChk] = useState({});
  const [err, setErr] = useState("");
  const all = rows.length > 0 && rows.every((r) => chk[r.key]);
  const run = async () => {
    setErr("");
    const picked = rows.filter((r) => chk[r.key]);
    if (!picked.length) return setErr("회수할 권한을 체크해 주세요.");
    const groups = {};
    picked.forEach((r) => {
      const g = `${r.kind}|${r.tab}`;
      groups[g] = groups[g] || { kind: r.kind, tab: r.tab, sids: [] };
      groups[g].sids.push(r.sid);
    });
    for (const g of Object.values(groups)) {
      const r = await api("perm_apply", { kind: g.kind, tab: g.tab, op: "revoke", sids: g.sids });
      if (!r.ok) return setErr(r.error || "회수 실패");
    }
    setChk({});
    onDone(picked.length);
  };
  return (
    <Popup open={open} title="➖ 권한 회수" onClose={onClose}>
      {!rows.length ? (
        <Info>부여된 권한이 없습니다.</Info>
      ) : (
        <>
          <div className="tbl-wrap">
            <div className="tbl-scroll" style={{ maxHeight: 380 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: "3.2rem" }}>
                      <Checkbox label="" checked={all} onChange={(v) => setChk(v ? Object.fromEntries(rows.map((r) => [r.key, true])) : {})} />
                    </th>
                    <th>번호</th>
                    <th>이름</th>
                    <th>부여된 권한</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} onClick={() => setChk((c) => ({ ...c, [r.key]: !c[r.key] }))} style={{ cursor: "pointer" }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Checkbox label="" checked={!!chk[r.key]} onChange={(v) => setChk((c) => ({ ...c, [r.key]: v }))} />
                      </td>
                      <td>{r.no}</td>
                      <td>{r.name}</td>
                      <td>{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Cols w={[3, 1]} va="center">
            <div className="caption">{`맨 위 체크칸을 누르면 전체 선택 · ${Object.values(chk).filter(Boolean).length}개 선택됨`}</div>
            <Btn onClick={run}>➖ 체크한 권한 회수</Btn>
          </Cols>
        </>
      )}
      <ErrorBox>{err}</ErrorBox>
    </Popup>
  );
}

export default function Permissions() {
  const app = useApp();
  const { data, error, reload } = useLoad("perm_load", {}, [app.ver]);
  const [opt, setOpt] = useState("💰입금/출금(관리자)");
  const [sel, setSel] = useState([]);
  const [revokeOpen, setRevokeOpen] = useState(false);
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
      <Cols w={[2, 2.6, 1, 1]} va="bottom">
        <Select label="부여할 항목 선택" value={opt} options={options.map((o) => o[0])} onChange={setOpt} />
        <MultiSelect label="대상 학생 선택(복수 선택 가능)" value={sel} options={Object.keys(byLabel)} onChange={setSel} />
        <Btn onClick={() => apply("grant")}>➕ 권한 부여</Btn>
        <Btn onClick={() => setRevokeOpen(true)}>➖ 권한 회수</Btn>
      </Cols>
      <Msg m={msg} />
      <RevokePopup
        data={data}
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onDone={(n) => {
          setRevokeOpen(false);
          app.toast(`권한 회수 완료! (${n}개)`, "✅");
          reload();
        }}
      />

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
