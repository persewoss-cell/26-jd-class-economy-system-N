// 사이드바: [학생] 비밀번호 변경 / [관리자] 계정생성·PIN변경·삭제
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { useApp, TextInput, Btn, Cols, Divider, ErrorBox, Warning } from "./ui.jsx";

export default function Sidebar({ open, onClose }) {
  const app = useApp();
  const [sName, setSName] = useState("");
  const [sOld, setSOld] = useState("");
  const [sNew1, setSNew1] = useState("");
  const [sNew2, setSNew2] = useState("");
  const [sErr, setSErr] = useState("");

  const [aPin, setAPin] = useState("");
  const [mName, setMName] = useState("");
  const [mPin, setMPin] = useState("");
  const [aErr, setAErr] = useState("");
  const [delConfirm, setDelConfirm] = useState(false);

  const changePin = async () => {
    setSErr("");
    const n = sName.trim();
    const o = sOld.trim();
    const a = sNew1.trim();
    const b = sNew2.trim();
    if (!n) return setSErr("이름(계정)을 입력해 주세요.");
    if (o.length !== 4) return setSErr("기존 비밀번호는 4자리여야 해요.");
    if (a.length !== 4 || b.length !== 4) return setSErr("새 비밀번호는 4자리여야 해요.");
    if (a !== b) return setSErr("새 비밀번호와 확인이 일치하지 않습니다.");
    if (o === a) return setSErr("새 비밀번호는 기존 비밀번호와 달라야 합니다.");
    const r = await api("change_pin_student", { name: n, old_pin: o, new_pin: a });
    if (r.ok) {
      app.toast("비밀번호 변경 완료!", "✅");
      setSName("");
      setSOld("");
      setSNew1("");
      setSNew2("");
    } else setSErr(r.error || "비밀번호 변경 실패");
  };

  const guard = () => {
    if (!aPin.trim()) {
      setAErr("관리자 비밀번호를 입력해 주세요.");
      return false;
    }
    return true;
  };

  const adminOp = async (op) => {
    setAErr("");
    if (!guard()) return;
    const r = await api("sidebar_admin", { admin_pin: aPin, op, name: mName, pin: mPin });
    if (r.ok) {
      if (op === "create") app.toast(`계정 생성 완료! (번호 ${r.new_no})`, "✅");
      if (op === "pin") app.toast("PIN 변경 완료!", "🔁");
      if (op === "delete") {
        app.toast("삭제 완료!", "🗑️");
        setDelConfirm(false);
      }
      setMName("");
      setMPin("");
      app.refresh();
    } else setAErr(r.error || "처리 실패");
  };

  return (
    <>
      {open ? <div className="sb-backdrop" onClick={onClose} /> : null}
      <aside className={`sidebar ${open ? "open" : ""}`} aria-hidden={!open}>
        <button className="sb-close" type="button" onClick={onClose} aria-label="사이드바 닫기">
          ✕
        </button>
        <div className="stack">
          <h2>🔑 [학생] 비밀번호 변경</h2>
          <TextInput label="이름(계정)" value={sName} onChange={setSName} />
          <TextInput label="기존 비밀번호(4자리)" type="password" value={sOld} onChange={setSOld} />
          <TextInput label="새 비밀번호(4자리)" type="password" value={sNew1} onChange={setSNew1} />
          <TextInput label="새 비밀번호(확인)" type="password" value={sNew2} onChange={setSNew2} />
          <Btn onClick={changePin}>비밀번호 변경(학생)</Btn>
          <ErrorBox>{sErr}</ErrorBox>

          <Divider />

          <h2>🔐 [관리자] 계정생성 / PIN변경 / 삭제</h2>
          <TextInput label="관리자 비밀번호" type="password" value={aPin} onChange={setAPin} />
          <TextInput label="이름(계정)" value={mName} onChange={setMName} />
          <TextInput label="비밀번호(4자리)" type="password" value={mPin} onChange={setMPin} />
          <Cols w={3}>
            <Btn onClick={() => adminOp("create")}>계정 생성</Btn>
            <Btn onClick={() => adminOp("pin")}>PIN 변경</Btn>
            <Btn onClick={() => setDelConfirm(true)}>삭제</Btn>
          </Cols>
          {delConfirm ? (
            <>
              <Warning>정말로 삭제하시겠습니까?</Warning>
              <Cols w={2}>
                <Btn onClick={() => adminOp("delete")}>예</Btn>
                <Btn onClick={() => setDelConfirm(false)}>아니오</Btn>
              </Cols>
            </>
          ) : null}
          <ErrorBox>{aErr}</ErrorBox>
        </div>
      </aside>
    </>
  );
}
