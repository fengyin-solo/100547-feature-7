/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 单向流转：动作允许发起的源状态。配置了的模块，动作只能从指定状态发起，不能跳步或回退。 */
  actionSources?: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 当前操作人的身份上下文：角色 + 所属片区，权限判定只看这个。 */
export type SessionContext = {
  role: 'observer' | 'monitor'
  area: string
  operator: string
}

/** 任务分派结果：一种监测方式一组，组内按归口单位再分。 */
export type SlopeAssignment = {
  method: string
  groups: { owner: string; rows: EntryRow[] }[]
}
