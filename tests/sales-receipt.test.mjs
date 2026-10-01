import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = fileURLToPath(new URL('../', import.meta.url))
const modules = new Map()

// Render the real receipt and its real calculation helpers, with no database.
function load(path) {
  if (modules.has(path)) return modules.get(path).exports
  const loadedModule = { exports: {} }
  modules.set(path, loadedModule)
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
  runInNewContext(source, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(name) {
      if (name.endsWith('.css')) return {}
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? resolve(root, 'src', name.slice(2))
          : resolve(dirname(path), name)
        return load(['.ts', '.tsx'].map(ext => base + ext).find(existsSync))
      }
      return require(name)
    },
  }, { filename: path })
  return loadedModule.exports
}

const Receipt = load(resolve(root, 'src/components/sales/sales-receipt-content.tsx')).default

function receiptSettings(initialStorage = {}, unavailableStorage = false) {
  const stored = new Map(Object.entries(initialStorage))
  const state = []
  let hook = 0
  const loadedModule = { exports: {} }
  const path = resolve(root, 'src/components/sales/sales-receipt-modal.tsx')
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  runInNewContext(source, {
    module: loadedModule, exports: loadedModule.exports, document: { body: {} },
    window: { localStorage: {
      getItem(key) { if (unavailableStorage) throw Error('Storage blocked'); return stored.get(key) ?? null },
      setItem(key, value) { if (unavailableStorage) throw Error('Storage blocked'); stored.set(key, value) },
    } },
    require(name) {
      if (name === 'react') return {
        ...React, useEffect() {}, useRef: () => ({ current: null }),
        useState(initial) {
          const index = hook++
          if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
          return [state[index], value => { state[index] = value }]
        },
      }
      if (name === 'react-dom') return { createPortal: element => element }
      if (name === '@/lib/tenant-client') return { useTenant: () => ({ tenantName: 'Testing', logoUrl: null }) }
      if (name === './sales-receipt-content') return { default: Receipt }
      if (name.endsWith('.css')) return {}
      return require(name)
    },
  }, { filename: path })
  function render() {
    hook = 0
    const tree = loadedModule.exports.default({ sale: {}, onClose() {} })
    const nodes = []
    function visit(element) {
      if (!React.isValidElement(element)) return
      nodes.push(element)
      React.Children.forEach(element.props.children, visit)
    }
    visit(tree)
    return {
      paper: nodes.find(node => node.type === 'article'),
      select: id => nodes.find(node => node.type === 'select' && node.props.id === id),
    }
  }
  return { render, stored }
}

function item(overrides = {}) {
  return {
    id: 'item-1', quantity_trays: 12, price_per_tray_paisa: 101,
    discount_type: null, discount_value: 0, discounted_price_paisa: 0,
    egg_category: { name: 'Large eggs' },
    ...overrides,
  }
}

function render(overrides = {}, businessName = 'Testing business') {
  return renderToStaticMarkup(React.createElement(Receipt, {
    businessName,
    sale: {
      id: 'sale-1', invoice_number: 'SAL-0009', sale_date: '2026-10-01',
      payment_status: 'unpaid', amount_paid_paisa: 0, discount_amount_paisa: 0,
      customer: { contact_name: 'Customer One', business_name: 'Shop One', phone: '03001234567' },
      items: [item()],
      ...overrides,
    },
  }))
}

test('receipt preserves exact paisa, units and paid/partial/unpaid amounts', () => {
  for (const [status, amount, paid, due] of [
    ['unpaid', 900, 'Rs. 0', 'Rs. 12.12'],
    ['partial', 501, 'Rs. 5.01', 'Rs. 7.11'],
    ['paid', 0, 'Rs. 12.12', 'Rs. 0'],
  ]) {
    const html = render({ payment_status: status, amount_paid_paisa: amount })
    assert.match(html, /1 peti/)
    assert.match(html, /Rate: Rs\. 1\.01 \/ tray/)
    assert.ok(html.includes(`<strong>Total</strong><strong>Rs. 12.12</strong>`))
    assert.ok(html.includes(`<span>Paid</span><span>${paid}</span>`))
    assert.ok(html.includes(`<strong>Balance due</strong><strong>${due}</strong>`))
  }
})

test('receipt uses rounded line totals, per-peti discounts and clamped invoice discounts', () => {
  const html = render({
    items: [
      item({ discount_type: 'percentage', discount_value: 10, discounted_price_paisa: 91 }),
      item({ id: 'item-2', quantity_trays: 6, price_per_tray_paisa: 500, discount_type: 'fixed', discount_value: 1.01 }),
    ],
    discount_amount_paisa: 1,
  })
  assert.ok(html.includes('<strong>Rs. 10.91</strong>'))
  assert.ok(html.includes('<strong>Rs. 29.49</strong>'))
  assert.match(html, /Item discount: Rs\. 1\.01 \/ peti/)
  assert.ok(html.includes('<span>Rs. 40.40</span>'))
  assert.ok(html.includes('<strong>Total</strong><strong>Rs. 40.39</strong>'))
  const free = render({ discount_amount_paisa: 999999, payment_status: 'paid' })
  assert.ok(free.includes('<strong>Total</strong><strong>Rs. 0</strong>'))
  assert.ok(free.includes('<strong>Balance due</strong><strong>Rs. 0</strong>'))
})

test('receipt escapes customer/business/item text and excludes internal accounting data', () => {
  const html = render({
    notes: 'Internal note: margin secret', cogs_paisa: 999, gross_profit_paisa: 111,
    customer: { contact_name: '<script>alert(1)</script>' },
    items: [item({ egg_category: { name: '<img src=x onerror=alert(1)>' } })],
  }, '<b>Tenant name</b>')
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;b&gt;Tenant name&lt;\/b&gt;/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<script|<img|margin secret|cogs|gross_profit/)
})

test('long names, many lines and large amounts remain complete in the receipt', () => {
  const items = Array.from({ length: 80 }, (_, index) => item({
    id: `item-${index}`, quantity_trays: 1, price_per_tray_paisa: 123456789,
    egg_category: { name: `Category ${index} with a very long complete description` },
  }))
  const html = render({ items })
  for (let i = 0; i < 80; i++) assert.ok(html.includes(`Category ${i} with a very long complete description`))
  assert.ok(html.includes('Rs. 12,34,567.89'))
  assert.ok(html.includes('Rs. 9,87,65,431.20'))
})

test('58 mm receipt defaults to a 48 mm printable content area', () => {
  const settings = receiptSettings({ 'doctors-egg.receipt-paper-width': '58' })
  const { paper } = settings.render()
  assert.equal(paper.props.style.width, '58mm')
  assert.equal(paper.props.style.paddingLeft, '5mm')
  assert.equal(paper.props.style.paddingRight, '5mm')
})

test('side margins are saved separately for each paper width', () => {
  const settings = receiptSettings({ 'doctors-egg.receipt-paper-width': '58' })
  let view = settings.render()
  view.select('receipt-side-margins').props.onChange({ target: { value: '6' } })
  view = settings.render()
  assert.equal(view.paper.props.style.paddingLeft, '6mm')
  view.select('receipt-paper-width').props.onChange({ target: { value: '80' } })
  view = settings.render()
  assert.equal(view.paper.props.style.paddingLeft, '3mm')
  view.select('receipt-side-margins').props.onChange({ target: { value: '4' } })
  view = settings.render()
  assert.equal(view.paper.props.style.paddingRight, '4mm')
  view.select('receipt-paper-width').props.onChange({ target: { value: '58' } })
  assert.equal(settings.render().paper.props.style.paddingLeft, '6mm')
  assert.equal(settings.stored.get('doctors-egg.receipt-paper-width.margin-58'), '6')
  assert.equal(settings.stored.get('doctors-egg.receipt-paper-width.margin-80'), '4')
})

test('invalid or blocked stored margins cannot produce an unsafe layout', () => {
  for (const invalid of ['-5', '0', '50', '3.5', 'NaN', 'Infinity', 'unknown']) {
    const settings = receiptSettings({
      'doctors-egg.receipt-paper-width': '58', 'doctors-egg.receipt-paper-width.margin-58': invalid,
    })
    const view = settings.render()
    assert.equal(view.paper.props.style.paddingLeft, '5mm', invalid)
    view.select('receipt-side-margins').props.onChange({ target: { value: invalid } })
    assert.equal(settings.render().paper.props.style.paddingRight, '5mm', invalid)
  }
  const blocked = receiptSettings({}, true)
  assert.equal(blocked.render().paper.props.style.width, '80mm')
  blocked.render().select('receipt-paper-width').props.onChange({ target: { value: '58' } })
  assert.equal(blocked.render().paper.props.style.paddingLeft, '5mm')
})
