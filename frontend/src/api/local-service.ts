import { MODULE_BY_KEY } from '@/data/modules'
import {
  AUTO_METHOD,
  DISPLACEMENT_LIMIT_MM,
  IDENTITY_FIELDS,
  MANUAL_METHOD,
  MONITORING_METHODS,
  MONITOR_ONLY_FIELDS,
  ROLE_LABELS,
  isDisplacementOutOfRange,
} from '@/data/monitoring'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  SessionContext,
  SlopeAssignment,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

export function runAction(key: string, id: number, action: string): ActionResult {
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
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 单向流转：配置了 actionSources 的模块，动作只能从登记的源状态发起，
  // 环节按 statuses 的固定次序往前走，不能跳步、不能回退。
  const source = meta.actionSources?.[action]
  if (source && current !== source) {
    return {
      ok: false,
      message: `流转校验：${meta.entity}当前是「${current}」，「${action}」只能从「${source}」发起；环节按 ${meta.statuses.join(' → ')} 单向流转`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
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

// ---------------------------------------------------------------------------
// 边坡观测点：任务分派、权限守卫、结论提交与削坡减载联动。
// 拦截规则优先级（与 data/monitoring.ts 的 RULE_PRIORITY 一致）：
//   越权拦截 > 越界挡回 > 重复登记 > 流转校验
// 一次提交同时踩中多条规则时，按这个顺序判定，先命中的先报。
// ---------------------------------------------------------------------------

/** 监测方式字典的唯一出口：页面下拉和任务分派都从这里拿，保证两条路径是同一套。 */
export function listMonitoringMethods(): readonly string[] {
  return MONITORING_METHODS
}

/** 按监测方式把观测任务分派下去：人工观测按片区归观测人，自动监测归监测组。 */
export function listSlopeAssignments(): SlopeAssignment[] {
  // 已停测是终态，不再派任务。
  const active = listRows('slope').filter((row) => String(row.status) !== '已停测')
  return MONITORING_METHODS.map((method) => {
    const matched = active.filter((row) => String(row['监测方式']) === method)
    if (method === MANUAL_METHOD) {
      const byArea = new Map<string, EntryRow[]>()
      for (const row of matched) {
        const area = String(row['所属片区'] ?? '未分区')
        byArea.set(area, [...(byArea.get(area) ?? []), row])
      }
      return {
        method,
        groups: [...byArea.entries()].map(([area, rows]) => ({
          owner: `${area}观测人`,
          rows,
        })),
      }
    }
    return { method, groups: [{ owner: '监测组', rows: matched }] }
  })
}

/**
 * 行级维护权限：人工观测测点归本片区观测人，自动监测测点只能监测组改，
 * 其余一律只读。返回拦截原因，页面和提交链共用这一份判定。
 */
export function canMaintainSlopeRow(
  row: EntryRow,
  session: SessionContext,
): { ok: boolean; reason: string } {
  const code = String(row['测点编号'] ?? row.id)
  const method = String(row['监测方式'] ?? '')
  if (method === AUTO_METHOD) {
    if (session.role !== 'monitor') {
      return {
        ok: false,
        reason: `测点「${code}」是自动监测，只能由监测组维护，${ROLE_LABELS.observer}只读`,
      }
    }
    return { ok: true, reason: '' }
  }
  if (session.role === 'monitor') {
    return {
      ok: false,
      reason: `测点「${code}」是人工观测，归${row['所属片区']}观测人维护，监测组只读`,
    }
  }
  if (String(row['所属片区']) !== session.area) {
    return {
      ok: false,
      reason: `测点「${code}」属于${row['所属片区']}，不在本片区（${session.area}）之内，只读`,
    }
  }
  return { ok: true, reason: '' }
}

function findSlopeRow(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows('slope')
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

/** 登记新测点：越权 > 越界 > 重复，全过了才落库，初始状态「待观测」。 */
export function registerSlopePoint(
  payload: Record<string, string>,
  session: SessionContext,
): ActionResult {
  const method = payload['监测方式'] ?? ''
  const code = (payload['测点编号'] ?? '').trim()
  const area = payload['所属片区'] ?? session.area

  // 1. 越权拦截：登记归口与维护归口一致，谁的孩子谁抱。
  if (!MONITORING_METHODS.includes(method as (typeof MONITORING_METHODS)[number])) {
    return { ok: false, message: `越权拦截：监测方式只能是 ${MONITORING_METHODS.join(' / ')}` }
  }
  if (method === AUTO_METHOD && session.role !== 'monitor') {
    return { ok: false, message: '越权拦截：自动监测测点由监测组登记维护，片区观测人无权登记' }
  }
  if (method === MANUAL_METHOD && session.role === 'monitor') {
    return { ok: false, message: '越权拦截：人工观测测点归本片区观测人登记，监测组不代录' }
  }
  if (method === MANUAL_METHOD && area !== session.area) {
    return {
      ok: false,
      message: `越权拦截：只能登记本片区（${session.area}）的测点，「${area}」超出范围`,
    }
  }
  if (code === '') {
    return { ok: false, message: '测点编号不能为空' }
  }

  // 2. 越界挡回：本期位移超出允许范围的登记直接挡回。
  if (isDisplacementOutOfRange(payload['本期位移'])) {
    return {
      ok: false,
      message: `越界挡回：本期位移「${payload['本期位移']}」超出允许范围 ±${DISPLACEMENT_LIMIT_MM}mm`,
    }
  }

  // 3. 重复登记：同一测点编号只认先登记的那条。
  const rows = listRows('slope')
  if (rows.some((row) => String(row['测点编号']) === code)) {
    return { ok: false, message: `重复登记：测点编号「${code}」已登记，以先登记的那条为准` }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id: nextId,
    status: '待观测',
    pending: true,
    abnormal: false,
    测点编号: code,
    所属隐患点: payload['所属隐患点'] ?? '',
    所属片区: area,
    监测方式: method,
    本期位移: Number(payload['本期位移'] ?? 0),
    累计位移: Number(payload['累计位移'] ?? 0),
    观测日期: payload['观测日期'] ?? '',
    观测人: payload['观测人'] ?? session.operator,
    形变状态: '待观测',
  }
  saveRows('slope', [...rows, row])
  return { ok: true, message: `测点「${code}」已登记，归口${method === AUTO_METHOD ? '监测组' : `${area}观测人`}，当前状态「待观测」` }
}

/** 编辑测点：测点编号谁都不能改，监测方式只有监测组能调，数据字段走行级权限。 */
export function updateSlopeEntry(
  id: number,
  changes: Record<string, string>,
  session: SessionContext,
): ActionResult {
  const found = findSlopeRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的边坡观测点` }
  }
  const row = found.rows[found.index]

  // 1. 越权拦截：先查管控字段，再查行级维护权限。
  for (const field of IDENTITY_FIELDS) {
    if (field in changes && changes[field].trim() !== String(row[field] ?? '')) {
      return {
        ok: false,
        message: `越权拦截：测点编号是身份字段，一经登记任何人不得改动（试图改为「${changes[field]}」）`,
      }
    }
  }
  for (const field of MONITOR_ONLY_FIELDS) {
    if (field in changes && changes[field] !== String(row[field] ?? '')) {
      if (session.role !== 'monitor') {
        return {
          ok: false,
          message: `越权拦截：监测方式决定任务归口，只能由监测组调整；当前身份是${ROLE_LABELS[session.role]}`,
        }
      }
      if (!MONITORING_METHODS.includes(changes[field] as (typeof MONITORING_METHODS)[number])) {
        return { ok: false, message: `监测方式只能是 ${MONITORING_METHODS.join(' / ')}` }
      }
    }
  }
  const dataChanged = Object.entries(changes).some(
    ([field, value]) =>
      !(IDENTITY_FIELDS as readonly string[]).includes(field) &&
      !(MONITOR_ONLY_FIELDS as readonly string[]).includes(field) &&
      value !== String(row[field] ?? ''),
  )
  if (dataChanged) {
    const guard = canMaintainSlopeRow(row, session)
    if (!guard.ok) {
      return { ok: false, message: `越权拦截：${guard.reason}` }
    }
  }

  // 2. 越界挡回：本期位移越界的改动不落地。
  if ('本期位移' in changes && isDisplacementOutOfRange(changes['本期位移'])) {
    return {
      ok: false,
      message: `越界挡回：本期位移「${changes['本期位移']}」超出允许范围 ±${DISPLACEMENT_LIMIT_MM}mm`,
    }
  }

  const next = [...found.rows]
  next[found.index] = {
    ...row,
    ...changes,
    本期位移: '本期位移' in changes ? Number(changes['本期位移']) : row['本期位移'],
    累计位移: '累计位移' in changes ? Number(changes['累计位移']) : row['累计位移'],
  }
  saveRows('slope', next)
  return { ok: true, message: `测点「${row['测点编号']}」已更新` }
}

/**
 * 提交观测结论：校验链全过后把状态从「待观测」推进到「正常」，
 * 并同步一条待复核测点到削坡减载清单。
 */
export function submitSlopeObservation(
  id: number,
  payload: { 本期位移: string; 累计位移: string; 观测日期: string; 观测人: string },
  session: SessionContext,
): ActionResult {
  const found = findSlopeRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的边坡观测点` }
  }
  const row = found.rows[found.index]
  const code = String(row['测点编号'])

  // 1. 越权拦截
  const guard = canMaintainSlopeRow(row, session)
  if (!guard.ok) {
    return { ok: false, message: `越权拦截：${guard.reason}` }
  }

  // 2. 越界挡回
  if (isDisplacementOutOfRange(payload['本期位移'])) {
    return {
      ok: false,
      message: `越界挡回：测点「${code}」本期位移「${payload['本期位移']}」超出允许范围 ±${DISPLACEMENT_LIMIT_MM}mm，请复核仪器读数后再报`,
    }
  }

  // 3. 重复登记：同一测点同一观测日的结论只认先登记的那条。
  if (String(row.status) !== '待观测' && String(row['观测日期']) === payload['观测日期']) {
    return {
      ok: false,
      message: `重复登记：测点「${code}」${payload['观测日期']}的结论已登记，以先登记的那条为准`,
    }
  }

  // 4. 流转校验：环节单向，只有「待观测」能提交观测结论。
  if (String(row.status) !== '待观测') {
    return {
      ok: false,
      message: `流转校验：测点「${code}」当前是「${row.status}」，观测结论只能从「待观测」发起，环节单向不可回退`,
    }
  }

  const updated: EntryRow = {
    ...row,
    本期位移: Number(payload['本期位移']),
    累计位移: Number(payload['累计位移']),
    观测日期: payload['观测日期'],
    观测人: payload['观测人'] || session.operator,
    形变状态: '正常',
    status: '正常',
    pending: true,
  }
  const next = [...found.rows]
  next[found.index] = updated
  saveRows('slope', next)
  syncCuttingReview(updated)
  return {
    ok: true,
    message: `测点「${code}」观测结论已登记，状态推进到「正常」，削坡减载清单已同步一条待复核测点`,
  }
}

/** 行内动作（标记加剧 / 办理停测）：先过行级权限，再走通用单向流转。 */
export function runSlopeAction(id: number, action: string, session: SessionContext): ActionResult {
  const found = findSlopeRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的边坡观测点` }
  }
  const guard = canMaintainSlopeRow(found.rows[found.index], session)
  if (!guard.ok) {
    return { ok: false, message: `越权拦截：${guard.reason}` }
  }
  return runAction('slope', id, action)
}

/** 结论同步：往削坡减载清单补一条待复核测点，同一测点只补一条（幂等）。 */
function syncCuttingReview(slopeRow: EntryRow): void {
  const rows = listRows('cutting')
  const code = String(slopeRow['测点编号'])
  const reviewCode = `REVIEW-${code}`
  if (rows.some((row) => String(row['工序编号']) === reviewCode)) {
    return
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  saveRows('cutting', [
    ...rows,
    {
      id: nextId,
      status: '待复核',
      pending: true,
      abnormal: false,
      工序编号: reviewCode,
      所属工程: String(slopeRow['所属隐患点'] ?? ''),
      削坡方量: '待复核',
      坡比要求: '待复核',
      开挖高程: '待复核',
      验收日期: String(slopeRow['观测日期'] ?? ''),
      验收人: String(slopeRow['观测人'] ?? ''),
      工序状态: `待复核测点 ${code}`,
    },
  ])
}
