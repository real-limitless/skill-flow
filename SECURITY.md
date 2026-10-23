# Security

## Reporting a vulnerability

Report a vulnerability privately through GitHub Security Advisories for this repository (Security → Report a vulnerability). Do not open a public issue for an undisclosed vulnerability, and do not include secret values in the report.

Include the affected version or commit, what you found, and how to reproduce it. The repository owner will acknowledge the report and coordinate a fix.

## Operations

### Interim on-call

The repository owner is the interim on-call contact. The deployment operator is the first responder: they can revoke access and take the service offline while the owner is reached.

### Kill switch

1. Revoke an operator session
   - The signed-in operator can choose **Sign out everywhere** in the admin console, or call `POST /v1/auth/revoke-sessions` with the session cookie and `X-CSRF-Token`. That revokes every session for that operator.
   - To revoke another operator, call `POST /v1/operators/<id>/sessions/revoke` with a signed-in operator session (and CSRF token) or the admin Bearer token.
2. Revoke the admin token
   - Rotate `SKILL_FLOW_ADMIN_TOKEN` to a new value and restart the process. The previous bearer stops working when the process restarts. Unset the variable to disable break-glass Bearer until a new value is set. The token is not stored in the database.
   - Rotating the token does not delete operator accounts. Revoking sessions does not delete operators.
3. Take the service offline
   - From the deployment directory, run `docker compose stop`, or stop the process that runs `skill-flow serve --http`.

A named volume created before the image ran as the `node` user may still be owned by root. If the restarted container cannot write `/data`, chown that volume to the `node` user (uid 1000) once, then start the service again.
