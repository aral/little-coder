---
name: kitten-streaming-html
type: domain-knowledge
topic: Kitten Web Framework
token_cost: 400
keywords: [kitten, Kitten, streaming, html, htmx, websocket, component, fragment, database, jsdb, page, route, connect, morph, send, onConnect, onUpdate, peer-to-peer, small web, web framework]
requires_tools: [Bash, Read, Write, Edit, Glob]
user-invocable: false
---

Kitten is a web framework by Small Technology Foundation (Aral Balkan) that uses a Streaming HTML workflow — server-rendered HTML streamed over WebSockets, no client-side JavaScript needed.

## Core concepts

**File-based routing**: Files ending in `.page.js` define routes based on their path. `index.page.js` → `/`. `about.page.js` → `/about`.

**kitten.html**: A tagged template string (global) for writing HTML. Example:
  kitten.html`<h1>Hello</h1>`

**kitten.db**: A built-in in-process JavaScript database (JSDB). Data persists to disk automatically.
  kitten.db.counter = { count: 0 }
  kitten.db.counter.count += 1

**Components & fragments**: Functions returning `kitten.html` templates.
  const Count = () => kitten.html`<div>${kitten.db.counter.count}</div>`

**HTML Validation**: Kitten performs HTML validation on the HTML rendered from page routes. Any validation errors you might see pertain to the rendered HTML. (Kitten-specific tags like `<page>` are stripped and/or transformed prior to hitting the validator and are not sent to the client.)

## Streaming HTML workflow (the core pattern)

1. A page exports a default function (GET handler) and optionally event handlers (`onUpdate`, `onConnect`, etc.).
2. Client elements with `connect` attribute + `name` map to server handlers: `<button name='update' connect>` → `export function onUpdate(data)`.
3. The handler mutates `kitten.db` (if it needs to persist anything) and calls `this.send(kitten.html`...`)` to stream updated HTML back. There must be a top-level element in the content being streamed back with an `id` that matches an element on the page (that is how the client-side functionality, powered by htmx, knows how to find and replace the element in the DOM).
4. Elements with `morph` attribute get idiomorph-replaced in-place.

Example counter page (`index.page.js`):
```js
if (kitten.db.counter === undefined) kitten.db.counter = { count: 0 }

export default () => kitten.html`
  <page css>
    <h1>Counter</h1>
    <${Count} />
    <button name='update' connect data='{value: -1}' aria-label='decrement'>-</button>
    <button name='update' connect data='{value: 1}' aria-label='increment'>+</button>
  </page>
`

const Count = () => kitten.html`
  <div id='counter' aria-live='assertive' morph style='font-size: 3em; margin: 0.25em 0;'>
    ${kitten.db.counter.count}
  </div>
`

export function onUpdate(data) {
  kitten.db.counter.count += data.value
  this.send(kitten.html`<${Count} />`)
}
```

## Key attributes

- `connect` on elements → auto-maps to `on<EventName>` handler
- `data` → extra payload sent to handler (parsed as JS object)
- `morph` → idiomorph swap (replaces element by id)
- `<page css>` → includes Water CSS

## File types

- `.page.js` — dynamic pages (route handlers)
- `.fragment.js` — reusable components
- `.page.md` — markdown pages

## When working with Kitten

- Always run `kitten` (not `node` or `python`) to serve the app. You should run it in the background and kill the process afterwards so as not to leave dangling processes. By default Kitten servers run at `https://localhost`.
- Pages export `default` (GET) and `on<EventName>` (WebSocket events).
- Use `kitten.db.<table>` for persistence — no SQL needed.
- The `send()` method streams HTML fragments back to the client. The top-level element in the fragment replaces the DOM element with the same ID on the client.
- Hot-reload is automatic — save and the browser updates.
