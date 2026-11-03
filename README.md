# PVC Collection

Google Apps Script customer-search portal. Employees search customer records through the server-side application; administrators manage access, review activity, and append customer imports.

## Files in this repository

- `Code.gs` — backend implementation.
- `Index.html` — employee login, signup, search, WhatsApp tracking, and personal activity UI.
- `Admin.html` — administrator dashboard, user management, logs, and customer import UI.

The repository currently does not contain `Config.gs`, `Security.gs`, `Database.gs`, `Styles.html`, or `App.html`. The available backend is monolithic in `Code.gs`, and the current HTML files contain their own styles/scripts. These files were not fabricated as placeholders: extracting modules requires a deliberate refactor of the existing backend and template include contract.

## Confirmed frontend/backend correction

The backend defines normal employees as `USER` and administrators as `ADMIN`. `Index.html` now accepts `USER` for the employee portal and routes `ADMIN` to the admin page. It does not trust a browser-supplied role for server authorization; protected server functions still validate the session.

## Apps Script syntax error investigation

The prior `Admin.html` generated an XLSX template by embedding XML declarations such as `<?xml version="1.0" ...?>` in inline JavaScript string literals. Apps Script HTML templates parse `<? ... ?>` as template scriptlets, so the `<?xml` text can be interpreted as a server-side scriptlet and produce an error referring to the XML attribute `version`. The rewritten `Admin.html` removes those inline XML declarations and offers a CSV template while preserving XLSX import support.

This explains a credible source-level cause in the repository content. It does not prove which saved editor/deployment version produced a historical error; verify by saving the current project in Apps Script and testing its current deployment.

## Configuration

Set Apps Script Script Properties in the actual Apps Script project. Required values are defined by `Code.gs`, including `ADMIN_EMAIL`, `ADMIN_NAME`, `CUSTOMER_DB_ID`, `CUSTOMER_DB_SHEET`, `PASSWORD_PEPPER`, and `WEB_APP_URL`. Never commit secret values or share the private spreadsheets with employees.

## Verification boundaries

This repository change does not connect to Google Apps Script, Google Sheets, or a production deployment. No live authentication, customer search, import, or deployment test is claimed. Use a test Apps Script project and test spreadsheets before deploying. Do not run imports or user-management actions against production as part of validation.
