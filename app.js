import './style.css'
import { actuatorColor, bounds, buildAngle, buildPosition, capsuleSize, clamp, completionPort, copyProgramNodes, fitsBuildArea, isDriveWheel, isLoop, isMotor, leftEdge, levels, loopParameter, maxMotorForce, motorForce, partName, parts, pasteProgramNodes, pistonAngle, placePart, removePart, sourceNodeId, starterMachine, blankMachine, uid } from './model.js'
import { decodeMachineFile, encodeMachineFile, MachineFileError, maxMachineFileBytes, maxMachineNameLength } from './machine-file.js'
import { translate } from './language.js'
import { createSimulation, initializePhysics, STEP } from './physics.js'
import { createRenderer, drawLevel, drawWorkshop, workshopView } from './render.js'

const storageKey = 'machine-works.v1'
let stored
try {
  stored = JSON.parse(localStorage.getItem(storageKey))
} catch {
  stored = null
}
const state = {
  language: stored?.language === 'en' ? 'en' : 'sv',
  machines: stored?.machines ?? [],
  records: stored?.records ?? {},
  machine: stored?.draft ?? starterMachine(),
  example: stored?.example ?? true,
  dirty: stored?.dirty ?? false,
  screen: 'garage',
  tab: 'build',
  selected: null,
  placing: null,
  wire: null,
  selectedWire: null,
  selectedNodes: new Set(),
  level: null,
  mode: '',
  simulation: null
}
const t = key => translate(state.language, key)
const app = document.querySelector('#app')
const stage = document.createElement('div')
stage.className = 'viewport'
stage.innerHTML = '<canvas tabindex="0"></canvas><div class="stage-overlay"></div>'
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char])
const symbols = {
  beam: '▬', block: '■', wedge: '◢', plate: '▱', strut: '▮', ball: '●', blob: '●',
  wheel: '◉', hinge: '⊙', piston: '↔', treadWheel: '⦿', servo: '◔', ram: '⇆'
}
const partTypes = Object.keys(parts).filter(type => !parts[type].legacy)
const icon = value => '<span aria-hidden="true">' + value + '</span>'
const button = (action, label, extra = '') => '<button type="button" data-action="' + action + '" ' + extra + '>' + label + '</button>'
const actionButton = (action, key, variant = '', extra = '') =>
  button(action, t(key), 'class="button ' + variant + '" ' + extra)
const fmt = (value, maximumFractionDigits = 1) => new Intl.NumberFormat(state.language, { maximumFractionDigits }).format(value)
const title = () => state.machine.name || t(state.example ? 'starter' : 'untitled')
const labelPart = part => partName(part, state.machine, t)
function bestTime(id) {
  const time = state.records[id]
  return Number.isFinite(time) && time > 0 ? time : null
}
const unlocked = index => index === 0 || bestTime(levels[index - 1]?.id) !== null

let paint
let redraw = true
let ghost
let placementTurns = 0
let drag
let graphDrag
let graphPan
let graphWireDrag
let suppressWireClick = false
let nodeClipboard
let pasteOffset = 0
const graphView = { x: 0, y: 0, zoom: 1 }
let toastTimer
let lastSize = ''
let runToken = 0
let runResult = ''
let camera = { x: 4, y: 0 }
let raceTicks = 0

function persist() {
  const { language, machines, records, machine, example, dirty } = state
  try {
    localStorage.setItem(storageKey, JSON.stringify({ language, machines, records, draft: machine, example, dirty }))
    return true
  } catch {
    notify('storageError')
    return false
  }
}

function edited() {
  state.dirty = true
  redraw = true
  persist()
}

function notify(key) {
  const toast = app.querySelector('.toast')
  if (!toast) return
  clearTimeout(toastTimer)
  toast.textContent = t(key)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 3200)
}

function footer() {
  const element = app.querySelector('.engine')
  if (element) element.textContent = state.mode ? t('renderer') + ' · ' + state.mode + ' / WASM' : ''
}

function render() {
  document.documentElement.lang = state.language
  document.title = t('brand')
  const nav = (action, key, screen) => button(action, t(key), state.screen === screen ? 'aria-current="page"' : '')
  app.innerHTML = '<header class="header">' +
    button('garage', '<span class="mark" aria-hidden="true">⚙</span>' + t('brand'), 'class="brand"') +
    '<nav class="nav" aria-label="' + t('brand') + '">' + nav('garage', 'garage', 'garage') +
    nav('levels', 'levels', 'levels') + nav('library', 'library') + nav('settings', 'settings') +
    '</nav></header><main>' + (
      state.screen === 'garage' ? garageMarkup() : state.screen === 'levels' ? levelsMarkup() : raceMarkup()
    ) + '<footer class="footer"><span class="engine"></span></footer></main>' +
    '<dialog></dialog><div class="toast" role="status" hidden></div>'
  footer()
  const slot = app.querySelector('.stage-slot')
  if (slot) {
    slot.append(stage)
    const canvas = stage.querySelector('canvas')
    canvas.setAttribute('aria-label', t(state.screen === 'race' ? 'playCanvas' : 'buildCanvas'))
    canvas.tabIndex = state.screen === 'garage' ? 0 : -1
    delete stage.querySelector('.stage-overlay').dataset.result
  }
  if (state.screen === 'garage' && state.tab === 'build') refreshBuild()
  if (state.screen === 'garage' && state.tab === 'program') refreshGraph()
  if (state.screen === 'race') updateRace()
  redraw = true
}

function garageMarkup() {
  const tab = key => button(key, t(key), 'aria-pressed="' + (state.tab === key) + '"')
  return '<section class="intro"><div><div class="kicker">' + t('garage') + '</div><h1>' + escape(title()) +
    '</h1></div><div class="actions">' + actionButton('save', 'save', '', state.machine.parts.length ? '' : 'disabled') +
    actionButton('export-machine', 'exportMachine', 'muted', state.machine.parts.length ? '' : 'disabled') +
    actionButton('test', 'run', 'primary', state.machine.parts.length ? '' : 'disabled') +
    '</div></section><div class="toolbar"><div class="tabs">' + tab('build') + tab('program') + '</div><div class="actions">' +
    actionButton('new', 'new', 'muted') + actionButton('example', 'loadStarter', 'muted') + '</div></div>' +
    (state.tab === 'build' ? '<div class="work-grid"><section class="panel"><div class="panel-head"><h2>' +
    t('inventory') + '</h2></div><div class="panel-body palette"></div></section><section class="panel build-panel">' +
    '<div class="panel-head"><h2>' + t('board') + '</h2><span class="mono">' +
    fmt(bounds.width, 2) + ' × ' + fmt(bounds.height, 2) + ' m</span></div><div class="stage-slot"></div>' +
    '<div class="panel-foot"><span class="build-hint"></span><span class="mono count"></span></div></section>' +
    '<section class="panel details"><div class="panel-head"><h2>' + t('machine') +
    '</h2></div><div class="panel-body inspector"></div></section></div>' :
    '<section class="panel"><div class="panel-head"><h2>' + t('graph') + '</h2><label class="mono">' + t('addNode') +
    ' <select id="node-type"><option value="">+</option>' + ['delay', 'speed', 'position', 'for', 'while'].map(type =>
      '<option value="' + type + '">' + t(type) + '</option>').join('') +
    '</select></label></div><div class="graph-scroll"><div class="graph-space"></div></div>' +
    '<div class="panel-foot">' + t('graphHint') + '</div></section>')
}

function refreshBuild() {
  const palette = app.querySelector('.palette')
  if (!palette) return
  const canRun = state.machine.parts.length > 0
  app.querySelector('[data-action="test"]').disabled = !canRun
  app.querySelector('[data-action="save"]').disabled = !canRun
  app.querySelector('[data-action="export-machine"]').disabled = !canRun
  const paletteGroup = (key, types) => '<div class="parts-group"><div class="eyebrow"' +
    (key === 'actuators' ? ' style="color:' + actuatorColor + '"' : '') + '>' + t(key) + '</div>' +
    types.map(type => button('place', '<span class="part-icon" aria-hidden="true" style="--tint:' + parts[type].color + '">' +
      symbols[type] + '</span><span><b>' + t(type) + '</b><small>' + t(type + 'Info') + '</small></span>',
    'class="part" data-type="' + type + '" aria-pressed="' + (state.placing === type) + '"')).join('') + '</div>'
  palette.innerHTML = paletteGroup('shapes', partTypes.filter(type => !parts[type].joint)) +
    paletteGroup('actuators', partTypes.filter(type => parts[type].joint))
  const selected = state.machine.parts.find(part => part.id === state.selected)
  const parent = selected && state.machine.parts.find(part => part.id === selected.parent)
  const oversized = state.machine.parts.some(part => !fitsBuildArea(part))
  const fitPrompt = oversized ? '<p role="status">' + t('oversizedMachine') + '</p>' +
    actionButton('fit-parts', 'fitParts', 'muted') + '<hr>' : ''
  app.querySelector('.inspector').innerHTML = fitPrompt + '<div class="eyebrow">' + t('frame') + '</div>' + (selected ?
    '<h3>' + labelPart(selected) + '</h3><p>' + (parent ? t('attachedTo') + ' · ' + labelPart(parent) : t('root')) +
    '</p>' + (isMotor(selected) ? '<label class="motor-force">' + t(parts[selected.type].joint === 'prismatic' ? 'maxForce' : 'maxTorque') +
      '<input type="number" min="0" max="' + maxMotorForce + '" step="any" data-motor-force value="' +
      motorForce(selected) + '"></label>' : '') + actionButton('remove-part', 'remove', 'muted', 'aria-keyshortcuts="Delete"') : '<p>' + t('noSelection') + '</p>') +
    '<hr><div class="eyebrow">' + state.machine.parts.length + ' ' + t('partsUnit') +
    '</div><div class="part-list">' + state.machine.parts.map(part => button('select-part',
      '<span style="color:' + parts[part.type].color + '" aria-hidden="true">' + symbols[part.type] + '</span> ' + labelPart(part),
      'data-id="' + part.id + '" aria-pressed="' + (part.id === state.selected) + '"')).join('') + '</div>'
  app.querySelector('.count').textContent = state.machine.parts.length + ' / ' + bounds.limit + ' ' + t('partCount')
  app.querySelector('.build-hint').textContent = t(state.placing ? 'placement' : 'selectHint')
  stage.classList.toggle('placing', Boolean(state.placing))
  stage.querySelector('.stage-overlay').innerHTML = canRun ? '' : '<div class="empty-build">' + t('emptyBuild') + '</div>'
  redraw = true
}

function levelsMarkup() {
  return '<section class="intro"><div><div class="kicker">' + t('levels') + '</div><h1>' + t('courses') +
    '</h1><p>' + t('courseHint') + '</p></div></section><div class="track-grid">' + levels.map((level, index) => {
      const available = unlocked(index)
      const best = bestTime(level.id)
      const start = level.points[0][0]
      const length = level.points.at(-1)[0] - start
      const terrain = level.points.map(([x, y]) => ((x - start) / length * 100) + '% ' + (63 - y * 11) + '%').join(',')
      return '<article class="panel track-card"><div class="track-art" style="--sky:' + level.sky + ';--land:' + level.land +
        ';--terrain:' + terrain + ',100% 100%,0% 100%"><span class="mono">' + t('track') + ' ' +
        String(index + 1).padStart(2, '0') + '</span></div><div class="panel-body"><span class="eyebrow">' +
        (best !== null ? t('complete') : t(available ? 'available' : 'locked')) +
        '</span><h2>' + t(level.id) + '</h2><p>' + t(level.id + 'Info') + '</p>' +
        '<dl class="track-best"><dt>' + t('bestTime') + '</dt><dd>' +
        (best === null ? '–' : fmt(best, 3) + ' s') + '</dd></dl>' +
        actionButton('play', available ? 'play' : 'locked', available ? 'primary' : '', 'data-index="' + index + '"' + (available ? '' : ' disabled')) +
        '</div></article>'
    }).join('') + '</div>'
}

function raceMarkup() {
  const index = state.level
  return '<section class="intro"><div><div class="kicker">' + t('track') + ' ' + String(index + 1).padStart(2, '0') +
    '</div><h1>' + t(levels[index].id) + '</h1><p>' + escape(title()) + '</p></div><div class="actions">' +
    actionButton('garage', 'garageReturn') + actionButton('retry', 'retry') +
    '</div></section><section class="panel race"><div class="stage-slot"></div><div class="panel-foot">' +
    '<span class="run-status" role="status"></span><span class="mono">' + t('time') +
    ' <span class="clock">0</span> s</span><progress max="1" value="0" aria-label="' + t('progress') +
    '"></progress></div></section>'
}

function updateRace() {
  if (state.screen !== 'race') return
  const sim = state.simulation
  const status = app.querySelector('.run-status')
  const message = t(runResult || (sim?.stalled ? 'stall' : 'running'))
  if (status.textContent !== message) status.textContent = message
  app.querySelector('.clock').textContent = fmt(sim?.elapsed ?? 0)
  if (sim) {
    const back = Math.min(...sim.poses().map(part => leftEdge(part, part.x, part.angle)))
    app.querySelector('progress').value = clamp((back - 2) / (levels[state.level].finish - 2), 0, 1)
  }
  const overlay = stage.querySelector('.stage-overlay')
  if (overlay.dataset.result === runResult) return
  overlay.dataset.result = runResult
  overlay.innerHTML = runResult ? '<div class="result"><h2>' + t(runResult) + '</h2>' +
    (runResult === 'won' && state.level < levels.length - 1 ? '<p>' + actionButton('next', 'nextLevel', 'primary') + '</p>' : '') +
    '</div>' : ''
}

function stopSimulation() {
  runToken++
  state.simulation?.dispose()
  state.simulation = null
  runResult = ''
}

function navigate(screen) {
  stopSimulation()
  state.screen = screen
  state.placing = null
  state.wire = null
  state.selectedWire = null
  ghost = null
  render()
}

async function play(level) {
  if (!levels[level] || !unlocked(level)) return
  if (!state.machine.parts.length) return notify('emptyRun')
  if (!state.machine.parts.every(fitsBuildArea)) {
    state.tab = 'build'
    navigate('garage')
    return notify('oversizedMachine')
  }
  stopSimulation()
  const token = runToken
  state.placing = null
  state.wire = null
  ghost = null
  state.level = level
  state.screen = 'race'
  camera = { x: 4, y: 0 }
  runResult = 'loading'
  render()
  try {
    await initializePhysics()
    if (token !== runToken) return
    state.simulation = createSimulation(structuredClone(state.machine), levels[level])
    runResult = ''
  } catch (error) {
    if (token !== runToken) return
    console.error(error)
    runResult = 'physicsError'
  }
  updateRace()
  redraw = true
}

function nodeFields(node) {
  if (node.type === 'start') return ''
  const field = (label, min, max, step = 'any') => '<label>' + label + '<input type="number" min="' + min + '" max="' + max +
    '" step="' + step + '" data-field="value" value="' + node.value + '"></label>'
  if (isLoop(node)) {
    const { max, step } = loopParameter[node.type]
    return field(t(node.type === 'for' ? 'cycleCount' : 'whileTime'), 0, max, step)
  }
  if (node.type === 'delay') return field(t('seconds'), 0, 60)
  const motors = state.machine.parts.filter(isMotor)
  const options = [['', t('pickTarget')], ...(motors.some(isDriveWheel) ? [['*', t('wheelGroup')]] : []),
    ...motors.map(part => [part.id, labelPart(part)])]
  return '<label>' + t('targets') + '<select data-field="target">' + options.map(([id, name]) =>
    '<option value="' + id + '"' + (id === node.target ? ' selected' : '') + '>' + name + '</option>').join('') +
    '</select></label>' + field(t(node.type === 'speed' ? 'speedValue' : 'positionValue'), -360, 360)
}

function refreshGraph() {
  const viewport = app.querySelector('.graph-scroll')
  const space = viewport.querySelector('.graph-space')
  space.innerHTML = '<svg class="wires"></svg>' + state.machine.nodes.map(node => {
    const loop = isLoop(node)
    const port = (direction, key, source, connected) => button('port-' + direction, '',
      'class="node-port ' + direction + (key === 'completed' ? ' done' : '') + (connected ? ' connected' : '') +
      '" data-port="' + source + '" title="' + t(key) + '" aria-label="' +
      t(key) + ' · ' + t(node.type) + '" aria-pressed="' + (direction === 'out' && state.wire === source) + '"')
    const output = (key, source) => port('out', key, source, Boolean(state.machine.links[source]))
    const selected = state.selectedNodes.has(node.id) ? ' selected' : ''
    return '<article class="node ' + node.type + selected + '" tabindex="0" data-node="' + node.id +
      '"><div class="node-head"><strong>' +
      t(node.type) + '</strong>' + (node.type !== 'start' ? button('remove-node', '×', 'aria-label="' + t('removeNode') + '"') : '') +
      '</div><div class="node-body">' + nodeFields(node) +
      (!loop && state.machine.links[node.id] ? button('unlink', t('detach'), 'class="unlink"') : '') + '</div>' +
      (node.type !== 'start' ? port('in', 'input', node.id, Object.values(state.machine.links).includes(node.id)) : '') +
      (loop ? '<span class="loop-pin-label">' + t('loopBody') + '</span><span class="loop-pin-label done">' +
        t('completed') + '</span>' + output('loopBody', node.id) + output('completed', completionPort(node.id)) :
        output('output', node.id)) + '</article>'
  }).join('')
  for (const node of state.machine.nodes) positionNode(space.querySelector('[data-node="' + node.id + '"]'), node)
  drawWires(space)
  updateGraphView(viewport)
}

function updateGraphView(viewport) {
  const { x, y, zoom } = graphView
  viewport.firstElementChild.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + zoom + ')'
  viewport.style.backgroundPosition = x + 'px ' + y + 'px'
  viewport.style.backgroundSize = (19 * zoom) + 'px ' + (19 * zoom) + 'px'
}

function positionNode(element, node) {
  element.style.left = node.x + 'px'
  element.style.top = node.y + 'px'
}

const portY = source => source === sourceNodeId(source) ? 59 : 89

function drawWires(space) {
  const nodes = new Map(state.machine.nodes.map(node => [node.id, node]))
  space.querySelector('.wires').innerHTML = Object.entries(state.machine.links).map(([source, target]) => {
    const a = nodes.get(sourceNodeId(source))
    const b = nodes.get(target)
    if (!a || !b) return ''
    const path = wirePath(a.x + 161, a.y + portY(source), b.x, b.y + 59)
    const output = isLoop(a) ? t(a.type) + ' · ' + t(source === a.id ? 'loopBody' : 'completed') : t(a.type)
    const label = t('wireLabel').replace('{from}', output).replace('{to}', t(b.type))
    return '<g class="wire" data-wire="' + escape(source) + '" role="button" tabindex="0" aria-keyshortcuts="Delete"' +
      ' aria-label="' + escape(label) + '" aria-pressed="' + (state.selectedWire === source) + '">' +
      '<path class="wire-line" d="' + path + '"></path><path class="wire-hit" d="' + path + '"></path></g>'
  }).join('') + '<path class="wire-preview" aria-hidden="true"></path>'
}

function wirePath(x, y, endX, endY) {
  const bend = Math.max(38, Math.abs(endX - x) * 0.48)
  return 'M ' + x + ' ' + y + ' C ' + (x + bend) + ' ' + y + ', ' + (endX - bend) +
    ' ' + endY + ', ' + endX + ' ' + endY
}

function dialog(key, body) {
  const element = app.querySelector('dialog')
  element.innerHTML = '<div class="panel-head"><h2>' + t(key) + '</h2>' +
    button('close', '×', 'class="button muted" aria-label="' + t('close') + '"') + '</div><div class="panel-body">' + body + '</div>'
  if (!element.open) element.showModal()
  element.querySelector('input, select')?.focus()
}

function settings() {
  dialog('settings', '<label>' + t('language') + '<select id="language"><option value="sv"' +
    (state.language === 'sv' ? ' selected' : '') + '>Svenska</option><option value="en"' +
    (state.language === 'en' ? ' selected' : '') + '>English</option></select></label>')
}

function showMachineFileStatus(key) {
  const status = app.querySelector('dialog[open] .machine-file-status')
  if (status) status.textContent = t(key)
  else notify(key)
}

function library() {
  const rows = state.machines.map((machine, index) => {
    const entry = 'data-index="' + index + '"'
    return '<div class="library-row"><div><strong>' + escape(machine.name) + '</strong><br><small>' +
      machine.parts.length + ' ' + t('partCount') + '</small></div><div class="actions">' +
      actionButton('export-machine', 'exportMachine', 'muted', entry) +
      actionButton('load', 'load', '', entry) + '</div></div>'
  }).join('')
  dialog('library', '<div class="actions">' + actionButton('import-machine', 'importMachine') +
    '<input id="import-machine-file" type="file" accept=".json,application/json" hidden></div>' +
    '<div class="machine-file-status" role="status"></div>' + (rows || '<p>' + t('libraryEmpty') + '</p>'))
}

function exportMachine(control) {
  const machine = control.dataset.index === undefined ? { ...state.machine, name: title() }
    : state.machines[Number(control.dataset.index)]
  let text
  try {
    text = encodeMachineFile(machine)
  } catch (error) {
    showMachineFileStatus(error instanceof MachineFileError ? error.code : 'machineFileWriteError')
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  const filename = machine.name.replace(/[^\p{L}\p{N} _-]+/gu, '-').trim() || 'machine'
  link.href = url
  link.download = filename + '.machine.json'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function importMachine(file) {
  if (file.size > maxMachineFileBytes) return showMachineFileStatus('machineFileTooLarge')
  let machine
  try {
    machine = decodeMachineFile(await file.text())
  } catch (error) {
    return showMachineFileStatus(error instanceof MachineFileError ? error.code : 'machineFileReadError')
  }
  const names = new Set(state.machines.map(saved => saved.name))
  const base = machine.name || t('untitled')
  machine.name = base
  for (let index = 2; names.has(machine.name); index++) {
    const suffix = ' (' + index + ')'
    machine.name = base.slice(0, maxMachineNameLength - suffix.length) + suffix
  }
  const previous = state.machines
  state.machines = [machine, ...previous]
  if (!persist()) {
    state.machines = previous
    return showMachineFileStatus('storageError')
  }
  if (app.querySelector('dialog[open] #import-machine-file')) {
    library()
    app.querySelector('[data-action="import-machine"]').focus()
  }
  showMachineFileStatus('machineImported')
}

function replaceMachine(machine, example = false) {
  if (state.dirty && !window.confirm(t('replaceDraft'))) return false
  state.machine = structuredClone(machine)
  Object.assign(graphView, { x: 0, y: 0, zoom: 1 })
  state.example = example
  state.dirty = false
  state.selected = null
  state.selectedNodes.clear()
  state.tab = 'build'
  persist()
  navigate('garage')
  return true
}

const actions = {
  garage: () => navigate('garage'),
  levels: () => navigate('levels'),
  settings,
  library,
  'export-machine': exportMachine,
  'import-machine': () => app.querySelector('#import-machine-file').click(),
  close: () => app.querySelector('dialog').close(),
  build: () => { state.tab = 'build'; state.wire = null; render() },
  program: () => { state.tab = 'program'; state.placing = null; ghost = null; render() },
  test: () => play(0),
  play: control => play(Number(control.dataset.index)),
  retry: () => play(state.level),
  next: () => play(state.level + 1),
  new: () => replaceMachine(blankMachine()),
  example: () => replaceMachine(starterMachine(), true),
  load: control => {
    if (replaceMachine(state.machines[Number(control.dataset.index)])) notify('loaded')
  },
  save: () => dialog('save', '<form id="save-machine"><label>' + t('saveName') +
    '<input name="name" required maxlength="' + maxMachineNameLength + '" value="' + escape(title()) + '"></label><div class="actions"><button class="button primary">' +
    t('save') + '</button></div></form>'),
  place: control => {
    const type = control.dataset.type
    if (parts[type].joint && !state.machine.parts.length) return notify('baseFirst')
    if (state.machine.parts.length >= bounds.limit) return notify('tooMany')
    state.placing = type === state.placing ? null : type
    placementTurns = 0
    ghost = null
    refreshBuild()
    if (state.placing && matchMedia('(max-width: 680px)').matches) {
      stage.scrollIntoView({ block: 'nearest' })
    }
  },
  'select-part': control => {
    state.selected = control.dataset.id
    state.placing = null
    ghost = null
    refreshBuild()
  },
  'fit-parts': () => {
    for (const part of state.machine.parts) {
      if (!fitsBuildArea(part)) Object.assign(part, buildPosition(part.type, part.x, part.y, false, part.turns))
    }
    edited()
    refreshBuild()
  },
  'remove-part': () => {
    removePart(state.machine, state.selected)
    state.selected = null
    if (!state.machine.parts.length && parts[state.placing]?.joint) state.placing = null
    ghost = null
    edited()
    refreshBuild()
  },
  'port-out': control => {
    const source = control.dataset.port
    state.wire = state.wire === source ? null : source
    refreshGraph()
    app.querySelector('.out[data-port="' + CSS.escape(source) + '"]')?.focus({ preventScroll: true })
  },
  'port-in': control => {
    if (state.wire) connectNodes(state.wire, control.closest('.node').dataset.node)
  },
  unlink: control => unlink(control.closest('.node').dataset.node),
  'remove-node': control => {
    const id = control.closest('.node').dataset.node
    state.machine.nodes = state.machine.nodes.filter(node => node.id !== id)
    state.machine.links = Object.fromEntries(Object.entries(state.machine.links).filter(([from, to]) => sourceNodeId(from) !== id && to !== id))
    state.selectedNodes.delete(id)
    if (state.wire && sourceNodeId(state.wire) === id) state.wire = null
    if (state.selectedWire && !state.machine.links[state.selectedWire]) state.selectedWire = null
    edited()
    refreshGraph()
  }
}

app.addEventListener('click', event => {
  const wire = event.target.closest('.wire')
  if (wire) {
    event.preventDefault()
    if (event.altKey) unlink(wire.dataset.wire)
    else {
      selectNodes()
      selectWire(wire.dataset.wire)
    }
    return
  }
  if (state.selectedWire && event.target.closest('.graph-scroll')) selectWire(null)
  const control = event.target.closest('[data-action]')
  if (control?.dataset.action === 'port-out' && suppressWireClick && event.detail > 0) {
    suppressWireClick = false
    return
  }
  if (control && !control.disabled) actions[control.dataset.action]?.(control)
})

app.addEventListener('submit', event => {
  if (event.target.id !== 'save-machine') return
  event.preventDefault()
  const input = event.target.elements.name
  const name = input.value.trim()
  if (!name) return input.focus()
  const machine = { ...structuredClone(state.machine), name }
  const index = state.machines.findIndex(saved => saved.name === name)
  const previous = { machines: state.machines, machine: state.machine, example: state.example, dirty: state.dirty }
  state.machines = [...state.machines]
  if (index === -1) state.machines.push(machine)
  else state.machines[index] = machine
  state.machine = structuredClone(machine)
  state.example = false
  state.dirty = false
  if (!persist()) {
    Object.assign(state, previous)
    return
  }
  render()
  notify('saved')
})

function updateMotorForce(control, commit = false) {
  const part = state.machine.parts.find(candidate => candidate.id === state.selected)
  if (!part || !isMotor(part)) return
  const input = control.valueAsNumber
  if (!commit && !Number.isFinite(input)) return
  const force = motorForce({ ...part, maxForce: input })
  if (commit) control.value = force
  if (force === motorForce(part)) return
  part.maxForce = force
  edited()
}

app.addEventListener('input', event => {
  if (event.target.hasAttribute('data-motor-force')) updateMotorForce(event.target)
})

app.addEventListener('change', event => {
  const control = event.target
  if (control.id === 'import-machine-file') {
    const file = control.files[0]
    control.value = ''
    if (file) void importMachine(file)
  } else if (control.id === 'language') {
    state.language = control.value
    persist()
    render()
    settings()
  } else if (control.id === 'node-type' && control.value) {
    const viewport = app.querySelector('.graph-scroll')
    const offset = state.machine.nodes.length * 29
    const x = Math.min(28 + offset % 350, viewport.clientWidth * 0.65)
    const y = Math.min(115 + offset % 170, viewport.clientHeight * 0.55)
    const node = { id: uid(), type: control.value, value: loopParameter[control.value]?.default ?? (control.value === 'delay' ? 1 : 0),
      target: state.machine.parts.find(isMotor)?.id ?? '',
      x: (x - graphView.x) / graphView.zoom, y: (y - graphView.y) / graphView.zoom }
    state.machine.nodes.push(node)
    control.value = ''
    edited()
    refreshGraph()
  } else if (control.hasAttribute('data-motor-force')) {
    updateMotorForce(control, true)
  } else if (control.dataset.field) {
    const node = state.machine.nodes.find(candidate => candidate.id === control.closest('.node').dataset.node)
    if (control.dataset.field === 'target') node.target = control.value
    else {
      node.value = clamp(Number(control.value) || 0, Number(control.min), Number(control.max))
      if (node.type === 'for') node.value = Math.floor(node.value)
      control.value = node.value
    }
    edited()
  }
})

app.addEventListener('contextmenu', event => {
  if (event.target.closest('.graph-scroll')) event.preventDefault()
})

app.addEventListener('wheel', event => {
  const viewport = event.target.closest('.graph-scroll')
  if (!viewport) return
  event.preventDefault()
  if (graphPan || graphDrag || graphWireDrag) return
  const rect = viewport.getBoundingClientRect()
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
  const zoom = clamp(graphView.zoom * Math.exp(-event.deltaY * unit * 0.0015), 0.45, 2.5)
  const ratio = zoom / graphView.zoom
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  graphView.x = x - (x - graphView.x) * ratio
  graphView.y = y - (y - graphView.y) * ratio
  graphView.zoom = zoom
  updateGraphView(viewport)
}, { passive: false })

function selectNodes(id, toggle = false) {
  const selected = state.selectedNodes
  if (!toggle) selected.clear()
  if (id && selected.has(id)) selected.delete(id)
  else if (id) selected.add(id)
  for (const element of app.querySelectorAll('.node')) {
    element.classList.toggle('selected', selected.has(element.dataset.node))
  }
}

function pasteNodes() {
  const viewport = app.querySelector('.graph-scroll')
  const offset = 32 + (pasteOffset++ % 6) * 24
  const left = Math.min(...nodeClipboard.nodes.map(node => node.x))
  const top = Math.min(...nodeClipboard.nodes.map(node => node.y))
  const position = (value, origin, size) => {
    const screen = value * graphView.zoom + origin
    return ((screen >= 0 && screen + offset + 162 * graphView.zoom < size ? screen : 0) + offset - origin) / graphView.zoom
  }
  state.selectedNodes = pasteProgramNodes(state.machine, nodeClipboard,
    position(left, graphView.x, viewport.clientWidth), position(top, graphView.y, viewport.clientHeight))
  state.wire = null
  state.selectedWire = null
  edited()
  refreshGraph()
}

function selectWire(source) {
  state.selectedWire = source
  for (const wire of app.querySelectorAll('.wire')) {
    wire.setAttribute('aria-pressed', String(wire.dataset.wire === source))
  }
}

function connectNodes(source, target) {
  state.machine.links[source] = target
  state.wire = null
  state.selectedWire = null
  edited()
  refreshGraph()
}

function wireDropTarget(viewport, event) {
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node-port.in')
  return target && viewport.contains(target) ? target : null
}

function finishWireDrag(event) {
  const { viewport, source, preview, target, moved } = graphWireDrag
  graphWireDrag = null
  target?.classList.remove('drop-target')
  preview.removeAttribute('d')
  if (!moved) return
  suppressWireClick = true
  const port = event?.type === 'pointerup' && wireDropTarget(viewport, event)
  if (port) connectNodes(source.port, port.closest('.node').dataset.node)
}

function unlink(id) {
  const restoreFocus = document.activeElement?.dataset.wire === id
  delete state.machine.links[id]
  if (state.wire === id) state.wire = null
  if (state.selectedWire === id) state.selectedWire = null
  edited()
  refreshGraph()
  if (restoreFocus) app.querySelector('.out[data-port="' + CSS.escape(id) + '"]')?.focus({ preventScroll: true })
}

app.addEventListener('pointerdown', event => {
  const viewport = event.target.closest('.graph-scroll')
  suppressWireClick = false
  if (!viewport || graphPan || graphDrag || graphWireDrag) return
  const output = event.target.closest('.node-port.out')
  if (output && event.button === 0) {
    const port = output.dataset.port
    const node = state.machine.nodes.find(node => node.id === sourceNodeId(port))
    graphWireDrag = {
      source: { port, x: node.x + 161, y: node.y + portY(port) }, viewport,
      x: event.clientX, y: event.clientY, pointer: event.pointerId,
      preview: viewport.querySelector('.wire-preview'), target: null, moved: false
    }
    output.setPointerCapture(event.pointerId)
    return
  }
  const rightClick = event.button === 2
  const touchBackground = event.pointerType === 'touch' && !event.target.closest('.node, .wire')
  if (rightClick || touchBackground) {
    event.preventDefault()
    const port = rightClick && event.target.closest('.node-port.out')
    graphPan = {
      viewport, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      originalX: graphView.x, originalY: graphView.y, moved: false,
      output: port ? port.dataset.port : null
    }
    viewport.setPointerCapture(event.pointerId)
    return
  }

  if (event.button !== 0 || event.target.closest('button, input, select, label, .wire')) return
  const element = event.target.closest('.node')
  selectNodes(element?.dataset.node, Boolean(element && (event.ctrlKey || event.metaKey)))
  element?.focus({ preventScroll: true })
  const header = event.target.closest('.node-head')
  if (!header || event.ctrlKey || event.metaKey) return
  const node = state.machine.nodes.find(candidate => candidate.id === element.dataset.node)
  graphDrag = { element, node, x: event.clientX, y: event.clientY,
    originalX: node.x, originalY: node.y, pointer: event.pointerId }
  header.setPointerCapture(event.pointerId)
})

app.addEventListener('pointermove', event => {
  if (graphWireDrag?.pointer === event.pointerId) {
    const drag = graphWireDrag
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return
    drag.moved = true
    drag.target?.classList.remove('drop-target')
    drag.target = wireDropTarget(drag.viewport, event)
    drag.target?.classList.add('drop-target')
    const rect = drag.viewport.getBoundingClientRect()
    const x = (event.clientX - rect.left - graphView.x) / graphView.zoom
    const y = (event.clientY - rect.top - graphView.y) / graphView.zoom
    drag.preview.setAttribute('d', wirePath(drag.source.x, drag.source.y, x, y))
    return
  }

  if (graphPan?.pointer === event.pointerId) {
    const { viewport, x, y, originalX, originalY } = graphPan
    const dx = event.clientX - x
    const dy = event.clientY - y
    if (!graphPan.moved && Math.hypot(dx, dy) < 4) return
    graphPan.moved = true
    viewport.classList.add('panning')
    graphView.x = originalX + dx
    graphView.y = originalY + dy
    updateGraphView(viewport)
    return
  }

  if (graphDrag?.pointer !== event.pointerId) return
  const { node, element, x, y, originalX, originalY } = graphDrag
  node.x = originalX + (event.clientX - x) / graphView.zoom
  node.y = originalY + (event.clientY - y) / graphView.zoom
  positionNode(element, node)
  drawWires(element.parentElement)
})

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) app.addEventListener(type, event => {
  if (graphWireDrag?.pointer === event.pointerId) {
    finishWireDrag(event)
    return
  }
  if (graphPan?.pointer === event.pointerId) {
    const { viewport, moved, output } = graphPan
    graphPan = null
    viewport.classList.remove('panning')
    if (event.type === 'pointerup' && !moved && output && state.machine.links[output]) unlink(output)
  }
  if (graphDrag?.pointer !== event.pointerId) return
  const { node, originalX, originalY } = graphDrag
  graphDrag = null
  if (node.x !== originalX || node.y !== originalY) edited()
})

function workshopPoint(event) {
  const rect = stage.getBoundingClientRect()
  const view = workshopView(rect.width, rect.height)
  return [(event.clientX - rect.left - view.x) / view.scale, (view.y + rect.top - event.clientY) / view.scale]
}

function movePart(part, x, y) {
  Object.assign(part, buildPosition(part.type, x, y, true, part.turns))
  redraw = true
}

function occupied(part, x, y) {
  const shape = parts[part.type]
  const dx = x - part.x
  const dy = y - part.y
  if (shape.shape === 'circle') return Math.hypot(dx, dy) <= shape.width / 2

  const angle = shape.shape === 'capsule'
    ? pistonAngle(part, state.machine.parts.find(candidate => candidate.id === part.parent))
    : buildAngle(part)
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
  const localY = dy * Math.cos(angle) - dx * Math.sin(angle)
  if (shape.shape === 'capsule') {
    const { halfLength, radius } = capsuleSize(part)
    return Math.hypot(localX - clamp(localX, -halfLength, halfLength), localY) <= radius
  }
  return Math.abs(localX) <= shape.width / 2 && Math.abs(localY) <= shape.height / 2 &&
    (shape.shape !== 'triangle' || (localX / shape.width + 0.5) + (localY / shape.height + 0.5) <= 1)
}

stage.addEventListener('pointerdown', event => {
  if (event.target.tagName !== 'CANVAS' || state.screen !== 'garage' || event.button !== 0) return
  const [x, y] = workshopPoint(event)
  if (state.placing) {
    if (Math.abs(x) > bounds.width / 2 || Math.abs(y) > bounds.height / 2) return notify('placeOutside')
    const part = placePart(state.machine, state.placing, x, y, state.selected, placementTurns)
    state.placing = null
    ghost = null
    if (part) {
      state.selected = part.id
      edited()
    }
  } else {
    const part = state.machine.parts.findLast(candidate => occupied(candidate, x, y))
    state.selected = part?.id ?? null
    if (part) {
      drag = { part, x: x - part.x, y: y - part.y, originalX: part.x, originalY: part.y, pointer: event.pointerId }
      stage.setPointerCapture(event.pointerId)
    }
  }
  refreshBuild()
})

stage.addEventListener('pointermove', event => {
  if (state.screen !== 'garage' || state.tab !== 'build') return
  const [x, y] = workshopPoint(event)
  if (drag?.pointer === event.pointerId) {
    movePart(drag.part, x - drag.x, y - drag.y)
  } else if (state.placing) {
    ghost = null
    if (Math.abs(x) <= bounds.width / 2 && Math.abs(y) <= bounds.height / 2) {
      ghost = { type: state.placing, id: 'ghost', turns: placementTurns, parent: state.selected ?? state.machine.parts[0]?.id }
      movePart(ghost, x, y)
    }
    redraw = true
  }
})
stage.addEventListener('pointerleave', () => { ghost = null; redraw = true })
for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, event => {
  if (drag?.pointer !== event.pointerId) return
  const { part, originalX, originalY } = drag
  drag = null
  if (part.x !== originalX || part.y !== originalY) edited()
})

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !app.querySelector('dialog').open) {
    if (graphWireDrag) finishWireDrag()
    if (state.wire) { state.wire = null; refreshGraph() }
    if (state.selectedWire) selectWire(null)
    if (state.selectedNodes.size) selectNodes()
    if (state.placing) { state.placing = null; ghost = null; refreshBuild() }
  }
  if (state.screen !== 'garage' || app.querySelector('dialog').open) return
  const editing = event.target.isContentEditable || event.target.closest?.('input, textarea, select')
  if (state.tab === 'program' && !editing) {
    const focused = event.target.closest?.('.wire')?.dataset.wire
    const source = focused ?? state.selectedWire
    const key = event.key.toLowerCase()
    const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
    if (shortcut && key === 'c' && state.selectedNodes.size) {
      const clipboard = copyProgramNodes(state.machine, state.selectedNodes)
      if (clipboard.nodes.length) {
        event.preventDefault()
        nodeClipboard = clipboard
        pasteOffset = 0
      }
      return
    }
    if (shortcut && key === 'v' && nodeClipboard) {
      event.preventDefault()
      if (!event.repeat) pasteNodes()
      return
    }
    if ((key === 'enter' || key === ' ') && event.target.matches?.('.node')) {
      event.preventDefault()
      selectNodes(event.target.dataset.node, shortcut)
      selectWire(null)
      return
    }
    if (event.key === 'Delete' && source && state.machine.links[source]) {
      event.preventDefault()
      unlink(source)
    } else if (focused && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      selectWire(focused)
    }
    return
  }
  if (state.tab !== 'build') return
  const selected = state.machine.parts.find(part => part.id === state.selected)
  const activeType = state.placing ?? selected?.type
  const rotationKey = event.key === '1' || (event.key === ' ' && (state.placing || !event.target.closest?.('button')))
  if (rotationKey && !event.altKey && !event.ctrlKey && !event.metaKey && !editing && activeType && !parts[activeType].joint) {
    event.preventDefault()
    if (event.repeat) return
    if (state.placing) {
      placementTurns = (placementTurns + 1) % 4
      if (ghost) {
        ghost.turns = placementTurns
        movePart(ghost, ghost.x, ghost.y)
      }
    } else {
      selected.turns = ((selected.turns ?? 0) + 1) % 4
      Object.assign(selected, buildPosition(selected.type, selected.x, selected.y, false, selected.turns))
      edited()
      refreshBuild()
    }
    return
  }
  if (!selected) return
  if (event.key === 'Delete' && !editing) {
    event.preventDefault()
    actions['remove-part']()
    return
  }
  if (event.target.tagName !== 'CANVAS') return
  const movement = { ArrowLeft: [-0.25, 0], ArrowRight: [0.25, 0], ArrowUp: [0, 0.25], ArrowDown: [0, -0.25] }[event.key]
  if (!movement) return
  event.preventDefault()
  movePart(selected, selected.x + movement[0], selected.y + movement[1])
  edited()
})

let previous = performance.now()
let accumulator = 0
function frame(now) {
  const delta = Math.min(0.05, (now - previous) / 1000)
  previous = now
  const sim = state.simulation
  if (sim?.status === 'running') {
    accumulator += delta
    while (accumulator >= STEP && sim.status === 'running') {
      sim.step()
      accumulator -= STEP
    }
    const poses = sim.poses()
    const center = poses.reduce((sum, pose) => sum + pose.x, 0) / poses.length
    const height = poses.reduce((sum, pose) => sum + pose.y, 0) / poses.length
    camera.x += (center - camera.x) * Math.min(1, delta * 5)
    camera.y += (height - camera.y) * Math.min(1, delta * 5)
    redraw = true
    if (sim.status !== 'running') {
      runResult = sim.status
      if (runResult === 'won') {
        const id = levels[state.level].id
        if (sim.elapsed < (bestTime(id) ?? Infinity)) {
          state.records[id] = sim.elapsed
          persist()
        }
      }
      updateRace()
    } else if (raceTicks++ % 5 === 0) updateRace()
  } else accumulator = 0
  if (paint && stage.isConnected) {
    const size = stage.clientWidth + 'x' + stage.clientHeight + '@' + window.devicePixelRatio
    if (redraw || lastSize !== size) {
      if (state.screen === 'race') paint(draw => drawLevel(draw, levels[state.level], sim?.poses() ?? [], camera))
      else paint(draw => drawWorkshop(draw, state.machine.parts, state.selected, ghost))
      redraw = false
      lastSize = size
    }
  }
  requestAnimationFrame(frame)
}

render()
createRenderer(stage.querySelector('canvas'), mode => {
  state.mode = mode
  footer()
  redraw = true
}).then(renderer => { paint = renderer; redraw = true })
requestAnimationFrame(frame)
