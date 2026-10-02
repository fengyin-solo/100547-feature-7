// 边坡观测的公共规则：监测方式字典、片区、角色、位移阈值、拦截优先级。
// 监测方式只在这里定义一次——边坡形变页面的下拉选项和任务分派的归口逻辑
// 都从这同一个常量读，两条路径看到的永远是同一套，不会各说各话。

export const MONITORING_METHODS = ['人工观测', '自动监测'] as const
export type MonitoringMethod = (typeof MONITORING_METHODS)[number]

export const MANUAL_METHOD: MonitoringMethod = '人工观测'
export const AUTO_METHOD: MonitoringMethod = '自动监测'

// 观测片区：人工观测测点按片区分派给本片区观测人维护。
export const OBSERVER_AREAS = ['东片区', '西片区', '北片区'] as const
export type ObserverArea = (typeof OBSERVER_AREAS)[number]

// 角色：片区观测人维护本片区的人工观测测点；监测组维护全部自动监测测点。
export const ROLES = ['observer', 'monitor'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  observer: '片区观测人',
  monitor: '监测组',
}

// 本期位移允许范围（mm）：绝对值超过这个值的提交一律挡回。
export const DISPLACEMENT_LIMIT_MM = 50

export function isDisplacementOutOfRange(value: unknown): boolean {
  const num = Number(value)
  return !Number.isFinite(num) || Math.abs(num) > DISPLACEMENT_LIMIT_MM
}

// 管控字段：测点编号是身份字段，一经登记任何人不得改动；
// 监测方式决定任务归口，只允许监测组调整，其他人改一律算越权。
export const IDENTITY_FIELDS = ['测点编号'] as const
export const MONITOR_ONLY_FIELDS = ['监测方式'] as const

// 拦截规则优先级：一次提交同时踩中多条规则时按这个顺序判定，先命中的先报。
// 越权拦截 > 越界挡回 > 重复登记 > 流转校验。
export const RULE_PRIORITY = ['越权拦截', '越界挡回', '重复登记', '流转校验'] as const
