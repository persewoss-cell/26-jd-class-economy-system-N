// 📊 통계청 (제출물 O/X/△ 관리) — 클릭은 화면에서만 바뀌고 [✅ 저장]을 눌러야 DB 반영
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, Btn, TextInput, Select, NumberInput, Checkbox, Info, Warning, ErrorBox, SectionDivider, Loading, TplEditor } from "../components/ui.jsx";

export function OX({ value, onPick, disabled }) {
  return (
    <div className={`ox ${disabled ? "disabled" : ""}`}>
      {["O", "X", "△"].map((v, i) => (
        <span key={v} className={`o v${i} ${value === v ? `on v-${v === "△" ? "T" : v}` : ""}`} onClick={() => !disabled && onPick && onPick(v)}>
          {v}
        </span>
      ))}
    </div>
  );
}

// 번호·이름은 고정하고 제출물 열은 옆으로 밀어서 보는 장부 (최신 제출물이 왼쪽)
// rows: [{ key, no, name, cell: (제출물) => 내용, className }]
export function LedgerGrid({ subs, rows, colWidth = "7.5rem" }) {
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th className="lg-no">번호</th>
            <th className="lg-name">이름</th>
            {subs.map((s) => (
              <th key={s.submission_id} className="stat-hdr" style={{ minWidth: colWidth }}>
                {s.date_display}
                <br />
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.className || ""}>
              <td className="lg-no">{r.no}</td>
              <td className="lg-name">{r.name}</td>
              {subs.map((s) => (
                <td key={s.submission_id}>{r.cell(s)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddSubmission({ templates, onAdded }) {
  const app = useApp();
  const [tpl, setTpl] = useState("(직접 입력)");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");
  const save = async () => {
    setErr("");
    if (!label.trim()) return setErr("내역을 입력해 주세요.");
    const r = await api("stat_add", { label: label.trim() });
    if (r.ok) {
      setTpl("(직접 입력)");
      setLabel("");
      app.toast("제출물 내역 추가 완료!", "✅");
      onAdded();
    } else setErr(r.error || "추가 실패");
  };
  return (
    <>
      <H3>➕ 제출물 내역 추가</H3>
      <Select
        label="제출물 템플릿"
        value={tpl}
        options={["(직접 입력)", ...templates.map((t) => t.label)]}
        onChange={(v) => {
          setTpl(v);
          if (v !== "(직접 입력)") setLabel(v);
        }}
      />
      <Cols w={[3.0, 1.0]} va="bottom">
        <TextInput label="내역" value={label} onChange={setLabel} />
        <Btn onClick={save}>저장</Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

function StatTemplates({ templates, reload }) {
  return (
    <>
      <SectionDivider />
      <H3>🧩 통계표 템플릿 추가/수정/삭제</H3>
      <TplEditor
        items={templates}
        itemLabel={(t) => `${t.order} | ${t.label}`}
        blank={() => ({ label: "", order: Math.max(1, templates.length + 1) })}
        fromItem={(t) => ({ label: t.label, order: t.order || 1 })}
        widths={[4, 0.9]}
        fields={(f, set) => [
          <TextInput key="l" label="템플릿 내역" value={f.label} onChange={(v) => set({ label: v })} />,
          <NumberInput key="o" label="순서" min={1} stepper={false} value={f.order} onChange={(v) => set({ order: v })} />,
        ]}
        onSave={(f, edit) => api("stat_tpl_save", { template_id: edit ? edit.template_id : "", label: f.label.trim(), order: f.order })}
        onDelete={(t) => api("stat_tpl_delete", { template_id: t.template_id })}
        saveToast="템플릿 저장 완료!"
        deleteToast="템플릿 삭제 완료!"
        reload={reload}
      />
    </>
  );
}

export default function Stats() {
  const app = useApp();
  const { data, error, reload } = useLoad("stats_load", {}, [app.ver]);
  const [edit, setEdit] = useState({});
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetPin, setResetPin] = useState("");
  const [delConfirm, setDelConfirm] = useState(false);
  const [delChecks, setDelChecks] = useState({});
  const [bulkPick, setBulkPick] = useState({});
  const [err, setErr] = useState("");

  // 제출물/학생 목록이 바뀔 때만 화면 편집값을 DB값으로 다시 맞춤
  const sig = data ? `${data.subs.map((s) => s.submission_id).join(",")}||${data.students.map((s) => s.student_id).join(",")}` : "";
  const dataKey = data ? JSON.stringify(data.subs.map((s) => [s.submission_id, s.statuses])) : "";
  useEffect(() => {
    if (!data) return;
    const e = {};
    for (const s of data.subs) {
      e[s.submission_id] = {};
      for (const st of data.students) {
        const v = String(s.statuses[st.student_id] || "X");
        e[s.submission_id][st.student_id] = ["X", "O", "△"].includes(v) ? v : "X";
      }
    }
    setEdit(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, dataKey]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const { subs, students, templates } = data;

  const save = async () => {
    setErr("");
    const r = await api("stat_save", { edited: edit });
    if (r.ok) {
      app.toast(`저장 완료! (${r.count}개 제출물 반영)`, "✅");
      reload();
    } else setErr(r.error || "저장 실패");
  };
  const doReset = async () => {
    setErr("");
    const r = await api("stat_delete", { reset: true, admin_pin: resetPin });
    if (!r.ok) return setErr(r.error);
    if (r.n > 0) app.toast(`초기화 완료! (${r.n}개 삭제)`, "🧹");
    setResetConfirm(false);
    setDelConfirm(false);
    setResetPin("");
    reload();
  };
  const doDelete = async () => {
    setErr("");
    const ids = Object.keys(delChecks).filter((k) => delChecks[k]);
    if (!ids.length) return setErr("삭제할 항목을 하나 이상 체크해 주세요.");
    const r = await api("stat_delete", { ids });
    if (!r.ok) return setErr(r.error);
    if (r.n > 0) app.toast(`삭제 완료! (${r.n}개)`, "🗑️");
    setDelConfirm(false);
    setDelChecks({});
    reload();
  };
  const setAll = (sid, v) => setEdit((e) => ({ ...e, [sid]: Object.fromEntries(students.map((s) => [s.student_id, v])) }));

  return (
    <>
      <AddSubmission templates={templates} onAdded={reload} />
      <H3>📋 통계 관리 장부</H3>
      <Cols w={[4, 3]} gap="small" va="center">
        <div className="caption">{subs.length ? `제출물 ${subs.length}개 · 표를 옆으로 밀어서 지난 제출물을 볼 수 있어요` : ""}</div>
        <Cols w={[1, 1, 1]} gap="small">
          <Btn onClick={save}>✅ 저장</Btn>
          <Btn onClick={() => setResetConfirm(true)}>🧹 초기화</Btn>
          <Btn onClick={() => setDelConfirm(true)}>🗑️ 삭제</Btn>
        </Cols>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
      {!subs.length ? (
        <Info>제출물 내역이 없습니다. 위에서 ‘제출물 내역 추가’를 먼저 해주세요.</Info>
      ) : (
        <>
          {resetConfirm ? (
            <>
              <ErrorBox>⚠️ 초기화하면 모든 제출물 내역(열)이 전부 삭제됩니다. 진행할까요?</ErrorBox>
              <TextInput label="관리자 비밀번호 입력" type="password" value={resetPin} onChange={setResetPin} />
              <Cols w={2}>
                <Btn onClick={doReset}>예(전체 삭제)</Btn>
                <Btn
                  onClick={() => {
                    setResetConfirm(false);
                    setResetPin("");
                  }}
                >
                  아니오
                </Btn>
              </Cols>
            </>
          ) : null}
          {delConfirm ? (
            <>
              <Warning>삭제할 제출물을 체크하세요. (여러 개 선택 가능)</Warning>
              {subs.map((s) => (
                <Checkbox key={s.submission_id} label={`${s.date_display} | ${s.label}`} checked={!!delChecks[s.submission_id]} onChange={(v) => setDelChecks((c) => ({ ...c, [s.submission_id]: v }))} />
              ))}
              <Cols w={2}>
                <Btn onClick={doDelete}>예</Btn>
                <Btn onClick={() => setDelConfirm(false)}>아니오</Btn>
              </Cols>
            </>
          ) : null}

          <LedgerGrid
            subs={subs}
            rows={[
              {
                key: "_bulk",
                no: "⚡",
                name: "일괄",
                className: "lg-bulk",
                cell: (s) => (
                  <OX
                    value={bulkPick[s.submission_id] || "X"}
                    onPick={(v) => {
                      setBulkPick((b) => ({ ...b, [s.submission_id]: v }));
                      setAll(s.submission_id, v);
                    }}
                  />
                ),
              },
              ...students.map((st) => ({
                key: st.student_id,
                no: st.no,
                name: st.name,
                cell: (s) => (
                  <OX
                    value={(edit[s.submission_id] || {})[st.student_id] || "X"}
                    onPick={(v) => setEdit((e) => ({ ...e, [s.submission_id]: { ...(e[s.submission_id] || {}), [st.student_id]: v } }))}
                  />
                ),
              })),
            ]}
          />
        </>
      )}
      <StatTemplates templates={templates} reload={reload} />
    </>
  );
}
