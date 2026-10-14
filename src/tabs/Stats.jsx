// 📊 통계청 (제출물 O/X/△ 관리) — 클릭은 화면에서만 바뀌고 [✅ 저장]을 눌러야 DB 반영
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, Btn, TextInput, Select, NumberInput, Checkbox, Info, Warning, ErrorBox, SectionDivider, Loading } from "../components/ui.jsx";

export const VISIBLE_COLS = 7;

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

export function PageNav({ page, total, onPage, extra }) {
  return (
    <Cols w={extra ? [4, 3] : [1]} gap="small" va="center">
      <Cols w={[1, 1, 1, 1]} gap="small" va="center">
        <Btn onClick={() => onPage(page - 1)} disabled={page <= 1}>
          ◀
        </Btn>
        <NumberInput hideLabel label="페이지" min={1} max={total} value={page} onChange={(v) => onPage(v)} />
        <div style={{ textAlign: "center", fontWeight: 700 }}>/ 전체페이지 {total}</div>
        <Btn onClick={() => onPage(page + 1)} disabled={page >= total}>
          ▶
        </Btn>
      </Cols>
      {extra || null}
    </Cols>
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
  const app = useApp();
  const labels = ["(새로 추가)", ...templates.map((t) => `${t.order} | ${t.label}`)];
  const [pick, setPick] = useState("(새로 추가)");
  const [f, setF] = useState({ label: "", order: 1 });
  const [err, setErr] = useState("");
  const edit = pick === "(새로 추가)" ? null : templates[labels.indexOf(pick) - 1] || null;
  const onPick = (v) => {
    setPick(v);
    const t = v === "(새로 추가)" ? null : templates[labels.indexOf(v) - 1];
    setF(t ? { label: t.label, order: t.order || 1 } : { label: "", order: 1 });
  };
  const save = async () => {
    setErr("");
    const r = await api("stat_tpl_save", { template_id: edit ? edit.template_id : "", label: f.label.trim(), order: f.order });
    if (r.ok) {
      app.toast("템플릿 저장 완료!", "✅");
      onPick("(새로 추가)");
      reload();
    } else setErr(r.error || "저장 실패");
  };
  const del = async () => {
    if (!edit) return;
    const r = await api("stat_tpl_delete", { template_id: edit.template_id });
    if (r.ok) {
      app.toast("템플릿 삭제 완료!", "🗑️");
      onPick("(새로 추가)");
      reload();
    } else setErr(r.error || "삭제 실패");
  };
  return (
    <>
      <SectionDivider />
      <H3>🧩 통계표 템플릿 추가/수정/삭제</H3>
      <Select label="편집 대상" value={pick} options={labels} onChange={onPick} />
      <Cols w={[3.0, 1.0]}>
        <TextInput label="템플릿 내역" value={f.label} onChange={(v) => setF((x) => ({ ...x, label: v }))} />
        <NumberInput label="순서" min={1} value={f.order} onChange={(v) => setF((x) => ({ ...x, order: v }))} />
      </Cols>
      <Cols w={3}>
        <Btn onClick={save}>✅ 저장</Btn>
        <Btn onClick={() => onPick("(새로 추가)")}>🧹 입력 초기화</Btn>
        <Btn onClick={del} disabled={!edit}>
          🗑️ 삭제
        </Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

export default function Stats() {
  const app = useApp();
  const { data, error, reload } = useLoad("stats_load", {}, [app.ver]);
  const [edit, setEdit] = useState({});
  const [page, setPage] = useState(1);
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

  const total = data ? Math.max(1, Math.ceil(data.subs.length / VISIBLE_COLS)) : 1;
  useEffect(() => {
    if (page > total) setPage(total);
  }, [page, total]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const { subs, students, templates } = data;
  const view = subs.slice((page - 1) * VISIBLE_COLS, page * VISIBLE_COLS);
  const w = [0.37, 0.7, ...view.map(() => 1.2)];

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
      <PageNav
        page={page}
        total={total}
        onPage={(p) => setPage(Math.max(1, Math.min(total, p)))}
        extra={
          <Cols w={[1, 1, 1]} gap="small">
            <Btn onClick={save}>✅ 저장</Btn>
            <Btn onClick={() => setResetConfirm(true)}>🧹 초기화</Btn>
            <Btn onClick={() => setDelConfirm(true)}>🗑️ 삭제</Btn>
          </Cols>
        }
      />
      <ErrorBox>{err}</ErrorBox>
      {!subs.length ? (
        <Info>제출물 내역이 없습니다. 위에서 ‘제출물 내역 추가’를 먼저 해주세요.</Info>
      ) : (
        <>
          {resetConfirm ? (
            <>
              <ErrorBox>⚠️ 초기화하면 모든 제출물 내역(열)이 전부 삭제됩니다. 진행할까요?</ErrorBox>
              <TextInput label="관리자 비밀번호 입력" type="password" value={resetPin} onChange={setResetPin} help="관리자 비밀번호를 정확히 입력해야 초기화가 실행됩니다." />
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

          <Cols w={w} va="center">
            <b>번호</b>
            <b>이름</b>
            {view.map((s) => (
              <div className="stat-hdr" key={s.submission_id}>
                {s.date_display}
                <br />
                {s.label}
              </div>
            ))}
          </Cols>
          <Cols w={w} va="center">
            <b>일괄</b>
            <b>버튼⚡</b>
            {view.map((s) => (
              <OX
                key={s.submission_id}
                value={bulkPick[s.submission_id] || "X"}
                onPick={(v) => {
                  setBulkPick((b) => ({ ...b, [s.submission_id]: v }));
                  setAll(s.submission_id, v);
                }}
              />
            ))}
          </Cols>
          <div className="grid-sep" />
          {students.map((st, i) => (
            <React.Fragment key={st.student_id}>
              <Cols w={w} va="center">
                <div>{st.no}</div>
                <div>{st.name}</div>
                {view.map((s) => (
                  <OX
                    key={s.submission_id}
                    value={(edit[s.submission_id] || {})[st.student_id] || "X"}
                    onPick={(v) => setEdit((e) => ({ ...e, [s.submission_id]: { ...(e[s.submission_id] || {}), [st.student_id]: v } }))}
                  />
                ))}
              </Cols>
              {i < students.length - 1 ? <div className="grid-sep" /> : null}
            </React.Fragment>
          ))}
        </>
      )}
      <StatTemplates templates={templates} reload={reload} />
    </>
  );
}
