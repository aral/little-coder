---
name: kitten-debugging
type: domain-knowledge
topic: Kitten Web Framework — Debugging
token_cost: 500
keywords: [kitten, Kitten, debugging, crash, error, issue, refresh, event system, data attribute, WebSocket, send, morph, error handling, stack trace]
requires_tools: [Bash, Read, ShellSession]
user-invocable: false
---

When debugging Kitten apps, follow this diagnostic workflow:

## 1. Unexpected Page Refresh → Check the Server First

A page refresh in Kitten is often **not** a client-side issue. The server may have crashed with an unhandled exception and auto-restarted.

**Always check:**
- The `kitten .` terminal output for stack traces
- Server log files at `~/.local/share/small-tech.org/kitten/`
- Browser console for JS errors

If there's a crash, the refresh is a *symptom* of the server restarting, not the root cause.

## 2. Kitten's Event System — Common Pitfalls

### The `data` attribute is NOT the same as `data-*` attributes

```html
<!-- WRONG: plain HTML attributes, NOT sent to server -->
<button data-row="3" data-col="5" name="fire" connect>Fire</button>

<!-- CORRECT: Kitten's data attribute, serialized and sent to server -->
<button data='{row: 3, col: 5}' name="fire" connect>Fire</button>
```

- `data-row`, `data-col`, etc. are **plain HTML attributes** — invisible to Kitten's event system
- `data='{...}'` is transformed by Kitten into `hx-vals='js:{...}'` and **sent to the server**

### Missing `data` → `undefined` crash

If a button has no `data` attribute, the event handler receives `data` as `undefined`. Accessing `data.row` or `data.col` throws:

```
TypeError: Cannot read properties of undefined (reading 'row')
```

This crashes the server, which auto-restarts, which causes the page refresh.

### The full event chain:

```
User clicks button
  → button has name="fire" + connect
  → Kitten maps this to exported function onFire(data)
  → data is the parsed value of the button's data attribute
  → if no data attribute, data is undefined → CRASH
```

## 3. Debugging Checklist

When a Kitten app misbehaves, check in this order:

1. **Server console** — any unhandled exceptions? (most common cause of "refreshes")
2. **Browser console** — any JS errors? (network failures, WebSocket issues)
3. **Event handler signature** — does `onXxx(data)` match the button's `name="xxx"`?
4. **Data attribute** — does the button have `data='{...}'` if the handler reads `data.something`?
5. **send() call** — does the handler call `this.send(kitten.html`...`)` with an element that has an `id` matching an element on the page?
6. **Morph target** — does the streamed fragment have an `id` that exists on the current page? (without it, the DOM update fails silently)

## 4. Common Error Patterns

| Symptom | Likely Cause |
|---|---|
| Page refreshes on click | Server crashed (check server logs for stack trace) |
| Click does nothing | Button missing `connect` attribute, or no matching `onXxx` handler exported |
| `data` is `undefined` in handler | Button has no `data` attribute (or uses `data-row` instead of `data`) |
| DOM doesn't update after click | `send()` fragment missing `id` that matches a page element, or missing `morph` attribute |
| WebSocket connection fails | No event handlers exported (Kitten only creates WebSocket route when handlers exist) |
