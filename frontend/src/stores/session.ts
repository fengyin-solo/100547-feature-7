import { defineStore } from 'pinia'

import type { SlopeRole } from '@/data/slope-rules'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '山地地质灾害隐患巡查与治理工作台',
    // 边坡观测分派用的值班身份：人工观测归片区观测人，自动监测归监测组。
    role: '片区观测人' as SlopeRole,
    area: '东山片区',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
