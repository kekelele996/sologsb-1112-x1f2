import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { Morphometrics } from '../types/morphometrics';
import type { RingRecord } from '../types/ring-record';
import type { SurveySession } from '../types/session';
import { buildClosedSnapshot, pendingRingsOfSession } from '../utils/stats';

export interface SessionInput {
  sessionNo: string;
  date: string;
  siteId: string;
  startedAt: string;
  endedAt: string;
  netRounds: number;
  cloudCover: number;
  windForce: number;
  leader: string;
  remark?: string;
}

interface SessionState {
  sessions: SurveySession[];
  hydrated: boolean;
}

/** 调查批次与统计派生值 */
export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({ sessions: [], hydrated: false }),

  getters: {
    byId(state) {
      return (id: string): SurveySession | undefined => state.sessions.find((session) => session.id === id);
    },
    isClosed() {
      return (id: string): boolean => Boolean(this.byId(id)?.closed);
    },
    sessionOptions(state): Array<{ label: string; value: string }> {
      return state.sessions.map((session) => ({
        label: `${session.sessionNo} · ${session.date} · ${session.closed ? '已关账' : '进行中'}`,
        value: session.id,
      }));
    },
    openSessions(state): SurveySession[] {
      return state.sessions.filter((session) => !session.closed);
    },
  },

  actions: {
    async hydrate() {
      this.sessions = await db.sessions.orderBy('date').reverse().toArray();
      this.hydrated = true;
    },

    /** 关账后批次只读：环志、量度与批次本身的写操作统一在此拦截 */
    assertOpen(sessionId: string) {
      const session = this.sessions.find((item) => item.id === sessionId);
      if (session?.closed) {
        throw new Error(`批次 ${session.sessionNo} 已关账，关账后环志与量度只读`);
      }
    },

    async addSession(input: SessionInput): Promise<SurveySession> {
      const session: SurveySession = {
        id: uid('session'),
        sessionNo: input.sessionNo.trim(),
        date: input.date,
        siteId: input.siteId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        netRounds: Number(input.netRounds) || 0,
        cloudCover: Number(input.cloudCover) || 0,
        windForce: Number(input.windForce) || 0,
        closed: false,
        leader: input.leader.trim(),
        remark: input.remark?.trim() || undefined,
      };
      await db.sessions.put(toPlain(session));
      this.sessions = [session, ...this.sessions];
      return session;
    },

    async updateSession(id: string, patch: Partial<SessionInput>) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      this.assertOpen(id);
      const next: SurveySession = { ...current, ...patch };
      await db.sessions.put(toPlain(next));
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    /**
     * 关账：必须先完成关账前检查（每个个体已量度或已填未测原因）。
     * 关账时把鸟种数、初捕、重捕、回收及量度情况固定为快照，之后补录不再影响本批统计。
     */
    async closeSession(id: string, records: RingRecord[], morphs: Morphometrics[]) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      if (current.closed) {
        throw new Error(`批次 ${current.sessionNo} 已关账，不能重复关账`);
      }
      const pending = pendingRingsOfSession(id, records, morphs);
      if (pending.length > 0) {
        throw new Error(`还有 ${pending.length} 个个体既无量度也未填未测原因，无法关账`);
      }
      const next: SurveySession = {
        ...current,
        closed: true,
        closedAt: new Date().toISOString(),
        closedStats: buildClosedSnapshot(id, records, morphs),
        endedAt: current.endedAt || new Date().toTimeString().slice(0, 5),
      };
      await db.sessions.put(toPlain(next));
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
      return next;
    },

    async removeSession(id: string) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      if (current.closed) {
        throw new Error(`批次 ${current.sessionNo} 已关账，不能删除`);
      }
      await db.sessions.delete(id);
      this.sessions = this.sessions.filter((session) => session.id !== id);
    },
  },
});
