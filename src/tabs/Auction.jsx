// 🏷️ 경매
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { downloadExcel } from "../lib/excel.js";
import { useApp, useLoad, Cols, H3, Caption, Btn, TextInput, Select, NumberInput, Checkbox, Radio, Info, Warning, ErrorBox, Success, DataTable, Loading } from "../components/ui.jsx";

const BID_COLS = ["입찰 가격", "입찰일시", "번호", "이름"];
const pad2 = (n) => String(n).padStart(2, "0");

function RefundApply({ roundId, withDownload, bids, roundNo, onDone }) {
  const app = useApp();
  const [no, setNo] = useState(false);
  const [yes, setYes] = useState(false);
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  const apply = async () => {
    setWarn("");
    setErr("");
    if (!no && !yes) return setWarn("낙찰금 반환 여부를 선택 후 장부 반영 버튼을 눌러 주세요");
    const r = await api("auction_apply", { round_id: roundId, refund: yes });
    if (r.ok) {
      app.toast("경매 관리장부 + 국고 세입 반영 완료", "✅");
      onDone();
    } else setErr(r.error || "장부 반영 실패");
  };
  const boxes = [
    <Checkbox key="n" label="낙찰금 미반환" checked={no} onChange={(v) => { setNo(v); if (v) setYes(false); }} />,
    <Checkbox key="y" label="낙찰금 반환(반환액 90%)" checked={yes} onChange={(v) => { setYes(v); if (v) setNo(false); }} />,
    <Btn key="b" onClick={apply}>장부반영</Btn>,
  ];
  return (
    <>
      {withDownload ? (
        <Cols w={[1.2, 0.9, 1.2, 1.2]} va="center">
          <Btn className="dl" onClick={() => downloadExcel(`auction_result_${pad2(roundNo)}.xlsx`, [{ name: "경매결과", columns: BID_COLS, rows: bids }])}>
            엑셀저장
          </Btn>
          {boxes}
        </Cols>
      ) : (
        <Cols w={3} va="center">
          {boxes}
        </Cols>
      )}
      {warn ? <Warning>{warn}</Warning> : null}
      <ErrorBox>{err}</ErrorBox>
    </>
  );
}

function AuctionAdmin() {
  const app = useApp();
  const [pickId, setPickId] = useState("");
  const { data, error, reload } = useLoad("auction_admin_load", { pick_round_id: pickId }, [app.ver, pickId]);
  const [bidName, setBidName] = useState("");
  const [aff, setAff] = useState("");
  const [err, setErr] = useState("");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const open = async () => {
    setErr("");
    const r = await api("auction_open", { bid_name: bidName, affiliation: aff });
    if (r.ok) {
      app.toast(`경매 ${pad2(r.round_no)}회 개시`, "✅");
      reload();
    } else setErr(r.error || "경매 개시 실패");
  };
  const close = async () => {
    setErr("");
    const r = await api("auction_close", {});
    if (r.ok) {
      app.toast("경매 마감 완료", "✅");
      reload();
    } else setErr(r.error || "경매 마감 실패");
  };
  const picked = data.closed.find((r) => r.round_id === pickId);
  const pickLabel = (r) => `${pad2(r.round_no)}회 | ${r.bid_name}`;
  return (
    <>
      <H3>📢 경매 개시</H3>
      <Cols w={[2.4, 1.6, 0.8, 0.8]} va="bottom">
        <TextInput label="입찰 내역" value={bidName} onChange={setBidName} />
        <TextInput label="소속" value={aff} onChange={setAff} />
        <Btn onClick={open}>개시</Btn>
        <Btn onClick={close}>마감</Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
      {data.open ? <Success>{`진행 중: 입찰번호 ${pad2(data.open.round_no)} | 입찰이름 ${data.open.bid_name} | 소속 ${data.open.affiliation}`}</Success> : <Info>개시된 경매가 없습니다.</Info>}

      <H3>📊 경매 결과</H3>
      {data.open ? (
        <Info>경매 마감 버튼을 눌러야 경매 결과가 표시됩니다.</Info>
      ) : !data.latest ? (
        <Info>마감된 경매가 없습니다.</Info>
      ) : data.latest.ledger_applied ? (
        <Info>경매 마감 버튼을 눌러야 경매 결과가 표시됩니다.</Info>
      ) : (
        <>
          <Caption>{`최근 마감 경매: ${pad2(data.latest.round_no)}회 | 입찰이름: ${data.latest.bid_name}`}</Caption>
          {data.latest.bids.length ? (
            <>
              <DataTable rows={data.latest.bids} columns={BID_COLS} csvName="경매결과" />
              <RefundApply roundId={data.latest.round_id} withDownload bids={data.latest.bids} roundNo={data.latest.round_no} onDone={() => app.refresh()} />
            </>
          ) : (
            <Info>제출된 입찰표가 없습니다.</Info>
          )}
        </>
      )}

      {data.closed.length ? (
        <>
          <Select
            label="🔎 마감된 경매 결과 조회"
            value={pickId ? pickLabel(picked || { round_no: 0, bid_name: "" }) : "(선택없음)"}
            options={["(선택없음)", ...data.closed.map(pickLabel)]}
            onChange={(v) => {
              const r = data.closed.find((x) => pickLabel(x) === v);
              setPickId(r ? r.round_id : "");
            }}
          />
          {pickId && picked ? (
            <>
              {(data.picked_bids || []).length ? <DataTable rows={data.picked_bids} columns={BID_COLS} csvName="경매결과" /> : <Info>선택한 회차에 제출된 입찰표가 없습니다.</Info>}
              {picked.ledger_applied ? (
                <Caption>✅ 이미 장부 반영된 경매입니다.</Caption>
              ) : (data.picked_bids || []).length ? (
                <>
                  <Warning>⚠️ 이 회차는 아직 장부(국고) 반영이 완료되지 않았습니다.</Warning>
                  <RefundApply key={pickId} roundId={pickId} onDone={() => app.refresh()} />
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <Info>조회 가능한 마감 경매가 없습니다.</Info>
      )}

      <H3>📚 경매 관리 장부</H3>
      {data.ledger.length ? <DataTable rows={data.ledger} csvName="경매관리장부" /> : <Info>아직 반영된 경매 관리 장부가 없습니다.</Info>}
    </>
  );
}

function AuctionUser() {
  const app = useApp();
  const { data, error } = useLoad("auction_user_load", {}, [app.ver]);
  const [amt, setAmt] = useState(0);
  const [confirm, setConfirm] = useState("아니오");
  const [warn, setWarn] = useState("");
  const [err, setErr] = useState("");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Loading />;
  const o = data.open;
  const submit = async () => {
    setWarn("");
    setErr("");
    if (confirm !== "예") return setWarn("제출 전 확인에서 '예'를 선택해 주세요.");
    const r = await api("auction_bid", { amount: amt });
    if (r.ok) {
      app.toast("입찰표 제출 완료! 제출 즉시 통장에서 차감되었습니다.", "✅");
      app.refresh();
    } else setErr(r.error || "입찰표 제출 실패");
  };
  return (
    <>
      <H3>📝 입찰표</H3>
      {!o ? (
        <Info>개시된 경매가 없습니다.</Info>
      ) : (
        <div className="md">
          <div>• 입찰기일: {o.opened_text}</div>
          <div>• 입찰번호: {pad2(o.round_no)}</div>
          <div>• 입찰이름: {o.bid_name}</div>
          <div>{`• 입찰자 정보: 번호 ${data.me.no} / 이름 ${data.me.name} / 소속 ${o.affiliation}`}</div>
        </div>
      )}
      <H3>✋경매 참여하기</H3>
      {!o ? (
        <Info>개시된 경매가 없습니다.</Info>
      ) : data.prev ? (
        <Success>{`입찰표 제출 완료: ${Number(data.prev.amount).toLocaleString("en-US")} 드림 | 제출시각 ${data.prev.submitted_text}`}</Success>
      ) : (
        <>
          <NumberInput label="입찰 가격(드림)" min={0} value={amt} onChange={setAmt} />
          <Radio label="입찰표를 제출하시겠습니까?" options={["아니오", "예"]} value={confirm} onChange={setConfirm} />
          <Btn onClick={submit}>입찰표 제출</Btn>
          {warn ? <Warning>{warn}</Warning> : null}
          <ErrorBox>{err}</ErrorBox>
        </>
      )}
    </>
  );
}

export default function Auction() {
  const app = useApp();
  return app.user && app.user.role === "admin" ? <AuctionAdmin /> : <AuctionUser />;
}
