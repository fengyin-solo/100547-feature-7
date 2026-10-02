<template>
  <section class="page" data-module="slope">
    <header class="page-head">
      <div>
        <h2>边坡形变管理</h2>
        <p class="page-desc">维护边坡观测点，围绕测点编号、所属隐患点、监测方式、本期位移做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记边坡观测点</button>
        <button class="btn" type="button" @click="exportRows">导出边坡形变清单</button>
      </div>
    </header>

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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>监测方式</span>
        <select v-model="filters['监测方式']">
          <option value="">全部</option>
          <option v-for="method in MONITOR_METHODS" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="formOpen" class="edit-panel">
      <div class="edit-grid">
        <label>
          <span>测点编号</span>
          <input v-model="form.测点编号" placeholder="如 SLOP-0005" />
        </label>
        <label>
          <span>所属隐患点</span>
          <input v-model="form.所属隐患点" placeholder="如 HAZA-0001" />
        </label>
        <label>
          <span>所属片区</span>
          <select v-model="form.所属片区">
            <option v-for="area in SLOPE_AREAS" :key="area" :value="area">{{ area }}</option>
          </select>
        </label>
        <label>
          <span>监测方式</span>
          <select v-model="form.监测方式">
            <option v-for="method in MONITOR_METHODS" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label>
          <span>本期位移(mm)</span>
          <input v-model="form.本期位移" :placeholder="`±${PERIOD_DISPLACEMENT_LIMIT} 以内，越界挡回`" />
        </label>
        <label>
          <span>累计位移(mm)</span>
          <input v-model="form.累计位移" />
        </label>
        <label>
          <span>观测日期</span>
          <input v-model="form.观测日期" type="date" />
        </label>
        <label>
          <span>观测人</span>
          <input v-model="form.观测人" />
        </label>
      </div>
      <div class="edit-actions">
        <button class="btn primary" type="button" @click="submitForm">
          {{ editingId === null ? '确认登记' : '保存修改' }}
        </button>
        <button class="btn ghost" type="button" @click="cancelForm">取消</button>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <span
              v-if="!accessOf(row).ok"
              class="readonly-tag"
              :title="accessOf(row).message"
            >只读</span>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openEdit(row)">编辑</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无边坡形变数据，可先登记边坡观测点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条边坡形变记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  saveSlopeEntry,
  slopeAccess,
} from '@/api/local-service'
import {
  MONITOR_METHODS,
  PERIOD_DISPLACEMENT_LIMIT,
  SLOPE_AREAS,
  type SlopeContext,
} from '@/data/slope-rules'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('slope')
const store = useSessionStore()
const columns = ["测点编号", "所属隐患点", "所属片区", "监测方式", "本期位移", "累计位移", "观测日期", "观测人", "形变状态"]
const actions = ["提交观测", "标记加剧", "办理停测"]
const statuses = ["待观测", "正常", "变形加剧", "已停测"]
const stats = [{"label": "待观测测点", "value": 0}, {"label": "变形加剧测点", "value": 0}, {"label": "本期最大位移", "value": 0}]

// 当前值班身份：角色 + 片区，每一次登记、编辑、流转都带给服务层判定。
const ctx = computed<SlopeContext>(() => ({
  role: store.role,
  area: store.area,
  operator: store.operator,
}))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["测点编号", "所属隐患点", "所属片区"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const formOpen = ref(false)
const editingId = ref<number | null>(null)
const form = ref<Record<string, string>>({})

function blankForm(): Record<string, string> {
  return {
    测点编号: '',
    所属隐患点: '',
    所属片区: store.area,
    监测方式: store.role === '监测组' ? '自动监测' : '人工观测',
    本期位移: '',
    累计位移: '',
    观测日期: new Date().toISOString().slice(0, 10),
    观测人: store.operator,
  }
}

// 页面上的只读标记只是提示，真正拦挡仍在服务层；两处用的是同一条规则。
function accessOf(row: EntryRow) {
  return slopeAccess(row, ctx.value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  editingId.value = null
  form.value = blankForm()
  formOpen.value = true
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  form.value = {
    测点编号: String(row['测点编号'] ?? ''),
    所属隐患点: String(row['所属隐患点'] ?? ''),
    所属片区: String(row['所属片区'] ?? store.area),
    监测方式: String(row['监测方式'] ?? ''),
    本期位移: String(row['本期位移'] ?? ''),
    累计位移: String(row['累计位移'] ?? ''),
    观测日期: String(row['观测日期'] ?? ''),
    观测人: String(row['观测人'] ?? ''),
  }
  formOpen.value = true
}

function cancelForm() {
  formOpen.value = false
  editingId.value = null
}

function submitForm() {
  const result = saveSlopeEntry({ ...form.value }, ctx.value, editingId.value ?? undefined)
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  formOpen.value = false
  editingId.value = null
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action, ctx.value)
  reload()
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
}

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '边坡形变列表读取失败'
  }
}

onMounted(reload)
</script>
