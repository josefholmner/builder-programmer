import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMachineFile, encodeMachineFile, maxMachineFileBytes } from './machine-file.js'
import { blankMachine, bounds, completionPort, copyProgramNodes, createProgram, fitsBuildArea, leftEdge, levels, parts, pasteProgramNodes, pistonAngle, placePart, removePart, starterMachine, terrainY } from './model.js'
import { createSimulation, initializePhysics, STEP } from './physics.js'

test('construction keeps full parts inside the bounds and clears removed actuator targets', () => {
  assert.ok(Math.abs(bounds.width * bounds.height - 12 * 7 * 0.6) < 1e-9)
  const machine = blankMachine()
  assert.equal(placePart(machine, 'wheel', 0, 0, null), undefined)
  const base = placePart(machine, 'beam', 50, -50, null)
  assert.equal(placePart(machine, 'treadWheel', 0, 0, base.id), undefined)
  assert.equal(placePart(machine, 'ram', 0, 0, base.id), undefined)
  assert.equal(base.x + 1.5, bounds.width / 2)
  assert.equal(base.y - 0.275, -bounds.height / 2)
  assert.ok(fitsBuildArea(base))
  assert.equal(fitsBuildArea({ ...base, x: 5 }), false)
  const hinge = placePart(machine, 'hinge', 0, 0, base.id)
  placePart(machine, 'block', 1, 0, hinge.id)
  machine.nodes.push({ type: 'position', target: hinge.id })
  removePart(machine, hinge.id)
  assert.deepEqual(machine.parts.map(part => part.id), [base.id])
  assert.equal(machine.nodes.at(-1).target, '')
})

test('quarter-turns affect the footprint and the collision shape of a primitive', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const beam = placePart(machine, 'beam', 0, 50, null, 1)
  assert.equal(beam.y, (bounds.height - parts.beam.width) / 2)
  assert.ok(fitsBuildArea(beam))
  assert.equal(fitsBuildArea({ ...beam, y: beam.y + 0.1 }), false)

  const simulation = createSimulation(machine, levels[0])
  try {
    while (simulation.elapsed < 0.6) simulation.step()
    const [vertical] = simulation.poses()
    assert.ok(Math.abs(vertical.angle - Math.PI / 2) < 0.025)
    assert.ok(Math.abs(vertical.y - parts.beam.width / 2) < 0.025)
  } finally {
    simulation.dispose()
  }
})

test('the starter graph waits before commanding both wheels', () => {
  const commands = []
  const program = createProgram(starterMachine(), (part, ...args) => commands.push([part.id, ...args]))
  program.step(0)
  program.step(0.29)
  assert.deepEqual(commands, [])
  program.step(0.3)
  assert.deepEqual(commands, [['rear', 'speed', 8], ['front', 'speed', 8]])
})

test('a delayed cycle repeats and a cycle without a delay yields control', () => {
  const machine = starterMachine()
  machine.links.drive = 'delay'
  const commands = []
  const program = createProgram(machine, part => commands.push(part.id))
  program.step(0)
  assert.equal(program.step(0.3).stalled, false)
  assert.equal(program.step(0.6).stalled, false)
  assert.deepEqual(commands, ['rear', 'front', 'rear', 'front'])
  machine.nodes[1].value = 0
  assert.equal(createProgram(machine, () => {}).step(0).stalled, true)
})

test('counted loops repeat a nested body and use the completion output', () => {
  const machine = starterMachine()
  machine.nodes = [
    { id: 'start', type: 'start' },
    { id: 'outer', type: 'for', value: 2 },
    { id: 'inner', type: 'for', value: 3 },
    { id: 'drive', type: 'speed', value: 8, target: 'rear' },
    { id: 'after-inner', type: 'speed', value: 4, target: 'rear' },
    { id: 'after-outer', type: 'speed', value: 0, target: 'rear' }
  ]
  machine.links = { start: 'outer', outer: 'inner', inner: 'drive',
    'drive': 'inner', [completionPort('inner')]: 'after-inner', [completionPort('outer')]: 'after-outer' }
  const speeds = []
  const program = createProgram(machine, (_, mode, value) => speeds.push(value))
  assert.deepEqual(program.step(0), { active: undefined, stalled: false })
  assert.deepEqual(speeds, [8, 8, 8, 4, 8, 8, 8, 4, 0])

  machine.nodes[1].value = 0
  speeds.length = 0
  createProgram(machine, (_, mode, value) => speeds.push(value)).step(0)
  assert.deepEqual(speeds, [0])
})

test('while checks elapsed time between iterations and finishes a body that is waiting', () => {
  const machine = starterMachine()
  machine.nodes = [
    { id: 'start', type: 'start' },
    { id: 'loop', type: 'while', value: 0.5 },
    { id: 'drive', type: 'speed', value: 8, target: 'rear' },
    { id: 'wait', type: 'delay', value: 0.3 },
    { id: 'stop', type: 'speed', value: 0, target: 'rear' }
  ]
  machine.links = { start: 'loop', loop: 'drive', drive: 'wait', [completionPort('loop')]: 'stop' }
  const speeds = []
  const program = createProgram(machine, (_, mode, value) => speeds.push(value))
  for (const time of [0, 0.25, 0.3, 0.5, 0.59]) assert.equal(program.step(time).stalled, false)
  assert.deepEqual(speeds, [8, 8])
  assert.deepEqual(program.step(0.6), { active: undefined, stalled: false })
  assert.deepEqual(speeds, [8, 8, 0])

  delete machine.links.drive
  speeds.length = 0
  const immediate = createProgram(machine, (_, mode, value) => speeds.push(value))
  assert.equal(immediate.step(0).active, 'loop')
  assert.equal(immediate.step(0.25).active, 'loop')
  assert.equal(immediate.step(0.5).active, undefined)
  assert.deepEqual(speeds, [8, 8, 0])
})

test('copying program nodes preserves internal loop wires and leaves original nodes intact', () => {
  const machine = starterMachine()
  machine.nodes.push({ id: 'loop', type: 'for', value: 3, x: 235, y: 255 })
  machine.links.start = 'loop'
  machine.links.loop = 'delay'
  machine.links[completionPort('loop')] = 'drive'
  const copy = copyProgramNodes(machine, new Set(['start', 'loop', 'delay', 'drive']))
  const [delay, drive, loop] = pasteProgramNodes(machine, copy, 60, 70)

  assert.equal(machine.nodes.filter(node => node.type === 'start').length, 1)
  assert.equal(machine.links.start, 'loop')
  assert.equal(machine.links[loop], delay)
  assert.equal(machine.links[completionPort(loop)], drive)
  assert.equal(machine.links[delay], drive)
  assert.notEqual(loop, 'loop')
  assert.deepEqual(machine.nodes.slice(-3).map(({ x, y, value }) => [x, y, value]),
    [[60, 70, 0.3], [260, 70, 8], [60, 270, 3]])
  const partial = copyProgramNodes(machine, new Set(['loop', 'drive']))
  assert.deepEqual(partial.links, [[completionPort('loop'), 'drive']])
})

test('all four wheel speed commands keep driving after the chassis reaches the step', async () => {
  await initializePhysics()
  const machine = starterMachine()
  machine.parts = [machine.parts[0], ...Array.from({ length: 4 }, (_, index) => ({
    id: 'wheel-' + index, type: 'wheel', parent: 'chassis', x: index * 1.5 - 2.25, y: 0
  }))]
  machine.nodes = [{ id: 'start', type: 'start' }, ...machine.parts.slice(1).map((wheel, index) => ({
    id: 'drive-' + index, type: 'speed', value: 8, target: wheel.id
  }))]
  machine.links = Object.fromEntries(machine.nodes.slice(1).map((node, index) => [machine.nodes[index].id, node.id]))
  const simulation = createSimulation(machine, levels[1])
  try {
    while (simulation.elapsed < 4.8) simulation.step()
    const before = simulation.poses()
    while (simulation.elapsed < 5) simulation.step()
    const after = simulation.poses()
    for (let index = 1; index < after.length; index++) {
      const angle = after[index].angle - before[index].angle - (after[0].angle - before[0].angle)
      assert.ok(Math.atan2(Math.sin(angle), Math.cos(angle)) < -0.35, after[index].id + ' stalled')
    }
  } finally {
    simulation.dispose()
  }
})

function wheelTurns(simulation, start, end) {
  while (simulation.elapsed < start && simulation.status === 'running') simulation.step()
  let before = new Map(simulation.poses().map(part => [part.id, part]))
  const turns = new Map([...before.values()].filter(part => part.type === 'wheel').map(part => [part.id, 0]))
  while (simulation.elapsed < end && simulation.status === 'running') {
    simulation.step()
    const after = new Map(simulation.poses().map(part => [part.id, part]))
    for (const [id, cumulative] of turns) {
      const part = after.get(id)
      const angle = (part.angle - after.get(part.parent).angle) -
        (before.get(id).angle - before.get(part.parent).angle)
      turns.set(id, cumulative + Math.atan2(Math.sin(angle), Math.cos(angle)))
    }
    before = after
  }
  return turns
}

test('wheels recover even when launching under load keeps them from reaching speed', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const wheelY = -(bounds.height - parts.wheel.height) / 2
  machine.parts = [
    { id: 'base', type: 'ball', parent: null, x: 0, y: 1.5 },
    { id: 'rear', type: 'ball', parent: 'base', x: -4.25, y: 1.5 },
    { id: 'front', type: 'ball', parent: 'rear', x: 4.25, y: 1.5 },
    { id: 'rear-wheel', type: 'wheel', parent: 'rear', x: -4.14, y: wheelY, maxForce: 2000 },
    { id: 'front-wheel', type: 'wheel', parent: 'front', x: 4.14, y: wheelY, maxForce: 2000 },
    { id: 'front-piston', type: 'piston', parent: 'front', x: 2.75, y: -1.75 },
    { id: 'front-inner-wheel', type: 'wheel', parent: 'front-piston', x: 2.5, y: wheelY, maxForce: 2000 },
    { id: 'rear-piston', type: 'piston', parent: 'rear', x: -3, y: -1.5 },
    { id: 'rear-inner-wheel', type: 'wheel', parent: 'rear-piston', x: -2.75, y: wheelY, maxForce: 2000 }
  ]
  const start = machine.nodes[0].id
  machine.nodes.push(
    { id: 'drive', type: 'speed', value: 5, target: '*' },
    { id: 'extend', type: 'speed', value: 5, target: 'front-piston' }
  )
  machine.links = { [start]: 'drive', drive: 'extend' }

  const simulation = createSimulation(machine, levels[1])
  try {
    for (const [id, angle] of wheelTurns(simulation, 4, 5)) {
      assert.ok(angle < -2, id + ' failed to recover from a slow launch')
    }
  } finally {
    simulation.dispose()
  }
})

test('piston-mounted driven wheels recover under load on the step', async () => {
  await initializePhysics()
  const machine = blankMachine()
  machine.parts = [
    { id: 'front-beam', type: 'beam', parent: null, x: 1.5, y: 0.75 },
    { id: 'rear-beam', type: 'beam', parent: 'front-beam', x: -1.5, y: 0.75 },
    { id: 'front-wheel', type: 'wheel', parent: 'front-beam', x: 3.25, y: -1.75 },
    { id: 'rear-wheel', type: 'wheel', parent: 'rear-beam', x: -2.75, y: -1.75 },
    { id: 'front-piston', type: 'piston', parent: 'front-beam', x: 1.5, y: -0.75 },
    { id: 'front-piston-wheel', type: 'wheel', parent: 'front-piston', x: 1.5, y: -1.75 },
    { id: 'rear-piston', type: 'piston', parent: 'rear-beam', x: -3.5, y: -1 },
    { id: 'rear-piston-wheel', type: 'wheel', parent: 'rear-piston', x: -4.14, y: -1.75 }
  ]
  machine.nodes.push(
    { id: 'drive', type: 'speed', value: 10, target: '*' },
    { id: 'wait-1', type: 'delay', value: 2 },
    { id: 'extend-front', type: 'speed', value: 5, target: 'front-piston' },
    { id: 'wait-2', type: 'delay', value: 4 },
    { id: 'retract-front', type: 'speed', value: -20, target: 'front-piston' },
    { id: 'wait-3', type: 'delay', value: 1 },
    { id: 'extend-rear', type: 'speed', value: 10, target: 'rear-piston' },
    { id: 'wait-4', type: 'delay', value: 1 },
    { id: 'retract-rear', type: 'speed', value: -20, target: 'rear-piston' }
  )
  machine.links = Object.fromEntries(machine.nodes.slice(1).map((node, index) => [machine.nodes[index].id, node.id]))

  const level = levels.find(level => level.id === 'step')
  const simulation = createSimulation(machine, level)
  try {
    for (const [id, angle] of wheelTurns(simulation, 4, 6)) {
      assert.ok(angle < -9, id + ' stopped turning under load')
    }
    while (simulation.elapsed < 20 && simulation.status === 'running') simulation.step()
    assert.equal(simulation.status, 'won')
  } finally {
    simulation.dispose()
  }
})

test('a shared machine preserves its geometry, actuator settings, and program when replayed', async () => {
  await initializePhysics()
  const machine = starterMachine()
  machine.name = 'Bana 2 – prov'
  machine.parts[0].turns = 1
  machine.parts[1].maxForce = 320
  machine.nodes.push({ id: 'loop', type: 'for', value: 2, x: 625, y: 55 })
  machine.links = { start: 'loop', loop: 'delay', delay: 'loop', [completionPort('loop')]: 'drive' }

  const exported = encodeMachineFile({ ...machine, unrelated: 'browser-only settings' })
  const imported = decodeMachineFile(exported)
  assert.deepEqual(imported, machine)

  const original = createSimulation(machine, levels[0])
  const roundTrip = createSimulation(imported, levels[0])
  try {
    for (let step = 0; step < 240; step++) {
      original.step()
      roundTrip.step()
    }
    assert.deepEqual(roundTrip.poses(), original.poses())
  } finally {
    original.dispose()
    roundTrip.dispose()
  }
})

test('invalid machine files are rejected before import', () => {
  const good = encodeMachineFile(starterMachine())
  assert.throws(() => decodeMachineFile('{broken'), { code: 'machineFileInvalid' })
  assert.throws(() => decodeMachineFile(good.replace('"version": 1', '"version": 2')), { code: 'machineFileVersion' })
  assert.throws(() => decodeMachineFile(' '.repeat(maxMachineFileBytes + 1)), { code: 'machineFileTooLarge' })
  const invalidMachines = [
    data => { data.parts[1].parent = data.parts[1].id },
    data => { data.parts[0].id = 'constructor' },
    data => { data.nodes[0].id = '"><script>' },
    data => { data.nodes[2].target = 'missing-part' },
    data => { data.links.delay = 'missing-node' },
    data => { data.links['delay:done'] = 'drive' }
  ]
  for (const mutate of invalidMachines) {
    const document = JSON.parse(good)
    mutate(document.machine)
    assert.throws(() => decodeMachineFile(JSON.stringify(document)), { code: 'machineFileInvalid' })
  }
})

test('the flat course requires the entire rover to cross the finish line', async () => {
  await initializePhysics()
  const [level] = levels
  const simulation = createSimulation(starterMachine(), level)
  let splitFinish = false
  try {
    while (simulation.status === 'running') {
      simulation.step()
      const edges = simulation.poses().map(part => leftEdge(part, part.x, part.angle))
      if (edges.some(edge => edge >= level.finish) && edges.some(edge => edge < level.finish)) {
        assert.equal(simulation.status, 'running')
        splitFinish = true
      }
    }
    assert.equal(splitFinish, true)
    assert.equal(simulation.status, 'won')
    assert.ok(simulation.poses().every(part => leftEdge(part, part.x, part.angle) >= level.finish))
  } finally {
    simulation.dispose()
  }
})

const obstacleDesigns = [
  {
    id: 'step', chassisY: 0.75, rearX: -2, frontX: 2, arm: [3, 1.5], wheel: [3.25, 0.25],
    speed: 17, commands: [['delay', 0.42], ['position', 92], ['delay', 0.86], ['position', 0]]
  },
  {
    id: 'pit', chassisY: 2, rearX: -2, frontX: 1.5, arm: [2, -0.25], wheel: [2.5, 1.5],
    speed: 23, commands: [['delay', 1.63], ['position', -154], ['delay', 0.5], ['position', 0]]
  }
]

for (const design of obstacleDesigns) {
  test(design.id + ' blocks the rover and can be passed with a programmed mechanism', async () => {
    await initializePhysics()
    const level = levels.find(level => level.id === design.id)
    function outcome(machine) {
      const simulation = createSimulation(machine, level)
      try {
        while (simulation.status === 'running') simulation.step()
        return simulation.status
      } finally {
        simulation.dispose()
      }
    }
    assert.equal(outcome(starterMachine()), 'lost')

    const machine = starterMachine()
    machine.parts.pop()
    const [chassis, rear, front] = machine.parts
    chassis.y = design.chassisY
    rear.x = design.rearX
    front.x = design.frontX
    const arm = placePart(machine, 'hinge', ...design.arm, chassis.id)
    placePart(machine, 'wheel', ...design.wheel, arm.id)
    const drive = machine.nodes.at(-1)
    drive.value = design.speed
    assert.ok(machine.parts.every(fitsBuildArea))
    assert.equal(outcome(machine), 'lost')

    let previous = drive.id
    for (const [type, value] of design.commands) {
      const id = 'command-' + machine.nodes.length
      machine.nodes.push({ id, type, value, target: arm.id })
      machine.links[previous] = id
      previous = id
    }
    assert.equal(outcome(machine), 'won')
  })
}

test('the three later courses block the starter rover', async () => {
  await initializePhysics()
  for (const level of levels.slice(3)) {
    const simulation = createSimulation(starterMachine(), level)
    try {
      while (simulation.status === 'running') simulation.step()
      assert.equal(simulation.status, 'lost', level.id)
    } finally {
      simulation.dispose()
    }
  }
})

test('an overhead obstacle blocks tall machines and leaves clearance for short ones', async () => {
  await initializePhysics()
  const level = { ...levels[0], obstacles: [[[10, 2], [14, 2], [14, 4], [10, 4]]] }
  for (const tall of [true, false]) {
    const rover = starterMachine()
    if (!tall) rover.parts.pop()
    const simulation = createSimulation(rover, level)
    try {
      while (simulation.status === 'running' && simulation.elapsed < 15) simulation.step()
      assert.equal(simulation.status === 'won', !tall)
    } finally {
      simulation.dispose()
    }
  }
})

test('the blob resists slipping and releases when lifted from the ground', async () => {
  await initializePhysics()
  const slope = { finish: 35, points: [[-12, 14.4], [20, -24], [40, -24]] }
  function slip(type) {
    const machine = blankMachine()
    const frame = placePart(machine, 'beam', 0, 1, null)
    placePart(machine, type, -1, 0, frame.id)
    placePart(machine, type, 1, 0, frame.id)
    const simulation = createSimulation(machine, slope)
    try {
      const start = simulation.poses()[0].x
      while (simulation.elapsed < 1.5 && simulation.status === 'running') simulation.step()
      return simulation.poses()[0].x - start
    } finally {
      simulation.dispose()
    }
  }
  assert.ok(slip('blob') + 0.5 < slip('ball'))

  const machine = blankMachine()
  const frame = placePart(machine, 'beam', 0, 1.5, null)
  placePart(machine, 'strut', -1, 0.5, frame.id)
  placePart(machine, 'strut', 1, 0.5, frame.id)
  const ram = { id: 'legacy-ram', type: 'ram', parent: frame.id, x: 0, y: 0.25 }
  machine.parts.push(ram)
  const blob = placePart(machine, 'blob', 0, -0.25, ram.id)
  machine.nodes.push(
    { id: 'settle', type: 'delay', value: 1 },
    { id: 'lift', type: 'position', value: -0.35, target: ram.id }
  )
  machine.links = { [machine.nodes[0].id]: 'settle', settle: 'lift' }
  const simulation = createSimulation(machine, levels[0])
  try {
    const clearance = () => simulation.poses().find(part => part.id === blob.id).y - parts.blob.height / 2
    while (simulation.elapsed < 0.9) simulation.step()
    assert.ok(Math.abs(clearance()) < 0.02)
    while (simulation.elapsed < 2) simulation.step()
    assert.ok(clearance() > 0.2)
  } finally {
    simulation.dispose()
  }
})

test('the servo and long-stroke ram stop at their travel limits', async () => {
  await initializePhysics()
  for (const [type, target] of [['servo', 160], ['ram', 3]]) {
    const machine = blankMachine()
    const base = placePart(machine, 'beam', 0, 0, null)
    const motor = { id: type, type, parent: base.id, x: 0, y: 1.5 }
    machine.parts.push(motor)
    machine.nodes.push({ id: 'move', type: 'position', target: motor.id, value: target, x: 245, y: 55 })
    machine.links[machine.nodes[0].id] = 'move'
    const simulation = createSimulation(decodeMachineFile(encodeMachineFile(machine)), levels[0])
    try {
      while (simulation.elapsed < 3) simulation.step()
      const [parent, part] = simulation.poses()
      if (type === 'servo') {
        assert.ok(Math.abs(part.angle - parent.angle + Math.PI / 3) < 0.025)
      } else {
        const extension = Math.hypot(part.x - parent.x, part.y - parent.y) - 1.5
        assert.ok(Math.abs(extension - 2.7) < 0.025)
      }
    } finally {
      simulation.dispose()
    }
  }
})

test('the pit floor supports a rover while it drives across the bottom', async () => {
  await initializePhysics()
  const pit = levels.find(level => level.id === 'pit')
  // Put the regular starting position just inside the pit to isolate driving on its floor.
  const level = { ...pit, points: pit.points.map(([x, y]) => [x - 13.25, y]) }
  const simulation = createSimulation(starterMachine(), level)
  let firstGroundedX
  let furthestGroundedX = -Infinity
  try {
    while (simulation.elapsed < 2) {
      simulation.step()
      const poses = simulation.poses()
      const grounded = poses.filter(part => part.type === 'wheel').every(wheel => {
        const surface = terrainY(level, wheel.x)
        return surface < 0 && Math.abs(wheel.y - parts.wheel.height / 2 - surface) < 0.02
      })
      if (!grounded) continue
      firstGroundedX ??= poses[0].x
      furthestGroundedX = Math.max(furthestGroundedX, poses[0].x)
    }
    assert.ok(furthestGroundedX - firstGroundedX > 0.5)
  } finally {
    simulation.dispose()
  }
})

test('a hinge carrying three drive wheels stays together on first ground contact', async () => {
  await initializePhysics()
  const machine = starterMachine()
  const chassis = { ...machine.parts[0], x: -0.25, y: 1.5 }
  machine.parts = [
    chassis,
    { ...machine.parts[1], x: -2.75, y: -0.5 },
    { ...machine.parts[3], x: -0.5, y: 2.125 },
    { id: 'hub', type: 'hinge', parent: chassis.id, x: 2, y: -0.75 },
    { id: 'lower', type: 'wheel', parent: 'hub', x: 2.75, y: -1.925 },
    { id: 'upper', type: 'wheel', parent: 'hub', x: 3, y: 0.75 },
    { id: 'inner', type: 'wheel', parent: 'hub', x: 0.25, y: -1 }
  ]
  const connections = machine.parts.slice(1).map(part => {
    const parent = machine.parts.find(candidate => candidate.id === part.parent)
    return [part.id, parent.id, Math.hypot(part.x - parent.x, part.y - parent.y)]
  })

  for (const drive of [false, true]) {
    const simulation = createSimulation({ ...machine, links: drive ? machine.links : {} }, levels[0])
    try {
      let previous = new Map(simulation.poses().map(part => [part.id, part]))
      while (simulation.status === 'running' && simulation.elapsed < (drive ? 12 : 3)) {
        simulation.step()
        const poses = new Map(simulation.poses().map(part => [part.id, part]))
        for (const [id, parentId, rest] of connections) {
          const part = poses.get(id)
          const parent = poses.get(parentId)
          const last = previous.get(id)
          const stretch = Math.abs(Math.hypot(part.x - parent.x, part.y - parent.y) - rest)
          const speed = Math.hypot(part.x - last.x, part.y - last.y) / STEP
          assert.ok(stretch < 0.02, id + ' stretched by ' + stretch + ' m')
          assert.ok(speed < 15, id + ' reached ' + speed + ' m/s')
        }
        previous = poses
      }
      assert.equal(simulation.status, drive ? 'won' : 'running')
    } finally {
      simulation.dispose()
    }
  }
})

test('the hinge keeps its mount fixed and drives an attached beam in both directions', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const base = placePart(machine, 'beam', 0, -2, null)
  const hinge = placePart(machine, 'hinge', 0.5, 1, base.id)
  placePart(machine, 'beam', 1.5, 1, hinge.id)
  machine.nodes.push(
    { id: 'hold', type: 'delay', value: 0.6 },
    { id: 'forward', type: 'speed', value: 2.5, target: hinge.id },
    { id: 'wait', type: 'delay', value: 0.6 },
    { id: 'reverse', type: 'speed', value: -2.5, target: hinge.id },
    { id: 'wait-to-stop', type: 'delay', value: 0.6 },
    { id: 'stop', type: 'speed', value: 0, target: hinge.id }
  )
  machine.links = {
    [machine.nodes[0].id]: 'hold', hold: 'forward', forward: 'wait', wait: 'reverse',
    reverse: 'wait-to-stop', 'wait-to-stop': 'stop'
  }

  const simulation = createSimulation(machine, levels[0])
  const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle))
  function sample(time) {
    while (simulation.elapsed < time) simulation.step()
    const [parent, rotor, beam] = simulation.poses()
    const dx = rotor.x - parent.x
    const dy = rotor.y - parent.y
    const cosine = Math.cos(parent.angle)
    const sine = Math.sin(parent.angle)
    assert.ok(Math.abs(dx * cosine + dy * sine - (hinge.x - base.x)) < 0.04)
    assert.ok(Math.abs(dy * cosine - dx * sine - (hinge.y - base.y)) < 0.04)
    assert.ok(Math.abs(wrapAngle(beam.angle - rotor.angle)) < 0.04)
    return wrapAngle(beam.angle - parent.angle)
  }

  try {
    assert.ok(Math.abs(sample(0.55)) < 0.08)
    const clockwiseStart = sample(0.75)
    const clockwise = wrapAngle(sample(1.15) - clockwiseStart)
    assert.ok(clockwise < -0.8, 'clockwise change: ' + clockwise)
    const counterclockwiseStart = sample(1.35)
    const counterclockwise = wrapAngle(sample(1.75) - counterclockwiseStart)
    assert.ok(counterclockwise > 0.8, 'counterclockwise change: ' + counterclockwise)
    const stopped = sample(2)
    assert.ok(Math.abs(wrapAngle(sample(2.6) - stopped)) < 0.04)
  } finally {
    simulation.dispose()
  }
})

test('a piston needs enough configured force to lift a heavy frame', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const base = placePart(machine, 'beam', 0, 1, null)
  placePart(machine, 'beam', 0, 1.5, base.id)
  placePart(machine, 'beam', 0, 2, base.id)
  const piston = placePart(machine, 'piston', 0, 0, base.id)
  machine.nodes.push({ id: 'push', type: 'speed', value: 2, target: piston.id })
  machine.links[machine.nodes[0].id] = 'push'

  for (const [force, lifts] of [[10, false], [100, true], [undefined, true]]) {
    piston.maxForce = force
    const simulation = createSimulation(machine, levels[0])
    try {
      while (simulation.elapsed < 2) simulation.step()
      const height = simulation.poses()[0].y
      assert.equal(height > 2, lifts, 'chassis height at force ' + force + ': ' + height)
    } finally {
      simulation.dispose()
    }
  }
})

test('hinge and piston motors hold their programmed positions under gravity', async () => {
  await initializePhysics()
  const machine = blankMachine()
  const base = placePart(machine, 'beam', 0, 0, null)
  const hinge = placePart(machine, 'hinge', 1, 1, base.id)
  const piston = placePart(machine, 'piston', -1, 1, base.id)
  machine.nodes.push(
    { id: 'rotate', type: 'position', value: 45, target: hinge.id },
    { id: 'extend', type: 'position', value: 1, target: piston.id }
  )
  machine.links = { [machine.nodes[0].id]: 'rotate', rotate: 'extend' }
  const simulation = createSimulation(machine, levels[0])
  try {
    for (let i = 0; i < 360; i++) simulation.step()
    const [parent, rotated, extended] = simulation.poses()
    const angle = rotated.angle - parent.angle
    const extension = Math.hypot(extended.x - parent.x, extended.y - parent.y) - Math.sqrt(2)
    assert.ok(Math.abs(angle + Math.PI / 4) < 0.1, 'hinge angle in radians: ' + angle)
    assert.ok(Math.abs(extension - 1) < 0.05, 'piston extension in meters: ' + extension)
    const mountAngle = pistonAngle(extended, parent)
    assert.ok(Math.abs(Math.sin(extended.angle - mountAngle)) < 0.025, 'piston body follows the attachment axis')
  } finally {
    simulation.dispose()
  }
})
