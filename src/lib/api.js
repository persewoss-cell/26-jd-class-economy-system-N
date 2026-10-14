// 서버 API 호출 (토큰은 브라우저 localStorage에 저장 → 새로고침해도 로그인 유지)
const TOKEN_KEY = "ce_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(t) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장 불가 환경 */
  }
}

let busyCount = 0;
const busyListeners = new Set();
export function onBusy(fn) {
  busyListeners.add(fn);
  return () => busyListeners.delete(fn);
}
function setBusy(delta) {
  busyCount += delta;
  busyListeners.forEach((f) => f(busyCount > 0));
}

// 결과: { ok: true, ... } 또는 { ok: false, error }
export async function api(action, args = {}) {
  setBusy(1);
  try {
    const res = await fetch("/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ action, args }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: `서버 응답 오류 (${res.status})` };
    }
  } catch (e) {
    return { ok: false, error: `네트워크 오류: ${e.message || e}` };
  } finally {
    setBusy(-1);
  }
}

// 로그인 정보 기억하기 (기존 앱의 ce_saved_name / ce_saved_pin 과 같은 키)
export const remember = {
  read() {
    const r = (k) => {
      try {
        return localStorage.getItem(k) || "";
      } catch {
        return "";
      }
    };
    return {
      name: r("ce_saved_name"),
      pin: r("ce_saved_pin"),
      rememberName: r("ce_remember_name") === "1",
      rememberPin: r("ce_remember_pin") === "1",
    };
  },
  write({ name, pin, rememberName, rememberPin }) {
    const w = (k, v) => {
      try {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    };
    if (rememberName && name) {
      w("ce_saved_name", name);
      w("ce_remember_name", "1");
    } else {
      w("ce_saved_name", null);
      w("ce_remember_name", null);
    }
    if (rememberPin && pin) {
      w("ce_saved_pin", pin);
      w("ce_remember_pin", "1");
    } else {
      w("ce_saved_pin", null);
      w("ce_remember_pin", null);
    }
  },
};
