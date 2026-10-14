// MongoDB 연결 + 기존 Streamlit(db.py) 저장 방식과 100% 호환되는 헬퍼
// - 문서 _id는 ObjectId가 아니라 "문자열"로 저장 (기존 데이터와 동일)
// - 중첩 dict 키의 '.', '$'는 전각 문자로 치환 (기존 _normalize_dict_key와 동일)
import { MongoClient, ObjectId } from "mongodb";

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
  return _db;
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
      await c.insertOne({ ...normalizePayload(data), _id: id });
      return id;
    },
    async create(id, data) {
      // 이미 있으면 false (AlreadyExists)
      try {
        await c.insertOne({ ...normalizePayload(data), _id: String(id) });
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
