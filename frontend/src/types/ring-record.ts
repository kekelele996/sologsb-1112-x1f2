/** 年龄 */
export type BirdAge = '幼' | '亚成' | '成';

/** 环志状态 */
export type RingStatus = '初捕' | '重捕' | '回收';

/** 环志记录 */
export interface RingRecord {
  id: string;
  /** 金属环号 */
  ringNo: string;
  /** 彩环组合（可空） */
  colorRing: string;
  /** 鸟种中文名 */
  speciesCn: string;
  /** 学名 */
  speciesSci: string;
  /** 年龄 */
  age: BirdAge;
  /** 环志日期 ISO */
  ringDate: string;
  /** 网号 */
  netNo: string;
  /** 网次 */
  netRound: number;
  /** 状态：初捕 / 重捕 / 回收 */
  status: RingStatus;
  /** 环志人 */
  ringer: string;
  /** 鸟点 id */
  siteId: string;
  /** 调查批次 id */
  sessionId: string;
  /** 未测量度原因（关账前逐项确认；补足量度后清空） */
  unmeasuredReason?: string;
  /** 备注 */
  remark?: string;
}

/** 金属环号格式：一般为「环前缀-序号」，如 A-12345 */
export const RING_PREFIXES: string[] = ['A', 'B', 'C', 'D', 'E'];

/** 彩环颜色组合可选值 */
export const COLOR_RING_PRESETS: string[] = ['无', '红-黄', '蓝-白', '绿-橙', '黑-红', '黄-蓝-白'];

export const BIRD_AGES: BirdAge[] = ['幼', '亚成', '成'];
export const RING_STATUSES: RingStatus[] = ['初捕', '重捕', '回收'];

export const STATUS_COLOR: Record<RingStatus, string> = {
  初捕: 'success',
  重捕: 'warning',
  回收: 'danger',
};

/** 未测量度原因预设（可在下拉中自定义补充） */
export const UNMEASURED_REASONS: string[] = ['伤重逃逸', '羽毛污损无法量翅', '个体死亡仅登记环号', '设备故障未及测量', '雨天羽毛湿透未测', '其他'];
