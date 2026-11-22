import type { HwCaps, HwDeviceStatus } from '../../../../packages/shared/src/hardware.ts';
import type { Database } from '../db.ts';
import { json } from '../db.ts';

/** 硬件设备的持久化记录。令牌只保存 sha256，明文仅在签发那一刻返回给设备。 */
export interface HwDeviceRecord {
  id: string;
  installationId: string;
  model: string;
  firmware: string;
  tokenHash: string;
  pairCode: string | null;
  pairExpiresAt: string | null;
  userId: string | null;
  name: string;
  caps: HwCaps;
  status: HwDeviceStatus;
  lastSeenAt: string | null;
  lastIp: string | null;
  createdAt: string;
}

/**
 * 网关只依赖这个接口，不直接写 SQL，因此可以用内存实现跑完整的协议测试。
 * 生产实现见 createSqlHardwareStore。
 */
export interface HardwareStore {
  create(input: { id: string; installationId: string; model: string; firmware: string; caps: HwCaps; tokenHash: string; pairCode: string; pairExpiresAt: string; name: string }): Promise<HwDeviceRecord>;
  findByInstallation(installationId: string): Promise<HwDeviceRecord | null>;
  findById(id: string): Promise<HwDeviceRecord | null>;
  findByTokenHash(tokenHash: string): Promise<HwDeviceRecord | null>;
  findByPairCode(code: string): Promise<HwDeviceRecord | null>;
  countBound(userId: string): Promise<number>;
  /** 重新烧录后的重新登记：已绑定设备保留绑定关系，其余回到待配对状态。 */
  rebind(id: string, input: { model: string; firmware: string; caps: HwCaps; tokenHash: string; pairCode: string; pairExpiresAt: string }): Promise<HwDeviceRecord | null>;
  bind(id: string, userId: string, name: string): Promise<HwDeviceRecord | null>;
  revoke(id: string, replacementTokenHash: string): Promise<void>;
  listByUser(userId: string): Promise<HwDeviceRecord[]>;
  touch(id: string, ip: string, firmware: string, caps: HwCaps): Promise<void>;
  expireStale(before: string): Promise<number>;
  recordEvent(input: { id: string; deviceId: string; kind: string; payload: unknown; accepted: boolean; message: string }): Promise<void>;
  openSession(input: { id: string; deviceId: string; userId: string; gameSessionId: string | null }): Promise<void>;
  closeSessions(deviceId: string): Promise<void>;
}

interface HwRow {
  id: string;
  installation_id: string;
  model: string;
  firmware: string;
  token_hash: string;
  pair_code: string | null;
  pair_expires_at: string | null;
  user_id: string | null;
  name: string;
  caps: HwCaps | string;
  status: HwDeviceStatus;
  last_seen_at: string | null;
  last_ip: string | null;
  created_at: string;
}

function toRecord(row: HwRow): HwDeviceRecord {
  return {
    id: row.id,
    installationId: row.installation_id,
    model: row.model,
    firmware: row.firmware,
    tokenHash: row.token_hash,
    pairCode: row.pair_code,
    pairExpiresAt: row.pair_expires_at,
    userId: row.user_id,
    name: row.name,
    caps: json(row.caps),
    status: row.status,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    createdAt: row.created_at,
  };
}

export function createSqlHardwareStore(db: Database): HardwareStore {
  return {
    async create(input) {
      await db.execute(
        "INSERT INTO hw_devices(id,installation_id,model,firmware,token_hash,pair_code,pair_expires_at,name,caps,status) VALUES(?,?,?,?,?,?,?,?,?,'pending')",
        [input.id, input.installationId, input.model, input.firmware, input.tokenHash, input.pairCode, input.pairExpiresAt, input.name, JSON.stringify(input.caps)],
      );
      const rows = await db.query<HwRow>('SELECT * FROM hw_devices WHERE id=?', [input.id]);
      return toRecord(rows[0]!);
    },
    async findByInstallation(installationId) {
      const rows = await db.query<HwRow>('SELECT * FROM hw_devices WHERE installation_id=?', [installationId]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findById(id) {
      const rows = await db.query<HwRow>('SELECT * FROM hw_devices WHERE id=?', [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findByTokenHash(tokenHash) {
      const rows = await db.query<HwRow>("SELECT * FROM hw_devices WHERE token_hash=? AND status<>'revoked'", [tokenHash]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findByPairCode(code) {
      const rows = await db.query<HwRow>("SELECT * FROM hw_devices WHERE pair_code=? AND status='pending'", [code]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async countBound(userId) {
      const rows = await db.query<{ total: number }>("SELECT COUNT(*) AS total FROM hw_devices WHERE user_id=? AND status='bound'", [userId]);
      return Number(rows[0]?.total ?? 0);
    },
    async rebind(id, input) {
      const before = await db.query<HwRow>('SELECT * FROM hw_devices WHERE id=?', [id]);
      const current = before[0];
      if (!current) return null;
      if (current.status === 'bound' && current.user_id) {
        await db.execute('UPDATE hw_devices SET model=?,firmware=?,caps=?,token_hash=?,pair_code=NULL,pair_expires_at=NULL WHERE id=?', [input.model, input.firmware, JSON.stringify(input.caps), input.tokenHash, id]);
      } else {
        await db.execute("UPDATE hw_devices SET model=?,firmware=?,caps=?,token_hash=?,pair_code=?,pair_expires_at=?,status='pending',user_id=NULL WHERE id=?", [input.model, input.firmware, JSON.stringify(input.caps), input.tokenHash, input.pairCode, input.pairExpiresAt, id]);
      }
      const rows = await db.query<HwRow>('SELECT * FROM hw_devices WHERE id=?', [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async bind(id, userId, name) {      await db.execute("UPDATE hw_devices SET user_id=?,name=?,status='bound',pair_code=NULL,pair_expires_at=NULL WHERE id=? AND status='pending'", [userId, name, id]);
      const rows = await db.query<HwRow>('SELECT * FROM hw_devices WHERE id=?', [id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },
    async revoke(id, replacementTokenHash) {
      await db.execute("UPDATE hw_devices SET status='revoked',token_hash=?,pair_code=NULL,pair_expires_at=NULL WHERE id=?", [replacementTokenHash, id]);
      await db.execute("UPDATE hw_sessions SET closed_at=UTC_TIMESTAMP(3) WHERE device_id=? AND closed_at IS NULL", [id]);
    },
    async listByUser(userId) {
      const rows = await db.query<HwRow>("SELECT * FROM hw_devices WHERE user_id=? AND status='bound' ORDER BY created_at", [userId]);
      return rows.map(toRecord);
    },
    async touch(id, ip, firmware, caps) {
      await db.execute('UPDATE hw_devices SET last_seen_at=UTC_TIMESTAMP(3),last_ip=?,firmware=?,caps=? WHERE id=?', [ip, firmware, JSON.stringify(caps), id]);
    },
    async expireStale(before) {
      const result = await db.execute("UPDATE hw_devices SET status='revoked' WHERE status='pending' AND created_at<?", [before]);
      return result.affectedRows;
    },
    async recordEvent(input) {
      await db.execute('INSERT INTO hw_events(id,device_id,kind,payload,accepted,message) VALUES(?,?,?,?,?,?)', [input.id, input.deviceId, input.kind, JSON.stringify(input.payload), input.accepted, input.message.slice(0, 300)]);
    },
    async openSession(input) {
      await db.execute('INSERT INTO hw_sessions(id,device_id,user_id,game_session_id) VALUES(?,?,?,?)', [input.id, input.deviceId, input.userId, input.gameSessionId]);
    },
    async closeSessions(deviceId) {
      await db.execute('UPDATE hw_sessions SET closed_at=UTC_TIMESTAMP(3) WHERE device_id=? AND closed_at IS NULL', [deviceId]);
    },
  };
}
