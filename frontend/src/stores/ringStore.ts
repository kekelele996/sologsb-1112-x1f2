import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { BirdAge, RingRecord, RingStatus } from '../types/ring-record';
import { useSessionStore } from './sessionStore';

/** 批次已关账时，其下环志记录只读（页面层已禁用入口，此处为兜底拦截） */
function sessionLocked(sessionId: string): boolean {
  return useSessionStore().byId(sessionId)?.closed ?? false;
}

export interface RingInput {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate?: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark?: string;
}

interface RingState {
  rings: RingRecord[];
  /** 环号重复时命中的历史记录 id */
  duplicateId: string;
  hydrated: boolean;
}

/** 环志记录与查重结果 */
export const useRingStore = defineStore('ring', {
  state: (): RingState => ({ rings: [], duplicateId: '', hydrated: false }),

  getters: {
    findByRingNo(state) {
      return (ringNo: string): RingRecord | undefined =>
        state.rings.find((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase());
    },
    /** 同一环号的全部历史记录（含重捕 / 回收） */
    historyOf(state) {
      return (ringNo: string): RingRecord[] =>
        state.rings
          .filter((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase())
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate));
    },
    duplicate(state): RingRecord | undefined {
      return state.rings.find((record) => record.id === state.duplicateId);
    },
  },

  actions: {
    async hydrate() {
      this.rings = await db.rings.orderBy('ringDate').reverse().toArray();
      this.hydrated = true;
    },

    setDuplicate(id: string) {
      this.duplicateId = id;
    },

    /** 新增环志记录：环号已存在时返回命中的历史记录，由页面提示并跳转 */
    async addRing(input: RingInput): Promise<{ record?: RingRecord; duplicate?: RingRecord }> {
      if (sessionLocked(input.sessionId)) {
        console.warn('[ringStore] 批次已关账，拒绝新增环志记录');
        return {};
      }
      const existed = this.findByRingNo(input.ringNo);
      if (existed) {
        this.duplicateId = existed.id;
        return { duplicate: existed };
      }
      const record: RingRecord = {
        id: uid('ring'),
        ringNo: input.ringNo.trim(),
        colorRing: input.colorRing || '无',
        speciesCn: input.speciesCn.trim(),
        speciesSci: input.speciesSci.trim(),
        age: input.age,
        ringDate: input.ringDate ?? new Date().toISOString(),
        netNo: input.netNo.trim(),
        netRound: Number(input.netRound) || 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        sessionId: input.sessionId,
        remark: input.remark?.trim() || undefined,
      };
      await db.rings.put(toPlain(record));
      this.rings = [record, ...this.rings];
      this.duplicateId = '';
      return { record };
    },

    async updateRing(id: string, patch: Partial<RingInput>) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      // 已关账批次的记录只读；也不允许把记录挪入已关账批次
      if (sessionLocked(current.sessionId) || (patch.sessionId && sessionLocked(patch.sessionId))) {
        console.warn('[ringStore] 批次已关账，拒绝修改环志记录');
        return;
      }
      const next: RingRecord = { ...current, ...patch };
      await db.rings.put(toPlain(next));
      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },

    async removeRing(id: string) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      if (sessionLocked(current.sessionId)) {
        console.warn('[ringStore] 批次已关账，拒绝删除环志记录');
        return;
      }
      await db.rings.delete(id);
      this.rings = this.rings.filter((record) => record.id !== id);
    },

    /** 关账前检查：为未量度个体登记未测原因（确认后该个体视为已处理） */
    async setUnmeasuredReason(id: string, reason: string) {
      const current = this.rings.find((record) => record.id === id);
      if (!current || sessionLocked(current.sessionId)) return;
      const trimmed = reason.trim();
      const next: RingRecord = { ...current, unmeasuredReason: trimmed || undefined };
      await db.rings.put(toPlain(next));
      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },
  },
});
