# Main Dashboard

A private dashboard.


## Design

- Dark themed
- `font-family: "Helvetica Neue", Helvetica, FreeSans, Arial, sans-serif`

### Buttons

- Use short labels (e.g. 'Create' instead of 'Create board')
- Stylize buttons with square brackets e.g. '[Create]'
- In tight spaces use single letter buttons
  - '[x]' for delete
  - '[+]' for add
  - '[e]' for edit etc.
- Editable entries are inline
  - Turn entry to a input by clicking on them
  - Write (update) entry on enter
- Titles (and single line entries)
  - Editing buttons are displayed in the same line
- Structure
  - Keep used `<div>`s to a minimum
  - Prefer single line (e.g. one-sided border) separators over `<div>`
  background color and borders
  

## Landing Page

- Horizontal `<nav>` menu for the Areas
- Columns for the Areas

## Areas

### Todo

- Kanban boards
- 3 columns: todo, doing, done
- Tasks can only be added in todo.
- Single line entries
- Each line can be reordered by dragging
- Each board can be reordered by dragging
- On the landing page
  - Each boards heading gets listed
  - Below each heading the top doing is showing
  - If there is no doing then the top todo is showing
- Keep a task in a single line
  - Moving to another Kanban column only by draging, no dropdown required
