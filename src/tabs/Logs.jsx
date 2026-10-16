// 🧾 로그기록 (통합)
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, H3, Btn, NumberInput, TextInput, Info, ErrorBox, Loading, ConfirmModal, useSort, SortTh, toCsv, cellText } from "../components/ui.jsx";

const COLS = ["번호", "시간", "대상", "탭", "내역", "입금", "출금", "기록자", "분류", "변경후잔액"];

// 로그 표: 함께 일어난 기록끼리 연한 회색/흰색으로 번갈아 묶고, 묶음마다 되돌리기 아이콘 하나
function LogTable({ rows, allRows, onUndo }) {
  const srt = useSort(rows, (r, c) => (c === "시간" ? r._ts : r[c])); // 시간은 실제 시각으로 정렬
  const sorted = srt.sort.col !== null;
  const shade = {};
  let k = 0;
  let prev = null;
  for (const r of rows) {
    if (r._g !== prev) {
      k += 1;
      prev = r._g;
    }
    if (!(r._g in shade)) shade[r._g] = k % 2 === 0;
  }
  // 정렬 안 했을 때: 묶음의 첫 줄에만 아이콘 칸(여러 줄 합침)
  const span = {};
  if (!sorted) {
    for (let i = 0; i < rows.length; ) {
      let j = i;
      while (j + 1 < rows.length && rows[j + 1]._g === rows[i]._g) j += 1;
      span[i] = j - i + 1;
      i = j + 1;
    }
  }
  const download = () => {
    const blob = new Blob(["\ufeff" + toCsv(COLS, srt.sorted)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "통합로그.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const cell = (r) => {
    if (r._undo === "ok") {
      return (
        <button type="button" className="icon-btn undo-btn" title="이 묶음 되돌리기" aria-label="되돌리기" onClick={() => onUndo(allRows.filter((x) => x._g === r._g))}>
          ↩️
        </button>
      );
    }
    if (String(r._undo).startsWith("x:")) {
      return (
        <span className="undo-no" title={`되돌릴 수 없음: ${r._undo.slice(2)}`}>
          –
        </span>
      );
    }
    return null;
  };
  return (
    <div className="tbl-wrap" style={{ marginTop: "2.1rem" }}>
      <div className="tbl-tools">
        <span className="tool-note">
          <span className="icon-btn undo-btn sample">↩️</span> 되돌리기: 함께 일어난 기록을 모두 지우고 원래대로
        </span>
        <button type="button" onClick={download} title="CSV로 내려받기">
          ⬇ CSV
        </button>
      </div>
      <div className="tbl-scroll">
        <table className="tbl log-tbl">
          <thead>
            <tr>
              {COLS.map((c) => (
                <SortTh key={c} label={c} col={c} s={srt} />
              ))}
              <th className="undo-h">되돌리기</th>
            </tr>
          </thead>
          <tbody>
            {srt.sorted.map((r, i) => (
              <tr key={`${r._g}-${i}`} className={shade[r._g] ? "grp-shade" : ""}>
                {COLS.map((c, j) => (
                  <td key={c} className={`${typeof r[c] === "number" ? "num-cell" : ""} ${j < 2 ? `c${j}` : ""}`}>
                    {cellText(r[c])}
                  </td>
                ))}
                {sorted ? (
                  <td className="undo-cell">{cell(r)}</td>
                ) : span[i] ? (
                  <td className="undo-cell" rowSpan={span[i]}>
                    {cell(r)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Logs() {
  const app = useApp();
  const isAdmin = app.user && app.user.role === "admin";
  const allowed = isAdmin || (app.user && (app.user.perms || []).includes("tab::🧾 로그기록"));
  const [maxRows, setMaxRows] = useState(200);
  const [rows, setRows] = useState(null);
  const [kw, setKw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [undoRows, setUndoRows] = useState(null);
  const [pin, setPin] = useState("");
  const [undoErr, setUndoErr] = useState("");

  const seq = useRef(0);
  const load = async (n) => {
    const my = ++seq.current;
    setLoading(true);
    setErr("");
    const r = await api("logs_load", { max_rows: n });
    if (my !== seq.current) return; // 더 나중 요청의 결과만 화면에 반영
    setLoading(false);
    if (r.ok) setRows(r.rows);
    else setErr(r.error);
  };
  useEffect(() => {
    if (allowed) load(maxRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxRows]);

  if (!allowed) return <Info>이 탭은 관리자 전용입니다.</Info>;
  const k = kw.trim().toLowerCase();
  const filtered = (rows || []).filter((r) => !k || [r.탭, r.내역, r.기록자, r.대상].some((v) => String(v ?? "").toLowerCase().includes(k)));
  const view = filtered.map((r, i) => ({ 번호: i + 1, ...r }));
  return (
    <>
      <H3>🧾 통합 로그기록</H3>
      <Btn onClick={() => load(maxRows)}>로그 새로고침</Btn>
      <NumberInput label="표시 행 수" min={100} max={10000} step={100} value={maxRows} onChange={setMaxRows} />
      <ErrorBox>{err}</ErrorBox>
      {loading && !rows ? <Loading /> : null}
      {rows && !rows.length ? <Info>표시할 로그가 없습니다.</Info> : null}
      {rows && rows.length ? (
        <>
          <TextInput label="검색(탭/내역/기록자/대상)" value={kw} onChange={setKw} />
          <LogTable rows={view} allRows={rows} onUndo={(g) => { setUndoRows(g); setPin(""); setUndoErr(""); }} />
        </>
      ) : null}
      <ConfirmModal
        open={!!undoRows}
        wide
        title="↩️ 묶음 되돌리기"
        message={undoRows ? `아래 ${undoRows.length}개 기록을 모두 지우고 원래대로 되돌릴까요?` : ""}
        yesText="되돌리기"
        onYes={async () => {
          setUndoErr("");
          if (!pin.trim()) return setUndoErr("관리자 비밀번호를 입력해 주세요.");
          const r = await api("log_undo", { refs: undoRows.map((x) => x._ref).filter(Boolean), admin_pin: pin });
          if (!r.ok) return setUndoErr(r.error || "되돌리기 실패");
          setUndoRows(null);
          app.toast(`되돌리기 완료 (학생 기록 ${r.students}건${r.treasury ? ` · 국고 ${r.treasury}건` : ""})`, "↩️");
          app.refresh();
          load(maxRows);
        }}
        onNo={() => setUndoRows(null)}
      >
        {undoRows ? (
          <div className="undo-list">
            {undoRows.map((x, i) => (
              <div key={i}>{`${x.시간} · ${x.탭} · ${x.대상} · ${x.내역}${x.입금 ? ` +${x.입금}` : ""}${x.출금 ? ` -${x.출금}` : ""}`}</div>
            ))}
          </div>
        ) : null}
        <TextInput label="관리자 비밀번호" type="password" value={pin} onChange={setPin} />
        <ErrorBox>{undoErr}</ErrorBox>
      </ConfirmModal>
    </>
  );
}
