// 팝업: [학생] 비밀번호 변경 / [관리자] 계정생성·PIN변경·삭제 (예전 사이드바 내용)
import React, { useState } from "react";
import { api, setToken, remember } from "../lib/api.js";
import { useApp, TextInput, Btn, Cols, ErrorBox, ConfirmModal, Popup } from "./ui.jsx";

// 학생: 로그인한 본인 비밀번호 변경 (이 기기는 로그인 유지, 다른 기기는 로그아웃)
export function StudentPinModal({ open, onClose }) {
  const app = useApp();
  const [o, setO] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [err, setErr] = useState("");
  const close = () => {
    setO("");
    setA("");
    setB("");
    setErr("");
    onClose();
  };
  const run = async () => {
    setErr("");
    if (o.trim().length !== 4) return setErr("기존 비밀번호는 4자리여야 해요.");
    if (a.trim().length !== 4 || b.trim().length !== 4) return setErr("새 비밀번호는 4자리여야 해요.");
    if (a.trim() !== b.trim()) return setErr("새 비밀번호와 확인이 일치하지 않습니다.");
    if (o.trim() === a.trim()) return setErr("새 비밀번호는 기존 비밀번호와 달라야 합니다.");
    const r = await api("change_pin_student", { old_pin: o.trim(), new_pin: a.trim() });
    if (!r.ok) return setErr(r.error || "비밀번호 변경 실패");
    // 이 기기는 새 토큰으로 로그인 유지, 기억해 둔 비밀번호도 새것으로
    if (r.token) setToken(r.token);
    const saved = remember.read();
    if (saved.rememberPin) remember.write({ ...saved, pin: a.trim() });
    app.toast("비밀번호 변경 완료!", "✅");
    close();
  };
  return (
    <Popup open={open} title="🔑 비밀번호 변경" onClose={close}>
      <Cols w={3}>
        <TextInput label="기존 비밀번호(4자리)" type="password" value={o} onChange={setO} />
        <TextInput label="새 비밀번호(4자리)" type="password" value={a} onChange={setA} />
        <TextInput label="새 비밀번호(확인)" type="password" value={b} onChange={setB} onEnter={run} />
      </Cols>
      <Btn className="primary big" onClick={run}>
        비밀번호 변경
      </Btn>
      <ErrorBox>{err}</ErrorBox>
    </Popup>
  );
}

// 관리자: 계정 생성 / PIN 변경 / 삭제
export function AdminAccountModal({ open, onClose }) {
  const app = useApp();
  const [aPin, setAPin] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [delAsk, setDelAsk] = useState(false);
  const op = async (kind) => {
    setErr("");
    setDelAsk(false);
    if (!aPin.trim()) return setErr("관리자 비밀번호를 입력해 주세요.");
    const r = await api("sidebar_admin", { admin_pin: aPin, op: kind, name, pin });
    if (!r.ok) return setErr(r.error || "처리 실패");
    if (kind === "create") app.toast(`계정 생성 완료! (번호 ${r.new_no})`, "✅");
    if (kind === "pin") app.toast("PIN 변경 완료!", "🔁");
    if (kind === "delete") app.toast("삭제 완료!", "🗑️");
    setName("");
    setPin("");
    app.refresh();
  };
  return (
    <Popup open={open} title="🔐 계정 관리 (계정생성 / PIN변경 / 삭제)" onClose={onClose}>
      <Cols w={3}>
        <TextInput label="관리자 비밀번호" type="password" value={aPin} onChange={setAPin} />
        <TextInput label="이름(계정)" value={name} onChange={setName} />
        <TextInput label="비밀번호(4자리)" type="password" value={pin} onChange={setPin} />
      </Cols>
      <Cols w={3}>
        <Btn onClick={() => op("create")}>➕ 계정 생성</Btn>
        <Btn onClick={() => op("pin")}>🔁 PIN 변경</Btn>
        <Btn onClick={() => setDelAsk(true)}>🗑️ 삭제</Btn>
      </Cols>
      <ErrorBox>{err}</ErrorBox>
      <ConfirmModal open={delAsk} title="🗑️ 계정 삭제" message={`'${name || "(이름 없음)"}' 계정을 삭제할까요?`} onYes={() => op("delete")} onNo={() => setDelAsk(false)} />
    </Popup>
  );
}
