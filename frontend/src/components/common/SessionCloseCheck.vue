<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRingStore } from '../../stores/ringStore';
import { useMeasureStore } from '../../stores/measureStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useSiteStore } from '../../stores/siteStore';
import { STATUS_COLOR, UNMEASURED_REASON_PRESETS, type RingRecord, type RingStatus } from '../../types/ring-record';
import type { SurveySession } from '../../types/session';
import { buildSessionStats, pendingMeasureRings } from '../../utils/stats';

const props = defineProps<{ session: SurveySession }>();
const emit = defineEmits<{ close: []; closed: [] }>();

const ringStore = useRingStore();
const measureStore = useMeasureStore();
const sessionStore = useSessionStore();
const siteStore = useSiteStore();

/** 每行的原因草稿（已确认过的行初始取记录上的原因） */
const drafts = reactive<Record<string, string>>({});
/** 处于编辑态的行：从未确认过的行默认编辑态，已确认的行收起为只读展示 */
const editingIds = ref<Set<string>>(new Set());

const sessionRings = computed(() => ringStore.rings.filter((record) => record.sessionId === props.session.id));
/** 还没有量度的环志：关账前必须逐个确认未测原因（或先去补录量度） */
const pendingRows = computed(() => pendingMeasureRings(props.session.id, ringStore.rings, measureStore.morphs));
/** 仍未处理：既无量度，也未确认未测原因 */
const unsettledRows = computed(() => pendingRows.value.filter((record) => !record.unmeasuredReason?.trim()));
const allSettled = computed(() => unsettledRows.value.length === 0);

const measuredCount = computed(() => sessionRings.value.length - pendingRows.value.length);
const confirmedCount = computed(() => pendingRows.value.length - unsettledRows.value.length);

/** 关账时将固定的统计（即当前实时值，关账后不再变化） */
const statsPreview = computed(() => buildSessionStats(props.session, ringStore.rings, siteStore.siteName(props.session.siteId)));

function isEditing(record: RingRecord): boolean {
  return editingIds.value.has(record.id) || !record.unmeasuredReason?.trim();
}

function draftOf(record: RingRecord): string {
  return drafts[record.id] ?? record.unmeasuredReason ?? '';
}

async function confirmReason(record: RingRecord) {
  const reason = draftOf(record).trim();
  if (!reason) {
    ElMessage.warning(`请填写 ${record.ringNo} 的未测原因`);
    return;
  }
  await ringStore.setUnmeasuredReason(record.id, reason);
  editingIds.value.delete(record.id);
  ElMessage.success(`已确认 ${record.ringNo} 的未测原因`);
}

function reopen(record: RingRecord) {
  drafts[record.id] = record.unmeasuredReason ?? '';
  editingIds.value.add(record.id);
}

async function confirmClose() {
  if (!allSettled.value) {
    ElMessage.warning(`还差 ${unsettledRows.value.length} 只个体未处理：${unsettledRows.value.map((r) => r.ringNo).join('、')}`);
    return;
  }
  const stats = statsPreview.value;
  const confirmed = await ElMessageBox.confirm(
    `关账后统计固定为：鸟种 ${stats.speciesCount} 种、初捕 ${stats.firstCount}、重捕 ${stats.recaptureCount}、回收 ${stats.recoveryCount}；该批次的环志与量度记录将转为只读。确认关账？`,
    `确认关账 · ${props.session.sessionNo}`,
    { type: 'warning', confirmButtonText: '确认关账', cancelButtonText: '再检查一下' },
  )
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await sessionStore.closeSession(props.session.id, {
    speciesCount: stats.speciesCount,
    firstCount: stats.firstCount,
    recaptureCount: stats.recaptureCount,
    recoveryCount: stats.recoveryCount,
  });
  ElMessage.success(`批次 ${props.session.sessionNo} 已关账，统计已固定`);
  emit('closed');
}
</script>

<template>
  <el-dialog :model-value="true" :title="`关账前检查 · ${session.sessionNo}`" width="800px" @close="emit('close')">
    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="关账前请逐个核对还没有量度的环志：填写未测原因并确认，或到「量度测量」页补录量度。全部处理完后才能关账。"
      class="check-tip"
    />

    <div class="check-summary">
      <el-tag effect="plain">批次环志 {{ sessionRings.length }} 只</el-tag>
      <el-tag type="success" effect="plain">已量度 {{ measuredCount }}</el-tag>
      <el-tag type="warning" effect="plain">未测原因已确认 {{ confirmedCount }}</el-tag>
      <el-tag v-if="unsettledRows.length" type="danger" effect="plain">待处理 {{ unsettledRows.length }}</el-tag>
    </div>

    <template v-if="pendingRows.length">
      <el-table :data="pendingRows" size="small" border class="check-table">
        <el-table-column prop="ringNo" label="金属环号" width="110" />
        <el-table-column prop="speciesCn" label="鸟种" width="110" />
        <el-table-column label="状态" width="80">
          <template #default="scope">
            <el-tag :type="STATUS_COLOR[scope.row.status as RingStatus]" size="small">{{ scope.row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ringer" label="环志人" width="90" />
        <el-table-column label="未测原因" min-width="240">
          <template #default="scope">
            <el-select
              v-if="isEditing(scope.row)"
              :model-value="draftOf(scope.row)"
              filterable
              allow-create
              default-first-option
              placeholder="选择或填写未测原因"
              style="width: 100%"
              @update:model-value="(value: string) => (drafts[scope.row.id] = value)"
            >
              <el-option v-for="reason in UNMEASURED_REASON_PRESETS" :key="reason" :label="reason" :value="reason" />
            </el-select>
            <span v-else class="reason-text">{{ scope.row.unmeasuredReason }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="scope">
            <el-button v-if="isEditing(scope.row)" link type="primary" :disabled="!draftOf(scope.row).trim()" @click="confirmReason(scope.row)">
              确认
            </el-button>
            <template v-else>
              <el-tag type="success" size="small" effect="plain">已确认</el-tag>
              <el-button link type="primary" @click="reopen(scope.row)">重填</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </template>
    <el-alert
      v-else
      type="success"
      show-icon
      :closable="false"
      :title="sessionRings.length ? '该批次环志均已量度，可直接关账' : '该批次暂无环志记录，关账后统计为 0'"
      class="check-tip"
    />

    <el-alert
      v-if="!allSettled"
      type="warning"
      show-icon
      :closable="false"
      :title="`还差 ${unsettledRows.length} 只个体未处理：${unsettledRows.map((r) => `${r.ringNo}（${r.speciesCn}）`).join('、')}`"
      description="逐条填写未测原因并确认，或先去补录量度；全部处理完后「确认关账」才可用。"
    />
    <el-alert
      v-else
      type="success"
      show-icon
      :closable="false"
      title="全部个体已处理，可以关账"
      :description="`关账后统计固定为：鸟种 ${statsPreview.speciesCount} 种、初捕 ${statsPreview.firstCount}、重捕 ${statsPreview.recaptureCount}、回收 ${statsPreview.recoveryCount}；该批次环志与量度转为只读。`"
    />

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="warning" :disabled="!allSettled" @click="confirmClose">确认关账</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.check-tip {
  margin-bottom: 12px;
}
.check-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.check-table {
  margin-bottom: 12px;
}
.reason-text {
  font-size: 13px;
  color: #2f4a44;
}
</style>
