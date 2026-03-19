![Shrew Banner](ui/static/md_banner.jpg)

# Shrew

Shrew is a browser automation workspace built around editable JSON recipes.

It lets you:

- describe web flows as structured steps
- compile those steps into Playwright scripts
- run flows from the terminal or from a local UI
- inspect and edit steps directly
- repair broken selectors with AI and save the fix back into the recipe

## What Shrew Is

Shrew is meant to make browser automation easier to understand, easier to edit, and easier to recover when websites change.

Instead of keeping all automation logic only in raw Playwright code, Shrew stores flows as JSON recipes. Those recipes are compiled into runnable scripts, and the system can update selectors when a step fails.

## Core Ideas

### 1. Recipes are the source of truth

Each flow lives as a JSON file in `recipes/`.

A recipe contains:

- metadata
- config
- variables
- steps

This makes flows easier to inspect, edit, and version.

### 2. Flows are compiled

Recipes are compiled into Playwright scripts in `flows/`.

That gives you:

- a structured recipe for editing
- a generated script for execution

### 3. Healing writes back to the recipe

When a selector fails, Shrew can inspect the current page, ask AI for the best replacement selector, validate it, and persist that new selector back into the JSON recipe.

This keeps the automation improving over time instead of failing the same way again and again.

### 4. The UI is part of the workflow

Shrew includes a local UI for:

- browsing recipes
- reviewing step lists
- running flows
- creating new recipes from Playwright codegen
- editing individual steps and saving them back into JSON

## Project Structure

```text
recipes/        JSON flow definitions
flows/          generated Playwright scripts
utils/          compiler, runner, healing logic, helpers
scripts/        small supporting scripts and local UI server
ui/             local frontend for browsing and editing flows
data/           supporting data files used by flows
```

## Supported Step Types

Shrew currently supports step types such as:

- `navigate`
- `click`
- `fill`
- `hover`
- `press`
- `selectOption`
- `waitForTimeout`

Recipes can also carry helpful fields like:

- `selector`
- `description`
- `value`
- `url`
- `clearFirst`
- `waitUntil`
- `waitForURL`
- `waitForLoadState`

## How It Runs

### Run a flow

```powershell
npm run flow:run -- recipes/yourFlow.json
```

or

```powershell
node utils/runFlow.js recipes/yourFlow.json
```

### Start the UI

```powershell
npm run ui:start
```

Then open:

```text
http://localhost:3010
```

## Editing and Creation

### Edit existing steps

In the UI, each step card can be edited with the top-right toggle.

When saved, the change is written back to the JSON recipe and the generated flow file is recompiled.

### Create a recipe from Playwright codegen

The UI includes an `Add` action where you can paste Playwright recorded code.

Shrew uses AI to convert that snippet into its JSON recipe format and then generates the matching flow script.

## AI Repair

Shrew includes AI-assisted selector repair.

When a step fails:

1. the failed step is identified
2. the page is inspected for relevant candidates
3. AI chooses the best selector
4. the selector is validated
5. the recipe is updated
6. the flow is recompiled and retried

The goal is simple:

- keep flows editable
- keep fixes persistent
- reduce manual selector repair work

## Environment

Create a `.env` file for any secrets your flows need.

Common values include:

- `OPENAI_API_KEY` for AI-based repair and recipe creation
- any site-specific credentials or secrets required by your flows

## Why This Project Exists

Shrew is built for a practical middle ground between:

- raw browser scripts that are powerful but brittle
- heavy no-code tools that can be hard to control

It gives you a flow format that stays readable, a generated script that stays runnable, and a repair path that helps when the page changes.

## Current State

Shrew already supports:

- JSON recipe authoring
- script compilation
- terminal execution
- local UI browsing and editing
- AI-based recipe creation from Playwright codegen
- AI-based selector healing

It is a working foundation for building and maintaining browser automations in a more structured way.
