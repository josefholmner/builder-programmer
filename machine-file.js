import { bounds, isLoop, isMotor, maxMotorForce, parts, sourceNodeId } from './model.js'

const format = 'maskinverkstan-machine'
const version = 1
const nodeTypes = new Set(['start', 'delay', 'speed', 'position', 'for', 'while'])
export const maxMachineFileBytes = 2 * 1024 * 1024
export const maxMachineNameLength = 60

export class MachineFileError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const invalid = message => new MachineFileError('machineFileInvalid', message)
const tooLarge = () => new MachineFileError('machineFileTooLarge', 'Machine files must be 2 MiB or smaller.')
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) &&
  !Object.hasOwn(Object.prototype, value)
const isCoordinate = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit

function machineData(machine) {
  if (!isRecord(machine) || typeof machine.name !== 'string' || machine.name.length > maxMachineNameLength ||
    !Array.isArray(machine.parts) || !machine.parts.length || machine.parts.length > bounds.limit ||
    !Array.isArray(machine.nodes) || !isRecord(machine.links)) {
    throw invalid('Expected a named machine definition with parts, nodes, and links.')
  }
  const partIds = new Set()
  const machineParts = machine.parts.map((part, index) => {
    if (!isRecord(part) || !isId(part.id) || partIds.has(part.id) ||
      typeof part.type !== 'string' || !Object.hasOwn(parts, part.type) ||
      !isCoordinate(part.x, 1000) || !isCoordinate(part.y, 1000) ||
      (index === 0 ? part.parent !== null || parts[part.type].joint : !partIds.has(part.parent))) {
      throw invalid('Invalid part or attachment at index ' + index + '.')
    }
    const { id, type, parent, x, y, turns, maxForce } = part
    const copy = { id, type, parent, x, y }
    if (turns !== undefined) {
      if (!Number.isInteger(turns) || turns < 0 || turns > 3) throw invalid('Invalid rotation for part ' + id + '.')
      copy.turns = turns
    }
    if (maxForce !== undefined) {
      if (!Number.isFinite(maxForce) || maxForce < 0 || maxForce > maxMotorForce) {
        throw invalid('Invalid force limit for part ' + id + '.')
      }
      copy.maxForce = maxForce
    }
    partIds.add(id)
    return copy
  })
  const motors = new Set(machineParts.filter(isMotor).map(part => part.id))
  const nodeById = new Map()
  let startCount = 0
  const nodes = machine.nodes.map((node, index) => {
    if (!isRecord(node) || !isId(node.id) || nodeById.has(node.id) || !nodeTypes.has(node.type) ||
      !isCoordinate(node.x, 1e7) || !isCoordinate(node.y, 1e7)) {
      throw invalid('Invalid program node at index ' + index + '.')
    }
    const { id, type, x, y, value, target } = node
    const copy = { id, type, x, y }
    if (type === 'start') startCount++
    else {
      if (!Number.isFinite(value)) throw invalid('Invalid value for node ' + id + '.')
      copy.value = value
    }
    if (target !== undefined) {
      if (target !== '' && target !== '*' && !motors.has(target)) throw invalid('Unknown actuator target for node ' + id + '.')
      copy.target = target
    }
    nodeById.set(id, copy)
    return copy
  })
  if (startCount !== 1) throw invalid('A program must have exactly one start node.')

  const links = {}
  for (const [port, target] of Object.entries(machine.links)) {
    const id = sourceNodeId(port)
    const node = nodeById.get(id)
    const destination = nodeById.get(target)
    if (!node || (port !== id && !isLoop(node)) || !destination || destination.type === 'start') {
      throw invalid('Invalid wire from port ' + port + '.')
    }
    links[port] = target
  }
  return { name: machine.name.trim(), parts: machineParts, nodes, links }
}

function checkSize(text) {
  if (text.length > maxMachineFileBytes || new TextEncoder().encode(text).length > maxMachineFileBytes) {
    throw tooLarge()
  }
}

export function encodeMachineFile(machine) {
  const text = JSON.stringify({ format, version, machine: machineData(machine) }, null, 2) + '\n'
  checkSize(text)
  return text
}

export function decodeMachineFile(text) {
  if (typeof text !== 'string') throw invalid('Expected a Maskinverkstan machine file.')
  checkSize(text)
  let document
  try {
    document = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw invalid('The file is not valid JSON.')
  }
  if (!isRecord(document) || document.format !== format) throw invalid('Expected a Maskinverkstan machine file.')
  if (document.version !== version) {
    throw new MachineFileError('machineFileVersion', 'Unsupported machine file version.')
  }
  return machineData(document.machine)
}
