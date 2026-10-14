// 📊 통계청 (제출물 O/X/△ 관리) — 클릭은 화면에서만 바뀌고 [✅ 저장]을 눌러야 DB 반영
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, Btn, TextInput, Select, NumberInput, Checkbox, Info, ErrorBox, SectionDivider, Loading, TplEditor, ConfirmModal, useSort, SortTh, ExcelBar, Warning, Success, DataTable, moveItem } from "../components/ui.jsx";

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
// rows: [{ key, no, name, cell: (제출물) => 내용, val: (제출물) => 정렬값, pin: "top"|"bottom", className }]
// pin 줄(일괄·평균)은 정렬해도 제자리
export function LedgerGrid({ subs, rows, colWidth = "7.5rem" }) {
  const top = rows.filter((r) => r.pin === "top");
  const bottom = rows.filter((r) => r.pin === "bottom");
  const body = rows.filter((r) => !r.pin);
  const subById = Object.fromEntries(subs.map((x) => [x.submission_id, x]));
  const srt = useSort(body, (r, c) => (c === "no" || c === "name" ? r[c] : r.val ? r.val(subById[c]) : ""));
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <SortTh label="번호" col="no" s={srt} className="lg-no" />
            <SortTh label="이름" col="name" s={srt} className="lg-name" />
            {subs.map((x) => (
              <SortTh
                key={x.submission_id}
                col={x.submission_id}
                s={srt}
                className="stat-hdr"
                style={{ minWidth: colWidth }}
                label={
                  <>
                    {x.date_display}
                    <br />
                    {x.label}
                  </>
                }
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {[...top, ...srt.sorted, ...bottom].map((r) => (
            <tr key={r.key} className={r.className || ""}>
              <td className="lg-no">{r.no}</td>
              <td className="lg-name">{r.name}</td>
              {subs.map((x) => (
                <td key={x.submission_id}>{r.cell(x)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddSubmission({ templates, onAdded, reload }) {
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
      <Cols w={[2.1, 2.6, 0.9]} va="bottom">
        <Select
          label="제출물 템플릿"
          value={tpl}
          options={[{ value: "(직접 입력)", label: "(직접 입력)", fixed: true }, ...templates.map((t) => ({ value: t.label, label: t.label }))]}
          onMove={async (i, d) => {
            const r = await api("tpl_reorder", { kind: "stats", ids: moveItem(templates, i - 1, d).map((t) => t.template_id) });
            if (r.ok) await reload();
            else setErr(r.error || "순서 변경 실패");
          }}
          onChange={(v) => {
            setTpl(v);
            if (v !== "(직접 입력)") setLabel(v);
          }}
        />
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
        idOf={(t) => t.template_id}
        onReorder={(ids) => api("tpl_reorder", { kind: "stats", ids })}
        saveToast="템플릿 저장 완료!"
        deleteToast="템플릿 삭제 완료!"
        reload={reload}
      />
    </>
  );
}

// 통계표 템플릿 엑셀로 일괄 추가 (탭 맨 아래)
const TPL_COLS = ["템플릿 내역", "순서"];
function StatTemplateExcel({ templates, reload }) {
  const app = useApp();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [msg, setMsg] = useState(null);
  const onFile = async (fl) => {
    setFile(fl);
    setPreview(null);
    setMsg(null);
    if (!fl) return;
    try {
      const { columns, rows } = await readExcel(fl);
      if (!TPL_COLS.every((c) => columns.includes(c))) return setMsg(["error", "엑셀 컬럼은 반드시: 템플릿 내역 | 순서 여야 합니다."]);
      const rs = rows.filter((r) => String(r["템플릿 내역"] ?? "").trim()).map((r) => ({ "템플릿 내역": String(r["템플릿 내역"]).trim(), 순서: r["순서"] }));
      if (!rs.length) return setMsg(["error", "엑셀에 템플릿 내역이 없습니다."]);
      setPreview(rs);
    } catch (e) {
      setMsg(["error", `엑셀을 읽지 못했어요: ${e.message || e}`]);
    }
  };
  const save = async () => {
    setMsg(null);
    if (!preview) return setMsg(["warning", "먼저 올바른 엑셀을 업로드하세요."]);
    const r = await api("stat_tpl_bulk", { rows: preview, overwrite });
    if (!r.ok) return setMsg(["error", `저장 실패: ${r.error}`]);
    app.toast(`통계표 템플릿 반영 완료: ${r.added}건 추가${r.skipped ? ` · 이미 있는 ${r.skipped}건 건너뜀` : ""}`, "📥");
    setFile(null);
    setPreview(null);
    reload();
  };
  return (
    <>
      <H3>📥 통계표 템플릿 엑셀로 일괄 추가</H3>
      <ExcelBar
        downloads={[
          ["📄 샘플 엑셀", () => downloadExcel("통계표_템플릿_샘플.xlsx", [{ name: "stat_templates", columns: TPL_COLS, rows: [{ "템플릿 내역": "수학 익힘책", 순서: 1 }, { "템플릿 내역": "독서록", 순서: 2 }] }])],
          ["📄 현재 템플릿 엑셀", () => downloadExcel("통계표_템플릿_현재.xlsx", [{ name: "stat_templates", columns: TPL_COLS, rows: templates.map((t) => ({ "템플릿 내역": t.label, 순서: t.order })) }])],
        ]}
        file={file}
        onFile={onFile}
        overwrite={overwrite}
        setOverwrite={setOverwrite}
        overwriteLabel="기존 통계표 템플릿을 모두 지우고 엑셀로 덮어쓰기"
        onSave={save}
      >
        {msg ? msg[0] === "warning" ? <Warning>{msg[1]}</Warning> : <ErrorBox>{msg[1]}</ErrorBox> : null}
        {preview ? (
          <>
            <Success>업로드 완료! ({preview.length}행) 미리보기 확인 후 저장을 누르세요.</Success>
            <DataTable rows={preview} columns={TPL_COLS} />
          </>
        ) : null}
      </ExcelBar>
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
      <AddSubmission templates={templates} onAdded={reload} reload={reload} />
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
          <ConfirmModal
            open={resetConfirm}
            title="🧹 통계 장부 초기화"
            message="모든 제출물 내역(열)이 전부 삭제됩니다. 진행할까요?"
            yesText="예(전체 삭제)"
            onYes={doReset}
            onNo={() => {
              setResetConfirm(false);
              setResetPin("");
              setErr("");
            }}
          >
            <TextInput label="관리자 비밀번호" type="password" value={resetPin} onChange={setResetPin} onEnter={doReset} />
            <ErrorBox>{err}</ErrorBox>
          </ConfirmModal>
          <ConfirmModal
            open={delConfirm}
            wide
            title="🗑️ 제출물 삭제"
            message="삭제할 제출물을 체크하세요."
            yesText="삭제"
            noText="취소"
            onYes={doDelete}
            onNo={() => {
              setDelConfirm(false);
              setErr("");
            }}
          >
            <div className="check-list">
              {subs.map((s) => (
                <Checkbox key={s.submission_id} label={`${s.date_display} | ${s.label}`} checked={!!delChecks[s.submission_id]} onChange={(v) => setDelChecks((c) => ({ ...c, [s.submission_id]: v }))} />
              ))}
            </div>
            <ErrorBox>{err}</ErrorBox>
          </ConfirmModal>

          <LedgerGrid
            subs={subs}
            rows={[
              {
                key: "_bulk",
                no: "⚡",
                name: "일괄",
                pin: "top",
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
                val: (s) => (edit[s.submission_id] || {})[st.student_id] || "X",
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
      <StatTemplateExcel templates={templates} reload={reload} />
    </>
  );
}
