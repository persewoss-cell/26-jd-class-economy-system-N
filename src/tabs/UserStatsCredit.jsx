// (학생) 📊 통계/신용 — 읽기 전용
import React, { useState } from "react";
import { useApp, useLoad, Cols, H3, Info, Divider, ErrorBox, Loading } from "../components/ui.jsx";
import { OX, PageNav, VISIBLE_COLS } from "./Stats.jsx";

export default function UserStatsCredit() {
  const app = useApp();
  const { data, error } = useLoad("user_stats_credit", {}, [app.ver]);
  const [p1, setP1] = useState(1);
  const [p2, setP2] = useState(1);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const subs = data.subs;
  const total = Math.max(1, Math.ceil(subs.length / VISIBLE_COLS));
  const a = Math.min(p1, total);
  const b = Math.min(p2, total);
  const v1 = subs.slice((a - 1) * VISIBLE_COLS, a * VISIBLE_COLS);
  const v2 = subs.slice((b - 1) * VISIBLE_COLS, b * VISIBLE_COLS);
  const no = data.me.no || "-";
  const nm = data.me.name || "-";
  return (
    <>
      <H3>📋 통계표(내 기록)</H3>
      {!subs.length ? (
        <Info>아직 제출물 내역이 없어요.</Info>
      ) : (
        <>
          <PageNav page={a} total={total} onPage={(x) => setP1(Math.max(1, Math.min(total, x)))} />
          <Cols w={[0.37, 0.7, ...v1.map(() => 1.2)]} va="center">
            <b>번호</b>
            <b>이름</b>
            {v1.map((s) => (
              <div className="stat-hdr" key={s.submission_id}>
                {s.date_display}
                <br />
                {s.label}
              </div>
            ))}
          </Cols>
          <Cols w={[0.37, 0.7, ...v1.map(() => 1.2)]} va="center">
            <div>{no}</div>
            <div>{nm}</div>
            {v1.map((s) => (
              <OX key={s.submission_id} value={s.status} disabled />
            ))}
          </Cols>
        </>
      )}
      <Divider />
      <H3>💳 신용등급 변동표(내 기록)</H3>
      {!subs.length ? (
        <Info>표시할 기록이 없어요.</Info>
      ) : (
        <>
          <PageNav page={b} total={total} onPage={(x) => setP2(Math.max(1, Math.min(total, x)))} />
          <Cols w={[0.55, 1.2, ...v2.map(() => 1.9)]} va="center">
            <b>번호</b>
            <b>이름</b>
            {v2.map((s) => (
              <div key={s.submission_id} style={{ textAlign: "center", fontWeight: 900, lineHeight: 1.15 }}>
                {s.date_display}
                <br />
                {s.label}
              </div>
            ))}
          </Cols>
          <Cols w={[0.55, 1.2, ...v2.map(() => 1.9)]} va="center">
            <div>{no}</div>
            <div>{nm}</div>
            {v2.map((s) => (
              <div key={s.submission_id} style={{ textAlign: "center", fontWeight: 900 }}>
                {s.score}점/{s.grade}등급
              </div>
            ))}
          </Cols>
        </>
      )}
    </>
  );
}
