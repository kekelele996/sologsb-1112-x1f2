<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useSessionStore } from '../stores/sessionStore';
import { useSiteStore } from '../stores/siteStore';
import { useRingStore } from '../stores/ringStore';
import { useMeasureStore } from '../stores/measureStore';
import { STATUS_COLOR, UNMEASURED_REASONS, type RingRecord, type RingStatus } from '../types/ring-record';
import { cloudText, type SessionStats, type SurveySession } from '../types/session';
import {
  buildSessionStats,
  measuredRingIds,
  pendingRingsOfSession,
  ringsOfSession,
  unmeasuredRingsOfSession,
} from '../utils/stats';
import { formatDateTime } from '../utils/format';

const route = useRoute();
const sessionStore = useSessionStore();
const siteStore = useSiteStore();
const ringStore = useRingStore();
const measureStore = useMeasureStore();

const dialogVisible = ref(false);
const editingId = ref('');
// 批次统计弹窗的开关：仅在选中记录时为字符串 id，关闭时为 null。
// 注意不要用空字符串占位——el-dialog 的 v-model 期望布尔值，非空字符串会被判定为打开。
const detailId = ref<string | null>(null);
// 关账前检查弹窗：仅在选中进行中批次时为字符串 id
const precloseId = ref<string | null>(null);
// 批量填写未测原因
const batchReason = ref('');
const saving = ref(false);
const formRef = ref<FormInstance>();

interface SessionForm {
  sessionNo: string;
  date: string;
  siteId: string;
  startedAt: string;
  endedAt: string;
  netRounds: number;
  cloudCover: number;
  windForce: number;
  leader: string;
  remark: string;
}

const form = ref<SessionForm>({
  sessionNo: '',
  date: new Date().toISOString().slice(0, 10),
  siteId: '',
  startedAt: '05:00',
  endedAt: '11:00',
  netRounds: 6,
  cloudCover: 2,
  windForce: 2,
  leader: '',
  remark: '',
});

const rules: FormRules = {
  sessionNo: [{ required: true, message: '请输入批次号', trigger: 'blur' }],
  leader: [{ required: true, message: '请输入主调查人', trigger: 'blur' }],
};

const siteParam = computed(() => (typeof route.query.site === 'string' ? route.query.site : ''));
const closedParam = computed(() => (typeof route.query.closed === 'string' ? route.query.closed : ''));

/** 已关账批次取关账快照，进行中批次取实时统计 */
const statsList = computed<SessionStats[]>(() =>
  sessionStore.sessions
    .map((session) => buildSessionStats(session, ringStore.rings, siteStore.siteName(session.siteId)))
    .filter((item) => {
      if (siteParam.value && siteStore.siteName(item.session.siteId) !== siteParam.value) return false;
      if (closedParam.value === '已关闭' && !item.session.closed) return false;
      if (closedParam.value === '进行中' && item.session.closed) return false;
      return true;
    }),
);

const measuredIds = computed(() => measuredRingIds(measureStore.morphs));

/** 各批次关账前检查进度：还差 / 未测（含已填原因）/ 总数 */
function pendingCountOf(session: SurveySession): number {
  return pendingRingsOfSession(session.id, ringStore.rings, measureStore.morphs).length;
}
function unmeasuredCountOf(session: SurveySession): number {
  return unmeasuredRingsOfSession(session.id, ringStore.rings, measureStore.morphs).length;
}

const closedCount = computed(() => sessionStore.sessions.filter((session) => session.closed).length);
const averageRecapture = computed(() => {
  const list = statsList.value;
  if (list.length === 0) return 0;
  return Number((list.reduce((sum, item) => sum + item.recaptureRate, 0) / list.length).toFixed(1));
});
const totalSpecies = computed(() => new Set(ringStore.rings.map((record) => record.speciesCn)).size);

const detail = computed(() => statsList.value.find((item) => item.session.id === detailId.value));

/** 关账前检查弹窗对应的批次 */
const precloseSession = computed(() =>
  precloseId.value ? sessionStore.byId(precloseId.value) : undefined,
);

interface ChecklistRow {
  ring: RingRecord;
  measured: boolean;
  pending: boolean;
}

/** 关账前检查清单：逐个列出该批环志，标出已量度 / 已填未测原因 / 待处理 */
const checklistRows = computed<ChecklistRow[]>(() => {
  if (!precloseId.value) return [];
  return ringsOfSession(precloseId.value, ringStore.rings).map((ring) => {
    const measured = measuredIds.value.has(ring.id);
    return { ring, measured, pending: !measured && !ring.unmeasuredReason };
  });
});
const checklistPending = computed(() => checklistRows.value.filter((row) => row.pending));
const checklistUnmeasured = computed(() => checklistRows.value.filter((row) => !row.measured));

/** 关账时将固定下来的统计预览（实时计算，与快照口径一致） */
const precloseStats = computed(() =>
  precloseSession.value
    ? buildSessionStats(precloseSession.value, ringStore.rings, siteStore.siteName(precloseSession.value.siteId))
    : undefined,
);

/** 详情弹窗里的未量度个体（已关账：只读展示关账时确认的原因；进行中：可看到处理进度） */
const detailUnmeasured = computed(() => {
  if (!detail.value) return [];
  return unmeasuredRingsOfSession(detail.value.session.id, ringStore.rings, measureStore.morphs);
});

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = {
    sessionNo: `2024-${String.fromCharCode(65 + Math.floor(sessionStore.sessions.length / 9))}${String((sessionStore.sessions.length % 9) + 1).padStart(2, '0')}`,
    date: new Date().toISOString().slice(0, 10),
    siteId: siteStore.sites[0]?.id ?? '',
    startedAt: '05:00',
    endedAt: '11:00',
    netRounds: 6,
    cloudCover: 2,
    windForce: 2,
    leader: '韩雪',
    remark: '',
  };
  dialogVisible.value = true;
}

function openEdit(session: SurveySession) {
  editingId.value = session.id;
  form.value = {
    sessionNo: session.sessionNo,
    date: session.date,
    siteId: session.siteId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    netRounds: session.netRounds,
    cloudCover: session.cloudCover,
    windForce: session.windForce,
    leader: session.leader,
    remark: session.remark ?? '',
  };
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const payload = {
    sessionNo: form.value.sessionNo,
    date: form.value.date,
    siteId: form.value.siteId,
    startedAt: form.value.startedAt,
    endedAt: form.value.endedAt,
    netRounds: Number(form.value.netRounds) || 0,
    cloudCover: Number(form.value.cloudCover) || 0,
    windForce: Number(form.value.windForce) || 0,
    leader: form.value.leader,
    remark: form.value.remark,
  };
  try {
    if (editingId.value) {
      await sessionStore.updateSession(editingId.value, payload);
      ElMessage.success(`已更新批次 ${payload.sessionNo}`);
    } else {
      await sessionStore.addSession(payload);
      ElMessage.success(`已新建批次 ${payload.sessionNo}`);
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/** 打开关账前检查：逐个确认未量度个体 */
function openPreclose(session: SurveySession) {
  precloseId.value = session.id;
  batchReason.value = '';
}

/** 弹窗点遮罩 / 右上角关闭时（el-dialog 回传 false）清掉批次 id */
function onPrecloseVisible(value: boolean) {
  if (!value) precloseId.value = null;
}

function goPrecloseFromDetail() {
  const session = detail.value?.session;
  detailId.value = null;
  if (session) openPreclose(session);
}

async function saveReason(row: ChecklistRow, reason: string) {
  saving.value = true;
  try {
    await ringStore.setUnmeasuredReason(row.ring.id, reason);
    ElMessage.success(`已登记 ${row.ring.ringNo} 的未测原因`);
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

async function applyBatchReason() {
  const reason = batchReason.value.trim();
  if (!reason) {
    ElMessage.warning('请先选择或填写未测原因');
    return;
  }
  const pendingRows = checklistPending.value;
  if (pendingRows.length === 0) {
    ElMessage.info('没有待处理的个体');
    return;
  }
  saving.value = true;
  try {
    for (const row of pendingRows) {
      await ringStore.setUnmeasuredReason(row.ring.id, reason);
    }
    ElMessage.success(`已为 ${pendingRows.length} 个个体批量登记未测原因`);
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    saving.value = false;
  }
}

/** 全部处理完才允许关账；关账时固定鸟种数、初捕、重捕与回收 */
async function confirmClose() {
  const session = precloseSession.value;
  const stats = precloseStats.value;
  if (!session || !stats) return;
  if (checklistPending.value.length > 0) return;
  const confirmed = await ElMessageBox.confirm(
    `关账后 ${session.sessionNo} 的环志与量度将只读，统计固定为：鸟种 ${stats.speciesCount} 种、初捕 ${stats.firstCount}、重捕 ${stats.recaptureCount}、回收 ${stats.recoveryCount}。确认关账？`,
    '确认关账',
    { type: 'warning' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  try {
    await sessionStore.closeSession(session.id, ringStore.rings, measureStore.morphs);
    ElMessage.success(`批次 ${session.sessionNo} 已关账，统计已固定`);
    precloseId.value = null;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function remove(session: SurveySession) {
  if (session.closed) {
    ElMessage.warning(`批次 ${session.sessionNo} 已关账，关账后记录只读，不能删除`);
    return;
  }
  const confirmed = await ElMessageBox.confirm(`确认删除批次 ${session.sessionNo}？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  try {
    await sessionStore.removeSession(session.id);
    ElMessage.success('已删除');
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}
</script>

<template>
  <div>
    <h2 class="page-title">调查批次与观测条件</h2>
    <p class="page-desc">登记批次号、鸟点、起止时间与云量风力；关账前逐个确认未量度个体，关账后固定鸟种数、初捕、重捕与回收，环志与量度只读。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新建批次</el-button>
      <el-tag type="info" effect="plain">批次 {{ sessionStore.sessions.length }} 个 · 已关账 {{ closedCount }} 个</el-tag>
    </div>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="调查批次" :value="sessionStore.sessions.length" unit="批" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="进行中" :value="sessionStore.sessions.length - closedCount" unit="批" status="warning" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="平均重捕率" :value="averageRecapture" unit="%" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="累计鸟种" :value="totalSpecies" unit="种" />
      </el-col>
    </el-row>

    <FilterBar
      :fields="[
        { key: 'site', label: '鸟点', options: siteStore.sites.map((s) => s.name), width: 150 },
        { key: 'closed', label: '状态', options: ['已关账', '进行中'], width: 110 },
      ]"
      keyword-placeholder="搜索批次号 / 主调查人"
      :result-count="statsList.length"
      :total-count="sessionStore.sessions.length"
    />

    <EmptyPanel v-if="statsList.length === 0" description="没有符合条件的调查批次" action-text="新建批次" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="statsList" size="small" border>
        <el-table-column label="批次号" width="120">
          <template #default="scope">{{ scope.row.session.sessionNo }}</template>
        </el-table-column>
        <el-table-column label="日期" width="110">
          <template #default="scope">{{ scope.row.session.date }}</template>
        </el-table-column>
        <el-table-column label="鸟点" width="150">
          <template #default="scope">{{ scope.row.siteName }}</template>
        </el-table-column>
        <el-table-column label="起止时间" width="120">
          <template #default="scope">{{ scope.row.session.startedAt }}~{{ scope.row.session.endedAt }}</template>
        </el-table-column>
        <el-table-column label="网次" width="70" align="right">
          <template #default="scope">{{ scope.row.session.netRounds }}</template>
        </el-table-column>
        <el-table-column label="观测条件" width="140">
          <template #default="scope">
            {{ cloudText(scope.row.session.cloudCover) }}（云量 {{ scope.row.session.cloudCover }}）· {{ scope.row.session.windForce }} 级风
          </template>
        </el-table-column>
        <el-table-column label="鸟种数" width="80" align="right">
          <template #default="scope">{{ scope.row.speciesCount }}</template>
        </el-table-column>
        <el-table-column label="初捕 / 重捕 / 回收" width="150">
          <template #default="scope">{{ scope.row.firstCount }} / {{ scope.row.recaptureCount }} / {{ scope.row.recoveryCount }}</template>
        </el-table-column>
        <el-table-column label="重捕率" width="90" align="right">
          <template #default="scope">{{ scope.row.recaptureRate }}%</template>
        </el-table-column>
        <el-table-column label="未量度" width="100" align="center">
          <template #default="scope">
            <el-tag v-if="unmeasuredCountOf(scope.row.session) === 0" type="success" size="small">齐</el-tag>
            <el-tooltip
              v-else
              :content="scope.row.session.closed ? '关账时已确认未测原因，见详情' : `还差 ${pendingCountOf(scope.row.session)} 个未填原因`"
              placement="top"
            >
              <el-tag :type="scope.row.session.closed || pendingCountOf(scope.row.session) === 0 ? 'info' : 'danger'" size="small">
                {{ unmeasuredCountOf(scope.row.session) }} 只
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="scope.row.session.closed ? 'success' : 'warning'" size="small">
              {{ scope.row.session.closed ? '已关账' : '进行中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="detailId = scope.row.session.id">详情</el-button>
            <el-button v-if="!scope.row.session.closed" link type="warning" @click="openPreclose(scope.row.session)">关账检查</el-button>
            <el-button v-if="!scope.row.session.closed" link type="primary" @click="openEdit(scope.row.session)">编辑</el-button>
            <el-button link type="danger" @click="remove(scope.row.session)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑调查批次' : '新建调查批次'" width="620px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="批次号" prop="sessionNo">
          <el-input v-model="form.sessionNo" placeholder="如：2024-A05" maxlength="20" />
        </el-form-item>
        <el-form-item label="调查日期">
          <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="鸟点">
          <el-select v-model="form.siteId" style="width: 260px">
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="`${site.siteNo} · ${site.name}`" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="开始 / 结束">
          <el-time-picker v-model="form.startedAt" value-format="HH:mm" placeholder="开始时间" style="width: 130px" />
          <span style="margin: 0 8px">~</span>
          <el-time-picker v-model="form.endedAt" value-format="HH:mm" placeholder="结束时间" style="width: 130px" />
        </el-form-item>
        <el-form-item label="计划网次">
          <el-input-number v-model="form.netRounds" :min="1" :max="20" placeholder="网次" />
        </el-form-item>
        <el-form-item label="云量(0~10)">
          <el-input-number v-model="form.cloudCover" :min="0" :max="10" placeholder="云量" />
        </el-form-item>
        <el-form-item label="风力(级)">
          <el-input-number v-model="form.windForce" :min="0" :max="12" placeholder="风力" />
        </el-form-item>
        <el-form-item label="主调查人" prop="leader">
          <el-input v-model="form.leader" style="width: 160px" maxlength="16" placeholder="如：韩雪" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="60" placeholder="观测条件变化、网次调整等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 关账前检查：逐个列出还没有量度的环志，可填写未测原因；全部处理完才能关账 -->
    <el-dialog
      :model-value="precloseId !== null"
      :title="`关账前检查 · ${precloseSession?.sessionNo ?? ''}`"
      width="860px"
      :close-on-click-modal="false"
      @update:model-value="onPrecloseVisible"
    >
      <template v-if="precloseSession && precloseStats">
        <el-alert
          v-if="checklistPending.length > 0"
          type="error"
          show-icon
          :closable="false"
          class="check-alert"
          :title="`还有 ${checklistPending.length} 个个体未处理：${checklistPending.map((row) => row.ring.ringNo).join('、')}`"
          description="请为每个未量度个体补录量度，或在下方填写未测原因后再关账。"
        />
        <el-alert
          v-else
          type="success"
          show-icon
          :closable="false"
          class="check-alert"
          title="本批个体已全部处理，可以关账"
          :description="`共 ${checklistRows.length} 只，已量度 ${checklistRows.length - checklistUnmeasured.length} 只，未测已填原因 ${checklistUnmeasured.length} 只。`"
        />

        <div class="batch-row">
          <span class="batch-label">批量填写未测原因：</span>
          <el-select
            v-model="batchReason"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入原因"
            style="width: 240px"
          >
            <el-option v-for="reason in UNMEASURED_REASONS" :key="reason" :label="reason" :value="reason" />
          </el-select>
          <el-button :disabled="saving || checklistPending.length === 0" @click="applyBatchReason">
            填入剩余 {{ checklistPending.length }} 只
          </el-button>
          <el-tag type="info" effect="plain" class="batch-hint">补录量度后原因会自动清除</el-tag>
        </div>

        <el-table :data="checklistRows" size="small" border max-height="340">
          <el-table-column label="环号" width="110">
            <template #default="scope">{{ scope.row.ring.ringNo }}</template>
          </el-table-column>
          <el-table-column label="鸟种" width="110">
            <template #default="scope">{{ scope.row.ring.speciesCn }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="scope">
              <el-tag :type="STATUS_COLOR[scope.row.ring.status as RingStatus]" size="small">{{ scope.row.ring.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="网号 / 网次" width="120">
            <template #default="scope">{{ scope.row.ring.netNo }} · {{ scope.row.ring.netRound }}</template>
          </el-table-column>
          <el-table-column label="量度情况" min-width="260">
            <template #default="scope">
              <el-tag v-if="scope.row.measured" type="success" size="small">已量度</el-tag>
              <div v-else class="reason-cell">
                <el-select
                  :model-value="scope.row.ring.unmeasuredReason ?? ''"
                  filterable
                  allow-create
                  default-first-option
                  :placeholder="scope.row.pending ? '选择 / 输入未测原因' : ''"
                  :disabled="saving"
                  style="width: 220px"
                  @change="(value: string) => saveReason(scope.row, value)"
                >
                  <el-option v-for="reason in UNMEASURED_REASONS" :key="reason" :label="reason" :value="reason" />
                </el-select>
                <el-tag v-if="!scope.row.pending" type="info" size="small">已确认</el-tag>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <el-descriptions :column="4" border size="small" class="snapshot-preview">
          <el-descriptions-item label="鸟种数">{{ precloseStats.speciesCount }} 种</el-descriptions-item>
          <el-descriptions-item label="初捕">{{ precloseStats.firstCount }}</el-descriptions-item>
          <el-descriptions-item label="重捕">{{ precloseStats.recaptureCount }}</el-descriptions-item>
          <el-descriptions-item label="回收">{{ precloseStats.recoveryCount }}</el-descriptions-item>
        </el-descriptions>
        <p class="snapshot-note">以上统计将在关账时固定，之后补录环志或量度不再改变本批数字。</p>
      </template>
      <template #footer>
        <el-button @click="precloseId = null">取消</el-button>
        <el-button
          type="warning"
          :disabled="!precloseSession || checklistPending.length > 0"
          @click="confirmClose"
        >
          {{ checklistPending.length > 0 ? `还差 ${checklistPending.length} 只未处理` : '确认关账' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-if="detailId"
      :model-value="true"
      :title="`批次详情 · ${detail?.session.sessionNo ?? ''}`"
      width="640px"
      @close="detailId = null"
    >
      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="鸟点">{{ detail.siteName }}</el-descriptions-item>
          <el-descriptions-item label="日期">{{ detail.session.date }}</el-descriptions-item>
          <el-descriptions-item label="起止">{{ detail.session.startedAt }}~{{ detail.session.endedAt }}</el-descriptions-item>
          <el-descriptions-item label="观测条件">
            {{ cloudText(detail.session.cloudCover) }} · {{ detail.session.windForce }} 级风
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="detail.session.closed ? 'success' : 'warning'" size="small">
              {{ detail.session.closed ? '已关账（只读）' : '进行中' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.session.closedAt" label="关账时间">
            {{ formatDateTime(detail.session.closedAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="鸟种数">
            {{ detail.speciesCount }} 种
            <el-tag v-if="detail.session.closed" size="small" type="info" effect="plain" class="snapshot-tag">关账固定</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="初捕">{{ detail.firstCount }} 只</el-descriptions-item>
          <el-descriptions-item label="重捕">{{ detail.recaptureCount }} 只</el-descriptions-item>
          <el-descriptions-item label="回收">{{ detail.recoveryCount }} 只</el-descriptions-item>
          <el-descriptions-item label="重捕率">{{ detail.recaptureRate }}%</el-descriptions-item>
          <el-descriptions-item label="主调查人">{{ detail.session.leader }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.session.closedStats" label="量度情况">
            已量度 {{ detail.session.closedStats.measuredCount }} 只 · 未测 {{ detail.session.closedStats.unmeasuredCount }} 只 / 共
            {{ detail.session.closedStats.ringCount }} 只
          </el-descriptions-item>
        </el-descriptions>

        <template v-if="detailUnmeasured.length">
          <el-divider content-position="left">未量度个体（{{ detailUnmeasured.length }}）</el-divider>
          <el-table :data="detailUnmeasured" size="small" border>
            <el-table-column label="环号" width="110">
              <template #default="scope">{{ scope.row.ringNo }}</template>
            </el-table-column>
            <el-table-column label="鸟种" width="120">
              <template #default="scope">{{ scope.row.speciesCn }}</template>
            </el-table-column>
            <el-table-column label="未测原因">
              <template #default="scope">
                <el-tag v-if="scope.row.unmeasuredReason" type="info" size="small">{{ scope.row.unmeasuredReason }}</el-tag>
                <el-tag v-else type="danger" size="small">待处理</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </template>
      <template #footer>
        <el-button v-if="detail && !detail.session.closed" type="warning" @click="goPrecloseFromDetail">
          去关账检查
        </el-button>
        <el-button type="primary" @click="detailId = null">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #1f4a44;
}
.page-desc {
  margin: 0 0 12px;
  color: #6f8480;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.block {
  border-radius: 8px;
}
.check-alert {
  margin-bottom: 12px;
}
.batch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.batch-label {
  font-size: 13px;
  color: #2f4a44;
}
.batch-hint {
  font-size: 12px;
}
.reason-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.snapshot-preview {
  margin-top: 12px;
}
.snapshot-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8a99a5;
}
.snapshot-tag {
  margin-left: 6px;
}
</style>
