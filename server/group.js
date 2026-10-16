// 한 번의 요청(버튼 한 번)에서 생긴 기록들을 같은 "묶음 번호(grp)"로 표시
// → 로그기록에서 함께 일어난 기록끼리 색으로 묶고, 한 번에 되돌릴 수 있게
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

const als = new AsyncLocalStorage();

export function newGroupId() {
  return crypto.randomBytes(12).toString("hex");
}

// fn 안에서 만들어지는 기록은 모두 같은 묶음 번호를 가짐
export function runInGroup(fn) {
  return als.run({ gid: newGroupId() }, fn);
}

export function curGroup() {
  const s = als.getStore();
  return s ? s.gid : null;
}
