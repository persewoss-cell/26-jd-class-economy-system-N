// (학생) 📊 통계/신용 — 읽기 전용
import React from "react";
import { useApp, useLoad, H3, Info, Divider, ErrorBox, Loading } from "../components/ui.jsx";
import { OX, LedgerGrid } from "./Stats.jsx";

export default function UserStatsCredit() {
  const app = useApp();
  const { data, error } = useLoad("user_stats_credit", {}, [app.ver]);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const subs = data.subs;
  const no = data.me.no || "-";
  const nm = data.me.name || "-";
  return (
    <>
      <H3>📋 통계표(내 기록)</H3>
      {!subs.length ? (
        <Info>아직 제출물 내역이 없어요.</Info>
      ) : (
        <LedgerGrid subs={subs} rows={[{ key: "me", no, name: nm, val: (s) => s.status, cell: (s) => <OX value={s.status} disabled /> }]} />
      )}
      <Divider />
      <H3>💳 신용등급 변동표(내 기록)</H3>
      {!subs.length ? (
        <Info>표시할 기록이 없어요.</Info>
      ) : (
        <LedgerGrid subs={subs} rows={[{ key: "me", no, name: nm, val: (s) => s.score, cell: (s) => <span className="credit-ledger-score">{s.score}점/{s.grade}등급</span> }]} />
      )}
    </>
  );
}
