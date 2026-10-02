// 冒烟验证：把边坡观测的规则链在 Node 里跑一遍（localStorage 用内存桩）。
// 用法：esbuild 打包后 node 运行，见 package 脚本或手动命令。
const store: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
  },
}

async function main() {
  const service = await import('@/api/local-service')
  const { MONITORING_METHODS } = await import('@/data/monitoring')

  const east = { role: 'observer', area: '东片区', operator: '王建国' } as const
  const west = { role: 'observer', area: '西片区', operator: '李秀兰' } as const
  const monitor = { role: 'monitor', area: '', operator: '监测组' } as const

  let pass = 0
  let fail = 0
  function check(name: string, cond: boolean, detail = '') {
    if (cond) {
      pass += 1
      console.log(`  ✓ ${name}`)
    } else {
      fail += 1
      console.log(`  ✗ ${name} ${detail}`)
    }
  }

  console.log('1. 监测方式两条路径同一套')
  const methods = service.listMonitoringMethods()
  check('字典内容一致', JSON.stringify(methods) === JSON.stringify(MONITORING_METHODS))
  const assignments = service.listSlopeAssignments()
  check(
    '分派按同一套字典分组',
    JSON.stringify(assignments.map((a) => a.method)) === JSON.stringify(MONITORING_METHODS),
  )

  console.log('2. 任务分派归口')
  const manual = assignments.find((a) => a.method === '人工观测')
  const auto = assignments.find((a) => a.method === '自动监测')
  check('人工观测按片区分派', manual?.groups.every((g) => g.owner.endsWith('片区观测人')) ?? false)
  check('自动监测归监测组', auto?.groups.length === 1 && auto.groups[0].owner === '监测组')

  console.log('3. 行级权限')
  const rows = service.listEntries('slope').items
  const eastManual = rows.find((r) => r['测点编号'] === 'SLOP-0001')!
  const autoRow = rows.find((r) => r['测点编号'] === 'SLOP-0002')!
  const westManual = rows.find((r) => r['测点编号'] === 'SLOP-0003')!
  check('本片区人工观测可维护', service.canMaintainSlopeRow(eastManual, east).ok)
  check('自动监测观测人只读', !service.canMaintainSlopeRow(autoRow, east).ok)
  check('片区外记录只读', !service.canMaintainSlopeRow(westManual, east).ok)
  check('监测组可维护自动监测', service.canMaintainSlopeRow(autoRow, monitor).ok)
  check('监测组对人工观测只读', !service.canMaintainSlopeRow(eastManual, monitor).ok)

  console.log('4. 登记守卫（越权 > 越界 > 重复）')
  const dupCode = service.registerSlopePoint(
    { 测点编号: 'SLOP-0001', 监测方式: '人工观测', 所属片区: '东片区', 本期位移: '1' },
    east,
  )
  check('重复编号以先登记为准', !dupCode.ok && dupCode.message.includes('以先登记'))
  const outRange = service.registerSlopePoint(
    { 测点编号: 'SLOP-1001', 监测方式: '人工观测', 所属片区: '东片区', 本期位移: '88' },
    east,
  )
  check('越界登记挡回', !outRange.ok && outRange.message.includes('越界挡回'))
  const wrongRole = service.registerSlopePoint(
    { 测点编号: 'SLOP-1002', 监测方式: '自动监测', 所属片区: '东片区', 本期位移: '1' },
    east,
  )
  check('观测人登记自动监测被拦', !wrongRole.ok && wrongRole.message.includes('越权拦截'))
  const wrongArea = service.registerSlopePoint(
    { 测点编号: 'SLOP-1003', 监测方式: '人工观测', 所属片区: '西片区', 本期位移: '1' },
    east,
  )
  check('跨片区登记被拦', !wrongArea.ok && wrongArea.message.includes('越权拦截'))
  const okReg = service.registerSlopePoint(
    { 测点编号: 'SLOP-1004', 监测方式: '人工观测', 所属片区: '东片区', 本期位移: '1.5', 累计位移: '3' },
    east,
  )
  check('本片区人工观测登记成功', okReg.ok)

  console.log('5. 编辑守卫（身份字段 / 监测方式）')
  const changeCode = service.updateSlopeEntry(1, { 测点编号: 'SLOP-9999' }, east)
  check('改测点编号一律拦下', !changeCode.ok && changeCode.message.includes('身份字段'))
  const changeMethod = service.updateSlopeEntry(1, { 监测方式: '自动监测' }, east)
  check('观测人改监测方式被拦', !changeMethod.ok && changeMethod.message.includes('监测组'))
  const monitorChange = service.updateSlopeEntry(1, { 监测方式: '自动监测' }, monitor)
  check('监测组可调整监测方式', monitorChange.ok)
  const revert = service.updateSlopeEntry(1, { 监测方式: '人工观测' }, monitor)
  check('（还原监测方式）', revert.ok)

  console.log('6. 提交观测结论 + 同步削坡减载')
  const before = service.listEntries('cutting').total
  const submit = service.submitSlopeObservation(
    1,
    { 本期位移: '2.4', 累计位移: '14.8', 观测日期: '2026-10-02', 观测人: '王建国' },
    east,
  )
  check('结论提交成功', submit.ok, submit.message)
  const after = service.listEntries('cutting').total
  check('削坡减载多一条', after === before + 1)
  const review = service
    .listEntries('cutting')
    .items.find((r) => String(r['工序编号']) === 'REVIEW-SLOP-0001')
  check('同步记录是待复核测点', review?.status === '待复核')
  const again = service.submitSlopeObservation(
    1,
    { 本期位移: '2.4', 累计位移: '14.8', 观测日期: '2026-10-02', 观测人: '王建国' },
    east,
  )
  check('重复提交以先登记为准', !again.ok && again.message.includes('以先登记'))
  check('重复提交不再补同步记录', service.listEntries('cutting').total === after)
  const outSubmit = service.submitSlopeObservation(
    5,
    { 本期位移: '68.4', 累计位移: '71', 观测日期: '2026-10-02', 观测人: '王建国' },
    east,
  )
  check('越界结论挡回', !outSubmit.ok && outSubmit.message.includes('越界挡回'))
  const crossSubmit = service.submitSlopeObservation(
    3,
    { 本期位移: '1', 累计位移: '10', 观测日期: '2026-10-02', 观测人: '王建国' },
    east,
  )
  check('跨片区提交越权拦截', !crossSubmit.ok && crossSubmit.message.includes('越权拦截'))

  console.log('7. 单向流转')
  const jump = service.runSlopeAction(6, '办理停测', monitor)
  check('待观测不能直接停测', !jump.ok && jump.message.includes('流转校验'))
  const backflow = service.runSlopeAction(1, '提交观测', east)
  check('已正常不能回退重复提交', !backflow.ok)
  const escalate = service.runSlopeAction(3, '标记加剧', west)
  check('正常→变形加剧 放行', escalate.ok)
  const stop = service.runSlopeAction(3, '办理停测', west)
  check('变形加剧→已停测 放行', stop.ok)
  const stoppedAssign = service
    .listSlopeAssignments()
    .flatMap((a) => a.groups)
    .flatMap((g) => g.rows)
    .some((r) => r['测点编号'] === 'SLOP-0003')
  check('已停测不再派任务', !stoppedAssign)

  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
