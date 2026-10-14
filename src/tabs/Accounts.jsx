// 👥 계정 정보 (관리자 전용)
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, H4, Btn, Warning, ErrorBox, Loading, ExcelBar, ConfirmModal, useSort, SortTh } from "../components/ui.jsx";

export default function Accounts() {
  const app = useApp();
  const { data, error } = useLoad("acc_load", {}, [app.ver]);
  const [file, setFile] = useState(null);
  const [upMsg, setUpMsg] = useState(null);
  const [rows, setRows] = useState([]);
  const [delTargets, setDelTargets] = useState(null);
  const [warn, setWarn] = useState("");
  const [saveMsg, setSaveMsg] = useState(null);
  const srt = useSort(rows, (r, c) => (c === "no" && Number(r.no) === 999999 ? "" : r[c]));

  useEffect(() => {
    if (data) setRows(data.rows.map((r) => ({ ...r, sel: false, _orig: { no: r.no, name: r.name, pin: r.pin } })));
  }, [data]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;

  const COLS = ["번호", "이름", "비밀번호"];
  const current = [...data.rows].map((r) => ({ 번호: r.no === 999999 ? 0 : r.no, 이름: r.name.trim(), 비밀번호: r.pin.trim() }));

  const runBulk = async () => {
    setUpMsg(null);
    if (!file) return setUpMsg(["warning", "엑셀 파일을 업로드하세요."]);
    try {
      const { columns, rows: xr } = await readExcel(file);
      if (!COLS.every((c) => columns.includes(c))) return setUpMsg(["error", "엑셀 컬럼이 부족합니다. 최소: 번호, 이름, 비밀번호"]);
      const r = await api("acc_bulk", { rows: xr });
      if (!r.ok) return setUpMsg(["error", `엑셀 처리 실패: ${r.error}`]);
      app.toast(`엑셀 등록 완료 (신규 ${r.created} / 수정 ${r.updated} / 제외 ${r.skipped})`, "📥");
      setFile(null);
      app.refresh();
    } catch (e) {
      setUpMsg(["error", `엑셀 처리 실패: ${e.message || e}`]);
    }
  };

  const doDelete = async () => {
    const r = await api("acc_delete", { sids: delTargets });
    setDelTargets(null);
    if (r.ok) {
      app.toast("삭제 완료", "🗑️");
      app.refresh();
    }
  };

  const changed = rows.filter((r) => String(r.no) !== String(r._orig.no) || r.name !== r._orig.name || r.pin !== r._orig.pin);
  const saveEdits = async () => {
    setSaveMsg(null);
    if (!changed.length) return setSaveMsg(["warning", "변경된 내용이 없습니다."]);
    const r = await api("acc_save_edits", { rows: changed.map((x) => ({ sid: x.sid, no: x.no, name: x.name, pin: x.pin })) });
    if (!r.ok) return setSaveMsg(["error", r.error]);
    if (r.changed) app.toast(`계정 정보 저장 완료 (${r.changed}명)`, "💾");
    if (r.errors && r.errors.length) setSaveMsg(["error", r.errors.join("\n")]);
    app.refresh();
  };

  const tableH = Math.min(900, Math.max(420, (rows.length + 2) * 35));
  const setCell = (sid, k, v) => setRows((rs) => rs.map((r) => (r.sid === sid ? { ...r, [k]: v } : r)));

  return (
    <>
      <H3>📥 일괄 엑셀 계정 추가</H3>
      <ExcelBar
        downloads={[
          ["📄 샘플 엑셀", () => downloadExcel("accounts_sample.xlsx", [{ name: "accounts", columns: COLS, rows: [{ 번호: 1, 이름: "홍길동", 비밀번호: "12a#" }, { 번호: 2, 이름: "김철수", 비밀번호: "ab@9" }] }])],
          ["📄 현재 계정 정보 엑셀", () => downloadExcel("accounts_current.xlsx", [{ name: "accounts", columns: COLS, rows: current }])],
        ]}
        file={file}
        onFile={setFile}
        onSave={runBulk}
        saveText="✅ 엑셀 일괄 등록"
      >
        {upMsg ? upMsg[0] === "warning" ? <Warning>{upMsg[1]}</Warning> : <ErrorBox>{upMsg[1]}</ErrorBox> : null}
      </ExcelBar>

      <H4>👥 계정/비번 관리</H4>
      <Cols w={4}>
        <Btn onClick={() => setRows((rs) => rs.map((r) => ({ ...r, sel: true })))}>✅ 전체 선택</Btn>
        <Btn onClick={() => setRows((rs) => rs.map((r) => ({ ...r, sel: false })))}>⬜ 전체 해제</Btn>
        <Btn
          onClick={() => {
            setWarn("");
            const sel = rows.filter((r) => r.sel);
            if (!sel.length) return setWarn("삭제할 계정을 체크하세요.");
            setDelTargets(sel.map((r) => r.sid));
          }}
        >
          🗑️ 계정 삭제(선택)
        </Btn>
        <Btn onClick={saveEdits} disabled={!changed.length}>
          💾 변경 저장{changed.length ? ` (${changed.length}명)` : ""}
        </Btn>
      </Cols>
      {warn ? <Warning>{warn}</Warning> : null}
      <ConfirmModal open={!!delTargets} title="🗑️ 계정 삭제" message={`선택한 ${delTargets ? delTargets.length : 0}명의 계정을 삭제할까요?`} onYes={doDelete} onNo={() => setDelTargets(null)} />
      {saveMsg ? saveMsg[0] === "warning" ? <Warning>{saveMsg[1]}</Warning> : <ErrorBox>{saveMsg[1]}</ErrorBox> : null}
      <div className="tbl-wrap">
        <div className="tbl-scroll" style={{ maxHeight: tableH }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>선택</th>
                <SortTh label="번호" col="no" s={srt} />
                <SortTh label="이름" col="name" s={srt} />
                <SortTh label="비밀번호" col="pin" s={srt} />
              </tr>
            </thead>
            <tbody>
              {srt.sorted.map((r) => (
                <tr key={r.sid}>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={r.sel} onChange={(e) => setCell(r.sid, "sel", e.target.checked)} style={{ width: 18, height: 18 }} />
                  </td>
                  <td>
                    <input className="cell-in" style={{ textAlign: "center" }} value={r.no} inputMode="numeric" onChange={(e) => setCell(r.sid, "no", e.target.value.replace(/[^\d-]/g, ""))} />
                  </td>
                  <td>
                    <input className="cell-in" style={{ textAlign: "center" }} value={r.name} onChange={(e) => setCell(r.sid, "name", e.target.value)} />
                  </td>
                  <td>
                    <input className="cell-in" value={r.pin} onChange={(e) => setCell(r.sid, "pin", e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
