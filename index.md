# Personal Expense Tracker

A small, complete three-tier application: a PostgreSQL database for logging expenses by category, a Flask API that exposes each query over HTTP behind a login, and a single-page web frontend for that API.

The project is deliberately small, about 700 lines in total, so that every layer can be read in one sitting. These pages explain what each layer does, why it is built the way it is, and how the three fit together.

| Page | Source | What it covers |
|------|--------|----------------|
| [Database](database.md) | `SQL/` | Two tables, the rules they enforce, and the nine queries behind the application |
| [API](api.md) | `API/app.py` | Authentication, a reference for all eleven endpoints, response formats and errors |
| [Frontend](frontend.md) | `frontend/index.html` | How one HTML file logs in, loads data and keeps the page in sync with the API |

## Architecture

Each tier talks only to the one next to it. The browser never touches the database, and the database knows nothing about HTTP.

![System architecture: a browser sends JSON over HTTP to the Flask API. Inside the API, Flask-Login checks the session cookie and passes the request to a route handler, which runs parameterized SQL against PostgreSQL. The API reads its settings from API/.env at startup.](assets/diagrams/architecture.svg)

*A request crosses three boundaries: HTTP into Flask, the login check, then SQL into PostgreSQL. The response travels back the same way as JSON.*

| Tier | Built with | Responsible for |
|------|------------|-----------------|
| [Database](database.md) | PostgreSQL | Storing categories and expenses, and refusing data that breaks the rules: duplicate names, non-positive amounts, expenses without a category. |
| [API](api.md) | Python, Flask, Flask-Login, psycopg 3 | Checking who is calling, validating that required inputs are present, running one SQL statement per request, and turning rows and database errors into JSON. |
| [Frontend](frontend.md) | One HTML file with inline CSS and JavaScript | Forms and tables for a person to use. It holds no data of its own and re-reads from the API after every change. |

## One use case, three layers

The whole project is organised around nine use cases. Each one is written once as a SQL query, exposed once as an API endpoint, and surfaced once in the page. If you understand one row of this table, you understand the pattern for all of them.

| # | As a user, I need to… | SQL | Endpoint | In the page |
|---|------------------------|-----|----------|-------------|
| 1 | Add an expense category | `INSERT` into `categories` | [`POST /categories`](api.md#post-categories) | Add category |
| 2 | View all categories | `SELECT`, ordered by name | [`GET /categories`](api.md#get-categories) | Category drop-downs |
| 3 | Add an expense | `INSERT` into `expenses` | [`POST /expenses`](api.md#post-expenses) | Add expense |
| 4 | View all expenses, most recent first | `JOIN`, ordered by date | [`GET /expenses`](api.md#get-expenses) | Expenses, “All expenses” |
| 5 | See the expenses in one category | `JOIN` filtered by category name | [`GET /expenses/by-category`](api.md#get-expensesby-category) | Expenses, “One category” |
| 6 | See total spending per category | `LEFT JOIN` with `COUNT` and `SUM` | [`GET /expenses/totals-by-category`](api.md#get-expensestotals-by-category) | Spending by category |
| 7 | See expenses in a date range | `JOIN` filtered with `BETWEEN` | [`GET /expenses/by-date-range`](api.md#get-expensesby-date-range) | Expenses, “Date range” |
| 8 | See the total for a month | `SUM` filtered by `to_char` | [`GET /expenses/monthly-total`](api.md#get-expensesmonthly-total) | Monthly total |
| 9 | Delete an expense | `DELETE` by id | [`DELETE /expenses/<id>`](api.md#delete-expensesid) | Delete button on each row |

Two more endpoints, `POST /login` and `POST /logout`, exist for [authentication](api.md#authentication), and `GET /` serves the frontend itself.

## Quickstart

You need PostgreSQL, Python 3 and a terminal. These steps take a fresh clone to a running app.

1. **Get the code**

   ```bash
   git clone https://github.com/gormes-EPIC/expense_sample.git
   cd expense_sample
   ```

2. **Create the database and its tables**

   The database name is up to you; `expenses` is used here. The script creates both tables and inserts eight default categories, and is safe to run again.

   ```bash
   createdb expenses
   psql -d expenses -f SQL/setup.sql
   ```

3. **Fill in `API/.env`**

   The file ships with a `<PLACEHOLDER>` for each of its ten values. Replace every one before starting the server. A local setup looks like this, with your own values in place of the angle brackets:

   ```ini
   SECRET_KEY=<output of the command below>

   API_HOST=127.0.0.1
   API_PORT=5000

   API_USERNAME=<a username of your choice>
   API_PASSWORD=<a password of your choice>

   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=expenses
   DB_USER=<your PostgreSQL user>
   DB_PASSWORD=<that user's password>
   ```

   Generate the secret key with:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

4. **Install the dependencies and start the server**

   ```bash
   cd API
   pip install -r requirements.txt
   python app.py
   ```

5. **Open the app**

   Go to `http://127.0.0.1:5000/` and log in with the `API_USERNAME` and `API_PASSWORD` you chose. To check the API without a browser, ask for something that needs a login:

   ```bash
   curl -i http://127.0.0.1:5000/categories
   ```

   A `401` with the body `{"error": "login required"}` means the server is up and the login check is working.

## Repository layout

| Path | Contents | Explained in |
|------|----------|--------------|
| `SQL/setup.sql` | Creates the tables and seeds the default categories | [Database › Schema](database.md#schema) |
| `SQL/queries.sql` | One SQL query per use case | [Database › Queries by use case](database.md#queries-by-use-case) |
| `API/app.py` | The Flask API, 253 lines | [API](api.md) |
| `API/requirements.txt` | Flask, Flask-Login, psycopg and python-dotenv | [API › How app.py is organised](api.md#how-apppy-is-organised) |
| `API/.env` | Secrets and machine-specific settings, as placeholders | [Quickstart](#quickstart) |
| `frontend/index.html` | The web frontend: one file with inline CSS and JavaScript | [Frontend](frontend.md) |
| `datadictionary.md` | Use cases, business rules and the data dictionary | [Database › Rules](database.md#rules-and-where-they-are-enforced) |

> **The folder is `SQL/`, in capitals.**
> The repository's own README writes the paths as `sql/setup.sql`. On Linux and other case-sensitive file systems that path does not exist, so the commands on this site use `SQL/`.

## What this sample leaves out

The code is a teaching sample, and several choices that keep it short would need revisiting before it handled real money or real users.

- **One user.** The only login is the username and password in `.env`. There is no users table, and expenses are not owned by anyone.
- **Development server.** `python app.py` starts Flask's built-in server, which is meant for local use. It serves plain HTTP, so the session cookie and the login request are unencrypted on the network.
- **A new database connection per request.** Simple and correct, but slower than a connection pool under load.
- **Create, read and delete only.** Expenses cannot be edited, and categories cannot be renamed or removed through the API.
- **No pagination.** List endpoints return every matching row.
- **Secrets file in the repository.** `API/.env` is committed with placeholders. Once it holds real values, keep it out of version control.

---

Next: [Database](database.md)
