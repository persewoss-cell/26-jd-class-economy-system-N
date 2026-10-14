// 🏦 은행(적금) — 관리자: 입금 승인 + 적금 관리 장부 + 중도해지 / 학생: 적금 가입·내역·중도해지 / 공통: 이자율표
import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useApp, useLoad, Cols, H3, H4, Caption, Btn, Select, NumberInput, Checkbox, Metric, Info, Warning, ErrorBox, Expander, DataTable, Loading, ConfirmModal } from "../components/ui.jsx";

function DepositApproval() {
  const app = useApp();
  const { data, reload } = useLoad("dep_req_list", {}, [app.ver]);
  const [checked, setChecked] = useState({});
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  const rows = (data && data.rows) || [];
  const W = [0.8, 0.9, 1.4, 2.2, 3.2, 1.2, 1.1, 1.9];

  const process = async (ids, action, kind) => {
    setWarn("");
    setErr("");
    if (kind === "checked" && !ids.length) return setWarn("체크된 승인 신청이 없습니다.");
    const r = await api("dep_req_process", { ids, action });
    const processed = r.processed || 0;
    if (kind === "single") {
      if (processed > 0) app.toast(action === "approve" ? "승인 완료! (통장에 반영됨)" : "거절 처리 완료!", action === "approve" ? "✅" : "🧾");
      else return setErr(r.error || (action === "approve" ? "승인 실패" : "거절 실패"));
    } else if (processed > 0) {
      const head = kind === "checked" ? (action === "approve" ? "체크 승인 완료!" : "체크 거절 완료!") : action === "approve" ? "전체 승인 완료!" : "전체 거절 완료!";
      let msg = `${head} (${processed}건)`;
      if ((r.failed || 0) > 0) msg += ` / 실패 ${r.failed}건`;
      app.toast(msg, action === "approve" ? "✅" : "🧾");
    } else {
      return setErr(kind === "checked" ? (action === "approve" ? "체크 승인 실패" : "체크 거절 실패") : action === "approve" ? "전체 승인 실패" : "전체 거절 실패");
    }
    setChecked({});
    app.refresh();
    reload();
  };

  const ids = rows.map((r) => r.request_id);
  const picked = ids.filter((id) => checked[id]);
  return (
    <>
      <Cols w={[4.0, 1.2, 1.2, 1.2, 1.2]} va="center">
        <H3>✅ 입금 승인(승인 대기 목록)</H3>
        {rows.length ? <Btn onClick={() => process(picked, "approve", "checked")}>체크승인</Btn> : <span />}
        {rows.length ? <Btn onClick={() => process(picked, "reject", "checked")}>체크거절</Btn> : <span />}
        {rows.length ? <Btn onClick={() => process(ids, "approve", "all")}>전체승인</Btn> : <span />}
        {rows.length ? <Btn onClick={() => process(ids, "reject", "all")}>전체거절</Btn> : <span />}
      </Cols>
      {data && !rows.length ? <Info>승인 대기 중인 입금 신청이 없습니다.</Info> : null}
      {warn ? <Warning>{warn}</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
      {rows.length ? (
        <>
          <Cols w={W} va="center">
            <b>체크</b>
            <b>번호</b>
            <b>이름</b>
            <b>날짜</b>
            <b>내역</b>
            <b>금액</b>
            <b>국고반영</b>
            <b>승인여부</b>
          </Cols>
          {rows.map((r, i) => (
            <Cols w={W} va="center" key={r.request_id}>
              <Checkbox checked={!!checked[r.request_id]} onChange={(v) => setChecked((c) => ({ ...c, [r.request_id]: v }))} />
              <div>{r.no > 0 ? r.no : i + 1}</div>
              <div>{r.name}</div>
              <div>{r.when}</div>
              <div>{r.memo}</div>
              <div>{r.amount}</div>
              <div>{r.apply_treasury ? "O" : "X"}</div>
              <Cols w={2}>
                <Btn onClick={() => process([r.request_id], "approve", "single")}>승인</Btn>
                <Btn onClick={() => process([r.request_id], "reject", "single")}>거절</Btn>
              </Cols>
            </Cols>
          ))}
        </>
      ) : null}
    </>
  );
}

const LEDGER_COLS = ["번호", "이름", "적금기간", "신용등급", "이자율", "적금 금액", "이자", "만기 금액", "적금 날짜", "만기 날짜", "처리 결과", "지급 금액"];
const MY_COLS = LEDGER_COLS.slice(2);

function RateTable({ cfg }) {
  const weeks = cfg.weeks || [];
  const rows = [];
  for (let g = 1; g <= 10; g++) {
    const row = { 신용등급: `${g}등급` };
    const gm = (cfg.rates || {})[String(g)] || {};
    weeks.forEach((w) => (row[`${parseInt(w, 10)}주`] = parseInt(Number(gm[String(parseInt(w, 10))] || 0), 10)));
    rows.push(row);
  }
  return (
    <>
      <H4>📶 신용등급·기간별 이자율표</H4>
      <Expander title="📌 신용등급 × 적금기간 이자율(%) 표 보기">
        <DataTable rows={rows} columns={["신용등급", ...weeks.map((w) => `${parseInt(w, 10)}주`)]} csvName="이자율표" />
      </Expander>
    </>
  );
}

function AdminPart({ data }) {
  const app = useApp();
  const [pick, setPick] = useState("(선택 없음)");
  const [err, setErr] = useState("");
  const [ask, setAsk] = useState(false);
  const rows = data.rows || [];
  const running = rows.filter((r) => r["처리 결과"] === "진행중").slice(0, 50);
  const opts = ["(선택 없음)", ...running.map((r) => `${r.번호} ${r.이름} | ${r.적금기간} | ${r["적금 날짜"]} | ${r["적금 금액"]}P`)];
  const cancel = async () => {
    setErr("");
    const r = running[opts.indexOf(pick) - 1];
    if (!r) return;
    const res = await api("savings_cancel", { doc_id: r._id, admin_mode: true });
    if (res.ok) {
      app.toast("중도해지 처리 완료", "✅");
      setPick("(선택 없음)");
      app.refresh();
    } else setErr(res.error || "중도해지 실패");
  };
  return (
    <>
      <H3>📒 적금 관리 장부</H3>
      {!rows.length ? (
        <Info>적금 내역이 아직 없어요.</Info>
      ) : (
        <>
          <DataTable rows={rows} columns={LEDGER_COLS} small csvName="적금관리장부" />
          <H4>🛠️ 관리자 강제 중도해지 처리</H4>
          {!running.length ? (
            <Info>진행중인 적금이 없습니다.</Info>
          ) : (
            <Cols w={[3, 1.2]} va="bottom">
              <Select label="중도해지할 적금" hideLabel value={pick} options={opts} onChange={setPick} />
              <Btn onClick={() => setAsk(true)} disabled={pick === "(선택 없음)"}>
                중도해지 처리(원금 지급)
              </Btn>
            </Cols>
          )}
          <ConfirmModal open={ask} title="🛠️ 관리자 강제 중도해지" message={`${pick}\n이 적금을 중도해지할까요?`} onYes={() => { setAsk(false); cancel(); }} onNo={() => setAsk(false)}>
            <div className="caption center">원금만 학생 통장으로 돌려주고, 이자는 지급되지 않아요.</div>
          </ConfirmModal>
          <ErrorBox>{err}</ErrorBox>
        </>
      )}
    </>
  );
}

function StudentPart({ data }) {
  const app = useApp();
  const weeksOpts = [...new Set((data.rate_cfg.weeks || []).map((w) => parseInt(w, 10)).filter((w) => !Number.isNaN(w)))].sort((a, b) => a - b);
  const weeks = weeksOpts.length ? weeksOpts : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const [w, setW] = useState(weeks[0]);
  const [principal, setPrincipal] = useState(0);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState("(선택 없음)");
  const [cErr, setCErr] = useState("");
  const g = Math.max(1, Math.min(10, data.credit.grade));
  const ww = Math.max(1, Math.min(10, w));
  const rate = Number(((data.rate_cfg.rates || {})[String(g)] || {})[String(ww)] || 0);
  const x = (parseInt(principal, 10) || 0) * (rate / 100);
  let it = Math.round(x);
  if (Math.abs(x % 1) === 0.5) it = Math.floor(x) % 2 === 0 ? Math.floor(x) : Math.floor(x) + 1;
  const mat = (parseInt(principal, 10) || 0) + it;

  const [askJoin, setAskJoin] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const join = async () => {
    setAskJoin(false);
    setErr("");
    if ((parseInt(principal, 10) || 0) > data.balance) return setErr("잔액이 부족해요.");
    const r = await api("savings_join", { weeks: w, principal });
    if (r.ok) {
      app.toast("적금 가입 완료!", "✅");
      setPrincipal(0);
      app.refresh();
    } else setErr(r.error || "적금 가입 실패");
  };

  const rows = data.rows || [];
  const running = rows.filter((r) => r._status === "running" && r["처리 결과"] === "진행중").slice(0, 30);
  const opts = ["(선택 없음)", ...running.map((r) => `${r.적금기간} | ${r["적금 날짜"]} | ${r["적금 금액"]}P`)];
  const cancel = async () => {
    setCErr("");
    const r = running[opts.indexOf(pick) - 1];
    if (!r) return;
    const res = await api("savings_cancel", { doc_id: r._id });
    if (res.ok) {
      app.toast("중도해지 완료", "✅");
      setPick("(선택 없음)");
      app.refresh();
    } else setCErr(res.error || "중도해지 실패");
  };

  return (
    <>
      <H3>📝 적금 가입</H3>
      <Caption>• 적금 가입 시 통장에서 해당 금액이 출금됩니다. • 만기면 원금+이자가 자동 지급됩니다. • 중도해지는 원금만 지급됩니다.</Caption>
      <Cols w={[1, 1.3, 1.3, 1.1]} va="bottom">
        <Select label="적금기간(주)" value={w} options={weeks} onChange={setW} />
        <NumberInput label="적금 금액" min={0} step={10} value={principal} onChange={setPrincipal} />
        <Metric label="미리보기(이자율/만기)" value={`${rate.toFixed(0)}% / ${mat}P`} />
        <Btn
          onClick={() => {
            setErr("");
            if (!(parseInt(principal, 10) > 0)) return setErr("적금 금액을 입력해 주세요.");
            setAskJoin(true);
          }}
        >
          🐷 적금 가입
        </Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
      <ConfirmModal open={askJoin} title="🐷 적금 가입" message={`${principal}드림을 ${w}주 적금에 넣을까요?`} onYes={join} onNo={() => setAskJoin(false)}>
        <div className="caption center">{`통장에서 ${principal}드림이 빠져나가고, 만기에는 ${mat}드림(이자율 ${rate.toFixed(0)}%)을 받아요.`}</div>
      </ConfirmModal>
      <H3>📒 내 적금 내역</H3>
      {!rows.length ? (
        <Info>내 적금 내역이 없어요.</Info>
      ) : (
        <>
          <DataTable rows={rows} columns={MY_COLS} csvName="내적금" />
          {running.length ? (
            <>
              <H4>⚠️ 중도 해지(원금만 지급)</H4>
              <Cols w={[3, 1]} va="bottom">
                <Select label="중도 해지할 적금" hideLabel value={pick} options={opts} onChange={setPick} />
                <Btn onClick={() => setAskCancel(true)} disabled={pick === "(선택 없음)"}>
                  중도해지
                </Btn>
              </Cols>
              <ErrorBox>{cErr}</ErrorBox>
              <ConfirmModal open={askCancel} title="⚠️ 적금 중도해지" message={`${pick}\n이 적금을 해지할까요?`} onYes={() => { setAskCancel(false); cancel(); }} onNo={() => setAskCancel(false)}>
                <div className="caption center">원금만 돌려받고 이자는 없어져요.</div>
              </ConfirmModal>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

export default function Savings({ adminMode }) {
  const app = useApp();
  const { data, error } = useLoad("bank_load", { admin_mode: !!adminMode }, [adminMode, app.ver]);
  const toasted = useRef(false);
  useEffect(() => {
    if (data && data.auto_matured > 0 && !toasted.current) {
      toasted.current = true;
      app.toast(`만기 자동 처리: ${data.auto_matured}건`, "🏦");
    }
  }, [data, app]);
  return (
    <>
      {adminMode ? <DepositApproval /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {!data && !error ? <Loading /> : null}
      {data ? (
        <>
          {adminMode ? <AdminPart data={data} /> : <StudentPart data={data} />}
          <RateTable cfg={data.rate_cfg} />
        </>
      ) : null}
    </>
  );
}
