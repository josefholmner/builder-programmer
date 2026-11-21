import { actuatorColor, bounds, buildAngle, capsuleSize, isRotaryMount, localVertices, parts, pistonAngle, terrainY } from './model.js'

const colors = new Map()
function rgb(hex) {
  if (!colors.has(hex)) {
    colors.set(hex, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255))
  }
  return colors.get(hex)
}

class Drawing {
  vertices = []

  constructor(width, height) {
    this.width = width
    this.height = height
  }

  triangle(a, b, c, color) {
    const tint = rgb(color)
    for (const [x, y] of [a, b, c]) {
      this.vertices.push(2 * x / this.width - 1, 1 - 2 * y / this.height, ...tint)
    }
  }

  polygon(points, color) {
    for (let i = 1; i < points.length - 1; i++) this.triangle(points[0], points[i], points[i + 1], color)
  }

  rect(x, y, w, h, color) {
    this.polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color)
  }

  line([x, y], [ex, ey], width, color) {
    const length = Math.hypot(ex - x, ey - y)
    if (!length) return
    const dx = -(ey - y) * width / (2 * length)
    const dy = (ex - x) * width / (2 * length)
    this.polygon([[x + dx, y + dy], [ex + dx, ey + dy], [ex - dx, ey - dy], [x - dx, y - dy]], color)
  }

  circle(x, y, radius, color) {
    const steps = radius > 60 ? 40 : 24
    this.polygon(Array.from({ length: steps }, (_, i) => {
      const angle = i * 2 * Math.PI / steps
      return [x + radius * Math.cos(angle), y + radius * Math.sin(angle)]
    }), color)
  }
}

export function workshopView(width, height) {
  return { x: width / 2, y: height / 2, scale: Math.max(1, Math.min((width - 54) / bounds.width, (height - 48) / bounds.height)) }
}

function machineDrawing(draw, machine, project, scale, selected, ghost) {
  const all = new Map(machine.map(part => [part.id, part]))
  for (const part of machine) {
    const parent = all.get(part.parent)
    if (!parent) continue
    const a = project(parent.x, parent.y)
    const b = project(part.x, part.y)
    const mountWidth = isRotaryMount(part) ? 0.26 : 0.18
    draw.line(a, b, Math.max(2, scale * mountWidth), '#343944')
    const moving = parts[part.type].joint === 'prismatic'
    draw.line(a, b, Math.max(moving ? 2 : 1, scale * (moving ? 0.09 : 0.06)), moving ? actuatorColor : '#8e949d')
  }
  for (const part of ghost ? [...machine, ghost] : machine) {
    const info = parts[part.type]
    const [x, y] = project(part.x, part.y)
    const angle = part.angle ?? (info.shape === 'capsule' ? pistonAngle(part, all.get(part.parent)) : buildAngle(part))
    const size = info.width * scale / 2
    const preview = info.previewColor ?? (info.joint ? '#a88f42' : part.type === 'blob' ? '#a95c89' : '#8994c2')
    const accent = part === ghost ? preview : info.color
    const outline = selected === part.id ? '#ffddaa' : '#101927'
    const point = (px, py) => [x + (px * Math.cos(angle) - py * Math.sin(angle)) * scale,
      y - (px * Math.sin(angle) + py * Math.cos(angle)) * scale]
    if (info.shape === 'capsule') {
      const { halfLength, radius } = capsuleSize(part)
      const a = point(-halfLength, 0)
      const b = point(halfLength, 0)
      const pixels = radius * scale
      draw.line(a, b, 2 * (pixels + 1.5), outline)
      for (const end of [a, b]) draw.circle(...end, pixels + 1.5, outline)
      draw.line(a, b, 2 * pixels, accent)
      for (const end of [a, b]) draw.circle(...end, pixels, accent)
      draw.line(point(-halfLength, radius * 0.42), point(halfLength, radius * 0.42), 1.5, '#fff2b3')
    } else if (isRotaryMount(part)) {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, '#8e949d')
      if (part.type === 'servo') {
        const edge = info.width * 0.3
        draw.polygon([point(-edge, -edge), point(edge, -edge), point(edge, edge), point(-edge, edge)], accent)
        draw.line(point(0, -edge * 0.6), point(0, edge * 0.6), Math.max(2, size * 0.13), '#173e48')
        draw.line([x, y], point(edge * 0.82, 0), Math.max(2, size * 0.16), '#173e48')
      } else {
        draw.circle(x, y, size * 0.74, accent)
        draw.line([x, y], point(info.width * 0.27, 0), Math.max(2, size * 0.19), '#3c3428')
        draw.circle(x, y, size * 0.18, '#3c3428')
      }
    } else if (info.drive) {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, '#293746')
      draw.circle(x, y, size * 0.74, accent)
      for (let i = 0; i < 6; i++) {
        const spoke = i * Math.PI / 3
        draw.line([x, y], point(Math.cos(spoke) * info.width * 0.32, Math.sin(spoke) * info.width * 0.32), Math.max(2, size * 0.16), '#3e5369')
        draw.line(point(Math.cos(spoke) * info.width * 0.43, Math.sin(spoke) * info.width * 0.43),
          point(Math.cos(spoke) * info.width * 0.49, Math.sin(spoke) * info.width * 0.49), 2, '#667b8d')
      }
      draw.circle(x, y, size * 0.23, '#e3ecf2')
    } else if (part.type === 'blob') {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, '#bc4c87')
      draw.circle(x, y - size * 0.11, size * 0.89, accent)
      draw.circle(x - size * 0.31, y - size * 0.37, size * 0.18, '#ffe1ef')
    } else if (info.shape === 'circle') {
      draw.circle(x, y, size + 2, outline)
      draw.circle(x, y, size, accent)
      draw.line(point(-info.width * 0.29, 0), point(info.width * 0.29, 0), 2, '#ffe1ab')
    } else {
      const vertices = localVertices(part)
      draw.polygon(vertices.map(([px, py]) => point(px, py)), accent)
      vertices.forEach(([px, py], i) => {
        const next = vertices[(i + 1) % vertices.length]
        draw.line(point(px, py), point(...next), selected === part.id ? 2.5 : 1.5, outline)
      })
      if (info.shape === 'box') {
        const edge = info.width * 0.37
        draw.line(point(-edge, info.height * 0.25), point(edge, info.height * 0.25), 2,
          info.joint ? '#fff2b3' : '#ffe1ab')
        for (const px of [-edge, edge]) {
          const [bx, by] = point(px, 0)
          draw.circle(bx, by, Math.max(2, scale * 0.045), '#5d4d4b')
        }
      }
    }
  }
}

export function drawWorkshop(draw, machine, selected, ghost) {
  const { x, y, scale } = workshopView(draw.width, draw.height)
  const project = (px, py) => [x + px * scale, y - py * scale]
  const [left, top] = project(-bounds.width / 2, bounds.height / 2)
  const w = bounds.width * scale
  const h = bounds.height * scale
  draw.rect(0, 0, draw.width, draw.height, '#20213c')
  for (let y = 0; y <= draw.height; y += 22) {
    for (let x = 0; x <= draw.width; x += 22) draw.rect(x, y, 1.5, 1.5, '#3c3d66')
  }
  draw.rect(left, top, w, h, '#242c4b')
  for (let dx = -Math.floor(bounds.width / 2); dx <= bounds.width / 2; dx++) {
    draw.rect(x + dx * scale, top, 1, h, dx === 0 ? '#515d86' : '#353e62')
  }
  for (let dy = -Math.floor(bounds.height); dy <= bounds.height; dy++) {
    draw.rect(left, y + dy * scale / 2, w, 1, dy === 0 ? '#515d86' : '#333a5c')
  }
  for (const dx of [0, w]) for (const dy of [0, h]) {
    draw.rect(left + dx - (dx ? 16 : 1), top + dy - 1, 17, 2, '#ffcd89')
    draw.rect(left + dx - 1, top + dy - (dy ? 16 : 1), 2, 17, '#ffcd89')
  }
  machineDrawing(draw, machine, project, scale, selected, ghost)
}

export function drawLevel(draw, level, poses, camera) {
  const { width, height } = draw
  const scale = Math.min(50, width / 17, height / 11)
  const hasPit = level.points.some(([, y]) => y < 0)
  const floor = height * (hasPit ? 0.70 : 0.78)
  const elevation = hasPit && camera.y < 0 ? camera.y : Math.max(0, camera.y - 2)
  const project = (x, y) => [width * 0.27 + (x - camera.x) * scale, floor - (y - elevation) * scale]
  draw.rect(0, 0, width, height, level.sky)
  const sunX = width * 0.78 - camera.x * 0.4
  const sunY = height * 0.23
  const sunRadius = Math.min(height * 0.105, 72)
  draw.circle(sunX, sunY, sunRadius * 1.16, '#fff3c6')
  draw.circle(sunX, sunY, sunRadius, '#ffda78')

  const cloudSpacing = 280
  const cloudOffset = (camera.x * 1.3) % cloudSpacing
  const cloudRadius = Math.min(27, height * 0.05)
  for (let i = -1; i < width / cloudSpacing + 1; i++) {
    const x = (i + 0.36) * cloudSpacing - cloudOffset
    const y = height * (0.19 + 0.11 * (1 + Math.sin(i * 2.6)))
    draw.line([x - cloudRadius, y], [x + cloudRadius, y], cloudRadius * 1.05, '#fffaf0')
    draw.circle(x - cloudRadius, y, cloudRadius * 0.57, '#fffaf0')
    draw.circle(x + cloudRadius, y, cloudRadius * 0.62, '#fffaf0')
    draw.circle(x - cloudRadius * 0.25, y - cloudRadius * 0.48, cloudRadius * 0.86, '#fffaf0')
    draw.circle(x + cloudRadius * 0.49, y - cloudRadius * 0.25, cloudRadius * 0.66, '#fffaf0')
  }

  for (const [layer, tint] of level.hills.entries()) {
    const spacing = 230 + layer * 40
    const offset = (camera.x * (1.8 + layer * 2)) % spacing
    for (let i = -1; i < width / spacing + 1; i++) {
      const x = (i + layer * 0.45) * spacing - offset
      const rise = height * (0.22 - layer * 0.055 + Math.sin(i * 2.8 + layer) * 0.05)
      const arch = Array.from({ length: 13 }, (_, step) => {
        const angle = Math.PI * step / 12
        return [x - spacing * 0.61 * Math.cos(angle), floor - rise * Math.sin(angle)]
      })
      draw.polygon([...arch, [arch.at(-1)[0], height], [arch[0][0], height]], tint)
    }
  }
  for (let i = 1; i < level.points.length; i++) {
    const start = level.points[i - 1]
    const end = level.points[i]
    const previous = project(...start)
    const next = project(...end)
    const pitFloor = start[1] < 0 && start[1] === end[1]
    draw.polygon([previous, next, [next[0], height + 2], [previous[0], height + 2]], level.land)
    if (pitFloor) {
      draw.rect(previous[0], previous[1], next[0] - previous[0], Math.max(6, scale * 0.22), '#cd976d')
    }
    draw.line(previous, next, 4, pitFloor ? '#ffe3b0' : level.verge)
  }
  for (const obstacle of level.obstacles ?? []) {
    const face = obstacle.map(([x, y]) => project(x, y))
    draw.polygon(face, '#67507d')
    face.forEach((point, index) => draw.line(point, face[(index + 1) % face.length], 3, '#473351'))
    draw.line(face[0], face[1], 3, '#ffce7d')
  }
  const left = camera.x - width / scale
  const right = camera.x + width / scale
  for (let x = Math.max(-11, Math.floor(left)); x < Math.min(right, level.points.at(-1)[0]); x++) {
    const surface = terrainY(level, x)
    const [px, py] = project(x, surface)
    draw.rect(px, py + 10 + (Math.sin(x * 32) + 1) * 10, scale * 0.22, 2, level.hills[1])
    if (surface >= 0 && x % 4 === 0 && Math.abs(surface - terrainY(level, x + 0.2)) < 0.025) {
      const petal = x % 8 === 0 ? '#fff2ac' : '#fff1fa'
      const stem = scale * 0.2
      draw.line([px, py], [px + stem * 0.4, py - stem], 2, '#3b9b79')
      draw.circle(px + stem * 0.4, py - stem, Math.max(2, scale * 0.075), petal)
    }
  }
  const [startX, startY] = project(2, terrainY(level, 2))
  draw.line([startX, startY], [startX, startY - scale * 2.25], 2, '#298784')
  draw.rect(startX, startY - scale * 2.25, scale * 0.8, scale * 0.45, '#35b7a4')
  const [goalX, goalY] = project(level.finish, terrainY(level, level.finish))
  draw.line([goalX, goalY], [goalX, goalY - scale * 5], 3, '#ffb35e')
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
    draw.rect(goalX + col * scale * 0.16, goalY - scale * 5 + row * scale * 0.16,
      scale * 0.16 + 0.2, scale * 0.16 + 0.2, (row + col) % 2 ? '#1a2331' : '#fff1d6')
  }
  machineDrawing(draw, poses, project, scale)
}

const shader = `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}
@vertex fn vertexMain(@location(0) position: vec2f, @location(1) color: vec3f) -> VertexOut {
  return VertexOut(vec4f(position, 0.0, 1.0), color);
}
@fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}
`

async function gpuRenderer(canvas, onLost) {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) return
  const device = await adapter.requestDevice()
  const format = navigator.gpu.getPreferredCanvasFormat()
  const module = device.createShaderModule({ code: shader })
  const pipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module, entryPoint: 'vertexMain', buffers: [{ arrayStride: 20, attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x3' }
    ] }] },
    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] }
  })
  const context = canvas.getContext('webgpu')
  context.configure({ device, format, alphaMode: 'opaque' })
  device.lost.then(onLost)
  let buffer
  return vertices => {
    const data = new Float32Array(vertices)
    if (!buffer || buffer.size < data.byteLength) {
      buffer?.destroy()
      buffer = device.createBuffer({ size: Math.max(65536, data.byteLength * 2), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    }
    if (data.length) device.queue.writeBuffer(buffer, 0, data)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{
      view: context.getCurrentTexture().createView(), clearValue: { r: 0.055, g: 0.082, b: 0.125, a: 1 },
      loadOp: 'clear', storeOp: 'store'
    }] })
    pass.setPipeline(pipeline)
    pass.setVertexBuffer(0, buffer)
    pass.draw(data.length / 5)
    pass.end()
    device.queue.submit([encoder.finish()])
  }
}

function softwareRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false })
  return vertices => {
    const { width, height } = canvas
    ctx.fillStyle = '#0e1520'
    ctx.fillRect(0, 0, width, height)
    // Batch adjacent triangles of the same color into a single Canvas path.
    let tint = ''
    ctx.beginPath()
    for (let i = 0; i < vertices.length; i += 15) {
      const color = 'rgb(' + vertices.slice(i + 2, i + 5).map(c => Math.round(c * 255)).join(',') + ')'
      if (color !== tint) {
        ctx.fill()
        ctx.beginPath()
        ctx.fillStyle = tint = color
      }
      for (let j = i; j < i + 15; j += 5) {
        ctx[j === i ? 'moveTo' : 'lineTo']((vertices[j] + 1) * width / 2, (1 - vertices[j + 1]) * height / 2)
      }
      ctx.closePath()
    }
    ctx.fill()
  }
}

export async function createRenderer(initialCanvas, onMode) {
  let canvas = initialCanvas
  let paint = (await gpuRenderer(canvas, () => {
    const replacement = canvas.cloneNode()
    canvas.replaceWith(replacement)
    canvas = replacement
    paint = softwareRenderer(canvas)
    onMode('Canvas 2D')
  }).catch(error => console.warn('WebGPU initialization failed', error)))
  onMode(paint ? 'WebGPU' : 'Canvas 2D')
  if (!paint) paint = softwareRenderer(canvas)
  return scene => {
    const { width, height } = canvas.getBoundingClientRect()
    if (width < 1 || height < 1) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const pixelsWide = Math.round(width * ratio)
    const pixelsHigh = Math.round(height * ratio)
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh
    const drawing = new Drawing(width, height)
    scene(drawing)
    paint(drawing.vertices)
  }
}
