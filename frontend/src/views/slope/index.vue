<template>
  <section class="page" data-module="slope">
    <header class="page-head">
      <div>
        <h2>边坡形变管理</h2>
        <p class="page-desc">
          按监测方式分派观测任务：人工观测归本片区观测人，自动监测归监测组；状态按
          待观测 → 正常 → 变形加剧 → 已停测 单向流转。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleCreate">
          {{ creating ? '收起登记' : '登记边坡观测点' }}
        </button>
        <button class="btn" type="button" @click="exportRows">导出边坡形变清单</button>
      </div>
    </header>

    <div class="role-bar">
      <span>当前身份</span>
      <select :value="store.role" @change="onRoleChange">
        <option value="observer">片区观测人</option>
        <option value="monitor">监测组</option>
      </select>
      <template v-if="store.role === 'observer'">
        <span>所属片区</span>
        <select :value="store.area" @change="onAreaChange">
          <option v-for="area in areas" :key="area" :value="area">{{ area }}</option>
        </select>
      </template>
      <span class="role-hint">{{ roleHint }}</span>
    </div>

    <div class="assign-panel">
      <article v-for="block in assignments" :key="block.method" class="assign-card">
        <h3>{{ block.method }}任务</h3>
        <div v-for="group in block.groups" :key="group.owner">
          <p class="assign-group">{{ group.owner }} · {{ group.rows.length }} 个测点</p>
          <p class="assign-list">
            <span v-for="row in group.rows" :key="String(row.id)" class="assign-chip">
              {{ row['测点编号'] }}（{{ row.status }}）
            </span>
            <span v-if="!group.rows.length" class="assign-chip muted">暂无待办测点</span>
          </p>
        </div>
      </article>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="creating" class="inline-form create-form" @submit.prevent="submitCreate">
      <label>
        测点编号
        <input v-model.trim="createForm['测点编号']" placeholder="如 SLOP-0007" required />
      </label>
      <label>
        所属隐患点
        <input v-model.trim="createForm['所属隐患点']" placeholder="如 HAZA-0001" />
      </label>
      <label>
        所属片区
        <select v-model="createForm['所属片区']" :disabled="store.role === 'observer'">
          <option v-for="area in areas" :key="area" :value="area">{{ area }}</option>
        </select>
      </label>
      <label>
        监测方式
        <select v-model="createForm['监测方式']">
          <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label>
        本期位移(mm)
        <input v-model.trim="createForm['本期位移']" placeholder="±50 以内" />
      </label>
      <label>
        累计位移(mm)
        <input v-model.trim="createForm['累计位移']" placeholder="数值" />
      </label>
      <label>
        观测日期
        <input v-model="createForm['观测日期']" type="date" />
      </label>
      <label>
        观测人
        <input v-model.trim="createForm['观测人']" />
      </label>
      <span class="inline-actions">
        <button class="btn primary" type="submit">确认登记</button>
        <button class="btn ghost" type="button" @click="toggleCreate">取消</button>
      </span>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr :class="{ 'out-of-range': isOutOfRange(row) }">
            <td v-for="column in columns" :key="column">
              {{ row[column] ?? '—' }}
              <span v-if="column === '本期位移' && isOutOfRange(row)" class="tag out-of-range">
                越界
              </span>
              <span v-if="column === '测点编号' && !maintainable(row).ok" class="tag readonly">
                只读
              </span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                :disabled="!actionEnabled(action, row).ok"
                :title="actionEnabled(action, row).reason"
                @click="runRowAction(action, row)"
              >
                {{ action }}
              </button>
              <button
                class="link"
                type="button"
                :disabled="!editable(row).ok"
                :title="editable(row).reason"
                @click="openEdit(row)"
              >
                编辑
              </button>
            </td>
          </tr>
          <tr v-if="submittingId === Number(row.id)" class="inline-panel">
            <td :colspan="columns.length + 2">
              <form class="inline-form" @submit.prevent="submitObservation(row)">
                <span class="inline-title">提交观测结论 · {{ row['测点编号'] }}</span>
                <label>
                  本期位移(mm)
                  <input v-model.trim="observeForm['本期位移']" placeholder="±50 以内" required />
                </label>
                <label>
                  累计位移(mm)
                  <input v-model.trim="observeForm['累计位移']" required />
                </label>
                <label>
                  观测日期
                  <input v-model="observeForm['观测日期']" type="date" required />
                </label>
                <label>
                  观测人
                  <input v-model.trim="observeForm['观测人']" />
                </label>
                <span class="inline-actions">
                  <button class="btn primary" type="submit">提交结论</button>
                  <button class="btn ghost" type="button" @click="submittingId = null">取消</button>
                </span>
              </form>
            </td>
          </tr>
          <tr v-if="editingId === Number(row.id)" class="inline-panel">
            <td :colspan="columns.length + 2">
              <form class="inline-form" @submit.prevent="submitEdit(row)">
                <span class="inline-title">编辑测点 · {{ row['测点编号'] }}</span>
                <label>
                  测点编号
                  <input :value="row['测点编号']" disabled title="测点编号是身份字段，任何人不得改动" />
                </label>
                <label>
                  监测方式
                  <select
                    v-model="editForm['监测方式']"
                    :disabled="store.role !== 'monitor'"
                    :title="store.role !== 'monitor' ? '监测方式只能由监测组调整' : ''"
                  >
                    <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
                  </select>
                </label>
                <label>
                  所属隐患点
                  <input v-model.trim="editForm['所属隐患点']" />
                </label>
                <label>
                  本期位移(mm)
                  <input v-model.trim="editForm['本期位移']" />
                </label>
                <label>
                  累计位移(mm)
                  <input v-model.trim="editForm['累计位移']" />
                </label>
                <label>
                  观测日期
                  <input v-model="editForm['观测日期']" type="date" />
                </label>
                <label>
                  观测人
                  <input v-model.trim="editForm['观测人']" />
                </label>
                <span class="inline-actions">
                  <button class="btn primary" type="submit">保存修改</button>
                  <button class="btn ghost" type="button" @click="editingId = null">取消</button>
                </span>
              </form>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无边坡形变数据，可先登记边坡观测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条边坡形变记录</span>
      <span v-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  canMaintainSlopeRow,
  downloadEntries,
  listEntries,
  listMonitoringMethods,
  listSlopeAssignments,
  moduleMeta,
  registerSlopePoint,
  runSlopeAction,
  submitSlopeObservation,
  updateSlopeEntry,
} from '@/api/local-service'
import {
  DISPLACEMENT_LIMIT_MM,
  OBSERVER_AREAS,
  isDisplacementOutOfRange,
  type Role,
} from '@/data/monitoring'
import type { EntryRow, SessionContext, SlopeAssignment } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('slope')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses
// 监测方式字典从数据层统一出口拿，和任务分派读到的是同一套。
const methods = listMonitoringMethods()
const areas = OBSERVER_AREAS

const store = useSessionStore()
const session = computed<SessionContext>(() => ({
  role: store.role,
  area: store.area,
  operator: store.operator,
}))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const assignments = ref<SlopeAssignment[]>([])
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 4)

const creating = ref(false)
const submittingId = ref<number | null>(null)
const editingId = ref<number | null>(null)

const today = new Date().toISOString().slice(0, 10)
const createForm = ref<Record<string, string>>({})
const observeForm = ref<Record<string, string>>({})
const editForm = ref<Record<string, string>>({})

const roleHint = computed(() =>
  store.role === 'monitor'
    ? '监测组：维护全部自动监测测点，可调整监测方式；人工观测测点只读。'
    : `片区观测人：维护本片区（${store.area}）的人工观测测点；自动监测与其他片区只读。`,
)

const stats = computed(() => [
  { label: '待观测测点', value: rows.value.filter((row) => row.status === '待观测').length },
  { label: '变形加剧测点', value: rows.value.filter((row) => row.status === '变形加剧').length },
  {
    label: '本期最大位移',
    value: rows.value.reduce((max, row) => {
      const value = Number(row['本期位移'])
      return Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max
    }, 0),
  },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isOutOfRange(row: EntryRow): boolean {
  return isDisplacementOutOfRange(row['本期位移'])
}

function maintainable(row: EntryRow) {
  return canMaintainSlopeRow(row, session.value)
}

function editable(row: EntryRow) {
  const guard = maintainable(row)
  if (guard.ok) {
    return guard
  }
  // 监测组对只读行也放开编辑入口：进去只能调监测方式，数据字段保存时仍会被拦。
  if (store.role === 'monitor') {
    return { ok: true, reason: '' }
  }
  return guard
}

function actionEnabled(action: string, row: EntryRow) {
  const guard = maintainable(row)
  if (!guard.ok) {
    return guard
  }
  const source = meta.actionSources?.[action]
  if (source && String(row.status) !== source) {
    return {
      ok: false,
      reason: `「${action}」只能从「${source}」发起，环节按 ${statuses.join(' → ')} 单向流转`,
    }
  }
  return { ok: true, reason: '' }
}

function onRoleChange(event: Event) {
  store.setRole((event.target as HTMLSelectElement).value as Role)
  reload()
}

function onAreaChange(event: Event) {
  store.setArea((event.target as HTMLSelectElement).value)
  reload()
}

function toggleCreate() {
  creating.value = !creating.value
  if (creating.value) {
    createForm.value = {
      测点编号: '',
      所属隐患点: '',
      所属片区: store.area,
      监测方式: store.role === 'monitor' ? '自动监测' : '人工观测',
      本期位移: '0',
      累计位移: '0',
      观测日期: today,
      观测人: store.operator,
    }
  }
}

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    noticeMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    noticeMessage.value = ''
  }
}

function submitCreate() {
  const result = registerSlopePoint(createForm.value, session.value)
  showResult(result)
  if (result.ok) {
    creating.value = false
    reload()
  }
}

function runRowAction(action: string, row: EntryRow) {
  if (action === '提交观测') {
    // 提交观测要带结论数据，展开行内表单而不是直接流转。
    submittingId.value = Number(row.id)
    editingId.value = null
    observeForm.value = {
      本期位移: String(row['本期位移'] ?? ''),
      累计位移: String(row['累计位移'] ?? ''),
      观测日期: today,
      观测人: store.operator,
    }
    return
  }
  const result = runSlopeAction(Number(row.id), action, session.value)
  showResult(result)
  if (result.ok) {
    reload()
  }
}

function submitObservation(row: EntryRow) {
  const result = submitSlopeObservation(
    Number(row.id),
    observeForm.value as { 本期位移: string; 累计位移: string; 观测日期: string; 观测人: string },
    session.value,
  )
  showResult(result)
  if (result.ok) {
    submittingId.value = null
    reload()
  }
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  submittingId.value = null
  editForm.value = {
    测点编号: String(row['测点编号'] ?? ''),
    监测方式: String(row['监测方式'] ?? ''),
    所属隐患点: String(row['所属隐患点'] ?? ''),
    本期位移: String(row['本期位移'] ?? ''),
    累计位移: String(row['累计位移'] ?? ''),
    观测日期: String(row['观测日期'] ?? ''),
    观测人: String(row['观测人'] ?? ''),
  }
}

function submitEdit(row: EntryRow) {
  const result = updateSlopeEntry(Number(row.id), editForm.value, session.value)
  showResult(result)
  if (result.ok) {
    editingId.value = null
    reload()
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    assignments.value = listSlopeAssignments()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '边坡形变列表读取失败'
  }
}

onMounted(reload)
</script>
