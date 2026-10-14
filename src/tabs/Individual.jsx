// 🔎 개별조회
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import {
  useApp, useLoad, Cols, H3, H4, Caption, Btn, Checkbox, TextInput, Info, Warning, ErrorBox, Expander, DataTable, Loading,
} from "../components/ui.jsx";
import { TX_COLUMNS, txRowsView } from "../components/trade.jsx";

function oneLine(r) {
  const inv = String(r.inv_text || "").trim();
  const invPart = !inv || inv === "없음" ? "투자: 없음" : `투자: ${inv}`;
  return `👤 ${r.no}번 ${r.name} | 총 ${r.asset_total}드림 | 통장: ${r.balance}드림 | 적금: ${r.savings_total}드림 | ${invPart} | 직업: ${r.role_name || "없음"} | 신용: ${r.credit_grade}등급(${r.credit_score}점)`;
}

function canDelete(r) {
  const memo = String(r.memo || "");
  if (r.type === "rollback" || memo.includes("되돌리기")) return false;
  if (memo.includes("적금 가입") || memo.includes("적금 해지") || memo.includes("적금 만기") || r.type === "maturity") return false;
  const m = memo.trim();
  if (m.startsWith("투자 ") || m.includes("투자 매입") || m.includes("투자 회수")) return false;
  return true;
}

function StudentDetail({ sid, onChanged }) {
  const app = useApp();
  const txs = useLoad("tx_list", { sid, limit: 120 }, [sid]);
  const [delMode, setDelMode] = useState(false);
  const [pin, setPin] = useState("");
  const [checked, setChecked] = useState({});
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [fails, setFails] = useState([]);
  const rows = (txs.data && txs.data.rows) || [];
  const deletable = rows.filter(canDelete).map((r) => r.tx_id);
  const allOn = deletable.length > 0 && deletable.every((id) => checked[id]);

  const doDelete = async () => {
    setWarn("");
    setErr("");
    const ids = rows.filter((r) => checked[r.tx_id] && canDelete(r)).map((r) => r.tx_id);
    if (!ids.length) return setWarn("체크된 항목이 없어요.");
    const r = await api("tx_delete", { admin_pin: pin, sid, tx_ids: ids });
    if (r.ok) {
      let msg = `삭제 완료: ${r.deleted}건`;
      if (r.treasury_reversed) msg += ` / 국고환급 ${r.treasury_reversed}건`;
      app.toast(msg, "🗑️");
      setInfo(r.message || "");
      setFails(r.errors || []);
      setDelMode(false);
      setChecked({});
      txs.reload();
      onChanged && onChanged();
    } else setErr(r.error || "삭제 실패");
  };

  return (
    <>
      <H3>📒 통장내역</H3>
      {txs.loading && !txs.data ? <Loading /> : null}
      <ErrorBox>{txs.error ? txs.error || "내역을 불러오지 못했어요." : ""}</ErrorBox>
      {info ? <Info>{info}</Info> : null}
      {fails.length ? (
        <Expander title="일부 실패 상세">
          {fails.map((e) => (
            <div key={e}>- {e}</div>
          ))}
        </Expander>
      ) : null}
      {txs.data && !rows.length ? <Info>거래 내역이 없어요.</Info> : null}
      {rows.length ? (
        <>
          <Btn onClick={() => setDelMode((v) => !v)}>🗑️ 통장내역 삭제</Btn>
          {delMode ? (
            <>
              <H4>🗑️ 삭제할 내역 선택</H4>
              <Caption>체크한 내역을 완전히 삭제합니다(목록/총액에서 즉시 제외). 적금·투자·되돌리기 관련 내역은 삭제할 수 없어요. 삭제하는 내역이 월급 입금이면 국고에 반영됐던 공제 세입도 함께 환급됩니다.</Caption>
              <TextInput label="관리자 비밀번호(PIN)" type="password" value={pin} onChange={setPin} />
              <Btn onClick={doDelete}>선택 항목 삭제</Btn>
              <Checkbox
                label="전체 선택"
                checked={allOn}
                disabled={!deletable.length}
                onChange={(v) => {
                  const next = { ...checked };
                  deletable.forEach((id) => (next[id] = v));
                  setChecked(next);
                }}
              />
              {rows.map((r) => (
                <Checkbox
                  key={r.tx_id}
                  label={`${r.created_at_kr} | ${r.memo} | +${r.deposit} / -${r.withdraw}`}
                  checked={!!checked[r.tx_id]}
                  disabled={!canDelete(r)}
                  onChange={(v) => setChecked((c) => ({ ...c, [r.tx_id]: v }))}
                />
              ))}
              {warn ? <Warning>{warn}</Warning> : null}
              <ErrorBox>{err}</ErrorBox>
            </>
          ) : null}
          <DataTable rows={txRowsView(rows)} columns={TX_COLUMNS} csvName="통장내역" />
        </>
      ) : null}
    </>
  );
}

export default function Individual() {
  const app = useApp();
  const list = useLoad("individual_students", {}, [app.ver]);
  const [picks, setPicks] = useState({});
  const [mode, setMode] = useState("none");
  const [summ, setSumm] = useState([]);
  const [loadingSumm, setLoadingSumm] = useState(false);
  const rows = (list.data && list.data.rows) || [];
  const selected = rows.filter((r) => picks[r.student_id]);
  const label = (a) => (a.no > 0 && a.no !== 999999 ? `${a.no}번 ${a.name}` : a.name);
  const viewRows = mode === "all" ? rows : mode === "checked" ? selected : [];
  const viewKey = viewRows.map((r) => r.student_id).join(",");

  const loadSumm = async () => {
    if (!viewRows.length) {
      setSumm([]);
      return;
    }
    setLoadingSumm(true);
    const r = await api("individual_summaries", { sids: viewRows.map((x) => x.student_id) });
    setLoadingSumm(false);
    if (r.ok) setSumm(r.rows);
  };
  useEffect(() => {
    loadSumm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, app.ver]);

  if (list.error) return <ErrorBox>{list.error}</ErrorBox>;
  if (list.loading && !list.data) return <Loading />;
  if (!rows.length) return <Info>표시할 계정이 없습니다.</Info>;
  const chunks = [];
  for (let i = 0; i < rows.length; i += 5) chunks.push(rows.slice(i, i + 5));
  return (
    <>
      <H3>👥 대상 학생 선택</H3>
      {chunks.map((ch, i) => (
        <Cols w={5} key={i}>
          {[0, 1, 2, 3, 4].map((j) =>
            ch[j] ? (
              <Checkbox key={ch[j].student_id} label={label(ch[j])} checked={!!picks[ch[j].student_id]} onChange={(v) => setPicks((p) => ({ ...p, [ch[j].student_id]: v }))} />
            ) : (
              <span key={j} />
            )
          )}
        </Cols>
      ))}
      <Cols w={3}>
        <Btn onClick={() => setMode("checked")}>체크학생 조회</Btn>
        <Btn onClick={() => setMode("all")}>전체 조회</Btn>
        <Btn onClick={() => setMode("none")}>조회 접기</Btn>
      </Cols>
      {mode === "checked" && !selected.length ? <Warning>체크된 학생이 없습니다. 먼저 학생을 선택해 주세요.</Warning> : null}
      {!viewRows.length ? <Info>아래 조회 버튼을 눌러 학생 정보를 불러오세요.</Info> : null}
      {viewRows.length && loadingSumm && !summ.length ? <Loading /> : null}
      {viewRows.map((v) => {
        const s = summ.find((x) => x.student_id === v.student_id);
        if (!s) return null;
        return (
          <Expander key={v.student_id} title={oneLine(s)}>
            <StudentDetail sid={v.student_id} onChanged={loadSumm} />
          </Expander>
        );
      })}
    </>
  );
}
