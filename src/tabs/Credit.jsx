// 💳 신용등급
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, Btn, Select, NumberInput, Info, Expander, DataTable, Loading } from "../components/ui.jsx";
import { LedgerGrid } from "./Stats.jsx";

function scoreToGrade(s) {
  s = parseInt(s, 10) || 0;
  if (s >= 90) return 1;
  if (s >= 80) return 2;
  if (s >= 70) return 3;
  if (s >= 60) return 4;
  if (s >= 50) return 5;
  if (s >= 40) return 6;
  if (s >= 30) return 7;
  if (s >= 20) return 8;
  if (s >= 10) return 9;
  return 10;
}

const norm = (v) => {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "O" || s === "○") return "O";
  if (s === "△" || s === "▲" || s === "Δ") return "△";
  return "X";
};

export function CreditBand() {
  return (
    <div className="credit-band">
      <table>
        <tbody>
          <tr>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((g) => (
              <th key={g}>{g}등급</th>
            ))}
          </tr>
          <tr>
            {["90이상", "80-89", "70-79", "60-69", "50-59", "40-49", "30-39", "20-29", "10-19", "0-9"].map((t) => (
              <td key={t}>{t}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CfgBox({ cfg, onSaved }) {
  const app = useApp();
  const [f, setF] = useState(cfg);
  useEffect(() => setF(cfg), [cfg]);
  const save = async () => {
    const r = await api("credit_cfg_save", f);
    if (r.ok) {
      app.toast("설정 저장 완료!", "✅");
      onSaved();
    }
  };
  return (
    <Expander title="⚙️ 점수 계산 설정(O/X/△ 점수 변경)">
      <Cols w={[1.1, 1, 1, 1, 1.2]} va="bottom">
        <NumberInput label="초기 점수" min={0} max={100} value={f.base} onChange={(v) => setF((x) => ({ ...x, base: v }))} />
        <NumberInput label="O 일 때" value={f.o} onChange={(v) => setF((x) => ({ ...x, o: v }))} />
        <NumberInput label="X 일 때" value={f.x} onChange={(v) => setF((x) => ({ ...x, x: v }))} />
        <NumberInput label="△ 일 때" value={f.tri} onChange={(v) => setF((x) => ({ ...x, tri: v }))} />
        <Btn onClick={save}>✅ 설정 저장</Btn>
      </Cols>
    </Expander>
  );
}

function ManualAdjust({ students, onSaved }) {
  const app = useApp();
  const [idx, setIdx] = useState(0);
  const [sign, setSign] = useState("+");
  const [pts, setPts] = useState(1);
  const save = async () => {
    const t = students[idx];
    if (!t) return;
    const r = await api("credit_adjust", { student_id: t.student_id, sign, pts });
    if (r.ok) {
      app.toast(`신용점수 조정 저장 완료 (${r.signed >= 0 ? "+" : ""}${r.signed}점)`, "✅");
      onSaved();
    }
  };
  return (
    <Cols w={[1.8, 1, 1, 1.1]} va="bottom">
      <Select label="학생 선택" value={idx} options={students.map((s, i) => ({ value: i, label: `${s.no}번 ${s.name}` }))} onChange={setIdx} />
      <Select label="점수 +/-" value={sign} options={["+", "-"]} onChange={setSign} />
      <NumberInput label="점수" min={1} max={100} value={pts} onChange={setPts} />
      <Btn onClick={save}>저장</Btn>
    </Cols>
  );
}

export default function Credit() {
  const app = useApp();
  const { data, error, reload } = useLoad("credit_load", {}, [app.ver]);
  if (error) return <Info>{error}</Info>;
  if (!data) return <Loading />;
  const { cfg } = data;
  const students = data.students || [];
  const subs = data.subs || [];

  // 누적 점수 (과거→최신)
  const scoresBy = {};
  const cur = Object.fromEntries(students.map((s) => [s.student_id, cfg.base]));
  const delta = (v) => (norm(v) === "O" ? cfg.o : norm(v) === "△" ? cfg.tri : cfg.x);
  for (let i = subs.length - 1; i >= 0; i--) {
    const s = subs[i];
    const snap = {};
    for (const st of students) {
      let nxt = (cur[st.student_id] ?? cfg.base) + delta(s.statuses[st.student_id] ?? "X");
      if (nxt > 100) nxt = 100;
      if (nxt < 0) nxt = 0;
      cur[st.student_id] = nxt;
      snap[st.student_id] = nxt;
    }
    scoresBy[s.submission_id] = snap;
  }
  const scoreAt = (sid, stid) => {
    let sc = scoresBy[sid] ? scoresBy[sid][stid] ?? cfg.base : cfg.base;
    sc += (data.manual || {})[stid] || 0;
    return Math.max(0, Math.min(100, sc));
  };
  const avgAt = (sid) => {
    const sum = students.reduce((acc, st) => acc + scoreAt(sid, st.student_id), 0);
    return students.length ? Math.round((sum / students.length) * 100) / 100 : 0;
  };

  return (
    <>
      {!students.length ? <Info>활성화된 학생(계정)이 없습니다.</Info> : null}
      <H3>📏 신용등급 점수 설정</H3>
      <CfgBox cfg={cfg} onSaved={reload} />
      {students.length > 0 && !subs.length ? <Info>통계청 제출물 내역이 없습니다. 먼저 통계청 탭에서 제출물을 추가하세요.</Info> : null}
      {students.length > 0 && subs.length > 0 ? (
        <>
          <H3>🌟 신용등급 관리 장부</H3>
          <LedgerGrid
            subs={subs}
            rows={[
              ...students.map((st) => ({
                key: st.student_id,
                no: st.no,
                name: st.name,
                cell: (s) => {
                  const sc = scoreAt(s.submission_id, st.student_id);
                  return <span className="credit-ledger-score">{sc}점/{scoreToGrade(sc)}등급</span>;
                },
              })),
              { key: "_avg", no: "", name: "평균", className: "lg-avg", cell: (s) => <span className="credit-ledger-score">{avgAt(s.submission_id).toFixed(2)}점</span> },
            ]}
          />
          <H3>📌 신용등급 구분표</H3>
          <CreditBand />
        </>
      ) : null}
      <H3>✍️ 신용점수 수동 조정</H3>
      {!students.length ? <Info>활성 학생이 없어 신용점수 수동 조정을 할 수 없습니다.</Info> : <ManualAdjust students={students} onSaved={() => app.refresh()} />}
      <H3>📒 신용점수 조정 장부</H3>
      {(data.adjustments || []).length ? <DataTable rows={data.adjustments} columns={["일시", "대상", "점수기록", "기록자"]} csvName="신용조정장부" /> : <Info>아직 수동 조정 장부가 없습니다.</Info>}
    </>
  );
}
