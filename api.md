# One endpoint per use case

A Flask application in a single file, `API/app.py`. It checks that the caller is logged in, runs one SQL statement, and returns the result as JSON.

To install and start the server, follow the [quickstart](index.md#quickstart). This page covers how to call the API and what comes back.

## Conventions

| Topic | Convention |
|-------|------------|
| **Base URL** | `http://<API_HOST>:<API_PORT>`, from `API/.env`. The examples use `http://127.0.0.1:5000`. |
| **Request bodies** | JSON, sent with `Content-Type: application/json`. A body that is missing or is not valid JSON is treated as an empty object, so the response is a `400` naming the fields that are missing. |
| **Responses** | JSON, except `DELETE`, which returns an empty `204`. Object keys come back in alphabetical order. |
| **Authentication** | A session cookie set by `POST /login`. Every data endpoint returns `401` without it. |
| **Browsers** | The API sends no CORS headers, so a web page can only call it from the same origin. That is why the API [serves the frontend itself](frontend.md#why-the-api-serves-the-page). |

## Authentication

The API has exactly one user, whose username and password are the `API_USERNAME` and `API_PASSWORD` values in `.env`. Logging in sets a cookie; the client sends that cookie back with each later request.

![Sequence diagram: the client posts a username and password to /login. The API checks them against the values in .env and answers 200 with a session cookie. The client requests /expenses with the cookie; the API queries PostgreSQL and returns the rows as JSON. The client posts to /logout and the session is cleared. A further request to /expenses gets 401 login required.](assets/diagrams/auth-sequence.svg)

*Solid arrows are requests and dashed arrows are responses. PostgreSQL is only reached once the cookie has been accepted.*

### POST `/login`

Starts a session. The only endpoint, apart from the page at `/`, that works without a cookie.

| Body field | Type | Description |
|------------|------|-------------|
| `username` | string | Must equal `API_USERNAME` |
| `password` | string | Must equal `API_PASSWORD` |

**Request**

```bash
curl -c cookies.txt -X POST http://127.0.0.1:5000/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "me", "password": "secret"}'
```

**Response · 200**

```json
{"message": "logged in"}
```

Wrong or missing credentials give `401` with `{"error": "invalid credentials"}`. The response is the same whichever of the two values was wrong.

### POST `/logout`

Ends the session. Takes no body. Requires a session, so calling it when already logged out gives `401`.

**Request**

```bash
curl -b cookies.txt -c cookies.txt -X POST http://127.0.0.1:5000/logout
```

**Response · 200**

```json
{"message": "logged out"}
```

### About the session cookie

- It is a standard Flask session cookie named `session`. Flask signs it with `SECRET_KEY`, so a client cannot forge or alter one, and no session data is stored on the server.
- Because nothing is stored server-side, restarting the API does not log anyone out. Changing `SECRET_KEY` does: every existing cookie stops verifying.
- Credentials are compared with `hmac.compare_digest`, which takes the same time whether the first or the last character is wrong, so response timing does not leak how close a guess was.
- With curl, `-c cookies.txt` saves the cookie and `-b cookies.txt` sends it. A browser does both automatically.

## What happens to a request

Every data endpoint follows the same path through `app.py`. Knowing the path tells you which status code to expect when something goes wrong, because each step has its own way of failing.

![Flow diagram: a request passes through five steps. The session check fails with 401 login required. The input check fails with 400 for a missing field or query parameter. Running the SQL fails with 503 database unavailable. PostgreSQL constraints fail with 409 already exists for a duplicate name, or 400 with the database's own message. Building the response fails with 404 expense not found when a DELETE matches no row. Otherwise the result is 200, 201 or 204.](assets/diagrams/request-lifecycle.svg)

*Steps 1, 2, 3 and 5 are code in `app.py`. Step 4 happens inside PostgreSQL, and `app.py` translates what it reports.*

The API deliberately does little validation of its own in step 2. It checks that required values are *present* and leaves the question of whether they are *valid* to the database in step 4, which already has the rules. This keeps each rule in one place, at the cost of error messages that are worded by PostgreSQL rather than for end users.

## Endpoint reference

All nine endpoints below require a session. Example responses assume a freshly set-up database, where “Food & Dining” has id 1.

| # | Endpoint | Input | Success |
|---|----------|-------|---------|
| 1 | [`POST /categories`](#post-categories) | JSON `name` | `201`, the new category |
| 2 | [`GET /categories`](#get-categories) | none | `200`, list ordered by name |
| 3 | [`POST /expenses`](#post-expenses) | JSON `category_id`, `amount`, `description`, `date` | `201`, the new expense |
| 4 | [`GET /expenses`](#get-expenses) | none | `200`, list, most recent first |
| 5 | [`GET /expenses/by-category`](#get-expensesby-category) | `?name=` | `200`, list, most recent first |
| 6 | [`GET /expenses/totals-by-category`](#get-expensestotals-by-category) | none | `200`, list, highest total first |
| 7 | [`GET /expenses/by-date-range`](#get-expensesby-date-range) | `?start=&end=` | `200`, list, most recent first |
| 8 | [`GET /expenses/monthly-total`](#get-expensesmonthly-total) | `?month=` | `200`, single object |
| 9 | [`DELETE /expenses/<id>`](#delete-expensesid) | id in the path | `204`, no body |

### POST `/categories`

Use case 1 ([SQL](database.md#1-add-a-category)). Creates a category and returns it with its new id.

| Body field | Type | Description |
|------------|------|-------------|
| `name` | string, required | The category label. Must not already exist; the comparison is case-sensitive. |

**Request**

```bash
curl -b cookies.txt -X POST http://127.0.0.1:5000/categories \
  -H 'Content-Type: application/json' \
  -d '{"name": "Travel"}'
```

**Response · 201**

```json
{"id": 9, "name": "Travel"}
```

**Errors:** `400` `name is required` · `409` `already exists`

### GET `/categories`

Use case 2 ([SQL](database.md#2-list-categories)). Lists every category in alphabetical order.

**Request**

```bash
curl -b cookies.txt http://127.0.0.1:5000/categories
```

**Response · 200** (the first three of eight)

```json
[
  {"id": 4, "name": "Entertainment"},
  {"id": 1, "name": "Food & Dining"},
  {"id": 5, "name": "Health & Medical"}
]
```

### POST `/expenses`

Use case 3 ([SQL](database.md#3-add-an-expense)). Records an expense and returns it with its new id.

| Body field | Type | Description |
|------------|------|-------------|
| `category_id` | integer, required | The id of an existing category |
| `amount` | number or numeric string, required | Greater than zero. Stored to two decimal places. |
| `description` | string, required | What the expense was for |
| `date` | string, required | A calendar date as `YYYY-MM-DD` |

**Request**

```bash
curl -b cookies.txt -X POST http://127.0.0.1:5000/expenses \
  -H 'Content-Type: application/json' \
  -d '{"category_id": 1, "amount": 45.99,
       "description": "Grocery run", "date": "2026-09-01"}'
```

**Response · 201**

```json
{
  "amount": "45.99",
  "category_id": 1,
  "date": "2026-09-01",
  "description": "Grocery run",
  "id": 1
}
```

**Errors:** `400` `missing fields: …`, listing each absent or empty field · `400` with a [database message](#messages-that-come-from-the-database) when the amount is not positive, the category does not exist, or a value has the wrong form.

Unlike the list endpoints, this response carries `category_id` rather than the category's name.

### GET `/expenses`

Use case 4 ([SQL](database.md#4-list-all-expenses-most-recent-first)). Lists every expense with its category name, most recent date first.

**Request**

```bash
curl -b cookies.txt http://127.0.0.1:5000/expenses
```

**Response · 200**

```json
[
  {
    "amount": "45.99",
    "category": "Food & Dining",
    "date": "2026-09-01",
    "description": "Grocery run",
    "id": 1
  }
]
```

### GET `/expenses/by-category`

Use case 5 ([SQL](database.md#5-list-the-expenses-in-one-category)). Lists the expenses in one category, most recent first.

| Query parameter | Type | Description |
|-----------------|------|-------------|
| `name` | string, required | The exact category name, URL-encoded. “Food & Dining” becomes `Food%20%26%20Dining`. |

**Request**

```bash
curl -b cookies.txt -G http://127.0.0.1:5000/expenses/by-category \
  --data-urlencode 'name=Food & Dining'
```

**Response · 200**

```json
[
  {
    "amount": "45.99",
    "date": "2026-09-01",
    "description": "Grocery run",
    "id": 1
  }
]
```

**Errors:** `400` `name query parameter is required`

The objects have no `category` field, since the caller supplied it. A name that matches no category returns an empty list, not a `404`.

### GET `/expenses/by-date-range`

Use case 7 ([SQL](database.md#7-list-expenses-in-a-date-range)). Lists the expenses dated between two days, including both, most recent first.

| Query parameter | Type | Description |
|-----------------|------|-------------|
| `start` | string, required | First day of the range, `YYYY-MM-DD` |
| `end` | string, required | Last day of the range, `YYYY-MM-DD` |

**Request**

```bash
curl -b cookies.txt \
  "http://127.0.0.1:5000/expenses/by-date-range?start=2026-09-01&end=2026-09-30"
```

**Response · 200**

```json
[
  {
    "amount": "45.99",
    "category": "Food & Dining",
    "date": "2026-09-01",
    "description": "Grocery run",
    "id": 1
  }
]
```

**Errors:** `400` `start and end query parameters are required (YYYY-MM-DD)` · `400` with a [database message](#messages-that-come-from-the-database) if either value is not a real date.

If `start` is after `end` the result is an empty list.

### DELETE `/expenses/<id>`

Use case 9 ([SQL](database.md#9-delete-an-expense)). Deletes one expense. There is no undo.

| Path parameter | Type | Description |
|----------------|------|-------------|
| `id` | non-negative integer | The id of the expense to delete |

**Request**

```bash
curl -i -b cookies.txt -X DELETE http://127.0.0.1:5000/expenses/1
```

**Response · 204** has no body.

**Errors:** `404` `expense not found`

### GET `/expenses/totals-by-category`

Use case 6 ([SQL](database.md#6-total-spending-per-category)). Returns one object per category with its expense count and total, highest total first. Categories with no expenses are included, at the end.

**Request**

```bash
curl -b cookies.txt http://127.0.0.1:5000/expenses/totals-by-category
```

**Response · 200** (the first two of eight)

```json
[
  {
    "category": "Food & Dining",
    "num_expenses": 1,
    "total_spent": "45.99"
  },
  {
    "category": "Housing",
    "num_expenses": 0,
    "total_spent": null
  }
]
```

For an unused category `num_expenses` is `0` but `total_spent` is `null`, not `"0.00"`. Clients should treat `null` as zero.

### GET `/expenses/monthly-total`

Use case 8 ([SQL](database.md#8-total-for-a-month)). Returns the sum of all expenses dated in one calendar month.

| Query parameter | Type | Description |
|-----------------|------|-------------|
| `month` | string, required | The month as `YYYY-MM`, with a two-digit month |

**Request**

```bash
curl -b cookies.txt \
  "http://127.0.0.1:5000/expenses/monthly-total?month=2026-09"
```

**Response · 200**

```json
{"monthly_total": "45.99"}
```

**Errors:** `400` `month query parameter is required (YYYY-MM)`

> **A malformed month is not an error.**
> The value is compared as text and never parsed. `?month=2026-9` or `?month=September` returns `200` with `{"monthly_total": null}`, exactly like a real month with no expenses.

## Response formats

| Kind of value | In JSON | Why |
|---------------|---------|-----|
| Amounts and totals | String: `"45.99"` | A JSON number would be read as floating point by most clients, which cannot represent every decimal amount exactly. A string carries the value from `NUMERIC` unchanged. |
| Dates | ISO 8601 string: `"2026-09-01"` | The same form the API accepts, and one that sorts correctly as text. |
| Ids and counts | Number: `1` | Whole numbers are safe as JSON numbers. |
| A sum over no rows | `null` | Passed through from SQL, where `SUM` of nothing is `NULL`. |

The fields in each response:

| Endpoint | Fields in each object |
|----------|-----------------------|
| `POST /categories`, `GET /categories` | `id`, `name` |
| `POST /expenses` | `id`, `category_id`, `amount`, `description`, `date` |
| `GET /expenses`, `GET /expenses/by-date-range` | `id`, `category`, `amount`, `description`, `date` |
| `GET /expenses/by-category` | `id`, `amount`, `description`, `date` |
| `GET /expenses/totals-by-category` | `category`, `num_expenses`, `total_spent` |
| `GET /expenses/monthly-total` | `monthly_total` |

## Errors

Errors raised by the application are JSON objects with a single key:

```json
{"error": "expense not found"}
```

| Status | Meaning | What to do |
|--------|---------|------------|
| `400` | A required field or query parameter is missing, or the database rejected a value | Fix the request. The message names the missing fields or quotes the database. |
| `401` | No valid session, or wrong credentials on `/login` | Log in, then retry with the cookie. |
| `404` | The expense to delete does not exist | Refresh your list; it may already be gone. |
| `409` | A category with that name already exists | Use the existing category or choose another name. |
| `503` | PostgreSQL could not be reached or refused the connection | Check that the database is running and that the `DB_*` values in `.env` are right. |

### Messages that come from the database

When PostgreSQL rejects a value, the API returns `400` and passes on PostgreSQL's own primary error message. These are precise but written for developers:

| Cause | Message |
|-------|---------|
| Amount of zero or less | `new row for relation "expenses" violates check constraint "expenses_amount_check"` |
| `category_id` that does not exist | `insert or update on table "expenses" violates foreign key constraint "expenses_category_id_fkey"` |
| Date that is not in a recognised form | `invalid input syntax for type date: "soon"` |
| Date that is not on the calendar, such as `2026-02-30` | `date/time field value out of range: "2026-02-30"` |

> **Not every error is JSON.**
> Errors that Flask raises before a handler runs keep Flask's default HTML body. That covers an unknown path, a wrong method (`405`), and a `DELETE /expenses/<id>` whose id is not a non-negative integer, which Flask treats as an unknown path (`404`). Check the status code before parsing the body.

## Example session

A complete run from login to delete. Set `BASE` once and paste the rest.

```bash
BASE=http://127.0.0.1:5000

# Log in and keep the session cookie
curl -c cookies.txt -X POST $BASE/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "<API_USERNAME>", "password": "<API_PASSWORD>"}'

# Add a category
curl -b cookies.txt -X POST $BASE/categories \
  -H 'Content-Type: application/json' \
  -d '{"name": "Travel"}'

# Add an expense
curl -b cookies.txt -X POST $BASE/expenses \
  -H 'Content-Type: application/json' \
  -d '{"category_id": 1, "amount": 45.99, "description": "Grocery run", "date": "2026-09-01"}'

# Expenses for one category (URL-encode the name)
curl -b cookies.txt -G $BASE/expenses/by-category --data-urlencode 'name=Food & Dining'

# Expenses in September, and the month's total
curl -b cookies.txt "$BASE/expenses/by-date-range?start=2026-09-01&end=2026-09-30"
curl -b cookies.txt "$BASE/expenses/monthly-total?month=2026-09"

# Delete an expense
curl -b cookies.txt -X DELETE $BASE/expenses/1
```

## How app.py is organised

The file reads top to bottom in the order a request meets it: configuration, shared helpers, authentication, error handling, then one short handler per use case.

| Dependency | Used for |
|------------|----------|
| Flask | Routing, request parsing and JSON responses |
| Flask-Login | The `@login_required` decorator and session handling |
| psycopg (version 3) | Talking to PostgreSQL |
| python-dotenv | Loading `API/.env` into the environment at startup |

### One helper runs every query

```python
def run(sql, params=()):
    """Run one statement; return rows if it produces any, else the row count."""
    with psycopg.connect(**DB, row_factory=dict_row) as conn:
        cur = conn.execute(sql, params)
        return cur.fetchall() if cur.description else cur.rowcount
```

Four things happen in these few lines:

- **One connection, one transaction, per call.** The `with` block commits when the statement succeeds, rolls back if it raises, and closes the connection either way.
- **Rows become dictionaries.** `dict_row` makes each row a `dict` keyed by column name, which `jsonify` can return directly. The SQL aliases, such as `AS category`, are therefore also the JSON field names.
- **The return value depends on the statement.** A `SELECT`, or an `INSERT … RETURNING`, gives a list of rows. A plain `DELETE` gives the number of rows affected, which is how the delete handler tells `204` from `404`.
- **Values never touch the SQL text.** See below.

### Parameterized queries

Each handler passes user input separately from the SQL, using `%s` placeholders:

```python
rows = run("INSERT INTO categories (name) VALUES (%s) RETURNING id, name", (data["name"],))
```

psycopg sends the statement and the values to PostgreSQL as separate things, so a value is only ever treated as data. A category named `'); DROP TABLE expenses; --` is stored as that literal, odd name. This is the standard defence against SQL injection, and it is the one change between the statements in `SQL/queries.sql` and the ones the API runs: example values become placeholders, and the two `INSERT`s gain a `RETURNING` clause so the new row can be sent back.

### Database errors become HTTP errors

Handlers do not catch exceptions. Three functions registered with Flask translate any psycopg error raised anywhere in the app:

| psycopg exception | Raised when | Response |
|-------------------|-------------|----------|
| `UniqueViolation` | A `UNIQUE` constraint fails | `409 already exists` |
| `IntegrityError` | Any other constraint fails: foreign key, check, not null | `400` with the database message |
| `DataError` | A value cannot be converted to the column type | `400` with the database message |
| `OperationalError` | The connection cannot be made or is lost | `503 database unavailable` |

`UniqueViolation` is a subclass of `IntegrityError`. Flask picks the handler registered for the most specific class, so a duplicate name gets `409` rather than the general `400`.

### A custom JSON provider for dates

Flask already serialises `Decimal` values as strings, which gives amounts their exact form. Its default for dates, however, is the HTTP date format (`Tue, 01 Sep 2026 00:00:00 GMT`). The small `JSONProvider` class at the top of `app.py` overrides that one case to return `date.isoformat()`.

---

Previous: [Database](database.md) · Next: [Frontend](frontend.md)
