// 💼 직업/월급
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { readExcel, downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, H4, Subheader, Caption, Btn, TextInput, Select, MultiSelect, NumberInput, Checkbox, Metric, Info, Warning, ErrorBox, Success, Expander, DataTable, Loading, ConfirmModal, ExcelBar, TplEditor, Popup } from "../components/ui.jsx";

function calcNet(gross, cfg) {
  gross = parseInt(gross, 10) || 0;
  const tp = Number(cfg.tax_percent) || 10;
  const desk = parseInt(cfg.desk_rent, 10) || 50;
  const elec = parseInt(cfg.electric_fee, 10) || 10;
  const health = parseInt(cfg.health_fee, 10) || 10;
  const x = gross * (tp / 100);
  // 파이썬 round(은행원 반올림)
  let tax = Math.round(x);
  if (Math.abs(x % 1) === 0.5) tax = Math.floor(x) % 2 === 0 ? Math.floor(x) : Math.floor(x) + 1;
  return Math.max(0, gross - tax - desk - elec - health);
}

function DeductionCfg({ cfg, onSaved }) {
  const app = useApp();
  const [f, setF] = useState(cfg);
  useEffect(() => setF(cfg), [cfg]);
  const save = async () => {
    const r = await api("salary_cfg_save", f);
    if (r.ok) {
      app.toast("공제 설정 저장 완료!", "✅");
      onSaved();
    }
  };
  return (
    <Expander title="⚙️ 실수령액 계산식(공제 설정) 변경">
      <Cols w={[1.2, 1, 1, 1, 1.2]} va="bottom">
        <NumberInput label="세금(%)" min={0} max={100} step={0.5} decimals={1} value={f.tax_percent} onChange={(v) => setF((x) => ({ ...x, tax_percent: v }))} />
        <NumberInput label="자리임대료" min={0} value={f.desk_rent} onChange={(v) => setF((x) => ({ ...x, desk_rent: v }))} />
        <NumberInput label="전기세" min={0} value={f.electric_fee} onChange={(v) => setF((x) => ({ ...x, electric_fee: v }))} />
        <NumberInput label="건강보험료" min={0} value={f.health_fee} onChange={(v) => setF((x) => ({ ...x, health_fee: v }))} />
        <Btn onClick={save}>✅ 공제 설정 저장</Btn>
      </Cols>
    </Expander>
  );
}

// 이번 달 월급을 전부 회수한 뒤(지급일이 지난 경우): 다시 지급할 날을 정하는 팝업
function RepayPrompt({ repay }) {
  const app = useApp();
  const today = new Date(Date.now() + 9 * 3600 * 1000).getUTCDate();
  const [closed, setClosed] = useState(false);
  const [day, setDay] = useState(Math.min(31, today + 1));
  const [err, setErr] = useState("");
  const send = async (skip) => {
    setErr("");
    const r = await api("payroll_repay_set", { day, skip });
    if (!r.ok) return setErr(r.error || "저장 실패");
    app.toast(skip ? "이번 달은 자동지급하지 않아요" : r.day <= today ? "오늘 다시 지급했어요" : `${r.day}일에 다시 자동지급해요`, "📅");
    app.refresh();
  };
  return (
    <>
      {repay && !repay.pending ? (
        <Info>{repay.day ? `📅 이번 달 월급은 ${repay.day}일에 다시 자동지급돼요.` : "📅 이번 달은 월급을 자동지급하지 않아요. (필요하면 수동지급을 눌러 주세요)"}</Info>
      ) : null}
      <Popup open={!!(repay && repay.pending) && !closed} title="📅 이번 달 월급을 모두 회수했어요" onClose={() => setClosed(true)}>
        <div>지급일이 지난 뒤 월급이 전부 회수되어, 자동지급을 잠시 멈췄어요. 이번 달에 다시 지급할 날을 정해 주세요.</div>
        <Cols w={[1, 1.3, 1.3]} va="bottom">
          <NumberInput label="다시 지급할 날 (일)" min={today} max={31} value={day} onChange={setDay} />
          <Btn onClick={() => send(false)}>📅 이 날 다시 지급</Btn>
          <Btn onClick={() => send(true)}>이번 달은 지급 안 함</Btn>
        </Cols>
        <div className="caption">오늘 날짜를 고르면 바로 다시 지급돼요. 직업을 고친 뒤 [수동지급]으로 바로 줄 수도 있어요.</div>
        <ErrorBox>{err}</ErrorBox>
      </Popup>
    </>
  );
}

function PayrollBox({ data, reload }) {
  const app = useApp();
  const [day, setDay] = useState(data.payroll.pay_day);
  const [auto, setAuto] = useState(data.payroll.auto_enabled);
  const [confirm, setConfirm] = useState(false);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [warn, setWarn] = useState("");
  const [fixMode, setFixMode] = useState(null); // "dup" | "all"
  const [fixPin, setFixPin] = useState("");
  const [fixErr, setFixErr] = useState("");
  const [fixFails, setFixFails] = useState([]);
  const [allPrev, setAllPrev] = useState(null);

  useEffect(() => {
    setDay(data.payroll.pay_day);
    setAuto(data.payroll.auto_enabled);
  }, [data.payroll.pay_day, data.payroll.auto_enabled]);

  const saveCfg = async () => {
    const r = await api("payroll_cfg_save", { pay_day: day, auto_enabled: auto });
    if (r.ok) {
      app.toast("월급 지급 설정 저장 완료!", "✅");
      reload();
    }
  };

  const doPay = async (repay) => {
    setErr("");
    setWarn("");
    const r = await api("payroll_manual", { admin_pin: pin, confirm_repay: repay });
    if (!r.ok) return setErr(r.error);
    setConfirm(false);
    setPin("");
    if (r.paid > 0) app.toast(`월급 수동지급 완료: ${r.paid}명`, "💸");
    if (r.err > 0) setWarn(`일부 지급 실패가 있었어요: ${r.err}건`);
    app.refresh();
  };

  const openAll = async () => {
    setFixErr("");
    setFixFails([]);
    const r = await api("payroll_all_preview", {});
    setAllPrev(r.ok ? r : { count: 0, sum: 0 });
    setFixMode("all");
  };

  const runFix = async () => {
    setFixErr("");
    const r = await api("payroll_fix", { mode: fixMode, admin_pin: fixPin });
    if (!r.ok) return setFixErr(r.error);
    if (r.none) {
      setFixMode(null);
      return;
    }
    if (r.fixed > 0) {
      app.toast(
        fixMode === "all" ? `이번달 월급 회수 완료: ${r.fixed}건 기록 삭제 (국고 공제 ${r.treasury_fixed}건 함께 삭제)` : `중복 월급 회수 완료: ${r.fixed}건 기록 삭제 (국고 공제 ${r.treasury_fixed}건 함께 삭제)`,
        fixMode === "all" ? "🗑️" : "♻️"
      );
    }
    setFixFails(r.errors || []);
    setFixMode(null);
    setFixPin("");
    app.refresh();
  };

  return (
    <Expander title="💸 월급 지급 설정">
      <Cols w={[1, 0.9, 1, 2.4]} va="bottom">
        <NumberInput label="월급 지급 날짜: 매월 (일)" min={1} max={31} value={day} onChange={setDay} />
        <Checkbox
          label="자동지급"
          checked={auto}
          onChange={setAuto}
          help={"해당 날짜부터 매월, 학생의 직업 실수령액 기준으로 자동 지급합니다.\n그날 아무도 접속을 안 해서 놓쳐도, 이번 달 안에 누군가 접속하면 그때 밀린 월급이 자동 지급됩니다.\n이미 이번 달에 수동지급을 했으면 자동지급은 그 달에는 패스됩니다."}
        />
        <Btn onClick={saveCfg}>✅ 지급 설정 저장</Btn>
        <Btn onClick={() => (data.already_any ? setConfirm(true) : doPay(false))}>💸 수동지급(이번 달 즉시 지급, 기지급 시 확인 후 지급)</Btn>
      </Cols>
      <ConfirmModal
        open={confirm}
        title="💸 월급 재지급"
        message="이번 달에 이미 월급 지급(자동/수동)한 기록이 있어요. 그래도 지급할까요?"
        yesText="지급"
        noText="취소"
        onYes={() => doPay(true)}
        onNo={() => {
          setConfirm(false);
          setErr("");
          app.toast("수동지급 취소", "🛑");
        }}
      >
        <TextInput label="관리자 비밀번호(PIN)" type="password" value={pin} onChange={setPin} onEnter={() => doPay(true)} />
        <ErrorBox>{confirm ? err : ""}</ErrorBox>
      </ConfirmModal>
      <ErrorBox>{confirm ? "" : err}</ErrorBox>
      {warn ? <Warning>{warn}</Warning> : null}

      <hr className="divider" />
      <H4>🛠️ 월급 중복 지급 회수(정정)</H4>
      <Caption>이번 달 1일 00:00부터 현재까지 발생한 월급 입금 내역에서 같은 학생/같은 직업/같은 금액이 2회 이상인 경우</Caption>
      {data.dup.groups.length ? (
        <>
          <Warning>{`중복 의심 ${data.dup.groups.length}그룹 · 회수 대상 ${data.dup.count}건 · 예상 회수액 ${data.dup.sum}원`}</Warning>
          <DataTable rows={data.dup.groups.map((g) => ({ 이름: g.name, 학생ID: g.student_id, 내역: g.memo, 건당금액: g.amount, 발생횟수: g.count }))} csvName="중복월급" />
        </>
      ) : (
        <Info>이번 달 기준으로 회수할 자동 월급 중복 건이 없습니다.</Info>
      )}
      <Cols w={[1.0, 1.7, 1.7]}>
        <Btn onClick={reload}>🔍 중복 다시 검사</Btn>
        <Btn onClick={() => { setFixErr(""); setFixMode("dup"); }} disabled={data.dup.count === 0}>
          ♻️ 이번 달 월급 중복 지급 회수 실행
        </Btn>
        <Btn onClick={openAll} disabled={!data.paid_this_month}>
          🗑️ 이번달 회수(중복 여부 관계 없이)
        </Btn>
      </Cols>
      {!data.paid_this_month ? <Caption>⚠️ 이번달 월급 지급이 되지 않아서 처리할 수 없습니다.</Caption> : null}
      {fixMode === "all" && allPrev && allPrev.count === 0 ? <Info>이번달 지급된 월급이 이미 모두 회수되어, 더 이상 회수할 대상이 없습니다.</Info> : null}
      <ConfirmModal
        open={fixMode === "dup" || (fixMode === "all" && !!allPrev && allPrev.count > 0)}
        title={fixMode === "all" ? "🗑️ 이번달 월급 전체 회수" : "♻️ 월급 중복 지급 회수"}
        message={
          fixMode === "all" && allPrev
            ? `중복 여부와 관계없이 이번 달 지급된 월급 전체(${allPrev.count}건 · 예상 회수액 ${allPrev.sum}원)를 회수할까요?\n국고에 반영된 공제 세입도 함께 되돌려요.`
            : "중복으로 지급된 월급을 회수(정정)할까요?"
        }
        yesText={fixMode === "all" ? "회수 실행" : "정정 실행"}
        noText="취소"
        onYes={runFix}
        onNo={() => {
          setFixMode(null);
          setFixErr("");
          setFixPin("");
        }}
      >
        <div className="caption center">실행 후에는 되돌릴 수 없어요.</div>
        <TextInput label="관리자 비밀번호(PIN)" type="password" value={fixPin} onChange={setFixPin} onEnter={runFix} />
        <ErrorBox>{fixErr}</ErrorBox>
      </ConfirmModal>
      <ErrorBox>{fixMode ? "" : fixErr}</ErrorBox>
      {fixFails.length ? (
        <>
          <Warning>{`일부 정정 실패: ${fixFails.length}건`}</Warning>
          <Expander title="정정 실패 상세">
            {fixFails.map((e) => (
              <div key={e}>- {e}</div>
            ))}
          </Expander>
        </>
      ) : null}
    </Expander>
  );
}

function JobAssign({ data, reload }) {
  const app = useApp();
  const accOptions = data.students.map((r) => `${r.no} ${r.name}`);
  const labelToId = Object.fromEntries(data.students.map((r) => [`${r.no} ${r.name}`, r.student_id]));
  const jobLabels = data.rows.map((r) => {
    const cnt = Math.max(0, parseInt(r.student_count, 10) || 1);
    const hired = r.assigned_ids.filter((s) => String(s).trim()).length;
    return `${r.order} | ${r.job} (월급 ${r.salary}) | 배정수 ${cnt} | 현재 고용수 ${hired}`;
  });
  const [job, setJob] = useState(jobLabels[0] || null);
  const [sel, setSel] = useState([]);
  const [msg, setMsg] = useState(null);
  const [clearChk, setClearChk] = useState(false);
  useEffect(() => {
    if (!job || !jobLabels.includes(job)) setJob(jobLabels[0] || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobLabels.join("|")]);

  const act = async (op) => {
    setMsg(null);
    if (!job) return setMsg(["warning", "먼저 직업을 선택하세요."]);
    if (!sel.length) return setMsg(["warning", "대상 학생을 선택하세요."]);
    const jobId = data.rows[jobLabels.indexOf(job)]?._id;
    const r = await api("job_assign", { job_id: jobId, op, sids: sel.map((l) => labelToId[l]).filter(Boolean) });
    if (!r.ok) return setMsg(["error", r.error]);
    if (op === "hire") {
      if (r.changed) {
        app.toast("고용 완료!", "✅");
        setSel([]);
        if (r.full > 0) setMsg(["warning", `정원이 가득 차서 ${r.full}명은 배정되지 않았어요. (학생수/정원 증가 후 다시 시도)`]);
        reload();
      } else setMsg(["info", "변경된 내용이 없습니다. (이미 배정되었거나 정원이 가득 찼을 수 있어요.)"]);
    } else if (r.changed) {
      app.toast("해제 완료!", "✅");
      setSel([]);
      reload();
    } else setMsg(["info", "해제할 배정이 없습니다."]);
  };

  const clearAll = async () => {
    const r = await api("job_clear_all", {});
    if (r.ok) {
      app.toast("전체 직업 해제 완료!", "✅");
      setClearChk(false);
      setSel([]);
      reload();
    } else setMsg(["error", `전체 직업 해제 실패: ${r.error}`]);
  };

  return (
    <>
      <H3>🎖️ 직업 지정 / 회수</H3>
      <Cols w={[1.8, 2.1, 0.8, 0.8, 1.5]} va="bottom">
        {jobLabels.length ? <Select label="부여할 직업 선택" value={job} options={jobLabels} onChange={setJob} /> : <span />}
        <MultiSelect label="대상 학생 선택(복수 선택 가능)" value={sel} options={accOptions} onChange={setSel} />
        <Btn onClick={() => act("hire")}>➕ 고용</Btn>
        <Btn onClick={() => act("fire")}>➖ 해제</Btn>
        <Btn onClick={() => setClearChk(true)}>🔥 전체 직업 해제</Btn>
      </Cols>
      {msg ? msg[0] === "warning" ? <Warning>{msg[1]}</Warning> : msg[0] === "info" ? <Info>{msg[1]}</Info> : <ErrorBox>{msg[1]}</ErrorBox> : null}
      <ConfirmModal open={clearChk} title="⚠️ 전체 직업 해제" message="모든 학생의 직업을 해제할까요? 되돌릴 수 없어요." onYes={() => { setClearChk(false); clearAll(); }} onNo={() => setClearChk(false)} />
    </>
  );
}

function JobEdit({ data, reload }) {
  return (
    <>
      <H3>➕ 직업 추가 / 수정 / 삭제</H3>
      <TplEditor
        noun="직업"
        items={data.rows}
        itemLabel={(r) => `${r.order} | ${r.job} (월급 ${r.salary})`}
        blank={() => ({ job: "", salary: 0, count: 1 })}
        fromItem={(r) => ({ job: r.job, salary: r.salary, count: r.student_count })}
        widths={[2.4, 1.1, 1.1, 1.2]}
        fields={(f, set) => [
          <TextInput key="j" label="직업" value={f.job} onChange={(v) => set({ job: v })} />,
          <NumberInput key="s" label="월급" min={0} stepper={false} value={f.salary} onChange={(v) => set({ salary: v })} />,
          <NumberInput key="c" label="학생 수(최소 1)" min={1} stepper={false} value={f.count} onChange={(v) => set({ count: v })} />,
          <Metric key="n" label="실수령액(자동)" value={calcNet(f.salary, data.cfg)} />,
        ]}
        onSave={async (f, edit) => {
          if (!f.job.trim()) return { ok: false, error: "직업을 입력해 주세요." };
          return api("job_save", { job_id: edit ? edit._id : "", job: f.job.trim(), salary: f.salary, student_count: f.count });
        }}
        onDelete={(r) => api("job_delete", { job_id: r._id })}
        saveToast="저장 완료!"
        deleteToast="삭제 완료"
        reload={reload}
      />
    </>
  );
}

function JobExcel({ data, reload }) {
  const app = useApp();
  const COLS = ["순", "직업", "월급", "배정 수"];
  const [wipe, setWipe] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState("");
  const onFile = async (fl) => {
    setFile(fl);
    setMsgs([]);
    setPreview(null);
    if (!fl) return;
    try {
      const { columns, rows } = await readExcel(fl);
      let cols = columns;
      let rs = rows;
      if (!cols.includes("배정수") && cols.includes("학생 수")) {
        cols = cols.map((c) => (c === "학생 수" ? "배정수" : c));
        rs = rs.map((r) => ({ ...r, 배정수: r["학생 수"] }));
      }
      if (!COLS.every((c) => cols.includes(c))) return setMsgs(["엑셀 컬럼은 반드시: 순 | 직업 | 월급 | 배정 수 여야 합니다."]);
      const num = (v, d) => {
        const n = Number(v);
        return v === undefined || v === null || v === "" || !Number.isFinite(n) ? d : Math.trunc(n);
      };
      const df = rs.map((r) => ({ 순: num(r["순"], 999999), 직업: r["직업"] === undefined ? "nan" : String(r["직업"]).trim(), 월급: num(r["월급"], 0), "배정 수": num(r["배정 수"], 0) }));
      const m = [];
      if (df.some((r) => r.직업.length === 0)) m.push("❌ 직업명이 비어있는 행이 있습니다.");
      if (df.some((r) => r.월급 < 0)) m.push("❌ 월급은 0 이상이어야 합니다.");
      if (df.some((r) => r["배정 수"] <= 0)) m.push("❌ 배정 수는 1 이상이어야 합니다.");
      if (m.length) return setMsgs(m);
      df.sort((a, b) => a.순 - b.순 || (a.직업 < b.직업 ? -1 : 1));
      setPreview(df);
    } catch (e) {
      setMsgs([`직업 엑셀 읽기 실패: ${e.message || e}`]);
    }
  };
  const save = async () => {
    setErr("");
    if (!preview || !preview.length) return setErr("먼저 올바른 엑셀을 업로드해서 미리보기를 만든 뒤 저장하세요.");
    const r = await api("jobs_bulk_save", { rows: preview, wipe });
    if (r.ok) {
      app.toast("직업 엑셀 저장(반영) 완료!", "📥");
      setPreview(null);
      setFile(null);
      reload();
    } else setErr(`직업 엑셀 저장 실패: ${r.error}`);
  };
  const current = data.rows.map((r) => ({ 순: r.order, 직업: String(r.job).trim(), 월급: r.salary, "배정 수": parseInt(r.raw_count, 10) || 0 }));
  return (
    <>
      <H3>📥 직업 엑셀 일괄 업로드</H3>
      <ExcelBar
        downloads={[
          ["📄 샘플 엑셀", () => downloadExcel("jobs_sample.xlsx", [{ name: "jobs", columns: COLS, rows: [{ 순: 1, 직업: "은행원", 월급: 500, "배정 수": 1 }, { 순: 2, 직업: "통계청", 월급: 300, "배정 수": 2 }] }])],
          ["📄 현재 직업 엑셀", () => downloadExcel("jobs_current.xlsx", [{ name: "jobs", columns: COLS, rows: current }])],
        ]}
        file={file}
        onFile={onFile}
        overwrite={wipe}
        setOverwrite={setWipe}
        overwriteLabel="⚠️ 기존 직업 목록을 모두 지우고 엑셀로 덮어쓰기"
        onSave={save}
        saveText="✅ 저장(반영)"
      >
        {msgs.map((m) => (
          <ErrorBox key={m}>{m}</ErrorBox>
        ))}
        {preview ? <Success>{`미리보기 준비 완료! (${preview.length}행) 저장(반영)을 누르세요.`}</Success> : null}
        {preview && preview.length ? <DataTable rows={preview} columns={COLS} /> : null}
      </ExcelBar>
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

export default function Jobs() {
  const app = useApp();
  const { data, error, reload } = useLoad("jobs_load", {}, [app.ver]);
  return (
    <>
      <Subheader>💼 직업/월급 시스템</Subheader>
      {error ? <Info>{error}</Info> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          <RepayPrompt repay={data.payroll.repay} />
          <DeductionCfg cfg={data.cfg} onSaved={reload} />
          <PayrollBox data={data} reload={reload} />
          <JobAssign data={data} reload={reload} />
          <H3>📋 직업/월급 목록</H3>
          {(() => {
            const idTo = Object.fromEntries(data.students.map((s) => [s.student_id, s]));
            const rows = [];
            for (const r of data.rows) {
              const cnt = Math.max(0, parseInt(r.student_count, 10) || 1);
              let a = [...r.assigned_ids];
              if (cnt === 0) a = [];
              else {
                if (a.length < cnt) a = a.concat(Array(cnt - a.length).fill(""));
                if (a.length > cnt) a = a.slice(0, cnt);
              }
              for (const sid of a) {
                if (!sid) continue;
                const s = idTo[sid];
                rows.push({ 번호: s ? s.no : 999999, 이름: s ? s.name : "", 직업: r.job, 월급: r.salary, 실수령액: calcNet(r.salary, data.cfg) });
              }
            }
            rows.sort((a, b) => a.번호 - b.번호 || (a.이름 < b.이름 ? -1 : a.이름 > b.이름 ? 1 : 0) || (a.직업 < b.직업 ? -1 : 1));
            return rows.length ? <DataTable rows={rows} columns={["번호", "이름", "직업", "월급", "실수령액"]} csvName="직업월급" /> : <Info>아직 직업이 배정된 학생이 없습니다.</Info>;
          })()}
          <JobEdit data={data} reload={reload} />
          <JobExcel data={data} reload={reload} />
        </>
      ) : null}
    </>
  );
}
