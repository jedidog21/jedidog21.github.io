# One HTML file, no build step

`frontend/index.html` holds the markup, the styles and about 190 lines of JavaScript. It has no dependencies and nothing to compile: the API hands the file to the browser as it is.

The page keeps no data of its own. Everything on screen was fetched from the [API](api.md), and after every change the page asks the API again instead of updating its own copy. That makes the code short and means the screen always shows what the database holds.

## Opening the page

Start the API (see the [quickstart](index.md#quickstart)), then open `http://<API_HOST>:<API_PORT>/` and log in with `API_USERNAME` and `API_PASSWORD`.

### Why the API serves the page

The page must be loaded from the API, not opened from disk as a `file://` URL. Two things depend on it:

- **Relative URLs.** The page calls `fetch("/categories")`, with no host. The browser resolves that against wherever the page came from, so it only reaches the API if the API served the page.
- **The session cookie.** Browsers attach cookies to requests going back to the same origin automatically. Served from the API, the page needs no extra code to stay logged in.

The route that does this is three lines in `app.py`, and it is the one route with no login check, because the login form is on the page it serves:

```python
@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")
```

## Two screens, one page

The file contains two top-level elements, a login card (`#login`) and the dashboard (`#app`). Both start hidden. The page shows exactly one of them, depending on how the API answers.

![State diagram: when the page loads it calls start(), which requests GET /categories. A 200 response shows the dashboard. A 401 response shows the login screen. A successful login calls start() again. From the dashboard, logging out or any API call that answers 401 returns to the login screen.](assets/diagrams/screen-states.svg)

*The page never stores whether you are logged in. It finds out by asking for the category list and seeing whether the API says `401`.*

This is the function that runs when the page loads. The request for categories is needed anyway, to fill the drop-downs, so it doubles as the “am I logged in?” check:

```js
async function start() {
  await loadCategories();
  $("login").hidden = true;
  $("app").hidden = false;
  await refreshData();
}
```

If `loadCategories()` gets a `401`, it throws before the next two lines run, and the login screen is shown instead. If it fails for another reason, such as the database being down, the dashboard is shown with the error message at the top so the page is never left blank.

## What is on the dashboard

The dashboard is four cards. This sketch shows their arrangement on a wide screen and the API calls behind each one.

![Sketch of the dashboard: a header with a Log out button, then four cards. Add expense and Add category sit side by side, with Monthly total inside the Add category card. Expenses and Spending by category each span the full width. Each card lists the endpoints it calls.](assets/diagrams/dashboard.svg)

*On a narrow screen the cards stack in a single column.*

| Part of the page | What it does | Endpoints used |
|------------------|--------------|----------------|
| Login screen | Logs in; shown whenever the API answers `401` | `POST /login` |
| Log out button | Ends the session | `POST /logout` |
| Add expense | Adds an expense to a chosen category | `GET /categories`, `POST /expenses` |
| Add category | Adds a category | `POST /categories` |
| Monthly total | Shows the total for the selected month | `GET /expenses/monthly-total` |
| Expenses | Lists all expenses, one category, or a date range, with a Delete button per row | `GET /expenses`, `GET /expenses/by-category`, `GET /expenses/by-date-range`, `DELETE /expenses/<id>` |
| Spending by category | Shows the expense count and total for every category | `GET /expenses/totals-by-category` |

Between them these use all eleven API endpoints, so the page is also a working example of every call in the [endpoint reference](api.md#endpoint-reference).

## Talking to the API

Every request goes through one function. It is the only place that calls `fetch`, and the only place that knows the API's conventions.

```js
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== "/login") {
    showLogin();
    throw new Error("Please log in.");
  }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
```

It handles the four kinds of answer the API gives:

| The API answers | `api()` does this |
|-----------------|-------------------|
| `200` or `201` with JSON | Returns the parsed data |
| `204` with no body | Returns `null` without trying to parse anything |
| `401` from any endpoint but `/login` | Switches to the login screen and throws. This is what handles a session that has ended while the page was open. |
| Any other error | Throws an `Error` whose message is the API's `error` text |

A `401` from `/login` itself is left to fall through to the last case, so that a wrong password shows “invalid credentials” on the login form.

### Showing errors

Because `api()` reports every failure by throwing, the rest of the code needs only one way to handle errors. Each action on the dashboard is wrapped in `attempt()`, which clears the message line, runs the action, and prints the error text if it throws:

```js
async function attempt(action) {
  $("message").textContent = "";
  try {
    await action();
  } catch (err) {
    $("message").textContent = err.message;
  }
}
```

The message line is marked `role="alert"`, so screen readers announce errors as they appear. The text shown is whatever the API sent, which for rejected values is [PostgreSQL's own wording](api.md#messages-that-come-from-the-database).

## Keeping the screen in sync

Four functions each fetch one thing and redraw one part of the page.

| Function | Fetches | Redraws |
|----------|---------|---------|
| `loadCategories()` | `GET /categories` | Both category drop-downs, keeping the current selection in each |
| `loadExpenses()` | One of the three expense lists, chosen by the filter | The Expenses table |
| `loadTotals()` | `GET /expenses/totals-by-category` | The Spending by category table |
| `loadMonthlyTotal()` | `GET /expenses/monthly-total` | The Monthly total figure |

`refreshData()` runs the last three at once with `Promise.all`. After any action, the page re-runs whichever of these could have been affected:

| When you… | The page calls | Then reloads |
|-----------|----------------|--------------|
| Log in | `POST /login` | Everything, through `start()` |
| Add an expense | `POST /expenses` | Expenses, totals and monthly total |
| Delete an expense | `DELETE /expenses/<id>` | Expenses, totals and monthly total |
| Add a category | `POST /categories` | Categories and totals. The new category appears in the drop-downs and as a row with no spending. |
| Change the filter | (nothing else) | Expenses only |
| Change the month | (nothing else) | Monthly total only |
| Log out | `POST /logout` | Nothing; the login screen is shown |

### The expense filter

The “Show” drop-down decides which endpoint `loadExpenses()` calls, and which extra inputs are visible.

| Show | Extra inputs | Request |
|------|--------------|---------|
| All expenses | none | `GET /expenses` |
| One category | Category | `GET /expenses/by-category?name=…` |
| Date range | From, To | `GET /expenses/by-date-range?start=…&end=…`, sent once both dates are filled in |

Query strings are built with `URLSearchParams`, which takes care of encoding, so a category called “Food & Dining” is sent correctly. The by-category endpoint leaves the category out of its results, so for that view the table's Category column is filled from the filter's own value.

## Details worth noticing

### Money and dates

- **Amounts go out as text.** The form sends the amount exactly as typed, as a string, and the database converts it to `NUMERIC`. The value is never held as a JavaScript floating-point number on its way in.
- **Amounts are shown in US dollars.** `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` turns `"45.99"` into `$45.99`. To use another currency, change that one line.
- **Missing totals show as $0.00.** The API returns `null` for a category or month with no expenses; the page substitutes zero with `?? 0`.
- **“Today” is local.** The date field defaults to today and the month picker to this month. The `today()` helper adjusts for the time zone first, so late in the evening it does not jump ahead to tomorrow's UTC date.

### Forms

- **Built-in validation first.** Inputs use `required`, `type="number"` with `min="0.01"` and `step="0.01"`, and `type="date"`, so the browser blocks most bad input before a request is made. The API and database still check, because a form can be bypassed.
- **Quick repeat entry.** After adding an expense, only the amount and description are cleared. The category and date stay, which suits entering several receipts from one day.
- **Deletion asks first.** The Delete button shows a confirmation naming the expense, since the API has no undo.

### Safe rendering

Table rows are built with `document.createElement` and filled through `textContent`, never by assembling HTML strings. Descriptions and category names are typed by a person and stored as they are, so this matters: an expense described as `<script>alert(1)</script>` is displayed as that text rather than run.

### Styling

- **Light and dark.** Colours are CSS custom properties on `:root`, redefined inside `@media (prefers-color-scheme: dark)`. The page follows the browser or system setting; it has no toggle of its own.
- **Responsive without breakpoints.** The cards sit in a CSS grid with `repeat(auto-fit, minmax(340px, 1fr))`: two columns when there is room, one when there is not. Tables scroll sideways inside their card on narrow screens.

## Adding a feature

New behaviour follows the same path through the tiers as the existing use cases. To add, say, the single largest expense of the month:

1. **Write the query.** Add it to `SQL/queries.sql` with example values and try it in `psql` until the result is right.
2. **Add the endpoint.** In `app.py`, add a function with a route decorator and `@login_required`. Check that required parameters are present, then return `jsonify(run(sql, params))` with `%s` in place of each example value.
3. **Add a place for it in the page.** Add the markup to a card, and write a `load…()` function that calls `api("GET", …)` and fills it in.
4. **Keep it fresh.** Add the new function to `refreshData()` so it re-runs whenever expenses change.

---

Previous: [API](api.md)
