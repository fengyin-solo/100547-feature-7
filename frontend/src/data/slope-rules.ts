import type { EntryRow } from './types'

// 边坡观测点的分派与校验规则，全部集中在这一个文件里：
// 页面下拉、登记校验、动作流转读的都是同一份常量，保证两条路径看到的监测方式是同一套。

/** 监测方式全集：只允许这两种，页面下拉和越权校验都从这里读。 */
export const MONITOR_METHODS = ['人工观测', '自动监测'] as const
export type MonitorMethod = (typeof MONITOR_METHODS)[number]
export const MANUAL_METHOD: MonitorMethod = '人工观测'
export const AUTO_METHOD: MonitorMethod = '自动监测'

/** 值班角色：人工观测归片区观测人，自动监测归监测组。 */
export const SLOPE_ROLES = ['片区观测人', '监测组'] as const
export type SlopeRole = (typeof SLOPE_ROLES)[number]

/** 片区清单：片区观测人只能维护本片区，之外只读。 */
export const SLOPE_AREAS = ['东山片区', '西山片区'] as const

/** 状态流转：单向、固定次序，只能走到紧邻的下一环。 */
export const SLOPE_STATUS_FLOW: readonly string[] = ['待观测', '正常', '变形加剧', '已停测']

/** 本期位移允许范围（mm），越界的记录直接挡回。 */
export const PERIOD_DISPLACEMENT_LIMIT = 100

/** 判定规则时需要的值班上下文：角色 + 片区。 */
export type SlopeContext = {
  role: SlopeRole
  area: string
  operator: string
}

export type RuleCheck = {
  ok: boolean
  message: string
}

const OK: RuleCheck = { ok: true, message: '' }

export function isMonitorMethod(value: string): value is MonitorMethod {
  return (MONITOR_METHODS as readonly string[]).includes(value)
}

// 监测方式归属 + 片区范围：登记和改动共用这一套判定，只是措辞不同。
function ownershipCheck(method: string, area: string, point: string, ctx: SlopeContext, verb: string): RuleCheck {
  if (!isMonitorMethod(method)) {
    return {
      ok: false,
      message: `监测方式「${method}」不在登记范围（${MONITOR_METHODS.join('、')}），测点 ${point} 不予${verb}，待监测组校正`,
    }
  }
  if (method === AUTO_METHOD && ctx.role !== '监测组') {
    return { ok: false, message: `自动监测测点只能由监测组维护，「${ctx.role}」越权${verb}测点 ${point}，已拦下` }
  }
  if (method === MANUAL_METHOD && ctx.role !== '片区观测人') {
    return { ok: false, message: `人工观测测点归本片区观测人维护，「${ctx.role}」越权${verb}测点 ${point}，已拦下` }
  }
  if (ctx.role === '片区观测人' && area !== ctx.area) {
    return {
      ok: false,
      message: `本片区（${ctx.area || '未登记'}）之外的记录只读：测点 ${point} 属于「${area || '未填写片区'}」，不予${verb}`,
    }
  }
  return OK
}

/** 已有记录是否允许当前值班人改动（页面只读标记与写路径拦挡都用它）。 */
export function checkSlopeAccess(row: EntryRow, ctx: SlopeContext): RuleCheck {
  return ownershipCheck(
    String(row['监测方式'] ?? ''),
    String(row['所属片区'] ?? ''),
    String(row['测点编号'] ?? row.id),
    ctx,
    '改动',
  )
}

/** 新登记一条测点时的归属判定。 */
export function checkSlopeCreateAccess(entry: Record<string, string>, ctx: SlopeContext): RuleCheck {
  return ownershipCheck(entry['监测方式'] ?? '', entry['所属片区'] ?? '', (entry['测点编号'] ?? '').trim() || '（未编号）', ctx, '登记')
}

/**
 * 登记/编辑测点的完整校验，冲突时按优先级判定，命中即返回：
 * ① 越权（改动测点编号或监测方式只准监测组；其余改动按监测方式归属与片区判定）
 * ② 监测方式必须落在登记的同一套集合里
 * ③ 测点编号必填，重复提交以先登记的那条为准
 * ④ 本期位移越界挡回
 */
export function validateSlopeEntry(
  entry: Record<string, string>,
  ctx: SlopeContext,
  existing: EntryRow[],
  original?: EntryRow,
): RuleCheck {
  const point = (entry['测点编号'] ?? '').trim()
  if (original) {
    const identityChanged =
      point !== String(original['测点编号'] ?? '') || (entry['监测方式'] ?? '') !== String(original['监测方式'] ?? '')
    if (identityChanged) {
      if (ctx.role !== '监测组') {
        return { ok: false, message: `测点编号与监测方式只准监测组改动，「${ctx.role}」越权，已拦下` }
      }
    } else {
      const access = checkSlopeAccess(original, ctx)
      if (!access.ok) return access
    }
  } else {
    const access = checkSlopeCreateAccess(entry, ctx)
    if (!access.ok) return access
  }
  if (!isMonitorMethod(entry['监测方式'] ?? '')) {
    return { ok: false, message: `监测方式「${entry['监测方式'] ?? ''}」不在登记范围（${MONITOR_METHODS.join('、')}）` }
  }
  if (!point) {
    return { ok: false, message: '测点编号不能为空' }
  }
  const duplicated = existing.find(
    (row) => String(row['测点编号'] ?? '') === point && Number(row.id) !== Number(original?.id ?? -1),
  )
  if (duplicated) {
    return {
      ok: false,
      message: `测点编号 ${point} 已由 #${duplicated.id} 登记，重复提交以先登记的那条为准，本次已挡回`,
    }
  }
  const raw = (entry['本期位移'] ?? '').trim()
  if (raw !== '') {
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      return { ok: false, message: `本期位移「${raw}」不是有效数值，已挡回` }
    }
    if (Math.abs(value) > PERIOD_DISPLACEMENT_LIMIT) {
      return { ok: false, message: `本期位移 ${raw}mm 越界（允许 ±${PERIOD_DISPLACEMENT_LIMIT}mm），已挡回` }
    }
  }
  return OK
}

/**
 * 状态流转校验，同样按优先级：先越权，再单向固定次序（只能走到紧邻的下一环）。
 */
export function validateSlopeTransition(row: EntryRow, action: string, target: string, ctx: SlopeContext): RuleCheck {
  const access = checkSlopeAccess(row, ctx)
  if (!access.ok) return access
  const currentIndex = SLOPE_STATUS_FLOW.indexOf(String(row.status))
  const targetIndex = SLOPE_STATUS_FLOW.indexOf(target)
  if (currentIndex < 0 || targetIndex < 0) {
    return { ok: false, message: `状态「${row.status}」不在登记的流转环节（${SLOPE_STATUS_FLOW.join('→')}）内` }
  }
  if (targetIndex !== currentIndex + 1) {
    return {
      ok: false,
      message: `流转是单向的，须按 ${SLOPE_STATUS_FLOW.join('→')} 依次进行；当前「${row.status}」不能执行「${action}」`,
    }
  }
  return OK
}
