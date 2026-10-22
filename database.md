# Two tables and the rules they keep

PostgreSQL stores the data and is the final authority on what counts as valid. Everything above it, the API and the page, can be wrong or bypassed and the data stays consistent.

The database lives in two files. `SQL/setup.sql` defines the schema and seeds it. `SQL/queries.sql` holds one query for each of the nine use cases, which the [API](api.md) then runs with real values in place of the examples.

## Data model

There are two entities. A **category** is a label such as “Food & Dining”. An **expense** is one purchase: an amount, a description, a date and the category it falls under.

![Entity relationship diagram: the categories table has columns id (primary key) and name (unique). The expenses table has columns id (primary key), category_id (foreign key to categories.id), amount, description and date. One category has zero or more expenses.](assets/diagrams/erd.svg)

*One category has zero or more expenses. Every expense belongs to exactly one category, through `expenses.category_id`. PK is primary key, FK foreign key, UK unique.*

## Schema

This is the whole of the schema, from `SQL/setup.sql`:

```sql
CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_id INTEGER        NOT NULL,
    amount      NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    description TEXT           NOT NULL,
    date        DATE           NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id)
);
```

### Table: categories

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, GENERATED ALWAYS AS IDENTITY | Unique identifier, assigned by the database |
| `name` | TEXT | NOT NULL, UNIQUE | The label people see, for example “Food & Dining” |

### Table: expenses

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY, GENERATED ALWAYS AS IDENTITY | Unique identifier, assigned by the database |
| `category_id` | INTEGER | NOT NULL, FOREIGN KEY → `categories.id` | The category this expense belongs to |
| `amount` | NUMERIC(10, 2) | NOT NULL, CHECK (`amount > 0`) | Amount spent, in dollars and cents |
| `description` | TEXT | NOT NULL | A short note on what the expense was for |
| `date` | DATE | NOT NULL | The day the expense happened |

### Why these types

- **`NUMERIC(10, 2)` for money.** It stores exact decimal values, so 0.10 + 0.20 is exactly 0.30, which binary floating point cannot promise. Ten digits with two after the point allows amounts up to 99,999,999.99. A value with more decimal places is rounded to two when stored.
- **`DATE` rather than text.** PostgreSQL rejects impossible dates such as 30 February, and comparisons like `BETWEEN` and `ORDER BY` follow the calendar instead of the alphabet.
- **`GENERATED ALWAYS AS IDENTITY` for ids.** The database hands out the numbers. `ALWAYS` means an `INSERT` that tries to supply its own id is an error, so callers cannot collide with or guess at ids.

## Rules and where they are enforced

The business rules come from `datadictionary.md`. Most are enforced in more than one tier, and the tiers do different jobs: the page catches mistakes early and politely, the API returns clear messages for missing input, and the database is the backstop that cannot be skipped.

| Rule | Database | API | Frontend |
|------|----------|-----|----------|
| Category names are unique | `UNIQUE` | Reports the violation as `409` | Shows the error message |
| A category has a name | `NOT NULL` | Rejects a missing or empty `name` | `required` field, trimmed before sending |
| An amount is greater than zero | `CHECK (amount > 0)` | Rejects a missing amount | Number input with `min="0.01"` |
| An expense has a description | `NOT NULL` | Rejects a missing or empty `description` | `required` field, trimmed before sending |
| The date is a real calendar date | `DATE` type | Rejects a missing date | Date picker |
| An expense belongs to an existing category | `NOT NULL` and `FOREIGN KEY` | Rejects a missing `category_id` | Drop-down filled from `GET /categories` |
| Ids are assigned by the database | `GENERATED ALWAYS` | Never accepts an id in a request body | No id field |

> **“Not null” is not the same as “not empty”.**
> `NOT NULL` stops a missing value, but PostgreSQL treats the empty string `''` as a perfectly good piece of text. The rule that names and descriptions must not be empty is therefore enforced by the API, not the database: an `INSERT` run directly in `psql` with an empty name would succeed.

### Deleting a category that is in use

The foreign key is declared without an `ON DELETE` clause, so PostgreSQL uses its default: a category cannot be deleted while any expense still points at it. Nothing is ever cascaded or orphaned. The API has no endpoint for deleting categories, so this only matters if you work in `psql` directly.

### Derived values

Totals and counts are never stored. They are computed when asked for, so they cannot drift out of step with the expenses they summarise.

| Value | How it is derived | Used by |
|-------|-------------------|---------|
| Total spending for a category | `SUM(amount)` of the expenses with that `category_id` | [Use case 6](#6-total-spending-per-category) |
| Number of expenses per category | `COUNT(id)` grouped by category | [Use case 6](#6-total-spending-per-category) |
| Total spending for a month | `SUM(amount)` of the expenses whose date, formatted as `YYYY-MM`, matches | [Use case 8](#8-total-for-a-month) |

## Setup and seed data

Create a database, then run the setup script against it:

```bash
createdb <DB_NAME>
psql -h <DB_HOST> -p <DB_PORT> -U <DB_USER> -d <DB_NAME> -f SQL/setup.sql
```

After creating the tables, the script inserts eight starting categories:

```sql
INSERT INTO categories (name) VALUES
    ('Food & Dining'),
    ('Transportation'),
    ('Housing'),
    ('Entertainment'),
    ('Health & Medical'),
    ('Shopping'),
    ('Utilities'),
    ('Other')
ON CONFLICT (name) DO NOTHING;
```

The script is safe to run more than once. `CREATE TABLE IF NOT EXISTS` leaves existing tables and their data alone, and `ON CONFLICT (name) DO NOTHING` skips any seed category that is already there. That second clause depends on the `UNIQUE` constraint on `name`.

To confirm the result:

```bash
psql -d <DB_NAME> -c "SELECT id, name FROM categories ORDER BY id;"
```

On a fresh database this lists the eight categories with ids 1 to 8, and “Food & Dining” is id 1.

## Queries by use case

`SQL/queries.sql` contains the nine statements below with example values written in, so each can be pasted into `psql` and run. The API runs the same statements with placeholders in place of the examples; see [how the API runs SQL](api.md#one-helper-runs-every-query).

### 1. Add a category

```sql
INSERT INTO categories (name) VALUES ('Travel');
```

Fails with a unique violation if “Travel” already exists. Names are compared exactly, so “travel” would be accepted as a different category.

### 2. List categories

```sql
SELECT id, name
FROM categories
ORDER BY name;
```

### 3. Add an expense

```sql
INSERT INTO expenses (category_id, amount, description, date)
VALUES (1, 45.99, 'Grocery run', '2026-09-01');
```

Fails if category 1 does not exist, if the amount is zero or negative, or if the date is not a real date.

### 4. List all expenses, most recent first

```sql
SELECT e.id,
       c.name  AS category,
       e.amount,
       e.description,
       e.date
FROM expenses e
JOIN categories c ON e.category_id = c.id
ORDER BY e.date DESC;
```

The join swaps the numeric `category_id` for the category's name, which is what a reader wants to see. An inner join is safe here because every expense is guaranteed to have a category.

Expenses on the same date come back in no particular order, because the date is the only sort key.

### 5. List the expenses in one category

```sql
SELECT e.id,
       e.amount,
       e.description,
       e.date
FROM expenses e
JOIN categories c ON e.category_id = c.id
WHERE c.name = 'Food & Dining'
ORDER BY e.date DESC;
```

The category is chosen by name, not id. The category column is left out of the result because the caller already knows it. A name that matches no category returns no rows rather than an error.

### 6. Total spending per category

```sql
SELECT c.name        AS category,
       COUNT(e.id)   AS num_expenses,
       SUM(e.amount) AS total_spent
FROM categories c
LEFT JOIN expenses e ON c.id = e.category_id
GROUP BY c.id, c.name
ORDER BY total_spent DESC NULLS LAST;
```

Three details make this query report on every category, including unused ones:

- It starts from `categories` and uses a `LEFT JOIN`, so a category with no expenses still produces a row.
- `COUNT(e.id)` counts only real expenses. For an unused category it gives 0, where `COUNT(*)` would give 1.
- `SUM` over no rows is `NULL`, not 0. `NULLS LAST` pushes those categories to the bottom; without it, a descending sort in PostgreSQL would list them first.

### 7. List expenses in a date range

```sql
SELECT e.id,
       c.name  AS category,
       e.amount,
       e.description,
       e.date
FROM expenses e
JOIN categories c ON e.category_id = c.id
WHERE e.date BETWEEN '2026-09-01' AND '2026-09-30'
ORDER BY e.date DESC;
```

`BETWEEN` includes both ends, so this covers the whole of September. If the start date is after the end date the range is empty and no rows come back.

### 8. Total for a month

```sql
SELECT SUM(amount) AS monthly_total
FROM expenses
WHERE to_char(date, 'YYYY-MM') = '2026-09';
```

`to_char` formats each date as text like `2026-09` and compares it with the month asked for. The result is always exactly one row. For a month with no expenses that row holds `NULL`.

The comparison is on text, so the month must be written with a four-digit year and a two-digit month. `'2026-9'` matches nothing.

### 9. Delete an expense

```sql
DELETE FROM expenses WHERE id = 1;
```

Deleting an id that does not exist is not an error in SQL; it simply affects zero rows. The API checks that count to decide between `204` and `404`.

---

Previous: [Overview](index.md) · Next: [API](api.md)
