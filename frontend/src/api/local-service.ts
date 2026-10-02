import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  checkSlopeAccess,
  validateSlopeEntry,
  validateSlopeTransition,
  type SlopeContext,
} from '@/data/slope-rules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 页面只读标记与写路径拦挡用同一条规则判定，结果一致。
export { checkSlopeAccess as slopeAccess }
export type { SlopeContext }

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 页面没传值班上下文时的兜底：无片区的观测人，任何改动都会被规则拦下并说明原因。
const FALLBACK_SLOPE_CONTEXT: SlopeContext = { role: '片区观测人', area: '', operator: '未登记值班人' }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string, ctx?: SlopeContext): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === 'slope') {
    // 边坡观测点先过规则：越权拦下 → 单向固定次序，冲突按优先级判定。
    const check = validateSlopeTransition(rows[index], action, target, ctx ?? FALLBACK_SLOPE_CONTEXT)
    if (!check.ok) {
      return check
    }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (key === 'slope') {
    updated['形变状态'] = target
    if (target === '变形加剧') {
      updated.abnormal = true
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (key === 'slope' && action === '提交观测' && syncSlopeConclusionToCutting(updated)) {
    message += '，结论已同步削坡减载清单（待复核）'
  }
  return { ok: true, message }
}

// 观测结论提交后，削坡减载清单跟着多一条「待复核」；同一测点只同步一次，重复提交以先登记的为准。
function syncSlopeConclusionToCutting(row: EntryRow): boolean {
  const point = String(row['测点编号'] ?? '')
  const rows = listRows('cutting')
  if (rows.some((item) => String(item['来源测点'] ?? '') === point)) {
    return false
  }
  const id = rows.reduce((max, item) => Math.max(max, Number(item.id)), 0) + 1
  const synced: EntryRow = {
    id,
    status: '待开工',
    pending: true,
    abnormal: false,
    工序编号: `CUTT-${String(id).padStart(4, '0')}`,
    所属工程: String(row['所属隐患点'] ?? ''),
    削坡方量: '',
    坡比要求: '',
    开挖高程: '',
    验收日期: '',
    验收人: '',
    工序状态: '待复核',
    来源测点: point,
  }
  saveRows('cutting', [...rows, synced])
  return true
}

/**
 * 边坡观测点登记/编辑：越权、监测方式集合、重复编号、位移越界都在 validateSlopeEntry 里按优先级判定。
 * originalId 为空表示新登记，否则按编号更新已有测点。
 */
export function saveSlopeEntry(
  entry: Record<string, string>,
  ctx: SlopeContext,
  originalId?: number,
): ActionResult {
  const meta = moduleMeta('slope')
  const rows = listRows('slope')
  const original = originalId === undefined ? undefined : rows.find((row) => Number(row.id) === originalId)
  if (originalId !== undefined && !original) {
    return { ok: false, message: `没有找到编号为 ${originalId} 的${meta.entity}` }
  }
  const check = validateSlopeEntry(entry, ctx, rows, original)
  if (!check.ok) {
    return check
  }
  if (original) {
    const next = rows.map((row) =>
      Number(row.id) === Number(original.id)
        ? { ...row, ...entry, id: row.id, status: row.status, pending: row.pending, abnormal: row.abnormal }
        : row,
    )
    saveRows('slope', next)
    return { ok: true, message: `${meta.entity} ${entry['测点编号']} 已更新` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = {
    ...entry,
    id,
    status: '待观测',
    pending: true,
    abnormal: false,
    形变状态: '待观测',
  }
  saveRows('slope', [...rows, created])
  return { ok: true, message: `${meta.entity} ${entry['测点编号']} 已登记，进入「待观测」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
