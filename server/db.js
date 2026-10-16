// MongoDB 연결 + 기존 Streamlit(db.py) 저장 방식과 100% 호환되는 헬퍼
// - 문서 _id는 ObjectId가 아니라 "문자열"로 저장 (기존 데이터와 동일)
// - 중첩 dict 키의 '.', '$'는 전각 문자로 치환 (기존 _normalize_dict_key와 동일)
import { MongoClient, ObjectId } from "mongodb";
import { curGroup } from "./group.js";

let _clientPromise = null;
let _db = null;

export async function getDb() {
  if (_db) return _db;
  const uri = String(process.env.MONGO_URI || "").trim();
  if (!uri) throw new Error("MONGO_URI 환경변수가 설정되지 않았습니다. (Vercel > Settings > Environment Variables)");
  const dbName = String(process.env.MONGO_DB_NAME || "class_point_app").trim() || "class_point_app";
  if (!_clientPromise) {
    const client = new MongoClient(uri, { maxPoolSize: 10 });
    _clientPromise = client.connect();
  }
  const client = await _clientPromise;
  _db = client.db(dbName);
  ensureIndexes(_db);
  return _db;
}

// 조회를 빠르게 하는 색인 (데이터는 바꾸지 않음, 이미 있으면 아무 일도 안 함). 응답을 기다리게 하지 않음
function ensureIndexes(db) {
  const list = [
    ["transactions", { student_id: 1, created_at: -1 }],
    ["transactions", { created_at: -1 }],
    ["savings", { student_id: 1 }],
    ["savings", { status: 1 }],
    ["invest_ledger", { student_id: 1 }],
    ["invest_price_history", { product_id: 1 }],
    ["stat_submissions", { created_at: -1 }],
    ["treasury_ledger", { created_at: -1 }],
    ["credit_adjustments", { created_at: -1 }],
    ["lottery_entries", { round_id: 1 }],
    ["auction_bids", { round_id: 1 }],
    ["deposit_requests", { status: 1 }],
    ["mart_requests", { status: 1 }],
  ];
  for (const [c, key] of list) db.collection(c).createIndex(key).catch(() => {});
}

export function newId() {
  return new ObjectId().toHexString();
}

export function encKey(key) {
  return String(key).replace(/\./g, "．").replace(/\$/g, "＄").replace(/\x00/g, "�");
}

export function decKey(key) {
  return String(key).replace(/．/g, ".").replace(/＄/g, "$").replace(/�/g, "");
}

export function normalizeValue(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[encKey(k)] = normalizeValue(val);
    return out;
  }
  return v;
}

export function normalizePayload(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) out[k] = normalizeValue(v);
  return out;
}

// 새로 만드는 기록에 묶음 번호(grp)를 붙일 컬렉션 (로그기록 묶음·되돌리기용)
const GROUPED = new Set(["transactions", "treasury_ledger", "savings", "mart_ledger", "invest_ledger", "payroll_log", "auction_bids", "credit_adjustments", "audit_log", "invest_price_history", "mart_requests", "deposit_requests"]);
function withGroup(name, doc) {
  const g = GROUPED.has(name) ? curGroup() : null;
  return g && !doc.grp ? { ...doc, grp: g } : doc;
}

// Firestore 스타일 래퍼(기존 코드 흐름을 그대로 옮기기 쉽게)
export function col(db, name) {
  const c = db.collection(name);
  return {
    raw: c,
    async get(id) {
      return await c.findOne({ _id: String(id) });
    },
    async set(id, data, merge = false) {
      const payload = normalizePayload(data);
      if (merge) {
        await c.updateOne({ _id: String(id) }, { $set: payload }, { upsert: true });
      } else {
        await c.replaceOne({ _id: String(id) }, { ...payload, _id: String(id) }, { upsert: true });
      }
    },
    async add(data) {
      const id = newId();
      await c.insertOne(withGroup(name, { ...normalizePayload(data), _id: id }));
      return id;
    },
    async create(id, data) {
      // 이미 있으면 false (AlreadyExists)
      try {
        await c.insertOne(withGroup(name, { ...normalizePayload(data), _id: String(id) }));
        return true;
      } catch (e) {
        if (e && e.code === 11000) return false;
        throw e;
      }
    },
    async update(id, data) {
      await c.updateOne({ _id: String(id) }, { $set: normalizePayload(data) });
    },
    async updateIf(id, condition, data) {
      const r = await c.updateOne({ _id: String(id), ...condition }, { $set: normalizePayload(data) });
      return r.modifiedCount > 0;
    },
    async del(id) {
      await c.deleteOne({ _id: String(id) });
    },
    async find(query = {}, { sort = null, limit = 0 } = {}) {
      let cur = c.find(query);
      if (sort) cur = cur.sort(sort);
      if (limit) cur = cur.limit(limit);
      return await cur.toArray();
    },
  };
}
