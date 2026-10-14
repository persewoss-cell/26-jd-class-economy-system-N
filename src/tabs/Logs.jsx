// 🧾 로그기록 (통합)
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, H3, Btn, NumberInput, TextInput, Info, ErrorBox, DataTable, Loading } from "../components/ui.jsx";

const COLS = ["번호", "시간", "대상", "탭", "내역", "입금", "출금", "기록자", "분류", "변경후잔액"];

export default function Logs() {
  const app = useApp();
  const isAdmin = app.user && app.user.role === "admin";
  const allowed = isAdmin || (app.user && (app.user.perms || []).includes("tab::🧾 로그기록"));
  const [maxRows, setMaxRows] = useState(200);
  const [rows, setRows] = useState(null);
  const [kw, setKw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

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
          <DataTable rows={view} columns={COLS} csvName="통합로그" />
        </>
      ) : null}
    </>
  );
}
