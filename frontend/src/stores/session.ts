import { defineStore } from 'pinia'

import { OBSERVER_AREAS, ROLE_LABELS, type Role } from '@/data/monitoring'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    // 当前身份：片区观测人维护本片区人工观测测点，监测组维护自动监测测点。
    role: 'observer' as Role,
    area: OBSERVER_AREAS[0] as string,
    shiftLabel: '白班 08:00-20:00',
    scope: '山地地质灾害隐患巡查与治理工作台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    roleLabel: (state) => ROLE_LABELS[state.role],
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Role) {
      this.role = role
    },
    setArea(area: string) {
      this.area = area
    },
  },
})
