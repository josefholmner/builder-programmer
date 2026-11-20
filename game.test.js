import assert from 'node:assert/strict'
import test from 'node:test'
import { blankMachine, bounds, createProgram, fitsBuildArea, leftEdge, levels, parts, placePart, removePart, starterMachine, terrainY } from './model.js'
import { createSimulation, initializePhysics } from './physics.js'

test('construction keeps full parts inside the bounds and clears removed actuator targets', () => {
  assert.ok(Math.abs(bounds.width * bounds.height - 12 * 7 * 0.6) < 1e-9)
  const machine = blankMachine()
  assert.equal(placePart(machine, 'wheel', 0, 0, null), undefined)
  const base = placePart(machine, 'beam', 50, -50, null)
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
    id: 'step', armType: 'hinge', chassisY: 1.5, rearX: -1, frontX: 1.75, arm: [1.75, 0.75], wheel: [2.25, 0.75],
    speed: 14, commands: [['delay', 1.69], ['position', 37], ['delay', 0.6], ['position', 0]]
  },
  {
    id: 'pit', armType: 'hinge', chassisY: 1, rearX: -2.25, frontX: 1, arm: [2.25, 0.75], wheel: [2.25, 1.5],
    speed: 15, commands: [['delay', 1.78], ['position', -57], ['delay', 0.59], ['position', 0]]
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
    const arm = placePart(machine, design.armType, ...design.arm, chassis.id)
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
  } finally {
    simulation.dispose()
  }
})
